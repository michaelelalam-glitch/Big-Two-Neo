-- Migration: add_current_player_default (2026-07-19)
--
-- game_state.current_player mirrors current_turn on creation but PostgREST's
-- schema cache occasionally lags behind schema changes, causing "column not found"
-- errors in integration tests. Adding DEFAULT 0 allows the column to be omitted
-- from INSERT statements; the application always sets it explicitly where needed.
ALTER TABLE game_state
  ALTER COLUMN current_player SET DEFAULT 0;
