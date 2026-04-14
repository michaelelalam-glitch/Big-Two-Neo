/**
 * realtimeActions — Server-call logic for play-cards and player-pass Edge Functions.
 *
 * Extracted from useRealtime.ts to reduce file size (~370 lines).
 * These are pure async functions (not hooks). The hook wraps them in useCallback.
 */

import type {
  Card,
  GameState,
  Player,
  Room,
  BroadcastEvent,
  BroadcastData,
  ComboType,
} from '../types/multiplayer';
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
  isExpectedTurnRaceError,
} from '../utils/edgeFunctionErrors';
import { gameLogger } from '../utils/logger';
import { soundManager, SoundType, showError } from '../utils';
import { notifyGameEnded } from '../services/pushNotificationTriggers';

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
  broadcastMessage: (event: BroadcastEvent, data: BroadcastData) => Promise<void>;
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
  setGameState: _setGameState,
}: PlayCardsParams): Promise<void> {
  const effectivePlayerIndex = playerIndex ?? currentPlayer?.player_index;

  // --- Validation ---
  // Reject play attempts when the match/game has already ended (prevents stale requests)
  if (gameState.game_phase === 'finished' || gameState.game_phase === 'game_over') {
    throw new Error('Match has ended — waiting for next match to start');
  }

  if (playerIndex === undefined) {
    if (!currentPlayer) throw new Error('Player not found');
    if (gameState.current_turn !== currentPlayer.player_index) throw new Error('Not your turn');
  } else {
    if (gameState.current_turn !== playerIndex) {
      throw new Error(`Not player ${playerIndex}'s turn (current turn: ${gameState.current_turn})`);
    }
  }
  if (cards.length === 0) throw new Error('Cannot play an empty hand');
  if (effectivePlayerIndex === undefined) throw new Error('Player index not resolved');

  // --- Find the player performing the play ---
  const playingPlayer =
    playerIndex !== undefined
      ? roomPlayers.find(p => p.player_index === playerIndex)
      : currentPlayer;
  if (!playingPlayer) throw new Error(`Player with index ${playerIndex} not found`);

  gameLogger.info('[useRealtime] 📡 Calling play-cards Edge Function...', {
    player_id: playingPlayer.user_id,
    player_index: effectivePlayerIndex,
    is_bot: playerIndex !== undefined,
  });

  // --- Edge Function call ---
  const { data: result, error: playError } = await invokeWithRetry<PlayCardsResponse>(
    'play-cards',
    {
      body: {
        room_code: room!.code,
        player_id: playingPlayer.user_id,
        cards: cards.map(c => ({ id: c.id, rank: c.rank, suit: c.suit })),
      },
    }
  );

  if (playError || !result?.success) {
    const errorMessage = await extractEdgeFunctionErrorAsync(
      playError,
      result,
      'Server validation failed'
    );
    const statusCode = playError?.context?.status || 'unknown';

    // Determine severity: expected race conditions (bot took the turn, player
    // disconnected) are warnings, not errors — they do not indicate bugs.
    const isExpectedRace = isExpectedTurnRaceError(errorMessage);
    const log = isExpectedRace
      ? gameLogger.warn.bind(gameLogger)
      : gameLogger.error.bind(gameLogger);

    if (!isExpectedRace) {
      log('[useRealtime] 🔍 Full error object structure:', {
        hasError: !!playError,
        hasResult: !!result,
        errorKeys: playError ? Object.keys(playError) : [],
        errorContext: playError?.context,
        errorContextKeys: playError?.context ? Object.keys(playError.context) : [],
        resultKeys: result ? Object.keys(result) : [],
        result,
      });
    }

    log('[useRealtime] ❌ Server validation failed:', {
      message: errorMessage,
      status: statusCode,
      ...(isExpectedRace
        ? {}
        : { debug: result?.debug ? JSON.stringify(result.debug) : 'No debug info' }),
    });
    if (isExpectedRace) {
      gameLogger.warn('[useRealtime] 📦 Error summary (expected race):', {
        message: errorMessage,
        status: statusCode,
        hasError: !!playError,
        hasResult: !!result,
      });
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        gameLogger.debug('[useRealtime] 📦 Full error context (DEV only):', {
          error: playError,
          result,
        });
      }
    } else {
      log('[useRealtime] 📦 Full error context:', {
        message: errorMessage,
        status: statusCode,
        hasError: !!playError,
        hasResult: !!result,
      });
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        gameLogger.debug('[useRealtime] 📦 Full error details (DEV only):', {
          error: playError,
          result,
        });
      }
    }

    // ── "Lost response" recovery ──────────────────────────────────────────────
    // Scenario: the server processed our play (match ended) but the HTTP response
    // was dropped in transit. invokeWithRetry retried and got HTTP 400 "Game already
    // ended (phase: finished)".  Without intervention, start_new_match is NEVER
    // called and the game freezes between matches.
    //
    // Fix: when we get this specific error, fire start_new_match silently in the
    // background so the transition still happens.  start_new_match is idempotent —
    // if the match already advanced it returns `already_advanced: true` harmlessly.
    // We suppress the error dialog so the user sees a clean next-match transition
    // instead of a confusing "Game already ended" toast.
    if (errorMessage.includes('Game already ended') && errorMessage.includes('finished')) {
      const recoveryMatchNumber = gameState.match_number ?? 1;
      gameLogger.warn(
        `[useRealtime] ⚡ "Game already ended" on play-cards — likely lost-response retry. ` +
          `Silently calling start_new_match for match ${recoveryMatchNumber} as safety net.`
      );
      (async () => {
        await new Promise(r => setTimeout(r, 500));
        const { data: snmData, error: snmError } = await invokeWithRetry<StartNewMatchResponse>(
          'start_new_match',
          { body: { room_id: room!.id, expected_match_number: recoveryMatchNumber } }
        );
        if (snmError) {
          gameLogger.warn(
            '[useRealtime] start_new_match (lost-response recovery) failed:',
            snmError
          );
          // P4-2 fix: surface failure so the user knows they need to rejoin
          // rather than being stuck silently on a frozen screen.
          showError('The match failed to advance. Please return to the lobby and rejoin the game.');
        } else {
          gameLogger.info('[useRealtime] ✅ start_new_match (lost-response recovery):', snmData);
        }
      })().catch(e => gameLogger.error('[useRealtime] start_new_match recovery threw:', e));
      return; // Don't show error dialog — Realtime subscription will update the UI
    }
    // ─────────────────────────────────────────────────────────────────────────

    const userFriendlyError = getPlayErrorExplanation(errorMessage);
    throw new Error(userFriendlyError);
  }

  gameLogger.info('[useRealtime] ✅ Server validation passed:', result);

  // --- Match end detection ---
  const matchWillEnd = result.match_ended || false;
  const alreadyFinished = result.already_finished || false; // Idempotent winner retry
  let matchScores: PlayerMatchScoreDetail[] | null = null;
  let gameOver = false;
  let finalWinnerIndex: number | null = null;
  const currentMatchNumber = gameState.match_number || 1;

  if (matchWillEnd && result.match_scores) {
    gameLogger.info('[useRealtime] 🏁 Match ended! Using server-calculated scores');
    matchScores = result.match_scores;
    gameOver = result.game_over || false;
    finalWinnerIndex = result.final_winner_index !== undefined ? result.final_winner_index : null;
    gameLogger.info('[useRealtime] 📊 Server scores:', { matchScores, gameOver, finalWinnerIndex });
  }

  // --- combo type (used for broadcast below) ---
  // play_history is now updated server-side in the play-cards Edge Function so that
  // bot plays (which never go through this client path) are also recorded.
  const comboType: ComboType = (result.combo_type as ComboType) || 'unknown';

  // Auto-pass timer from server response
  const autoPassTimerState = result.auto_pass_timer || null;
  const isHighestPlay = result.highest_play_detected || false;
  const autoPassTriggered = result.auto_pass_timer != null;
  gameLogger.info('[useRealtime] ⏰ Server timer state:', {
    isHighestPlay,
    autoPassTriggered,
    timerState: autoPassTimerState,
  });

  // Play HIGHEST_CARD sound immediately for match/game-winning plays where the
  // auto_pass_timer is null (last card played — no opponents left to time out).
  // For non-terminal highest plays, useGameAudio handles the sound via the
  // auto_pass_timer.active flag so we only trigger here when timer is absent.
  // Guard !alreadyFinished so idempotent retries (lost-response re-sends) do
  // not replay the sound — the original call already fired it.
  if (isHighestPlay && !autoPassTriggered && !alreadyFinished) {
    soundManager.playSound(SoundType.HIGHEST_CARD);
    gameLogger.info(
      '🎵 [Audio] Highest card sound triggered from realtimeActions (no timer — match/game winning play)'
    );
  }

  // --- Broadcasting ---
  // Skip cards_played broadcast on an already_finished retry — the original play was
  // already broadcast when it actually happened; re-broadcasting would confuse clients.
  if (!alreadyFinished) {
    await broadcastMessage('cards_played', {
      player_index: effectivePlayerIndex,
      cards,
      combo_type: comboType,
    });

    if (autoPassTriggered && autoPassTimerState) {
      try {
        await broadcastMessage('auto_pass_timer_started', {
          timer_state: autoPassTimerState,
          triggering_player_index: effectivePlayerIndex,
        });
        gameLogger.info('[useRealtime] ⏰ Auto-pass timer broadcasted:', autoPassTimerState);
      } catch (timerBroadcastError) {
        gameLogger.error(
          '[useRealtime] ⚠️ Auto-pass timer broadcast failed (non-fatal):',
          timerBroadcastError
        );
      }
    }
  }

  // Wait for Realtime sync
  gameLogger.info('[useRealtime] ⏳ Waiting 50ms for Realtime sync...');
  await new Promise(resolve => setTimeout(resolve, 50));

  // --- Match end / game over broadcasting ---
  if (matchWillEnd && matchScores && !alreadyFinished) {
    if (gameOver && finalWinnerIndex !== null) {
      await broadcastMessage('game_over', {
        winner_index: finalWinnerIndex,
        final_scores: matchScores,
        match_number: currentMatchNumber,
      });
      gameLogger.info('[useRealtime] 📡 Broadcast: GAME OVER');

      // --- Push notification: notify all players game ended ---
      if (room?.id && room?.code) {
        const winnerPlayer = roomPlayers.find(p => p.player_index === finalWinnerIndex);
        const winnerName = winnerPlayer?.username || 'Unknown';
        const winnerUserId = winnerPlayer?.user_id;

        if (winnerUserId) {
          notifyGameEnded(room.id, room.code, winnerName, winnerUserId).catch(err =>
            gameLogger.warn('[useRealtime] ⚠️ notifyGameEnded failed (non-fatal):', err)
          );
        } else {
          gameLogger.warn(
            '[useRealtime] ⚠️ Skipping notifyGameEnded — winner has no valid user_id'
          );
        }
      }

      // Score history is now managed exclusively by useMultiplayerScoreHistory (reads from
      // game_state.scores_history via Realtime).  Game-end modal is opened exclusively by
      // useMatchEndHandler (reads from multiplayerGameState after postgres_changes update).
      // Both onMatchEnded and onGameOver direct calls have been removed to prevent:
      //   1. Score doubling (each match entry added by both broadcast-path and Realtime-path)
      //   2. Inconsistent modals (broadcast-path used stale React state; zeros / missing data)
    } else {
      await broadcastMessage('match_ended', {
        winner_index: effectivePlayerIndex,
        match_number: currentMatchNumber,
        match_scores: matchScores,
      });
      gameLogger.info('[useRealtime] 📡 Broadcast: MATCH ENDED');
      // onMatchEnded call removed — useMultiplayerScoreHistory handles score history via DB.

      // Start next match (fire-and-forget)
      (async () => {
        try {
          gameLogger.info('[useRealtime] 🔄 Starting next match in 0.6 seconds...');
          await new Promise(resolve => setTimeout(resolve, 600));

          gameLogger.info('[useRealtime] 🎴 Calling start_new_match edge function...');
          const { data: newMatchData, error: newMatchError } =
            await invokeWithRetry<StartNewMatchResponse>('start_new_match', {
              body: { room_id: room!.id, expected_match_number: currentMatchNumber },
            });

          if (newMatchError || !newMatchData) {
            gameLogger.error('[useRealtime] ❌ Failed to start new match:', newMatchError);
            // P4-2 fix: surface failure so the user can take action (rejoin)
            // instead of sitting on a permanently frozen between-match screen.
            showError(
              'Failed to start the next match. Please return to the lobby and rejoin the game.'
            );
          } else if (newMatchData.game_over || newMatchData.already_advanced) {
            // start_new_match safety guard:
            //   - If game_over is true, the game_over phase will be delivered via Realtime
            //     and there is no next match to broadcast.
            //   - If already_advanced is true (and game_over is false), another client has
            //     already advanced the match; the new game_state will arrive via the DB
            //     postgres_changes subscription, not via a game_over update.
            // In both cases we skip broadcasting new_match_started here.
            gameLogger.warn(
              '[useRealtime] ⚠️ start_new_match returned already_advanced/game_over — skipping new_match_started broadcast'
            );
          } else {
            gameLogger.info('[useRealtime] ✅ New match started successfully:', newMatchData);
            await broadcastMessage('new_match_started', {
              // In the else branch (not game_over, not already_advanced) these fields
              // are always populated by the edge function for a genuine new-match response.
              match_number: newMatchData.match_number!,
              starting_player_index: newMatchData.starting_player_index!,
            });
          }
        } catch (matchStartError) {
          gameLogger.error('[useRealtime] 💥 Match start failed (non-fatal):', matchStartError);
        }
      })().catch(unhandledError => {
        gameLogger.error('[useRealtime] 💥 Unhandled error in match start flow:', unhandledError);
      });
    }
  }

  // --- Already-finished winner retry: kick off start_new_match without re-broadcasting ---
  // This handles the scenario where our match-winning play succeeded on the server but
  // the HTTP response was lost. The server-side play-cards idempotency guard returns
  // match_ended=true + already_finished=true. We must still call start_new_match or
  // the game will be stuck in 'finished' phase permanently (useMatchTransition is a
  // 5-second fallback but the user may close the app before it fires).
  if (alreadyFinished && matchWillEnd) {
    gameLogger.warn(
      `[useRealtime] ⚡ already_finished=true — winner retry confirmed. ` +
        `Calling start_new_match for match ${currentMatchNumber} silently.`
    );
    (async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        const { data: newMatchData, error: newMatchError } =
          await invokeWithRetry<StartNewMatchResponse>('start_new_match', {
            body: { room_id: room!.id, expected_match_number: currentMatchNumber },
          });
        if (newMatchError || !newMatchData) {
          gameLogger.error(
            '[useRealtime] ❌ start_new_match (already-finished) failed:',
            newMatchError
          );
        } else {
          gameLogger.info(
            '[useRealtime] ✅ start_new_match (already-finished) succeeded:',
            newMatchData
          );
        }
      } catch (err) {
        gameLogger.error('[useRealtime] 💥 start_new_match (already-finished) threw:', err);
      }
    })().catch(e =>
      gameLogger.error('[useRealtime] 💥 Unhandled start_new_match (already-finished):', e)
    );
  }

  // Auto-pass timer cancellation (non-blocking)
  const hadPreviousTimer =
    gameState.auto_pass_timer !== null && gameState.auto_pass_timer !== undefined;
  if (hadPreviousTimer) {
    broadcastMessage('auto_pass_timer_cancelled', {
      player_index: effectivePlayerIndex,
      reason: 'new_play' as const,
    }).catch(cancelError => {
      gameLogger.warn(
        '[useRealtime] ⚠️ Timer cancellation broadcast failed (non-fatal):',
        cancelError
      );
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
  broadcastMessage: (event: BroadcastEvent, data: BroadcastData) => Promise<void>;
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
  const passingPlayer =
    playerIndex !== undefined
      ? roomPlayers.find(p => p.player_index === playerIndex)
      : currentPlayer;

  // Reject pass attempts when the match/game has already ended
  if (gameState.game_phase === 'finished' || gameState.game_phase === 'game_over') {
    throw new Error('Match has ended — waiting for next match to start');
  }

  if (!passingPlayer || gameState.current_turn !== passingPlayer.player_index) {
    throw new Error('Not your turn');
  }

  // Guard: cannot pass when leading (no last play on board — player must open the trick)
  if (!gameState.last_play) {
    throw new Error('You cannot pass when leading — you must play cards to start the trick');
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

  const { data: result, error: passError } = await invokeWithRetry<PlayerPassResponse>(
    'player-pass',
    {
      body: {
        room_code: room.code,
        player_id: passingPlayer.user_id,
      },
    }
  );

  if (passError || !result?.success) {
    const errorMessage = await extractEdgeFunctionErrorAsync(
      passError,
      result,
      'Pass validation failed'
    );
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
  gameLogger.info('[useRealtime] ⏳ Waiting 50ms for Realtime sync after pass...');
  await new Promise(resolve => setTimeout(resolve, 50));
}
