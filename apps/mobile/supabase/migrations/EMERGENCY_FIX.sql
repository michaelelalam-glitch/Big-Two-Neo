-- =========================================================================
-- EMERGENCY FIX: Delete ALL stuck rooms + Fix find_match status
-- Run in Supabase Dashboard: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql/new
-- =========================================================================

-- STEP 1: DELETE ALL STUCK ROOMS (NUCLEAR OPTION)
DELETE FROM rooms WHERE status IN ('waiting', 'starting', 'playing', 'active');

-- STEP 2: Apply the fixed find_match (creates rooms with 'waiting' not 'starting')
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
  PERFORM cleanup_abandoned_rooms();
  PERFORM cleanup_stale_waiting_room_entries();
  
  INSERT INTO waiting_room (user_id, username, skill_rating, region, status)
  VALUES (p_user_id, p_username, p_skill_rating, p_region, 'waiting')
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
    AND updated_at < NOW() - INTERVAL '2 hours'
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
    AND updated_at < NOW() - INTERVAL '30 days'
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

GRANT EXECUTE ON FUNCTION cleanup_abandoned_rooms() TO authenticated;

-- STEP 4: Verify cleanup
SELECT COUNT(*) as remaining_stuck_rooms FROM rooms WHERE status IN ('waiting', 'starting', 'playing', 'active');
-- Should return 0

SELECT * FROM rooms ORDER BY created_at DESC LIMIT 10;
-- Should show no active rooms