/**
 * useClockSync Hook
 * 
 * Measures and maintains client-server clock offset for timer synchronization.
 * 
 * Architecture:
 * - When timer is created, server includes server_time_at_creation
 * - Client calculates: offset = server_time - local_time  (ONCE per unique server_time)
 * - Client uses offset to correct all time calculations: correctedNow = Date.now() + offset
 * 
 * CRITICAL DESIGN DECISIONS (Mar 2026 fixes):
 * 1. offsetMs is stored in a REF so getCorrectedNow always reads the latest
 *    value, even inside stale closures (e.g. setInterval callbacks that
 *    captured getCorrectedNow on an earlier render).
 * 2. The offset is only recalculated when server_time_at_creation CHANGES
 *    (new timer).  Re-rendering with the SAME server_time_at_creation does
 *    NOT recalculate, because `offset = fixed_serverTime - later_Date.now()`
 *    would produce a progressively smaller offset → wrong remaining time.
 * 3. When timerState goes null (e.g. brief Realtime flash between passes),
 *    we KEEP the last valid offset and isSynced=true.  Resetting would force
 *    the AutoPassTimer UI to show clamped duration (10s) instead of the real
 *    remaining, making the timer "restart" visually.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { networkLogger } from '../utils/logger';
import type { AutoPassTimerState } from '../types/multiplayer';

interface ClockSyncResult {
  /** Clock offset in milliseconds (positive = client is behind server) */
  offsetMs: number;
  /** Whether clock sync has been established */
  isSynced: boolean;
  /** Get corrected current time: Date.now() + offset — always reads current offset (ref-based) */
  getCorrectedNow: () => number;
}

/**
 * Hook to synchronize client clock with server clock
 * 
 * @param timerState - Current timer state (includes server_time_at_creation)
 * @returns Clock sync information and corrected time function
 */
export function useClockSync(timerState: AutoPassTimerState | null): ClockSyncResult {
  // ── Ref-based offset (primary source of truth) ──────────────────────────
  // State is kept in sync for re-renders but the REF is what getCorrectedNow
  // reads so that stale closures always get the latest value.
  const offsetRef = useRef(0);
  const syncedRef = useRef(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const [isSynced, setIsSynced] = useState(false);

  // Track which server_time_at_creation we already synced against so we
  // never recalculate for the same value (which would drift the offset).
  const lastSyncedServerTime = useRef<number | null>(null);

  useEffect(() => {
    // ── CRITICAL: Do NOT reset when timer goes null ─────────────────────
    // During a game-state transition (e.g. pass processed → Realtime update)
    // auto_pass_timer can briefly flash to null before reappearing with the
    // same data.  Resetting here would destroy the offset, causing the
    // AutoPassTimer UI to show full duration (10s) and then snap back —
    // the "timer restart" bug the user reported.
    if (!timerState || !timerState.active) {
      return; // Keep last valid offset — no reset
    }

    // Check if timer has server_time_at_creation (new architecture)
    const serverTime = timerState.server_time_at_creation;
    if (typeof serverTime !== 'number') {
      // Fallback: No clock sync data, use local time (old architecture)
      // Only reset if we haven't synced before
      if (!syncedRef.current) {
        offsetRef.current = 0;
        setOffsetMs(0);
        setIsSynced(false);
        networkLogger.warn('[Clock Sync] ⚠️ No server time in timer state - using local time');
      }
      return;
    }

    // ── Already synced for this exact server_time? Skip. ────────────────
    // server_time_at_creation is a fixed snapshot. Recalculating
    // `serverTime - Date.now()` at a later wall-clock time would produce
    // a SMALLER offset, making remaining time appear larger (the "timer
    // restart" bug).
    if (lastSyncedServerTime.current === serverTime) {
      return;
    }

    // ── First sync for this server_time ─────────────────────────────────
    const receivedAt = Date.now();
    const offset = serverTime - receivedAt;

    lastSyncedServerTime.current = serverTime;
    offsetRef.current = offset;
    syncedRef.current = true;
    setOffsetMs(offset);
    setIsSynced(true);

    networkLogger.info('[Clock Sync] ⏱️ Synchronized with server:', {
      serverTime,
      receivedAt,
      offsetMs: offset,
      clientAhead: offset < 0,
      driftMs: Math.abs(offset),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the timer identity changes
  }, [timerState?.active, timerState?.server_time_at_creation]);

  // ── Stable getCorrectedNow — reads from ref, safe in any closure ──────
  const getCorrectedNow = useCallback((): number => {
    return Date.now() + offsetRef.current;
  }, []); // Empty deps: the function identity never changes; it reads the ref

  return {
    offsetMs,
    isSynced,
    getCorrectedNow,
  };
}
