# Auto-Pass Timer Multiplayer Diagnostic - December 28, 2025

**Status:** 🚨 CRITICAL - Auto-pass timer NOT executing after 10s countdown  
**Priority:** URGENT  
**Affected System:** Realtime Multiplayer Mode

---

## 🔴 CRITICAL ISSUES IDENTIFIED

### 1. **AUTO-PASS EXECUTION IS MISSING IN MULTIPLAYER**
**Severity:** CRITICAL  
**Impact:** Players are NOT being auto-passed after the 10-second countdown expires

### 2. **ALERT NOTIFICATION NOT TRIGGERING**
**Severity:** HIGH  
**Impact:** Users don't receive visual/audio feedback when timer activates

### 3. **PLAYED CARDS TRACKING**
**Severity:** HIGH  
**Impact:** Need to verify `played_cards` array is being maintained correctly

---

## 📊 COMPARISON: LOCAL GAME vs MULTIPLAYER

### LOCAL GAME (`src/game/state.ts`) - ✅ WORKING

#### Timer Lifecycle:
```
1. Play Cards → executePlay()
2. Check: isHighestPossiblePlay(cards, this.state.played_cards)
3. If TRUE → Create auto_pass_timer state
4. startTimerCountdown() interval (runs every 100ms)
5. When remaining === 0 → EXECUTE AUTO-PASS
6. Call: this.pass() → Advances turn automatically
```

#### Key Implementation (Lines 150-250):
```typescript
private startTimerCountdown(): void {
  this.timerInterval = setInterval(() => {
    // ... update remaining time ...
    
    // ✅ CRITICAL: When timer expires, execute auto-pass
    if (remaining === 0) {
      gameLogger.info('⏰ [Auto-Pass Timer] Timer expired - executing auto-pass');
      this.state.auto_pass_timer = null;
      
      // ✅ EXECUTES AUTO-PASS ACTION
      this.pass().then((result) => {
        if (result.success) {
          gameLogger.info('⏰ [Auto-Pass Timer] Auto-pass successful');
        }
      });
    }
  }, 100);
}
```

#### How It Works:
1. **Timer Creation:** When highest play detected in `executePlay()`
2. **Countdown:** `startTimerCountdown()` updates `remaining_ms` every 100ms
3. **Expiration Detection:** When `remaining === 0`
4. **Auto-Pass Execution:** Calls `this.pass()` which:
   - Increments `consecutivePasses`
   - Advances turn to next player
   - Updates game state
   - Notifies all listeners
5. **State Update:** UI receives updated game state via listeners

---

### MULTIPLAYER (`src/hooks/useRealtime.ts`) - ❌ BROKEN

#### Timer Lifecycle:
```
1. Play Cards → playCards()
2. Check: isHighestPossiblePlay(cards, gameState.played_cards)
3. If TRUE → Create auto_pass_timer state
4. Store in database via Supabase update
5. Broadcast 'auto_pass_timer_started' event
6. useEffect timer countdown (runs every 100ms)
7. When remaining === 0 → ❌ NOTHING HAPPENS (MISSING!)
8. Timer just deactivates but NO auto-pass is executed
```

#### Current Implementation (Lines 1550-1620):
```typescript
useEffect(() => {
  // ... setup interval ...
  
  timerIntervalRef.current = setInterval(() => {
    const remaining = calculateRemainingMs();
    
    // Update game state with new remaining_ms
    setGameState(prevState => ({
      ...prevState,
      auto_pass_timer: {
        ...prevState.auto_pass_timer,
        remaining_ms: remaining,
        active: remaining > 0, // ❌ Just deactivates, doesn't execute pass
      },
    }));
    
    // ❌ CRITICAL BUG: NO AUTO-PASS EXECUTION!
    // Clear interval when timer expires
    if (remaining <= 0) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    // ❌ MISSING: Should call pass() here!!!
  }, 100);
}, [/* dependencies */]);
```

