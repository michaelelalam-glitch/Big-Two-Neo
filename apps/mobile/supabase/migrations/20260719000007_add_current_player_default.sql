-- Migration: add_defaults_and_reload_cache (2026-07-19)
--
-- PostgREST's schema cache on the CI Supabase project is stale and does not
-- reflect all game_state columns (current_player, dealer_index). This migration:
--   1. Ensures BOTH columns exist with DEFAULT 0 regardless of CI schema state
--   2. Issues NOTIFY pgrst, 'reload schema' so PostgREST reloads immediately
--
-- ADD COLUMN IF NOT EXISTS is a no-op when the column already exists.
-- ALTER COLUMN SET DEFAULT is safe on both existing and newly-added columns.

ALTER TABLE game_state
  ADD COLUMN IF NOT EXISTS current_player INTEGER NOT NULL DEFAULT 0;

ALTER TABLE game_state
  ALTER COLUMN current_player SET DEFAULT 0;

ALTER TABLE game_state
  ADD COLUMN IF NOT EXISTS dealer_index INTEGER NOT NULL DEFAULT 0;

ALTER TABLE game_state
  ALTER COLUMN dealer_index SET DEFAULT 0;

-- Signal PostgREST to reload its schema cache so it sees all columns.
NOTIFY pgrst, 'reload schema';
