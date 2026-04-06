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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /**
   * Optional clock offset (ms) from the parent context (turnClockOffsetMs / clockOffsetMs).
   * When provided, overrides the internal NTP-based useClockSync so that timers whose
   * end_timestamp was set with the LOCAL clock (offline/AI games, clockOffsetMs=0) are
   * not incorrectly shifted by an NTP drift measured against the Supabase server.
   * Multiplayer callers should pass their real NTP offset here too for consistency.
   */
  clockOffsetMs?: number;
}

/** Compute remaining ms from server state + clock sync, without any state read. */
function computeRemainingMs(timerState: AutoPassTimerState, getCorrectedNow: () => number): number {
  const durationMs = timerState.duration_ms || 10000;
  const endTimestamp = timerState.end_timestamp;
  if (typeof endTimestamp === 'number') {
    // end_timestamp is the server-side epoch-ms deadline.
    // getCorrectedNow() = Date.now() + NTP_drift ≈ server_now — correct for all
    // players regardless of join time (early, late, or after reconnect).
    // NTP drift is device-specific and time-independent; it does NOT include
    // elapsed time since timer creation, so there is no "full ring on rejoin" risk.
    // CLAMP: Before NTP sync completes (drift=0), a client clock behind the server
    // would compute remaining > durationMs (e.g. 17s for a 10s timer). Clamping
    // ensures the displayed countdown never exceeds the configured duration.
    return Math.min(durationMs, Math.max(0, endTimestamp - getCorrectedNow()));
  }
  // Fallback path (no end_timestamp): use started_at.
  // getCorrectedNow() returns Date.now() + drift (drift=0 before NTP sync), so it
  // is safe to use unconditionally — no separate isSynced guard needed.
  const startedAt = new Date(timerState.started_at).getTime();
  if (isNaN(startedAt)) return 0;
  return Math.min(durationMs, Math.max(0, durationMs - (getCorrectedNow() - startedAt)));
}

