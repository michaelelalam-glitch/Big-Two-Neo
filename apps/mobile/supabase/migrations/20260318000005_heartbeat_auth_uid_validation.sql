-- =============================================================================
-- Migration: heartbeat_auth_uid_validation
-- Date: March 18, 2026
-- Addresses: Copilot PR-153 review comment r2953341342 (commit 6b5e4d7)
--
-- update_player_heartbeat is SECURITY DEFINER and currently updates rows by
-- p_user_id without verifying auth.uid().  Any authenticated client can call
-- this RPC with a different user's UUID to refresh their last_seen_at,
-- preventing ghost-eviction from ever removing that player.
--
-- Fix: add an identity check so the function only updates the authenticated
-- caller's own row.  The existing call-site in LobbyScreen already passes
-- user.id (= auth.uid()) so no client-side change is required.
-- =============================================================================

CREATE OR REPLACE FUNCTION update_player_heartbeat(
  p_room_id UUID,
  p_user_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Security: verify the JWT uid matches the supplied user_id.
  -- Prevents an authenticated user from spoofing another player's heartbeat
  -- by passing a different UUID as p_user_id, which would keep a ghost row
  -- alive and prevent eviction by lobby_evict_ghosts.
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'update_player_heartbeat: JWT uid does not match p_user_id';
  END IF;

  UPDATE room_players
     SET last_seen_at      = NOW(),
         connection_status = 'connected',
         disconnected_at   = NULL
   WHERE room_id = p_room_id
     AND user_id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_player_heartbeat(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION update_player_heartbeat(UUID, UUID) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260318000005 applied: update_player_heartbeat now validates auth.uid() = p_user_id.';
END $$;
