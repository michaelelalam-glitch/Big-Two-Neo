-- Task #268: Leaderboard and Stats Schema
-- Creates tables for player statistics, game history, and leaderboard rankings
-- Date: December 8, 2025

-- ============================================================================
-- PART 1: PLAYER STATISTICS TABLE
-- ============================================================================

-- Track player game statistics
CREATE TABLE IF NOT EXISTS player_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Win/Loss tracking
  games_played INTEGER DEFAULT 0 CHECK (games_played >= 0),
  games_won INTEGER DEFAULT 0 CHECK (games_won >= 0),
  games_lost INTEGER DEFAULT 0 CHECK (games_lost >= 0),
  
  -- Performance metrics
  win_rate DECIMAL(5,2) DEFAULT 0.00 CHECK (win_rate >= 0 AND win_rate <= 100),
  avg_finish_position DECIMAL(3,2) CHECK (avg_finish_position >= 1 AND avg_finish_position <= 4),
  
  -- Scoring
  total_points INTEGER DEFAULT 0,
  highest_score INTEGER DEFAULT 0,
  avg_score_per_game DECIMAL(10,2) DEFAULT 0,
  
  -- Streaks
  current_win_streak INTEGER DEFAULT 0 CHECK (current_win_streak >= 0),
  longest_win_streak INTEGER DEFAULT 0 CHECK (longest_win_streak >= 0),
  current_loss_streak INTEGER DEFAULT 0 CHECK (current_loss_streak >= 0),
  
  -- Rankings
  global_rank INTEGER,
  rank_points INTEGER DEFAULT 1000, -- ELO-style rating
  
  -- Combo tracking
  singles_played INTEGER DEFAULT 0,
  pairs_played INTEGER DEFAULT 0,
  triples_played INTEGER DEFAULT 0,
  straights_played INTEGER DEFAULT 0,
  full_houses_played INTEGER DEFAULT 0,
  four_of_a_kinds_played INTEGER DEFAULT 0,
  straight_flushes_played INTEGER DEFAULT 0,
  royal_flushes_played INTEGER DEFAULT 0,
  
  -- Timestamps
  first_game_at TIMESTAMPTZ,
  last_game_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- Indexes for leaderboard queries
CREATE INDEX idx_player_stats_user_id ON player_stats(user_id);
CREATE INDEX idx_player_stats_rank_points ON player_stats(rank_points DESC);
CREATE INDEX idx_player_stats_games_won ON player_stats(games_won DESC);
CREATE INDEX idx_player_stats_win_rate ON player_stats(win_rate DESC);
CREATE INDEX idx_player_stats_updated ON player_stats(updated_at DESC);

-- Add foreign key to profiles for PostgREST join support
ALTER TABLE player_stats
ADD CONSTRAINT player_stats_user_id_profiles_fkey 
FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Player stats viewable by everyone" ON player_stats
  FOR SELECT USING (true);

CREATE POLICY "Users can insert own stats" ON player_stats
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own stats" ON player_stats
  FOR UPDATE USING ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- PART 2: GAME HISTORY TABLE
-- ============================================================================

-- Track individual game results
CREATE TABLE IF NOT EXISTS game_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  room_code TEXT NOT NULL,
  
  -- Players (store in order of finish)
  player_1_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  player_2_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  player_3_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  player_4_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Player usernames (denormalized for historical record)
  player_1_username TEXT,
  player_2_username TEXT,
  player_3_username TEXT,
  player_4_username TEXT,
  
  -- Scores
  player_1_score INTEGER DEFAULT 0,
  player_2_score INTEGER DEFAULT 0,
  player_3_score INTEGER DEFAULT 0,
  player_4_score INTEGER DEFAULT 0,
  
  -- Game metadata
  winner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  game_duration_seconds INTEGER,
  total_rounds INTEGER DEFAULT 0,
  game_mode TEXT DEFAULT 'standard', -- 'standard', 'quick', 'ranked'
  
  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CHECK (game_duration_seconds >= 0),
  CHECK (finished_at >= started_at)
);

-- Indexes for history queries
CREATE INDEX idx_game_history_player_1 ON game_history(player_1_id);
CREATE INDEX idx_game_history_player_2 ON game_history(player_2_id);
CREATE INDEX idx_game_history_player_3 ON game_history(player_3_id);
CREATE INDEX idx_game_history_player_4 ON game_history(player_4_id);
CREATE INDEX idx_game_history_winner ON game_history(winner_id);
CREATE INDEX idx_game_history_finished_at ON game_history(finished_at DESC);
CREATE INDEX idx_game_history_room_code ON game_history(room_code);