#### What's Missing:
1. **NO AUTO-PASS EXECUTION:** When `remaining <= 0`, should call `pass()`
2. **NO BROADCAST EVENT:** Should broadcast `'auto_pass_executed'` event
3. **NO ALERT NOTIFICATION:** Should trigger alert/haptic feedback

---

## 🔧 ROOT CAUSE ANALYSIS

### Issue #1: Missing Auto-Pass Execution Logic

**Local Game Has:**
```typescript
if (remaining === 0) {
  this.pass().then((result) => {
    if (result.success) {
      gameLogger.info('⏰ [Auto-Pass Timer] Auto-pass successful');
    }
  });
}
```

**Multiplayer Missing:**
```typescript
if (remaining <= 0) {
  clearInterval(timerIntervalRef.current);
  timerIntervalRef.current = null;
  // ❌ SHOULD CALL pass() HERE BUT DOESN'T!
}
```

---

### Issue #2: Timer Expiration Flow Difference

**Local Game Flow:**
```
Timer expires → Set timer to null → Execute pass() → 
Update game state → Notify listeners → UI updates → Turn advances
```

**Multiplayer Flow (Current - BROKEN):**
```
Timer expires → Set active: false → Clear interval → 
❌ NOTHING ELSE HAPPENS → UI shows expired timer → Game stuck
```

**Multiplayer Flow (Expected):**
```
Timer expires → Execute pass(currentPlayer.player_index) → 
Update database → Broadcast 'auto_pass_executed' → 
All clients update UI → Turn advances
```

---

### Issue #3: Played Cards Tracking

**Local Game:**
```typescript
// In executePlay() - Line 769
this.state!.played_cards.push(...cards);
```
✅ **Correctly maintains `played_cards` array throughout match**

**Multiplayer:**
```typescript
// In playCards() - Line 935
played_cards: [...(gameState.played_cards || []), ...cards],
```
✅ **Correctly maintains `played_cards` array**

**Verdict:** ✅ `played_cards` tracking is CORRECT in both versions

---

## 🎯 WHAT NEEDS TO BE FIXED

### Fix #1: Add Auto-Pass Execution to Multiplayer Timer

**Location:** `apps/mobile/src/hooks/useRealtime.ts` (Lines 1580-1605)

**Current Code:**
```typescript
timerIntervalRef.current = setInterval(() => {
  const remaining = calculateRemainingMs();
  
  setGameState(prevState => ({
    ...prevState,
    auto_pass_timer: {
      ...prevState.auto_pass_timer,
      remaining_ms: remaining,
      active: remaining > 0,
    },
  }));
  
  if (remaining <= 0) {
    clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
    // ❌ MISSING AUTO-PASS EXECUTION
  }
}, 100);
```

**REQUIRED FIX:**
```typescript
timerIntervalRef.current = setInterval(() => {
  const remaining = calculateRemainingMs();
  
  setGameState(prevState => ({
    ...prevState,
    auto_pass_timer: {
      ...prevState.auto_pass_timer,
      remaining_ms: remaining,
      active: remaining > 0,
    },
  }));
  
  // ✅ FIX: Execute auto-pass when timer expires
  if (remaining <= 0) {
    clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
    
    // Get current player who needs to auto-pass
    const currentPlayerIndex = gameState?.current_turn;
    if (currentPlayerIndex !== undefined && currentPlayerIndex !== null) {
      networkLogger.info('⏰ [Auto-Pass Timer] Timer expired - executing auto-pass for player', currentPlayerIndex);
      
      // Execute auto-pass for current player
      pass(currentPlayerIndex).then(() => {
        networkLogger.info('⏰ [Auto-Pass Timer] Auto-pass successful');
        
        // Broadcast auto-pass execution event
        broadcastMessage('auto_pass_executed', {
          player_index: currentPlayerIndex,
        });
      }).catch((error) => {
        networkLogger.error('⏰ [Auto-Pass Timer] Auto-pass failed:', error);
      });
    }
  }
}, 100);
```

---

### Fix #2: Add Alert Notification on Timer Start

