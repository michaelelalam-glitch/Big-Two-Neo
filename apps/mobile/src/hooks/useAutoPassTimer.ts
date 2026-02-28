/**
 * useAutoPassTimer — Server-authoritative auto-pass timer hook.
 *
 * Extracted from useRealtime.ts (~395 lines) to isolate the most complex
 * piece of timer logic into a self-contained, independently testable module.
 *
 * Architecture (Dec 29 2025 – CRITICAL FIX v2):
 * - Timer state lives in `game_state.auto_pass_timer` (database)
 * - Contains `started_at` timestamp and `duration_ms`
 * - ALL clients calculate remaining_ms independently from the SAME server timestamp
 * - ALL clients execute auto-pass for redundancy (backend validates turns)
 *
 * When the timer expires, every non-exempt player is auto-passed in sequence.
 * The exempt player is the one who played the highest card (stored in
 * `auto_pass_timer.triggering_play.position`).
 */

import { useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import type { GameState, Player, AutoPassTimerState, BroadcastEvent } from '../types/multiplayer';
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
  broadcastMessage: (event: BroadcastEvent, data: unknown) => Promise<void>;
  /** Clock-sync corrected timestamp (ms). */
  getCorrectedNow: () => number;
}

/**
 * Manages the auto-pass timer lifecycle:
 * 1. Watches `gameState.auto_pass_timer` for active timers.
 * 2. Polls every 100 ms using a `setInterval` with a ref-based pattern to
 *    avoid stale closures.
 * 3. When the timer expires, fetches fresh state from DB and sequentially
 *    invokes `player-pass` for every non-exempt player.
 */
