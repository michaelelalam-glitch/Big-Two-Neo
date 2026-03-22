-- ============================================================
-- REFERENCE COPY — NOT applied by the Supabase CLI.
-- The active migration lives in apps/mobile/supabase/migrations/ (same filename).
-- This copy is retained for historical context only and will NOT affect
-- `supabase db push` or `supabase db reset`. Any changes must be made to
-- the canonical copy in apps/mobile/supabase/migrations/.
-- ============================================================
-- Migration: Security Hardening — Fix mutable search_path, RLS gaps, permissive policies
-- Date: 2026-03-22
-- Addresses all Supabase security advisor warnings/errors/infos:
--   1. Set search_path on all public functions (dynamic, environment-safe)
--   2. Enable RLS on public.room_analytics (no client-facing read policy)
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
-- 2. Enable RLS on public.room_analytics.
--    RLS is enabled so the table is protected by default.  No client-facing
--    SELECT policy is created: room_analytics.metadata contains raw SQLERRM
--    error details that must not be exposed to regular authenticated clients.
--    Only service_role (which bypasses RLS) is allowed to read this table.
--    NOTE: This reference copy reflects the canonical migration in
--    apps/mobile/supabase/migrations/20260322000000_security_hardening.sql.
-- ============================================================

ALTER TABLE public.room_analytics ENABLE ROW LEVEL SECURITY;

-- room_analytics: no client-facing SELECT policy.
-- Drop any previously-created authenticated SELECT policy (idempotent).
DROP POLICY IF EXISTS "Authenticated users can read room analytics" ON public.room_analytics;

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
