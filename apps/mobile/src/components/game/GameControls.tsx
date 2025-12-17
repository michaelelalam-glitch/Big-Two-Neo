import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import type { Card } from '../../game/types';
import type { GameStateManager } from '../../game/state';
import { COLORS, SPACING, FONT_SIZES, OPACITIES } from '../../constants';
import { soundManager, hapticManager, SoundType } from '../../utils';
import { sortCardsForDisplay } from '../../utils/cardSorting';
import { gameLogger } from '../../utils/logger';

interface GameControlsProps {
  gameManager: GameStateManager | null;
  isPlayerActive: boolean;
  selectedCards: Card[];
  onPlaySuccess: () => void;
  onPassSuccess: () => void;
  isMounted: React.MutableRefObject<boolean>;
  customCardOrder: string[];
  setCustomCardOrder: (order: string[]) => void;
  playerHand: Card[];
  onPlayCardsRef?: React.MutableRefObject<((cards: Card[]) => Promise<void>) | null>; // Expose handlePlayCards to parent
  onPassRef?: React.MutableRefObject<(() => Promise<void>) | null>; // Expose handlePass to parent
}

/**
 * GameControls Component
 * Handles all game action controls: Play and Pass buttons with their logic
 * Extracted from GameScreen.tsx to reduce complexity (Task #425)
 */
