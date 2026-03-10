-- ============================================================================
-- Leaderboard Fixes Migration
-- Task #621: Points, ELO, Stats & Completion Logic
-- Date: March 9, 2026
--
-- Fixes:
-- 1. Rank Points / ELO — sync global rank_points = casual_rank_points;
--    stop double-incrementing rank_points for non-casual games.
-- 2. Game Completion % — clamp to 0-100; add games_voided column;
--    add per-mode completion columns.
-- 3. Performance Stats — add per-mode avg_finish_position, total_points,
--    highest_score, lowest_score, avg_score_per_game, avg_cards_left_in_hand.
-- 4. Combos — add per-mode combo count columns.
-- 5. Update update_player_stats_after_game() to populate all new columns.
-- 6. Back-fill rank_points = casual_rank_points for existing rows.
-- ============================================================================

-- ============================================================================
-- PART 1: games_voided column + per-mode completion columns
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'player_stats' AND column_name = 'games_voided'
  ) THEN
    ALTER TABLE player_stats ADD COLUMN games_voided INTEGER DEFAULT 0;
  END IF;
END $$;

-- NOTE: Per-mode stat columns are initialised to DEFAULT 0 (or NULL for lowest_score).
-- There is intentionally no historical backfill — per-mode tracking starts from the
-- moment this migration runs.  Existing totals remain in the global columns; only
-- games played after this migration will be reflected in per-mode breakdowns.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'player_stats' AND column_name = 'casual_games_completed'
  ) THEN
    ALTER TABLE player_stats
      ADD COLUMN casual_games_completed  INTEGER DEFAULT 0,
      ADD COLUMN casual_games_abandoned  INTEGER DEFAULT 0,
      ADD COLUMN casual_games_voided     INTEGER DEFAULT 0,
      ADD COLUMN ranked_games_completed  INTEGER DEFAULT 0,
      ADD COLUMN ranked_games_abandoned  INTEGER DEFAULT 0,
      ADD COLUMN ranked_games_voided     INTEGER DEFAULT 0,
      ADD COLUMN private_games_completed INTEGER DEFAULT 0,
      ADD COLUMN private_games_abandoned INTEGER DEFAULT 0,
      ADD COLUMN private_games_voided    INTEGER DEFAULT 0;
  END IF;
END $$;

-- ============================================================================
-- PART 2: Per-mode performance stat columns
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'player_stats' AND column_name = 'casual_total_points'
  ) THEN
    ALTER TABLE player_stats
      -- Casual performance
      ADD COLUMN casual_total_points          INTEGER       DEFAULT 0,
      ADD COLUMN casual_highest_score         INTEGER       DEFAULT 0,
      ADD COLUMN casual_lowest_score          INTEGER       DEFAULT NULL,
      ADD COLUMN casual_avg_score_per_game    DECIMAL(10,2) DEFAULT 0,
      ADD COLUMN casual_avg_finish_position   DECIMAL(3,2)  DEFAULT 0,
      ADD COLUMN casual_avg_cards_left        DECIMAL(5,2)  DEFAULT 0,
      ADD COLUMN casual_total_cards_left      INTEGER       DEFAULT 0,
      -- Ranked performance
      ADD COLUMN ranked_total_points          INTEGER       DEFAULT 0,
      ADD COLUMN ranked_highest_score         INTEGER       DEFAULT 0,
      ADD COLUMN ranked_lowest_score          INTEGER       DEFAULT NULL,
      ADD COLUMN ranked_avg_score_per_game    DECIMAL(10,2) DEFAULT 0,
      ADD COLUMN ranked_avg_finish_position   DECIMAL(3,2)  DEFAULT 0,
      ADD COLUMN ranked_avg_cards_left        DECIMAL(5,2)  DEFAULT 0,
      ADD COLUMN ranked_total_cards_left      INTEGER       DEFAULT 0,
      -- Private performance
      ADD COLUMN private_total_points         INTEGER       DEFAULT 0,
      ADD COLUMN private_highest_score        INTEGER       DEFAULT 0,
      ADD COLUMN private_lowest_score         INTEGER       DEFAULT NULL,
      ADD COLUMN private_avg_score_per_game   DECIMAL(10,2) DEFAULT 0,
      ADD COLUMN private_avg_finish_position  DECIMAL(3,2)  DEFAULT 0,
      ADD COLUMN private_avg_cards_left       DECIMAL(5,2)  DEFAULT 0,
      ADD COLUMN private_total_cards_left     INTEGER       DEFAULT 0;
  END IF;
