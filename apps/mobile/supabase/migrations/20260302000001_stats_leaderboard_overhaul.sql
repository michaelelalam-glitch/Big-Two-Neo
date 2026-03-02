-- ============================================================================
-- Stats & Leaderboard Overhaul Migration
-- Date: March 2, 2026
-- 
-- This migration adds:
-- 1. game_type column to game_history (casual/ranked/private/local)
-- 2. Per-mode stat columns to player_stats (casual/ranked/private)
-- 3. Game completion tracking columns
-- 4. Performance enhancement columns (lowest_score, avg_cards_left)
-- 5. Recent games metadata (bot replacement, disconnection tracking)
-- 6. Rank points history (JSONB) for progression graph
-- 7. Separate casual & ranked materialized views
-- 8. Updated RPC functions
-- ============================================================================

-- ============================================================================
-- PART 1: game_history schema extensions
-- ============================================================================

-- Add game_type to distinguish casual/ranked/private/local games
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_history' AND column_name = 'game_type'
  ) THEN
    ALTER TABLE game_history ADD COLUMN game_type TEXT NOT NULL DEFAULT 'casual';
  END IF;
END $$;

-- Add bot replacement tracking columns
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_history' AND column_name = 'player_1_original_username'
  ) THEN
    ALTER TABLE game_history ADD COLUMN player_1_original_username TEXT;
    ALTER TABLE game_history ADD COLUMN player_2_original_username TEXT;
    ALTER TABLE game_history ADD COLUMN player_3_original_username TEXT;
    ALTER TABLE game_history ADD COLUMN player_4_original_username TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_history' AND column_name = 'player_1_was_bot'
  ) THEN
    ALTER TABLE game_history ADD COLUMN player_1_was_bot BOOLEAN DEFAULT false;
    ALTER TABLE game_history ADD COLUMN player_2_was_bot BOOLEAN DEFAULT false;
    ALTER TABLE game_history ADD COLUMN player_3_was_bot BOOLEAN DEFAULT false;
    ALTER TABLE game_history ADD COLUMN player_4_was_bot BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Add disconnection tracking
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_history' AND column_name = 'player_1_disconnected'
  ) THEN
    ALTER TABLE game_history ADD COLUMN player_1_disconnected BOOLEAN DEFAULT false;
    ALTER TABLE game_history ADD COLUMN player_2_disconnected BOOLEAN DEFAULT false;
    ALTER TABLE game_history ADD COLUMN player_3_disconnected BOOLEAN DEFAULT false;
    ALTER TABLE game_history ADD COLUMN player_4_disconnected BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Add cards left tracking per player
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_history' AND column_name = 'player_1_cards_left'
  ) THEN
    ALTER TABLE game_history ADD COLUMN player_1_cards_left INTEGER DEFAULT 0;
    ALTER TABLE game_history ADD COLUMN player_2_cards_left INTEGER DEFAULT 0;
    ALTER TABLE game_history ADD COLUMN player_3_cards_left INTEGER DEFAULT 0;
    ALTER TABLE game_history ADD COLUMN player_4_cards_left INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add game_completed flag
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_history' AND column_name = 'game_completed'
  ) THEN
    ALTER TABLE game_history ADD COLUMN game_completed BOOLEAN DEFAULT true;
  END IF;
END $$;

-- Index for game_type queries
CREATE INDEX IF NOT EXISTS idx_game_history_game_type ON game_history(game_type);

-- Backfill existing game_history: LOCAL rooms = 'local', everything else = 'casual'
UPDATE game_history SET game_type = 'local' WHERE room_code = 'LOCAL' AND game_type = 'casual';

-- ============================================================================
-- PART 2: player_stats per-mode columns
-- ============================================================================

-- Casual mode stats
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'player_stats' AND column_name = 'casual_games_played'
  ) THEN
    ALTER TABLE player_stats ADD COLUMN casual_games_played INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN casual_games_won INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN casual_games_lost INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN casual_win_rate DECIMAL(5,2) DEFAULT 0.00;
    ALTER TABLE player_stats ADD COLUMN casual_rank_points INTEGER DEFAULT 1000;
  END IF;
END $$;

-- Ranked mode stats
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'player_stats' AND column_name = 'ranked_games_played'
  ) THEN
    ALTER TABLE player_stats ADD COLUMN ranked_games_played INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN ranked_games_won INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN ranked_games_lost INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN ranked_win_rate DECIMAL(5,2) DEFAULT 0.00;
    ALTER TABLE player_stats ADD COLUMN ranked_rank_points INTEGER DEFAULT 1000;
  END IF;
