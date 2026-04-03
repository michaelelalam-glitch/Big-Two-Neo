/**
 * @module useServerBotCoordinator
 * Server-side bot coordinator hook — thin client-side fallback.
 *
 * The PRIMARY bot trigger is server-side: play-cards, player-pass, and start_new_match
 * Edge Functions detect when the next turn is a bot and invoke the bot-coordinator
 * Edge Function directly.
 *
 * This hook exists as a FALLBACK safety net for edge cases where the server-side
 * trigger might fail (network issues, Edge Function cold starts, etc.).
 * It detects when it's a bot's turn and triggers the server-side bot-coordinator
 * if no action has been taken within a grace period.
 *
 * Replaces the 569-line client-side useBotCoordinator hook that had 16+ critical
 * race condition patches. All bot AI logic now runs server-side.
 *
 * @see apps/mobile/supabase/functions/bot-coordinator/index.ts
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { gameLogger } from '../utils/logger';
import type { GameState } from '../types/multiplayer';

interface UseServerBotCoordinatorProps {
  /** Room code string (not UUID) */
  roomCode: string;
  /** Whether the hook should be active */
  enabled: boolean;
  /** Current game state from Realtime subscription */
  gameState: GameState | null;
  /** Room players array with is_bot flag */
  players: { player_index: number; is_bot?: boolean | null; [key: string]: unknown }[];
  /**
   * True while the auto-pass self-pass is in progress (from useAutoPassTimer).
   * When true, bot-coordinator must NOT fire — it would race with the client's
   * own auto-pass action and can cause "Not your turn" errors.
   */
  isAutoPassInProgress?: boolean;
}

/**
 * Grace period (ms) before triggering a fallback bot-coordinator call.
 * The server-side trigger (EdgeRuntime.waitUntil) should fire within ~100ms,
 * but cold starts can push that to ~800ms. 600ms catches a failed primary
 * trigger quickly without racing a slow-but-working one.
 */
const FALLBACK_GRACE_PERIOD_MS = 600;

/**
 * Cooldown (ms) between fallback trigger attempts to prevent spam.
 */
const TRIGGER_COOLDOWN_MS = 5000;

