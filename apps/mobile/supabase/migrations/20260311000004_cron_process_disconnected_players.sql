-- ============================================================================
-- Migration: pg_cron backstop for process_disconnected_players
-- Branch: game/chinese-poker
-- Date: 2026-03-11
--
-- Problem
-- -------
-- process_disconnected_players() (Phase A + Phase B) is normally triggered
-- by the update-heartbeat edge function every ~30 s via a per-room sweep slot,
-- piggybacked on connected players' heartbeats.
--
-- This works fine while at least one player has the app in the foreground.
-- But if ALL remaining connected players background their apps simultaneously
-- (or close the app), heartbeats stop, the sweep never fires, and a
-- disconnected player is never replaced — the game freezes indefinitely.
--
-- Additionally, the forceSweep client-side trigger (fired when a disconnect
-- ring hits 0) can fail if the server clock lags the client clock by >5 s
-- (after the 55-second grace-window fix applied in update-heartbeat).
--
-- Fix
-- ---
-- Schedule pg_cron to call process_disconnected_players() every minute.
-- This provides a server-side guarantee independent of client connectivity:
--   • Normal (clients in foreground): forceSweep fires at T60 via ring expiry → replacement at T60
--   • Clock-skew case: second forceSweep call (4 s retry) hits at T64 → replacement at T64
--   • All-background case: pg_cron fires at next minute mark → worst-case T60+60=T120
--
-- Once Phase B replaces a player, the next heartbeat from any active client
-- (or the same cron's next sweep) triggers bot-coordinator so the bot plays.
-- The heartbeat watchdog (every 3rd heartbeat ≈ 15 s) also triggers bot-coordinator
-- automatically when it detects that the current turn belongs to a bot.
--
-- Safety
-- ------
-- process_disconnected_players() is idempotent: already-replaced players and
-- already-closed rooms are silently skipped.  Calling it every minute for all
-- live rooms has negligible DB cost (indexed scans on room_players + rooms).
-- ============================================================================

-- Remove stale schedule if it exists from a previous deployment
DO $$
BEGIN
  PERFORM cron.unschedule('process-disconnected-players-every-minute');
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron might not be installed yet, that is OK
END;
$$;

-- Schedule: run every minute as a server-side backstop
DO $$
BEGIN
  PERFORM cron.schedule(
    'process-disconnected-players-every-minute',
    '* * * * *',
    'SELECT public.process_disconnected_players();'
  );
  RAISE NOTICE 'pg_cron: process-disconnected-players-every-minute scheduled (runs every 60 s)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (extension not available): %', SQLERRM;
END;
$$;
