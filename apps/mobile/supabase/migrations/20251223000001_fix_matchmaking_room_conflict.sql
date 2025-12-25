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
