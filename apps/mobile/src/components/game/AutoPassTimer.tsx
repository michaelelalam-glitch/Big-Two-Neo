/**
 * Auto-Pass Timer Component
 *
 * UPDATED: Task #628 — eliminate 60fps rAF re-renders.
 * ARCHITECTURE (post-task-628):
 * - Ring rotation is driven by react-native-reanimated (UI thread, 0 JS re-renders)
 * - Text/color only update when the displayed whole-second changes via setInterval(200ms)
 *   → ≤11 JS re-renders for a 10s timer (down from ~600 rAF-driven re-renders)
 * - Pulse animation continues to use Animated.loop + useNativeDriver:true (native thread)
 *
 * ORIGINAL ARCHITECTURE:
 * - Server creates timer with end_timestamp = server_time + 10000ms
 * - Client measures clock offset: offset = server_time - local_time
 * - Client calculates remaining = end_timestamp - (local_now + offset)
 * - All 4 devices show IDENTICAL countdown (within 100ms) regardless of latency/drift
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import ReanimatedLib, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';
import { useClockSync } from '../../hooks/useClockSync';
import { i18n } from '../../i18n';
import { gameLogger } from '../../utils/logger';
import type { AutoPassTimerState } from '../../types/multiplayer';

interface AutoPassTimerProps {
  timerState: AutoPassTimerState | null;
  currentPlayerIndex: number; // Index of the current user
}

/** Compute remaining ms from server state + clock sync, without any state read. */
function computeRemainingMs(
  timerState: AutoPassTimerState,
  isSynced: boolean,
  getCorrectedNow: () => number,
): number {
  const endTimestamp = timerState.end_timestamp;
  if (typeof endTimestamp === 'number') {
    const durationMs = timerState.duration_ms || 10000;
    if (!isSynced) return durationMs; // hold at full until clock syncs (<300ms)
    return Math.max(0, endTimestamp - getCorrectedNow());
  }
  // Fallback path (no end_timestamp): use started_at.
  // Use getCorrectedNow() when synced to stay server-time-based across devices.
  const startedAt = new Date(timerState.started_at).getTime();
  if (isNaN(startedAt)) return 0;
  const durationMs = timerState.duration_ms || 10000;
  const now = isSynced ? getCorrectedNow() : Date.now();
  return Math.max(0, durationMs - (now - startedAt));
}

