-- Fix casual rank points going deeply negative in multi-match games.
--
-- Root cause: the formula `ROUND((100 - p_score) * p_bot_multiplier)` uses the
-- cumulative Big Two penalty score across all matches. In a long game (10+ rounds)
-- a losing player can easily accumulate 120-300+ penalty points, making
-- `(100 - score)` a large negative number and causing rank points to spiral down
-- (e.g. -67 → -157 → -227 → -260) even for players who completed the game.
--
-- Fix: cap the score used in the rank point formula at 100 for COMPLETED games only
-- (p_completed = true), so the rank change stays in [0, +100*multiplier].
-- A winner (score=0, completed) earns +100 × multiplier; a player with score ≥ 100
-- earns 0 (no gain, no loss). Abandoned/disconnected players pass p_completed=false
-- with p_score=200, which bypasses the cap and correctly retains the penalty.
--
-- This modifies update_player_stats_after_game defined in
-- migration 20260718000001_fix_avg_cards_left_completed_only.sql, preserving
-- the full existing signature and body — only the rank_point_change formula changes.

CREATE OR REPLACE FUNCTION update_player_stats_after_game(
  p_user_id           UUID,
  p_won               BOOLEAN,
  p_finish_position   INTEGER,
  p_score             INTEGER,
  p_combos_played     JSONB,
  p_game_type         TEXT    DEFAULT 'casual',
  p_completed         BOOLEAN DEFAULT true,
  p_cards_left        INTEGER DEFAULT 0,
  -- voided = last human left before game finished; distinct from abandoned
  p_voided            BOOLEAN DEFAULT false,
  -- Multiplier applied to casual ELO delta (1.0 = all-human, 0.9 = hard bots, etc.)
  p_bot_multiplier    DECIMAL DEFAULT 1.0,
  -- Pre-computed chess K=32 pairwise ELO delta for ranked/private games (0 for casual)
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
  -- per-mode performance helpers
  v_mode_completed       INTEGER;
  v_mode_total_cards     INTEGER;
  v_mode_avg_cards       DECIMAL(5,2);
  v_mode_avg_score       DECIMAL(10,2);
  v_mode_avg_pos         DECIMAL(3,2);
BEGIN
  -- Fetch current stats row (create if missing)
  SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    PERFORM initialize_player_stats(p_user_id);
    SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  END IF;

  -- ── Rank point change ───────────────────────────────────────────────────
  -- Casual only (casual column): score-based formula scaled by bot multiplier.
  -- Lower game score = better result = larger positive ELO gain.
  -- FIX: cap p_score at 100 for completed games so that multi-match cumulative
  -- scores (which can exceed 100) never produce a negative rank change for players
  -- who actually finished the game. Abandoned/disconnected players pass
  -- p_completed=false with score=200, bypassing the cap to retain their penalty.
  -- Ranked only (ranked column): chess K=32 pairwise delta pre-computed
  -- by the complete-game edge function and passed as p_ranked_elo_change.
  -- Private games are consequence-free: they do NOT affect any ELO / rank columns.
  v_rank_point_change := CASE
    WHEN p_game_type = 'casual' THEN ROUND((100 - CASE WHEN p_completed THEN LEAST(p_score, 100) ELSE p_score END) * p_bot_multiplier)::INTEGER
    ELSE 0
  END;

  -- Casual rank_points is the canonical "overview" ELO for casual games only.
  -- Private games do not affect casual_rank_points.
  -- The legacy global rank_points is kept in sync with casual_rank_points.
  v_new_casual_rp := COALESCE(v_stats.casual_rank_points, 1000) +
    CASE WHEN p_game_type = 'casual' THEN v_rank_point_change ELSE 0 END;

  -- Ranked ELO (chess K=32 pairwise) applies to ranked games only.
  -- Private games do not affect ranked ELO.
  v_new_ranked_rp := COALESCE(v_stats.ranked_rank_points, 1000) +
    CASE WHEN p_game_type = 'ranked' THEN p_ranked_elo_change ELSE 0 END;

  -- ── Global win rate ────────────────────────────────────────────────────────
  v_new_win_rate := ROUND(
    (v_stats.games_won + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL /
    (v_stats.games_played + 1)::DECIMAL * 100, 2
  );

  -- ── Global avg cards left (only for completed, non-voided games) ───────────
  v_new_avg_cards_left := CASE
    WHEN p_completed AND NOT p_voided THEN
      ROUND(
        (COALESCE(v_stats.total_cards_left_in_hand, 0) + p_cards_left)::DECIMAL /
        (COALESCE(v_stats.games_completed, 0) + 1)::DECIMAL, 2
      )
    ELSE COALESCE(v_stats.avg_cards_left_in_hand, 0)
  END;

  -- ── Global avg score (only for completed games) ────────────────────────────
  v_new_avg_score := CASE
    WHEN p_completed THEN
      ROUND(
        (COALESCE(v_stats.avg_score_per_game, 0) * COALESCE(v_stats.games_completed, 0) + p_score)::DECIMAL /
        (COALESCE(v_stats.games_completed, 0) + 1)::DECIMAL, 2
      )
    ELSE v_stats.avg_score_per_game
  END;

  -- ── Completion rate (clamped to 0-100) ────────────────────────────────────
  v_new_completion_rate := LEAST(100, GREATEST(0, ROUND(
    (COALESCE(v_stats.games_completed, 0) + CASE WHEN p_completed THEN 1 ELSE 0 END)::DECIMAL /
    (v_stats.games_played + 1)::DECIMAL * 100, 2
  )));

  -- ── Always-update block ───────────────────────────────────────────────────
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

  -- ── Completed-game-only globals (performance) ────────────────────────────
  IF p_completed AND NOT p_voided THEN
    UPDATE player_stats SET
      avg_finish_position = ROUND(
        (COALESCE(avg_finish_position, 2.5) * COALESCE(games_completed - 1, 0) + p_finish_position)::DECIMAL /
        GREATEST(COALESCE(games_completed, 1), 1)::DECIMAL, 2
      ),
      total_points     = total_points + p_score,
      highest_score    = GREATEST(highest_score, p_score),
      lowest_score     = CASE WHEN lowest_score IS NULL THEN p_score ELSE LEAST(lowest_score, p_score) END,
      avg_score_per_game = v_new_avg_score,
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

  -- ── Mode-specific stats ───────────────────────────────────────────────────
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
      ranked_games_played    = CASE WHEN p_voided THEN ranked_games_played ELSE COALESCE(ranked_games_played, 0) + 1 END,
      ranked_games_won       = CASE WHEN p_voided THEN ranked_games_won ELSE COALESCE(ranked_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END END,
      ranked_games_lost      = CASE WHEN p_voided THEN ranked_games_lost ELSE COALESCE(ranked_games_lost, 0) + CASE WHEN NOT p_won THEN 1 ELSE 0 END END,
      ranked_win_rate        = CASE WHEN p_voided THEN ranked_win_rate ELSE v_new_mode_win_rate END,
      ranked_rank_points     = CASE WHEN p_voided THEN ranked_rank_points ELSE v_new_ranked_rp END,
      ranked_games_completed = CASE WHEN p_voided THEN ranked_games_completed ELSE COALESCE(ranked_games_completed, 0) + CASE WHEN p_completed THEN 1 ELSE 0 END END,
      ranked_games_abandoned = COALESCE(ranked_games_abandoned, 0) + CASE WHEN (NOT p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      ranked_games_voided    = COALESCE(ranked_games_voided, 0) + CASE WHEN p_voided THEN 1 ELSE 0 END,
      ranked_total_points        = CASE WHEN p_voided THEN ranked_total_points ELSE COALESCE(ranked_total_points, 0) + CASE WHEN p_completed THEN p_score ELSE 0 END END,
      ranked_highest_score       = CASE WHEN p_voided THEN ranked_highest_score
                                     ELSE CASE WHEN p_completed THEN GREATEST(COALESCE(ranked_highest_score, 0), p_score) ELSE COALESCE(ranked_highest_score, 0) END
                                   END,
      ranked_lowest_score        = CASE WHEN p_voided THEN ranked_lowest_score
                                     ELSE CASE WHEN p_completed THEN
                                       CASE WHEN ranked_lowest_score IS NULL THEN p_score ELSE LEAST(ranked_lowest_score, p_score) END
                                     ELSE ranked_lowest_score END
                                   END,
      ranked_avg_score_per_game  = CASE WHEN p_voided THEN ranked_avg_score_per_game ELSE v_mode_avg_score END,
      ranked_avg_finish_position = CASE WHEN p_voided THEN ranked_avg_finish_position ELSE v_mode_avg_pos END,
      ranked_total_cards_left    = CASE WHEN p_voided THEN ranked_total_cards_left ELSE v_mode_total_cards END,
      ranked_avg_cards_left      = CASE WHEN p_voided THEN ranked_avg_cards_left ELSE v_mode_avg_cards END,
      ranked_singles_played            = COALESCE(ranked_singles_played, 0) + CASE WHEN (NOT p_voided AND p_completed) THEN COALESCE((p_combos_played->>'singles')::INTEGER, 0) ELSE 0 END,
      ranked_pairs_played              = COALESCE(ranked_pairs_played, 0) + CASE WHEN (NOT p_voided AND p_completed) THEN COALESCE((p_combos_played->>'pairs')::INTEGER, 0) ELSE 0 END,
      ranked_triples_played            = COALESCE(ranked_triples_played, 0) + CASE WHEN (NOT p_voided AND p_completed) THEN COALESCE((p_combos_played->>'triples')::INTEGER, 0) ELSE 0 END,
      ranked_straights_played          = COALESCE(ranked_straights_played, 0) + CASE WHEN (NOT p_voided AND p_completed) THEN COALESCE((p_combos_played->>'straights')::INTEGER, 0) ELSE 0 END,
      ranked_flushes_played            = COALESCE(ranked_flushes_played, 0) + CASE WHEN (NOT p_voided AND p_completed) THEN COALESCE((p_combos_played->>'flushes')::INTEGER, 0) ELSE 0 END,
      ranked_full_houses_played        = COALESCE(ranked_full_houses_played, 0) + CASE WHEN (NOT p_voided AND p_completed) THEN COALESCE((p_combos_played->>'full_houses')::INTEGER, 0) ELSE 0 END,
      ranked_four_of_a_kinds_played    = COALESCE(ranked_four_of_a_kinds_played, 0) + CASE WHEN (NOT p_voided AND p_completed) THEN COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0) ELSE 0 END,
      ranked_straight_flushes_played   = COALESCE(ranked_straight_flushes_played, 0) + CASE WHEN (NOT p_voided AND p_completed) THEN COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0) ELSE 0 END,
      ranked_royal_flushes_played      = COALESCE(ranked_royal_flushes_played, 0) + CASE WHEN (NOT p_voided AND p_completed) THEN COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0) ELSE 0 END
    WHERE user_id = p_user_id;

  ELSIF p_game_type = 'private' THEN
    v_new_mode_win_rate := ROUND(
      (COALESCE(v_stats.private_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL /
      (COALESCE(v_stats.private_games_played, 0) + 1)::DECIMAL * 100, 2
    );

    v_mode_completed   := COALESCE(v_stats.private_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END;
    v_mode_total_cards := COALESCE(v_stats.private_total_cards_left, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_cards_left ELSE 0 END;
    v_mode_avg_cards   := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(v_mode_total_cards::DECIMAL / v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.private_avg_cards_left, 0) END;
    v_mode_avg_score   := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(
                             (COALESCE(v_stats.private_avg_score_per_game, 0) * COALESCE(v_stats.private_games_completed, 0) + p_score)::DECIMAL /
                             v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.private_avg_score_per_game, 0) END;
    v_mode_avg_pos     := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(
                             (COALESCE(v_stats.private_avg_finish_position, 2.5) * COALESCE(v_stats.private_games_completed, 0) + p_finish_position)::DECIMAL /
                             v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.private_avg_finish_position, 2.5) END;

    UPDATE player_stats SET
      private_games_played    = COALESCE(private_games_played, 0) + CASE WHEN NOT p_voided THEN 1 ELSE 0 END,
      private_games_won       = COALESCE(private_games_won, 0) + CASE WHEN (NOT p_voided AND p_won) THEN 1 ELSE 0 END,
      private_games_lost      = COALESCE(private_games_lost, 0) + CASE WHEN (NOT p_voided AND NOT p_won) THEN 1 ELSE 0 END,
      private_win_rate        = CASE WHEN NOT p_voided THEN v_new_mode_win_rate ELSE COALESCE(private_win_rate, 0) END,
      private_games_completed = COALESCE(private_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      private_games_abandoned = COALESCE(private_games_abandoned, 0) + CASE WHEN (NOT p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      private_games_voided    = COALESCE(private_games_voided, 0) + CASE WHEN p_voided THEN 1 ELSE 0 END,
      private_total_points        = COALESCE(private_total_points, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_score ELSE 0 END,
      private_highest_score       = CASE WHEN (p_completed AND NOT p_voided) THEN GREATEST(COALESCE(private_highest_score, 0), p_score) ELSE COALESCE(private_highest_score, 0) END,
      private_lowest_score        = CASE WHEN (p_completed AND NOT p_voided) THEN
                                      CASE WHEN private_lowest_score IS NULL THEN p_score ELSE LEAST(private_lowest_score, p_score) END
                                    ELSE private_lowest_score END,
      private_avg_score_per_game  = CASE WHEN NOT p_voided THEN v_mode_avg_score ELSE COALESCE(private_avg_score_per_game, 0) END,
      private_avg_finish_position = CASE WHEN NOT p_voided THEN v_mode_avg_pos ELSE COALESCE(private_avg_finish_position, 2.5) END,
      private_total_cards_left    = CASE WHEN NOT p_voided THEN v_mode_total_cards ELSE COALESCE(private_total_cards_left, 0) END,
      private_avg_cards_left      = CASE WHEN NOT p_voided THEN v_mode_avg_cards ELSE COALESCE(private_avg_cards_left, 0) END,
      private_singles_played            = COALESCE(private_singles_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'singles')::INTEGER, 0) ELSE 0 END,
      private_pairs_played              = COALESCE(private_pairs_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'pairs')::INTEGER, 0) ELSE 0 END,
      private_triples_played            = COALESCE(private_triples_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'triples')::INTEGER, 0) ELSE 0 END,
      private_straights_played          = COALESCE(private_straights_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'straights')::INTEGER, 0) ELSE 0 END,
      private_flushes_played            = COALESCE(private_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'flushes')::INTEGER, 0) ELSE 0 END,
      private_full_houses_played        = COALESCE(private_full_houses_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'full_houses')::INTEGER, 0) ELSE 0 END,
      private_four_of_a_kinds_played    = COALESCE(private_four_of_a_kinds_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0) ELSE 0 END,
      private_straight_flushes_played   = COALESCE(private_straight_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0) ELSE 0 END,
      private_royal_flushes_played      = COALESCE(private_royal_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0) ELSE 0 END
    WHERE user_id = p_user_id;
  END IF;

  -- ── rank_points_history: append entry using mode-specific points ──────────
  IF NOT p_voided AND p_game_type <> 'private' THEN
    v_history_entry := jsonb_build_object(
      'points',    CASE
                     WHEN p_game_type = 'ranked' THEN v_new_ranked_rp
                     ELSE v_new_casual_rp
                   END,
      'is_win',    p_won,
      'game_type', p_game_type,
      'timestamp', NOW()
    );

    UPDATE player_stats SET
      rank_points_history = CASE
        WHEN jsonb_array_length(COALESCE(rank_points_history, '[]'::jsonb)) >= 100
        THEN (COALESCE(rank_points_history, '[]'::jsonb) - 0) || jsonb_build_array(v_history_entry)
        ELSE COALESCE(rank_points_history, '[]'::jsonb) || jsonb_build_array(v_history_entry)
      END
    WHERE user_id = p_user_id;
  END IF;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB, TEXT, BOOLEAN, INTEGER, BOOLEAN, DECIMAL, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB, TEXT, BOOLEAN, INTEGER, BOOLEAN, DECIMAL, INTEGER) TO service_role;
