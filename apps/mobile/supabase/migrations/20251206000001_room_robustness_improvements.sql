-- Phase 1: Room Robustness Improvements
-- Implements: Username uniqueness, atomic joins, host transfer, analytics
-- Date: December 6, 2025
-- Risk Level: Medium (schema changes)

-- ============================================================================
-- PART 1: ROOM ANALYTICS & ABANDONMENT TRACKING
-- ============================================================================

-- Room analytics table for debugging and metrics
CREATE TABLE IF NOT EXISTS room_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID,  -- Can be NULL if room deleted
  room_code TEXT NOT NULL,
  status_reached TEXT NOT NULL CHECK (status_reached IN ('waiting', 'playing', 'finished')),
  error_type TEXT CHECK (error_type IN (
    'all_players_left_waiting',
    'all_players_left_playing',
    'host_left_no_transfer',
    'game_crash',
    'network_timeout',
    'forced_close',
    'duplicate_name_conflict',
    'race_condition_join',
    NULL
  )),
  is_dirty BOOLEAN DEFAULT FALSE,
  player_count_at_event INTEGER DEFAULT 0,
  human_player_count INTEGER DEFAULT 0,
  bot_player_count INTEGER DEFAULT 0,
  time_in_waiting_seconds INTEGER,
  time_in_playing_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB
);

-- Indexes for analytics queries
CREATE INDEX idx_room_analytics_code ON room_analytics(room_code);
CREATE INDEX idx_room_analytics_error ON room_analytics(error_type) WHERE error_type IS NOT NULL;
CREATE INDEX idx_room_analytics_dirty ON room_analytics(is_dirty) WHERE is_dirty = true;
CREATE INDEX idx_room_analytics_event_time ON room_analytics(event_at DESC);

-- Function to log room lifecycle events
CREATE OR REPLACE FUNCTION log_room_event(
  p_room_id UUID,
  p_event_type TEXT,
  p_error_type TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_room RECORD;
  v_players RECORD;
  v_analytics_id UUID;
  v_time_in_waiting INTEGER;
  v_time_in_playing INTEGER;
  v_is_dirty BOOLEAN;
BEGIN
  -- Get room details
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RAISE WARNING 'Room % not found for event logging', p_room_id;
    RETURN NULL;
  END IF;
  
  -- Count players
  SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE is_bot = false) as humans,
    COUNT(*) FILTER (WHERE is_bot = true) as bots
  INTO v_players
  FROM room_players
  WHERE room_id = p_room_id;
  
  -- Calculate time spent in each phase
  v_time_in_waiting := EXTRACT(EPOCH FROM (
    COALESCE(v_room.started_at, NOW()) - v_room.created_at
  ))::INTEGER;
  
  v_time_in_playing := CASE 
    WHEN v_room.started_at IS NOT NULL THEN
      EXTRACT(EPOCH FROM (NOW() - v_room.started_at))::INTEGER
    ELSE 0
  END;
  
  -- Determine if room is dirty
  v_is_dirty := (p_error_type IS NOT NULL);
  
  -- Insert analytics record
  INSERT INTO room_analytics (
    room_id,
    room_code,
    status_reached,
    error_type,
    is_dirty,
    player_count_at_event,
    human_player_count,
    bot_player_count,
    time_in_waiting_seconds,
    time_in_playing_seconds,
    created_at,
    event_at,
    metadata
  ) VALUES (
    p_room_id,
    v_room.code,
    v_room.status,
    p_error_type,
    v_is_dirty,
    v_players.total,
    v_players.humans,
    v_players.bots,
    v_time_in_waiting,
    v_time_in_playing,
    v_room.created_at,
    NOW(),
    p_metadata
  ) RETURNING id INTO v_analytics_id;
  
  RETURN v_analytics_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION log_room_event IS 
  'Logs room lifecycle events to room_analytics table for debugging and metrics';

-- Trigger: Log when all players leave a room
CREATE OR REPLACE FUNCTION check_room_abandonment()
RETURNS TRIGGER AS $$
DECLARE
  v_remaining_players INTEGER;
  v_room_status TEXT;
