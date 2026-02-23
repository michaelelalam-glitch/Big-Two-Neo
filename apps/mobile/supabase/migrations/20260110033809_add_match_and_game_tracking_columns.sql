-- ============================================================================
-- CRITICAL FIX: Add match and game tracking columns
-- ============================================================================
-- MIGRATION NOTES:
-- - This migration supersedes 20260110000001_add_last_match_winner_index.sql
-- - CHECK constraints use explicit NULL handling per PostgreSQL best practices
-- - Pattern: CHECK (column IS NULL OR (column >= min AND column < max))
--
-- Purpose: Add timestamp and winner tracking for match/game end events
-- Date: January 10, 2026
-- Applied: 20260110033809
-- Task #585-586: Fix Match End Schema Errors

-- Add columns for tracking match and game completion
ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS last_match_winner_index INTEGER
CHECK (last_match_winner_index IS NULL OR (last_match_winner_index >= 0 AND last_match_winner_index < 4));

ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS match_ended_at TIMESTAMPTZ;

ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS game_ended_at TIMESTAMPTZ;

ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS game_winner_index INTEGER
CHECK (game_winner_index IS NULL OR (game_winner_index >= 0 AND game_winner_index < 4));

-- Add comments
COMMENT ON COLUMN game_state.last_match_winner_index IS 
  'Index (0-3) of the player who won the previous match. Used by start_new_match to determine who starts the next match.';

COMMENT ON COLUMN game_state.match_ended_at IS 
  'Timestamp when the current match ended (one player finished all cards). Used for tracking match duration.';

COMMENT ON COLUMN game_state.game_ended_at IS 
  'Timestamp when the entire game ended (one player reached 101+ points). Used for tracking game completion.';

COMMENT ON COLUMN game_state.game_winner_index IS 
  'Index (0-3) of the player who won the entire game (lowest score when someone hits 101+). NULL until game ends.';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Added match and game tracking columns to game_state table';
  RAISE NOTICE '   - last_match_winner_index: Winner of previous match (0-3)';
  RAISE NOTICE '   - match_ended_at: Timestamp of match completion';
  RAISE NOTICE '   - game_ended_at: Timestamp of game completion';
  RAISE NOTICE '   - game_winner_index: Winner of entire game (0-3)';
  RAISE NOTICE '   - Enables proper match/game end tracking and transitions';
END $$;
