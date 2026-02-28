/**
 * @module useGameStateManager
 * Game state initialization, subscription, and lifecycle management for local AI games.
 */
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createGameStateManager, type GameState, type GameStateManager } from '../game/state';
import { i18n } from '../i18n';
import { soundManager, SoundType, showError, showInfo } from '../utils';
import { gameLogger } from '../utils/logger';
import { buildFinalPlayHistoryFromState } from '../utils/playHistoryUtils';
import type { FinalScore } from '../types/gameEnd';
import type { ScoreHistory, PlayHistoryMatch } from '../types/scoreboard';

const SCORE_HISTORY_KEY = '@big2_score_history';

interface UseGameStateManagerProps {
  roomCode: string;
  currentPlayerName: string;
  forceNewGame?: boolean;
  isLocalGame?: boolean; // NEW: Only initialize game engine for local games
  botDifficulty?: 'easy' | 'medium' | 'hard'; // Bot difficulty for local games (Task #596)
  addScoreHistory: (history: ScoreHistory) => void;
  restoreScoreHistory: (history: ScoreHistory[]) => void;
  openGameEndModal: (
    winnerName: string,
    winnerPosition: number,
    finalScores: FinalScore[],
    playerNames: string[],
    scoreHistory: ScoreHistory[],
    playHistory: PlayHistoryMatch[]
  ) => void;
  scoreHistory: ScoreHistory[];
  playHistoryByMatch: PlayHistoryMatch[];
  checkAndExecuteBotTurn: () => void;
}

interface UseGameStateManagerReturn {
  gameManagerRef: React.MutableRefObject<GameStateManager | null>;
  gameState: GameState | null;
  isInitializing: boolean;
}

/**
 * useGameStateManager Hook
 * Handles game state initialization, subscription, and lifecycle management.
 * Extracted from GameScreen.tsx to reduce complexity (Task #427).
 *
 * Responsibilities:
 * - Create and initialize GameStateManager
 * - Subscribe to game state changes
 * - Handle match end and game over scenarios
 * - Manage score history tracking
 * - Trigger bot turns
 * - Clean up resources on unmount
 *
 * @param props - Configuration object
 * @param props.roomCode - Room identifier (used for AsyncStorage key + logging)
 * @param props.currentPlayerName - Display name of the current user
 * @param props.forceNewGame - If true, skips saved-state restoration and starts fresh
 * @param props.isLocalGame - When true, initializes the local game engine; false for multiplayer (server-side state)
 * @param props.botDifficulty - AI difficulty for local games ('easy' | 'medium' | 'hard')
 * @param props.addScoreHistory - Callback to append a new ScoreHistory entry
 * @param props.restoreScoreHistory - Callback to bulk-restore saved ScoreHistory on mount
 * @param props.openGameEndModal - Callback invoked when a game ends (shows winner modal)
 * @param props.scoreHistory - Current score history array (used for match numbering)
 * @param props.playHistoryByMatch - Play history grouped by match (passed to game-end modal)
 * @param props.checkAndExecuteBotTurn - Callback to trigger bot AI after state changes
 * @returns {{ gameManagerRef: React.MutableRefObject<GameStateManager | null>, gameState: GameState | null, isInitializing: boolean }}
 */
