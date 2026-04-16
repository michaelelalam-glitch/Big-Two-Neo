-- ============================================================================
-- Migration: Repair player rank points using the corrected formula
-- ============================================================================
-- Context: Migrations 20260719000001–20260719000006 and the data repair in
-- 20260719000005 all used the WRONG casual rank-point formula:
--   • LEAST(p_score, 100) cap — score > 100 gave 0 delta instead of negative
--   • Abandoned penalty was -50 instead of -25
--   • game_mode NOT IN ('ranked') filter accidentally included private games
--
-- This migration recalculates ALL players' casual_rank_points from their
-- post-reset casual game_history using the CORRECT formula (matching the tests
-- in rank-points-4player.test.ts):
--   voided    → 0
--   abandoned → -25 (fixed)
--   completed → ROUND((100 - score) × bot_multiplier)  [NO score cap]
--   No floor  — rank points can go negative and recover
--
-- It also:
--   • Rebuilds rank_points_history: casual entries from game_history +
--     existing ranked entries, sorted DESC, capped at 100.
--
-- Reset date: 2026-03-23 08:53:51 UTC — same scope used in migration 000005.
--   Games before this date were from the pre-reset era and should not count.
-- ============================================================================

DO $$
DECLARE
  v_reset_date      TIMESTAMPTZ := '2026-03-23 08:53:51+00'::TIMESTAMPTZ;
  v_player          RECORD;
  v_game            RECORD;
  v_casual_rp       INTEGER;
  v_delta           INTEGER;
  v_mult            NUMERIC;
  v_is_voided       BOOLEAN;
  v_is_completed    BOOLEAN;
  v_casual_history  JSONB;
  v_ranked_history  JSONB;
  v_merged          JSONB;
  v_entry           JSONB;
