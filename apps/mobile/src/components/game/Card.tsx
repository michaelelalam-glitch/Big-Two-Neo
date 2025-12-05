import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import type { Card as CardType } from '../../game/types';
import { COLORS, SPACING } from '../../constants';

interface CardProps {
  card: CardType;
  isSelected: boolean;
  onToggleSelect: (cardId: string) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  disabled?: boolean;
}

const CARD_WIDTH = 60;
const CARD_HEIGHT = 84;
const SELECTED_OFFSET = -20; // Offset for selected card elevation
const DRAG_TO_PLAY_THRESHOLD = -80; // Drag distance to trigger play
const CARD_OVERLAP_MARGIN = -8; // Negative margin for card overlap effect

// Suit colors and symbols
const SUIT_COLORS: Record<string, string> = {
  H: '#E53935', // Hearts (red)
  D: '#E53935', // Diamonds (red)
  C: '#212121', // Clubs (black)
  S: '#212121', // Spades (black)
};

const SUIT_SYMBOLS: Record<string, string> = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠',
};

export default function Card({
  card,
  isSelected,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  disabled = false,
}: CardProps) {
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);

  // Tap gesture for selection
  // Note: Haptic feedback handled by CardHand to avoid duplicate feedback
  const tapGesture = Gesture.Tap()
    .enabled(!disabled)
    .onStart(() => {
      scale.value = withSpring(0.95, { damping: 10 });
    })
    .onEnd(() => {
      scale.value = withSpring(1, { damping: 10 });
      onToggleSelect(card.id);
    });

  // Pan gesture for dragging (future enhancement)
  const panGesture = Gesture.Pan()
    .enabled(!disabled && isSelected)
    .onStart(() => {
      onDragStart?.();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    })
    .onUpdate((event) => {
      // Only allow upward dragging
      translateY.value = Math.min(0, event.translationY);
    })
    .onEnd(() => {
      // Snap to play zone if dragged far enough
      if (translateY.value < DRAG_TO_PLAY_THRESHOLD) {
        // TODO: Implement play action in Task #266
        // For now, just provide feedback but don't actually play
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      translateY.value = withSpring(0);
      onDragEnd?.();
    });

  // Use Exclusive instead of Race - tap has priority, pan only works when dragging
  const composedGesture = Gesture.Exclusive(tapGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => {
    const selectedOffset = isSelected ? SELECTED_OFFSET : 0;
    return {
      transform: [
        { translateY: selectedOffset + translateY.value },
        { scale: scale.value },
      ],
      zIndex: isSelected ? 10 : 1,
    };
  });

  const suitColor = SUIT_COLORS[card.suit] || '#212121';
  const suitSymbol = SUIT_SYMBOLS[card.suit] || card.suit;

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={[styles.container, animatedStyle]}>
        <View style={[styles.card, isSelected && styles.cardSelected]}>
          {/* Top-left corner */}
          <View style={styles.corner}>
            <Text style={[styles.rank, { color: suitColor }]}>{card.rank}</Text>
            <Text style={[styles.suit, { color: suitColor }]}>{suitSymbol}</Text>
          </View>

          {/* Center suit */}
          <Text style={[styles.centerSuit, { color: suitColor }]}>
            {suitSymbol}
          </Text>

          {/* Bottom-right corner (rotated) */}
          <View style={[styles.corner, styles.cornerBottom]}>
            <Text style={[styles.rank, { color: suitColor }]}>
              {card.rank}
            </Text>
            <Text style={[styles.suit, { color: suitColor }]}>
              {suitSymbol}
            </Text>
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: CARD_OVERLAP_MARGIN, // Overlap cards slightly
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: SPACING.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  cardSelected: {
    borderColor: COLORS.accent,
    borderWidth: 2,
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  corner: {
    position: 'absolute',
    top: SPACING.xs,
    left: SPACING.xs,
    alignItems: 'center',
  },
  cornerBottom: {
    top: undefined,
    left: undefined,
    bottom: SPACING.xs,
    right: SPACING.xs,
    transform: [{ rotate: '180deg' }],
  },
  rank: {
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  suit: {
    fontSize: 14,
    lineHeight: 16,
  },
  centerSuit: {
    fontSize: 32,
    textAlign: 'center',
    marginTop: 20,
  },
});
