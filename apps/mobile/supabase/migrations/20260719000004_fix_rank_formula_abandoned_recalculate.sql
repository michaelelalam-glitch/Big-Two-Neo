-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: Fix rank formula, abandoned penalty, and recalculate all players
--
-- Supersedes / corrects the approach in 20260719000001 and 20260719000003.
-- Both 20260719000003 and this migration are applied in the same batch:
--   • 20260719000003 temporarily floors ranks at 0 and updates the function;
--     this migration immediately overrides BOTH of those changes.
--   • The data clamp in 20260719000003 is made redundant by the full
--     recalculation in Step 3 below (game_history replay resets all values).
--
-- IMPORTANT: This migration recalculates from ALL game history (Dec 2025+),
-- which gives inflated RP for some players. 20260719000005 immediately follows
-- and corrects this by replaying only post-reset games (from 2026-03-23).
-- Both migrations are required: this one fixes the formula, the next one
-- fixes the date range.
--
-- CHANGES:
-- 1. Remove ROUND() from completed-game formula:
--      was: ROUND((100 - LEAST(score, 100)) * bot_multiplier)
--      now: ((100 - LEAST(score, 100)) * bot_multiplier)::INTEGER  (truncation)
--
-- 2. Abandoned games → fixed -50 penalty regardless of score or bot difficulty.
--      was: ROUND((100 - score) * multiplier)  → hugely negative for high scores
--           (e.g. score=200, mult=1.0 → -100; caused Steve's -702 spiral)
--      now: -50 always
--
-- 3. Remove GREATEST(0, ...) floor — rank CAN go below 0 (abandoned-game penalty)
--    but will recover as the player wins completed games.
--
-- 4. Recalculate ALL players' casual_rank_points from game_history using the new
--    formula and reset rank_points_history (the progression graph) so the graph
--    reflects the corrected starting state.
--
-- Formula after this migration:
--   completed casual game: delta = ((100 - min(score, 100)) × bot_multiplier)::int  ≥ 0
--   abandoned casual game: delta = -50  (independent of score or difficulty)
--   ranked game:           delta = p_ranked_elo_change  (chess ELO, unchanged)
--   private game:          delta = 0   (no rank impact, unchanged)
--
-- Recalculation formula:
--   new_casual_rp = 1000
--                 + Σ completed_game_delta   (from game_history where game_mode != 'ranked')
--                 - 50 × games_abandoned      (from player_stats.games_abandoned)
-- ──────────────────────────────────────────────────────────────────────────────


-- ──────────────────────────────────────────────────────────────────────────────
-- PART 1: Recalculate casual_rank_points for ALL players from game_history
-- ──────────────────────────────────────────────────────────────────────────────

UPDATE player_stats ps
SET
  casual_rank_points  = calcs.new_rp,
  rank_points         = calcs.new_rp,   -- legacy global column kept in sync
  rank_points_history = '[]'::jsonb     -- reset graph; entries rebuild from next game
FROM (
  SELECT
    ps2.user_id,
    1000
      + COALESCE(rg.total_gain, 0)
      - (50 * COALESCE(ps2.games_abandoned, 0)) AS new_rp
  FROM player_stats ps2
  LEFT JOIN (
    -- Aggregate rank gain from completed casual games for each player.
    -- game_history stores games as 'standard' / 'quick' / 'ranked'; we
    -- exclude only 'ranked' to capture all casual/quick modes.
    SELECT
      player_id,
      SUM(
        ((100 - LEAST(score, 100))::DECIMAL
          * CASE
              WHEN bot_difficulty = 'easy'   THEN 0.5
              WHEN bot_difficulty = 'medium' THEN 0.7
              WHEN bot_difficulty = 'hard'   THEN 0.9
              ELSE 1.0   -- all-human game or no bots
            END
        )::INTEGER
      ) AS total_gain
    FROM (
      -- Union all four player positions into (player_id, score, bot_difficulty)
      SELECT g.player_1_id AS player_id, g.player_1_score AS score, g.bot_difficulty
      FROM game_history g
      WHERE g.game_mode NOT IN ('ranked') AND g.player_1_id IS NOT NULL

      UNION ALL

      SELECT g.player_2_id, g.player_2_score, g.bot_difficulty
      FROM game_history g
      WHERE g.game_mode NOT IN ('ranked') AND g.player_2_id IS NOT NULL

      UNION ALL

      SELECT g.player_3_id, g.player_3_score, g.bot_difficulty
      FROM game_history g
      WHERE g.game_mode NOT IN ('ranked') AND g.player_3_id IS NOT NULL

      UNION ALL

      SELECT g.player_4_id, g.player_4_score, g.bot_difficulty
      FROM game_history g
      WHERE g.game_mode NOT IN ('ranked') AND g.player_4_id IS NOT NULL
    ) all_games
    GROUP BY player_id
  ) rg ON rg.player_id = ps2.user_id
) calcs
WHERE ps.user_id = calcs.user_id;

-- Players who have no games in game_history start at 1000 (already the default,
-- but reset explicitly in case any negative values exist).
UPDATE player_stats
SET
  casual_rank_points  = 1000,
  rank_points         = 1000,
  rank_points_history = '[]'::jsonb
WHERE
  user_id NOT IN (
    SELECT DISTINCT player_id FROM (
      SELECT player_1_id AS player_id FROM game_history WHERE game_mode NOT IN ('ranked') AND player_1_id IS NOT NULL
      UNION
      SELECT player_2_id FROM game_history WHERE game_mode NOT IN ('ranked') AND player_2_id IS NOT NULL
      UNION
      SELECT player_3_id FROM game_history WHERE game_mode NOT IN ('ranked') AND player_3_id IS NOT NULL
      UNION
      SELECT player_4_id FROM game_history WHERE game_mode NOT IN ('ranked') AND player_4_id IS NOT NULL
    ) ids
  );


-- ──────────────────────────────────────────────────────────────────────────────
-- PART 2: Replace update_player_stats_after_game with corrected rank formula
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_player_stats_after_game(
  p_user_id           UUID,
  p_won               BOOLEAN,
  p_finish_position   INTEGER,
  p_score             INTEGER,
  p_combos_played     JSONB,
  p_game_type         TEXT    DEFAULT 'casual',
  p_completed         BOOLEAN DEFAULT true,
  p_cards_left        INTEGER DEFAULT 0,
  p_voided            BOOLEAN DEFAULT false,
  p_bot_multiplier    DECIMAL DEFAULT 1.0,
  p_ranked_elo_change INTEGER DEFAULT 0
) RETURNS VOID AS $$
DECLARE
  v_stats                RECORD;
  v_new_win_rate         DECIMAL(5,2);
  v_new_mode_win_rate    DECIMAL(5,2);
  v_new_avg_score        DECIMAL(10,2);
  v_new_completion_rate  DECIMAL(5,2);
  v_new_avg_cards_left   DECIMAL(5,2);
  v_rank_point_change    INTEGER;
  v_new_casual_rp        INTEGER;
  v_new_ranked_rp        INTEGER;
  v_history_entry        JSONB;
  v_mode_completed       INTEGER;
  v_mode_total_cards     INTEGER;
  v_mode_avg_cards       DECIMAL(5,2);
  v_mode_avg_score       DECIMAL(10,2);
  v_mode_avg_pos         DECIMAL(3,2);
BEGIN
  SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    PERFORM initialize_player_stats(p_user_id);
    SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  END IF;

  -- ── Rank point change ────────────────────────────────────────────────────
  -- Casual completed: ((100 - min(score, 100)) × multiplier)::int  →  always ≥ 0
  -- Casual abandoned: fixed -50 regardless of score or bot difficulty
  -- Ranked:           chess ELO delta pre-computed by edge function
  -- Private:          no rank impact
  v_rank_point_change := CASE
    WHEN p_game_type = 'casual' THEN
      CASE
        WHEN NOT p_completed THEN -50   -- abandoned: fixed penalty
        ELSE ((100 - LEAST(p_score, 100))::DECIMAL * p_bot_multiplier)::INTEGER
      END
    ELSE 0
  END;

  -- Casual rank: no floor — can go below 0 from abandonment but recovers through wins.
  v_new_casual_rp :=
    COALESCE(v_stats.casual_rank_points, 1000) +
    CASE WHEN p_game_type = 'casual' THEN v_rank_point_change ELSE 0 END;

  -- Ranked ELO: no floor either — ELO is designed to be bidirectional.
  v_new_ranked_rp :=
    COALESCE(v_stats.ranked_rank_points, 1000) +
    CASE WHEN p_game_type = 'ranked' THEN p_ranked_elo_change ELSE 0 END;

  -- ── Global win rate ──────────────────────────────────────────────────────
  v_new_win_rate := ROUND(
    (v_stats.games_won + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL /
    (v_stats.games_played + 1)::DECIMAL * 100, 2
  );

  -- ── Global avg cards left ────────────────────────────────────────────────
  v_new_avg_cards_left := CASE
    WHEN p_completed AND NOT p_voided THEN
      ROUND(
        (COALESCE(v_stats.total_cards_left_in_hand, 0) + p_cards_left)::DECIMAL /
        (COALESCE(v_stats.games_completed, 0) + 1)::DECIMAL, 2
      )
    ELSE COALESCE(v_stats.avg_cards_left_in_hand, 0)
  END;

  -- ── Global avg score ─────────────────────────────────────────────────────
  v_new_avg_score := CASE
    WHEN p_completed THEN
      ROUND(
        (COALESCE(v_stats.avg_score_per_game, 0) * COALESCE(v_stats.games_completed, 0) + p_score)::DECIMAL /
        (COALESCE(v_stats.games_completed, 0) + 1)::DECIMAL, 2
      )
    ELSE v_stats.avg_score_per_game
  END;

  -- ── Completion rate ──────────────────────────────────────────────────────
  v_new_completion_rate := LEAST(100, GREATEST(0, ROUND(
    (COALESCE(v_stats.games_completed, 0) + CASE WHEN p_completed THEN 1 ELSE 0 END)::DECIMAL /
    (v_stats.games_played + 1)::DECIMAL * 100, 2
  )));

  -- ── Always-update block ──────────────────────────────────────────────────
  UPDATE player_stats SET
    games_played           = games_played + CASE WHEN NOT p_voided THEN 1 ELSE 0 END,
    games_won              = games_won  + CASE WHEN (NOT p_voided AND p_won) THEN 1 ELSE 0 END,
    games_lost             = games_lost + CASE WHEN (NOT p_voided AND NOT p_won) THEN 1 ELSE 0 END,
    win_rate               = CASE WHEN NOT p_voided THEN v_new_win_rate ELSE win_rate END,
    current_win_streak     = CASE
                               WHEN p_voided THEN current_win_streak
                               WHEN p_won    THEN current_win_streak + 1
                               ELSE 0
                             END,
    longest_win_streak     = CASE
                               WHEN p_voided THEN longest_win_streak
                               ELSE GREATEST(
                                 longest_win_streak,
                                 CASE WHEN p_won THEN current_win_streak + 1 ELSE current_win_streak END
                               )
                             END,
    current_loss_streak    = CASE
                               WHEN p_voided  THEN current_loss_streak
                               WHEN NOT p_won THEN current_loss_streak + 1
                               ELSE 0
                             END,
    rank_points            = CASE WHEN (NOT p_voided AND p_game_type = 'casual') THEN v_new_casual_rp ELSE rank_points END,
    games_completed        = COALESCE(games_completed, 0)  + CASE WHEN (NOT p_voided AND p_completed) THEN 1 ELSE 0 END,
    games_abandoned        = COALESCE(games_abandoned, 0)  + CASE WHEN (NOT p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
    games_voided           = COALESCE(games_voided, 0)     + CASE WHEN p_voided THEN 1 ELSE 0 END,
    completion_rate        = CASE WHEN NOT p_voided THEN v_new_completion_rate ELSE completion_rate END,
    current_completion_streak = CASE
      WHEN p_voided     THEN current_completion_streak
      WHEN p_completed  THEN COALESCE(current_completion_streak, 0) + 1
      ELSE 0
    END,
    longest_completion_streak = CASE
      WHEN p_voided THEN COALESCE(longest_completion_streak, 0)
      ELSE GREATEST(
        COALESCE(longest_completion_streak, 0),
        CASE WHEN p_completed THEN COALESCE(current_completion_streak, 0) + 1 ELSE COALESCE(current_completion_streak, 0) END
      )
    END,
    total_cards_left_in_hand = CASE
      WHEN p_completed AND NOT p_voided THEN COALESCE(total_cards_left_in_hand, 0) + p_cards_left
      ELSE COALESCE(total_cards_left_in_hand, 0)
    END,
    avg_cards_left_in_hand   = CASE WHEN p_completed AND NOT p_voided THEN v_new_avg_cards_left ELSE avg_cards_left_in_hand END,
    last_game_at             = NOW(),
    updated_at               = NOW()
  WHERE user_id = p_user_id;

  -- ── Completed-game-only globals ──────────────────────────────────────────
  IF p_completed AND NOT p_voided THEN
    UPDATE player_stats SET
      avg_finish_position = ROUND(
        (COALESCE(avg_finish_position, 2.5) * COALESCE(games_completed - 1, 0) + p_finish_position)::DECIMAL /
        GREATEST(COALESCE(games_completed, 1), 1)::DECIMAL, 2
      ),
      total_points             = total_points + p_score,
      highest_score            = GREATEST(highest_score, p_score),
      lowest_score             = CASE WHEN lowest_score IS NULL THEN p_score ELSE LEAST(lowest_score, p_score) END,
      avg_score_per_game       = v_new_avg_score,
      singles_played           = singles_played + COALESCE((p_combos_played->>'singles')::INTEGER, 0),
      pairs_played             = pairs_played   + COALESCE((p_combos_played->>'pairs')::INTEGER, 0),
      triples_played           = triples_played + COALESCE((p_combos_played->>'triples')::INTEGER, 0),
      straights_played         = straights_played + COALESCE((p_combos_played->>'straights')::INTEGER, 0),
      flushes_played           = COALESCE(flushes_played, 0) + COALESCE((p_combos_played->>'flushes')::INTEGER, 0),
      full_houses_played       = full_houses_played + COALESCE((p_combos_played->>'full_houses')::INTEGER, 0),
      four_of_a_kinds_played   = four_of_a_kinds_played + COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0),
      straight_flushes_played  = straight_flushes_played + COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0),
      royal_flushes_played     = royal_flushes_played + COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0)
    WHERE user_id = p_user_id;
  END IF;

  -- ── Mode-specific stats ──────────────────────────────────────────────────
  IF p_game_type = 'casual' THEN
    v_new_mode_win_rate := ROUND(
      (COALESCE(v_stats.casual_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL /
      (COALESCE(v_stats.casual_games_played, 0) + 1)::DECIMAL * 100, 2
    );

    v_mode_completed   := COALESCE(v_stats.casual_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END;
    v_mode_total_cards := COALESCE(v_stats.casual_total_cards_left, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_cards_left ELSE 0 END;
    v_mode_avg_cards   := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(v_mode_total_cards::DECIMAL / v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.casual_avg_cards_left, 0) END;
    v_mode_avg_score   := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(
                             (COALESCE(v_stats.casual_avg_score_per_game, 0) * COALESCE(v_stats.casual_games_completed, 0) + p_score)::DECIMAL /
                             v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.casual_avg_score_per_game, 0) END;
    v_mode_avg_pos     := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(
                             (COALESCE(v_stats.casual_avg_finish_position, 2.5) * COALESCE(v_stats.casual_games_completed, 0) + p_finish_position)::DECIMAL /
                             v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.casual_avg_finish_position, 2.5) END;

    UPDATE player_stats SET
      casual_games_played    = COALESCE(casual_games_played, 0) + CASE WHEN NOT p_voided THEN 1 ELSE 0 END,
      casual_games_won       = COALESCE(casual_games_won, 0) + CASE WHEN (NOT p_voided AND p_won) THEN 1 ELSE 0 END,
      casual_games_lost      = COALESCE(casual_games_lost, 0) + CASE WHEN (NOT p_voided AND NOT p_won) THEN 1 ELSE 0 END,
      casual_win_rate        = CASE WHEN NOT p_voided THEN v_new_mode_win_rate ELSE casual_win_rate END,
      casual_rank_points     = CASE WHEN NOT p_voided THEN v_new_casual_rp ELSE casual_rank_points END,
      casual_games_completed = COALESCE(casual_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      casual_games_abandoned = COALESCE(casual_games_abandoned, 0) + CASE WHEN (NOT p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      casual_games_voided    = COALESCE(casual_games_voided, 0) + CASE WHEN p_voided THEN 1 ELSE 0 END,
      casual_total_points        = COALESCE(casual_total_points, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_score ELSE 0 END,
      casual_highest_score       = CASE WHEN (p_completed AND NOT p_voided) THEN GREATEST(COALESCE(casual_highest_score, 0), p_score) ELSE COALESCE(casual_highest_score, 0) END,
      casual_lowest_score        = CASE WHEN (p_completed AND NOT p_voided) THEN
                                     CASE WHEN casual_lowest_score IS NULL THEN p_score ELSE LEAST(casual_lowest_score, p_score) END
                                   ELSE casual_lowest_score END,
      casual_avg_score_per_game  = CASE WHEN NOT p_voided THEN v_mode_avg_score ELSE casual_avg_score_per_game END,
      casual_avg_finish_position = CASE WHEN NOT p_voided THEN v_mode_avg_pos ELSE casual_avg_finish_position END,
      casual_total_cards_left    = CASE WHEN NOT p_voided THEN v_mode_total_cards ELSE COALESCE(casual_total_cards_left, 0) END,
      casual_avg_cards_left      = CASE WHEN NOT p_voided THEN v_mode_avg_cards ELSE casual_avg_cards_left END,
      casual_singles_played            = COALESCE(casual_singles_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'singles')::INTEGER, 0) ELSE 0 END,
      casual_pairs_played              = COALESCE(casual_pairs_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'pairs')::INTEGER, 0) ELSE 0 END,
      casual_triples_played            = COALESCE(casual_triples_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'triples')::INTEGER, 0) ELSE 0 END,
      casual_straights_played          = COALESCE(casual_straights_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'straights')::INTEGER, 0) ELSE 0 END,
      casual_flushes_played            = COALESCE(casual_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'flushes')::INTEGER, 0) ELSE 0 END,
      casual_full_houses_played        = COALESCE(casual_full_houses_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'full_houses')::INTEGER, 0) ELSE 0 END,
      casual_four_of_a_kinds_played    = COALESCE(casual_four_of_a_kinds_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0) ELSE 0 END,
      casual_straight_flushes_played   = COALESCE(casual_straight_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0) ELSE 0 END,
      casual_royal_flushes_played      = COALESCE(casual_royal_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0) ELSE 0 END
    WHERE user_id = p_user_id;

  ELSIF p_game_type = 'ranked' THEN
    v_new_mode_win_rate := ROUND(
      (COALESCE(v_stats.ranked_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL /
      (COALESCE(v_stats.ranked_games_played, 0) + 1)::DECIMAL * 100, 2
    );

    v_mode_completed   := COALESCE(v_stats.ranked_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END;
    v_mode_total_cards := COALESCE(v_stats.ranked_total_cards_left, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_cards_left ELSE 0 END;
    v_mode_avg_cards   := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(v_mode_total_cards::DECIMAL / v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.ranked_avg_cards_left, 0) END;
    v_mode_avg_score   := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(
                             (COALESCE(v_stats.ranked_avg_score_per_game, 0) * COALESCE(v_stats.ranked_games_completed, 0) + p_score)::DECIMAL /
                             v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.ranked_avg_score_per_game, 0) END;
    v_mode_avg_pos     := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(
                             (COALESCE(v_stats.ranked_avg_finish_position, 2.5) * COALESCE(v_stats.ranked_games_completed, 0) + p_finish_position)::DECIMAL /
                             v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.ranked_avg_finish_position, 2.5) END;

    UPDATE player_stats SET
      ranked_games_played    = COALESCE(ranked_games_played, 0) + CASE WHEN NOT p_voided THEN 1 ELSE 0 END,
      ranked_games_won       = COALESCE(ranked_games_won, 0) + CASE WHEN (NOT p_voided AND p_won) THEN 1 ELSE 0 END,
      ranked_games_lost      = COALESCE(ranked_games_lost, 0) + CASE WHEN (NOT p_voided AND NOT p_won) THEN 1 ELSE 0 END,
      ranked_win_rate        = CASE WHEN NOT p_voided THEN v_new_mode_win_rate ELSE ranked_win_rate END,
      ranked_rank_points     = CASE WHEN NOT p_voided THEN v_new_ranked_rp ELSE ranked_rank_points END,
      ranked_games_completed = COALESCE(ranked_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      ranked_games_abandoned = COALESCE(ranked_games_abandoned, 0) + CASE WHEN (NOT p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      ranked_games_voided    = COALESCE(ranked_games_voided, 0) + CASE WHEN p_voided THEN 1 ELSE 0 END,
      ranked_total_points        = COALESCE(ranked_total_points, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_score ELSE 0 END,
      ranked_highest_score       = CASE WHEN (p_completed AND NOT p_voided) THEN GREATEST(COALESCE(ranked_highest_score, 0), p_score) ELSE COALESCE(ranked_highest_score, 0) END,
      ranked_lowest_score        = CASE WHEN (p_completed AND NOT p_voided) THEN
                                    CASE WHEN ranked_lowest_score IS NULL THEN p_score ELSE LEAST(ranked_lowest_score, p_score) END
                                   ELSE ranked_lowest_score END,
      ranked_avg_score_per_game  = CASE WHEN NOT p_voided THEN v_mode_avg_score ELSE ranked_avg_score_per_game END,
      ranked_avg_finish_position = CASE WHEN NOT p_voided THEN v_mode_avg_pos ELSE ranked_avg_finish_position END,
      ranked_total_cards_left    = CASE WHEN NOT p_voided THEN v_mode_total_cards ELSE COALESCE(ranked_total_cards_left, 0) END,
      ranked_avg_cards_left      = CASE WHEN NOT p_voided THEN v_mode_avg_cards ELSE ranked_avg_cards_left END,
      ranked_singles_played            = COALESCE(ranked_singles_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'singles')::INTEGER, 0) ELSE 0 END,
      ranked_pairs_played              = COALESCE(ranked_pairs_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'pairs')::INTEGER, 0) ELSE 0 END,
      ranked_triples_played            = COALESCE(ranked_triples_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'triples')::INTEGER, 0) ELSE 0 END,
      ranked_straights_played          = COALESCE(ranked_straights_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'straights')::INTEGER, 0) ELSE 0 END,
      ranked_flushes_played            = COALESCE(ranked_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'flushes')::INTEGER, 0) ELSE 0 END,
      ranked_full_houses_played        = COALESCE(ranked_full_houses_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'full_houses')::INTEGER, 0) ELSE 0 END,
      ranked_four_of_a_kinds_played    = COALESCE(ranked_four_of_a_kinds_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0) ELSE 0 END,
      ranked_straight_flushes_played   = COALESCE(ranked_straight_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0) ELSE 0 END,
      ranked_royal_flushes_played      = COALESCE(ranked_royal_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0) ELSE 0 END
    WHERE user_id = p_user_id;

  ELSIF p_game_type = 'private' THEN
    v_new_mode_win_rate := ROUND(
      (COALESCE(v_stats.private_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL /
      (COALESCE(v_stats.private_games_played, 0) + 1)::DECIMAL * 100, 2
    );
    UPDATE player_stats SET
      private_games_played = COALESCE(private_games_played, 0) + CASE WHEN NOT p_voided THEN 1 ELSE 0 END,
      private_games_won    = COALESCE(private_games_won, 0) + CASE WHEN (NOT p_voided AND p_won) THEN 1 ELSE 0 END,
      private_games_lost   = COALESCE(private_games_lost, 0) + CASE WHEN (NOT p_voided AND NOT p_won) THEN 1 ELSE 0 END,
      private_win_rate     = CASE WHEN NOT p_voided THEN v_new_mode_win_rate ELSE private_win_rate END
    WHERE user_id = p_user_id;
  END IF;

  -- ── Append to rank_points_history (cap at last 100 entries) ─────────────
  v_history_entry := jsonb_build_object(
    'points',    CASE WHEN p_game_type = 'ranked' THEN v_new_ranked_rp ELSE v_new_casual_rp END,
    'is_win',    p_won,
    'game_type', p_game_type,
    'timestamp', NOW()
  );

  UPDATE player_stats SET
    rank_points_history = (
      SELECT jsonb_agg(entry ORDER BY (entry->>'timestamp')::text DESC)
      FROM (
        SELECT entry
        FROM (
          SELECT entry FROM jsonb_array_elements(
            COALESCE(rank_points_history, '[]'::jsonb)
          ) AS entry
          UNION ALL
          SELECT v_history_entry
        ) combined
        ORDER BY (entry->>'timestamp')::text DESC
        LIMIT 100
      ) sub
    )
  WHERE user_id = p_user_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB, TEXT, BOOLEAN, INTEGER, BOOLEAN, DECIMAL, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB, TEXT, BOOLEAN, INTEGER, BOOLEAN, DECIMAL, INTEGER) TO service_role;
