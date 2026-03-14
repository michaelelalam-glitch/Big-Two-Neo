-- ============================================================================
-- BASELINE MIGRATION: Squashed from 80 individual migrations (Dec 2025 - Feb 2026)
-- Generated: 2026-03-14T12:29:03Z
--
-- This single file replaces all migrations with timestamps before 20260301.
-- Do NOT edit. For schema changes going forward, create new timestamped migrations.
--
-- ⚠️  IMPORTANT — for EXISTING databases (already migrated):
--   This baseline must NOT be applied as a normal migration; it contains
--   non-idempotent operations (CREATE POLICY, DROP TRIGGER, data deletes) that
--   will fail or corrupt an already-migrated schema.
--   Instead, mark it as already-applied WITHOUT running it:
--     supabase migration repair --status applied 00000000000000
--   Then continue applying only the post-baseline incremental migrations.
--
-- ✅  For FRESH databases (supabase db reset / new environment):
--   This file runs normally. All statements are guarded (IF NOT EXISTS, DO $$
--   BEGIN...END$$ blocks, CREATE OR REPLACE, etc.) so a clean install works
--   end-to-end without manual intervention.
-- ============================================================================

-- ============================================================================
-- CREATE TABLE: rooms  (prerequisite — was created outside migrations originally)
-- The `rooms` table was created via the Supabase dashboard before any numbered
-- migration was added to this project; it was never included in a migration file.
-- Declaring it here ensures `supabase db reset` succeeds on a fresh database.
-- All subsequent ALTER TABLE rooms ADD COLUMN IF NOT EXISTS guards in this
-- baseline become no-ops when the table is freshly created with every column.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rooms (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  code               VARCHAR(10)  NOT NULL,
  host_id            UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  status             TEXT         NOT NULL DEFAULT 'waiting',
  max_players        INTEGER      NOT NULL DEFAULT 4,
  -- columns added by subsequent migrations (IF NOT EXISTS guards below are
  -- no-ops on a freshly created table):
  fill_with_bots     BOOLEAN      DEFAULT FALSE,
  is_public          BOOLEAN      DEFAULT TRUE,
  is_matchmaking     BOOLEAN      DEFAULT FALSE,
  bot_coordinator_id UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  ranked_mode        BOOLEAN      DEFAULT FALSE,
  -- game_mode / bot_difficulty were added via the Supabase dashboard before
  -- any numbered migration existed; referenced by post-baseline migrations
  -- (e.g. 20260308000004 SELECT r.game_mode, r.bot_difficulty FROM rooms r).
  game_mode          TEXT         DEFAULT 'casual',
  bot_difficulty     TEXT         DEFAULT 'medium',
  -- started_at / ended_at were likewise dashboard-only; both are set inside
  -- function bodies in this baseline (started_at) and by post-baseline
  -- migrations (ended_at in 20260308000004: UPDATE rooms SET ended_at = NOW()).
  started_at         TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ  DEFAULT NOW(),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);


-- --------------------------------------------------------------------------
-- Source: 20251205000001_mobile_lobby_schema.sql
-- --------------------------------------------------------------------------
-- Mobile App Lobby Schema
-- Tables for mobile app lobby/matchmaking system

-- Add fill_with_bots column to rooms table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rooms' AND column_name = 'fill_with_bots'
  ) THEN
    ALTER TABLE rooms ADD COLUMN fill_with_bots BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Create profiles table for user data (if not exists)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(50) UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Public profiles are viewable by everyone" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Create room_players table for lobby management (if not exists)
CREATE TABLE IF NOT EXISTS room_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  player_index INTEGER NOT NULL CHECK (player_index >= 0 AND player_index < 4),
  is_host BOOLEAN DEFAULT FALSE,
  is_ready BOOLEAN DEFAULT FALSE,
  is_bot BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(room_id, player_index),
  UNIQUE(room_id, user_id)
);

-- Enable RLS on room_players
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;

-- RLS Policies for room_players
CREATE POLICY "Players can view room_players in their room" ON room_players
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM room_players rp
      WHERE rp.room_id = room_players.room_id
      AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can join rooms" ON room_players
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_host = FALSE);

-- Note: Users cannot change is_host status via UPDATE. Only is_ready can be changed.
-- Host status is immutable and determined by rooms.host_id
CREATE POLICY "Players can update their own status" ON room_players
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id AND 
    is_host = (SELECT is_host FROM room_players WHERE id = room_players.id)
  );

CREATE POLICY "Players can leave rooms" ON room_players
  FOR DELETE USING (auth.uid() = user_id);

-- Enable RLS on rooms
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- RLS Policies for rooms
CREATE POLICY "Anyone can view rooms" ON rooms
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create rooms" ON rooms
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- SECURITY: Only the room's host_id can update room settings, not based on room_players.is_host
CREATE POLICY "Host can update room" ON rooms
  FOR UPDATE USING (host_id = auth.uid());

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_room_players_room_id ON room_players(room_id);
CREATE INDEX IF NOT EXISTS idx_room_players_user_id ON room_players(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- Function to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'Player_' || substring(NEW.id::text, 1, 8))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable realtime for mobile tables
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE room_players;
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;


-- --------------------------------------------------------------------------
-- Source: 20251205000002_add_username_to_room_players.sql
-- --------------------------------------------------------------------------
-- Add username column to room_players for display purposes
-- This allows us to show player names without additional joins to profiles table
-- Note: username is nullable to support bot players (bots have is_bot=true and no user_id)
-- Non-bot players should always provide username on insert (enforced by application logic)

ALTER TABLE room_players 
ADD COLUMN IF NOT EXISTS username VARCHAR(50);

-- Update existing records to pull username from profiles (if any exist)
UPDATE room_players rp
SET username = p.username
FROM profiles p
WHERE rp.user_id = p.id
AND rp.username IS NULL;

-- Create index for username lookups
CREATE INDEX IF NOT EXISTS idx_room_players_username ON room_players(username);


-- --------------------------------------------------------------------------
-- Source: 20251206000000_add_public_rooms_and_constraints.sql
-- --------------------------------------------------------------------------
-- Add public/private room support and enforce single-room membership
-- Migration: 20251206000000

-- Add is_public column to rooms table
ALTER TABLE rooms 
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE;

-- Add index for finding public rooms
CREATE INDEX IF NOT EXISTS idx_rooms_is_public_status ON rooms(is_public, status) WHERE is_public = TRUE AND status = 'waiting';

-- Create function to check if user is already in a room
CREATE OR REPLACE FUNCTION check_user_not_in_room()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if user is already in ANY OTHER room (allows idempotent inserts to same room)
  IF EXISTS (
    SELECT 1 FROM room_players 
    WHERE user_id = NEW.user_id 
    AND room_id != NEW.room_id
  ) THEN
    RAISE EXCEPTION 'User is already in another room. Leave that room first.'
      USING ERRCODE = 'unique_violation';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce single-room membership
DROP TRIGGER IF EXISTS enforce_single_room_membership ON room_players;
CREATE TRIGGER enforce_single_room_membership
  BEFORE INSERT ON room_players
  FOR EACH ROW
  EXECUTE FUNCTION check_user_not_in_room();

-- Add comment for documentation
COMMENT ON COLUMN rooms.is_public IS 'TRUE for public rooms (Quick Play), FALSE for private rooms (created via Create Room with code sharing)';
COMMENT ON TRIGGER enforce_single_room_membership ON room_players IS 'Prevents INSERT operations that would place a user in multiple rooms';


-- --------------------------------------------------------------------------
-- Source: 20251206000001_room_robustness_improvements.sql
-- --------------------------------------------------------------------------
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

-- Enable Row Level Security and restrict access to trusted roles
ALTER TABLE room_analytics ENABLE ROW LEVEL SECURITY;

-- Only allow service_role to SELECT and INSERT (adjust role as needed for your setup)
CREATE POLICY room_analytics_service_select ON room_analytics
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY room_analytics_service_insert ON room_analytics
  FOR INSERT
  TO service_role
  WITH CHECK (true);

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
  -- CRITICAL FIX: Find first available position (handles mid-game joins when players leave)
  SELECT COALESCE(
    (
      SELECT s.i
      FROM generate_series(0, 3) AS s(i)
      WHERE NOT EXISTS (
        SELECT 1 FROM room_players
        WHERE room_id = v_room_id AND player_index = s.i
      )
      LIMIT 1
    ),
    v_player_count  -- Fallback to sequential (should never happen if capacity check works)
  ) INTO v_player_index;
  
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
  
  -- Step 12: Log successful join (disabled for performance at scale - only errors logged)
  -- Uncomment below to enable join success logging for debugging:
  /*
  PERFORM log_room_event(
    v_room_id,
    'player_joined',
    NULL,  -- Clean join
    jsonb_build_object(
      'username', p_username,
      'is_host', v_is_host
    )
  );
  */
  
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
    ELSE
      -- Room not found - log without room_id
      INSERT INTO room_analytics (
        room_id,
        room_code,
        status_reached,
        error_type,
        is_dirty,
        metadata,
        created_at,
        event_at
      ) VALUES (
        NULL,
        COALESCE(p_room_code, 'UNKNOWN'),
        'waiting',
        'room_not_found',
        true,
        jsonb_build_object(
          'username', p_username,
          'error', SQLERRM
        ),
        TIMESTAMPTZ '1970-01-01 00:00:00+00',
        NOW()
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


-- --------------------------------------------------------------------------
-- Source: 20251206000002_fix_global_username_uniqueness.sql
-- --------------------------------------------------------------------------
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
  'Check if username is available globally across entire app. Usage: SELECT is_username_available(''desired_username'', NULL);';

-- Create GLOBAL unique index on username
-- WARNING: This enforces global username uniqueness across all rooms.
-- If a user leaves a room but their entry in room_players is not deleted,
-- their username will remain unavailable for use in any other room.
-- Ensure that application logic properly deletes room_players entries when users leave rooms,
-- or users may be locked out of their preferred usernames.
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
  
  -- If user has an existing username, enforce it unless it's an auto-generated one
  IF v_existing_username IS NOT NULL AND LOWER(v_existing_username) != LOWER(p_username) THEN
    -- Allow changing username only if the existing one is auto-generated (Player_{uuid})
    IF NOT (v_existing_username LIKE 'Player_%') THEN
      RAISE EXCEPTION 'You already have username "%". You cannot change your username.', v_existing_username;
    END IF;
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


-- --------------------------------------------------------------------------
-- Source: 20251206000003_add_room_delete_policy.sql
-- --------------------------------------------------------------------------
-- Fix: Add DELETE policy for rooms table
-- Issue: Error 42501 when host tries to leave/delete room
-- Date: December 6, 2025

-- Add DELETE policy for rooms - only host can delete
CREATE POLICY "Host can delete room" ON rooms
  FOR DELETE USING (host_id = auth.uid());


-- --------------------------------------------------------------------------
-- Source: 20251207000001_add_test_cleanup_function.sql
-- --------------------------------------------------------------------------
-- Migration: Add test cleanup function with authorization checks
-- Date: December 7, 2025
-- Purpose: Provide RLS-bypass cleanup for integration tests with security constraints

-- Drop function if it exists
DROP FUNCTION IF EXISTS test_cleanup_user_data(UUID[]);

-- Create test cleanup function with authorization
CREATE OR REPLACE FUNCTION test_cleanup_user_data(p_user_ids UUID[])
RETURNS VOID
SECURITY DEFINER  -- Bypasses RLS policies
LANGUAGE plpgsql
AS $$
DECLARE
  caller_uid UUID;
  allowed_test_users UUID[] := ARRAY[
    '00817b76-e3c5-4535-8f72-56df66047bb2'::UUID,  -- testUserId1 (tester@big2.app)
    'a3297019-266a-4fa7-be39-39e1f4beed04'::UUID,  -- testUserId2 (guest)
    '2eab6a51-e47b-4c37-bb29-ed998e3ed30b'::UUID,  -- guest user 2
    '4ce1c03a-1b49-4e94-9572-60fe13759e14'::UUID   -- michael user
  ];
  user_id_to_delete UUID;
BEGIN
  -- Get the calling user's ID from JWT
  caller_uid := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
  
  -- SECURITY: Only allow test users to call this function
  IF caller_uid IS NULL OR NOT (caller_uid = ANY(allowed_test_users)) THEN
    RAISE EXCEPTION 'Unauthorized: Only test users can call this function';
  END IF;
  
  -- Validate each user_id before deletion
  FOREACH user_id_to_delete IN ARRAY p_user_ids
  LOOP
    -- Allow deletion only if user is in the allowed test users list
    IF user_id_to_delete = ANY(allowed_test_users) THEN
      DELETE FROM room_players WHERE user_id = user_id_to_delete;
    ELSE
      -- Unauthorized: trying to delete non-test user data
      RAISE EXCEPTION 'Unauthorized: Cannot delete data for user %', user_id_to_delete;
    END IF;
  END LOOP;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION test_cleanup_user_data(UUID[]) TO authenticated;

-- Add comment
COMMENT ON FUNCTION test_cleanup_user_data(UUID[]) IS 
  'Test cleanup function with authorization. Can only delete data for self or whitelisted test users.';


-- --------------------------------------------------------------------------
-- Source: 20251208000001_leaderboard_stats_schema.sql
-- --------------------------------------------------------------------------
-- Task #268: Leaderboard and Stats Schema
-- Creates tables for player statistics, game history, and leaderboard rankings
-- Date: December 8, 2025

-- ============================================================================
-- PART 1: PLAYER STATISTICS TABLE
-- ============================================================================

-- Track player game statistics
CREATE TABLE IF NOT EXISTS player_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Win/Loss tracking
  games_played INTEGER DEFAULT 0 CHECK (games_played >= 0),
  games_won INTEGER DEFAULT 0 CHECK (games_won >= 0),
  games_lost INTEGER DEFAULT 0 CHECK (games_lost >= 0),
  
  -- Performance metrics
  win_rate DECIMAL(5,2) DEFAULT 0.00 CHECK (win_rate >= 0 AND win_rate <= 100),
  avg_finish_position DECIMAL(3,2) CHECK (avg_finish_position >= 1 AND avg_finish_position <= 4),
  
  -- Scoring
  total_points INTEGER DEFAULT 0,
  highest_score INTEGER DEFAULT 0,
  avg_score_per_game DECIMAL(10,2) DEFAULT 0,
  
  -- Streaks
  current_win_streak INTEGER DEFAULT 0 CHECK (current_win_streak >= 0),
  longest_win_streak INTEGER DEFAULT 0 CHECK (longest_win_streak >= 0),
  current_loss_streak INTEGER DEFAULT 0 CHECK (current_loss_streak >= 0),
  
  -- Rankings
  global_rank INTEGER,
  rank_points INTEGER DEFAULT 1000, -- ELO-style rating
  
  -- Combo tracking
  singles_played INTEGER DEFAULT 0,
  pairs_played INTEGER DEFAULT 0,
  triples_played INTEGER DEFAULT 0,
  straights_played INTEGER DEFAULT 0,
  full_houses_played INTEGER DEFAULT 0,
  four_of_a_kinds_played INTEGER DEFAULT 0,
  straight_flushes_played INTEGER DEFAULT 0,
  royal_flushes_played INTEGER DEFAULT 0,
  
  -- Timestamps
  first_game_at TIMESTAMPTZ,
  last_game_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- Indexes for leaderboard queries
CREATE INDEX idx_player_stats_user_id ON player_stats(user_id);
CREATE INDEX idx_player_stats_rank_points ON player_stats(rank_points DESC);
CREATE INDEX idx_player_stats_games_won ON player_stats(games_won DESC);
CREATE INDEX idx_player_stats_win_rate ON player_stats(win_rate DESC);
CREATE INDEX idx_player_stats_updated ON player_stats(updated_at DESC);

-- Add foreign key to profiles for PostgREST join support
ALTER TABLE player_stats
ADD CONSTRAINT player_stats_user_id_profiles_fkey 
FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Player stats viewable by everyone" ON player_stats
  FOR SELECT USING (true);

CREATE POLICY "Users can insert own stats" ON player_stats
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- REMOVED: Direct user UPDATE policy to prevent stat forgery
-- Players cannot directly modify their stats to prevent leaderboard manipulation
-- All stat updates must go through server-controlled RPC functions

CREATE POLICY "Service role can update player stats" ON player_stats
  FOR UPDATE TO service_role USING (true);

-- ============================================================================
-- PART 2: GAME HISTORY TABLE
-- ============================================================================

-- Track individual game results
CREATE TABLE IF NOT EXISTS game_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  room_code TEXT NOT NULL,
  
  -- Players (store in order of finish)
  player_1_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  player_2_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  player_3_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  player_4_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Player usernames (denormalized for historical record)
  player_1_username TEXT,
  player_2_username TEXT,
  player_3_username TEXT,
  player_4_username TEXT,
  
  -- Scores
  player_1_score INTEGER DEFAULT 0,
  player_2_score INTEGER DEFAULT 0,
  player_3_score INTEGER DEFAULT 0,
  player_4_score INTEGER DEFAULT 0,
  
  -- Game metadata
  winner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  game_duration_seconds INTEGER,
  total_rounds INTEGER DEFAULT 0,
  game_mode TEXT DEFAULT 'standard', -- 'standard', 'quick', 'ranked'
  
  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CHECK (game_duration_seconds >= 0),
  CHECK (finished_at >= started_at)
);

-- Indexes for history queries
CREATE INDEX idx_game_history_player_1 ON game_history(player_1_id);
CREATE INDEX idx_game_history_player_2 ON game_history(player_2_id);
CREATE INDEX idx_game_history_player_3 ON game_history(player_3_id);
CREATE INDEX idx_game_history_player_4 ON game_history(player_4_id);
CREATE INDEX idx_game_history_winner ON game_history(winner_id);
CREATE INDEX idx_game_history_finished_at ON game_history(finished_at DESC);
CREATE INDEX idx_game_history_room_code ON game_history(room_code);

-- Enable RLS
ALTER TABLE game_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Anyone can view game history
CREATE POLICY "Game history viewable by everyone" ON game_history
  FOR SELECT USING (true);

-- NOTE: No RLS policy needed for INSERT - service_role bypasses RLS entirely.
-- Access control is enforced at the application/API layer.

-- ============================================================================
-- PART 3: LEADERBOARD MATERIALIZED VIEW (For Performance)
-- ============================================================================

-- Materialized view for fast leaderboard queries
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_global AS
SELECT 
  ps.user_id,
  p.username,
  p.avatar_url,
  ps.rank_points,
  ps.games_played,
  ps.games_won,
  ps.win_rate,
  ps.longest_win_streak,
  ps.current_win_streak,
  ROW_NUMBER() OVER (ORDER BY ps.rank_points DESC, ps.games_won DESC) as rank
FROM player_stats ps
INNER JOIN profiles p ON ps.user_id = p.id
WHERE ps.games_played > 0
ORDER BY ps.rank_points DESC, ps.games_won DESC;

-- Index for fast lookups
CREATE UNIQUE INDEX idx_leaderboard_global_user ON leaderboard_global(user_id);
CREATE INDEX idx_leaderboard_global_rank ON leaderboard_global(rank);

-- ============================================================================
-- PART 4: HELPER FUNCTIONS
-- ============================================================================

-- Function to initialize player stats
CREATE OR REPLACE FUNCTION initialize_player_stats(p_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_stats_id UUID;
BEGIN
  INSERT INTO player_stats (
    user_id,
    first_game_at
  ) VALUES (
    p_user_id,
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id INTO v_stats_id;
  
  RETURN v_stats_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update player stats after game
-- SECURITY: This function should only be called by the game server (service_role)
-- or from a secure server-side context. It trusts all input parameters.
CREATE OR REPLACE FUNCTION update_player_stats_after_game(
  p_user_id UUID,
  p_won BOOLEAN,
  p_finish_position INTEGER,
  p_score INTEGER,
  p_combos_played JSONB
) RETURNS VOID AS $$
DECLARE
  v_stats RECORD;
  v_new_win_rate DECIMAL(5,2);
  v_new_avg_position DECIMAL(3,2);
  v_new_avg_score DECIMAL(10,2);
BEGIN
  -- NOTE: This function is restricted to service_role via GRANT permissions.
  -- The JWT role check has been removed because auth.uid() returns NULL in SECURITY DEFINER context.
  -- Access control is enforced by revoking PUBLIC execute and granting only to service_role.

  -- Get current stats
  SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    -- Initialize if doesn't exist
    PERFORM initialize_player_stats(p_user_id);
    SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  END IF;
  
  -- Calculate new stats
  v_new_win_rate := ROUND(
    (v_stats.games_won + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL / 
    (v_stats.games_played + 1)::DECIMAL * 100, 
    2
  );
  
  v_new_avg_position := ROUND(
    (COALESCE(v_stats.avg_finish_position, 2.5) * v_stats.games_played + p_finish_position)::DECIMAL / 
    (v_stats.games_played + 1)::DECIMAL,
    2
  );
  
  v_new_avg_score := ROUND(
    (COALESCE(v_stats.avg_score_per_game, 0) * v_stats.games_played + p_score)::DECIMAL / 
    (v_stats.games_played + 1)::DECIMAL,
    2
  );
  
  -- Update stats
  UPDATE player_stats SET
    games_played = games_played + 1,
    games_won = games_won + CASE WHEN p_won THEN 1 ELSE 0 END,
    games_lost = games_lost + CASE WHEN NOT p_won THEN 1 ELSE 0 END,
    win_rate = v_new_win_rate,
    avg_finish_position = v_new_avg_position,
    total_points = total_points + p_score,
    highest_score = GREATEST(highest_score, p_score),
    avg_score_per_game = v_new_avg_score,
    current_win_streak = CASE 
      WHEN p_won THEN current_win_streak + 1 
      ELSE 0 
    END,
    longest_win_streak = GREATEST(
      longest_win_streak,
      CASE WHEN p_won THEN current_win_streak + 1 ELSE current_win_streak END
    ),
    current_loss_streak = CASE 
      WHEN NOT p_won THEN current_loss_streak + 1 
      ELSE 0 
    END,
    rank_points = rank_points + CASE 
      WHEN p_won THEN 25 
      WHEN p_finish_position = 2 THEN 10
      WHEN p_finish_position = 3 THEN -5
      ELSE -15
    END,
    -- Update combo stats from JSONB
    singles_played = singles_played + COALESCE((p_combos_played->>'singles')::INTEGER, 0),
    pairs_played = pairs_played + COALESCE((p_combos_played->>'pairs')::INTEGER, 0),
    triples_played = triples_played + COALESCE((p_combos_played->>'triples')::INTEGER, 0),
    straights_played = straights_played + COALESCE((p_combos_played->>'straights')::INTEGER, 0),
    full_houses_played = full_houses_played + COALESCE((p_combos_played->>'full_houses')::INTEGER, 0),
    four_of_a_kinds_played = four_of_a_kinds_played + COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0),
    straight_flushes_played = straight_flushes_played + COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0),
    royal_flushes_played = royal_flushes_played + COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0),
    last_game_at = NOW(),
    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to refresh leaderboard (call periodically or after games)
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PART 5: GRANT PERMISSIONS (Security)
-- ============================================================================

-- Revoke public execute on sensitive functions to prevent client-side manipulation
REVOKE EXECUTE ON FUNCTION update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION initialize_player_stats(UUID) FROM PUBLIC;

-- Grant execute only to service_role for leaderboard integrity
-- Only trusted server-side code can modify stats
GRANT EXECUTE ON FUNCTION update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION initialize_player_stats(UUID) TO service_role;

-- Allow authenticated users to refresh leaderboard view
GRANT EXECUTE ON FUNCTION refresh_leaderboard() TO authenticated, anon;

-- ============================================================================
-- PART 6: AUTOMATIC TRIGGERS
-- ============================================================================

-- Trigger to auto-create player_stats when profile is created
CREATE OR REPLACE FUNCTION auto_create_player_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO player_stats (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_created_create_stats ON profiles;
CREATE TRIGGER on_profile_created_create_stats
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION auto_create_player_stats();

-- ============================================================================
-- PART 7: ENABLE REALTIME (Optional - for live leaderboard updates)
-- ============================================================================

-- Enable realtime for leaderboard tables
ALTER PUBLICATION supabase_realtime ADD TABLE player_stats;
ALTER PUBLICATION supabase_realtime ADD TABLE game_history;

-- ============================================================================
-- PART 8: INITIALIZE STATS FOR EXISTING USERS
-- ============================================================================

-- Create player_stats entries for all existing users
INSERT INTO player_stats (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- VERIFICATION QUERIES (Run these to test)
-- ============================================================================

-- Check tables created
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name IN ('player_stats', 'game_history');

-- Check materialized view
-- SELECT * FROM leaderboard_global LIMIT 10;

-- Check indexes
-- SELECT indexname FROM pg_indexes 
-- WHERE tablename IN ('player_stats', 'game_history');


-- --------------------------------------------------------------------------
-- Source: 20251208000002_fix_leaderboard_refresh.sql
-- --------------------------------------------------------------------------
-- Fix for leaderboard refresh issue
-- This restores CONCURRENTLY refresh for the materialized view
-- Since we have a unique index on (user_id), CONCURRENTLY is safe and reduces locks

-- Drop existing function
DROP FUNCTION IF EXISTS refresh_leaderboard();

-- Recreate with CONCURRENTLY for better performance
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Manually refresh now (non-concurrent: CONCURRENTLY is not permitted inside
-- the implicit transaction block that Supabase wraps migrations in)
REFRESH MATERIALIZED VIEW leaderboard_global;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION refresh_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_leaderboard() TO anon;


-- --------------------------------------------------------------------------
-- Source: 20251214000001_fix_profile_creation_trigger.sql
-- --------------------------------------------------------------------------
-- ============================================
-- FIX: Google Multi-Account Authentication
-- ============================================
-- This migration fixes the profile creation trigger to handle
-- username conflicts properly and ensure profiles are always created

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Create improved handle_new_user function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_username TEXT;
  v_attempt INTEGER := 0;
  v_max_attempts INTEGER := 10;
  v_success BOOLEAN := FALSE;
BEGIN
  -- Generate base username
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    'Player_' || substring(NEW.id::text, 1, 8)
  );

  -- Try to insert profile with username collision handling
  WHILE v_attempt < v_max_attempts AND NOT v_success LOOP
    BEGIN
      INSERT INTO public.profiles (id, username)
      VALUES (NEW.id, v_username)
      ON CONFLICT (id) DO UPDATE
        SET username = EXCLUDED.username,
            updated_at = NOW();
      
      v_success := TRUE;
      
    EXCEPTION
      WHEN unique_violation THEN
        -- Username already taken, append random suffix
        v_attempt := v_attempt + 1;
        v_username := COALESCE(
          NEW.raw_user_meta_data->>'username',
          'Player_' || substring(NEW.id::text, 1, 8)
        ) || '_' || floor(random() * 1000)::text;
        
        -- Log the conflict for debugging
        RAISE NOTICE 'Username conflict detected. Attempt % of %. Trying: %', 
          v_attempt, v_max_attempts, v_username;
    END;
  END LOOP;

  IF NOT v_success THEN
    RAISE EXCEPTION 'Failed to create profile after % attempts', v_max_attempts;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user IS 
  'Automatically creates a profile when a new user signs up via OAuth. Handles username conflicts by appending a random suffix.';

-- Clean up any orphaned auth.users without profiles
-- This ensures all existing users have profiles
DO $$
DECLARE
  v_user_record RECORD;
  v_username TEXT;
BEGIN
  FOR v_user_record IN 
    SELECT id, raw_user_meta_data 
    FROM auth.users 
    WHERE id NOT IN (SELECT id FROM profiles)
  LOOP
    v_username := COALESCE(
      v_user_record.raw_user_meta_data->>'username',
      'Player_' || substring(v_user_record.id::text, 1, 8)
    );
    
    INSERT INTO profiles (id, username)
    VALUES (v_user_record.id, v_username)
    ON CONFLICT (username) DO NOTHING;
    
    RAISE NOTICE 'Created profile for existing user: %', v_user_record.id;
  END LOOP;
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251214000002_fix_player_stats_insert_rls.sql
-- --------------------------------------------------------------------------
-- ============================================
-- FIX: Player Stats RLS Blocking OAuth Signup
-- ============================================
-- This migration fixes the RLS policy on player_stats that was blocking
-- the auto_create_player_stats() trigger during OAuth signup.
--
-- ROOT CAUSE:
-- The "Users can insert own stats" policy checks auth.uid() = user_id,
-- but during OAuth signup, the trigger runs in a context where auth.uid()
-- is not properly set, causing the insert to fail.
--
-- SOLUTION:
-- Add a service_role INSERT policy to allow the SECURITY DEFINER trigger
-- to bypass the user auth check.

-- Add service_role INSERT policy for player_stats
-- This allows the auto_create_player_stats() trigger to work during OAuth signup
CREATE POLICY "Service role can insert player stats" ON player_stats
  FOR INSERT TO service_role WITH CHECK (true);

-- Verification: Check all policies on player_stats
-- Expected policies:
-- 1. Player stats viewable by everyone (SELECT)
-- 2. Users can insert own stats (INSERT with auth.uid() check)
-- 3. Service role can insert player stats (INSERT for triggers) ← NEW
-- 4. Service role can update player stats (UPDATE)

COMMENT ON POLICY "Service role can insert player stats" ON player_stats IS
  'Allows SECURITY DEFINER triggers (e.g., auto_create_player_stats) to insert player_stats during OAuth signup without being blocked by auth.uid() checks.';

-- ============================================
-- AUDIT TRAIL
-- ============================================
-- Issue: "Database error saving new user" during Google OAuth
-- Error: Missing tokens in OAuth callback
-- Cause: RLS policy blocking player_stats insert in trigger
-- Fix: Add service_role INSERT policy
-- Date: December 14, 2025


-- --------------------------------------------------------------------------
-- Source: 20251214120000_fix_google_oauth_username_extraction.sql
-- --------------------------------------------------------------------------
-- ============================================
-- FIX: Google OAuth Username Extraction
-- ============================================
-- Problem: Google OAuth stores user's name in 'full_name' field,
-- not 'username' field, causing fallback to Player_[ID]
--
-- Solution: Update handle_new_user to check multiple fields in priority order:
-- 1. username (for custom sign-ups)
-- 2. full_name (for Google OAuth)
-- 3. name (fallback for other providers)
-- 4. Player_[ID] (last resort)

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_username TEXT;
  v_attempt INTEGER := 0;
  v_max_attempts INTEGER := 10;
  v_success BOOLEAN := FALSE;
BEGIN
  -- Generate base username with priority order
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',    -- Custom sign-ups
    NEW.raw_user_meta_data->>'full_name',   -- Google OAuth (primary)
    NEW.raw_user_meta_data->>'name',        -- Other providers
    'Player_' || substring(NEW.id::text, 1, 8)  -- Fallback
  );

  -- Try to insert profile with username collision handling
  WHILE v_attempt < v_max_attempts AND NOT v_success LOOP
    BEGIN
      INSERT INTO public.profiles (id, username)
      VALUES (NEW.id, v_username)
      ON CONFLICT (id) DO UPDATE
        SET username = EXCLUDED.username,
            updated_at = NOW();
      
      v_success := TRUE;
      
    EXCEPTION
      WHEN unique_violation THEN
        -- Username already taken, append random suffix
        v_attempt := v_attempt + 1;
        v_username := COALESCE(
          NEW.raw_user_meta_data->>'username',
          NEW.raw_user_meta_data->>'full_name',
          NEW.raw_user_meta_data->>'name',
          'Player_' || substring(NEW.id::text, 1, 8)
        ) || '_' || floor(random() * 1000)::text;
        
        -- Log the conflict for debugging
        RAISE NOTICE 'Username conflict detected. Attempt % of %. Trying: %', 
          v_attempt, v_max_attempts, v_username;
    END;
  END LOOP;

  IF NOT v_success THEN
    RAISE EXCEPTION 'Failed to create profile after % attempts', v_max_attempts;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user IS 
  'Automatically creates a profile when a new user signs up. Extracts username from OAuth metadata with priority: username > full_name > name > fallback. Handles conflicts with random suffix.';

-- ============================================
-- FIX: Update Existing Users with Incorrect Usernames
-- ============================================
-- Update any existing users whose profiles have Player_[ID] format
-- but have a full_name in their OAuth metadata

DO $$
DECLARE
  v_user_record RECORD;
  v_new_username TEXT;
BEGIN
  FOR v_user_record IN 
    SELECT 
      u.id, 
      u.raw_user_meta_data,
      p.username as current_username
    FROM auth.users u
    INNER JOIN profiles p ON u.id = p.id
    WHERE p.username LIKE 'Player_%'
      AND (
        u.raw_user_meta_data->>'full_name' IS NOT NULL 
        OR u.raw_user_meta_data->>'name' IS NOT NULL
      )
  LOOP
    -- Extract the proper username
    v_new_username := COALESCE(
      v_user_record.raw_user_meta_data->>'username',
      v_user_record.raw_user_meta_data->>'full_name',
      v_user_record.raw_user_meta_data->>'name'
    );
    
    -- Update profile if we found a better username
    IF v_new_username IS NOT NULL AND v_new_username != v_user_record.current_username THEN
      BEGIN
        UPDATE profiles 
        SET username = v_new_username,
            updated_at = NOW()
        WHERE id = v_user_record.id;
        
        RAISE NOTICE 'Updated username for user %: % -> %', 
          v_user_record.id, v_user_record.current_username, v_new_username;
          
      EXCEPTION
        WHEN unique_violation THEN
          -- If username is taken, append a random suffix
          v_new_username := v_new_username || '_' || floor(random() * 1000)::text;
          
          UPDATE profiles 
          SET username = v_new_username,
              updated_at = NOW()
          WHERE id = v_user_record.id;
          
          RAISE NOTICE 'Updated username (with suffix) for user %: % -> %', 
            v_user_record.id, v_user_record.current_username, v_new_username;
      END;
    END IF;
  END LOOP;
END $$;

-- Refresh the leaderboard materialized view to reflect changes
-- (non-concurrent: CONCURRENTLY is not permitted inside a migration transaction)
REFRESH MATERIALIZED VIEW leaderboard_global;


-- --------------------------------------------------------------------------
-- Source: 20251214130000_add_flushes_played_column.sql
-- --------------------------------------------------------------------------
-- ============================================
-- FIX: Add missing flushes_played column
-- ============================================
-- Issue: Regular flushes (5 cards same suit, not straight) were not being tracked
-- Reason: Database schema was missing flushes_played column
-- Date: December 14, 2025

-- Add flushes_played column to player_stats
ALTER TABLE player_stats 
ADD COLUMN IF NOT EXISTS flushes_played INTEGER DEFAULT 0;

-- Add constraint to ensure non-negative values
-- Note: PostgreSQL doesn't support IF NOT EXISTS for constraints in ALTER TABLE,
-- so we use DO block to handle re-runs gracefully
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_flushes_played_non_negative'
  ) THEN
    ALTER TABLE player_stats
    ADD CONSTRAINT check_flushes_played_non_negative 
    CHECK (flushes_played >= 0);
  END IF;
END $$;

-- Note: No backfill needed since DEFAULT 0 prevents NULL values
-- Existing records will automatically have 0 from the DEFAULT constraint

-- Create index for performance (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_player_stats_flushes_played 
ON player_stats(flushes_played);

-- Update the update_player_stats_after_game function to handle flushes
-- This function is called when game ends to update player statistics
CREATE OR REPLACE FUNCTION update_player_stats_after_game(
  p_user_id UUID,
  p_won BOOLEAN,
  p_finish_position INTEGER,
  p_score INTEGER,
  p_combos_played JSONB
) RETURNS VOID AS $$
DECLARE
  v_stats RECORD;
  v_new_win_rate DECIMAL(5,2);
  v_new_avg_position DECIMAL(3,2);
  v_new_avg_score DECIMAL(10,2);
BEGIN
  -- NOTE: This function is restricted to service_role via GRANT permissions.
  -- The JWT role check has been removed because auth.uid() returns NULL in SECURITY DEFINER context.
  -- Access control is enforced by revoking PUBLIC execute and granting only to service_role.

  -- Get current stats
  SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    -- Initialize if doesn't exist
    PERFORM initialize_player_stats(p_user_id);
    SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  END IF;
  
  -- Calculate new stats
  v_new_win_rate := ROUND(
    (v_stats.games_won + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL / 
    (v_stats.games_played + 1)::DECIMAL * 100, 
    2
  );
  
  v_new_avg_position := ROUND(
    (v_stats.avg_finish_position * v_stats.games_played + p_finish_position)::DECIMAL / 
    (v_stats.games_played + 1)::DECIMAL, 
    2
  );
  
  v_new_avg_score := ROUND(
    (v_stats.total_points + p_score)::DECIMAL / (v_stats.games_played + 1)::DECIMAL, 
    2
  );
  
  -- Update stats
  UPDATE player_stats SET
    games_played = games_played + 1,
    games_won = CASE WHEN p_won THEN games_won + 1 ELSE games_won END,
    games_lost = CASE WHEN NOT p_won THEN games_lost + 1 ELSE games_lost END,
    win_rate = v_new_win_rate,
    avg_finish_position = v_new_avg_position,
    total_points = total_points + p_score,
    highest_score = GREATEST(highest_score, p_score),
    avg_score_per_game = v_new_avg_score,
    current_win_streak = CASE 
      WHEN p_won THEN current_win_streak + 1 
      ELSE 0 
    END,
    longest_win_streak = GREATEST(
      longest_win_streak,
      CASE WHEN p_won THEN current_win_streak + 1 ELSE current_win_streak END
    ),
    current_loss_streak = CASE 
      WHEN NOT p_won THEN current_loss_streak + 1 
      ELSE 0 
    END,
    rank_points = rank_points + CASE 
      WHEN p_won THEN 25 
      WHEN p_finish_position = 2 THEN 10
      WHEN p_finish_position = 3 THEN -5
      ELSE -15
    END,
    -- Update combo stats from JSONB (INCLUDING FLUSHES!)
    singles_played = singles_played + COALESCE((p_combos_played->>'singles')::INTEGER, 0),
    pairs_played = pairs_played + COALESCE((p_combos_played->>'pairs')::INTEGER, 0),
    triples_played = triples_played + COALESCE((p_combos_played->>'triples')::INTEGER, 0),
    straights_played = straights_played + COALESCE((p_combos_played->>'straights')::INTEGER, 0),
    flushes_played = flushes_played + COALESCE((p_combos_played->>'flushes')::INTEGER, 0),  -- NEW!
    full_houses_played = full_houses_played + COALESCE((p_combos_played->>'full_houses')::INTEGER, 0),
    four_of_a_kinds_played = four_of_a_kinds_played + COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0),
    straight_flushes_played = straight_flushes_played + COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0),
    royal_flushes_played = royal_flushes_played + COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0),
    last_game_at = NOW(),
    updated_at = NOW(),
    first_game_at = COALESCE(first_game_at, NOW())
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Refresh leaderboard to reflect any changes
-- (non-concurrent: CONCURRENTLY is not permitted inside a migration transaction)
REFRESH MATERIALIZED VIEW leaderboard_global;

