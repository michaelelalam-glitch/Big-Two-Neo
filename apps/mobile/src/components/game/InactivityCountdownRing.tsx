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

/**
 * Minimum server-ahead clock drift that is considered "real" skew and warrants a
 * warning log. Drift smaller than this is treated as negligible jitter — the ring
 * simply starts at 100% and runs for the full 60s. Matches the guard used in
 * useTurnInactivityTimer to keep skew sensitivity consistent across the app.
 */
const CLOCK_SKEW_WARN_THRESHOLD_MS = 2_000;

/** Ring visual settings (defaults, can be overridden by size prop) */
const DEFAULT_RING_SIZE = LAYOUT.avatarSize; // 70px — default avatar size
const RING_STROKE_WIDTH = 4; // Slightly thinner than avatar border (4px) so it overlays cleanly

/** Ring colors by type */
const TURN_COLOR_FULL = '#FFD700'; // Yellow — it's your turn, play within 60s
const TURN_COLOR_LOW = '#FFC107'; // Amber — under 15s remaining
const CONN_COLOR_FULL = '#4A4A4A'; // Charcoal grey — player disconnected
const CONN_COLOR_LOW = '#2E2E2E'; // Dark charcoal — under 15s remaining

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
  /**
   * Called when the countdown reaches 0 (timer expired).
   *
   * 5.5 HIGH: Now required. For display-only rings on opponent avatars where the local
   * client has no action to take on expiry, pass a no-op `() => {}`. Making this
   * required prevents silent omissions at call sites that DO need expiry handling
   * (e.g. the local player's turn ring), ensuring the caller explicitly acknowledges
   * whether they need an expiry action rather than silently ignoring the event.
   */
  onExpired: () => void;
  /** Optional size override — defaults to LAYOUT.avatarSize (70px) */
  size?: number;
  /**
   * Server-to-client clock offset in milliseconds (positive = client is behind server).
   * Passed from useClockSync so elapsed time is computed against the corrected server
   * clock rather than raw Date.now(). When omitted / 0, falls back to the previous
   * skew-detection heuristic for backward compatibility.
   */
  clockOffsetMs?: number;
}

/**
 * Resolves the canonical start-time anchor in ms, handling server-ahead clock skew.
 * When clockOffsetMs is provided (from useClockSync), the corrected now is used so
 * the ring depletes at the same rate as the server-side timer. Without an offset,
 * falls back to the previous heuristic: when the uncorrected elapsed is significantly
 * negative (server >> client clock), uses Date.now() as anchor so the ring starts
 * depleting immediately rather than appearing frozen at 100%.
 */
