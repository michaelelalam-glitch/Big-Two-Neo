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

-- Grant permissions (re-grant after function replacement)
GRANT EXECUTE ON FUNCTION cleanup_abandoned_rooms() TO authenticated;
GRANT EXECUTE ON FUNCTION find_match TO authenticated;

COMMENT ON FUNCTION cleanup_abandoned_rooms IS 'Cleans up abandoned rooms (waiting > 2hrs, starting > 10mins, old completed)';
COMMENT ON FUNCTION find_match IS 'Fixed: Now cleans up abandoned rooms before matching to prevent stale room issues';
