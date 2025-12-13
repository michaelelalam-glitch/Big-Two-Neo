/**
 * CardImage Component for Scoreboard
 * Displays text-based card rendering (SVG images cause freeze errors in dev mode)
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface CardImageProps {
  rank: string; // A, 2-10, J, Q, K
  suit: string; // H, D, C, S
  width?: number;
  height?: number;
}

// Suit colors matching game cards
const SUIT_COLORS: Record<string, string> = {
  H: '#ef4444', // Hearts (red)
  D: '#ef4444', // Diamonds (red)
  C: '#1f2937', // Clubs (black)
  S: '#1f2937', // Spades (black)
};

// Suit symbols
const SUIT_SYMBOLS: Record<string, string> = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠',
};

/**
 * Renders a text-based card (avoids SVG freeze issues)
 * Used in scoreboard play history to show cards played
 */
const CardImageComponent: React.FC<CardImageProps> = ({
  rank,
  suit,
  width = 35,
  height = 51,
}) => {
  // Normalize rank and suit to uppercase
  const normalizedRank = String(rank).toUpperCase();
  const normalizedSuit = String(suit).toUpperCase();
  
  const suitSymbol = SUIT_SYMBOLS[normalizedSuit] || '?';
  const suitColor = SUIT_COLORS[normalizedSuit] || '#1f2937';
  
  return (
    <View style={[styles.card, { width, height }]}>
      {/* Top-left corner */}
      <View style={styles.corner}>
        <Text style={[styles.rank, { color: suitColor }]}>{normalizedRank}</Text>
        <Text style={[styles.suit, { color: suitColor }]}>{suitSymbol}</Text>
      </View>

      {/* Center suit */}
      <Text style={[styles.centerSuit, { color: suitColor }]}>
        {suitSymbol}
      </Text>

      {/* Bottom-right corner (rotated) */}
      <View style={[styles.corner, styles.cornerBottom]}>
        <Text style={[styles.rank, { color: suitColor }]}>
          {normalizedRank}
        </Text>
        <Text style={[styles.suit, { color: suitColor }]}>
          {suitSymbol}
        </Text>
      </View>
    </View>
  );
};

export const CardImage = React.memo(CardImageComponent);
CardImage.displayName = 'CardImage';

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#d1d5db',
    padding: 2,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    top: 2,
    left: 2,
    alignItems: 'center',
  },
  cornerBottom: {
    top: undefined,
    left: undefined,
    bottom: 2,
    right: 2,
    transform: [{ rotate: '180deg' }],
  },
  rank: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  suit: {
    fontSize: 9,
    lineHeight: 10,
  },
  centerSuit: {
    position: 'absolute',
    fontSize: 16,
    fontWeight: '600',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -8 }, { translateY: -10 }],
  },
});
