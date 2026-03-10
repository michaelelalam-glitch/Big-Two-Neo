-- ============================================================================
-- Migration: fix_phase_b_no_turn_guard
-- Branch: game/chinese-poker
-- Date: 2026-03-10
--
-- Root-cause fix: bot replacement takes 3+ minutes the 2nd time a player
-- disconnects.
--
-- Why it happened:
--   Phase B has a turn-guard that skips bot replacement when the disconnected
--   player's turn is active and < 70 s have elapsed on that turn:
--
--     IF rec.current_turn = rec.player_index AND rec.turn_started_at IS NOT NULL THEN
--       v_turn_elapsed := NOW() - rec.turn_started_at;
--       IF v_turn_elapsed < INTERVAL '70 seconds' THEN
--         CONTINUE;  -- ← keeps skipping indefinitely
--       END IF;
--     END IF;
--
--   This guard was added in 20260308000004 to prevent Phase B racing with
--   auto-play: if the player's client was still active, their turn timer might
--   fire auto-play at the same moment Phase B replaced them.
--
--   The guard is WRONG for fully-disconnected players because:
--   1. useTurnInactivityTimer only fires auto-play for the LOCAL (connected)
--      player's OWN turn — it never fires for another player's turn.
--   2. A disconnected player has no client, so auto-play is never called for
--      them; their turn stays active indefinitely.
--   3. Every Phase B sweep sees an "active" turn (< 70 s because it was just
--      started by the game advancing) and keeps skipping, so the player is
--      never replaced.
--   4. With pg_cron firing once per minute and HEARTBEAT_SLACK = 30 s, worst-
--      case wait compounds to 3-4 minutes before any sweep fires with the turn
--      having been active for ≥ 70 s.
--
-- Fix:
--   Remove the turn guard entirely from Phase B.  All players entering Phase B
--   already satisfy connection_status = 'disconnected' with an expired timer,
--   so the race condition the guard was meant to prevent cannot occur.
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
  STUCK_ROOM_AFTER  CONSTANT INTERVAL := INTERVAL '5 minutes';

  rec               RECORD;
  v_room            RECORD;
  v_abandoned       RECORD;
  v_slot            RECORD;
  v_human_count     INTEGER;
  v_bot_difficulty  VARCHAR(10);
  v_bot_multiplier  DECIMAL := 1.0;
  v_game_type       TEXT;
  v_marked          INTEGER := 0;
  v_replaced        INTEGER := 0;
  v_closed          INTEGER := 0;
  v_affected_codes  TEXT[]  := '{}';
  v_room_code       TEXT;
  v_voided_user_id  UUID;

  -- Phase A anchor computation (from 20260309000002 / 20260309000006)
  v_gs_current_turn    INTEGER;
  v_gs_turn_started_at TIMESTAMPTZ;
  v_phase_a_anchor     TIMESTAMPTZ;

  -- game_history player slots (indexed 1-4 by player_index+1)
  v_p_ids            UUID[]    := ARRAY[NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID];
  v_p_usernames      TEXT[]    := ARRAY[NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT];
  v_p_orig_usernames TEXT[]    := ARRAY[NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT];
  v_p_was_bot        BOOLEAN[] := ARRAY[FALSE, FALSE, FALSE, FALSE];
  v_p_disconn        BOOLEAN[] := ARRAY[FALSE, FALSE, FALSE, FALSE];
  v_slot_idx         INTEGER;
