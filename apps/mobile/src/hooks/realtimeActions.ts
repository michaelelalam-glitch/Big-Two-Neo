/**
 * realtimeActions — Server-call logic for play-cards and player-pass Edge Functions.
 *
 * Extracted from useRealtime.ts to reduce file size (~370 lines).
 * These are pure async functions (not hooks). The hook wraps them in useCallback.
 */

import { supabase } from '../services/supabase';
import type { Card, GameState, Player, Room, BroadcastEvent } from '../types/multiplayer';
import type {
  PlayCardsResponse,
  StartNewMatchResponse,
  PlayerPassResponse,
  MultiplayerMatchScoreDetail,
} from '../types/realtimeTypes';
import { invokeWithRetry } from '../utils/edgeFunctionRetry';
import {
  getPlayErrorExplanation,
  extractEdgeFunctionErrorAsync,
} from '../utils/edgeFunctionErrors';
import { gameLogger } from '../utils/logger';

// Alias for internal use
type PlayerMatchScoreDetail = MultiplayerMatchScoreDetail;

// ---------- playCards ----------

export interface PlayCardsParams {
  cards: Card[];
  playerIndex: number | undefined;
  gameState: GameState;
  currentPlayer: Player | null;
  roomPlayers: Player[];
  room: Room | null;
  broadcastMessage: (event: BroadcastEvent, data: any) => Promise<void>;
  onMatchEnded?: (matchNumber: number, scores: PlayerMatchScoreDetail[]) => void;
  setGameState: React.Dispatch<React.SetStateAction<GameState | null>>;
}

/**
 * Execute a play-cards action against the server. Handles:
 * - Input validation
 * - Edge Function invocation with retry
 * - Play history updating
 * - Broadcasting events (cards_played, auto_pass_timer, match_ended, game_over)
 * - Next match start (fire-and-forget)
 * - Auto-pass timer cancellation
 */
