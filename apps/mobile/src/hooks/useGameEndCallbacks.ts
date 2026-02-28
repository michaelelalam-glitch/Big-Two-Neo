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

interface UseGameEndCallbacksOptions {
  gameManagerRef: React.RefObject<any>;
  currentPlayerName: string;
  botDifficulty: 'easy' | 'medium' | 'hard';
  navigation: StackNavigationProp<RootStackParamList, 'Game'>;
  setOnPlayAgain: (fn: () => () => Promise<void>) => void;
  setOnReturnToMenu: (fn: () => () => void) => void;
}

export function useGameEndCallbacks({
  gameManagerRef,
  currentPlayerName,
  botDifficulty,
  navigation,
  setOnPlayAgain,
  setOnReturnToMenu,
}: UseGameEndCallbacksOptions): void {
  useEffect(() => {
    const manager = gameManagerRef.current;
    if (!manager) return;

    setOnPlayAgain(() => async () => {
      gameLogger.info('🔄 [GameScreen] Play Again requested - reinitializing game');
      try {
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
  }, [currentPlayerName, navigation, gameManagerRef, botDifficulty, setOnPlayAgain, setOnReturnToMenu]);
}
