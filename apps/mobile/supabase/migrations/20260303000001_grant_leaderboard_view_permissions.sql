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

-- Refresh the materialized views so they have data
-- (They may be empty if no games were completed with the new edge function yet)
REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_casual;
REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_ranked;
