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
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA net;

-- 2. Export tracking column (added after table creation in previous migration)
ALTER TABLE public.analytics_raw_events
  ADD COLUMN IF NOT EXISTS exported_to_bigquery_at timestamptz;

-- Partial index for exporter batch reads: unprocessed rows ordered by receive time
-- allows the claim function (ORDER BY received_at + LIMIT + FOR UPDATE SKIP LOCKED)
-- to use an index-only scan instead of a sequential scan + sort.
CREATE INDEX IF NOT EXISTS analytics_raw_events_bq_export_idx
  ON public.analytics_raw_events (received_at, id)
  WHERE exported_to_bigquery_at IS NULL;

-- 3. pg_cron schedule — invoke analytics-bigquery-push Edge Function every 5 min
--
--    PORTABILITY: the Edge Function URL and bearer secret are read from database
--    settings so this migration works across local / dev / staging / production
--    without embedding project-specific values in SQL.
--
--    Set these before running this migration:
--      ALTER DATABASE postgres
--        SET "app.supabase_functions_base_url" = 'https://<project-ref>.supabase.co';
--      ALTER DATABASE postgres
--        SET "app.cron_secret" = '<your-cron-secret>';
--    The CRON_SECRET Supabase secret must be set to the same value:
--      supabase secrets set CRON_SECRET='<your-cron-secret>'

-- Enable pg_cron (warns and skips if unavailable — safe for local/test envs)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA extensions;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING
      'pg_cron extension unavailable; skipping analytics-bigquery-push cron registration: %',
      SQLERRM;
END
$$;

-- Register cron job — idempotent (unschedules existing job before re-registering)
DO $$
DECLARE
  functions_base_url text := nullif(current_setting('app.supabase_functions_base_url', true), '');
  cron_secret        text := nullif(current_setting('app.cron_secret', true), '');
BEGIN
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
    PERFORM cron.unschedule(
      (SELECT jobid FROM cron.job WHERE jobname = 'analytics-bigquery-push')
    );
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
END
$$;
