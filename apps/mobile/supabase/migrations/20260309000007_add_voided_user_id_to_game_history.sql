-- ============================================================================
-- Migration: add_voided_user_id_to_game_history
-- Branch: task/621-leaderboard-fixes
-- Date: 2026-03-09
--
-- Adds voided_user_id column to game_history so the recent-games list in
-- StatsScreen can display a neutral grey "VOID" card instead of a red "LOSS"
-- for the player who was the last human to leave an unfinished game.
--
-- complete-game edge function now computes serverVoidedPlayerId before
-- writing game_history and stores it in this column (NULL for completed games).
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'game_history' AND column_name = 'voided_user_id'
  ) THEN
    ALTER TABLE game_history
      ADD COLUMN voided_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

    COMMENT ON COLUMN game_history.voided_user_id IS
      'The user_id of the player who voided this game (last human to leave an unfinished game). NULL for completed or abandoned (non-voided) games.';
  END IF;
END $$;
