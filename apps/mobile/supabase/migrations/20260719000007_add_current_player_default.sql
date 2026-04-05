-- Migration: add_current_player_default (2026-07-19)
--
-- Ensures all game_state columns that may be absent on older Supabase projects
-- (where the table predates the consolidated baseline) exist with safe defaults.
-- The baseline uses CREATE TABLE IF NOT EXISTS, so columns added after initial
-- project setup are missing on environments created before those additions.
--
-- All ADD COLUMN operations are idempotent (IF NOT EXISTS). For columns with
-- NOT NULL + DEFAULT, we add nullable first, backfill, then apply the constraint
-- to avoid long ACCESS EXCLUSIVE locks from volatile-default table rewrites.

-- Turn/player state
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS current_player INTEGER;
UPDATE game_state SET current_player = 0 WHERE current_player IS NULL;
ALTER TABLE game_state ALTER COLUMN current_player SET DEFAULT 0;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS scores JSONB;
UPDATE game_state SET scores = '[0, 0, 0, 0]'::jsonb WHERE scores IS NULL;
ALTER TABLE game_state ALTER COLUMN scores SET DEFAULT '[0, 0, 0, 0]'::jsonb;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS round INTEGER;
UPDATE game_state SET round = 1 WHERE round IS NULL;
ALTER TABLE game_state ALTER COLUMN round SET DEFAULT 1;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS passes INTEGER;
UPDATE game_state SET passes = 0 WHERE passes IS NULL;
ALTER TABLE game_state ALTER COLUMN passes SET DEFAULT 0;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS passes_in_row INTEGER;
UPDATE game_state SET passes_in_row = 0 WHERE passes_in_row IS NULL;
ALTER TABLE game_state ALTER COLUMN passes_in_row SET DEFAULT 0;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS last_play JSONB;
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS last_player INTEGER;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS play_history JSONB;
UPDATE game_state SET play_history = '[]'::jsonb WHERE play_history IS NULL;
ALTER TABLE game_state ALTER COLUMN play_history SET DEFAULT '[]'::jsonb;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS round_number INTEGER;
UPDATE game_state SET round_number = 1 WHERE round_number IS NULL;
ALTER TABLE game_state ALTER COLUMN round_number SET DEFAULT 1;

ALTER TABLE game_state ADD COLUMN IF NOT EXISTS dealer_index INTEGER;
UPDATE game_state SET dealer_index = 0 WHERE dealer_index IS NULL;
ALTER TABLE game_state ALTER COLUMN dealer_index SET DEFAULT 0;

-- Add game_started_at nullable first (avoids volatile-default table rewrite),
-- backfill existing rows, then set NOT NULL and DEFAULT.
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS game_started_at TIMESTAMPTZ;
UPDATE game_state SET game_started_at = NOW() WHERE game_started_at IS NULL;
ALTER TABLE game_state ALTER COLUMN game_started_at SET NOT NULL;
ALTER TABLE game_state ALTER COLUMN game_started_at SET DEFAULT NOW();

-- Signal PostgREST to reload its schema cache immediately.
NOTIFY pgrst, 'reload schema';