export async function executePlayCards({
  cards,
  playerIndex,
  gameState,
  currentPlayer,
  roomPlayers,
  room,
  broadcastMessage,
  onMatchEnded,
  setGameState: _setGameState,
}: PlayCardsParams): Promise<void> {
  const effectivePlayerIndex = playerIndex ?? currentPlayer?.player_index;

  // --- Validation ---
  if (playerIndex === undefined) {
    if (!currentPlayer) throw new Error('Player not found');
    if (gameState.current_turn !== currentPlayer.player_index) throw new Error('Not your turn');
  } else {
    if (gameState.current_turn !== playerIndex) {
      throw new Error(`Not player ${playerIndex}'s turn (current turn: ${gameState.current_turn})`);
    }
  }
  if (cards.length === 0) throw new Error('Cannot play an empty hand');

  // --- Find the player performing the play ---
  const playingPlayer = playerIndex !== undefined
    ? roomPlayers.find(p => p.player_index === playerIndex)
    : currentPlayer;
  if (!playingPlayer) throw new Error(`Player with index ${playerIndex} not found`);

  gameLogger.info('[useRealtime] 📡 Calling play-cards Edge Function...', {
    player_id: playingPlayer.user_id,
    player_index: effectivePlayerIndex,
    is_bot: playerIndex !== undefined,
  });

  // --- Edge Function call ---
  const { data: result, error: playError } = await invokeWithRetry<PlayCardsResponse>('play-cards', {
    body: {
      room_code: room!.code,
      player_id: playingPlayer.user_id,
      cards: cards.map(c => ({ id: c.id, rank: c.rank, suit: c.suit })),
    },
  });

  if (playError || !result?.success) {
    gameLogger.error('[useRealtime] 🔍 Full error object structure:', {
      hasError: !!playError,
      hasResult: !!result,
      errorKeys: playError ? Object.keys(playError) : [],
      errorContext: playError?.context,
      errorContextKeys: playError?.context ? Object.keys(playError.context) : [],
      resultKeys: result ? Object.keys(result) : [],
      result,
    });

    const errorMessage = await extractEdgeFunctionErrorAsync(playError, result, 'Server validation failed');
    const debugInfo = result?.debug ? JSON.stringify(result.debug) : 'No debug info';
    const statusCode = playError?.context?.status || 'unknown';

    gameLogger.error('[useRealtime] ❌ Server validation failed:', { message: errorMessage, status: statusCode, debug: debugInfo });
    gameLogger.error('[useRealtime] 📦 Full error context:', { error: playError, result });

    const userFriendlyError = getPlayErrorExplanation(errorMessage);
    throw new Error(userFriendlyError);
  }

  gameLogger.info('[useRealtime] ✅ Server validation passed:', result);

  // --- Match end detection ---
  const matchWillEnd = result.match_ended || false;
  let matchScores: PlayerMatchScoreDetail[] | null = null;
  let gameOver = false;
  let finalWinnerIndex: number | null = null;

  if (matchWillEnd && result.match_scores) {
    gameLogger.info('[useRealtime] 🏁 Match ended! Using server-calculated scores');
    matchScores = result.match_scores;
    gameOver = result.game_over || false;
    finalWinnerIndex = result.final_winner_index !== undefined ? result.final_winner_index : null;
    gameLogger.info('[useRealtime] 📊 Server scores:', { matchScores, gameOver, finalWinnerIndex });
  }

  // --- Play history update ---
  const currentPlayHistory = (gameState as any).play_history || [];
  const currentMatchNumber = (gameState as any).match_number || 1;
  const comboType = result.combo_type;
  const updatedPlayHistory = [
    ...currentPlayHistory,
    {
      match_number: currentMatchNumber,
      position: effectivePlayerIndex,
      cards,
      combo_type: comboType,
      passed: false,
    },
  ];

  // Auto-pass timer from server response
  const autoPassTimerState = result.auto_pass_timer || null;
  const isHighestPlay = result.highest_play_detected || false;
  gameLogger.info('[useRealtime] ⏰ Server timer state:', { isHighestPlay, timerState: autoPassTimerState });

  // Server already updated game_state (hands, last_play, current_turn, auto_pass_timer)
  // Client only updates play_history (cosmetic)
  if (updatedPlayHistory.length > 0) {
    const { error: historyError } = await supabase
      .from('game_state')
      .update({ play_history: updatedPlayHistory })
      .eq('id', gameState.id);

    if (historyError) {
      gameLogger.warn('[useRealtime] ⚠️ Failed to update play_history (non-fatal):', historyError);
    } else {
      gameLogger.info('[useRealtime] ✅ Play history updated');
    }
  }

  // --- Broadcasting ---
  await broadcastMessage('cards_played', {
    player_index: effectivePlayerIndex,
    cards,
    combo_type: comboType,
  });

  if (isHighestPlay && autoPassTimerState) {
    try {
      await broadcastMessage('auto_pass_timer_started', {
        timer_state: autoPassTimerState,
        triggering_player_index: effectivePlayerIndex,
      });
      gameLogger.info('[useRealtime] ⏰ Auto-pass timer broadcasted:', autoPassTimerState);
    } catch (timerBroadcastError) {
      gameLogger.error('[useRealtime] ⚠️ Auto-pass timer broadcast failed (non-fatal):', timerBroadcastError);
    }
  }

  // Wait for Realtime sync
  gameLogger.info('[useRealtime] ⏳ Waiting 300ms for Realtime sync...');
  await new Promise(resolve => setTimeout(resolve, 300));

  // --- Match end / game over broadcasting ---
  if (matchWillEnd && matchScores) {
    if (gameOver && finalWinnerIndex !== null) {
      await broadcastMessage('game_over', {
        winner_index: finalWinnerIndex,
        final_scores: matchScores,
      });
      gameLogger.info('[useRealtime] 📡 Broadcast: GAME OVER');
    } else {
      await broadcastMessage('match_ended', {
        winner_index: effectivePlayerIndex,
        match_number: currentMatchNumber,
        match_scores: matchScores,
      });
      gameLogger.info('[useRealtime] 📡 Broadcast: MATCH ENDED');

      if (onMatchEnded) {
        gameLogger.info('[useRealtime] 📊 Calling onMatchEnded callback directly');
        onMatchEnded(currentMatchNumber, matchScores);
      }

      // Start next match (fire-and-forget)
      (async () => {
        try {
          gameLogger.info('[useRealtime] 🔄 Starting next match in 2 seconds...');
          await new Promise(resolve => setTimeout(resolve, 2000));

          gameLogger.info('[useRealtime] 🎴 Calling start_new_match edge function...');
          const { data: newMatchData, error: newMatchError } = await invokeWithRetry<StartNewMatchResponse>('start_new_match', {
            body: { room_id: room!.id },
          });

          if (newMatchError || !newMatchData) {
            gameLogger.error('[useRealtime] ❌ Failed to start new match:', newMatchError);
          } else {
            gameLogger.info('[useRealtime] ✅ New match started successfully:', newMatchData);
            await broadcastMessage('new_match_started', {
              match_number: newMatchData.match_number,
              starting_player_index: newMatchData.starting_player_index,
            });
          }
        } catch (matchStartError) {
          gameLogger.error('[useRealtime] 💥 Match start failed (non-fatal):', matchStartError);
        }
      })().catch((unhandledError) => {
        gameLogger.error('[useRealtime] 💥 Unhandled error in match start flow:', unhandledError);
      });
    }
  }

  // Auto-pass timer cancellation (non-blocking)
  const hadPreviousTimer = gameState.auto_pass_timer !== null && gameState.auto_pass_timer !== undefined;
  if (hadPreviousTimer) {
    broadcastMessage('auto_pass_timer_cancelled', {
      player_index: effectivePlayerIndex,
      reason: 'new_play' as const,
    }).catch((cancelError) => {
      gameLogger.warn('[useRealtime] ⚠️ Timer cancellation broadcast failed (non-fatal):', cancelError);
    });
  }
}

