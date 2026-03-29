-- NOTE: This migration is the authoritative definition for production applies.
-- It intentionally matches the original table from the old Supabase project
-- (bjxdmhybbpbmgdabqswi) and the legacy migration at
-- apps/mobile/migrations/20260717000000_create_game_hands_training.sql, but that
-- older file is retained only for historical/reference purposes and should not be
-- applied in production workflows.
--
-- Create game_hands_training table for collecting per-hand play data to train bots.
-- Schema matches the original table from the old Supabase project (bjxdmhybbpbmgdabqswi)
-- with the same columns, indexes, and constraints.

CREATE TABLE IF NOT EXISTS public.game_hands_training (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id uuid,
  room_code character varying,
  game_session_id uuid NOT NULL,
  round_number integer NOT NULL DEFAULT 1,
  play_sequence integer NOT NULL,
  player_index integer NOT NULL,
  is_bot boolean NOT NULL DEFAULT false,
  player_hash character varying,
  hand_before_play jsonb NOT NULL,
  hand_size_before integer NOT NULL,
  cards_played jsonb NOT NULL,
  combo_type character varying NOT NULL,
  combo_key integer,
  last_play_before jsonb,
  last_play_combo_type character varying,
  is_first_play_of_round boolean NOT NULL DEFAULT false,
  is_first_play_of_game boolean NOT NULL DEFAULT false,
  passes_before_this_play integer DEFAULT 0,
  opponent_hand_sizes jsonb NOT NULL,
  total_cards_remaining integer NOT NULL,
  won_trick boolean,
  won_round boolean,
  won_game boolean,
  cards_remaining_after_play integer NOT NULL,
  was_highest_possible boolean DEFAULT false,
  alternative_plays_available integer,
  risk_score numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  game_ended_at timestamp with time zone,
  CONSTRAINT game_hands_training_pkey PRIMARY KEY (id)
);

-- Unique constraint to prevent duplicate training rows from retried edge function calls
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_hands_training_unique_play
  ON public.game_hands_training (game_session_id, round_number, play_sequence, player_index);

-- Indexes for efficient querying during bot training
CREATE INDEX IF NOT EXISTS idx_game_hands_training_session ON public.game_hands_training USING btree (game_session_id);
CREATE INDEX IF NOT EXISTS idx_game_hands_training_combo ON public.game_hands_training USING btree (combo_type);
CREATE INDEX IF NOT EXISTS idx_game_hands_training_bot ON public.game_hands_training USING btree (is_bot);
CREATE INDEX IF NOT EXISTS idx_game_hands_training_outcome ON public.game_hands_training USING btree (won_trick, won_round, won_game);
CREATE INDEX IF NOT EXISTS idx_game_hands_training_created ON public.game_hands_training USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_game_hands_training_player_hash ON public.game_hands_training USING btree (player_hash);

-- RLS is disabled by default; enable it and add service_role policies for edge function access
ALTER TABLE public.game_hands_training ENABLE ROW LEVEL SECURITY;

-- Allow service_role to insert (edge functions use service_role key)
DROP POLICY IF EXISTS "service_role_insert" ON public.game_hands_training;
CREATE POLICY "service_role_insert" ON public.game_hands_training
  FOR INSERT TO service_role WITH CHECK (true);

-- Allow service_role to select (for training data export)
DROP POLICY IF EXISTS "service_role_select" ON public.game_hands_training;
CREATE POLICY "service_role_select" ON public.game_hands_training
  FOR SELECT TO service_role USING (true);

COMMENT ON TABLE public.game_hands_training IS 'Per-hand play data collected from multiplayer games for bot training. Each row represents one card-play action with full game context.';
