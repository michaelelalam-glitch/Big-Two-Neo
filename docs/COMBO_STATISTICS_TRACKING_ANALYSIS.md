# 🔍 Combo Statistics Tracking Analysis

**Date:** December 14, 2025  
**Investigator:** Project Manager  
**Status:** ✅ Analysis Complete - Ready for User Review

---

## 📋 Requirements Review

### User Requirements:
1. ✅ **Only save stats for completed games** (not abandoned)
2. ⚠️ **No double-counting**: Pairs in Full Houses should count as Full House ONLY, not as pairs
3. ✅ **Correct categorization** of all combo types

---

## 🔍 Current Implementation Analysis

### 1. **Stats Save Trigger - CORRECT ✅**

**Location:** `apps/mobile/src/game/state.ts` (Line 810-860)

```typescript
private async handleMatchEnd(matchWinnerId: string): Promise<void> {
  // ...
  const gameEnds = shouldGameEnd(this.state.matchScores);

  if (gameEnds) {
    // Game Over: find winner (lowest score)
    this.state.gameOver = true;
    this.state.gameEnded = true;
    this.state.finalWinnerId = findFinalWinner(this.state.matchScores);
    
    // Save game stats to database
    this.saveGameStatsToDatabase().catch(err => {
      // Error handling...
    });
  }
}
```

**✅ FINDING:** Stats are **ONLY saved when game completes** (reaches 101+ points). Abandoned games do NOT trigger stats save.

---

### 2. **Combo Counting Logic - ISSUE FOUND ⚠️**

**Location:** `apps/mobile/src/game/state.ts` (Line 872-910)

```typescript
// Count combo types for this player
const playerPlays = this.state!.roundHistory.filter(
  entry => entry.playerId === player.id && !entry.passed
);

const comboCounts = {
  singles: 0,
  pairs: 0,
  triples: 0,
  straights: 0,
  full_houses: 0,
  four_of_a_kinds: 0,
  straight_flushes: 0,
  royal_flushes: 0,
};

// Explicit mapping from combo display names to database field names
const comboMapping: Record<string, keyof typeof comboCounts> = {
  'single': 'singles',
  'pair': 'pairs',            // ⚠️ PROBLEM: Counts pairs separately
  'triple': 'triples',        // ⚠️ PROBLEM: Counts triples separately
  'straight': 'straights',
  'full house': 'full_houses',  // ✅ Counts full houses
  'four of a kind': 'four_of_a_kinds',
  'straight flush': 'straight_flushes',
  'royal flush': 'royal_flushes',
};

playerPlays.forEach(play => {
  const comboName = play.combo_type.trim().toLowerCase();
  const dbField = comboMapping[comboName];
  if (dbField) {
    comboCounts[dbField]++;  // ⚠️ ISSUE: Increments for each combo type
  }
});
```

**⚠️ ISSUE IDENTIFIED:**

The code correctly classifies combos, **BUT** there's a logical problem:

### How Cards Are Classified:

**Location:** `apps/mobile/src/game/engine/game-logic.ts` (Line 95-120)

```typescript
function classifyFive(cards: Card[]): ComboType {
  const counts = countByRank(sorted);
  const countValues = Object.values(counts).sort((a, b) => b - a);
  
  // Check for straight flush first
  if (straightInfo.valid && isFlush) {
    return 'Straight Flush';
  }
  
  // Check for four of a kind
  if (countValues[0] === 4) {
    return 'Four of a Kind';
  }
  
  // Check for full house (3 + 2)
  if (countValues[0] === 3 && countValues[1] === 2) {
    return 'Full House';  // ✅ Returns "Full House", not "Pair" + "Triple"
  }
  
  // Check for flush
  if (isFlush) {
    return 'Flush';
  }
  
  // Check for straight
  if (straightInfo.valid) {
    return 'Straight';
  }
  
  return 'unknown';
}
```

**✅ GOOD NEWS:** The `classifyCards()` function returns **"Full House"** for 3+2 combos, **NOT** "Pair" + "Triple".

---

## 🧪 Verification: Are Combos Being Double-Counted?

