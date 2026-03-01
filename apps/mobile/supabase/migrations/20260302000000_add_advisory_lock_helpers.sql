-- Migration: Add advisory lock helper functions for bot-coordinator Edge Function
-- Task #551: Server-side bot coordinator
--
-- pg_try_advisory_lock and pg_advisory_unlock are built-in PostgreSQL functions
-- but cannot be called directly via PostgREST/Supabase rpc().
-- These thin wrappers expose them so the bot-coordinator Edge Function can use
-- distributed locking to prevent concurrent bot coordinators for the same room.

-- Wrapper for pg_try_advisory_lock(bigint)
-- Returns true if the lock was acquired, false if another session holds it.
CREATE OR REPLACE FUNCTION acquire_bot_coordinator_lock(lock_key bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RETURN pg_try_advisory_lock(lock_key);
END;
$$;

-- Wrapper for pg_advisory_unlock(bigint)
-- Returns true if the lock was released, false if not held.
CREATE OR REPLACE FUNCTION release_bot_coordinator_lock(lock_key bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RETURN pg_advisory_unlock(lock_key);
END;
$$;

-- Grant execute to the service role only (used by Edge Functions)
-- Authenticated/anon users must NOT be able to acquire advisory locks,
-- as they could hold the room lock and stall bot coordination.
GRANT EXECUTE ON FUNCTION acquire_bot_coordinator_lock(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION release_bot_coordinator_lock(bigint) TO service_role;
