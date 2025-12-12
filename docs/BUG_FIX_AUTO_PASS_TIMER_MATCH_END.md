# Bug Fix: Auto-Pass Timer Not Cancelling on Match End

**Date:** December 12, 2025  
**Severity:** CRITICAL  
**Status:** FIXED  

## 🐛 Problem

When a bot played their **last card** AND that card was the **highest possible play**, the game would crash with the following symptoms:

1. Match end detected correctly (Bot 2 won)
2. Auto-pass timer started (10s countdown for highest play)
3. **Timer was NOT cancelled when match ended**
4. Timer interval kept calling `notifyListeners()` every 100ms
5. Each call triggered GameScreen subscription → **60+ identical state updates** spamming console
6. After 10 seconds, timer tried to auto-pass on ended game → failed with "Game not in progress"
7. State corruption prevented new match from starting
8. Screen went black with only the notification modal showing

## 📊 Evidence

From console logs at 12:30:57 - 12:31:21:

```
12:30:57 - Match ends, Bot 2 wins
12:30:57 - Auto-pass timer STARTS (shouldn't happen after match end!)
12:30:58-12:31:07 - 60+ identical "Game state updated" logs (every 100ms)
12:31:07 - Timer expires, tries to auto-pass
12:31:07 - WARN: "Auto-pass failed: Game not in progress"
12:31:21+ - ERROR: "Cannot start new match" (repeated errors)
```

## 🔍 Root Cause

**File:** `apps/mobile/src/game/state.ts`

### Issue 1: Timer Not Cancelled in `handleMatchEnd()`

The `handleMatchEnd()` function at line 745 calculates scores and sets flags but **never cancels the auto-pass timer**.

```typescript
// BEFORE (Missing timer cancellation)
private async handleMatchEnd(matchWinnerId: string): Promise<void> {
  if (!this.state) return;
  
  gameLogger.info(`🏆 [Match End] Match ${this.state.currentMatch} won by ${matchWinnerId}`);
  
  // Calculate scores... (no timer cancellation!)
  const matchScoreDetails = calculateMatchScores(this.state.players, matchWinnerId);
  // ...
}
```

### Issue 2: Timer Countdown Doesn't Check Match End

The `startTimerCountdown()` function at line 167 runs every 100ms and only checks:

```typescript
// BEFORE (Missing gameEnded check)
this.timerInterval = setInterval(() => {
  if (!this.state?.auto_pass_timer?.active) {
    return;
  }
  // ... continues running even if gameEnded = true
}, 100);
```

This creates an infinite loop:
1. Timer updates state every 100ms
2. State update calls `notifyListeners()`
3. GameScreen subscription callback fires
4. Logs "Game state updated" (60+ times)
5. Repeat until timer expires or user crashes app

## ✅ Solution

### Fix 1: Cancel Timer in `handleMatchEnd()`

**File:** `apps/mobile/src/game/state.ts` line 760

```typescript
// AFTER (Timer properly cancelled)
private async handleMatchEnd(matchWinnerId: string): Promise<void> {
  if (!this.state) return;

  gameLogger.info(`🏆 [Match End] Match ${this.state.currentMatch} won by ${matchWinnerId}`);

  // CRITICAL FIX: Cancel auto-pass timer when match ends
  if (this.state.auto_pass_timer?.active) {
    gameLogger.info('⏹️ [Auto-Pass Timer] Cancelled - match ended');
    this.state.auto_pass_timer = null;
  }

  // Calculate scores for this match
  const matchScoreDetails = calculateMatchScores(this.state.players, matchWinnerId);
  // ...
}
```

### Fix 2: Add Safety Check in Timer Countdown

**File:** `apps/mobile/src/game/state.ts` line 174