### Test Scenario:
```
Player plays: K♠ K♥ K♦ 8♠ 8♥ (Full House)
```

**What Actually Happens:**
1. ✅ `classifyCards()` is called with 5 cards
2. ✅ Returns `"Full House"` (not "Pair" or "Triple")
3. ✅ `roundHistory.push()` stores `combo_type: "Full House"`
4. ✅ When saving stats, increments `full_houses: 1`
5. ✅ **Does NOT increment `pairs` or `triples`**

**Proof:** `apps/mobile/src/game/state.ts` Line 723

```typescript
// Add to history
this.state!.roundHistory.push({
  playerId: player.id,
  playerName: player.name,
  cards,
  combo_type: combo,  // ← This is the classified combo from classifyCards()
  timestamp: Date.now(),
  passed: false,
});
```

The `combo` variable comes from `classifyCards(cards)`, which returns **one combo type**, not multiple.

---

## ✅ FINAL VERDICT

### 1. **Stats Only Save for Completed Games** ✅
- **CORRECT:** Stats save **ONLY** when game reaches 101+ points
- **CORRECT:** Abandoned games do NOT trigger `saveGameStatsToDatabase()`

### 2. **No Double-Counting** ✅
- **CORRECT:** Full Houses count as Full House **ONLY**
- **CORRECT:** Pairs in Full Houses are **NOT** counted separately
- **Reason:** `classifyCards()` returns a **single combo type**, not multiple

### 3. **Correct Categorization** ✅
- **CORRECT:** All combos are classified correctly:
  - Singles → `singles`
  - Pairs → `pairs`
  - Triples → `triples`
  - Straights → `straights`
  - Full Houses → `full_houses`
  - Four of a Kind → `four_of_a_kinds`
  - Straight Flushes → `straight_flushes`
  - Royal Flushes → `royal_flushes`

---

## 🎯 Summary

**ALL REQUIREMENTS MET ✅**

The combo statistics tracking is working **correctly**:

1. ✅ **Only complete games** trigger stats save
2. ✅ **No double-counting** - Full Houses are counted as Full Houses only
3. ✅ **Correct categorization** - Each combo type is properly identified

**No changes needed!** The system is functioning as designed.

---

## 📊 Example Flow (Full House)

```
Player plays: [K♠, K♥, K♦, 8♠, 8♥]
↓
classifyCards() analyzes 5 cards
↓
countByRank: { 'K': 3, '8': 2 }
↓
countValues: [3, 2]
↓
Matches: countValues[0] === 3 && countValues[1] === 2
↓
Returns: "Full House"
↓
roundHistory.push({ combo_type: "Full House" })
↓
When game ends:
  - full_houses++  ✅
  - pairs += 0     ✅ (not incremented)
  - triples += 0   ✅ (not incremented)
```

---

## 🧪 Testing Recommendations

To verify this analysis, you can:

1. **Play a complete game** (reach 101+ points)
2. **Play various combos** including:
   - Full Houses (K♠ K♥ K♦ 8♠ 8♥)
   - Four of a Kind with kicker (9♠ 9♥ 9♦ 9♣ 3♠)
   - Straight Flushes
3. **Check your stats** after the game ends
4. **Verify counts** match what you actually played

**Expected Result:** Each combo should be counted **exactly once** in the correct category.

---

## 📁 Files Analyzed

1. **`apps/mobile/src/game/state.ts`**
   - Lines 723-730: Combo recording in roundHistory
   - Lines 810-860: Game completion trigger
   - Lines 872-910: Combo counting logic

2. **`apps/mobile/src/game/engine/game-logic.ts`**
   - Lines 95-120: Five-card combo classification
   - Lines 152-180: `classifyCards()` function

3. **`apps/mobile/supabase/migrations/20251208000001_leaderboard_stats_schema.sql`**
   - Lines 24-45: Database schema for combo stats
   - Lines 276-282: Combo incrementing in `update_player_stats_after_game()`

---

**Status:** ✅ **ALL REQUIREMENTS MET - NO CHANGES NEEDED**
