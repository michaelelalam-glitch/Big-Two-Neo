/**
 * useTurnInactivityTimer — Client-side turn countdown hook for 60s turn timeout.
 *
 * Architecture:
 * - Monitors game_state.turn_started_at when it's the local player's turn
 * - Shows yellow InactivityCountdownRing (60s countdown)
 * - When timer expires: calls auto-play-turn edge function
 * - Edge function auto-plays highest valid cards OR passes
 * - Returns auto-played cards to show "I'm Still Here?" popup
 *
 * CRITICAL: Coexists with connection inactivity (charcoal-grey disconnect ring).
 * - Yellow ring = turn inactivity (60s to play)
 * - Charcoal-grey ring = connection inactivity (heartbeat stopped)
 * - If disconnect happens during turn, charcoal-grey disconnect ring replaces yellow and continues countdown
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { GameState, Player, BroadcastEvent, BroadcastData, Card } from '../types/multiplayer';
import { invokeWithRetry } from '../utils/edgeFunctionRetry';
import { networkLogger } from '../utils/logger';

export interface UseTurnInactivityTimerOptions {
  /** Current game state (turn_started_at, current_turn) */
  gameState: GameState | null;
  /** Room object — needed for room code */
  room: { id: string; code: string } | null;
  /** Current list of room players */
  roomPlayers: Player[];
  /** Broadcast a message to all connected clients (optional — auto-play is server-authoritative) */
  broadcastMessage?: (event: BroadcastEvent, data: BroadcastData) => Promise<void>;
  /** Clock-sync corrected timestamp (ms) */
  getCorrectedNow: () => number;
  /** Current authenticated user id */
  currentUserId?: string | null;
  /** Callback when auto-play happens (show "I'm Still Here?" modal) */
  onAutoPlay?: (cards: Card[] | null, action: 'play' | 'pass') => void;
}

export interface TurnInactivityTimer {
  /** Whether it's the local player's turn */
  isMyTurn: boolean;
  /** Remaining milliseconds in turn (60000 to 0) */
  remainingMs: number;
  /** Whether auto-play is currently in progress */
  isAutoPlayInProgress: boolean;
}

const TURN_TIMEOUT_MS = 60_000; // 60 seconds
// 500ms polling: sufficient to detect expiry within half a second while keeping
// re-renders to ~2/sec instead of ~10/sec during the local player's turn.
const POLLING_INTERVAL_MS = 500;

