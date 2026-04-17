-- Atomic batch-claim function for the analytics BigQuery export pipeline.
--
-- Purpose: prevent concurrent Edge Function invocations from processing the
-- same analytics_raw_events rows and double-inserting them into BigQuery.
--
-- Mechanism:
--   - export_claimed_at records when a worker claimed a row.
--   - A row is eligible for claiming when NOT yet exported AND either unclaimed
--     or stale (claimed > 10 minutes ago — worker likely crashed or timed out).
--   - SELECT ... FOR UPDATE SKIP LOCKED prevents two workers from claiming the
--     same row simultaneously.
--   - On Success: worker sets exported_to_bigquery_at = now(), export_claimed_at = NULL
--   - On Failure: worker resets export_claimed_at = NULL (enables immediate retry)
--   - On Crash:   stale claim (> 10 min) is auto-recovered by the next scheduled run

-- 1. Add the claim-tracking column (idempotent)
ALTER TABLE public.analytics_raw_events
  ADD COLUMN IF NOT EXISTS export_claimed_at timestamptz;

-- 2. Claim function: atomically claims a batch and returns the rows
CREATE OR REPLACE FUNCTION public.analytics_claim_export_batch(p_limit integer DEFAULT 500)
RETURNS SETOF public.analytics_raw_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH to_claim AS (
    -- Unclaimed rows OR rows with a stale claim (crash/timeout recovery).
    -- FOR UPDATE SKIP LOCKED ensures concurrent workers never race for the same row.
    SELECT id
    FROM   public.analytics_raw_events
    WHERE  exported_to_bigquery_at IS NULL
      AND  (export_claimed_at IS NULL
            OR export_claimed_at < now() - INTERVAL '10 minutes')
    ORDER  BY received_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.analytics_raw_events AS r
  SET    export_claimed_at = now()
  FROM   to_claim
  WHERE  r.id = to_claim.id
  RETURNING r.*;
$$;

-- 3. Restrict execute permissions: SECURITY DEFINER bypasses RLS so only the
--    service_role-backed Edge Function should be able to invoke this function.
REVOKE EXECUTE ON FUNCTION public.analytics_claim_export_batch(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.analytics_claim_export_batch(integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.analytics_claim_export_batch(integer) TO service_role;

-- 4. Confirm export RPC: stamps exported_to_bigquery_at using Postgres now() so the
--    export timestamp is authoritative and consistent with received_at (which also uses
--    a server-side default). Using the Edge Function clock (new Date()) would introduce
--    clock skew between workers and drift relative to Postgres time.
--    p_ids is uuid[] (matching analytics_raw_events.id) to avoid implicit text→uuid cast
--    failures at runtime. WHERE guards prevent re-stamping already-exported rows.
CREATE OR REPLACE FUNCTION public.analytics_confirm_batch_export(p_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  UPDATE public.analytics_raw_events
  SET    exported_to_bigquery_at = now(),
         export_claimed_at       = NULL
  WHERE  id = ANY(p_ids)
  AND    exported_to_bigquery_at IS NULL   -- idempotent: skip already-confirmed rows
  AND    export_claimed_at       IS NOT NULL;  -- only update rows we actually claimed
$$;

REVOKE EXECUTE ON FUNCTION public.analytics_confirm_batch_export(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.analytics_confirm_batch_export(uuid[]) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.analytics_confirm_batch_export(uuid[]) TO service_role;

-- 5. pg_cron schedule — invoke analytics-bigquery-push Edge Function every 5 min
--
--    Registered HERE (after export_claimed_at column + claim RPC exist) so the
--    cron job can never fire against an incomplete schema.
--
--    PORTABILITY: Edge Function URL and bearer secret come from database settings
--    so this migration is portable across local / dev / staging / production.
--
--    Set these before running this migration:
--      ALTER DATABASE postgres
--        SET "app.supabase_functions_base_url" = 'https://<project-ref>.supabase.co';
--      ALTER DATABASE postgres
--        SET "app.cron_secret" = '<your-cron-secret>';
--    The CRON_SECRET Supabase secret must match:
--      supabase secrets set CRON_SECRET='<your-cron-secret>'

-- Enable pg_cron (warns and skips if unavailable — safe for local/test envs)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING
      'pg_cron extension unavailable; skipping analytics-bigquery-push cron registration: %',
      SQLERRM;
END
$$;

-- Register cron job — idempotent (unschedules existing before re-registering)
DO $$
DECLARE
  functions_base_url text := nullif(current_setting('app.supabase_functions_base_url', true), '');
  cron_secret        text := nullif(current_setting('app.cron_secret', true), '');
BEGIN
  -- Guard: skip silently if pg_cron is not installed (e.g. local / test environments)
  IF to_regclass('cron.job') IS NULL THEN
    RAISE WARNING 'pg_cron is not available; skipping analytics-bigquery-push cron registration.';
    RETURN;
  END IF;

  -- Guard: skip if pg_net is unavailable — the cron job calls net.http_post; if the
  -- pg_net migration degraded with a warning, scheduling would succeed but every run
  -- would fail with "function net.http_post does not exist".
  IF to_regproc('net.http_post') IS NULL THEN
    RAISE WARNING 'pg_net (net.http_post) is not available; skipping analytics-bigquery-push cron registration.';
    RETURN;
  END IF;

  IF functions_base_url IS NULL THEN
    RAISE EXCEPTION
      'Missing required database setting app.supabase_functions_base_url. '
      'Run: ALTER DATABASE postgres SET "app.supabase_functions_base_url" = ''https://<project-ref>.supabase.co'';';
  END IF;

  IF cron_secret IS NULL THEN
    RAISE EXCEPTION
      'Missing required database setting app.cron_secret. '
      'Run: ALTER DATABASE postgres SET "app.cron_secret" = ''<your-cron-secret>'';';
  END IF;

  -- Idempotent: remove existing job before re-registering
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'analytics-bigquery-push') THEN
    PERFORM cron.unschedule('analytics-bigquery-push');
  END IF;

  PERFORM cron.schedule(
    'analytics-bigquery-push',
    '*/5 * * * *',
    format(
      $cron$
      SELECT net.http_post(
        url     := %L,
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', %L
        ),
        body    := '{}'::jsonb
      );
      $cron$,
      functions_base_url || '/functions/v1/analytics-bigquery-push',
      'Bearer ' || cron_secret
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'analytics-bigquery-push cron registration failed: %', SQLERRM;
END
$$;
