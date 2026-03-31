-- Idempotent migration: ensure game_type and bot_difficulty exist on game_hands_training
--
-- This migration file originally attempted to add the following to public.game_hands_training:
--   - Columns: game_type, bot_difficulty
--   - Indexes: idx_game_hands_training_game_type, idx_game_hands_training_bot_difficulty
--
-- These columns and indexes are also defined in:
--   20260331060000_add_game_type_bot_difficulty_to_game_hands_training.sql
--
-- However, that earlier migration is timestamped before
--   20260718000002_create_game_hands_training.sql (which creates the table),
-- so it is guarded by IF EXISTS and will no-op on a fresh database reset.
-- This migration (ordered AFTER table creation) idempotently enforces the same
-- columns and indexes so both fresh and existing databases converge on the
-- same schema.

ALTER TABLE public.game_hands_training
  ADD COLUMN IF NOT EXISTS game_type text NOT NULL DEFAULT 'casual',
  ADD COLUMN IF NOT EXISTS bot_difficulty text;

CREATE INDEX IF NOT EXISTS idx_game_hands_training_game_type
  ON public.game_hands_training (game_type);

CREATE INDEX IF NOT EXISTS idx_game_hands_training_bot_difficulty
  ON public.game_hands_training (bot_difficulty);

-- Normalize game_type definition so environments where it was previously
-- created (e.g., as varchar and nullable) converge to the same schema as
-- fresh installs (text NOT NULL DEFAULT 'casual').
ALTER TABLE public.game_hands_training
  ALTER COLUMN game_type TYPE text USING game_type::text,
  ALTER COLUMN game_type SET DEFAULT 'casual';

-- Backfill any existing NULL values before enforcing NOT NULL
UPDATE public.game_hands_training
SET game_type = 'casual'
WHERE game_type IS NULL;

ALTER TABLE public.game_hands_training
  ALTER COLUMN game_type SET NOT NULL;
