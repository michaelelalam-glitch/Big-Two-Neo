import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  AccessibilityInfo,
} from 'react-native';
import { COLORS, SPACING, FONT_SIZES, OPACITIES } from '../../constants';
import { i18n } from '../../i18n';
import { soundManager, hapticManager, SoundType } from '../../utils';
import { sortCardsForDisplay } from '../../utils/cardSorting';
import { gameLogger } from '../../utils/logger';
import type { GameStateManager } from '../../game/state';
import type { Card } from '../../game/types';

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
  onPlayCards: (cards: Card[]) => Promise<void>;
  onPass: () => Promise<void>;
}

/**
 * GameControls Component
 * Handles all game action controls: Play and Pass buttons with their logic
 * Extracted from GameScreen.tsx to reduce complexity (Task #425)
 */
// Task #628: React.memo prevents re-renders when action buttons aren't affected by
// context changes unrelated to selection or turn state.
function GameControlsComponent({
  gameManager: _gameManager,
  isPlayerActive,
  selectedCards,
  onPlaySuccess,
  onPassSuccess,
  isMounted,
  customCardOrder,
  setCustomCardOrder,
  playerHand,
  onPlayCards,
  onPass,
}: GameControlsProps) {
  const [isPlayingCards, setIsPlayingCards] = useState(false);
  const [isPassing, setIsPassing] = useState(false);

  const handlePlayCards = useCallback(
    async (cards: Card[]) => {
      // Prevent duplicate card plays
      if (isPlayingCards) {
        return;
      }

      try {
        setIsPlayingCards(true);

        // Task #270: Add haptic feedback for Play button
        hapticManager.playCard();

        // Task #313: Auto-sort cards for proper display order before submission
        // This ensures straights are played as 6-5-4-3-2 (highest first) not 3-4-5-6-2
        const sortedCards = sortCardsForDisplay(cards);

        gameLogger.info(
          '🎴 [GameControls] Playing cards (auto-sorted):',
          sortedCards.map(c => c.id)
        );

        // Delegate to GameScreen (local or multiplayer)
        await onPlayCards(sortedCards);

        gameLogger.info('✅ [GameControls] Cards played successfully');
        soundManager.playSound(SoundType.CARD_PLAY);

        // Preserve custom card order by removing only the played cards
        if (customCardOrder.length > 0) {
          const playedCardIds = new Set(sortedCards.map(c => c.id));
          const currentHandCardIds = new Set(playerHand.map(card => card.id));
          const updatedOrder = customCardOrder.filter(
            id => !playedCardIds.has(id) && currentHandCardIds.has(id)
          );
          setCustomCardOrder(updatedOrder);
        }

        onPlaySuccess();
      } catch (error: unknown) {
        // Only log error message/code to avoid exposing game state internals
        gameLogger.error(
          '❌ [GameControls] Failed to play cards:',
          error instanceof Error ? error.message : String(error)
        );

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
    },
    [
      isPlayingCards,
      isMounted,
      customCardOrder,
      playerHand,
      onPlaySuccess,
      setCustomCardOrder,
      onPlayCards,
    ]
  );

  const handlePass = useCallback(async () => {
    if (isPassing) {
      return;
    }

    try {
      setIsPassing(true);

      // Task #270: Add haptic feedback for Pass button
      hapticManager.pass();

      gameLogger.info('⏭️ [GameControls] Player passing...');

      await onPass();

      gameLogger.info('✅ [GameControls] Pass successful');
      soundManager.playSound(SoundType.PASS);
      onPassSuccess();
    } catch (error: unknown) {
      // Only log error message/code to avoid exposing game state internals
      gameLogger.error(
        '❌ [GameControls] Failed to pass:',
        error instanceof Error ? error.message : String(error)
      );

      const errorMessage = error instanceof Error ? error.message : 'Cannot pass';
      Alert.alert('Cannot Pass', errorMessage);
    } finally {
      setTimeout(() => {
        if (isMounted.current) {
          setIsPassing(false);
        }
      }, 300);
    }
  }, [isPassing, isMounted, onPassSuccess, onPass]);

  // Compute disabled states
  const isPassDisabled = !isPlayerActive || isPassing;
  const isPlayDisabled = !isPlayerActive || selectedCards.length === 0 || isPlayingCards;

  // Task #645: Dynamic play label announces card count to screen readers
  const playLabel =
    selectedCards.length > 0
      ? `Play ${selectedCards.length} card${selectedCards.length !== 1 ? 's' : ''}`
      : 'Play selected cards';

  // Task #645: Announce when play becomes enabled (cards selected on active turn).
  // Guard: skip announcement if the transition came from a play attempt resetting
  // (isPlayingCards flipping true → false after a completed/failed play attempt).
  const prevPlayDisabledRef = React.useRef(isPlayDisabled);
  const prevIsPlayingRef = React.useRef(isPlayingCards);
  React.useEffect(() => {
    const wasPlaying = prevIsPlayingRef.current;
    if (prevPlayDisabledRef.current && !isPlayDisabled && !wasPlaying) {
      AccessibilityInfo.announceForAccessibility(
        `${selectedCards.length} card${selectedCards.length !== 1 ? 's' : ''} selected. Ready to play.`
      );
    }
    prevPlayDisabledRef.current = isPlayDisabled;
    prevIsPlayingRef.current = isPlayingCards;
  }, [isPlayDisabled, isPlayingCards, selectedCards.length]);

  return (
    <View style={styles.actionButtons}>
      {/* Task #645: Live region Text announces turn/selection state changes */}
      <Text
        style={styles.srOnly}
        accessibilityLiveRegion="polite"
        accessibilityElementsHidden={false}
      >
        {isPlayerActive
          ? selectedCards.length > 0
            ? `Your turn. ${selectedCards.length} card${selectedCards.length !== 1 ? 's' : ''} selected.`
            : 'Your turn. Select cards to play.'
          : ''}
      </Text>
      <Pressable
        style={[styles.actionButton, styles.passButton, isPassDisabled && styles.buttonDisabled]}
        onPress={handlePass}
        disabled={isPassDisabled}
        accessibilityRole="button"
        accessibilityLabel="Pass turn"
        accessibilityHint="Skips your turn and passes to the next player"
        accessibilityState={{ disabled: isPassDisabled }}
      >
        {isPassing ? (
          <ActivityIndicator
            color={COLORS.gray.light}
            size="small"
            accessibilityLabel="Passing turn"
          />
        ) : (
          <Text style={[styles.actionButtonText, styles.passButtonText]}>
            {i18n.t('game.pass')}
          </Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.actionButton, styles.playButton, isPlayDisabled && styles.buttonDisabled]}
        onPress={() => {
          if (isPlayDisabled) return;
          handlePlayCards(selectedCards);
        }}
        disabled={isPlayDisabled}
        accessibilityRole="button"
        accessibilityLabel={playLabel}
        accessibilityHint="Plays your selected cards onto the table"
        accessibilityState={{ disabled: isPlayDisabled }}
      >
        {isPlayingCards ? (
          <ActivityIndicator color={COLORS.white} size="small" accessibilityLabel="Playing cards" />
        ) : (
          <Text style={styles.actionButtonText}>{i18n.t('game.play')}</Text>
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
  // Task #645: Screen-reader-only live region; visually hidden but announced by VoiceOver/TalkBack
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
  actionButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: 12, // MATCH LANDSCAPE: 12pt radius (was 8)
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
    backgroundColor: '#374151', // MATCH LANDSCAPE: Dark gray (was COLORS.gray.medium)
    borderWidth: 1,
    borderColor: '#6b7280',
  },
  playButton: {
    backgroundColor: '#10b981', // MATCH LANDSCAPE: Green (was COLORS.primary - blue)
    borderWidth: 0, // MATCH LANDSCAPE: No border
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
    color: '#D1D5DB', // MATCH LANDSCAPE: Light gray text (was COLORS.gray.light)
  },
});

export const GameControls = React.memo(GameControlsComponent);
