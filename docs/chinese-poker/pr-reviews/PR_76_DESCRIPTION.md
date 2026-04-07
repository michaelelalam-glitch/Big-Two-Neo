# PR #76: Implement One-Card-Left Rule and Fix Auto-Pass Timer Synchronization

**Copy this to GitHub PR description:** https://github.com/michaelelalam-glitch/Big-Two-Neo/pull/76

---

## 🎯 Overview
This PR implements two critical game logic improvements:
1. **One-Card-Left Pass Restriction Rule** (✅ Working)
2. **Auto-Pass Timer Sequential Synchronization Fix** (⚠️ In Testing)

---

## 🎮 Feature 1: One-Card-Left Rule (✅ WORKING)

### Problem
Players could strategically stall by passing repeatedly when the next player has only 1 card left (likely the winning card like 2♠), forcing them to play it prematurely. This is against official Big Two rules.

### Solution
Implemented the official Big Two rule: **Cannot pass when the next player has exactly 1 card left**.

### Changes Made
**Edge Functions:**
- [`apps/mobile/supabase/functions/player-pass/index.ts`](apps/mobile/supabase/functions/player-pass/index.ts): Added validation at lines 136-184
  - Checks next player's card count before allowing pass
  - Returns specific error: `"Cannot pass: Next player has only 1 card left"`
  - Handles race conditions (trick clearing simultaneously)

- [`apps/mobile/supabase/functions/play-cards/index.ts`](apps/mobile/supabase/functions/play-cards/index.ts): Added same validation
  - Prevents passing via play-cards endpoint
  - Consistent error messaging across both endpoints

**Database Migrations:**
- `apps/mobile/migrations/20260114000000_one_card_left_rule_functions.sql`
  - PostgreSQL helper functions: `get_player_card_count()`, `get_next_player_index()`
  - Server-side card counting logic

- `apps/mobile/migrations/20260114000001_one_card_left_rule_pass_validation.sql`
  - Race condition handling with graceful fallback
  - Edge case validation

**Key Features:**
- ✅ Prevents passing when next player (counterclockwise: 0→1→2→3→0) has exactly 1 card
- ✅ Handles race conditions (if auto-pass clears trick simultaneously, succeeds gracefully)
- ✅ Returns specific error message for client UI feedback
- ✅ Applies to both manual pass and play-cards pass scenarios

### Testing Results
- [x] Manual testing with 4 players: **PASSING** ✅
- [x] Validated error message displays correctly in client: **CONFIRMED** ✅
- [x] Confirmed rule enforcement prevents strategic stalling: **WORKING** ✅
- [x] Race condition handling tested: **STABLE** ✅

**Status:** ✅ **COMPLETE AND WORKING**

---

## 🔧 Feature 2: Auto-Pass Timer Fix (⚠️ IN TESTING)

### Problem
Auto-pass timer was **only passing 1 out of 3 players** instead of all remaining players. After the first player successfully passed, subsequent passes failed with `"Not your turn"` errors.

**Console Evidence:**
```
5:38:18 pm | ✅ Successfully auto-passed player 1 (1/3)
5:38:18 pm | ⚠️ Player 2 already passed or not their turn, trying next player...
5:38:18 pm | ⚠️ Player 3 already passed or not their turn, trying next player...
5:38:18 pm | Auto-pass execution complete: 1/3 players passed
```

### Root Cause Analysis
The frontend calculated turn numbers **once at the START** of execution:
```typescript
// BEFORE (Broken):
let currentTurn = currentGameState.current_turn; // Fetched ONCE
for (let i = 0; i < 3; i++) {
  await pass(currentTurn); // Player 1: SUCCESS ✅
  currentTurn = (currentTurn + 1) % 4; // Manual increment: Player 2
  // But server already updated current_turn after Player 1 passed!
  // So Player 2's turn number is now STALE ❌
}
```

**The Issue:** After each successful pass, the **server updates `game_state.current_turn`** via the Edge Function. But the frontend was using a stale, pre-calculated turn number that no longer matched the server's state.

### Solution
Changed auto-pass execution to **query fresh `current_turn` from database BEFORE EACH pass** instead of calculating turn numbers in advance.

