# One Card Left Rule - Pass Validation Fix
**Date:** January 14, 2026  
**Bug Report:** User was able to pass when next player had 1 card left and user had a higher single  
**Versions:** player-pass v16 (FIXED), SQL migration 20260114000001  
**Critical Bug:** v15 used wrong database column name (`current_hands` vs `hands`)

---

## 🐛 Problem

The One Card Left rule was **incompletely implemented**:
- ✅ **play-cards (v44):** Validates when PLAYING cards → forces highest single  
- ❌ **player-pass (v14):** NO validation → allowed illegal passes  
- ❌ **player-pass (v15):** Validation added but NEVER triggered due to wrong column name!

**Example:**
- Bot 4 has 1 card left
- Last play: 9C (single)
- User has KH (higher single)
- User pressed PASS → ❌ Should be BLOCKED!

**Root Cause (v15):**
```typescript
const currentHands = gameState.current_hands || {};  // ❌ WRONG! Database uses 'hands'
```
This resulted in `currentHands = {}`, so `nextPlayerHand.length` was always 0, and the validation check NEVER triggered.

---

## 🔧 Solution

### 1. Updated SQL Function (Migration 20260114000001)
**File:** `apps/mobile/migrations/20260114000001_one_card_left_rule_pass_validation.sql`

**Changes:**
- Detect when `p_selected_cards` is empty array (`[]`) = passing
- If passing AND player has higher single → BLOCK with error message
- If playing single AND not highest → BLOCK (existing behavior)

**Logic:**
```typescript
if (selected_cards.length === 0) {
  // Player is PASSING
  if (nextPlayer.cards === 1 && playerHasHigherSingle) {
    return { valid: false, error: "Cannot pass! Must play highest single..." }
  }
} else if (selected_cards.length === 1) {
  // Player is PLAYING a single
  if (nextPlayer.cards === 1 && !isHighestSingle) {
    return { valid: false, error: "Must play highest single..." }
  }
}
```

### 2. Updated player-pass Edge Function (v16 - FIXED)
**File:** `apps/mobile/supabase/functions/player-pass/index.ts`

**Critical Fix (v15 → v16):**
```typescript
// v15 (BROKEN):
const currentHands = gameState.current_hands || {};  // ❌ Always returns {}

// v16 (FIXED):
const currentHands = gameState.hands || {};  // ✅ Correct column name
```

**Added at Line 137-215:**
- Parse current hands (player's hand + next player's hand)
- Check if next player has 1 card AND last play was single
- Call `validate_one_card_left_rule()` with EMPTY array (`[]`) for passing
- If validation fails, return error with required card

**Key Code:**
```typescript
// 5.5 ✅ ONE CARD LEFT RULE: Check if player can pass
const nextPlayerIndex = [1, 2, 3, 0][player.player_index];
const nextPlayerHand = parseCards(currentHands[nextPlayerIndex] || []);
const playerHand = parseCards(currentHands[player.player_index] || []);

if (nextPlayerHand.length === 1 && lastPlay?.cards?.length === 1) {
  const { data: validation } = await supabaseClient.rpc('validate_one_card_left_rule', {
    p_selected_cards: [],              // Empty array = PASSING
    p_current_player_hand: playerHand,
    p_next_player_card_count: 1,
    p_last_play: lastPlay
  });

  if (!validation.valid) {
    return { 
      success: false, 
      error: validation.error,         // "Cannot pass! Must play highest single (KH)..."
      required_card: validation.required_card 
    };
  }
}
```

---

## ✅ Expected Behavior (After Fix)

### Scenario 1: Next player has 1 card, user has higher single
- Last play: 9C (single)
- Next player (Bot 4): 1 card
- User hand: [5D, 7H, KH] (KH beats 9C)
- User presses PASS → **BLOCKED!** ❌
- Error: "Cannot pass! Must play highest single (KH) when opponent has 1 card left"

### Scenario 2: Next player has 1 card, user has NO higher single
- Last play: AS (single, highest rank)
- Next player: 1 card
- User hand: [5D, 7H, KD] (no card beats AS)
- User presses PASS → **ALLOWED** ✅

### Scenario 3: Next player has 1 card, last play was pair
- Last play: 9C, 9D (pair)
- Next player: 1 card
- User hand: [5D, 7H, KH]
- User presses PASS → **ALLOWED** ✅ (rule only applies to singles)

### Scenario 4: Next player has 2+ cards
- Last play: 9C (single)
- Next player: 3 cards
- User hand: [5D, 7H, KH]
- User presses PASS → **ALLOWED** ✅ (rule only applies when next player has 1 card)

---

## 🧪 Testing Checklist

- [ ] Start multiplayer game with 3 bots
- [ ] Play until one bot has 1 card left
- [ ] Ensure last play is a single
- [ ] Try to PASS when you have a higher single → Should be BLOCKED
- [ ] Try to PASS when you have NO higher single → Should be ALLOWED
- [ ] Try to PLAY wrong single → Should be BLOCKED (existing behavior)
- [ ] Try to PLAY highest single → Should be ALLOWED

---

## 📊 Deployment Status

✅ **Migration Applied:** 20260114000001_one_card_left_rule_pass_validation  
✅ **Edge Function Deployed:** player-pass v16 (ACTIVE) - **FIXED column name bug from v15**  
✅ **SQL Function Updated:** `validate_one_card_left_rule()` (handles passing)  
✅ **Backward Compatibility:** Existing play-cards v44 continues working

**Version History:**
- v14: No One Card Left validation (buggy)
- v15: Validation added but NEVER triggered (wrong column: `current_hands` vs `hands`)
- **v16: FIXED - Uses correct column `hands`** ✅

---

## 🔍 Related Files

1. `apps/mobile/migrations/20260114000000_one_card_left_rule_functions.sql` (original)
2. `apps/mobile/migrations/20260114000001_one_card_left_rule_pass_validation.sql` (this fix)
3. `apps/mobile/supabase/functions/player-pass/index.ts` (v15)
4. `apps/mobile/supabase/functions/play-cards/index.ts` (v44, unchanged)

---

## 📝 Notes

- **Timeout Protection:** 5-second max for SQL RPC call (prevents 504 timeouts)
- **Fallback Behavior:** If SQL function fails/times out → Allow pass (don't block gameplay)
- **Error Messages:** Clear, actionable ("Cannot pass! Must play KH...")
- **Turn Order:** Counterclockwise 0→1→2→3→0 (matches play-cards)
- **Card Parsing:** Handles both string format ("5D") and object format ({rank: "5", suit: "D"})

---

## 🎯 Root Cause Summary

The One Card Left rule was ONLY implemented in:
- ✅ play-cards Edge Function (v44) → Validates card plays

But was MISSING from:
- ❌ player-pass Edge Function (v14) → No validation!

This allowed players to PASS illegally when they should have been forced to play their highest single.

**Fix:** Added identical validation logic to player-pass (v15) with empty array detection for passing.
