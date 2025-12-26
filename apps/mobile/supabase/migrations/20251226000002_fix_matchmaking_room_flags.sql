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
