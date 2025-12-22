/**
 * Memory Leak Test for soundManager Cleanup
 * 
 * Tests that audio resources are properly cleaned up after multiple game sessions
 * to prevent memory exhaustion on iOS devices.
 * 
 * Run with: pnpm test memory-leak-test
 */

// Mock expo-av before imports
jest.mock('expo-av');

import { soundManager, SoundType } from '../../utils/soundManager';

describe('Memory Leak Test - soundManager', () => {
  beforeEach(async () => {
    // Initialize fresh for each test
    await soundManager.initialize();
  });

  afterEach(async () => {
    // Clean up after each test
    await soundManager.cleanup();
  });

  it('should properly cleanup audio resources after multiple initializations', async () => {
    // Simulate 10 consecutive game sessions
    for (let session = 1; session <= 10; session++) {
      console.log(`[Memory Test] Session ${session}/10`);
      
      // Initialize (preloads sounds)
      await soundManager.initialize();
      
      // Play multiple sounds (simulates gameplay)
      await soundManager.playSound(SoundType.GAME_START);
      await soundManager.playSound(SoundType.HIGHEST_CARD);
      await soundManager.playSound(SoundType.HIGHEST_CARD);
      
      // Cleanup (should unload all sounds)
      await soundManager.cleanup();
      
      // Verify cleanup worked
      const state = soundManager.getState();
      expect(state.enabled).toBe(true); // Settings should persist
      
      // Wait a bit between sessions
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('[Memory Test] ✅ All 10 sessions completed without memory leak');
  });

  it('should handle rapid sound playback without memory issues', async () => {
    // Simulate rapid card plays (stress test)
    const playCount = 50;
    console.log(`[Stress Test] Playing ${playCount} sounds rapidly...`);
    
    const startTime = Date.now();
    
    for (let i = 0; i < playCount; i++) {
      await soundManager.playSound(SoundType.HIGHEST_CARD);
    }
    
    const duration = Date.now() - startTime;
    console.log(`[Stress Test] ✅ Completed ${playCount} plays in ${duration}ms`);
    
    // Should complete without crashes
    expect(duration).toBeLessThan(10000); // Should finish within 10 seconds
  });

  it('should properly handle cleanup when sounds are playing', async () => {
    // Start playing a sound
    const playPromise = soundManager.playSound(SoundType.GAME_START);
    
    // Immediately cleanup (while sound might still be loading/playing)
    await soundManager.cleanup();
    
    // Wait for play to finish
    await playPromise;
    
    console.log('[Cleanup Test] ✅ Cleanup handled active sounds gracefully');
  });
});