export function useAutoPassTimer({
  gameState,
  room,
  roomPlayers,
  broadcastMessage,
  getCorrectedNow,
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
   * Mutable ref kept in sync with the latest `gameState` so that
   * `setInterval` callbacks never read stale closure values.
   */
  const gameStateRef = useRef<GameState | null>(null);

  // Keep ref in sync with prop
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // ── Main timer effect ───────────────────────────────────────────────────────
  useEffect(() => {
    const timerState = gameState?.auto_pass_timer;

    networkLogger.info('⏰ [DEBUG] Timer useEffect triggered', {
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
        networkLogger.info('⏰ [DEBUG] Clearing timer interval');
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
      networkLogger.info('⏰ [DEBUG] Timer already running for sequence_id', newTimerId);
      return;
    }

    // Clear old interval if switching to a new timer
    cleanup();
    currentTimerId.current = newTimerId;

    networkLogger.info('⏰ [DEBUG] Starting NEW timer polling interval', {
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
          networkLogger.info('⏰ [Timer] Timer deactivated, stopping interval');
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
        networkLogger.info(`⏰ [Timer] Server-auth check: ${remaining}ms remaining (corrected time)`);
      } else {
        const startedAt = new Date(currentTimerState.started_at).getTime();
        const correctedNow = getCorrectedNow();
        const elapsed = correctedNow - startedAt;
        remaining = Math.max(0, currentTimerState.duration_ms - elapsed);
        networkLogger.info(`⏰ [Timer] Fallback check: ${remaining}ms remaining`);
      }

      // ── Timer expired → execute auto-passes ──────────────────────────────
      if (remaining <= 0) {
        if (activeTimerInterval.current) {
          clearInterval(activeTimerInterval.current);
          activeTimerInterval.current = null;
          currentTimerId.current = null;
        }

        const exemptPlayerId = currentTimerState.player_id;
        networkLogger.info(`⏰ [Timer] EXPIRED! Auto-passing all players except player_id: ${exemptPlayerId}`);

        void executeAutoPasses(
          room,
          roomPlayers,
          broadcastMessage,
          autoPassExecutionGuard,
        );
      }
    }, 100);

    // Cleanup on unmount / deps change
    return () => {
      if (activeTimerInterval.current) {
        networkLogger.info('⏰ [DEBUG] Cleaning up timer polling interval on unmount');
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

  return { isAutoPassInProgress: autoPassExecutionGuard.current !== null };
}

// ───────────────────────────────────────────────────────────────────────────────
// Private helper — extracted from the inline IIFE for readability
// ───────────────────────────────────────────────────────────────────────────────

async function executeAutoPasses(
  room: { id: string; code: string } | null,
  roomPlayers: Player[],
  broadcastMessage: (event: BroadcastEvent, data: unknown) => Promise<void>,
  autoPassExecutionGuard: React.MutableRefObject<number | null>,
): Promise<void> {
  const now = Date.now();
  const lockTimeout = 30000; // 30 s max lock duration
  const currentLock = autoPassExecutionGuard.current;

  // Check if lock is held and not stale
  if (currentLock && now - currentLock < lockTimeout) {
    networkLogger.warn(`⏰ [Timer] ⚠️ Auto-pass already in progress (lock age: ${now - currentLock}ms), skipping`);
    return;
  }

  if (currentLock && now - currentLock >= lockTimeout) {
    networkLogger.warn(
      `⏰ [Timer] ⚠️ Stale lock detected (age: ${now - currentLock}ms > ${lockTimeout}ms), overriding. ` +
      `Previous execution may have taken longer than expected or crashed.`,
    );
  }

  // Acquire lock
  autoPassExecutionGuard.current = now;

  try {
    // STEP 1: Query FRESH game state
    const { data: currentGameState, error: stateError } = await supabase
      .from('game_state')
      .select('current_turn, passes, last_play, auto_pass_timer')
      .eq('room_id', room?.id)
      .single();

    if (stateError || !currentGameState) {
      networkLogger.error('⏰ [Timer] Failed to fetch game state:', stateError);
      return;
    }

    // Trick already completed
    if (currentGameState.last_play === null && currentGameState.passes === 0) {
      networkLogger.info('⏰ [Timer] ✅ Trick already completed, no auto-pass needed');
      return;
    }

    // Timer no longer active
    if (!currentGameState.auto_pass_timer || !currentGameState.auto_pass_timer.active) {
      networkLogger.info('⏰ [Timer] Timer manually cleared, no auto-pass needed');
      return;
    }

    const currentPassCount = currentGameState.passes || 0;
    const remainingPasses = 3 - currentPassCount;
    if (remainingPasses <= 0) {
      networkLogger.info(`⏰ [Timer] No passes needed (already ${currentPassCount}/3)`);
      return;
    }

    // Determine exempt player
    const timerData = currentGameState.auto_pass_timer as {
      triggering_play?: { position?: number };
      player_index?: number;
    } | null;
    const exemptPlayerIndex = timerData?.triggering_play?.position ?? timerData?.player_index;
    if (typeof exemptPlayerIndex !== 'number') {
      networkLogger.error('⏰ [Timer] No exempt player index found in timer state:', JSON.stringify(timerData));
      return;
    }

    const totalPlayers = roomPlayers.length;
    networkLogger.info(`⏰ [Timer] Current state: turn=${currentGameState.current_turn}, passes=${currentPassCount}, exempt=${exemptPlayerIndex}`);
    networkLogger.info(`⏰ [Timer] Will auto-pass up to ${totalPlayers - 1} players (all except exempt player ${exemptPlayerIndex})`);

    // STEP 2: Sequential passes
    let passedCount = 0;
    const maxPasses = totalPlayers - 1;
    const startingTurnIndex = currentGameState.current_turn;
    if (typeof startingTurnIndex !== 'number') {
      networkLogger.error('⏰ [Timer] ❌ No current_turn in initial state');
      return;
    }

    let turnOffset = 0;

    for (let attempt = 0; attempt < maxPasses && turnOffset < maxPasses; attempt++) {
      const currentTurnIndex = (startingTurnIndex + turnOffset) % totalPlayers;

      if (currentTurnIndex === exemptPlayerIndex) {
        networkLogger.info(`⏰ [Timer] Current turn is exempt player ${exemptPlayerIndex}, round complete`);
        break;
      }

      const playerToPass = roomPlayers.find(p => p.player_index === currentTurnIndex);
      if (!playerToPass) {
        networkLogger.error(`⏰ [Timer] ❌ No player found at index ${currentTurnIndex}`);
        continue;
      }

      try {
        networkLogger.info(`⏰ [Timer] Auto-passing player ${currentTurnIndex} (${playerToPass.username})... (${passedCount + 1}/${maxPasses})`);

        const { data: passResult, error: passError } = await invokeWithRetry<PlayerPassResponse>('player-pass', {
          body: {
            room_code: room?.code,
            player_id: playerToPass.user_id,
          },
        });

        if (passError || !passResult?.success) {
          const errorMsg = passResult?.error || passError?.message || 'Unknown error';
          throw new Error(errorMsg);
        }

        passedCount++;
        turnOffset++;
        networkLogger.info(`⏰ [Timer] ✅ Successfully auto-passed player ${currentTurnIndex} (${passedCount}/${maxPasses})`);
        networkLogger.info(`⏰ [Timer] Server response: next_turn=${passResult.next_turn}, passes=${passResult.passes}, trick_cleared=${passResult.trick_cleared}`);

        // Broadcast (non-blocking)
        void broadcastMessage('auto_pass_executed', { player_index: currentTurnIndex }).catch(broadcastError => {
          networkLogger.error('[Timer] Broadcast failed:', broadcastError);
        });

        if (passResult.trick_cleared) {
          networkLogger.info('⏰ [Timer] 🎯 Trick cleared after 3 passes, stopping auto-pass');
          break;
        }

        const AUTO_PASS_DELAY_MS = 300;
        const hasRemainingAttempts = attempt + 1 < maxPasses && passedCount < maxPasses;
        if (hasRemainingAttempts) {
          await new Promise(resolve => setTimeout(resolve, AUTO_PASS_DELAY_MS));
        }
      } catch (error) {
        const errorMsg = (error as Error).message || String(error);

        if (errorMsg.includes('Not your turn')) {
          networkLogger.warn(`⏰ [Timer] ⚠️ Player ${currentTurnIndex} - server says not their turn, querying fresh state...`);

          try {
            const { data: freshState } = await supabase
              .from('game_state')
              .select('current_turn, auto_pass_timer')
              .eq('room_id', room?.id)
              .single();

            if (freshState) {
              const expectedTurn = (startingTurnIndex + attempt) % totalPlayers;
              const actualTurn = freshState.current_turn;
              if (expectedTurn !== actualTurn) {
                turnOffset = (actualTurn - startingTurnIndex + totalPlayers) % totalPlayers - attempt;
                networkLogger.info(`⏰ [Timer] Synced with server: actualTurn=${actualTurn}, adjusted turnOffset=${turnOffset}`);
              }

              if (!freshState.auto_pass_timer?.active) {
                networkLogger.info('⏰ [Timer] Timer no longer active on server, stopping execution');
                break;
              }
            }
          } catch (queryError) {
            networkLogger.warn('⏰ [Timer] Failed to query fresh state, aborting auto-pass to avoid desync', queryError);
            break;
          }
          continue;
        }

        networkLogger.error(`⏰ [Timer] ❌ Unexpected error during auto-pass for player ${currentTurnIndex}:`, errorMsg);
        break;
      }
    }

    networkLogger.info(`⏰ [Timer] Auto-pass execution complete: ${passedCount}/${maxPasses} players passed`);

    // Wait for Realtime sync
    networkLogger.info('⏰ [Timer] Waiting 250ms for final Realtime sync...');
    await new Promise(resolve => setTimeout(resolve, 250));

    // Clear timer from DB
    if (passedCount > 0) {
      networkLogger.info('⏰ [Timer] Clearing timer state from database...');
      try {
        await supabase.from('game_state').update({ auto_pass_timer: null }).eq('room_id', room?.id);
        networkLogger.info('⏰ [Timer] ✅ Timer cleared from database');
      } catch (clearError) {
        networkLogger.error('[Timer] Failed to clear timer:', clearError);
      }
    } else {
      networkLogger.info('⏰ [Timer] No passes executed, timer likely already cleared');
    }
  } catch (fatalError) {
    networkLogger.error('⏰ [Timer] ❌ Fatal error in auto-pass execution:', fatalError);
  } finally {
    autoPassExecutionGuard.current = null;
  }
}
