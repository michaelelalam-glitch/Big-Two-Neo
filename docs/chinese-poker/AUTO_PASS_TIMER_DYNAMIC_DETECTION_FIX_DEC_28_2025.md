# Auto-Pass Timer Dynamic Detection Fix - December 28, 2025

**Status:** 🔧 IN PROGRESS - Diagnostic logging added  
**Priority:** CRITICAL

---

## 🐛 REPORTED ISSUES

### Issue #1: Alert Popup Showing ❌
**User Report:** "i dont want the notification/alert that you can see to appear or be present in the code"  
**Expected:** Only countdown timer UI visible (no Alert.alert popup)  
**Status:** ✅ **FIXED** - Removed Alert.alert() from AutoPassTimer.tsx

### Issue #2: Timer Not Starting After 2♥ is Played ❌
**User Report:** "when the player played the 2h after the 2s has already been played the timer never started and no one was autopassed"  
**Expected:** Timer should start for 2♥ (next highest after 2♠)  
**Status:** 🔧 **INVESTIGATING** - Added diagnostic logging

---

## 📊 CONSOLE LOG ANALYSIS

### What Happened:

**Turn 1: Player plays 2♠**
- ✅ Timer started correctly
- ✅ Countdown visible (7868ms remaining)
- ✅ Auto-pass executed when timer reached 0
- ✅ Turn advanced to next player

**Turn 2: Bot 1's turn (after auto-pass)**
- ❌ Console shows: `[BotCoordinator] Bot passed successfully`
- ❌ No log of Bot 1 playing 2♥
- ❌ Timer never started

### Key Console Log Entries:

```
LOG 4:58:27 pm | GAME | DEBUG : [DEBUG] Timer effect fired:
{
  "isMultiplayer": true,
  "hasTimer": true,
  "remaining_ms": 7868,
  "displaySeconds": 8,
  "gamePhase": "playing"
}
```

Then later:

```
LOG 4:58:27 pm | GAME | DEBUG : [DEBUG] Timer effect fired:
{
  "isMultiplayer": true,
  "hasTimer": false,  ← TIMER BECAME INACTIVE
  "displaySeconds": null,
  "gamePhase": "playing"
}

LOG 4:58:27 pm | GAME | INFO : [useRealtime] ⏳ Waiting 300ms for Realtime sync after pass...
LOG 4:58:28 pm | GAME | INFO : ✅ [BotCoordinator] Bot passed successfully
```

**Analysis:** Bot PASSED instead of playing 2♥! That's why no timer started.

---

## 🔍 ROOT CAUSE INVESTIGATION

### Question 1: Why Did Bot Pass Instead of Playing 2♥?

**Possible Causes:**
1. Bot doesn't have 2♥ in hand
2. Bot strategy chose to pass (bad decision)
3. Bot coordinator logic issue
4. Bot algorithm not detecting 2♥ as playable

### Question 2: Is Timer Detection Logic Correct?

**Current Logic:**
```typescript
// Line 786-787 in useRealtime.ts
const currentPlayedCards = gameState.played_cards || [];
const isHighestPlay = isHighestPossiblePlay(cards, currentPlayedCards);
```

**This should work correctly:**
- When 2♠ is played: `isHighestPossiblePlay([2♠], [])` → TRUE ✅
- When 2♥ is played: `isHighestPossiblePlay([2♥], [2♠])` → TRUE ✅

**BUT:** If the bot doesn't PLAY 2♥, then `isHighestPossiblePlay` never gets called!

---

## 🔧 FIXES APPLIED

### Fix #1: Remove Alert Popup ✅

**File:** `apps/mobile/src/components/game/AutoPassTimer.tsx`

**Changes:**
- Removed `Alert` from React Native imports
- Removed `hasShownAlert` state variable
- Removed entire `useEffect` that showed Alert.alert()

**Result:** Only countdown timer UI displays (no popup)

---

### Fix #2: Enhanced Diagnostic Logging 🔧

**File:** `apps/mobile/src/hooks/useRealtime.ts`

**Changes Made:**

#### A) Enhanced playCards() logging (Line 786-809):
```typescript
gameLogger.info('[useRealtime] 🎯 Highest play detection:', {
  isHighestPlay,
  willCreateTimer: !!autoPassTimerState,
  currentPlay: cards.map(c => `${c.rank}${c.suit}`).join(', '),
  playedCardsBeforeThisPlay: currentPlayedCards.map((c: Card) => `${c.rank}${c.suit}`).join(', '),
  playedCardsCount: currentPlayedCards.length,
  comboType,
});
```

**What This Shows:**
- Exact cards being played (e.g., "2H")
- Exact cards already played before this (e.g., "2S")
- Whether timer will be created
- Combo type