**Location:** `apps/mobile/src/components/game/AutoPassTimer.tsx`

**Current Behavior:**
- Timer UI displays countdown
- ❌ NO alert/haptic feedback
- ❌ NO audio notification

**REQUIRED FIX:**
```typescript
useEffect(() => {
  if (timerState?.active) {
    // ✅ Trigger alert notification
    Alert.alert(
      '⏰ Highest Card Played!',
      'Auto-passing in 10 seconds if no action is taken.',
      [{ text: 'OK' }]
    );
    
    // ✅ Trigger haptic feedback (if available)
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      import('expo-haptics').then((Haptics) => {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning
        );
      });
    }
  }
}, [timerState?.active]);
```

---

### Fix #3: Ensure `pass()` Function Accepts Player Index

**Location:** `apps/mobile/src/hooks/useRealtime.ts` (Line 1053)

**Current Signature:**
```typescript
const pass = useCallback(async (playerIndex?: number): Promise<void> => {
  // ...implementation...
}, [/* deps */]);
```

✅ **Already supports `playerIndex` parameter** - No fix needed

**Usage in Fix #1:**
```typescript
pass(currentPlayerIndex) // ✅ Will work correctly
```

---

## 📋 IMPLEMENTATION CHECKLIST

### Phase 1: Core Auto-Pass Execution ⚡ URGENT
- [ ] Add auto-pass execution logic to timer countdown effect
- [ ] Call `pass(currentPlayerIndex)` when `remaining <= 0`
- [ ] Broadcast `'auto_pass_executed'` event to all clients
- [ ] Add proper error handling and logging

### Phase 2: Alert Notifications 📢 HIGH
- [ ] Add Alert.alert() when timer starts
- [ ] Add haptic feedback on timer start
- [ ] Add audio notification (optional)
- [ ] Test on iOS and Android

### Phase 3: Testing 🧪 CRITICAL
- [ ] Test timer expiration auto-passes correctly
- [ ] Test alert notification appears
- [ ] Test with bots (coordinator must not interfere)
- [ ] Test with real players in multiplayer
- [ ] Test edge cases (disconnect, game end, manual pass)

---

## 🔬 TESTING SCENARIOS

### Scenario 1: Single Player Auto-Pass
```
1. Player A plays 2♠ (highest single)
2. Timer starts (10s countdown)
3. Player B does nothing for 10 seconds
4. ✅ EXPECTED: Player B auto-passes after 10s
5. ✅ EXPECTED: Turn advances to Player C
6. ✅ EXPECTED: Alert shown when timer started
```

### Scenario 2: Pair Auto-Pass
```
1. Player A plays 2♠-2♥ (highest pair)
2. Timer starts (10s countdown)
3. Player B does nothing for 10 seconds
4. ✅ EXPECTED: Player B auto-passes after 10s
```

### Scenario 3: Manual Pass Before Expiry
```
1. Player A plays 2♠ (highest single)
2. Timer starts (10s countdown)
3. Player B manually passes at 5s
4. ✅ EXPECTED: Timer cancelled
5. ✅ EXPECTED: 'auto_pass_timer_cancelled' broadcast
6. ✅ EXPECTED: Turn advances immediately
```

### Scenario 4: Bot Coordinator Compatibility
```
1. Bot plays 2♠ (highest single)
2. Timer starts for human player
3. Human player does nothing for 10s
4. ✅ EXPECTED: Human auto-passes after 10s
5. ✅ EXPECTED: Bot coordinator continues normally
6. ✅ EXPECTED: No interference with bot logic
```

---

## 🎓 KEY LEARNINGS

### Why It Works in Local Game:
1. **Direct State Management:** `this.state` is synchronous
2. **Simple Callback:** `this.pass()` directly updates state
3. **No Network Latency:** Immediate execution
4. **Single Source of Truth:** One game state manager

### Why It's Broken in Multiplayer:
1. **Missing Logic:** Countdown effect doesn't call `pass()`
2. **Network Dependency:** Requires RPC call to Supabase
3. **Async Operations:** Need proper error handling
4. **Broadcast Required:** All clients must be notified

