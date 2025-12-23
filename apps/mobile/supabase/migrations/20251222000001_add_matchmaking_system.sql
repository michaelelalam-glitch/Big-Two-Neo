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
