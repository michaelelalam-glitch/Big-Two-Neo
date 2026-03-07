/**
 * InactivityCountdownRing — Circular progress ring around player avatars
 * that depletes clockwise over 60 seconds when a player's disconnect timer is active.
 *
 * Shows other players that a disconnected player will be replaced by a bot
 * when the ring fully depletes.
 *
 * Uses react-native-svg for the circular arc and requestAnimationFrame for
 * smooth 60fps animation (same pattern as AutoPassTimer).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { LAYOUT } from '../../constants';

/** Duration of the bot-replacement timer (must match server BOT_REPLACE_AFTER) */
const BOT_REPLACE_DURATION_MS = 60_000;

/** Ring visual settings */
const RING_SIZE = LAYOUT.avatarSize; // 70px — same as avatar container
const RING_STROKE_WIDTH = 4; // Slightly thinner than avatar border (4px) so it overlays cleanly
const RING_RADIUS = (RING_SIZE - RING_STROKE_WIDTH) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Orange countdown color */
const RING_COLOR_FULL = '#FFA500'; // Orange — full time remaining
const RING_COLOR_LOW = '#FF4500';  // OrangeRed — under 15s remaining

interface InactivityCountdownRingProps {
  /** UTC ISO-8601 timestamp when the server started the 60s disconnect timer */
  disconnectTimerStartedAt: string;
}

/**
 * Renders a circular SVG ring that depletes clockwise from full → empty
 * over 60 seconds.  Positioned absolutely over the player's avatar.
 */
export default function InactivityCountdownRing({
  disconnectTimerStartedAt,
}: InactivityCountdownRingProps) {
  const [progress, setProgress] = useState(1); // 1 = full ring, 0 = depleted
  const rafIdRef = useRef<number | null>(null);

  const startTimeMs = React.useMemo(
    () => new Date(disconnectTimerStartedAt).getTime(),
    [disconnectTimerStartedAt],
  );

  const tick = useCallback(() => {
    const elapsed = Date.now() - startTimeMs;
    const remaining = Math.max(0, BOT_REPLACE_DURATION_MS - elapsed);
    const newProgress = remaining / BOT_REPLACE_DURATION_MS;
    setProgress(newProgress);

    if (newProgress > 0) {
      rafIdRef.current = requestAnimationFrame(tick);
    }
  }, [startTimeMs]);

  useEffect(() => {
    // Start animation loop
    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [tick]);

  // strokeDashoffset: 0 = full circle, circumference = empty circle
  // We want clockwise depletion from top, so offset increases as progress decreases
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);
  const ringColor = progress <= 0.25 ? RING_COLOR_LOW : RING_COLOR_FULL;

  if (progress <= 0) return null; // Timer expired — ring fully depleted

  return (
    <View
      style={styles.container}
      pointerEvents="none"
      accessibilityLabel={`Bot replacement in ${Math.ceil(progress * 60)} seconds`}
    >
      <Svg width={RING_SIZE} height={RING_SIZE}>
        {/* Background track (subtle, optional) */}
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke="rgba(255,165,0,0.2)"
          strokeWidth={RING_STROKE_WIDTH}
          fill="none"
        />
        {/* Animated countdown arc — rotated -90° so it starts at 12 o'clock */}
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={ringColor}
          strokeWidth={RING_STROKE_WIDTH}
          fill="none"
          strokeDasharray={`${RING_CIRCUMFERENCE}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation={-90}
          originX={RING_SIZE / 2}
          originY={RING_SIZE / 2}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RING_SIZE,
    height: RING_SIZE,
    zIndex: 6, // Above avatar (z:0) but below card badge (z:10)
  },
});
