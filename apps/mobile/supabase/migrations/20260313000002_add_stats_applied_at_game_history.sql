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

-- Backfill pre-existing rows that are definitively complete as fully applied
-- so they are never flagged as partial failures by the new dedup logic.
-- Guards:
--   room_id IS NOT NULL    — skip local/casual-game rows (never checked by dedup)
--   game_completed = TRUE  — skip abandoned/incomplete rows whose stats were
--                            never written (they correctly remain IS NULL)
--   finished_at IS NOT NULL — skip any row that may still be in-progress
--                             (active games have finished_at = NULL; touching
--                             them would incorrectly mark stats as done while
--                             the winning caller is still running stats RPCs)
-- Note: this UPDATE may still scan a large portion of game_history depending
-- on available indexes; schedule during a low-traffic window if the table is
-- large.
-- finished_at IS NOT NULL is already required by the WHERE clause above,
-- so finished_at will never be null here — use it directly instead of COALESCE.
UPDATE game_history
  SET stats_applied_at = finished_at
  WHERE stats_applied_at IS NULL
    AND room_id IS NOT NULL
    AND game_completed = TRUE
    AND finished_at IS NOT NULL;

-- Helper function called by the complete-game Edge Function to stamp
-- stats_applied_at using the database clock (authoritative, single source of
-- truth) rather than the edge-runtime clock.  Edge clocks can drift; using
-- DB now() ensures all stats_applied_at values are directly comparable to
-- other DB timestamps (created_at, finished_at) for diagnostics and auditing.
CREATE OR REPLACE FUNCTION mark_game_stats_applied(p_room_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE game_history
     SET stats_applied_at = now()
   WHERE room_id = p_room_id
     AND stats_applied_at IS NULL;  -- idempotent: never overwrites a completed stamp
END;
$$;

COMMENT ON FUNCTION mark_game_stats_applied(UUID) IS
  'Stamps game_history.stats_applied_at = now() for a given room_id when IS NULL. '
  'Used by the complete-game Edge Function to mark stats as fully applied using '
  'the authoritative DB clock instead of the edge-runtime clock.';
