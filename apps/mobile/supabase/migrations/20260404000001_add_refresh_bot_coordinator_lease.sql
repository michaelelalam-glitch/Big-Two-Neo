-- Migration: Add refresh_bot_coordinator_lease SQL function
-- Task #659 (3.3): Bot-coordinator lease refresh so long-running bot loops
-- don't lose their lease mid-execution when they outlive the initial timeout.
--
-- The bot-coordinator acquires a lease with a fixed expiry (1.5× loop budget).
-- With MAX_BOT_MOVES=20 and FETCH_TIMEOUT_MS=10s, worst-case execution is
-- ~22s (20 × 1s average round-trip + delays). The initial 45-second lease
-- is adequate in the happy path, but under high DB latency or network jitter
-- a slow iteration can push total runtime past the expiry threshold, allowing
-- a second coordinator to acquire the lease and cause concurrent execution.
--
-- refresh_bot_coordinator_lease extends the lease expiry to `now() + timeout_seconds`
-- IFF the row still belongs to the caller (coordinator_id match).
-- Returns TRUE if refreshed, FALSE if the lease was stolen or expired.

CREATE OR REPLACE FUNCTION refresh_bot_coordinator_lease(
  p_room_code        text,
  p_coordinator_id   text,
  p_timeout_seconds  int DEFAULT 45
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_rows_updated int;
BEGIN
  UPDATE bot_coordinator_locks
  SET    expires_at = now() + (p_timeout_seconds || ' seconds')::interval
  WHERE  room_code = p_room_code
    AND  coordinator_id = p_coordinator_id
    AND  expires_at > now(); -- only refresh a lease that is still alive

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated > 0;
END;
$$;

-- Only service_role can call this (same access pattern as acquire/release)
REVOKE EXECUTE ON FUNCTION refresh_bot_coordinator_lease(text, text, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION refresh_bot_coordinator_lease(text, text, int) TO service_role;