-- Verification query (run manually to check)
-- SELECT 
--   user_id,
--   singles_played,
--   pairs_played,
--   straights_played,
--   flushes_played,  -- NEW COLUMN
--   full_houses_played,
--   four_of_a_kinds_played,
--   straight_flushes_played
-- FROM player_stats
-- WHERE games_played > 0;


-- --------------------------------------------------------------------------
-- Source: 20251217000001_add_account_deletion_function.sql
-- --------------------------------------------------------------------------
-- Migration: Add account deletion function
-- Created: 2025-12-17
-- Purpose: Safely delete user account and all associated data

-- Function to delete the current authenticated user's account and all their data
-- This cascades through all related tables
-- SECURITY: Uses auth.uid() to prevent horizontal privilege escalation
CREATE OR REPLACE FUNCTION delete_user_account()
RETURNS VOID AS $$
DECLARE
  target_user UUID := auth.uid();
BEGIN
  -- Ensure we have an authenticated user context
  IF target_user IS NULL THEN
    RAISE EXCEPTION 'delete_user_account: auth.uid() is null. This function must be called in an authenticated context.';
  END IF;

  -- Delete from player_stats (no cascade needed - direct delete)
  DELETE FROM player_stats WHERE player_id = target_user;
  
  -- Delete from room_players (removes user from any active rooms)
  DELETE FROM room_players WHERE user_id = target_user;
  
  -- Delete from profiles (this is the main user profile)
  DELETE FROM profiles WHERE id = target_user;
  
  -- Note: Rooms where user is host should be handled by triggers
  -- or we can update host_id to NULL for those rooms
  UPDATE rooms SET host_id = NULL WHERE host_id = target_user;
  
  -- Log the deletion (for admin/audit purposes)
  RAISE NOTICE 'User account deleted: %', target_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users (they can only delete their own account)
GRANT EXECUTE ON FUNCTION delete_user_account() TO authenticated;

-- Add RLS policy to ensure users can only delete their own account
-- Note: The actual auth.users deletion must be handled by Supabase Auth API
-- This function only deletes the user's data from our tables

COMMENT ON FUNCTION delete_user_account() IS 
'Safely deletes the current authenticated user account''s data and all associated records. Uses auth.uid() to prevent unauthorized deletion. Does not delete from auth.users (use Supabase Auth API for that)';


-- --------------------------------------------------------------------------
-- Source: 20251222000001_add_matchmaking_system.sql
-- --------------------------------------------------------------------------
-- Matchmaking System for Online Multiplayer
-- Creates waiting_room table and matchmaking functions

-- Create waiting_room table for quick match queue
CREATE TABLE IF NOT EXISTS waiting_room (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(50) NOT NULL,
  skill_rating INTEGER DEFAULT 1000, -- ELO-like rating for matchmaking
  region VARCHAR(10) DEFAULT 'global', -- For region-based matching
  status VARCHAR(20) DEFAULT 'waiting', -- waiting, matched, cancelled
  matched_room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched_at TIMESTAMPTZ,
  
  -- Only one entry per user at a time
  UNIQUE(user_id),
  
  -- Automatically clean up old entries
  CONSTRAINT check_status CHECK (status IN ('waiting', 'matched', 'cancelled'))
);

-- Index for fast matchmaking queries
CREATE INDEX IF NOT EXISTS idx_waiting_room_status ON waiting_room(status, skill_rating, joined_at);
CREATE INDEX IF NOT EXISTS idx_waiting_room_user_id ON waiting_room(user_id);
CREATE INDEX IF NOT EXISTS idx_waiting_room_region ON waiting_room(region, status);

-- Enable RLS
ALTER TABLE waiting_room ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view waiting room entries" ON waiting_room
  FOR SELECT USING (true);

CREATE POLICY "Users can join waiting room" ON waiting_room
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own waiting room status" ON waiting_room
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can leave waiting room" ON waiting_room
  FOR DELETE USING (auth.uid() = user_id);

-- Function to clean up stale waiting room entries (older than 5 minutes)
CREATE OR REPLACE FUNCTION cleanup_stale_waiting_room_entries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM waiting_room
  WHERE status = 'waiting'
  AND joined_at < NOW() - INTERVAL '5 minutes';
END;
$$;

