-- NO-OP MIGRATION: game_type and bot_difficulty on game_hands_training
--
-- This migration file originally attempted to add the following to public.game_hands_training:
--   - Columns: game_type, bot_difficulty
--   - Indexes: idx_game_hands_training_game_type, idx_game_hands_training_bot_difficulty
--
-- However, these columns and indexes are already defined in:
--   20260331060000_add_game_type_bot_difficulty_to_game_hands_training.sql
--
-- That earlier migration is the authoritative source of truth for:
--   - The column definitions (including defaults: game_type defaults to 'casual')
--   - The related indexes
--
-- To avoid duplicate schema changes and conflicting documentation, this migration
-- has been intentionally converted into a no-op that preserves the migration
-- sequence without altering the database schema.

DO $$
BEGIN
  -- intentional no-op: all relevant changes were applied in
  -- 20260331060000_add_game_type_bot_difficulty_to_game_hands_training.sql
  NULL;
END;
$$;
