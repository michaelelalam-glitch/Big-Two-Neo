-- Add game_type and bot_difficulty columns to game_hands_training.
--
-- game_type: distinguishes ranked / casual / private games for bot training analysis.
-- bot_difficulty: records the difficulty level of the bot in the session so training
--   data can be segmented by opponent strength.
--
-- Both columns default to NULL so existing rows are unaffected. New inserts from
-- the updated play-cards and player-pass edge functions will populate these fields.

ALTER TABLE public.game_hands_training
  ADD COLUMN IF NOT EXISTS game_type character varying,
  ADD COLUMN IF NOT EXISTS bot_difficulty character varying;

COMMENT ON COLUMN public.game_hands_training.game_type IS 'Game type: ranked, casual, or private';
COMMENT ON COLUMN public.game_hands_training.bot_difficulty IS 'Bot difficulty level for the session: easy, medium, hard, or null for human-only games';

-- Index for efficient filtering by game_type and bot_difficulty during training data export
CREATE INDEX IF NOT EXISTS idx_game_hands_training_game_type
  ON public.game_hands_training USING btree (game_type);

CREATE INDEX IF NOT EXISTS idx_game_hands_training_bot_difficulty
  ON public.game_hands_training USING btree (bot_difficulty);
