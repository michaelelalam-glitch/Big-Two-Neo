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
  const triggeredForTurnRef = useRef<number | null>(null);

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
    // Clear any existing timer
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    if (!enabled || !gameState || !roomCode) return;

    const currentTurn = gameState.current_turn;
    const phase = gameState.game_phase;

    // Don't trigger for finished/game_over phases
    if (phase === 'finished' || phase === 'game_over') return;

    // Find the current player
    const currentPlayer = players.find(p => p.player_index === currentTurn);
    if (!currentPlayer?.is_bot) return;

    // Don't re-trigger for the same turn
    if (triggeredForTurnRef.current === currentTurn) return;

    // Schedule fallback trigger after grace period
    // The server-side trigger should handle this, but if it doesn't,
    // the fallback kicks in.
    fallbackTimerRef.current = setTimeout(() => {
      triggeredForTurnRef.current = currentTurn;
      triggerBotCoordinator();
    }, FALLBACK_GRACE_PERIOD_MS);

    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [enabled, gameState?.current_turn, gameState?.game_phase, players, roomCode, triggerBotCoordinator, gameState]);

  // Reset triggered turn when the turn actually advances
  useEffect(() => {
    if (gameState?.current_turn !== undefined) {
      const currentPlayer = players.find(p => p.player_index === gameState.current_turn);
      if (!currentPlayer?.is_bot) {
        // Turn is now a human — reset the trigger tracker
        triggeredForTurnRef.current = null;
      }
    }
  }, [gameState?.current_turn, players]);
}
