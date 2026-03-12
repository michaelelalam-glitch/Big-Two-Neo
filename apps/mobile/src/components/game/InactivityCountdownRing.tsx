/**
 * InactivityCountdownRing — Dual-mode circular progress ring around player avatars.
 * 
 * **YELLOW RING (Turn Inactivity):**
 * - Shows when it's a player's turn (60s countdown to auto-play)
 * - Depletes clockwise from full → empty over 60 seconds
 * - When expired: calls auto-play-turn edge function (plays highest cards OR passes)
 * - Shows "I'm Still Here?" popup after auto-play
 * 
 * **CHARCOAL GREY RING (Connection / Disconnect):**
 * - Shows when player disconnects (heartbeat stopped) — 60s countdown to bot replacement
 * - Replaces yellow ring if disconnect happens during turn
 * - Picks up where yellow ring left off (continuous countdown, no flash)
 * - When expired: bot replaces player, RejoinModal shown
 *
 * Uses react-native-svg for the circular arc and requestAnimationFrame for
 * smooth 60fps animation (same pattern as AutoPassTimer).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { LAYOUT } from '../../constants';
import { networkLogger } from '../../utils/logger';

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
    full: '#FFD700',  // Yellow — it's your turn, play within 60s
    low: '#FFC107',   // Amber — under 15s remaining
    background: 'rgba(255,215,0,0.2)', // Yellow tint for background track
  },
  connection: {
    full: '#4A4A4A',  // Charcoal grey — player disconnected, 60s to bot replacement
    low: '#2E2E2E',   // Dark charcoal — under 15s remaining
    background: 'rgba(74,74,74,0.2)', // Charcoal grey tint for background track
  },
};

interface InactivityCountdownRingProps {
  /** Ring type: 'turn' (yellow, 60s to play) or 'connection' (charcoal grey, 60s to bot replacement) */
  type: 'turn' | 'connection';
  /** UTC ISO-8601 timestamp when the countdown started */
  startedAt: string;
  /** Called when the countdown reaches 0 (timer expired) */
  onExpired?: () => void;
}

/**
 * Renders a circular SVG ring that depletes clockwise from full → empty
 * over 60 seconds. Color adapts based on type (yellow = turn, charcoal grey = connection/disconnect).
 * Positioned absolutely over the player's avatar.
 */
