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
  DROP CONSTRAINT check_status;

ALTER TABLE waiting_room
  ADD CONSTRAINT check_status
  CHECK (status IN ('waiting', 'matched', 'cancelled', 'processing'));
