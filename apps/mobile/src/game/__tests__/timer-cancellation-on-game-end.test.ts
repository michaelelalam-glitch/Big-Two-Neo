/**
 * Tests for Auto-Pass Timer Cancellation on Game End
 * 
 * This test suite verifies the critical fix for the infinite loop bug
 * where the timer would continue running after a match/game ended.
 * 
 * Bug: When bot plays last card + highest play, timer starts but never
 * cancels on match end, causing 60+ state updates/second until crash.
 * 
 * Fix: Timer countdown checks gameEnded/gameOver and cancels timer state.
 */

import { GameStateManager } from '../state';
import type { GameConfig } from '../types';

describe('Auto-Pass Timer Cancellation on Game End', () => {
  let manager: GameStateManager;
  
  const testConfig: GameConfig = {
    playerName: 'TestPlayer',
    botCount: 3,
    botDifficulty: 'medium',
  };

  beforeEach(() => {
    manager = new GameStateManager();
  });

  afterEach(() => {
    // Clean up timer interval
    manager.destroy();
  });

  /**
   * Critical Test: Timer must stop when match ends
   * 
   * This reproduces the exact bug scenario:
   * 1. Timer is active (bot played highest card)
   * 2. Match ends (bot played last card)
   * 3. Timer countdown should detect gameEnded and cancel
   * 4. No infinite state update loop should occur
   */
  it('should cancel timer when match ends while timer is active', async () => {
    // Initialize game
    const state = await manager.initializeGame(testConfig);
    
    // Simulate: Bot plays highest card (timer starts)
    // We'll manually set the timer state to simulate this
    if (state) {
      state.auto_pass_timer = {
        active: true,
        player_id: 'bot_2',
        started_at: new Date().toISOString(),
        duration_ms: 10000,
        remaining_ms: 10000,
      };
    }
    
    // Verify timer is active
    expect(state?.auto_pass_timer?.active).toBe(true);
    
    // Simulate: Match ends (set gameEnded flag)
    if (state) {
      state.gameEnded = true;
    }
    
    // Wait for a few timer ticks (timer runs every 100ms)
    await new Promise(resolve => setTimeout(resolve, 350)); // ~3 ticks
    
    // CRITICAL CHECK: Timer should be cancelled (null) by now
    // The timer countdown detected gameEnded and set auto_pass_timer = null
    // NOTE: The timer interval itself continues running (by design) and only
    // becomes inactive when auto_pass_timer is null. The interval is only
    // cleared in destroy() method. This test verifies the timer STATE is
    // properly cancelled, which prevents the infinite loop.
    const currentState = manager.getState();
    expect(currentState?.auto_pass_timer).toBeNull();
    
    // Additional verification: gameEnded flag should still be true
    expect(currentState?.gameEnded).toBe(true);
  });

  /**
   * Critical Test: Timer must stop when game is over
   * 
   * Similar to match end, but tests the gameOver flag
   */
  it('should cancel timer when game is over while timer is active', async () => {
    // Initialize game
    const state = await manager.initializeGame(testConfig);
    
    // Simulate: Timer is active
    if (state) {
      state.auto_pass_timer = {
        active: true,
        player_id: 'bot_1',
        started_at: new Date().toISOString(),
        duration_ms: 10000,
        remaining_ms: 10000,
      };
    }
    
    // Verify timer is active
    expect(state?.auto_pass_timer?.active).toBe(true);
    
    // Simulate: Game over (someone reached 101+ points)
    if (state) {
      state.gameOver = true;
    }
    
    // Wait for timer ticks
    await new Promise(resolve => setTimeout(resolve, 350));
    
    // CRITICAL CHECK: Timer should be cancelled
    const currentState = manager.getState();
    expect(currentState?.auto_pass_timer).toBeNull();
    expect(currentState?.gameOver).toBe(true);
  });

  /**
   * Test: Timer should NOT be cancelled if game is still in progress
   * 
   * Ensures the fix doesn't break normal timer operation
   */
  it('should keep timer running when game is still in progress', async () => {
    // Initialize game
    const state = await manager.initializeGame(testConfig);
    
    // Simulate: Timer is active and game is in progress
    if (state) {
      state.auto_pass_timer = {
        active: true,
        player_id: 'bot_3',
        started_at: new Date().toISOString(),
        duration_ms: 10000,
        remaining_ms: 10000,
      };
      state.gameEnded = false;
      state.gameOver = false;
    }
    
    // Wait for timer ticks
    await new Promise(resolve => setTimeout(resolve, 350));
    
    // Timer should STILL be active (not cancelled)
    const currentState = manager.getState();
    expect(currentState?.auto_pass_timer).not.toBeNull();
    expect(currentState?.auto_pass_timer?.active).toBe(true);
    
    // Remaining time should have decreased
    expect(currentState?.auto_pass_timer?.remaining_ms).toBeLessThan(10000);
  });

  /**
   * Test: Verify no infinite loop when timer expires on ended game
   * 
   * This tests the scenario where timer wasn't cancelled and tries
   * to auto-pass after 10 seconds on an already-ended game
   */
  it('should not cause infinite loop if timer expires after game ends', async () => {
    // Initialize game
    const state = await manager.initializeGame(testConfig);
    
    // Simulate: Timer with very short duration (100ms for quick test)
    if (state) {
      state.auto_pass_timer = {
        active: true,
        player_id: 'bot_2',
        started_at: new Date().toISOString(),
        duration_ms: 100, // Very short for testing
        remaining_ms: 100,
      };
      
      // Game ends immediately
      state.gameEnded = true;
    }
    
    // Wait longer than timer duration
    await new Promise(resolve => setTimeout(resolve, 250));
    
    // Timer should be cancelled, not expired and trying to auto-pass
    const currentState = manager.getState();
    expect(currentState?.auto_pass_timer).toBeNull();
    
    // Game state should be stable (no crashes or state corruption)
    expect(currentState?.gameEnded).toBe(true);
  });
});
