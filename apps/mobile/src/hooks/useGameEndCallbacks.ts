/**
 * useGameEndCallbacks — Registers Play Again / Return to Menu handlers on the GameEnd context.
 *
 * Extracted from GameScreen.tsx to reduce file size (~35 lines).
 */

import { Platform } from 'react-native';
import { useEffect } from 'react';
import type { StackNavigationProp } from '@react-navigation/stack';

import { soundManager, SoundType, showError } from '../utils';
import { gameLogger } from '../utils/logger';
import i18n from '../i18n';
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
  /**
   * Orientation-safe in-game alert (iOS only). When provided, used instead of
   * `showError`/`Alert.alert` so errors respect the active orientation lock.
   */
  onAlert?: (options: { title?: string; message: string }) => void;
}

export function useGameEndCallbacks({
  gameManagerRef,
  currentPlayerName,
  botDifficulty,
  navigation,
  setOnPlayAgain,
  setOnReturnToMenu,
  clearHistory,
  onAlert,
}: UseGameEndCallbacksOptions): void {
  useEffect(() => {
    // alertError is defined inside the effect so it always captures the latest
    // `onAlert` prop — avoids a stale-closure if the callback changes after mount.
    const alertError = (message: string) => {
      if (Platform.OS === 'ios' && onAlert) {
        onAlert({ title: i18n.t('common.error'), message });
      } else {
        showError(message);
      }
    };

    setOnPlayAgain(() => async () => {
      // Access ref lazily so this callback works even when registered before
      // the game manager finishes initializing (avoiding early-return on mount).
      const manager = gameManagerRef.current;
      if (!manager) {
        alertError('Game not ready. Please try again.');
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
        alertError('Failed to restart game. Please try again.');
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
    // onAlert included so alertError always uses the latest iOS alert callback.
  }, [
    currentPlayerName,
    navigation,
    gameManagerRef,
    botDifficulty,
    setOnPlayAgain,
    setOnReturnToMenu,
    clearHistory,
    onAlert,
  ]);
}
