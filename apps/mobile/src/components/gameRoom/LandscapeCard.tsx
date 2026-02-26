/**
 * Landscape Card Component
 * 
 * Text-based card rendering for landscape game room
 * Matches the portrait mode Card.tsx styling (white background, text symbols)
 * 
 * Part of Task #449: Create card rendering system (same effects as portrait mode)
 * Date: December 18, 2025
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { COLORS, SPACING, CARD_FONTS, TYPOGRAPHY } from '../../constants';
import { LANDSCAPE_DIMENSIONS } from '../../constants/landscape';
import type { Card as CardType } from '../../game/types';

interface LandscapeCardProps {
  card: CardType;
  size?: 'base' | 'compact' | 'center' | 'hand'; // Size variants from landscape.ts
  style?: ViewStyle;
}

// Suit colors matching portrait mode Card.tsx
const SUIT_COLORS: Record<string, string> = {
  H: COLORS.card.hearts,   // Hearts (red)
  D: COLORS.card.diamonds, // Diamonds (red)
  C: COLORS.card.clubs,    // Clubs (black)
  S: COLORS.card.spades,   // Spades (black)
};

// Suit symbols
const SUIT_SYMBOLS: Record<string, string> = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠',
};

/**
 * Landscape Card Component
 * Displays cards in landscape mode with same visual style as portrait mode
 */
const LandscapeCard: React.FC<LandscapeCardProps> = ({
  card,
  size = 'base',
  style,
}) => {
  // Get dimensions based on size variant
  const dimensions = useMemo(() => {
    const cardDimensions = LANDSCAPE_DIMENSIONS.cards[size];
    return {
      width: cardDimensions.width,
      height: cardDimensions.height,
      borderRadius: cardDimensions.borderRadius,
    };
  }, [size]);

  // Calculate font scaling based on card size
  const sizeScale = useMemo(() => {
    switch (size) {
      case 'compact':
        return 0.44; // 32/72 ≈ 0.44
      case 'center':
        return 0.97; // 70/72 ≈ 0.97
      case 'hand':
        return 0.83; // 60/72 ≈ 0.83 (matches portrait hand cards)
      case 'base':
      default:
        return 1.0;
    }
  }, [size]);

  const suitColor = SUIT_COLORS[card.suit] || '#212121';
  const suitSymbol = SUIT_SYMBOLS[card.suit] || card.suit;

  // Memoized text styles with scaling
  const rankStyle = useMemo(() => ({
    color: suitColor,
    fontSize: CARD_FONTS.rankFontSize * sizeScale,
    fontWeight: 'bold' as const,
    lineHeight: TYPOGRAPHY.rankLineHeight,
  }), [suitColor, sizeScale]);

  const suitStyle = useMemo(() => ({
    color: suitColor,
    fontSize: CARD_FONTS.suitFontSize * sizeScale,
    lineHeight: TYPOGRAPHY.suitLineHeight,
  }), [suitColor, sizeScale]);

  const centerSuitStyle = useMemo(() => ({
    color: suitColor,
    fontSize: CARD_FONTS.centerSuitFontSize * sizeScale,
    textAlign: 'center' as const,
    marginTop: CARD_FONTS.centerSuitMarginTop * sizeScale,
  }), [suitColor, sizeScale]);

  return (
    <View
      style={[
        styles.container,
        {
          width: dimensions.width,
          height: dimensions.height,
          borderRadius: dimensions.borderRadius,
        },
        style,
      ]}
      accessible={true}
      accessibilityLabel={`${card.rank} of ${suitSymbol}`}
      accessibilityRole="image"
    >
      {/* Text-based card rendering (matches portrait mode) */}
      <View style={styles.card}>
        {/* Top-left corner */}
        <View style={styles.corner}>
          <Text style={rankStyle}>{card.rank}</Text>
          <Text style={suitStyle}>{suitSymbol}</Text>
        </View>

        {/* Center suit symbol */}
        <Text style={centerSuitStyle}>
          {suitSymbol}
        </Text>

        {/* Bottom-right corner (rotated 180°) */}
        <View style={[styles.corner, styles.cornerBottom]}>
          <Text style={rankStyle}>{card.rank}</Text>
          <Text style={suitStyle}>{suitSymbol}</Text>
        </View>
      </View>
    </View>
  );
};

// Component styles matching portrait mode Card.tsx
const styles = StyleSheet.create({
  container: {
    // Shadow for depth (matches portrait mode)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  card: {
    width: '100%',
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: SPACING.xs,
  },
  corner: {
    position: 'absolute',
    top: 2,
    left: 2,
    alignItems: 'flex-start',
  },
  cornerBottom: {
    top: undefined,
    left: undefined,
    bottom: 2,
    right: 2,
    alignItems: 'flex-end',
    transform: [{ rotate: '180deg' }],
  },
});

export default React.memo(LandscapeCard);
