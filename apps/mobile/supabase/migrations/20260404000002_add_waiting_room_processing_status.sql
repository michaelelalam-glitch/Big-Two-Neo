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
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Remove rows that have been waiting longer than 5 minutes.
  DELETE FROM waiting_room
  WHERE status = 'waiting'
    AND joined_at < NOW() - INTERVAL '5 minutes';

  -- Revert rows stuck in 'processing' for more than 30 seconds back to
  -- 'waiting' so users are not permanently blocked from matchmaking by a
  -- crashed/timed-out find-match invocation.
  UPDATE waiting_room
  SET status = 'waiting'
  WHERE status = 'processing'
    AND joined_at < NOW() - INTERVAL '30 seconds';
END;
$$;
