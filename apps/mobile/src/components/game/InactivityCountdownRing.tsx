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
 * **Animation strategy (H3 Audit fix):**
 * Previous implementation used requestAnimationFrame + React setState at ~15fps,
 * triggering JS-thread re-renders every tick and competing with game logic.
 *
 * This version drives the arc entirely on the UI thread via react-native-reanimated:
 * - `useSharedValue` holds the numeric progress (0–1)
 * - `withTiming(..., Easing.linear)` animates it from current → 0 over the remaining ms
 * - `useAnimatedProps` computes strokeDasharray/strokeDashoffset/stroke in a worklet
 * - `Animated.createAnimatedComponent(Circle)` connects props to the SVG arc
 * - Zero JS-thread re-renders occur during the animation; the JS thread is only
 *   touched once on mount/remount to schedule the animation and once on expiry.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
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
const TURN_COLOR_FULL = '#FFD700';   // Yellow — it's your turn, play within 60s
const TURN_COLOR_LOW  = '#FFC107';   // Amber — under 15s remaining
const CONN_COLOR_FULL = '#4A4A4A';   // Charcoal grey — player disconnected
const CONN_COLOR_LOW  = '#2E2E2E';   // Dark charcoal — under 15s remaining

const RING_BACKGROUND: Record<'turn' | 'connection', string> = {
  turn: 'rgba(255,215,0,0.2)',
  connection: 'rgba(74,74,74,0.2)',
};

// Animated wrapper for react-native-svg Circle — lets Reanimated write animated
// props (strokeDasharray, strokeDashoffset, stroke) directly on the UI thread.
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface InactivityCountdownRingProps {
  /** Ring type: 'turn' (yellow, 60s to play) or 'connection' (charcoal grey, 60s to bot replacement) */
  type: 'turn' | 'connection';
  /** UTC ISO-8601 timestamp when the countdown started */
  startedAt: string;
  /** Called when the countdown reaches 0 (timer expired) */
  onExpired?: () => void;
}

/**
 * Resolves the canonical start-time anchor in ms, handling server-ahead clock skew.
 * When the server timestamp is in the future relative to the client (skew > 0), use
 * Date.now() so the ring starts depleting immediately instead of freezing at 100%.
 */
function resolveStartTimeMs(startedAt: string): number {
  const serverMs = new Date(startedAt).getTime();
  const elapsed = Date.now() - serverMs;
  if (elapsed < 0) {
    networkLogger.warn(
      `[InactivityRing] ⚠️ Clock skew: server ${Math.abs(elapsed)}ms ahead. Using Date.now().`,
    );
    return Date.now();
  }
  return serverMs;
}

/**
 * Renders a circular SVG ring that depletes clockwise from full → empty over 60 seconds.
 * Color adapts based on type (yellow = turn, charcoal grey = connection/disconnect).
 * Positioned absolutely over the player's avatar.
 *
 * All per-frame animation runs on the UI thread (react-native-reanimated withTiming +
 * useAnimatedProps); the JS thread is not touched during the sweep.
 */