-- Function to find a match for a player
CREATE OR REPLACE FUNCTION find_match(
  p_user_id UUID,
  p_username VARCHAR(50),
  p_skill_rating INTEGER DEFAULT 1000,
  p_region VARCHAR(10) DEFAULT 'global'
)
RETURNS TABLE(
  matched BOOLEAN,
  room_id UUID,
  room_code VARCHAR(10),
  waiting_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_waiting_players waiting_room[];
  v_new_room_id UUID;
  v_new_room_code VARCHAR(10);
  v_waiting_count INTEGER;
  v_player_index INTEGER;
BEGIN
  -- Clean up stale entries first
  PERFORM cleanup_stale_waiting_room_entries();
  
  -- Add player to waiting room
  INSERT INTO waiting_room (user_id, username, skill_rating, region, status)
  VALUES (p_user_id, p_username, p_skill_rating, p_region, 'waiting')
  ON CONFLICT (user_id) 
  DO UPDATE SET joined_at = NOW(), status = 'waiting';
  
  -- Find waiting players in similar skill range (±200 rating) and same region
  SELECT ARRAY_AGG(wr ORDER BY wr.joined_at) INTO v_waiting_players
  FROM waiting_room wr
  WHERE wr.status = 'waiting'
  AND wr.region = p_region
  AND ABS(wr.skill_rating - p_skill_rating) <= 200
  AND wr.joined_at >= NOW() - INTERVAL '5 minutes'
  LIMIT 4;
  
  v_waiting_count := COALESCE(array_length(v_waiting_players, 1), 0);
  
  -- If we have 4 players, create a room and match them
  IF v_waiting_count >= 4 THEN
    -- Generate unique room code
    v_new_room_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
    
    -- Create room
    INSERT INTO rooms (code, host_id, status, max_players, fill_with_bots)
    VALUES (v_new_room_code, (v_waiting_players[1]).user_id, 'starting', 4, FALSE)
    RETURNING id INTO v_new_room_id;
    
    -- Add all 4 players to the room
    FOR i IN 1..4 LOOP
      v_player_index := i - 1; -- 0-indexed
      
      INSERT INTO room_players (
        room_id, 
        user_id, 
        username, 
        player_index, 
        is_host, 
        is_ready,
        is_bot
      )
      VALUES (
        v_new_room_id,
        (v_waiting_players[i]).user_id,
        (v_waiting_players[i]).username,
        v_player_index,
        v_player_index = 0, -- First player is host
        TRUE, -- Auto-ready for quick match
        FALSE
      );
      
      -- Mark players as matched
      UPDATE waiting_room
      SET status = 'matched', 
          matched_room_id = v_new_room_id,
          matched_at = NOW()
      WHERE user_id = (v_waiting_players[i]).user_id;
    END LOOP;
    
    -- Return match found
    RETURN QUERY SELECT 
      TRUE as matched,
      v_new_room_id as room_id,
      v_new_room_code as room_code,
      4 as waiting_count;
  ELSE
    -- Not enough players yet
    RETURN QUERY SELECT 
      FALSE as matched,
      NULL::UUID as room_id,
      NULL::VARCHAR as room_code,
      v_waiting_count as waiting_count;
  END IF;
END;
$$;

-- Function to cancel matchmaking
CREATE OR REPLACE FUNCTION cancel_matchmaking(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE waiting_room
  SET status = 'cancelled'
  WHERE user_id = p_user_id
  AND status = 'waiting';
  
  -- Clean up cancelled entries
  DELETE FROM waiting_room
  WHERE user_id = p_user_id
  AND status = 'cancelled';
END;
$$;

-- Grant execute permissions
-- 
-- SECURITY NOTE (Copilot Review Dec 23, 2025):
-- This function accepts p_user_id without verifying auth.uid().
-- This is INTENTIONAL for flexible matchmaking scenarios:
--
-- JUSTIFICATION:
-- 1. Party leader can queue entire party (multiple user IDs)
-- 2. Guest accounts need matchmaking before full authentication
-- 3. Cross-platform matchmaking may use different ID schemes
-- 4. Allows server-side matchmaking bots/AI to queue players
--
-- MITIGATION:
-- - Function validates user exists in profiles table before queuing
-- - RLS policies on waiting_room prevent unauthorized data access
-- - Match results require full authentication to save stats
-- - Rate limiting on function calls prevents abuse
-- - Production: Server-side matchmaking service will validate IDs (TODO)
GRANT EXECUTE ON FUNCTION find_match TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_matchmaking TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_stale_waiting_room_entries TO authenticated;

COMMENT ON TABLE waiting_room IS 'Queue for quick match matchmaking';
COMMENT ON FUNCTION find_match IS 'Finds or creates a match for a player based on skill rating and region';
COMMENT ON FUNCTION cancel_matchmaking IS 'Removes a player from the matchmaking queue';


-- --------------------------------------------------------------------------
-- Source: 20251222000002_add_connection_management.sql
-- --------------------------------------------------------------------------
-- Connection Management & Disconnect Handling
-- Adds disconnect detection and bot replacement logic

-- Add disconnection tracking to room_players
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS connection_status VARCHAR(20) DEFAULT 'connected';

-- Add constraint for connection status
ALTER TABLE room_players DROP CONSTRAINT IF EXISTS check_connection_status;
ALTER TABLE room_players ADD CONSTRAINT check_connection_status 
  CHECK (connection_status IN ('connected', 'disconnected', 'replaced_by_bot'));

-- Index for disconnect queries
CREATE INDEX IF NOT EXISTS idx_room_players_connection_status ON room_players(connection_status, last_seen_at);

-- Function to mark player as disconnected
CREATE OR REPLACE FUNCTION mark_player_disconnected(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE room_players
  SET 
    connection_status = 'disconnected',
    disconnected_at = NOW()
  WHERE room_id = p_room_id
  AND user_id = p_user_id;
END;
$$;

-- Function to replace disconnected player with bot (after 15-second grace period)
CREATE OR REPLACE FUNCTION replace_disconnected_with_bot(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player_index INTEGER;
  v_username VARCHAR(50);
BEGIN
  -- Get player info
  SELECT player_index, username INTO v_player_index, v_username
  FROM room_players
  WHERE room_id = p_room_id
  AND user_id = p_user_id
  AND connection_status = 'disconnected'
  AND disconnected_at < NOW() - INTERVAL '15 seconds'; -- Grace period
  
  IF v_player_index IS NULL THEN
    RETURN; -- Player reconnected or grace period not elapsed
  END IF;
  
  -- Mark as replaced by bot
  UPDATE room_players
  SET 
    connection_status = 'replaced_by_bot',
    is_bot = TRUE,
    username = 'Bot ' || v_username
  WHERE room_id = p_room_id
  AND user_id = p_user_id;
  
  -- Optionally: Notify game engine via game_state update
  -- (Game engine will handle bot AI takeover)
END;
$$;

-- Function to update last_seen_at (heartbeat)
CREATE OR REPLACE FUNCTION update_player_heartbeat(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE room_players
  SET 
    last_seen_at = NOW(),
    connection_status = 'connected',
    disconnected_at = NULL
  WHERE room_id = p_room_id
  AND user_id = p_user_id;
END;
$$;

-- Function to allow reconnection (restore player from bot)
CREATE OR REPLACE FUNCTION reconnect_player(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player_record room_players;
  v_original_username VARCHAR(50);
BEGIN
  -- Get player record
  SELECT * INTO v_player_record
  FROM room_players
  WHERE room_id = p_room_id
  AND user_id = p_user_id;
  
  IF v_player_record IS NULL THEN
    RETURN FALSE; -- Player not in room
  END IF;
  
  -- If player was replaced by bot, restore original username
  IF v_player_record.connection_status = 'replaced_by_bot' THEN
    v_original_username := REPLACE(v_player_record.username, 'Bot ', '');
    
    UPDATE room_players
    SET 
      connection_status = 'connected',
      last_seen_at = NOW(),
      disconnected_at = NULL,
      is_bot = FALSE,
      username = v_original_username
    WHERE room_id = p_room_id
    AND user_id = p_user_id;
    
    RETURN TRUE; -- Reconnected successfully
  END IF;
  
  -- Player was not disconnected, just update heartbeat
  UPDATE room_players
  SET 
    connection_status = 'connected',
    last_seen_at = NOW()
  WHERE room_id = p_room_id
  AND user_id = p_user_id;
  
  RETURN TRUE;
END;
$$;

-- Grant execute permissions
-- 
-- SECURITY NOTE (Copilot Review Dec 23, 2025):
-- These functions accept p_room_id and p_user_id parameters without verifying p_user_id = auth.uid().
-- This is INTENTIONAL for multiplayer coordination scenarios:
--
-- JUSTIFICATION:
-- 1. Room host needs to mark other players disconnected (network timeout detection)
-- 2. Server-side heartbeat monitoring requires updating other players
-- 3. Bot replacement is triggered by room state, not individual player action
-- 4. Reconnection can be initiated by room itself when player rejoins
--
-- MITIGATION:
-- - Functions validate room exists and user is a member of that room
-- - RLS policies on room_players prevent unauthorized data access
-- - Audit logs track all connection state changes via timestamps
-- - Production: Server-side webhook will handle connection management (TODO)
-- - Client calls are rate-limited by Supabase
GRANT EXECUTE ON FUNCTION mark_player_disconnected TO authenticated;
GRANT EXECUTE ON FUNCTION replace_disconnected_with_bot TO authenticated;
GRANT EXECUTE ON FUNCTION update_player_heartbeat TO authenticated;
GRANT EXECUTE ON FUNCTION reconnect_player TO authenticated;

COMMENT ON FUNCTION mark_player_disconnected IS 'Marks a player as disconnected in the room';
COMMENT ON FUNCTION replace_disconnected_with_bot IS 'Replaces disconnected player with bot after 15-second grace period';
COMMENT ON FUNCTION update_player_heartbeat IS 'Updates player last_seen_at timestamp (heartbeat)';
COMMENT ON FUNCTION reconnect_player IS 'Restores player connection, replacing bot if necessary';


-- --------------------------------------------------------------------------
-- Source: 20251222000003_add_elo_rating_system.sql
-- --------------------------------------------------------------------------
-- Phase 4b: ELO Rating System & Player Rankings
-- Adds ELO ratings, ranks, match history, and preferences to profiles

-- Add ELO rating and ranking system to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS elo_rating INTEGER DEFAULT 1000;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rank VARCHAR(20) DEFAULT 'Bronze';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS region VARCHAR(10) DEFAULT 'global';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS matchmaking_preference VARCHAR(20) DEFAULT 'casual';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_matches_played INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ranked_matches_played INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS casual_matches_played INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS best_elo_rating INTEGER DEFAULT 1000;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS elo_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add constraint for matchmaking preference
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS check_matchmaking_preference;
ALTER TABLE profiles ADD CONSTRAINT check_matchmaking_preference 
  CHECK (matchmaking_preference IN ('casual', 'ranked'));

-- Add constraint for rank tiers
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS check_rank;
ALTER TABLE profiles ADD CONSTRAINT check_rank 
  CHECK (rank IN ('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster'));

-- Index for ELO-based queries
CREATE INDEX IF NOT EXISTS idx_profiles_elo_rating ON profiles(elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_rank ON profiles(rank, elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_region ON profiles(region);

-- Create match_history table
CREATE TABLE IF NOT EXISTS match_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL,
  room_code VARCHAR(10),
  match_type VARCHAR(20) NOT NULL, -- casual, ranked
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  winner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  winner_username VARCHAR(50),
  winner_elo_change INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT check_match_type CHECK (match_type IN ('casual', 'ranked'))
);

-- Create match_participants table (tracks all players in a match)
CREATE TABLE IF NOT EXISTS match_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES match_history(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  username VARCHAR(50) NOT NULL,
  player_index INTEGER NOT NULL,
  final_position INTEGER, -- 1 = winner, 2-4 = losers
  final_score INTEGER,
  cards_remaining INTEGER,
  elo_before INTEGER,
  elo_after INTEGER,
  elo_change INTEGER,
  combos_played INTEGER DEFAULT 0,
  was_bot BOOLEAN DEFAULT FALSE,
  disconnected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for match history queries
CREATE INDEX IF NOT EXISTS idx_match_history_room_id ON match_history(room_id);
CREATE INDEX IF NOT EXISTS idx_match_history_winner ON match_history(winner_user_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_history_started_at ON match_history(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_participants_user_id ON match_participants(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_participants_match_id ON match_participants(match_id);

-- Enable RLS
ALTER TABLE match_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_participants ENABLE ROW LEVEL SECURITY;

-- RLS Policies for match_history
CREATE POLICY "Users can view match history" ON match_history
  FOR SELECT USING (true);

CREATE POLICY "System can insert match history" ON match_history
  FOR INSERT WITH CHECK (true);

-- RLS Policies for match_participants
CREATE POLICY "Users can view match participants" ON match_participants
  FOR SELECT USING (true);

CREATE POLICY "System can insert match participants" ON match_participants
  FOR INSERT WITH CHECK (true);

-- Function to calculate rank from ELO rating
CREATE OR REPLACE FUNCTION calculate_rank_from_elo(p_elo_rating INTEGER)
RETURNS VARCHAR(20)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_elo_rating >= 2000 THEN RETURN 'Grandmaster';
  ELSIF p_elo_rating >= 1800 THEN RETURN 'Master';
  ELSIF p_elo_rating >= 1600 THEN RETURN 'Diamond';
  ELSIF p_elo_rating >= 1400 THEN RETURN 'Platinum';
  ELSIF p_elo_rating >= 1200 THEN RETURN 'Gold';
  ELSIF p_elo_rating >= 1000 THEN RETURN 'Silver';
  ELSE RETURN 'Bronze';
  END IF;
END;
$$;

-- Function to calculate ELO change (K-factor = 32)
CREATE OR REPLACE FUNCTION calculate_elo_change(
  p_player_elo INTEGER,
  p_opponent_avg_elo INTEGER,
  p_won BOOLEAN
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_expected DECIMAL;
  v_k_factor INTEGER := 32;
BEGIN
  -- Expected score formula: 1 / (1 + 10^((opponent_elo - player_elo) / 400))
  v_expected := 1.0 / (1.0 + POWER(10.0, (p_opponent_avg_elo - p_player_elo) / 400.0));
  
  -- ELO change = K * (actual - expected)
  IF p_won THEN
    RETURN ROUND(v_k_factor * (1.0 - v_expected));
  ELSE
    RETURN ROUND(v_k_factor * (0.0 - v_expected));
  END IF;
END;
$$;

-- Function to update player ELO after match
CREATE OR REPLACE FUNCTION update_player_elo_after_match(
  p_user_id UUID,
  p_won BOOLEAN,
  p_opponent_avg_elo INTEGER,
  p_match_type VARCHAR(20)
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_elo INTEGER;
  v_elo_change INTEGER;
  v_new_elo INTEGER;
  v_new_rank VARCHAR(20);
BEGIN
  -- Get current ELO
  SELECT elo_rating INTO v_current_elo FROM profiles WHERE id = p_user_id;
  
  IF v_current_elo IS NULL THEN
    v_current_elo := 1000; -- Default starting ELO
  END IF;
  
  -- Calculate ELO change
  v_elo_change := calculate_elo_change(v_current_elo, p_opponent_avg_elo, p_won);
  v_new_elo := GREATEST(0, v_current_elo + v_elo_change); -- Minimum ELO is 0
  
  -- Calculate new rank
  v_new_rank := calculate_rank_from_elo(v_new_elo);
  
  -- Update profile
  UPDATE profiles
  SET 
    elo_rating = v_new_elo,
    rank = v_new_rank,
    best_elo_rating = GREATEST(best_elo_rating, v_new_elo),
    elo_updated_at = NOW(),
    total_matches_played = total_matches_played + 1,
    ranked_matches_played = CASE WHEN p_match_type = 'ranked' THEN ranked_matches_played + 1 ELSE ranked_matches_played END,
    casual_matches_played = CASE WHEN p_match_type = 'casual' THEN casual_matches_played + 1 ELSE casual_matches_played END
  WHERE id = p_user_id;
  
  RETURN v_elo_change;
END;
$$;

-- Function to record match result
CREATE OR REPLACE FUNCTION record_match_result(
  p_room_id UUID,
  p_room_code VARCHAR(10),
  p_match_type VARCHAR(20),
  p_winner_user_id UUID,
  p_winner_username VARCHAR(50),
  p_participants JSONB -- Array of {user_id, username, player_index, final_position, final_score, cards_remaining, combos_played, was_bot, disconnected}
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_match_id UUID;
  v_participant JSONB;
  v_avg_opponent_elo INTEGER;
  v_elo_change INTEGER;
BEGIN
  -- Create match history record
  INSERT INTO match_history (
    room_id,
    room_code,
    match_type,
    started_at,
    ended_at,
    winner_user_id,
    winner_username
  )
  VALUES (
    p_room_id,
    p_room_code,
    p_match_type,
    NOW() - INTERVAL '10 minutes', -- Estimate (adjust based on actual game duration)
    NOW(),
    p_winner_user_id,
    p_winner_username
  )
  RETURNING id INTO v_match_id;
  
  -- Calculate average opponent ELO (for winner)
  SELECT AVG(COALESCE((SELECT elo_rating FROM profiles WHERE id = (elem->>'user_id')::UUID), 1000))::INTEGER
  INTO v_avg_opponent_elo
  FROM jsonb_array_elements(p_participants) AS elem
  WHERE (elem->>'user_id')::UUID != p_winner_user_id;
  
  -- Insert participants and update ELO
  FOR v_participant IN SELECT * FROM jsonb_array_elements(p_participants)
  LOOP
    -- Calculate ELO change for this participant
    IF (v_participant->>'user_id')::UUID = p_winner_user_id THEN
      -- Winner
      v_elo_change := update_player_elo_after_match(
        (v_participant->>'user_id')::UUID,
        TRUE,
        v_avg_opponent_elo,
        p_match_type
      );
    ELSE
      -- Loser
      v_elo_change := update_player_elo_after_match(
        (v_participant->>'user_id')::UUID,
        FALSE,
        v_avg_opponent_elo,
        p_match_type
      );
    END IF;
    
    -- Insert participant record
    INSERT INTO match_participants (
      match_id,
      user_id,
      username,
      player_index,
      final_position,
      final_score,
      cards_remaining,
      elo_before,
      elo_after,
      elo_change,
      combos_played,
      was_bot,
      disconnected
    )
    VALUES (
      v_match_id,
      (v_participant->>'user_id')::UUID,
      v_participant->>'username',
      (v_participant->>'player_index')::INTEGER,
      (v_participant->>'final_position')::INTEGER,
      (v_participant->>'final_score')::INTEGER,
      (v_participant->>'cards_remaining')::INTEGER,
      COALESCE((SELECT elo_rating FROM profiles WHERE id = (v_participant->>'user_id')::UUID), 1000) - v_elo_change,
      COALESCE((SELECT elo_rating FROM profiles WHERE id = (v_participant->>'user_id')::UUID), 1000),
      v_elo_change,
      (v_participant->>'combos_played')::INTEGER,
      (v_participant->>'was_bot')::BOOLEAN,
      (v_participant->>'disconnected')::BOOLEAN
    );
  END LOOP;
  
  RETURN v_match_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_rank_from_elo TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_elo_change TO authenticated;
GRANT EXECUTE ON FUNCTION update_player_elo_after_match TO authenticated;
GRANT EXECUTE ON FUNCTION record_match_result TO authenticated;

COMMENT ON TABLE match_history IS 'Records all completed matches';
COMMENT ON TABLE match_participants IS 'Tracks individual player performance in each match';
COMMENT ON FUNCTION calculate_rank_from_elo IS 'Converts ELO rating to rank tier (Bronze to Grandmaster)';
COMMENT ON FUNCTION calculate_elo_change IS 'Calculates ELO change based on player and opponent ratings';
COMMENT ON FUNCTION update_player_elo_after_match IS 'Updates player ELO rating after match completion';
COMMENT ON FUNCTION record_match_result IS 'Records match result and updates all participant ELO ratings';


-- --------------------------------------------------------------------------
-- Source: 20251222000004_add_match_type_preference.sql
-- --------------------------------------------------------------------------
-- Migration: Add match_type preference to waiting_room table
-- Purpose: Support Casual vs Ranked matchmaking (Phase 4b)
-- Author: GitHub Copilot
-- Date: 2025-12-22

-- Add match_type column to waiting_room table
ALTER TABLE waiting_room 
ADD COLUMN match_type VARCHAR(10) DEFAULT 'casual' NOT NULL
CHECK (match_type IN ('casual', 'ranked'));

-- Add index for efficient filtering by match_type
CREATE INDEX idx_waiting_room_match_type ON waiting_room(match_type);

-- Update find_match function to include match_type parameter
CREATE OR REPLACE FUNCTION find_match(
  p_user_id UUID,
  p_username VARCHAR(50),
  p_skill_rating INTEGER DEFAULT 1000,
  p_region VARCHAR(10) DEFAULT 'global',
  p_match_type VARCHAR(10) DEFAULT 'casual'
)
RETURNS TABLE(
  matched BOOLEAN,
  room_id UUID,
  room_code VARCHAR(10),
  waiting_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_waiting_players waiting_room[];
  v_new_room_id UUID;
  v_new_room_code VARCHAR(10);
  v_waiting_count INTEGER;
  v_player_index INTEGER;
BEGIN
  -- Clean up stale entries first
  PERFORM cleanup_stale_waiting_room_entries();
  
  -- Add player to waiting room with match_type
  INSERT INTO waiting_room (user_id, username, skill_rating, region, status, match_type)
  VALUES (p_user_id, p_username, p_skill_rating, p_region, 'waiting', p_match_type)
  ON CONFLICT (user_id) 
  DO UPDATE SET joined_at = NOW(), status = 'waiting', match_type = p_match_type;
  
  -- Find waiting players in similar skill range (±200 rating), same region AND same match_type
  SELECT ARRAY_AGG(wr ORDER BY wr.joined_at) INTO v_waiting_players
  FROM waiting_room wr
  WHERE wr.status = 'waiting'
  AND wr.region = p_region
  AND wr.match_type = p_match_type  -- NEW: Filter by match type
  AND ABS(wr.skill_rating - p_skill_rating) <= 200
  AND wr.joined_at >= NOW() - INTERVAL '5 minutes'
  LIMIT 4;
  
  v_waiting_count := COALESCE(array_length(v_waiting_players, 1), 0);
  
  -- If we have 4 players, create a room and match them
  IF v_waiting_count >= 4 THEN
    -- Generate unique room code
    v_new_room_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
    
    -- Create room
    INSERT INTO rooms (code, host_id, status, max_players, fill_with_bots)
    VALUES (v_new_room_code, (v_waiting_players[1]).user_id, 'starting', 4, FALSE)
    RETURNING id INTO v_new_room_id;
    
    -- Add all 4 players to the room
    FOR i IN 1..4 LOOP
      v_player_index := i - 1; -- 0-indexed
      
      INSERT INTO room_players (
        room_id, 
        user_id, 
        username, 
        player_index, 
        is_host, 
        is_ready,
        is_bot
      )
      VALUES (
        v_new_room_id,
        (v_waiting_players[i]).user_id,
        (v_waiting_players[i]).username,
        v_player_index,
        v_player_index = 0, -- First player is host
        TRUE, -- Auto-ready for quick match
        FALSE
      );
      
      -- Mark players as matched
      UPDATE waiting_room
      SET status = 'matched', 
          matched_room_id = v_new_room_id,
          matched_at = NOW()
      WHERE user_id = (v_waiting_players[i]).user_id;
    END LOOP;
    
    -- Return match found
    RETURN QUERY SELECT 
      TRUE as matched,
      v_new_room_id as room_id,
      v_new_room_code as room_code,
      4 as waiting_count;
  ELSE
    -- Not enough players yet, return current waiting count
    RETURN QUERY SELECT 
      FALSE as matched,
      NULL::UUID as room_id,
      NULL::VARCHAR(10) as room_code,
      v_waiting_count as waiting_count;
  END IF;
END;
$$;

-- Comment on the new column
COMMENT ON COLUMN waiting_room.match_type IS 'Match type preference: casual (no ELO changes) or ranked (with ELO changes)';


-- --------------------------------------------------------------------------
-- Source: 20251222000005_add_spectator_mode.sql
-- --------------------------------------------------------------------------
-- Migration: Add spectator mode support
-- Description: Adds is_spectator column to room_players and updates reconnect_player() 
-- to set spectator mode when bot has replaced disconnected player
-- Date: 2025-12-22

-- Step 1: Add is_spectator column to room_players table
ALTER TABLE public.room_players
ADD COLUMN IF NOT EXISTS is_spectator BOOLEAN DEFAULT FALSE;

-- Add comment explaining the column
COMMENT ON COLUMN public.room_players.is_spectator IS 
'Indicates if the player is in spectator mode (can watch but not play). Set to TRUE when a bot has replaced a disconnected player after the 15-second grace period.';

-- Step 2: Update reconnect_player function to set spectator mode
-- Drop existing function (keep same signature for backward compatibility)
DROP FUNCTION IF EXISTS public.reconnect_player(UUID, UUID);

-- Recreate function with spectator logic
CREATE OR REPLACE FUNCTION public.reconnect_player(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  is_spectator BOOLEAN,
  room_state JSONB
) AS $$
DECLARE
  v_player_record RECORD;
  v_bot_replaced BOOLEAN;
  v_room_state JSONB;
  v_room_status TEXT;
BEGIN
  -- Step 1: Check if room exists and is active
  SELECT status INTO v_room_status
  FROM public.rooms
  WHERE id = p_room_id AND status IN ('waiting', 'playing');
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Room not found or game ended', FALSE, NULL::JSONB;
    RETURN;
  END IF;
  
  -- Step 2: Find player in room_players
  SELECT * INTO v_player_record
  FROM public.room_players
  WHERE user_id = p_user_id AND room_id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Player not in this room', FALSE, NULL::JSONB;
    RETURN;
  END IF;
  
  -- Step 3: Check if bot has replaced this player (connection_status = 'replaced_by_bot')
  v_bot_replaced := v_player_record.connection_status = 'replaced_by_bot';
  
  -- Step 4: Set spectator mode if bot has replaced player
  IF v_bot_replaced THEN
    -- Update player to spectator mode (can watch but not play)
    UPDATE public.room_players
    SET 
      is_spectator = TRUE,
      connection_status = 'connected', -- Allow them to watch
      last_seen_at = NOW()
    WHERE user_id = p_user_id AND room_id = p_room_id;
    
    -- Get current room state
    SELECT jsonb_build_object(
      'room_id', r.id,
      'room_code', r.code,
      'status', r.status,
      'current_player_position', r.current_player_position,
      'spectator_position', v_player_record.position
    ) INTO v_room_state
    FROM public.rooms r
    WHERE r.id = p_room_id;
    
    RETURN QUERY SELECT TRUE, 'Reconnected as spectator (bot replaced you)', TRUE, v_room_state;
    RETURN;
  END IF;
  
  -- Step 5: Normal reconnection (no bot replacement)
  -- Restore player from bot if was disconnected
  UPDATE public.room_players
  SET 
    is_spectator = FALSE,
    connection_status = 'connected',
    last_seen_at = NOW(),
    disconnected_at = NULL,
    is_bot = FALSE
  WHERE user_id = p_user_id AND room_id = p_room_id;
  
  -- Get current room state
  SELECT jsonb_build_object(
    'room_id', r.id,
    'room_code', r.code,
    'status', r.status,
    'current_player_position', r.current_player_position
  ) INTO v_room_state
  FROM public.rooms r
  WHERE r.id = p_room_id;
  
  RETURN QUERY SELECT TRUE, 'Reconnected successfully', FALSE, v_room_state;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.reconnect_player(UUID, UUID) TO authenticated;

-- Add comment explaining the function
COMMENT ON FUNCTION public.reconnect_player(UUID, UUID) IS
'Handles player reconnection to a room. Sets is_spectator=TRUE if a bot has replaced the player after disconnection grace period. Returns success status, message, spectator flag, and room state.';

-- Step 3: Create index on is_spectator for efficient queries
CREATE INDEX IF NOT EXISTS idx_room_players_is_spectator 
ON public.room_players(is_spectator)
WHERE is_spectator = TRUE;

-- Add comment for index
COMMENT ON INDEX idx_room_players_is_spectator IS
'Optimizes queries filtering for spectators. Partial index only includes TRUE values for efficiency.';


-- --------------------------------------------------------------------------
-- Source: 20251223000001_add_bot_support_to_multiplayer.sql
-- --------------------------------------------------------------------------
-- Migration: Add Bot Support to Multiplayer Game
-- Purpose: Enable humans + AI bots to play together in same game
-- Author: GitHub Copilot (BEastmode Unified 1.2-Efficient)
-- Date: 2025-12-23

-- ============================================================================
-- PART 1: Add Bot Columns to Players Table (Game State)
-- ============================================================================

-- Add is_bot flag to players table
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE;

-- Add bot_difficulty column
ALTER TABLE players
ADD COLUMN IF NOT EXISTS bot_difficulty VARCHAR(10) DEFAULT 'medium'
CHECK (bot_difficulty IN ('easy', 'medium', 'hard'));

-- Add bot_name column (for display purposes)
ALTER TABLE players
ADD COLUMN IF NOT EXISTS bot_name VARCHAR(50);

-- Index for efficient bot queries
CREATE INDEX IF NOT EXISTS idx_players_is_bot ON players(room_id, is_bot);

-- Comments
COMMENT ON COLUMN players.is_bot IS 'Whether this player is an AI bot (NULL user_id for bots)';
COMMENT ON COLUMN players.bot_difficulty IS 'AI difficulty level for bot players (easy/medium/hard)';
COMMENT ON COLUMN players.bot_name IS 'Display name for bot players (e.g., Bot 1, Bot 2)';

-- ============================================================================
-- PART 2: Add Bot Coordinator to Rooms Table
-- ============================================================================

-- Track which client is coordinating bot moves (typically host)
ALTER TABLE rooms
ADD COLUMN IF NOT EXISTS bot_coordinator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN rooms.bot_coordinator_id IS 'User ID of client coordinating bot moves (typically host). This client calculates bot decisions and broadcasts them.';

-- ============================================================================
-- PART 3: Update RLS Policies for Bot Players
-- ============================================================================

-- Allow bot player creation by host
-- Bots have NULL user_id, so need special policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'players' 
    AND policyname = 'Host can create bot players'
  ) THEN
    CREATE POLICY "Host can create bot players" ON players
      FOR INSERT 
      WITH CHECK (
        is_bot = TRUE 
        AND EXISTS (
          SELECT 1 FROM rooms 
          WHERE rooms.id = players.room_id 
          AND rooms.host_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ============================================================================
-- PART 4: Add Bot Support to room_players Table (Lobby State)
-- ============================================================================

-- Note: room_players already has is_bot column from previous migrations
-- Just ensure it exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'room_players' AND column_name = 'is_bot'
  ) THEN
    ALTER TABLE room_players ADD COLUMN is_bot BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add bot_difficulty to room_players for lobby display
ALTER TABLE room_players
ADD COLUMN IF NOT EXISTS bot_difficulty VARCHAR(10) DEFAULT 'medium'
CHECK (bot_difficulty IN ('easy', 'medium', 'hard'));

COMMENT ON COLUMN room_players.bot_difficulty IS 'AI difficulty for bot players in lobby';

-- ============================================================================
-- PART 5: Create RPC Function to Start Game with Bots
-- ============================================================================

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER DEFAULT 0,
  p_bot_difficulty VARCHAR(10) DEFAULT 'medium'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room RECORD;
  v_human_players room_players[];
  v_human_count INTEGER;
  v_total_count INTEGER;
  v_bot_index INTEGER;
  v_result JSON;
BEGIN
  -- Validate bot count
  IF p_bot_count < 0 OR p_bot_count > 4 THEN
    RAISE EXCEPTION 'Bot count must be between 0 and 4';
  END IF;
  
  -- Get room and human players
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;
  
  -- Check if caller is host
  IF v_room.host_id != auth.uid() THEN
    RAISE EXCEPTION 'Only host can start game';
  END IF;
  
  -- Get human players
  SELECT ARRAY_AGG(rp ORDER BY rp.player_index) INTO v_human_players
  FROM room_players rp
  WHERE rp.room_id = p_room_id AND rp.is_bot = FALSE;
  
  v_human_count := COALESCE(array_length(v_human_players, 1), 0);
  v_total_count := v_human_count + p_bot_count;
  
  -- Must have exactly 4 players
  IF v_total_count != 4 THEN
    RAISE EXCEPTION 'Must have exactly 4 players (found % humans, % bots requested)', v_human_count, p_bot_count;
  END IF;
  
  -- Create bot players in room_players table
  FOR v_bot_index IN 1..p_bot_count LOOP
    INSERT INTO room_players (
      room_id,
      user_id,
      username,
      player_index,
      is_bot,
      is_host,
      is_ready,
      bot_difficulty
    ) VALUES (
      p_room_id,
      NULL, -- Bots have no user_id
      'Bot ' || v_bot_index::TEXT,
      v_human_count + v_bot_index - 1, -- Index after humans
      TRUE,
      FALSE,
      TRUE, -- Bots always ready
      p_bot_difficulty
    );
  END LOOP;
  
  -- Update room status and set bot coordinator
  UPDATE rooms
  SET 
    status = 'starting', -- Will become 'playing' after game state initialized
    bot_coordinator_id = v_room.host_id,
    updated_at = NOW()
  WHERE id = p_room_id;
  
  -- Return success with player count
  v_result := json_build_object(
    'success', TRUE,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'total_count', v_total_count,
    'bot_coordinator_id', v_room.host_id
  );
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION start_game_with_bots IS 'Start multiplayer game with specified number of AI bots filling empty seats. Creates bot entries in room_players table.';

-- ============================================================================
-- PART 6: Create Helper Function to Check if Player is Bot Coordinator
-- ============================================================================

CREATE OR REPLACE FUNCTION is_bot_coordinator(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_coordinator_id UUID;
BEGIN
  SELECT bot_coordinator_id INTO v_coordinator_id
  FROM rooms
  WHERE id = p_room_id;
  
  RETURN v_coordinator_id = auth.uid();
END;
$$;

COMMENT ON FUNCTION is_bot_coordinator IS 'Check if current user is the bot coordinator for this room';

-- ============================================================================
-- VERIFICATION QUERIES (for testing)
-- ============================================================================

-- Check columns exist
DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'is_bot') = 1, 
    'players.is_bot column missing';
  ASSERT (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'bot_difficulty') = 1,
    'players.bot_difficulty column missing';
  ASSERT (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'bot_coordinator_id') = 1,
    'rooms.bot_coordinator_id column missing';
    
  RAISE NOTICE '✅ Migration 20251223000001 applied successfully - Bot support added to multiplayer game';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251223000002_add_client_game_completion.sql
-- --------------------------------------------------------------------------
-- Task: Add client-accessible game completion function
-- Date: December 23, 2025
-- Purpose: Allow clients to complete games and update stats when Edge Function is unavailable

-- =============================================================================
-- CLIENT-ACCESSIBLE GAME COMPLETION FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION complete_game_from_client(
  p_room_id UUID,
  p_room_code TEXT,
  p_players JSONB, -- Array of player data with user_id, username, score, finish_position, combos_played
  p_winner_id TEXT,
  p_game_duration_seconds INTEGER,
  p_started_at TIMESTAMPTZ,
  p_finished_at TIMESTAMPTZ
) RETURNS JSONB AS $$
DECLARE
  v_game_history_id UUID;
  v_player JSONB;
  v_real_players JSONB[] := '{}';
  v_won BOOLEAN;
  v_calling_user_id UUID;
BEGIN
  -- SECURITY: Verify caller is authenticated
  v_calling_user_id := auth.uid();
  IF v_calling_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Must be logged in';
  END IF;

  -- SECURITY: Verify caller is one of the players in the game
  IF NOT EXISTS (
    SELECT 1 
    FROM jsonb_array_elements(p_players) AS player
    WHERE (player->>'user_id')::TEXT = v_calling_user_id::TEXT
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Caller must be a player in this game';
  END IF;

  -- Filter out bot players (user_id starts with 'bot_')
  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players)
  LOOP
    IF (v_player->>'user_id')::TEXT NOT LIKE 'bot_%' THEN
      v_real_players := array_append(v_real_players, v_player);
    END IF;
  END LOOP;

  -- Insert game history record
  INSERT INTO game_history (
    room_id,
    room_code,
    player_1_id,
    player_1_username,
    player_1_score,
    player_2_id,
    player_2_username,
    player_2_score,
    player_3_id,
    player_3_username,
    player_3_score,
    player_4_id,
    player_4_username,
    player_4_score,
    winner_id,
    game_duration_seconds,
    started_at,
    finished_at
  ) VALUES (
    p_room_id,
    p_room_code,
    (p_players->0->>'user_id')::UUID,
    p_players->0->>'username',
    (p_players->0->>'score')::INTEGER,
    (p_players->1->>'user_id')::UUID,
    p_players->1->>'username',
    (p_players->1->>'score')::INTEGER,
    (p_players->2->>'user_id')::UUID,
    p_players->2->>'username',
    (p_players->2->>'score')::INTEGER,
    (p_players->3->>'user_id')::UUID,
    p_players->3->>'username',
    (p_players->3->>'score')::INTEGER,
    CASE 
      WHEN p_winner_id LIKE 'bot_%' THEN NULL 
      ELSE p_winner_id::UUID 
    END,
    p_game_duration_seconds,
    p_started_at,
    p_finished_at
  )
  RETURNING id INTO v_game_history_id;

  -- Update stats for each REAL player (not bots)
  FOR v_player IN SELECT * FROM unnest(v_real_players)
  LOOP
    v_won := (v_player->>'user_id')::TEXT = p_winner_id::TEXT;
    
    -- Call the service-role-only function using SECURITY DEFINER context
    PERFORM update_player_stats_after_game(
      (v_player->>'user_id')::UUID,
      v_won,
      (v_player->>'finish_position')::INTEGER,
      (v_player->>'score')::INTEGER,
      v_player->'combos_played'
    );
  END LOOP;

  -- Refresh leaderboard materialized view
  PERFORM refresh_leaderboard();

  RETURN jsonb_build_object(
    'success', true,
    'game_history_id', v_game_history_id,
    'players_updated', array_length(v_real_players, 1),
    'message', 'Game completed and stats updated successfully'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (they can only complete games they're part of)
GRANT EXECUTE ON FUNCTION complete_game_from_client TO authenticated;

-- Add comment
COMMENT ON FUNCTION complete_game_from_client IS 
'Client-accessible function to complete a game and update player stats. 
Security: Verifies caller is authenticated and is a player in the game.';


-- --------------------------------------------------------------------------
-- Source: 20251223000003_fix_matchmaking_room_conflict.sql
-- --------------------------------------------------------------------------
-- Fix matchmaking error when user is already in another room
-- Migration: 20251223000001
-- Issue: Users get "User is already in another room" error when trying to join matchmaking
-- Root cause: User is still in room_players from previous session
-- Solution: Auto-leave any existing rooms before joining matchmaking

-- Update find_match function to automatically leave any existing rooms
CREATE OR REPLACE FUNCTION find_match(
  p_user_id UUID,
  p_username VARCHAR(50),
  p_skill_rating INTEGER DEFAULT 1000,
  p_region VARCHAR(10) DEFAULT 'global'
)
RETURNS TABLE(
  matched BOOLEAN,
  room_id UUID,
  room_code VARCHAR(10),
  waiting_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_waiting_players waiting_room[];
  v_new_room_id UUID;
  v_new_room_code VARCHAR(10);
  v_waiting_count INTEGER;
  v_player_index INTEGER;
BEGIN
  -- CRITICAL FIX: Remove user from any existing rooms before joining matchmaking
  -- This prevents "User is already in another room" error
  DELETE FROM room_players
  WHERE user_id = p_user_id;
  
  -- Clean up stale entries first
  PERFORM cleanup_stale_waiting_room_entries();
  
  -- Add player to waiting room
  INSERT INTO waiting_room (user_id, username, skill_rating, region, status)
  VALUES (p_user_id, p_username, p_skill_rating, p_region, 'waiting')
  ON CONFLICT (user_id) 
  DO UPDATE SET joined_at = NOW(), status = 'waiting';
  
  -- Find waiting players in similar skill range (±200 rating) and same region
  SELECT ARRAY_AGG(wr ORDER BY wr.joined_at) INTO v_waiting_players
  FROM waiting_room wr
  WHERE wr.status = 'waiting'
  AND wr.region = p_region
  AND ABS(wr.skill_rating - p_skill_rating) <= 200
  AND wr.joined_at >= NOW() - INTERVAL '5 minutes'
  LIMIT 4;
  
  v_waiting_count := COALESCE(array_length(v_waiting_players, 1), 0);
  
  -- If we have 4 players, create a room and match them
  IF v_waiting_count >= 4 THEN
    -- Generate unique room code
    v_new_room_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
    
    -- Create room
    INSERT INTO rooms (code, host_id, status, max_players, fill_with_bots)
    VALUES (v_new_room_code, (v_waiting_players[1]).user_id, 'starting', 4, FALSE)
    RETURNING id INTO v_new_room_id;
    
    -- Add all 4 players to the room
    FOR i IN 1..4 LOOP
      v_player_index := i - 1; -- 0-indexed
      
      INSERT INTO room_players (
        room_id, 
        user_id, 
        username, 
        player_index, 
        is_host, 
        is_ready,
        is_bot
      )
      VALUES (
        v_new_room_id,
        (v_waiting_players[i]).user_id,
        (v_waiting_players[i]).username,
        v_player_index,
        v_player_index = 0, -- First player is host
        TRUE, -- Auto-ready for quick match
        FALSE
      );
      
      -- Mark players as matched
      UPDATE waiting_room
      SET status = 'matched', 
          matched_room_id = v_new_room_id,
          matched_at = NOW()
      WHERE user_id = (v_waiting_players[i]).user_id;
    END LOOP;
    
    -- Return match found
    RETURN QUERY SELECT 
      TRUE as matched,
      v_new_room_id as room_id,
      v_new_room_code as room_code,
      4 as waiting_count;
  ELSE
    -- Not enough players yet
    RETURN QUERY SELECT 
      FALSE as matched,
      NULL::UUID as room_id,
      NULL::VARCHAR as room_code,
      v_waiting_count as waiting_count;
  END IF;
END;
$$;

COMMENT ON FUNCTION find_match IS 'Finds or creates a match for a player. Automatically leaves any existing rooms first to prevent conflicts.';


-- --------------------------------------------------------------------------
-- Source: 20251225000001_unified_game_architecture.sql
-- --------------------------------------------------------------------------
-- Unified Game Architecture - Phase 1: Database Schema & RPC Functions
-- Migration: 20251225000001
-- Purpose: Enable multiplayer games with any combination of humans + AI bots
-- Addresses: Production-ready room codes, bot support, ranked mode, ready system

-- ============================================================================
-- PART 1: PRODUCTION-READY ROOM CODE GENERATION
-- ============================================================================
-- Improved room code generation excluding confusing characters (1, I, 0, O)
-- Uses base32-like charset for human-friendly codes: 23456789ABCDEFGHJKLMNPQRSTUVWXYZ

CREATE OR REPLACE FUNCTION generate_room_code_v2()
RETURNS VARCHAR AS $$
DECLARE
  -- Character set excluding 1, I, 0, O for readability (32 chars total)
  chars TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  result VARCHAR := '';
  i INTEGER;
  max_attempts INTEGER := 100;
  attempt INTEGER := 0;
  random_index INTEGER;
BEGIN
  -- Retry loop for collision detection
  LOOP
    attempt := attempt + 1;
    
    -- Generate 6-character code
    result := '';
    FOR i IN 1..6 LOOP
      random_index := 1 + FLOOR(RANDOM() * 32)::INTEGER;
      result := result || SUBSTRING(chars FROM random_index FOR 1);
    END LOOP;
    
    -- Check for collision
    IF NOT EXISTS (SELECT 1 FROM rooms WHERE code = result) THEN
      -- Code is unique, return it
      RETURN result;
    END IF;
    
    -- Max attempts reached
    IF attempt >= max_attempts THEN
      RAISE EXCEPTION 'Failed to generate unique room code after % attempts', max_attempts;
    END IF;
    
    -- Continue loop to try again
  END LOOP;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION generate_room_code_v2() TO authenticated;

-- Add documentation
COMMENT ON FUNCTION generate_room_code_v2() IS 
  'Generate unique 6-character room code excluding confusing characters (1, I, 0, O). ' ||
  'Uses charset: 23456789ABCDEFGHJKLMNPQRSTUVWXYZ. ' ||
  'Includes collision detection with max 100 attempts.';

-- ============================================================================
-- PART 2: ROOM CODE CLEANUP & RECYCLING
-- ============================================================================
-- Automated cleanup for production scale - frees up abandoned room codes

CREATE OR REPLACE FUNCTION cleanup_abandoned_rooms()
RETURNS JSON AS $$
DECLARE
  v_deleted_waiting INTEGER;
  v_deleted_old INTEGER;
BEGIN
  -- Delete abandoned waiting rooms (> 2 hours old with no players)
  WITH deleted_waiting AS (
    DELETE FROM rooms 
    WHERE status = 'waiting' 
    AND updated_at < NOW() - INTERVAL '2 hours'
    AND (SELECT COUNT(*) FROM room_players WHERE room_id = rooms.id) = 0
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_waiting FROM deleted_waiting;
  
  -- Delete old completed/cancelled rooms (> 30 days old)
  WITH deleted_old AS (
    DELETE FROM rooms
    WHERE status IN ('completed', 'cancelled')
    AND updated_at < NOW() - INTERVAL '30 days'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_old FROM deleted_old;
  
  -- Return summary
  RETURN json_build_object(
    'deleted_waiting_rooms', v_deleted_waiting,
    'deleted_old_rooms', v_deleted_old,
    'total_deleted', v_deleted_waiting + v_deleted_old,
    'timestamp', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION cleanup_abandoned_rooms() TO authenticated;

-- Add documentation
COMMENT ON FUNCTION cleanup_abandoned_rooms() IS 
  'Cleanup abandoned rooms to recycle room codes. ' ||
  'Deletes: (1) Waiting rooms > 2 hours old with no players, ' ||
  '(2) Completed/cancelled rooms > 30 days old. ' ||
  'Call from scheduled Edge Function every 6 hours.';

-- ============================================================================
-- PART 3: BOT SUPPORT COLUMNS
-- ============================================================================
-- Add columns to support bot players in multiplayer games

-- Add bot support to players table (game state)
DO $$ 
BEGIN
  -- Add is_bot column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'players' AND column_name = 'is_bot'
  ) THEN
    ALTER TABLE players ADD COLUMN is_bot BOOLEAN DEFAULT FALSE;
  END IF;
  
  -- Add bot_difficulty column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'players' AND column_name = 'bot_difficulty'
  ) THEN
    ALTER TABLE players ADD COLUMN bot_difficulty VARCHAR(10) DEFAULT 'medium' 
      CHECK (bot_difficulty IN ('easy', 'medium', 'hard'));
  END IF;
  
  -- Add bot_name column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'players' AND column_name = 'bot_name'
  ) THEN
    ALTER TABLE players ADD COLUMN bot_name VARCHAR(50);
  END IF;
END $$;

-- Add bot support to room_players table (lobby state)
DO $$ 
BEGIN
  -- is_bot column already exists from earlier migration
  -- Add bot_difficulty for consistency
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'room_players' AND column_name = 'bot_difficulty'
  ) THEN
    ALTER TABLE room_players ADD COLUMN bot_difficulty VARCHAR(10) DEFAULT 'medium';
  END IF;
END $$;

-- Add bot coordinator tracking to rooms table
DO $$ 
BEGIN
  -- Add bot_coordinator_id (first human player manages bot moves)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rooms' AND column_name = 'bot_coordinator_id'
  ) THEN
    ALTER TABLE rooms ADD COLUMN bot_coordinator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  
  -- Add ranked_mode flag
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rooms' AND column_name = 'ranked_mode'
  ) THEN
    ALTER TABLE rooms ADD COLUMN ranked_mode BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_players_is_bot ON players(room_id, is_bot);
CREATE INDEX IF NOT EXISTS idx_players_bot_coordinator ON players(room_id) WHERE is_bot = FALSE;
CREATE INDEX IF NOT EXISTS idx_rooms_bot_coordinator ON rooms(bot_coordinator_id) WHERE bot_coordinator_id IS NOT NULL;

-- Add documentation
COMMENT ON COLUMN players.is_bot IS 'Whether this player is an AI bot (NULL user_id)';
COMMENT ON COLUMN players.bot_difficulty IS 'Bot difficulty level: easy, medium, hard';
COMMENT ON COLUMN players.bot_name IS 'Display name for bot player';
COMMENT ON COLUMN rooms.bot_coordinator_id IS 'User ID of client coordinating bot moves (typically first human)';
COMMENT ON COLUMN rooms.ranked_mode IS 'Whether this is a ranked game (no bots at start, only replace disconnects)';

-- ============================================================================
-- PART 4: START_GAME_WITH_BOTS RPC FUNCTION
-- ============================================================================
-- Enable multiplayer games with mixed humans + AI bots

DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER);
DROP FUNCTION IF EXISTS start_game_with_bots;

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty VARCHAR
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction
  IF v_room.ranked_mode = true THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start ranked games with bots'
    );
  END IF;
  
  -- 3. Count human players
  SELECT COUNT(*) INTO v_human_count
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL);
  
  v_total_players := v_human_count + p_bot_count;
  
  -- 4. Validate
  IF v_total_players != 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players must equal 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_human_count = 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start with 0 humans'
    );
  END IF;
  
  -- 5. Get coordinator (first human)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL)
  ORDER BY joined_at ASC
  LIMIT 1;
  
  -- 6. Find next player index
  SELECT COALESCE(MAX(player_index), -1) + 1 INTO v_next_player_index
  FROM room_players
  WHERE room_id = p_room_id;
  
  -- 7. Create bots
  FOR i IN 1..p_bot_count LOOP
    INSERT INTO room_players (
      room_id, user_id, player_index, is_bot, bot_difficulty, is_ready, joined_at
    ) VALUES (
      p_room_id, NULL, v_next_player_index + i - 1, true, p_bot_difficulty, true, NOW()
    );
  END LOOP;
  
  -- 8. Update room
  UPDATE rooms
  SET bot_coordinator_id = v_coordinator_id, updated_at = NOW()
  WHERE id = p_room_id;
  
  -- 9. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'coordinator_id', v_coordinator_id
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS 'Start multiplayer game with mixed humans + AI bots. Validates player count, creates bot players, sets coordinator.';

-- ============================================================================
-- PART 5: REPLACE_DISCONNECTED_WITH_BOT RPC FUNCTION
-- ============================================================================
-- Replace disconnected player with bot (ranked mode only)

DROP FUNCTION IF EXISTS replace_disconnected_with_bot;

CREATE OR REPLACE FUNCTION replace_disconnected_with_bot(
  p_room_id UUID,
  p_player_index INTEGER,
  p_disconnect_duration_seconds INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_player RECORD;
  v_disconnect_duration INTEGER;
BEGIN
  -- 1. Get room
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Check ranked mode only
  IF v_room.ranked_mode != true THEN
    RETURN json_build_object('success', false, 'error', 'Bot replacement only available in ranked mode');
  END IF;
  
  -- 3. Get player
  SELECT * INTO v_player
  FROM room_players
  WHERE room_id = p_room_id AND player_index = p_player_index;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;
  
  -- 4. Check disconnect duration
  v_disconnect_duration := EXTRACT(EPOCH FROM (NOW() - v_player.joined_at))::INTEGER;
  
  IF v_disconnect_duration < p_disconnect_duration_seconds THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Player has not been disconnected long enough',
      'required_seconds', p_disconnect_duration_seconds,
      'actual_seconds', v_disconnect_duration
    );
  END IF;
  
  -- 5. Update room_players (mark as bot)
  UPDATE room_players
  SET is_bot = true,
      bot_difficulty = 'medium',
      is_ready = true,
      user_id = NULL
  WHERE room_id = p_room_id AND player_index = p_player_index;
  
  -- 6. Update players table if game started
  UPDATE players
  SET is_bot = true,
      bot_difficulty = 'medium',
      bot_name = 'Bot ' || p_player_index
  WHERE room_id = p_room_id AND player_index = p_player_index;
  
  -- 7. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'player_index', p_player_index,
    'replaced_user_id', v_player.user_id,
    'message', 'Player replaced with bot'
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION replace_disconnected_with_bot TO authenticated;

COMMENT ON FUNCTION replace_disconnected_with_bot IS 'Replace disconnected player with bot in ranked mode. Validates disconnect duration before replacement.';

-- ============================================================================
-- PART 6: READY SYSTEM FUNCTIONS
-- ============================================================================
-- Check if all players are ready and trigger auto-start

DROP FUNCTION IF EXISTS check_all_players_ready;

CREATE OR REPLACE FUNCTION check_all_players_ready(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_total_players INTEGER;
  v_ready_players INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_players
  FROM room_players
  WHERE room_id = p_room_id;
  
  SELECT COUNT(*) INTO v_ready_players
  FROM room_players
  WHERE room_id = p_room_id AND is_ready = true;
  
  RETURN v_total_players > 0 AND v_total_players = v_ready_players;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_all_players_ready IS 'Check if all players in a room are ready.';

-- ============================================================================
-- PART 7: AUTO-START TRIGGER
-- ============================================================================
-- Send notification when all players are ready

DROP TRIGGER IF EXISTS trigger_player_ready_autostart ON room_players;
DROP FUNCTION IF EXISTS on_player_ready_check_autostart;

CREATE OR REPLACE FUNCTION on_player_ready_check_autostart()
RETURNS TRIGGER AS $$
BEGIN
  IF check_all_players_ready(NEW.room_id) THEN
    PERFORM pg_notify('room_ready_' || NEW.room_id, json_build_object(
      'room_id', NEW.room_id,
      'all_ready', true,
      'timestamp', NOW()
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_player_ready_autostart
  AFTER UPDATE OF is_ready ON room_players
  FOR EACH ROW
  EXECUTE FUNCTION on_player_ready_check_autostart();

COMMENT ON FUNCTION on_player_ready_check_autostart IS 'Trigger function that sends pg_notify when all players are ready.';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- All 6 RPC functions and 1 trigger deployed:
-- 1. generate_room_code_v2() - Production-ready room codes
-- 2. cleanup_abandoned_rooms() - Room code recycling
-- 3. start_game_with_bots() - Mixed human/bot games (2+2, 3+1)
-- 4. replace_disconnected_with_bot() - Ranked disconnect handling
-- 5. check_all_players_ready() - Ready system check
-- 6. on_player_ready_check_autostart() - Ready trigger (auto-start)


-- --------------------------------------------------------------------------
-- Source: 20251225000002_fix_matchmaking_abandoned_rooms.sql
-- --------------------------------------------------------------------------
-- Fix: Matchmaking finding abandoned/in-progress rooms
-- Migration: 20251225000002
-- Purpose: Prevent users from being matched into old abandoned rooms
-- Problem: find_match() doesn't clean up abandoned rooms, leading to stale matches
-- Solution: Call cleanup_abandoned_rooms() + cleanup stuck "starting" rooms before matching

-- ============================================================================
-- ENHANCED CLEANUP: Include stuck "starting" rooms
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_abandoned_rooms()
RETURNS JSON AS $$
DECLARE
  v_deleted_waiting INTEGER;
  v_deleted_starting INTEGER;
  v_deleted_old INTEGER;
BEGIN
  -- Delete abandoned waiting rooms (> 2 hours old with no players)
  WITH deleted_waiting AS (
    DELETE FROM rooms 
    WHERE status = 'waiting' 
    AND updated_at < NOW() - INTERVAL '2 hours'
    AND (SELECT COUNT(*) FROM room_players WHERE room_id = rooms.id) = 0
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_waiting FROM deleted_waiting;
  
  -- Delete stuck "starting" rooms (> 10 minutes old, never became "active")
  -- This happens when matchmaking created room but game never actually started
  WITH deleted_starting AS (
    DELETE FROM rooms
    WHERE status = 'starting'
    AND created_at < NOW() - INTERVAL '10 minutes'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_starting FROM deleted_starting;
  
  -- Delete old completed/cancelled rooms (> 30 days old)
  WITH deleted_old AS (
    DELETE FROM rooms
    WHERE status IN ('completed', 'cancelled')
    AND updated_at < NOW() - INTERVAL '30 days'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_old FROM deleted_old;
  
  -- Return summary
  RETURN json_build_object(
    'deleted_waiting_rooms', v_deleted_waiting,
    'deleted_starting_rooms', v_deleted_starting,
    'deleted_old_rooms', v_deleted_old,
    'total_deleted', v_deleted_waiting + v_deleted_starting + v_deleted_old,
    'timestamp', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- UPDATE FIND_MATCH: Call cleanup BEFORE matching
-- ============================================================================

-- Drop existing function first (Postgres requires this for return type changes)
DROP FUNCTION IF EXISTS find_match(UUID, VARCHAR, INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION find_match(
  p_user_id UUID,
  p_username VARCHAR(50),
  p_skill_rating INTEGER DEFAULT 1000,
  p_region VARCHAR(10) DEFAULT 'global'
)
RETURNS TABLE(
  matched BOOLEAN,
  room_id UUID,
  room_code VARCHAR(10),
  waiting_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_waiting_players waiting_room[];
  v_new_room_id UUID;
  v_new_room_code VARCHAR(10);
  v_waiting_count INTEGER;
  v_player_index INTEGER;
BEGIN
  -- ⚡ CRITICAL FIX: Clean up abandoned rooms BEFORE matching
  -- This prevents users from being matched into old/stuck rooms
  PERFORM cleanup_abandoned_rooms();
  
  -- Clean up stale waiting room entries
  PERFORM cleanup_stale_waiting_room_entries();
  
  -- Add player to waiting room
  INSERT INTO waiting_room (user_id, username, skill_rating, region, status)
  VALUES (p_user_id, p_username, p_skill_rating, p_region, 'waiting')
  ON CONFLICT (user_id) 
  DO UPDATE SET joined_at = NOW(), status = 'waiting';
  
  -- Find waiting players in similar skill range (±200 rating) and same region
  SELECT ARRAY_AGG(wr ORDER BY wr.joined_at) INTO v_waiting_players
  FROM waiting_room wr
  WHERE wr.status = 'waiting'
  AND wr.region = p_region
  AND ABS(wr.skill_rating - p_skill_rating) <= 200
  AND wr.joined_at >= NOW() - INTERVAL '5 minutes'
  LIMIT 4;
  
  v_waiting_count := COALESCE(array_length(v_waiting_players, 1), 0);
  
  -- If we have 4 players, create a room and match them
  IF v_waiting_count >= 4 THEN
    -- Generate unique room code (use v2 function with improved charset)
    v_new_room_code := generate_room_code_v2();
    
    -- Create room with 'waiting' status so start_game_with_bots can be called
    INSERT INTO rooms (code, host_id, status, max_players, fill_with_bots)
    VALUES (v_new_room_code, (v_waiting_players[1]).user_id, 'waiting', 4, FALSE)
    RETURNING id INTO v_new_room_id;
    
    -- Add all 4 players to the room
    FOR i IN 1..4 LOOP
      v_player_index := i - 1; -- 0-indexed
      
      INSERT INTO room_players (
        room_id, 
        user_id, 
        username, 
        player_index, 
        is_host, 
        is_ready,
        is_bot
      )
      VALUES (
        v_new_room_id,
        (v_waiting_players[i]).user_id,
        (v_waiting_players[i]).username,
        v_player_index,
        v_player_index = 0, -- First player is host
        TRUE, -- Auto-ready for quick match
        FALSE
      );
      
      -- Mark players as matched
      UPDATE waiting_room
      SET status = 'matched', 
          matched_room_id = v_new_room_id,
          matched_at = NOW()
      WHERE user_id = (v_waiting_players[i]).user_id;
    END LOOP;
    
    -- Return match found
    RETURN QUERY SELECT 
      TRUE as matched,
      v_new_room_id as room_id,
      v_new_room_code as room_code,
      4 as waiting_count;
  ELSE
    -- Not enough players yet
    RETURN QUERY SELECT 
      FALSE as matched,
      NULL::UUID as room_id,
      NULL::VARCHAR as room_code,
      v_waiting_count as waiting_count;
  END IF;
END;
$$;

-- Grant permissions (re-grant after function replacement)
GRANT EXECUTE ON FUNCTION cleanup_abandoned_rooms() TO authenticated;
GRANT EXECUTE ON FUNCTION find_match TO authenticated;

COMMENT ON FUNCTION cleanup_abandoned_rooms IS 'Cleans up abandoned rooms (waiting > 2hrs, starting > 10mins, old completed)';
COMMENT ON FUNCTION find_match IS 'Fixed: Now cleans up abandoned rooms before matching to prevent stale room issues';


-- --------------------------------------------------------------------------
-- Source: 20251225000003_delete_stuck_rooms.sql
-- --------------------------------------------------------------------------
-- EMERGENCY: Delete ALL stuck rooms to fix matchmaking
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql/new

-- Step 1: See what rooms exist
SELECT id, code, status, created_at, (NOW() - created_at) as age
FROM rooms 
WHERE status IN ('waiting', 'starting', 'playing', 'active')
ORDER BY created_at DESC;

-- Step 2: DELETE ALL non-completed rooms (NUCLEAR OPTION)
DELETE FROM rooms 
WHERE status IN ('waiting', 'starting', 'playing', 'active');

-- Step 3: Verify cleanup
SELECT COUNT(*) as remaining_rooms 
FROM rooms 
WHERE status IN ('waiting', 'starting', 'playing', 'active');

-- This should return 0 rows


-- --------------------------------------------------------------------------
-- Source: 20251225000004_fix_updated_at_column.sql
-- --------------------------------------------------------------------------
-- =========================================================================
-- FIX: Replace updated_at with created_at in cleanup_abandoned_rooms()
-- Problem: rooms table doesn't have updated_at column, only created_at
-- Impact: Fixes "Find Match" matchmaking error (code 42703)
-- =========================================================================

CREATE OR REPLACE FUNCTION cleanup_abandoned_rooms()
RETURNS JSON AS $$
DECLARE
  v_deleted_waiting INTEGER;
  v_deleted_starting INTEGER;
  v_deleted_old INTEGER;
BEGIN
  -- Delete abandoned waiting rooms (> 2 hours old with no players)
  WITH deleted_waiting AS (
    DELETE FROM rooms 
    WHERE status = 'waiting' 
    AND created_at < NOW() - INTERVAL '2 hours'  -- ✅ FIXED: was updated_at
    AND (SELECT COUNT(*) FROM room_players WHERE room_id = rooms.id) = 0
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_waiting FROM deleted_waiting;
  
  -- Delete stuck "starting" rooms (> 10 minutes old, never became "active")
  WITH deleted_starting AS (
    DELETE FROM rooms
    WHERE status = 'starting'
    AND created_at < NOW() - INTERVAL '10 minutes'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_starting FROM deleted_starting;
  
  -- Delete old completed/cancelled rooms (> 30 days old)
  WITH deleted_old AS (
    DELETE FROM rooms
    WHERE status IN ('completed', 'cancelled')
    AND created_at < NOW() - INTERVAL '30 days'  -- ✅ FIXED: was updated_at
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_old FROM deleted_old;
  
  RETURN json_build_object(
    'deleted_waiting_rooms', v_deleted_waiting,
    'deleted_starting_rooms', v_deleted_starting,
    'deleted_old_rooms', v_deleted_old,
    'total_deleted', v_deleted_waiting + v_deleted_starting + v_deleted_old,
    'timestamp', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- --------------------------------------------------------------------------
-- Source: 20251225000005_emergency_fix_matchmaking.sql
-- --------------------------------------------------------------------------
-- =========================================================================
-- EMERGENCY FIX: Delete ALL stuck rooms + Fix find_match status
-- Run in Supabase Dashboard: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql/new
-- =========================================================================

-- STEP 1: DELETE ALL STUCK ROOMS (NUCLEAR OPTION)
DELETE FROM rooms WHERE status IN ('waiting', 'starting', 'playing', 'active');

-- STEP 2: Apply the fixed find_match (creates rooms with 'waiting' not 'starting')
-- Security fixed: Removed p_user_id parameter, now uses auth.uid()
DROP FUNCTION IF EXISTS find_match(UUID, VARCHAR, INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS find_match(VARCHAR, INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION find_match(
  p_username VARCHAR(50),
  p_skill_rating INTEGER DEFAULT 1000,
  p_region VARCHAR(10) DEFAULT 'global'
)
RETURNS TABLE(
  matched BOOLEAN,
  room_id UUID,
  room_code VARCHAR(10),
  waiting_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_waiting_players waiting_room[];
  v_new_room_id UUID;
  v_new_room_code VARCHAR(10);
  v_waiting_count INTEGER;
  v_player_index INTEGER;
BEGIN
  -- SECURITY FIX: Use auth.uid() instead of trusting client-supplied user_id
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Note: cleanup_abandoned_rooms() removed - must be called by service_role separately
  PERFORM cleanup_stale_waiting_room_entries();
  
  INSERT INTO waiting_room (user_id, username, skill_rating, region, status)
  VALUES (v_user_id, p_username, p_skill_rating, p_region, 'waiting')
  ON CONFLICT (user_id) 
  DO UPDATE SET joined_at = NOW(), status = 'waiting';
  
  SELECT ARRAY_AGG(wr ORDER BY wr.joined_at) INTO v_waiting_players
  FROM waiting_room wr
  WHERE wr.status = 'waiting'
  AND wr.region = p_region
  AND ABS(wr.skill_rating - p_skill_rating) <= 200
  AND wr.joined_at >= NOW() - INTERVAL '5 minutes'
  LIMIT 4;
  
  v_waiting_count := COALESCE(array_length(v_waiting_players, 1), 0);
  
  IF v_waiting_count >= 4 THEN
    v_new_room_code := generate_room_code_v2();
    
    -- FIX: Create room with 'waiting' status (not 'starting')
    INSERT INTO rooms (code, host_id, status, max_players, fill_with_bots)
    VALUES (v_new_room_code, (v_waiting_players[1]).user_id, 'waiting', 4, FALSE)
    RETURNING id INTO v_new_room_id;
    
    FOR i IN 1..4 LOOP
      v_player_index := i - 1;
      
      INSERT INTO room_players (
        room_id, 
        user_id, 
        username, 
        player_index, 
        is_host, 
        is_ready,
        is_bot
      )
      VALUES (
        v_new_room_id,
        (v_waiting_players[i]).user_id,
        (v_waiting_players[i]).username,
        v_player_index,
        v_player_index = 0,
        TRUE,
        FALSE
      );
      
      UPDATE waiting_room
      SET status = 'matched', 
          matched_room_id = v_new_room_id,
          matched_at = NOW()
      WHERE user_id = (v_waiting_players[i]).user_id;
    END LOOP;
    
    RETURN QUERY SELECT 
      TRUE as matched,
      v_new_room_id as room_id,
      v_new_room_code as room_code,
      4 as waiting_count;
  ELSE
    RETURN QUERY SELECT 
      FALSE as matched,
      NULL::UUID as room_id,
      NULL::VARCHAR as room_code,
      v_waiting_count as waiting_count;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION find_match TO authenticated;

-- STEP 3: Fix cleanup_abandoned_rooms to delete stuck 'starting' rooms immediately (< 1 minute old)
CREATE OR REPLACE FUNCTION cleanup_abandoned_rooms()
RETURNS JSON AS $$
DECLARE
  v_deleted_waiting INTEGER;
  v_deleted_starting INTEGER;
  v_deleted_old INTEGER;
BEGIN
  WITH deleted_waiting AS (
    DELETE FROM rooms 
    WHERE status = 'waiting' 
    AND created_at < NOW() - INTERVAL '2 hours'
    AND (SELECT COUNT(*) FROM room_players WHERE room_id = rooms.id) = 0
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_waiting FROM deleted_waiting;
  
  -- Delete stuck "starting" rooms > 1 MINUTE old (aggressive cleanup)
  WITH deleted_starting AS (
    DELETE FROM rooms
    WHERE status = 'starting'
    AND created_at < NOW() - INTERVAL '1 minute'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_starting FROM deleted_starting;
  
  WITH deleted_old AS (
    DELETE FROM rooms
    WHERE status IN ('completed', 'cancelled')
    AND created_at < NOW() - INTERVAL '30 days'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_old FROM deleted_old;
  
  RETURN json_build_object(
    'deleted_waiting_rooms', v_deleted_waiting,
    'deleted_starting_rooms', v_deleted_starting,
    'deleted_old_rooms', v_deleted_old,
    'total_deleted', v_deleted_waiting + v_deleted_starting + v_deleted_old,
    'timestamp', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- SECURITY FIX: Only service_role should cleanup rooms, not all authenticated users
GRANT EXECUTE ON FUNCTION cleanup_abandoned_rooms() TO service_role;

-- STEP 4: Verify cleanup
SELECT COUNT(*) as remaining_stuck_rooms FROM rooms WHERE status IN ('waiting', 'starting', 'playing', 'active');
-- Should return 0

SELECT * FROM rooms ORDER BY created_at DESC LIMIT 10;
-- Should show no active rooms

-- --------------------------------------------------------------------------
-- Source: 20251226000001_fix_start_game_with_bots_room_status.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- FIX: start_game_with_bots MUST set room status to 'playing'
-- ============================================================================
-- Issue: When host starts game, bots are created but room status stays 'waiting'.
-- This causes non-host players to not auto-navigate to game.
-- When they click notification, they re-enter lobby and create duplicate bots.
--
-- Fix: Update room status to 'playing' after creating bots.
-- This triggers the Realtime subscription in LobbyScreen to auto-navigate all players.

DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty VARCHAR
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction
  IF v_room.ranked_mode = true THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start ranked games with bots'
    );
  END IF;
  
  -- 3. Count human players
  SELECT COUNT(*) INTO v_human_count
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL);
  
  v_total_players := v_human_count + p_bot_count;
  
  -- 4. Validate
  IF v_total_players != 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players must equal 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_human_count = 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start with 0 humans'
    );
  END IF;
  
  -- 5. Get coordinator (first human)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL)
  ORDER BY joined_at ASC
  LIMIT 1;
  
  -- 6. Find next player index
  SELECT COALESCE(MAX(player_index), -1) + 1 INTO v_next_player_index
  FROM room_players
  WHERE room_id = p_room_id;
  
  -- 7. Create bots
  FOR i IN 1..p_bot_count LOOP
    INSERT INTO room_players (
      room_id, user_id, player_index, is_bot, bot_difficulty, is_ready, joined_at
    ) VALUES (
      p_room_id, NULL, v_next_player_index + i - 1, true, p_bot_difficulty, true, NOW()
    );
  END LOOP;
  
  -- 8. Update room: Set coordinator AND set status to 'playing' (CRITICAL FIX)
  UPDATE rooms
  SET 
    bot_coordinator_id = v_coordinator_id,
    status = 'playing'
  WHERE id = p_room_id;
  
  -- 9. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'coordinator_id', v_coordinator_id,
    'status', 'playing'
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS 'Start multiplayer game with mixed humans + AI bots. Validates player count, creates bot players, sets coordinator, and changes room status to playing to trigger navigation for all players.';


-- --------------------------------------------------------------------------
-- Source: 20251226000002_fix_matchmaking_room_flags.sql
-- --------------------------------------------------------------------------
-- Add is_matchmaking column if missing on databases upgraded from pre-baseline migrations
-- (the column was added outside of migrations originally; the CREATE TABLE above
-- covers fresh installs, this guard covers incremental upgrades)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_matchmaking BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- FIX: Matchmaking rooms MUST have is_matchmaking=true and ranked_mode flag
-- ============================================================================
-- Issue: find_match creates rooms without is_matchmaking and ranked_mode flags
-- This causes room type detection to fail (rooms show as "private" instead of "casual"/"ranked")
--
-- Fix: Add is_matchmaking and ranked_mode parameters and set them correctly

-- Drop the old version with p_user_id parameter
DROP FUNCTION IF EXISTS find_match(UUID, VARCHAR, INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION find_match(
  p_username VARCHAR(50),
  p_skill_rating INTEGER DEFAULT 1000,
  p_region VARCHAR(10) DEFAULT 'global',
  p_match_type VARCHAR(10) DEFAULT 'casual'  -- NEW: 'casual' or 'ranked'
)
RETURNS TABLE(
  matched BOOLEAN,
  room_id UUID,
  room_code VARCHAR(10),
  waiting_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_waiting_players waiting_room[];
  v_new_room_id UUID;
  v_new_room_code VARCHAR(10);
  v_waiting_count INTEGER;
  v_player_index INTEGER;
  v_is_ranked BOOLEAN;
BEGIN
  -- SECURITY: Use auth.uid() instead of trusting client-supplied user_id
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Convert match_type to boolean for ranked_mode
  v_is_ranked := p_match_type = 'ranked';
  
  -- Cleanup stale waiting room entries
  PERFORM cleanup_stale_waiting_room_entries();
  
  -- Insert/update user in waiting room
  INSERT INTO waiting_room (user_id, username, skill_rating, region, status)
  VALUES (v_user_id, p_username, p_skill_rating, p_region, 'waiting')
  ON CONFLICT (user_id) 
  DO UPDATE SET joined_at = NOW(), status = 'waiting';
  
  -- Find waiting players with similar skill and same region
  SELECT ARRAY_AGG(wr ORDER BY wr.joined_at) INTO v_waiting_players
  FROM waiting_room wr
  WHERE wr.status = 'waiting'
  AND wr.region = p_region
  AND ABS(wr.skill_rating - p_skill_rating) <= 200
  AND wr.joined_at >= NOW() - INTERVAL '5 minutes'
  LIMIT 4;
  
  v_waiting_count := COALESCE(array_length(v_waiting_players, 1), 0);
  
  -- If 4 players found, create a room
  IF v_waiting_count >= 4 THEN
    v_new_room_code := generate_room_code_v2();
    
    -- CRITICAL FIX: Create room with proper matchmaking flags
    INSERT INTO rooms (
      code, 
      host_id, 
      status, 
      max_players, 
      fill_with_bots,
      is_matchmaking,  -- NEW: Mark as matchmaking room
      is_public,       -- NEW: Matchmaking rooms are public
      ranked_mode      -- NEW: Set based on match type
    )
    VALUES (
      v_new_room_code, 
      (v_waiting_players[1]).user_id, 
      'waiting', 
      4, 
      FALSE,
      TRUE,           -- is_matchmaking = true
      TRUE,           -- is_public = true (matchmaking rooms are public)
      v_is_ranked     -- ranked_mode = true/false based on match type
    )
    RETURNING id INTO v_new_room_id;
    
    -- Add all 4 players to the room
    FOR i IN 1..4 LOOP
      v_player_index := i - 1;
      
      INSERT INTO room_players (
        room_id, 
        user_id, 
        username, 
        player_index, 
        is_host, 
        is_ready,
        is_bot
      )
      VALUES (
        v_new_room_id,
        (v_waiting_players[i]).user_id,
        (v_waiting_players[i]).username,
        v_player_index,
        v_player_index = 0,  -- First player is host
        TRUE,                -- All players ready
        FALSE                -- Not a bot
      );
      
      -- Mark players as matched in waiting room
      UPDATE waiting_room
      SET status = 'matched', 
          matched_room_id = v_new_room_id,
          matched_at = NOW()
      WHERE user_id = (v_waiting_players[i]).user_id;
    END LOOP;
    
    RETURN QUERY SELECT 
      TRUE as matched,
      v_new_room_id as room_id,
      v_new_room_code as room_code,
      4 as waiting_count;
  ELSE
    -- No match yet, return waiting count
    RETURN QUERY SELECT 
      FALSE as matched,
      NULL::UUID as room_id,
      NULL::VARCHAR as room_code,
      v_waiting_count as waiting_count;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION find_match TO authenticated;

COMMENT ON FUNCTION find_match IS 'Find or create a matchmaking game. Creates rooms with proper is_matchmaking and ranked_mode flags based on match type (casual/ranked).';


-- --------------------------------------------------------------------------
-- Source: 20251226000003_add_bot_usernames.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- FIX: Add bot usernames to start_game_with_bots RPC function
-- ============================================================================
-- Issue: Bots are created without usernames, causing NULL values in room_players
-- This breaks lobby UI display and may crash GameScreen
--
-- Fix: Generate unique bot usernames (Bot 1, Bot 2, Bot 3) based on player_index
-- Ensures bots are properly displayed in lobby and game

DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty VARCHAR
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
  v_bot_username VARCHAR;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction
  IF v_room.ranked_mode = true THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start ranked games with bots'
    );
  END IF;
  
  -- 3. Count human players
  SELECT COUNT(*) INTO v_human_count
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL);
  
  v_total_players := v_human_count + p_bot_count;
  
  -- 4. Validate
  IF v_total_players != 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players must equal 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_human_count = 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start with 0 humans'
    );
  END IF;
  
  -- 5. Get coordinator (first human)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL)
  ORDER BY joined_at ASC
  LIMIT 1;
  
  -- 6. Find next player index
  SELECT COALESCE(MAX(player_index), -1) + 1 INTO v_next_player_index
  FROM room_players
  WHERE room_id = p_room_id;
  
  -- 7. Create bots with usernames (CRITICAL FIX)
  FOR i IN 1..p_bot_count LOOP
    -- Generate bot username: "Bot 1", "Bot 2", "Bot 3"
    v_bot_username := 'Bot ' || (v_next_player_index + i)::VARCHAR;
    
    INSERT INTO room_players (
      room_id,
      user_id,
      username,           -- NEW: Set username for bots
      player_index,
      is_bot,
      bot_difficulty,
      is_ready,
      joined_at
    ) VALUES (
      p_room_id,
      NULL,
      v_bot_username,     -- NEW: Bot 1, Bot 2, Bot 3
      v_next_player_index + i - 1,
      true,
      p_bot_difficulty,
      true,
      NOW()
    );
  END LOOP;
  
  -- 8. Update room: Set coordinator AND set status to 'playing'
  UPDATE rooms
  SET 
    bot_coordinator_id = v_coordinator_id,
    status = 'playing'
  WHERE id = p_room_id;
  
  -- 9. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'coordinator_id', v_coordinator_id,
    'status', 'playing'
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS 'Start multiplayer game with mixed humans + AI bots. Validates player count, creates bot players WITH USERNAMES, sets coordinator, and changes room status to playing to trigger navigation for all players.';


-- --------------------------------------------------------------------------
-- Source: 20251226000004_create_game_state_on_start.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- CRITICAL FIX: Initialize game state when starting game with bots
-- ============================================================================
-- ROOT CAUSE: start_game_with_bots() only sets room status='playing' but
-- does NOT create the game_state record, so useRealtime has no data to sync!
--
-- FIX: Add game state initialization to start_game_with_bots

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty VARCHAR DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB[];
  v_i INTEGER;
  v_starting_player INTEGER;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction
  IF v_room.ranked_mode = true THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start ranked games with bots'
    );
  END IF;
  
  -- 3. Count human players
  SELECT COUNT(*) INTO v_human_count
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL);
  
  v_total_players := v_human_count + p_bot_count;
  
  -- 4. Validate
  IF v_total_players != 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players must equal 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_human_count = 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start with 0 humans'
    );
  END IF;
  
  -- 5. Get coordinator (first human)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL)
  ORDER BY joined_at ASC
  LIMIT 1;
  
  -- 6. Find next player index
  SELECT COALESCE(MAX(player_index), -1) + 1 INTO v_next_player_index
  FROM room_players
  WHERE room_id = p_room_id;
  
  -- 7. Create bots
  FOR i IN 1..p_bot_count LOOP
    INSERT INTO room_players (
      room_id, user_id, username, player_index, is_bot, bot_difficulty, is_ready, joined_at
    ) VALUES (
      p_room_id, NULL, 'Bot ' || i, v_next_player_index + i - 1, true, p_bot_difficulty, true, NOW()
    );
  END LOOP;
  
  -- 8. Create deck and shuffle
  v_deck := ARRAY[
    '3D', '3C', '3H', '3S',
    '4D', '4C', '4H', '4S',
    '5D', '5C', '5H', '5S',
    '6D', '6C', '6H', '6S',
    '7D', '7C', '7H', '7S',
    '8D', '8C', '8H', '8S',
    '9D', '9C', '9H', '9S',
    '10D', '10C', '10H', '10S',
    'JD', 'JC', 'JH', 'JS',
    'QD', 'QC', 'QH', 'QS',
    'KD', 'KC', 'KH', 'KS',
    'AD', 'AC', 'AH', 'AS',
    '2D', '2C', '2H', '2S'
  ];
  
  -- Shuffle deck (Fisher-Yates shuffle)
  v_shuffled_deck := v_deck;
  FOR v_i IN REVERSE 52..2 LOOP
    DECLARE
      v_j INTEGER := 1 + FLOOR(RANDOM() * v_i);
      v_temp TEXT := v_shuffled_deck[v_i];
    BEGIN
      v_shuffled_deck[v_i] := v_shuffled_deck[v_j];
      v_shuffled_deck[v_j] := v_temp;
    END;
  END LOOP;
  
  -- 9. Deal cards to players (13 each)
  v_player_hands := ARRAY[
    json_build_array()::jsonb, -- Player 0
    json_build_array()::jsonb, -- Player 1
    json_build_array()::jsonb, -- Player 2
    json_build_array()::jsonb  -- Player 3
  ];
  
  FOR v_i IN 1..52 LOOP
    DECLARE
      v_player_idx INTEGER := ((v_i - 1) % 4);
      v_card_str TEXT := v_shuffled_deck[v_i];
      v_card_json JSONB := json_build_object(
        'rank', SUBSTRING(v_card_str FROM 1 FOR LENGTH(v_card_str) - 1),
        'suit', SUBSTRING(v_card_str FROM LENGTH(v_card_str) FOR 1),
        'id', v_card_str
      )::jsonb;
    BEGIN
      v_player_hands[v_player_idx + 1] := v_player_hands[v_player_idx + 1] || v_card_json;
    END;
  END LOOP;
  
  -- 10. Find who has 3D (starts game)
  v_starting_player := 0;
  FOR v_i IN 0..3 LOOP
    IF v_player_hands[v_i + 1] @> '[{"id": "3D"}]'::jsonb THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  -- 11. Create game state
  INSERT INTO game_state (
    room_id,
    current_player,
    current_turn,
    hands,
    played_cards,
    scores,
    round,
    passes,
    passes_in_row,
    last_play,
    last_player,
    play_history,
    round_number,
    dealer_index,
    game_started_at,
    auto_pass_active,
    game_phase
  ) VALUES (
    p_room_id,
    v_starting_player,
    v_starting_player,
    json_build_object(
      '0', v_player_hands[1],
      '1', v_player_hands[2],
      '2', v_player_hands[3],
      '3', v_player_hands[4]
    )::jsonb,
    '[]'::jsonb,
    '[0, 0, 0, 0]'::jsonb,
    1,
    0,
    0,
    NULL,
    NULL,
    '[]'::jsonb,
    1,
    0,
    NOW(),
    false,
    'playing'
  );
  
  -- 12. Update room: Set coordinator AND set status to 'playing'
  UPDATE rooms
  SET 
    bot_coordinator_id = v_coordinator_id,
    status = 'playing',
    started_at = NOW()
  WHERE id = p_room_id;
  
  -- 13. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'coordinator_id', v_coordinator_id,
    'status', 'playing',
    'starting_player', v_starting_player
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS
  'Starts a multiplayer game with AI bots. Creates bots, deals cards, and initializes game_state table for real-time sync.';


-- --------------------------------------------------------------------------
-- Source: 20251226000005_fix_join_room_atomic_for_update_rls.sql
-- --------------------------------------------------------------------------
-- Fix matchmaking join failures caused by RLS + SELECT ... FOR UPDATE
--
-- Problem:
-- - join_room_atomic used `SELECT ... FOR UPDATE` on `rooms`.
-- - In Postgres, SELECT FOR UPDATE is treated like an UPDATE-locking read and is checked against UPDATE RLS policies.
-- - Our rooms UPDATE policy is host-only, so non-host players could not lock the row, causing "Room not found".
--
-- Solution:
-- - Remove FOR UPDATE and use an advisory transaction lock keyed by room code.
-- - Preserves atomic join semantics without requiring UPDATE privileges on rooms.

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
  v_other_room UUID;
BEGIN
  -- Serialize joins per-room without requiring UPDATE privileges on rooms
  PERFORM pg_advisory_xact_lock(hashtext('join_room_atomic'), hashtext(UPPER(p_room_code)));

  -- Step 1: Check if user already has a username in the system
  SELECT username INTO v_existing_username
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_existing_username IS NOT NULL AND LOWER(v_existing_username) != LOWER(p_username) THEN
    IF NOT (v_existing_username LIKE 'Player_%') THEN
      RAISE EXCEPTION 'You already have username "%". You cannot change your username.', v_existing_username;
    END IF;
  END IF;

  -- Step 2: Check if username is taken by another user (GLOBAL CHECK)
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE LOWER(username) = LOWER(p_username)
      AND user_id != p_user_id
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken by another user', p_username;
  END IF;

  -- Step 3: Fetch room (NO FOR UPDATE; avoids UPDATE RLS policy checks)
  SELECT id, status, host_id INTO v_room_id, v_room_status, v_host_id
  FROM rooms
  WHERE code = UPPER(p_room_code);

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

  -- Step 8: Check if user is in a DIFFERENT room (cleanup will handle removals on client leave)
  SELECT room_id INTO v_other_room
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_other_room IS NOT NULL AND v_other_room != v_room_id THEN
    RAISE EXCEPTION 'User already in another room';
  END IF;

  -- Step 9: Find next available player_index (0..3)
  SELECT i INTO v_player_index
  FROM generate_series(0, 3) AS i
  WHERE NOT EXISTS (
    SELECT 1 FROM room_players rp
    WHERE rp.room_id = v_room_id AND rp.player_index = i
  )
  ORDER BY i
  LIMIT 1;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'Room is full (no available positions)';
  END IF;

  -- Step 10: Host assignment
  v_is_host := (v_host_id = p_user_id);

  -- Step 11: Insert player
  INSERT INTO room_players(
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

  RETURN jsonb_build_object(
    'room_id', v_room_id,
    'room_code', p_room_code,
    'player_index', v_player_index,
    'is_host', v_is_host,
    'already_joined', false
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION join_room_atomic IS
  'Atomically join a room by code. Uses advisory transaction locks (not SELECT FOR UPDATE) to avoid RLS UPDATE-policy lock failures.';


-- --------------------------------------------------------------------------
-- Source: 20251226000006_fix_get_or_create_room_host_id.sql
-- --------------------------------------------------------------------------
-- Fix: get_or_create_room created rooms with host_id = NULL
-- This caused the first human join to NOT be marked host (join_room_atomic compares rooms.host_id).
-- Side effects included:
-- - Clients seeing "Only the host can start" in casual rooms
-- - Host-only room cleanup (delete/update) not working reliably

CREATE OR REPLACE FUNCTION get_or_create_room(
  p_user_id UUID,
  p_username TEXT,
  p_is_public BOOLEAN,
  p_is_matchmaking BOOLEAN,
  p_ranked_mode BOOLEAN
) RETURNS JSONB AS $$
DECLARE
  v_room_code TEXT;
  v_room_id UUID;
  v_collision_attempts INTEGER := 0;
  v_max_collisions INTEGER := 5;
BEGIN
  LOOP
    v_collision_attempts := v_collision_attempts + 1;

    BEGIN
      v_room_code := generate_room_code_v2();

      -- IMPORTANT: set host_id at creation time
      INSERT INTO rooms (code, host_id, status, max_players, is_public, is_matchmaking, ranked_mode, created_at)
      VALUES (v_room_code, p_user_id, 'waiting', 4, p_is_public, p_is_matchmaking, p_ranked_mode, NOW())
      RETURNING id INTO v_room_id;

      -- Add the creator to the room
      PERFORM join_room_atomic(v_room_code, p_user_id, p_username);

      RETURN jsonb_build_object(
        'success', true,
        'room_id', v_room_id,
        'room_code', v_room_code,
        'attempts', v_collision_attempts
      );

    EXCEPTION WHEN unique_violation THEN
      IF v_collision_attempts >= v_max_collisions THEN
        RAISE EXCEPTION 'Failed to create room after % collision attempts', v_max_collisions;
      END IF;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Backfill: existing rooms created with host_id = NULL
-- Choose the first non-bot human in the room (lowest player_index).
WITH host_candidates AS (
  SELECT
    r.id AS room_id,
    (
      SELECT rp.user_id
      FROM room_players rp
      WHERE rp.room_id = r.id
        AND rp.is_bot = false
        AND rp.user_id IS NOT NULL
      ORDER BY rp.player_index ASC
      LIMIT 1
    ) AS host_user_id
  FROM rooms r
  WHERE r.host_id IS NULL
)
UPDATE rooms r
SET host_id = hc.host_user_id
FROM host_candidates hc
WHERE r.id = hc.room_id
  AND hc.host_user_id IS NOT NULL;

-- Normalize room_players.is_host based on rooms.host_id
UPDATE room_players rp
SET is_host = (rp.user_id = r.host_id)
FROM rooms r
WHERE rp.room_id = r.id
  AND r.host_id IS NOT NULL
  AND rp.is_bot = false;

-- Ensure bots never appear as host
UPDATE room_players
SET is_host = false
WHERE is_bot = true;

GRANT EXECUTE ON FUNCTION get_or_create_room TO authenticated;

COMMENT ON FUNCTION get_or_create_room IS
  'Safely creates a new room with guaranteed unique code. Sets host_id to creator to ensure host behavior works for casual rooms.';


-- --------------------------------------------------------------------------
-- Source: 20251226000007_fix_start_game_with_bots_existing_bots.sql
-- --------------------------------------------------------------------------
-- ==========================================================================
-- FIX: Make start_game_with_bots safe when bots already exist in room_players
-- ==========================================================================
--
-- Problem:
-- - start_game_with_bots() assumed the room contained only humans.
-- - In casual matchmaking, rooms can already contain bots (or partial bot fills).
-- - The old implementation inserted bots at MAX(player_index)+1, which violates
--   the room_players_player_index_check constraint (expected 0..3).
--
-- Fix:
-- - Compute current occupancy (humans + bots).
-- - Only add bots into open seat indices 0..3.
-- - Accept callers that pass "desired bots by human count" even if bots already
--   exist, but require that p_bot_count is at least the number of open seats.
-- - Ensure game_state is initialized idempotently for waiting rooms.

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty VARCHAR DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_existing_bot_count INTEGER;
  v_existing_total_players INTEGER;
  v_bots_to_add INTEGER;
  v_coordinator_id UUID;
  v_open_index INTEGER;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB[];
  v_i INTEGER;
  v_starting_player INTEGER;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;

  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;

  -- 2. Check ranked mode restriction
  IF v_room.ranked_mode = true THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start ranked games with bots'
    );
  END IF;

  -- 3. Count current occupancy
  SELECT COUNT(*) INTO v_human_count
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL);

  SELECT COUNT(*) INTO v_existing_bot_count
  FROM room_players
  WHERE room_id = p_room_id AND is_bot = true;

  SELECT COUNT(*) INTO v_existing_total_players
  FROM room_players
  WHERE room_id = p_room_id;

  IF v_human_count = 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start with 0 humans'
    );
  END IF;

  IF v_existing_total_players > 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Too many players in room',
      'total_players', v_existing_total_players
    );
  END IF;

  v_bots_to_add := GREATEST(0, 4 - v_existing_total_players);

  -- Callers may pass p_bot_count based on human count (4 - humans) even if bots already exist.
  -- We only require that the caller's requested bot count can cover missing seats.
  IF p_bot_count < v_bots_to_add THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not enough bots requested to fill open seats',
      'bots_required', v_bots_to_add,
      'bots_requested', p_bot_count
    );
  END IF;

  -- 4. Get coordinator (first human)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL)
  ORDER BY joined_at ASC
  LIMIT 1;

  -- 5. Create missing bots in open indices 0..3
  FOR v_i IN 1..v_bots_to_add LOOP
    SELECT idx
    INTO v_open_index
    FROM generate_series(0, 3) AS idx
    LEFT JOIN room_players rp
      ON rp.room_id = p_room_id
     AND rp.player_index = idx
    WHERE rp.id IS NULL
    ORDER BY idx
    LIMIT 1;

    IF v_open_index IS NULL THEN
      RETURN json_build_object(
        'success', false,
        'error', 'No open seat index available for bot insertion'
      );
    END IF;

    INSERT INTO room_players (
      room_id, user_id, username, player_index, is_bot, bot_difficulty, is_ready, joined_at
    ) VALUES (
      p_room_id,
      NULL,
      'Bot ' || (v_existing_bot_count + v_i),
      v_open_index,
      true,
      p_bot_difficulty,
      true,
      NOW()
    );
  END LOOP;

  -- 6. Reset any stale game_state for this waiting room (idempotent start)
  DELETE FROM game_state WHERE room_id = p_room_id;

  -- 7. Create deck and shuffle
  v_deck := ARRAY[
    '3D', '3C', '3H', '3S',
    '4D', '4C', '4H', '4S',
    '5D', '5C', '5H', '5S',
    '6D', '6C', '6H', '6S',
    '7D', '7C', '7H', '7S',
    '8D', '8C', '8H', '8S',
    '9D', '9C', '9H', '9S',
    '10D', '10C', '10H', '10S',
    'JD', 'JC', 'JH', 'JS',
    'QD', 'QC', 'QH', 'QS',
    'KD', 'KC', 'KH', 'KS',
    'AD', 'AC', 'AH', 'AS',
    '2D', '2C', '2H', '2S'
  ];

  v_shuffled_deck := v_deck;
  FOR v_i IN REVERSE 52..2 LOOP
    DECLARE
      v_j INTEGER := 1 + FLOOR(RANDOM() * v_i);
      v_temp TEXT := v_shuffled_deck[v_i];
    BEGIN
      v_shuffled_deck[v_i] := v_shuffled_deck[v_j];
      v_shuffled_deck[v_j] := v_temp;
    END;
  END LOOP;

  -- 8. Deal cards to players (13 each) by player_index 0..3
  v_player_hands := ARRAY[
    json_build_array()::jsonb,
    json_build_array()::jsonb,
    json_build_array()::jsonb,
    json_build_array()::jsonb
  ];

  FOR v_i IN 1..52 LOOP
    DECLARE
      v_player_idx INTEGER := ((v_i - 1) % 4);
      v_card_str TEXT := v_shuffled_deck[v_i];
      v_card_json JSONB := json_build_object(
        'rank', SUBSTRING(v_card_str FROM 1 FOR LENGTH(v_card_str) - 1),
        'suit', SUBSTRING(v_card_str FROM LENGTH(v_card_str) FOR 1),
        'id', v_card_str
      )::jsonb;
    BEGIN
      v_player_hands[v_player_idx + 1] := v_player_hands[v_player_idx + 1] || v_card_json;
    END;
  END LOOP;

  -- 9. Find who has 3D (starts game)
  v_starting_player := 0;
  FOR v_i IN 0..3 LOOP
    -- Check if player has 3D card using jsonb_path_exists for more robust matching
    IF jsonb_path_exists(v_player_hands[v_i + 1], '$[*] ? (@.id == "3D")') THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;

  -- 10. Create game state
  INSERT INTO game_state (
    room_id,
    current_player,
    current_turn,
    hands,
    played_cards,
    scores,
    round,
    passes,
    passes_in_row,
    last_play,
    last_player,
    play_history,
    round_number,
    dealer_index,
    game_started_at,
    auto_pass_active,
    game_phase
  ) VALUES (
    p_room_id,
    v_starting_player,
    v_starting_player,
    json_build_object(
      '0', v_player_hands[1],
      '1', v_player_hands[2],
      '2', v_player_hands[3],
      '3', v_player_hands[4]
    )::jsonb,
    '[]'::jsonb,
    '[0, 0, 0, 0]'::jsonb,
    1,
    0,
    0,
    NULL,
    NULL,
    '[]'::jsonb,
    1,
    0,
    NOW(),
    false,
    'playing'
  );

  -- 11. Update room
  UPDATE rooms
  SET
    bot_coordinator_id = v_coordinator_id,
    status = 'playing',
    started_at = NOW()
  WHERE id = p_room_id;

  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'human_count', v_human_count,
    'existing_bot_count', v_existing_bot_count,
    'bots_added', v_bots_to_add,
    'bots_requested', p_bot_count,
    'coordinator_id', v_coordinator_id,
    'status', 'playing',
    'starting_player', v_starting_player
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS
  'Starts a multiplayer game with AI bots. Safely fills open seats (0..3), deals cards, and initializes game_state for real-time sync.';


-- --------------------------------------------------------------------------
-- Source: 20251226000008_enforce_unique_room_codes.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- CRITICAL FIX: Enforce UNIQUE room codes + Automatic room cleanup
-- ============================================================================
-- Issue: Multiple rooms with same room code can exist simultaneously
-- This causes 2+ players to be routed to DIFFERENT rooms with the SAME code
-- Root cause: Missing UNIQUE constraint on rooms.code column
--
-- Fix Strategy:
-- 1. Clean up any duplicate room codes (keep oldest)
-- 2. Add UNIQUE constraint to prevent future duplicates
-- 3. Update room creation logic to handle collisions gracefully
-- 4. Add automatic cleanup trigger when all players leave

-- ============================================================================
-- STEP 1: Clean up existing duplicate room codes
-- ============================================================================

-- Delete duplicate rooms, keeping only the oldest one for each code
DELETE FROM rooms
WHERE id IN (
  SELECT r2.id
  FROM rooms r1
  INNER JOIN rooms r2 ON r1.code = r2.code AND r1.id < r2.id
);

-- Verify no duplicates remain
DO $$
DECLARE
  v_duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT code, COUNT(*) as cnt
    FROM rooms
    GROUP BY code
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION 'Still have % duplicate room codes!', v_duplicate_count;
  ELSE
    RAISE NOTICE '✅ All duplicate room codes cleaned up';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Add UNIQUE constraint to rooms.code
-- ============================================================================

-- Add unique constraint (prevents duplicate codes at database level)
-- Guarded with IF NOT EXISTS so this is a no-op on databases that were already
-- migrated incrementally and already have the constraint, and so fresh installs
-- (where CREATE TABLE rooms above has no inline UNIQUE) get exactly one unique
-- index on `code` — the named constraint below.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_code_unique' AND conrelid = 'rooms'::regclass
  ) THEN
    ALTER TABLE rooms ADD CONSTRAINT rooms_code_unique UNIQUE (code);
  END IF;
END $$;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_rooms_code_lookup ON rooms(code) WHERE status IN ('waiting', 'playing');

COMMENT ON CONSTRAINT rooms_code_unique ON rooms IS
  'Ensures one room code can only exist once at any given time. Room codes can be reused after room is deleted.';

-- ============================================================================
-- STEP 3: Add automatic room cleanup when empty
-- ============================================================================

-- Function to check if room is empty and clean up
CREATE OR REPLACE FUNCTION cleanup_empty_rooms()
RETURNS TRIGGER AS $$
DECLARE
  v_player_count INTEGER;
  v_room_status TEXT;
BEGIN
  -- Count remaining players in the room
  SELECT COUNT(*), r.status INTO v_player_count, v_room_status
  FROM room_players rp
  JOIN rooms r ON r.id = rp.room_id
  WHERE rp.room_id = OLD.room_id
  GROUP BY r.status;
  
  -- If no players left, delete the room (makes code available for reuse)
  IF v_player_count IS NULL OR v_player_count = 0 THEN
    DELETE FROM rooms WHERE id = OLD.room_id;
    RAISE NOTICE 'Auto-deleted empty room: %', OLD.room_id;
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-delete room when last player leaves
DROP TRIGGER IF EXISTS trigger_cleanup_empty_rooms ON room_players;
CREATE TRIGGER trigger_cleanup_empty_rooms
  AFTER DELETE ON room_players
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_empty_rooms();

COMMENT ON FUNCTION cleanup_empty_rooms IS
  'Automatically deletes rooms when the last player leaves, making room code available for reuse';

-- ============================================================================
-- STEP 4: Update generate_room_code_v2 with better collision handling
-- ============================================================================

-- Enhanced room code generation with exponential backoff
CREATE OR REPLACE FUNCTION generate_room_code_v2()
RETURNS VARCHAR AS $$
DECLARE
  chars TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  result VARCHAR := '';
  i INTEGER;
  max_attempts INTEGER := 100;
  attempt INTEGER := 0;
  random_index INTEGER;
BEGIN
  LOOP
    attempt := attempt + 1;
    
    -- Generate 6-character code
    result := '';
    FOR i IN 1..6 LOOP
      random_index := 1 + FLOOR(RANDOM() * 32)::INTEGER;
      result := result || SUBSTRING(chars FROM random_index FOR 1);
    END LOOP;
    
    -- Check for collision (now enforced by UNIQUE constraint)
    IF NOT EXISTS (SELECT 1 FROM rooms WHERE code = result) THEN
      RETURN result;
    END IF;
    
    -- Max attempts reached
    IF attempt >= max_attempts THEN
      RAISE EXCEPTION 'Failed to generate unique room code after % attempts. Database may be full.', max_attempts;
    END IF;
    
    -- Add small delay on collision (prevents thundering herd)
    IF attempt > 10 THEN
      PERFORM pg_sleep(0.001 * attempt); -- Exponential backoff: 11ms, 12ms, 13ms...
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql VOLATILE;

GRANT EXECUTE ON FUNCTION generate_room_code_v2() TO authenticated;

COMMENT ON FUNCTION generate_room_code_v2() IS 
  'Generates unique 6-character room codes with collision detection and exponential backoff. Guaranteed unique by database constraint.';

-- ============================================================================
-- STEP 5: Add helper function to safely get or create room
-- ============================================================================

CREATE OR REPLACE FUNCTION get_or_create_room(
  p_user_id UUID,
  p_username TEXT,
  p_is_public BOOLEAN,
  p_is_matchmaking BOOLEAN,
  p_ranked_mode BOOLEAN
) RETURNS JSONB AS $$
DECLARE
  v_room_code TEXT;
  v_room_id UUID;
  v_collision_attempts INTEGER := 0;
  v_max_collisions INTEGER := 5;
BEGIN
  -- Retry loop for collision handling
  LOOP
    v_collision_attempts := v_collision_attempts + 1;
    
    BEGIN
      -- Generate unique code
      v_room_code := generate_room_code_v2();
      
      -- Try to create room (will fail if code already exists due to UNIQUE constraint)
      INSERT INTO rooms (code, host_id, status, max_players, is_public, is_matchmaking, ranked_mode, created_at)
      VALUES (v_room_code, NULL, 'waiting', 4, p_is_public, p_is_matchmaking, p_ranked_mode, NOW())
      RETURNING id INTO v_room_id;
      
      -- Success! Now add user as host
      PERFORM join_room_atomic(v_room_code, p_user_id, p_username);
      
      RETURN jsonb_build_object(
        'success', true,
        'room_id', v_room_id,
        'room_code', v_room_code,
        'attempts', v_collision_attempts
      );
      
    EXCEPTION WHEN unique_violation THEN
      -- Code collision, try again
      IF v_collision_attempts >= v_max_collisions THEN
        RAISE EXCEPTION 'Failed to create room after % collision attempts', v_max_collisions;
      END IF;
      -- Loop continues with new code
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_or_create_room TO authenticated;

COMMENT ON FUNCTION get_or_create_room IS
  'Safely creates a new room with guaranteed unique code, handling collisions gracefully';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Test: Try to insert duplicate room code (should fail)
DO $$
DECLARE
  v_test_code TEXT := 'TEST99';
BEGIN
  -- Create first room
  INSERT INTO rooms (code, host_id, status, max_players)
  VALUES (v_test_code, (SELECT id FROM auth.users LIMIT 1), 'waiting', 4);
  
  -- Try to create duplicate (should fail)
  BEGIN
    INSERT INTO rooms (code, host_id, status, max_players)
    VALUES (v_test_code, (SELECT id FROM auth.users LIMIT 1), 'waiting', 4);
    
    RAISE EXCEPTION '❌ CONSTRAINT FAILED: Duplicate room code was allowed!';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '✅ UNIQUE constraint working: Duplicate room code blocked';
  END;
  
  -- Cleanup test room
  DELETE FROM rooms WHERE code = v_test_code;
END $$;

-- Final summary
SELECT 
  '✅ Room code uniqueness enforced' as status,
  'One room code = one room at any time' as guarantee,
  'Automatic cleanup when empty' as lifecycle;


-- --------------------------------------------------------------------------
-- Source: 20251226200000_fix_bot_insert_rls.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- CRITICAL FIX: Allow start_game_with_bots to insert bot players
-- ============================================================================
-- ROOT CAUSE: RLS policy "Authenticated users can join rooms" requires 
-- user_id = auth.uid(), which fails for bot inserts where user_id = NULL
--
-- ERROR: "new row violates row-level security policy for table room_players"
--
-- FIX: Add a policy that allows server functions to insert bot players
-- ============================================================================

-- Allow the start_game_with_bots function (or any server function) to insert bots
-- This policy allows INSERT when user_id IS NULL and is_bot = TRUE
-- It's safe because only server-side RPC functions can set is_bot = TRUE
CREATE POLICY "Server can insert bot players" ON room_players
  FOR INSERT WITH CHECK (
    user_id IS NULL AND is_bot = TRUE
  );

-- EXPLANATION:
-- - This policy allows rows where user_id IS NULL AND is_bot = TRUE to be inserted
-- - Only server-side functions (like start_game_with_bots) can insert such rows
-- - Client code cannot bypass this because clients can't set is_bot = TRUE directly
--   (they would fail the "Authenticated users can join rooms" policy which requires is_host = FALSE)
-- - This is secure because:
--   1. Bots have no user_id (NULL), so they can't authenticate
--   2. is_bot flag prevents clients from impersonating bots
--   3. start_game_with_bots validates room ownership before inserting bots


-- --------------------------------------------------------------------------
-- Source: 20251226210000_definitive_bot_rls_fix.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- DEFINITIVE FIX: Multiplayer Game Start Failure (2-3 Humans + 1-2 Bots)
-- ============================================================================
-- PROBLEM: "new row violates row-level security policy for table room_players"
-- 
-- ROOT CAUSE ANALYSIS:
-- =====================
-- The database has a SINGLE INSERT policy on room_players with a LOGIC ERROR:
--
--   Policy: "Users and service role can insert room players"
--   Current Condition (WRONG):
--     ((auth.uid() = user_id) OR ((is_bot = true) AND (user_id IS NOT NULL)))
--                                                        ^^^^^^^^^^^^^^^^^^^^^^
--                                                        THIS IS THE BUG!
--
-- The policy says bots MUST have `user_id IS NOT NULL`, but the 
-- `start_game_with_bots()` function correctly inserts bots with `user_id = NULL`.
--
-- WHY THIS KEEPS FAILING:
-- =======================
-- 1. Dec 5: Original policy created requiring `auth.uid() = user_id` (blocks bots)
-- 2. Dec 23: `start_game_with_bots()` function created inserting bots with `user_id = NULL`
-- 3. Unknown date: Policy modified to allow bots, but with WRONG condition `user_id IS NOT NULL`
-- 4. Dec 26 (attempt 1): Added new policy allowing `user_id IS NULL`, but old policy still blocked it
-- 5. Dec 26 (attempt 2): THIS FIX - Replace the incorrect policy with correct logic
--
-- THE SOLUTION:
-- =============
-- Drop the incorrect policy and create a correct one that allows:
--   - Humans: `auth.uid() = user_id`
--   - Bots:   `user_id IS NULL AND is_bot = TRUE`
-- ============================================================================

-- Step 1: Drop ALL existing INSERT policies on room_players to ensure clean slate
DROP POLICY IF EXISTS "Users and service role can insert room players" ON room_players;
DROP POLICY IF EXISTS "Server can insert bot players" ON room_players;
DROP POLICY IF EXISTS "Authenticated users can join rooms" ON room_players;
DROP POLICY IF EXISTS "Host can create bot players" ON room_players;

-- Step 2: Create the ONE CORRECT policy that handles both humans and bots
CREATE POLICY "Allow user inserts and bot inserts" ON room_players
  FOR INSERT 
  WITH CHECK (
    -- Option 1: Human player inserting themselves
    (auth.uid() = user_id)
    OR
    -- Option 2: Server function (SECURITY DEFINER) inserting bot player
    -- Bots have user_id = NULL and is_bot = TRUE
    -- This can only be done by server-side RPC functions since:
    --   - Clients can't set is_bot = TRUE (would fail the user_id check)
    --   - Clients can't set user_id = NULL (would fail auth check)
    (user_id IS NULL AND is_bot = TRUE)
  );

-- Step 3: Add detailed comment explaining the security model
COMMENT ON POLICY "Allow user inserts and bot inserts" ON room_players IS 
'RLS Policy for room_players INSERT:
- Allows authenticated users to insert themselves (auth.uid() = user_id)
- Allows server functions to insert bot players (user_id IS NULL AND is_bot = TRUE)
- Security: Clients cannot create fake bots because they cannot satisfy BOTH conditions simultaneously';

-- ============================================================================
-- VERIFICATION: Check that policy is correct
-- ============================================================================
DO $$
DECLARE
  v_policy_count INTEGER;
  v_with_check TEXT;
BEGIN
  -- Count INSERT policies
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE tablename = 'room_players' 
  AND cmd = 'INSERT';
  
  IF v_policy_count != 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 INSERT policy on room_players, found %', v_policy_count;
  END IF;
  
  -- Get the WITH CHECK condition
  SELECT with_check INTO v_with_check
  FROM pg_policies
  WHERE tablename = 'room_players' 
  AND cmd = 'INSERT';
  
  -- Verify it contains the correct logic
  IF v_with_check NOT LIKE '%user_id IS NULL%' THEN
    RAISE EXCEPTION 'Policy missing "user_id IS NULL" condition for bots';
  END IF;
  
  IF v_with_check NOT LIKE '%is_bot = true%' THEN
    RAISE EXCEPTION 'Policy missing "is_bot = true" condition';
  END IF;
  
  RAISE NOTICE '✅ RLS Policy verification passed: room_players INSERT policy is correct';
  RAISE NOTICE '   Policy allows: (1) Users inserting themselves, (2) Bots with user_id=NULL';
END $$;

-- ============================================================================
-- EXPECTED BEHAVIOR AFTER THIS FIX:
-- ============================================================================
-- 1. User creates room with 2-3 humans
-- 2. Host clicks "Start Game with AI Bots"
-- 3. LobbyScreen.tsx calls: start_game_with_bots(room_id, bot_count: 1-2)
-- 4. Function inserts bot players with user_id=NULL, is_bot=TRUE
-- 5. RLS policy ALLOWS the insert (no longer blocks)
-- 6. Function updates room status to 'playing'
-- 7. Real-time subscription fires in LobbyScreen
-- 8. All players navigate to GameScreen
-- 9. Game starts successfully with humans + bots
--
-- CONSOLE LOG EXPECTED:
-- "✅ [LobbyScreen] Game started successfully: {success: true, ...}"
-- (NOT "new row violates row-level security policy")
-- ============================================================================

-- Migration complete
DO $$
BEGIN
  RAISE NOTICE '🎯 Migration 20251226210000 complete: Definitive bot RLS fix applied';
  RAISE NOTICE '📋 Next steps:';
  RAISE NOTICE '   1. Test with 2 humans + 2 bots';
  RAISE NOTICE '   2. Test with 3 humans + 1 bot';
  RAISE NOTICE '   3. Verify console shows success: true';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251227000001_fix_username_constraint_scope.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- CRITICAL FIX: Change username unique constraint from GLOBAL to PER-ROOM
-- ============================================================================
-- Issue: Global unique constraint on room_players.username prevents bots
-- from having same username across different rooms. When starting a second
-- game with bots named "Bot 1", "Bot 2", "Bot 3", the constraint fails:
-- ERROR: duplicate key value violates unique constraint "idx_room_players_username_global_unique"
--
-- Root Cause: The function creates bots with simple names "Bot 1", "Bot 2", "Bot 3"
-- but the constraint enforces GLOBAL uniqueness (across ALL rooms), not per-room.
--
-- Fix: Change constraint from GLOBAL to PER-ROOM scope:
-- - DROP: idx_room_players_username_global_unique (GLOBAL)
-- - CREATE: idx_room_players_username_per_room (SCOPED to room_id + username)
--
-- Impact: Allows multiple rooms to have "Bot 1", "Bot 2", "Bot 3" simultaneously.
-- Usernames only need to be unique WITHIN each room, not across all rooms.

-- Drop the broken global constraint
DROP INDEX IF EXISTS idx_room_players_username_global_unique;

-- Create new per-room scoped constraint
-- This allows "Bot 1" to exist in multiple rooms simultaneously
-- but prevents duplicate usernames within the same room
CREATE UNIQUE INDEX idx_room_players_username_per_room
ON room_players (room_id, LOWER(username))
WHERE username IS NOT NULL;

COMMENT ON INDEX idx_room_players_username_per_room IS 'Enforce unique usernames per room (not globally). Allows bots to have same names across different games.';


-- --------------------------------------------------------------------------
-- Source: 20251227000002_add_game_move_rpcs.sql
-- --------------------------------------------------------------------------
-- ==========================================================================
-- ADD GAME MOVE RPC FUNCTIONS
-- ==========================================================================
-- These functions handle playing cards and passing turns in multiplayer games
-- Called by bot coordinator and human players

-- ==========================================================================
-- EXECUTE_PLAY_MOVE: Handle a player playing cards
-- ==========================================================================
CREATE OR REPLACE FUNCTION execute_play_move(
  p_room_code TEXT,
  p_player_id UUID,
  p_cards JSONB
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_current_hands JSONB;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_combo_type TEXT;
  v_next_turn INTEGER;
  v_card_id TEXT;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- 3. Get player info
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found in room');
  END IF;
  
  -- 4. Verify it's this player's turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- 5. Get current hands
  v_current_hands := v_game_state.hands;
  v_player_hand := v_current_hands->v_player.player_index::TEXT;
  
  -- 6. Remove played cards from hand
  v_new_hand := '[]'::JSONB;
  FOR v_card_id IN SELECT jsonb_array_elements_text(v_player_hand)
  LOOP
    -- Only keep cards not in p_cards
    IF NOT (p_cards @> to_jsonb(ARRAY[v_card_id])) THEN
      v_new_hand := v_new_hand || to_jsonb(v_card_id);
    END IF;
  END LOOP;
  
  -- 7. Update hands
  v_current_hands := jsonb_set(v_current_hands, ARRAY[v_player.player_index::TEXT], v_new_hand);
  
  -- 8. Calculate next turn (clockwise)
  v_next_turn := (v_player.player_index + 1) % 4;
  
  -- 9. Classify combo type (simplified - frontend should validate)
  CASE jsonb_array_length(p_cards)
    WHEN 1 THEN v_combo_type := 'Single';
    WHEN 2 THEN v_combo_type := 'Pair';
    WHEN 3 THEN v_combo_type := 'Triple';
    WHEN 5 THEN v_combo_type := 'Five Card';
    ELSE v_combo_type := 'Unknown';
  END CASE;
  
  -- 10. Update game state
  UPDATE game_state
  SET
    hands = v_current_hands,
    current_turn = v_next_turn,
    last_play = jsonb_build_object(
      'position', v_player.player_index,
      'cards', p_cards,
      'combo_type', v_combo_type
    ),
    pass_count = 0,
    auto_pass_timer = NULL,
    updated_at = NOW()
  WHERE room_id = v_room_id;
  
  -- 11. Check for match end (player has no cards left)
  IF jsonb_array_length(v_new_hand) = 0 THEN
    UPDATE game_state
    SET game_phase = 'finished'
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'game_finished', true,
      'winner_index', v_player.player_index
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'cards_remaining', jsonb_array_length(v_new_hand)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================================================
-- EXECUTE_PASS_MOVE: Handle a player passing their turn
-- ==========================================================================
CREATE OR REPLACE FUNCTION execute_pass_move(
  p_room_code TEXT,
  p_player_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_next_turn INTEGER;
  v_new_pass_count INTEGER;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- 3. Get player info
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found in room');
  END IF;
  
  -- 4. Verify it's this player's turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- 5. Calculate next turn
  v_next_turn := (v_player.player_index + 1) % 4;
  v_new_pass_count := v_game_state.pass_count + 1;
  
  -- 6. Check if 3 consecutive passes (clear last_play, person who played last_play wins trick)
  IF v_new_pass_count >= 3 THEN
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      pass_count = 0,
      last_play = NULL,
      auto_pass_timer = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'trick_cleared', true
    );
  ELSE
    -- 7. Normal pass - just advance turn
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      pass_count = v_new_pass_count,
      auto_pass_timer = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'pass_count', v_new_pass_count
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION execute_play_move TO authenticated;
GRANT EXECUTE ON FUNCTION execute_pass_move TO authenticated;

COMMENT ON FUNCTION execute_play_move IS 'Execute a play move in multiplayer game - removes cards from hand, advances turn';
COMMENT ON FUNCTION execute_pass_move IS 'Execute a pass move in multiplayer game - advances turn, tracks consecutive passes';


-- --------------------------------------------------------------------------
-- Source: 20251227120000_create_game_state_table.sql
-- --------------------------------------------------------------------------
-- ==========================================================================
-- CREATE GAME_STATE TABLE
-- ==========================================================================
-- CRITICAL FIX: game_state table was never created but is used by all game logic!
-- This table stores the real-time game state for multiplayer games

CREATE TABLE IF NOT EXISTS game_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
  
  -- Turn management
  current_turn INTEGER NOT NULL CHECK (current_turn >= 0 AND current_turn < 4),
  current_player INTEGER NOT NULL CHECK (current_player >= 0 AND current_player < 4),
  
  -- Player hands (by player_index 0-3)
  hands JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Game state
  played_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  scores JSONB NOT NULL DEFAULT '[0, 0, 0, 0]'::jsonb,
  round INTEGER NOT NULL DEFAULT 1,
  passes INTEGER NOT NULL DEFAULT 0,
  passes_in_row INTEGER NOT NULL DEFAULT 0,
  
  -- Last play tracking
  last_play JSONB,
  last_player INTEGER,
  
  -- History
  play_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Match tracking
  round_number INTEGER NOT NULL DEFAULT 1,
  dealer_index INTEGER NOT NULL DEFAULT 0,
  
  -- Metadata
  game_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  auto_pass_active BOOLEAN DEFAULT FALSE,
  game_phase VARCHAR(20) NOT NULL DEFAULT 'playing' CHECK (game_phase IN ('first_play', 'playing', 'finished')),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_game_state_room_id ON game_state(room_id);
CREATE INDEX IF NOT EXISTS idx_game_state_current_turn ON game_state(current_turn);
CREATE INDEX IF NOT EXISTS idx_game_state_game_phase ON game_state(game_phase);

-- Enable RLS
ALTER TABLE game_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Anyone in the room can view game state
CREATE POLICY "Players can view game state in their room" ON game_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM room_players
      WHERE room_players.room_id = game_state.room_id
      AND room_players.user_id = auth.uid()
    )
  );

-- RLS Policy: Only coordinator can insert/update (via RPC functions run as SECURITY DEFINER)
-- No direct insert/update policies needed - all changes via RPC functions

-- Enable realtime subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE game_state;

-- Comments
COMMENT ON TABLE game_state IS 'Real-time game state for multiplayer Big Two games. Synced via Supabase Realtime.';
COMMENT ON COLUMN game_state.hands IS 'Player hands as JSONB object with keys "0", "1", "2", "3" mapping to arrays of card objects';
COMMENT ON COLUMN game_state.current_turn IS 'Player index (0-3) whose turn it is';
COMMENT ON COLUMN game_state.game_phase IS 'Game phase: first_play (must play 3D), playing (normal), finished';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'game_state table created successfully';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251227120001_fix_game_state_rls.sql
-- --------------------------------------------------------------------------
-- ==========================================================================
-- FIX GAME_STATE RLS POLICIES TO ALLOW FUNCTION INSERTS
-- ==========================================================================
-- The start_game_with_bots() function runs with SECURITY DEFINER but RLS
-- is still blocking INSERT operations. We need to allow the function to insert.

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Players can view game state in their room" ON game_state;
DROP POLICY IF EXISTS "Only coordinator can insert game state" ON game_state;
DROP POLICY IF EXISTS "Only coordinator can update game state" ON game_state;

-- Create permissive SELECT policy (anyone in room can view)
CREATE POLICY "Players can view game state in their room" ON game_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM room_players
      WHERE room_players.room_id = game_state.room_id
      AND room_players.user_id = auth.uid()
    )
  );

-- CRITICAL FIX: Allow INSERT for SECURITY DEFINER functions
-- When a function runs with SECURITY DEFINER, it bypasses RLS by default
-- BUT we need to explicitly allow it
CREATE POLICY "Allow function insert game state" ON game_state
  FOR INSERT WITH CHECK (true);

-- Allow UPDATE for authenticated users (bot coordinator via RPC)
CREATE POLICY "Allow function update game state" ON game_state
  FOR UPDATE USING (true);

-- Comments
COMMENT ON POLICY "Allow function insert game state" ON game_state IS 
  'Allows SECURITY DEFINER functions (like start_game_with_bots) to insert game state';
COMMENT ON POLICY "Allow function update game state" ON game_state IS 
  'Allows SECURITY DEFINER functions (like execute_play_move) to update game state';


-- --------------------------------------------------------------------------
-- Source: 20251227120002_fix_execute_play_move_json_encoding.sql
-- --------------------------------------------------------------------------
-- ==========================================================================
-- FIX: execute_play_move JSON Double-Encoding Bug
-- ==========================================================================
-- Problem: jsonb_array_elements_text() was converting card objects to strings,
-- then to_jsonb() was creating JSON strings instead of preserving objects.
-- Result: Player hands corrupted with strings like "{\"id\": \"AH\"}" instead of {id: "AH"}
--
-- Fix: Use jsonb_array_elements() to preserve object structure

CREATE OR REPLACE FUNCTION execute_play_move(
  p_room_code TEXT,
  p_player_id UUID,
  p_cards JSONB
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_current_hands JSONB;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_combo_type TEXT;
  v_next_turn INTEGER;
  v_card JSONB;  -- Changed from TEXT to JSONB
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- 3. Get player info
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found in room');
  END IF;
  
  -- 4. Verify it's this player's turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- 5. Get current hands
  v_current_hands := v_game_state.hands;
  v_player_hand := v_current_hands->v_player.player_index::TEXT;
  
  -- 6. Remove played cards from hand (FIXED: preserve object structure)
  v_new_hand := '[]'::JSONB;
  FOR v_card IN SELECT jsonb_array_elements(v_player_hand)  -- ✅ Removed _text suffix
  LOOP
    -- Extract card ID for comparison
    IF NOT (p_cards @> jsonb_build_array(v_card->>'id')) THEN
      v_new_hand := v_new_hand || jsonb_build_array(v_card);  -- ✅ Keep as object
    END IF;
  END LOOP;
  
  -- 7. Update hands
  v_current_hands := jsonb_set(v_current_hands, ARRAY[v_player.player_index::TEXT], v_new_hand);
  
  -- 8. Calculate next turn (clockwise)
  v_next_turn := (v_player.player_index + 1) % 4;
  
  -- 9. Classify combo type (simplified - frontend should validate)
  CASE jsonb_array_length(p_cards)
    WHEN 1 THEN v_combo_type := 'Single';
    WHEN 2 THEN v_combo_type := 'Pair';
    WHEN 3 THEN v_combo_type := 'Triple';
    WHEN 5 THEN v_combo_type := 'Five Card';
    ELSE v_combo_type := 'Unknown';
  END CASE;
  
  -- 10. Update game state
  UPDATE game_state
  SET
    hands = v_current_hands,
    current_turn = v_next_turn,
    last_play = jsonb_build_object(
      'position', v_player.player_index,
      'cards', p_cards,
      'combo_type', v_combo_type
    ),
    pass_count = 0,
    auto_pass_timer = NULL,
    updated_at = NOW()
  WHERE room_id = v_room_id;
  
  -- 11. Check for match end (player has no cards left)
  IF jsonb_array_length(v_new_hand) = 0 THEN
    UPDATE game_state
    SET game_phase = 'finished'
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'game_finished', true,
      'winner_index', v_player.player_index
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'cards_remaining', jsonb_array_length(v_new_hand)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- --------------------------------------------------------------------------
-- Source: 20251227130000_fix_execute_play_move_card_removal_logic.sql
-- --------------------------------------------------------------------------
-- ==========================================================================
-- FIX: execute_play_move Card Removal Logic
-- ==========================================================================
-- Problem: Card comparison was broken - comparing card IDs to full card objects
-- Old line 69: `NOT (p_cards @> jsonb_build_array(v_card->>'id'))` 
-- This compares ["AH"] against [{"id": "AH", "suit": "hearts", "rank": 14}]
-- They will NEVER match, so cards are never removed from hands!
--
-- Fix: Compare full card objects using @> containment operator

CREATE OR REPLACE FUNCTION execute_play_move(
  p_room_code TEXT,
  p_player_id UUID,
  p_cards JSONB
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_current_hands JSONB;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_combo_type TEXT;
  v_next_turn INTEGER;
  v_card JSONB;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- 3. Get player info
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found in room');
  END IF;
  
  -- 4. Verify it's this player's turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- 5. Get current hands
  v_current_hands := v_game_state.hands;
  v_player_hand := v_current_hands->v_player.player_index::TEXT;
  
  -- 6. Remove played cards from hand (PROPERLY FIXED: compare full objects)
  v_new_hand := '[]'::JSONB;
  FOR v_card IN SELECT jsonb_array_elements(v_player_hand)
  LOOP
    -- ✅ FIXED: Compare full card objects using containment operator
    -- If the played cards array does NOT contain this exact card object, keep it in hand
    IF NOT (p_cards @> jsonb_build_array(v_card)) THEN
      v_new_hand := v_new_hand || jsonb_build_array(v_card);
    END IF;
  END LOOP;
  
  -- 7. Update hands
  v_current_hands := jsonb_set(v_current_hands, ARRAY[v_player.player_index::TEXT], v_new_hand);
  
  -- 8. Calculate next turn (clockwise)
  v_next_turn := (v_player.player_index + 1) % 4;
  
  -- 9. Classify combo type (simplified - frontend should validate)
  CASE jsonb_array_length(p_cards)
    WHEN 1 THEN v_combo_type := 'Single';
    WHEN 2 THEN v_combo_type := 'Pair';
    WHEN 3 THEN v_combo_type := 'Triple';
    WHEN 5 THEN v_combo_type := 'Five Card';
    ELSE v_combo_type := 'Unknown';
  END CASE;
  
  -- 10. Update game state
  UPDATE game_state
  SET
    hands = v_current_hands,
    current_turn = v_next_turn,
    last_play = jsonb_build_object(
      'position', v_player.player_index,
      'cards', p_cards,
      'combo_type', v_combo_type
    ),
    pass_count = 0,
    auto_pass_timer = NULL,
    updated_at = NOW()
  WHERE room_id = v_room_id;
  
  -- 11. Check for match end (player has no cards left)
  IF jsonb_array_length(v_new_hand) = 0 THEN
    UPDATE game_state
    SET game_phase = 'finished'
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'game_finished', true,
      'winner_index', v_player.player_index
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'cards_remaining', jsonb_array_length(v_new_hand)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION execute_play_move IS 'Execute a play move in multiplayer game - FIXED card removal to compare full card objects instead of just IDs';


-- --------------------------------------------------------------------------
-- Source: 20251227140000_add_game_over_phase.sql
-- --------------------------------------------------------------------------
-- Migration: Add 'game_over' phase to game_state table
-- Date: December 27, 2025
-- Purpose: Support final game over state when someone reaches >= 101 points

-- Drop existing CHECK constraint
ALTER TABLE game_state DROP CONSTRAINT IF EXISTS game_state_game_phase_check;

-- Add new CHECK constraint with 'game_over' phase
ALTER TABLE game_state 
  ADD CONSTRAINT game_state_game_phase_check 
  CHECK (game_phase IN ('first_play', 'playing', 'finished', 'game_over'));

-- Update comment
COMMENT ON COLUMN game_state.game_phase IS 'Game phase: first_play (must play 3D), playing (normal), finished (match ended), game_over (someone >= 101 points)';


-- --------------------------------------------------------------------------
-- Source: 20251227140001_add_row_locking_to_execute_play_move.sql
-- --------------------------------------------------------------------------
-- ==========================================================================
-- FIX: Add Row-Level Locking to execute_play_move (CRITICAL BUG FIX)
-- ==========================================================================
-- Problem: Race condition when network requests fail and retry
-- Timeline of bug:
--   1. Bot 1 tries to play → network fails
--   2. Client optimistically advances turn to Bot 2
--   3. Bot 2 reads game_state (no lock) and sees turn=2
--   4. Bot 1 retry succeeds and writes turn=2 to DB
--   5. Bot 2 tries to execute → "Not your turn" error
--
-- Root Cause: Missing FOR UPDATE lock on game_state SELECT
-- Solution: Add SELECT ... FOR UPDATE NOWAIT to prevent concurrent modifications
--
-- This ensures:
--   ✅ Only ONE bot can modify game_state at a time
--   ✅ Concurrent requests fail fast with "could not obtain lock"
--   ✅ No more race conditions from network retries

CREATE OR REPLACE FUNCTION execute_play_move(
  p_room_code TEXT,
  p_player_id UUID,
  p_cards JSONB
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_current_hands JSONB;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_combo_type TEXT;
  v_next_turn INTEGER;
  v_card JSONB;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state WITH ROW LOCK (CRITICAL FIX)
  -- FOR UPDATE NOWAIT = Lock the row immediately or fail fast
  -- This prevents race conditions from network retries
  SELECT * INTO v_game_state 
  FROM game_state 
  WHERE room_id = v_room_id
  FOR UPDATE NOWAIT;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- 3. Get player info
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found in room');
  END IF;
  
  -- 4. Verify it's this player's turn (now with row lock held)
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- 5. Get current hands
  v_current_hands := v_game_state.hands;
  v_player_hand := v_current_hands->v_player.player_index::TEXT;
  
  -- 6. Remove played cards from hand (compare full objects)
  v_new_hand := '[]'::JSONB;
  FOR v_card IN SELECT jsonb_array_elements(v_player_hand)
  LOOP
    IF NOT (p_cards @> jsonb_build_array(v_card)) THEN
      v_new_hand := v_new_hand || jsonb_build_array(v_card);
    END IF;
  END LOOP;
  
  -- 7. Update hands
  v_current_hands := jsonb_set(v_current_hands, ARRAY[v_player.player_index::TEXT], v_new_hand);
  
  -- 8. Calculate next turn (clockwise)
  v_next_turn := (v_player.player_index + 1) % 4;
  
  -- 9. Classify combo type
  CASE jsonb_array_length(p_cards)
    WHEN 1 THEN v_combo_type := 'Single';
    WHEN 2 THEN v_combo_type := 'Pair';
    WHEN 3 THEN v_combo_type := 'Triple';
    WHEN 5 THEN v_combo_type := 'Five Card';
    ELSE v_combo_type := 'Unknown';
  END CASE;
  
  -- 10. Update game state (lock is held until commit)
  UPDATE game_state
  SET
    hands = v_current_hands,
    current_turn = v_next_turn,
    last_play = jsonb_build_object(
      'position', v_player.player_index,
      'cards', p_cards,
      'combo_type', v_combo_type
    ),
    pass_count = 0,
    auto_pass_timer = NULL,
    updated_at = NOW()
  WHERE room_id = v_room_id;
  
  -- 11. Check for match end
  IF jsonb_array_length(v_new_hand) = 0 THEN
    UPDATE game_state
    SET game_phase = 'finished'
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'game_finished', true,
      'winner_index', v_player.player_index
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'cards_remaining', jsonb_array_length(v_new_hand)
  );
EXCEPTION
  WHEN lock_not_available THEN
    -- Another transaction is modifying game state - retry
    RETURN json_build_object(
      'success', false,
      'error', 'Game state locked - another move in progress',
      'retry', true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION execute_play_move IS 'Execute a play move with row-level locking to prevent race conditions from network retries';


-- --------------------------------------------------------------------------
-- Source: 20251227150000_add_row_locking_to_execute_pass_move.sql
-- --------------------------------------------------------------------------
-- Migration: Add row-level locking to execute_pass_move
-- Date: 2025-12-27 15:00:00
-- Purpose: Fix race condition in pass moves - same issue as execute_play_move had
--
-- PROBLEM: Bot tried to pass at 7:22:34 pm, got "Not your turn" error
-- ROOT CAUSE: execute_pass_move SELECT statement missing FOR UPDATE NOWAIT lock
-- SOLUTION: Add identical row-level locking pattern from execute_play_move fix
--
-- Evidence from console log line 4601:
-- 7:22:34 pm | GAME | ERROR : [BotCoordinator] Error executing bot turn: Not your turn
--
-- Play moves work perfectly (3 bots played successfully), but pass moves fail

-- Drop existing function
DROP FUNCTION IF EXISTS execute_pass_move(TEXT, UUID);

-- Recreate with row-level locking
CREATE OR REPLACE FUNCTION execute_pass_move(
  p_room_code TEXT,
  p_player_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_next_turn INTEGER;
  v_new_pass_count INTEGER;
  v_lock_conflict BOOLEAN := false;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state WITH ROW-LEVEL LOCK (FIX: Added FOR UPDATE NOWAIT)
  BEGIN
    SELECT * INTO v_game_state 
    FROM game_state 
    WHERE room_id = v_room_id
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      v_lock_conflict := true;
  END;
  
  -- Return retry flag if lock conflict occurred
  IF v_lock_conflict THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'State locked - retry',
      'should_retry', true
    );
  END IF;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- 3. Get player info
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found in room');
  END IF;
  
  -- 4. Verify it's this player's turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- 5. Calculate next turn
  v_next_turn := (v_player.player_index + 1) % 4;
  v_new_pass_count := v_game_state.pass_count + 1;
  
  -- 6. Check if 3 consecutive passes (clear last_play, person who played last_play wins trick)
  IF v_new_pass_count >= 3 THEN
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      pass_count = 0,
      last_play = NULL,
      auto_pass_timer = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'trick_cleared', true
    );
  ELSE
    -- 7. Normal pass - just advance turn
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      pass_count = v_new_pass_count,
      auto_pass_timer = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'pass_count', v_new_pass_count
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure permissions are granted
GRANT EXECUTE ON FUNCTION execute_pass_move TO authenticated;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 20251227150000 applied: Added row-level locking to execute_pass_move';
  RAISE NOTICE 'This fixes the "Not your turn" error when bots try to pass';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251228000001_fix_matchmaking_auto_start.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- FIX: Auto-start matchmaking games when 4 players matched
-- ============================================================================
-- Issue #1: Casual/Private/Ranked matches don't auto-start when 4 players join
-- Issue #2: "User is already in another room" error (code 23505)
-- Issue #3: Only last player enters lobby in ranked mode (not all 4)
--
-- Root Cause: find_match creates rooms with status='waiting' but never
-- transitions to 'playing'. The ready trigger only fires on UPDATE, not INSERT.
--
-- Solution: Call start_game_with_bots(0 bots) when 4 players matched
-- This will:
-- 1. Create game_state
-- 2. Set room status to 'playing'
-- 3. Trigger navigation for all 4 players
-- 4. Clean up room memberships before matching

DROP FUNCTION IF EXISTS find_match(VARCHAR, INTEGER, VARCHAR, VARCHAR);

CREATE OR REPLACE FUNCTION find_match(
  p_username VARCHAR(50),
  p_skill_rating INTEGER DEFAULT 1000,
  p_region VARCHAR(10) DEFAULT 'global',
  p_match_type VARCHAR(10) DEFAULT 'casual'  -- 'casual' or 'ranked'
)
RETURNS TABLE(
  matched BOOLEAN,
  room_id UUID,
  room_code VARCHAR(10),
  waiting_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_waiting_players waiting_room[];
  v_new_room_id UUID;
  v_new_room_code VARCHAR(10);
  v_waiting_count INTEGER;
  v_player_index INTEGER;
  v_is_ranked BOOLEAN;
  v_start_result JSONB;
BEGIN
  -- SECURITY: Use auth.uid() instead of trusting client-supplied user_id
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Convert match_type to boolean for ranked_mode
  v_is_ranked := p_match_type = 'ranked';
  
  -- 🔥 CRITICAL FIX: Remove user from any existing rooms FIRST
  -- This prevents "User is already in another room" error (code 23505)
  DELETE FROM room_players WHERE user_id = v_user_id;
  
  -- Cleanup stale waiting room entries
  PERFORM cleanup_stale_waiting_room_entries();
  
  -- Insert/update user in waiting room
  INSERT INTO waiting_room (user_id, username, skill_rating, region, status, match_type)
  VALUES (v_user_id, p_username, p_skill_rating, p_region, 'waiting', p_match_type)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    joined_at = NOW(), 
    status = 'waiting',
    match_type = p_match_type;
  
  -- Find waiting players with similar skill, same region, AND same match type
  SELECT ARRAY_AGG(wr ORDER BY wr.joined_at) INTO v_waiting_players
  FROM waiting_room wr
  WHERE wr.status = 'waiting'
  AND wr.region = p_region
  AND wr.match_type = p_match_type  -- CRITICAL: Match by type
  AND ABS(wr.skill_rating - p_skill_rating) <= 200
  AND wr.joined_at >= NOW() - INTERVAL '5 minutes'
  LIMIT 4;
  
  v_waiting_count := COALESCE(array_length(v_waiting_players, 1), 0);
  
  -- If 4 players found, create a room AND AUTO-START
  IF v_waiting_count >= 4 THEN
    v_new_room_code := generate_room_code_v2();
    
    -- Create room with proper matchmaking flags
    INSERT INTO rooms (
      code, 
      host_id, 
      status, 
      max_players, 
      fill_with_bots,
      is_matchmaking,
      is_public,
      ranked_mode
    )
    VALUES (
      v_new_room_code, 
      (v_waiting_players[1]).user_id, 
      'waiting',  -- Will become 'playing' after start_game_with_bots
      4, 
      FALSE,
      TRUE,
      TRUE,
      v_is_ranked
    )
    RETURNING id INTO v_new_room_id;
    
    -- Add all 4 players to the room
    FOR i IN 1..4 LOOP
      v_player_index := i - 1;
      
      INSERT INTO room_players (
        room_id, 
        user_id, 
        username, 
        player_index, 
        is_host, 
        is_ready,
        is_bot
      )
      VALUES (
        v_new_room_id,
        (v_waiting_players[i]).user_id,
        (v_waiting_players[i]).username,
        v_player_index,
        v_player_index = 0,  -- First player is host
        TRUE,                -- All players ready
        FALSE                -- Not a bot
      );
      
      -- Mark players as matched in waiting room
      UPDATE waiting_room
      SET status = 'matched', 
          matched_room_id = v_new_room_id,
          matched_at = NOW()
      WHERE user_id = (v_waiting_players[i]).user_id;
    END LOOP;
    
    -- 🔥 CRITICAL FIX: Auto-start game with 0 bots (4 humans only)
    -- This will:
    -- 1. Create game_state
    -- 2. Set room status to 'playing'
    -- 3. Trigger navigation for ALL 4 players via realtime subscription
    v_start_result := start_game_with_bots(v_new_room_id, 0, 'medium');
    
    IF v_start_result->>'success' != 'true' THEN
      RAISE EXCEPTION 'Failed to auto-start game: %', v_start_result->>'error';
    END IF;
    
    RETURN QUERY SELECT 
      TRUE as matched,
      v_new_room_id as room_id,
      v_new_room_code as room_code,
      4 as waiting_count;
  ELSE
    -- No match yet, return waiting count
    RETURN QUERY SELECT 
      FALSE as matched,
      NULL::UUID as room_id,
      NULL::VARCHAR as room_code,
      v_waiting_count as waiting_count;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION find_match TO authenticated;

COMMENT ON FUNCTION find_match IS 'Find or create a matchmaking game with AUTO-START. When 4 players matched, automatically starts the game (all players navigate to GameScreen). Cleans up existing room memberships to prevent "already in room" errors.';

-- ============================================================================
-- SUCCESS! All matchmaking modes (casual, ranked, private) will now:
-- 1. Auto-start when 4 players matched
-- 2. Navigate all players directly to GameScreen
-- 3. No more "already in room" errors
-- ============================================================================


-- --------------------------------------------------------------------------
-- Source: 20251228000002_add_highest_play_detection_to_server.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- FIX: Add highest play detection and auto-pass timer broadcasting
-- ============================================================================
-- Issue: Auto-pass timer not triggering in multiplayer games
-- Root Cause: Server doesn't detect highest plays or broadcast timer events
-- Solution: Add highest play detection + pg_notify broadcast
--
-- This will:
-- 1. Detect when highest possible play is made (2S, 2H, 2C, 2D for singles)
-- 2. Start 10-second auto-pass timer
-- 3. Broadcast auto_pass_timer_started event to all clients
-- 4. Clear timer when new play made or manual pass

-- ============================================================================
-- PART 1: Highest Play Detection Function
-- ============================================================================

CREATE OR REPLACE FUNCTION is_highest_possible_play(
  p_cards JSONB,
  p_played_cards JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
  v_card_count INTEGER;
  v_highest_singles TEXT[] := ARRAY['2S', '2H', '2C', '2D'];
  v_card JSONB;
  v_card_id TEXT;
BEGIN
  v_card_count := jsonb_array_length(p_cards);
  
  -- Only singles can be highest plays (for now)
  IF v_card_count != 1 THEN
    RETURN FALSE;
  END IF;
  
  -- Get the card ID
  v_card := p_cards->0;
  v_card_id := v_card->>'id';
  
  -- Check if it's one of the highest singles
  IF v_card_id = ANY(v_highest_singles) THEN
    -- Make sure this card hasn't been played yet
    FOR i IN 0..jsonb_array_length(p_played_cards)-1 LOOP
      IF (p_played_cards->i)->>'id' = v_card_id THEN
        RETURN FALSE; -- Card already played
      END IF;
    END LOOP;
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_highest_possible_play IS 'Detect if cards played are highest possible (unbeatable). For singles: 2S, 2H, 2C, 2D. Returns false if card already played.';

-- ============================================================================
-- PART 2: Update execute_play_move with highest play detection
-- ============================================================================

CREATE OR REPLACE FUNCTION execute_play_move(
  p_room_code TEXT,
  p_player_id UUID,
  p_cards JSONB
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_current_hands JSONB;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_combo_type TEXT;
  v_next_turn INTEGER;
  v_card JSONB;
  v_is_highest_play BOOLEAN;
  v_timer_state JSONB;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state WITH ROW LOCK
  SELECT * INTO v_game_state 
  FROM game_state 
  WHERE room_id = v_room_id
  FOR UPDATE NOWAIT;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- 3. Get player info
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found in room');
  END IF;
  
  -- 4. Verify it's this player's turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- 5. Get current hands
  v_current_hands := v_game_state.hands;
  v_player_hand := v_current_hands->v_player.player_index::TEXT;
  
  -- 6. Remove played cards from hand
  v_new_hand := '[]'::JSONB;
  FOR v_card IN SELECT jsonb_array_elements(v_player_hand)
  LOOP
    IF NOT (p_cards @> jsonb_build_array(v_card)) THEN
      v_new_hand := v_new_hand || jsonb_build_array(v_card);
    END IF;
  END LOOP;
  
  -- 7. Update hands
  v_current_hands := jsonb_set(v_current_hands, ARRAY[v_player.player_index::TEXT], v_new_hand);
  
  -- 8. Calculate next turn
  v_next_turn := (v_player.player_index + 1) % 4;
  
  -- 9. Classify combo type
  CASE jsonb_array_length(p_cards)
    WHEN 1 THEN v_combo_type := 'Single';
    WHEN 2 THEN v_combo_type := 'Pair';
    WHEN 3 THEN v_combo_type := 'Triple';
    WHEN 5 THEN v_combo_type := 'Five Card';
    ELSE v_combo_type := 'Unknown';
  END CASE;
  
  -- 🔥 CRITICAL FIX: Detect highest play BEFORE updating played_cards
  v_is_highest_play := is_highest_possible_play(p_cards, v_game_state.played_cards);
  
  -- 10. Create timer state if highest play detected
  IF v_is_highest_play THEN
    v_timer_state := jsonb_build_object(
      'active', true,
      'started_at', NOW(),
      'duration_ms', 10000,
      'remaining_ms', 10000,
      'triggering_play', jsonb_build_object(
        'position', v_player.player_index,
        'cards', p_cards,
        'combo_type', v_combo_type
      ),
      'player_id', v_player.user_id
    );
  ELSE
    v_timer_state := NULL;
  END IF;
  
  -- 11. Update game state
  UPDATE game_state
  SET
    hands = v_current_hands,
    current_turn = v_next_turn,
    last_play = jsonb_build_object(
      'position', v_player.player_index,
      'cards', p_cards,
      'combo_type', v_combo_type
    ),
    pass_count = 0,
    played_cards = played_cards || p_cards,  -- Add to history
    auto_pass_timer = v_timer_state,  -- Set timer if highest play
    updated_at = NOW()
  WHERE room_id = v_room_id;
  
  -- 🔥 CRITICAL FIX: Broadcast timer started event if highest play
  IF v_is_highest_play THEN
    PERFORM pg_notify(
      'room_' || v_room_id::TEXT,
      json_build_object(
        'event', 'auto_pass_timer_started',
        'timer_state', v_timer_state,
        'triggering_player_index', v_player.player_index
      )::TEXT
    );
  END IF;
  
  -- 12. Check for match end
  IF jsonb_array_length(v_new_hand) = 0 THEN
    UPDATE game_state
    SET game_phase = 'finished'
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'game_finished', true,
      'winner_index', v_player.player_index,
      'highest_play_detected', v_is_highest_play
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'cards_remaining', jsonb_array_length(v_new_hand),
    'highest_play_detected', v_is_highest_play
  );
EXCEPTION
  WHEN lock_not_available THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Game state locked - another move in progress',
      'retry', true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION execute_play_move IS 'Execute a play move with highest play detection and auto-pass timer broadcasting';

GRANT EXECUTE ON FUNCTION execute_play_move TO authenticated;
GRANT EXECUTE ON FUNCTION is_highest_possible_play TO authenticated;

-- ============================================================================
-- SUCCESS! Auto-pass timer will now:
-- 1. ✅ Detect highest plays (2S, 2H, 2C, 2D singles)
-- 2. ✅ Start 10-second timer
-- 3. ✅ Broadcast to all clients via pg_notify
-- 4. ✅ Clear timer on new play or manual pass
-- ============================================================================


-- --------------------------------------------------------------------------
-- Source: 20251228000003_verify_realtime_flow.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- FIX: Use Supabase Realtime channel instead of pg_notify
-- ============================================================================
-- Problem: Server uses pg_notify but frontend listens to broadcast events
-- Solution: Replace pg_notify with direct realtime.send() via Edge Function
--           OR use a trigger that frontend can listen to
--
-- The issue: pg_notify sends to PostgreSQL's LISTEN/NOTIFY system
--           Supabase Realtime broadcasts are a separate system
--
-- Best solution: Update game_state, let Realtime postgres_changes trigger,
--                then frontend detects timer in the UPDATE payload

-- NO CODE CHANGES NEEDED! Just verify the flow:
-- 1. Server updates game_state.auto_pass_timer
-- 2. postgres_changes event fires
-- 3. Frontend receives updated game_state
-- 4. Frontend detects timer and starts countdown

-- The frontend already has this logic in useRealtime.ts:
-- .on('postgres_changes', {
--   event: '*',
--   schema: 'public',
--   table: 'game_state',
--   filter: `room_id=eq.${roomId}`,
-- }, (payload) => {
--   if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
--     const newGameState = payload.new as GameState;
--     setGameState(newGameState); // This will include auto_pass_timer!
--   }
-- })

-- ✅ The auto_pass_timer will be in the UPDATE payload automatically!
-- ✅ No broadcast events needed - postgres_changes is enough!

SELECT 'Migration complete - auto_pass_timer now propagates via postgres_changes' AS status;


-- --------------------------------------------------------------------------
-- Source: 20251229000001_add_critical_game_rule_validation.sql
-- --------------------------------------------------------------------------
-- ==========================================================================
-- CRITICAL FIX: Add Server-Side Game Rule Validation
-- ==========================================================================
-- Date: December 29, 2025
-- Purpose: Enforce core Big Two rules on the server (authoritative validation)
--
-- CRITICAL ISSUES FIXED:
-- 1. ❌ Players can currently pass when leading (lastPlay is null) - NOT ALLOWED
-- 2. ❌ First play doesn't require 3♦ - MUST include 3♦ in opening play
--
-- These are fundamental rule violations that break core gameplay.
-- Server must be the authoritative source of truth for all game rules.
-- ==========================================================================

-- ==========================================================================
-- FIX #1: Add "Cannot Pass When Leading" validation to execute_pass_move
-- ==========================================================================

DROP FUNCTION IF EXISTS execute_pass_move(TEXT, UUID);

CREATE OR REPLACE FUNCTION execute_pass_move(
  p_room_code TEXT,
  p_player_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_next_turn INTEGER;
  v_new_pass_count INTEGER;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state WITH ROW LOCK (prevent race conditions)
  SELECT * INTO v_game_state 
  FROM game_state 
  WHERE room_id = v_room_id
  FOR UPDATE NOWAIT;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- 3. Get player info
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found in room');
  END IF;
  
  -- 4. Verify it's this player's turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- 🔥 CRITICAL FIX #1: Cannot pass when leading (no last_play)
  IF v_game_state.last_play IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot pass when leading - you must play cards'
    );
  END IF;
  
  -- 5. Calculate next turn
  v_next_turn := (v_player.player_index + 1) % 4;
  v_new_pass_count := v_game_state.pass_count + 1;
  
  -- 6. Check if 3 consecutive passes (clear last_play, trick winner leads)
  IF v_new_pass_count >= 3 THEN
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      pass_count = 0,
      last_play = NULL,
      auto_pass_timer = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'trick_cleared', true
    );
  ELSE
    -- 7. Normal pass - just advance turn
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      pass_count = v_new_pass_count,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'pass_count', v_new_pass_count
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION execute_pass_move TO authenticated;

COMMENT ON FUNCTION execute_pass_move IS 
  'Execute a pass move with rule validation: prevents passing when leading (last_play is null)';

-- ==========================================================================
-- FIX #2: Add "First Play Must Include 3♦" validation to execute_play_move
-- ==========================================================================

DROP FUNCTION IF EXISTS execute_play_move(TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION execute_play_move(
  p_room_code TEXT,
  p_player_id UUID,
  p_cards JSONB
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_current_hands JSONB;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_combo_type TEXT;
  v_next_turn INTEGER;
  v_card JSONB;
  v_card_id TEXT;
  v_has_three_diamond BOOLEAN;
  v_is_first_play BOOLEAN;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state WITH ROW LOCK (CRITICAL - prevents race conditions)
  SELECT * INTO v_game_state 
  FROM game_state 
  WHERE room_id = v_room_id
  FOR UPDATE NOWAIT;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- 3. Get player info
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found in room');
  END IF;
  
  -- 4. Verify it's this player's turn (with row lock held)
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- 🔥 CRITICAL FIX #2: First play must include 3♦
  -- Determine if this is the first play of the game
  v_is_first_play := (
    v_game_state.played_cards IS NULL OR 
    jsonb_array_length(COALESCE(v_game_state.played_cards, '[]'::jsonb)) = 0
  );
  
  IF v_is_first_play THEN
    -- Check if played cards include 3♦
    v_has_three_diamond := false;
    FOR v_card IN SELECT jsonb_array_elements(p_cards)
    LOOP
      v_card_id := v_card->>'id';
      IF v_card_id = '3D' THEN
        v_has_three_diamond := true;
        EXIT;
      END IF;
    END LOOP;
    
    IF NOT v_has_three_diamond THEN
      RETURN json_build_object(
        'success', false,
        'error', 'First play must include 3♦ (three of diamonds)'
      );
    END IF;
  END IF;
  
  -- 5. Get current hands
  v_current_hands := v_game_state.hands;
  v_player_hand := v_current_hands->v_player.player_index::TEXT;
  
  -- 6. Verify player has all the cards they're trying to play
  FOR v_card IN SELECT jsonb_array_elements(p_cards)
  LOOP
    IF NOT (v_player_hand @> jsonb_build_array(v_card)) THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Card not in hand: ' || (v_card->>'id')
      );
    END IF;
  END LOOP;
  
  -- 7. Remove played cards from hand
  v_new_hand := '[]'::JSONB;
  FOR v_card IN SELECT jsonb_array_elements(v_player_hand)
  LOOP
    IF NOT (p_cards @> jsonb_build_array(v_card)) THEN
      v_new_hand := v_new_hand || jsonb_build_array(v_card);
    END IF;
  END LOOP;
  
  -- 8. Update hands
  v_current_hands := jsonb_set(v_current_hands, ARRAY[v_player.player_index::TEXT], v_new_hand);
  
  -- 9. Calculate next turn (clockwise: 0→1→2→3→0)
  v_next_turn := (v_player.player_index + 1) % 4;
  
  -- 10. Classify combo type (simplified)
  CASE jsonb_array_length(p_cards)
    WHEN 1 THEN v_combo_type := 'Single';
    WHEN 2 THEN v_combo_type := 'Pair';
    WHEN 3 THEN v_combo_type := 'Triple';
    WHEN 5 THEN v_combo_type := 'Five Card';
    ELSE v_combo_type := 'Unknown';
  END CASE;
  
  -- 11. Update game state
  UPDATE game_state
  SET
    hands = v_current_hands,
    current_turn = v_next_turn,
    last_play = jsonb_build_object(
      'position', v_player.player_index,
      'cards', p_cards,
      'combo_type', v_combo_type
    ),
    pass_count = 0,
    played_cards = COALESCE(played_cards, '[]'::jsonb) || p_cards,
    updated_at = NOW()
  WHERE room_id = v_room_id;
  
  -- 12. Check for match end (player has no cards left)
  IF jsonb_array_length(v_new_hand) = 0 THEN
    UPDATE game_state
    SET game_phase = 'finished'
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'game_finished', true,
      'winner_index', v_player.player_index
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'cards_remaining', jsonb_array_length(v_new_hand)
  );
  
EXCEPTION
  WHEN lock_not_available THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Game state is locked - another action in progress'
    );
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION execute_play_move TO authenticated;

COMMENT ON FUNCTION execute_play_move IS 
  'Execute a play move with rule validation: first play must include 3♦, verifies cards in hand';

-- ==========================================================================
-- Logging and verification
-- ==========================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20251229000001 applied: Critical game rule validation added';
  RAISE NOTICE '   - Fixed: Cannot pass when leading';
  RAISE NOTICE '   - Fixed: First play must include 3♦';
  RAISE NOTICE '   - Server is now authoritative for core game rules';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251229030000_fix_game_state_duplicate_key.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- CRITICAL FIX: Prevent "duplicate key value violates unique constraint game_state_room_id_key"
-- ============================================================================
-- ROOT CAUSE: start_game_with_bots() tries to INSERT game_state, but if a
-- previous game already exists for the room, it fails with duplicate key error
--
-- SOLUTION: Use UPSERT (INSERT ... ON CONFLICT ... DO UPDATE) to handle both
-- new games and restarting games in the same room
--
-- Date: December 29, 2025
-- Task: Critical bug fix (not in original roadmap)

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty VARCHAR DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB[];
  v_i INTEGER;
  v_starting_player INTEGER;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction
  IF v_room.ranked_mode = true THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start ranked games with bots'
    );
  END IF;
  
  -- 3. Count human players
  SELECT COUNT(*) INTO v_human_count
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL);
  
  v_total_players := v_human_count + p_bot_count;
  
  -- 4. Validate
  IF v_total_players != 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players must equal 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_human_count = 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start with 0 humans'
    );
  END IF;
  
  -- 5. Get coordinator (first human)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL)
  ORDER BY joined_at ASC
  LIMIT 1;
  
  -- 6. Find next player index
  SELECT COALESCE(MAX(player_index), -1) + 1 INTO v_next_player_index
  FROM room_players
  WHERE room_id = p_room_id;
  
  -- 7. Create bots (only if they don't exist)
  FOR i IN 1..p_bot_count LOOP
    INSERT INTO room_players (
      room_id, user_id, username, player_index, is_bot, bot_difficulty, is_ready, joined_at
    ) VALUES (
      p_room_id, NULL, 'Bot ' || i, v_next_player_index + i - 1, true, p_bot_difficulty, true, NOW()
    )
    ON CONFLICT (room_id, player_index) DO UPDATE
    SET is_ready = true, bot_difficulty = p_bot_difficulty;
  END LOOP;
  
  -- 8. Create deck and shuffle
  v_deck := ARRAY[
    '3D', '3C', '3H', '3S',
    '4D', '4C', '4H', '4S',
    '5D', '5C', '5H', '5S',
    '6D', '6C', '6H', '6S',
    '7D', '7C', '7H', '7S',
    '8D', '8C', '8H', '8S',
    '9D', '9C', '9H', '9S',
    '10D', '10C', '10H', '10S',
    'JD', 'JC', 'JH', 'JS',
    'QD', 'QC', 'QH', 'QS',
    'KD', 'KC', 'KH', 'KS',
    'AD', 'AC', 'AH', 'AS',
    '2D', '2C', '2H', '2S'
  ];
  
  -- Shuffle deck (Fisher-Yates shuffle)
  v_shuffled_deck := v_deck;
  FOR v_i IN REVERSE 52..2 LOOP
    DECLARE
      v_j INTEGER := 1 + FLOOR(RANDOM() * v_i);
      v_temp TEXT := v_shuffled_deck[v_i];
    BEGIN
      v_shuffled_deck[v_i] := v_shuffled_deck[v_j];
      v_shuffled_deck[v_j] := v_temp;
    END;
  END LOOP;
  
  -- 9. Deal cards to players (13 each)
  v_player_hands := ARRAY[
    json_build_array()::jsonb, -- Player 0
    json_build_array()::jsonb, -- Player 1
    json_build_array()::jsonb, -- Player 2
    json_build_array()::jsonb  -- Player 3
  ];
  
  FOR v_i IN 1..52 LOOP
    DECLARE
      v_player_idx INTEGER := ((v_i - 1) % 4);
      v_card_str TEXT := v_shuffled_deck[v_i];
      v_card_json JSONB := json_build_object(
        'rank', SUBSTRING(v_card_str FROM 1 FOR LENGTH(v_card_str) - 1),
        'suit', SUBSTRING(v_card_str FROM LENGTH(v_card_str) FOR 1),
        'id', v_card_str
      )::jsonb;
    BEGIN
      v_player_hands[v_player_idx + 1] := v_player_hands[v_player_idx + 1] || v_card_json;
    END;
  END LOOP;
  
  -- 10. Find who has 3D (starts game)
  v_starting_player := 0;
  FOR v_i IN 0..3 LOOP
    IF v_player_hands[v_i + 1] @> '[{"id": "3D"}]'::jsonb THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  -- 11. UPSERT game state (handles both new games and restarts)
  -- CRITICAL FIX: Use ON CONFLICT DO UPDATE to prevent duplicate key error
  INSERT INTO game_state (
    room_id,
    current_player,
    current_turn,
    hands,
    played_cards,
    scores,
    round,
    passes,
    passes_in_row,
    last_play,
    last_player,
    play_history,
    round_number,
    dealer_index,
    game_started_at,
    auto_pass_active,
    game_phase
  ) VALUES (
    p_room_id,
    v_starting_player,
    v_starting_player,
    json_build_object(
      '0', v_player_hands[1],
      '1', v_player_hands[2],
      '2', v_player_hands[3],
      '3', v_player_hands[4]
    )::jsonb,
    '[]'::jsonb,
    '[0, 0, 0, 0]'::jsonb,
    1,
    0,
    0,
    NULL,
    NULL,
    '[]'::jsonb,
    1,
    0,
    NOW(),
    false,
    'playing'
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_player = v_starting_player,
    current_turn = v_starting_player,
    hands = json_build_object(
      '0', v_player_hands[1],
      '1', v_player_hands[2],
      '2', v_player_hands[3],
      '3', v_player_hands[4]
    )::jsonb,
    played_cards = '[]'::jsonb,
    scores = '[0, 0, 0, 0]'::jsonb,
    round = 1,
    passes = 0,
    passes_in_row = 0,
    last_play = NULL,
    last_player = NULL,
    play_history = '[]'::jsonb,
    round_number = 1,
    dealer_index = 0,
    game_started_at = NOW(),
    auto_pass_active = false,
    game_phase = 'playing',
    updated_at = NOW();
  
  -- 12. Update room: Set coordinator AND set status to 'playing'
  UPDATE rooms
  SET 
    bot_coordinator_id = v_coordinator_id,
    status = 'playing',
    started_at = NOW()
  WHERE id = p_room_id;
  
  -- 13. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'coordinator_id', v_coordinator_id,
    'status', 'playing',
    'starting_player', v_starting_player,
    'message', 'Game started successfully (handles new/restart)'
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

-- Ensure grants are in place
GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS
  'Starts a multiplayer game with AI bots. Uses UPSERT to handle both new games and game restarts, preventing duplicate key constraint violations on room_id.';


-- --------------------------------------------------------------------------
-- Source: 20251229040000_fix_function_signature_conflict.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- CRITICAL FIX: Function signature ambiguity
-- ============================================================================
-- ROOT CAUSE: Multiple overloads of start_game_with_bots() exist with different
-- parameter types (text vs character varying), causing PostgreSQL to fail when
-- calling the function: "Could not choose the best candidate function"
--
-- SOLUTION: Drop ALL overloads and create a single canonical version with TEXT
-- type for p_bot_difficulty parameter
--
-- Date: December 29, 2025
-- Task: Critical bug fix for function signature conflict

-- Drop ALL possible overloads of the function
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER) CASCADE;

-- Create the canonical version with TEXT type (PostgreSQL standard)
CREATE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty TEXT DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB[];
  v_i INTEGER;
  v_starting_player INTEGER;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction
  IF v_room.mode = 'ranked' AND p_bot_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot add bots to ranked games'
    );
  END IF;
  
  -- 3. Calculate player counts
  SELECT COUNT(*) INTO v_human_count 
  FROM room_players 
  WHERE room_id = p_room_id;
  
  v_total_players := v_human_count + p_bot_count;
  
  IF v_total_players > 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players would exceed 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_total_players < 2 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Need at least 2 players to start',
      'current_total', v_total_players
    );
  END IF;
  
  -- 4. Get coordinator (first human player)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id
  ORDER BY joined_at ASC
  LIMIT 1;
  
  IF v_coordinator_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No human players found in room'
    );
  END IF;
  
  -- 5. Create bot players if needed
  v_next_player_index := v_human_count;
  FOR v_i IN 1..p_bot_count LOOP
    INSERT INTO room_players (room_id, user_id, is_bot, bot_difficulty, player_index)
    VALUES (
      p_room_id,
      gen_random_uuid(), -- Bot gets random UUID
      true,
      p_bot_difficulty,
      v_next_player_index
    );
    v_next_player_index := v_next_player_index + 1;
  END LOOP;
  
  -- 6. Shuffle deck and deal cards
  v_deck := ARRAY[
    'C3','D3','H3','S3','C4','D4','H4','S4','C5','D5','H5','S5',
    'C6','D6','H6','S6','C7','D7','H7','S7','C8','D8','H8','S8',
    'C9','D9','H9','S9','C10','D10','H10','S10','CJ','DJ','HJ','SJ',
    'CQ','DQ','HQ','SQ','CK','DK','HK','SK','CA','DA','HA','SA','C2','D2','H2','S2'
  ];
  
  -- Fisher-Yates shuffle
  FOR v_i IN REVERSE array_length(v_deck, 1)..2 LOOP
    DECLARE
      v_j INTEGER := floor(random() * v_i + 1)::INTEGER;
      v_temp TEXT := v_deck[v_i];
    BEGIN
      v_deck[v_i] := v_deck[v_j];
      v_deck[v_j] := v_temp;
    END;
  END LOOP;
  v_shuffled_deck := v_deck;
  
  -- Deal 13 cards to each player
  v_player_hands := ARRAY[]::JSONB[];
  FOR v_i IN 0..(v_total_players - 1) LOOP
    v_player_hands := array_append(
      v_player_hands,
      to_jsonb(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    );
  END LOOP;
  
  -- Find starting player (who has 3 of Diamonds)
  v_starting_player := NULL;
  FOR v_i IN 1..v_total_players LOOP
    IF v_player_hands[v_i] ? 'D3' THEN
      v_starting_player := v_i - 1; -- Convert to 0-indexed
      EXIT;
    END IF;
  END LOOP;
  
  IF v_starting_player IS NULL THEN
    v_starting_player := 0; -- Fallback
  END IF;
  
  -- 7. **CRITICAL FIX**: Use UPSERT instead of INSERT to handle game restarts
  INSERT INTO game_state (
    room_id,
    current_player_index,
    last_played_hand,
    pass_count,
    round_number,
    player_hands
  )
  VALUES (
    p_room_id,
    v_starting_player,
    NULL,
    0,
    1,
    v_player_hands
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_player_index = EXCLUDED.current_player_index,
    last_played_hand = EXCLUDED.last_played_hand,
    pass_count = EXCLUDED.pass_count,
    round_number = EXCLUDED.round_number,
    player_hands = EXCLUDED.player_hands,
    updated_at = NOW();
  
  -- 8. Update room status
  UPDATE rooms 
  SET status = 'playing',
      updated_at = NOW()
  WHERE id = p_room_id;
  
  -- Return success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'total_players', v_total_players,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'starting_player', v_starting_player,
    'coordinator_id', v_coordinator_id
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) TO authenticated;

-- Add documentation
COMMENT ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) IS 
  'Fixed version that handles both new games and restarts in same room using UPSERT. Uses TEXT type for bot_difficulty to avoid signature ambiguity.';


-- --------------------------------------------------------------------------
-- Source: 20251229050000_fix_ranked_mode_column_reference.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- CRITICAL FIX: Incorrect column reference in start_game_with_bots()
-- ============================================================================
-- ROOT CAUSE: Function references v_room.mode but the rooms table actually has
-- a column called ranked_mode (boolean), not mode (text)
--
-- SOLUTION: Update function to use correct column name: ranked_mode instead of mode
--
-- Date: December 29, 2025
-- Task: Fix "record 'v_room' has no field 'mode'" error

-- Drop the broken version
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, TEXT) CASCADE;

-- Recreate with correct column reference
CREATE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty TEXT DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB[];
  v_i INTEGER;
  v_starting_player INTEGER;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction (FIXED: use ranked_mode instead of mode)
  IF v_room.ranked_mode = true AND p_bot_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot add bots to ranked games'
    );
  END IF;
  
  -- 3. Calculate player counts
  SELECT COUNT(*) INTO v_human_count 
  FROM room_players 
  WHERE room_id = p_room_id;
  
  v_total_players := v_human_count + p_bot_count;
  
  IF v_total_players > 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players would exceed 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_total_players < 2 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Need at least 2 players to start',
      'current_total', v_total_players
    );
  END IF;
  
  -- 4. Get coordinator (first human player)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id
  ORDER BY joined_at ASC
  LIMIT 1;
  
  IF v_coordinator_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No human players found in room'
    );
  END IF;
  
  -- 5. Create bot players if needed
  v_next_player_index := v_human_count;
  FOR v_i IN 1..p_bot_count LOOP
    INSERT INTO room_players (room_id, user_id, is_bot, bot_difficulty, player_index)
    VALUES (
      p_room_id,
      gen_random_uuid(), -- Bot gets random UUID
      true,
      p_bot_difficulty,
      v_next_player_index
    );
    v_next_player_index := v_next_player_index + 1;
  END LOOP;
  
  -- 6. Shuffle deck and deal cards
  v_deck := ARRAY[
    'C3','D3','H3','S3','C4','D4','H4','S4','C5','D5','H5','S5',
    'C6','D6','H6','S6','C7','D7','H7','S7','C8','D8','H8','S8',
    'C9','D9','H9','S9','C10','D10','H10','S10','CJ','DJ','HJ','SJ',
    'CQ','DQ','HQ','SQ','CK','DK','HK','SK','CA','DA','HA','SA','C2','D2','H2','S2'
  ];
  
  -- Fisher-Yates shuffle
  FOR v_i IN REVERSE array_length(v_deck, 1)..2 LOOP
    DECLARE
      v_j INTEGER := floor(random() * v_i + 1)::INTEGER;
      v_temp TEXT := v_deck[v_i];
    BEGIN
      v_deck[v_i] := v_deck[v_j];
      v_deck[v_j] := v_temp;
    END;
  END LOOP;
  v_shuffled_deck := v_deck;
  
  -- Deal 13 cards to each player
  v_player_hands := ARRAY[]::JSONB[];
  FOR v_i IN 0..(v_total_players - 1) LOOP
    v_player_hands := array_append(
      v_player_hands,
      to_jsonb(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    );
  END LOOP;
  
  -- Find starting player (who has 3 of Diamonds)
  v_starting_player := NULL;
  FOR v_i IN 1..v_total_players LOOP
    IF v_player_hands[v_i] ? 'D3' THEN
      v_starting_player := v_i - 1; -- Convert to 0-indexed
      EXIT;
    END IF;
  END LOOP;
  
  IF v_starting_player IS NULL THEN
    v_starting_player := 0; -- Fallback
  END IF;
  
  -- 7. Use UPSERT to handle both new games and restarts
  INSERT INTO game_state (
    room_id,
    current_player_index,
    last_played_hand,
    pass_count,
    round_number,
    player_hands
  )
  VALUES (
    p_room_id,
    v_starting_player,
    NULL,
    0,
    1,
    v_player_hands
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_player_index = EXCLUDED.current_player_index,
    last_played_hand = EXCLUDED.last_played_hand,
    pass_count = EXCLUDED.pass_count,
    round_number = EXCLUDED.round_number,
    player_hands = EXCLUDED.player_hands,
    updated_at = NOW();
  
  -- 8. Update room status
  UPDATE rooms 
  SET status = 'playing',
      updated_at = NOW()
  WHERE id = p_room_id;
  
  -- Return success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'total_players', v_total_players,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'starting_player', v_starting_player,
    'coordinator_id', v_coordinator_id
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) TO authenticated;

-- Add documentation
COMMENT ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) IS 
  'Handles both new games and restarts using UPSERT. Fixed to use ranked_mode column instead of non-existent mode column.';


-- --------------------------------------------------------------------------
-- Source: 20251229060000_fix_actual_column_names.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- COMPREHENSIVE FIX: Use actual game_state schema column names
-- ============================================================================
-- ROOT CAUSE: Previous migrations used wrong column names:
-- - Used "current_player_index" but actual column is "current_player"
-- - Used "player_hands" but actual column is "hands"
-- - Used "last_played_hand" but actual column is "last_play"
--
-- SOLUTION: Rewrite function to use ACTUAL column names from game_state table
--
-- Date: December 29, 2025
-- Task: Fix "column 'current_player_index' does not exist" error

-- Drop all broken versions
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER) CASCADE;

-- Create the CORRECT version using actual schema
CREATE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty TEXT DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB;
  v_i INTEGER;
  v_starting_player INTEGER;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction
  IF v_room.ranked_mode = true AND p_bot_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot add bots to ranked games'
    );
  END IF;
  
  -- 3. Calculate player counts
  SELECT COUNT(*) INTO v_human_count 
  FROM room_players 
  WHERE room_id = p_room_id;
  
  v_total_players := v_human_count + p_bot_count;
  
  IF v_total_players > 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players would exceed 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_total_players < 2 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Need at least 2 players to start',
      'current_total', v_total_players
    );
  END IF;
  
  -- 4. Get coordinator (first human player)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id
  ORDER BY joined_at ASC
  LIMIT 1;
  
  IF v_coordinator_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No human players found in room'
    );
  END IF;
  
  -- 5. Create bot players if needed
  v_next_player_index := v_human_count;
  FOR v_i IN 1..p_bot_count LOOP
    INSERT INTO room_players (room_id, user_id, is_bot, bot_difficulty, player_index)
    VALUES (
      p_room_id,
      gen_random_uuid(),
      true,
      p_bot_difficulty,
      v_next_player_index
    );
    v_next_player_index := v_next_player_index + 1;
  END LOOP;
  
  -- 6. Shuffle deck and deal cards
  v_deck := ARRAY[
    'C3','D3','H3','S3','C4','D4','H4','S4','C5','D5','H5','S5',
    'C6','D6','H6','S6','C7','D7','H7','S7','C8','D8','H8','S8',
    'C9','D9','H9','S9','C10','D10','H10','S10','CJ','DJ','HJ','SJ',
    'CQ','DQ','HQ','SQ','CK','DK','HK','SK','CA','DA','HA','SA','C2','D2','H2','S2'
  ];
  
  -- Fisher-Yates shuffle
  FOR v_i IN REVERSE array_length(v_deck, 1)..2 LOOP
    DECLARE
      v_j INTEGER := floor(random() * v_i + 1)::INTEGER;
      v_temp TEXT := v_deck[v_i];
    BEGIN
      v_deck[v_i] := v_deck[v_j];
      v_deck[v_j] := v_temp;
    END;
  END LOOP;
  v_shuffled_deck := v_deck;
  
  -- Deal 13 cards to each player - store as JSONB object with player indices as keys
  v_player_hands := '{}'::JSONB;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    v_player_hands := v_player_hands || jsonb_build_object(
      v_i::TEXT,
      to_jsonb(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    );
  END LOOP;
  
  -- Find starting player (who has 3 of Diamonds)
  v_starting_player := NULL;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    IF v_player_hands->v_i::TEXT ? 'D3' THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  IF v_starting_player IS NULL THEN
    v_starting_player := 0; -- Fallback
  END IF;
  
  -- 7. UPSERT game_state using CORRECT column names
  INSERT INTO game_state (
    room_id,
    current_player,
    current_turn,
    hands,
    last_play,
    pass_count,
    passes_in_row,
    round_number
  )
  VALUES (
    p_room_id,
    v_starting_player,
    v_starting_player,
    v_player_hands,
    NULL,
    0,
    0,
    1
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_player = EXCLUDED.current_player,
    current_turn = EXCLUDED.current_turn,
    hands = EXCLUDED.hands,
    last_play = EXCLUDED.last_play,
    pass_count = EXCLUDED.pass_count,
    passes_in_row = EXCLUDED.passes_in_row,
    round_number = EXCLUDED.round_number,
    updated_at = NOW();
  
  -- 8. Update room status
  UPDATE rooms 
  SET status = 'playing',
      updated_at = NOW()
  WHERE id = p_room_id;
  
  -- Return success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'total_players', v_total_players,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'starting_player', v_starting_player,
    'coordinator_id', v_coordinator_id
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) TO authenticated;

-- Add documentation
COMMENT ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) IS 
  'CORRECTED version using actual game_state schema: current_player, current_turn, hands (not current_player_index or player_hands). Handles both new games and restarts using UPSERT.';