BEGIN

  -- ── Process each player ────────────────────────────────────────────────────
  FOR v_player IN
    SELECT user_id, rank_points_history
    FROM player_stats
  LOOP

    -- ── Step 1: Preserve existing ranked history as-is ───────────────────────
    -- Ranked ELO was computed correctly (K=32 pairwise in the edge function).
    -- This step only keeps existing ranked entries from rank_points_history
    -- and preserves them as-is; no flooring/capping is applied here.
    SELECT COALESCE(
      (
        SELECT jsonb_agg(e.entry ORDER BY (e.entry->>'timestamp')::timestamptz ASC NULLS LAST)
        FROM jsonb_array_elements(
          COALESCE(v_player.rank_points_history, '[]'::jsonb)
        ) AS e(entry)
        WHERE e.entry->>'game_type' = 'ranked'
      ),
      '[]'::jsonb
    ) INTO v_ranked_history;

    -- ── Step 2: Rebuild casual history from game_history (correct formula) ───
    v_casual_rp      := 1000;
    v_casual_history := '[]'::jsonb;

    FOR v_game IN
      SELECT
        g.finished_at,
        g.game_completed,
        g.winner_id,
        g.bot_difficulty,
        g.voided_user_id,
        CASE
          WHEN g.player_1_id = v_player.user_id THEN g.player_1_score
          WHEN g.player_2_id = v_player.user_id THEN g.player_2_score
          WHEN g.player_3_id = v_player.user_id THEN g.player_3_score
          WHEN g.player_4_id = v_player.user_id THEN g.player_4_score
        END AS player_score,
        CASE
          WHEN g.player_1_id = v_player.user_id THEN g.player_1_disconnected
          WHEN g.player_2_id = v_player.user_id THEN g.player_2_disconnected
          WHEN g.player_3_id = v_player.user_id THEN g.player_3_disconnected
          WHEN g.player_4_id = v_player.user_id THEN g.player_4_disconnected
        END AS player_disconnected
      FROM game_history g
      WHERE g.game_type = 'casual'
        AND g.created_at >= v_reset_date
        AND (
          g.player_1_id = v_player.user_id OR
          g.player_2_id = v_player.user_id OR
          g.player_3_id = v_player.user_id OR
          g.player_4_id = v_player.user_id
        )
      ORDER BY g.finished_at ASC
    LOOP
      -- Determine player status for this game
      v_is_voided    := COALESCE(v_game.voided_user_id = v_player.user_id, false);
      v_is_completed := COALESCE(v_game.game_completed, false)
                     AND NOT COALESCE(v_game.player_disconnected, false);

      -- Bot difficulty → multiplier (matches edge function logic)
      v_mult := CASE v_game.bot_difficulty
        WHEN 'hard'   THEN 0.9
        WHEN 'medium' THEN 0.7
        WHEN 'easy'   THEN 0.5
        ELSE 1.0
      END;

      -- Apply CORRECT delta formula (no LEAST cap; -25 for abandoned)
      v_delta := CASE
        WHEN v_is_voided        THEN 0
        WHEN NOT v_is_completed THEN -25
        ELSE ROUND((100 - COALESCE(v_game.player_score, 0))::DECIMAL * v_mult)::INTEGER
      END;

      -- No floor — rank points can go negative and recover
      v_casual_rp := v_casual_rp + v_delta;

      -- Build history entry
      v_entry := jsonb_build_object(
        'points',    v_casual_rp,
        'is_win',    COALESCE(v_game.winner_id = v_player.user_id, false),
        'game_type', 'casual',
        'timestamp', v_game.finished_at
      );

      -- Keep only the 100 most-recent casual entries while building history.
      -- This avoids repeatedly concatenating an ever-growing JSONB array, and
      -- is safe because Step 3 only keeps the 100 most-recent combined entries.
      SELECT COALESCE(
        jsonb_agg(entry ORDER BY (entry->>'timestamp')::timestamptz DESC NULLS LAST),
        '[]'::jsonb
      )
      INTO v_casual_history
      FROM (
        SELECT entry
        FROM (
          SELECT e.entry
          FROM jsonb_array_elements(v_casual_history) AS e(entry)
          UNION ALL
          SELECT v_entry
        ) casual_entries
        ORDER BY (entry->>'timestamp')::timestamptz DESC NULLS LAST
        LIMIT 100
      ) limited_entries;
    END LOOP;

    -- ── Step 3: Merge ranked + casual, keep 100 most-recent entries ──────────
    SELECT COALESCE(
      (
        SELECT jsonb_agg(
          inner_e.entry
          ORDER BY (inner_e.entry->>'timestamp')::timestamptz DESC NULLS LAST
        )
        FROM (
          SELECT entry
          FROM (
            SELECT e.entry
            FROM jsonb_array_elements(v_ranked_history)  AS e(entry)
            UNION ALL
            SELECT e.entry
            FROM jsonb_array_elements(v_casual_history) AS e(entry)
          ) combined
          ORDER BY (entry->>'timestamp')::timestamptz DESC NULLS LAST
          LIMIT 100
        ) inner_e
      ),
      '[]'::jsonb
    ) INTO v_merged;

    -- ── Step 4: Persist the corrected values ─────────────────────────────────
    UPDATE player_stats SET
      casual_rank_points  = v_casual_rp,
      rank_points         = v_casual_rp,   -- legacy column mirrors casual
      rank_points_history = v_merged,
      updated_at          = NOW()
    WHERE user_id = v_player.user_id;

  END LOOP;

END $$;

-- ── Players with no post-reset casual games: reset to 1000 ──────────────────
-- Covers accounts created but never played, or accounts whose games predate
-- the reset date. Their casual_rank_points might have been drifted by the
-- previous (incorrect) recalculation in migration 000005.
UPDATE player_stats
SET
  casual_rank_points  = 1000,
  rank_points         = 1000,
  rank_points_history = '[]'::jsonb,
  updated_at          = NOW()
WHERE user_id NOT IN (
  SELECT DISTINCT p_slot.player_id
  FROM game_history g
  CROSS JOIN LATERAL (
    VALUES
      (g.player_1_id),
      (g.player_2_id),
      (g.player_3_id),
      (g.player_4_id)
  ) AS p_slot(player_id)
  WHERE p_slot.player_id IS NOT NULL
    AND g.game_type = 'casual'
    AND g.created_at >= '2026-03-23 08:53:51+00'::TIMESTAMPTZ
)
AND casual_rank_points != 1000;

-- ── Refresh leaderboard views ────────────────────────────────────────────────
SELECT refresh_leaderboard();