#### B) Enhanced timer countdown effect logging (Line 1458-1476):
```typescript
if (!gameState?.auto_pass_timer || !gameState.auto_pass_timer.active) {
  networkLogger.debug('⏰ [Auto-Pass Timer] No active timer', {
    hasGameState: !!gameState,
    hasTimer: !!gameState?.auto_pass_timer,
    isActive: gameState?.auto_pass_timer?.active,
    currentTurn: gameState?.current_turn,
    gamePhase: gameState?.game_phase,
  });
  return;
}

const timerState = gameState.auto_pass_timer;

networkLogger.info('⏰ [Auto-Pass Timer] Starting timer countdown', {
  duration_ms: timerState.duration_ms,
  triggering_play: timerState.triggering_play?.cards.map(c => `${c.rank}${c.suit}`).join(', '),
  player_index: timerState.triggering_play?.position,
  currentTurn: gameState?.current_turn,
});
```

**What This Shows:**
- Why timer is NOT starting (missing timer, inactive, etc.)
- When timer DOES start (with card details)
- Current turn and game phase

---

## 🧪 TESTING PLAN

### Test Scenario 1: 2♠ → 2♥ Sequence
```
1. Player plays 2♠
   → Check logs: Should see "🎯 Highest play detection: isHighestPlay=true, currentPlay=2S"
   → Check logs: Should see "⏰ Starting timer countdown: triggering_play=2S"
   → Verify: Timer countdown visible on screen
   → Wait 10 seconds
   → Verify: Player auto-passed

2. Next player's turn (they have 2♥)
   → Bot should play 2♥ (or human if testing manually)
   → Check logs: Should see "🎯 Highest play detection: isHighestPlay=true, currentPlay=2H, playedCardsBeforeThisPlay=2S"
   → Check logs: Should see "⏰ Starting timer countdown: triggering_play=2H"
   → Verify: Timer countdown visible on screen
   → Wait 10 seconds
   → Verify: Next player auto-passed
```

### Test Scenario 2: Bot Has 2♥ But Passes
```
1. Player plays 2♠ → Timer works (confirmed by user)
2. Bot's turn
   → Check logs: Does bot have 2♥ in hand?
   → Check logs: What does bot coordinator decide?
   → If bot passes: WHY?
```

### Test Scenario 3: Dynamic Detection (2♠ → 2♥ → 2♣)
```
1. Player plays 2♠ → Timer starts ✅
2. Player plays 2♥ → Timer should start again
3. Player plays 2♣ → Timer should start again
4. Player plays 2♦ → Timer should start again
```

---

## 🎯 NEXT STEPS

1. **Test with enhanced logging:**
   - Start new game
   - Play 2♠
   - Check console for detailed timer logs
   - Let bot take turn
   - Check if bot plays 2♥ or passes
   - Examine why bot made that decision

2. **If bot doesn't have 2♥:**
   - Test manually with human player who has 2♥
   - Verify timer starts correctly for 2♥

3. **If bot has 2♥ but passes:**
   - Investigate bot strategy algorithm
   - Check bot coordinator logic
   - May need to fix bot decision-making

---

## 📋 FILES MODIFIED

1. **`apps/mobile/src/components/game/AutoPassTimer.tsx`**
   - Removed Alert.alert() popup
   - Removed alert-related imports and state

2. **`apps/mobile/src/hooks/useRealtime.ts`**
   - Enhanced logging in `playCards()` (lines 786-809)
   - Enhanced logging in timer countdown effect (lines 1458-1476)
   - Shows exact cards played and timer decisions

---

## 🚨 CRITICAL OBSERVATIONS

**From Console Log:**
- Timer DOES work for 2♠ (confirmed)
- Auto-pass DOES execute when timer expires (confirmed)
- Bot PASSED instead of playing (unexpected behavior)
- Need to determine WHY bot passed

**Two Possible Scenarios:**

### Scenario A: Bot Doesn't Have 2♥
- Bot hand doesn't include 2♥
- Bot correctly passes
- Timer doesn't start because no highest play was made
- **This is correct behavior** ✅

### Scenario B: Bot Has 2♥ But Chooses to Pass
- Bot hand includes 2♥
- Bot strategy decides to pass (bad decision)
- Timer doesn't start because no play was made
- **This is a bot logic bug** ❌

---

## 🔬 DIAGNOSTIC COMMANDS

**To check bot's hand:**
```typescript
// Look for log: "[GameScreen] 👤 Player 1 "Bot 1" [BOT]"
// Shows: "hand_from_state": "11 cards", "first_3_cards": ["KH", "2D", "KC"]
```

**Check if 2♥ or 2♦ is in Bot 1's hand:**
```bash
# In console log, search for: "Player 1" + "2H" or "2D"
```

---

## ✅ SUCCESS CRITERIA

- ✅ No Alert.alert() popup (DONE)
- ⏳ Timer starts when 2♥ is played after 2♠
- ⏳ Timer starts when 2♣ is played after 2♠ and 2♥
- ⏳ Timer starts when 2♦ is played after all other 2s
- ⏳ Dynamic detection works for pairs, triples, 5-card combos
- ⏳ Detailed logs show timer decisions

---

**Status:** Ready for testing with enhanced logging  
**Next:** Run game and collect console logs to diagnose bot behavior
