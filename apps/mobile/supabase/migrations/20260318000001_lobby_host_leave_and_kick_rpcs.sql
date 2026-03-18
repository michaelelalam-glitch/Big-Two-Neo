-- =============================================================================
-- Migration: lobby_host_leave_and_kick_rpcs
-- Purpose:
--   1. REPLICA IDENTITY FULL on room_players so Supabase Realtime DELETE events
--      include all columns (room_id). Without this the per-room filter
--      `room_id=eq.X` cannot match DELETE events, so other lobby members never
--      see a player disappear when they delete their row.
--   2. lobby_host_leave() — SECURITY DEFINER RPC that atomically:
--        a. Promotes the next human player as host (updates room_players.is_host +
--           rooms.host_id) and re-indexes remaining players.
--        b. Removes the leaving host's room_players row.
--        c. If no other humans remain, deletes the room entirely.
--      Bypasses RLS restrictions that blocked direct UPDATE/DELETE on other
--      users' room_players rows and rooms.host_id changes.
--   3. lobby_kick_player() — SECURITY DEFINER RPC that lets the room host
--      delete another player's row. The host cannot do this with a direct DELETE
--      due to the "Players can leave rooms" RLS policy which only permits a user
--      to delete their OWN row.
-- =============================================================================

-- 1. REPLICA IDENTITY FULL -------------------------------------------------------
-- Required for Supabase Realtime server-side row filters to work on DELETE events.
-- Without FULL identity, the WAL record for DELETE only contains the primary key
-- (id), so filter `room_id=eq.X` never matches and subscribed clients don't
-- receive the event.
ALTER TABLE room_players REPLICA IDENTITY FULL;

-- 2. lobby_host_leave -----------------------------------------------------------
CREATE OR REPLACE FUNCTION lobby_host_leave(
  p_room_id       UUID,
  p_leaving_user_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_host        BOOLEAN;
  v_new_host_id    UUID;
  v_remaining_id   UUID;
  v_index          INT := 0;
BEGIN
  -- Validate: caller must be the room's host.
  SELECT is_host
    INTO v_is_host
    FROM room_players
   WHERE room_id = p_room_id
     AND user_id = p_leaving_user_id;

  IF NOT FOUND OR v_is_host IS NOT TRUE THEN
    RAISE EXCEPTION 'lobby_host_leave: user % is not the host of room %',
      p_leaving_user_id, p_room_id;
  END IF;

  -- Find the next human player (lowest player_index, excluding the leaving host).
  SELECT user_id
    INTO v_new_host_id
    FROM room_players
   WHERE room_id = p_room_id
     AND user_id != p_leaving_user_id
     AND is_bot   = FALSE
     AND user_id IS NOT NULL
   ORDER BY player_index
   LIMIT 1;

  IF v_new_host_id IS NOT NULL THEN
    -- a. Promote next human as host in room_players.
    UPDATE room_players
       SET is_host = TRUE
     WHERE room_id = p_room_id
       AND user_id = v_new_host_id;

    -- b. Transfer host ownership in rooms table.
    UPDATE rooms
       SET host_id = v_new_host_id
     WHERE id = p_room_id;

    -- c. Re-index remaining players (excluding leaving host) starting from 0
    --    so player slots are gapless.
    FOR v_remaining_id IN
      SELECT id
        FROM room_players
       WHERE room_id = p_room_id
         AND user_id != p_leaving_user_id
       ORDER BY player_index
    LOOP
      UPDATE room_players
         SET player_index = v_index
       WHERE id = v_remaining_id;
      v_index := v_index + 1;
    END LOOP;

    -- d. Remove the leaving host's row.
    DELETE FROM room_players
     WHERE room_id = p_room_id
       AND user_id = p_leaving_user_id;

  ELSE
    -- No other human players — delete the room entirely.
    -- room_players rows are cleaned up by ON DELETE CASCADE on rooms.
    DELETE FROM rooms WHERE id = p_room_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION lobby_host_leave(UUID, UUID) TO authenticated;

-- 3. lobby_kick_player ----------------------------------------------------------
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
  v_is_host BOOLEAN;
BEGIN
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

  -- Prevent the host kicking themselves (safety guard).
  IF p_kicker_user_id = p_kicked_user_id THEN
    RAISE EXCEPTION 'lobby_kick_player: host cannot kick themselves';
  END IF;

  -- Remove the kicked player's row.
  DELETE FROM room_players
   WHERE room_id = p_room_id
     AND user_id = p_kicked_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION lobby_kick_player(UUID, UUID, UUID) TO authenticated;
