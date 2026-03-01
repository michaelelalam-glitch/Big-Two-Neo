/**
 * @module useMatchTransition
 * Client-side fallback to ensure match progression in multiplayer games.
 *
 * Problem: When a match ends (game_phase='finished'), the `start_new_match`
 * edge function must be called to deal new cards and start the next match.
 * There are two primary triggers:
 *   1. Client-side: realtimeActions.ts calls it when the human's play returns match_ended=true
 *   2. Server-side: bot-coordinator calls it when a bot's play returns match_ended=true
 *
 * Both can fail due to:
 *   - Race conditions between auto-pass timer, bot-coordinator, and human plays
 *   - Network errors / cold starts on fire-and-forget calls
 *   - Edge function timeouts
 *
 * This hook acts as a SAFETY NET: it watches game_phase and triggers
 * start_new_match if the game stays stuck in 'finished' state for too long.
 *
 * @see apps/mobile/supabase/functions/start_new_match/index.ts
 */

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { invokeWithRetry } from '../utils/edgeFunctionRetry';
import { gameLogger, networkLogger } from '../utils/logger';
import type { GameState } from '../types/multiplayer';

interface UseMatchTransitionOptions {
  /** Current multiplayer game state from Realtime subscription */
  gameState: GameState | null;
  /** Room object with id and code */
  room: { id: string; code: string } | null;
  /** Whether this client is connected and the hook should be active */
  enabled: boolean;
}

/**
 * Grace period (ms) before triggering fallback start_new_match.
 * The bot-coordinator should call start_new_match within ~2s of match ending.
 * The client-side realtimeActions also fires within ~1.5s.
 * If after this period the game is still 'finished', we trigger the fallback.
 */
const MATCH_TRANSITION_GRACE_MS = 5000;

/**
 * Cooldown (ms) between fallback attempts to prevent spam.
 */
const TRANSITION_COOLDOWN_MS = 8000;

/**
 * Maximum retries for the fallback start_new_match call.
 */
const MAX_TRANSITION_RETRIES = 3;

