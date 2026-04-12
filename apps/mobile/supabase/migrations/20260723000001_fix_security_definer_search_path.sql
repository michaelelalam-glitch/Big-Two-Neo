-- P5-15 FIX: Harden remaining SECURITY DEFINER functions that lack explicit
-- SET search_path.  Without this, an attacker who can create objects in a
-- schema that appears earlier in the session search_path can shadow system
-- functions (e.g. pg_catalog.now) and execute code under the function owner's
-- privileges.
--
-- Identified via:
--   SELECT proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prosecdef = true
--   AND (p.proconfig IS NULL OR NOT EXISTS (
--     SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'));
--
-- Only 3 baseline functions pre-dating the blanket hardening migration
-- (20260307000001) remain unpatched in the production database.

ALTER FUNCTION public.cleanup_friendship_on_block()
  SET search_path = public;

-- sync_player_stats_to_profiles and trigger_refresh_leaderboard are legacy
-- production functions that pre-date the repo's migration history and have no
-- CREATE FUNCTION in these files.  Guard with an existence check so this
-- migration is idempotent on fresh environments (e.g. staging, CI) where the
-- functions may not yet exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'sync_player_stats_to_profiles'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.sync_player_stats_to_profiles() SET search_path = public';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'trigger_refresh_leaderboard'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.trigger_refresh_leaderboard() SET search_path = public';
  END IF;
END $$;