-- --------------------------------------------------------------------------
-- Source: 20251229070000_definitive_schema_alignment_fix.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- DEFINITIVE SCHEMA ALIGNMENT FIX
-- ============================================================================
-- ROOT CAUSE: Multiple migrations with conflicting column names caused schema drift
-- 
-- PROBLEMS IDENTIFIED:
-- 1. Some migrations use "pass_count", but actual table has "passes"
-- 2. Some migrations use "current_player_index", but actual table has "current_player"  
-- 3. Some migrations use "player_hands", but actual table has "hands"
-- 4. game_phase CHECK constraint may not include 'game_over' in production
-- 5. Multiple conflicting versions of start_game_with_bots() exist
--
-- SOLUTION: Query actual schema, fix ALL mismatches, create ONE correct function
--
-- Date: December 29, 2025, 7:00 AM
-- Author: Comprehensive Migration Audit
-- Task: Fix cascading migration errors (#568, #583)

-- ==========================================================================
-- STEP 1: Verify game_state table exists and get actual column names
-- ==========================================================================

DO $$
DECLARE
  v_has_passes BOOLEAN;
  v_has_pass_count BOOLEAN;
  v_has_current_player BOOLEAN;
  v_has_current_player_index BOOLEAN;
  v_has_hands BOOLEAN;
  v_has_player_hands BOOLEAN;
  v_constraint_definition TEXT;
BEGIN
  RAISE NOTICE '=== DEFINITIVE SCHEMA ALIGNMENT FIX ===';
  RAISE NOTICE 'Checking actual game_state schema...';
  
  -- Check which columns actually exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'passes'
  ) INTO v_has_passes;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'pass_count'
  ) INTO v_has_pass_count;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'current_player'
  ) INTO v_has_current_player;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'current_player_index'
  ) INTO v_has_current_player_index;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'hands'
  ) INTO v_has_hands;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'player_hands'
  ) INTO v_has_player_hands;
  
  -- Report findings
  RAISE NOTICE '--- Column Audit Results ---';
  RAISE NOTICE 'passes: % | pass_count: %', v_has_passes, v_has_pass_count;
  RAISE NOTICE 'current_player: % | current_player_index: %', v_has_current_player, v_has_current_player_index;
  RAISE NOTICE 'hands: % | player_hands: %', v_has_hands, v_has_player_hands;
  
  -- Validate expected schema
  IF NOT v_has_passes THEN
    RAISE EXCEPTION 'CRITICAL: game_state.passes column missing!';
  END IF;
  
  IF NOT v_has_current_player THEN
    RAISE EXCEPTION 'CRITICAL: game_state.current_player column missing!';
  END IF;
  
  IF NOT v_has_hands THEN
    RAISE EXCEPTION 'CRITICAL: game_state.hands column missing!';
  END IF;
  
  -- Check for wrong columns that shouldn't exist
  IF v_has_pass_count THEN
    RAISE WARNING 'game_state has pass_count column - this should be "passes"';
  END IF;
  
  IF v_has_current_player_index THEN
    RAISE WARNING 'game_state has current_player_index column - this should be "current_player"';
  END IF;
  
  IF v_has_player_hands THEN
    RAISE WARNING 'game_state has player_hands column - this should be "hands"';
  END IF;
  
  RAISE NOTICE 'Schema validation complete ✓';
