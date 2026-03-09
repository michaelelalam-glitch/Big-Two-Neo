-- ============================================================================
-- Migration: fix_abandoned_game_stats_recording
-- Branch: task/621-leaderboard-fixes
-- Date: 2026-03-09
--
-- Problem:
--   When all human players leave a game before it finishes, the server closes
--   the room (sets status='finished') inside process_disconnected_players() but
--   never records stats for any player.  Stats are only written via the
--   complete-game edge function — which is called by the game client when it
--   observes game_phase='game_over'.  With no humans left in the room there is
--   no client alive to trigger that path, so both players end up with nothing
--   recorded on their Game Completion stats.
--
-- Fix:
--   Extend the "sole human left → close the room" branch inside
--   process_disconnected_players() to immediately call
--   update_player_stats_after_game() for every affected human:
--
--     • The last human to disconnect (rec.user_id) → p_voided = true
--       These players are the "last person standing" — they voided the game
--       and their stats are deliberately excluded from games_played /
--       completion_rate so the incomplete game doesn't distort their %.
--
--     • Every human who was previously replaced by a bot in this room
--       (room_players rows where is_bot = TRUE AND human_user_id IS NOT NULL)
--       → p_voided = false, p_completed = false  (= abandoned)
--       These players left early; the usual ELO penalty and games_abandoned
--       increment apply.
--
--   Both paths are wrapped in individual BEGIN/EXCEPTION blocks so a single
--   bad user_id cannot abort the whole sweep — the warning is logged and the
--   function continues.
--
-- Unchanged behaviour:
--   • When humans remain, bot-replacement logic is exactly as before.
--   • Phase A (mark stale heartbeats as disconnected) is unchanged.
--   • Return shape is unchanged — no callers need updating.
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

    -- ── Sole human left → close the room and record stats ────────────────────
    IF v_human_count = 0 THEN
      UPDATE public.rooms
      SET
        status      = 'finished',
        finished_at = NOW(),
        updated_at  = NOW()
      WHERE id = rec.room_id
        AND status = 'playing';

      IF FOUND THEN
        v_closed := v_closed + 1;

        -- Determine game_type from room flags (mirrors complete-game edge function)
        v_game_type := CASE
          WHEN v_room.ranked_mode = TRUE THEN 'ranked'
          WHEN v_room.is_public   = TRUE THEN 'casual'
          ELSE 'private'
        END;

        -- Record VOIDED stat for the last human to leave.
        -- p_voided=true means: games_voided += 1, but games_played / ELO /
        -- completion_rate are NOT touched (see update_player_stats_after_game).
        BEGIN
          PERFORM update_player_stats_after_game(
            p_user_id         := rec.user_id,
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
            rec.user_id, SQLERRM;
        END;

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
            RAISE WARNING '[process_disconnected_players] abandoned stat failed for user %: %',
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
GRANT EXECUTE ON FUNCTION public.process_disconnected_players() TO service_role;

COMMENT ON FUNCTION public.process_disconnected_players IS
  'Sweeps room_players for stale heartbeats, replaces long-disconnected players with bots, '
  'and — when the last human leaves — closes the room and records abandoned/voided stats '
  'for all human participants via update_player_stats_after_game().';
