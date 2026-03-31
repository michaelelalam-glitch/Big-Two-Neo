-- Add game_type and bot_difficulty columns to game_hands_training.
-- These are required by play-cards and player-pass edge functions which already
-- include them in training row inserts (added 2026-03-31). Without these columns
-- every insert was failing silently (Supabase rejects unknown columns), so NO
-- training hands were being saved after those edge function changes.
--
-- Note: This migration is timestamped before game_hands_training is created
-- (20260718000002). Wrapped in an IF EXISTS guard so it is safe on fresh DBs
-- where the table may not yet exist when migrations run in filename order.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'game_hands_training'
  ) THEN

    ALTER TABLE public.game_hands_training
      ADD COLUMN IF NOT EXISTS game_type character varying DEFAULT 'casual',
      ADD COLUMN IF NOT EXISTS bot_difficulty character varying DEFAULT NULL;

    -- Index for filtering training data by game type and bot difficulty
    CREATE INDEX IF NOT EXISTS idx_game_hands_training_game_type
      ON public.game_hands_training USING btree (game_type);

    CREATE INDEX IF NOT EXISTS idx_game_hands_training_bot_difficulty
      ON public.game_hands_training USING btree (bot_difficulty);

    COMMENT ON COLUMN public.game_hands_training.game_type IS 'Type of game: casual, ranked, or private';
    COMMENT ON COLUMN public.game_hands_training.bot_difficulty IS 'Bot difficulty level (easy, medium, hard) for bot players; NULL for human players';

  END IF;
END
$$;