END $$;

-- ============================================================================
-- PART 3: Per-mode combo columns
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'player_stats' AND column_name = 'casual_singles_played'
  ) THEN
    ALTER TABLE player_stats
      -- Casual combos
      ADD COLUMN casual_singles_played         INTEGER DEFAULT 0,
      ADD COLUMN casual_pairs_played           INTEGER DEFAULT 0,
      ADD COLUMN casual_triples_played         INTEGER DEFAULT 0,
      ADD COLUMN casual_straights_played       INTEGER DEFAULT 0,
      ADD COLUMN casual_flushes_played         INTEGER DEFAULT 0,
      ADD COLUMN casual_full_houses_played     INTEGER DEFAULT 0,
      ADD COLUMN casual_four_of_a_kinds_played INTEGER DEFAULT 0,
      ADD COLUMN casual_straight_flushes_played INTEGER DEFAULT 0,
      ADD COLUMN casual_royal_flushes_played   INTEGER DEFAULT 0,
      -- Ranked combos
      ADD COLUMN ranked_singles_played         INTEGER DEFAULT 0,
      ADD COLUMN ranked_pairs_played           INTEGER DEFAULT 0,
      ADD COLUMN ranked_triples_played         INTEGER DEFAULT 0,
      ADD COLUMN ranked_straights_played       INTEGER DEFAULT 0,
      ADD COLUMN ranked_flushes_played         INTEGER DEFAULT 0,
      ADD COLUMN ranked_full_houses_played     INTEGER DEFAULT 0,
      ADD COLUMN ranked_four_of_a_kinds_played INTEGER DEFAULT 0,
      ADD COLUMN ranked_straight_flushes_played INTEGER DEFAULT 0,
      ADD COLUMN ranked_royal_flushes_played   INTEGER DEFAULT 0,
      -- Private combos
      ADD COLUMN private_singles_played         INTEGER DEFAULT 0,
      ADD COLUMN private_pairs_played           INTEGER DEFAULT 0,
      ADD COLUMN private_triples_played         INTEGER DEFAULT 0,
      ADD COLUMN private_straights_played       INTEGER DEFAULT 0,
      ADD COLUMN private_flushes_played         INTEGER DEFAULT 0,
      ADD COLUMN private_full_houses_played     INTEGER DEFAULT 0,
      ADD COLUMN private_four_of_a_kinds_played INTEGER DEFAULT 0,
      ADD COLUMN private_straight_flushes_played INTEGER DEFAULT 0,
      ADD COLUMN private_royal_flushes_played   INTEGER DEFAULT 0;
  END IF;
END $$;

-- ============================================================================
-- PART 4: Back-fill rank_points = casual_rank_points
-- Fix the divergence caused by rank_points being incremented for all game types
-- ============================================================================

UPDATE player_stats
SET rank_points = COALESCE(casual_rank_points, 1000)
WHERE rank_points IS DISTINCT FROM COALESCE(casual_rank_points, 1000);

-- ============================================================================
-- PART 5: Clamp existing completion_rate to 0-100
-- ============================================================================

UPDATE player_stats
SET completion_rate = GREATEST(0, LEAST(100, COALESCE(completion_rate, 100)))
WHERE completion_rate IS NULL OR completion_rate > 100 OR completion_rate < 0;

-- ============================================================================
-- PART 6: Replace update_player_stats_after_game with fixed version
-- ============================================================================

