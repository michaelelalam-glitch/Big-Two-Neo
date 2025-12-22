/**
 * CardCountBadge Component
 * 
 * Displays a player's remaining card count with risk-based colors and a glow effect when they are close to winning.
 * 
 * Features:
 * - Green: 13-10 cards (safe zone)
 * - Yellow: 9-6 cards (warning zone)
 * - Red: 5-2 cards (danger zone)
 * - Glowing Red: 1 card (critical - about to win)
 * 
 * Date: December 18, 2025
 */

import React, { useEffect, useRef } from 'react';
import { Text, StyleSheet, Animated } from 'react-native';

export interface CardCountBadgeProps {
  /** Number of cards in player's hand */
  cardCount: number;
  /** Whether to show badge (hide when game is finished) */
  visible?: boolean;
}

/**
 * Get badge background color based on card count
 */
const getBadgeColor = (count: number): string => {
  if (count >= 10) return '#4CAF50'; // Green
  if (count >= 6) return '#F9A825'; // Amber (darker for WCAG AA contrast 4.5:1 with black text)
  if (count >= 2) return '#F44336'; // Red
  return '#F44336'; // Red (for 1 card - will have glow)
};

/**
 * Get text color based on background
 */
const getTextColor = (count: number): string => {
  // Yellow needs dark text, others use white
  return count >= 6 && count < 10 ? '#000000' : '#FFFFFF';
};

export const CardCountBadge: React.FC<CardCountBadgeProps> = ({ 
  cardCount, 
  visible = true 
}) => {
  const glowAnim = useRef(new Animated.Value(1)).current;
  const shouldGlow = cardCount === 1;

  // Glow animation for 1 card remaining
  useEffect(() => {
    if (!shouldGlow) {
      glowAnim.setValue(1);
      return;
    }

    // Pulsing glow animation
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1.3,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [shouldGlow, glowAnim]);

  if (!visible) return null;

  const backgroundColor = getBadgeColor(cardCount);
  const textColor = getTextColor(cardCount);

  return (
    <Animated.View
      style={[
        styles.badge,
        { backgroundColor },
        shouldGlow && {
          transform: [{ scale: glowAnim }],
          shadowColor: '#F44336',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 8,
          elevation: 8,
        },
      ]}
    >
      <Text style={[styles.badgeText, { color: textColor }]}>
        {cardCount}
      </Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  badge: {
    minWidth: 32,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
});

export default CardCountBadge;
