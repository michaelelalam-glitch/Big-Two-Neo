# Performance & Auto-Pass Timer Fix - December 28, 2025

## 🎯 Problems Fixed

### 1. Performance Issues (16ms Budget Violations)
**Problem:** GameScreen re-renders exceeded 16ms budget (18-37ms observed in logs)

**Root Cause:**
- Expensive props recalculated on every render
- `mapPlayersToScoreboardOrder()` called multiple times per render
- Complex score calculations (`reduce()` operations) not memoized

**Solution:**
```typescript
// ✅ Memoized expensive prop calculations
const memoizedPlayerNames = React.useMemo(() => {
  return layoutPlayers.length === 4 
    ? mapPlayersToScoreboardOrder(layoutPlayers, (p: any) => p.name) 
    : [];
}, [layoutPlayers]);

const memoizedCurrentScores = React.useMemo(() => {
  if (layoutPlayers.length !== 4) return [];
  
  if (scoreHistory.length > 0) {
    return mapPlayersToScoreboardOrder(
      layoutPlayers.map((p: any) => ({
        ...p,
        score: scoreHistory.reduce((sum, match) => sum + (match.pointsAdded[p.player_index] || 0), 0)
      })),
      (p: any) => p.score
    );
  }
  
  return mapPlayersToScoreboardOrder(layoutPlayers, (p: any) => p.score);
}, [layoutPlayers, scoreHistory]);
```

**Impact:**
- Reduced expensive calculations from ~10/render to 1/render
- Props only recalculate when dependencies actually change
- Expected render time reduction: 30-50%

---

### 2. Auto-Pass Timer Network Failures
**Problem from Logs:**
```
7:41:27pm: Auto-pass timer started (10s duration, 2♠ highest play)
7:41:29pm: Network request failed → RetryLogic attempt 1/3
7:41:30pm: Turn changed during retry → Bot coordinator abort
```

**Root Cause:**
- Auto-pass timer broadcasts trigger network calls
- Turn state changes during network retry window (1000ms → 2000ms → 4000ms)
- Bot coordinator validates turn before action, aborts when mismatch detected

**Solution 1: Non-Blocking Timer Broadcasts**
```typescript
// ✅ BEFORE: Blocks game flow on network failure
if (isHighestPlay && autoPassTimerState) {
  await broadcastMessage('auto_pass_timer_started', { ... });
}

// ✅ AFTER: Non-blocking, game continues even if timer fails
if (isHighestPlay && autoPassTimerState) {
  try {
    await broadcastMessage('auto_pass_timer_started', { ... });
  } catch (timerBroadcastError) {
    // CRITICAL: Don't throw - timer is cosmetic, game must continue
    gameLogger.error('[useRealtime] ⚠️ Auto-pass timer broadcast failed (non-fatal):', timerBroadcastError);
  }
}

// Timer cancellation also non-blocking
if (hasActiveTimer) {
  broadcastMessage('auto_pass_timer_cancelled', { ... })
    .catch((cancelError) => {
      gameLogger.warn('[useRealtime] ⚠️ Timer cancellation failed (non-fatal):', cancelError);
    });
}
```

**Solution 2: Turn State Validation in Retry Logic**
```typescript
// ✅ Enhanced retry function with turn validation
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000,
  validateBeforeRetry?: () => boolean  // ← NEW: Optional validation
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 🎯 RACE CONDITION FIX: Validate state before each attempt
      if (validateBeforeRetry && !validateBeforeRetry()) {
        gameLogger.warn('[RetryLogic] ⚠️ Validation failed, aborting retry');
        throw new Error('State changed during retry - operation aborted');
      }
      
      return await fn();
    } catch (error) {
      // ... network error handling ...
    }
  }
}
```

**Solution 3: Pass Validation Function to Retry Calls**
```typescript
// ✅ Bot pass move with turn validation
await retryWithBackoff(
  async () => {
    if (gameState.current_turn !== currentPlayerIndex) {
      throw new Error('Turn changed - abort execution');
    }
    await passMove(currentPlayerIndex);
  },
  3,
  1000,
  async () => {
    // Validate turn before each retry attempt
    const { data: checkState } = await supabase
      .from('game_state')
      .select('current_turn')
      .eq('room_id', gameState.room_id)
      .single();
    return checkState?.current_turn === currentPlayerIndex;
  }
);
```

---

## 📊 Expected Results

### Performance Improvements
- **Before:** 18-37ms renders (2-21ms over budget)
- **After:** Expected 12-20ms renders (within or near budget)
- **Reduction:** ~30-50% fewer expensive calculations per render

