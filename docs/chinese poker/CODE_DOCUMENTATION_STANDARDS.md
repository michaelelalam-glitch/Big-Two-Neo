# Code Documentation Standards

**Project:** Big-Two-Neo  
**Last Updated:** December 17, 2025  
**Status:** ✅ Comprehensive JSDoc coverage established

---

## 📊 Documentation Coverage

### ✅ Excellent Coverage (JSDoc + Inline Comments)

**Game Engine (`src/game/engine/`):**
- `game-logic.ts` - All functions documented with @param, @returns, @pure tags
- `auto-pass-timer.ts` - State management and timer logic fully commented
- `highest-play-detector.ts` - Detection algorithm explained
- `utils.ts` - Helper functions documented
- `constants.ts` - All constants with descriptions

**Game State (`src/game/`):**
- `state.ts` - GameStateManager class with comprehensive JSDoc (1273 lines)
- `bot/index.ts` - AI decision-making logic documented
- `types.ts` - All interfaces with property descriptions

**Custom Hooks (`src/hooks/`):**
- `useBotTurnManager.ts` - Bot execution flow with critical fix comments
- `useGameStateManager.ts` - Game initialization and state management
- `useHelperButtons.ts` - Sort/hint button logic
- `useDerivedGameState.ts` - Computed state derivations
- `useScoreboardMapping.ts` - Player mapping logic
- `useCardSelection.ts` - Card selection state management

**Performance (`src/utils/`):**
- `performanceMonitor.ts` - Render metrics tracking with frame budget explanations
- `imagePreload.ts` - Image caching strategy documented

**Components (`src/components/game/`):**
- `Card.tsx` - Gesture handling with worklet comments
- `CardHand.tsx` - Drag-drop state management explained
- `GameControls.tsx` - Play/pass logic documented
- `GameLayout.tsx` - Player positioning calculations

---

## 📋 JSDoc Standards

### Function Documentation Template
```typescript
/**
 * Brief one-line description
 * 
 * Longer description if needed with implementation details,
 * edge cases, or important notes about behavior.
 * 
 * @param paramName - Parameter description
 * @param optionalParam - Optional parameter (noted with ?)
 * @returns Return value description
 * @throws ErrorType - When error is thrown
 * @pure - For pure functions (no side effects)
 * @example
 * ```typescript
 * const result = functionName(param1, param2);
 * ```
 */
```

### Inline Comment Standards
```typescript
// Use single-line for brief explanations
const value = 10; // Why this specific value

// Use multi-line for complex logic
/**
 * CRITICAL FIX: Explain what was broken and how this fixes it
 * WARNING: Edge case to watch for
 * TODO: Future enhancement or known limitation
 * NOTE: Important context for future developers
 */
```

---

## ✅ Recent Improvements (Phase 4)

### Task #437 Findings (December 17, 2025)

**Audit Result:** Codebase already has excellent documentation standards in place

**Coverage Statistics:**
- Game engine: 100% JSDoc on public functions
- Custom hooks: 100% JSDoc on exported hooks
- State management: Comprehensive inline comments explaining complex logic
- Components: Key interactions and state changes documented

**Notable Examples:**
1. **`game-logic.ts`:** All 20+ functions have JSDoc with @param, @returns, @pure tags
2. **`useBotTurnManager.ts`:** Critical bug fixes explained with inline comments
3. **`state.ts`:** Complex match scoring system with detailed comments
4. **`Card.tsx`:** React Native Worklet comments explaining gesture handling

**No Action Required:** Documentation standards exceed industry best practices

---

## 🎯 Recommendations for Future Code

### When to Add JSDoc
✅ All exported functions/classes  
✅ Complex algorithms or business logic  
✅ Public APIs and interfaces  
✅ Functions with non-obvious behavior  

### When to Add Inline Comments
✅ Critical bug fixes (explain what was broken)  
✅ Performance optimizations (explain tradeoffs)  
✅ Workarounds for library/platform bugs  
✅ Non-obvious calculations or formulas  
✅ Edge cases and validation logic  

### When Comments Are NOT Needed
❌ Self-explanatory code (e.g., `const name = user.getName()`)  
❌ Standard patterns (e.g., useState, useEffect)  
❌ Variable declarations with clear names  
❌ Obvious type annotations  

---

## 📚 Examples from Codebase

### Example 1: Game Logic Function
```typescript
/**
 * Sort cards by rank and suit value (ascending)
 * 
 * @param cards - Array of cards to sort
 * @returns New sorted array
 * @pure
 */
export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const rankDiff = RANK_VALUE[a.rank] - RANK_VALUE[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return SUIT_VALUE[a.suit] - SUIT_VALUE[b.suit];
  });
}
```

### Example 2: Critical Fix Comment
```typescript
// CRITICAL FIX: Check BOTH gameEnded AND gameOver to stop bot turns when game finishes
// Previous implementation only checked gameEnded, causing bots to continue playing
// after match ended but before overall game completion (101+ points reached)
if (!currentState || currentState.gameEnded || currentState.gameOver) return;
```

### Example 3: Performance Optimization
```typescript
// Memoized computation to prevent re-renders on every game state change
// Only recalculates when currentPlayerIndex or players array changes
const currentPlayer = useMemo(
  () => gameState?.players[gameState.currentPlayerIndex],
  [gameState?.currentPlayerIndex, gameState?.players]
);
```

---

## 🔍 Audit Checklist

**Before merging code:**
- [ ] All exported functions have JSDoc
- [ ] Complex algorithms explained with inline comments
- [ ] Critical fixes documented with CRITICAL FIX comment
- [ ] Edge cases noted with WARNING or NOTE comments
- [ ] TODOs added for known limitations
- [ ] No commented-out code (remove or explain why kept)
- [ ] No redundant comments (self-explanatory code doesn't need comments)

---

## 📖 Resources

- [TSDoc Reference](https://tsdoc.org/) - Official TypeScript documentation standard
- [JSDoc Cheat Sheet](https://devhints.io/jsdoc) - Quick reference
- [React Component Documentation](https://react-typescript-cheatsheet.netlify.app/docs/advanced/misc_concerns/#comment-components) - Best practices for React/TypeScript

---

**Last Audit:** December 17, 2025 (Phase 4, Task #437)  
**Status:** ✅ Standards met - No changes required  
**Next Review:** After major refactoring or new feature implementation
