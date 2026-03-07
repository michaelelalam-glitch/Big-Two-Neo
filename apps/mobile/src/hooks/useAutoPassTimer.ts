/**
 * useAutoPassTimer — Server-authoritative auto-pass timer hook.
 *
 * Extracted from useRealtime.ts (~395 lines) to isolate the most complex
 * piece of timer logic into a self-contained, independently testable module.
 *
 * Architecture (Mar 2026 – SELF-PASS MODEL):
 * - Timer state lives in `game_state.auto_pass_timer` (database)
 * - Contains `started_at` timestamp and `duration_ms`
 * - ALL clients calculate remaining_ms independently from the SAME server timestamp
 * - When the timer expires, each client auto-passes ONLY ITSELF when it's
 *   their turn.  This avoids 403 Forbidden errors from the JWT identity
 *   check in the player-pass edge function.
 * - The interval keeps running after expiry, polling every 500ms until the
 *   auto_pass_timer is cleared by the server (after 3 consecutive passes
 *   complete the trick).
 * - Bots are handled by the bot-coordinator, not this hook.
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import type { GameState, Player, AutoPassTimerState, BroadcastEvent, BroadcastData } from '../types/multiplayer';
import type { PlayerPassResponse } from '../types/realtimeTypes';
import { invokeWithRetry } from '../utils/edgeFunctionRetry';
import { networkLogger } from '../utils/logger';

export interface UseAutoPassTimerOptions {
  /** Current game state (read via ref for freshness inside setInterval). */
  gameState: GameState | null;
  /** Room object – needed for room_id and room code. */
  room: { id: string; code: string } | null;
  /** Current list of room players. */
  roomPlayers: Player[];
  /** Broadcast a message to all connected clients. */
  broadcastMessage: (event: BroadcastEvent, data: BroadcastData) => Promise<void>;
  /** Clock-sync corrected timestamp (ms). */
  getCorrectedNow: () => number;
  /** Current authenticated user id (auth.uid) — used to only auto-pass the local player. */
  currentUserId?: string | null;
}

/**
 * Manages the auto-pass timer lifecycle:
 * 1. Watches `gameState.auto_pass_timer` for active timers.
 * 2. Polls every 100 ms using a `setInterval` with a ref-based pattern to
 *    avoid stale closures.
 * 3. When the timer expires, continues polling every 500 ms.  On each tick it
 *    checks fresh DB state; if it's the local user's turn (and they're not
 *    exempt), it auto-passes them.  The interval stops when the server clears
 *    `auto_pass_timer` (after 3 passes or trick reset).
 */
