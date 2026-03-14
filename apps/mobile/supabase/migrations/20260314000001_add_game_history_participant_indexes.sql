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
-- migrations run in a transaction, so we use plain CREATE INDEX, which takes a
-- SHARE lock: reads continue uninterrupted, but writes (INSERT/UPDATE/DELETE)
-- are blocked for the duration of the index build. For production tables with
-- millions of rows, run these manually OUTSIDE a transaction before deploying:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_history_player_1_id ON game_history (player_1_id) WHERE player_1_id IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_history_player_2_id ON game_history (player_2_id) WHERE player_2_id IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_history_player_3_id ON game_history (player_3_id) WHERE player_3_id IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_history_player_4_id ON game_history (player_4_id) WHERE player_4_id IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_history_voided_user_id ON game_history (voided_user_id) WHERE voided_user_id IS NOT NULL;
--
-- The IF NOT EXISTS guards below make this migration a safe no-op once the
-- indexes already exist, so the migration runner can be applied afterward.
--
-- Lock / timeout protection:
--   SET LOCAL lock_timeout = '5s'    → fail fast if any CREATE INDEX cannot
--     acquire AutoExclusive in 5 s instead of blocking in-flight queries
--     indefinitely.  A deploy failure is preferable to a read/write stall.
--   SET LOCAL statement_timeout = '30s' → abort if the index build itself
--     runs longer than 30 s (e.g. table is much larger than expected).
--   Both are LOCAL so they revert at transaction end and do not affect the
--   Supabase migration runner's wider session settings.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Fail fast rather than block: if the lock cannot be acquired within 5 s
  -- or the index build exceeds 30 s, the migration aborts with an error so
  -- the operator knows to use the CONCURRENTLY runbook above.
  EXECUTE 'SET LOCAL lock_timeout = ''5s''';
  EXECUTE 'SET LOCAL statement_timeout = ''30s''';

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