export function GameControls({
  gameManager,
  isPlayerActive,
  selectedCards,
  onPlaySuccess,
  onPassSuccess,
  isMounted,
  customCardOrder,
  setCustomCardOrder,
  playerHand,
  onPlayCardsRef,
  onPassRef,
}: GameControlsProps) {
  const [isPlayingCards, setIsPlayingCards] = useState(false);
  const [isPassing, setIsPassing] = useState(false);

  const handlePlayCards = useCallback(async (cards: Card[]) => {
    if (!gameManager) {
      gameLogger.error('❌ [GameControls] Game not initialized');
      return;
    }

    // Prevent duplicate card plays
    if (isPlayingCards) {
      gameLogger.debug('⏭️ [GameControls] Card play already in progress, ignoring...');
      return;
    }

    try {
      setIsPlayingCards(true);

      // Task #270: Add haptic feedback for Play button
      hapticManager.playCard();

      // Task #313: Auto-sort cards for proper display order before submission
      // This ensures straights are played as 6-5-4-3-2 (highest first) not 3-4-5-6-2
      const sortedCards = sortCardsForDisplay(cards);

      gameLogger.info('🎴 [GameControls] Playing cards (auto-sorted):', sortedCards.map(c => c.id));

      // Get card IDs to play (using sorted order)
      const cardIds = sortedCards.map(c => c.id);

      // Attempt to play cards through game engine
      const result = await gameManager.playCards(cardIds);

      if (result.success) {
        gameLogger.info('✅ [GameControls] Cards played successfully');

        // Play card sound effect
        soundManager.playSound(SoundType.CARD_PLAY);

        // Preserve custom card order by removing only the played cards
        if (customCardOrder.length > 0) {
          const playedCardIds = new Set(cardIds);
          // Also filter out any IDs not present in the current hand
          const currentHandCardIds = new Set(playerHand.map(card => card.id));
          const updatedOrder = customCardOrder.filter(
            id => !playedCardIds.has(id) && currentHandCardIds.has(id)
          );
          setCustomCardOrder(updatedOrder);
        }

        // Notify parent of successful play
        onPlaySuccess();

        // Bot turns and match/game end will be handled by subscription callback
      } else {
        // Show error from validation
        soundManager.playSound(SoundType.INVALID_MOVE);
        Alert.alert('Invalid Move', result.error || 'Invalid play');
      }
    } catch (error: any) {
      // Only log error message/code to avoid exposing game state internals
      gameLogger.error('❌ [GameControls] Failed to play cards:', error?.message || error?.code || String(error));

      // Show user-friendly error
      soundManager.playSound(SoundType.INVALID_MOVE);
      const errorMessage = error instanceof Error ? error.message : 'Invalid play';
      Alert.alert('Invalid Move', errorMessage);
    } finally {
      // Release lock after short delay to prevent rapid double-taps
      setTimeout(() => {
        if (isMounted.current) {
          setIsPlayingCards(false);
        }
      }, 300);
    }
  }, [gameManager, isPlayingCards, isMounted, customCardOrder, playerHand, onPlaySuccess, setCustomCardOrder]);

  const handlePass = useCallback(async () => {
    if (!gameManager) {
      gameLogger.error('❌ [GameControls] Game not initialized');
      return;
    }

    if (isPassing) {
      gameLogger.debug('⏭️ [GameControls] Pass already in progress, ignoring...');
      return;
    }

    try {
      setIsPassing(true);

      // Task #270: Add haptic feedback for Pass button
      hapticManager.pass();

      gameLogger.info('⏭️ [GameControls] Player passing...');

      const result = await gameManager.pass();

      if (result.success) {
        gameLogger.info('✅ [GameControls] Pass successful');

        // Play pass sound effect
        soundManager.playSound(SoundType.PASS);

        // Notify parent of successful pass
        onPassSuccess();

        // Bot turns will be triggered automatically by the subscription
      } else {
        Alert.alert('Cannot Pass', result.error || 'Cannot pass');
      }
    } catch (error: any) {
      // Only log error message/code to avoid exposing game state internals
      gameLogger.error('❌ [GameControls] Failed to pass:', error?.message || error?.code || String(error));

      const errorMessage = error instanceof Error ? error.message : 'Cannot pass';
      Alert.alert('Cannot Pass', errorMessage);
    } finally {
      setTimeout(() => {
        if (isMounted.current) {
          setIsPassing(false);
        }
      }, 300);
    }
  }, [gameManager, isPassing, isMounted, onPassSuccess]);

  // Expose handlePlayCards and handlePass to parent via refs (for drag-to-play from CardHand)
  // Note: This effect should only run once on mount to set up the refs.
  // The functions themselves are stable due to useCallback, and refs allow parent to always access latest version.
  //
  // WHY EMPTY DEPENDENCY ARRAY:
  // - handlePlayCards and handlePass are intentionally excluded from dependencies
  // - These are useCallback functions that ARE recreated when their deps change (gameManager, state, etc.)
  // - However, we WANT the parent to always call the LATEST version via refs
  // - If we included them as dependencies, this effect would run on every dep change,
  //   causing unnecessary ref reassignments (the ref pattern already solves staleness)
  // - The ref mechanism ensures parent always accesses current function version without
  //   needing to re-run this effect
  React.useEffect(() => {
    if (onPlayCardsRef) {
      onPlayCardsRef.current = handlePlayCards;
    }
    if (onPassRef) {
      onPassRef.current = handlePass;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute disabled states
  const isPassDisabled = !isPlayerActive || isPassing;
  const isPlayDisabled = !isPlayerActive || selectedCards.length === 0 || isPlayingCards;

  return (
    <View style={styles.actionButtons}>
      <Pressable
        style={[styles.actionButton, styles.passButton, isPassDisabled && styles.buttonDisabled]}
        onPress={handlePass}
        disabled={isPassDisabled}
        accessibilityRole="button"
        accessibilityLabel="Pass turn"
        accessibilityState={{ disabled: isPassDisabled }}
      >
        {isPassing ? (
          <ActivityIndicator color={COLORS.gray.light} size="small" accessibilityLabel="Passing turn" />
        ) : (
          <Text style={[styles.actionButtonText, styles.passButtonText]}>Pass</Text>
        )}
      </Pressable>

      <Pressable
        style={[
          styles.actionButton,
          styles.playButton,
          isPlayDisabled && styles.buttonDisabled,
        ]}
        onPress={() => {
          if (isPlayDisabled) return;
          handlePlayCards(selectedCards);
        }}
        disabled={isPlayDisabled}
        accessibilityRole="button"
        accessibilityLabel="Play selected cards"
        accessibilityState={{ disabled: isPlayDisabled }}
      >
        {isPlayingCards ? (
          <ActivityIndicator color={COLORS.white} size="small" accessibilityLabel="Playing cards" />
        ) : (
          <Text style={styles.actionButtonText}>Play</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButtons: {
    flexDirection: 'row',
    gap: SPACING.md,
    alignItems: 'center',
  },
  actionButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  passButton: {
    backgroundColor: COLORS.gray.medium,
  },
  playButton: {
    backgroundColor: COLORS.primary,
  },
  buttonDisabled: {
    opacity: OPACITIES.disabled,
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  passButtonText: {
    color: COLORS.gray.light,
  },
});
