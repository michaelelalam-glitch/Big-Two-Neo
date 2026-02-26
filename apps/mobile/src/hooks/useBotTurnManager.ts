import { useRef } from 'react';
import { Alert } from 'react-native';
import { GameStateManager } from '../game/state';
import { i18n } from '../i18n';
import { gameLogger } from '../utils/logger';

interface UseBotTurnManagerParams {
  gameManagerRef: React.MutableRefObject<GameStateManager | null>;
}

/**
 * Custom hook to manage bot turn execution with debouncing and timeout protection
 * Extracted from GameScreen to reduce complexity
 */
export function useBotTurnManager({ gameManagerRef }: UseBotTurnManagerParams) {
  // Track bot turn execution to prevent duplicates
  const isExecutingBotTurnRef = useRef(false);
  const lastBotTurnPlayerIndexRef = useRef<number | null>(null);

  // Bot turn timing configuration based on difficulty
  const getBotDelayMs = (difficulty: 'easy' | 'medium' | 'hard' = 'medium'): number => {
    const delays = { easy: 1200, medium: 800, hard: 500 };
    return delays[difficulty];
  };

  // Bot turn timeout: 15 seconds to accommodate slower/resource-constrained devices
  const BOT_TURN_TIMEOUT_MS = 15000;

  // Bot turn checker function (accessible from everywhere)
  const checkAndExecuteBotTurn = () => {
    if (!gameManagerRef.current) return;

    const currentState = gameManagerRef.current.getState();
    // CRITICAL FIX: Check BOTH gameEnded AND gameOver to stop bot turns when game finishes
    if (!currentState || currentState.gameEnded || currentState.gameOver) return;

    const currentPlayer = currentState.players[currentState.currentPlayerIndex];

    // Detect new trick: lastPlay is null and consecutivePasses is 0 (trick was just won)
    const isNewTrickLeader = !currentState.lastPlay && currentState.consecutivePasses === 0;
    const turnChanged = lastBotTurnPlayerIndexRef.current !== currentState.currentPlayerIndex;

    // Execute bot turn if: it's a bot, not already executing, AND (turn changed OR leading new trick)
    if (currentPlayer.isBot && !isExecutingBotTurnRef.current && (turnChanged || isNewTrickLeader)) {
      // Mark as executing and track player index
      isExecutingBotTurnRef.current = true;
      lastBotTurnPlayerIndexRef.current = currentState.currentPlayerIndex;

      gameLogger.info(`🤖 [useBotTurnManager] Bot ${currentPlayer.name} is thinking...`);

      // Bot turn timing: configurable delay for natural feel, 100ms between subsequent bot turns
      setTimeout(() => {
        // CRITICAL FIX: Start timeout AFTER bot delay to give full timeout duration for execution
        // If bot turn doesn't complete within timeout (e.g., blocked by notification or slow device),
        // forcefully release the lock and retry. Uses 15s timeout to accommodate resource-constrained devices.
        const botTurnTimeoutId = setTimeout(() => {
          if (isExecutingBotTurnRef.current) {
            gameLogger.error(
              '⚠️ [useBotTurnManager] Bot turn TIMEOUT detected - forcefully releasing lock'
            );
            isExecutingBotTurnRef.current = false;
            // Retry bot turn check after clearing the stuck state
            setTimeout(checkAndExecuteBotTurn, 500);
          }
        }, BOT_TURN_TIMEOUT_MS); // 15 second timeout (applies to actual bot turn execution)

        gameManagerRef.current
          ?.executeBotTurn()
          .then(() => {
            clearTimeout(botTurnTimeoutId); // Clear timeout on success
            gameLogger.info(`✅ [useBotTurnManager] Bot ${currentPlayer.name} turn finished`);
            // Release lock immediately after turn completes
            isExecutingBotTurnRef.current = false;
            // Check for next bot turn
            setTimeout(checkAndExecuteBotTurn, 100);
          })
          .catch((error: any) => {
            clearTimeout(botTurnTimeoutId); // Clear timeout on error
            // Only log error message/code to avoid exposing game state internals
            gameLogger.error(
              '❌ [useBotTurnManager] Bot turn failed:',
              error?.message || error?.code || String(error)
            );
            isExecutingBotTurnRef.current = false;

            // Notify user and attempt recovery
            Alert.alert(
              i18n.t('game.botTurnErrorTitle'),
              i18n.t('game.botTurnErrorMessage', { botName: currentPlayer.name }),
              [{ text: i18n.t('common.ok') }]
            );

            // Check for next player after brief delay
            setTimeout(checkAndExecuteBotTurn, 100);
          });
      }, getBotDelayMs('medium'));
    }
  };

  return { checkAndExecuteBotTurn };
}
