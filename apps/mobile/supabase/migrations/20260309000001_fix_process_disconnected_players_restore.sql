-- ============================================================================
-- Migration: fix_process_disconnected_players_restore
-- Branch: fix/auto-pass-cascade
-- Date: 2026-03-09
--
-- Purpose:
--   Restores correct process_disconnected_players() function.
--
--   The previous migration (20260308000004) introduced TWO critical bugs:
--
--   BUG 1 — Contradictory WHERE clause in Phase B:
--     WHERE rp.connection_status = 'disconnected'
--       AND rp.connection_status NOT IN ('disconnected', 'replaced_by_bot')
--     These conditions can NEVER both be true, so Phase B never finds rows
--     and bot replacement NEVER happens via the server sweep.
--
--   BUG 2 — Wrong column name in replacement UPDATE:
--     disconnect_timer_expires_at does not exist in the schema.
--     The correct column is disconnect_timer_started_at.
--
--   This migration restores the correct logic from 20260306000001 while
--   preserving the useful active-turn guard from 20260308000004 (skip
--   replacement if the player's turn is still active with time remaining).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_disconnected_players()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_turn_elapsed    INTERVAL;
BEGIN

  -- ── Phase A: Mark stale heartbeats as disconnected ───────────────────────
  FOR rec IN
    SELECT rp.id, rp.room_id
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    WHERE  rp.is_bot             = FALSE
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
    SELECT rp.*, gs.current_turn, gs.turn_started_at
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    LEFT JOIN public.game_state gs ON gs.room_id = r.id
    WHERE  rp.is_bot             = FALSE
      AND  rp.connection_status  = 'disconnected'
      -- Use persistent timer (survives heartbeat-resume cycles)
      AND  rp.disconnect_timer_started_at IS NOT NULL
      AND  rp.disconnect_timer_started_at < NOW() - BOT_REPLACE_AFTER
      AND  r.status              = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    -- Active-turn guard: if this player's turn is active and turn timer hasn't
    -- expired yet (60s + 10s buffer for auto-play), skip replacement to let
    -- auto-play-turn handle it first. This prevents a race where bot replacement
    -- interferes with the auto-play edge function.
    IF rec.current_turn = rec.player_index AND rec.turn_started_at IS NOT NULL THEN
      v_turn_elapsed := NOW() - rec.turn_started_at;
      IF v_turn_elapsed < INTERVAL '70 seconds' THEN
        CONTINUE; -- Let auto-play handle this player
      END IF;
    END IF;

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
    'affected_room_codes',         to_jsonb(v_affected_codes)
  );
END;
$function$;

-- Restrict to service_role only (called by update-heartbeat edge function)
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM anon;
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_disconnected_players() TO service_role;

COMMENT ON FUNCTION public.process_disconnected_players IS
  'Sweeps room_players for stale heartbeats and replaces long-disconnected players with bots. '
  'Returns rooms_with_bot_replacements for bot-coordinator triggering. '
  'Restores correct logic after contradictory WHERE clause bug in 20260308000004.';
