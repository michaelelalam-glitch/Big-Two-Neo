  # Task #589: Invalid Play Error Alerts Implementation

**Date:** January 20, 2026  
**Status:** ✅ COMPLETE  
**Priority:** High  
**Domain:** Frontend

---

## 🎯 Objective

Add user-friendly error alerts with clear explanations when players attempt invalid plays in multiplayer games, matching the error feedback experience of local AI games.

---

## 🐛 Problem

In realtime multiplayer Edge Function games, when players tried invalid plays:
- ❌ No user-friendly error messages displayed
- ❌ Players didn't understand why plays were rejected
- ❌ Generic "Server validation failed" errors were unhelpful
- ❌ No guidance on what was wrong or how to fix it

Example errors returned by server that lacked user context:
- "Cannot beat Pair with Single"
- "Invalid card combination"
- "Not your turn"
- "First play of first match must include 3♦ (three of diamonds)"

---

## ✅ Solution

Implemented error message mapping in `useRealtime.ts` to convert server errors into user-friendly explanations with context and guidance.

### Key Changes

**File:** `/apps/mobile/src/hooks/useRealtime.ts`

#### 1. Added Error Explanation Mapper Function

```typescript
/**
 * Map server error messages to user-friendly explanations
 * Provides context and guidance for why a play was rejected
 */
function getPlayErrorExplanation(serverError: string): string {
  const errorLower = serverError.toLowerCase();
  
  // Turn validation
  if (errorLower.includes('not your turn')) {
    return 'Not your turn. Wait for other players to complete their moves.';
  }
  
  // First play 3♦ requirement
  if (errorLower.includes('first play') && errorLower.includes('3')) {
    return 'First play must include the 3 of Diamonds (3♦).';
  }
  
  // Invalid combination
  if (errorLower.includes('invalid card combination')) {
    return 'Invalid card combination. Valid plays: Single, Pair, Triple, Straight, Flush, Full House, Four of a Kind, Straight Flush.';
  }
  
  // Cannot beat last play (with dynamic extraction)
  if (errorLower.includes('cannot beat')) {
    const match = serverError.match(/Cannot beat (\w+) with (\w+)/i);
    if (match) {
      return `Cannot beat ${match[1]} with ${match[2]}. Play a higher card combo or pass.`;
    }
    return 'Cannot beat the current play. Play higher cards or pass your turn.';
  }
  
  // One Card Left Rule
  if (errorLower.includes('one card left')) {
    return 'One Card Left Rule: When next player has 1 card, you must play your highest single card if playing a single.';
  }
  
  // Card not in hand
  if (errorLower.includes('card not in hand')) {
    return 'One or more selected cards are not in your hand. Please refresh and try again.';
  }
  
  // Game state errors
  if (errorLower.includes('game state not found')) {
    return 'Game state not found. The game may have ended or been disconnected.';
  }
  
  if (errorLower.includes('room not found')) {
    return 'Room not found. The game session may have expired.';
  }
  
  // Default: return original server error
  return serverError;
}
```

#### 2. Enhanced Error Throwing in playCards()

**Before:**
```typescript
throw new Error(errorMessage);
```

**After:**
```typescript
// Enhance error message with user-friendly explanation
const userFriendlyError = getPlayErrorExplanation(errorMessage);
throw new Error(userFriendlyError);
```

---

## 📊 Error Message Mapping

| Server Error | User-Friendly Message |
|--------------|----------------------|
| "Not your turn" | "Not your turn. Wait for other players to complete their moves." |
| "First play of first match must include 3♦" | "First play must include the 3 of Diamonds (3♦)." |
| "Invalid card combination" | "Invalid card combination. Valid plays: Single, Pair, Triple, Straight, Flush, Full House, Four of a Kind, Straight Flush." |
| "Cannot beat Pair with Single" | "Cannot beat Pair with Single. Play a higher card combo or pass." |
| "Cannot beat {X} with {Y}" | "Cannot beat {X} with {Y}. Play a higher card combo or pass." |
| "One Card Left Rule: ..." | "One Card Left Rule: When next player has 1 card, you must play your highest single card if playing a single." |
| "Card not in hand: 3D" | "One or more selected cards are not in your hand. Please refresh and try again." |
| "Game state not found" | "Game state not found. The game may have ended or been disconnected." |
| "Room not found" | "Room not found. The game session may have expired." |

