import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Card from './Card';
import { sortHand } from '../../game/engine/game-logic';
import type { Card as CardType } from '../../game/types';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';

// Removed CARD_HAND_MAX_HEIGHT - cards fit without scrolling on most devices
// With 13 cards: 60px + (12 × 20px overlap) = 300px total width
// If needed for very small screens, could add conditional ScrollView

interface CardHandProps {
  cards: CardType[];
  onPlayCards: (selectedCards: CardType[]) => void;
  onPass: () => void;
  canPlay?: boolean;
  disabled?: boolean;
  hideButtons?: boolean; // New prop to hide internal buttons
}

export default function CardHand({
  cards,
  onPlayCards,
  onPass,
  canPlay = true,
  disabled = false,
  hideButtons = false,
}: CardHandProps) {
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());

  // Sort cards (memoized to avoid re-sorting on every render)
  // sortHand returns ascending order for visual display:
  // lowest rank (3) appears on the LEFT, highest (2) on the RIGHT in the card hand
  const sortedCards = useMemo(() => sortHand(cards), [cards]);

  // Toggle card selection (memoized to prevent card re-renders)
  const handleToggleSelect = useCallback((cardId: string) => {
    if (disabled) return;

    setSelectedCardIds((prev) => {
      const newSet = new Set(prev);
      const wasSelected = newSet.has(cardId);
      
      if (wasSelected) {
        newSet.delete(cardId);
        // Light haptic for deselection
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        newSet.add(cardId);
        // Medium haptic for selection (more pronounced feedback)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      
      return newSet;
    });
  }, [disabled]); // selectedCardIds removed from deps - state updates use functional form (prev) to avoid stale closures

  // Clear selection (memoized)
  const handleClearSelection = useCallback(() => {
    setSelectedCardIds(new Set());
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // Play selected cards (memoized)
  const handlePlay = useCallback(() => {
    if (selectedCardIds.size === 0) return;

    const selected = sortedCards.filter((card) => selectedCardIds.has(card.id));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onPlayCards(selected);
    setSelectedCardIds(new Set());
  }, [selectedCardIds, sortedCards, onPlayCards]);

  // Pass turn (memoized)
  const handlePass = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPass();
    // Note: Keep selection intact after pass - user may want to adjust before playing
    // setSelectedCardIds(new Set()); // Removed per Copilot feedback
  }, [onPass]);

  // Sort is automatic by rank/suit
  // Future enhancement: Add different sort options

  return (
    <SafeAreaView edges={['bottom']} style={styles.container}>
      {/* Card display area with horizontal scroll for small screens */}
      <View style={styles.cardsWrapper}>
        {sortedCards.map((card, index) => (
          <Card
            key={card.id}
            card={card}
            isSelected={selectedCardIds.has(card.id)}
            onToggleSelect={handleToggleSelect}
            disabled={disabled}
            style={{ zIndex: index }}
          />
        ))}
      </View>

      {/* Action buttons - only show if not hidden */}
      {!hideButtons && (
        <View style={styles.actionsContainer}>
          {/* Selection info */}
          {selectedCardIds.size > 0 && (
            <Pressable 
              style={styles.clearButton} 
              onPress={handleClearSelection}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${selectedCardIds.size} selected card${selectedCardIds.size !== 1 ? 's' : ''}`}
            >
              <Text style={styles.clearButtonText}>
                Clear ({selectedCardIds.size})
              </Text>
            </Pressable>
          )}

          {/* Main actions */}
          <View style={styles.mainActions}>
            <Pressable
              style={[styles.button, styles.passButton, !canPlay && styles.buttonDisabled]}
              onPress={handlePass}
              disabled={!canPlay || disabled}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Pass turn"
              accessibilityState={{ disabled: !canPlay || disabled }}
            >
              <Text style={[styles.buttonText, styles.passButtonText]}>Pass</Text>
            </Pressable>

            <Pressable
              style={[
                styles.button,
                styles.playButton,
                (selectedCardIds.size === 0 || !canPlay || disabled) &&
                  styles.buttonDisabled,
              ]}
              onPress={handlePlay}
              disabled={selectedCardIds.size === 0 || !canPlay || disabled}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Play ${selectedCardIds.size} selected card${selectedCardIds.size !== 1 ? 's' : ''}`}
              accessibilityState={{ disabled: selectedCardIds.size === 0 || !canPlay || disabled }}
            >
              <Text style={styles.buttonText}>
                Play {selectedCardIds.size > 0 ? `(${selectedCardIds.size})` : ''}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.primary,
  },
  cardsWrapper: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center', // Center the cards horizontally
  },
  actionsContainer: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  // Reserved for future sort options feature (Task #266+)
  clearButton: {
    alignSelf: 'flex-start',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.gray.medium,
    borderRadius: 8,
  },
  clearButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  mainActions: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  button: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    backgroundColor: COLORS.accent,
  },
  passButton: {
    backgroundColor: COLORS.gray.dark,
    borderWidth: 1,
    borderColor: COLORS.gray.medium,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  passButtonText: {
    color: COLORS.gray.light,
  },
});
