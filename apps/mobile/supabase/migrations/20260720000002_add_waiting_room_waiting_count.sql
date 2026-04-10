-- ==========================================================================
-- C5 FIX: Add waiting_count column to waiting_room table
-- (C5 = Sprint 1 finding: waiting_count column missing from waiting_room,
--  causing Realtime live-count updates to silently drop in useMatchmaking)
-- ==========================================================================
-- The `useMatchmaking` hook expects a `waiting_count` field on `waiting_room`
-- rows delivered via Realtime UPDATE events. The find-match Edge Function
-- returns `waiting_count` in its HTTP response (which works), but the
-- Realtime-driven live queue count updates rely on a DB column that was
-- never added.
--
-- Fix: Add the column with a default of 0 so existing rows are valid.
-- The find-match Edge Function will UPDATE this column on each invocation
-- so all waiting players see the current queue size via Realtime.
-- ==========================================================================

ALTER TABLE waiting_room
  ADD COLUMN IF NOT EXISTS waiting_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN waiting_room.waiting_count IS
  'C5 Fix: Current queue count written by find-match Edge Function. '
  'Drives Realtime UPDATE events so clients see live queue size.';
