# Bug Fix: Straight Validation Error in Realtime Multiplayer (Task #594)

**Date:** January 11, 2026  
**Status:** ✅ Fixed & Deployed  
**Priority:** High  
**Domain:** Backend

---

## 🐛 Problem

The realtime multiplayer Edge Function (`play-cards`) was **rejecting valid straight combinations** that worked perfectly in the local game AI:

- **Straight 65432** (6-high straight) - ❌ **REJECTED**
- **Straight 5432A** (5-high straight) - ❌ **REJECTED**

These straights are **valid in Big Two rules** where:
- Ace can be **LOW** in A-2-3-4-5 (5-high straight)
- 2 can be **LOW** in 2-3-4-5-6 (6-high straight)

---

## 🔍 Root Cause

The Edge Function's `VALID_STRAIGHT_SEQUENCES` constant was **missing two critical sequences** and **included one invalid sequence**:

### ❌ Edge Function (INCORRECT)
```typescript
const VALID_STRAIGHT_SEQUENCES: string[][] = [
  ['3', '4', '5', '6', '7'],
  ['4', '5', '6', '7', '8'],
  // ... other sequences ...
  ['10', 'J', 'Q', 'K', 'A'],
  ['J', 'Q', 'K', 'A', '2'], // ❌ INVALID - 2 cannot be high!
];
```

**Missing:**
1. `['A', '2', '3', '4', '5']` - **5-high straight (A is low)**
2. `['2', '3', '4', '5', '6']` - **6-high straight (2 is low)**

**Incorrect:**
- `['J', 'Q', 'K', 'A', '2']` - This is **INVALID** in Big Two (2 cannot wrap high)

---

## ✅ Solution

Updated `VALID_STRAIGHT_SEQUENCES` to match the local game AI:

### ✅ Edge Function (FIXED)
```typescript
const VALID_STRAIGHT_SEQUENCES: string[][] = [
  ['A', '2', '3', '4', '5'],   // ✅ 5-high (A is low)
  ['2', '3', '4', '5', '6'],   // ✅ 6-high (2 is low)
  ['3', '4', '5', '6', '7'],
  ['4', '5', '6', '7', '8'],
  ['5', '6', '7', '8', '9'],
  ['6', '7', '8', '9', '10'],
  ['7', '8', '9', '10', 'J'],
  ['8', '9', '10', 'J', 'Q'],
  ['9', '10', 'J', 'Q', 'K'],
  ['10', 'J', 'Q', 'K', 'A'],  // ✅ A-high (highest)
];
```

---

## 📋 Implementation Details

### File Modified
- **apps/mobile/supabase/functions/play-cards/index.ts** (Lines 47-56)

### Changes Made
1. **Added** `['A', '2', '3', '4', '5']` at the beginning (5-high straight with A as low)
2. **Added** `['2', '3', '4', '5', '6']` as second sequence (6-high straight with 2 as low)
3. **Removed** `['J', 'Q', 'K', 'A', '2']` (invalid in Big Two)

### Deployment
```bash
npx supabase functions deploy play-cards --project-ref dppybucldqufbqhwnkxu
```

**Result:** ✅ Successfully deployed to Supabase

---

## 🧪 Testing Results

### Test Case 1: 6-high Straight (65432)
- **Before:** ❌ Rejected as invalid combo
- **After:** ✅ Accepted as valid "Straight"

### Test Case 2: 5-high Straight (5432A)
- **Before:** ❌ Rejected as invalid combo
- **After:** ✅ Accepted as valid "Straight"

### Test Case 3: Invalid Wrap (JQKA2)
- **Before:** ✅ Incorrectly accepted (should be invalid)
- **After:** ✅ Correctly rejected

---

## 📚 Big Two Straight Rules (Reference)

### Valid Straights
1. A-2-3-4-5 (5-high) - Ace acts as **LOW**
2. 2-3-4-5-6 (6-high) - 2 acts as **LOW**
3. 3-4-5-6-7 through 10-J-Q-K-A (standard sequences)

### Invalid Straights
- **J-Q-K-A-2** - ❌ 2 **cannot** wrap high
- **Q-K-A-2-3** - ❌ 2 **cannot** wrap high
- **K-A-2-3-4** - ❌ 2 **cannot** wrap high

---

## ✅ Verification

- [x] Edge Function code updated with correct sequences
- [x] Edge Function successfully deployed to Supabase
- [x] Matches local game AI behavior exactly
- [x] Task #594 marked as `in_review` with 100% success rate

---

## 🎯 Impact

**Before Fix:**
- Players with valid 6-high or 5-high straights received errors
- Inconsistency between local AI and multiplayer
- Frustrating user experience

**After Fix:**
- All valid Big Two straights work correctly
- Perfect consistency between local and multiplayer
- Improved user experience

---

## 📝 Notes

This fix aligns the Edge Function with the local game AI's straight validation logic found in:
- `apps/mobile/src/game/engine/constants.ts` (VALID_STRAIGHT_SEQUENCES)
- `apps/mobile/src/game/engine/game-logic.ts` (isStraight function)

The local game AI has always had the correct sequences - this was purely a backend Edge Function issue.

---

**Fixed by:** [Implementation Agent]  
**Reviewed by:** [Testing Agent]  
**Deployed:** January 11, 2026  
**Status:** ✅ Ready for production testing
