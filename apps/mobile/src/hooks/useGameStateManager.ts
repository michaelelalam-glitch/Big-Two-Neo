import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { createGameStateManager, type GameState, type GameStateManager } from '../game/state';
import { soundManager, SoundType, showError, showInfo } from '../utils';
import { gameLogger } from '../utils/logger';
import { buildFinalPlayHistoryFromState } from '../utils/playHistoryUtils';
import { i18n } from '../i18n';
import type { ScoreHistory, PlayHistoryMatch } from '../types/scoreboard';
import type { FinalScore } from '../types/gameEnd';

interface UseGameStateManagerProps {
  roomCode: string;
  currentPlayerName: string;
  forceNewGame?: boolean;
  isLocalGame?: boolean; // NEW: Only initialize game engine for local games
  addScoreHistory: (history: ScoreHistory) => void;
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
 * Handles game state initialization, subscription, and lifecycle management
 * Extracted from GameScreen.tsx to reduce complexity (Task #427)
 * 
 * Responsibilities:
 * - Create and initialize GameStateManager
 * - Subscribe to game state changes
 * - Handle match end and game over scenarios
 * - Manage score history tracking
 * - Trigger bot turns
 * - Clean up resources on unmount
 */
export function useGameStateManager({
  roomCode,
  currentPlayerName,
  forceNewGame = false,
  isLocalGame = true, // Default true for backwards compatibility
  addScoreHistory,
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

    // Prevent multiple initializations for the same room
    if (isInitializedRef.current && initializedRoomRef.current === roomCode) {
      return;
    }

    const initGame = async () => {
      try {
        gameLogger.info('🎮 [useGameStateManager] Initializing game engine for room:', roomCode);

        // Mark as initializing
        isInitializedRef.current = true;
        initializedRoomRef.current = roomCode;

        // Create game manager
        const manager = createGameStateManager();
        gameManagerRef.current = manager;

        // 🔥 CRITICAL FIX: Clear saved state if starting a new game explicitly
        if (forceNewGame) {
          gameLogger.info('🧹 [useGameStateManager] Clearing saved game state (forceNewGame=true)...');
          await manager.clearState();
          gameLogger.info('✅ [useGameStateManager] Saved state cleared - starting fresh game');
        }

        // CRITICAL FIX: Try to load saved game state first (for rejoin)
        gameLogger.info('🔄 [useGameStateManager] Checking for saved game state...');
        const savedState = forceNewGame ? null : await manager.loadState();
        
        if (savedState) {
          gameLogger.info('✅ [useGameStateManager] Loaded saved game state - continuing from where you left off');
          setGameState(savedState);
          setIsInitializing(false);
          
          // Play notification sound
          soundManager.playSound(SoundType.TURN_NOTIFICATION);
          gameLogger.info('🎵 [Audio] Notification sound triggered for rejoined game');
        }

        // Subscribe to state changes
        const unsubscribe = manager.subscribe((state: GameState) => {
          // Play turn notification when it becomes player's turn
          const previousState = gameState;
          if (
            previousState &&
            state.currentPlayerIndex === 0 &&
            previousState.currentPlayerIndex !== 0
          ) {
            soundManager.playSound(SoundType.TURN_NOTIFICATION);
            gameLogger.info('🎵 [Audio] Turn notification sound triggered - player turn started');
          }

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
            const pointsAdded: number[] = [];
            const cumulativeScores: number[] = [];

            state.matchScores.forEach((playerScore) => {
              const latestMatchScore =
                playerScore.matchScores[playerScore.matchScores.length - 1] || 0;
              pointsAdded.push(latestMatchScore);
              cumulativeScores.push(playerScore.score);
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
                  const errorMsg = (result.error as any)?.message || String(result.error);
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

        // Only initialize NEW game if no saved state was loaded
        if (!savedState) {
          gameLogger.info('🆕 [useGameStateManager] No saved game found - starting new game');
          // Initialize game with 3 bots
          const initialState = await manager.initializeGame({
            playerName: currentPlayerName,
            botCount: 3,
            botDifficulty: 'medium',
          });

          setGameState(initialState);
          setIsInitializing(false);
          gameLogger.info('✅ [useGameStateManager] New game initialized successfully');

          // Play game start sound
          soundManager.playSound(SoundType.GAME_START);
          gameLogger.info('🎵 [Audio] Game start sound triggered');
        }

        return () => {
          unsubscribe();
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
      } catch (error: any) {
        gameLogger.error(
          '❌ [useGameStateManager] Failed to initialize game:',
          error?.message || error?.code || String(error)
        );
        setIsInitializing(false);
        Alert.alert(i18n.t('common.error'), 'Failed to initialize game. Please try again.');
      }
    };

    initGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, currentPlayerName, isLocalGame]);

  return {
    gameManagerRef,
    gameState,
    isInitializing,
  };
}