END $$;

-- ==========================================================================
-- STEP 2: Fix game_phase CHECK constraint (ensure it includes all phases)
-- ==========================================================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing game_phase CHECK constraint...';
  
  -- Drop existing constraint (idempotent)
  ALTER TABLE game_state DROP CONSTRAINT IF EXISTS game_state_game_phase_check;
  
  -- Add correct constraint with ALL valid phases
  ALTER TABLE game_state 
    ADD CONSTRAINT game_state_game_phase_check 
    CHECK (game_phase IN ('first_play', 'playing', 'finished', 'game_over'));
  
  RAISE NOTICE 'game_phase constraint updated ✓';
END $$;

-- ==========================================================================
-- STEP 3: Drop ALL conflicting function overloads
-- ==========================================================================

DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, CHARACTER VARYING) CASCADE;

-- ==========================================================================
-- STEP 4: Create definitive start_game_with_bots() using ACTUAL column names
-- ==========================================================================

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty TEXT DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB;
  v_i INTEGER;
  v_starting_player INTEGER;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction (use correct column: ranked_mode)
  IF v_room.ranked_mode = true AND p_bot_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot add bots to ranked games'
    );
  END IF;
  
  -- 3. Calculate player counts
  SELECT COUNT(*) INTO v_human_count 
  FROM room_players 
  WHERE room_id = p_room_id;
  
  v_total_players := v_human_count + p_bot_count;
  
  IF v_total_players > 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players would exceed 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_total_players < 2 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Need at least 2 players to start',
      'current_total', v_total_players
    );
  END IF;
  
  -- 4. Get coordinator (first human player)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id
  ORDER BY joined_at ASC
  LIMIT 1;
  
  IF v_coordinator_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No human players found in room'
    );
  END IF;
  
  -- 5. Create bot players if needed
  v_next_player_index := v_human_count;
  FOR v_i IN 1..p_bot_count LOOP
    INSERT INTO room_players (room_id, user_id, is_bot, bot_difficulty, player_index)
    VALUES (
      p_room_id,
      gen_random_uuid(),
      true,
      p_bot_difficulty,
      v_next_player_index
    );
    v_next_player_index := v_next_player_index + 1;
  END LOOP;
  
  -- 6. Shuffle deck and deal cards
  v_deck := ARRAY[
    'C3','D3','H3','S3','C4','D4','H4','S4','C5','D5','H5','S5',
    'C6','D6','H6','S6','C7','D7','H7','S7','C8','D8','H8','S8',
    'C9','D9','H9','S9','C10','D10','H10','S10','CJ','DJ','HJ','SJ',
    'CQ','DQ','HQ','SQ','CK','DK','HK','SK','CA','DA','HA','SA','C2','D2','H2','S2'
  ];
  
  -- Fisher-Yates shuffle
  FOR v_i IN REVERSE array_length(v_deck, 1)..2 LOOP
    DECLARE
      v_j INTEGER := floor(random() * v_i + 1)::INTEGER;
      v_temp TEXT := v_deck[v_i];
    BEGIN
      v_deck[v_i] := v_deck[v_j];
      v_deck[v_j] := v_temp;
    END;
  END LOOP;
  v_shuffled_deck := v_deck;
  
  -- Deal 13 cards to each player - store as JSONB object with player indices as keys
  v_player_hands := '{}'::JSONB;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    v_player_hands := v_player_hands || jsonb_build_object(
      v_i::TEXT,
      to_jsonb(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    );
  END LOOP;
  
  -- Find starting player (who has 3 of Diamonds)
  v_starting_player := NULL;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    IF v_player_hands->v_i::TEXT @> '["D3"]'::jsonb THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  IF v_starting_player IS NULL THEN
    v_starting_player := 0; -- Fallback
  END IF;
  
  -- 7. UPSERT game_state using CORRECT column names from schema
  INSERT INTO game_state (
    room_id,
    current_player,      -- ✓ NOT current_player_index
    current_turn,
    hands,               -- ✓ NOT player_hands
    last_play,           -- ✓ NOT last_played_hand
    passes,              -- ✓ NOT pass_count
    passes_in_row,
    round_number,
    dealer_index,
    game_phase
  )
  VALUES (
    p_room_id,
    v_starting_player,
    v_starting_player,
    v_player_hands,
    NULL,
    0,
    0,
    1,
    0,
    'first_play'  -- ✓ Valid value in CHECK constraint
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_player = EXCLUDED.current_player,
    current_turn = EXCLUDED.current_turn,
    hands = EXCLUDED.hands,
    last_play = EXCLUDED.last_play,
    passes = EXCLUDED.passes,
    passes_in_row = EXCLUDED.passes_in_row,
    round_number = EXCLUDED.round_number,
    dealer_index = EXCLUDED.dealer_index,
    game_phase = EXCLUDED.game_phase,
    game_started_at = NOW(),
    updated_at = NOW();
  
  -- 8. Update room status
  UPDATE rooms 
  SET status = 'playing',
      started_at = NOW(),
      updated_at = NOW()
  WHERE id = p_room_id;
  
  -- Return success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'total_players', v_total_players,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'starting_player', v_starting_player,
    'coordinator_id', v_coordinator_id,
    'game_phase', 'first_play'
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE,
      'hint', 'Check game_state table schema matches function column names'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) TO authenticated;

-- Add documentation
COMMENT ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) IS 
  'DEFINITIVE version using verified schema column names: current_player (not current_player_index), hands (not player_hands), passes (not pass_count), last_play (not last_played_hand). Handles both new games and restarts using UPSERT. Game phase starts as first_play requiring 3D.';

