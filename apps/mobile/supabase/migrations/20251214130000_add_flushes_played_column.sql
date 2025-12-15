-- ============================================
-- FIX: Add missing flushes_played column
-- ============================================
-- Issue: Regular flushes (5 cards same suit, not straight) were not being tracked
-- Reason: Database schema was missing flushes_played column
-- Date: December 14, 2025

-- Add flushes_played column to player_stats
ALTER TABLE player_stats 
ADD COLUMN IF NOT EXISTS flushes_played INTEGER DEFAULT 0;

-- Add constraint to ensure non-negative values
ALTER TABLE player_stats
ADD CONSTRAINT check_flushes_played_non_negative 
CHECK (flushes_played >= 0);

-- Note: No backfill needed since DEFAULT 0 prevents NULL values
-- Existing records will automatically have 0 from the DEFAULT constraint

-- Create index for performance (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_player_stats_flushes_played 
ON player_stats(flushes_played);

-- Update the update_player_stats_after_game function to handle flushes
-- This function is called when game ends to update player statistics
CREATE OR REPLACE FUNCTION update_player_stats_after_game(
  p_user_id UUID,
  p_won BOOLEAN,
  p_finish_position INTEGER,
  p_score INTEGER,
  p_combos_played JSONB
) RETURNS VOID AS $$
DECLARE
  v_stats RECORD;
  v_new_win_rate DECIMAL(5,2);
  v_new_avg_position DECIMAL(3,2);
  v_new_avg_score DECIMAL(10,2);
BEGIN
  -- NOTE: This function is restricted to service_role via GRANT permissions.
  -- The JWT role check has been removed because auth.uid() returns NULL in SECURITY DEFINER context.
  -- Access control is enforced by revoking PUBLIC execute and granting only to service_role.

  -- Get current stats
  SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    -- Initialize if doesn't exist
    PERFORM initialize_player_stats(p_user_id);
    SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  END IF;
  
  -- Calculate new stats
  v_new_win_rate := ROUND(
    (v_stats.games_won + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL / 
    (v_stats.games_played + 1)::DECIMAL * 100, 
    2
  );
  
  v_new_avg_position := ROUND(
    (v_stats.avg_finish_position * v_stats.games_played + p_finish_position)::DECIMAL / 
    (v_stats.games_played + 1)::DECIMAL, 
    2
  );
  
  v_new_avg_score := ROUND(
    (v_stats.total_points + p_score)::DECIMAL / (v_stats.games_played + 1)::DECIMAL, 
    2
  );
  
  -- Update stats
  UPDATE player_stats SET
    games_played = games_played + 1,
    games_won = CASE WHEN p_won THEN games_won + 1 ELSE games_won END,
    games_lost = CASE WHEN NOT p_won THEN games_lost + 1 ELSE games_lost END,
    win_rate = v_new_win_rate,
    avg_finish_position = v_new_avg_position,
    total_points = total_points + p_score,
    highest_score = GREATEST(highest_score, p_score),
    avg_score_per_game = v_new_avg_score,
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
    rank_points = rank_points + CASE 
      WHEN p_won THEN 25 
      WHEN p_finish_position = 2 THEN 10
      WHEN p_finish_position = 3 THEN -5
      ELSE -15
    END,
    -- Update combo stats from JSONB (INCLUDING FLUSHES!)
    singles_played = singles_played + COALESCE((p_combos_played->>'singles')::INTEGER, 0),
    pairs_played = pairs_played + COALESCE((p_combos_played->>'pairs')::INTEGER, 0),
    triples_played = triples_played + COALESCE((p_combos_played->>'triples')::INTEGER, 0),
    straights_played = straights_played + COALESCE((p_combos_played->>'straights')::INTEGER, 0),
    flushes_played = flushes_played + COALESCE((p_combos_played->>'flushes')::INTEGER, 0),  -- NEW!
    full_houses_played = full_houses_played + COALESCE((p_combos_played->>'full_houses')::INTEGER, 0),
    four_of_a_kinds_played = four_of_a_kinds_played + COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0),
    straight_flushes_played = straight_flushes_played + COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0),
    royal_flushes_played = royal_flushes_played + COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0),
    last_game_at = NOW(),
    updated_at = NOW(),
    first_game_at = COALESCE(first_game_at, NOW())
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Refresh leaderboard to reflect any changes
REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global;

-- Verification query (run manually to check)
-- SELECT 
--   user_id,
--   singles_played,
--   pairs_played,
--   straights_played,
--   flushes_played,  -- NEW COLUMN
--   full_houses_played,
--   four_of_a_kinds_played,
--   straight_flushes_played
-- FROM player_stats
-- WHERE games_played > 0;