-- Enable RLS
ALTER TABLE game_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Anyone can view game history
CREATE POLICY "Game history viewable by everyone" ON game_history
  FOR SELECT USING (true);

-- Only service_role can insert (game results recorded by server)
CREATE POLICY "Service role can insert game history" ON game_history
  FOR INSERT TO service_role WITH CHECK (true);

-- ============================================================================
-- PART 3: LEADERBOARD MATERIALIZED VIEW (For Performance)
-- ============================================================================

-- Materialized view for fast leaderboard queries
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_global AS
SELECT 
  ps.user_id,
  p.username,
  p.avatar_url,
  ps.rank_points,
  ps.games_played,
  ps.games_won,
  ps.win_rate,
  ps.longest_win_streak,
  ps.current_win_streak,
  ROW_NUMBER() OVER (ORDER BY ps.rank_points DESC, ps.games_won DESC) as rank
FROM player_stats ps
INNER JOIN profiles p ON ps.user_id = p.id
WHERE ps.games_played > 0
ORDER BY ps.rank_points DESC, ps.games_won DESC;

-- Index for fast lookups
CREATE UNIQUE INDEX idx_leaderboard_global_user ON leaderboard_global(user_id);
CREATE INDEX idx_leaderboard_global_rank ON leaderboard_global(rank);

-- ============================================================================
-- PART 4: HELPER FUNCTIONS
-- ============================================================================

-- Function to initialize player stats
CREATE OR REPLACE FUNCTION initialize_player_stats(p_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_stats_id UUID;
BEGIN
  INSERT INTO player_stats (
    user_id,
    first_game_at
  ) VALUES (
    p_user_id,
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id INTO v_stats_id;
  
  RETURN v_stats_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update player stats after game
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
  -- Security: Verify the user can only update their own stats
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot update stats for other users';
  END IF;

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
    (COALESCE(v_stats.avg_finish_position, 2.5) * v_stats.games_played + p_finish_position)::DECIMAL / 
    (v_stats.games_played + 1)::DECIMAL,
    2
  );
  
  v_new_avg_score := ROUND(
    (COALESCE(v_stats.avg_score_per_game, 0) * v_stats.games_played + p_score)::DECIMAL / 
    (v_stats.games_played + 1)::DECIMAL,
    2
  );
  
  -- Update stats
  UPDATE player_stats SET
    games_played = games_played + 1,
    games_won = games_won + CASE WHEN p_won THEN 1 ELSE 0 END,
    games_lost = games_lost + CASE WHEN NOT p_won THEN 1 ELSE 0 END,
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
    -- Update combo stats from JSONB
    singles_played = singles_played + COALESCE((p_combos_played->>'singles')::INTEGER, 0),
    pairs_played = pairs_played + COALESCE((p_combos_played->>'pairs')::INTEGER, 0),
    triples_played = triples_played + COALESCE((p_combos_played->>'triples')::INTEGER, 0),
    straights_played = straights_played + COALESCE((p_combos_played->>'straights')::INTEGER, 0),
    full_houses_played = full_houses_played + COALESCE((p_combos_played->>'full_houses')::INTEGER, 0),
    four_of_a_kinds_played = four_of_a_kinds_played + COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0),
    straight_flushes_played = straight_flushes_played + COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0),
    royal_flushes_played = royal_flushes_played + COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0),
    last_game_at = NOW(),
    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to refresh leaderboard (call periodically or after games)
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PART 5: AUTOMATIC TRIGGERS
-- ============================================================================

-- Trigger to auto-create player_stats when profile is created
CREATE OR REPLACE FUNCTION auto_create_player_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO player_stats (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_created_create_stats ON profiles;
CREATE TRIGGER on_profile_created_create_stats
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION auto_create_player_stats();

-- ============================================================================
-- PART 6: ENABLE REALTIME (Optional - for live leaderboard updates)
-- ============================================================================

-- Enable realtime for leaderboard tables
ALTER PUBLICATION supabase_realtime ADD TABLE player_stats;
ALTER PUBLICATION supabase_realtime ADD TABLE game_history;

-- ============================================================================
-- PART 7: INITIALIZE STATS FOR EXISTING USERS
-- ============================================================================

-- Create player_stats entries for all existing users
INSERT INTO player_stats (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- VERIFICATION QUERIES (Run these to test)
-- ============================================================================

-- Check tables created
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name IN ('player_stats', 'game_history');

-- Check materialized view
-- SELECT * FROM leaderboard_global LIMIT 10;

-- Check indexes
-- SELECT indexname FROM pg_indexes 
-- WHERE tablename IN ('player_stats', 'game_history');
