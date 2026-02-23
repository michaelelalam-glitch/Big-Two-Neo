-- ============================================================================
-- MIGRATION STATUS: SUPERSEDED BY 20260110033809
-- ============================================================================
-- This migration has been superseded by:
--   20260110033809_add_match_and_game_tracking_columns.sql
--
-- The later migration adds the same column (last_match_winner_index) along with
-- additional tracking columns (match_ended_at, game_ended_at, game_winner_index).
--
-- This migration is retained as a no-op for migration history consistency.
-- If you're reviewing the schema, please refer to migration 20260110033809.
-- ============================================================================

-- ============================================================================
-- ORIGINAL PURPOSE: Add last_match_winner_index column to game_state table
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

-- MIGRATION SUPERSEDED: This migration has been superseded by migration
-- 20260110033809_add_match_and_game_tracking_columns.sql which adds the same
-- column along with additional tracking columns. This is now a no-op migration
-- to maintain migration history consistency.

-- Original intent: Add last_match_winner_index column
-- Current status: Column added by later migration 20260110033809
-- Action: No-op migration with informational notices only

-- Informational message
DO $$
BEGIN
  RAISE NOTICE 'ℹ️  Migration 20260110000001 superseded by 20260110033809';
  RAISE NOTICE '   - last_match_winner_index column added by later migration';
  RAISE NOTICE '   - This migration is now a no-op for consistency';
  RAISE NOTICE '   - No action required';
END $$;