export function useMatchTransition({
  gameState,
  room,
  enabled,
}: UseMatchTransitionOptions): void {
  const lastAttemptTimeRef = useRef<number>(0);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTransitioningRef = useRef<boolean>(false);
  /** Track the match_number we're transitioning FROM to prevent double-fires */
  const transitionedMatchRef = useRef<number | null>(null);

  // Store gameState in a ref so triggerNewMatch does not need it in its useCallback deps.
  // Without this, every Realtime update recreates triggerNewMatch (because gameState is a
  // new object reference), which in turn causes the scheduling useEffect to re-run and
  // cancel the pending fallback timer — potentially preventing start_new_match from firing.
  const gameStateRef = useRef(gameState);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const triggerNewMatch = useCallback(async () => {
    const gs = gameStateRef.current;
    if (!room?.id || !gs) return;
    if (isTransitioningRef.current) {
      networkLogger.debug('[MatchTransition] Already transitioning, skipping');
      return;
    }

    const now = Date.now();
    if (now - lastAttemptTimeRef.current < TRANSITION_COOLDOWN_MS) {
      networkLogger.debug('[MatchTransition] Cooldown active, skipping');
      return;
    }

    const currentMatchNumber = gs.match_number || 1;

    // Don't fire twice for the same match
    if (transitionedMatchRef.current === currentMatchNumber) {
      networkLogger.debug(`[MatchTransition] Already transitioned match ${currentMatchNumber}, skipping`);
      return;
    }

    isTransitioningRef.current = true;
    lastAttemptTimeRef.current = now;

    gameLogger.info(`[MatchTransition] 🔄 Fallback: starting new match (current match: ${currentMatchNumber})`);

    for (let attempt = 0; attempt < MAX_TRANSITION_RETRIES; attempt++) {
      try {
        // Re-check: is the game still in 'finished'? Another client/coordinator might have fixed it.
        const roomId = room.id; // captured from outer scope (room is a dep, so this is stable)
        const { data: freshState, error: fetchErr } = await supabase
          .from('game_state')
          .select('game_phase, match_number')
          .eq('room_id', roomId)
          .single();

        if (fetchErr) {
          gameLogger.error('[MatchTransition] Failed to fetch fresh state:', fetchErr);
          break;
        }

        if (freshState?.game_phase !== 'finished') {
          gameLogger.info(`[MatchTransition] ✅ Game phase is now '${freshState?.game_phase}', no transition needed`);
          // If match_number advanced, mark transition as done
          if (freshState?.match_number !== currentMatchNumber) {
            transitionedMatchRef.current = currentMatchNumber;
          }
          break;
        }

        gameLogger.info(`[MatchTransition] 🎴 Calling start_new_match (attempt ${attempt + 1}/${MAX_TRANSITION_RETRIES})...`);

        const { data: newMatchData, error: newMatchError } = await invokeWithRetry<{
          success?: boolean;
          match_number?: number;
          starting_player_index?: number;
          error?: string;
        }>('start_new_match', {
          body: { room_id: roomId },
        });

        if (newMatchError || !newMatchData?.success) {
          const errMsg = newMatchData?.error || newMatchError?.message || 'Unknown error';
          gameLogger.error(`[MatchTransition] ❌ start_new_match failed (attempt ${attempt + 1}):`, errMsg);

          // If the error indicates the match already started, we're done
          if (errMsg.includes('Game state not found') || errMsg.includes('No winner found')) {
            gameLogger.warn('[MatchTransition] Match may have already started, stopping retries');
            break;
          }

          // Wait before retry
          if (attempt < MAX_TRANSITION_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
          continue;
        }

        gameLogger.info('[MatchTransition] ✅ New match started successfully:', newMatchData);
        transitionedMatchRef.current = currentMatchNumber;
        break; // Success — DB update triggers Realtime for all clients
      } catch (err) {
        gameLogger.error(`[MatchTransition] ❌ Unexpected error (attempt ${attempt + 1}):`, err);
        if (attempt < MAX_TRANSITION_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }

    isTransitioningRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- gameState intentionally excluded; stored in gameStateRef to prevent timer cancellation on unrelated Realtime updates
  }, [room]);

  useEffect(() => {
    // Clear timer if disabled or no context
    if (!enabled || !gameState || !room) {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      return;
    }

    const phase = gameState.game_phase;
    const currentMatchNumber = gameState.match_number || 1;

    // Only act when game_phase is 'finished' (match ended, but not game_over)
    if (phase !== 'finished') {
      // Game progressed (or hasn't ended yet) — cancel any pending fallback
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      return;
    }

    // game_phase === 'finished' — schedule fallback if not already scheduled
    // and we haven't already transitioned this match
    if (transitionedMatchRef.current === currentMatchNumber) {
      return; // Already handled
    }

    if (transitionTimerRef.current) {
      return; // Timer already running
    }

    gameLogger.info(
      `[MatchTransition] ⏰ Match ${currentMatchNumber} ended (phase='finished'). ` +
      `Scheduling fallback start_new_match in ${MATCH_TRANSITION_GRACE_MS}ms...`
    );

    transitionTimerRef.current = setTimeout(() => {
      transitionTimerRef.current = null;
      void triggerNewMatch();
    }, MATCH_TRANSITION_GRACE_MS);

    return () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
    };
  }, [enabled, gameState?.game_phase, gameState?.match_number, room, triggerNewMatch]);

  // Reset transitioned match when match_number changes (new match started by someone else)
  useEffect(() => {
    if (gameState?.match_number && gameState.game_phase === 'playing') {
      // A new match is actively playing — clear any stale transition tracking
      transitionedMatchRef.current = null;
    }
  }, [gameState?.match_number, gameState?.game_phase]);
}
