/**
 * LandscapeYourPosition Component
 * 
 * Bottom player position with card hand display for landscape mode
 * 
 * Features:
 * - Player profile display (name + card count badge)
 * - Horizontal card hand with adaptive overlap
 * - 72×104pt cards (1.4444 aspect ratio)
 * - 50% overlap (36pt spacing) by default
 * - Lift-up selection animation
 * - Touch-optimized (44pt minimum target)
 * 
 * Task #452: Build bottom player position with card hand display
 * Date: December 19, 2025
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import type { Card as CardType } from '../../game/types';
import LandscapeCard from './LandscapeCard';
import { calculateCardOverlap } from '../../utils/cardOverlap';
import { i18n } from '../../i18n';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface LandscapeYourPositionProps {
  /** Player name */
  playerName: string;
  /** Player's cards */
  cards: CardType[];
  /** Selected card IDs */
  selectedCardIds: Set<string>;
  /** Card selection handler */
  onCardSelect: (cardId: string) => void;
  /** Is player's turn */
  isActive: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Container width for adaptive overlap */
  containerWidth?: number;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LandscapeYourPosition({
  playerName,
  cards,
  selectedCardIds,
  onCardSelect,
  isActive,
  disabled = false,
  containerWidth = 932, // Default: iPhone 17 landscape width
}: LandscapeYourPositionProps) {
  // Calculate adaptive card overlap
  const { cardSpacing, totalWidth } = useMemo(() => {
    return calculateCardOverlap(
      cards.length,
      72, // Card width
      containerWidth - 40, // Available width (minus padding)
      36, // Preferred spacing (50% overlap = 72 * 0.5)
      20  // Minimum spacing
    );
  }, [cards.length, containerWidth]);

  // Render card badge (top-right corner)
  const renderBadge = () => {
    const cardCount = cards.length;
    
    return (
      <View style={styles.badgeContainer}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{cardCount}</Text>
        </View>
      </View>
    );
  };

  // Empty state (no cards)
  if (cards.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.playerInfo}>
          <Text style={[styles.playerName, isActive && styles.playerNameActive]}>
            {playerName}
          </Text>
          {renderBadge()}
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{i18n.t('game.noCards')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="landscape-your-position">
      {/* Player Info Row */}
      <View style={styles.playerInfo}>
        <Text style={[styles.playerName, isActive && styles.playerNameActive]}>
          {playerName}
        </Text>
        {renderBadge()}
      </View>

      {/* Card Hand */}
      <View 
        style={[styles.cardsContainer, { width: totalWidth }]}
        testID="cards-container"
      >
        {cards.map((card, index) => {
          const isSelected = selectedCardIds.has(card.id);
          
          return (
            <Pressable
              key={card.id}
              style={[
                styles.cardWrapper,
                {
                  marginLeft: index > 0 ? cardSpacing : 0,
                  zIndex: isSelected ? 1000 + index : index,
                  transform: [{ translateY: isSelected ? -20 : 0 }], // Lift selected cards
                },
              ]}
              onPress={() => !disabled && onCardSelect(card.id)}
              disabled={disabled}
              testID={`card-${card.id}`}
            >
              <LandscapeCard 
                card={card}
                size="base" // 72×104pt for player hand
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },

  // Player info row
  playerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    gap: 8,
  },

  playerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },

  playerNameActive: {
    color: '#10b981', // Green for active player
    fontWeight: '700',
  },

  // Badge
  badgeContainer: {
    position: 'relative',
  },

  badge: {
    minWidth: 44,
    height: 44,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#10b981',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },

  badgeText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#10b981',
  },

  // Cards container
  cardsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end', // Align cards to bottom
    justifyContent: 'center',
    minHeight: 104, // Card height
  },

  cardWrapper: {
    // Positioning and z-index applied inline
  },

  // Empty state
  emptyState: {
    padding: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderStyle: 'dashed',
    minHeight: 104,
    justifyContent: 'center',
    alignItems: 'center',
  },

  emptyText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});

export default LandscapeYourPosition;