BEGIN
  -- Count remaining players in room
  SELECT COUNT(*) INTO v_remaining_players
  FROM room_players
  WHERE room_id = OLD.room_id;
  
  -- Get room status
  SELECT status INTO v_room_status
  FROM rooms
  WHERE id = OLD.room_id;
  
  -- If last player left and room not finished, log abandonment
  IF v_remaining_players = 0 AND v_room_status != 'finished' THEN
    PERFORM log_room_event(
      OLD.room_id,
      'room_abandoned',
      CASE v_room_status
        WHEN 'waiting' THEN 'all_players_left_waiting'
        WHEN 'playing' THEN 'all_players_left_playing'
        ELSE 'unknown_abandonment'
      END,
      jsonb_build_object(
        'last_player_username', OLD.username,
        'last_player_was_host', OLD.is_host
      )
    );
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER room_abandonment_check
AFTER DELETE ON room_players
FOR EACH ROW
EXECUTE FUNCTION check_room_abandonment();

COMMENT ON TRIGGER room_abandonment_check ON room_players IS
  'Logs analytics event when last player leaves an unfinished room';

-- ============================================================================
-- PART 2: USERNAME UNIQUENESS CONSTRAINT
-- ============================================================================

-- Step 1: Clean existing duplicates by appending player_index
UPDATE room_players
SET username = username || '_' || player_index
WHERE id IN (
  SELECT UNNEST(player_ids[2:]) -- Keep first, rename rest
  FROM (
    SELECT 
      array_agg(id ORDER BY joined_at) as player_ids
    FROM room_players
    GROUP BY room_id, LOWER(username)
    HAVING COUNT(*) > 1
  ) sub
);

-- Step 2: Create unique index (case-insensitive)
CREATE UNIQUE INDEX idx_room_players_username_unique
ON room_players(room_id, LOWER(username));

COMMENT ON INDEX idx_room_players_username_unique IS
  'Prevents duplicate usernames within the same room (case-insensitive)';

-- Step 3: Function to check username availability
CREATE OR REPLACE FUNCTION is_username_available(
  p_room_id UUID,
  p_username TEXT,
  p_exclude_user_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = p_room_id
      AND LOWER(username) = LOWER(p_username)
      AND (p_exclude_user_id IS NULL OR user_id != p_exclude_user_id)
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION is_username_available IS
  'Check if username is available in a specific room before attempting join';

-- ============================================================================
-- PART 3: ATOMIC ROOM JOINS (RACE CONDITION PREVENTION)
-- ============================================================================

CREATE OR REPLACE FUNCTION join_room_atomic(
  p_room_code TEXT,
  p_user_id UUID,
  p_username TEXT
) RETURNS JSONB AS $$
DECLARE
  v_room_id UUID;
  v_player_count INTEGER;
  v_player_index INTEGER;
  v_is_host BOOLEAN;
  v_host_id UUID;
  v_room_status TEXT;
  v_result JSONB;
BEGIN
  -- Step 1: Lock and fetch room (blocks other joins)
  SELECT id, status, host_id INTO v_room_id, v_room_status, v_host_id
  FROM rooms
  WHERE code = UPPER(p_room_code)
  FOR UPDATE;  -- Row-level lock until transaction commits
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found: %', p_room_code;
  END IF;
  
  -- Step 2: Check room status
  IF v_room_status NOT IN ('waiting', 'playing') THEN
    RAISE EXCEPTION 'Room is not accepting players (status: %)', v_room_status;
  END IF;
  
  -- Step 3: Count current players (within locked transaction)
  SELECT COUNT(*) INTO v_player_count
  FROM room_players
  WHERE room_id = v_room_id;
  
  -- Step 4: Check capacity
  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;
  
  -- Step 5: Check if user already in this room
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id
  ) THEN
    -- User already in room, return existing data (idempotent)
    SELECT jsonb_build_object(
      'room_id', v_room_id,
      'room_code', p_room_code,
      'player_index', player_index,
      'is_host', is_host,
      'already_joined', true
    ) INTO v_result
    FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id;
    
    RETURN v_result;
  END IF;
  
  -- Step 6: Check if user is in a DIFFERENT room
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE user_id = p_user_id AND room_id != v_room_id
  ) THEN
    RAISE EXCEPTION 'User is already in another room';
  END IF;
  
  -- Step 7: Check username uniqueness
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND LOWER(username) = LOWER(p_username)
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken in this room', p_username;
  END IF;
  
  -- Step 8: Determine player_index and host status
  v_player_index := v_player_count;  -- 0, 1, 2, or 3
  v_is_host := (v_host_id IS NULL OR v_player_count = 0);  -- First player or abandoned room
  
  -- Step 9: Insert player
  INSERT INTO room_players (
    room_id,
    user_id,
    username,
    player_index,
    is_host,
    is_ready,
    is_bot
  ) VALUES (
    v_room_id,
    p_user_id,
    p_username,
    v_player_index,
    v_is_host,
    false,
    false
  );
  
  -- Step 10: Update room host if needed
  IF v_is_host THEN
    UPDATE rooms
    SET host_id = p_user_id
    WHERE id = v_room_id;
  END IF;
  
  -- Step 11: Build success response
  v_result := jsonb_build_object(
    'room_id', v_room_id,
    'room_code', p_room_code,
    'player_index', v_player_index,
    'is_host', v_is_host,
    'already_joined', false,
    'player_count', v_player_count + 1
  );
  
  -- Step 12: Log successful join (optional)
  PERFORM log_room_event(
    v_room_id,
    'player_joined',
    NULL,  -- Clean join
    jsonb_build_object(
      'username', p_username,
      'is_host', v_is_host
    )
  );
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    -- Log failed join attempt
    IF v_room_id IS NOT NULL THEN
      PERFORM log_room_event(
        v_room_id,
        'join_failed',
        'race_condition_join',
        jsonb_build_object(
          'username', p_username,
          'error', SQLERRM
        )
      );
    END IF;
    
    RAISE;  -- Re-raise the exception
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION join_room_atomic IS
  'Thread-safe room join with row-level locking to prevent race conditions';

