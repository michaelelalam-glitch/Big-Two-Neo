-- ============================================================================
-- Migration: Deduplicate game_history + add unique constraint on room_id
-- ============================================================================
-- Root cause: complete-game edge function had no deduplication guard.
-- In a 4-human game, all 4 clients call complete-game independently when
-- game_phase → 'game_over'. Each call inserts a game_history row and
-- runs update_player_stats_after_game for every player, quadrupling stats.
--
-- This migration:
--   1. Deletes duplicate game_history rows (keeps earliest per room_id)
--   2. Adds a unique partial index on room_id (WHERE room_id IS NOT NULL)
--      to prevent future duplicates at the DB level
--
-- NOTE: Inflated player stats (games_played, ELO, rank_points) resulting from
-- the pre-fix duplicate rows are NOT automatically reset here because
-- update_player_stats_after_game is not safely invertible without a full
-- re-computation. Stats will remain inflated unless a separate manual corrective
-- migration is run off-hours to recalculate them. They will NOT naturally re-converge
-- on their own (ELO and counter offsets persist indefinitely).
-- ============================================================================

-- ============================================================================
-- DEPLOYMENT ORDER (single authoritative sequence):
--   1. Deploy the updated complete-game Edge Function (adds the SELECT-based
--      dedup guard + 23505 handler that return 200 for duplicates instead of
--      inserting again). This is safe even before the index exists.
--   2. Run migration 20260313000001 (this file): dedup existing rows + add
--      UNIQUE index to prevent future duplicates at the DB level.
--      Rationale for EF first: the old code is still live during step 2 and
--      could race-insert a duplicate between the DELETE (Step 1) and the
--      CREATE UNIQUE INDEX (Step 2), causing the latter to fail. The updated
--      EF eliminates that window by preventing new duplicate inserts.
--   3. Run migration 20260313000002: adds stats_applied_at column (optional
--      for correctness; enables partial-failure detection in the dedup guard).
--      The Edge Function handles a missing column gracefully (falls through on
--      PostgREST error) so this migration may be applied any time after step 2.
-- ============================================================================

-- Step 1: Delete duplicate game_history rows, keeping only the earliest per room_id
DELETE FROM game_history
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY created_at ASC, id ASC) AS rn
    FROM game_history
    WHERE room_id IS NOT NULL
  ) dupes
  WHERE rn > 1
);

-- Step 2: Add unique partial index to prevent future duplicates
-- room_id can be NULL for local/casual games, so we use a partial index.
--
-- LOCKING NOTE: CREATE INDEX (without CONCURRENTLY) takes an ACCESS EXCLUSIVE
-- lock on game_history for the duration of the index build.  Supabase
-- migrations run inside a transaction, so CONCURRENTLY is not available here.
-- For a small table this lock is brief and acceptable.
--
-- PRODUCTION RUNBOOK (large tables):
--   If game_history has grown to millions of rows, run this step manually in a
--   low-traffic window OUTSIDE a transaction to avoid blocking reads/writes:
--
--     CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
--       idx_game_history_unique_room_id
--       ON game_history (room_id)
--       WHERE room_id IS NOT NULL;
--
--   Then re-run this migration (the IF NOT EXISTS guard makes it a no-op).
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_history_unique_room_id
  ON game_history (room_id)
  WHERE room_id IS NOT NULL;
