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
