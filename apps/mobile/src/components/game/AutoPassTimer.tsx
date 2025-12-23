/**
 * Auto-Pass Timer Component
 * 
 * Displays a countdown timer when the highest possible card/combo is played.
 * Shows visual indicator and clear messaging for the 10-second auto-pass window.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import type { AutoPassTimerState } from '../../types/multiplayer';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';
import i18n from '../../i18n';

interface AutoPassTimerProps {
  timerState: AutoPassTimerState | null;
  currentPlayerIndex: number; // Index of the current user
}

export default function AutoPassTimer({
  timerState,
  currentPlayerIndex,
}: AutoPassTimerProps) {
  const [pulseAnim] = useState(new Animated.Value(1));

  useEffect(() => {
    if (!timerState || !timerState.active) {
      return;
    }

    // Calculate display seconds (rounded)
    const seconds = Math.ceil(timerState.remaining_ms / 1000);

    // Start pulse animation when timer is active and below 5 seconds
    if (seconds <= 5) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [timerState?.remaining_ms, timerState?.active, pulseAnim]);

  // Don't render if timer is not active
  if (!timerState || !timerState.active || timerState.remaining_ms <= 0) {
    return null;
  }

  // Calculate display seconds directly from remaining_ms for accuracy
  const currentSeconds = Math.ceil(timerState.remaining_ms / 1000);
  
  // Calculate progress percentage (1.0 = full, 0.0 = empty)
  const progress = timerState.remaining_ms / timerState.duration_ms;

  // Determine color based on remaining time (use current calculation, not state)
  const getTimerColor = (): string => {
    if (currentSeconds <= 3) return COLORS.error; // Red (critical)
    if (currentSeconds <= 5) return COLORS.warning; // Orange (warning)
    return COLORS.secondary; // Blue (safe)
  };

  const timerColor = getTimerColor();
  
  // Get combo type display text
  const comboText = timerState.triggering_play.combo_type;

  // Memoize animated styles to prevent React freeze error
  const animatedContainerStyle = { transform: [{ scale: pulseAnim }] };
  const progressBackgroundStyle = { borderColor: COLORS.gray.medium };
  const progressRingStyle = {
    borderColor: timerColor,
    transform: [{ rotate: `${-90 + (360 * (1 - progress))}deg` }]
  };
  const timerNumberStyle = { color: timerColor };

  return (
    <Animated.View 
      style={[
        styles.container,
        animatedContainerStyle
      ]}
    >
      {/* Circular progress ring */}
      <View style={styles.timerCircle}>
        {/* Background circle */}
        <View style={[styles.progressBackground, progressBackgroundStyle]} />
        
        {/* Progress ring (rendered as partial circle) */}
        <View style={[
          styles.progressRing,
          progressRingStyle
        ]} />
        
        {/* Center content */}
        <View style={styles.timerContent}>
          <Text style={[styles.timerNumber, timerNumberStyle]}>
            {currentSeconds}
          </Text>
          <Text style={styles.timerLabel}>sec</Text>
        </View>
      </View>

      {/* Message text */}
      <View style={styles.messageContainer}>
        <Text style={styles.messageTitle}>
          {i18n.t('game.autoPassHighestPlay')} {comboText}
        </Text>
        <Text style={styles.messageText}>
          {i18n.t('game.autoPassNoOneCanBeat').replace('{seconds}', currentSeconds.toString())}
        </Text>
      </View>
    </Animated.View>
  );
}

const TIMER_SIZE = 80;
const RING_WIDTH = 6;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
  },
  timerCircle: {
    width: TIMER_SIZE,
    height: TIMER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: SPACING.sm,
  },
  progressBackground: {
    position: 'absolute',
    width: TIMER_SIZE,
    height: TIMER_SIZE,
    borderRadius: TIMER_SIZE / 2,
    borderWidth: RING_WIDTH,
    borderColor: COLORS.gray.medium,
  },
  progressRing: {
    position: 'absolute',
    width: TIMER_SIZE,
    height: TIMER_SIZE,
    borderRadius: TIMER_SIZE / 2,
    borderWidth: RING_WIDTH,
    borderColor: COLORS.secondary,
    borderTopColor: 'transparent',
    borderLeftColor: 'transparent',
  },
  timerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  timerNumber: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.secondary,
  },
  timerLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.white,
    marginTop: -4,
  },
  messageContainer: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 12,
    maxWidth: 280,
  },
  messageTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
    marginBottom: SPACING.xs / 2,
    textAlign: 'center',
  },
  messageText: {
    color: COLORS.gray.light,
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
  },
});
