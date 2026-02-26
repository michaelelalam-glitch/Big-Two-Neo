/**
 * useClockSync Hook
 * 
 * Measures and maintains client-server clock offset for timer synchronization.
 * 
 * Architecture:
 * - When timer is created, server includes server_time_at_creation
 * - Client calculates: offset = server_time - local_time
 * - Client uses offset to correct all time calculations: correctedNow = Date.now() + offset
 * 
 * This ensures all clients see the same remaining time regardless of network latency or clock drift.
 */

import { useState, useEffect } from 'react';
import { networkLogger } from '../utils/logger';
import type { AutoPassTimerState } from '../types/multiplayer';

interface ClockSyncResult {
  /** Clock offset in milliseconds (positive = client is ahead of server) */
  offsetMs: number;
  /** Whether clock sync has been established */
  isSynced: boolean;
  /** Get corrected current time: Date.now() + offset */
  getCorrectedNow: () => number;
}

/**
 * Hook to synchronize client clock with server clock
 * 
 * @param timerState - Current timer state (includes server_time_at_creation)
 * @returns Clock sync information and corrected time function
 */
export function useClockSync(timerState: AutoPassTimerState | null): ClockSyncResult {
  const [offsetMs, setOffsetMs] = useState(0);
  const [isSynced, setIsSynced] = useState(false);

  useEffect(() => {
    if (!timerState || !timerState.active) {
      // Reset sync when timer is inactive
      setIsSynced(false);
      return;
    }

    // Check if timer has server_time_at_creation (new architecture)
    const serverTime = (timerState as any).server_time_at_creation;
    if (typeof serverTime === 'number') {
      // Calculate offset: how much to ADD to local time to get server time
      // Example: if server=1000 and local=900, offset=+100 (client is 100ms behind)
      const receivedAt = Date.now();
      const offset = serverTime - receivedAt;
      
      setOffsetMs(offset);
      setIsSynced(true);
      
      networkLogger.info('[Clock Sync] ⏱️ Synchronized with server:', {
        serverTime,
        receivedAt,
        offsetMs: offset,
        clientAhead: offset < 0,
        driftMs: Math.abs(offset),
      });
    } else {
      // Fallback: No clock sync data, use local time (old architecture)
      setOffsetMs(0);
      setIsSynced(false);
      networkLogger.warn('[Clock Sync] ⚠️ No server time in timer state - using local time');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- full timerState excluded intentionally; only the two scalar fields that indicate a new server time sync are needed as triggers; adding timerState would re-sync the clock offset on every timer tick
  }, [timerState?.active, (timerState as any)?.server_time_at_creation]);

  const getCorrectedNow = (): number => {
    return Date.now() + offsetMs;
  };

  return {
    offsetMs,
    isSynced,
    getCorrectedNow,
  };
}
