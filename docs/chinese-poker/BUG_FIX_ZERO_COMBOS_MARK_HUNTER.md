# 🐛 CRITICAL BUG: Zero Combos Recorded for Mark Hunter

**Date:** December 15, 2025  
**Task:** #312 - Player Stats Accuracy  
**Severity:** CRITICAL - Complete stats loss  
**Status:** 🔍 INVESTIGATING

---

## 🔍 Problem Report

### User Report:
> "I've played two games with Mark Hunter. In those two games, I have lost, and the game has come to completion. When I look down to see combos played, I can see none of my combos. None of the singles, pairs, triples, straights, flushes, or any of them appear."

### Verified Issue:
```sql
-- Mark Hunter's stats after 2 completed games:
{
  "games_played": 2,
  "games_won": 0,
  "games_lost": 2,
  "singles_played": 0,      ❌ Should be > 0
  "pairs_played": 0,        ❌ Should be > 0
  "triples_played": 0,      ❌ Should be > 0
  "straights_played": 0,    ❌ Should be > 0
  "flushes_played": 0,      ❌ Expected
  "full_houses_played": 0,  ❌ Expected
  "four_of_a_kinds_played": 0,
  "straight_flushes_played": 0,
  "last_game_at": "2025-12-15 06:51:33.703391+00"
}
```

**Comparison with Steve Peterson (10 games):**
- Singles: 68 ✅
- Pairs: 33 ✅
- Triples: 9 ✅
- Straights: 7 ✅

**Critical Finding:** Mark Hunter has **ALL ZEROS** for combos despite playing 2 completed games!

---

## 🔬 Root Cause Analysis

### Investigation Timeline:

1. ✅ **Checked Mobile App Combo Counting Logic** (`state.ts` line 870-910)
   - Code correctly filters `roundHistory` by `playerId`
   - Code correctly maps combo types to database fields
   - **ISSUE FOUND:** Filtering logic depends on matching `player.id` with `entry.playerId`

2. ✅ **Checked Edge Function** (`complete-game/index.ts`)
   - Edge function receives `combos_played` object correctly
   - Database function is called with correct parameters
   - **NOTE:** TypeScript interface missing `flushes`, but this doesn't affect runtime

3. ✅ **Checked Database Function** (`update_player_stats_after_game`)
   - Function correctly updates all combo fields
   - Function was fixed to include `flushes_played` line
   - Function executes successfully (confirmed by `games_played` increment)

4. ❌ **FOUND THE BUG: Player ID Mismatch**

---

## 🎯 The Bug

### Code Analysis:

**File:** `apps/mobile/src/game/state.ts` (Line 870-875)

```typescript
// Count combo types for this player
const playerPlays = this.state!.roundHistory.filter(
  entry => entry.playerId === player.id && !entry.passed
);

const comboCounts = {
  singles: 0,
  pairs: 0,
  // ... all zeros
};
```

**The Problem:**
- `roundHistory` entries are created with `playerId: player.id` during gameplay
- When stats are saved, the code filters `roundHistory` by `player.id`
- **If `player.id` has changed or doesn't match, the filter returns EMPTY ARRAY!**
- Result: `comboCounts` remains all zeros!

---

## 🧪 Why This Affects Mark Hunter But Not Steve Peterson

### Hypothesis 1: Player ID Inconsistency
- Steve Peterson's games: Player IDs remained consistent throughout game
- Mark Hunter's games: Player IDs changed between rounds and final stats collection

