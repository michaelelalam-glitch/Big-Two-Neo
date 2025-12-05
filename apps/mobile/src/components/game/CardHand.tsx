import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Card from './Card';
import { sortHand } from '../../game/engine/game-logic';
import type { Card as CardType } from '../../game/types';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';

interface CardHandProps {
  cards: CardType[];
  onPlayCards: (selectedCards: CardType[]) => void;
  onPass: () => void;
  canPlay?: boolean;
  disabled?: boolean;
}

export default function CardHand({
  cards,
  onPlayCards,
  onPass,
  canPlay = true,
  disabled = false,
}: CardHandProps) {
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());

  // Sort cards (memoized to avoid re-sorting on every render)
  const sortedCards = useMemo(() => sortHand(cards), [cards]);

  // Toggle card selection
  const handleToggleSelect = (cardId: string) => {
    if (disabled) return;

    setSelectedCardIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(cardId)) {
        newSet.delete(cardId);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        newSet.add(cardId);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      return newSet;
    });
  };

  // Clear selection
  const handleClearSelection = () => {
    setSelectedCardIds(new Set());
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Play selected cards
  const handlePlay = () => {
    if (selectedCardIds.size === 0) return;

    const selected = sortedCards.filter((card) => selectedCardIds.has(card.id));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onPlayCards(selected);
    setSelectedCardIds(new Set());
  };

  // Pass turn
  const handlePass = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPass();
    setSelectedCardIds(new Set());
  };

  // Sort is automatic by rank/suit
  // Future enhancement: Add different sort options

  return (
    <SafeAreaView edges={['bottom']} style={styles.container}>
      {/* Card display area */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cardsContainer}
        style={styles.cardsScroll}
      >
        {sortedCards.map((card) => (
          <Card
            key={card.id}
            card={card}
            isSelected={selectedCardIds.has(card.id)}
            onToggleSelect={handleToggleSelect}
            disabled={disabled}
          />
        ))}
      </ScrollView>

      {/* Action buttons */}
      <View style={styles.actionsContainer}>
        {/* Selection info */}
        {selectedCardIds.size > 0 && (
          <Pressable style={styles.clearButton} onPress={handleClearSelection}>
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
          >
            <Text style={styles.buttonText}>
              Play {selectedCardIds.size > 0 ? `(${selectedCardIds.size})` : ''}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.primary,
  },
  cardsScroll: {
    maxHeight: 120,
  },
  cardsContainer: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  actionsContainer: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  // TODO: sortButton and sortButtonText reserved for future sort options feature
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
