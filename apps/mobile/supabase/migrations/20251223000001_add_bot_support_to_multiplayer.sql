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