function AutoPassTimerComponent({
  timerState,
  currentPlayerIndex: _currentPlayerIndex,
  clockOffsetMs,
}: AutoPassTimerProps) {
  const [pulseAnim] = useState(new Animated.Value(1));
  // Throttle debug logs to once per whole-second transition.
  const lastLoggedSecondRef = useRef(-1);

  // ⏱️ CRITICAL: Clock sync with server
  // When the caller provides clockOffsetMs (e.g. 0 for offline AI games), we use
  // Date.now() + clockOffsetMs directly and skip the internal NTP ping.  This
  // prevents the bug where a positive NTP drift (device clock behind server)
  // incorrectly fast-forwards a LOCAL-clock-based end_timestamp, making the
  // timer jump from 10s → 3s as soon as the NTP ping resolves.
  const { isSynced, getCorrectedNow: getCorrectedNowNTP } = useClockSync(
    clockOffsetMs === undefined ? timerState : null,
    undefined,
    clockOffsetMs === undefined // enabled=false when caller provides their own clock offset
  );
  // Stable function reference — only changes when clockOffsetMs changes,
  // so useMemo deps that include getCorrectedNow are not invalidated every render.
  const getCorrectedNowLocal = useCallback(
    () => Date.now() + (clockOffsetMs ?? 0),
    [clockOffsetMs]
  );
  const getCorrectedNow = clockOffsetMs !== undefined ? getCorrectedNowLocal : getCorrectedNowNTP;
  const isSyncedEffective = clockOffsetMs !== undefined ? true : isSynced;

  // ── Stable clock-sync ref — keeps latest getCorrectedNow without triggering effects ──
  // useEffect deps intentionally exclude getCorrectedNow to avoid restarting the interval
  // on every sync tick; the ref gives the interval access to the freshest value.
  const getCorrectedNowRef = useRef(getCorrectedNow);
  getCorrectedNowRef.current = getCorrectedNow;

  // ── Initial snapshot (computed once per timerState activation or when clock sync completes) ──
  // Recomputes when timerState identity changes (active/end_timestamp/started_at/duration_ms)
  // AND when isSynced transitions false→true (clock sync established). Without the isSynced
  // dep (5.3 fix), the snapshot was anchored on isSynced=false (full clamped duration) and
  // never updated once sync arrived, leaving the ring and tick counter on the wrong remaining-ms.
  const initialSnapshot = useMemo(() => {
    if (!timerState || !timerState.active) return { remainingMs: 0, seconds: 0, progress: 0 };
    const remaining = computeRemainingMs(timerState, getCorrectedNow);
    const durationMs = timerState.duration_ms || 10000;
    return {
      remainingMs: remaining,
      seconds: Math.ceil(remaining / 1000),
      progress: remaining / durationMs,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timerState is covered granularly; getCorrectedNow is stable (useCallback([clockOffsetMs]) in offset path, stable NTP hook ref in sync path)
  }, [
    timerState?.active,
    timerState?.end_timestamp,
    timerState?.started_at,
    timerState?.duration_ms,
    isSyncedEffective,
    getCorrectedNow,
  ]);

  // ── Reanimated shared value for the ring arc — runs on UI thread (0 JS re-renders) ──
  const progressAnim = useSharedValue(initialSnapshot.progress);

  // Track last rendered second to guard setState calls in tick (skip if unchanged).
  const prevSecsRef = useRef(initialSnapshot.seconds);

  // Animated ring rotation style — computed entirely on the UI thread
  const animatedRingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-90 + 360 * (1 - progressAnim.value)}deg` }],
  }));

  // ── Schedule the ring animation whenever the timer activates / resets ───────
  // NOTE: getCorrectedNow excluded from deps so clock-sync status changes after reconnect
  // do NOT restart the ring animation (which would flash a full ring).
  // The animation uses getCorrectedNowRef for accurate positioning without re-scheduling.
  useEffect(() => {
    if (!timerState?.active) {
      cancelAnimation(progressAnim);
      progressAnim.value = 0;
      return;
    }
    const remaining = computeRemainingMs(timerState, getCorrectedNowRef.current);
    const durationMs = timerState.duration_ms || 10000;
    const initial = remaining / durationMs;
    progressAnim.value = initial;
    progressAnim.value = withTiming(0, { duration: remaining, easing: Easing.linear });
    return () => {
      cancelAnimation(progressAnim);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getCorrectedNow excluded intentionally; animation only restarts when timer identity changes
  }, [
    timerState?.active,
    timerState?.end_timestamp,
    timerState?.started_at,
    timerState?.duration_ms,
  ]);

  // ── Throttled text/color state — updates once per second max (≤11 re-renders/timer) ──
  const [displaySeconds, setDisplaySeconds] = useState(initialSnapshot.seconds);
  const [timerColorState, setTimerColorState] = useState<string>(() => {
    const s = initialSnapshot.seconds;
    if (s <= 3) return COLORS.error;
    if (s <= 5) return COLORS.warning;
    return COLORS.secondary;
  });

  // Reset display state whenever the timer identity changes (new active timer starts).
  // Because the component stays mounted while returning null (expired/inactive), displaySeconds
  // and timerColorState keep stale values (e.g. 0 / red) from the previous timer. Without this
  // reset they flash stale values for one render before the interval tick fires.
  useEffect(() => {
    if (!timerState?.active) return;
    const snap = initialSnapshot;
    setDisplaySeconds(snap.seconds);
    setTimerColorState(
      snap.seconds <= 3 ? COLORS.error : snap.seconds <= 5 ? COLORS.warning : COLORS.secondary
    );
    prevSecsRef.current = snap.seconds;
    lastLoggedSecondRef.current = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    timerState?.active,
    timerState?.end_timestamp,
    timerState?.started_at,
    timerState?.duration_ms,
  ]);

  useEffect(() => {
    if (!timerState?.active) return;

    const tick = () => {
      const remaining = computeRemainingMs(timerState, getCorrectedNowRef.current);
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
        setTimerColorState(
          secs <= 3 ? COLORS.error : secs <= 5 ? COLORS.warning : COLORS.secondary
        );
      }
    };

    tick(); // immediate snapshot
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    timerState?.active,
    timerState?.end_timestamp,
    timerState?.started_at,
    timerState?.duration_ms,
  ]);

  // Compute directly (cheap) — avoids stale value when getCorrectedNow
  // changes after the initial render (useMemo deps were incomplete).
  const remainingMs = timerState?.active ? computeRemainingMs(timerState, getCorrectedNow) : 0;

  // Keep a ref so the pulse effect can read the latest value without being
  // in its dependency array — avoids stop/start of Animated.loop every 200ms
  // (which caused SIGSEGV in the native animation driver).
  const remainingMsRef = useRef(0);
  remainingMsRef.current = remainingMs;

  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    // Stop any prior loop before deciding whether to start a new one
    if (pulseLoopRef.current) {
      pulseLoopRef.current.stop();
      pulseLoopRef.current = null;
    }

    if (!timerState || !timerState.active || remainingMsRef.current <= 0) {
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
  }, [displaySeconds, timerState?.active, pulseAnim]);

  // Cancel the Reanimated progress animation when the timer becomes inactive or expires,
  // so the shared value is not updated after the animated view is unmounted — prevents
  // the cloneShadowTreeWithNewPropsRecursive SIGSEGV crash seen in Reanimated 3.x.
  // Placed in a useEffect rather than the render path to keep rendering pure.
  useEffect(() => {
    if (!timerState || !timerState.active || remainingMs <= 0) {
      cancelAnimation(progressAnim);
    }
  }, [timerState, remainingMs, progressAnim]);

  // Don't render if timer is not active or has expired.
  if (!timerState || !timerState.active || remainingMs <= 0) {
    return null;
  }

  // Get combo type display text
  const comboText = timerState.triggering_play.combo_type;

  // Static styles — computed once per re-render (max ~11 per 10s timer with the new architecture)
  const animatedContainerStyle = { transform: [{ scale: pulseAnim }] };
  const timerNumberStyle = { color: timerColorState };

  return (
    <Animated.View style={[styles.container, animatedContainerStyle]}>
      {/* Compact countdown ring on the left */}
      <View style={styles.timerCircle}>
        {/* Background ring */}
        <View style={[styles.progressBackground, { borderColor: COLORS.gray.medium }]} />
        {/* Progress ring — rotation driven by Reanimated UI thread (0 JS re-renders) */}
        <ReanimatedLib.View
          style={[styles.progressRing, { borderColor: timerColorState }, animatedRingStyle]}
        />
        {/* Countdown number */}
        <View style={styles.timerContent}>
          <Text style={[styles.timerNumber, timerNumberStyle]}>{displaySeconds}</Text>
        </View>
      </View>

      {/* Inline message to the right of the ring */}
      <Text style={styles.inlineMessage} numberOfLines={1}>
        {i18n.t('game.autoPassInlineMessage', { combo: comboText, seconds: displaySeconds })}
      </Text>
    </Animated.View>
  );
}

export default React.memo(AutoPassTimerComponent);

const TIMER_SIZE = 36;
const RING_WIDTH = 3;

const styles = StyleSheet.create({
  // Horizontal strip — sits flush under the "last played" text without
  // pushing cards upward or overlapping player avatars.
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 20,
    alignSelf: 'center',
    maxWidth: 260,
  },
  timerCircle: {
    width: TIMER_SIZE,
    height: TIMER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginRight: SPACING.xs,
    flexShrink: 0,
  },
  progressBackground: {
    position: 'absolute',
    width: TIMER_SIZE,
    height: TIMER_SIZE,
    borderRadius: TIMER_SIZE / 2,
    borderWidth: RING_WIDTH,
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
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
    color: COLORS.secondary,
  },
  inlineMessage: {
    flex: 1,
    color: COLORS.white,
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
});
