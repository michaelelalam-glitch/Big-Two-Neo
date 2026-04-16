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
--          event_params    JSON    REQUIRED   (or STRING if JSON type unavailable)
--          user_properties JSON    REQUIRED
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
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- 2. Export tracking column (added after table creation in previous migration)
ALTER TABLE public.analytics_raw_events
  ADD COLUMN IF NOT EXISTS exported_to_bigquery_at timestamptz;

-- Partial index: only unprocessed rows — near-zero cost once rows are exported
CREATE INDEX IF NOT EXISTS analytics_raw_events_bq_export_idx
  ON public.analytics_raw_events (exported_to_bigquery_at)
  WHERE exported_to_bigquery_at IS NULL;

-- 3. pg_cron schedule — invoke analytics-bigquery-push Edge Function every 5 min
--    The Edge Function URL uses the project ref (dppybucldqufbqhwnkxu).
--    The Authorization header must carry the service_role key so the Edge Function
--    can create a Supabase admin client for the SELECT and UPDATE operations.
SELECT cron.schedule(
  'analytics-bigquery-push',
  '*/5 * * * *',
  $$
  SELECT extensions.http_post(
    url     := 'https://dppybucldqufbqhwnkxu.supabase.co/functions/v1/analytics-bigquery-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := '{}'::jsonb
  );
  $$
);
