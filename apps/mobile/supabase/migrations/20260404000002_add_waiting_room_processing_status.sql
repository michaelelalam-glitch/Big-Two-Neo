-- Migration: Add 'processing' to waiting_room status constraint
-- Task #659 (3.2 follow-up): The optimistic concurrency lock in find-match
-- transitions rows from 'waiting' → 'processing' while a potential match is
-- being assembled. The existing CHECK constraint only allowed
-- ('waiting', 'matched', 'cancelled'); this migration extends it so the
-- transient 'processing' state is valid.
--
-- 'processing' rows are always reverted to 'waiting' (on lock failure) or
-- advanced to 'matched' (on successful room creation). They should never
-- persist; cleanup_stale_waiting_room_entries() handles any leaked rows.

ALTER TABLE waiting_room
  DROP CONSTRAINT IF EXISTS check_status;

ALTER TABLE waiting_room
  ADD CONSTRAINT check_status
  CHECK (status IN ('waiting', 'matched', 'cancelled', 'processing'));

-- Track when a row enters 'processing' so the staleness check can use the
-- actual lock-acquisition time rather than joined_at (which reflects when the
-- user originally joined the queue and may be many minutes in the past).
-- Without this, a player who waited >30 s before being locked could have their
-- active optimistic lock immediately reverted by the cleanup function.
ALTER TABLE waiting_room
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

-- Extend cleanup_stale_waiting_room_entries to also revert stale 'processing'
-- rows back to 'waiting'. A find-match invocation that crashes or times out
-- after acquiring the optimistic lock but before finishing match assembly will
-- leave the user stuck in 'processing' indefinitely (UNIQUE(user_id) prevents
-- them from re-joining matchmaking via the ignoreDuplicates upsert path).
-- We revert rows stuck in 'processing' for more than 30 seconds so the user
-- can re-enter the queue on their next find-match call.
CREATE OR REPLACE FUNCTION cleanup_stale_waiting_room_entries()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Remove rows that have been waiting longer than 5 minutes.
  DELETE FROM public.waiting_room
  WHERE status = 'waiting'
    AND joined_at < NOW() - INTERVAL '5 minutes';

  -- Revert rows stuck in 'processing' for more than 30 seconds back to
  -- 'waiting' so users are not permanently blocked from matchmaking by a
  -- crashed/timed-out find-match invocation.
  -- Use COALESCE so that legacy rows without processing_started_at fall back
  -- to joined_at (backward-compatible), while new rows use the accurate
  -- lock-acquisition timestamp.
  UPDATE public.waiting_room
  SET status = 'waiting',
      processing_started_at = NULL
  WHERE status = 'processing'
    AND COALESCE(processing_started_at, joined_at) < NOW() - INTERVAL '30 seconds';
END;
$$;

-- This function runs as SECURITY INVOKER, so it executes with the caller's
-- privileges and does not itself bypass RLS. Revoke both the default PUBLIC
-- EXECUTE privilege and the explicit GRANT TO authenticated that was added in
-- the baseline migration so that no authenticated client can invoke it
-- directly (which would allow griefing matchmaking). Only service_role (used
-- by server-side edge functions and scheduled jobs) may call it.
REVOKE EXECUTE ON FUNCTION cleanup_stale_waiting_room_entries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cleanup_stale_waiting_room_entries() FROM authenticated;
GRANT  EXECUTE ON FUNCTION cleanup_stale_waiting_room_entries() TO service_role;
