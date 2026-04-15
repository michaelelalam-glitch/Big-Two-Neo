-- Fix: unfriend does not remove the other player from their friends list.
-- Ensures Supabase Realtime DELETE events on friendships carry the full old row
-- so column-based subscription filters (requester_id / addressee_id) match correctly.
-- Guard against fresh-reset environments where the table may not yet exist.
DO $$
BEGIN
  IF to_regclass('public.friendships') IS NOT NULL THEN
    ALTER TABLE public.friendships REPLICA IDENTITY FULL;
  END IF;
END $$;
