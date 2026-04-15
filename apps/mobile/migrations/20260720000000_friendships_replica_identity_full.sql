-- Fix: unfriend does not remove other player from their friends list.
--
-- Root cause: Supabase Realtime uses Postgres WAL replication. For DELETE events
-- on rows without REPLICA IDENTITY FULL, the WAL only contains the primary-key
-- column (id). The Realtime server therefore cannot evaluate the column filters
-- (requester_id=eq.X or addressee_id=eq.Y) and the DELETE event is never
-- delivered to the other party's subscription, leaving their local friends list
-- stale until the next manual refresh.
--
-- Fix: Set REPLICA IDENTITY FULL on the friendships table so that DELETE events
-- carry the entire old row, allowing both filtered Realtime subscriptions to fire.

ALTER TABLE public.friendships REPLICA IDENTITY FULL;
