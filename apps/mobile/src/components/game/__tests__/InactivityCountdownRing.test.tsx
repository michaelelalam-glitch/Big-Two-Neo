/**
 * Tests for InactivityCountdownRing (H3 Audit fix — Reanimated migration)
 *
 * Verifies that the component:
 * 1. Renders correctly for both ring types with a recent startedAt
 * 2. Does not render when the timer has already expired
 * 3. Schedules a withTiming animation on mount and cancels it on unmount
 * 4. Produces correct arc geometry (strokeDasharray, strokeDashoffset) via useAnimatedProps
 * 5. Applies correct colors for each type and each progress level
 * 6. Invokes onExpired when the component mounts with an already-expired timer
 *
 * The Reanimated mock (setup.ts) calls the useAnimatedProps worklet synchronously
 * during render and returns the static result. We read `mock.results[last].value`
 * (the static object returned during render) rather than re-invoking the worklet
 * function after effects ran — effects assign `progress.value = 0` (withTiming
 * mock returns the target value 0), so re-invoking post-effect gives wrong data.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import {
  withTiming,
  cancelAnimation,
  useAnimatedProps,
  useSharedValue,
} from 'react-native-reanimated';
import InactivityCountdownRing from '../InactivityCountdownRing';

// Constants replicated from InactivityCountdownRing so tests don't import private values.
const COUNTDOWN_DURATION_MS = 60_000;

/** Build an ISO timestamp that is `elapsedMs` in the past */
const startedAt = (elapsedMs: number) =>
  new Date(Date.now() - elapsedMs).toISOString();

/** Get the static animated props returned by the last useAnimatedProps call during render. */
function getLastAnimatedProps(): Record<string, unknown> {
  const results = (useAnimatedProps as jest.Mock).mock.results;
  return results[results.length - 1].value as Record<string, unknown>;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Seed useSharedValue so it returns a writable { value } object (setup.ts already does
  // this globally, but clearAllMocks wipes it — re-implement the minimal version).
  (useSharedValue as jest.Mock).mockImplementation((initial: unknown) => ({
    value: initial,
  }));
  // useAnimatedProps: call the worklet synchronously and return the static object.
  (useAnimatedProps as jest.Mock).mockImplementation((fn: () => unknown) => fn());
});

