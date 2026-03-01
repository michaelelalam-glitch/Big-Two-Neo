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
import { useEffect, useRef, useCallback } from 'react';
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
  players: Array<{ player_index: number; is_bot?: boolean; [key: string]: any }>;
}

/**
 * Grace period (ms) before triggering a fallback bot-coordinator call.
 * The server-side trigger should fire within ~100ms of the move completing.
 * If after this period the turn hasn't advanced, we trigger the fallback.
 */
const FALLBACK_GRACE_PERIOD_MS = 3000;

/**
 * Cooldown (ms) between fallback trigger attempts to prevent spam.
 */
const TRIGGER_COOLDOWN_MS = 5000;

export function useServerBotCoordinator({
  roomCode,
  enabled,
  gameState,
  players,
}: UseServerBotCoordinatorProps): void {
  const lastTriggerTimeRef = useRef<number>(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track per-turn trigger attempts: allow re-triggering after cooldown if the turn is still stuck
  const triggeredForTurnRef = useRef<{ turn: number; lastAttemptAt: number } | null>(null);
  // Store players in a ref so the effect does not re-run (and cancel the timer) on every
  // Realtime update that produces a new players array reference without changing the turn.
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);

  const triggerBotCoordinator = useCallback(async () => {
    const now = Date.now();
    if (now - lastTriggerTimeRef.current < TRIGGER_COOLDOWN_MS) {
      return; // Cooldown active
    }

    lastTriggerTimeRef.current = now;
    gameLogger.info(`[ServerBotCoordinator] 🤖 Fallback trigger for room ${roomCode}`);

    try {
      const { error } = await supabase.functions.invoke('bot-coordinator', {
        body: { room_code: roomCode },
      });

      if (error) {
        gameLogger.error('[ServerBotCoordinator] ❌ Fallback trigger failed:', error.message);
      } else {
        gameLogger.info('[ServerBotCoordinator] ✅ Fallback trigger succeeded');
      }
    } catch (err) {
      gameLogger.error('[ServerBotCoordinator] ❌ Fallback trigger error:', err instanceof Error ? err.message : String(err));
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

    const currentTurn = gameState.current_turn;
    const phase = gameState.game_phase;

    // Don't trigger for finished/game_over phases
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
  }, [enabled, gameState?.current_turn, gameState?.game_phase, roomCode, triggerBotCoordinator]);

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
}
