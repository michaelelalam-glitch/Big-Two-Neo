-- ============================================================================
-- Migration: fix_process_disconnected_returns_room_codes
-- Branch: fix/rejoin
-- Date: 2026-03-06
--
-- Purpose:
--   1. Guarantee human_user_id and disconnect_timer_started_at columns exist
--      (safe no-ops if the previous migrations already ran).
--   2. Replace process_disconnected_players() so it ALWAYS returns
--      rooms_with_bot_replacements — required by update-heartbeat to trigger
--      bot-coordinator after a player is replaced.
--   3. Update get_rejoin_status() to clearly return seconds_left and
--      disconnect_timer_active fields consumed by the client.
-- ============================================================================

-- ── 1. Schema safety guards ──────────────────────────────────────────────────
ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS human_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS replaced_username VARCHAR(100);

ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS disconnect_timer_started_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_room_players_pending_replacement
  ON public.room_players (room_id, disconnected_at)
  WHERE connection_status = 'disconnected';

CREATE INDEX IF NOT EXISTS idx_room_players_last_seen
  ON public.room_players (room_id, last_seen_at)
  WHERE connection_status = 'connected' AND is_bot = FALSE;

CREATE INDEX IF NOT EXISTS idx_room_players_disconnect_timer
  ON public.room_players (disconnect_timer_started_at)
  WHERE disconnect_timer_started_at IS NOT NULL;

-- ── 2. process_disconnected_players ─────────────────────────────────────────
--    Phase A: Mark stale heartbeat players as disconnected
--    Phase B: Replace long-disconnected players with bots (or close room)
--    Returns: rooms_with_bot_replacements (array of room codes) so the
--             update-heartbeat edge function can trigger bot-coordinator.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_disconnected_players()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  HEARTBEAT_SLACK   CONSTANT INTERVAL := INTERVAL '30 seconds';
  BOT_REPLACE_AFTER CONSTANT INTERVAL := INTERVAL '60 seconds';

  rec               RECORD;
  v_room            RECORD;
  v_human_count     INTEGER;
  v_bot_difficulty  VARCHAR(10);
  v_marked          INTEGER := 0;
  v_replaced        INTEGER := 0;
  v_closed          INTEGER := 0;
  v_affected_codes  TEXT[]  := '{}';
  v_room_code       TEXT;
BEGIN

  -- ── Phase A: Mark stale heartbeats as disconnected ───────────────────────
  FOR rec IN
    SELECT rp.id, rp.room_id
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    WHERE  rp.is_bot            = FALSE
      AND  rp.connection_status  = 'connected'
      AND  rp.last_seen_at       < NOW() - HEARTBEAT_SLACK
      AND  r.status              = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    UPDATE public.room_players
    SET
      connection_status           = 'disconnected',
      disconnected_at             = NOW(),
      -- Persist timer start only on first disconnect (COALESCE preserves existing)
      disconnect_timer_started_at = COALESCE(disconnect_timer_started_at, NOW())
    WHERE id = rec.id
      AND connection_status = 'connected'
      AND last_seen_at < NOW() - HEARTBEAT_SLACK;

    IF FOUND THEN
      v_marked := v_marked + 1;
    END IF;
  END LOOP;

  -- ── Phase B: Replace long-disconnected players with bots (or close room) ─
  FOR rec IN
    SELECT rp.*
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    WHERE  rp.is_bot            = FALSE
      AND  rp.connection_status  = 'disconnected'
      -- Use persistent timer (survives heartbeat-resume cycles)
      AND  rp.disconnect_timer_started_at IS NOT NULL
      AND  rp.disconnect_timer_started_at < NOW() - BOT_REPLACE_AFTER
      AND  r.status              = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    SELECT * INTO v_room FROM public.rooms WHERE id = rec.room_id;

    -- Count remaining connected humans (excluding the disconnected player)
    SELECT COUNT(*)
    INTO   v_human_count
    FROM   public.room_players
    WHERE  room_id          = rec.room_id
      AND  is_bot           = FALSE
      AND  connection_status NOT IN ('disconnected', 'replaced_by_bot')
      AND  id               != rec.id;

    -- Sole human left → close the room instead of replacing
    IF v_human_count = 0 THEN
      UPDATE public.rooms
      SET
        status      = 'finished',
        finished_at = NOW(),
        updated_at  = NOW()
      WHERE id = rec.room_id
        AND status = 'playing';

      v_closed := v_closed + 1;
      CONTINUE;
    END IF;

    -- Determine bot difficulty
    IF v_room.ranked_mode = TRUE THEN
      v_bot_difficulty := 'hard';
    ELSE
      v_bot_difficulty := COALESCE(
        v_room.settings->>'bot_difficulty',
        rec.bot_difficulty,
        'medium'
      );
    END IF;

    -- Replace the player row with a bot
    UPDATE public.room_players
    SET
      human_user_id               = rec.user_id,
      replaced_username           = rec.username,
      user_id                     = NULL,
      is_bot                      = TRUE,
      bot_difficulty              = v_bot_difficulty,
      username                    = 'Bot ' || COALESCE(rec.username, 'Player'),
      connection_status           = 'replaced_by_bot',
      disconnected_at             = NULL,
      disconnect_timer_started_at = NULL,
      last_seen_at                = NOW()
    WHERE id = rec.id
      AND connection_status = 'disconnected'; -- guard against races

    IF FOUND THEN
      v_replaced := v_replaced + 1;

      -- Collect the room code for bot-coordinator triggering
      SELECT code INTO v_room_code FROM public.rooms WHERE id = rec.room_id;
      IF v_room_code IS NOT NULL AND NOT (v_room_code = ANY(v_affected_codes)) THEN
        v_affected_codes := array_append(v_affected_codes, v_room_code);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'marked_disconnected',         v_marked,
    'replaced_with_bot',           v_replaced,
    'rooms_closed',                v_closed,
    'rooms_with_bot_replacements', to_jsonb(v_affected_codes),
    'processed_at',                NOW()
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM, 'processed_at', NOW());
END;
$function$;

-- Only service_role may call this expensive sweep
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM anon;
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_disconnected_players() TO service_role;

-- ── 3. get_rejoin_status ─────────────────────────────────────────────────────
--    Returns the current rejoin state for a player, including fields consumed
--    by HomeScreen.tsx (seconds_left, disconnect_timer_active).
-- ────────────────────────────────────────────────────────────────────────────
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
      'status',                  'disconnected',
      'seconds_left',            v_seconds_left,
      'disconnect_timer_active', TRUE,
      'player_index',            v_rec.player_index
    );
  END IF;

  -- 'connected' state
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

COMMENT ON FUNCTION public.get_rejoin_status IS
  'Returns rejoin status for a player. Checks user_id (not yet replaced) and '
  'human_user_id (replaced by bot). Returns seconds_left and disconnect_timer_active '
  'fields consumed by HomeScreen.tsx.';