-- Drop old signature to allow clean replacement
DROP FUNCTION IF EXISTS update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB, TEXT, BOOLEAN, INTEGER);
DROP FUNCTION IF EXISTS update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB, TEXT, BOOLEAN, INTEGER, BOOLEAN);

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
  -- Casual & private (casual column): score-based formula scaled by bot multiplier.
  -- Lower game score = better result = larger positive ELO gain.
  -- Formula: ROUND((100 - p_score) * p_bot_multiplier)
  -- The constant is intentionally 100 (not 101): a winner who scores 0 gains exactly
  -- +100 ELO × multiplier; a player who scores 100 breaks even; an abandoned player
  -- who is assigned p_score=200 receives a −100 × multiplier penalty.
  -- Ranked & private (ranked column): chess K=32 pairwise delta pre-computed
  -- by the complete-game edge function and passed as p_ranked_elo_change.
  v_rank_point_change := CASE
    WHEN p_game_type IN ('casual', 'private') THEN ROUND((100 - p_score) * p_bot_multiplier)::INTEGER
    ELSE 0
  END;

  -- Casual rank_points is the canonical “overview” ELO; private games also
  -- affect casual_rank_points (they share the same ELO pool).
  -- The legacy global rank_points is kept in sync with casual_rank_points.
  v_new_casual_rp := COALESCE(v_stats.casual_rank_points, 1000) +
    CASE WHEN p_game_type IN ('casual', 'private') THEN v_rank_point_change ELSE 0 END;

  -- Ranked ELO (chess K=32 pairwise) also applies to private games.
  v_new_ranked_rp := COALESCE(v_stats.ranked_rank_points, 1000) +
    CASE WHEN p_game_type IN ('ranked', 'private') THEN p_ranked_elo_change ELSE 0 END;

  -- ── Global win rate ────────────────────────────────────────────────────────
  v_new_win_rate := ROUND(
    (v_stats.games_won + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL /
    (v_stats.games_played + 1)::DECIMAL * 100, 2
  );

  -- ── Global avg cards left ──────────────────────────────────────────────────
  v_new_avg_cards_left := ROUND(
    (COALESCE(v_stats.total_cards_left_in_hand, 0) + p_cards_left)::DECIMAL /
    (v_stats.games_played + 1)::DECIMAL, 2
  );

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
  -- Voided games only increment games_voided + timestamps; all win/loss/ELO/streak
  -- counters are gated on NOT p_voided to prevent inflating stats.
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
    -- Sync rank_points with casual_rank_points (casual games only — private games
    -- must not alter the legacy rank_points column either).
    rank_points            = CASE WHEN (NOT p_voided AND p_game_type = 'casual') THEN v_new_casual_rp ELSE rank_points END,
    -- Completion tracking (global)
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
    -- Cards left (global) — skip for voided games
    total_cards_left_in_hand = CASE
      WHEN p_voided THEN COALESCE(total_cards_left_in_hand, 0)
      ELSE COALESCE(total_cards_left_in_hand, 0) + p_cards_left
    END,
    avg_cards_left_in_hand   = CASE WHEN NOT p_voided THEN v_new_avg_cards_left ELSE avg_cards_left_in_hand END,
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
      -- Global combos
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

    -- completed count used as denominator for avg calculations
    v_mode_completed   := COALESCE(v_stats.casual_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END;
    v_mode_total_cards := COALESCE(v_stats.casual_total_cards_left, 0) + CASE WHEN NOT p_voided THEN p_cards_left ELSE 0 END;
    v_mode_avg_cards   := CASE WHEN NOT p_voided AND (COALESCE(v_stats.casual_games_played, 0) + 1) > 0
                           THEN ROUND(v_mode_total_cards::DECIMAL / (COALESCE(v_stats.casual_games_played, 0) + 1)::DECIMAL, 2)
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
      -- Completion
      casual_games_completed = COALESCE(casual_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      casual_games_abandoned = COALESCE(casual_games_abandoned, 0) + CASE WHEN (NOT p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      casual_games_voided    = COALESCE(casual_games_voided, 0) + CASE WHEN p_voided THEN 1 ELSE 0 END,
      -- Performance (only for completed, non-voided games)
      casual_total_points        = COALESCE(casual_total_points, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_score ELSE 0 END,
      casual_highest_score       = CASE WHEN (p_completed AND NOT p_voided) THEN GREATEST(COALESCE(casual_highest_score, 0), p_score) ELSE COALESCE(casual_highest_score, 0) END,
      casual_lowest_score        = CASE WHEN (p_completed AND NOT p_voided) THEN
                                     CASE WHEN casual_lowest_score IS NULL THEN p_score ELSE LEAST(casual_lowest_score, p_score) END
                                   ELSE casual_lowest_score END,
      casual_avg_score_per_game  = CASE WHEN NOT p_voided THEN v_mode_avg_score ELSE casual_avg_score_per_game END,
      casual_avg_finish_position = CASE WHEN NOT p_voided THEN v_mode_avg_pos ELSE casual_avg_finish_position END,
      casual_total_cards_left    = CASE WHEN NOT p_voided THEN v_mode_total_cards ELSE COALESCE(casual_total_cards_left, 0) END,
      casual_avg_cards_left      = CASE WHEN NOT p_voided THEN v_mode_avg_cards ELSE casual_avg_cards_left END,
      -- Combos (only for completed, non-voided games)
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
    v_mode_total_cards := COALESCE(v_stats.ranked_total_cards_left, 0) + CASE WHEN NOT p_voided THEN p_cards_left ELSE 0 END;
    v_mode_avg_cards   := CASE WHEN NOT p_voided AND (COALESCE(v_stats.ranked_games_played, 0) + 1) > 0
                           THEN ROUND(v_mode_total_cards::DECIMAL / (COALESCE(v_stats.ranked_games_played, 0) + 1)::DECIMAL, 2)
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
      -- Completion
      ranked_games_completed = CASE WHEN p_voided THEN ranked_games_completed ELSE COALESCE(ranked_games_completed, 0) + CASE WHEN p_completed THEN 1 ELSE 0 END END,
      ranked_games_abandoned = COALESCE(ranked_games_abandoned, 0) + CASE WHEN (NOT p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      ranked_games_voided    = COALESCE(ranked_games_voided, 0) + CASE WHEN p_voided THEN 1 ELSE 0 END,
      -- Performance (only for completed, non-voided games)
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
      -- Combos (only for completed, non-voided games)
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
    v_mode_total_cards := COALESCE(v_stats.private_total_cards_left, 0) + CASE WHEN NOT p_voided THEN p_cards_left ELSE 0 END;
    v_mode_avg_cards   := CASE WHEN NOT p_voided AND (COALESCE(v_stats.private_games_played, 0) + 1) > 0
                           THEN ROUND(v_mode_total_cards::DECIMAL / (COALESCE(v_stats.private_games_played, 0) + 1)::DECIMAL, 2)
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
      -- Private games do NOT affect rank_points; only total_points are tracked.
      -- Completion
      private_games_completed = COALESCE(private_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      private_games_abandoned = COALESCE(private_games_abandoned, 0) + CASE WHEN (NOT p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      private_games_voided    = COALESCE(private_games_voided, 0) + CASE WHEN p_voided THEN 1 ELSE 0 END,
      -- Performance (only for completed, non-voided games)
      private_total_points        = COALESCE(private_total_points, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_score ELSE 0 END,
      private_highest_score       = CASE WHEN (p_completed AND NOT p_voided) THEN GREATEST(COALESCE(private_highest_score, 0), p_score) ELSE COALESCE(private_highest_score, 0) END,
      private_lowest_score        = CASE WHEN (p_completed AND NOT p_voided) THEN
                                      CASE WHEN private_lowest_score IS NULL THEN p_score ELSE LEAST(private_lowest_score, p_score) END
                                    ELSE private_lowest_score END,
      private_avg_score_per_game  = CASE WHEN NOT p_voided THEN v_mode_avg_score ELSE COALESCE(private_avg_score_per_game, 0) END,
      private_avg_finish_position = CASE WHEN NOT p_voided THEN v_mode_avg_pos ELSE COALESCE(private_avg_finish_position, 2.5) END,
      private_total_cards_left    = CASE WHEN NOT p_voided THEN v_mode_total_cards ELSE COALESCE(private_total_cards_left, 0) END,
      private_avg_cards_left      = CASE WHEN NOT p_voided THEN v_mode_avg_cards ELSE COALESCE(private_avg_cards_left, 0) END,
      -- Combos (only for completed, non-voided games)
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
  -- Voided and private games do not change ELO; skip history for them to avoid
  -- graph divergence. For the overview graph: store casual_rank_points for casual
  -- games, ranked_rank_points for ranked games (so the ranked-tab graph filters
  -- correctly). Private games are excluded — they have no ELO impact.
  -- The 'points' value stored is the NEW value after this game.
  IF NOT p_voided AND p_game_type <> 'private' THEN
    v_history_entry := jsonb_build_object(
      'points',    CASE
                     WHEN p_game_type = 'ranked' THEN v_new_ranked_rp
                     ELSE v_new_casual_rp  -- casual
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

-- ============================================================================
-- PART 7: Permissions
-- ============================================================================

REVOKE EXECUTE ON FUNCTION update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB, TEXT, BOOLEAN, INTEGER, BOOLEAN, DECIMAL, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB, TEXT, BOOLEAN, INTEGER, BOOLEAN, DECIMAL, INTEGER) TO service_role;