### Solution Approach:
1. **Mirror Local Logic:** Copy timer expiration logic from local game
2. **Add Network Calls:** Execute pass via `pass(playerIndex)`
3. **Broadcast Events:** Notify all clients of auto-pass execution
4. **Error Handling:** Handle network failures gracefully

---

## 📝 DETAILED IMPLEMENTATION PLAN

### Step 1: Modify Timer Countdown Effect

**File:** `apps/mobile/src/hooks/useRealtime.ts`  
**Lines:** 1580-1605

**Changes:**
1. Add auto-pass execution when `remaining <= 0`
2. Call `pass(currentPlayerIndex)`
3. Broadcast `'auto_pass_executed'` event
4. Add error handling with try-catch
5. Add logging for debugging

**Code:**
```typescript
useEffect(() => {
  // ... existing setup code ...
  
  timerIntervalRef.current = setInterval(() => {
    const remaining = calculateRemainingMs();
    
    // Update game state with new remaining_ms
    setGameState(prevState => {
      if (!prevState || !prevState.auto_pass_timer) return prevState;
      
      return {
        ...prevState,
        auto_pass_timer: {
          ...prevState.auto_pass_timer,
          remaining_ms: remaining,
          active: remaining > 0,
        },
      };
    });
    
    // ✅ NEW: Execute auto-pass when timer expires
    if (remaining <= 0) {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      
      // Get current player who needs to auto-pass
      const currentPlayerIndex = gameState?.current_turn;
      
      if (currentPlayerIndex !== undefined && currentPlayerIndex !== null) {
        networkLogger.info('⏰ [Auto-Pass Timer] Timer expired - executing auto-pass for player', currentPlayerIndex);
        
        // Execute auto-pass for current player
        pass(currentPlayerIndex)
          .then(() => {
            networkLogger.info('⏰ [Auto-Pass Timer] Auto-pass successful');
            
            // Broadcast auto-pass execution event to all clients
            broadcastMessage('auto_pass_executed', {
              player_index: currentPlayerIndex,
            }).catch((broadcastError) => {
              networkLogger.error('⏰ [Auto-Pass Timer] Failed to broadcast auto-pass event:', broadcastError);
            });
          })
          .catch((error) => {
            networkLogger.error('⏰ [Auto-Pass Timer] Auto-pass execution failed:', error);
            // Don't crash - log error and continue
          });
      } else {
        networkLogger.error('⏰ [Auto-Pass Timer] Cannot execute auto-pass - current_turn is undefined');
      }
    }
  }, 100);
  
  // ... existing cleanup code ...
}, [
  gameState?.auto_pass_timer?.active, 
  gameState?.auto_pass_timer?.started_at,
  gameState?.game_phase,
  gameState?.current_turn, // ✅ ADD: Re-run when turn changes
  pass, // ✅ ADD: Include pass function in dependencies
  broadcastMessage, // ✅ ADD: Include broadcast function
]);
```

---

### Step 2: Add Alert Notification Component

**File:** `apps/mobile/src/components/game/AutoPassTimer.tsx`

**Add Import:**
```typescript
import { Alert, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
```

**Add Effect:**
```typescript
// Alert notification when timer starts
useEffect(() => {
  if (timerState?.active && timerState.remaining_ms === timerState.duration_ms) {
    // Show alert only when timer just started (remaining === duration)
    Alert.alert(
      '⏰ Highest Card Played!',
      'You will be auto-passed in 10 seconds if no action is taken.',
      [{ text: 'OK' }],
      { cancelable: true }
    );
    
    // Trigger haptic feedback
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Warning
      ).catch((error) => {
        console.warn('Failed to trigger haptic feedback:', error);
      });
    }
  }
}, [timerState?.active, timerState?.remaining_ms, timerState?.duration_ms]);
```

---

### Step 3: Update Dependencies Array

