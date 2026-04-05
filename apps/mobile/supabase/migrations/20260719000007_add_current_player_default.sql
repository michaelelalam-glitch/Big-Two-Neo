-- Migration: ensure_full_game_state_schema (2026-07-19)
--
-- The CI Supabase project's game_state table was created before the baseline
-- consolidated all column additions. Because the baseline uses CREATE TABLE IF NOT
-- EXISTS, columns added to the CREATE TABLE statement after initial setup were
-- never applied to the CI project.
--
-- This migration adds all potentially-missing game_state columns using
-- ADD COLUMN IF NOT EXISTS (idempotent) and then signals PostgREST to reload
-- its schema cache so integration tests can use all columns.

-- Turn/player state
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS current_player INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_state ALTER COLUMN current_player SET DEFAULT 0;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS scores JSONB NOT NULL DEFAULT '[0, 0, 0, 0]'::jsonb;
ALTER TABLE game_state ALTER COLUMN scores SET DEFAULT '[0, 0, 0, 0]'::jsonb;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE game_state ALTER COLUMN round SET DEFAULT 1;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS passes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_state ALTER COLUMN passes SET DEFAULT 0;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS passes_in_row INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_state ALTER COLUMN passes_in_row SET DEFAULT 0;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS last_play JSONB;
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS last_player INTEGER;
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS play_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE game_state ALTER COLUMN play_history SET DEFAULT '[]'::jsonb;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS round_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE game_state ALTER COLUMN round_number SET DEFAULT 1;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS dealer_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_state ALTER COLUMN dealer_index SET DEFAULT 0;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS game_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE game_state ALTER COLUMN game_started_at SET DEFAULT NOW();

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS auto_pass_active BOOLEAN DEFAULT FALSE;
ALTER TABLE game_state ALTER COLUMN auto_pass_active SET DEFAULT FALSE;

-- Signal PostgREST to reload its schema cache immediately.
NOTIFY pgrst, 'reload schema';
