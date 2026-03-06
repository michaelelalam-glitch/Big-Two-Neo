-- Migration: Add rate_limit_tracking table and room-creation rate-limit trigger
-- Tasks: #281 (room creation) | #556 (Edge Function abuse prevention)
--
-- Design:
--   • rate_limit_tracking — lightweight table used by both the DB trigger (room creation)
--     and Edge Function helpers (play-cards, player-pass) to count actions per window.
--   • enforce_create_room_rate_limit() — BEFORE INSERT trigger on `rooms` that rejects
--     requests exceeding MAX_ROOMS_PER_HOUR (5) for a given user in a rolling 1-hour window.
--   • RLS: rows are owned by the creating user; service role bypasses (bot-coordinator, etc.).
--   • Cleanup: pg_cron job purges rows older than 25 hours; table stays lean.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_tracking (
  user_id      uuid        NOT NULL,
  action_type  text        NOT NULL,
  -- Truncated to start of the current window bucket (e.g. nearest hour or 10-second slot)
  window_start timestamptz NOT NULL,
  attempts     integer     NOT NULL DEFAULT 1,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action_type, window_start)
);

COMMENT ON TABLE rate_limit_tracking IS
  'Sliding-window rate-limit counters shared by DB triggers and Edge Functions. '
  'Rows older than 25 h are purged by pg_cron.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Index for fast range scans (user + action + recency)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rate_limit_user_action_window
  ON rate_limit_tracking (user_id, action_type, window_start DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE rate_limit_tracking ENABLE ROW LEVEL SECURITY;

-- Service role (Edge Functions, trigger security-definer context) can do anything.
-- Authenticated users can only read their own rows (for potential client-side display).
CREATE POLICY "Users read own rate limit rows"
  ON rate_limit_tracking
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Writes are performed by security-definer functions only — no direct client writes.
CREATE POLICY "No direct client writes"
  ON rate_limit_tracking
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SECURITY DEFINER helper: upsert_rate_limit_counter
--    Used by both the trigger and Edge Functions.
--    Returns the NEW total attempts in the current window after incrementing.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_rate_limit_counter(
  p_user_id     uuid,
  p_action_type text,
  p_window_secs integer  -- width of the bucket in seconds (e.g. 3600 = 1 h)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_attempts     integer;
BEGIN
  -- Truncate NOW() to the nearest bucket boundary so all requests within the
  -- same window land on the same row.
  v_window_start := date_trunc('second', now()) -
                    make_interval(secs => EXTRACT(EPOCH FROM now())::bigint % p_window_secs);

  INSERT INTO rate_limit_tracking (user_id, action_type, window_start, attempts, updated_at)
  VALUES (p_user_id, p_action_type, v_window_start, 1, now())
  ON CONFLICT (user_id, action_type, window_start)
  DO UPDATE SET
    attempts   = rate_limit_tracking.attempts + 1,
    updated_at = now()
  RETURNING attempts INTO v_attempts;

  RETURN v_attempts;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. BEFORE INSERT trigger function: enforce_create_room_rate_limit
--    Limits each authenticated user to MAX_ROOMS_PER_HOUR room creations.
--    Service-role / null auth.uid() bypasses the check (bots, migrations).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_create_room_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  MAX_ROOMS_PER_HOUR CONSTANT integer := 5;
  WINDOW_SECS        CONSTANT integer := 3600; -- 1 hour
  v_caller_uid  uuid;
  v_attempts    integer;
BEGIN
  -- auth.uid() is null when called from service-role or direct SQL — skip check.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Enforce that the host_id the client is inserting matches their JWT identity.
  -- (RLS normally handles this, but belt-and-suspenders.)
  IF NEW.host_id IS DISTINCT FROM v_caller_uid THEN
    RAISE EXCEPTION 'host_id must match authenticated user'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- Increment counter and check limit.
  v_attempts := upsert_rate_limit_counter(v_caller_uid, 'create_room', WINDOW_SECS);

  IF v_attempts > MAX_ROOMS_PER_HOUR THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum % rooms per hour. Please wait before creating another room.', MAX_ROOMS_PER_HOUR
      USING ERRCODE = 'P0429';  -- custom code: too many requests
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Attach trigger to rooms table
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_rate_limit_create_room ON rooms;

CREATE TRIGGER trg_rate_limit_create_room
  BEFORE INSERT ON rooms
  FOR EACH ROW
  EXECUTE FUNCTION enforce_create_room_rate_limit();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. pg_cron: purge stale rows every hour (keeps table lean)
--    Uses the same two-block convention as other migrations:
--    block 1 — safely remove any pre-existing schedule (idempotent);
--    block 2 — register the new schedule.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('purge-rate-limit-tracking');
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron not installed yet, or job doesn't exist — safe to ignore
END;
$$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'purge-rate-limit-tracking',    -- job name
    '0 * * * *',                    -- every hour on the hour
    $$DELETE FROM rate_limit_tracking WHERE updated_at < now() - INTERVAL '25 hours'$$
  );
  RAISE NOTICE 'pg_cron: purge-rate-limit-tracking scheduled every hour';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (extension not available): %', SQLERRM;
END;
$$;
