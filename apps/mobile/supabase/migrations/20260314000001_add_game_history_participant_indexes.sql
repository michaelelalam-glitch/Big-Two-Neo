-- Migration: add B-tree indexes on game_history participant columns
-- ============================================================================
-- Context (r2934562191):
--   MatchHistoryScreen queries game_history using a 5-column OR filter:
--     player_1_id = $uid OR player_2_id = $uid OR player_3_id = $uid
--     OR player_4_id = $uid OR voided_user_id = $uid
--
--   Without per-column indexes Postgres performs a sequential scan. With 5
--   separate B-tree indexes Postgres can use a bitmap OR union of index scans,
--   dramatically reducing query cost as the table grows.
--
-- Alternative (future improvement):
--   A denormalised participants array/GIN index or a normalized game_participants
--   join table would allow a single indexed predicate. These are left as a
--   future optimisation; the 5-index approach provides immediate relief with
--   zero schema-breaking changes.
-- ============================================================================

-- CREATE INDEX CONCURRENTLY is not allowed inside a transaction. Supabase
-- migrations run in a transaction, so we use plain CREATE INDEX (ACCESS SHARE
-- lock on reads is still granted). For production tables with millions of rows,
-- run these manually OUTSIDE a transaction before deploying:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_history_player_1_id ON game_history (player_1_id) WHERE player_1_id IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_history_player_2_id ON game_history (player_2_id) WHERE player_2_id IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_history_player_3_id ON game_history (player_3_id) WHERE player_3_id IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_history_player_4_id ON game_history (player_4_id) WHERE player_4_id IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_history_voided_user_id ON game_history (voided_user_id) WHERE voided_user_id IS NOT NULL;
--
-- The IF NOT EXISTS guards below make this migration a safe no-op once the
-- indexes already exist, so the migration runner can be applied afterward.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'game_history' AND indexname = 'idx_game_history_player_1_id'
  ) THEN
    CREATE INDEX idx_game_history_player_1_id ON game_history (player_1_id) WHERE player_1_id IS NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'game_history' AND indexname = 'idx_game_history_player_2_id'
  ) THEN
    CREATE INDEX idx_game_history_player_2_id ON game_history (player_2_id) WHERE player_2_id IS NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'game_history' AND indexname = 'idx_game_history_player_3_id'
  ) THEN
    CREATE INDEX idx_game_history_player_3_id ON game_history (player_3_id) WHERE player_3_id IS NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'game_history' AND indexname = 'idx_game_history_player_4_id'
  ) THEN
    CREATE INDEX idx_game_history_player_4_id ON game_history (player_4_id) WHERE player_4_id IS NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'game_history' AND indexname = 'idx_game_history_voided_user_id'
  ) THEN
    CREATE INDEX idx_game_history_voided_user_id ON game_history (voided_user_id) WHERE voided_user_id IS NOT NULL;
  END IF;
END $$;
