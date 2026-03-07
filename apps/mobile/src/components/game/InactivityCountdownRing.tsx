/**
 * InactivityCountdownRing — Dual-mode circular progress ring around player avatars.
 * 
 * **ORANGE RING (Turn Inactivity):**
 * - Shows when it's a player's turn (60s countdown to auto-play)
 * - Depletes clockwise from full → empty over 60 seconds
 * - When expired: calls auto-play-turn edge function (plays highest cards OR passes)
 * - Shows "I'm Still Here?" popup after auto-play
 * 
 * **YELLOW RING (Connection Inactivity):**
 * - Shows when player's heartbeat stops (60s countdown to bot replacement)
 * - Replaces orange ring if disconnect happens during turn
 * - Picks up where orange ring left off (continuous countdown)
 * - When expired: bot replaces player, RejoinModal shown
 *
 * Uses react-native-svg for the circular arc and requestAnimationFrame for
 * smooth 60fps animation (same pattern as AutoPassTimer).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { LAYOUT } from '../../constants';

/** Duration of both timers (must match server BOT_REPLACE_AFTER and TURN_TIMEOUT) */
const COUNTDOWN_DURATION_MS = 60_000;

/** Ring visual settings */
const RING_SIZE = LAYOUT.avatarSize; // 70px — same as avatar container
const RING_STROKE_WIDTH = 4; // Slightly thinner than avatar border (4px) so it overlays cleanly
const RING_RADIUS = (RING_SIZE - RING_STROKE_WIDTH) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Ring colors by type */
const RING_COLORS = {
  turn: {
    full: '#FFA500',  // Orange — full time remaining (turn countdown)
    low: '#FF4500',   // OrangeRed — under 15s remaining
    background: 'rgba(255,165,0,0.2)', // Orange tint for background track
  },
  connection: {
    full: '#FFD700',  // Gold/Yellow — full time remaining (connection countdown)
    low: '#FF8C00',   // DarkOrange — under 15s remaining
    background: 'rgba(255,215,0,0.2)', // Yellow tint for background track
  },
};

interface InactivityCountdownRingProps {
  /** Ring type: 'turn' (orange, 60s to play) or 'connection' (yellow, 60s to bot replacement) */
  type: 'turn' | 'connection';
  /** UTC ISO-8601 timestamp when the countdown started */
  startedAt: string;
  /** Called when the countdown reaches 0 (timer expired) */
  onExpired?: () => void;
}

/**
 * Renders a circular SVG ring that depletes clockwise from full → empty
 * over 60 seconds. Color adapts based on type (orange = turn, yellow = connection).
 * Positioned absolutely over the player's avatar.
 */
export default function InactivityCountdownRing({
  type,
  startedAt,
  onExpired,
}: InactivityCountdownRingProps) {
  const [progress, setProgress] = useState(1); // 1 = full ring, 0 = depleted
  const rafIdRef = useRef<number | null>(null);
  const expiredFiredRef = useRef(false);

  const startTimeMs = React.useMemo(
    () => new Date(startedAt).getTime(),
    [startedAt],
  );

  const tick = useCallback(() => {
    const elapsed = Date.now() - startTimeMs;
    const remaining = Math.max(0, COUNTDOWN_DURATION_MS - elapsed);
    const newProgress = remaining / COUNTDOWN_DURATION_MS;
    setProgress(newProgress);

    if (newProgress > 0) {
      rafIdRef.current = requestAnimationFrame(tick);
    } else if (!expiredFiredRef.current && onExpired) {
      // Timer reached 0 — fire callback once
      expiredFiredRef.current = true;
      onExpired();
    }
  }, [startTimeMs, onExpired]);

  useEffect(() => {
    // Reset expired flag when timer restarts
    expiredFiredRef.current = false;
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
  const colors = RING_COLORS[type];
  const ringColor = progress <= 0.25 ? colors.low : colors.full;

  if (progress <= 0) return null; // Timer expired — ring fully depleted

  const label = type === 'turn' 
    ? `Auto-play in ${Math.ceil(progress * 60)} seconds`
    : `Bot replacement in ${Math.ceil(progress * 60)} seconds`;

  return (
    <View
      style={styles.container}
      pointerEvents="none"
      accessibilityLabel={label}
    >
      <Svg width={RING_SIZE} height={RING_SIZE}>
        {/* Background track (subtle, optional) */}
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={colors.background}
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
