-- Migration: Row-based bot-coordinator lease table + atomic helper functions
-- Task #551: Server-side bot coordinator
--
-- Replaces pg_advisory_lock wrappers. Session-level advisory locks are unreliable
-- across PgBouncer/Supabase pooled connections: acquire and release may run on
-- different backend sessions, leaking locks indefinitely.
--
-- This row-based approach works across all pooled connections because the lease
-- state is stored in a table row, not a DB session variable. The acquire function
-- atomically cleans up expired leases and inserts a new one in a single DB session.

-- ─── Lease table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_coordinator_locks (
  room_code     text        PRIMARY KEY,
  coordinator_id text       NOT NULL,
  locked_at     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

-- Enable RLS — no policies means no client (anon/authenticated) can touch the table.
-- The service_role key bypasses RLS entirely, so the Edge Function can still operate.
ALTER TABLE bot_coordinator_locks ENABLE ROW LEVEL SECURITY;

-- ─── Atomic acquire function ─────────────────────────────────────────────────────
-- Tries to acquire a lease for a room.
-- Returns TRUE if acquired, FALSE if another live lease exists.
-- Cleans up expired leases atomically inside the same DB session.
CREATE OR REPLACE FUNCTION try_acquire_bot_coordinator_lease(
  p_room_code       text,
  p_coordinator_id  text,
  p_timeout_seconds int DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_acquired boolean := false;
BEGIN
  -- Clean up any expired lease for this specific room first.
  DELETE FROM bot_coordinator_locks
  WHERE room_code = p_room_code
    AND expires_at < now();

  -- Try to insert our lease. Unique conflict means another live lease exists.
  BEGIN
    INSERT INTO bot_coordinator_locks (room_code, coordinator_id, expires_at)
    VALUES (p_room_code, p_coordinator_id,
            now() + (p_timeout_seconds || ' seconds')::interval);
    v_acquired := true;
  EXCEPTION WHEN unique_violation THEN
    v_acquired := false;
  END;

  RETURN v_acquired;
END;
$$;

-- ─── Release function ────────────────────────────────────────────────────────────
-- Releases only if coordinator_id matches (prevents foreign release).
CREATE OR REPLACE FUNCTION release_bot_coordinator_lease(
  p_room_code       text,
  p_coordinator_id  text
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
AS $$
  DELETE FROM bot_coordinator_locks
  WHERE room_code = p_room_code
    AND coordinator_id = p_coordinator_id;
$$;

-- ─── Privileges ──────────────────────────────────────────────────────────────────
-- Explicitly revoke PUBLIC execute so anon/authenticated cannot call these RPCs
-- and hold coordinator leases to stall bot turns.
REVOKE EXECUTE ON FUNCTION try_acquire_bot_coordinator_lease(text, text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION release_bot_coordinator_lease(text, text) FROM PUBLIC, anon, authenticated;

-- Grant only to service_role (used by Edge Functions with the service key).
GRANT EXECUTE ON FUNCTION try_acquire_bot_coordinator_lease(text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION release_bot_coordinator_lease(text, text) TO service_role;