export function useServerBotCoordinator({
  roomCode,
  enabled,
  gameState,
  players,
  isAutoPassInProgress = false,
}: UseServerBotCoordinatorProps): void {
  const lastTriggerTimeRef = useRef<number>(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track per-turn trigger attempts: allow re-triggering after cooldown if the turn is still stuck
  const triggeredForTurnRef = useRef<{ turn: number; lastAttemptAt: number } | null>(null);
  // Store players in a ref so the effect does not re-run (and cancel the timer) on every
  // Realtime update that produces a new players array reference without changing the turn.
  const playersRef = useRef(players);
  // Track whether the current-turn player is a bot (used to detect replacement events).
  // Initialised as `null` (unknown) so the first observation just records the value
  // instead of triggering a false "replaced by bot" event on game start when the
  // starting player happens to be a bot.
  const currentTurnIsBotRef = useRef<boolean | null>(null);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  const triggerBotCoordinator = useCallback(async () => {
    const now = Date.now();
    if (now - lastTriggerTimeRef.current < TRIGGER_COOLDOWN_MS) {
      return; // Cooldown active
    }

    lastTriggerTimeRef.current = now;
    gameLogger.info(`[ServerBotCoordinator] 🤖 Fallback trigger for room ${roomCode}`);

    try {
      const { data, error } = await supabase.functions.invoke('bot-coordinator', {
        body: { room_code: roomCode },
      });

      if (error) {
        gameLogger.error('[ServerBotCoordinator] ❌ Fallback trigger failed:', error.message);
      } else {
        gameLogger.info(
          `[ServerBotCoordinator] ✅ Fallback trigger result: moves=${data?.moves_executed ?? '?'} skipped=${data?.skipped ?? false} err=${data?.error ?? 'none'} exit=${data?.exit_reason ?? 'none'}`
        );
      }
    } catch (err) {
      gameLogger.error(
        '[ServerBotCoordinator] ❌ Fallback trigger error:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }, [roomCode]);

  useEffect(() => {
    // Only clear the timer when we are definitively stopping (disabled, no context,
    // non-bot turn, or end-of-game phase). Do NOT clear unconditionally at the top —
    // re-renders during a cooldown window would cancel the scheduled retry with nothing
    // replacing it, leaving the game stuck on a bot turn.

    if (!enabled || !gameState || !roomCode) {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      return;
    }

    // Don't schedule bot-coordinator while the auto-pass self-pass is in progress.
    // Auto-pass now issues a self-pass (player-pass for the local player) and the server
    // cascades additional passes; if bot-coordinator fires simultaneously it can race with
    // those actions and cause "Not your turn" errors.
    if (isAutoPassInProgress) {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      return;
    }

    const currentTurn = gameState.current_turn;
    const phase = gameState.game_phase;

    // Don't trigger bot-coordinator for finished/game_over phases.
    // 'finished' is a transient state while start_new_match is being called;
    // 'game_over' means the entire game has ended.
    // Recovery from a stuck 'finished' phase is the responsibility of useMatchTransition,
    // which calls start_new_match after MATCH_TRANSITION_GRACE_MS (5s) as a safety net.
    if (phase === 'finished' || phase === 'game_over') {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      return;
    }

    // Find the current player — read from ref so this effect is not re-run (and the
    // cooldown timer not cancelled) when an unrelated Realtime update produces a new
    // players array reference without changing current_turn or game_phase.
    const currentPlayer = playersRef.current.find(p => p.player_index === currentTurn);
    if (!currentPlayer?.is_bot) {
      // Human turn — cancel any lingering bot-turn timer
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      return;
    }

    // Allow re-triggering the same turn after the cooldown expires.
    // If the first fallback attempt failed (or the server didn't respond),
    // we want to retry rather than leaving the game stuck on a bot turn.
    const nowForCheck = Date.now();
    const prevTrigger = triggeredForTurnRef.current;
    if (
      prevTrigger !== null &&
      prevTrigger.turn === currentTurn &&
      nowForCheck - prevTrigger.lastAttemptAt < TRIGGER_COOLDOWN_MS
    ) {
      // Cooldown still active — leave the existing retry timer running; do NOT cancel it.
      return;
    }

    // A new bot turn (or cooldown expired): cancel any stale timer before scheduling.
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    // Self-rescheduling retry: fires after grace period, then retries every
    // TRIGGER_COOLDOWN_MS while the turn is still stuck on this bot.
    // A `cancelled` flag is set in the cleanup function and checked both before
    // re-scheduling and before invoking, so timers stop reliably on unmount
    // and when `enabled` becomes false or the turn advances.
    let cancelled = false;

    const scheduleAttempt = (delayMs: number): void => {
      fallbackTimerRef.current = setTimeout(async () => {
        if (cancelled) return;
        triggeredForTurnRef.current = { turn: currentTurn, lastAttemptAt: Date.now() };
        await triggerBotCoordinator();
        // Only re-schedule if unmount/disable hasn't been signalled
        if (!cancelled) {
          scheduleAttempt(TRIGGER_COOLDOWN_MS);
        }
      }, delayMs);
    };

    scheduleAttempt(FALLBACK_GRACE_PERIOD_MS);

    return () => {
      cancelled = true;
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- players intentionally excluded; stored in playersRef so timer is not cancelled on every Realtime update that recreates the array
  }, [
    enabled,
    gameState?.current_turn,
    gameState?.game_phase,
    roomCode,
    triggerBotCoordinator,
    isAutoPassInProgress,
  ]);

  // Reset triggered turn when the turn actually advances to a human player
  useEffect(() => {
    if (gameState?.current_turn !== undefined) {
      const currentPlayer = playersRef.current.find(p => p.player_index === gameState.current_turn);
      if (!currentPlayer?.is_bot) {
        triggeredForTurnRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- players excluded (use ref); only re-run when current_turn changes
  }, [gameState?.current_turn]);

  // ── Bot-replacement detection ────────────────────────────────────────────────
  // When process_disconnected_players converts a human to a bot, a room_players
  // UPDATE event fires and `players` is updated — but current_turn does NOT change,
  // so the main effect never re-evaluates currentPlayer?.is_bot.  This effect watches
  // for the "was human, now bot" transition on the current-turn slot and immediately
  // triggers the bot coordinator fallback so the game doesn't stall.
  //
  // STABILISED DEP: Derive a string key of "playerIndex:is_bot" pairs so the effect
  // only re-runs when the is_bot status actually changes, NOT on every Realtime
  // heartbeat or unrelated player update that produces a new array reference.
  const playerBotKey = React.useMemo(
    () =>
      players
        .map(p => `${p.player_index}:${!!p.is_bot}`)
        .sort()
        .join(','),
    [players]
  );

  useEffect(() => {
    if (!enabled || !gameState || !roomCode) return;
    // Don't fire replacement-detection trigger while auto-pass is running —
    // same race-condition concern as the main effect.
    if (isAutoPassInProgress) return;
    const { current_turn: currentTurn, game_phase: phase } = gameState;
    if (phase === 'finished' || phase === 'game_over') return;

    const currentPlayer = playersRef.current.find(p => p.player_index === currentTurn);
    const isNowBot = !!currentPlayer?.is_bot;

    if (isNowBot && currentTurnIsBotRef.current === false) {
      // Transition: human → bot on the current-turn slot (replacement happened)
      // NOTE: currentTurnIsBotRef is `null` on first render (unknown state),
      // so this only fires on an actual change from `false` (human) to `true` (bot).
      gameLogger.info(
        `[ServerBotCoordinator] 🔄 Player at turn ${currentTurn} replaced by bot — scheduling immediate fallback trigger`
      );
      // Reset any prior "triggered for this turn" record so the main effect fires fresh
      triggeredForTurnRef.current = null;
      // Fire the coordinator after the replacement Realtime update has propagated
      const t = setTimeout(() => {
        triggerBotCoordinator();
      }, FALLBACK_GRACE_PERIOD_MS);
      currentTurnIsBotRef.current = true;
      return () => clearTimeout(t);
    }

    currentTurnIsBotRef.current = isNowBot;
    // playerBotKey is a stable string that only changes when is_bot values change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    playerBotKey,
    gameState?.current_turn,
    gameState?.game_phase,
    enabled,
    roomCode,
    triggerBotCoordinator,
    isAutoPassInProgress,
  ]);
}