function resolveStartTimeMs(startedAt: string, clockOffsetMs: number): number {
  const serverMs = new Date(startedAt).getTime();
  const correctedNow = Date.now() + clockOffsetMs;
  const correctedElapsed = correctedNow - serverMs;
  // P3-5 FIX: Guard against any negative correctedElapsed by anchoring at correctedNow.
  // Covers two cases:
  //   a. Strong skew (< -CLOCK_SKEW_WARN_THRESHOLD_MS): client is still well behind server.
  //   b. Mild over-correction (−2s to 0): clockOffsetMs puts correctedNow slightly before serverMs.
  // In both cases we return correctedNow so the effective elapsed time is 0 and the
  // ring starts full, matching the scheduling path's lower-bound clamp and making
  // the negative-elapsed fallback explicit and easier to reason about.
  if (correctedElapsed < 0) {
    return correctedNow;
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
  size = DEFAULT_RING_SIZE,
  clockOffsetMs = 0,
}: InactivityCountdownRingProps) {
  // Calculate ring dimensions based on size
  const ringDimensions = useMemo(() => {
    const ringSize = size;
    const radius = (ringSize - RING_STROKE_WIDTH) / 2;
    const circumference = 2 * Math.PI * radius;
    return { ringSize, radius, circumference };
  }, [size]);

  const { ringSize, radius, circumference } = ringDimensions;
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

  // Keep clockOffsetMs in a ref so the scheduling effect always reads the latest
  // corrected value without it appearing in the effect's dep array.
  const clockOffsetMsRef = useRef(clockOffsetMs);
  clockOffsetMsRef.current = clockOffsetMs;

  // Resolve the countdown anchor exactly once per `startedAt`. If clock offset is
  // refined while the same timer is running, retain the original resolved anchor so
  // downstream effects depending on `startTimeMs` do not restart/jump mid-countdown.
  const startAnchorRef = useRef<{ startedAt: string; startTimeMs: number } | null>(null);
  if (startAnchorRef.current == null || startAnchorRef.current.startedAt !== startedAt) {
    startAnchorRef.current = {
      startedAt,
      startTimeMs: resolveStartTimeMs(startedAt, clockOffsetMs),
    };
  }
  const startTimeMs = startAnchorRef.current.startTimeMs;

  // Log a one-time debug message whenever the ring is scheduled so callers can verify
  // the corrected anchor is being used. Placed in a useEffect (not inside
  // resolveStartTimeMs / useMemo) so it fires exactly once per startedAt / offset
  // change even under React 18 StrictMode double-invocation of pure functions.
  useEffect(() => {
    const serverMs = new Date(startedAt).getTime();
    const correctedNow = Date.now() + clockOffsetMs;
    const residualSkew = serverMs - correctedNow; // positive when server still ahead after correction
    if (residualSkew > CLOCK_SKEW_WARN_THRESHOLD_MS) {
      networkLogger.debug(
        `[InactivityRing] Residual clock skew after sync: server ~${Math.round(residualSkew / 100) / 10}s ahead. Clamping to corrected anchor.`
      );
    }
  }, [startedAt, clockOffsetMs]);

  // Initial progress fraction (0–1) at the moment this render executes.
  // Seeded into useSharedValue on mount and used to determine initial visibility.
  const initialProgress = useMemo(() => {
    const elapsed = Math.max(0, Date.now() + clockOffsetMs - startTimeMs);
    return Math.min(1, Math.max(0, (COUNTDOWN_DURATION_MS - elapsed) / COUNTDOWN_DURATION_MS));
  }, [startTimeMs, clockOffsetMs]);

  // Static accessibility label derived from the initial ring state. Computed once per
  // startedAt/type change — no per-frame JS updates. Screen readers announce the ring
  // type and approximate remaining time without reintroducing JS-thread re-renders.
  const accessibilityLabel = useMemo(() => {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((initialProgress * COUNTDOWN_DURATION_MS) / 1000)
    );
    const action = type === 'turn' ? 'auto-play' : 'bot replacement';
    return remainingSeconds > 0
      ? `${type === 'turn' ? 'Turn' : 'Disconnect'} timer — about ${remainingSeconds}s until ${action}`
      : `${type === 'turn' ? 'Turn' : 'Disconnect'} timer expired`;
  }, [type, initialProgress]);

  // --- Shared values (UI thread) ---
  // `progress` drives the arc geometry via useAnimatedProps — no setState involved.
  const progress = useSharedValue(initialProgress);
  // `typeShared` lets the useAnimatedProps worklet pick the correct color without
  // restarting the animation when `type` prop changes. Synced from JS thread via
  // a separate useEffect so the color update arrives on the UI thread automatically.
  const typeShared = useSharedValue<'turn' | 'connection'>(type);
  useEffect(() => {
    typeShared.value = type;
  }, [type, typeShared]);

  // JS-side visibility: only used to mount/unmount the SVG element. One boolean
  // flag avoids keeping the entire render tree alive after expiry.
  const [visible, setVisible] = useState(initialProgress > 0);

  // P3-4 FIX: Guard against calling setState/onExpired on an unmounted component.
  // The withTiming completion callback fires via runOnJS asynchronously; if the
  // component unmounts (e.g. game ends) between animation completion and callback
  // execution, calling setVisible/onExpired would be a no-op in React 18 but still
  // pollutes LogBox with "Can't perform a React state update on an unmounted component"
  // and can trigger unexpected effects in the parent if onExpired navigates.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Dispatched to JS when withTiming finishes — hides component and fires onExpired.
  // Stable (deps=[]) — reads type from typeRef so it does not create a closure over
  // the `type` prop, which would force the scheduling effect to re-run on type changes
  // and restart the animation.
  const handleExpired = useCallback(() => {
    // Guard: if the component unmounted between animation completion and this
    // runOnJS callback, skip all state updates and callbacks.
    if (!isMountedRef.current) return;
    // Expiry is part of the normal ring lifecycle, so log at info level to avoid
    // noisy production log files for non-actionable timer completions. All rings
    // now receive a required onExpired prop (5.5), so warn level here would flood
    // the daily prod log file with every opponent's ring expiry.
    networkLogger.info(`[InactivityRing] Timer expired: type=${typeRef.current}`);
    setVisible(false);
    onExpiredRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally stable — type read from typeRef, onExpired read from onExpiredRef, isMounted read from isMountedRef

  // Schedule (or reschedule) the depletion animation whenever startedAt changes.
  // Uses the memoised startTimeMs so resolveStartTimeMs() is not invoked a second
  // time (skew warning already fired inside the useMemo above if applicable).
  // type changes are handled exclusively via typeShared.value (color update on UI
  // thread — no animation restart); adding `type` to deps would reset progress and
  // restart withTiming on every turn→connection or connection→turn transition.
  useEffect(() => {
    // Re-sample corrected time at effect-execution time (slightly after render) for
    // the most accurate remaining-ms value; startTimeMs is the stable T0 anchor.
    const elapsed = Math.max(0, Date.now() + clockOffsetMsRef.current - startTimeMs);
    const remaining = Math.max(0, COUNTDOWN_DURATION_MS - elapsed);
    const initial = remaining / COUNTDOWN_DURATION_MS;

    networkLogger.debug(
      `[InactivityRing] Scheduling ${typeRef.current} ring: elapsed=${elapsed}ms, remaining=${remaining}ms`
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
    progress.value = withTiming(0, { duration: remaining, easing: Easing.linear }, finished => {
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
  }, [startTimeMs]); // startTimeMs is stable per `startedAt` (via startAnchorRef) — only a genuinely
  // new timer identity (new startedAt) triggers re-scheduling. clockOffsetMs refinements are read
  // live via clockOffsetMsRef so they don't restart the animation mid-countdown.
  // type → typeShared.value (color only, no animation restart); handleExpired, progress,
  // typeShared are stable.

  // --- Animated props (UI thread worklet) ---
  // CLOCKWISE depletion from 12 o'clock:
  //   strokeDasharray=[visibleArc, gap] defines how much of the circumference is painted.
  //   strokeDashoffset=-gap shifts the painted portion so the gap is at the "back" (bottom),
  //   and combined with rotation=-90 the visible arc starts at 12 o'clock.
  const arcAnimatedProps = useAnimatedProps(() => {
    const p = progress.value;
    const visibleArc = p * circumference;
    const gap = circumference - visibleArc;
    const isTurn = typeShared.value === 'turn';
    const stroke =
      p <= 0.25
        ? isTurn
          ? TURN_COLOR_LOW
          : CONN_COLOR_LOW
        : isTurn
          ? TURN_COLOR_FULL
          : CONN_COLOR_FULL;
    return {
      strokeDasharray: `${visibleArc} ${gap}`,
      strokeDashoffset: -gap,
      stroke,
    };
  });

  if (!visible) return null; // Timer expired — remove from render tree entirely.

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          width: ringSize,
          height: ringSize,
          zIndex: 6, // Above avatar (z:0) but below card badge (z:10)
        },
      ]}
      pointerEvents="none"
      accessible={true}
      accessibilityLabel={accessibilityLabel}
    >
      <Svg width={ringSize} height={ringSize}>
        {/* Background track — static, no animation needed */}
        <Circle
          cx={ringSize / 2}
          cy={ringSize / 2}
          r={radius}
          stroke={RING_BACKGROUND[type]}
          strokeWidth={RING_STROKE_WIDTH}
          fill="none"
        />
        {/* Animated countdown arc — driven entirely on the UI thread */}
        <AnimatedCircle
          cx={ringSize / 2}
          cy={ringSize / 2}
          r={radius}
          strokeWidth={RING_STROKE_WIDTH}
          fill="none"
          strokeLinecap="round"
          rotation={-90}
          originX={ringSize / 2}
          originY={ringSize / 2}
          animatedProps={arcAnimatedProps}
        />
      </Svg>
    </Animated.View>
  );
}