export function useTurnInactivityTimer({
  gameState,
  room,
  roomPlayers,
  broadcastMessage,
  getCorrectedNow,
  currentUserId,
  onAutoPlay,
}: UseTurnInactivityTimerOptions): TurnInactivityTimer {
  // ── Refs (all state the interval callback needs) ────────────────────────
  const gameStateRef = useRef<GameState | null>(null);
  const roomRef = useRef<{ id: string; code: string } | null>(null);
  const roomPlayersRef = useRef<Player[]>([]);
  const currentUserIdRef = useRef<string | null>(null);
  const broadcastMessageRef = useRef<NonNullable<typeof broadcastMessage> | undefined>(
    broadcastMessage
  );
  const getCorrectedNowRef = useRef<typeof getCorrectedNow>(getCorrectedNow);
  const onAutoPlayRef = useRef<typeof onAutoPlay>(onAutoPlay);

  /** Execution guard to prevent concurrent auto-play calls */
  const autoPlayExecutionGuard = useRef<number | null>(null);
  /** Tracks whether auto-play is in progress — read inside the stable interval
   *  via setTimerState to expose isAutoPlayInProgress to consumers. A ref is used
   *  instead of useState so the interval (deps: [room?.id, currentUserId]) is not
   *  recreated on every auto-play start/finish, which would reset activeTurnSequenceRef. */
  const isAutoPlayInProgressRef = useRef(false);

  /** Track which turn sequence we're monitoring to detect turn changes */
  const activeTurnSequenceRef = useRef<string | null>(null);
  const hasExpiredRef = useRef(false);
  const lastAutoPlayAttemptRef = useRef<number>(0);

  /**
   * Client-local start time for the current turn.
   * Used INSTEAD of the server's turn_started_at when clock skew is detected.
   * This ensures the 60s countdown is always relative to when the client
   * first observed the turn, avoiding issues where server clock is ahead.
   */
  const localTurnStartRef = useRef<number | null>(null);

  /** Reactive state for UI */
  const [timerState, setTimerState] = useState<TurnInactivityTimer>({
    isMyTurn: false,
    remainingMs: TURN_TIMEOUT_MS,
    isAutoPlayInProgress: false,
  });

  // ── Keep refs in sync with props ────────────────────────────────────────
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  useEffect(() => {
    roomPlayersRef.current = roomPlayers;
  }, [roomPlayers]);
  useEffect(() => {
    currentUserIdRef.current = currentUserId ?? null;
  }, [currentUserId]);
  useEffect(() => {
    broadcastMessageRef.current = broadcastMessage;
  }, [broadcastMessage]);
  useEffect(() => {
    getCorrectedNowRef.current = getCorrectedNow;
  }, [getCorrectedNow]);
  useEffect(() => {
    onAutoPlayRef.current = onAutoPlay;
  }, [onAutoPlay]);

  // ── Stable auto-play function ───────────────────────────────────────────
  const tryAutoPlayTurn = useCallback(async () => {
    const currentRoom = roomRef.current;
    const userId = currentUserIdRef.current;
    if (!currentRoom || !userId) return;

    const now = Date.now();
    const lockTimeout = 10_000;
    const currentLock = autoPlayExecutionGuard.current;

    // Skip if already executing
    if (currentLock && now - currentLock < lockTimeout) return;
    if (currentLock) {
      networkLogger.warn('⏰ [TurnTimer] Stale auto-play lock detected, overriding');
    }

    autoPlayExecutionGuard.current = now;
    isAutoPlayInProgressRef.current = true;

    try {
      networkLogger.info('⏰ [TurnTimer] Calling auto-play-turn edge function');

      const { data: result, error } = await invokeWithRetry<{
        success: boolean;
        action: 'play' | 'pass';
        cards?: Card[];
        replaced_by_bot?: boolean;
        error?: string;
      }>('auto-play-turn', {
        body: { room_code: currentRoom.code },
      });

      if (error || !result?.success) {
        const errMsg = result?.error || error?.message || 'Unknown';
        networkLogger.error(`⏰ [TurnTimer] ❌ Auto-play failed: ${errMsg}`);
        return;
      }

      networkLogger.info(
        `⏰ [TurnTimer] ✅ Auto-play successful: ${result.action}`,
        result.cards ? `(${result.cards.length} cards)` : '',
        result.replaced_by_bot ? '(replaced by bot)' : ''
      );

      // The server always replaces the inactive player with a bot (65s spec).
      // The Realtime subscription will surface the RejoinModal automatically.
      // Call onAutoPlay for logging/observability.
      if (onAutoPlayRef.current) {
        onAutoPlayRef.current(result.cards || null, result.action);
      }

      // Broadcast (best-effort, optional)
      const players = roomPlayersRef.current;
      const myPlayer = players.find(p => p.user_id === userId);
      if (myPlayer && broadcastMessageRef.current) {
        void broadcastMessageRef
          .current('turn_auto_played', {
            player_index: myPlayer.player_index,
          })
          .catch(() => {});
      }
    } catch (fatalError) {
      networkLogger.error('⏰ [TurnTimer] ❌ Auto-play fatal error:', fatalError);
    } finally {
      autoPlayExecutionGuard.current = null;
      isAutoPlayInProgressRef.current = false;
    }
  }, []);

  // ── Stable polling interval ─────────────────────────────────────────────
  useEffect(() => {
    if (!room?.id || !currentUserId) return;

    networkLogger.debug('⏰ [TurnTimer] Creating stable turn polling interval');

    const interval = setInterval(() => {
      const gs = gameStateRef.current;
      const players = roomPlayersRef.current;
      const userId = currentUserIdRef.current;

      if (!gs || !players || !userId) {
        setTimerState(prev =>
          !prev.isMyTurn && prev.remainingMs === TURN_TIMEOUT_MS && !prev.isAutoPlayInProgress
            ? prev
            : { isMyTurn: false, remainingMs: TURN_TIMEOUT_MS, isAutoPlayInProgress: false }
        );
        return;
      }

      // Game not in active phase → no timer
      if (gs.game_phase !== 'playing' && gs.game_phase !== 'first_play') {
        setTimerState(prev =>
          !prev.isMyTurn && prev.remainingMs === TURN_TIMEOUT_MS && !prev.isAutoPlayInProgress
            ? prev
            : { isMyTurn: false, remainingMs: TURN_TIMEOUT_MS, isAutoPlayInProgress: false }
        );
        return;
      }

      // Find local player
      const myPlayer = players.find(p => p.user_id === userId);
      if (!myPlayer) {
        setTimerState(prev =>
          !prev.isMyTurn && prev.remainingMs === TURN_TIMEOUT_MS && !prev.isAutoPlayInProgress
            ? prev
            : { isMyTurn: false, remainingMs: TURN_TIMEOUT_MS, isAutoPlayInProgress: false }
        );
        return;
      }

      // Check if it's my turn
      const isMyTurn = gs.current_turn === myPlayer.player_index;
      if (!isMyTurn) {
        // Reset tracking when turn changes away
        if (activeTurnSequenceRef.current) {
          activeTurnSequenceRef.current = null;
          hasExpiredRef.current = false;
          lastAutoPlayAttemptRef.current = 0;
        }
        setTimerState(prev =>
          !prev.isMyTurn && prev.remainingMs === TURN_TIMEOUT_MS && !prev.isAutoPlayInProgress
            ? prev
            : { isMyTurn: false, remainingMs: TURN_TIMEOUT_MS, isAutoPlayInProgress: false }
        );
        return;
      }

      // It's my turn — check turn_started_at
      const turnStartedAt = gs.turn_started_at;
      if (!turnStartedAt) {
        setTimerState(prev =>
          prev.isMyTurn &&
          prev.remainingMs === TURN_TIMEOUT_MS &&
          prev.isAutoPlayInProgress === isAutoPlayInProgressRef.current
            ? prev
            : {
                isMyTurn: true,
                remainingMs: TURN_TIMEOUT_MS,
                isAutoPlayInProgress: isAutoPlayInProgressRef.current,
              }
        );
        return;
      }

      // Detect new turn (different turn_started_at → reset expiry tracking)
      const seqId = turnStartedAt;
      if (activeTurnSequenceRef.current !== seqId) {
        activeTurnSequenceRef.current = seqId;
        hasExpiredRef.current = false;
        lastAutoPlayAttemptRef.current = 0;

        // CLOCK SKEW FIX: If server timestamp is in the future relative to client,
        // use client-local time as the start instead. This prevents the timer from
        // accumulating extra seconds when the server clock is ahead of the client.
        const serverStart = new Date(turnStartedAt).getTime();
        const clientNow = Date.now();
        const serverElapsed = clientNow - serverStart;
        if (serverElapsed < -2000) {
          // Server clock is >2s ahead — use client time as start
          networkLogger.warn(
            `⏰ [TurnTimer] Clock skew detected: server is ${Math.abs(serverElapsed)}ms ahead. Using client-local start time.`
          );
          localTurnStartRef.current = clientNow;
        } else {
          localTurnStartRef.current = null; // Use server timestamp normally
        }
        networkLogger.debug('⏰ [TurnTimer] Tracking new turn sequence:', seqId);
      }

      // Calculate remaining time — use local start if clock skew was detected
      const startTime = localTurnStartRef.current ?? new Date(turnStartedAt).getTime();
      const correctedNow = getCorrectedNowRef.current();
      const elapsed = correctedNow - startTime;
      const remaining = Math.max(0, TURN_TIMEOUT_MS - elapsed);

      // Update UI state ONLY when boolean flags change — NOT on every 500ms tick.
      // `remainingMs` is intentionally excluded from this comparison: InactivityCountdownRing
      // drives its own Reanimated animation from game_state.turn_started_at and does NOT
      // consume remainingMs from this hook.  Updating on every tick caused ~2 re-renders/sec
      // in MultiplayerGame even when nothing visible changed (perf/task-628).
      setTimerState(prev => {
        if (
          prev.isMyTurn !== true ||
          prev.isAutoPlayInProgress !== isAutoPlayInProgressRef.current
        ) {
          return {
            isMyTurn: true,
            remainingMs: remaining,
            isAutoPlayInProgress: isAutoPlayInProgressRef.current,
          };
        }
        return prev;
      });

      // Timer expired → trigger auto-play
      if (remaining <= 0) {
        const now = Date.now();
        if (now - lastAutoPlayAttemptRef.current < 1000) return; // Throttle to 1s
        lastAutoPlayAttemptRef.current = now;

        if (!hasExpiredRef.current) {
          hasExpiredRef.current = true;
          networkLogger.info('⏰ [TurnTimer] EXPIRED — triggering auto-play');
        }

        void tryAutoPlayTurn();
      }
    }, POLLING_INTERVAL_MS);

    return () => {
      networkLogger.debug('⏰ [TurnTimer] Cleaning up turn polling interval');
      clearInterval(interval);
      activeTurnSequenceRef.current = null;
    };
  }, [room?.id, currentUserId, tryAutoPlayTurn]);

  return timerState;
}
