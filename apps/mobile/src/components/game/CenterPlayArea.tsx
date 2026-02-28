import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Card from './Card';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, CENTER_PLAY } from '../../constants';
import { i18n } from '../../i18n';
import { sortCardsForDisplay } from '../../utils/cardSorting';
import type { Card as CardType } from '../../game/types';

interface CenterPlayAreaProps {
  lastPlayed: CardType[] | null;
  lastPlayedBy: string | null; // Player who played last (null before first play)
  combinationType?: string | null; // Raw combo type for sorting: "Straight", "Flush", etc.
  comboDisplayText?: string; // Formatted display text: "Straight to 6", "Flush ♥ (A high)", etc.
}

export default function CenterPlayArea({
  lastPlayed,
  lastPlayedBy,
  combinationType,
  comboDisplayText,
}: CenterPlayAreaProps) {
  // Sort cards for display (highest card first - Task #313)
  // This ensures straights show as 6-5-4-3-2 instead of 3-4-5-6-2
  // Use raw combinationType (not formatted text) for proper sorting
  const displayCards = useMemo(() => {
    if (!lastPlayed || lastPlayed.length === 0) return [];
    return sortCardsForDisplay(lastPlayed, combinationType || undefined);
  }, [lastPlayed, combinationType]);

  // Memoize card wrapper styles to prevent React freeze error
  // Creating style objects inline causes React dev mode freeze issues
  const cardWrapperStyles = useMemo(() => {
    if (!displayCards || displayCards.length === 0) return [];
    return displayCards.map((_, index) => ({
      marginLeft: index > 0 ? CENTER_PLAY.cardSpacing : CENTER_PLAY.cardFirstMargin,
      zIndex: index,
    }));
  }, [displayCards]);

  if (displayCards.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{i18n.t('game.noCardsYet')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Cards display - Task #313: Cards sorted with highest first */}
      <View style={styles.cardsContainer}>
        {displayCards.map((card, index) => (
          <View
            key={card.id}
            style={[
              styles.cardWrapper,
              cardWrapperStyles[index],
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
      {lastPlayedBy && (
        <Text style={styles.lastPlayedText} numberOfLines={1}>
          {i18n.t('game.lastPlayedBy')} {lastPlayedBy}: {comboDisplayText || 'Cards'}
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
