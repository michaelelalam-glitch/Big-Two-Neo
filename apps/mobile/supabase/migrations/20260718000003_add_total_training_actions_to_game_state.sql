-- Add total_training_actions column to game_state.
--
-- This monotonically increasing counter is incremented on every play (play-cards
-- edge function) and every pass (player-pass edge function). It is used as the
-- source for game_hands_training.play_sequence so that sequence numbers are
-- globally unique within a game session and never collide across trick boundaries.
--
-- Unlike gameState.passes (which resets to 0 after every trick-clearing play),
-- total_training_actions is never reset, guaranteeing unique play_sequence values
-- for the (game_session_id, round_number, play_sequence, player_index) unique
-- index without silently dropping rows via ignoreDuplicates.
--
-- DEFAULT 0 means all existing in-progress rooms start from 0 on first increment.
-- NULL rows are treated as 0 in the edge functions via the `?? 0` fallback.

ALTER TABLE public.game_state
  ADD COLUMN IF NOT EXISTS total_training_actions integer NOT NULL DEFAULT 0;
