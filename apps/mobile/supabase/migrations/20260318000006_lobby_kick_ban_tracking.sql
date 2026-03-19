-- =============================================================================
-- Migration: lobby_kick_ban_tracking
-- Date: March 18, 2026
-- Purpose:
--   Record kicked players in rooms.banned_user_ids so join_room_atomic can
--   prevent them from rejoining private rooms.
--
--   The banned_user_ids UUID[] column was added to rooms in migration_002.
--   This migration updates lobby_kick_player (originally in migration_001,
--   constraints hardened in that same migration) to also append the kicked
--   user's id to banned_user_ids when the room is a private room.
--
--   Casual and ranked (matchmaking) rooms are explicitly excluded from banning
--   because those rooms allow free re-entry after a voluntary leave; only the
--   host of a private room should permanently block a player.
-- =============================================================================

CREATE OR REPLACE FUNCTION lobby_kick_player(
  p_room_id         UUID,
  p_kicker_user_id  UUID,
  p_kicked_user_id  UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_host        BOOLEAN;
  v_room_status    TEXT;
  v_is_matchmaking BOOLEAN;
  v_is_public      BOOLEAN;
  v_kicked_is_bot  BOOLEAN;
  v_kicked_is_host BOOLEAN;
BEGIN
  -- Security: reject calls where the JWT uid doesn't match the supplied kicker_user_id.
  IF auth.uid() IS DISTINCT FROM p_kicker_user_id THEN
    RAISE EXCEPTION 'lobby_kick_player: JWT uid does not match supplied kicker_user_id';
  END IF;

  -- Validate: room must be in waiting state.
  SELECT status, COALESCE(is_matchmaking, FALSE), COALESCE(is_public, FALSE)
    INTO v_room_status, v_is_matchmaking, v_is_public
    FROM rooms
   WHERE id = p_room_id;

  IF NOT FOUND OR v_room_status != 'waiting' THEN
    RAISE EXCEPTION 'lobby_kick_player: can only kick players in a waiting lobby (status: %)',
      COALESCE(v_room_status, 'not found');
  END IF;

  -- Validate: kicker must be the room's host.
  SELECT is_host
    INTO v_is_host
    FROM room_players
   WHERE room_id = p_room_id
     AND user_id = p_kicker_user_id;

  IF NOT FOUND OR v_is_host IS NOT TRUE THEN
    RAISE EXCEPTION 'lobby_kick_player: user % is not the host of room %',
      p_kicker_user_id, p_room_id;
  END IF;

  -- Prevent the host kicking themselves.
  IF p_kicker_user_id = p_kicked_user_id THEN
    RAISE EXCEPTION 'lobby_kick_player: host cannot kick themselves';
  END IF;

  -- Validate: kicked player must be a non-bot, non-host human.
  SELECT is_bot, is_host
    INTO v_kicked_is_bot, v_kicked_is_host
    FROM room_players
   WHERE room_id = p_room_id
     AND user_id = p_kicked_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lobby_kick_player: target player not found in room %', p_room_id;
  END IF;

  IF v_kicked_is_bot THEN
    RAISE EXCEPTION 'lobby_kick_player: cannot kick a bot';
  END IF;

  IF v_kicked_is_host THEN
    RAISE EXCEPTION 'lobby_kick_player: cannot kick the host';
  END IF;

  -- For private rooms (not matchmaking, not public): record the ban BEFORE
  -- removing the room_players row so there is no race window where
  -- join_room_atomic could squeeze in between the DELETE and the UPDATE.
  --
  -- The rooms row is locked with SELECT … FOR UPDATE first so that concurrent
  -- kicks (e.g. host rapidly kicking two players) cannot produce lost updates:
  -- without the lock both transactions would read the same old banned_user_ids
  -- value, compute independent DISTINCT/UNNEST results, and the later
  -- COMMIT would silently overwrite the earlier one's addition.
  --
  -- Casual and ranked (matchmaking) rooms allow free re-entry; only private
  -- rooms ban.
  IF NOT v_is_matchmaking AND NOT v_is_public THEN
    -- Acquire a row-level lock on the rooms record for this transaction.
    PERFORM id FROM rooms WHERE id = p_room_id FOR UPDATE;

    UPDATE rooms
       SET banned_user_ids = ARRAY(
             SELECT DISTINCT UNNEST(
               array_append(COALESCE(banned_user_ids, '{}'), p_kicked_user_id)
             )
           )
     WHERE id = p_room_id;
  END IF;

  -- Remove the kicked player's row (done AFTER the ban is recorded so there
  -- is no gap between eviction and the re-entry guard being in place).
  DELETE FROM room_players
   WHERE room_id = p_room_id
     AND user_id = p_kicked_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION lobby_kick_player(UUID, UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lobby_kick_player(UUID, UUID, UUID) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260318000006 applied: lobby_kick_player records kicked users in rooms.banned_user_ids for private rooms.';
END $$;