### Changes Made
**Frontend:**
- [`apps/mobile/src/hooks/useRealtime.ts`](apps/mobile/src/hooks/useRealtime.ts) (Lines 1478-1520)
  - ❌ Removed: Pre-calculated turn array (`let currentTurn = ...`)
  - ❌ Removed: Manual turn increment (`currentTurn = (currentTurn + 1) % 4`)
  - ✅ Added: Database query BEFORE each pass in the loop
  - ✅ Added: Fresh `current_turn` fetch ensures sync with server

**New Logic:**
```typescript
// AFTER (Fixed):
for (let i = 0; i < remainingPasses; i++) {
  // Query fresh turn from server BEFORE each pass
  const { data: freshState } = await supabase
    .from('game_state')
    .select('current_turn, passes')
    .eq('room_id', room?.id)
    .single();
  
  const currentTurn = freshState.current_turn; // Always fresh!
  await pass(currentTurn); // Pass whoever server says is current
  // Server updates current_turn, and we query it fresh next iteration
}
```

**Edge Functions:**
- `apps/mobile/migrations/20260115000001_fix_auto_pass_exempt_player_return.sql`
  - Fixed exempt player return value validation in Edge Function
  - Ensures proper turn return for exempt player

### Expected Behavior After Fix
- ✅ Timer expires with 0 manual passes → Auto-pass all 3 players (1, 2, 3)
- ✅ Timer expires with 1 manual pass → Auto-pass remaining 2 players (2, 3)
- ✅ Timer expires with 2 manual passes → Auto-pass remaining 1 player (3)
- ✅ Manual pass during auto-pass execution → Gracefully continue to next player
- ✅ No "Not your turn" errors due to stale state

### Testing Status
**Current Console Output (Still Failing):**
```
✅ Successfully auto-passed player 1 (1/3)
⚠️ Player already passed or not their turn, trying next iteration...
⚠️ Player already passed or not their turn, trying next iteration...
Auto-pass execution complete: 1/3 players passed
```

**Status:** ⚠️ **FIX DEPLOYED BUT STILL FAILING IN TESTING**

### Next Steps for Debugging
1. Add delay between passes (give server time to update): `await new Promise(resolve => setTimeout(resolve, 500));`
2. Add more logging to show exact `current_turn` value fetched each iteration
3. Verify Edge Function is properly updating `current_turn` after each pass
4. Check if Realtime sync is interfering with database queries

---

## 📊 Files Changed Summary

### Modified Files (3)
1. **[apps/mobile/src/hooks/useRealtime.ts](apps/mobile/src/hooks/useRealtime.ts)**
   - Lines 1478-1520: Auto-pass timer logic rewritten
   - Added fresh database query before each pass
   - Removed stale turn calculation

2. **[apps/mobile/supabase/functions/play-cards/index.ts](apps/mobile/supabase/functions/play-cards/index.ts)**
   - Lines 180-230: One-card-left pass validation
   - Card count checking with PostgreSQL functions

3. **[apps/mobile/supabase/functions/player-pass/index.ts](apps/mobile/supabase/functions/player-pass/index.ts)**
   - Lines 136-184: One-card-left pass validation
   - Exempt player return fix
   - Race condition handling

### New Files Added (11)
**SQL Migrations:**
- `apps/mobile/migrations/20260114000000_one_card_left_rule_functions.sql`
- `apps/mobile/migrations/20260114000001_one_card_left_rule_pass_validation.sql`
- `apps/mobile/migrations/20260115000001_fix_auto_pass_exempt_player_return.sql`

**Documentation:**
- `docs/BUG_FIX_ONE_CARD_LEFT_PASS_VALIDATION_JAN_14_2026.md`
- `docs/BUG_FIX_AUTO_PASS_TURN_VALIDATION_JAN_15_2026.md`
- `docs/BUG_FIX_AUTO_PASS_RACE_CONDITION_JAN_15_2026.md`
- `docs/BUG_FIX_AUTO_PASS_VALIDATION_GUARD_JAN_15_2026.md`
- `docs/BUG_FIX_AUTO_PASS_EXEMPT_RETURN_JAN_15_2026.md`
- `docs/BUG_FIX_AUTOPASS_TIMER_AND_BOT_3D_JAN_12_2026.md`
- `docs/BUG_FIX_AUTOPASS_TIMER_MATCH_2_JAN_12_2026.md`

**Tests:**
- `apps/mobile/src/game/__tests__/bot-matchNumber.test.ts`

