-- Migration: SECURITY DEFINER RPC to delete a replaced_by_bot seat permanently
--
-- Context
-- -------
-- After bot replacement the player's row has user_id = NULL and
-- human_user_id = <original player UUID>.  The room_players DELETE policy only
-- allows deletion where  auth.uid() = user_id  — so a client-side DELETE is
-- silently blocked for replaced rows.
--
-- This SECURITY DEFINER function bypasses RLS and is called by HomeScreen when
-- the player taps "Leave Permanently" after the 60-second rejoin window.

CREATE OR REPLACE FUNCTION public.delete_room_players_by_human_user_id(
  human_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Qualify the column with the table name to disambiguate from the parameter.
  DELETE FROM public.room_players rp
  WHERE rp.human_user_id   = delete_room_players_by_human_user_id.human_user_id
    AND rp.connection_status = 'replaced_by_bot';
END;
$$;

-- Restrict access: unauthenticated callers and anon role must not be able to
-- delete rows.  Authenticated users may only call it with their own UUID
-- (enforced by HomeScreen.tsx passing user.id).
REVOKE ALL ON FUNCTION public.delete_room_players_by_human_user_id(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_room_players_by_human_user_id(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_room_players_by_human_user_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_room_players_by_human_user_id(UUID) TO service_role;

COMMENT ON FUNCTION public.delete_room_players_by_human_user_id(UUID) IS
  'SECURITY DEFINER: deletes the replaced_by_bot seat belonging to the given '
  'human player. Used when a player permanently leaves after bot replacement. '
  'Bypasses the DELETE RLS policy (which checks user_id = auth.uid()) because '
  'replaced rows carry user_id = NULL with human_user_id = original player UUID.';
