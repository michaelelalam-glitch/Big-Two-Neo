-- ============================================================
-- Leaderboard RPC Hardening (patch for 20260322000001)
-- ============================================================
-- Addresses code-review feedback on the initial RPC wrappers:
--  1. Drop old wrongly-named get_my_leaderboard_rank_* functions
--  2. Recreate paginated functions with NULL-safe p_limit/p_offset clamping
--  3. Create per-user rank lookup functions with honest names
--  4. Set explicit EXECUTE permissions (REVOKE PUBLIC, then grant to intended roles)
-- ============================================================

-- --------------------------------------------------------
-- Step 1: Drop old wrongly-named functions from 20260322000001
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_my_leaderboard_rank_ranked(uuid);
DROP FUNCTION IF EXISTS public.get_my_leaderboard_rank_casual(uuid);

-- --------------------------------------------------------
-- Step 2: Recreate paginated functions with p_limit/p_offset bounds.
--         CREATE OR REPLACE updates the function in-place; existing privileges are preserved.
--         Grants below reaffirm and document the intended permissions.
--         (REVOKE EXECUTE FROM PUBLIC is done in Step 4 after all functions are created.)
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

-- --------------------------------------------------------
-- Step 3: Create per-user rank lookup functions with honest names.
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
-- Step 4: Set explicit EXECUTE permissions on all functions
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