---

## 🧪 Testing Scenarios

### Test Case 1: Invalid Turn
**Setup:** Player tries to play when it's not their turn  
**Expected:** "Not your turn. Wait for other players to complete their moves."

### Test Case 2: Missing 3♦ on First Play
**Setup:** First play of match 1 without 3 of Diamonds  
**Expected:** "First play must include the 3 of Diamonds (3♦)."

### Test Case 3: Invalid Combo
**Setup:** Player selects 2 cards of different ranks (not a pair)  
**Expected:** "Invalid card combination. Valid plays: Single, Pair, Triple, Straight, Flush, Full House, Four of a Kind, Straight Flush."

### Test Case 4: Cannot Beat Play
**Setup:** Player plays Single when last play was Pair  
**Expected:** "Cannot beat Pair with Single. Play a higher card combo or pass."

### Test Case 5: One Card Left Rule Violation
**Setup:** Player plays low single when next player has 1 card  
**Expected:** "One Card Left Rule: When next player has 1 card, you must play your highest single card if playing a single."

---

## 🔗 Related Files

- **Edge Function:** `/apps/mobile/supabase/functions/play-cards/index.ts`  
  Server-side validation that generates error messages

- **Client Hook:** `/apps/mobile/src/hooks/useRealtime.ts`  
  Extracts and maps server errors to user-friendly messages

- **Alert System:** `/apps/mobile/src/utils/alerts.ts`  
  Displays error messages to user via Toast (Android) or Alert (iOS)

- **Screen Components:**
  - `/apps/mobile/src/screens/GameScreen.tsx`
  - `/apps/mobile/src/screens/game/MultiplayerGameScreen.tsx`  
  Catch and display errors via `showError()`

---

## 📝 Implementation Notes

1. **Pattern Matching:** Uses flexible string matching to handle slight variations in server error messages
2. **Dynamic Extraction:** Regex extracts combo types from "Cannot beat X with Y" messages
3. **Fallback Safety:** Returns original server error if no pattern matches
4. **Case Insensitive:** All matching done in lowercase for robustness
5. **Unicode Support:** Properly displays 3♦ symbol in error messages

---

## ✅ Success Criteria

- [x] All invalid play errors show user-friendly messages
- [x] Messages explain WHY the play failed
- [x] Messages provide GUIDANCE on what to do next
- [x] Consistent with local AI game error experience
- [x] All error scenarios covered (turn, combo, beat, one-card-left)
- [x] TypeScript type safety maintained
- [x] No breaking changes to existing error handling

---

## 🎯 Impact

**User Experience:**
- ✅ Clear understanding of why plays are rejected
- ✅ Actionable guidance (e.g., "Play higher cards or pass")
- ✅ Reduced confusion and frustration
- ✅ Faster learning curve for new players

**Code Quality:**
- ✅ Centralized error message mapping
- ✅ Easy to add new error types in the future
- ✅ Consistent error handling across multiplayer
- ✅ Maintainable and testable

---

## 🔮 Future Enhancements

1. **Localization:** Add i18n support for translated error messages
2. **Visual Indicators:** Highlight invalid cards with red borders
3. **Error History:** Show last 3 errors in a toast stack
4. **Hints:** Suggest valid plays when player makes repeated errors
5. **Tutorial Mode:** First-time players get extra detailed explanations

---

## 📚 Related Documentation

- [BUG_FIX_EDGE_FUNCTION_ERROR_HANDLING_JAN_1_2026.md](./BUG_FIX_EDGE_FUNCTION_ERROR_HANDLING_JAN_1_2026.md)
- [EDGE_FUNCTION_INTEGRATION_ANALYSIS_DEC_31_2025.md](./EDGE_FUNCTION_INTEGRATION_ANALYSIS_DEC_31_2025.md)
- Task #591: One Card Left Rule implementation

---

**Status:** ✅ **READY FOR TESTING**

Test in multiplayer game by attempting:
1. Play out of turn
2. First play without 3♦
3. Invalid card combinations
4. Playing single when last play was pair
5. Violating One Card Left Rule
