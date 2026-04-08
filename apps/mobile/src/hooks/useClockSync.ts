/**
 * useClockSync Hook
 *
 * Measures client–server clock drift via a one-time NTP-style ping to the
 * `server-time` edge function.
 *
 * WHY the old approach was broken
 * ────────────────────────────────
 * The previous implementation computed:
 *   offset = server_time_at_creation − Date.now_at_receipt
 * This is only valid at the EXACT moment the timer is first created.
 * For a player who joins/rejoins mid-timer (e.g. 8 s after creation):
 *   Date.now_at_rejoin ≈ server_time_at_creation + 8000
 *   → offset = −8000  (not clock drift — it's elapsed time!)
 *   → getCorrectedNow() = Date.now() − 8000 ≈ server_time_at_CREATION
 *   → endTimestamp − getCorrectedNow() = duration_ms  (full ring on rejoin ✗)
 *
 * Using Date.now() directly (the previous "fix") ignores real clock drift
 * between devices, causing timers to show wrong values (e.g. 17 s instead
 * of 10 s on a device whose clock is 7 s behind the server).
 *
 * NEW STRATEGY
 * ─────────────
 * 1. On first mount, fire a lightweight NTP-style round-trip to server-time:
 *      t0 = Date.now()
 *      server_ms = server-time response
 *      true_drift = server_ms − t0 − rtt/2   ← device-specific, time-independent
 * 2. getCorrectedNow() = Date.now() + true_drift  ≈ server_now
 *    Works correctly for ALL players regardless of join time.
 * 3. Results are cached (module-level) for 30 s so multiple hook instances
 *    in the same game share one network round-trip.
 * 4. While the ping is in flight (< ~300 ms), drift = 0 so timers use
 *    Date.now() directly — imperceptible inaccuracy for a 10-second timer.
 * 5. On ping failure, drift stays 0 — still better than a −elapsed offset.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { networkLogger } from '../utils/logger';
import type { AutoPassTimerState } from '../types/multiplayer';

interface ClockSyncResult {
  /** Clock drift in milliseconds (positive = client is behind server) */
  offsetMs: number;
  /** Whether clock sync has been established (ping completed) */
  isSynced: boolean;
  /** Get estimated server time: Date.now() + NTP drift */
  getCorrectedNow: () => number;
}

// ── Module-level NTP cache — shared across all hook instances ──────────────
// M4: Adaptive TTL — short (5 s) until 3 consecutive successes, then long (60 s).
// This avoids the initial latency of the static 30 s TTL while reducing pings in
// long stable sessions.
const NTP_TTL_SHORT_MS = 5_000;
const NTP_TTL_LONG_MS = 60_000;
const NTP_STABLE_THRESHOLD = 3; // consecutive successes before switching to long TTL
let _successCount = 0;
let _cachedDrift: { drift: number; measuredAt: number } | null = null;
let _pendingPing: Promise<number> | null = null;

/** @internal Reset module-level NTP cache — for unit tests only. */
export function __resetCacheForTesting(): void {
  _cachedDrift = null;
  _pendingPing = null;
  _successCount = 0;
}

