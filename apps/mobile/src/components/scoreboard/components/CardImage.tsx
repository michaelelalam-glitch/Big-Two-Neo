/**
 * CardImage Component for Scoreboard
 * Displays card SVG images from assets
 */

import React from 'react';
import { View, Image, StyleSheet, StyleProp, ImageStyle } from 'react-native';
import { getCardAsset } from '../../../utils/cardAssets';

interface CardImageProps {
  rank: string; // A, 2-10, J, Q, K
  suit: string; // H, D, C, S
  width?: number;
  height?: number;
  style?: StyleProp<ImageStyle>;
}

/**
 * Renders a card image from SVG assets
 * Used in scoreboard play history to show cards played
 */
export const CardImage: React.FC<CardImageProps> = ({
  rank,
  suit,
  width = 35,
  height = 51,
  style,
}) => {
  const cardAsset = getCardAsset(rank, suit);
  
  if (!cardAsset) {
    // Fallback for invalid card
    return (
      <View style={[styles.fallback, { width, height }, style]}>
        <View style={styles.fallbackInner} />
      </View>
    );
  }
  
  return (
    <Image
      source={cardAsset}
      style={[styles.card, { width, height }, style]}
      resizeMode="contain"
    />
  );
};

const styles = StyleSheet.create({
  card: {
    // Default styling for card images
  },
  fallback: {
    backgroundColor: '#f3f4f6',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackInner: {
    width: '60%',
    height: '80%',
    backgroundColor: '#e5e7eb',
    borderRadius: 1,
  },
});
