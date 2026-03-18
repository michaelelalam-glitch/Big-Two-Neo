-- =============================================================================
-- Migration: lobby_evict_ghosts RPC definition
-- Date: March 18, 2026
-- Purpose:
--   Defines lobby_evict_ghosts(p_room_id) — callable RPC that evicts stale
--   players from a waiting lobby.  Previously ghost eviction only ran inside
--   join_room_atomic, so existing lobby members were never cleaned up unless
--   a new player attempted to join.
--
--   LobbyScreen's heartbeat interval (every 15 s) calls this RPC alongside
--   update_player_heartbeat, ensuring disconnected players are removed within
--   ~75 s (60 s threshold + up to 15 s interval).  This client-driven
--   "periodic" eviction replaces the need for a server-side cron job.
--
--   Host transfer is handled automatically by the existing
--   check_host_departure → reassign_next_host AFTER DELETE trigger on
--   room_players.
--
-- NOTE: This migration only defines and grants the RPC.  No pg_cron/scheduled
-- job is created here — eviction is triggered from LobbyScreen heartbeats.
-- =============================================================================
-- (Copilot PR-153 review r2953147528 — migration name updated to reflect actual
-- scope: defines the RPC rather than registering a scheduled cron job.)

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

  -- Only evict from waiting lobbies (never from in-progress games).
  SELECT status INTO v_room_status
    FROM rooms
   WHERE id = p_room_id;

  IF NOT FOUND OR v_room_status != 'waiting' THEN
    RETURN 0;
  END IF;

  -- Delete non-bot human players whose last_seen_at exceeds the threshold.
  -- last_seen_at IS NULL is treated as infinitely stale (covers legacy rows or
  -- rows where the initial heartbeat call failed before the session ended).
  -- The caller is never evicted (they are clearly online if they called this).
  -- The check_host_departure trigger fires for each deleted row and promotes
  -- the next human via reassign_next_host when a ghost host is among them.
  DELETE FROM room_players
   WHERE room_id      = p_room_id
     AND is_bot       = FALSE
     AND user_id     IS NOT NULL
     AND user_id     != v_caller_id
     AND (last_seen_at IS NULL OR last_seen_at < NOW() - v_ghost_threshold);

  GET DIAGNOSTICS v_evicted_count = ROW_COUNT;

  RETURN v_evicted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION lobby_evict_ghosts(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lobby_evict_ghosts(UUID) TO authenticated;