async function getServerDriftMs(): Promise<number> {
  const now = Date.now();
  // Return cached result if fresh — TTL depends on how stable the sync has been.
  const ttl = _successCount >= NTP_STABLE_THRESHOLD ? NTP_TTL_LONG_MS : NTP_TTL_SHORT_MS;
  if (_cachedDrift && now - _cachedDrift.measuredAt < ttl) {
    return _cachedDrift.drift;
  }
  // Deduplicate concurrent calls — only one in-flight ping at a time.
  if (_pendingPing) return _pendingPing;

  _pendingPing = (async () => {
    try {
      const t0 = Date.now();
      const { data, error } = await supabase.functions.invoke('server-time');
      const rtt = Date.now() - t0;
      if (error || typeof data?.timestamp !== 'number') {
        networkLogger.warn('[Clock Sync] ⚠️ server-time ping failed, drift=0:', error);
        _successCount = 0;
        return 0;
      }
      const drift = (data.timestamp as number) - t0 - Math.round(rtt / 2);
      _cachedDrift = { drift, measuredAt: Date.now() };
      _successCount = Math.min(_successCount + 1, NTP_STABLE_THRESHOLD);
      networkLogger.info('[Clock Sync] ✅ NTP drift measured:', {
        serverMs: data.timestamp,
        t0,
        rtt,
        drift,
        clientAhead: drift < 0,
        absMs: Math.abs(drift),
      });
      return drift;
    } catch (err) {
      networkLogger.warn('[Clock Sync] ⚠️ server-time ping threw, drift=0:', err);
      _successCount = 0;
      return 0;
    } finally {
      _pendingPing = null;
    }
  })();

  return _pendingPing;
}

/**
 * Hook to synchronize client clock with server clock.
 *
 * @param timerState - Current auto-pass timer state (used only for diagnostic logging).
 * @param fallbackServerTimestamp - Optional server-side timestamp (ms) used to seed a rough
 *   initial drift before the NTP ping completes when the device clock appears >1 s fast.
 * @param enabled - When false, the NTP ping is skipped and the hook immediately reports
 *   isSynced=true. Use when the caller provides its own clock offset (e.g. offline/AI games).
 */
export function useClockSync(
  timerState: AutoPassTimerState | null,
  fallbackServerTimestamp?: number | null,
  enabled = true
): ClockSyncResult {
  // Ref holds the live drift value; getCorrectedNow reads from it so stale
  // closures (e.g. setInterval) always get the latest measurement.
  const driftRef = useRef(0);
  const [offsetMs, setOffsetMs] = useState(0);
  const [isSynced, setIsSynced] = useState(false);

  // ── One-time NTP ping on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      // Caller provides their own clock offset — mark synced immediately and skip the ping.
      setIsSynced(true);
      return;
    }
    let cancelled = false;
    getServerDriftMs().then(drift => {
      if (cancelled) return;
      driftRef.current = drift;
      setOffsetMs(drift);
      setIsSynced(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `enabled` is stable (determined at creation time)
  }, []); // runs once per component mount; shared cache handles de-duplication

  // ── Fallback: seed a rough drift from turn_started_at before ping lands ─
  // Only applied when the NTP ping hasn't completed yet and the server clock
  // appears to be >1 s ahead of the client (genuine clock-skew, not jitter).
  useEffect(() => {
    if (isSynced) return;
    if (!fallbackServerTimestamp || fallbackServerTimestamp <= 0) return;
    const rough = fallbackServerTimestamp - Date.now();
    if (rough > 1000) {
      driftRef.current = rough;
      setOffsetMs(rough);
      networkLogger.info('[Clock Sync] ⏱️ Rough initial drift from fallback:', {
        fallbackServerTimestamp,
        rough,
      });
    }
  }, [fallbackServerTimestamp, isSynced]);

  // ── Diagnostic: log when a new timer identity appears ─────────────────
  const lastLoggedTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!timerState?.active || typeof timerState.server_time_at_creation !== 'number') return;
    if (timerState.server_time_at_creation === lastLoggedTimerRef.current) return;
    lastLoggedTimerRef.current = timerState.server_time_at_creation;
    networkLogger.info('[Clock Sync] 🎯 New timer observed:', {
      server_time_at_creation: timerState.server_time_at_creation,
      driftMs: driftRef.current,
      isSynced,
    });
  }, [timerState?.active, timerState?.server_time_at_creation, isSynced]);

  // ── Stable getter — reads the ref so any closure gets the latest drift ─
  const getCorrectedNow = useCallback((): number => {
    return Date.now() + driftRef.current;
  }, []); // intentionally empty: reads ref, never needs to be recreated

  return { offsetMs, isSynced, getCorrectedNow };
}
