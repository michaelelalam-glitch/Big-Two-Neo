-- ============================================================================
-- Migration: fix_stuck_rooms_and_game_history
-- Branch: task/621-leaderboard-fixes
-- Date: 2026-03-09
--
-- Two additions to process_disconnected_players():
--
-- 1. Phase C: Stuck-room cleanup
--    Rooms that are still 'playing' but have NO non-bot room_players rows are
--    permanently stuck — the normal Phase B path can never fire because it
--    iterates over `is_bot=false AND connection_status='disconnected'` rows.
--    This happens when a player's row is deleted directly (e.g., old signOut
--    behaviour that has now been fixed) instead of being marked disconnected.
--    Phase C finds such rooms that have been stuck for ≥5 minutes and marks
--    them 'finished'.  No stats can be recorded (player IDs are gone), but
--    at least the room no longer blocks DB queries and dashboards.
--
-- 2. game_history INSERT in Phase B
--    When Phase B closes a room (sole human left), a game_history row is
--    now inserted with game_completed=false so players can see the
--    abandoned/voided game in their history, and analysts can audit it.
--    Player slots are populated from the room_players rows that still exist
--    at close time; scores/combo counts are left at 0 (not available
--    server-side without the full game state).
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
  v_game_type       TEXT;
  v_marked          INTEGER := 0;
  v_replaced        INTEGER := 0;
  v_closed          INTEGER := 0;
  v_affected_codes  TEXT[]  := '{}';
  v_room_code       TEXT;
  v_turn_elapsed    INTERVAL;
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
  FOR rec IN
    SELECT rp.*, gs.current_turn, gs.turn_started_at
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    LEFT JOIN public.game_state gs ON gs.room_id = r.id
    WHERE  rp.is_bot             = FALSE
      AND  rp.connection_status  = 'disconnected'
      AND  rp.disconnect_timer_started_at IS NOT NULL
      AND  rp.disconnect_timer_started_at < NOW() - BOT_REPLACE_AFTER
      AND  r.status              = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    IF rec.current_turn = rec.player_index AND rec.turn_started_at IS NOT NULL THEN
      v_turn_elapsed := NOW() - rec.turn_started_at;
      IF v_turn_elapsed < INTERVAL '70 seconds' THEN
        CONTINUE;
      END IF;
    END IF;

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
            winner_id,
            started_at, finished_at,
            player_1_id,       player_2_id,       player_3_id,       player_4_id,
            player_1_username, player_2_username, player_3_username, player_4_username,
            player_1_original_username, player_2_original_username,
            player_3_original_username, player_4_original_username,
            player_1_was_bot,  player_2_was_bot,  player_3_was_bot,  player_4_was_bot,
            player_1_disconnected, player_2_disconnected,
            player_3_disconnected, player_4_disconnected,
            voided_user_id
          ) VALUES (
            v_room.id, v_room.code, v_game_type, FALSE,
            NULL,  -- no winner for abandoned/voided game
            COALESCE(v_room.started_at, v_room.created_at), NOW(),
            v_p_ids[1],            v_p_ids[2],            v_p_ids[3],            v_p_ids[4],
            v_p_usernames[1],      v_p_usernames[2],      v_p_usernames[3],      v_p_usernames[4],
            v_p_orig_usernames[1], v_p_orig_usernames[2],
            v_p_orig_usernames[3], v_p_orig_usernames[4],
            v_p_was_bot[1],        v_p_was_bot[2],        v_p_was_bot[3],        v_p_was_bot[4],
            v_p_disconn[1],        v_p_disconn[2],
            v_p_disconn[3],        v_p_disconn[4],
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
                p_score           := 0,
                p_combos_played   := '{}'::jsonb,
                p_game_type       := CASE
                                       WHEN rec.ranked_mode = TRUE THEN 'ranked'
                                       WHEN rec.is_public   = TRUE THEN 'casual'
                                       ELSE 'private'
                                     END,
                p_completed       := false,
                p_cards_left      := 0,
                p_voided          := false
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
  'Phase B sole-human-left branch records abandoned/voided stats AND a game_history row '
  '(game_completed=false) for the closed room. '
  'Phase C closes rooms that are stuck in ''playing'' with no non-bot room_players rows '
  '(safety net for any path that hard-deletes rows instead of marking disconnected).';
