-- Migration: Security Hardening — Fix mutable search_path, RLS gaps, permissive policies
-- Date: 2026-03-22
-- Addresses all Supabase security advisor warnings/errors/infos:
--   1. Set search_path on all public functions (dynamic, environment-safe)
--   2. Enable RLS on public.room_analytics + add scoped read policy
--   3. bot_coordinator_locks — intentionally no client policy (service-role only)
--   4. Tighten permissive RLS policies on players and rooms
-- ============================================================

-- ============================================================
-- 1. Fix mutable search_path on all public functions.
--    Uses a dynamic DO block that discovers existing functions via pg_proc
--    and applies SET search_path = public, pg_catalog to each.
--    Only functions that do NOT already have an explicit search_path config
--    are altered — functions with intentional custom configurations are skipped.
--    prokind = 'f' restricts to regular functions (skips aggregates/procs).
-- ============================================================
DO $$
DECLARE
  r   RECORD;
  sql TEXT;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.prokind = 'f'
      AND  (p.proconfig IS NULL
            OR NOT array_to_string(p.proconfig, ',') LIKE '%search_path=%')
  LOOP
    sql := format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_catalog',
      r.proname, r.args
    );
    BEGIN
      EXECUTE sql;
    EXCEPTION
      WHEN undefined_function THEN
        RAISE NOTICE 'Skipping % — not found in this environment', sql;
      WHEN OTHERS THEN
        RAISE EXCEPTION 'Could not harden function %: %', sql, SQLERRM;
    END;
  END LOOP;
END $$;

-- ============================================================
-- 2. Enable RLS on public.room_analytics (currently unprotected)
--    Scoped SELECT policy: only allows access to rows for rooms the
--    authenticated user participated in (via public.players join).
--    Wrapped in a DO block so the policy is skipped gracefully if
--    public.players does not exist in this environment (superseded by
--    room_players in some schemas).
-- ============================================================

ALTER TABLE public.room_analytics ENABLE ROW LEVEL SECURITY;

-- Drop broad policy if it was applied by a previous run of this migration
DROP POLICY IF EXISTS "Authenticated users can read room analytics" ON public.room_analytics;

DO $$
BEGIN
  IF to_regclass('public.room_players') IS NOT NULL THEN
    -- Canonical membership table on fresh installs (supersedes public.players).
    CREATE POLICY "Authenticated users can read room analytics"
      ON public.room_analytics
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM   public.room_players rp
          WHERE  rp.room_id = room_analytics.room_id
            AND  rp.user_id = auth.uid()
        )
      );
  ELSIF to_regclass('public.players') IS NOT NULL THEN
    -- Legacy membership table (may exist on partially-migrated/production schemas).
    CREATE POLICY "Authenticated users can read room analytics"
      ON public.room_analytics
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM   public.rooms  r
          JOIN   public.players p ON p.room_id = r.id
          WHERE  r.id = room_analytics.room_id
            AND  p.user_id = auth.uid()
        )
      );
  END IF;
  -- If neither membership table exists, no policy is created.
  -- room_analytics remains inaccessible to clients; service_role still works.
END $$;

-- Insert/update/delete locked to service role only (inserted by server functions)
-- No INSERT/UPDATE/DELETE policy for anon or authenticated — only service role
-- (service_role bypasses RLS by default in Supabase)

-- ============================================================
-- 3. bot_coordinator_locks — intentionally no client-facing SELECT policy.
--    The table was designed with RLS enabled and zero policies so that clients
--    cannot read lock/coordinator state directly. Functions that use this table
--    are SECURITY INVOKER and rely on the caller's role; in practice they are
--    invoked as the service_role (which bypasses RLS in Supabase) or other
--    appropriately privileged roles via grants.
--    Adding a broad authenticated SELECT policy here would unnecessarily expose
--    coordinator_id and lock state to all authenticated users.
--    If a future requirement needs scoped client reads, add a narrowly scoped
--    policy (e.g., restricted to the caller's own rooms) rather than USING (true).
-- ============================================================

-- (no policy DDL for bot_coordinator_locks — intentional by design)

-- ============================================================
-- 4. Tighten permissive RLS policies on public.players
--    Replaces overly broad UPDATE/INSERT/DELETE policies that used (true)
--    with auth.uid()-scoped equivalents.
--    Wrapped in a guard: fresh-install environments that supersede public.players
--    with room_players will not have this table; DO block prevents errors.
-- ============================================================

DO $$
BEGIN
  -- Guard: only apply if public.players exists in this environment
  IF to_regclass('public.players') IS NOT NULL THEN

    -- 4a. UPDATE: only allow a user to update their own player row
    DROP POLICY IF EXISTS "Players can update own row" ON public.players;
    DROP POLICY IF EXISTS "Allow updates for authenticated users" ON public.players;
    CREATE POLICY "Players can update own row"
      ON public.players
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());

    -- 4b. INSERT: restrict to the authenticated user inserting themselves
    DROP POLICY IF EXISTS "Users can join rooms" ON public.players;
    CREATE POLICY "Users can join rooms"
      ON public.players
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());

    -- 4c. DELETE: only allow a user to remove their own player row
    DROP POLICY IF EXISTS "Users can leave rooms" ON public.players;
    CREATE POLICY "Users can leave rooms"
      ON public.players
      FOR DELETE
      TO authenticated
      USING (user_id = auth.uid());

  END IF;
END
$$;

-- ============================================================
-- 5. Tighten rooms INSERT policy — require caller to be authenticated
-- ============================================================

DROP POLICY IF EXISTS "Anyone can create rooms" ON public.rooms;
DROP POLICY IF EXISTS "Authenticated users can create rooms" ON public.rooms;
CREATE POLICY "Authenticated users can create rooms"
  ON public.rooms
  FOR INSERT
  TO authenticated
  WITH CHECK (host_id = auth.uid());