export function useGameStateManager({
  roomCode,
  currentPlayerName,
  forceNewGame = false,
  isLocalGame = true, // Default true for backwards compatibility
  botDifficulty = 'medium', // Default medium for backwards compatibility (Task #596)
  addScoreHistory,
  restoreScoreHistory,
  openGameEndModal,
  scoreHistory,
  playHistoryByMatch,
  checkAndExecuteBotTurn,
}: UseGameStateManagerProps): UseGameStateManagerReturn {
  const gameManagerRef = useRef<GameStateManager | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Track initialization to prevent multiple inits
  const isInitializedRef = useRef(false);
  const initializedRoomRef = useRef<string | null>(null);

  // Track auto-start match timeout for cleanup
  const autoStartMatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store refs for callbacks
  const scoreHistoryRef = useRef(scoreHistory);
  const playHistoryRef = useRef(playHistoryByMatch);

  useEffect(() => {
    scoreHistoryRef.current = scoreHistory;
    playHistoryRef.current = playHistoryByMatch;
  }, [scoreHistory, playHistoryByMatch]);

  // Initialize game engine
  useEffect(() => {
    // CRITICAL: Skip initialization for multiplayer games (handled by useRealtime)
    if (!isLocalGame) {
      gameLogger.info('⏭️ [useGameStateManager] Skipping local game init - multiplayer mode');
      setIsInitializing(false);
      return;
    }

    // Prevent multiple initializations for the same room+difficulty
    // Include botDifficulty in guard key
    const initKey = `${roomCode}:${botDifficulty}`;
    if (isInitializedRef.current && initializedRoomRef.current === initKey) {
      return;
    }

    // Capture unsubscribe in outer scope so useEffect
    // can return synchronous cleanup. Previously, cleanup was returned inside async
    // initGame() and never reached React.
    let unsubscribeFn: (() => void) | null = null;

    const initGame = async () => {
      try {
        gameLogger.info('🎮 [useGameStateManager] Initializing game engine for room:', roomCode);

        // Mark as initializing
        isInitializedRef.current = true;
        initializedRoomRef.current = initKey;

        // Create game manager
        const manager = createGameStateManager();
        gameManagerRef.current = manager;

        // 🔥 CRITICAL FIX: Clear saved state if starting a new game explicitly
        if (forceNewGame) {
          gameLogger.info('🧹 [useGameStateManager] Clearing saved game state (forceNewGame=true)...');
          await manager.clearState();
          // Also clear persisted scoreHistory
          await AsyncStorage.removeItem(SCORE_HISTORY_KEY).catch(() => {});
          gameLogger.info('✅ [useGameStateManager] Saved state cleared - starting fresh game');
        }

        // CRITICAL FIX: Try to load saved game state first (for rejoin)
        gameLogger.info('🔄 [useGameStateManager] Checking for saved game state...');
        const savedState = forceNewGame ? null : await manager.loadState();
        
        if (savedState) {
          gameLogger.info('✅ [useGameStateManager] Loaded saved game state - continuing from where you left off');
          setGameState(savedState);
          setIsInitializing(false);
          
          // 🔥 FIX: Restore scoreHistory from AsyncStorage (primary mechanism).
          // The old reconstruction from matchScores was fragile and had edge cases.
          // Now we persist scoreHistory to a separate key whenever it changes
          // and restore it directly on rejoin.
          let scoreRestored = false;
          try {
            const persistedHistory = await AsyncStorage.getItem(SCORE_HISTORY_KEY);
            if (persistedHistory) {
              const parsed: ScoreHistory[] = JSON.parse(persistedHistory);
              if (Array.isArray(parsed) && parsed.length > 0) {
                gameLogger.info(`📊 [useGameStateManager] Restored ${parsed.length} score history entries from AsyncStorage`);
                restoreScoreHistory(parsed);
                scoreRestored = true;
              }
            }
          } catch (err) {
            gameLogger.error('[useGameStateManager] Failed to load persisted scoreHistory:', err instanceof Error ? err.message : String(err));
          }

          // Fallback: Reconstruct scoreHistory from persisted matchScores
          // (handles case where scoreHistory key was cleared but game state survived)
          if (!scoreRestored && savedState.matchScores && savedState.matchScores.length > 0) {
            // If gameEnded is true, the current match has ALSO completed — include it
            const numCompletedMatches = savedState.gameEnded && !savedState.gameOver
              ? savedState.currentMatch
              : savedState.currentMatch - 1;
            gameLogger.info(`📊 [useGameStateManager] Fallback: Reconstructing ${numCompletedMatches} score history entries from matchScores`);
            
            const reconstructed: ScoreHistory[] = [];
            for (let matchIdx = 0; matchIdx < numCompletedMatches; matchIdx++) {
              const pointsAdded: number[] = new Array(savedState.players.length).fill(0);
              const cumulativeScores: number[] = new Array(savedState.players.length).fill(0);
              
              savedState.matchScores.forEach((playerScore) => {
                const playerIndex = savedState.players.findIndex(p => p.id === playerScore.playerId);
                if (playerIndex !== -1 && matchIdx < playerScore.matchScores.length) {
                  pointsAdded[playerIndex] = playerScore.matchScores[matchIdx];
                  // Cumulative = sum of matchScores[0..matchIdx]
                  let cumulative = 0;
                  for (let i = 0; i <= matchIdx; i++) {
                    cumulative += playerScore.matchScores[i] || 0;
                  }
                  cumulativeScores[playerIndex] = cumulative;
                }
              });
              
              reconstructed.push({
                matchNumber: matchIdx + 1,
                pointsAdded,
                scores: cumulativeScores,
                timestamp: new Date().toISOString(),
              });
              gameLogger.info(`📊 [Score History] Reconstructed match ${matchIdx + 1}:`, { pointsAdded, scores: cumulativeScores });
            }
            
            if (reconstructed.length > 0) {
              restoreScoreHistory(reconstructed);
            }
          }

          // 🔥 FIX: If the saved state has gameEnded=true (user left during the
          // inter-match window), auto-start the next match now.
          if (savedState.gameEnded && !savedState.gameOver) {
            gameLogger.info('🔄 [useGameStateManager] Saved state has gameEnded=true, auto-starting next match...');
            // We need to subscribe FIRST so the startNewMatch notifyListeners triggers the subscriber
          }

          // Play notification sound
          soundManager.playSound(SoundType.TURN_NOTIFICATION);
          gameLogger.info('🎵 [Audio] Notification sound triggered for rejoined game');
        }

        // Track previous player index in a ref
        // instead of reading from the stale `gameState` closure.
        let prevPlayerIndex: number | null = null;

        // Subscribe to state changes
        const unsubscribe = manager.subscribe((state: GameState) => {
          // Play turn notification when it becomes player's turn
          if (
            prevPlayerIndex !== null &&
            state.currentPlayerIndex === 0 &&
            prevPlayerIndex !== 0
          ) {
            soundManager.playSound(SoundType.TURN_NOTIFICATION);
            gameLogger.info('🎵 [Audio] Turn notification sound triggered - player turn started');
          }
          prevPlayerIndex = state.currentPlayerIndex;

          setGameState(state);

          // Handle match end (someone ran out of cards)
          if (state.gameEnded) {
            const matchWinner = state.players.find((p) => p.id === state.winnerId);

            // Play win/lose sound based on match outcome (only if game continues)
            if (!state.gameOver) {
              if (matchWinner && matchWinner.id === state.players[0].id) {
                soundManager.playSound(SoundType.WIN);
                gameLogger.info('🎵 [Audio] Win sound triggered - player won match');
              } else {
                soundManager.playSound(SoundType.LOSE);
                gameLogger.info('🎵 [Audio] Lose sound triggered - player lost match');
              }
            }

            // Track score history for scoreboard
            // CRITICAL FIX: Build arrays indexed by player position, not forEach order
            // This ensures scores align with player indices [0,1,2,3]
            const pointsAdded: number[] = new Array(state.players.length).fill(0);
            const cumulativeScores: number[] = new Array(state.players.length).fill(0);

            state.matchScores.forEach((playerScore) => {
              // Find this player's index in the players array
              const playerIndex = state.players.findIndex(p => p.id === playerScore.playerId);
              if (playerIndex !== -1) {
                const latestMatchScore =
                  playerScore.matchScores[playerScore.matchScores.length - 1] || 0;
                pointsAdded[playerIndex] = latestMatchScore;
                cumulativeScores[playerIndex] = playerScore.score;
              }
            });

            const scoreHistory: ScoreHistory = {
              matchNumber: state.currentMatch,
              pointsAdded,
              scores: cumulativeScores,
              timestamp: new Date().toISOString(),
            };

            // Use state updater callback to avoid race conditions with ref mutations
            // The refs will be automatically synchronized via the scoreHistory/playHistoryByMatch state updates
            addScoreHistory(scoreHistory);
            gameLogger.info('📊 [Score History] Added to scoreboard context:', scoreHistory);
            
            // Note: Play history is automatically cleared for the next match via addPlayHistory
            // mechanism when new plays are added. No manual clearing needed here.

            // Auto-start next match when game is NOT over
            if (!state.gameOver) {
              gameLogger.info('🔄 [useGameStateManager] Match ended, auto-starting next match...');

              // Clear any existing timeout
              if (autoStartMatchTimeoutRef.current) {
                clearTimeout(autoStartMatchTimeoutRef.current);
              }

              // Start next match automatically after brief delay
              autoStartMatchTimeoutRef.current = setTimeout(async () => {
                const result = await manager.startNewMatch();
                if (result.success) {
                  gameLogger.info('✅ [useGameStateManager] Next match started automatically');
                } else {
                  const errorMsg = result.error ?? 'Unknown error';
                  gameLogger.error('❌ [useGameStateManager] Failed to start new match:', errorMsg);
                  showError('Failed to start next match. Please try leaving and rejoining the game.');
                }
                autoStartMatchTimeoutRef.current = null;
              }, 1500);
            }
          }

          // Handle game over (101+ points reached)
          if (state.gameOver && state.gameEnded) {
            gameLogger.info('🚨 [GAME OVER] Detected! Opening Game End Modal...', {
              gameOver: state.gameOver,
              gameEnded: state.gameEnded,
              finalWinnerId: state.finalWinnerId,
            });

            const finalWinner = state.matchScores.find((s) => s.playerId === state.finalWinnerId);

            // Prepare final scores in display order
            const finalScores: FinalScore[] = state.matchScores
              .sort((a, b) => a.score - b.score)
              .map((s, index) => ({
                player_index: state.players.findIndex((p) => p.id === s.playerId),
                player_name: s.playerName,
                cumulative_score: s.score,
                points_added: 0,
                rank: index + 1,
                is_busted: s.score >= 101,
              }));

            const playerNames = state.players.map((p) => p.name);
            const currentScoreHistory = scoreHistoryRef.current;
            const finalPlayHistory = buildFinalPlayHistoryFromState(
              state,
              playHistoryRef.current
            );

            gameLogger.info('📊 [Game Over] Modal data:', {
              scoreHistoryCount: currentScoreHistory.length,
              playHistoryCount: finalPlayHistory.length,
              finalMatchHands: state.roundHistory.length,
              finalScoresCount: finalScores.length,
            });

            // Open modal immediately
            requestAnimationFrame(() => {
              gameLogger.info('🎉 [Game Over] Opening Game End Modal NOW');

              try {
                openGameEndModal(
                  finalWinner?.playerName || 'Someone',
                  state.players.findIndex((p) => p.id === state.finalWinnerId),
                  finalScores,
                  playerNames,
                  currentScoreHistory,
                  finalPlayHistory
                );

                gameLogger.info('✅ [Game Over] Game End Modal opened successfully');
              } catch (error) {
                gameLogger.error('❌ [Game Over] Failed to open modal:', error);
                showInfo(`Game Over! ${finalWinner?.playerName || 'Someone'} wins!`);
              }
            });

            return;
          }

          // Trigger bot turn check after state update
          setTimeout(() => checkAndExecuteBotTurn(), 100);
        });

        // Capture unsubscribe for synchronous cleanup
        unsubscribeFn = unsubscribe;

        // 🔥 FIX: Handle edge cases after subscriber is registered
        if (savedState) {
          // Case 1: User left during inter-match window (gameEnded=true, !gameOver)
          // Auto-start the next match now that subscriber is listening
          if (savedState.gameEnded && !savedState.gameOver) {
            gameLogger.info('🔄 [useGameStateManager] Auto-starting next match (saved state had gameEnded=true)...');
            autoStartMatchTimeoutRef.current = setTimeout(async () => {
              const result = await manager.startNewMatch();
              if (result.success) {
                gameLogger.info('✅ [useGameStateManager] Next match started after rejoin');
              } else {
                gameLogger.error('❌ [useGameStateManager] Failed to start next match after rejoin:', result.error);
              }
              autoStartMatchTimeoutRef.current = null;
            }, 500);
          } else if (!savedState.gameEnded && !savedState.gameOver) {
            // Case 2: Normal rejoin mid-match — trigger bot turn check
            // The subscriber only fires on notifyListeners(), but loadState() already
            // called notifyListeners() before the subscriber was registered.
            // We need to manually kick off the bot turn loop.
            setTimeout(() => checkAndExecuteBotTurn(), 200);
          }
        }

        // Only initialize NEW game if no saved state was loaded
        if (!savedState) {
          gameLogger.info('🆕 [useGameStateManager] No saved game found - starting new game');
          // Initialize game with 3 bots using configured difficulty (Task #596)
          const initialState = await manager.initializeGame({
            playerName: currentPlayerName,
            botCount: 3,
            botDifficulty: botDifficulty,
          });

          setGameState(initialState);
          setIsInitializing(false);
          gameLogger.info('✅ [useGameStateManager] New game initialized successfully');

          // Play game start sound
          soundManager.playSound(SoundType.GAME_START);
          gameLogger.info('🎵 [Audio] Game start sound triggered');
        }
      } catch (error: unknown) {
        gameLogger.error(
          '❌ [useGameStateManager] Failed to initialize game:',
          error instanceof Error ? error.message : String(error)
        );
        // Reset init guards on failure so a
        // re-render can retry initialization instead of being permanently stuck.
        isInitializedRef.current = false;
        initializedRoomRef.current = null;
        if (gameManagerRef.current) {
          gameManagerRef.current.destroy();
          gameManagerRef.current = null;
        }
        setIsInitializing(false);
        Alert.alert(i18n.t('common.error'), 'Failed to initialize game. Please try again.');
      }
    };

    initGame();

    // Return synchronous cleanup from useEffect itself.
    // Previously, cleanup was returned inside async initGame() where React couldn't reach it,
    // leaking subscriptions, timeouts, and the game manager on unmount/re-render.
    return () => {
      unsubscribeFn?.();
      if (gameManagerRef.current) {
        gameManagerRef.current.destroy();
      }
      if (autoStartMatchTimeoutRef.current) {
        clearTimeout(autoStartMatchTimeoutRef.current);
        autoStartMatchTimeoutRef.current = null;
      }
      soundManager.cleanup().catch((err) => {
        gameLogger.error('Failed to cleanup audio:', err?.message || String(err));
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, currentPlayerName, isLocalGame, botDifficulty]);

  return {
    gameManagerRef,
    gameState,
    isInitializing,
  };
}