### Git Statistics
```
18 files changed
+2,966 insertions
-160 deletions
```

---

## ✅ Testing Checklist

### One-Card-Left Rule Testing
- [x] Player cannot pass when next player has 1 card
- [x] Error message displays correctly: "Cannot pass: Next player has only 1 card left"
- [x] Rule enforced in both `player-pass` and `play-cards` endpoints
- [x] Race condition handling works (trick clearing during pass)
- [x] Manual testing with 4 players: **PASSING** ✅

### Auto-Pass Timer Testing
- [ ] ⚠️ **FAILING:** Currently only 1/3 players auto-pass
- [ ] Timer expires with 0 manual passes → Auto-pass all 3 players
- [ ] Timer expires with 1 manual pass → Auto-pass remaining 2 players
- [ ] Timer expires with 2 manual passes → Auto-pass remaining 1 player
- [ ] Manual pass during timer doesn't break auto-pass
- [ ] Console shows correct pass counts (currently shows 1/3)
- [ ] No "Not your turn" errors after fresh state queries (still occurring)

---

## 🚀 Deployment Steps

### Database Migrations
```bash
# Run migrations in order:
1. apps/mobile/migrations/20260114000000_one_card_left_rule_functions.sql
2. apps/mobile/migrations/20260114000001_one_card_left_rule_pass_validation.sql
3. apps/mobile/migrations/20260115000001_fix_auto_pass_exempt_player_return.sql
```

### Edge Functions
```bash
# Deploy updated Edge Functions:
supabase functions deploy player-pass
supabase functions deploy play-cards
```

### Frontend
- React Native app will auto-update on hot reload
- No additional deployment steps needed

---

## 📌 Related Issues & Context

### Fixes
- ❌ Auto-pass only passing 1 out of 3 players (still failing)
- ✅ Strategic stalling exploit with one-card-left scenario (fixed)
- ✅ Race conditions in pass validation (fixed)

### Implements
- ✅ Official Big Two one-card-left pass restriction rule
- ⚠️ Server-authoritative auto-pass synchronization (in progress)

### Technical Debt
- Need to add integration tests for auto-pass timer
- Consider refactoring auto-pass logic to be fully server-side
- Add more detailed error logging for debugging

---

## 🔍 Code Review Focus Areas

### For Reviewers
1. **One-Card-Left Logic:** Verify card counting is accurate (lines 136-184 in player-pass)
2. **Race Conditions:** Check race condition handling in both Edge Functions
3. **Auto-Pass Sync:** Review fresh state query logic (useRealtime.ts lines 1478-1520)
4. **Error Handling:** Ensure errors are gracefully handled and logged
5. **Database Queries:** Verify PostgreSQL functions are efficient

### For Copilot
- ⚠️ **CRITICAL:** Auto-pass still failing after fresh state query implementation
- ❓ Should we add delay between passes to let server state settle?
- ❓ Is there a Realtime sync interference issue?
- ❓ Should auto-pass be moved to server-side Edge Function?

---

## 📖 Documentation References

See these files for comprehensive implementation details:
- [BUG_FIX_ONE_CARD_LEFT_PASS_VALIDATION_JAN_14_2026.md](docs/BUG_FIX_ONE_CARD_LEFT_PASS_VALIDATION_JAN_14_2026.md)
- [BUG_FIX_AUTO_PASS_TURN_VALIDATION_JAN_15_2026.md](docs/BUG_FIX_AUTO_PASS_TURN_VALIDATION_JAN_15_2026.md)
- [BUG_FIX_AUTO_PASS_RACE_CONDITION_JAN_15_2026.md](docs/BUG_FIX_AUTO_PASS_RACE_CONDITION_JAN_15_2026.md)

---

## 🎯 Next Actions

1. **Copilot Review:** Request feedback on auto-pass implementation approach
2. **Testing:** Test auto-pass with multiple players in live game
3. **Debugging:** Add more logging to diagnose why fresh queries still fail
4. **Investigation:** Check if server is actually updating `current_turn` after each pass
5. **Monitoring:** Watch console logs during multiplayer games

---

**PR Status:** 
- ✅ One-Card-Left Rule: **READY TO MERGE**
- ⚠️ Auto-Pass Timer: **NEEDS MORE DEBUGGING**

**Ready for Copilot review! 🎮**
