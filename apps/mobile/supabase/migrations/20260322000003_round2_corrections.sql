-- =============================================================================
-- Migration: Round-2 Copilot review corrections
-- Date: 2026-03-22
-- =============================================================================
-- 1. Remove the authenticated SELECT policy on room_analytics.
--    That policy was created by 20260322000000_security_hardening.sql.
--    room_analytics.metadata contains raw SQLERRM details that must not be
--    readable by regular clients.  service_role bypasses RLS and retains access.
-- 2. Recreate the three paginated leaderboard functions with fully-clamped
--    p_limit / p_offset bounds (NULL-safe COALESCE + GREATEST to block
--    negatives + LEAST cap at 100).  The previous version used only
--    LEAST(p_limit, 100) which does not defend against NULL or negative inputs.
-- =============================================================================

-- --------------------------------------------------------
-- Part 1: Drop authenticated SELECT policy on room_analytics
-- --------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can read room analytics" ON public.room_analytics;

-- --------------------------------------------------------
-- Part 2: Patch paginated leaderboard functions with hardened bounds.
--         LEAST(GREATEST(COALESCE(p_limit, 20), 0), 100) ensures:
--           • NULL          → defaults to 20
--           • negative      → clamped to 0  (returns 0 rows rather than all rows)
--           • > 100         → capped at 100 (DoS / over-fetch guard)
-- --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_leaderboard_ranked(
  p_limit  integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  user_id              uuid,
  username             text,
  avatar_url           text,
  rank_points          integer,
  games_played         integer,
  games_won            integer,
  win_rate             numeric,
  longest_win_streak   integer,
  current_win_streak   integer,
  rank                 bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT user_id, username, avatar_url, rank_points,
         games_played, games_won, win_rate,
         longest_win_streak, current_win_streak, rank
  FROM   public.leaderboard_ranked
  ORDER  BY rank
  LIMIT  LEAST(GREATEST(COALESCE(p_limit, 20), 0), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_leaderboard_casual(
  p_limit  integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  user_id              uuid,
  username             text,
  avatar_url           text,
  rank_points          integer,
  games_played         integer,
  games_won            integer,
  win_rate             numeric,
  longest_win_streak   integer,
  current_win_streak   integer,
  rank                 bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT user_id, username, avatar_url, rank_points,
         games_played, games_won, win_rate,
         longest_win_streak, current_win_streak, rank
  FROM   public.leaderboard_casual
  ORDER  BY rank
  LIMIT  LEAST(GREATEST(COALESCE(p_limit, 20), 0), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_leaderboard_global(
  p_limit  integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  user_id              uuid,
  username             text,
  avatar_url           text,
  rank_points          integer,
  games_played         integer,
  games_won            integer,
  win_rate             numeric,
  longest_win_streak   integer,
  current_win_streak   integer,
  rank                 bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT user_id, username, avatar_url, rank_points,
         games_played, games_won, win_rate,
         longest_win_streak, current_win_streak, rank
  FROM   public.leaderboard_global
  ORDER  BY rank
  LIMIT  LEAST(GREATEST(COALESCE(p_limit, 20), 0), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

-- Ensure PUBLIC cannot call these functions directly (no leakage via anonymous callers).
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_ranked(integer, integer)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_casual(integer, integer)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_global(integer, integer)  FROM PUBLIC;

-- Re-grant to authenticated callers only.
GRANT  EXECUTE ON FUNCTION public.get_leaderboard_ranked(integer, integer)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_leaderboard_casual(integer, integer)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_leaderboard_global(integer, integer)  TO authenticated;
