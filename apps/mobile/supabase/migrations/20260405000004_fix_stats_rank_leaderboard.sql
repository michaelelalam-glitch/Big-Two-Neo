-- ============================================================================
-- Migration: fix_stats_rank_leaderboard (2026-04-05) — ⚠️  NO-OP PLACEHOLDER
-- ============================================================================
--
-- ⚠️  THIS FILE DOES NOT CONTAIN ANY FIXES.  It is a no-op placeholder.
--
-- Originally applied live via Supabase MCP on 2026-04-05.
-- The actual stats/rank/leaderboard logic lives in these sibling migrations
-- (present in this same directory):
--
--   supabase/migrations/20260719000001_fix_casual_rank_points.sql
--   supabase/migrations/20260719000005_recalculate_rank_from_reset_date.sql
--   supabase/migrations/20260719000007_add_current_player_default.sql  (game_state column backfill)
--
-- This placeholder preserves the migration timeline so that
-- `supabase db reset` applies files in order without gaps.
-- ============================================================================

SELECT 1; -- no-op placeholder: see sibling migrations listed above