END $$;

-- Private mode stats
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'player_stats' AND column_name = 'private_games_played'
  ) THEN
    ALTER TABLE player_stats ADD COLUMN private_games_played INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN private_games_won INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN private_games_lost INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN private_win_rate DECIMAL(5,2) DEFAULT 0.00;
  END IF;
END $$;

-- ============================================================================
-- PART 3: Game completion tracking columns
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'player_stats' AND column_name = 'games_completed'
  ) THEN
    ALTER TABLE player_stats ADD COLUMN games_completed INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN games_abandoned INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN completion_rate DECIMAL(5,2) DEFAULT 100.00;
    ALTER TABLE player_stats ADD COLUMN current_completion_streak INTEGER DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN longest_completion_streak INTEGER DEFAULT 0;
  END IF;
END $$;

-- ============================================================================
-- PART 4: Performance enhancement columns
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'player_stats' AND column_name = 'lowest_score'
  ) THEN
    ALTER TABLE player_stats ADD COLUMN lowest_score INTEGER DEFAULT NULL;
    ALTER TABLE player_stats ADD COLUMN avg_cards_left_in_hand DECIMAL(5,2) DEFAULT 0;
    ALTER TABLE player_stats ADD COLUMN total_cards_left_in_hand INTEGER DEFAULT 0;
  END IF;
END $$;

-- ============================================================================
-- PART 5: Rank points history (JSONB array for progression graph)
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'player_stats' AND column_name = 'rank_points_history'
  ) THEN
    ALTER TABLE player_stats ADD COLUMN rank_points_history JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- ============================================================================
-- PART 6: Casual & Ranked Materialized Views
-- ============================================================================

-- Casual leaderboard (casual + private games)
DROP MATERIALIZED VIEW IF EXISTS leaderboard_casual;
CREATE MATERIALIZED VIEW leaderboard_casual AS
SELECT 
  ps.user_id,
  p.username,
  p.avatar_url,
  ps.casual_rank_points AS rank_points,
  (ps.casual_games_played + ps.private_games_played) AS games_played,
  (ps.casual_games_won + ps.private_games_won) AS games_won,
  CASE 
    WHEN (ps.casual_games_played + ps.private_games_played) > 0 
    THEN ROUND(((ps.casual_games_won + ps.private_games_won)::DECIMAL / (ps.casual_games_played + ps.private_games_played)::DECIMAL * 100), 2)
    ELSE 0 
  END AS win_rate,
  ps.longest_win_streak,
  ps.current_win_streak,
  ROW_NUMBER() OVER (ORDER BY ps.casual_rank_points DESC, (ps.casual_games_won + ps.private_games_won) DESC) AS rank
