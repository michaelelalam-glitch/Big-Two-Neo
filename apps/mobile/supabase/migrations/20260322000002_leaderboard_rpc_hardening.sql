-- ============================================================
-- Leaderboard RPC Hardening (patch for 20260322000001)
-- ============================================================
-- Addresses code-review feedback on the initial RPC wrappers:
--  1. Add REVOKE EXECUTE FROM PUBLIC before explicit grants
--  2. Rename get_my_leaderboard_rank_* → get_leaderboard_rank_*_by_user_id
--     (honest naming: these look up ANY user's rank, not just the caller's)
--  3. Grant per-user rank functions to "authenticated" only (not "anon")
--  4. Clamp p_limit to ≤100 and enforce p_offset ≥ 0 on paginated functions
-- ============================================================

-- --------------------------------------------------------
-- Step 1: Drop old wrongly-named functions from 20260322000001
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_my_leaderboard_rank_ranked(uuid);
DROP FUNCTION IF EXISTS public.get_my_leaderboard_rank_casual(uuid);

-- --------------------------------------------------------
-- Step 2: Revoke PUBLIC EXECUTE from functions already created in 20260322000001
--         (Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION)
-- --------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_ranked(integer, integer)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_casual(integer, integer)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_global(integer, integer)  FROM PUBLIC;

-- --------------------------------------------------------
-- Step 3: Recreate paginated functions with p_limit/p_offset bounds.
--         CREATE OR REPLACE replaces in-place; permissions below are reset.
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
  LIMIT  LEAST(p_limit, 100)
  OFFSET GREATEST(p_offset, 0);
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
  LIMIT  LEAST(p_limit, 100)
  OFFSET GREATEST(p_offset, 0);
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
  LIMIT  LEAST(p_limit, 100)
  OFFSET GREATEST(p_offset, 0);
$$;

-- --------------------------------------------------------
-- Step 4: Create per-user rank lookup functions with honest names.
--         These allow looking up any user's rank (used by LeaderboardScreen
--         and StatsScreen) and are intended only for authenticated callers.
-- --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_leaderboard_rank_ranked_by_user_id(
  p_user_id uuid
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
  WHERE  user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.get_leaderboard_rank_casual_by_user_id(
  p_user_id uuid
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
  WHERE  user_id = p_user_id;
$$;

-- --------------------------------------------------------
-- Step 5: Set explicit EXECUTE permissions on all functions
--         (REVOKE from PUBLIC first, then grant to intended roles).
-- --------------------------------------------------------

-- Paginated list functions — revoke PUBLIC, grant anon + authenticated
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_ranked(integer, integer)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_casual(integer, integer)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_global(integer, integer)              FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_leaderboard_ranked(integer, integer)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_casual(integer, integer)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_global(integer, integer)               TO anon, authenticated;

-- Per-user rank functions — revoke PUBLIC, grant authenticated only
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_rank_ranked_by_user_id(uuid)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_rank_casual_by_user_id(uuid)         FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_leaderboard_rank_ranked_by_user_id(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_rank_casual_by_user_id(uuid)          TO authenticated;
