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
SET search_path = public
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
