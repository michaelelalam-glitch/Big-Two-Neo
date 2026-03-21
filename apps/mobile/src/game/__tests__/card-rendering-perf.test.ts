/**
 * Task #328 — Performance benchmarks for card rendering and game logic
 *
 * These benchmarks establish baseline performance budgets for critical game
 * operations. They run in the Jest test environment (Node.js) using
 * performance.now() and fail if operations exceed their time budgets.
 *
 * Budget guidelines (conservative — running on CI 2-vCPU runner):
 *   - sortHand(13 cards)             < 1 ms
 *   - classifyCards (any hand)       < 1 ms
 *   - classifyAndSortCards(5 cards)  < 1 ms
 *   - canBeatPlay (worst-case)       < 2 ms
 *   - findRecommendedPlay(13 cards)  < 5 ms
 *
 * Iteration counts are large (1 000–10 000) so that the average latency per
 * operation smooths out JIT warm-up noise. We measure the *total* wall-time
 * for all iterations and divide to get per-call cost.
 */

import {
  sortHand,
  classifyCards,
  classifyAndSortCards,
  canBeatPlay,
  findRecommendedPlay,
} from '../engine/game-logic';
import type { Card, LastPlay } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A full 13-card hand (suits: D < C < H < S, ranks: 3 low → 2 high) */
const HAND_13: Card[] = [
  { id: '3D', rank: '3', suit: 'D' },
  { id: '5H', rank: '5', suit: 'H' },
  { id: '7C', rank: '7', suit: 'C' },
  { id: '8S', rank: '8', suit: 'S' },
  { id: '9D', rank: '9', suit: 'D' },
  { id: '10H', rank: '10', suit: 'H' },
  { id: 'JC', rank: 'J', suit: 'C' },
  { id: 'QS', rank: 'Q', suit: 'S' },
  { id: 'KD', rank: 'K', suit: 'D' },
  { id: 'AH', rank: 'A', suit: 'H' },
  { id: '2C', rank: '2', suit: 'C' },
  { id: '4S', rank: '4', suit: 'S' },
  { id: '6D', rank: '6', suit: 'D' },
];

/** Worst-case: already sorted descending (sortHand must produce a new sorted array) */
const HAND_13_REVERSED: Card[] = [...HAND_13].reverse();

