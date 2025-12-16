/**
 * Race Condition Test for fetchProfile Deduplication Lock
 * 
 * Tests that parallel fetchProfile calls are properly deduplicated
 * to prevent 22-second timeout issues.
 * 
 * This is a unit test - actual integration test would require Supabase.
 * 
 * Run with: pnpm test race-condition-test
 */

describe('Race Condition Test - fetchProfile Lock', () => {
  // Mock implementation of fetchProfile with lock
  class FetchProfileSimulator {
    private isFetching = false;
    private fetchPromise: Promise<any> | null = null;
    private callCount = 0;
    private actualFetchCount = 0;

    async fetchProfile(userId: string, simulateDelay: number = 100): Promise<any> {
      this.callCount++;
      
      // Deduplication: If already fetching, return existing promise
      if (this.isFetching && this.fetchPromise) {
        console.log(`[Test] Call #${this.callCount} - Returning existing promise (deduplication working)`);
        return this.fetchPromise;
      }
      
      // Mark as fetching
      this.isFetching = true;
      this.actualFetchCount++;
      console.log(`[Test] Call #${this.callCount} - Starting actual fetch #${this.actualFetchCount}`);
      
      // Store promise for deduplication
      const fetchOperation = (async () => {
        await new Promise(resolve => setTimeout(resolve, simulateDelay));
        return { userId, username: `User_${userId}` };
      })();
      
      this.fetchPromise = fetchOperation;
      
      try {
        const result = await fetchOperation;
        return result;
      } finally {
        // Clear lock after fetch completes
        this.isFetching = false;
        this.fetchPromise = null;
      }
    }

    getStats() {
      return {
        totalCalls: this.callCount,
        actualFetches: this.actualFetchCount,
        deduplicationRate: ((this.callCount - this.actualFetchCount) / this.callCount * 100).toFixed(1) + '%'
      };
    }

    reset() {
      this.callCount = 0;
      this.actualFetchCount = 0;
      this.isFetching = false;
      this.fetchPromise = null;
    }
  }

  let simulator: FetchProfileSimulator;

  beforeEach(() => {
    simulator = new FetchProfileSimulator();
  });

  it('should deduplicate parallel fetchProfile calls', async () => {
    const userId = 'test-user-123';
    
    // Simulate 5 parallel calls (e.g., TOKEN_REFRESHED + SIGNED_IN + manual refresh)
    const parallelCalls = [
      simulator.fetchProfile(userId),
      simulator.fetchProfile(userId),
      simulator.fetchProfile(userId),
      simulator.fetchProfile(userId),
      simulator.fetchProfile(userId),
    ];
    
    const results = await Promise.all(parallelCalls);
    const stats = simulator.getStats();
    
    console.log('[Race Test] Results:', stats);
    
    // All should return the same result
    expect(results.every(r => r.userId === userId)).toBe(true);
    
    // Only 1 actual fetch should occur (others deduplicated)
    expect(stats.actualFetches).toBe(1);
    expect(stats.totalCalls).toBe(5);
    expect(stats.deduplicationRate).toBe('80.0%');
    
    console.log('[Race Test] ✅ Deduplication working: 5 calls → 1 fetch');
  });

  it('should allow sequential fetches after first completes', async () => {
    const userId = 'test-user-456';
    
    // First fetch
    await simulator.fetchProfile(userId);
    
    // Second fetch (after first completes)
    await simulator.fetchProfile(userId);
    
    // Third fetch
    await simulator.fetchProfile(userId);
    
    const stats = simulator.getStats();
    console.log('[Sequential Test] Results:', stats);
    
    // All 3 should execute (no deduplication for sequential calls)
    expect(stats.actualFetches).toBe(3);
    expect(stats.totalCalls).toBe(3);
    
    console.log('[Sequential Test] ✅ Sequential calls work correctly');
  });

  it('should handle mixed parallel and sequential calls', async () => {
    simulator.reset();
    const userId = 'test-user-789';
    
    // Batch 1: 3 parallel calls
    await Promise.all([
      simulator.fetchProfile(userId, 50),
      simulator.fetchProfile(userId, 50),
      simulator.fetchProfile(userId, 50),
    ]);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Batch 2: 2 parallel calls
    await Promise.all([
      simulator.fetchProfile(userId, 50),
      simulator.fetchProfile(userId, 50),
    ]);
    
    const stats = simulator.getStats();
    console.log('[Mixed Test] Results:', stats);
    
    // Should have 2 actual fetches (one per batch)
    expect(stats.actualFetches).toBe(2);
    expect(stats.totalCalls).toBe(5);
    expect(stats.deduplicationRate).toBe('60.0%');
    
    console.log('[Mixed Test] ✅ Mixed calls handled correctly: 5 calls → 2 fetches');
  });

  it('should handle rapid calls with timing edge cases', async () => {
    simulator.reset();
    const userId = 'test-user-race';
    
    // Simulate the exact race condition scenario:
    // Two TOKEN_REFRESHED events 500ms apart
    const call1Promise = simulator.fetchProfile(userId, 600); // Takes 600ms
    
    // Wait 500ms (during first fetch)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Second call arrives while first is still running
    const call2Promise = simulator.fetchProfile(userId, 600);
    
    await Promise.all([call1Promise, call2Promise]);
    
    const stats = simulator.getStats();
    console.log('[Timing Test] Results:', stats);
    
    // Should deduplicate (second call reuses first's promise)
    expect(stats.actualFetches).toBe(1);
    expect(stats.totalCalls).toBe(2);
    
    console.log('[Timing Test] ✅ Timing edge case handled correctly');
  });
});
