-- =============================================================================
-- Migration: lobby_evict_ghosts — add room-membership check
-- Date: March 18, 2026
-- Purpose:
--   Copilot PR-153 review comment: lobby_evict_ghosts is SECURITY DEFINER
--   and only checked that the caller is authenticated.  Any authenticated
--   user who learned a room UUID could trigger deletions.  Add a membership
--   guard so only players who are actually in the room can evict ghosts.
-- =============================================================================

CREATE OR REPLACE FUNCTION lobby_evict_ghosts(
  p_room_id UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_status    TEXT;
  v_evicted_count  INT;
  v_caller_id      UUID := auth.uid();
  v_ghost_threshold CONSTANT INTERVAL := INTERVAL '60 seconds';
BEGIN
  -- Only authenticated users may trigger eviction.
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'lobby_evict_ghosts: not authenticated';
  END IF;

  -- Caller must be a member of the room (prevents external users from
  -- triggering deletions for rooms they don't belong to).
  IF NOT EXISTS (
    SELECT 1 FROM room_players
     WHERE room_id = p_room_id
       AND user_id = v_caller_id
  ) THEN
    RETURN 0;
  END IF;

  -- Only evict from waiting lobbies (never from in-progress games).
  SELECT status INTO v_room_status
    FROM rooms
   WHERE id = p_room_id;

  IF NOT FOUND OR v_room_status != 'waiting' THEN
    RETURN 0;
  END IF;

  -- Delete non-bot human players whose last_seen_at exceeds the threshold.
  -- The caller is never evicted (they are clearly online if they called this).
  -- The check_host_departure trigger fires for each deleted row and promotes
  -- the next human via reassign_next_host when a ghost host is among them.
  DELETE FROM room_players
   WHERE room_id      = p_room_id
     AND is_bot       = FALSE
     AND user_id     IS NOT NULL
     AND user_id     != v_caller_id
     AND last_seen_at < NOW() - v_ghost_threshold;

  GET DIAGNOSTICS v_evicted_count = ROW_COUNT;

  RETURN v_evicted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION lobby_evict_ghosts(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lobby_evict_ghosts(UUID) TO authenticated;