export default function InactivityCountdownRing({
  type,
  startedAt,
  onExpired,
}: InactivityCountdownRingProps) {
  // Keep stable refs for callbacks so we never need to re-schedule the Reanimated
  // animation just because the parent re-created its onExpired arrow function or
  // because the `type` prop changed (type is synced via typeRef + typeShared).
  //
  // Assigned synchronously during render (not via useEffect) so the ref is always
  // current before any withTiming completion callback can fire via runOnJS.
  // Using useEffect would leave a window between commit and effect execution where
  // handleExpired() could read a stale onExpiredRef/typeRef value.
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  const typeRef = useRef(type);
  typeRef.current = type;

  // Memoised: resolveStartTimeMs() is called exactly once per `startedAt` change.
  // All three consumers (useSharedValue init, useState init, scheduling effect) share
  // the same T0 anchor so the clock-skew warning fires at most once per startedAt.
  const startTimeMs = useMemo(() => resolveStartTimeMs(startedAt), [startedAt]);

  // Initial progress fraction (0–1) at the moment this render executes.
  // Seeded into useSharedValue on mount and used to determine initial visibility.
  const initialProgress = useMemo(() => {
    const elapsed = Math.max(0, Date.now() - startTimeMs);
    return Math.min(1, Math.max(0, (COUNTDOWN_DURATION_MS - elapsed) / COUNTDOWN_DURATION_MS));
  }, [startTimeMs]);

  // --- Shared values (UI thread) ---
  // `progress` drives the arc geometry via useAnimatedProps — no setState involved.
  const progress = useSharedValue(initialProgress);
  // `typeShared` lets the useAnimatedProps worklet pick the correct color without
  // restarting the animation when `type` prop changes. Synced from JS thread via
  // a separate useEffect so the color update arrives on the UI thread automatically.
  const typeShared = useSharedValue<'turn' | 'connection'>(type);
  useEffect(() => { typeShared.value = type; }, [type, typeShared]);

  // JS-side visibility: only used to mount/unmount the SVG element. One boolean
  // flag avoids keeping the entire render tree alive after expiry.
  const [visible, setVisible] = useState(initialProgress > 0);

  // Dispatched to JS when withTiming finishes — hides component and fires onExpired.
  // Stable (deps=[]) — reads type from typeRef so it does not create a closure over
  // the `type` prop, which would force the scheduling effect to re-run on type changes
  // and restart the animation.
  const handleExpired = useCallback(() => {
    networkLogger.warn(`[InactivityRing] Timer expired: type=${typeRef.current}`);
    setVisible(false);
    onExpiredRef.current?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally stable — type read from typeRef, onExpired read from onExpiredRef

  // Schedule (or reschedule) the depletion animation whenever startedAt changes.
  // Uses the memoised startTimeMs so resolveStartTimeMs() is not invoked a second
  // time (skew warning already fired inside the useMemo above if applicable).
  // type changes are handled exclusively via typeShared.value (color update on UI
  // thread — no animation restart); adding `type` to deps would reset progress and
  // restart withTiming on every turn→connection or connection→turn transition.
  useEffect(() => {
    // Re-sample Date.now() at effect-execution time (slightly after render) for
    // the most accurate remaining-ms value; startTimeMs is the stable T0 anchor.
    const elapsed = Math.max(0, Date.now() - startTimeMs);
    const remaining = Math.max(0, COUNTDOWN_DURATION_MS - elapsed);
    const initial = remaining / COUNTDOWN_DURATION_MS;

    networkLogger.info(
      `[InactivityRing] Scheduling ${typeRef.current} ring: elapsed=${elapsed}ms, remaining=${remaining}ms`,
    );

    if (remaining <= 0) {
      // Already expired before mount; fire immediately without scheduling an animation.
      // handleExpired() calls setVisible(false) internally — no separate call needed here.
      handleExpired();
      return;
    }

    setVisible(true);
    // Assign synchronously so the arc is at the correct position for the first frame.
    progress.value = initial;
    // Drive to 0 over the remaining duration — entirely on the UI thread.
    progress.value = withTiming(0, { duration: remaining, easing: Easing.linear }, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(handleExpired)();
      }
    });

    return () => {
      // On unmount or re-schedule, cancel any in-flight animation so the completion
      // callback does not fire after the new animation has started.
      cancelAnimation(progress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTimeMs]); // startTimeMs is memoised on [startedAt] — same trigger, no duplicate
                     // resolveStartTimeMs call. type → typeShared.value (color only, no
                     // animation restart); handleExpired, progress, typeShared are stable.

  // --- Animated props (UI thread worklet) ---
  // CLOCKWISE depletion from 12 o'clock:
  //   strokeDasharray=[visibleArc, gap] defines how much of the circumference is painted.
  //   strokeDashoffset=-gap shifts the painted portion so the gap is at the "back" (bottom),
  //   and combined with rotation=-90 the visible arc starts at 12 o'clock.
  const arcAnimatedProps = useAnimatedProps(() => {
    const p = progress.value;
    const visibleArc = p * RING_CIRCUMFERENCE;
    const gap = RING_CIRCUMFERENCE - visibleArc;
    const isTurn = typeShared.value === 'turn';
    const stroke = p <= 0.25
      ? (isTurn ? TURN_COLOR_LOW : CONN_COLOR_LOW)
      : (isTurn ? TURN_COLOR_FULL : CONN_COLOR_FULL);
    return {
      strokeDasharray: `${visibleArc} ${gap}`,
      strokeDashoffset: -gap,
      stroke,
    };
  });

  if (!visible) return null; // Timer expired — remove from render tree entirely.

  return (
    <Animated.View
      style={styles.container}
      pointerEvents="none"
      accessible={false}
    >
      <Svg width={RING_SIZE} height={RING_SIZE}>
        {/* Background track — static, no animation needed */}
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={RING_BACKGROUND[type]}
          strokeWidth={RING_STROKE_WIDTH}
          fill="none"
        />
        {/* Animated countdown arc — driven entirely on the UI thread */}
        <AnimatedCircle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          strokeWidth={RING_STROKE_WIDTH}
          fill="none"
          strokeLinecap="round"
          rotation={-90}
          originX={RING_SIZE / 2}
          originY={RING_SIZE / 2}
          animatedProps={arcAnimatedProps}
        />
      </Svg>
    </Animated.View>
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
