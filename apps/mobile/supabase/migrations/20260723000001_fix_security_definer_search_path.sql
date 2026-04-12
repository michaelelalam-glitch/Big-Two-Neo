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

-- SET search_path = public, pg_catalog is the correct pragmatic hardening
-- choice for these legacy functions: it prevents schema-injection attacks
-- (no user-controlled schema can appear before 'public') while preserving
-- unqualified references to public-schema tables inside the function body.
-- Using SET search_path = '' would require fully-qualifying every table
-- reference inside functions we cannot inspect/rewrite here.
ALTER FUNCTION public.cleanup_friendship_on_block()
  SET search_path = public, pg_catalog;

-- sync_player_stats_to_profiles and trigger_refresh_leaderboard are legacy
-- production functions that pre-date the repo's migration history and have no
-- CREATE FUNCTION in these files.  Iterate over matching signatures so this
-- migration is idempotent on fresh environments (e.g. staging, CI) where the
-- functions may not yet exist, and robust if the functions have parameters or
-- are overloaded.
DO $$
DECLARE
  target_func record;
BEGIN
  FOR target_func IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'sync_player_stats_to_profiles'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_catalog',
      target_func.schema_name,
      target_func.function_name,
      target_func.identity_args
    );
  END LOOP;

  FOR target_func IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'trigger_refresh_leaderboard'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_catalog',
      target_func.schema_name,
      target_func.function_name,
      target_func.identity_args
    );
  END LOOP;
END $$;
