-- Migration: add_unique_index_game_hands_training
-- Adds the unique index on (game_session_id, round_number, play_sequence, player_index)
-- that is required for the upsert ON CONFLICT clause in play-cards and player-pass
-- edge functions. Without this index, every training data insert silently fails with
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification".

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_hands_training_unique_play
  ON public.game_hands_training (game_session_id, round_number, play_sequence, player_index);
