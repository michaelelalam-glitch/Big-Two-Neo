-- ── Task 622: Sync disconnect countdown between in-game ring and home banner ──
--
-- Problem: get_rejoin_status() did not return disconnect_timer_started_at in its
-- JSONB response. HomeScreen.tsx was checking statusData.disconnect_timer_started_at
-- to anchor the banner countdown precisely to the server timestamp, but always fell
-- back to the seconds_left back-calculation because the field was never present.
--
-- Fix: Add disconnect_timer_started_at to the responses for:
--   1. connection_status = 'disconnected'  (the main use-case)
--   2. connection_status = 'connected' but disconnect_timer_started_at IS NOT NULL
--      (player re-opened the app mid-grace-period)
--
-- HomeScreen now uses the ISO timestamp directly to anchor ActiveGameBanner
-- countdown, matching the server's timer precisely.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_rejoin_status(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec          RECORD;
  v_room_status  TEXT;
  v_seconds_left INTEGER;
BEGIN
  SELECT status INTO v_room_status
  FROM   public.rooms WHERE id = p_room_id;

  IF NOT FOUND OR v_room_status = 'finished' THEN
    RETURN jsonb_build_object('status', 'room_closed');
  END IF;

  -- Search by user_id (not yet replaced) OR human_user_id (already replaced by bot)
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
      'status',       'replaced_by_bot',
      'player_index', v_rec.player_index,
      'bot_username', v_rec.username
    );
  END IF;

  IF v_rec.connection_status = 'disconnected' THEN
    -- Use persistent timer if available, else fall back to disconnected_at
    v_seconds_left := GREATEST(
      0,
      60 - EXTRACT(EPOCH FROM (
        NOW() - COALESCE(v_rec.disconnect_timer_started_at, v_rec.disconnected_at)
      ))::INTEGER
    );
    RETURN jsonb_build_object(
      'status',                      'disconnected',
      'seconds_left',                v_seconds_left,
      'disconnect_timer_active',     TRUE,
      -- NEW: return the raw ISO timestamp so the client can anchor its countdown
      -- precisely to the server timer start instead of back-computing from seconds_left.
      'disconnect_timer_started_at', COALESCE(v_rec.disconnect_timer_started_at, v_rec.disconnected_at),
      'player_index',                v_rec.player_index
    );
  END IF;

  -- 'connected' but persistent disconnect timer still running
  -- (player reopened the app and heartbeat resumed, but rejoin not yet confirmed).
  -- Return the active timer info so the client can show the correct countdown.
  IF v_rec.disconnect_timer_started_at IS NOT NULL THEN
    v_seconds_left := GREATEST(
      0,
      60 - EXTRACT(EPOCH FROM (NOW() - v_rec.disconnect_timer_started_at))::INTEGER
    );
    RETURN jsonb_build_object(
      'status',                      'connected',
      'player_index',                v_rec.player_index,
      'disconnect_timer_active',     TRUE,
      'seconds_left',                v_seconds_left,
      -- NEW: also return the timestamp for precise client-side anchoring
      'disconnect_timer_started_at', v_rec.disconnect_timer_started_at
    );
  END IF;

  -- Fully connected, no timer running
  RETURN jsonb_build_object(
    'status',       'connected',
    'player_index', v_rec.player_index
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_rejoin_status(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_rejoin_status(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.get_rejoin_status(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_rejoin_status(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.get_rejoin_status(UUID, UUID) IS
  'Returns rejoin status for a player. Checks user_id (not yet replaced) and '
  'human_user_id (replaced by bot). Returns seconds_left, disconnect_timer_active, '
  'and disconnect_timer_started_at fields consumed by HomeScreen.tsx. '
  'The disconnect_timer_started_at ISO timestamp allows the client to anchor its '
  'countdown precisely to the server timer start instead of back-computing from seconds_left.';