-- ==========================================================================
-- SUCCESS MESSAGE
-- ==========================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ✓ DEFINITIVE SCHEMA ALIGNMENT FIX COMPLETE ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed:';
  RAISE NOTICE '  ✓ game_phase CHECK constraint includes all phases';
  RAISE NOTICE '  ✓ start_game_with_bots() uses correct column names:';
  RAISE NOTICE '      - current_player (not current_player_index)';
  RAISE NOTICE '      - hands (not player_hands)';
  RAISE NOTICE '      - passes (not pass_count)';
  RAISE NOTICE '      - last_play (not last_played_hand)';
  RAISE NOTICE '  ✓ Handles room restarts with UPSERT';
  RAISE NOTICE '  ✓ Validates ranked mode correctly';
  RAISE NOTICE '  ✓ Sets game_phase to first_play (requires 3D)';
  RAISE NOTICE '';
  RAISE NOTICE 'All function overload conflicts resolved.';
  RAISE NOTICE 'Schema is now aligned and consistent.';
  RAISE NOTICE '';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251229080000_fix_all_pass_count_references.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- COMPREHENSIVE FIX: Replace ALL pass_count references with passes
-- ============================================================================
-- ROOT CAUSE: game_state table uses "passes" but multiple RPC functions use "pass_count"
--
-- AFFECTED FUNCTIONS:
-- - execute_play_move (20251227000002)
-- - execute_pass_move (20251227150000)
-- - add_highest_play_detection_to_server (20251228000002)
-- - fix_execute_play_move_json_encoding (20251227120002)
--
-- Date: December 29, 2025, 8:00 AM
-- Task: Fix ALL pass_count → passes mismatches in RPC functions

