import React, { useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import type { Card as CardType } from '../../game/types';
import { COLORS, SPACING, CARD_FONTS, TYPOGRAPHY } from '../../constants';

interface CardProps {
  card: CardType;
  isSelected: boolean;
  onToggleSelect: (cardId: string) => void;
  onDragStart?: () => void;
  onDragEnd?: (translationX: number, translationY: number) => void; // Returns final position for drop zone detection
  onDragUpdate?: (translationX: number, translationY: number) => void; // Updated: both X and Y for drop zones
  onLongPress?: () => void; // New: long press feedback
  disabled?: boolean;
  size?: 'hand' | 'table'; // Hand: 60×84, Table: 47×72
  style?: StyleProp<ViewStyle>; // Additional styles for container (includes zIndex from parent)
  zIndex?: number; // Explicit z-index control from parent
  hasMultipleSelected?: boolean; // True if multiple cards are selected (disables rearrange, enables multi-drag)
  isDraggingGroup?: boolean; // True if this card is part of a group being dragged
  sharedDragX?: number; // Shared X translation for synchronized multi-card dragging
  sharedDragY?: number; // Shared Y translation for synchronized multi-card dragging
}

// Hand card dimensions (default)
const HAND_CARD_WIDTH = 60;
const HAND_CARD_HEIGHT = 84;

// Table card dimensions (smaller)
const TABLE_CARD_WIDTH = 47;
const TABLE_CARD_HEIGHT = 72;

const SELECTED_OFFSET = -20; // Offset for selected card elevation
const DRAG_TO_PLAY_THRESHOLD = -80; // Drag distance to trigger play
const CARD_OVERLAP_MARGIN = -40; // Negative margin for card overlap effect (13 cards fit in ~300px)

// Touch target improvements (30px touch target - balanced for fitting 13 cards while improving UX)
const TOUCH_TARGET_PADDING = 5; // Invisible padding to expand hit area (5px left/right = 10px total + 20px visible = 30px touch target)

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
  onDragUpdate,
  onLongPress,
  disabled = false,
  size = 'hand',
  style,
  zIndex = 1,
  hasMultipleSelected = false,
  isDraggingGroup = false,
  sharedDragX = 0,
  sharedDragY = 0,
}: CardProps) {
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1); // New: for long press visual feedback
  const isLongPressed = useSharedValue(false); // Track if card was long-pressed

  // Calculate dimensions based on size
  const cardWidth = size === 'table' ? TABLE_CARD_WIDTH : HAND_CARD_WIDTH;
  const cardHeight = size === 'table' ? TABLE_CARD_HEIGHT : HAND_CARD_HEIGHT;
  const sizeScale = size === 'table' ? 0.78 : 1; // 47/60 ≈ 0.78

  // FIX: Task #378 - Force opacity and scale reset when selection state changes (Android fix)
  // CRITICAL: Must use withSpring to cancel any pending animations
  // Note: Do not reset translateX/translateY here to avoid interrupting drag gestures
  useEffect(() => {
    // ALWAYS reset opacity and scale when isSelected changes
    // This prevents stale animated values from persisting on Android
    // Use withSpring to properly cancel any pending animations from drag gestures
    opacity.value = withSpring(1, { damping: 20, stiffness: 300 });
    scale.value = withSpring(1, { damping: 20, stiffness: 300 });
    // Do not reset translateX/translateY here to avoid interrupting drags
  }, [isSelected, opacity, scale]);

  // Long press gesture for visual feedback (opacity 0.7)
  const longPressGesture = useMemo(
    () => Gesture.LongPress()
      .enabled(!disabled)
      .minDuration(500)
      .onStart(() => {
        'worklet';
        isLongPressed.value = true; // Mark as long-pressed
        opacity.value = withSpring(0.7);
        scale.value = withSpring(1.05);
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Heavy);
      })
      .onEnd(() => {
        'worklet';
        opacity.value = withSpring(1);
        scale.value = withSpring(1);
        if (onLongPress) {
          runOnJS(onLongPress)();
        }
      }),
    [disabled, opacity, scale, isLongPressed, onLongPress]
  );

  // Tap gesture for selection (memoized for performance)
  // Note: Haptic feedback handled by CardHand to avoid duplicate feedback
  const tapGesture = useMemo(
    () => Gesture.Tap()
      .enabled(!disabled)
      .maxDuration(450) // Prevent conflict with long press (set < long press minDuration)
      .onStart(() => {
        'worklet';
        scale.value = withSpring(0.95, { damping: 10 });
      })
      .onEnd(() => {
        'worklet';
        scale.value = withSpring(1, { damping: 10 });
        // Opacity reset handled by useEffect on isSelected change
        runOnJS(onToggleSelect)(card.id);
      }),
    [disabled, card.id, onToggleSelect, scale]
  );

  // Pan gesture for dragging - supports both horizontal (rearrange) and vertical (play)
  // BEHAVIOR: 
  // - If multiple cards selected: drag immediately without long press (to play on table)
  // - If single card: require long press first (for rearranging)
  const panGesture = useMemo(
    () => Gesture.Pan()
      .enabled(!disabled)
      .minDistance(10) // Require 10px movement to start pan
      .onStart(() => {
        'worklet';
        // Allow drag if:
        // 1. Multiple cards selected (hasMultipleSelected) - instant drag to play
        // 2. Single card was long-pressed (isLongPressed) - drag to rearrange
        const canDrag = hasMultipleSelected || isLongPressed.value;
        if (!canDrag) {
          // Provide subtle haptic feedback to indicate drag is not allowed
          runOnJS(Haptics.selectionAsync)();
          return; // Don't start drag
        }
        scale.value = withSpring(1.1); // Slightly larger during drag
        opacity.value = withSpring(0.9); // Slight transparency during drag
        if (onDragStart) {
          runOnJS(onDragStart)();
        }
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      })
      .onUpdate((event) => {
        'worklet';
        // Only update position if drag is allowed
        const canDrag = hasMultipleSelected || isLongPressed.value;
        if (!canDrag) {
          return;
        }
        // Allow free movement in both directions
        translateX.value = event.translationX;
        translateY.value = event.translationY;
        
        // Notify parent for drop zone detection
        if (onDragUpdate) {
          runOnJS(onDragUpdate)(event.translationX, event.translationY);
        }
      })
      .onEnd((event) => {
        'worklet';
        // Reset visual state
        scale.value = withSpring(1);
        opacity.value = withSpring(1);
        
        // Only process drag end if drag was allowed
        const canDrag = hasMultipleSelected || isLongPressed.value;
        if (canDrag) {
          // Notify parent with final position for drop zone detection
          if (onDragEnd) {
            runOnJS(onDragEnd)(event.translationX, event.translationY);
          }
        }
        
        // Reset long press state
        isLongPressed.value = false;
        
        // Animate back to original position
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      }),
    [disabled, translateX, translateY, scale, opacity, isLongPressed, hasMultipleSelected, onDragStart, onDragEnd, onDragUpdate]
  );

  // Gesture composition: long press enables pan, tap is separate
  // Simultaneous allows long press to activate pan gesture
  const composedGesture = useMemo(
    () => Gesture.Exclusive(
      tapGesture,
      Gesture.Simultaneous(longPressGesture, panGesture)
    ),
    [tapGesture, longPressGesture, panGesture]
  );

  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    const selectedOffset = isSelected ? SELECTED_OFFSET : 0;
    // Use shared drag values when this card is part of a group drag
    const effectiveTranslateX = isDraggingGroup ? sharedDragX : translateX.value;
    const effectiveTranslateY = isDraggingGroup ? sharedDragY : translateY.value;
    
    // Visual feedback: add shadow/glow when actively dragging
    const isDragging = Math.abs(effectiveTranslateX) > 5 || Math.abs(effectiveTranslateY) > 5;
    const shadowOpacity = isDragging ? 0.5 : 0.2;
    const shadowRadius = isDragging ? 12 : 4;
    
    return {
      transform: [
        { translateX: effectiveTranslateX },
        { translateY: selectedOffset + effectiveTranslateY },
        { scale: scale.value },
      ],
      opacity: isDraggingGroup ? 1 : opacity.value,
      zIndex: zIndex, // Use z-index from parent for proper layering during drag
      shadowOpacity,
      shadowRadius,
    };
  }, [isSelected, zIndex, isDraggingGroup, sharedDragX, sharedDragY, translateX, translateY, scale, opacity]);

  const suitColor = SUIT_COLORS[card.suit] || '#212121';
  const suitSymbol = SUIT_SYMBOLS[card.suit] || card.suit;

  const rankStyle = useMemo(() => ({
    color: suitColor,
    fontSize: CARD_FONTS.rankFontSize * sizeScale,
  }), [suitColor, sizeScale]);

  const suitStyle = useMemo(() => ({
    color: suitColor,
    fontSize: CARD_FONTS.suitFontSize * sizeScale,
  }), [suitColor, sizeScale]);

  const centerSuitStyle = useMemo(() => ({
    color: suitColor,
    fontSize: CARD_FONTS.centerSuitFontSize * sizeScale,
    marginTop: CARD_FONTS.centerSuitMarginTop * sizeScale,
  }), [suitColor, sizeScale]);

  // Memoize container dimensions to prevent React freeze error
  const containerDimensions = useMemo(() => ({
    width: cardWidth,
    height: cardHeight,
  }), [cardWidth, cardHeight]);

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View 
        style={[
          styles.container, 
          animatedStyle, 
          style,
          styles.touchTargetExpansion, // Add invisible padding for larger touch area
        ]}
        accessible={true}
        accessibilityLabel={`${card.rank} of ${suitSymbol}`}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected, disabled: disabled }}
        accessibilityHint="Double tap to select or deselect this card"
        // Set to false to avoid hardware texture caching issues on Android
        // This prevents rendering artifacts when animated values are reset
        renderToHardwareTextureAndroid={false}
        needsOffscreenAlphaCompositing={true}
        collapsable={false}
      >
        <View style={[
          styles.cardContainer, 
          isSelected && styles.cardSelected,
          containerDimensions
        ]}>
          {/* Text-based card rendering (SVG images causing freeze errors in dev mode) */}
          <View style={styles.card}>
              {/* Top-left corner */}
              <View style={styles.corner}>
                <Text style={[styles.rank, rankStyle]}>{card.rank}</Text>
                <Text style={[styles.suit, suitStyle]}>{suitSymbol}</Text>
              </View>

              {/* Center suit */}
              <Text style={[styles.centerSuit, centerSuitStyle]}>
                {suitSymbol}
              </Text>

              {/* Bottom-right corner (rotated) */}
              <View style={[styles.corner, styles.cornerBottom]}>
                <Text style={[styles.rank, rankStyle]}>
                  {card.rank}
                </Text>
                <Text style={[styles.suit, suitStyle]}>
                  {suitSymbol}
                </Text>
              </View>
            </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  container: {
    marginLeft: CARD_OVERLAP_MARGIN, // Overlap cards: right cards overlap left cards
  },
  touchTargetExpansion: {
    // Add invisible padding to expand touch target area
    // 30px touch target balances improved UX with fitting all 13 cards on screen
    paddingHorizontal: TOUCH_TARGET_PADDING, // 5px each side = 10px total
    paddingVertical: TOUCH_TARGET_PADDING, // Vertical padding for better tap accuracy
    // Compensate for vertical padding so cards don't overflow viewport
    marginVertical: -TOUCH_TARGET_PADDING, // Negative margin offsets padding
    // Note: paddingHorizontal DOES affect card spacing because it increases the layout box size.
    // In React Native, padding is part of the box model and will impact flexbox layout calculations.
    // Be sure to test that all 13 cards fit as intended and that CARD_OVERLAP_MARGIN creates the desired overlap.
  },
  cardContainer: {
    // Width and height set dynamically via props
    borderRadius: 6,
    // Explicitly set overflow: 'visible' to avoid clipping on Android during transform animations.
    // NOTE: This may cause visual artifacts with rounded corners when scaling/transforms are applied.
    overflow: 'visible',
    // Shadow values are animated dynamically in animatedStyle for drag feedback
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    // FIX: Task #378 - Force consistent elevation to prevent Android layer switching
    // Keep elevation constant regardless of selection state
  },
  cardSelected: {
    // Enhanced border for selected state
    borderWidth: 3,
    borderColor: COLORS.accent,
    shadowOpacity: 0.3,
    shadowRadius: 5,
    // FIX: Task #378 - Keep elevation constant (removed elevation: 5)
    // Android layer switching bug occurs when elevation changes during animation
    // Use border/shadow instead to indicate selection
  },
  // Fallback text-based card styles (used if SVG asset not found)
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
  rank: {
    // fontSize set dynamically via inline style
    fontWeight: 'bold',
    lineHeight: TYPOGRAPHY.rankLineHeight,
  },
  suit: {
    // fontSize set dynamically via inline style
    lineHeight: TYPOGRAPHY.suitLineHeight,
  },
  centerSuit: {
    // fontSize and marginTop set dynamically via inline style
    textAlign: 'center',
  },
  cardImage: {
    borderRadius: 6,
  },
});

export default Card;
