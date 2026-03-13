-- ============================================================================
-- Migration: Add stats_applied_at to game_history
-- ============================================================================
-- Adds a nullable TIMESTAMPTZ column that complete-game sets after all player
-- stats are fully written. Enables the dedup guard to distinguish:
--
--   stats_applied_at IS NOT NULL  →  winning caller completed everything; safe
--                                    to short-circuit all subsequent callers.
--   stats_applied_at IS NULL      →  winning caller crashed between the
--                                    game_history INSERT and the stats RPCs.
--                                    Subsequent callers detect the partial
--                                    failure, log a recoverable warning, and
--                                    still short-circuit (update_player_stats_
--                                    after_game is NOT idempotent — re-running
--                                    would double-count), but send game_ended
--                                    broadcast so clients are not blocked.
--
-- Observable failure mode: admin diagnostic query
--   SELECT * FROM game_history
--   WHERE  stats_applied_at IS NULL
--     AND  room_id IS NOT NULL
--     AND  created_at > NOW() - INTERVAL '24 hours';
-- ============================================================================

ALTER TABLE game_history
  ADD COLUMN IF NOT EXISTS stats_applied_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill all pre-existing rows as fully applied so they are never flagged as
-- partial failures by the new dedup logic.
UPDATE game_history
  SET stats_applied_at = COALESCE(finished_at, created_at, NOW())
  WHERE stats_applied_at IS NULL;