export default function InactivityCountdownRing({
  type,
  startedAt,
  onExpired,
}: InactivityCountdownRingProps) {
  // Initialise to actual elapsed progress so there is no one-frame flash to full
  // when the component first mounts (e.g. seamless yellow→orange colour switch).
  const [progress, setProgress] = useState(() => {
    const elapsed = Math.max(0, Date.now() - new Date(startedAt).getTime());
    return Math.min(1, Math.max(0, (COUNTDOWN_DURATION_MS - elapsed) / COUNTDOWN_DURATION_MS));
  });
  const rafIdRef = useRef<number | null>(null);
  const expiredFiredRef = useRef(false);
  // Throttle React state updates to ~15fps to reduce render pressure while keeping
  // the RAF loop running at native rate for precise expiry detection.
  const lastRenderMsRef = useRef(0);
  const RENDER_INTERVAL_MS = 66; // ~15fps

  const startTimeMs = React.useMemo(
    () => {
      const time = new Date(startedAt).getTime();
      const now = Date.now();
      const elapsed = now - time;
      
      // NOTE: `type` is intentionally NOT a dependency — it does not affect this
      // computation, and including it caused startTimeMs to re-evaluate (with a fresh
      // Date.now()) whenever the ring transitioned between 'turn' and 'connection' for
      // the SAME startedAt. On devices where the server clock is even slightly ahead,
      // that re-evaluation could produce elapsed < 0 and snap startTimeMs to 'now',
      // resetting the ring to 60 s at the instant of the grey→yellow reconnect transition.
      //
      // CLOCK SKEW HANDLING: When the server timestamp is in the future relative to the
      // client (elapsed < 0), we use Date.now() so the ring starts depleting immediately.
      // Sitting at 100% until the client catches up (the previous approach) caused the
      // ring to appear frozen for the entire skew duration — on some devices up to ~45s.
      // Using Date.now() means the ring may finish slightly before/after the server auto-
      // plays (off by the skew amount), but it's always visually moving. This matches
      // what useTurnInactivityTimer does for the auto-play trigger.
      // eslint-disable-next-line no-console
      console.warn(`[RING_DEBUG] type=${type} startedAt=${startedAt} serverMs=${time} clientMs=${now} elapsed=${elapsed}ms`);
      if (elapsed < 0) {
        networkLogger.warn(`[InactivityRing] ⚠️ Clock skew: server ${Math.abs(elapsed)}ms ahead. Using Date.now() so ring depletes immediately.`);
        return now;
      } else {
        const remaining = COUNTDOWN_DURATION_MS - elapsed;
        networkLogger.info(`[InactivityRing] 🔄 Timer initialized: type=${type}, elapsed=${elapsed}ms, remaining=${remaining}ms`);
        return time;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startedAt], // `type` intentionally omitted — see comment above
  );

  const tick = useCallback(() => {
    const now = Date.now();
    const elapsed = now - startTimeMs;
    const remaining = Math.max(0, COUNTDOWN_DURATION_MS - elapsed);
    // CRITICAL: Clamp progress between 0 and 1 to prevent arc overflow
    const newProgress = Math.min(1, Math.max(0, remaining / COUNTDOWN_DURATION_MS));

    if (newProgress > 0) {
      // Only push a React state update at ~15fps to reduce render churn while
      // keeping the RAF loop running at native rate for precise expiry detection.
      if (now - lastRenderMsRef.current >= RENDER_INTERVAL_MS) {
        lastRenderMsRef.current = now;
        setProgress(newProgress);
      }
      rafIdRef.current = requestAnimationFrame(tick);
    } else {
      // Commit final progress=0 so the ring disappears, then fire callback once.
      setProgress(0);
      if (!expiredFiredRef.current && onExpired) {
        expiredFiredRef.current = true;
        networkLogger.warn(`[InactivityRing] Timer expired: type=${type}`);
        onExpired();
      }
    }
  }, [startTimeMs, onExpired, type]);

  // When startedAt or type changes (without a remount), recalculate progress from elapsed
  // time instead of resetting to full — this prevents a flash-to-full artefact.
  useEffect(() => {
    const elapsed = Math.max(0, Date.now() - startTimeMs);
    const currentProgress = Math.min(1, Math.max(0, (COUNTDOWN_DURATION_MS - elapsed) / COUNTDOWN_DURATION_MS));
    setProgress(currentProgress);
    expiredFiredRef.current = false;
    networkLogger.info(`[InactivityRing] ⚡ RESET: type=${type}, startedAt=${startedAt}, progress=${currentProgress.toFixed(2)}`);
  }, [startedAt, type, startTimeMs]);

  useEffect(() => {
    // Start animation loop
    networkLogger.info(`[InactivityRing] Starting ${type} countdown animation`);
    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null) {
        networkLogger.debug(`[InactivityRing] Cleaning up ${type} countdown`);
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [tick, type]);

  // CLOCKWISE DEPLETION from 12 o'clock:
  // SVG circles draw counter-clockwise by default. To make it deplete CLOCKWISE:
  // - Use strokeDashoffset to shift where the visible arc starts
  // - As progress decreases, offset increases (moves the gap clockwise)
  // - rotation={-90} positions the start at 12 o'clock
  const visibleArcLength = progress * RING_CIRCUMFERENCE;
  const gapLength = RING_CIRCUMFERENCE - visibleArcLength;
  // Offset formula for CLOCKWISE depletion: move gap forward as progress decreases
  const strokeDashoffset = -gapLength;
  const colors = RING_COLORS[type];
  const ringColor = progress <= 0.25 ? colors.low : colors.full;

  // Log every 5 seconds to track depletion (throttled)
  const secondsRemaining = Math.ceil(progress * 60);
  const lastLoggedSecondRef = useRef(-1);
  React.useEffect(() => {
    if (secondsRemaining % 5 === 0 && secondsRemaining > 0 && secondsRemaining !== lastLoggedSecondRef.current) {
      lastLoggedSecondRef.current = secondsRemaining;
      networkLogger.debug(`[InactivityRing] 🔽 ${type} depleting: ${secondsRemaining}s remaining, progress=${progress.toFixed(2)}, visibleArc=${visibleArcLength.toFixed(1)}/${RING_CIRCUMFERENCE.toFixed(1)}`);
    }
  }, [secondsRemaining, type, progress, visibleArcLength]);

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
        {/* Animated countdown arc — starts at 12 o'clock, depletes clockwise */}
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={ringColor}
          strokeWidth={RING_STROKE_WIDTH}
          fill="none"
          strokeDasharray={`${visibleArcLength} ${gapLength}`}
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
