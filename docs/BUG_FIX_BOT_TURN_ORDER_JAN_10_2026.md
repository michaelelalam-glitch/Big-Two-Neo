# Bug Fix: Bot AI Turn Order (Clockwise → Counterclockwise)

**Date:** January 10, 2026  
**Branch:** `fix/task-585-586-match-end-error`  
**Severity:** 🔴 CRITICAL  
**Status:** ✅ FIXED

---

## 🚨 Problem

Bot AI was using **CLOCKWISE** turn order `[3, 2, 0, 1]` while the game engine and edge functions were updated to use **COUNTERCLOCKWISE** turn order `[1, 2, 3, 0]`. This caused bots to make incorrect decisions when checking the "One Card Left" rule, leading to HTTP 400 errors.

### Symptoms
1. ❌ Bot 2 tried to play cards after Bot 4's full house
2. ❌ HTTP 400 error: Bot's play was invalid
3. ❌ Game got stuck on Bot 2's turn
4. ❌ Console showed: `[useRealtime] ❌ Server validation failed: HTTP 400`

### Root Cause
Bot AI was checking the **WRONG next player** due to outdated turn order:
- Bot 2 (index 3) used `turnOrder[3] = 1` → thought next player was Bot 4 (index 1)
- **CORRECT:** Next player after Bot 2 (index 3) should be Player 0 (Steve)

This caused Bot 2 to make decisions based on Bot 4's card count instead of Steve's, leading to invalid plays that the server correctly rejected.

---

## 🔍 Investigation

### Console Log Analysis
```
2:27:41 pm | Bot 4 (player 1) plays full house: 2D, 2C, 2H, 8H, 8S
2:27:43 pm | Bot 3 (player 2) passes
2:27:44 pm | Bot 2 (player 3) decision: should_pass: false, cards_to_play: 5
2:27:46 pm | ❌ Server validation failed: HTTP 400
```

**Expected:** Bot 2 should check if Player 0 (Steve) has 1 card left  
**Actual:** Bot 2 checked if Bot 4 (player 1) has 1 card left

### Code Location
**File:** `apps/mobile/src/game/bot/index.ts`

**Two affected methods:**
1. `handleLeading()` - Line ~107
2. `handleFollowing()` - Line ~167

---

## ✅ Solution

### Changes Made

#### Before (BROKEN - Clockwise)
```typescript
// Mapping: 0→3, 1→2, 2→0, 3→1. Example sequence: 0→3→1→2→0.
const turnOrder = [3, 2, 0, 1]; // WRONG: Clockwise
```

#### After (FIXED - Counterclockwise)
```typescript
// Counterclockwise: 0→1→2→3→0, so sequence maps to: 0→1, 1→2, 2→3, 3→0
const turnOrder = [1, 2, 3, 0]; // CORRECT: Counterclockwise
```

### Verification
- ✅ Turn order now matches edge functions (play-cards, player-pass, start_new_match)
- ✅ Bot correctly identifies next player in counterclockwise order
- ✅ One Card Left rule works properly
- ✅ No TypeScript errors

---

## 📊 Testing

### Test Scenario
1. Start multiplayer match with 3 bots
2. Play cards until Match 2 begins
3. Player 0 plays a flush (5 cards)
4. Bot 4 plays a full house (5 cards)
5. Bot 3 passes
6. **Bot 2 should now make correct decision based on Player 0's card count**

### Expected Behavior
- Bot 2 checks Player 0's (Steve) card count
- If Player 0 has 1 card, Bot 2 must play highest single (One Card Left rule)
- If Player 0 has >1 cards, Bot 2 plays normally or passes

### Before Fix
- ❌ Bot 2 checked Bot 4's card count (WRONG)
- ❌ Made invalid play based on wrong assumption
- ❌ HTTP 400 error from server
- ❌ Game stuck

### After Fix
- ✅ Bot 2 checks Player 0's card count (CORRECT)
- ✅ Makes valid play based on correct assumption
- ✅ No HTTP errors
- ✅ Game continues smoothly

---

## 🔗 Related Fixes

This is the **THIRD** turn order fix in this PR:
1. ✅ Fixed play-cards edge function (line 935)
2. ✅ Fixed player-pass edge function (line 113)
3. ✅ Fixed bot AI (handleLeading & handleFollowing)

All components now use consistent **COUNTERCLOCKWISE** turn order: `[1, 2, 3, 0]`

---

## 📝 Commit

```bash
git commit -m "fix(bot): correct turn order from clockwise to counterclockwise in bot AI

CRITICAL FIX: Bot AI was using old clockwise turn order [3,2,0,1] 
which caused wrong decision making when checking One Card Left rule.

Changes:
- handleLeading(): turnOrder changed from [3,2,0,1] to [1,2,3,0]
- handleFollowing(): turnOrder changed from [3,2,0,1] to [1,2,3,0]

This ensures bot correctly determines next player in counterclockwise 
direction: 0→1→2→3→0

Resolves: Bot 2 HTTP 400 error when trying to play after Bot 4's full house"
```

---

## 🎯 Impact

**Before:** Bots made incorrect strategic decisions, causing game-breaking HTTP 400 errors  
**After:** Bots make correct decisions based on proper turn sequence, game flows smoothly

**Affected Systems:**
- ✅ Bot AI decision making
- ✅ One Card Left rule enforcement
- ✅ Strategic bot play
- ✅ Multiplayer game flow

---

## ✨ Summary

This critical fix ensures that the bot AI correctly determines the next player in the counterclockwise turn order, aligning with the game engine and edge functions. Without this fix, bots would make incorrect strategic decisions based on the wrong player's card count, leading to invalid plays and HTTP 400 errors that broke multiplayer gameplay.

**Status:** ✅ Fixed and deployed to PR branch `fix/task-585-586-match-end-error`