const SINGLE: Card[] = [{ id: 'AS', rank: 'A', suit: 'S' }];
const PAIR: Card[] = [
  { id: 'KH', rank: 'K', suit: 'H' },
  { id: 'KS', rank: 'K', suit: 'S' },
];
const TRIPLE: Card[] = [
  { id: 'QD', rank: 'Q', suit: 'D' },
  { id: 'QC', rank: 'Q', suit: 'C' },
  { id: 'QH', rank: 'Q', suit: 'H' },
];
const STRAIGHT_5: Card[] = [
  { id: '3D', rank: '3', suit: 'D' },
  { id: '4C', rank: '4', suit: 'C' },
  { id: '5H', rank: '5', suit: 'H' },
  { id: '6S', rank: '6', suit: 'S' },
  { id: '7D', rank: '7', suit: 'D' },
];
const LAST_PLAY_SINGLE: LastPlay = {
  cards: [{ id: '10D', rank: '10', suit: 'D' }],
  playedBy: 'opponent',
  comboType: 'Single',
};
const LAST_PLAY_PAIR: LastPlay = {
  cards: PAIR,
  playedBy: 'opponent',
  comboType: 'Pair',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run `fn` N times and return milliseconds per call (average).
 * Excludes the first 10 iterations as JIT warm-up.
 */
function benchmarkMs(fn: () => unknown, iterations: number, warmup = 10): number {
  for (let i = 0; i < warmup; i++) fn(); // warm up JIT
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  return (performance.now() - start) / iterations;
}

/**
 * Scale timing budgets in CI to account for CPU throttling / noisy neighbours
 * on 2-vCPU runners. 3× gives ample headroom without masking real regressions.
 */
const CI_BUDGET_MULTIPLIER = process.env.CI ? 3 : 1;

// ─── Benchmarks ───────────────────────────────────────────────────────────────

describe('Performance Benchmarks — Card Rendering & Game Logic (Task #328)', () => {
  // ── sortHand ───────────────────────────────────────────────────────────────

  describe('sortHand', () => {
    const ITERATIONS = 5000;

    it(`sorts 13 cards in < 1 ms per call (${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(() => sortHand(HAND_13), ITERATIONS);
      expect(ms).toBeLessThan(1 * CI_BUDGET_MULTIPLIER);
    });

    it(`sorts 13-card reversed hand in < 1 ms per call (${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(() => sortHand(HAND_13_REVERSED), ITERATIONS);
      expect(ms).toBeLessThan(1 * CI_BUDGET_MULTIPLIER);
    });

    it('returns a new array (does not mutate source)', () => {
      const copy = [...HAND_13];
      const sorted = sortHand(HAND_13_REVERSED);
      expect(sorted).not.toBe(HAND_13_REVERSED); // new reference
      expect(HAND_13).toEqual(copy); // original unchanged
    });
  });

  // ── classifyCards ─────────────────────────────────────────────────────────

  describe('classifyCards', () => {
    const ITERATIONS = 5000;

    it(`classifies Single in < 1 ms per call (${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(() => classifyCards(SINGLE), ITERATIONS);
      expect(ms).toBeLessThan(1 * CI_BUDGET_MULTIPLIER);
    });

    it(`classifies Pair in < 1 ms per call (${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(() => classifyCards(PAIR), ITERATIONS);
      expect(ms).toBeLessThan(1 * CI_BUDGET_MULTIPLIER);
    });

    it(`classifies Triple in < 1 ms per call (${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(() => classifyCards(TRIPLE), ITERATIONS);
      expect(ms).toBeLessThan(1 * CI_BUDGET_MULTIPLIER);
    });

    it(`classifies Straight (5-card combo) in < 1 ms per call (${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(() => classifyCards(STRAIGHT_5), ITERATIONS);
      expect(ms).toBeLessThan(1 * CI_BUDGET_MULTIPLIER);
    });
  });

  // ── classifyAndSortCards ──────────────────────────────────────────────────

  describe('classifyAndSortCards', () => {
    const ITERATIONS = 5000;

    it(`classifies+sorts 5-card combo in < 1 ms per call (${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(() => classifyAndSortCards(STRAIGHT_5), ITERATIONS);
      expect(ms).toBeLessThan(1 * CI_BUDGET_MULTIPLIER);
    });
  });

  // ── canBeatPlay ────────────────────────────────────────────────────────────

  describe('canBeatPlay', () => {
    const ITERATIONS = 2000;

    it(`evaluates beat-single in < 2 ms per call (${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(
        () => canBeatPlay([{ id: 'AS', rank: 'A', suit: 'S' }], LAST_PLAY_SINGLE),
        ITERATIONS
      );
      expect(ms).toBeLessThan(2 * CI_BUDGET_MULTIPLIER);
    });

    it(`evaluates beat-pair in < 2 ms per call (${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(
        () =>
          canBeatPlay(
            [
              { id: 'AH', rank: 'A', suit: 'H' },
              { id: 'AS', rank: 'A', suit: 'S' },
            ],
            LAST_PLAY_PAIR
          ),
        ITERATIONS
      );
      expect(ms).toBeLessThan(2 * CI_BUDGET_MULTIPLIER);
    });

    it(`returns false quickly when no beat possible (< 2 ms per call, ${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(
        () => canBeatPlay([{ id: '3D', rank: '3', suit: 'D' }], LAST_PLAY_SINGLE),
        ITERATIONS
      );
      expect(ms).toBeLessThan(2 * CI_BUDGET_MULTIPLIER);
    });
  });

  // ── findRecommendedPlay ────────────────────────────────────────────────────

  describe('findRecommendedPlay', () => {
    const ITERATIONS = 500;

    it(`finds recommended play from 13-card hand in < 5 ms per call (${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(() => findRecommendedPlay(HAND_13, LAST_PLAY_SINGLE), ITERATIONS);
      expect(ms).toBeLessThan(5 * CI_BUDGET_MULTIPLIER);
    });

    it(`finds recommended play with no last play (opening move) in < 5 ms per call (${ITERATIONS} iterations)`, () => {
      const ms = benchmarkMs(() => findRecommendedPlay(HAND_13, null), ITERATIONS);
      expect(ms).toBeLessThan(5 * CI_BUDGET_MULTIPLIER);
    });
  });

  // ── State update simulation ────────────────────────────────────────────────
  // Simulates the hot path: a card tap triggers sortHand + classifyCards for
  // rendering the updated selection badge. Must complete well under one frame
  // (16.67 ms at 60 fps) even when processing a full 13-card hand.

  describe('Card selection state update (hot path)', () => {
    const ITERATIONS = 1000;
    const FRAME_BUDGET_MS = 16.67; // 60 fps

    it(`sortHand + classifyCards total hot-path < ${FRAME_BUDGET_MS} ms per call`, () => {
      const selectedCards = HAND_13.slice(0, 3);
      const ms = benchmarkMs(() => {
        const sorted = sortHand(HAND_13);
        const combo = classifyCards(selectedCards);
        return { sorted, combo };
      }, ITERATIONS);
      expect(ms).toBeLessThan(FRAME_BUDGET_MS);
    });
  });
});