// ---------- pass ----------

export interface PassParams {
  playerIndex: number | undefined;
  gameState: GameState;
  currentPlayer: Player | null;
  roomPlayers: Player[];
  room: Room | null;
  isAutoPassInProgress: boolean;
  broadcastMessage: (event: BroadcastEvent, data: any) => Promise<void>;
  setGameState: React.Dispatch<React.SetStateAction<GameState | null>>;
}

/**
 * Execute a player-pass action against the server. Handles:
 * - Input validation
 * - Guard against auto-pass race condition
 * - Edge Function invocation with retry
 * - Local timer state clearing when trick is cleared
 * - Broadcasting player_passed event
 */
export async function executePass({
  playerIndex,
  gameState,
  currentPlayer,
  roomPlayers,
  room,
  isAutoPassInProgress,
  broadcastMessage,
  setGameState,
}: PassParams): Promise<void> {
  const passingPlayer = playerIndex !== undefined
    ? roomPlayers.find(p => p.player_index === playerIndex)
    : currentPlayer;

  if (!passingPlayer || gameState.current_turn !== passingPlayer.player_index) {
    throw new Error('Not your turn');
  }

  // Guard against auto-pass race condition
  if (isAutoPassInProgress) {
    gameLogger.info('[useRealtime] ⚠️ Skipping pass() — auto-pass execution in progress');
    return;
  }

  if (!room?.code) throw new Error('Room code not available');

  gameLogger.info('[useRealtime] 📡 Calling player-pass Edge Function...', {
    player_id: passingPlayer.user_id,
    player_index: passingPlayer.player_index,
    is_bot: playerIndex !== undefined,
  });

  const { data: result, error: passError } = await invokeWithRetry<PlayerPassResponse>('player-pass', {
    body: {
      room_code: room.code,
      player_id: passingPlayer.user_id,
    },
  });

  if (passError || !result?.success) {
    const errorMessage = await extractEdgeFunctionErrorAsync(passError, result, 'Pass validation failed');
    const statusCode = passError?.context?.status || 'unknown';

    gameLogger.error('[useRealtime] ❌ Pass failed:', {
      message: errorMessage,
      status: statusCode,
      fullError: passError,
      result,
    });

    throw new Error(errorMessage);
  }

  gameLogger.info('[useRealtime] ✅ Pass successful:', {
    next_turn: result.next_turn,
    passes: result.passes,
    trick_cleared: result.trick_cleared,
    timer_preserved: !!result.auto_pass_timer,
  });

  // Clear local timer state when trick cleared
  if (!result.auto_pass_timer) {
    setGameState(prevState => {
      if (!prevState) return prevState;
      return { ...prevState, auto_pass_timer: null };
    });
  }

  // Broadcast pass event
  await broadcastMessage('player_passed', { player_index: passingPlayer.player_index });

  // Wait for Realtime propagation
  gameLogger.info('[useRealtime] ⏳ Waiting 300ms for Realtime sync after pass...');
  await new Promise(resolve => setTimeout(resolve, 300));
}
