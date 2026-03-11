-- ============================================================================
-- Migration: fix_phase_b_bot_fk
-- Branch: task/623-incomplete-games-recent-stats
-- Date: 2026-03-11
--
-- Problem:
--   Phase B of process_disconnected_players() builds player slots from ALL
--   room_players rows, including pure-bot rows (is_bot=TRUE, human_user_id IS NULL).
--   For those rows COALESCE(human_user_id, user_id) = bot's user_id UUID.
--
--   game_history.player_X_id has FK constraints → auth.users(id) ON DELETE SET NULL.
--   Bot user_ids in room_players are NOT present in auth.users (confirmed:
--   1854 bot rows, 0 in auth.users). So inserting a bot UUID into player_X_id
--   triggers a FK violation on every INSERT → caught by EXCEPTION WHEN OTHERS
--   → silent WARNING, INSERT discarded → NO game_history row written.
--
--   Consequence: Phase B never successfully records an incomplete game.
--   Since Phase B already set the room to 'finished', Phase C (which only
--   processes status='playing') also never fires. Both the voided player AND
--   every abandoned player are permanently invisible in recent game history.
--
-- Fix:
--   In Phase B's player-slot-building loop, null out player_X_id for pure-bot
--   slots (is_bot=TRUE AND human_user_id IS NULL). This mirrors the logic in
--   the complete-game edge function:
--     const realPlayers = gameData.players.map(p =>
--       p.user_id.startsWith('bot_') ? null : p.user_id);
--
--   After this fix:
--   • Phase B INSERT succeeds → game appears in both players' recent history
--   • Abandoned player's human_user_id (from their replaced_by_bot row) is stored
--     at the correct player_X_id slot → visible via player_X_id filter
--   • Voided player's user_id (still is_bot=FALSE at INSERT time) is stored at
--     their slot → visible via player_X_id filter
--   • voided_user_id is already correctly computed (query uses is_bot=FALSE filter)
--
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
  v_bot_multiplier  DECIMAL := 1.0;
  v_voided_user_id  UUID;

  -- Phase A anchor computation
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
  v_history_exists   BOOLEAN;
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

    IF FOUND THEN v_marked := v_marked + 1; END IF;
  END LOOP;

  -- ── Phase B: Replace long-disconnected players with bots (or close room) ─
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

    SELECT COUNT(*) INTO v_human_count
    FROM   public.room_players
    WHERE  room_id          = rec.room_id
      AND  is_bot           = FALSE
      AND  connection_status NOT IN ('disconnected', 'replaced_by_bot')
      AND  id               != rec.id;

    -- ── Sole human left → close the room and record stats ────────────────────
    IF v_human_count = 0 THEN
      UPDATE public.rooms
      SET status = 'finished', finished_at = NOW(), updated_at = NOW()
      WHERE id = rec.room_id AND status = 'playing';

      IF FOUND THEN
        v_closed := v_closed + 1;

        v_game_type := CASE
          WHEN v_room.ranked_mode = TRUE THEN 'ranked'
          WHEN v_room.is_public   = TRUE THEN 'casual'
          ELSE 'private'
        END;

        -- Tie-safe voided-player detection: pick the single latest-to-disconnect
        -- human; if multiple players share the same max anchor (truly simultaneous
        -- disconnects) we cannot determine ordering, so leave voided_user_id NULL.
        -- The frontend treats NULL as a neutral "Incomplete" state for all players.
        WITH disconnected_players AS (
          SELECT
            COALESCE(rp.disconnect_timer_started_at, rp.disconnected_at) AS anchor,
            COALESCE(rp.human_user_id, rp.user_id)                       AS uid
          FROM public.room_players rp
          WHERE rp.room_id           = rec.room_id
            AND rp.is_bot            = FALSE
            AND rp.connection_status = 'disconnected'
        ),
        max_anchor AS (
          SELECT MAX(anchor) AS anchor
          FROM disconnected_players
        ),
        candidates AS (
          SELECT dp.uid
          FROM disconnected_players dp
          JOIN max_anchor ma ON dp.anchor = ma.anchor
          WHERE ma.anchor IS NOT NULL
        )
        SELECT CASE
                 WHEN COUNT(*) = 1 THEN MAX(uid)
                 ELSE NULL::UUID
               END
        INTO v_voided_user_id
        FROM candidates;

        SELECT EXISTS (
          SELECT 1 FROM public.game_history WHERE room_id = rec.room_id
        ) INTO v_history_exists;

        IF NOT v_history_exists THEN
          v_p_ids            := ARRAY[NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID];
          v_p_usernames      := ARRAY[NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT];
          v_p_orig_usernames := ARRAY[NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT];
          v_p_was_bot        := ARRAY[FALSE, FALSE, FALSE, FALSE];
          v_p_disconn        := ARRAY[FALSE, FALSE, FALSE, FALSE];

          FOR v_slot IN
            SELECT player_index,
                   COALESCE(human_user_id, user_id) AS effective_user_id,
                   username,
                   CASE WHEN human_user_id IS NOT NULL THEN replaced_username ELSE NULL END AS orig_username,
                   is_bot,
                   human_user_id,
                   connection_status
            FROM   public.room_players
            WHERE  room_id = rec.room_id AND player_index BETWEEN 0 AND 3
          LOOP
            v_slot_idx := v_slot.player_index + 1;
            -- KEY FIX: only store real human UUIDs in player_X_id.
            -- Pure-bot rows (is_bot=TRUE, human_user_id IS NULL) have user_ids
            -- that do NOT exist in auth.users — inserting them violates the FK
            -- constraint and silently rolls back the entire INSERT.
            -- This mirrors the complete-game edge function's `realPlayers` filter.
            v_p_ids[v_slot_idx]            := CASE
              WHEN v_slot.is_bot AND v_slot.human_user_id IS NULL THEN NULL
              ELSE v_slot.effective_user_id
            END;
            v_p_usernames[v_slot_idx]      := v_slot.username;
            v_p_orig_usernames[v_slot_idx] := v_slot.orig_username;
            v_p_was_bot[v_slot_idx]        := v_slot.is_bot;
            v_p_disconn[v_slot_idx]        := (v_slot.connection_status IN ('disconnected', 'replaced_by_bot'));
          END LOOP;

          BEGIN
            INSERT INTO public.game_history (
              room_id, room_code, game_type, game_completed, winner_id, started_at, finished_at,
              player_1_id, player_2_id, player_3_id, player_4_id,
              player_1_username, player_2_username, player_3_username, player_4_username,
              player_1_original_username, player_2_original_username,
              player_3_original_username, player_4_original_username,
              player_1_was_bot, player_2_was_bot, player_3_was_bot, player_4_was_bot,
              player_1_disconnected, player_2_disconnected, player_3_disconnected, player_4_disconnected,
              voided_user_id
            ) VALUES (
              v_room.id, v_room.code, v_game_type, FALSE, NULL,
              COALESCE(v_room.started_at, v_room.created_at), NOW(),
              v_p_ids[1], v_p_ids[2], v_p_ids[3], v_p_ids[4],
              v_p_usernames[1], v_p_usernames[2], v_p_usernames[3], v_p_usernames[4],
              v_p_orig_usernames[1], v_p_orig_usernames[2], v_p_orig_usernames[3], v_p_orig_usernames[4],
              v_p_was_bot[1], v_p_was_bot[2], v_p_was_bot[3], v_p_was_bot[4],
              v_p_disconn[1], v_p_disconn[2], v_p_disconn[3], v_p_disconn[4],
              v_voided_user_id
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '[process_disconnected_players] Phase B game_history insert failed for room %: %', v_room.code, SQLERRM;
          END;
        END IF;

        BEGIN
          PERFORM update_player_stats_after_game(
            p_user_id := v_voided_user_id, p_won := false,
            p_finish_position := 4, p_score := 0,
            p_combos_played := '{}'::jsonb, p_game_type := v_game_type,
            p_completed := false, p_cards_left := 0, p_voided := true
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[process_disconnected_players] voided stat failed for user %: %', v_voided_user_id, SQLERRM;
        END;

        SELECT COALESCE(
          CASE
            WHEN bool_or(bot_difficulty = 'hard')   THEN 0.9
            WHEN bool_or(bot_difficulty = 'medium') THEN 0.7
            WHEN bool_or(bot_difficulty = 'easy')   THEN 0.5
            ELSE 1.0
          END, 1.0
        )
        INTO v_bot_multiplier
        FROM public.room_players WHERE room_id = rec.room_id AND is_bot = TRUE;

        FOR v_abandoned IN
          SELECT user_id FROM public.room_players
          WHERE room_id = rec.room_id AND is_bot = FALSE
            AND connection_status = 'disconnected' AND user_id != v_voided_user_id
        LOOP
          BEGIN
            PERFORM update_player_stats_after_game(
              p_user_id := v_abandoned.user_id, p_won := false,
              p_finish_position := 4, p_score := 200,
              p_combos_played := '{}'::jsonb, p_game_type := v_game_type,
              p_completed := false, p_cards_left := 0,
              p_voided := false, p_bot_multiplier := v_bot_multiplier
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '[process_disconnected_players] abandoned stat failed for user %: %', v_abandoned.user_id, SQLERRM;
          END;
        END LOOP;

        FOR v_abandoned IN
          SELECT human_user_id FROM public.room_players
          WHERE room_id = rec.room_id AND is_bot = TRUE AND human_user_id IS NOT NULL
        LOOP
          BEGIN
            PERFORM update_player_stats_after_game(
              p_user_id := v_abandoned.human_user_id, p_won := false,
              p_finish_position := 4, p_score := 200,
              p_combos_played := '{}'::jsonb, p_game_type := v_game_type,
              p_completed := false, p_cards_left := 0,
              p_voided := false, p_bot_multiplier := v_bot_multiplier
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '[process_disconnected_players] abandoned stat failed for bot-replaced user %: %', v_abandoned.human_user_id, SQLERRM;
          END;
        END LOOP;
      END IF;
      CONTINUE;
    END IF;

    -- ── Still other connected humans → replace this player with a bot ──────
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
    WHERE id               = rec.id
      AND connection_status = 'disconnected';

    IF FOUND THEN
      v_replaced := v_replaced + 1;
      SELECT code INTO v_room_code FROM public.rooms WHERE id = rec.room_id;
      IF v_room_code IS NOT NULL AND NOT (v_room_code = ANY(v_affected_codes)) THEN
        v_affected_codes := array_append(v_affected_codes, v_room_code);
      END IF;
    END IF;
  END LOOP;

  -- ── Phase C: Close rooms stuck in 'playing' with no human rows ───────────
  -- Fires when ALL humans were bot-replaced and the game has been stuck > 5 min.
  -- Builds player slots exclusively from replaced_by_bot rows (human_user_id IS NOT NULL)
  -- so only real human UUIDs (which exist in auth.users) are stored in player_X_id.
  FOR rec IN
    SELECT r.id, r.code, r.is_public, r.ranked_mode, r.started_at, r.created_at
    FROM   public.rooms r
    WHERE  r.status     = 'playing'
      AND  r.updated_at < NOW() - STUCK_ROOM_AFTER
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
      AND  NOT EXISTS (
             SELECT 1 FROM public.room_players rp
             WHERE rp.room_id = r.id AND rp.is_bot = FALSE
           )
  LOOP
    UPDATE public.rooms
    SET status = 'finished', finished_at = NOW(), updated_at = NOW()
    WHERE id = rec.id AND status = 'playing';

    IF FOUND THEN
      v_closed := v_closed + 1;

      v_p_ids            := ARRAY[NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID];
      v_p_usernames      := ARRAY[NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT];
      v_p_orig_usernames := ARRAY[NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT];
      v_p_was_bot        := ARRAY[FALSE, FALSE, FALSE, FALSE];
      v_p_disconn        := ARRAY[FALSE, FALSE, FALSE, FALSE];

      -- Only read replaced_by_bot rows — human_user_id IS valid auth.users UUID.
      -- Pure-bot rows (human_user_id IS NULL) are skipped to avoid FK violation.
      FOR v_slot IN
        SELECT player_index,
               human_user_id    AS effective_user_id,
               username,
               replaced_username AS orig_username,
               is_bot,
               connection_status
        FROM   public.room_players
        WHERE  room_id       = rec.id
          AND  is_bot        = TRUE
          AND  human_user_id IS NOT NULL
          AND  player_index BETWEEN 0 AND 3
      LOOP
        v_slot_idx := v_slot.player_index + 1;
        v_p_ids[v_slot_idx]            := v_slot.effective_user_id;
        v_p_usernames[v_slot_idx]      := v_slot.username;
        v_p_orig_usernames[v_slot_idx] := v_slot.orig_username;
        v_p_was_bot[v_slot_idx]        := v_slot.is_bot;
        v_p_disconn[v_slot_idx]        := (v_slot.connection_status IN ('disconnected', 'replaced_by_bot'));
      END LOOP;

      v_voided_user_id := NULL;
      SELECT human_user_id
      INTO   v_voided_user_id
      FROM   public.room_players
      WHERE  room_id       = rec.id
        AND  is_bot        = TRUE
        AND  human_user_id IS NOT NULL
      ORDER BY COALESCE(disconnect_timer_started_at, disconnected_at) DESC NULLS LAST,
               human_user_id::text
      LIMIT 1;

      SELECT EXISTS (
        SELECT 1 FROM public.game_history WHERE room_id = rec.id
      ) INTO v_history_exists;

      IF NOT v_history_exists THEN
        BEGIN
          INSERT INTO public.game_history (
            room_id, room_code, game_type, game_completed, winner_id, started_at, finished_at,
            player_1_id,       player_2_id,       player_3_id,       player_4_id,
            player_1_username, player_2_username, player_3_username, player_4_username,
            player_1_original_username, player_2_original_username,
            player_3_original_username, player_4_original_username,
            player_1_was_bot,  player_2_was_bot,  player_3_was_bot,  player_4_was_bot,
            player_1_disconnected, player_2_disconnected,
            player_3_disconnected, player_4_disconnected,
            voided_user_id
          ) VALUES (
            rec.id, rec.code,
            CASE WHEN rec.ranked_mode = TRUE THEN 'ranked' WHEN rec.is_public = TRUE THEN 'casual' ELSE 'private' END,
            FALSE, NULL,
            COALESCE(rec.started_at, rec.created_at), NOW(),
            v_p_ids[1], v_p_ids[2], v_p_ids[3], v_p_ids[4],
            v_p_usernames[1], v_p_usernames[2], v_p_usernames[3], v_p_usernames[4],
            v_p_orig_usernames[1], v_p_orig_usernames[2], v_p_orig_usernames[3], v_p_orig_usernames[4],
            v_p_was_bot[1], v_p_was_bot[2], v_p_was_bot[3], v_p_was_bot[4],
            v_p_disconn[1], v_p_disconn[2], v_p_disconn[3], v_p_disconn[4],
            v_voided_user_id
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[process_disconnected_players] Phase C game_history insert failed for room %: %', rec.code, SQLERRM;
        END;
      END IF;

      RAISE WARNING '[process_disconnected_players] Phase C: closed stuck room % (no human rows after 5 min)', rec.code;

      SELECT COALESCE(
        CASE
          WHEN bool_or(bot_difficulty = 'hard')   THEN 0.9
          WHEN bool_or(bot_difficulty = 'medium') THEN 0.7
          WHEN bool_or(bot_difficulty = 'easy')   THEN 0.5
          ELSE 1.0
        END, 1.0
      )
      INTO v_bot_multiplier
      FROM public.room_players WHERE room_id = rec.id AND is_bot = TRUE;

      FOR v_abandoned IN
        SELECT rp.human_user_id
        FROM   public.room_players rp
        WHERE  rp.room_id       = rec.id
          AND  rp.is_bot        = TRUE
          AND  rp.human_user_id IS NOT NULL
      LOOP
        BEGIN
          PERFORM update_player_stats_after_game(
            p_user_id         := v_abandoned.human_user_id,
            p_won             := false,
            p_finish_position := 4,
            p_score           := 200,
            p_combos_played   := '{}'::jsonb,
            p_game_type       := CASE WHEN rec.ranked_mode = TRUE THEN 'ranked' WHEN rec.is_public = TRUE THEN 'casual' ELSE 'private' END,
            p_completed       := false,
            p_cards_left      := 0,
            p_voided          := false,
            p_bot_multiplier  := v_bot_multiplier
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[process_disconnected_players] Phase C abandoned stat failed for room % user %: %',
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
