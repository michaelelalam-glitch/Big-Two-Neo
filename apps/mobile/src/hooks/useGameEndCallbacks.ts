/**
 * useGameEndCallbacks — Registers Play Again / Return to Menu handlers on the GameEnd context.
 *
 * Extracted from GameScreen.tsx to reduce file size (~35 lines).
 */

import { useEffect } from 'react';
import type { StackNavigationProp } from '@react-navigation/stack';

import { soundManager, SoundType, showError } from '../utils';
import { gameLogger } from '../utils/logger';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { GameStateManager } from '../game/state';

interface UseGameEndCallbacksOptions {
  gameManagerRef: React.RefObject<GameStateManager | null>;
  currentPlayerName: string;
  botDifficulty: 'easy' | 'medium' | 'hard';
  navigation: StackNavigationProp<RootStackParamList, 'Game'>;
  setOnPlayAgain: (fn: () => () => Promise<void>) => void;
  setOnReturnToMenu: (fn: () => () => void) => void;
  /** Clears all score history and scoreboard state for a fresh game. */
  clearHistory: () => void;
}

export function useGameEndCallbacks({
  gameManagerRef,
  currentPlayerName,
  botDifficulty,
  navigation,
  setOnPlayAgain,
  setOnReturnToMenu,
  clearHistory,
}: UseGameEndCallbacksOptions): void {
  useEffect(() => {
    setOnPlayAgain(() => async () => {
      // Access ref lazily so this callback works even when registered before
      // the game manager finishes initializing (avoiding early-return on mount).
      const manager = gameManagerRef.current;
      if (!manager) {
        showError('Game not ready. Please try again.');
        return;
      }
      gameLogger.info('🔄 [GameScreen] Play Again requested - reinitializing game');
      try {
        // Clear scoreboard history so the new game starts with 0 scores
        clearHistory();
        gameLogger.info('🧹 [GameScreen] Score history cleared for new game');
        await manager.initializeGame({
          playerName: currentPlayerName,
          botCount: 3,
          botDifficulty,
        });
        gameLogger.info('✅ [GameScreen] Game restarted successfully');
        soundManager.playSound(SoundType.GAME_START);
      } catch (error) {
        gameLogger.error('❌ [GameScreen] Failed to restart game:', error);
        showError('Failed to restart game. Please try again.');
      }
    });

    setOnReturnToMenu(() => () => {
      gameLogger.info('🏠 [GameScreen] Return to Menu requested - navigating to Home');
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    });
    // botDifficulty included so "Play Again" always uses the latest difficulty.
    // setOnPlayAgain / setOnReturnToMenu are stable setters — safe to include.
    // clearHistory is a stable useCallback from ScoreboardContext — safe to include.
  }, [
    currentPlayerName,
    navigation,
    gameManagerRef,
    botDifficulty,
    setOnPlayAgain,
    setOnReturnToMenu,
    clearHistory,
  ]);
}
