/**
 * @module useHelperButtons
 * Provides Sort, Smart Sort, and Hint button handlers for the game screen.
 */
import { Platform, ToastAndroid, Alert } from 'react-native';
import { hapticManager, HapticType } from '../utils';
import { sortHandLowestToHighest, smartSortHand, findHintPlay } from '../utils/helperButtonUtils';
import { gameLogger } from '../utils/logger';
import type { Card, LastPlay } from '../game/types';

interface UseHelperButtonsParams {
  playerHand: Card[];
  lastPlay: LastPlay | null;
  isFirstPlay: boolean;
  customCardOrder: string[];
  setCustomCardOrder: (order: string[]) => void;
  setSelectedCardIds: (ids: Set<string>) => void;
}

/**
 * useHelperButtons — Provides Sort, Smart Sort, and Hint button handlers.
 *
 * Extracted from GameScreen to reduce complexity.
 *
 * @param props - Configuration object
 * @param props.playerHand - The current player's hand of cards
 * @param props.lastPlay - The last played combo (null if starting a new round)
 * @param props.isFirstPlay - Whether this is the very first play of the match
 * @param props.customCardOrder - Current custom card ordering
 * @param props.setCustomCardOrder - Setter for custom card ordering
 * @param props.setSelectedCardIds - Setter for selected card IDs
 * @returns {{ handleSort: () => void, handleSmartSort: () => void, handleHint: () => void }}
 */
export function useHelperButtons({
  playerHand,
  lastPlay,
  isFirstPlay,
  customCardOrder: _customCardOrder,
  setCustomCardOrder,
  setSelectedCardIds,
}: UseHelperButtonsParams) {
  /**
   * Sort button handler - Arranges cards from lowest to highest
   * Task #388: Implement Sort button functionality
   */
  const handleSort = () => {
    if (playerHand.length === 0) return;

    // Haptic feedback - light for utility action
    hapticManager.trigger(HapticType.LIGHT);

    // Sort hand
    const sorted = sortHandLowestToHighest(playerHand);
    const newOrder = sorted.map((card) => card.id);
    setCustomCardOrder(newOrder);

    gameLogger.info('[useHelperButtons] Sorted hand lowest to highest');
  };

  /**
   * Smart Sort button handler - Groups cards by combo type
   * Task #389: Implement Smart Sort button functionality
   */
  const handleSmartSort = () => {
    if (playerHand.length === 0) return;

    // Haptic feedback - medium for complex operation
    hapticManager.trigger(HapticType.MEDIUM);

    // Smart sort hand
    const smartSorted = smartSortHand(playerHand);
    const newOrder = smartSorted.map((card) => card.id);
    setCustomCardOrder(newOrder);

    // Toast message
    if (Platform.OS === 'android') {
      ToastAndroid.show('Hand organized by combos', ToastAndroid.SHORT);
    } else if (Platform.OS === 'ios') {
      Alert.alert('Hand organized by combos');
    }

    gameLogger.info('[useHelperButtons] Smart sorted hand by combo type');
  };

  /**
   * Hint button handler - Suggests best play
   * Task #390: Implement Hint button functionality
   */
  const handleHint = () => {
    if (playerHand.length === 0) return;

    const recommended = findHintPlay(playerHand, lastPlay, isFirstPlay);

    if (recommended === null) {
      // No valid play - recommend passing
      hapticManager.trigger(HapticType.WARNING);

      if (Platform.OS === 'android') {
        ToastAndroid.show('No valid play - recommend passing', ToastAndroid.LONG);
      } else if (Platform.OS === 'ios') {
        Alert.alert('No valid play - recommend passing');
      }

      gameLogger.info('[useHelperButtons] Hint: No valid play, recommend pass');
    } else {
      // Valid play found - auto-select cards
      hapticManager.success();

      const recommendedSet = new Set(recommended);
      setSelectedCardIds(recommendedSet);

      const cardCount = recommended.length;
      const comboType =
        cardCount === 1
          ? 'Single'
          : cardCount === 2
            ? 'Pair'
            : cardCount === 3
              ? 'Triple'
              : cardCount === 5
                ? '5-card combo'
                : `${cardCount} card${cardCount > 1 ? 's' : ''}`;

      if (Platform.OS === 'android') {
        ToastAndroid.show(`Recommended: ${comboType}`, ToastAndroid.SHORT);
      } else if (Platform.OS === 'ios') {
        Alert.alert(`Recommended: ${comboType}`);
      }

      gameLogger.info(`[useHelperButtons] Hint: Recommended ${cardCount} card(s)`);
    }
  };

  return {
    handleSort,
    handleSmartSort,
    handleHint,
  };
}