export function useAutoPassTimer({
  gameState,
  room,
  roomPlayers,
  broadcastMessage,
  getCorrectedNow,
  currentUserId,
}: UseAutoPassTimerOptions): { isAutoPassInProgress: boolean } {
  // ── Refs ────────────────────────────────────────────────────────────────────
  /** Track active polling interval to prevent duplicates. */
  const activeTimerInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Unique ID of the timer we're currently polling (sequence_id or started_at). */
  const currentTimerId = useRef<string | null>(null);
  /**
   * Timestamp-based execution guard to prevent multiple simultaneous
   * auto-pass executions.  Stores the timestamp when the lock was acquired,
   * or `null` when unlocked.
   */
  const autoPassExecutionGuard = useRef<number | null>(null);
  /**
   * Reactive state that mirrors autoPassExecutionGuard so consumers
   * (e.g., useRealtime gating `pass()`) observe changes via re-render
   * rather than reading a potentially stale ref value.
   */
  const [isAutoPassInProgressState, setIsAutoPassInProgressState] = useState(false);
  /**
   * Mutable ref kept in sync with the latest `gameState` so that
   * `setInterval` callbacks never read stale closure values.
   */
  const gameStateRef = useRef<GameState | null>(null);
  /** Whether the timer has already expired — used to switch from 100ms to 500ms
   *  polling cadence after expiry to avoid DB spam. */
  const hasExpiredRef = useRef(false);
  /** Timestamp of last self-pass attempt to throttle DB queries. */
  const lastSelfPassAttemptRef = useRef<number>(0);

  // Keep ref in sync with prop
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // ── Main timer effect ───────────────────────────────────────────────────────
  useEffect(() => {
    const timerState = gameState?.auto_pass_timer;

    networkLogger.debug('⏰ [DEBUG] Timer useEffect triggered', {
      gamePhase: gameState?.game_phase,
      hasAutoPassTimer: !!timerState,
      timerActive: timerState?.active,
      timerStartedAt: timerState?.started_at,
      currentTimerId: currentTimerId.current,
      hasActiveInterval: !!activeTimerInterval.current,
      roomId: room?.id,
    });

    // ── Cleanup helper ────────────────────────────────────────────────────────
    const cleanup = () => {
      if (activeTimerInterval.current) {
        networkLogger.debug('⏰ [DEBUG] Clearing timer interval');
        clearInterval(activeTimerInterval.current);
        activeTimerInterval.current = null;
        currentTimerId.current = null;
      }
    };

    // Skip if game has finished
    if (gameState?.game_phase === 'finished') {
      cleanup();
      return;
    }

    // Skip if no timer or timer is inactive
    if (!timerState || !timerState.active) {
      cleanup();
      return;
    }

    // Prevent duplicate intervals for the same timer (keyed by sequence_id)
    const newTimerId = (timerState as AutoPassTimerState & { sequence_id?: string }).sequence_id || timerState.started_at;
    if (currentTimerId.current === newTimerId && activeTimerInterval.current) {
      networkLogger.debug('⏰ [DEBUG] Timer already running for sequence_id', newTimerId);
      return;
    }

    // Clear old interval if switching to a new timer
    cleanup();
    currentTimerId.current = newTimerId;
    hasExpiredRef.current = false;
    lastSelfPassAttemptRef.current = 0;

    networkLogger.debug('⏰ [DEBUG] Starting NEW timer polling interval', {
      sequence_id: (timerState as AutoPassTimerState & { sequence_id?: string }).sequence_id,
      started_at: timerState.started_at,
      end_timestamp: (timerState as AutoPassTimerState & { end_timestamp?: number }).end_timestamp,
      duration_ms: timerState.duration_ms,
      player_id: timerState.player_id,
    });

    // ── 100 ms polling interval ───────────────────────────────────────────────
    activeTimerInterval.current = setInterval(() => {
      const currentTimerState = gameStateRef.current?.auto_pass_timer;

      // Timer deactivated → stop
      if (!currentTimerState || !currentTimerState.active) {
        if (activeTimerInterval.current) {
          networkLogger.debug('⏰ [Timer] Timer deactivated, stopping interval');
          clearInterval(activeTimerInterval.current);
          activeTimerInterval.current = null;
          currentTimerId.current = null;
        }
        return;
      }

      // Calculate remaining milliseconds
      let remaining: number;
      const endTimestamp = (currentTimerState as AutoPassTimerState & { end_timestamp?: number }).end_timestamp;

      if (typeof endTimestamp === 'number') {
        const correctedNow = getCorrectedNow();
        remaining = Math.max(0, endTimestamp - correctedNow);
        // Only log at whole-second transitions to avoid 300+ lines of 100ms spam
        if (remaining > 0 && Math.floor(remaining / 1000) !== Math.floor((remaining + 100) / 1000)) {
          networkLogger.debug(`⏰ [Timer] ${Math.ceil(remaining / 1000)}s remaining`);
        }
      } else {
        const startedAt = new Date(currentTimerState.started_at).getTime();
        const correctedNow = getCorrectedNow();
        const elapsed = correctedNow - startedAt;
        remaining = Math.max(0, currentTimerState.duration_ms - elapsed);
      }

      // ── Timer expired → self-pass when it's our turn ─────────────────────
      if (remaining <= 0) {
        // Throttle: only attempt self-pass every 500ms to avoid DB spam.
        // The execution guard also prevents concurrent inflight calls.
        const now = Date.now();
        if (now - lastSelfPassAttemptRef.current < 500) return;
        lastSelfPassAttemptRef.current = now;

        if (!hasExpiredRef.current) {
          hasExpiredRef.current = true;
          networkLogger.info('⏰ [Timer] EXPIRED! Will auto-pass self when it\'s our turn');
        }

        void tryAutoPassSelf(
          room,
          roomPlayers,
          currentUserId ?? null,
          broadcastMessage,
          autoPassExecutionGuard,
          setIsAutoPassInProgressState,
        );
      }
    }, 100);

    // Cleanup on unmount / deps change
    return () => {
      if (activeTimerInterval.current) {
        networkLogger.debug('⏰ [DEBUG] Cleaning up timer polling interval on unmount');
        clearInterval(activeTimerInterval.current);
        activeTimerInterval.current = null;
        currentTimerId.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gameState?.auto_pass_timer, getCorrectedNow, and room?.code intentionally excluded: these are read inside the interval callback via ref-based patterns; including them would destroy/recreate the interval on every game state broadcast
  }, [
    gameState?.auto_pass_timer?.active,
    gameState?.auto_pass_timer?.started_at,
    gameState?.game_phase,
    room?.id,
    roomPlayers,
    broadcastMessage,
  ]);

  return { isAutoPassInProgress: isAutoPassInProgressState };
}

// ───────────────────────────────────────────────────────────────────────────────
// tryAutoPassSelf — Each client only auto-passes the LOCAL user.
//
// When the auto-pass timer expires, every client keeps polling.  On each tick
// this function checks (via a fresh DB read) whether it's the local user's
// turn.  If so, it calls `player-pass` with the local user's JWT — which is
// guaranteed to pass the identity check.  The turn then advances, and the
// NEXT client's timer tick picks it up.
//
// This eliminates the 403 Forbidden errors that occurred when one client
// tried to invoke player-pass for OTHER human users' player_ids.
// ───────────────────────────────────────────────────────────────────────────────

async function tryAutoPassSelf(
  room: { id: string; code: string } | null,
  roomPlayers: Player[],
  currentUserId: string | null,
  broadcastMessage: (event: BroadcastEvent, data: BroadcastData) => Promise<void>,
  autoPassExecutionGuard: React.MutableRefObject<number | null>,
  setIsAutoPassInProgress: (value: boolean) => void,
): Promise<void> {
  if (!room || !currentUserId) return;

  const now = Date.now();
  const lockTimeout = 10_000; // 10 s max lock duration (single pass is fast)
  const currentLock = autoPassExecutionGuard.current;

  // Skip if already executing (non-stale lock)
  if (currentLock && now - currentLock < lockTimeout) return;

  // Override stale lock
  if (currentLock) {
    networkLogger.warn('⏰ [Timer] Stale self-pass lock detected, overriding');
  }

  // Acquire lock
  autoPassExecutionGuard.current = now;
  setIsAutoPassInProgress(true);

  try {
    // ── Fetch fresh game state ────────────────────────────────────────────
    const { data: gs, error: stateErr } = await supabase
      .from('game_state')
      .select('current_turn, passes, last_play, auto_pass_timer, game_phase')
      .eq('room_id', room.id)
      .single();

    if (stateErr || !gs) {
      networkLogger.error('⏰ [Timer] Self-pass: failed to fetch game state:', stateErr);
      return;
    }

    // ── Early exits ───────────────────────────────────────────────────────
    // Game ended
    if (gs.game_phase === 'finished' || gs.game_phase === 'game_over') return;
    // Timer cleared server-side (trick completed or manual cancel)
    if (!gs.auto_pass_timer || !(gs.auto_pass_timer as { active?: boolean }).active) return;
    // Trick already cleared (no last play and 0 passes = fresh round)
    if (!gs.last_play && (!gs.passes || gs.passes === 0)) return;
    // All passes already done
    if ((gs.passes || 0) >= 3) return;

    // ── Find the local player ─────────────────────────────────────────────
    const myPlayer = roomPlayers.find(p => p.user_id === currentUserId);
    if (!myPlayer) return;

    // ── Exempt check (the player who played the highest card) ─────────────
    const timerData = gs.auto_pass_timer as {
      triggering_play?: { position?: number };
      player_index?: number;
    } | null;
    const exemptIdx = timerData?.triggering_play?.position ?? timerData?.player_index;
    if (myPlayer.player_index === exemptIdx) return; // I'm exempt — nothing to do

    // ── Turn check ────────────────────────────────────────────────────────
    if (gs.current_turn !== myPlayer.player_index) return; // Not my turn yet

    // ── It's my turn → auto-pass myself ───────────────────────────────────
    networkLogger.info(
      `⏰ [Timer] Auto-passing self (player ${myPlayer.player_index}, ${myPlayer.username})`,
    );

    const { data: passResult, error: passError } = await invokeWithRetry<PlayerPassResponse>(
      'player-pass',
      { body: { room_code: room.code, player_id: myPlayer.user_id } },
    );

    if (passError || !passResult?.success) {
      const errMsg = passResult?.error || passError?.message || 'Unknown';
      networkLogger.error(`⏰ [Timer] ❌ Self-pass failed: ${errMsg}`);
      return;
    }

    networkLogger.info(
      `⏰ [Timer] ✅ Self-pass successful. next_turn=${passResult.next_turn}, ` +
      `passes=${passResult.passes}, trick_cleared=${passResult.trick_cleared}`,
    );

    // Broadcast (non-blocking)
    void broadcastMessage('auto_pass_executed', { player_index: myPlayer.player_index })
      .catch(() => { /* swallow — broadcast is best-effort */ });
  } catch (fatalError) {
    networkLogger.error('⏰ [Timer] ❌ Self-pass fatal error:', fatalError);
  } finally {
    autoPassExecutionGuard.current = null;
    setIsAutoPassInProgress(false);
  }
}
