/**
 * Auto-Pass Timer Component
 * 
 * UPDATED: December 29, 2025 - SERVER-AUTHORITATIVE SYNC
 * Displays a countdown timer using server-authoritative endTimestamp with clock-sync correction.
 * 
 * Architecture:
 * - Server creates timer with end_timestamp = server_time + 10000ms
 * - Client measures clock offset: offset = server_time - local_time
 * - Client calculates remaining = end_timestamp - (local_now + offset)
 * - Uses requestAnimationFrame for smooth 60fps countdown
 * - NO setInterval - pure calculation from server endTimestamp
 * 
 * This ensures ALL 4 devices show IDENTICAL countdown (within 100ms) regardless of:
 * - Network latency (50-500ms)
 * - Clock drift between devices
 * - Late joins or reconnections
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';
import { useClockSync } from '../../hooks/useClockSync';
import { i18n } from '../../i18n';
import type { AutoPassTimerState } from '../../types/multiplayer';

interface AutoPassTimerProps {
  timerState: AutoPassTimerState | null;
  currentPlayerIndex: number; // Index of the current user
}

export default function AutoPassTimer({
  timerState,
  currentPlayerIndex: _currentPlayerIndex,
}: AutoPassTimerProps) {
  const [pulseAnim] = useState(new Animated.Value(1));
  const [currentTime, setCurrentTime] = useState(Date.now());
  // Throttle debug logs to once per whole-second transition.
  // Component-scoped ref (not module-scoped) so multiple instances and test cases stay isolated.
  const lastLoggedSecondRef = useRef(-1);
  
  // ⏱️ CRITICAL: Clock sync with server
  const { offsetMs, isSynced, getCorrectedNow } = useClockSync(timerState);

  // Update current time every frame for smooth countdown
  // CRITICAL FIX: Stop the rAF loop once remaining reaches 0 to prevent
  // infinite log spam and unnecessary CPU usage when timer has expired.
  useEffect(() => {
    if (!timerState || !timerState.active) {
      return;
    }

    let animationFrameId: number;
    let stopped = false;
    const updateTime = () => {
      if (stopped) return;
      const now = Date.now();
      // Check if timer has expired — if so, do one final update and stop the loop
      const endTimestamp = (timerState as any).end_timestamp;
      if (typeof endTimestamp === 'number') {
        const correctedNow = now + (offsetMs || 0);
        if (correctedNow >= endTimestamp) {
          setCurrentTime(now);
          stopped = true;
          return; // Don't schedule another frame
        }
      } else {
        // Fallback path: stop when started_at + duration_ms has elapsed
        const startedAt = new Date(timerState.started_at).getTime();
        const durationMs = timerState.duration_ms || 10000;
        if (!isNaN(startedAt) && now >= startedAt + durationMs) {
          setCurrentTime(now);
          stopped = true;
          return; // Don't schedule another frame
        }
      }
      setCurrentTime(now);
      animationFrameId = requestAnimationFrame(updateTime);
    };
    
    animationFrameId = requestAnimationFrame(updateTime);
    
    return () => {
      stopped = true;
      cancelAnimationFrame(animationFrameId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- full timerState intentionally excluded: deps are the specific scalar fields that trigger rescheduling; including the whole object would restart the rAF loop on every render
  }, [timerState?.active, (timerState as any)?.end_timestamp, offsetMs]);

  // ⏰ CRITICAL: Calculate remaining time from server-authoritative endTimestamp
  const calculateRemainingMs = (): number => {
    if (!timerState) return 0;
    
    // NEW ARCHITECTURE: Use end_timestamp if available (server-authoritative)
    const endTimestamp = (timerState as any).end_timestamp;
    if (typeof endTimestamp === 'number') {
      // Use clock-corrected current time
      const correctedNow = getCorrectedNow();
      const remaining = Math.max(0, endTimestamp - correctedNow);
      
      // Debug: log once per whole-second transition (not every frame).
      const currentSecond = Math.ceil(remaining / 1000);
      if (__DEV__ && remaining > 0 && currentSecond !== lastLoggedSecondRef.current) {
        lastLoggedSecondRef.current = currentSecond;
        console.log('[AutoPassTimer] Server-authoritative calculation:', {
          endTimestamp: new Date(endTimestamp).toISOString(),
          correctedNow: new Date(correctedNow).toISOString(),
          localNow: new Date(Date.now()).toISOString(),
          offsetMs,
          isSynced,
          remaining,
          seconds: currentSecond,
        });
      }
      
      return remaining;
    }
    
    // FALLBACK: Old architecture (calculate from started_at)
    const startedAt = new Date(timerState.started_at).getTime();
    
    // Guard against invalid dates
    if (isNaN(startedAt)) {
      return 0;
    }
    
    const elapsed = currentTime - startedAt;
    const durationMs = timerState.duration_ms || 10000;
    const remaining = Math.max(0, durationMs - elapsed);
    
    if (__DEV__ && Math.floor(remaining / 1000) !== Math.floor((remaining - 16) / 1000)) {
      console.log('[AutoPassTimer] Fallback calculation (no endTimestamp):', {
        startedAt: new Date(startedAt).toISOString(),
        currentTime: new Date(currentTime).toISOString(),
        elapsed,
        durationMs,
        remaining,
        seconds: Math.ceil(remaining / 1000),
      });
    }
    
    return remaining;
  };

  const remainingMs = calculateRemainingMs();
  const currentSeconds = Math.ceil(remainingMs / 1000);

  useEffect(() => {
    if (!timerState || !timerState.active || remainingMs <= 0) {
      return;
    }

    // Start pulse animation when timer is active and below 5 seconds
    if (currentSeconds <= 5) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timerState intentionally excluded: only the derived values (currentSeconds, remainingMs, timerState?.active) are needed to gate the animation; full timerState object not required
  }, [currentSeconds, timerState?.active, remainingMs, pulseAnim]);

  // Don't render if timer is not active or has expired
  if (!timerState || !timerState.active || remainingMs <= 0) {
    return null;
  }
  
  // Calculate progress percentage (1.0 = full, 0.0 = empty)
  const progress = remainingMs / timerState.duration_ms;

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
