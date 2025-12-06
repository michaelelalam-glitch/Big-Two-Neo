import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
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
  H: COLORS.card.hearts, // Hearts (red)
  D: COLORS.card.diamonds, // Diamonds (red)
  C: COLORS.card.clubs, // Clubs (black)
  S: COLORS.card.spades, // Spades (black)
};

const SUIT_SYMBOLS: Record<string, string> = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠',
};

const Card = React.memo(function Card({
  card,
  isSelected,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  disabled = false,
}: CardProps) {
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);

  // Tap gesture for selection (memoized for performance)
  // Note: Haptic feedback handled by CardHand to avoid duplicate feedback
  const tapGesture = useMemo(
    () => Gesture.Tap()
      .enabled(!disabled)
      .onStart(() => {
        'worklet';
        scale.value = withSpring(0.95, { damping: 10 });
      })
      .onEnd(() => {
        'worklet';
        scale.value = withSpring(1, { damping: 10 });
        runOnJS(onToggleSelect)(card.id);
      }),
    [disabled, card.id, onToggleSelect, scale]
  );

  // Pan gesture for dragging (future enhancement, memoized for performance)
  const panGesture = useMemo(
    () => Gesture.Pan()
      .enabled(!disabled && isSelected)
      .onStart(() => {
        'worklet';
        if (onDragStart) {
          runOnJS(onDragStart)();
        }
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      })
      .onUpdate((event) => {
        'worklet';
        // Only allow upward dragging
        translateY.value = Math.min(0, event.translationY);
      })
      .onEnd(() => {
        'worklet';
        // Snap to play zone if dragged far enough
        if (translateY.value < DRAG_TO_PLAY_THRESHOLD) {
          // TODO: Implement play action in Task #266
          // For now, just provide feedback but don't actually play
          runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success);
        }
        translateY.value = withSpring(0);
        if (onDragEnd) {
          runOnJS(onDragEnd)();
        }
      }),
    [disabled, isSelected, translateY, onDragStart, onDragEnd]
  );

  // Use Race instead of Exclusive - tap has priority over pan
  // Race will complete with the first gesture that activates
  const composedGesture = useMemo(
    () => Gesture.Race(tapGesture, panGesture),
    [tapGesture, panGesture]
  );

  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
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
      <Animated.View 
        style={[styles.container, animatedStyle]}
        accessible={true}
        accessibilityLabel={`${card.rank} of ${suitSymbol}`}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected, disabled: disabled }}
        accessibilityHint="Double tap to select or deselect this card"
      >
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
});

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

export default Card;
