-- M15: pg_cron job to clean up stale 'matched' entries in the waiting_room table.
--
-- Background: When the find-match edge function matches players and creates a room,
-- it sets their waiting_room.status to 'matched'. Under normal operation the
-- start_new_match function then clears those rows. However, if start_new_match
-- fails (edge function timeout, transient DB error, client crash immediately after
-- match) the rows remain in 'matched' status indefinitely, permanently blocking
-- those users from joining future matchmaking queues (the find-match function
-- short-circuits for users with status IN ('processing', 'matched')).
--
-- Fix: schedule a pg_cron job that fires every minute and resets rows that have
-- been in 'matched' state for more than 5 minutes back to 'waiting'. This is
-- safe to do because start_new_match completes in < 30 seconds on any healthy
-- path; 5 minutes provides ample margin while preventing the permanent block.
--
-- Requires: pg_cron extension enabled on the Supabase project.
--           (Dashboard → Extensions → pg_cron → Enable)
--
-- Note: pg_cron runs in the 'cron' schema. The scheduled command is a plain
-- UPDATE statement that runs as the postgres superuser (no SECURITY DEFINER
-- function required).

-- Enable pg_cron if not already enabled (idempotent).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any existing job with this name before re-creating (idempotent migration).
SELECT cron.unschedule('cleanup_stale_matched_queue_entries')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cleanup_stale_matched_queue_entries'
  );

-- Schedule cleanup job: every minute, reset rows that have been in 'matched'
-- state for > 5 minutes back to 'waiting'.
SELECT cron.schedule(
  'cleanup_stale_matched_queue_entries', -- job name
  '* * * * *',                           -- cron expression: every minute
  $$
    UPDATE public.waiting_room
    SET
      status               = 'waiting',
      matched_room_id      = NULL,
      matched_at           = NULL,
      processing_started_at = NULL
    WHERE
      status     = 'matched'
      AND matched_at IS NOT NULL
      AND matched_at < NOW() - INTERVAL '5 minutes';
  $$
);
