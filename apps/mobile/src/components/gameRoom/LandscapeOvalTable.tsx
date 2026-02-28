/**
 * LandscapeOvalTable Component
 * 
 * Poker-style oval play area for landscape game room
 * 
 * Features:
 * - 420×240pt oval shape (iPhone 17 base)
 * - Green poker table gradient background
 * - Displays last played cards in center
 * - Shows combo type and player name
 * - Adaptive sizing for tablets
 * 
 * Task #455: Implement oval poker table play area
 * Date: December 19, 2025
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../../constants';
import { i18n } from '../../i18n';
import { sortCardsForDisplay } from '../../utils/cardSorting';
import type { Card as CardType } from '../../game/types';
import LandscapeCard from './LandscapeCard';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface LandscapeOvalTableProps {
  /** Last played cards (sorted by rank/suit) */
  lastPlayed: CardType[] | null;
  /** Player who made last play */
  lastPlayedBy: string | null;
  /** Raw combo type for card sorting (e.g., "Straight", "Flush") */
  combinationType?: string | null;
  /** Formatted display text (e.g., "Straight to 6", "Flush ♥ (A high)") */
  comboDisplayText?: string;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LandscapeOvalTable({
  lastPlayed,
  lastPlayedBy,
  combinationType,
  comboDisplayText,
}: LandscapeOvalTableProps) {
  // Sort cards for display (highest card first - matches portrait CenterPlayArea)
  // This ensures straights show as 6-5-4-3-2 instead of 3-4-5-6-2
  const displayCards = useMemo(() => {
    if (!lastPlayed || lastPlayed.length === 0) return [];
    return sortCardsForDisplay(lastPlayed, combinationType || undefined);
  }, [lastPlayed, combinationType]);

  // Memoize card positioning styles to prevent React freeze
  const cardWrapperStyles = useMemo(() => {
    if (!displayCards || displayCards.length === 0) return [];
    return displayCards.map((_, index) => ({
      marginLeft: index > 0 ? 8 : 0, // 8pt spacing between cards
      zIndex: index,
    }));
  }, [displayCards]);

  // Empty state (no cards played yet)
  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText}>{i18n.t('game.noCardsYet')}</Text>
    </View>
  );

  // Active state (cards displayed)
  const renderPlayedCards = () => (
    <>
      {/* Cards container */}
      <View style={styles.cardsContainer}>
        {displayCards.map((card, index) => (
          <View
            key={card.id}
            style={[
              styles.cardWrapper,
              cardWrapperStyles[index],
            ]}
          >
            <LandscapeCard 
              card={card}
              size="hand" // 60×84pt - matches portrait hand card size
            />
          </View>
        ))}
      </View>

      {/* Combined last play info: "Last played by {player}: {combo}" in white */}
      {(lastPlayedBy || comboDisplayText) && (
        <Text style={styles.lastPlayInfo} numberOfLines={1}>
          {lastPlayedBy
            ? comboDisplayText
              ? `${i18n.t('game.lastPlayedBy')} ${lastPlayedBy}: ${comboDisplayText}`
              : `${i18n.t('game.lastPlayedBy')} ${lastPlayedBy}`
            : comboDisplayText}
        </Text>
      )}
    </>
  );

  return (
    <View
      style={styles.container}
      testID="oval-table-container"
    >
      <View style={styles.innerContent}>
        {displayCards.length === 0 ? renderEmptyState() : renderPlayedCards()}
      </View>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  // Oval poker table container (matches portrait table color)
  container: {
    width: 420,
    height: 240,
    borderRadius: 120, // Half of height for oval ends
    borderWidth: 5,
    borderColor: COLORS.table.border, // #7A7A7A - matches portrait
    backgroundColor: COLORS.table.background, // #4A7C59 - green felt (matches portrait)
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    // Shadow for depth (matches portrait)
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8, // Android shadow
  },

  // Inner content wrapper
  innerContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },

  // Empty state (no cards)
  emptyState: {
    padding: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderStyle: 'dashed',
  },

  emptyText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
  },

  // Last play info (combined player + combo, white)
  lastPlayInfo: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
    marginTop: 6,
    textAlign: 'center',
  },

  // Cards container
  cardsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
    maxWidth: 280, // Fit 5 cards (48×5 + 32 gaps)
    overflow: 'visible', // Don't clip cards
  },

  // Individual card wrapper
  cardWrapper: {
    // Positioning handled by marginLeft and zIndex
  },

});

