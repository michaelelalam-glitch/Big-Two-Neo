-- ============================================================================
-- Migration: fix_stats_recording_and_timer_anchor
-- Branch: task/621-leaderboard-fixes
-- Date: 2026-03-09
--
-- Fixes two regressions introduced by 20260309062340
-- (fix_abandoned_game_stats_recording):
--
-- 1. Phase A anchor regression (Copilot review comment #4 on PR #112)
--    Migration 20260309062340 replaced the Phase A body wholesale and
--    reverted the anchor to COALESCE(disconnect_timer_started_at, NOW()).
--    20260309000002 (fix_disconnect_timer_anchors) had established the
--    correct logic:
--      • Anchor to last_seen_at (when the heartbeat stopped) instead of
--        NOW() (when pg_cron ran, up to 30s later).
--      • Turn carry-over: if it's the player's active turn, use
--        LEAST(turn_started_at, last_seen_at) so the charcoal-grey
--        disconnect ring picks up exactly where the yellow turn ring left
--        off rather than jumping to a fresh 60s.
--    This migration restores that logic.
--
-- 2. Stats not recorded for all disconnected players (Copilot review
--    comment #5 on PR #112 + the root cause of the reported bug where
--    "nothing showed up on either player's game completion stats")
--
--    Root cause:
--      Phase B iterates over ALL disconnected players whose 60-second
--      timer has expired.  For a room where two players leave without
--      being bot-replaced both their rows satisfy the WHERE condition in
--      the same cron sweep.  When Phase B processes the first row:
--        • v_human_count = 0 (the other player is already 'disconnected')
--        • UPDATE rooms SET status='finished' → FOUND
--        • Stats recorded for rec.user_id (voided) only
--        • Bot-replaced abandoned loop finds nothing (neither was replaced)
--      When Phase B processes the second row for the SAME room:
--        • v_human_count = 0 again
--        • UPDATE rooms SET status='finished' → NOT FOUND (already closed)
--        • IF FOUND block skipped → second player gets NO stat at all
--
--    Fix:
--      When IF FOUND (we just closed the room):
--        a. Collect ALL still-disconnected non-bot humans in the room.
--        b. Determine the voided player deterministically: the one with
--           the LATEST disconnected_at (= truly last to leave).  This
--           removes the non-determinism of which iteration "wins".
--        c. Record ABANDONED for every other still-disconnected human.
--        d. Record ABANDONED for every bot-replaced human (existing logic,
--           kept as-is).
--      Because stats are now recorded for everyone in the single IF FOUND
--      pass, subsequent Phase B iterations for the same room correctly
--      skip (IF FOUND=false) without dropping any stats.
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
  v_abandoned       RECORD;
  v_human_count     INTEGER;
  v_bot_difficulty  VARCHAR(10);
  v_game_type       TEXT;
  v_marked          INTEGER := 0;
  v_replaced        INTEGER := 0;
  v_closed          INTEGER := 0;
  v_affected_codes  TEXT[]  := '{}';
  v_room_code       TEXT;
  v_turn_elapsed    INTERVAL;
  v_voided_user_id  UUID;

  -- Phase A anchor computation (restored from 20260309000002)
  v_gs_current_turn    INTEGER;
  v_gs_turn_started_at TIMESTAMPTZ;
  v_phase_a_anchor     TIMESTAMPTZ;
BEGIN

  -- ── Phase A: Mark stale heartbeats as disconnected ───────────────────────
  -- Selects last_seen_at and player_index so we can compute the correct
  -- disconnect_timer_started_at anchor instead of using NOW() (which can be
  -- up to 30s after the player actually stopped heartbeating).
  FOR rec IN
    SELECT rp.id, rp.room_id, rp.last_seen_at, rp.player_index
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    WHERE  rp.is_bot             = FALSE
      AND  rp.connection_status  = 'connected'
      AND  rp.last_seen_at       < NOW() - HEARTBEAT_SLACK
      AND  r.status              = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    -- Fetch game state to check whether it is this player's active turn
    SELECT current_turn, turn_started_at
    INTO   v_gs_current_turn, v_gs_turn_started_at
    FROM   public.game_state
    WHERE  room_id = rec.room_id
    LIMIT  1;

    -- Anchor selection:
    --   • Turn carry-over: if this player's turn is active and the turn
    --     started within the last 60s, use LEAST(turn_started_at, last_seen_at)
    --     so the in-game disconnect ring picks up where the yellow turn ring
    --     left off (no jump to a fresh 60s countdown).
    --   • Otherwise anchor to last_seen_at so the banner and ring measure
    --     time elapsed since the player actually stopped heartbeating, not
    --     since pg_cron happened to run.
    IF v_gs_current_turn = rec.player_index
       AND v_gs_turn_started_at IS NOT NULL
       AND v_gs_turn_started_at > rec.last_seen_at - INTERVAL '60 seconds'
    THEN
      v_phase_a_anchor := LEAST(v_gs_turn_started_at, rec.last_seen_at);
    ELSE
      v_phase_a_anchor := rec.last_seen_at;
    END IF;

    UPDATE public.room_players
    SET
      connection_status           = 'disconnected',
      disconnected_at             = NOW(),
      -- COALESCE: never overwrite an already-running persistent timer
      disconnect_timer_started_at = COALESCE(disconnect_timer_started_at, v_phase_a_anchor)
    WHERE id               = rec.id
      AND connection_status = 'connected'
      AND last_seen_at      < NOW() - HEARTBEAT_SLACK;

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
    -- auto-play-turn handle it first.
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

    -- ── Sole human left → close the room and record stats ────────────────────
    IF v_human_count = 0 THEN
      UPDATE public.rooms
      SET
        status      = 'finished',
        finished_at = NOW(),
        updated_at  = NOW()
      WHERE id     = rec.room_id
        AND status = 'playing';

      IF FOUND THEN
        v_closed := v_closed + 1;

        -- Determine game_type from room flags (mirrors complete-game edge function)
        v_game_type := CASE
          WHEN v_room.ranked_mode = TRUE THEN 'ranked'
          WHEN v_room.is_public   = TRUE THEN 'casual'
          ELSE 'private'
        END;

        -- Identify the VOIDED player: the still-disconnected (not-yet-replaced)
        -- human with the latest *actual* disconnect anchor.  We use the same
        -- heartbeat-based anchor as Phase A:
        --   COALESCE(disconnect_timer_started_at, last_seen_at, disconnected_at)
        -- so the "last to leave" matches real disconnect order even when multiple
        -- players are marked disconnected in the same sweep (disconnected_at = NOW()
        -- for all of them, making it non-deterministic).
        SELECT user_id
        INTO   v_voided_user_id
        FROM   public.room_players
        WHERE  room_id           = rec.room_id
          AND  is_bot            = FALSE
          AND  connection_status = 'disconnected'
        ORDER BY COALESCE(disconnect_timer_started_at, last_seen_at, disconnected_at) DESC NULLS LAST
        LIMIT 1;

        -- Safety fallback: if the query returns nothing (unexpected), fall back
        -- to the current rec's user_id.
        IF v_voided_user_id IS NULL THEN
          v_voided_user_id := rec.user_id;
        END IF;

        -- Record VOIDED stat for the last human to leave.
        -- p_voided=true → games_voided += 1 but games_played / ELO /
        -- completion_rate are NOT touched (per product spec).
        BEGIN
          PERFORM update_player_stats_after_game(
            p_user_id         := v_voided_user_id,
            p_won             := false,
            p_finish_position := 4,
            p_score           := 0,
            p_combos_played   := '{}'::jsonb,
            p_game_type       := v_game_type,
            p_completed       := false,
            p_cards_left      := 0,
            p_voided          := true
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[process_disconnected_players] voided stat failed for user %: %',
            v_voided_user_id, SQLERRM;
        END;

        -- Record ABANDONED for every OTHER still-disconnected human in the room
        -- (those whose timer also expired in this same sweep but who left earlier
        -- than the voided player).  This is the fix for the "second player gets
        -- nothing" bug — these rows also satisfy the WHERE clause above but their
        -- IF FOUND would be false since the room is now already 'finished'.
        FOR v_abandoned IN
          SELECT user_id
          FROM   public.room_players
          WHERE  room_id           = rec.room_id
            AND  is_bot            = FALSE
            AND  connection_status = 'disconnected'
            AND  user_id          != v_voided_user_id
        LOOP
          BEGIN
            PERFORM update_player_stats_after_game(
              p_user_id         := v_abandoned.user_id,
              p_won             := false,
              p_finish_position := 4,
              p_score           := 0,
              p_combos_played   := '{}'::jsonb,
              p_game_type       := v_game_type,
              p_completed       := false,
              p_cards_left      := 0,
              p_voided          := false
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '[process_disconnected_players] abandoned stat failed for user %: %',
              v_abandoned.user_id, SQLERRM;
          END;
        END LOOP;

        -- Record ABANDONED stat for every human previously replaced by a bot
        -- in this room.  p_voided=false, p_completed=false → games_abandoned += 1.
        FOR v_abandoned IN
          SELECT human_user_id
          FROM   public.room_players
          WHERE  room_id       = rec.room_id
            AND  is_bot        = TRUE
            AND  human_user_id IS NOT NULL
        LOOP
          BEGIN
            PERFORM update_player_stats_after_game(
              p_user_id         := v_abandoned.human_user_id,
              p_won             := false,
              p_finish_position := 4,
              p_score           := 0,
              p_combos_played   := '{}'::jsonb,
              p_game_type       := v_game_type,
              p_completed       := false,
              p_cards_left      := 0,
              p_voided          := false
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '[process_disconnected_players] abandoned stat failed for bot-replaced user %: %',
              v_abandoned.human_user_id, SQLERRM;
          END;
        END LOOP;
      END IF;

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
      -- Strip any existing 'Bot ' prefix before prepending to prevent 'Bot Bot ...' doubling
      username                    = 'Bot ' || REGEXP_REPLACE(COALESCE(rec.username, 'Player'), '^Bot ', '', 'i'),
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
GRANT  EXECUTE ON FUNCTION public.process_disconnected_players() TO service_role;

COMMENT ON FUNCTION public.process_disconnected_players IS
  'Sweeps room_players for stale heartbeats and replaces long-disconnected players with bots. '
  'Phase A anchors disconnect_timer_started_at to last_seen_at (not NOW()) so the '
  'home-screen banner immediately shows the correct remaining time. '
  'Turn carry-over: when it is the player''s active turn, uses LEAST(turn_started_at, '
  'last_seen_at) so the charcoal-grey disconnect ring picks up where the yellow turn ring left off. '
  'Phase B sole-human-left branch queries ALL still-disconnected humans, picks the latest '
  'COALESCE(disconnect_timer_started_at, last_seen_at, disconnected_at) as the voided player, '
  'and records abandoned for the rest — ensuring every '
  'player receives a stat regardless of Phase B iteration order.';
