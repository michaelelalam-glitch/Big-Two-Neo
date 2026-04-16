-- analytics_raw_events — BigQuery-ready full-fidelity analytics store.
--
-- Purpose:
--   GA4 Measurement Protocol truncates string event params to 100 chars,
--   losing rich game data (standings JSON, combo maps, match scores).
--   This table is written by the analytics-proxy Edge Function BEFORE the
--   100-char truncation is applied to the GA4 payload, so every param value
--   is stored in full. Used as the primary source for BigQuery queries /
--   exports via BigQuery Data Transfer, Federated Queries, or a scheduled
--   export Edge Function.
--
-- BigQuery export options (configure whichever fits your billing):
--   A) Firebase Analytics BigQuery Export (Firebase Console → Integrations →
--      BigQuery) — captures GA4-native events; combine with this table for
--      full param coverage.
--   B) BigQuery DataTransfer API pointed at the Supabase Postgres connection.
--   C) analytics-bigquery-push Edge Function (secrets: GOOGLE_CLOUD_SA_KEY,
--      BIGQUERY_PROJECT_ID, BIGQUERY_DATASET_ID) — run on a CRON schedule.

CREATE TABLE IF NOT EXISTS public.analytics_raw_events (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- GA4 event name (e.g. game_started, card_play, game_session_summary)
  event_name      text        NOT NULL,
  -- Supabase user UUID (overwritten by proxy — cannot be spoofed by client)
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Device-persistent random UUID stored in AsyncStorage on the client
  client_id       text        NOT NULL,
  -- GA4 session ID (timestamp-based epoch ms from analytics.ts getSessionId())
  session_id      bigint,
  platform        text,           -- 'ios' | 'android'
  app_version     text,
  -- COMPLETE event params — NO 100-char truncation applied (BigQuery-first).
  -- Keys mirror the GA4 Measurement Protocol params sent by the app.
  event_params    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- User-scoped properties forwarded by the client (rank, locale, etc.)
  user_properties jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- true when the event was sent from a __DEV__ build
  debug_mode      boolean     NOT NULL DEFAULT false,
  -- Server-side receipt time (UTC). For client-originating time use
  -- event_params->>'client_timestamp_ms' if emitted by the client.
  received_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────── --

-- Primary access pattern: all events for a user ordered by time
CREATE INDEX IF NOT EXISTS analytics_raw_events_user_time_idx
  ON public.analytics_raw_events (user_id, received_at DESC);

-- Event-type rollups (COUNT(*) GROUP BY event_name)
CREATE INDEX IF NOT EXISTS analytics_raw_events_event_name_idx
  ON public.analytics_raw_events (event_name, received_at DESC);

-- Time-range scans (partitioned exports to BigQuery)
CREATE INDEX IF NOT EXISTS analytics_raw_events_received_at_idx
  ON public.analytics_raw_events (received_at DESC);

-- JSONB gin index for ad-hoc param queries:
--   e.g. WHERE event_params @> '{"game_mode":"online_ranked"}'
CREATE INDEX IF NOT EXISTS analytics_raw_events_params_gin_idx
  ON public.analytics_raw_events USING gin (event_params);

-- ── Row-Level Security ─────────────────────────────────────────────────────── --
-- Writes come exclusively from the service-role key inside analytics-proxy.
-- No user-facing reads to avoid PII leakage; analytics dashboards use the
-- service role or a dedicated read-only Supabase role.

ALTER TABLE public.analytics_raw_events ENABLE ROW LEVEL SECURITY;
-- Deny all by default; service role bypasses RLS by design.
-- If you add a Metabase / Retool integration, grant a dedicated role SELECT.
