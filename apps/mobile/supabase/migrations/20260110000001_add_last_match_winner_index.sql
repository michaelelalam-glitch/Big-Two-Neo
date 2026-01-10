-- ============================================================================
-- CRITICAL FIX: Add last_match_winner_index column to game_state table
-- ============================================================================
-- ROOT CAUSE: start_new_match edge function fails with "No winner found" error
-- 
-- PROBLEM:
-- - When a match ends, play-cards edge function detects the winner (player with 0 cards)
-- - Client waits 2 seconds and calls start_new_match edge function
-- - start_new_match tries to find winner by searching for player with 0 cards
-- - Race condition: hands might be updated or in unexpected state
-- - Result: "Edge Function returned a non-2xx status code" error
--
-- SOLUTION:
-- - Store the match winner index in game_state when match ends
-- - start_new_match reads this stored value instead of searching hands
-- - Eliminates race condition and ensures reliable match transitions
--
-- Date: January 10, 2026
-- Task #585: Fix Match End Error
-- Reference: /Users/michaelalam/Desktop/console log.md line 843

-- Add last_match_winner_index column
ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS last_match_winner_index INTEGER
CHECK (last_match_winner_index >= 0 AND last_match_winner_index < 4);

COMMENT ON COLUMN game_state.last_match_winner_index IS 
  'Index (0-3) of the player who won the previous match. Used by start_new_match to determine who starts the next match. Updated by play-cards when a player finishes all cards.';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Added last_match_winner_index column to game_state table';
  RAISE NOTICE '   - Stores winner of previous match (0-3)';
  RAISE NOTICE '   - Prevents "No winner found" error in start_new_match';
  RAISE NOTICE '   - Eliminates race condition when transitioning between matches';
END $$;
