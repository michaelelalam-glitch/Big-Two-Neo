/**
 * useClockSync Hook
 *
 * Measures and maintains client-server clock offset for timer synchronization.
 *
 * Architecture:
 * - When timer is created, server includes server_time_at_creation AND started_at
 * - Client calculates: offset = server_time - local_time  (ONCE per unique sync identity)
 * - Sync identity = (server_time_at_creation, started_at) — both fields together.
 *   A new timer whose server_time_at_creation === a previous timer's value but whose
 *   started_at differs (same server-clock millisecond, different timer) will still
 *   trigger a fresh offset calculation, preventing sticky-offset bugs.
 * - Client uses offset to correct all time calculations: correctedNow = Date.now() + offset
 *
 * CRITICAL DESIGN DECISIONS (Mar 2026 fixes):
 * 1. offsetMs is stored in a REF so getCorrectedNow always reads the latest
 *    value, even inside stale closures (e.g. setInterval callbacks that
 *    captured getCorrectedNow on an earlier render).
 * 2. The offset is only recalculated when the sync identity (server_time_at_creation,
 *    started_at) CHANGES (new timer).  Re-rendering with the SAME identity does
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
  // 5.4/5.7: Track started_at alongside server_time_at_creation so that a new timer
  // whose server_time_at_creation COLLIDES with a previous timer's value (extremely
  // rare: same server-clock millisecond) is not silently treated as the same timer.
  // Combining both fields as the sync identity prevents the "offset sticky after
  // timer null window" bug where a brand-new timer skips re-sync because
  // lastSyncedServerTime still holds the same numeric value from a past timer.
  const lastSyncedStartedAt = useRef<string | null>(null);

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
      // Fallback: No clock sync data, use local time (old architecture).
      // Always reset to the un-synced baseline — a stale offset from a
      // previous timer must not be applied when the current payload has
      // no server_time_at_creation (e.g. old-architecture payloads).
      offsetRef.current = 0;
      syncedRef.current = false;
      lastSyncedServerTime.current = null;
      lastSyncedStartedAt.current = null;
      setOffsetMs(0);
      setIsSynced(false);
      networkLogger.warn('[Clock Sync] ⚠️ No server time in timer state - using local time');
      return;
    }

    // ── Already synced for this exact timer identity? Skip. ─────────────
    // server_time_at_creation is a fixed snapshot. Recalculating
    // `serverTime - Date.now()` at a later wall-clock time would produce
    // a SMALLER offset, making remaining time appear larger (the "timer
    // restart" bug).
    // 5.4/5.7: Use started_at as a secondary identity key. Two timers with the
    // same server_time_at_creation but different started_at values are distinct
    // timers (e.g. new round that happened to start at the same clock ms). Using
    // only serverTime would prevent the new timer from ever syncing its offset.
    const currentStartedAt = timerState.started_at;
    if (
      lastSyncedServerTime.current === serverTime &&
      lastSyncedStartedAt.current === currentStartedAt
    ) {
      return;
    }

    // ── First sync for this timer identity ──────────────────────────────
    const receivedAt = Date.now();
    const offset = serverTime - receivedAt;

    lastSyncedServerTime.current = serverTime;
    lastSyncedStartedAt.current = currentStartedAt;
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
  }, [timerState?.active, timerState?.server_time_at_creation, timerState?.started_at]);

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
