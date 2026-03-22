-- ============================================================
-- Security Hardening: Fix Remaining Supabase Security Advisories
-- ============================================================
-- Fixes:
--  1. rls_enabled_no_policy  – bot_coordinator_locks            (INFO)
--  2. materialized_view_in_api – leaderboard_ranked             (WARN)
--  3. materialized_view_in_api – leaderboard_global             (WARN)
--  4. materialized_view_in_api – leaderboard_casual             (WARN)
--  5. rls_policy_always_true  – game_events   INSERT            (WARN)
--  6. rls_policy_always_true  – game_state    ALL               (WARN)
--  7. rls_policy_always_true  – match_history INSERT            (WARN)
--  8. rls_policy_always_true  – match_participants INSERT       (WARN)
-- ============================================================

-- --------------------------------------------------------
-- 1. bot_coordinator_locks
--    Add an explicit deny-all policy for the public role so the
--    "rls_enabled_no_policy" advisory is cleared.  The table is
--    only accessed server-side via service_role, which bypasses RLS.
-- --------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'bot_coordinator_locks'
      AND policyname = 'no_direct_client_access'
  ) THEN
    CREATE POLICY "no_direct_client_access"
      ON public.bot_coordinator_locks
      FOR ALL
      TO public
      USING (false)
      WITH CHECK (false);
  END IF;
END;
$$;

-- --------------------------------------------------------
-- 2-4. Materialized views: revoke direct API access and expose
--      data exclusively through SECURITY DEFINER wrapper functions.
--      This removes the "materialized_view_in_api" advisories while
--      keeping the data available to authenticated clients via RPC.
-- --------------------------------------------------------

-- Revoke direct SELECT from API roles
REVOKE SELECT ON public.leaderboard_ranked    FROM anon, authenticated;
REVOKE SELECT ON public.leaderboard_global    FROM anon, authenticated;
REVOKE SELECT ON public.leaderboard_casual    FROM anon, authenticated;

-- ---- leaderboard_ranked wrappers ----

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

-- ---- leaderboard_casual wrappers ----

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

-- ---- leaderboard_global wrapper (not queried by client but exposed in API) ----

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

-- Ensure EXECUTE is not available to PUBLIC by default
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_ranked(integer, integer)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_casual(integer, integer)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_global(integer, integer)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_rank_ranked_by_user_id(uuid)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_rank_casual_by_user_id(uuid)         FROM PUBLIC;

-- Grant EXECUTE to API roles (paginated lists: anon + authenticated; per-user: authenticated only)
GRANT EXECUTE ON FUNCTION public.get_leaderboard_ranked(integer, integer)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_casual(integer, integer)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_global(integer, integer)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_rank_ranked_by_user_id(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_rank_casual_by_user_id(uuid)         TO authenticated;

-- --------------------------------------------------------
-- 5. game_events: drop INSERT WITH CHECK(true) for public role.
--    Server-side inserts use service_role which bypasses RLS entirely.
--    The SELECT policy ("Anyone can view game events in active rooms")
--    remains intact.
-- --------------------------------------------------------
DROP POLICY IF EXISTS "System can insert game events" ON public.game_events;

-- --------------------------------------------------------
-- 6. game_state: drop the ALL USING(true)/WITH CHECK(true) policy for
--    the public role. service_role bypasses RLS; the "Authenticated
--    users can view all game states" SELECT policy remains intact.
-- --------------------------------------------------------
DROP POLICY IF EXISTS "Service role can manage game state" ON public.game_state;

-- --------------------------------------------------------
-- 7-8. match_history / match_participants: drop INSERT WITH CHECK(true)
--      policies. These are legacy tables never written to by production
--      code (confirmed by code comments; only service_role tests touch
--      them, and service_role bypasses RLS anyway).
-- --------------------------------------------------------
DROP POLICY IF EXISTS "System can insert match history"      ON public.match_history;
DROP POLICY IF EXISTS "System can insert match participants" ON public.match_participants;
