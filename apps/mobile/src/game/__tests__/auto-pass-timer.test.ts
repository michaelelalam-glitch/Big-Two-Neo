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
      const playedCards: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
      ];
      
      expect(shouldTriggerAutoPassTimer(play, playedCards)).toBe(true);
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
    it('should fire onComplete callback after duration', (done) => {
      const timerId = 'test-timer';
      const duration = 150; // Increased from 100 to avoid flaky tests
      
      let tickCount = 0;
      
      startTimer(
        timerId,
        duration,
        (remaining) => {
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

    it('should fire onTick callbacks periodically', (done) => {
      const timerId = 'tick-timer';
      const duration = 300;
      
      const tickValues: number[] = [];
      
      startTimer(
        timerId,
        duration,
        (remaining) => {
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

    it('should replace existing timer with same ID', (done) => {
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
  });

  describe('cancelTimer', () => {
    it('should stop timer and prevent callbacks', (done) => {
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
    it('should cancel multiple active timers', (done) => {
      let completed1 = false;
      let completed2 = false;
      let completed3 = false;
      
      startTimer('timer1', 200, () => {}, () => { completed1 = true; });
      startTimer('timer2', 200, () => {}, () => { completed2 = true; });
      startTimer('timer3', 200, () => {}, () => { completed3 = true; });
      
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
      
      startTimer(timerId, 1000, () => {}, () => {});
      
      expect(isTimerActive(timerId)).toBe(true);
      
      cancelTimer(timerId);
    });

    it('should return false for non-existent timer', () => {
      expect(isTimerActive('non-existent')).toBe(false);
    });

    it('should return false after timer completes', (done) => {
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
