-- ============================================================================
-- Migration: Reset All Player Stats & Leaderboard Rankings
-- Task #16: Full reset of player_stats table to defaults and refresh
--           materialized leaderboard views.
-- ============================================================================

-- Reset all player_stats rows to default values while preserving user_id and
-- created_at. This zeroes every counter, rate, streak, and score column,
-- resets rank_points (casual + ranked) to 1000, and clears rank_points_history.

UPDATE player_stats SET
  -- Global stats
  games_played           = 0,
  games_won              = 0,
  games_lost             = 0,
  win_rate               = 0.00,
  current_win_streak     = 0,
  longest_win_streak     = 0,
  current_loss_streak    = 0,
  rank_points            = 1000,
  total_points           = 0,
  highest_score          = 0,
  lowest_score           = NULL,
  avg_score_per_game     = 0.00,
  avg_finish_position    = NULL,
  global_rank            = NULL,
  first_game_at          = NULL,
  last_game_at           = NULL,

  -- Completion tracking (global)
  games_completed               = 0,
  games_abandoned               = 0,
  games_voided                  = 0,
  completion_rate               = 100.00,
  current_completion_streak     = 0,
  longest_completion_streak     = 0,

  -- Cards left (global)
  total_cards_left_in_hand = 0,
  avg_cards_left_in_hand   = 0.00,

  -- Global combos
  singles_played          = 0,
  pairs_played            = 0,
  triples_played          = 0,
  straights_played        = 0,
  flushes_played          = 0,
  full_houses_played      = 0,
  four_of_a_kinds_played  = 0,
  straight_flushes_played = 0,
  royal_flushes_played    = 0,

  -- Rank points history
  rank_points_history     = '[]'::jsonb,

  -- ── Casual mode ─────────────────────────────────────────────────────────
  casual_games_played          = 0,
  casual_games_won             = 0,
  casual_games_lost            = 0,
  casual_win_rate              = 0.00,
  casual_rank_points           = 1000,
  casual_games_completed       = 0,
  casual_games_abandoned       = 0,
  casual_games_voided          = 0,
  casual_total_points          = 0,
  casual_highest_score         = 0,
  casual_lowest_score          = NULL,
  casual_avg_score_per_game    = 0.00,
  casual_avg_finish_position   = NULL,
  casual_total_cards_left      = 0,
  casual_avg_cards_left        = 0.00,
  casual_singles_played        = 0,
  casual_pairs_played          = 0,
  casual_triples_played        = 0,
  casual_straights_played      = 0,
  casual_flushes_played        = 0,
  casual_full_houses_played    = 0,
  casual_four_of_a_kinds_played    = 0,
  casual_straight_flushes_played   = 0,
  casual_royal_flushes_played      = 0,

  -- ── Ranked mode ─────────────────────────────────────────────────────────
  ranked_games_played          = 0,
  ranked_games_won             = 0,
  ranked_games_lost            = 0,
  ranked_win_rate              = 0.00,
  ranked_rank_points           = 1000,
  ranked_games_completed       = 0,
  ranked_games_abandoned       = 0,
  ranked_games_voided          = 0,
  ranked_total_points          = 0,
  ranked_highest_score         = 0,
  ranked_lowest_score          = NULL,
  ranked_avg_score_per_game    = 0.00,
  ranked_avg_finish_position   = NULL,
  ranked_total_cards_left      = 0,
  ranked_avg_cards_left        = 0.00,
  ranked_singles_played        = 0,
  ranked_pairs_played          = 0,
  ranked_triples_played        = 0,
  ranked_straights_played      = 0,
  ranked_flushes_played        = 0,
  ranked_full_houses_played    = 0,
  ranked_four_of_a_kinds_played    = 0,
  ranked_straight_flushes_played   = 0,
  ranked_royal_flushes_played      = 0,

  -- ── Private mode ────────────────────────────────────────────────────────
  private_games_played         = 0,
  private_games_won            = 0,
  private_games_lost           = 0,
  private_win_rate             = 0.00,
  private_games_completed      = 0,
  private_games_abandoned      = 0,
  private_games_voided         = 0,
  private_total_points         = 0,
  private_highest_score        = 0,
  private_lowest_score         = NULL,
  private_avg_score_per_game   = 0.00,
  private_avg_finish_position  = NULL,
  private_total_cards_left     = 0,
  private_avg_cards_left       = 0.00,
  private_singles_played       = 0,
  private_pairs_played         = 0,
  private_triples_played       = 0,
  private_straights_played     = 0,
  private_flushes_played       = 0,
  private_full_houses_played   = 0,
  private_four_of_a_kinds_played   = 0,
  private_straight_flushes_played  = 0,
  private_royal_flushes_played     = 0,

  updated_at = NOW();

-- ── Refresh materialized leaderboard views ────────────────────────────────
SELECT refresh_leaderboard();
