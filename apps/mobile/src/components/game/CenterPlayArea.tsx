import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Card from './Card';
import type { Card as CardType } from '../../game/types';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, CENTER_PLAY } from '../../constants';

interface CenterPlayAreaProps {
  lastPlayed: CardType[] | null;
  lastPlayedBy: string | null; // Player who played last (null before first play)
  combinationType?: string; // e.g., "Full house (A)", "Pair", "Single"
}

export default function CenterPlayArea({
  lastPlayed,
  lastPlayedBy,
  combinationType,
}: CenterPlayAreaProps) {
  if (!lastPlayed || lastPlayed.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No cards played yet</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Cards display */}
      <View style={styles.cardsContainer}>
        {lastPlayed.map((card, index) => (
          <View
            key={card.id}
            style={[
              styles.cardWrapper,
              { 
                marginLeft: index > 0 ? CENTER_PLAY.cardSpacing : CENTER_PLAY.cardFirstMargin, // Small gap between cards, no overlap
                zIndex: index,
              },
            ]}
          >
            <Card 
              card={card} 
              isSelected={false} 
              onToggleSelect={() => {}} // No-op for display-only cards
              disabled={true}
              size="table" // Use smaller table card dimensions (47×72)
            />
          </View>
        ))}
      </View>

      {/* Last played text - directly on felt, white text */}
      {lastPlayedBy && lastPlayed && lastPlayed.length > 0 && (
        <Text style={styles.lastPlayedText} numberOfLines={1}>
          Last played by {lastPlayedBy}: {combinationType || 'Cards'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    padding: SPACING.xl,
    backgroundColor: OVERLAYS.emptyStateBackground,
    borderRadius: CENTER_PLAY.emptyStateBorderRadius,
    borderWidth: CENTER_PLAY.emptyStateBorderWidth,
    borderColor: OVERLAYS.emptyStateBorder,
    borderStyle: 'dashed',
  },
  emptyText: {
    color: COLORS.gray.light,
    fontSize: FONT_SIZES.md,
    fontStyle: 'italic',
  },
  cardsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    height: LAYOUT.centerPlayHeightTable, // Adjusted for smaller table cards (72px + padding)
    overflow: 'visible', // Make sure cards aren't clipped
  },
  cardWrapper: {
    // Individual card positioning handled by marginLeft and zIndex
  },
  lastPlayedText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm, // Smaller to fit on one line
    fontWeight: '600',
    textAlign: 'center',
  },
});
