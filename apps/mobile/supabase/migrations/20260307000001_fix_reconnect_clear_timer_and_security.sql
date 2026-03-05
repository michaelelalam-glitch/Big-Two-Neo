-- ============================================================================
-- Migration: fix_reconnect_clear_timer_and_security
-- Date: 2026-03-07
--
-- Fixes:
--   1. reconnect_player() now clears disconnect_timer_started_at on reclaim.
--      Without this the persistent 60-second server-side timer persists after
--      a player reclaims their seat, and the next process_disconnected_players()
--      sweep sees an old timer and immediately tries to re-replace the human.
--
--   2. delete_room_players_by_human_user_id() adds an auth.uid() guard so an
--      authenticated user cannot delete another player's replaced seat by
--      guessing their UUID. The function already restricted PUBLIC/anon; this
--      closes the remaining broken-object-level-access gap flagged by Copilot.
--
--   3. Fixes the invalid COMMENT ON FUNCTION syntax in 20260304000001 that
--      omitted the required (UUID, UUID) argument-type signature.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1.  reconnect_player() — clear the persistent disconnect timer on reclaim
-- ────────────────────────────────────────────────────────────────────────────
-- The disconnect_timer_started_at column was added in migration
-- 20260305000001_disconnect_timer_and_bot_trigger.sql.  The original
-- reconnect_player() in 20260304000001 predates it and therefore does not
-- clear it.  This CREATE OR REPLACE adds the missing NULL-out.
DROP FUNCTION IF EXISTS public.reconnect_player(UUID, UUID);

CREATE OR REPLACE FUNCTION public.reconnect_player(
  p_room_id   UUID,
  p_user_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec          RECORD;
  v_room_status  TEXT;
  v_was_bot      BOOLEAN := FALSE;
BEGIN
  -- 1. Room must still be active
  SELECT status INTO v_room_status
  FROM   public.rooms
  WHERE  id = p_room_id;

  IF NOT FOUND OR v_room_status NOT IN ('waiting', 'playing') THEN
    RETURN jsonb_build_object(
      'success',     FALSE,
      'room_closed', TRUE,
      'message',     'Room not found or already finished'
    );
  END IF;

  -- 2. Find the player's row.
  --    Either they are still the user_id (disconnected, not yet replaced)
  --    OR a bot is now sitting there and human_user_id = p_user_id.
  SELECT * INTO v_rec
  FROM   public.room_players
  WHERE  room_id = p_room_id
    AND  (
           user_id       = p_user_id
           OR human_user_id = p_user_id
         )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'Player not found in this room'
    );
  END IF;

  v_was_bot := (v_rec.connection_status = 'replaced_by_bot');

  -- 3. Restore the seat to the human.
  --    Also clears disconnect_timer_started_at so the next sweep does NOT
  --    see a stale timer and immediately re-open the replacement window.
  UPDATE public.room_players
  SET
    user_id                     = p_user_id,
    human_user_id               = NULL,            -- seat is theirs again
    replaced_username           = NULL,
    is_bot                      = FALSE,
    bot_difficulty              = NULL,
    username                    = COALESCE(v_rec.replaced_username, v_rec.username),
    connection_status           = 'connected',
    last_seen_at                = NOW(),
    disconnected_at             = NULL,
    disconnect_timer_started_at = NULL             -- ← KEY FIX: clear persistent timer
  WHERE id = v_rec.id;

  RETURN jsonb_build_object(
    'success',          TRUE,
    'was_replaced',     v_was_bot,
    'player_index',     v_rec.player_index,
    'username',         COALESCE(v_rec.replaced_username, v_rec.username),
    'message',          CASE WHEN v_was_bot THEN 'Reclaimed seat from bot' ELSE 'Reconnected successfully' END
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
END;
$$;

-- Security: only edge functions (service_role) should invoke this.
-- The edge function verifies auth.uid() before calling the RPC.
REVOKE ALL ON FUNCTION public.reconnect_player(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconnect_player(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.reconnect_player(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconnect_player(UUID, UUID) TO service_role;

-- Fix: include the full function signature in COMMENT ON FUNCTION (Copilot #23)
COMMENT ON FUNCTION public.reconnect_player(UUID, UUID) IS
'Allows a human to reconnect to their seat. Handles both simple reconnect (was '
'disconnected but not yet replaced) and reclaim-from-bot (replaced_by_bot status). '
'Looks up the row by user_id OR human_user_id so the player can always find their slot. '
'Clears disconnect_timer_started_at on success so the persistent rejoin window resets.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2.  delete_room_players_by_human_user_id() — enforce caller owns the row
-- ────────────────────────────────────────────────────────────────────────────
-- The existing function only restricts PUBLIC/anon. An authenticated user
-- could pass an arbitrary UUID and delete another player's replaced seat.
-- Fix: add an explicit auth.uid() == p_human_user_id enforcement.
CREATE OR REPLACE FUNCTION public.delete_room_players_by_human_user_id(
  human_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Authorization check: the caller may only delete their OWN replaced seat.
  -- auth.uid() is NULL when called via service_role (superuser context) so
  -- we only enforce the check when there IS an authenticated session.
  IF auth.uid() IS NOT NULL AND auth.uid() != human_user_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only delete your own replaced seat'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Qualify the column with the table alias to disambiguate from the parameter.
  DELETE FROM public.room_players rp
  WHERE rp.human_user_id   = delete_room_players_by_human_user_id.human_user_id
    AND rp.connection_status = 'replaced_by_bot';
END;
$$;

-- Permissions: authenticated users call this directly from the client;
-- service_role is used by edge functions if needed.
REVOKE ALL ON FUNCTION public.delete_room_players_by_human_user_id(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_room_players_by_human_user_id(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_room_players_by_human_user_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_room_players_by_human_user_id(UUID) TO service_role;

COMMENT ON FUNCTION public.delete_room_players_by_human_user_id(UUID) IS
  'SECURITY DEFINER: deletes the replaced_by_bot seat belonging to the given '
  'human player. Enforces auth.uid() == human_user_id so callers cannot delete '
  'other players'' seats. Bypasses the DELETE RLS (which checks user_id = auth.uid()) '
  'because replaced rows carry user_id = NULL.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3.  Fix COMMENT ON FUNCTION get_rejoin_status (missing arg-type signature)
-- ────────────────────────────────────────────────────────────────────────────
-- The comment in 20260304000001 used the invalid form without argument types.
-- Postgres COMMENT ON FUNCTION requires the full signature.
COMMENT ON FUNCTION public.get_rejoin_status(UUID, UUID) IS
'Returns the current rejoin status for a player in a room. '
'Used on app-foreground to determine the UI state. '
'Possible statuses: connected | disconnected | replaced_by_bot | room_closed | not_in_room.';
