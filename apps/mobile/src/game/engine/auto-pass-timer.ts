/**
 * Auto-Pass Timer Manager
 * 
 * Manages the 10-second countdown timer that triggers when the highest possible
 * card/combo is played. Automatically passes for players who don't respond in time.
 */

import type { Card, LastPlay, AutoPassTimerState } from '../types';
import { isHighestPossiblePlay } from './highest-play-detector';

/**
 * Timer configuration
 */
export const AUTO_PASS_TIMER_DURATION_MS = 10000; // 10 seconds

/**
 * Timer instance tracking
 */
interface TimerInstance {
  timeoutId: NodeJS.Timeout;
  intervalId: NodeJS.Timeout;
  onTick: (remainingMs: number) => void;
  onComplete: () => void;
}

const activeTimers = new Map<string, TimerInstance>();

/**
 * Check if a play triggers the auto-pass timer
 * 
 * @param cards - Cards in the current play
 * @param playedCards - All cards previously played in the game
 * @returns true if this is the highest possible play
 */
export function shouldTriggerAutoPassTimer(
  cards: Card[],
  playedCards: Card[]
): boolean {
  return isHighestPossiblePlay(cards, playedCards);
}

/**
 * Create auto-pass timer state when a highest play is detected
 * 
 * @param triggeringPlay - The play that triggered the timer
 * @returns AutoPassTimerState object
 */
export function createAutoPassTimerState(
  triggeringPlay: LastPlay
): AutoPassTimerState {
  return {
    active: true,
    started_at: new Date().toISOString(),
    duration_ms: AUTO_PASS_TIMER_DURATION_MS,
    remaining_ms: AUTO_PASS_TIMER_DURATION_MS,
    triggering_play: triggeringPlay,
  };
}

/**
 * Update timer state with remaining time
 * 
 * @param timerState - Current timer state
 * @returns Updated timer state with recalculated remaining_ms
 */
export function updateTimerState(
  timerState: AutoPassTimerState
): AutoPassTimerState {
  const startedAt = new Date(timerState.started_at).getTime();
  const now = Date.now();
  const elapsed = now - startedAt;
  const remaining = Math.max(0, timerState.duration_ms - elapsed);
  
  return {
    ...timerState,
    remaining_ms: remaining,
    active: remaining > 0,
  };
}

/**
 * Start a countdown timer
 * 
 * @param timerId - Unique identifier for this timer
 * @param durationMs - Duration in milliseconds
 * @param onTick - Callback fired every 100ms with remaining time
 * @param onComplete - Callback fired when timer expires
 */
export function startTimer(
  timerId: string,
  durationMs: number,
  onTick: (remainingMs: number) => void,
  onComplete: () => void
): void {
  // Cancel existing timer if any
  cancelTimer(timerId);
  
  const startTime = Date.now();
  
  // Set up completion timeout
  const timeoutId = setTimeout(() => {
    cancelTimer(timerId);
    onComplete();
  }, durationMs);
  
  // Set up tick interval (every 100ms for smooth UI updates)
  const intervalId = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, durationMs - elapsed);
    
    onTick(remaining);
    
    if (remaining === 0) {
      clearInterval(intervalId);
    }
  }, 100);
  
  // Store timer instance
  activeTimers.set(timerId, {
    timeoutId,
    intervalId,
    onTick,
    onComplete,
  });
}

/**
 * Cancel a running timer
 * 
 * @param timerId - Unique identifier of timer to cancel
 */
export function cancelTimer(timerId: string): void {
  const timer = activeTimers.get(timerId);
  if (timer) {
    clearTimeout(timer.timeoutId);
    clearInterval(timer.intervalId);
    activeTimers.delete(timerId);
  }
}

/**
 * Cancel all active timers (cleanup on unmount)
 */
export function cancelAllTimers(): void {
  activeTimers.forEach((timer, timerId) => {
    cancelTimer(timerId);
  });
}

/**
 * Check if a timer is currently active
 * 
 * @param timerId - Timer identifier to check
 * @returns true if timer is running
 */
export function isTimerActive(timerId: string): boolean {
  return activeTimers.has(timerId);
}
