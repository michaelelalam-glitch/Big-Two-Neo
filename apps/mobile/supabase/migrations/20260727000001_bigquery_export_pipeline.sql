-- BigQuery export infrastructure for analytics_raw_events.
--
-- What this migration does:
--   1. Enables pg_net extension (HTTP calls from Postgres)
--   2. Adds exported_to_bigquery_at column + partial index to analytics_raw_events
--   3. Schedules a pg_cron job every 5 minutes to invoke the
--      analytics-bigquery-push Edge Function
--
-- Prerequisites:
--   A) Set Supabase secrets:
--        supabase secrets set \
--          GOOGLE_CLOUD_SA_KEY='<service-account-json>' \
--          BIGQUERY_PROJECT_ID='<your-gcp-project-id>' \
--          BIGQUERY_DATASET_ID='big_two_analytics' \
--          BIGQUERY_TABLE_ID='analytics_raw_events'
--
--   B) In Google BigQuery console, create the dataset and table:
--        Dataset: big_two_analytics
--        Table:   analytics_raw_events
--        Schema:
--          id              STRING  REQUIRED
--          event_name      STRING  REQUIRED
--          user_id         STRING  NULLABLE
--          client_id       STRING  REQUIRED
--          session_id      INT64   NULLABLE
--          platform        STRING  NULLABLE
--          app_version     STRING  NULLABLE
--          event_params    JSON      REQUIRED
--          user_properties JSON      REQUIRED
--          debug_mode      BOOL    REQUIRED
--          received_at     TIMESTAMP REQUIRED
--        Partitioning: received_at (DAY)    ← enables cheap time-range queries
--        Clustering:   event_name, user_id  ← speeds up per-event / per-user analytics
--
--   C) Grant the service account:
--        roles/bigquery.dataEditor  on the dataset
--        roles/bigquery.jobUser     on the GCP project
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enable pg_net for outbound HTTP from Postgres
--    Wrapped in DO/EXCEPTION so the migration degrades gracefully in environments
--    where extension creation is restricted (local dev, CI, certain Supabase tiers).
DO $$
BEGIN
  CREATE SCHEMA IF NOT EXISTS net;
  CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA net;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'pg_net extension unavailable; raw-event BigQuery export will not function: %',
      SQLERRM;
END$$;

-- 2. Export tracking column (added after table creation in previous migration)
ALTER TABLE public.analytics_raw_events
  ADD COLUMN IF NOT EXISTS exported_to_bigquery_at timestamptz;

-- Partial index for exporter batch reads: unprocessed rows ordered by receive time
-- allows the claim function (ORDER BY received_at + LIMIT + FOR UPDATE SKIP LOCKED)
-- to use an index-only scan instead of a sequential scan + sort.
CREATE INDEX IF NOT EXISTS analytics_raw_events_bq_export_idx
  ON public.analytics_raw_events (received_at, id)
  WHERE exported_to_bigquery_at IS NULL;

-- 3. pg_cron schedule for analytics-bigquery-push is registered in
--    20260727000002_analytics_export_claim.sql — after the export_claimed_at
--    column and analytics_claim_export_batch() RPC have been created. This
--    guarantees the cron job cannot fire against an incomplete schema.
