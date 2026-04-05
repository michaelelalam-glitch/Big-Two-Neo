-- ============================================================================
-- Migration: fix_stats_rank_leaderboard (2026-04-05)
-- ============================================================================
-- Originally applied live via Supabase MCP on 2026-04-05.
-- Superseded by the following tracked migrations which contain the full,
-- reproducible SQL:
--   • 20260719000001_fix_casual_rank_points.sql
--       – Rewrites update_player_stats_after_game with private stats tracking,
--         capped casual rank formula, and corrected voided counters.
--   • 20260719000005_recalculate_rank_from_reset_date.sql
--       – Re-derives all casual_rank_points from game_history (post-reset).
--
-- This migration is intentionally a no-op placeholder.  The actual stats,
-- rank, and leaderboard fixes are delivered by the superseding migrations
-- listed above (NOT by this file).  It exists solely to preserve the
-- migration timeline so that `supabase db reset` applies files in order
-- without gaps.
-- ============================================================================

SELECT 1; -- no-op placeholder: see superseding migrations above