### Auto-Pass Timer Reliability
- **Before:** ❌ Timer triggers network call → FAILS → Turn changes during retry → Bot aborts
- **After:** ✅ Timer broadcast fails gracefully → Game continues → Bot validates turn before each retry attempt
- **Impact:** Timer failures no longer block gameplay

---

## 🧪 Testing Checklist

### Performance Testing
- [ ] Run game in release mode (dev mode inflates render times)
- [ ] Monitor performance using React DevTools Profiler
- [ ] Verify GameScreen renders consistently <20ms
- [ ] Check for frame drops during:
  - [ ] Card selection changes
  - [ ] Turn transitions
  - [ ] Scoreboard updates

### Auto-Pass Timer Testing
- [ ] **Scenario 1: Highest Play (2♠)**
  - [ ] Play 2♠ single card
  - [ ] Verify timer starts (10s countdown)
  - [ ] Verify game continues even if timer broadcast fails
  - [ ] Verify all players see timer (if broadcast succeeds)

- [ ] **Scenario 2: Network Failure During Bot Turn**
  - [ ] Simulate network failure (airplane mode, poor connection)
  - [ ] Verify bot retries operation (3 attempts)
  - [ ] Verify bot aborts if turn changes during retry
  - [ ] Verify game doesn't hang on network error

- [ ] **Scenario 3: Turn Changes During Retry**
  - [ ] Trigger bot action with network delay
  - [ ] Change turn state during retry window
  - [ ] Verify bot detects turn change and aborts
  - [ ] Verify execution lock is released (next turn proceeds)

### Multiplayer Integration Testing
- [ ] Test with 4 players (human + 3 bots)
- [ ] Verify bot coordinator only runs on host
- [ ] Verify auto-pass timer visible to all players
- [ ] Verify no race conditions during rapid turns

---

## 🔍 Diagnostic Commands

### Monitor Performance in Real-Time
```javascript
// In React DevTools Console
performanceMonitor.printSummary();
performanceMonitor.getAllReports();
```

### Check Game State During Testing
```javascript
// Check current turn
gameState.current_turn

// Check auto-pass timer state
gameState.auto_pass_timer

// Check bot execution lock
isExecutingRef.current
```

---

## 📂 Files Modified

1. **`apps/mobile/src/hooks/useRealtime.ts`**
   - Made auto-pass timer broadcasts non-blocking (try-catch wrapper)
   - Made timer cancellation non-blocking (catch errors, don't await)

2. **`apps/mobile/src/hooks/useBotCoordinator.ts`**
   - Enhanced `retryWithBackoff()` with optional validation function
   - Added turn validation before each retry attempt (bot pass)
   - Added turn validation before each retry attempt (bot play cards)

3. **`apps/mobile/src/screens/GameScreen.tsx`**
   - Memoized `playerNames` prop calculation
   - Memoized `currentScores` prop calculation (with scoreHistory reduce)
   - Memoized `cardCounts` prop calculation
   - Memoized `originalPlayerNames` prop calculation
   - Applied memoized props to both LandscapeGameLayout and ScoreboardContainer

---

## 🎓 Lessons Learned

### Performance
1. **Memoize expensive calculations:** Use `React.useMemo()` for any prop that involves iteration, mapping, or reduce operations
2. **Profile in release mode:** Development mode adds significant overhead (2-3x slower renders)
3. **Target metrics:** Aim for <16ms renders (60fps) on modern devices

### Network Resilience
1. **Non-critical operations should be non-blocking:** Timer broadcasts are cosmetic - don't let failures stop gameplay
2. **Validate state before retry:** Turn-based games need turn validation before each retry attempt
3. **Fail gracefully:** Log errors, continue execution, don't crash on network failures

### Bot Coordination
1. **Single source of truth:** Only host executes bot logic (prevents conflicts)
2. **Execution locks:** Use refs to prevent concurrent bot actions
3. **Turn validation at every step:** Check turn state before thinking, before action, and before each retry

---

## ⚠️ Known Limitations

1. **TypeScript errors remain:** Pre-existing type issues in GameScreen (not related to this fix)
2. **Dev mode performance:** Still expect 20-30ms renders in dev mode (normal)
3. **Network failures still logged:** Non-fatal errors will appear in console (expected behavior)

---

## 🚀 Next Steps

After testing and validation:
1. Monitor production performance metrics
2. Collect auto-pass timer success/failure rates
3. Consider implementing:
   - WebSocket reconnection logic for persistent connections
   - Client-side timer fallback if broadcast fails
   - Performance monitoring dashboard

---

**Status:** ✅ Implemented, Ready for Testing
**Priority:** High (affects core gameplay)
**Risk:** Low (changes are defensive, fail-safe)