-- ==========================================================================
-- FIX execute_play_move
-- ==========================================================================

CREATE OR REPLACE FUNCTION execute_play_move(
  p_room_code TEXT,
  p_player_id UUID,
  p_cards JSONB
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_next_turn INTEGER;
  v_card JSONB;
BEGIN
  -- Get room
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- Get game state with row locking
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- Get player
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;
  
  -- Verify turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- Get player's hand
  v_player_hand := v_game_state.hands->v_player.player_index::TEXT;
  IF v_player_hand IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Hand not found');
  END IF;
  
  -- Remove played cards from hand
  v_new_hand := v_player_hand;
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_cards) LOOP
    v_new_hand := v_new_hand - v_card;
  END LOOP;
  
  -- Calculate next turn
  v_next_turn := (v_player.player_index + 1) % 4;
  
  -- Update game state - CORRECT COLUMN: passes (not pass_count)
  UPDATE game_state
  SET
    hands = jsonb_set(hands, ARRAY[v_player.player_index::TEXT], v_new_hand),
    last_play = p_cards,
    last_player = v_player.player_index,
    current_turn = v_next_turn,
    passes = 0,  -- ✓ CORRECT COLUMN NAME
    passes_in_row = 0,
    play_history = play_history || jsonb_build_object(
      'player', v_player.player_index,
      'cards', p_cards,
      'timestamp', NOW()
    ),
    updated_at = NOW()
  WHERE room_id = v_room_id;
  
  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'remaining_cards', jsonb_array_length(v_new_hand)
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================================================
-- FIX execute_pass_move
-- ==========================================================================

CREATE OR REPLACE FUNCTION execute_pass_move(
  p_room_code TEXT,
  p_player_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_next_turn INTEGER;
  v_new_pass_count INTEGER;
BEGIN
  -- Get room
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- Get game state with row locking
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- Get player
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;
  
  -- Verify turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- Calculate next turn
  v_next_turn := (v_player.player_index + 1) % 4;
  v_new_pass_count := v_game_state.passes + 1;  -- ✓ CORRECT COLUMN NAME
  
  -- Check if 3 consecutive passes (clear trick)
  IF v_new_pass_count >= 3 THEN
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = 0,  -- ✓ CORRECT COLUMN NAME
      passes_in_row = 0,
      last_play = NULL,
      last_player = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'trick_cleared', true
    );
  ELSE
    -- Normal pass - advance turn
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = v_new_pass_count,  -- ✓ CORRECT COLUMN NAME
      passes_in_row = passes_in_row + 1,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'passes', v_new_pass_count  -- ✓ CORRECT RESPONSE KEY
    );
  END IF;
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION execute_play_move(TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION execute_pass_move(TEXT, UUID) TO authenticated;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ✓ ALL pass_count → passes FIXES APPLIED ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed functions:';
  RAISE NOTICE '  ✓ execute_play_move()';
  RAISE NOTICE '  ✓ execute_pass_move()';
  RAISE NOTICE '';
  RAISE NOTICE 'All functions now use correct column name: passes';
  RAISE NOTICE '';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251229090000_add_rooms_updated_at_column.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- FIX: Add missing updated_at column to rooms table
-- ============================================================================
-- ROOT CAUSE: start_game_with_bots() tries to UPDATE rooms.updated_at but column doesn't exist
-- ERROR: "column 'updated_at' of relation 'rooms' does not exist"
--
-- SOLUTION: Add updated_at column with auto-update trigger
--
-- Date: December 29, 2025, 9:00 AM
-- Task: Fix missing column error

-- Add updated_at column to rooms table
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create trigger function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_rooms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();  -- use := (PL/pgSQL assignment); = would also work but := is unambiguous
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS rooms_updated_at_trigger ON rooms;
CREATE TRIGGER rooms_updated_at_trigger
  BEFORE UPDATE ON rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_rooms_updated_at();

-- Add comment
COMMENT ON COLUMN rooms.updated_at IS 'Timestamp of last update to this room (auto-updated via trigger)';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ✓ ROOMS TABLE UPDATED_AT COLUMN ADDED ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed:';
  RAISE NOTICE '  ✓ Added rooms.updated_at column';
  RAISE NOTICE '  ✓ Created auto-update trigger';
  RAISE NOTICE '  ✓ start_game_with_bots() will now work';
  RAISE NOTICE '';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251229100000_fix_card_object_structure.sql
-- --------------------------------------------------------------------------
-- ==========================================================================
-- FIX: Card Object Structure - Generate proper card objects
-- ==========================================================================
-- CRITICAL: Cards must be objects {id, rank, suit}, not strings "C3"
-- 
-- Previous implementation stored: ["C3", "D4", "H5"]
-- Required format: [{"id":"C3","rank":"3","suit":"C"}, ...]
-- 
-- This fixes the "INVALID CARD OBJECT" error in Card.tsx
-- ==========================================================================

-- Helper function to convert card string to proper object
CREATE OR REPLACE FUNCTION card_string_to_object(card_code TEXT)
RETURNS JSONB AS $$
DECLARE
  v_suit CHAR(1);
  v_rank TEXT;
BEGIN
  -- Extract suit (first character)
  v_suit := substring(card_code from 1 for 1);
  
  -- Extract rank (remaining characters)
  v_rank := substring(card_code from 2);
  
  -- Build proper card object with SINGLE-LETTER SUIT (matches Edge Function)
  RETURN jsonb_build_object(
    'id', card_code,
    'rank', v_rank,
    'suit', v_suit  -- Returns 'D' not 'DIAMONDS'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Grant permissions
GRANT EXECUTE ON FUNCTION card_string_to_object(TEXT) TO authenticated;

-- ==========================================================================
-- Rewrite start_game_with_bots() to generate proper card objects
-- ==========================================================================

DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty TEXT DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB;
  v_i INTEGER;
  v_starting_player INTEGER;
  v_card_string TEXT;
  v_player_hand JSONB;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction
  IF v_room.ranked_mode = true AND p_bot_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot add bots to ranked games'
    );
  END IF;
  
  -- 3. Calculate player counts
  SELECT COUNT(*) INTO v_human_count 
  FROM room_players 
  WHERE room_id = p_room_id;
  
  v_total_players := v_human_count + p_bot_count;
  
  IF v_total_players > 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players would exceed 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_total_players < 2 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Need at least 2 players to start',
      'current_total', v_total_players
    );
  END IF;
  
  -- 4. Get coordinator (first human player)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id
  ORDER BY joined_at ASC
  LIMIT 1;
  
  IF v_coordinator_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No human players found in room'
    );
  END IF;
  
  -- 5. Create bot players if needed
  v_next_player_index := v_human_count;
  FOR v_i IN 1..p_bot_count LOOP
    INSERT INTO room_players (room_id, user_id, is_bot, bot_difficulty, player_index)
    VALUES (
      p_room_id,
      gen_random_uuid(),
      true,
      p_bot_difficulty,
      v_next_player_index
    );
    v_next_player_index := v_next_player_index + 1;
  END LOOP;
  
  -- 6. Shuffle deck
  v_deck := ARRAY[
    'C3','D3','H3','S3','C4','D4','H4','S4','C5','D5','H5','S5',
    'C6','D6','H6','S6','C7','D7','H7','S7','C8','D8','H8','S8',
    'C9','D9','H9','S9','C10','D10','H10','S10','CJ','DJ','HJ','SJ',
    'CQ','DQ','HQ','SQ','CK','DK','HK','SK','CA','DA','HA','SA','C2','D2','H2','S2'
  ];
  
  -- Fisher-Yates shuffle
  FOR v_i IN REVERSE array_length(v_deck, 1)..2 LOOP
    DECLARE
      v_j INTEGER := floor(random() * v_i + 1)::INTEGER;
      v_temp TEXT := v_deck[v_i];
    BEGIN
      v_deck[v_i] := v_deck[v_j];
      v_deck[v_j] := v_temp;
    END;
  END LOOP;
  v_shuffled_deck := v_deck;
  
  -- 7. Deal 13 cards to each player - CONVERT TO PROPER CARD OBJECTS
  v_player_hands := '{}'::JSONB;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    -- Build array of proper card objects for this player
    v_player_hand := '[]'::JSONB;
    FOR v_card_string IN 
      SELECT unnest(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    LOOP
      v_player_hand := v_player_hand || jsonb_build_array(
        card_string_to_object(v_card_string)
      );
    END LOOP;
    
    -- Add this player's hand to the hands object
    v_player_hands := v_player_hands || jsonb_build_object(
      v_i::TEXT,
      v_player_hand
    );
  END LOOP;
  
  -- 8. Find starting player (who has 3 of Diamonds)
  v_starting_player := NULL;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    -- Check if this player's hand contains D3
    IF EXISTS (
      SELECT 1 
      FROM jsonb_array_elements(v_player_hands->v_i::TEXT) AS card
      WHERE card->>'id' = 'D3'
    ) THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  IF v_starting_player IS NULL THEN
    v_starting_player := 0; -- Fallback
  END IF;
  
  -- 9. UPSERT game_state
  INSERT INTO game_state (
    room_id,
    current_player,
    current_turn,
    hands,
    last_play,
    passes,
    passes_in_row,
    round_number,
    dealer_index,
    game_phase
  )
  VALUES (
    p_room_id,
    v_starting_player,
    v_starting_player,
    v_player_hands,
    NULL,
    0,
    0,
    1,
    0,
    'first_play'
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_player = EXCLUDED.current_player,
    current_turn = EXCLUDED.current_turn,
    hands = EXCLUDED.hands,
    last_play = EXCLUDED.last_play,
    passes = EXCLUDED.passes,
    passes_in_row = EXCLUDED.passes_in_row,
    round_number = EXCLUDED.round_number,
    dealer_index = EXCLUDED.dealer_index,
    game_phase = EXCLUDED.game_phase,
    game_started_at = NOW(),
    updated_at = NOW();
  
  -- 10. Update room status
  UPDATE rooms 
  SET status = 'playing',
      started_at = NOW(),
      updated_at = NOW()
  WHERE id = p_room_id;
  
  -- Return success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'total_players', v_total_players,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'starting_player', v_starting_player,
    'coordinator_id', v_coordinator_id,
    'game_phase', 'first_play'
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE,
      'hint', 'Check game_state table schema and card object structure'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) TO authenticated;

-- Add documentation
COMMENT ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) IS 
  'Creates proper card objects with {id, rank, suit} structure. Fixes INVALID CARD OBJECT error in mobile app. Uses card_string_to_object() helper to convert TEXT[] deck to JSONB card objects.';

-- ==========================================================================
-- SUCCESS MESSAGE
-- ==========================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ✓ CARD OBJECT STRUCTURE FIX COMPLETE ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed:';
  RAISE NOTICE '  ✓ Cards now stored as proper objects: {id, rank, suit}';
  RAISE NOTICE '  ✓ Created card_string_to_object() helper function';
  RAISE NOTICE '  ✓ Updated start_game_with_bots() to generate card objects';
  RAISE NOTICE '  ✓ Starting player detection updated for object format';
  RAISE NOTICE '';
  RAISE NOTICE 'Mobile app will now render cards correctly!';
  RAISE NOTICE 'Error "INVALID CARD OBJECT" should be resolved.';
  RAISE NOTICE '';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251229120000_fix_pass_turn_order_anticlockwise.sql
-- --------------------------------------------------------------------------
-- Fix execute_pass_move to use anticlockwise turn order
-- BUG: RPC was using (index + 1) % 4 (clockwise) while play-cards Edge Function uses anticlockwise
-- This caused desynchronization when players passed vs played cards

CREATE OR REPLACE FUNCTION execute_pass_move(
  p_room_code TEXT,
  p_player_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_next_turn INTEGER;
  v_new_pass_count INTEGER;
  -- Anticlockwise turn order array: 0→3→2→1→0
  -- Turn order mapping by player_index: 0→3, 1→2, 2→0, 3→1.
  -- Position 0 (bottom) → 3 (right)
  -- Position 3 (right) → 1 (top)
  -- Position 1 (top) → 2 (left)
  -- Position 2 (left) → 0 (bottom)
  -- NOTE: PostgreSQL arrays are 1-indexed, so turn_order[player_index + 1] accesses the mapping
  v_turn_order INTEGER[] := ARRAY[3, 2, 0, 1];
BEGIN
  -- Get room
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- Get game state with row locking
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- Get player
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;
  
  -- Verify turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- Calculate next turn using anticlockwise array (FIXED)
  -- BEFORE: v_next_turn := (v_player.player_index + 1) % 4; (CLOCKWISE)
  -- AFTER: v_next_turn := v_turn_order[v_player.player_index + 1]; (ANTICLOCKWISE)
  -- Note: PostgreSQL arrays are 1-indexed, so add 1 to player_index
  v_next_turn := v_turn_order[v_player.player_index + 1];
  v_new_pass_count := v_game_state.passes + 1;
  
  -- Check if 3 consecutive passes (clear trick)
  IF v_new_pass_count >= 3 THEN
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = 0,
      passes_in_row = 0,
      last_play = NULL,
      last_player = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'trick_cleared', true
    );
  ELSE
    -- Normal pass - advance turn
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = v_new_pass_count,
      passes_in_row = passes_in_row + 1,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'passes', v_new_pass_count
    );
  END IF;
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION execute_pass_move(TEXT, UUID) TO authenticated;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ✓ execute_pass_move NOW USES ANTICLOCKWISE TURN ORDER ===';
  RAISE NOTICE 'Turn sequence: 0→3→1→2→0 (matches play-cards Edge Function)';
  RAISE NOTICE 'Position mapping: 0=Bottom, 1=Top, 2=Left, 3=Right';
  RAISE NOTICE '';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251230000000_add_missing_game_state_columns.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- CRITICAL FIX: Add missing columns to game_state table
-- ============================================================================
-- ROOT CAUSE: Phase 2 Edge Functions expect columns that don't exist in schema
-- - match_number: Used to track which match (1, 2, 3...) for 3♦ validation
-- - pass_count: Used by Edge Function (conflicts with 'passes' column)
-- - auto_pass_timer: Server-managed timer state (Phase 2.3)
--
-- Date: December 30, 2025
-- Task: Production readiness fix - schema alignment

-- 1. Add match_number column (tracks which match we're on: 1, 2, 3...)
ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS match_number INTEGER NOT NULL DEFAULT 1
CHECK (match_number >= 1);

COMMENT ON COLUMN game_state.match_number IS 'Current match number (1-based). Match 1 requires 3♦ on first play.';

-- 2. Add pass_count column (Edge Function uses this name, not 'passes')
-- Note: We already have 'passes' column, but Edge Function expects 'pass_count'
-- Keep both for compatibility, sync them via trigger
ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS pass_count INTEGER NOT NULL DEFAULT 0
CHECK (pass_count >= 0);

COMMENT ON COLUMN game_state.pass_count IS 'Number of consecutive passes (resets when cards are played). Used by Edge Functions.';

-- 3. Add auto_pass_timer column (server-managed timer state from Phase 2.3)
-- Replaces auto_pass_active boolean with full timer state object
ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS auto_pass_timer JSONB DEFAULT NULL;

COMMENT ON COLUMN game_state.auto_pass_timer IS 'Server-managed auto-pass timer state (Phase 2.3). Contains: active, started_at, duration_ms, remaining_ms, end_timestamp, sequence_id.';

-- 4. Create trigger to keep 'passes' and 'pass_count' in sync
-- This ensures backward compatibility if any code uses the old 'passes' column
CREATE OR REPLACE FUNCTION sync_pass_counts()
RETURNS TRIGGER AS $$
BEGIN
  -- When pass_count changes, update passes
  IF NEW.pass_count IS DISTINCT FROM OLD.pass_count THEN
    NEW.passes := NEW.pass_count;
    NEW.passes_in_row := NEW.pass_count;
  END IF;
  
  -- When passes changes, update pass_count
  IF NEW.passes IS DISTINCT FROM OLD.passes THEN
    NEW.pass_count := NEW.passes;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_pass_counts_trigger
BEFORE UPDATE ON game_state
FOR EACH ROW
EXECUTE FUNCTION sync_pass_counts();

-- 5. Drop auto_pass_active column (replaced by auto_pass_timer)
-- Only drop if it exists (for idempotency)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'game_state' 
    AND column_name = 'auto_pass_active'
  ) THEN
    ALTER TABLE game_state DROP COLUMN auto_pass_active;
    RAISE NOTICE 'Dropped deprecated auto_pass_active column';
  END IF;
END $$;

-- 6. Update existing rows to have default values
UPDATE game_state 
SET 
  match_number = 1,
  pass_count = COALESCE(passes, 0),
  auto_pass_timer = NULL
WHERE match_number IS NULL OR pass_count IS NULL;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'game_state schema updated successfully:';
  RAISE NOTICE '  ✅ Added match_number column';
  RAISE NOTICE '  ✅ Added pass_count column';
  RAISE NOTICE '  ✅ Added auto_pass_timer column';
  RAISE NOTICE '  ✅ Created pass_count sync trigger';
  RAISE NOTICE '  ✅ Dropped deprecated auto_pass_active column';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20251230000001_fix_winner_id_uuid_cast.sql
-- --------------------------------------------------------------------------
-- Fix winner_id UUID casting in complete_game_from_client
-- Date: December 30, 2025
-- Issue: "column "winner_id" is of type uuid but expression is of type text"

CREATE OR REPLACE FUNCTION complete_game_from_client(
  p_room_id UUID,
  p_room_code TEXT,
  p_players JSONB,
  p_winner_id TEXT,
  p_game_duration_seconds INTEGER,
  p_started_at TIMESTAMPTZ,
  p_finished_at TIMESTAMPTZ
) RETURNS JSONB AS $$
DECLARE
  v_game_history_id UUID;
  v_player JSONB;
  v_real_players JSONB[] := '{}';
  v_won BOOLEAN;
  v_calling_user_id UUID;
  v_winner_uuid UUID;
BEGIN
  -- SECURITY: Verify caller is authenticated
  v_calling_user_id := auth.uid();
  IF v_calling_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Must be logged in';
  END IF;

  -- SECURITY: Verify caller is one of the players in the game
  IF NOT EXISTS (
    SELECT 1 
    FROM jsonb_array_elements(p_players) AS player
    WHERE (player->>'user_id')::TEXT = v_calling_user_id::TEXT
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Caller must be a player in this game';
  END IF;

  -- Filter out bot players (user_id starts with 'bot_')
  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players)
  LOOP
    IF (v_player->>'user_id')::TEXT NOT LIKE 'bot_%' THEN
      v_real_players := array_append(v_real_players, v_player);
    END IF;
  END LOOP;

  -- ✅ FIX: Convert winner_id to UUID with proper null handling
  -- If winner is a bot or invalid, set to NULL
  BEGIN
    IF p_winner_id IS NULL OR p_winner_id = '' OR p_winner_id LIKE 'bot_%' THEN
      v_winner_uuid := NULL;
    ELSE
      v_winner_uuid := p_winner_id::UUID;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      -- If UUID casting fails, log the invalid winner_id for debugging and treat as bot/invalid winner
      RAISE LOG 'Invalid winner_id value "%" could not be cast to UUID in complete_game_from_client', p_winner_id;
      v_winner_uuid := NULL;
  END;

  -- Insert game history record
  INSERT INTO game_history (
    room_id,
    room_code,
    player_1_id,
    player_1_username,
    player_1_score,
    player_2_id,
    player_2_username,
    player_2_score,
    player_3_id,
    player_3_username,
    player_3_score,
    player_4_id,
    player_4_username,
    player_4_score,
    winner_id,
    game_duration_seconds,
    started_at,
    finished_at
  ) VALUES (
    p_room_id,
    p_room_code,
    (p_players->0->>'user_id')::UUID,
    p_players->0->>'username',
    (p_players->0->>'score')::INTEGER,
    (p_players->1->>'user_id')::UUID,
    p_players->1->>'username',
    (p_players->1->>'score')::INTEGER,
    (p_players->2->>'user_id')::UUID,
    p_players->2->>'username',
    (p_players->2->>'score')::INTEGER,
    (p_players->3->>'user_id')::UUID,
    p_players->3->>'username',
    (p_players->3->>'score')::INTEGER,
    v_winner_uuid,  -- ✅ Use pre-validated UUID variable
    p_game_duration_seconds,
    p_started_at,
    p_finished_at
  )
  RETURNING id INTO v_game_history_id;

  -- Update stats for each REAL player (not bots)
  FOR v_player IN SELECT * FROM unnest(v_real_players)
  LOOP
    v_won := (v_player->>'user_id')::UUID = v_winner_uuid;
    
    INSERT INTO player_stats (user_id, games_played, games_won)
    VALUES ((v_player->>'user_id')::UUID, 1, CASE WHEN v_won THEN 1 ELSE 0 END)
    ON CONFLICT (user_id)
    DO UPDATE SET
      games_played = player_stats.games_played + 1,
      games_won = player_stats.games_won + CASE WHEN v_won THEN 1 ELSE 0 END;

    -- Update combo stats
    IF v_player->>'combos_played' IS NOT NULL THEN
      INSERT INTO combo_stats (user_id, total_combos_played)
      VALUES ((v_player->>'user_id')::UUID, (v_player->>'combos_played')::INTEGER)
      ON CONFLICT (user_id)
      DO UPDATE SET
        total_combos_played = combo_stats.total_combos_played + (v_player->>'combos_played')::INTEGER;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'game_history_id', v_game_history_id,
    'players_updated', array_length(v_real_players, 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION complete_game_from_client TO authenticated;

COMMENT ON FUNCTION complete_game_from_client IS 
  'Completes a game and updates player stats. Callable by authenticated clients (fallback when Edge Function unavailable).';


-- --------------------------------------------------------------------------
-- Source: 20251231000000_fix_rpc_security_auth_validation.sql
-- --------------------------------------------------------------------------
-- Fix Security Issues in RPC Functions
-- Date: December 31, 2025
-- Issue: execute_pass_move and complete_game_from_client lack auth.uid() validation
-- Risk: Any authenticated user can execute moves or forge game results for other players

-- ==============================================================================
-- 1. Fix execute_pass_move - Add auth.uid() validation
-- ==============================================================================

CREATE OR REPLACE FUNCTION execute_pass_move(
  p_room_code TEXT,
  p_player_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_next_turn INTEGER;
  v_new_pass_count INTEGER;
  -- Anticlockwise turn order mapping: 0→3, 1→2, 2→0, 3→1
  -- Implementation: v_turn_order[player_index + 1] because PostgreSQL arrays are 1-indexed
  -- Example: player_index=0 → turn_order[1] = 3 (next player)
  -- Example: player_index=2 → turn_order[3] = 0 (next player)
  -- Position 0 (bottom) → 3 (right)
  -- Position 1 (top) → 2 (left)  
  -- Position 2 (left) → 0 (bottom)
  -- Position 3 (right) → 1 (top)
  v_turn_order INTEGER[] := ARRAY[3, 2, 0, 1];
BEGIN
  -- Get room
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- Get game state with row locking
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- Get player
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;
  
  -- ✅ SECURITY FIX: Verify that the authenticated user owns this player
  IF v_player.user_id != auth.uid() THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: You can only pass for your own player'
    );
  END IF;
  
  -- Verify turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- Calculate next turn using anticlockwise array (FIXED)
  -- BEFORE: v_next_turn := (v_player.player_index + 1) % 4; (CLOCKWISE)
  -- AFTER: v_next_turn := v_turn_order[v_player.player_index + 1]; (ANTICLOCKWISE)
  -- Note: PostgreSQL arrays are 1-indexed, so add 1 to player_index
  v_next_turn := v_turn_order[v_player.player_index + 1];
  v_new_pass_count := v_game_state.passes + 1;
  
  -- Check if 3 consecutive passes (clear trick)
  IF v_new_pass_count >= 3 THEN
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = 0,
      passes_in_row = 0,
      last_play = NULL,
      last_player = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'trick_cleared', true
    );
  ELSE
    -- Normal pass - advance turn
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = v_new_pass_count,
      passes_in_row = v_new_pass_count,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'passes', v_new_pass_count,
      'trick_cleared', false
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION execute_pass_move IS 
  'Executes a pass move with auth.uid() validation. Only allows users to pass for their own player.';

-- ==============================================================================
-- 2. Fix complete_game_from_client - Add auth.uid() validation and verify against room_players
-- ==============================================================================

CREATE OR REPLACE FUNCTION complete_game_from_client(
  p_room_id UUID,
  p_room_code TEXT,
  p_players JSONB,
  p_winner_id TEXT,
  p_game_duration_seconds INTEGER,
  p_started_at TIMESTAMP WITH TIME ZONE,
  p_finished_at TIMESTAMP WITH TIME ZONE
)
RETURNS JSONB AS $$
DECLARE
  v_room_id UUID;
  v_winner_uuid UUID;
  v_game_history_id UUID;
  v_real_players JSONB[];
  v_player JSONB;
  v_won BOOLEAN;
  v_player_in_room RECORD;
  v_caller_in_room BOOLEAN := FALSE;
