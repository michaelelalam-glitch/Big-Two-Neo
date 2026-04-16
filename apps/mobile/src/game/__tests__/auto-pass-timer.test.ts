/**
 * Tests for Auto-Pass Timer Manager
 */

import {
  shouldTriggerAutoPassTimer,
  createAutoPassTimerState,
  updateTimerState,
  startTimer,
  cancelTimer,
  cancelAllTimers,
  isTimerActive,
  AUTO_PASS_TIMER_DURATION_MS,
} from '../engine/auto-pass-timer';
import type { Card, LastPlay } from '../types';

describe('Auto-Pass Timer Manager', () => {
  beforeEach(() => {
    // Clear all timers before each test
    cancelAllTimers();
  });

  afterEach(() => {
    // Cleanup after each test
    cancelAllTimers();
  });

  describe('shouldTriggerAutoPassTimer', () => {
    it('should trigger for 2♠ (highest single)', () => {
      const play: Card[] = [{ id: '2S', rank: '2', suit: 'S' }];
      const playedCards: Card[] = [];

      expect(shouldTriggerAutoPassTimer(play, playedCards)).toBe(true);
    });

    it('should NOT trigger for A♠ when 2♠ is still unplayed', () => {
      const play: Card[] = [{ id: 'AS', rank: 'A', suit: 'S' }];
      const playedCards: Card[] = [];

      expect(shouldTriggerAutoPassTimer(play, playedCards)).toBe(false);
    });

    it('should trigger for A♠ when all 2s are played', () => {
      const play: Card[] = [{ id: 'AS', rank: 'A', suit: 'S' }];
      const playedCards: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
        { id: '2C', rank: '2', suit: 'C' },
        { id: '2D', rank: '2', suit: 'D' },
      ];

      expect(shouldTriggerAutoPassTimer(play, playedCards)).toBe(true);
    });

    it('should trigger for highest remaining pair', () => {
      const play: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
      ];
      const playedCards: Card[] = [];

      expect(shouldTriggerAutoPassTimer(play, playedCards)).toBe(true);
    });

    it('should trigger for 2♣-2♦ pair when only 2♠ is played', () => {
      const play: Card[] = [
        { id: '2C', rank: '2', suit: 'C' },
        { id: '2D', rank: '2', suit: 'D' },
      ];
      const playedCards: Card[] = [{ id: '2S', rank: '2', suit: 'S' }];

      expect(shouldTriggerAutoPassTimer(play, playedCards)).toBe(true);
    });
  });

  // ── 5-card combo shouldTriggerAutoPassTimer tests ────────────────────────────
  //
  // "Last-N-cards" approach: build allExcept(play) as playedCards so the
  // remaining deck contains only the play → no stronger combo is formable.
  // ─────────────────────────────────────────────────────────────────────────────

  describe('shouldTriggerAutoPassTimer — 5-card combos', () => {
    type Rank = '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
    type Suit = 'D' | 'C' | 'H' | 'S';

    /** All 52 cards except the specified play cards */
    function allExcept(cards: Card[]): Card[] {
      const ids = new Set(cards.map(c => c.id));
      const result: Card[] = [];
      const ranks: Rank[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
      const suits: Suit[] = ['D', 'C', 'H', 'S'];
      for (const r of ranks) {
        for (const s of suits) {
          const id = `${r}${s}`;
          if (!ids.has(id)) result.push({ id, rank: r, suit: s });
        }
      }
      return result;
    }

    // ── Full House ────────────────────────────────────────────────────────────

    it('should TRIGGER for Full House 2-2-2-A-A when it is the last 5 cards in the deck', () => {
      const play: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
        { id: '2D', rank: '2', suit: 'D' },
        { id: 'AS', rank: 'A', suit: 'S' },
        { id: 'AH', rank: 'A', suit: 'H' },
      ];
      expect(shouldTriggerAutoPassTimer(play, allExcept(play))).toBe(true);
    });

    it('should TRIGGER for Full House A-A-A-K-K when it is the last 5 cards', () => {
      const play: Card[] = [
        { id: 'AS', rank: 'A', suit: 'S' },
        { id: 'AH', rank: 'A', suit: 'H' },
        { id: 'AD', rank: 'A', suit: 'D' },
        { id: 'KS', rank: 'K', suit: 'S' },
        { id: 'KH', rank: 'K', suit: 'H' },
      ];
      expect(shouldTriggerAutoPassTimer(play, allExcept(play))).toBe(true);
    });

    it('should NOT trigger for Full House K-K-K-Q-Q when higher combos are possible', () => {
      const play: Card[] = [
        { id: 'KS', rank: 'K', suit: 'S' },
        { id: 'KH', rank: 'K', suit: 'H' },
        { id: 'KD', rank: 'K', suit: 'D' },
        { id: 'QS', rank: 'Q', suit: 'S' },
        { id: 'QH', rank: 'Q', suit: 'H' },
      ];
      // With nothing played, triple-2 FH is still possible → NOT highest
      expect(shouldTriggerAutoPassTimer(play, [])).toBe(false);
    });

    it('should NOT trigger for Full House 2-2-2-6-6 when SF is still possible', () => {
      // Real false-positive guard from Screenshot 3 scenario
      const play: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
        { id: '2D', rank: '2', suit: 'D' },
        { id: '6S', rank: '6', suit: 'S' },
        { id: '6H', rank: '6', suit: 'H' },
      ];
      expect(shouldTriggerAutoPassTimer(play, [])).toBe(false);
    });

    // ── Flush ─────────────────────────────────────────────────────────────────

    it('should TRIGGER for Flush [2♠,A♠,K♠,Q♠,J♠] when it is the last 5 cards', () => {
      const play: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: 'AS', rank: 'A', suit: 'S' },
        { id: 'KS', rank: 'K', suit: 'S' },
        { id: 'QS', rank: 'Q', suit: 'S' },
        { id: 'JS', rank: 'J', suit: 'S' },
      ];
      expect(shouldTriggerAutoPassTimer(play, allExcept(play))).toBe(true);
    });

    it('should NOT trigger for Flush A♠-K♠-Q♠-J♠-9♠ when SF is still possible', () => {
      const play: Card[] = [
        { id: 'AS', rank: 'A', suit: 'S' },
        { id: 'KS', rank: 'K', suit: 'S' },
        { id: 'QS', rank: 'Q', suit: 'S' },
        { id: 'JS', rank: 'J', suit: 'S' },
        { id: '9S', rank: '9', suit: 'S' },
      ];
      expect(shouldTriggerAutoPassTimer(play, [])).toBe(false);
    });

    // ── Straight ──────────────────────────────────────────────────────────────

    it('should TRIGGER for Straight 10-J-Q-K-A (mixed suits) when it is the last 5 cards', () => {
      const play: Card[] = [
        { id: '10D', rank: '10', suit: 'D' },
        { id: 'JC', rank: 'J', suit: 'C' },
        { id: 'QH', rank: 'Q', suit: 'H' },
        { id: 'KS', rank: 'K', suit: 'S' },
        { id: 'AD', rank: 'A', suit: 'D' },
      ];
      expect(shouldTriggerAutoPassTimer(play, allExcept(play))).toBe(true);
    });

    it('should NOT trigger for Straight 3-4-5-6-7 when plenty of cards remain', () => {
      const play: Card[] = [
        { id: '3H', rank: '3', suit: 'H' },
        { id: '4D', rank: '4', suit: 'D' },
        { id: '5S', rank: '5', suit: 'S' },
        { id: '6C', rank: '6', suit: 'C' },
        { id: '7H', rank: '7', suit: 'H' },
      ];
      expect(shouldTriggerAutoPassTimer(play, [])).toBe(false);
    });

    it('should TRIGGER for Straight A-2-3-4-5 (mixed suits) when it is the last 5 cards', () => {
      const play: Card[] = [
        { id: 'AD', rank: 'A', suit: 'D' },
        { id: '2C', rank: '2', suit: 'C' },
        { id: '3H', rank: '3', suit: 'H' },
        { id: '4S', rank: '4', suit: 'S' },
        { id: '5D', rank: '5', suit: 'D' },
      ];
      expect(shouldTriggerAutoPassTimer(play, allExcept(play))).toBe(true);
    });
  });

  describe('createAutoPassTimerState', () => {
    it('should create timer state with correct defaults', () => {
      const triggeringPlay: LastPlay = {
        position: 0,
        cards: [{ id: '2S', rank: '2', suit: 'S' }],
        combo_type: 'Single',
      };

      const timerState = createAutoPassTimerState(triggeringPlay, 'player1');

      expect(timerState.active).toBe(true);
      expect(timerState.duration_ms).toBe(AUTO_PASS_TIMER_DURATION_MS);
      expect(timerState.remaining_ms).toBe(AUTO_PASS_TIMER_DURATION_MS);
      expect(timerState.triggering_play).toEqual(triggeringPlay);
      expect(timerState.player_id).toBe('player1');
      expect(new Date(timerState.started_at).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('updateTimerState', () => {
    it('should calculate correct remaining time', async () => {
      const triggeringPlay: LastPlay = {
        position: 0,
        cards: [{ id: '2S', rank: '2', suit: 'S' }],
        combo_type: 'Single',
      };

      const timerState = createAutoPassTimerState(triggeringPlay, 'player1');

      // Wait 100ms
      await new Promise(resolve => setTimeout(resolve, 100));

      const updated = updateTimerState(timerState);

      expect(updated.remaining_ms).toBeLessThan(AUTO_PASS_TIMER_DURATION_MS);
      expect(updated.remaining_ms).toBeGreaterThan(AUTO_PASS_TIMER_DURATION_MS - 200); // Allow margin
      expect(updated.active).toBe(true);
    });

    it('should mark timer as inactive when expired', () => {
      const triggeringPlay: LastPlay = {
        position: 0,
        cards: [{ id: '2S', rank: '2', suit: 'S' }],
        combo_type: 'Single',
      };

      // Create timer that already expired
      const timerState = createAutoPassTimerState(triggeringPlay, 'player1');
      const expiredState = {
        ...timerState,
        started_at: new Date(Date.now() - AUTO_PASS_TIMER_DURATION_MS - 1000).toISOString(),
      };

      const updated = updateTimerState(expiredState);

      expect(updated.remaining_ms).toBe(0);
      expect(updated.active).toBe(false);
    });
  });

  describe('startTimer', () => {
    it('should fire onComplete callback after duration', done => {
      const timerId = 'test-timer';
      const duration = 150; // Increased from 100 to avoid flaky tests

      let tickCount = 0;

      startTimer(
        timerId,
        duration,
        remaining => {
          tickCount++;
          expect(remaining).toBeLessThanOrEqual(duration);
          expect(remaining).toBeGreaterThanOrEqual(0);
        },
        () => {
          expect(tickCount).toBeGreaterThan(0);
          expect(isTimerActive(timerId)).toBe(false);
          done();
        }
      );

      expect(isTimerActive(timerId)).toBe(true);
    }, 10000); // 10 second timeout to prevent flaky failures

    it('should fire onTick callbacks periodically', done => {
      const timerId = 'tick-timer';
      const duration = 300;

      const tickValues: number[] = [];

      startTimer(
        timerId,
        duration,
        remaining => {
          tickValues.push(remaining);
        },
        () => {
          // Should have multiple ticks (duration 300ms / 100ms interval = 3+)
          expect(tickValues.length).toBeGreaterThan(1);

          // Values should be descending
          for (let i = 1; i < tickValues.length; i++) {
            expect(tickValues[i]).toBeLessThanOrEqual(tickValues[i - 1]);
          }

          done();
        }
      );
    });

    it('should replace existing timer with same ID', done => {
      const timerId = 'replace-timer';

      let firstCompleted = false;
      let secondCompleted = false;

      // Start first timer
      startTimer(
        timerId,
        200,
        () => {},
        () => {
          firstCompleted = true;
        }
      );

      // Immediately start second timer with same ID
      startTimer(
        timerId,
        100,
        () => {},
        () => {
          secondCompleted = true;

          // Only second timer should complete
          expect(firstCompleted).toBe(false);
          expect(secondCompleted).toBe(true);
          done();
        }
      );
    });

    it('5.1 — onTick is never called with remaining=0 and onComplete fires exactly once', done => {
      // Regression guard for the decoupled setTimeout/setInterval fix.
      // Before the fix: the interval could fire onTick(0) AND the timeout fired
      // onComplete() moments later — two separate auto-pass triggers.
      // After the fix: interval only calls onTick when remaining > 0; setTimeout
      // is the sole caller of onComplete (exactly once).
      const timerId = 'decouple-test';
      const duration = 200;

      let zeroTickCount = 0;
      let completeCount = 0;

      startTimer(
        timerId,
        duration,
        remaining => {
          if (remaining === 0) zeroTickCount++;
        },
        () => {
          completeCount++;
          // Give an extra interval cycle (150ms) to ensure no late onTick(0) arrives.
          setTimeout(() => {
            expect(zeroTickCount).toBe(0); // interval must never call onTick(0)
            expect(completeCount).toBe(1); // onComplete fires exactly once
            done();
          }, 150);
        }
      );
    }, 10000);
  });

  describe('cancelTimer', () => {
    it('should stop timer and prevent callbacks', done => {
      const timerId = 'cancel-timer';

      let tickCount = 0;
      let completed = false;

      startTimer(
        timerId,
        200,
        () => {
          tickCount++;
        },
        () => {
          completed = true;
        }
      );

      // Cancel after 50ms
      setTimeout(() => {
        cancelTimer(timerId);

        const ticksBeforeCancel = tickCount;

        // Wait another 200ms to ensure no more callbacks
        setTimeout(() => {
          expect(completed).toBe(false);
          expect(tickCount).toBe(ticksBeforeCancel); // No additional ticks
          expect(isTimerActive(timerId)).toBe(false);
          done();
        }, 200);
      }, 50);
    });
  });

  describe('cancelAllTimers', () => {
    it('should cancel multiple active timers', done => {
      let completed1 = false;
      let completed2 = false;
      let completed3 = false;

      startTimer(
        'timer1',
        200,
        () => {},
        () => {
          completed1 = true;
        }
      );
      startTimer(
        'timer2',
        200,
        () => {},
        () => {
          completed2 = true;
        }
      );
      startTimer(
        'timer3',
        200,
        () => {},
        () => {
          completed3 = true;
        }
      );

      expect(isTimerActive('timer1')).toBe(true);
      expect(isTimerActive('timer2')).toBe(true);
      expect(isTimerActive('timer3')).toBe(true);

      // Cancel all after 50ms
      setTimeout(() => {
        cancelAllTimers();

        expect(isTimerActive('timer1')).toBe(false);
        expect(isTimerActive('timer2')).toBe(false);
        expect(isTimerActive('timer3')).toBe(false);

        // Wait to ensure no callbacks fire
        setTimeout(() => {
          expect(completed1).toBe(false);
          expect(completed2).toBe(false);
          expect(completed3).toBe(false);
          done();
        }, 200);
      }, 50);
    });
  });

  describe('isTimerActive', () => {
    it('should return true for active timer', () => {
      const timerId = 'active-timer';

      startTimer(
        timerId,
        1000,
        () => {},
        () => {}
      );

      expect(isTimerActive(timerId)).toBe(true);

      cancelTimer(timerId);
    });

    it('should return false for non-existent timer', () => {
      expect(isTimerActive('non-existent')).toBe(false);
    });

    it('should return false after timer completes', done => {
      const timerId = 'complete-timer';

      startTimer(
        timerId,
        100,
        () => {},
        () => {
          expect(isTimerActive(timerId)).toBe(false);
          done();
        }
      );
    });
  });
});