-- ============================================================================
-- PART 4: AUTOMATIC HOST TRANSFER
-- ============================================================================

-- Function to reassign host when current host leaves
CREATE OR REPLACE FUNCTION reassign_next_host(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_new_host RECORD;
  v_room_status TEXT;
BEGIN
  -- Get room status
  SELECT status INTO v_room_status FROM rooms WHERE id = p_room_id;
  
  -- Only reassign in waiting rooms (not during active games)
  IF v_room_status != 'waiting' THEN
    RETURN false;
  END IF;
  
  -- Find next host: prefer humans over bots, lowest player_index wins
  SELECT user_id, player_index, username INTO v_new_host
  FROM room_players
  WHERE room_id = p_room_id
  ORDER BY 
    is_bot ASC,        -- Humans first (false < true)
    player_index ASC   -- Lowest index breaks ties
  LIMIT 1;
  
  IF NOT FOUND THEN
    -- No players left, mark room as abandoned
    UPDATE rooms
    SET host_id = NULL
    WHERE id = p_room_id;
    
    RETURN false;
  END IF;
  
  -- Assign new host
  UPDATE room_players
  SET is_host = true
  WHERE room_id = p_room_id AND user_id = v_new_host.user_id;
  
  UPDATE rooms
  SET host_id = v_new_host.user_id
  WHERE id = p_room_id;
  
  -- Log host transfer event
  PERFORM log_room_event(
    p_room_id,
    'host_transferred',
    NULL,  -- Not an error
    jsonb_build_object(
      'new_host_username', v_new_host.username,
      'new_host_player_index', v_new_host.player_index
    )
  );
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reassign_next_host IS
  'Assigns a new host when current host leaves a waiting room';

-- Trigger when host leaves room
CREATE OR REPLACE FUNCTION check_host_departure()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act if departing player was the host
  IF OLD.is_host = true THEN
    PERFORM reassign_next_host(OLD.room_id);
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reassign_host_on_leave
AFTER DELETE ON room_players
FOR EACH ROW
EXECUTE FUNCTION check_host_departure();

COMMENT ON TRIGGER reassign_host_on_leave ON room_players IS
  'Automatically reassigns host when current host leaves a waiting room';

-- ============================================================================
-- VALIDATION QUERIES (Run these after migration to verify)
-- ============================================================================

-- Verify tables exist
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' AND table_name = 'room_analytics';

-- Verify functions exist
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
-- AND routine_name IN ('join_room_atomic', 'reassign_next_host', 'log_room_event');

-- Verify triggers exist
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table = 'room_players';

-- Verify unique index
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'room_players'
-- AND indexname = 'idx_room_players_username_unique';