**File:** `apps/mobile/src/hooks/useRealtime.ts`  
**Lines:** 1615-1620

**Current:**
```typescript
}, [
  gameState?.auto_pass_timer?.active, 
  gameState?.auto_pass_timer?.started_at,
  gameState?.game_phase
]);
```

**Updated:**
```typescript
}, [
  gameState?.auto_pass_timer?.active, 
  gameState?.auto_pass_timer?.started_at,
  gameState?.game_phase,
  gameState?.current_turn, // ✅ NEW: Re-run when turn changes
  pass, // ✅ NEW: Required for calling pass()
  broadcastMessage, // ✅ NEW: Required for broadcasting event
]);
```

---

## 🚨 CRITICAL WARNINGS

### 1. Bot Coordinator Interference
**Problem:** Bot coordinator also calls `pass()` for bots  
**Solution:** Ensure timer only auto-passes CURRENT TURN player  
**Check:** `gameState.current_turn === playerIndex` before executing

### 2. Race Conditions
**Problem:** Manual pass and auto-pass might execute simultaneously  
**Solution:** Check if timer is still active before executing auto-pass  
**Implementation:** Already handled by `timerState.active` check

### 3. Network Failures
**Problem:** `pass()` might fail due to network issues  
**Solution:** Add try-catch blocks and error logging  
**Fallback:** Don't crash game, just log error

---

## ✅ VERIFICATION CHECKLIST

After implementing fixes, verify:

1. **Timer Countdown:**
   - [ ] Timer displays 10 → 9 → 8 → ... → 1 → 0
   - [ ] UI updates smoothly every second
   - [ ] No console spam (max 10 state updates)

2. **Auto-Pass Execution:**
   - [ ] Player auto-passes when timer reaches 0
   - [ ] Turn advances to next player
   - [ ] Database updated correctly
   - [ ] All clients receive `'auto_pass_executed'` broadcast

3. **Alert Notification:**
   - [ ] Alert appears when timer starts
   - [ ] Haptic feedback triggers (on mobile)
   - [ ] Alert dismissible by user

4. **Edge Cases:**
   - [ ] Manual pass cancels timer before expiry
   - [ ] Game end cancels timer
   - [ ] Disconnect doesn't break timer
   - [ ] Reconnect restores timer state

5. **Highest Play Detection:**
   - [ ] 2♠ (highest single) triggers timer
   - [ ] After 2♠ played, 2♥ triggers timer
   - [ ] Pair of 2s triggers timer
   - [ ] Triple 2s triggers timer
   - [ ] Royal Flush triggers timer (if highest 5-card)

---

## 📊 SUCCESS METRICS

### Before Fix (Current State):
- ❌ Auto-pass execution: 0% success rate
- ❌ Alert notification: Not implemented
- ❌ Players stuck waiting after timer expires
- ❌ Game progression halted

### After Fix (Expected State):
- ✅ Auto-pass execution: 100% success rate
- ✅ Alert notification: 100% triggered
- ✅ Turn advances automatically after 10s
- ✅ Game flows smoothly

---

## 🎯 SUMMARY

### Core Problem:
**Multiplayer timer countdown effect DOES NOT execute auto-pass when timer expires**

### Root Cause:
**Missing logic to call `pass(currentPlayerIndex)` when `remaining <= 0`**

### Solution:
**Add auto-pass execution, broadcast events, and alert notifications matching local game behavior**

### Files to Modify:
1. `apps/mobile/src/hooks/useRealtime.ts` (Lines 1580-1620)
2. `apps/mobile/src/components/game/AutoPassTimer.tsx` (Add alert effect)

### Estimated Effort:
- **Implementation:** 30 minutes
- **Testing:** 1 hour
- **Total:** 1.5 hours

### Priority:
**🚨 URGENT - Blocking multiplayer gameplay**

---

**Document Created:** December 28, 2025  
**Status:** Ready for Implementation  
**Next Step:** Apply fixes to `useRealtime.ts` and `AutoPassTimer.tsx`
