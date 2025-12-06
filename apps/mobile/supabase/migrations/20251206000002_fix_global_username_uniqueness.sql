-- ROLLBACK Phase 1: Remove room-scoped uniqueness
-- This migration removes the incorrect room-scoped username constraint
-- and replaces it with GLOBAL username uniqueness

-- Drop the room-scoped unique index
DROP INDEX IF EXISTS idx_room_players_username_unique;

-- Update is_username_available function to check globally
CREATE OR REPLACE FUNCTION is_username_available(
  p_username TEXT,
  p_exclude_user_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  -- Check if username exists anywhere in the system (global check)
  RETURN NOT EXISTS (
    SELECT 1 FROM room_players
    WHERE LOWER(username) = LOWER(p_username)
      AND (p_exclude_user_id IS NULL OR user_id != p_exclude_user_id)
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION is_username_available IS
  'Check if username is available globally across entire app (not room-specific). Usage: SELECT is_username_available(''desired_username'', NULL);';

-- Create GLOBAL unique index on username
CREATE UNIQUE INDEX idx_room_players_username_global_unique
ON room_players(LOWER(username));

COMMENT ON INDEX idx_room_players_username_global_unique IS
  'Enforces GLOBAL username uniqueness - one username per user across entire app';

-- Update join_room_atomic to check global uniqueness
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
  v_existing_username TEXT;
BEGIN
  -- Step 1: Check if user already has a username in the system
  SELECT username INTO v_existing_username
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;
  
  -- If user has an existing username, enforce it
  IF v_existing_username IS NOT NULL AND LOWER(v_existing_username) != LOWER(p_username) THEN
    RAISE EXCEPTION 'You already have username "%". You cannot change your username.', v_existing_username;
  END IF;
  
  -- Step 2: Check if username is taken by another user (GLOBAL CHECK)
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE LOWER(username) = LOWER(p_username)
      AND user_id != p_user_id
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken by another user', p_username;
  END IF;
  
  -- Step 3: Lock and fetch room
  SELECT id, status, host_id INTO v_room_id, v_room_status, v_host_id
  FROM rooms
  WHERE code = UPPER(p_room_code)
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found: %', p_room_code;
  END IF;
  
  -- Step 4: Check room status
  IF v_room_status NOT IN ('waiting', 'playing') THEN
    RAISE EXCEPTION 'Room is not accepting players (status: %)', v_room_status;
  END IF;
  
  -- Step 5: Count current players in THIS room
  SELECT COUNT(*) INTO v_player_count
  FROM room_players
  WHERE room_id = v_room_id;
  
  -- Step 6: Check capacity
  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;
  
  -- Step 7: Check if user already in this room
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id
  ) THEN
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
  
  -- Step 8: Check if user is in a DIFFERENT room
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE user_id = p_user_id AND room_id != v_room_id
  ) THEN
    RAISE EXCEPTION 'User is already in another room';
  END IF;
  
  -- Step 9: Determine player_index and host status
  v_player_index := v_player_count;
  v_is_host := (v_host_id IS NULL OR v_player_count = 0);
  
  -- Step 10: Insert player
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
  
  -- Step 11: Update room host if needed
  IF v_is_host THEN
    UPDATE rooms
    SET host_id = p_user_id
    WHERE id = v_room_id;
  END IF;
  
  -- Step 12: Build success response
  v_result := jsonb_build_object(
    'room_id', v_room_id,
    'room_code', p_room_code,
    'player_index', v_player_index,
    'is_host', v_is_host,
    'already_joined', false,
    'player_count', v_player_count + 1
  );
  
  -- Step 13: Log successful join
  PERFORM log_room_event(
    v_room_id,
    'player_joined',
    NULL,
    jsonb_build_object(
      'username', p_username,
      'is_host', v_is_host
    )
  );
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
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
    
    RAISE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION join_room_atomic IS
  'Thread-safe room join with GLOBAL username uniqueness enforcement';
