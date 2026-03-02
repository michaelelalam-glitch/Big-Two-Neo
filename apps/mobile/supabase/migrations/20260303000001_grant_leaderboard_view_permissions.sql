-- Migration: Grant SELECT permissions on leaderboard materialized views to authenticated and anon roles.
-- The 20260302000001_stats_leaderboard_overhaul migration created these views but did not grant
-- SELECT access, causing "permission denied for materialized view leaderboard_casual" errors on the client.

-- Grant SELECT on both materialized views
GRANT SELECT ON leaderboard_casual TO authenticated, anon;
GRANT SELECT ON leaderboard_ranked TO authenticated, anon;

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
REFRESH MATERIALIZED VIEW leaderboard_casual;
REFRESH MATERIALIZED VIEW leaderboard_ranked;
