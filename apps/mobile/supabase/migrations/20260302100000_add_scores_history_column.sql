-- Add scores_history JSONB column to game_state for persistent per-match score tracking.
-- This mirrors play_history: a JSONB array that grows with each match so clients can
-- reconstruct the full scoreboard from any game_state update — critical for bot-triggered
-- match ends where no HTTP response or broadcast reaches the human client.
ALTER TABLE game_state
ADD COLUMN IF NOT EXISTS scores_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Add winner and final_scores columns so the stats uploader can read game outcome
-- data directly from game_state when game_phase='game_over'.
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS winner INTEGER DEFAULT NULL;
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS final_scores JSONB DEFAULT NULL;

COMMENT ON COLUMN game_state.scores_history IS 'Array of per-match score entries [{match_number, scores: [{player_index, matchScore, cumulativeScore, cardsRemaining}]}]. Populated by play-cards edge function on each match end.';
COMMENT ON COLUMN game_state.winner IS 'Game winner player_index (lowest cumulative score). Set when game_phase=game_over.';
COMMENT ON COLUMN game_state.final_scores IS 'Final cumulative scores map {player_index_str: score}. Set when game_phase=game_over.';