### Hypothesis 2: Auth Context Issue
- Steve Peterson: Authenticated as `user.id = 4ce1c03a-...` (Steve's real ID)
- Mark Hunter: Authenticated as `user.id = 20bd45cb-...` (Lorraine Alan's real ID!)

**CRITICAL INSIGHT:**
```typescript
// Line 912 in state.ts:
user_id: player.isBot ? `bot_${player.id}` : user.id,
```

If you (Lorraine Alan) were logged in but playing AS "Mark Hunter" (e.g., by changing username in profile), then:
- ✅ Game stats recorded to correct user ID (`20bd45cb-...`)
- ✅ Database increments `games_played` correctly
- ❌ But `player.id` in the game != `playerId` in `roundHistory`
- ❌ Result: Filter finds NO plays, all combo counts are 0!

---

## 🔧 Hypothesis 3: roundHistory Not Being Populated

**Alternative Explanation:**
- `roundHistory` might be EMPTY for Mark Hunter's games
- This would happen if:
  - Game was ended prematurely (e.g., forfeit)
  - Cards were never played
  - `roundHistory.push()` was never called during gameplay

Let me check the logs...

**NOTE:** No `game_history` records exist for Mark Hunter's games! This suggests the games were completed via the Edge Function but no audit trail was created.

---

## ✅ Recommended Fix

### Fix #1: Add Defensive Logging

**File:** `apps/mobile/src/game/state.ts`

```typescript
// Count combo types for this player
const playerPlays = this.state!.roundHistory.filter(
  entry => entry.playerId === player.id && !entry.passed
);

// ✅ ADD THIS LOGGING:
statsLogger.debug(`[Stats] Player ${player.name} (ID: ${player.id})`);
statsLogger.debug(`[Stats] Total roundHistory entries: ${this.state!.roundHistory.length}`);
statsLogger.debug(`[Stats] Filtered plays for this player: ${playerPlays.length}`);
if (playerPlays.length === 0) {
  statsLogger.warn(`⚠️ [Stats] NO PLAYS FOUND FOR ${player.name}! This will result in zero combo counts.`);
  statsLogger.debug(`[Stats] roundHistory player IDs: ${this.state!.roundHistory.map(e => e.playerId).join(', ')}`);
}
```

### Fix #2: Use Player Name as Fallback

**Alternative approach if IDs are unreliable:**

```typescript
const playerPlays = this.state!.roundHistory.filter(
  entry => (entry.playerId === player.id || entry.playerName === player.name) && !entry.passed
);
```

### Fix #3: Ensure roundHistory is Populated

**Check if `roundHistory.push()` is being called:**

Add logging in the `playCards()` method:

```typescript
this.state!.roundHistory.push({
  playerId: player.id,
  playerName: player.name,
  cards,
  combo_type: combo,
  timestamp: Date.now(),
  passed: false,
});
statsLogger.debug(`[Game] Added play to roundHistory: ${player.name} played ${combo}`);
```

---

## 🧪 Testing Steps

### To Reproduce:
1. Sign in as **Lorraine Alan** (`20bd45cb-...`)
2. Start a new game with username set to "Mark Hunter" in UI
3. Play a complete game
4. Check stats after game ends
5. **Expected:** All combo counts should be 0 ❌
6. **After fix:** Combos should be tracked correctly ✅

### To Verify Fix:
1. Add logging (Fix #1)
2. Play a new game as Mark Hunter
3. Check console logs for:
   - Total `roundHistory` entries
   - Filtered plays count
   - Player ID matches
4. If playerPlays.length === 0, investigate player ID mismatch
5. If roundHistory.length === 0, investigate why plays aren't being recorded

---

## 📊 Data Analysis

### Mark Hunter's Profile:
- User ID: `20bd45cb-1d72-4427-be77-b829e76c6688`
- Username: `Mark Hunter`
- Created: `2025-12-14 04:59:45`
- Games played: 2
- Last game: `2025-12-15 06:51:33`

### Game History:
- ❌ **NO game_history records** for Mark Hunter
- This is suspicious - indicates games might not have completed normally

### Edge Function Logs:
- ✅ `complete-game` called successfully (200 OK)
- ✅ Execution time: ~5.6 seconds (normal)
- ❌ No error logs

**Conclusion:** The Edge Function executed successfully, but the mobile app sent `combos_played` with all zeros!

---

## 🎯 Most Likely Root Cause

**Primary Hypothesis:**
1. User signed in as Lorraine Alan
2. Changed display name to "Mark Hunter" in profile settings
3. Played 2 games
4. During gameplay, `player.id` was assigned (e.g., `player-1`, `player-2`)
5. `roundHistory` recorded plays with these player IDs
6. When saving stats, code filtered by `player.id` BUT player object was different
7. Filter returned empty array → all combo counts remained 0

**Evidence:**
- Mark Hunter profile shows `user_id = 20bd45cb-...` (Lorraine Alan's auth ID!)
- Stats were updated (games_played incremented)
- But combos are all zeros
- No game_history records (Edge Function filtering out invalid data?)

---

## 🚀 Immediate Action Required

### Step 1: Add Logging (NOW)
Add defensive logging to identify the exact cause:
- Log `player.id` vs `roundHistory` player IDs
- Log `roundHistory.length` before filtering
- Log `playerPlays.length` after filtering

### Step 2: Test Reproduction (TODAY)
- Play a new game as Mark Hunter
- Verify if combos are still zero
- Check console logs for player ID mismatches

### Step 3: Apply Fix (ASAP)
- If player ID mismatch: Use player name as fallback
- If roundHistory empty: Investigate why plays aren't being recorded
- Add validation to prevent zero-combo submissions

---

## 📝 Related Issues

1. **Task #312:** Player Stats Accuracy - This bug is part of the same issue
2. **Flushes Bug:** Already fixed, but Mark Hunter's games were before the fix
3. **Edge Function Interface:** Missing `flushes` field in TypeScript (non-critical)

---

## ✅ Success Criteria

- [ ] Identify root cause of player ID mismatch
- [ ] Add logging to detect zero-combo submissions
- [ ] Fix combo tracking for all players
- [ ] Verify Mark Hunter can record combos in new games
- [ ] Document lessons learned

---

**Status:** 🔍 INVESTIGATING - Awaiting user feedback and console logs from next game

**Next Steps:**
1. User should play another game as Mark Hunter
2. Check console logs for [Stats] messages
3. Report findings back to dev team
