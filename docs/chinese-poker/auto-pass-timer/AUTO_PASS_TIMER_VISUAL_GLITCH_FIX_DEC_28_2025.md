# Auto-Pass Timer Visual Glitch Fix - December 28, 2025

**Status:** ✅ FIXED  
**Issue:** Timer and highest card "replaying" briefly on turn changes after auto-pass

---

## 🐛 THE VISUAL GLITCH

**User Experience:**
1. Bot 3 plays highest card (pair of 6s) → Timer starts (10s)
2. Player (Steve Peterson) waits → Auto-passed correctly at 0s ✅
3. Turn moves to Bot 1 → **GLITCH:** Pair of 6s "replays" + timer shows 10s for 1 second
4. Turn moves to Bot 2 → **GLITCH:** Pair of 6s "replays" + timer shows 10s for 1 second
5. Turn moves to Bot 3 → **GLITCH:** Pair of 6s "replays" + timer shows 10s for 1 second
6. Bot 3 finally plays successfully

**Impact:** 
- Gameplay NOT interrupted ✅
- But looks like game is glitching ❌
- Confusing UX - appears cards are being replayed

---

## 🔍 ROOT CAUSE ANALYSIS

### The Problem

The timer countdown useEffect had `gameState?.current_turn` in its dependencies array:

```typescript
useEffect(() => {
  // Timer countdown logic...
}, [
  gameState?.auto_pass_timer?.active,
  gameState?.auto_pass_timer?.started_at,
  gameState?.game_phase,
  gameState?.current_turn, // ❌ THIS WAS THE PROBLEM!
  pass,
  broadcastMessage,
]);
```

**What Happened:**
1. Timer expires → Auto-passes player → Turn advances
2. `gameState.current_turn` changes from 0 → 1
3. **useEffect dependency changed → Effect RESTARTS completely**
4. Effect recalculates `remaining_ms` from old `started_at` timestamp
5. For ~1 second, shows wrong countdown (could be 10s or negative)
6. Next tick realizes timer expired → Hides timer
7. **Result:** Brief flash of timer + highest card on screen

### Why It Glitched 3 Times

When player auto-passed:
- Turn 0 (Player) → Turn 1 (Bot 1): Effect restarted → Glitch #1
- Turn 1 (Bot 1) → Turn 2 (Bot 2): Effect restarted → Glitch #2  
- Turn 2 (Bot 2) → Turn 3 (Bot 3): Effect restarted → Glitch #3

Each turn change triggered the effect to restart and briefly recalculate from the expired timestamp.

---

## ✅ THE FIXES

### Fix #1: Remove `current_turn` from Dependencies

```typescript
useEffect(() => {
  // Timer countdown logic...
}, [
  gameState?.auto_pass_timer?.active,
  gameState?.auto_pass_timer?.started_at,
  gameState?.game_phase,
  // ❌ REMOVED: gameState?.current_turn
  // Timer should NOT restart on turn changes!
  pass,
  broadcastMessage,
]);
```

**Why This Works:**
- Timer effect only restarts when timer is activated/deactivated
- Turn changes DON'T trigger effect restart
- Inside interval, we use `prevState.current_turn` which always has latest value
- No need to restart entire effect just to access current turn

### Fix #2: Skip Countdown if Timer Already Expired

```typescript
// Calculate initial remaining time
const initialRemaining = calculateRemainingMs();

// If timer already expired, don't start countdown
if (initialRemaining <= 0) {
  networkLogger.warn('⏰ Timer already expired, skipping countdown');
  
  // Immediately deactivate in local state
  setGameState(prevState => ({
    ...prevState,
    auto_pass_timer: {
      ...prevState.auto_pass_timer,
      remaining_ms: 0,
      active: false,
    },
  }));
  
  return; // Don't start interval
}
```

**Why This Works:**
- Before starting interval, checks if timer is already expired
- If expired, immediately sets `active: false` in local state
- Prevents any visual flash of expired timer
- Exit early without creating interval

---

## 🧪 Testing Results

### Before Fix:
```
Bot 3 plays pair of 6s → Timer starts
Player waits 10s → Auto-passed ✅
Turn → Bot 1: FLASH (pair of 6s + 10s timer) ❌
Turn → Bot 2: FLASH (pair of 6s + 10s timer) ❌
Turn → Bot 3: FLASH (pair of 6s + 10s timer) ❌
Bot 3 plays
```

### After Fix:
```
Bot 3 plays pair of 6s → Timer starts
Player waits 10s → Auto-passed ✅
Turn → Bot 1: Clean (no flash) ✅
Turn → Bot 2: Clean (no flash) ✅
Turn → Bot 3: Clean (no flash) ✅
Bot 3 plays
```

---

## 📊 Technical Details

### State Flow Analysis

**Before Fix:**
```
1. Timer expires → pass() called → Turn advances (0 → 1)
2. Realtime broadcasts: { current_turn: 1, auto_pass_timer: {...} }
3. useEffect sees current_turn changed → RESTARTS EFFECT
4. calculateRemainingMs() runs with OLD started_at timestamp
5. remaining_ms could be 10000ms (if timestamp very old)
6. UI shows timer for 1 second
7. Next tick: remaining_ms recalculated → 0ms → hides timer
```

**After Fix:**
```
1. Timer expires → pass() called → Turn advances (0 → 1)
2. Realtime broadcasts: { current_turn: 1, auto_pass_timer: {...} }
3. useEffect does NOT restart (current_turn not in deps)
4. No recalculation triggered
5. Local state already has active: false from previous tick
6. No visual glitch ✅
```

### Why `prevState.current_turn` Works

Inside the `setGameState` callback:
```typescript
setGameState(prevState => {
  const currentPlayerIndex = prevState.current_turn; // ✅ Always latest
  // Use this value...
});
```

React guarantees `prevState` is the LATEST state at the time of update, even if the effect captured an older `gameState`. This is why we don't need `current_turn` in dependencies.

---

## 📝 Summary

**What Was Wrong:**
1. Timer effect had `current_turn` in dependencies
2. Every turn change restarted the effect
3. Effect recalculated from expired timestamp
4. Brief visual flash of timer + highest card

**What Was Fixed:**
1. ✅ Removed `current_turn` from dependencies array
2. ✅ Added check to skip countdown if timer already expired
3. ✅ Use `prevState.current_turn` inside callback for latest value

**Result:**
- ✅ No more visual glitches on turn changes
- ✅ Clean, smooth turn transitions
- ✅ Timer only shows when actually active
- ✅ Professional UX experience

---

**Files Modified:**
- `apps/mobile/src/hooks/useRealtime.ts` (Lines 1478-1570)

**Date:** December 28, 2025
