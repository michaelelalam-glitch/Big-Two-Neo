-- ============================================================================
-- Migration: Sync disconnect timer between in-game ring and home-screen banner
-- Branch: fix/auto-pass-cascade
-- Date: 2026-03-08
--
-- Problem
-- -------
-- The 60s countdown on the opponent avatar (orange InactivityCountdownRing) and
-- the 60s countdown on the home-screen banner (ActiveGameBanner) were NOT in sync:
--
--   In-game ring  → anchored to disconnect_timer_started_at (persistent column,
--                   set once when the player first disconnects)
--
--   Home-screen   → called get-rejoin-status which computed seconds_left from
--                   disconnected_at (the last heartbeat-fail timestamp), which
--                   can be up to 30s later than disconnect_timer_started_at.
--                   The client then back-computed a local timestamp from the
--                   integer seconds_left (1-second rounding precision).
--
-- Between the wrong source column (up to 30s off) and integer rounding,
-- the two countdowns could show meaningfully different values.
--
-- Fix
-- ---
-- Update get_rejoin_status() to:
--   1. Use disconnect_timer_started_at (the true 60s anchor) instead of
--      disconnected_at when computing seconds_left.
--   2. Return disconnect_timer_started_at as a raw ISO-8601 timestamp.
--
-- The client (HomeScreen) now reads the raw timestamp and calls new Date(ts).getTime()
-- to get a millisecond epoch — exactly the same arithmetic InactivityCountdownRing
-- uses — so both countdowns are now guaranteed to show the same value.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_rejoin_status(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec          RECORD;
  v_room_status  TEXT;
  v_timer_anchor TIMESTAMPTZ;
  v_seconds_left INTEGER;
BEGIN
  SELECT status INTO v_room_status
  FROM   public.rooms WHERE id = p_room_id;

  IF NOT FOUND OR v_room_status = 'finished' THEN
    RETURN jsonb_build_object('status', 'room_closed');
  END IF;

  SELECT * INTO v_rec
  FROM   public.room_players
  WHERE  room_id = p_room_id
    AND  (user_id = p_user_id OR human_user_id = p_user_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_in_room');
  END IF;

  IF v_rec.connection_status = 'replaced_by_bot' THEN
    RETURN jsonb_build_object(
      'status',        'replaced_by_bot',
      'player_index',  v_rec.player_index,
      'bot_username',  v_rec.username
    );
  END IF;

  IF v_rec.connection_status = 'disconnected' THEN
    -- Use disconnect_timer_started_at (set once when the player first disconnects,
    -- never reset by reconnect cycles) as the authoritative 60s anchor.
    -- Fall back to disconnected_at for rows written before this column existed.
    v_timer_anchor := COALESCE(v_rec.disconnect_timer_started_at, v_rec.disconnected_at);

    v_seconds_left := GREATEST(
      0,
      60 - EXTRACT(EPOCH FROM (NOW() - v_timer_anchor))::INTEGER
    );

    RETURN jsonb_build_object(
      'status',                       'disconnected',
      'seconds_left',                 v_seconds_left,
      -- Raw ISO-8601 timestamp: client uses new Date(ts).getTime() so both
      -- the home-screen banner and the in-game orange ring are anchored to
      -- the exact same millisecond with no back-computation drift.
      'disconnect_timer_started_at',  v_timer_anchor,
      'player_index',                 v_rec.player_index
    );
  END IF;

  RETURN jsonb_build_object(
    'status',       'connected',
    'player_index', v_rec.player_index
  );
END;
$$;

-- Restrict to service_role only (called by get-rejoin-status edge function)
REVOKE ALL ON FUNCTION public.get_rejoin_status(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_rejoin_status(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.get_rejoin_status(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_rejoin_status(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.get_rejoin_status IS
  'Returns the current rejoin status for a player in a room. '
  'For disconnected players, returns the raw disconnect_timer_started_at ISO timestamp '
  'so both the home-screen banner and in-game orange ring anchor to the same moment.';