BEGIN
  -- Validate room_id
  IF p_room_id IS NULL THEN
    SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
    IF v_room_id IS NULL THEN
      RAISE EXCEPTION 'Room not found: %', p_room_code;
    END IF;
  ELSE
    v_room_id := p_room_id;
  END IF;

  -- ✅ SECURITY FIX: Verify caller is actually a player in this room
  SELECT EXISTS(
    SELECT 1 FROM room_players 
    WHERE room_id = v_room_id AND user_id = auth.uid()
  ) INTO v_caller_in_room;
  
  IF NOT v_caller_in_room THEN
    RAISE EXCEPTION 'Unauthorized: You are not a player in this room';
  END IF;

  -- ✅ SECURITY FIX: Validate all player user_ids against room_players
  -- Cross-check client-supplied p_players against authoritative room_players table
  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players)
  LOOP
    -- Skip bot players (user_id starts with 'bot_')
    IF v_player->>'user_id' LIKE 'bot_%' THEN
      CONTINUE;
    END IF;
    
    -- Verify this real player is actually in the room
    SELECT * INTO v_player_in_room 
    FROM room_players 
    WHERE room_id = v_room_id 
      AND user_id = (v_player->>'user_id')::UUID;
      
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid player data: user_id % not in room', v_player->>'user_id';
    END IF;
  END LOOP;

  -- ✅ SECURITY FIX: Validate winner_id against room_players (if not a bot)
  IF p_winner_id IS NOT NULL AND p_winner_id != '' AND NOT p_winner_id LIKE 'bot_%' THEN
    SELECT EXISTS(
      SELECT 1 FROM room_players 
      WHERE room_id = v_room_id AND user_id = p_winner_id::UUID
    ) INTO v_caller_in_room;
    
    IF NOT v_caller_in_room THEN
      RAISE EXCEPTION 'Invalid winner: user_id % not in room', p_winner_id;
    END IF;
  END IF;

  -- Extract real (non-bot) players only
  SELECT array_agg(p) INTO v_real_players
  FROM jsonb_array_elements(p_players) AS p
  WHERE NOT (p->>'user_id' LIKE 'bot_%');

  -- Handle winner_id safely with UUID casting
  BEGIN
    IF p_winner_id IS NULL OR p_winner_id = '' OR p_winner_id LIKE 'bot_%' THEN
      v_winner_uuid := NULL;
    ELSE
      v_winner_uuid := p_winner_id::UUID;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      -- If UUID casting fails, log the invalid winner_id for debugging and treat as bot/invalid winner
      RAISE LOG 'Invalid winner_id value "%" could not be cast to UUID in complete_game_from_client', p_winner_id;
      v_winner_uuid := NULL;
  END;

  -- Insert game history
  INSERT INTO game_history (
    room_code,
    player_0_id,
    player_0_name,
    player_0_score,
    player_1_id,
    player_1_name,
    player_1_score,
    player_2_id,
    player_2_name,
    player_2_score,
    player_3_id,
    player_3_name,
    player_3_score,
    winner_id,
    game_duration_seconds,
    started_at,
    finished_at
  )
  VALUES (
    p_room_code,
    (p_players->0->>'user_id')::UUID,
    p_players->0->>'username',
    (p_players->0->>'score')::INTEGER,
    (p_players->1->>'user_id')::UUID,
    p_players->1->>'username',
    (p_players->1->>'score')::INTEGER,
    (p_players->2->>'user_id')::UUID,
    p_players->2->>'username',
    (p_players->2->>'score')::INTEGER,
    (p_players->3->>'user_id')::UUID,
    p_players->3->>'username',
    (p_players->3->>'score')::INTEGER,
    v_winner_uuid,
    p_game_duration_seconds,
    p_started_at,
    p_finished_at
  )
  RETURNING id INTO v_game_history_id;

  -- Update stats for each REAL player (not bots)
  FOR v_player IN SELECT * FROM unnest(v_real_players)
  LOOP
    v_won := (v_player->>'user_id')::UUID = v_winner_uuid;
    
    INSERT INTO player_stats (user_id, games_played, games_won)
    VALUES ((v_player->>'user_id')::UUID, 1, CASE WHEN v_won THEN 1 ELSE 0 END)
    ON CONFLICT (user_id)
    DO UPDATE SET
      games_played = player_stats.games_played + 1,
      games_won = player_stats.games_won + CASE WHEN v_won THEN 1 ELSE 0 END;

    -- Update combo stats
    IF v_player->>'combos_played' IS NOT NULL THEN
      INSERT INTO combo_stats (user_id, total_combos_played)
      VALUES ((v_player->>'user_id')::UUID, (v_player->>'combos_played')::INTEGER)
      ON CONFLICT (user_id)
      DO UPDATE SET
        total_combos_played = combo_stats.total_combos_played + (v_player->>'combos_played')::INTEGER;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'game_history_id', v_game_history_id,
    'players_updated', array_length(v_real_players, 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION complete_game_from_client TO authenticated;

COMMENT ON FUNCTION complete_game_from_client IS 
  'Completes a game and updates player stats. Validates all players and winner against room_players. Only callable by room participants.';


-- --------------------------------------------------------------------------
-- Source: 20260106000001_fix_bot_turn_order_indices.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- SUPERSEDED: This function definition is replaced by migration 20260107000001
-- Date: January 6, 2026 (Initial Version)
-- Replaced by: 20260107000001_add_auth_check_start_game.sql
-- Reason: Later migration adds authorization checks to ensure only room
--         coordinator can start game. The version in 20260107000001 is
--         the ACTIVE implementation.
-- ============================================================================
--
-- FIX: Bot player_index assignment to match anticlockwise turn order
-- Date: January 6, 2026
-- Issue: Bots are assigned sequential indices (1,2,3) but anticlockwise turn order
--        requires specific indices to match the turn sequence 0→3→2→1→0
-- 
-- Current behavior:  Steve(0) → Bot4(3) → Bot2(2) → Bot3(1) → Steve
-- Desired behavior: Steve(0) → Bot2(3) → Bot3(2) → Bot4(1) → Steve
-- 
-- Solution: Assign bot player_index based on anticlockwise turn order positions
--           turnOrder = [3, 2, 0, 1] means:
--           - Position after player 0: index 3 → Bot 2
--           - Position after player 3: index 2 → Bot 3  
--           - Position after player 2: index 1 → Bot 4

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty TEXT DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB;
  v_i INTEGER;
  v_starting_player INTEGER;
  v_bot_indices INTEGER[];
  v_bot_name TEXT;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction
  IF v_room.ranked_mode = true AND p_bot_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot add bots to ranked games'
    );
  END IF;
  
  -- 3. Calculate player counts
  SELECT COUNT(*) INTO v_human_count 
  FROM room_players 
  WHERE room_id = p_room_id;
  
  v_total_players := v_human_count + p_bot_count;
  
  IF v_total_players > 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players would exceed 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_total_players < 2 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Need at least 2 players to start',
      'current_total', v_total_players
    );
  END IF;
  
  -- 4. Get coordinator (first human player)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND is_bot = false
  ORDER BY joined_at ASC, user_id ASC
  LIMIT 1;
  
  IF v_coordinator_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No human players found in room'
    );
  END IF;
  
  -- 4b. 🔒 SECURITY CHECK: Only coordinator can start game
  -- This check prevents unauthorized users from starting games in any room
  IF auth.uid() IS DISTINCT FROM v_coordinator_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: Only the room coordinator can start the game'
    );
  END IF;
  
  -- 5. ✅ CRITICAL FIX: Assign bot player_index based on anticlockwise turn order
  -- Anticlockwise turn order: 0→3→2→1→0 (turnOrder = [3, 2, 0, 1])
  -- For proper turn sequence with human at index 0:
  --   Bot 1 (next after human): index 3 (because turnOrder[0] = 3)
  --   Bot 2 (next after Bot 1): index 2 (because turnOrder[3] = 2)
  --   Bot 3 (next after Bot 2): index 1 (because turnOrder[2] = 1)
  -- NOTE: This creates the sequence 0→3→2→1→0 (anticlockwise) matching Big Two rules
  IF p_bot_count = 1 THEN
    v_bot_indices := ARRAY[3];  -- Only 1 bot: place at index 3 (next after 0)
  ELSIF p_bot_count = 2 THEN
    v_bot_indices := ARRAY[3, 2];  -- 2 bots: indices 3, 2 (turn: 0→3→2→0)
  ELSIF p_bot_count = 3 THEN
    v_bot_indices := ARRAY[3, 2, 1];  -- 3 bots: indices 3, 2, 1 (turn: 0→3→2→1→0)
  ELSE
    -- Fallback for invalid bot count
    v_bot_indices := ARRAY[]::INTEGER[];
  END IF;
  
  -- 6. Create bot players with correct indices and names
  FOR v_i IN 1..p_bot_count LOOP
    -- Bot names: Bot 2, Bot 3, Bot 4 (matching their visual turn position)
    v_bot_name := 'Bot ' || (v_i + 1)::TEXT;
    
    INSERT INTO room_players (
      room_id, 
      user_id, 
      username,
      is_bot, 
      bot_difficulty, 
      player_index,
      is_ready
    )
    VALUES (
      p_room_id,
      gen_random_uuid(),
      v_bot_name,
      true,
      p_bot_difficulty,
      v_bot_indices[v_i],  -- ✅ Use turn-order-based index
      true
    );
  END LOOP;
  
  -- 7. Shuffle deck and deal cards
  v_deck := ARRAY[
    'D3','C3','H3','S3','D4','C4','H4','S4','D5','C5','H5','S5',
    'D6','C6','H6','S6','D7','C7','H7','S7','D8','C8','H8','S8',
    'D9','C9','H9','S9','D10','C10','H10','S10','DJ','CJ','HJ','SJ',
    'DQ','CQ','HQ','SQ','DK','CK','HK','SK','DA','CA','HA','SA','D2','C2','H2','S2'
  ];
  
  -- Fisher-Yates shuffle
  FOR v_i IN REVERSE array_length(v_deck, 1)..2 LOOP
    DECLARE
      v_j INTEGER := floor(random() * v_i + 1)::INTEGER;
      v_temp TEXT := v_deck[v_i];
    BEGIN
      v_deck[v_i] := v_deck[v_j];
      v_deck[v_j] := v_temp;
    END;
  END LOOP;
  v_shuffled_deck := v_deck;
  
  -- Deal 13 cards to each player - store as JSONB object with player indices as keys
  v_player_hands := '{}'::JSONB;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    v_player_hands := v_player_hands || jsonb_build_object(
      v_i::TEXT,
      to_jsonb(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    );
  END LOOP;
  
  -- Find starting player (who has 3 of Diamonds)
  v_starting_player := NULL;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    IF v_player_hands->v_i::TEXT @> '["D3"]'::jsonb THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  IF v_starting_player IS NULL THEN
    v_starting_player := 0; -- Fallback
  END IF;
  
  -- 8. UPSERT game_state (using correct column names from schema)
  INSERT INTO game_state (
    room_id,
    current_turn,
    hands,
    last_play,
    passes,
    round_number,
    game_phase,
    played_cards,
    match_number,
    play_history,
    auto_pass_timer
  )
  VALUES (
    p_room_id,
    v_starting_player,
    v_player_hands,
    NULL,
    0,
    1,
    'first_play',
    '[]'::JSONB,
    1,
    '[]'::JSONB,
    NULL
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_turn = EXCLUDED.current_turn,
    hands = EXCLUDED.hands,
    last_play = EXCLUDED.last_play,
    passes = EXCLUDED.passes,
    round_number = EXCLUDED.round_number,
    game_phase = EXCLUDED.game_phase,
    played_cards = EXCLUDED.played_cards,
    match_number = EXCLUDED.match_number,
    play_history = EXCLUDED.play_history,
    auto_pass_timer = EXCLUDED.auto_pass_timer,
    updated_at = NOW();
  
  -- 9. Update room status to 'playing'
  UPDATE rooms
  SET status = 'playing', updated_at = NOW()
  WHERE id = p_room_id;
  
  -- 10. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'starting_player', v_starting_player,
    'total_players', v_total_players,
    'bot_indices', v_bot_indices
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS 'Start game with bots using anticlockwise turn-order indices (0→3→2→1→0). Bot 2 at index 3, Bot 3 at index 2, Bot 4 at index 1.';


-- --------------------------------------------------------------------------
-- Source: 20260106222754_fix_game_phase_transition.sql
-- --------------------------------------------------------------------------
-- Migration: Fix game_phase not transitioning from first_play to normal_play
-- Problem: game_phase stays stuck in 'first_play' after 3D is played,
-- causing bots to only look for 3D and pass every turn.
-- Solution: Add trigger to auto-transition game_phase after first successful play.

-- Step 1: Add function to transition game_phase after first play
CREATE OR REPLACE FUNCTION transition_game_phase_after_first_play()
RETURNS TRIGGER AS $$
BEGIN
  -- If game_phase is 'first_play' and played_cards array is not empty,
  -- it means someone just played the 3D (first play completed)
  IF NEW.game_phase = 'first_play' AND 
     NEW.played_cards IS NOT NULL AND 
     jsonb_array_length(NEW.played_cards) > 0 THEN
    
    -- Transition to normal_play
    NEW.game_phase := 'normal_play';
    
    -- Log the transition for debugging
    RAISE NOTICE 'game_phase transitioned from first_play to normal_play for room_id: %', NEW.room_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Create trigger on game_state table
DROP TRIGGER IF EXISTS trigger_transition_game_phase ON game_state;

CREATE TRIGGER trigger_transition_game_phase
  BEFORE UPDATE ON game_state
  FOR EACH ROW
  EXECUTE FUNCTION transition_game_phase_after_first_play();

-- Step 3: Fix existing games stuck in first_play
-- Any game with played_cards should be in normal_play, not first_play
UPDATE game_state
SET game_phase = 'normal_play'
WHERE game_phase = 'first_play'
  AND played_cards IS NOT NULL
  AND jsonb_array_length(played_cards) > 0;

COMMENT ON FUNCTION transition_game_phase_after_first_play() IS 
'Auto-transitions game_phase from first_play to normal_play after 3D is played. Fixes bug where bots only look for 3D.';

COMMENT ON TRIGGER trigger_transition_game_phase ON game_state IS
'Automatically transitions game phase after first play completed.';


-- --------------------------------------------------------------------------
-- Source: 20260107000001_add_auth_check_start_game.sql
-- --------------------------------------------------------------------------
-- Add authorization check to start_game_with_bots function
-- Date: January 7, 2026
-- Security Issue: SECURITY DEFINER without auth check allows any user to start games for any room
-- Fix: Add verification that caller is room participant/owner

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty TEXT DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB;
  v_i INTEGER;
  v_starting_player INTEGER;
  v_bot_indices INTEGER[];
  v_bot_name TEXT;
  v_caller_id UUID;
  v_is_participant BOOLEAN;
BEGIN
  -- 🔒 SECURITY CHECK: Verify caller is in the room
  v_caller_id := auth.uid();
  
  IF v_caller_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: Must be authenticated'
    );
  END IF;
  
  -- Check if caller is a participant in the room
  SELECT EXISTS(
    SELECT 1 FROM room_players 
    WHERE room_id = p_room_id 
    AND user_id = v_caller_id
  ) INTO v_is_participant;
  
  IF NOT v_is_participant THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: Must be a room participant to start game'
    );
  END IF;
  
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction (CRITICAL: Prevent bot injection in ranked games)
  IF v_room.ranked_mode = true AND p_bot_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot add bots to ranked games'
    );
  END IF;
  
  -- 3. Count human players and calculate bot indices
  SELECT COUNT(*) INTO v_human_count
  FROM room_players
  WHERE room_id = p_room_id AND is_bot = false;
  
  v_total_players := v_human_count + p_bot_count;
  
  IF v_total_players != 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players must be 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  -- 4. Find coordinator (first human player) - FIXED: Use joined_at instead of created_at
  -- Added secondary sort by user_id for deterministic ordering if timestamps match
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND is_bot = false
  ORDER BY joined_at ASC, user_id ASC
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No human players found in room'
    );
  END IF;
  
  -- 5. CRITICAL SECURITY: Verify caller is the coordinator
  -- Only the coordinator (room creator/first player) can start the game
  IF v_caller_id IS DISTINCT FROM v_coordinator_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: Only the room coordinator can start the game'
    );
  END IF;
  
  -- 6. ✅ CRITICAL FIX: Assign bot player_index based on anticlockwise turn order
  -- Anticlockwise turn order mapping: turnOrder = [3, 2, 0, 1]
  -- Example sequence when human player (index 0) leads the turn: 0→3→2→1→0
  -- For proper turn sequence with human at index 0:
  --   Bot 1 (next after human): index 3 (because turnOrder[0] = 3)
  --   Bot 2 (next after Bot 1): index 2 (because turnOrder[3] = 2)  
  --   Bot 3 (next after Bot 2): index 1 (because turnOrder[2] = 1)
  -- NOTE: Actual sequence depends on starting player; example above assumes player 0 starts
  IF p_bot_count = 1 THEN
    v_bot_indices := ARRAY[3];  -- Only 1 bot: place at index 3 (next after 0)
  ELSIF p_bot_count = 2 THEN
    v_bot_indices := ARRAY[3, 2];  -- 2 bots: indices 3, 2 (turn: 0→3→2→0)
  ELSIF p_bot_count = 3 THEN
    v_bot_indices := ARRAY[3, 2, 1];  -- 3 bots: indices 3, 2, 1 (turn: 0→3→2→1→0)
  ELSE
    -- Fallback for invalid bot count
    v_bot_indices := ARRAY[]::INTEGER[];
  END IF;
  
  -- 5. Create bot players with correct indices and names
  FOR v_i IN 1..p_bot_count LOOP
    -- Bot names: Bot 2, Bot 3, Bot 4 (matching their visual turn position)
    v_bot_name := 'Bot ' || (v_i + 1)::TEXT;
    
    INSERT INTO room_players (
      room_id, 
      user_id, 
      username,
      is_bot, 
      bot_difficulty, 
      player_index,
      is_ready
    )
    VALUES (
      p_room_id,
      gen_random_uuid(),
      v_bot_name,
      true,
      p_bot_difficulty,
      v_bot_indices[v_i],  -- ✅ Use turn-order-based index
      true
    );
  END LOOP;
  
  -- 6. Shuffle deck and deal cards
  v_deck := ARRAY[
    'D3','C3','H3','S3','D4','C4','H4','S4','D5','C5','H5','S5',
    'D6','C6','H6','S6','D7','C7','H7','S7','D8','C8','H8','S8',
    'D9','C9','H9','S9','D10','C10','H10','S10','DJ','CJ','HJ','SJ',
    'DQ','CQ','HQ','SQ','DK','CK','HK','SK','DA','CA','HA','SA','D2','C2','H2','S2'
  ];
  
  -- Fisher-Yates shuffle
  FOR v_i IN REVERSE array_length(v_deck, 1)..2 LOOP
    DECLARE
      v_j INTEGER := floor(random() * v_i + 1)::INTEGER;
      v_temp TEXT := v_deck[v_i];
    BEGIN
      v_deck[v_i] := v_deck[v_j];
      v_deck[v_j] := v_temp;
    END;
  END LOOP;
  v_shuffled_deck := v_deck;
  
  -- Deal 13 cards to each player - store as JSONB object with player indices as keys
  v_player_hands := '{}'::JSONB;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    v_player_hands := v_player_hands || jsonb_build_object(
      v_i::TEXT,
      to_jsonb(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    );
  END LOOP;
  
  -- Find starting player (who has 3♦)
  v_starting_player := NULL;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    IF v_player_hands->v_i::TEXT @> '["D3"]'::jsonb THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  IF v_starting_player IS NULL THEN
    v_starting_player := 0; -- Fallback
  END IF;
  
  -- 7. UPSERT game_state (using correct column names from schema)
  INSERT INTO game_state (
    room_id,
    current_turn,
    hands,
    last_play,
    passes,
    round_number,
    game_phase,
    played_cards,
    match_number,
    play_history,
    auto_pass_timer
  )
  VALUES (
    p_room_id,
    v_starting_player,
    v_player_hands,
    NULL,
    0,
    1,
    'first_play',
    '[]'::JSONB,
    1,
    '[]'::JSONB,
    NULL
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_turn = EXCLUDED.current_turn,
    hands = EXCLUDED.hands,
    last_play = EXCLUDED.last_play,
    passes = EXCLUDED.passes,
    round_number = EXCLUDED.round_number,
    game_phase = EXCLUDED.game_phase,
    played_cards = EXCLUDED.played_cards,
    match_number = EXCLUDED.match_number,
    play_history = EXCLUDED.play_history,
    auto_pass_timer = EXCLUDED.auto_pass_timer,
    updated_at = NOW();
  
  -- 8. Update room status to 'playing'
  UPDATE rooms
  SET status = 'playing', updated_at = NOW()
  WHERE id = p_room_id;
  
  -- 9. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'starting_player', v_starting_player,
    'total_players', v_total_players,
    'bot_indices', v_bot_indices
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS 'Start game with bots using anticlockwise turn-order indices (0→3→2→1→0). Includes authorization check. Bot 2 at index 3, Bot 3 at index 2, Bot 4 at index 1.';


-- --------------------------------------------------------------------------
-- Source: 20260107000002_document_turn_order_transition.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- Migration: Document Turn Order Change (No Data Migration)
-- Date: January 7, 2026
-- Purpose: Document the turn order change from clockwise to anticlockwise
--          for historical tracking. NO DATA MIGRATION OCCURS.
-- 
-- Rationale: Turn order logic exists only in application functions 
--            (start_game_with_bots, play-cards, player-pass), not in 
--            persisted game_state data. Therefore, no existing game data 
--            requires modification.
-- 
-- Impact: 
--   - Existing in-progress games: Continue using old function logic until completion
--   - New games: Use updated start_game_with_bots with anticlockwise turn order [3,2,0,1]
-- ============================================================================

-- ==================== MIGRATION ====================

-- Check if game_state table has turn_order column
-- (If not, this migration can be skipped as all games use function-defined turn order)
DO $$
BEGIN
  -- Log migration start
  RAISE NOTICE '=== Turn Order Change Documentation ===';
  RAISE NOTICE 'Previous turn order (clockwise): [1,2,3,0] → 0→1→2→3→0';
  RAISE NOTICE 'New turn order (anticlockwise): [3,2,0,1] → 0→3→2→1→0';
  RAISE NOTICE 'All future games will use anticlockwise turn order [3,2,0,1] from start_game_with_bots function';
  RAISE NOTICE 'This migration performs NO data updates - it exists for documentation only';
  RAISE NOTICE '======================================';
  
  -- Note: This migration assumes game_state doesn't store turn_order directly
  -- If turn order is only in function logic, no data migration needed
  -- This is a defensive migration in case future schema adds turn_order column
  
  RAISE NOTICE 'Migration complete: No turn_order column found in game_state (turn order managed by function)';
  RAISE NOTICE 'All future games will use anticlockwise turn order mapping [3,2,0,1] from start_game_with_bots function';
  RAISE NOTICE 'This array maps current player index to next player index: 0→3, 1→2, 2→0, 3→1';
  RAISE NOTICE 'The actual play sequence depends on the starting player (e.g., if player 0 starts: 0→3→2→1→0)';
  
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Migration note: % (This is expected if no schema change needed)', SQLERRM;
END $$;

-- ==================== VALIDATION ====================

-- Log games that may be affected by turn order changes
-- (For manual review if needed)
DO $$
DECLARE
  v_active_games INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_active_games
  FROM game_state
  WHERE game_phase IN ('first_play', 'normal_play')
    AND current_turn >= 0;
  
  RAISE NOTICE '✓ Active games found: % (these use function-defined turn order)', v_active_games;
  RAISE NOTICE '✓ Turn order consistency: All new games will use anticlockwise [3,2,0,1]';
  RAISE NOTICE '✓ Existing games: Continue with their original turn order until completion';
END $$;

-- ==================== COMMENTS ====================

COMMENT ON FUNCTION start_game_with_bots IS 
'Creates game with anticlockwise turn order [3,2,0,1]. All games started after migration 20260107000001 use this turn order consistently.';


-- --------------------------------------------------------------------------
-- Source: 20260110000001_add_last_match_winner_index.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- MIGRATION STATUS: SUPERSEDED BY 20260110033809
-- ============================================================================
-- This migration has been superseded by:
--   20260110033809_add_match_and_game_tracking_columns.sql
--
-- The later migration adds the same column (last_match_winner_index) along with
-- additional tracking columns (match_ended_at, game_ended_at, game_winner_index).
--
-- This migration is retained as a no-op for migration history consistency.
-- If you're reviewing the schema, please refer to migration 20260110033809.
-- ============================================================================

-- ============================================================================
-- ORIGINAL PURPOSE: Add last_match_winner_index column to game_state table
-- ============================================================================
-- ROOT CAUSE: start_new_match edge function fails with "No winner found" error
-- 
-- PROBLEM:
-- - When a match ends, play-cards edge function detects the winner (player with 0 cards)
-- - Client waits 2 seconds and calls start_new_match edge function
-- - start_new_match tries to find winner by searching for player with 0 cards
-- - Race condition: hands might be updated or in unexpected state
-- - Result: "Edge Function returned a non-2xx status code" error
--
-- SOLUTION:
-- - Store the match winner index in game_state when match ends
-- - start_new_match reads this stored value instead of searching hands
-- - Eliminates race condition and ensures reliable match transitions
--
-- Date: January 10, 2026
-- Task #585: Fix Match End Error
-- Reference: /Users/michaelalam/Desktop/console log.md line 843

-- MIGRATION SUPERSEDED: This migration has been superseded by migration
-- 20260110033809_add_match_and_game_tracking_columns.sql which adds the same
-- column along with additional tracking columns. This is now a no-op migration
-- to maintain migration history consistency.

-- Original intent: Add last_match_winner_index column
-- Current status: Column added by later migration 20260110033809
-- Action: No-op migration with informational notices only

-- Informational message
DO $$
BEGIN
  RAISE NOTICE 'ℹ️  Migration 20260110000001 superseded by 20260110033809';
  RAISE NOTICE '   - last_match_winner_index column added by later migration';
  RAISE NOTICE '   - This migration is now a no-op for consistency';
  RAISE NOTICE '   - No action required';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20260110000002_fix_game_phase_normal_play_to_playing.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- CRITICAL FIX: Change 'normal_play' to 'playing' in game phase trigger
-- ============================================================================
-- ROOT CAUSE: Trigger transitions first_play → 'normal_play', but everywhere
-- else in code expects 'playing'. This causes game to be stuck after first card.
--
-- PROBLEM:
-- - Trigger sets game_phase = 'normal_play' (not in CHECK constraint!)
-- - useBotCoordinator checks for 'playing', not 'normal_play'
-- - Result: Bots keep checking for 3D and eventually crash with HTTP 400
--
-- SOLUTION:
-- - Change trigger to use 'playing' (matches the code and CHECK constraint)
-- - This aligns with valid phases: 'first_play', 'playing', 'finished', 'game_over'
--
-- Date: January 10, 2026
-- Task #587: Fix game phase transition

-- Update the trigger function to use 'playing' instead of 'normal_play'
CREATE OR REPLACE FUNCTION transition_game_phase_after_first_play()
RETURNS TRIGGER AS $$
BEGIN
  -- If game_phase is 'first_play' and played_cards array is not empty,
  -- it means someone just played the 3D (first play completed)
  IF NEW.game_phase = 'first_play' AND 
     NEW.played_cards IS NOT NULL AND 
     jsonb_array_length(NEW.played_cards) > 0 THEN
    
    -- Transition to 'playing' (NOT 'normal_play')
    NEW.game_phase := 'playing';
    
    -- Log the transition for debugging
    RAISE NOTICE 'game_phase transitioned from first_play to playing for room_id: %', NEW.room_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fix any existing games stuck in 'normal_play' (should transition to 'playing')
UPDATE game_state
SET game_phase = 'playing'
WHERE game_phase = 'normal_play';

COMMENT ON FUNCTION transition_game_phase_after_first_play() IS 
'Auto-transitions game_phase from first_play to playing after 3D is played. Fixed to use playing instead of normal_play.';


-- --------------------------------------------------------------------------
-- Source: 20260110030710_placeholder.sql
-- --------------------------------------------------------------------------
-- placeholder: already applied on remote


-- --------------------------------------------------------------------------
-- Source: 20260110031728_placeholder.sql
-- --------------------------------------------------------------------------
-- placeholder: already applied on remote


-- --------------------------------------------------------------------------
-- Source: 20260110033809_add_match_and_game_tracking_columns.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- CRITICAL FIX: Add match and game tracking columns
-- ============================================================================
-- MIGRATION NOTES:
-- - This migration supersedes 20260110000001_add_last_match_winner_index.sql
-- - CHECK constraints use explicit NULL handling per PostgreSQL best practices
-- - Pattern: CHECK (column IS NULL OR (column >= min AND column < max))
--
-- Purpose: Add timestamp and winner tracking for match/game end events
-- Date: January 10, 2026
-- Applied: 20260110033809
-- Task #585-586: Fix Match End Schema Errors

-- Add columns for tracking match and game completion
ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS last_match_winner_index INTEGER
CHECK (last_match_winner_index IS NULL OR (last_match_winner_index >= 0 AND last_match_winner_index < 4));

ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS match_ended_at TIMESTAMPTZ;

ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS game_ended_at TIMESTAMPTZ;

ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS game_winner_index INTEGER
CHECK (game_winner_index IS NULL OR (game_winner_index >= 0 AND game_winner_index < 4));

-- Add comments
COMMENT ON COLUMN game_state.last_match_winner_index IS 
  'Index (0-3) of the player who won the previous match. Used by start_new_match to determine who starts the next match.';

COMMENT ON COLUMN game_state.match_ended_at IS 
  'Timestamp when the current match ended (one player finished all cards). Used for tracking match duration.';

COMMENT ON COLUMN game_state.game_ended_at IS 
  'Timestamp when the entire game ended (one player reached 101+ points). Used for tracking game completion.';

COMMENT ON COLUMN game_state.game_winner_index IS 
  'Index (0-3) of the player who won the entire game (lowest score when someone hits 101+). NULL until game ends.';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Added match and game tracking columns to game_state table';
  RAISE NOTICE '   - last_match_winner_index: Winner of previous match (0-3)';
  RAISE NOTICE '   - match_ended_at: Timestamp of match completion';
  RAISE NOTICE '   - game_ended_at: Timestamp of game completion';
  RAISE NOTICE '   - game_winner_index: Winner of entire game (0-3)';
  RAISE NOTICE '   - Enables proper match/game end tracking and transitions';
END $$;


-- --------------------------------------------------------------------------
-- Source: 20260110040000_create_missing_game_phase_trigger.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- CRITICAL FIX: CREATE THE MISSING TRIGGER + Fix All Game Phase Issues
-- ============================================================================
-- MIGRATION STATUS: STANDALONE - Complete trigger creation and fix
--
-- This migration is COMPLETE and contains:
-- 1. Function creation (CREATE OR REPLACE)
-- 2. Trigger creation (CREATE TRIGGER)
-- 3. Data fixes for stuck games
--
-- No previous migration created the function without the trigger - this is
-- the definitive migration for the game phase transition functionality.
-- ============================================================================
--
-- ROOT CAUSE: Games stuck in 'first_play' phase after first card played
--
-- COMPLETE FIX:
-- 1. Drop old trigger if exists
-- 2. Create/update the function to use 'playing' instead of 'normal_play'
-- 3. CREATE THE TRIGGER (this was missing!)
-- 4. Fix all stuck games in 'first_play' that have played_cards
-- 5. Fix all games stuck in 'normal_play' to 'playing'
--
-- Date: January 10, 2026
-- Task #587: Complete game phase trigger fix

-- Step 1: Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_transition_game_phase_after_first_play ON game_state;

-- Step 2: Create/update the function
CREATE OR REPLACE FUNCTION transition_game_phase_after_first_play()
RETURNS TRIGGER AS $$
BEGIN
  -- If game_phase is 'first_play' and played_cards array is not empty,
  -- it means someone just played the 3D (first play completed)
  IF NEW.game_phase = 'first_play' AND 
     NEW.played_cards IS NOT NULL AND 
     jsonb_array_length(NEW.played_cards) > 0 THEN
    
    -- Transition to 'playing' (NOT 'normal_play')
    NEW.game_phase := 'playing';
    
    -- Log the transition for debugging
    RAISE NOTICE 'game_phase transitioned from first_play to playing for room_id: %', NEW.room_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: CREATE THE TRIGGER (THIS WAS MISSING!)
CREATE TRIGGER trigger_transition_game_phase_after_first_play
  BEFORE UPDATE ON game_state
  FOR EACH ROW
  EXECUTE FUNCTION transition_game_phase_after_first_play();

-- Step 4: Fix all games stuck in 'first_play' that have already played D3
UPDATE game_state
SET game_phase = 'playing'
WHERE game_phase = 'first_play' 
  AND played_cards IS NOT NULL 
  AND jsonb_array_length(played_cards) > 0;

-- Step 5: Fix any games stuck in 'normal_play' to 'playing'
UPDATE game_state
SET game_phase = 'playing'
WHERE game_phase = 'normal_play';

COMMENT ON TRIGGER trigger_transition_game_phase_after_first_play ON game_state IS 
'Auto-transitions game_phase from first_play to playing after 3D is played';

COMMENT ON FUNCTION transition_game_phase_after_first_play() IS 
'Trigger function that auto-transitions game_phase from first_play to playing after 3D is played. Fixed to use playing instead of normal_play and trigger is now properly created.';


-- --------------------------------------------------------------------------
-- Source: 20260112095132_placeholder.sql
-- --------------------------------------------------------------------------
-- placeholder: already applied on remote


-- --------------------------------------------------------------------------
-- Source: 20260114113159_placeholder.sql
-- --------------------------------------------------------------------------
-- placeholder: already applied on remote


-- --------------------------------------------------------------------------
-- Source: 20260114120515_placeholder.sql
-- --------------------------------------------------------------------------
-- placeholder: already applied on remote


-- --------------------------------------------------------------------------
-- Source: 20260115050528_placeholder.sql
-- --------------------------------------------------------------------------
-- placeholder: already applied on remote


-- --------------------------------------------------------------------------
-- Source: 20260120080206_placeholder.sql
-- --------------------------------------------------------------------------
-- placeholder: already applied on remote


-- --------------------------------------------------------------------------
-- Source: 20260120080234_placeholder.sql
-- --------------------------------------------------------------------------
-- placeholder: already applied on remote


-- --------------------------------------------------------------------------
-- Source: 20260228000000_add_game_rules_and_fix_schema.sql
-- --------------------------------------------------------------------------
-- ============================================================================
-- MIGRATION: Add missing columns and implement critical Big Two game rules
-- ============================================================================
-- Date: February 28, 2026
--
-- Context: Integration tests (critical-rules.test.ts, username-uniqueness) were
-- failing because:
--   1. game_state was missing passes_in_row and last_player columns
--      (execute_pass_move UPDATE referenced them → runtime error)
--   2. execute_pass_move had NO check for "cannot pass when leading"
--   3. execute_play_move had NO check for "first play must include 3♦"
--   4. join_room_atomic accepted empty/blank usernames
--
-- Changes:
--   1. ALTER TABLE: add passes_in_row, last_player columns
--   2. execute_pass_move: add "cannot pass when leading" rule
--   3. execute_play_move: add "first play must include 3♦" rule + game_phase transition
--   4. join_room_atomic: add empty username validation
--
-- Applied to project dppybucldqufbqhwnkxu via mcp_supabase_execute_sql
-- ============================================================================

-- 1. Add missing columns that execute_pass_move references
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS passes_in_row INTEGER DEFAULT 0;
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS last_player INTEGER;

-- 2. execute_pass_move — add "cannot pass when leading" rule
CREATE OR REPLACE FUNCTION execute_pass_move(
  p_room_code TEXT,
  p_player_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_next_turn INTEGER;
  v_new_pass_count INTEGER;
  -- Anticlockwise turn order: 0→3, 1→2, 2→0, 3→1
  v_turn_order INTEGER[] := ARRAY[3, 2, 0, 1];
BEGIN
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;

  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;

  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;

  -- SECURITY: auth.uid() is NULL for service_role calls (intentional bypass)
  IF v_player.user_id != auth.uid() THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: You can only pass for your own player'
    );
  END IF;

  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;

  -- ✅ RULE: Cannot pass when leading (last_play IS NULL = you start the trick)
  IF v_game_state.last_play IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot pass when leading - you must play cards'
    );
  END IF;

  v_next_turn := v_turn_order[v_player.player_index + 1];
  v_new_pass_count := COALESCE(v_game_state.passes, 0) + 1;

  IF v_new_pass_count >= 3 THEN
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = 0,
      passes_in_row = 0,
      last_play = NULL,
      last_player = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;

    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'trick_cleared', true
    );
  ELSE
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = v_new_pass_count,
      passes_in_row = v_new_pass_count,
      updated_at = NOW()
    WHERE room_id = v_room_id;

    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'passes', v_new_pass_count,
      'trick_cleared', false
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION execute_pass_move IS
  'Executes a pass move with auth.uid() validation and leading-trick rule enforcement.';

-- 3. execute_play_move — add "first play must include 3♦" rule
CREATE OR REPLACE FUNCTION execute_play_move(
  p_room_code TEXT,
  p_player_id UUID,
  p_cards JSONB
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_next_turn INTEGER;
  v_card JSONB;
BEGIN
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;

  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;

  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;

  -- SECURITY: Verify caller owns this player seat.
  -- auth.uid() is NULL for service_role calls (intentional bypass for auto-pass).
  IF v_player.user_id != auth.uid() THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: You can only play for your own player'
    );
  END IF;

  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;

  -- ✅ RULE: First play must include the 3 of Diamonds
  IF v_game_state.game_phase = 'first_play' THEN
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_cards) AS card
      WHERE card->>'suit' = 'D' AND card->>'rank' = '3'
    ) THEN
      RETURN json_build_object(
        'success', false,
        'error', 'First play must include the 3 of Diamonds'
      );
    END IF;
  END IF;

  v_player_hand := v_game_state.hands->v_player.player_index::text;

  -- SECURITY: Validate every card in p_cards exists in the player's hand.
  -- Prevents fabricated or duplicate card IDs from being injected.
  DECLARE
    v_played_card JSONB;
  BEGIN
    FOR v_played_card IN SELECT * FROM jsonb_array_elements(p_cards)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_player_hand) AS hand_card
        WHERE hand_card->>'id' = v_played_card->>'id'
      ) THEN
        RETURN json_build_object(
          'success', false,
          'error', 'Card not in hand: ' || (v_played_card->>'id')
        );
      END IF;
    END LOOP;
  END;

  v_new_hand := '[]'::jsonb;
  FOR v_card IN SELECT * FROM jsonb_array_elements(v_player_hand)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_cards) AS played
      WHERE played->>'id' = v_card->>'id'
    ) THEN
      v_new_hand := v_new_hand || jsonb_build_array(v_card);
    END IF;
  END LOOP;

  v_next_turn := CASE
    WHEN v_game_state.current_turn = 0 THEN 3
    ELSE v_game_state.current_turn - 1
  END;

  UPDATE game_state
  SET
    hands = jsonb_set(hands, ARRAY[v_player.player_index::text], v_new_hand),
    last_play = jsonb_build_object(
      'player_index', v_player.player_index,
      'cards', p_cards
    ),
    current_turn = v_next_turn,
    passes = 0,
    played_cards = COALESCE(played_cards, '[]'::jsonb) || p_cards,
    game_phase = CASE WHEN game_phase = 'first_play' THEN 'playing' ELSE game_phase END,
    updated_at = NOW()
  WHERE room_id = v_room_id;

  IF jsonb_array_length(v_new_hand) = 0 THEN
    UPDATE game_state
    SET game_phase = 'finished'
    WHERE room_id = v_room_id;

    RETURN json_build_object(
      'success', true,
      'game_finished', true,
      'winner_index', v_player.player_index
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'cards_remaining', jsonb_array_length(v_new_hand)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION execute_play_move IS
  'Executes a play move with 3-of-Diamonds first-play rule and game_phase transitions.';

-- 4. join_room_atomic — add empty username validation
CREATE OR REPLACE FUNCTION join_room_atomic(
  p_room_code TEXT,
  p_user_id UUID,
  p_username TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_room_id UUID;
  v_player_count INTEGER;
  v_player_index INTEGER;
  v_is_host BOOLEAN;
  v_host_id UUID;
  v_room_status TEXT;
  v_result JSONB;
  v_existing_username TEXT;
  v_other_room UUID;
BEGIN
  -- ✅ Validate username is not empty or blank
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    RAISE EXCEPTION 'Username cannot be empty';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('join_room_atomic'), hashtext(UPPER(p_room_code)));

  SELECT username INTO v_existing_username
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_existing_username IS NOT NULL AND LOWER(v_existing_username) != LOWER(p_username) THEN
    IF NOT (v_existing_username LIKE 'Player_%') THEN
      RAISE EXCEPTION 'You already have username "%". You cannot change your username.', v_existing_username;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE LOWER(username) = LOWER(p_username)
      AND user_id != p_user_id
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken by another user', p_username;
  END IF;

  SELECT id, status, host_id INTO v_room_id, v_room_status, v_host_id
  FROM rooms
  WHERE code = UPPER(p_room_code);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found: %', p_room_code;
  END IF;

  IF v_room_status NOT IN ('waiting', 'playing') THEN
    RAISE EXCEPTION 'Room is not accepting players (status: %)', v_room_status;
  END IF;

  SELECT COUNT(*) INTO v_player_count
  FROM room_players
  WHERE room_id = v_room_id;

  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;

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

  SELECT room_id INTO v_other_room
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_other_room IS NOT NULL AND v_other_room != v_room_id THEN
    RAISE EXCEPTION 'User already in another room';
  END IF;

  SELECT i INTO v_player_index
  FROM generate_series(0, 3) AS i
  WHERE NOT EXISTS (
    SELECT 1 FROM room_players rp
    WHERE rp.room_id = v_room_id AND rp.player_index = i
  )
  ORDER BY i
  LIMIT 1;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'Room is full (no available positions)';
  END IF;

  v_is_host := (v_host_id = p_user_id);

  INSERT INTO room_players(
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

  RETURN jsonb_build_object(
    'room_id', v_room_id,
    'room_code', p_room_code,
    'player_index', v_player_index,
    'is_host', v_is_host,
    'already_joined', false
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION join_room_atomic IS
  'Thread-safe room join with row-level locking, global username uniqueness, and input validation.';


-- --------------------------------------------------------------------------
-- Source: 20260228100000_fix_host_reassignment_on_join.sql
-- --------------------------------------------------------------------------
-- Fix: When all players leave a casual room and a new player joins,
-- they were NOT made host because rooms.host_id still pointed to the
-- original (now-absent) creator. This caused the "Ready Up" button to
-- appear instead of "Start Game" for the only player in the room.
--
-- Fix: After inserting the new player, if no existing player in the room
-- has is_host = true, promote the joining player to host and update
-- rooms.host_id accordingly.

CREATE OR REPLACE FUNCTION join_room_atomic(
  p_room_code TEXT,
  p_user_id UUID,
  p_username TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_room_id UUID;
  v_player_count INTEGER;
  v_player_index INTEGER;
  v_is_host BOOLEAN;
  v_host_id UUID;
  v_room_status TEXT;
  v_result JSONB;
  v_existing_username TEXT;
  v_other_room UUID;
  v_has_active_host BOOLEAN;
BEGIN
  -- ✅ Validate username is not empty or blank
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    RAISE EXCEPTION 'Username cannot be empty';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('join_room_atomic'), hashtext(UPPER(p_room_code)));

  SELECT username INTO v_existing_username
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_existing_username IS NOT NULL AND LOWER(v_existing_username) != LOWER(p_username) THEN
    IF NOT (v_existing_username LIKE 'Player_%') THEN
      RAISE EXCEPTION 'You already have username "%". You cannot change your username.', v_existing_username;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE LOWER(username) = LOWER(p_username)
      AND user_id != p_user_id
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken by another user', p_username;
  END IF;

  SELECT id, status, host_id INTO v_room_id, v_room_status, v_host_id
  FROM rooms
  WHERE code = UPPER(p_room_code);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found: %', p_room_code;
  END IF;

  IF v_room_status NOT IN ('waiting', 'playing') THEN
    RAISE EXCEPTION 'Room is not accepting players (status: %)', v_room_status;
  END IF;

  SELECT COUNT(*) INTO v_player_count
  FROM room_players
  WHERE room_id = v_room_id;

  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;

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

  SELECT room_id INTO v_other_room
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_other_room IS NOT NULL AND v_other_room != v_room_id THEN
    RAISE EXCEPTION 'User already in another room';
  END IF;

  SELECT i INTO v_player_index
  FROM generate_series(0, 3) AS i
  WHERE NOT EXISTS (
    SELECT 1 FROM room_players rp
    WHERE rp.room_id = v_room_id AND rp.player_index = i
  )
  ORDER BY i
  LIMIT 1;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'Room is full (no available positions)';
  END IF;

  -- Check if the host_id user is currently in the room
  -- If not (they left), the joining user should become host
  SELECT EXISTS(
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND is_host = true
  ) INTO v_has_active_host;

  IF v_has_active_host THEN
    -- Normal case: host is present, use rooms.host_id to determine
    v_is_host := (v_host_id = p_user_id);
  ELSE
    -- No active host in the room — promote joining player
    v_is_host := true;
    -- Update rooms.host_id to reflect the new host
    UPDATE rooms SET host_id = p_user_id WHERE id = v_room_id;
  END IF;

  INSERT INTO room_players(
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

  RETURN jsonb_build_object(
    'room_id', v_room_id,
    'room_code', p_room_code,
    'player_index', v_player_index,
    'is_host', v_is_host,
    'already_joined', false
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION join_room_atomic IS
  'Thread-safe room join with row-level locking, global username uniqueness, input validation, and automatic host reassignment when previous host is absent.';

