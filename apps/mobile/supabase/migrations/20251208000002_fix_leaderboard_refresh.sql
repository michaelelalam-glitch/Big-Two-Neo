-- Fix for leaderboard refresh issue
-- This restores CONCURRENTLY refresh for the materialized view
-- Since we have a unique index on (user_id), CONCURRENTLY is safe and reduces locks

-- Drop existing function
DROP FUNCTION IF EXISTS refresh_leaderboard();

-- Recreate with CONCURRENTLY for better performance
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Manually refresh now
REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION refresh_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_leaderboard() TO anon;
