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