function AutoPassTimerComponent({
  timerState,
  currentPlayerIndex: _currentPlayerIndex,
}: AutoPassTimerProps) {
  const [pulseAnim] = useState(new Animated.Value(1));
  // Throttle debug logs to once per whole-second transition.
  const lastLoggedSecondRef = useRef(-1);

  // ⏱️ CRITICAL: Clock sync with server
  const { isSynced, getCorrectedNow } = useClockSync(timerState);

  // ── Stable clock-sync refs — keep latest values without triggering effects ──
  // useEffect deps intentionally exclude isSynced/getCorrectedNow to avoid
  // restarting the interval on every sync tick; refs give the interval access to the
  // freshest values without re-scheduling.
  const isSyncedRef = useRef(isSynced);
  const getCorrectedNowRef = useRef(getCorrectedNow);
  isSyncedRef.current = isSynced;
  getCorrectedNowRef.current = getCorrectedNow;

  // ── Initial snapshot (computed once per timerState activation) ──────────────
  const initialSnapshot = useMemo(() => {
    if (!timerState || !timerState.active) return { remainingMs: 0, seconds: 0, progress: 0 };
    const remaining = computeRemainingMs(timerState, isSynced, getCorrectedNow);
    const durationMs = timerState.duration_ms || 10000;
    return {
      remainingMs: remaining,
      seconds: Math.ceil(remaining / 1000),
      progress: remaining / durationMs,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerState?.active, timerState?.end_timestamp, timerState?.started_at]);

  // ── Reanimated shared value for the ring arc — runs on UI thread (0 JS re-renders) ──
  const progressAnim = useSharedValue(initialSnapshot.progress);

  // Track last rendered second to guard setState calls in tick (skip if unchanged).
  const prevSecsRef = useRef(initialSnapshot.seconds);

  // Animated ring rotation style — computed entirely on the UI thread
  const animatedRingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-90 + 360 * (1 - progressAnim.value)}deg` }],
  }));

  // ── Schedule the ring animation whenever the timer activates / resets ───────
  useEffect(() => {
    if (!timerState?.active) {
      cancelAnimation(progressAnim);
      progressAnim.value = 0;
      return;
    }
    const remaining = computeRemainingMs(
      timerState,
      isSyncedRef.current,
      getCorrectedNowRef.current,
    );
    const durationMs = timerState.duration_ms || 10000;
    const initial = remaining / durationMs;
    progressAnim.value = initial;
    progressAnim.value = withTiming(0, { duration: remaining, easing: Easing.linear });
    return () => { cancelAnimation(progressAnim); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerState?.active, timerState?.end_timestamp, timerState?.started_at, isSynced]);

  // ── Throttled text/color state — updates once per second max (≤11 re-renders/timer) ──
  const [displaySeconds, setDisplaySeconds] = useState(initialSnapshot.seconds);
  const [timerColorState, setTimerColorState] = useState<string>(() => {
    const s = initialSnapshot.seconds;
    if (s <= 3) return COLORS.error;
    if (s <= 5) return COLORS.warning;
    return COLORS.secondary;
  });

  useEffect(() => {
    if (!timerState?.active) return;

    const tick = () => {
      const remaining = computeRemainingMs(
        timerState,
        isSyncedRef.current,
        getCorrectedNowRef.current,
      );
      const secs = Math.ceil(remaining / 1000);

      // Log once per whole-second transition
      if (remaining > 0 && secs !== lastLoggedSecondRef.current) {
        lastLoggedSecondRef.current = secs;
        gameLogger.debug('[AutoPassTimer] Tick:', { remaining, secs });
      }

      // Only update state when the displayed second changes (keeps JS thread work minimal).
      if (secs !== prevSecsRef.current) {
        prevSecsRef.current = secs;
        setDisplaySeconds(secs);
        setTimerColorState(secs <= 3 ? COLORS.error : secs <= 5 ? COLORS.warning : COLORS.secondary);
      }
    };

    tick(); // immediate snapshot
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerState?.active, timerState?.end_timestamp, timerState?.started_at]);

  // Compute directly (cheap) — avoids stale value when isSynced or getCorrectedNow
  // change after the initial render (useMemo deps were incomplete).
  const remainingMs = timerState?.active
    ? computeRemainingMs(timerState, isSynced, getCorrectedNow)
    : 0;

  // Ref to hold the current pulse loop so we can stop it before starting a new one
  // or during cleanup. Without this, every re-render that triggers the effect would
  // start an additional concurrent loop, leaking animations.
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    // Stop any prior loop before deciding whether to start a new one
    if (pulseLoopRef.current) {
      pulseLoopRef.current.stop();
      pulseLoopRef.current = null;
    }

    if (!timerState || !timerState.active || remainingMs <= 0) {
      pulseAnim.setValue(1);
      return;
    }

    // Start pulse animation when timer is active and below 5 seconds
    if (displaySeconds <= 5) {
      const loop = Animated.loop(
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
      );
      pulseLoopRef.current = loop;
      loop.start();
    } else {
      pulseAnim.setValue(1);
    }

    return () => {
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop();
        pulseLoopRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySeconds, timerState?.active, remainingMs, pulseAnim]);

  // Don't render if timer is not active or has expired
  if (!timerState || !timerState.active || remainingMs <= 0) {
    return null;
  }

  // Get combo type display text
  const comboText = timerState.triggering_play.combo_type;

  // Static styles — computed once per re-render (max ~11 per 10s timer with the new architecture)
  const animatedContainerStyle = { transform: [{ scale: pulseAnim }] };
  const progressBackgroundStyle = { borderColor: COLORS.gray.medium };
  const timerNumberStyle = { color: timerColorState };

  return (
    <Animated.View
      style={[
        styles.container,
        animatedContainerStyle,
      ]}
    >
      {/* Circular progress ring */}
      <View style={styles.timerCircle}>
        {/* Background circle */}
        <View style={[styles.progressBackground, progressBackgroundStyle]} />

        {/* Progress ring — rotation driven by Reanimated UI thread (0 JS re-renders) */}
        <ReanimatedLib.View style={[styles.progressRing, { borderColor: timerColorState }, animatedRingStyle]} />

        {/* Center content */}
        <View style={styles.timerContent}>
          <Text style={[styles.timerNumber, timerNumberStyle]}>
            {displaySeconds}
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
          {i18n.t('game.autoPassNoOneCanBeat').replace('{seconds}', displaySeconds.toString())}
        </Text>
      </View>
    </Animated.View>
  );
}

export default React.memo(AutoPassTimerComponent);

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