FROM player_stats ps
INNER JOIN profiles p ON ps.user_id = p.id
WHERE (ps.casual_games_played + ps.private_games_played) > 0
ORDER BY ps.casual_rank_points DESC, (ps.casual_games_won + ps.private_games_won) DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_casual_user ON leaderboard_casual(user_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_casual_rank ON leaderboard_casual(rank);

-- Ranked leaderboard
DROP MATERIALIZED VIEW IF EXISTS leaderboard_ranked;
CREATE MATERIALIZED VIEW leaderboard_ranked AS
SELECT 
  ps.user_id,
  p.username,
  p.avatar_url,
  ps.ranked_rank_points AS rank_points,
  ps.ranked_games_played AS games_played,
  ps.ranked_games_won AS games_won,
  ps.ranked_win_rate AS win_rate,
  ps.longest_win_streak,
  ps.current_win_streak,
  ROW_NUMBER() OVER (ORDER BY ps.ranked_rank_points DESC, ps.ranked_games_won DESC) AS rank
FROM player_stats ps
INNER JOIN profiles p ON ps.user_id = p.id
WHERE ps.ranked_games_played > 0
ORDER BY ps.ranked_rank_points DESC, ps.ranked_games_won DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_ranked_user ON leaderboard_ranked(user_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_ranked_rank ON leaderboard_ranked(rank);

-- ============================================================================
-- PART 7: Updated RPC Functions
-- ============================================================================

-- Drop old function signature before recreating with new params
DROP FUNCTION IF EXISTS update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB);

-- Updated function with game_type, completed, and cards_left params
CREATE OR REPLACE FUNCTION update_player_stats_after_game(
  p_user_id UUID,
  p_won BOOLEAN,
  p_finish_position INTEGER,
  p_score INTEGER,
  p_combos_played JSONB,
  p_game_type TEXT DEFAULT 'casual',
  p_completed BOOLEAN DEFAULT true,
  p_cards_left INTEGER DEFAULT 0
) RETURNS VOID AS $$
DECLARE
  v_stats RECORD;
  v_new_win_rate DECIMAL(5,2);
  v_new_avg_position DECIMAL(3,2);
  v_new_avg_score DECIMAL(10,2);
  v_new_mode_win_rate DECIMAL(5,2);
  v_new_completion_rate DECIMAL(5,2);
  v_new_avg_cards_left DECIMAL(5,2);
  v_rank_point_change INTEGER;
  v_new_rank_points INTEGER;
  v_history_entry JSONB;
BEGIN
  -- Get current stats
  SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    PERFORM initialize_player_stats(p_user_id);
    SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  END IF;

  -- Calculate rank point change
  v_rank_point_change := CASE 
    WHEN p_won THEN 25 
    WHEN p_finish_position = 2 THEN 10
    WHEN p_finish_position = 3 THEN -5
    ELSE -15
  END;

  -- Calculate new overall stats
  v_new_win_rate := ROUND(
    (v_stats.games_won + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL / 
    (v_stats.games_played + 1)::DECIMAL * 100, 
    2
  );
  
  v_new_avg_position := ROUND(
    (COALESCE(v_stats.avg_finish_position, 2.5) * v_stats.games_played + p_finish_position)::DECIMAL / 
    (v_stats.games_played + 1)::DECIMAL,
    2
  );
  
  v_new_avg_score := ROUND(
    (COALESCE(v_stats.avg_score_per_game, 0) * COALESCE(v_stats.games_completed, 0) + p_score)::DECIMAL / 
    (COALESCE(v_stats.games_completed, 0) + 1)::DECIMAL,
    2
  );

  -- Calculate new avg cards left
  v_new_avg_cards_left := ROUND(
    (COALESCE(v_stats.total_cards_left_in_hand, 0) + p_cards_left)::DECIMAL /
    (v_stats.games_played + 1)::DECIMAL,
    2
  );

  -- Calculate completion rate
  v_new_completion_rate := ROUND(
    (COALESCE(v_stats.games_completed, 0) + CASE WHEN p_completed THEN 1 ELSE 0 END)::DECIMAL /
    (v_stats.games_played + 1)::DECIMAL * 100,
    2
  );

  -- Always update: games_played, won/lost, streaks, rank_points
  UPDATE player_stats SET
    games_played = games_played + 1,
    games_won = games_won + CASE WHEN p_won THEN 1 ELSE 0 END,
    games_lost = games_lost + CASE WHEN NOT p_won THEN 1 ELSE 0 END,
    win_rate = v_new_win_rate,
    current_win_streak = CASE 
      WHEN p_won THEN current_win_streak + 1 
      ELSE 0 
    END,
    longest_win_streak = GREATEST(
      longest_win_streak,
      CASE WHEN p_won THEN current_win_streak + 1 ELSE current_win_streak END
    ),
    current_loss_streak = CASE 
      WHEN NOT p_won THEN current_loss_streak + 1 
      ELSE 0 
    END,
    rank_points = rank_points + v_rank_point_change,
    -- Completion tracking
    games_completed = COALESCE(games_completed, 0) + CASE WHEN p_completed THEN 1 ELSE 0 END,
    games_abandoned = COALESCE(games_abandoned, 0) + CASE WHEN NOT p_completed THEN 1 ELSE 0 END,
    completion_rate = v_new_completion_rate,
    current_completion_streak = CASE 
      WHEN p_completed THEN COALESCE(current_completion_streak, 0) + 1
      ELSE 0
    END,
    longest_completion_streak = GREATEST(
      COALESCE(longest_completion_streak, 0),
      CASE WHEN p_completed THEN COALESCE(current_completion_streak, 0) + 1 ELSE COALESCE(current_completion_streak, 0) END
    ),
    -- Cards left tracking
    total_cards_left_in_hand = COALESCE(total_cards_left_in_hand, 0) + p_cards_left,
    avg_cards_left_in_hand = v_new_avg_cards_left,
    last_game_at = NOW(),
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Only update performance & combo stats for COMPLETED games (Item 8)
  IF p_completed THEN
    UPDATE player_stats SET
      avg_finish_position = v_new_avg_position,
      total_points = total_points + p_score,
      highest_score = GREATEST(highest_score, p_score),
      lowest_score = CASE 
        WHEN lowest_score IS NULL THEN p_score
        ELSE LEAST(lowest_score, p_score)
      END,
      avg_score_per_game = v_new_avg_score,
      -- Combo stats
      singles_played = singles_played + COALESCE((p_combos_played->>'singles')::INTEGER, 0),
      pairs_played = pairs_played + COALESCE((p_combos_played->>'pairs')::INTEGER, 0),
      triples_played = triples_played + COALESCE((p_combos_played->>'triples')::INTEGER, 0),
      straights_played = straights_played + COALESCE((p_combos_played->>'straights')::INTEGER, 0),
      flushes_played = COALESCE(flushes_played, 0) + COALESCE((p_combos_played->>'flushes')::INTEGER, 0),
      full_houses_played = full_houses_played + COALESCE((p_combos_played->>'full_houses')::INTEGER, 0),
      four_of_a_kinds_played = four_of_a_kinds_played + COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0),
      straight_flushes_played = straight_flushes_played + COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0),
      royal_flushes_played = royal_flushes_played + COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0)
    WHERE user_id = p_user_id;
  END IF;

  -- Update mode-specific stats
  IF p_game_type = 'casual' THEN
    v_new_mode_win_rate := ROUND(
      (COALESCE(v_stats.casual_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL / 
      (COALESCE(v_stats.casual_games_played, 0) + 1)::DECIMAL * 100, 2
    );
    UPDATE player_stats SET
      casual_games_played = COALESCE(casual_games_played, 0) + 1,
      casual_games_won = COALESCE(casual_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END,
      casual_games_lost = COALESCE(casual_games_lost, 0) + CASE WHEN NOT p_won THEN 1 ELSE 0 END,
      casual_win_rate = v_new_mode_win_rate,
      casual_rank_points = COALESCE(casual_rank_points, 1000) + v_rank_point_change
    WHERE user_id = p_user_id;
  ELSIF p_game_type = 'ranked' THEN
    v_new_mode_win_rate := ROUND(
      (COALESCE(v_stats.ranked_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL / 
      (COALESCE(v_stats.ranked_games_played, 0) + 1)::DECIMAL * 100, 2
    );
    UPDATE player_stats SET
      ranked_games_played = COALESCE(ranked_games_played, 0) + 1,
      ranked_games_won = COALESCE(ranked_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END,
      ranked_games_lost = COALESCE(ranked_games_lost, 0) + CASE WHEN NOT p_won THEN 1 ELSE 0 END,
      ranked_win_rate = v_new_mode_win_rate,
      ranked_rank_points = COALESCE(ranked_rank_points, 1000) + v_rank_point_change
    WHERE user_id = p_user_id;
  ELSIF p_game_type = 'private' THEN
    v_new_mode_win_rate := ROUND(
      (COALESCE(v_stats.private_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL / 
      (COALESCE(v_stats.private_games_played, 0) + 1)::DECIMAL * 100, 2
    );
    UPDATE player_stats SET
      private_games_played = COALESCE(private_games_played, 0) + 1,
      private_games_won = COALESCE(private_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END,
      private_games_lost = COALESCE(private_games_lost, 0) + CASE WHEN NOT p_won THEN 1 ELSE 0 END,
      private_win_rate = v_new_mode_win_rate
    WHERE user_id = p_user_id;
  END IF;

  -- Append to rank_points_history (cap at last 100 entries)
  v_new_rank_points := v_stats.rank_points + v_rank_point_change;
  v_history_entry := jsonb_build_object(
    'points', v_new_rank_points,
    'is_win', p_won,
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

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated refresh_leaderboard to refresh all views
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS VOID AS $$
BEGIN
  -- Use non-concurrent refresh to support first-run on a fresh DB
  -- (CONCURRENTLY requires a prior population which may not exist on new installs).
  REFRESH MATERIALIZED VIEW leaderboard_global;
  REFRESH MATERIALIZED VIEW leaderboard_casual;
  REFRESH MATERIALIZED VIEW leaderboard_ranked;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PART 8: Permissions
-- ============================================================================

-- Revoke and re-grant with new signature
REVOKE EXECUTE ON FUNCTION update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB, TEXT, BOOLEAN, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_player_stats_after_game(UUID, BOOLEAN, INTEGER, INTEGER, JSONB, TEXT, BOOLEAN, INTEGER) TO service_role;

-- Restrict refresh_leaderboard to service_role only to prevent expensive
-- materialised-view refreshes from being triggered by unprivileged clients.
REVOKE EXECUTE ON FUNCTION refresh_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_leaderboard() TO service_role;
