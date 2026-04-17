-- Atomic batch-claim function for the analytics BigQuery export pipeline.
--
-- Purpose: prevent concurrent Edge Function invocations from processing the
-- same analytics_raw_events rows and double-inserting them into BigQuery.
--
-- Mechanism: SELECT ... FOR UPDATE SKIP LOCKED inside a CTE ensures that only
-- one worker can claim each row. Claimed rows are marked with the UNIX epoch
-- sentinel (1970-01-01 00:00:00 UTC) so they are no longer visible to
-- subsequent claim calls (which filter WHERE exported_to_bigquery_at IS NULL).
--
-- Callers MUST either:
--   a) UPDATE exported_to_bigquery_at = now()  on success (confirms export), or
--   b) UPDATE exported_to_bigquery_at = NULL    on failure (releases claim so
--      the next scheduled run can retry the rows).
--
-- The analytics-bigquery-push Edge Function handles both paths.

CREATE OR REPLACE FUNCTION public.analytics_claim_export_batch(p_limit integer DEFAULT 500)
RETURNS SETOF public.analytics_raw_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH to_claim AS (
    -- Lock selected rows; any row already locked by a concurrent worker is
    -- skipped (SKIP LOCKED) so workers never block each other.
    SELECT id
    FROM   public.analytics_raw_events
    WHERE  exported_to_bigquery_at IS NULL
    ORDER  BY received_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  -- Atomically mark selected rows as in-flight and return their full data.
  -- 'epoch'::timestamptz = 1970-01-01 00:00:00+00 — the in-flight sentinel.
  UPDATE public.analytics_raw_events AS r
  SET    exported_to_bigquery_at = 'epoch'::timestamptz
  FROM   to_claim
  WHERE  r.id = to_claim.id
  RETURNING r.*;
$$;

-- Grant execute to the authenticated and service_role so the Edge Function
-- (which uses the service role key) can call the function.
GRANT EXECUTE ON FUNCTION public.analytics_claim_export_batch(integer) TO service_role;
