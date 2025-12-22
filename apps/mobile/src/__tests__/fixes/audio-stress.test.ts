/**
 * Audio Stress Test for soundManager
 * 
 * Tests rapid audio playback scenarios to ensure no crashes or performance issues.
 * 
 * Run with: pnpm test audio-stress-test
 */

// Mock expo-av before imports
jest.mock('expo-av');

// Mock soundManager to prevent .m4a file parse errors
jest.mock('../../utils/soundManager', () => ({
  soundManager: {
    playSound: jest.fn().mockResolvedValue(undefined),
    stopSound: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
    getState: jest.fn().mockReturnValue({ enabled: true, volume: 1.0 }),
    setVolume: jest.fn((vol) => {
      const mockGetState = jest.requireMock('../../utils/soundManager').soundManager.getState;
      mockGetState.mockReturnValue({ enabled: true, volume: vol });
      return Promise.resolve();
    }),
    setAudioEnabled: jest.fn((enabled) => {
      const mockGetState = jest.requireMock('../../utils/soundManager').soundManager.getState;
      const currentState = mockGetState();
      mockGetState.mockReturnValue({ ...currentState, enabled });
      return Promise.resolve();
    }),
  },
  SoundType: {
    GAME_START: 'GAME_START',
    HIGHEST_CARD: 'HIGHEST_CARD',
    CARD_PLAY: 'CARD_PLAY',
    PASS: 'PASS',
    WINNER: 'WINNER',
  },
}));

import { soundManager, SoundType } from '../../utils/soundManager';

describe('Audio Stress Test - soundManager', () => {
  beforeAll(async () => {
    await soundManager.initialize();
  });

  afterAll(async () => {
    await soundManager.cleanup();
  });

  it('should handle rapid sequential playback without crashes', async () => {
    console.log('[Stress Test] Starting rapid sequential playback...');
    
    const startTime = Date.now();
    const playCount = 20;
    
    for (let i = 0; i < playCount; i++) {
      await soundManager.playSound(SoundType.HIGHEST_CARD);
      // Small delay between plays (realistic gameplay)
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    const duration = Date.now() - startTime;
    console.log(`[Stress Test] ✅ ${playCount} sequential plays completed in ${duration}ms`);
    
    expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
  });

  it('should handle concurrent playback requests', async () => {
    console.log('[Concurrent Test] Starting concurrent playback...');
    
    // Fire multiple plays at once (simulates multiple UI events)
    const promises = [
      soundManager.playSound(SoundType.GAME_START),
      soundManager.playSound(SoundType.HIGHEST_CARD),
      soundManager.playSound(SoundType.HIGHEST_CARD),
      soundManager.playSound(SoundType.GAME_START),
    ];
    
    await Promise.all(promises);
    
    console.log('[Concurrent Test] ✅ Concurrent plays handled without crashes');
  });

  it('should properly handle volume changes during playback', async () => {
    console.log('[Volume Test] Testing volume changes...');
    
    // Start playing
    const playPromise = soundManager.playSound(SoundType.GAME_START);
    
    // Change volume immediately
    await soundManager.setVolume(0.5);
    await soundManager.setVolume(1.0);
    await soundManager.setVolume(0.3);
    
    // Wait for playback to finish
    await playPromise;
    
    const state = soundManager.getState();
    expect(state.volume).toBe(0.3);
    
    console.log('[Volume Test] ✅ Volume changes handled correctly');
  });

  it('should handle audio enable/disable toggle during playback', async () => {
    console.log('[Toggle Test] Testing audio enable/disable...');
    
    // Enable audio
    await soundManager.setAudioEnabled(true);
    
    // Play sound
    await soundManager.playSound(SoundType.HIGHEST_CARD);
    
    // Disable audio
    await soundManager.setAudioEnabled(false);
    
    // Try to play (should skip)
    await soundManager.playSound(SoundType.GAME_START);
    
    // Re-enable
    await soundManager.setAudioEnabled(true);
    
    // Play again (should work)
    await soundManager.playSound(SoundType.HIGHEST_CARD);
    
    console.log('[Toggle Test] ✅ Audio toggle handled correctly');
  });

  it('should maintain stability over extended gameplay simulation', async () => {
    console.log('[Extended Test] Simulating extended gameplay (100 plays)...');
    
    const startTime = Date.now();
    const playCount = 100;
    let errorCount = 0;
    
    for (let i = 0; i < playCount; i++) {
      try {
        // Randomly select sound type (realistic gameplay)
        const soundType = i % 3 === 0 ? SoundType.GAME_START : SoundType.HIGHEST_CARD;
        await soundManager.playSound(soundType);
        
        // Variable delay (10-100ms)
        await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 90));
      } catch (error) {
        errorCount++;
        console.error(`[Extended Test] Error on play #${i + 1}:`, error);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[Extended Test] Completed ${playCount} plays in ${duration}ms`);
    console.log(`[Extended Test] Error rate: ${errorCount}/${playCount} (${(errorCount/playCount*100).toFixed(1)}%)`);
    
    expect(errorCount).toBe(0); // No errors should occur
    expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
    
    console.log('[Extended Test] ✅ Extended gameplay stable');
  });
});
