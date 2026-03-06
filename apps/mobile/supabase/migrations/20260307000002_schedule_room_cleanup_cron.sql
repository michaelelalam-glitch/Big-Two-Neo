-- ============================================================================
-- Migration: Schedule cleanup_abandoned_rooms via pg_cron (Task #524)
-- Runs every 6 hours to clean up abandoned, stuck, and old rooms.
--
-- This cron job calls the SQL function directly (no HTTP round-trip).
-- For manual HTTP invocations via the cleanup-rooms Edge Function,
-- set CRON_SECRET in Supabase project secrets and pass it as:
--   Authorization: Bearer <CRON_SECRET>
-- ============================================================================

-- Remove stale schedule if it exists
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-abandoned-rooms');
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron might not be installed yet, that is OK
END;
$$;

-- Schedule cleanup every 6 hours (at minute 0 of hours 0, 6, 12, 18)
DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-abandoned-rooms',
    '0 */6 * * *',
    'SELECT public.cleanup_abandoned_rooms();'
  );
  RAISE NOTICE 'pg_cron: cleanup-abandoned-rooms scheduled every 6 hours';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (extension not available): %', SQLERRM;
END;
$$;