BEGIN

  -- ── Phase A: Mark stale heartbeats as disconnected ───────────────────────
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
    SELECT current_turn, turn_started_at
    INTO   v_gs_current_turn, v_gs_turn_started_at
    FROM   public.game_state
    WHERE  room_id = rec.room_id
    LIMIT  1;

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
      disconnect_timer_started_at = COALESCE(disconnect_timer_started_at, v_phase_a_anchor)
    WHERE id               = rec.id
      AND connection_status = 'connected'
      AND last_seen_at      < NOW() - HEARTBEAT_SLACK;

    IF FOUND THEN
      v_marked := v_marked + 1;
    END IF;
  END LOOP;

  -- ── Phase B: Replace long-disconnected players with bots (or close room) ─
  --
  -- NOTE: The turn-guard (skip if v_turn_elapsed < 70s) was intentionally
  -- removed in this migration.  All players here have connection_status =
  -- 'disconnected'; their client is gone so auto-play will never fire for
  -- them.  Keeping the guard caused indefinite skips (turn stays "active"
  -- because nobody advances it) resulting in 3+ minute replacement delays.
  FOR rec IN
    SELECT rp.*
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    WHERE  rp.is_bot             = FALSE
      AND  rp.connection_status  = 'disconnected'
      AND  rp.disconnect_timer_started_at IS NOT NULL
      AND  rp.disconnect_timer_started_at < NOW() - BOT_REPLACE_AFTER
      AND  r.status              = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    SELECT * INTO v_room FROM public.rooms WHERE id = rec.room_id;

    SELECT COUNT(*)
    INTO   v_human_count
    FROM   public.room_players
    WHERE  room_id          = rec.room_id
      AND  is_bot           = FALSE
      AND  connection_status NOT IN ('disconnected', 'replaced_by_bot')
      AND  id               != rec.id;

    -- ── Sole human left → close the room and record stats ──────────────────
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

        v_game_type := CASE
          WHEN v_room.ranked_mode = TRUE THEN 'ranked'
          WHEN v_room.is_public   = TRUE THEN 'casual'
          ELSE 'private'
        END;

        -- Identify VOIDED player (last to leave, per heartbeat anchor)
        SELECT user_id
        INTO   v_voided_user_id
        FROM   public.room_players
        WHERE  room_id           = rec.room_id
          AND  is_bot            = FALSE
          AND  connection_status = 'disconnected'
        -- last_seen_at is intentionally excluded: for bot-replaced rows it
        -- reflects bot heartbeats rather than the human's actual disconnect time.
        ORDER BY COALESCE(disconnect_timer_started_at, disconnected_at) DESC NULLS LAST
        LIMIT 1;

        IF v_voided_user_id IS NULL THEN
          v_voided_user_id := rec.user_id;
        END IF;

        -- ── Insert game_history for audit trail ────────────────────────────
        -- Build 4 player slots from room_players (index 0..3 → column 1..4).
        -- Scores and combo counts are unavailable server-side without the full
        -- game state; columns default to 0/NULL which is acceptable for
        -- incomplete games.
        v_p_ids            := ARRAY[NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID];
        v_p_usernames      := ARRAY[NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT];
        v_p_orig_usernames := ARRAY[NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT];
        v_p_was_bot        := ARRAY[FALSE, FALSE, FALSE, FALSE];
        v_p_disconn        := ARRAY[FALSE, FALSE, FALSE, FALSE];

        FOR v_slot IN
          SELECT player_index,
                 user_id,
                 username,
                 replaced_username,
                 is_bot,
                 human_user_id,
                 connection_status
          FROM   public.room_players
          WHERE  room_id = rec.room_id
            AND  player_index BETWEEN 0 AND 3
        LOOP
          v_slot_idx := v_slot.player_index + 1; -- 1-based array index
          -- For bot slots that replaced a human, record the original human's ID
          v_p_ids[v_slot_idx]            := COALESCE(v_slot.human_user_id, v_slot.user_id);
          v_p_usernames[v_slot_idx]      := v_slot.username;
          -- Preserve original human name in audit trail for bot-replaced slots
          v_p_orig_usernames[v_slot_idx] := CASE
            WHEN v_slot.human_user_id IS NOT NULL THEN v_slot.replaced_username
            ELSE NULL
          END;
          v_p_was_bot[v_slot_idx]        := v_slot.is_bot;
          v_p_disconn[v_slot_idx]        := (v_slot.connection_status = 'disconnected');
        END LOOP;

        BEGIN
          INSERT INTO public.game_history (
            room_id, room_code, game_type, game_completed,
            winner_id, started_at, finished_at,
            player_1_id,       player_2_id,       player_3_id,       player_4_id,
            player_1_username, player_2_username, player_3_username, player_4_username,
            player_1_original_username, player_2_original_username,
            player_3_original_username, player_4_original_username,
            player_1_was_bot,  player_2_was_bot,  player_3_was_bot,  player_4_was_bot,
            player_1_disconnected, player_2_disconnected,
            player_3_disconnected, player_4_disconnected,
            voided_user_id
          ) VALUES (
            rec.room_id,
            v_room.code,
            v_game_type,
            FALSE,           -- game not completed
            NULL,            -- no winner
            COALESCE(v_room.started_at, v_room.created_at),
            NOW(),
            v_p_ids[1],            v_p_ids[2],            v_p_ids[3],            v_p_ids[4],
            v_p_usernames[1],      v_p_usernames[2],      v_p_usernames[3],      v_p_usernames[4],
            v_p_orig_usernames[1], v_p_orig_usernames[2], v_p_orig_usernames[3], v_p_orig_usernames[4],
            v_p_was_bot[1],        v_p_was_bot[2],        v_p_was_bot[3],        v_p_was_bot[4],
            v_p_disconn[1],        v_p_disconn[2],        v_p_disconn[3],        v_p_disconn[4],
            v_voided_user_id  -- NULL for non-voided / unknown
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[process_disconnected_players] game_history insert failed for room %: %',
            v_room.code, SQLERRM;
        END;

        -- Record VOIDED stat
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

        -- Derive bot multiplier for this room (mirrors complete-game server logic:
        -- hardest bot_difficulty present wins; no bots → 1.0 for all-human game).
        SELECT COALESCE(
          CASE
            WHEN bool_or(bot_difficulty = 'hard')   THEN 0.9
            WHEN bool_or(bot_difficulty = 'medium') THEN 0.7
            WHEN bool_or(bot_difficulty = 'easy')   THEN 0.5
            ELSE 1.0
          END,
          1.0
        )
        INTO v_bot_multiplier
        FROM public.room_players
        WHERE room_id = rec.room_id
          AND is_bot  = TRUE;

        -- Record ABANDONED for every OTHER still-disconnected human in the room
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
              -- Use worst-case score so the ELO formula (100 - score) applies a
              -- penalty (-100) rather than incorrectly rewarding abandonment (+100).
              p_score           := 200,
              p_combos_played   := '{}'::jsonb,
              p_game_type       := v_game_type,
              p_completed       := false,
              p_cards_left      := 0,
              p_voided          := false,
              p_bot_multiplier  := v_bot_multiplier
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '[process_disconnected_players] abandoned stat failed for user %: %',
              v_abandoned.user_id, SQLERRM;
          END;
        END LOOP;

        -- Record ABANDONED for every human previously replaced by a bot
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
              -- Use worst-case score so the ELO formula (100 - score) applies a
              -- penalty (-100) rather than incorrectly rewarding abandonment (+100).
              p_score           := 200,
              p_combos_played   := '{}'::jsonb,
              p_game_type       := v_game_type,
              p_completed       := false,
              p_cards_left      := 0,
              p_voided          := false,
              p_bot_multiplier  := v_bot_multiplier
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '[process_disconnected_players] abandoned stat failed for bot-replaced user %: %',
              v_abandoned.human_user_id, SQLERRM;
          END;
        END LOOP;
      END IF;

      CONTINUE;
    END IF;

    -- ── Still other connected humans → replace with a bot ──────────────────
    IF v_room.ranked_mode = TRUE THEN
      v_bot_difficulty := 'hard';
    ELSE
      v_bot_difficulty := COALESCE(
        v_room.settings->>'bot_difficulty',
        rec.bot_difficulty,
        'medium'
      );
    END IF;

    UPDATE public.room_players
    SET
      human_user_id               = rec.user_id,
      replaced_username           = rec.username,
      user_id                     = NULL,
      is_bot                      = TRUE,
      bot_difficulty              = v_bot_difficulty,
      username                    = 'Bot ' || REGEXP_REPLACE(COALESCE(rec.username, 'Player'), '^Bot ', '', 'i'),
      connection_status           = 'replaced_by_bot',
      disconnected_at             = NULL,
      disconnect_timer_started_at = NULL,
      last_seen_at                = NOW()
    WHERE id = rec.id
      AND connection_status = 'disconnected';

    IF FOUND THEN
      v_replaced := v_replaced + 1;

      SELECT code INTO v_room_code FROM public.rooms WHERE id = rec.room_id;
      IF v_room_code IS NOT NULL AND NOT (v_room_code = ANY(v_affected_codes)) THEN
        v_affected_codes := array_append(v_affected_codes, v_room_code);
      END IF;
    END IF;
  END LOOP;

  -- ── Phase C: Close rooms that are stuck in 'playing' with no human rows ──
  -- This handles the edge case where room_players rows were hard-deleted
  -- (bypassing the normal disconnect flow) leaving the room permanently stuck.
  -- The old signOut() code could trigger this; it has been fixed, but Phase C
  -- acts as a safety net for any future paths that might also hard-delete rows.
  FOR rec IN
    SELECT r.id, r.code, r.is_public, r.ranked_mode, r.started_at, r.created_at
    FROM   public.rooms r
    WHERE  r.status     = 'playing'
      AND  r.updated_at < NOW() - STUCK_ROOM_AFTER
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
      AND  NOT EXISTS (
             SELECT 1
             FROM   public.room_players rp
             WHERE  rp.room_id = r.id
               AND  rp.is_bot  = FALSE
           )
  LOOP
    UPDATE public.rooms
    SET
      status      = 'finished',
      finished_at = NOW(),
      updated_at  = NOW()
    WHERE id     = rec.id
      AND status = 'playing';

    IF FOUND THEN
      v_closed := v_closed + 1;

      -- Insert a minimal game_history entry so the room appears in history
      -- (player IDs are unknown since rows were deleted; columns default to NULL).
      BEGIN
        INSERT INTO public.game_history (
          room_id, room_code, game_type, game_completed,
          winner_id, started_at, finished_at
        ) VALUES (
          rec.id,
          rec.code,
          CASE
            WHEN rec.ranked_mode = TRUE THEN 'ranked'
            WHEN rec.is_public   = TRUE THEN 'casual'
            ELSE 'private'
          END,
          FALSE,
          NULL,
          COALESCE(rec.started_at, rec.created_at),
          NOW()
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[process_disconnected_players] Phase C game_history insert failed for room %: %',
          rec.code, SQLERRM;
      END;

      RAISE WARNING '[process_disconnected_players] Phase C: closed stuck room % (no human rows found after 5 min)',
        rec.code;

        -- Even though the leave-path that caused the rows to be deleted has
        -- been fixed, we can still recover ABANDONED stats for any humans who
        -- were bot-replaced BEFORE the room got stuck.  Their human_user_id is
        -- preserved in the is_bot=true rows so we can still credit them.
        -- We cannot determine who was the 'last' to leave (row ordering is lost),
        -- so everyone present in a bot slot gets ABANDONED (not VOIDED).

        -- Derive bot multiplier for Phase C (from bot rows still present in the stuck room)
        SELECT COALESCE(
          CASE
            WHEN bool_or(bot_difficulty = 'hard')   THEN 0.9
            WHEN bool_or(bot_difficulty = 'medium') THEN 0.7
            WHEN bool_or(bot_difficulty = 'easy')   THEN 0.5
            ELSE 1.0
          END,
          1.0
        )
        INTO v_bot_multiplier
        FROM public.room_players
        WHERE room_id = rec.id
          AND is_bot  = TRUE;

          FOR v_abandoned IN
            SELECT human_user_id, ranked_mode, is_public
            FROM   public.room_players rp
            JOIN   public.rooms r ON r.id = rp.room_id
            WHERE  rp.room_id       = rec.id
              AND  rp.is_bot        = TRUE
              AND  rp.human_user_id IS NOT NULL
          LOOP
            -- Per-user isolation: one bad row cannot skip the rest of the loop
            BEGIN
              PERFORM update_player_stats_after_game(
                p_user_id         := v_abandoned.human_user_id,
                p_won             := false,
                p_finish_position := 4,
                -- Use worst-case score so the ELO formula (100 - score) applies a
                -- penalty (-100) rather than incorrectly rewarding abandonment (+100).
                p_score           := 200,
                p_combos_played   := '{}'::jsonb,
                p_game_type       := CASE
                                       WHEN rec.ranked_mode = TRUE THEN 'ranked'
                                       WHEN rec.is_public   = TRUE THEN 'casual'
                                       ELSE 'private'
                                     END,
                p_completed       := false,
                p_cards_left      := 0,
                p_voided          := false,
                p_bot_multiplier  := v_bot_multiplier
              );
            EXCEPTION WHEN OTHERS THEN
              RAISE WARNING '[process_disconnected_players] Phase C abandoned stats failed for room % user %: %',
                rec.code, v_abandoned.human_user_id, SQLERRM;
            END;
          END LOOP;
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
  'Phase A anchors disconnect_timer_started_at to last_seen_at (not NOW()). '
  'Phase B replaces disconnected players immediately once the 60 s timer expires — '
  'the turn-guard (skip if turn elapsed < 70 s) was removed because disconnected '
  'players have no client to call auto-play, so the turn stays active indefinitely '
  'and the guard caused 3+ minute replacement delays on 2nd+ disconnects. '
  'Phase B sole-human-left branch records abandoned/voided stats AND a game_history row '
  '(game_completed=false) for the closed room. '
  'Phase C closes rooms that are stuck in ''playing'' with no non-bot room_players rows '
  '(safety net for any path that hard-deletes rows instead of marking disconnected). '
  'Phase B and Phase C ABANDONED stats pass p_bot_multiplier derived from the '
  'hardest bot_difficulty present in the room, matching the complete-game edge function.';

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260310000003: Phase B turn-guard removed from process_disconnected_players';
  RAISE NOTICE '   - Bot replacement now fires immediately once 60 s timer expires (no turn-guard skip)';
  RAISE NOTICE '   - Fixes 3+ minute 2nd-replacement delay when player disconnects twice';
END $$;
