-- ============================================================================
-- Migration: Recalculate rank points from post-reset date only
-- Reset date: 2026-03-23 08:53:51 UTC
--   (commit cfb9e8d3 "feat: comprehensive app fixes (16 tasks)" applied
--    20260715000000_reset_all_player_stats.sql — first post-reset game was
--    2026-03-23 08:56:00 UTC, confirming the migration ran at that timestamp)
--
-- Problem: previous recalculation used ALL game_history (Dec 2025–now),
-- producing inflated RP (e.g. Steve Peterson: 26 187). We must only count
-- games played AFTER the leaderboard was reset.
--
-- Rules (matches update_player_stats_after_game function):
--   • game mode IN ('ranked')     → skip (ranked uses ELO, not casual RP)
--   • voided_user_id = player_id  → 0 change (game voided for this player)
--   • player_X_disconnected = true AND not voided → -50 (abandoned)
--   • completed game              → ((100 - LEAST(score, 100)) * bot_mult)::INT
--   • bot_difficulty multiplier: easy=0.5, medium=0.7, hard=0.9, human/null=1.0
-- ============================================================================

DO $$
DECLARE
  v_reset_date TIMESTAMPTZ := '2026-03-23 08:53:51+00'::TIMESTAMPTZ;
BEGIN

  -- ── Step 1: Recalculate casual_rank_points / rank_points for every player ──
  UPDATE player_stats ps
  SET
    casual_rank_points  = calcs.new_rp,
    rank_points         = calcs.new_rp,
    rank_points_history = '[]'::jsonb,
    updated_at          = NOW()
  FROM (
    SELECT
      player_id,
      1000 + COALESCE(SUM(rp_change), 0) AS new_rp
    FROM (
      -- Flatten game_history into one row per player per game
      SELECT
        p_slot.player_id,
        CASE
          -- Voided for this player → no RP change
          WHEN COALESCE(g.voided_user_id = p_slot.player_id, false) THEN 0
          -- Disconnected (abandoned) → -50
          WHEN COALESCE(p_slot.disconnected, false)                  THEN -50
          -- Completed game → score-based gain
          ELSE (
            (100 - LEAST(p_slot.score, 100))::DECIMAL
            * CASE
                WHEN g.bot_difficulty = 'easy'   THEN 0.5
                WHEN g.bot_difficulty = 'medium' THEN 0.7
                WHEN g.bot_difficulty = 'hard'   THEN 0.9
                ELSE 1.0
              END
          )::INTEGER
        END AS rp_change
      FROM game_history g
      CROSS JOIN LATERAL (
        VALUES
          (g.player_1_id, g.player_1_score, g.player_1_disconnected),
          (g.player_2_id, g.player_2_score, g.player_2_disconnected),
          (g.player_3_id, g.player_3_score, g.player_3_disconnected),
          (g.player_4_id, g.player_4_score, g.player_4_disconnected)
      ) AS p_slot(player_id, score, disconnected)
      WHERE p_slot.player_id IS NOT NULL
      AND   g.game_mode NOT IN ('ranked')
      AND   g.created_at >= v_reset_date
    ) game_changes
    GROUP BY player_id
  ) calcs
  WHERE ps.user_id = calcs.player_id;

  -- ── Step 2: Players with zero post-reset games reset to 1000 ─────────────
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
      VALUES (g.player_1_id), (g.player_2_id), (g.player_3_id), (g.player_4_id)
    ) AS p_slot(player_id)
    WHERE p_slot.player_id IS NOT NULL
    AND   g.game_mode NOT IN ('ranked')
    AND   g.created_at >= v_reset_date
  );

END $$;

-- Players with games_played=0 had orphaned game_history entries (stats function
-- was never called for them) — keep them at base 1000 regardless of history
UPDATE player_stats ps
SET casual_rank_points = 1000, rank_points = 1000, rank_points_history = '[]'::jsonb, updated_at = NOW()
WHERE ps.casual_rank_points != 1000
AND NOT EXISTS (
  SELECT 1 FROM game_history g
  CROSS JOIN LATERAL (VALUES
    (g.player_1_id), (g.player_2_id), (g.player_3_id), (g.player_4_id)
  ) AS sl(player_id)
  WHERE sl.player_id = ps.user_id
  AND g.game_mode NOT IN ('ranked')
  AND g.created_at >= '2026-03-23 08:53:51+00'
  AND g.stats_applied_at IS NOT NULL
);

-- Refresh all leaderboard materialized views
SELECT refresh_leaderboard();
