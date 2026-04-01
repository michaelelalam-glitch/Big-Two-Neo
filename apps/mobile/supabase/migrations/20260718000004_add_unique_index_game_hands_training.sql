-- Migration: add_unique_index_game_hands_training
--
-- Ensures the unique index idx_game_hands_training_unique_play exists on
-- (game_session_id, round_number, play_sequence, player_index) for
-- environments that created game_hands_training without it (e.g. those that
-- ran 20260718000002 before the index was added).
--
-- The IF NOT EXISTS guard makes this idempotent — safe to re-apply on any
-- environment regardless of whether the index already exists.

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_hands_training_unique_play
  ON public.game_hands_training (game_session_id, round_number, play_sequence, player_index);
