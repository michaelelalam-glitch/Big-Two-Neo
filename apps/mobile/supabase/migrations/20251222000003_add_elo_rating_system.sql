-- Phase 4b: ELO Rating System & Player Rankings
-- Adds ELO ratings, ranks, match history, and preferences to profiles

-- Add ELO rating and ranking system to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS elo_rating INTEGER DEFAULT 1000;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rank VARCHAR(20) DEFAULT 'Bronze';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS region VARCHAR(10) DEFAULT 'global';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS matchmaking_preference VARCHAR(20) DEFAULT 'casual';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_matches_played INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ranked_matches_played INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS casual_matches_played INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS best_elo_rating INTEGER DEFAULT 1000;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS elo_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add constraint for matchmaking preference
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS check_matchmaking_preference;
ALTER TABLE profiles ADD CONSTRAINT check_matchmaking_preference 
  CHECK (matchmaking_preference IN ('casual', 'ranked'));

-- Add constraint for rank tiers
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS check_rank;
ALTER TABLE profiles ADD CONSTRAINT check_rank 
  CHECK (rank IN ('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster'));

-- Index for ELO-based queries
CREATE INDEX IF NOT EXISTS idx_profiles_elo_rating ON profiles(elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_rank ON profiles(rank, elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_region ON profiles(region);

-- Create match_history table
CREATE TABLE IF NOT EXISTS match_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL,
  room_code VARCHAR(10),
  match_type VARCHAR(20) NOT NULL, -- casual, ranked
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  winner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  winner_username VARCHAR(50),
  winner_elo_change INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT check_match_type CHECK (match_type IN ('casual', 'ranked'))
);

-- Create match_participants table (tracks all players in a match)
CREATE TABLE IF NOT EXISTS match_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES match_history(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  username VARCHAR(50) NOT NULL,
  player_index INTEGER NOT NULL,
  final_position INTEGER, -- 1 = winner, 2-4 = losers
  final_score INTEGER,
  cards_remaining INTEGER,
  elo_before INTEGER,
  elo_after INTEGER,
  elo_change INTEGER,
  combos_played INTEGER DEFAULT 0,
  was_bot BOOLEAN DEFAULT FALSE,
  disconnected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for match history queries
CREATE INDEX IF NOT EXISTS idx_match_history_room_id ON match_history(room_id);
CREATE INDEX IF NOT EXISTS idx_match_history_winner ON match_history(winner_user_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_history_started_at ON match_history(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_participants_user_id ON match_participants(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_participants_match_id ON match_participants(match_id);

-- Enable RLS
ALTER TABLE match_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_participants ENABLE ROW LEVEL SECURITY;

-- RLS Policies for match_history
CREATE POLICY "Users can view match history" ON match_history
  FOR SELECT USING (true);

CREATE POLICY "System can insert match history" ON match_history
  FOR INSERT WITH CHECK (true);

-- RLS Policies for match_participants
CREATE POLICY "Users can view match participants" ON match_participants
  FOR SELECT USING (true);

CREATE POLICY "System can insert match participants" ON match_participants
  FOR INSERT WITH CHECK (true);

-- Function to calculate rank from ELO rating
CREATE OR REPLACE FUNCTION calculate_rank_from_elo(p_elo_rating INTEGER)
RETURNS VARCHAR(20)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_elo_rating >= 2000 THEN RETURN 'Grandmaster';
  ELSIF p_elo_rating >= 1800 THEN RETURN 'Master';
  ELSIF p_elo_rating >= 1600 THEN RETURN 'Diamond';
  ELSIF p_elo_rating >= 1400 THEN RETURN 'Platinum';
  ELSIF p_elo_rating >= 1200 THEN RETURN 'Gold';
  ELSIF p_elo_rating >= 1000 THEN RETURN 'Silver';
  ELSE RETURN 'Bronze';
  END IF;
END;
$$;

-- Function to calculate ELO change (K-factor = 32)
CREATE OR REPLACE FUNCTION calculate_elo_change(
  p_player_elo INTEGER,
  p_opponent_avg_elo INTEGER,
  p_won BOOLEAN
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_expected DECIMAL;
  v_k_factor INTEGER := 32;
BEGIN
  -- Expected score formula: 1 / (1 + 10^((opponent_elo - player_elo) / 400))
  v_expected := 1.0 / (1.0 + POWER(10.0, (p_opponent_avg_elo - p_player_elo) / 400.0));
  
  -- ELO change = K * (actual - expected)
  IF p_won THEN
    RETURN ROUND(v_k_factor * (1.0 - v_expected));
  ELSE
    RETURN ROUND(v_k_factor * (0.0 - v_expected));
  END IF;
END;
$$;

-- Function to update player ELO after match
CREATE OR REPLACE FUNCTION update_player_elo_after_match(
  p_user_id UUID,
  p_won BOOLEAN,
  p_opponent_avg_elo INTEGER,
  p_match_type VARCHAR(20)
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_elo INTEGER;
  v_elo_change INTEGER;
  v_new_elo INTEGER;
  v_new_rank VARCHAR(20);
BEGIN
  -- Get current ELO
  SELECT elo_rating INTO v_current_elo FROM profiles WHERE id = p_user_id;
  
  IF v_current_elo IS NULL THEN
    v_current_elo := 1000; -- Default starting ELO
  END IF;
  
  -- Calculate ELO change
  v_elo_change := calculate_elo_change(v_current_elo, p_opponent_avg_elo, p_won);
  v_new_elo := GREATEST(0, v_current_elo + v_elo_change); -- Minimum ELO is 0
  
  -- Calculate new rank
  v_new_rank := calculate_rank_from_elo(v_new_elo);
  
  -- Update profile
  UPDATE profiles
  SET 
    elo_rating = v_new_elo,
    rank = v_new_rank,
    best_elo_rating = GREATEST(best_elo_rating, v_new_elo),
    elo_updated_at = NOW(),
    total_matches_played = total_matches_played + 1,
    ranked_matches_played = CASE WHEN p_match_type = 'ranked' THEN ranked_matches_played + 1 ELSE ranked_matches_played END,
    casual_matches_played = CASE WHEN p_match_type = 'casual' THEN casual_matches_played + 1 ELSE casual_matches_played END
  WHERE id = p_user_id;
  
  RETURN v_elo_change;
END;
$$;

-- Function to record match result
CREATE OR REPLACE FUNCTION record_match_result(
  p_room_id UUID,
  p_room_code VARCHAR(10),
  p_match_type VARCHAR(20),
  p_winner_user_id UUID,
  p_winner_username VARCHAR(50),
  p_participants JSONB -- Array of {user_id, username, player_index, final_position, final_score, cards_remaining, combos_played, was_bot, disconnected}
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_match_id UUID;
  v_participant JSONB;
  v_avg_opponent_elo INTEGER;
  v_elo_change INTEGER;
BEGIN
  -- Create match history record
  INSERT INTO match_history (
    room_id,
    room_code,
    match_type,
    started_at,
    ended_at,
    winner_user_id,
    winner_username
  )
  VALUES (
    p_room_id,
    p_room_code,
    p_match_type,
    NOW() - INTERVAL '10 minutes', -- Estimate (adjust based on actual game duration)
    NOW(),
    p_winner_user_id,
    p_winner_username
  )
  RETURNING id INTO v_match_id;
  
  -- Calculate average opponent ELO (for winner)
  SELECT AVG(COALESCE((SELECT elo_rating FROM profiles WHERE id = (elem->>'user_id')::UUID), 1000))::INTEGER
  INTO v_avg_opponent_elo
  FROM jsonb_array_elements(p_participants) AS elem
  WHERE (elem->>'user_id')::UUID != p_winner_user_id;
  
  -- Insert participants and update ELO
  FOR v_participant IN SELECT * FROM jsonb_array_elements(p_participants)
  LOOP
    -- Calculate ELO change for this participant
    IF (v_participant->>'user_id')::UUID = p_winner_user_id THEN
      -- Winner
      v_elo_change := update_player_elo_after_match(
        (v_participant->>'user_id')::UUID,
        TRUE,
        v_avg_opponent_elo,
        p_match_type
      );
    ELSE
      -- Loser
      v_elo_change := update_player_elo_after_match(
        (v_participant->>'user_id')::UUID,
        FALSE,
        v_avg_opponent_elo,
        p_match_type
      );
    END IF;
    
    -- Insert participant record
    INSERT INTO match_participants (
      match_id,
      user_id,
      username,
      player_index,
      final_position,
      final_score,
      cards_remaining,
      elo_before,
      elo_after,
      elo_change,
      combos_played,
      was_bot,
      disconnected
    )
    VALUES (
      v_match_id,
      (v_participant->>'user_id')::UUID,
      v_participant->>'username',
      (v_participant->>'player_index')::INTEGER,
      (v_participant->>'final_position')::INTEGER,
      (v_participant->>'final_score')::INTEGER,
      (v_participant->>'cards_remaining')::INTEGER,
      COALESCE((SELECT elo_rating FROM profiles WHERE id = (v_participant->>'user_id')::UUID), 1000) - v_elo_change,
      COALESCE((SELECT elo_rating FROM profiles WHERE id = (v_participant->>'user_id')::UUID), 1000),
      v_elo_change,
      (v_participant->>'combos_played')::INTEGER,
      (v_participant->>'was_bot')::BOOLEAN,
      (v_participant->>'disconnected')::BOOLEAN
    );
  END LOOP;
  
  RETURN v_match_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_rank_from_elo TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_elo_change TO authenticated;
GRANT EXECUTE ON FUNCTION update_player_elo_after_match TO authenticated;
GRANT EXECUTE ON FUNCTION record_match_result TO authenticated;

COMMENT ON TABLE match_history IS 'Records all completed matches';
COMMENT ON TABLE match_participants IS 'Tracks individual player performance in each match';
COMMENT ON FUNCTION calculate_rank_from_elo IS 'Converts ELO rating to rank tier (Bronze to Grandmaster)';
COMMENT ON FUNCTION calculate_elo_change IS 'Calculates ELO change based on player and opponent ratings';
COMMENT ON FUNCTION update_player_elo_after_match IS 'Updates player ELO rating after match completion';
COMMENT ON FUNCTION record_match_result IS 'Records match result and updates all participant ELO ratings';
