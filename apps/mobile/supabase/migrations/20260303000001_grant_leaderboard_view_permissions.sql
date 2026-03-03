-- Migration: Grant SELECT permissions on leaderboard materialized views to authenticated and anon roles.
-- Date: 2026-03-03 (matches filename timestamp 20260303000001)
-- The 20260302000001_stats_leaderboard_overhaul migration created these views but did not grant
-- SELECT access, causing "permission denied for materialized view leaderboard_casual" errors on the client.

-- Grant SELECT on both materialized views.
-- These grants are idempotent: the same grants are also applied inline in
-- 20260302000001_stats_leaderboard_overhaul.sql immediately after each view
-- creation, ensuring permissions are never missing even if this file is
-- skipped or run out of order.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'leaderboard_casual') THEN
    EXECUTE 'GRANT SELECT ON leaderboard_casual TO authenticated, anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'leaderboard_ranked') THEN
    EXECUTE 'GRANT SELECT ON leaderboard_ranked TO authenticated, anon';
  END IF;
END$$;

-- Also ensure the global leaderboard view (if it exists) has the same grants
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_matviews WHERE matviewname = 'leaderboard_global'
  ) THEN
    EXECUTE 'GRANT SELECT ON leaderboard_global TO authenticated, anon';
  END IF;
END$$;

-- Initial (non-concurrent) refresh so views have data from the start.
-- REFRESH MATERIALIZED VIEW CONCURRENTLY requires a prior population and a
-- unique index; using the plain form here is safe for a first-run migration.
-- Guards with pg_matviews check so this migration is safe to run even if the
-- view-creation migration (20260302000001) was skipped or rolled back.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'leaderboard_casual') THEN
    EXECUTE 'REFRESH MATERIALIZED VIEW leaderboard_casual';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'leaderboard_ranked') THEN
    EXECUTE 'REFRESH MATERIALIZED VIEW leaderboard_ranked';
  END IF;
END$$;