```typescript
// AFTER (Safety check added)
private startTimerCountdown(): void {
  // ...
  
  this.timerInterval = setInterval(() => {
    // CRITICAL FIX: Stop timer if match/game has ended
    if (this.state?.gameEnded || this.state?.gameOver) {
      if (this.state.auto_pass_timer) {
        gameLogger.info('⏹️ [Auto-Pass Timer] Cancelled - game ended');
        this.state.auto_pass_timer = null;
      }
      return;
    }

    if (!this.state?.auto_pass_timer?.active) {
      return;
    }
    // ... continue normal countdown
  }, 100);
}
```

### Fix 3: Multiplayer Timer (Preventive)

**File:** `apps/mobile/src/hooks/useRealtime.ts` line 822

```typescript
// AFTER (Preventive fix for multiplayer)
useEffect(() => {
  // Clear existing interval
  if (timerIntervalRef.current) {
    clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
  }
  
  // CRITICAL FIX: Cancel timer if game has finished
  if (gameState?.game_phase === 'finished') {
    networkLogger.info('⏰ [Auto-Pass Timer] Cancelling timer - game finished');
    return;
  }
  
  // ... rest of timer logic
}, [
  gameState?.auto_pass_timer?.active, 
  gameState?.auto_pass_timer?.started_at,
  gameState?.game_phase // Re-run when game finishes
]);
```

## 🧪 Testing

### Test Case: Bot Plays Last Card + Highest Play

**Scenario:**
1. Start game with 3 bots
2. Play through match until bot has 1 card remaining
3. Bot plays final card (highest play: e.g., 2♠)
4. Match end should trigger immediately
5. **Expected:** Timer cancelled, no infinite loop
6. **Expected:** "Next Match" button works correctly
7. **Expected:** New match starts successfully

### Verification Steps:

1. Check console logs for timer cancellation:
   ```
   ✅ Should see: "⏹️ [Auto-Pass Timer] Cancelled - match ended"
   ❌ Should NOT see: 60+ "Game state updated" logs
   ❌ Should NOT see: "Auto-pass failed: Game not in progress"
   ```

2. Verify UI behavior:
   ```
   ✅ Match end modal appears immediately
   ✅ "Next Match" button is clickable
   ✅ New match starts without errors
   ❌ Screen does NOT go black
   ```

3. Check timer state:
   ```
   ✅ auto_pass_timer should be null after match end
   ✅ No timer interval should be running
   ```

## 📝 Files Changed

1. **`apps/mobile/src/game/state.ts`**
   - Added timer cancellation in `handleMatchEnd()` (line 760)
   - Added safety check in `startTimerCountdown()` (line 174)

2. **`apps/mobile/src/hooks/useRealtime.ts`**
   - Added `game_phase` check in timer countdown effect (line 822)
   - Added `game_phase` to useEffect dependencies (line 884)

## 🚀 Impact

**Before Fix:**
- ❌ Game crashes when bot wins with highest play
- ❌ 60+ state updates per 10 seconds
- ❌ New match cannot start
- ❌ Poor user experience (black screen)

**After Fix:**
- ✅ Timer properly cancelled on match end
- ✅ No infinite state update loop
- ✅ New match starts correctly
- ✅ Smooth gameplay experience

## 🔄 Related Issues

- Auto-pass timer was originally added in PR #XX for highest play detection
- This edge case (last card + highest play) was not tested
- Similar issue could occur in multiplayer mode (preventively fixed)

## 📚 Lessons Learned

1. **Always cancel timers/intervals when state changes**
   - Match end, game over, component unmount
   
2. **Add defensive checks in long-running intervals**
   - Check game state validity before executing logic
   
3. **Test edge cases thoroughly**
   - Combination of multiple features (auto-pass + match end)
   
4. **Monitor console logs for infinite loops**
   - Repeated identical logs = likely interval/timer issue

## ✅ Checklist

- [x] Bug identified and root cause analyzed
- [x] Fix implemented in `state.ts`
- [x] Preventive fix added to `useRealtime.ts`
- [x] Console logs added for debugging
- [ ] Manual testing completed
- [ ] Automated test added
- [ ] PR created and reviewed
- [ ] Documentation updated

---

**Status:** Fixed and ready for testing  
**Next Steps:** Manual QA testing with bot games
