-- Fix for leaderboard refresh issue
-- This drops and recreates the refresh function to not use CONCURRENTLY
-- which can fail if the materialized view structure changed

-- Drop existing function
DROP FUNCTION IF EXISTS refresh_leaderboard();

-- Recreate without CONCURRENTLY (more reliable, slightly more blocking)
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW leaderboard_global;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Manually refresh now
REFRESH MATERIALIZED VIEW leaderboard_global;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION refresh_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_leaderboard() TO anon;