describe('InactivityCountdownRing', () => {
  describe('Rendering', () => {
    it('renders without crashing for a fresh turn ring', () => {
      const { toJSON } = render(
        <InactivityCountdownRing type="turn" startedAt={startedAt(1000)} />,
      );
      expect(toJSON()).not.toBeNull();
    });

    it('renders without crashing for a fresh connection ring', () => {
      const { toJSON } = render(
        <InactivityCountdownRing type="connection" startedAt={startedAt(1000)} />,
      );
      expect(toJSON()).not.toBeNull();
    });

    it('renders null when the timer has already expired', () => {
      // startedAt is > 60s ago → initial progress = 0 → visible starts false → returns null
      const expired = startedAt(COUNTDOWN_DURATION_MS + 5000);
      const { toJSON } = render(
        <InactivityCountdownRing type="turn" startedAt={expired} />,
      );
      expect(toJSON()).toBeNull();
    });

    it('renders null for a startedAt exactly at the deadline', () => {
      const exactlyExpired = startedAt(COUNTDOWN_DURATION_MS);
      const { toJSON } = render(
        <InactivityCountdownRing type="turn" startedAt={exactlyExpired} />,
      );
      expect(toJSON()).toBeNull();
    });
  });

  describe('Reanimated scheduling', () => {
    it('calls withTiming targeting 0 with duration ≈ remaining time on mount', () => {
      const elapsedMs = 10_000; // 10s elapsed → ~50s remaining
      render(
        <InactivityCountdownRing type="turn" startedAt={startedAt(elapsedMs)} />,
      );

      expect(withTiming).toHaveBeenCalledTimes(1);
      const [targetValue, opts] = (withTiming as jest.Mock).mock.calls[0];
      expect(targetValue).toBe(0); // animates progress to 0
      // Allow ±500ms tolerance for test execution time
      const expectedRemaining = COUNTDOWN_DURATION_MS - elapsedMs;
      expect(opts.duration).toBeGreaterThan(expectedRemaining - 500);
      expect(opts.duration).toBeLessThanOrEqual(expectedRemaining + 500);
    });

    it('calls cancelAnimation on unmount to prevent stale completion callbacks', () => {
      const { unmount } = render(
        <InactivityCountdownRing type="turn" startedAt={startedAt(5000)} />,
      );
      unmount();
      expect(cancelAnimation).toHaveBeenCalledTimes(1);
    });

    it('re-schedules withTiming when startedAt changes', () => {
      const { rerender } = render(
        <InactivityCountdownRing type="turn" startedAt={startedAt(5000)} />,
      );
      rerender(
        <InactivityCountdownRing type="turn" startedAt={startedAt(15000)} />,
      );
      // Mount + rerender = 2 withTiming calls
      expect(withTiming).toHaveBeenCalledTimes(2);
    });

    it('does NOT re-schedule withTiming when only type changes (color handled by typeShared)', () => {
      // The scheduling effect depends only on startedAt. When type changes, typeShared.value
      // is updated via its own useEffect, and the useAnimatedProps worklet picks up the new
      // color on the UI thread — no animation restart occurs.
      const ts = startedAt(5000);
      const { rerender } = render(
        <InactivityCountdownRing type="turn" startedAt={ts} />,
      );
      rerender(
        <InactivityCountdownRing type="connection" startedAt={ts} />,
      );
      expect(withTiming).toHaveBeenCalledTimes(1);
    });

    it('does NOT call withTiming when the timer is already expired', () => {
      const expired = startedAt(COUNTDOWN_DURATION_MS + 5000);
      render(
        <InactivityCountdownRing type="turn" startedAt={expired} />,
      );
      // remaining <= 0 path → no withTiming is scheduled
      expect(withTiming).not.toHaveBeenCalled();
    });
  });

  describe('Animated arc props (static values from render-time worklet execution)', () => {
    // These tests read mock.results[last].value — the static object returned by
    // useAnimatedProps(worklet) during render, BEFORE effects reassign progress.value.

    it('computes non-zero visibleArc for a ring with time remaining', () => {
      render(
        <InactivityCountdownRing type="turn" startedAt={startedAt(5000)} />,
      );
      const arcProps = getLastAnimatedProps();
      expect(Array.isArray(arcProps.strokeDasharray)).toBe(true);
      const [visibleArc] = arcProps.strokeDasharray as number[];
      expect(visibleArc).toBeGreaterThan(0);
    });

    it('strokeDashoffset equals -gap', () => {
      render(
        <InactivityCountdownRing type="turn" startedAt={startedAt(5000)} />,
      );
      const arcProps = getLastAnimatedProps();
      const [, gap] = arcProps.strokeDasharray as number[];
      expect(arcProps.strokeDashoffset).toBeCloseTo(-gap, 5);
    });

    it('uses full yellow (#FFD700) for turn ring at >25% progress', () => {
      // 5s elapsed → 55s remaining → progress ≈ 91.7% (> 25%)
      render(
        <InactivityCountdownRing type="turn" startedAt={startedAt(5000)} />,
      );
      expect(getLastAnimatedProps().stroke).toBe('#FFD700');
    });

    it('uses full charcoal (#4A4A4A) for connection ring at >25% progress', () => {
      render(
        <InactivityCountdownRing type="connection" startedAt={startedAt(5000)} />,
      );
      expect(getLastAnimatedProps().stroke).toBe('#4A4A4A');
    });

    it('switches to low-yellow (#FFC107) when progress ≤ 25% for turn ring', () => {
      // 50s elapsed → 10s remaining → progress = 10/60 ≈ 16.7% (≤ 25%)
      render(
        <InactivityCountdownRing type="turn" startedAt={startedAt(50_000)} />,
      );
      expect(getLastAnimatedProps().stroke).toBe('#FFC107');
    });

    it('switches to low-charcoal (#2E2E2E) when progress ≤ 25% for connection ring', () => {
      render(
        <InactivityCountdownRing type="connection" startedAt={startedAt(50_000)} />,
      );
      expect(getLastAnimatedProps().stroke).toBe('#2E2E2E');
    });
  });

  describe('onExpired callback', () => {
    it('does not call onExpired for a timer with time remaining', () => {
      const onExpired = jest.fn();
      render(
        <InactivityCountdownRing
          type="turn"
          startedAt={startedAt(5000)}
          onExpired={onExpired}
        />,
      );
      // withTiming mock returns target value (0) but ignores the completion callback,
      // so onExpired is never triggered synchronously.
      expect(onExpired).not.toHaveBeenCalled();
    });

    it('calls onExpired synchronously when the component mounts with an already-expired timer', () => {
      const onExpired = jest.fn();
      // The effect detects remaining <= 0 and calls handleExpired() directly.
      render(
        <InactivityCountdownRing
          type="turn"
          startedAt={startedAt(COUNTDOWN_DURATION_MS + 1000)}
          onExpired={onExpired}
        />,
      );
      expect(onExpired).toHaveBeenCalledTimes(1);
    });
  });

  describe('Clock skew handling', () => {
    it('renders (not null) when startedAt is slightly in the future (server ahead)', () => {
      // Server 500ms ahead of client → elapsed = -500ms → treated as 0 elapsed → full ring
      const futureTs = new Date(Date.now() + 500).toISOString();
      const { toJSON } = render(
        <InactivityCountdownRing type="turn" startedAt={futureTs} />,
      );
      expect(toJSON()).not.toBeNull();
    });

    it('schedules withTiming with full 60s duration on server-ahead clock skew', () => {
      const futureTs = new Date(Date.now() + 1000).toISOString();
      render(
        <InactivityCountdownRing type="turn" startedAt={futureTs} />,
      );
      expect(withTiming).toHaveBeenCalledTimes(1);
      const [, opts] = (withTiming as jest.Mock).mock.calls[0];
      // elapsed was negative → treated as 0 → remaining ≈ COUNTDOWN_DURATION_MS
      expect(opts.duration).toBeGreaterThan(COUNTDOWN_DURATION_MS - 500);
    });
  });
});

