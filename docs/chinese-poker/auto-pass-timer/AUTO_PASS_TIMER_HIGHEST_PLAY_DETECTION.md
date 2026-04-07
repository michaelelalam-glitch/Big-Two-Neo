# Auto-Pass Timer: Highest Play Detection Algorithm Design

**Date:** December 11, 2025  
**Task:** #340 - Research and design highest play detection algorithm  
**Project:** Big Two Neo

## Overview

The auto-pass timer should activate when a player plays the **highest possible card/combo** that cannot be beaten **given the current game state** (cards already played). This gives other players 10 seconds to manually pass before auto-passing them.

## CRITICAL CONCEPT: Dynamic Detection

**The "highest possible play" changes as cards are played!**

Example scenario:
- **Round 1:** Player A plays `2♠` → Auto-pass timer starts (highest single)
- **Round 3:** `2♠` was played earlier, now Player B plays `2♥` → Auto-pass timer starts **AGAIN** (now highest remaining single)
- **Round 7:** Both `2♠` and `2♥` are gone, Player C plays `2♣` → Auto-pass timer starts (now highest)

**Key Insight:** The algorithm must track `playedCards` and determine what's still possible to play.

## Big Two Card/Combo Hierarchy

### Card Ranking (Highest to Lowest)
```
2 > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3
```

### Suit Ranking (Highest to Lowest)
```
♠ (Spades) > ♥ (Hearts) > ♣ (Clubs) > ♦ (Diamonds)
```

### Five-Card Combo Strength (Highest to Lowest)
```
Straight Flush (8) > Four of a Kind (7) > Full House (6) > Flush (5) > Straight (4)
```

---

## Highest Possible Plays by Combo Type (CORRECTED)

### 1. SINGLE
**Highest REMAINING:** Check all played 2s, find the highest unplayed 2
```
If 2♠ not played → 2♠ triggers timer
Else if 2♥ not played → 2♥ triggers timer
Else if 2♣ not played → 2♣ triggers timer
Else if 2♦ not played → 2♦ triggers timer
Else check remaining Aces (A♠, A♥, A♣, A♦) and so on...
```

**Algorithm:**
```typescript
function getHighestRemainingCard(playedCards: Card[]): Card {
  const allCards = generateFullDeck(); // 52 cards
  const remaining = allCards.filter(c => 
    !playedCards.some(p => p.id === c.id)
  );
  return sortHand(remaining)[remaining.length - 1]; // Highest
}

function isHighestSingle(card: Card, playedCards: Card[]): boolean {
  const highestRemaining = getHighestRemainingCard(playedCards);
  return card.id === highestRemaining.id;
}
```

### 2. PAIR
**Highest REMAINING:** Check all possible pairs in descending order
```
Priority order:
1. 2♥-2♠ (if both unplayed)
2. 2♦-2♠ (if both unplayed)
3. 2♣-2♠ (if both unplayed)
4. 2♣-2♥ (if both unplayed)
5. 2♦-2♥ (if both unplayed)
6. 2♦-2♣ (if both unplayed)
7. Then check Ace pairs (A♥-A♠, etc.)
8. Continue down ranks...
```

**Algorithm:**
```typescript
function isHighestPair(pair: Card[], playedCards: Card[]): boolean {
  const allPairs = generateAllPossiblePairs();
  const remainingPairs = allPairs.filter(p => 
    canFormPair(p, playedCards) // Both cards not played
  );
  const sorted = sortPairsByStrength(remainingPairs);
  const highestPair = sorted[sorted.length - 1];
  
  return pairsAreEqual(pair, highestPair);
}
```

### 3. TRIPLE
**Highest REMAINING:** Check if triple of 2s, Aces, Kings... is still possible
```
If 3+ twos remain unplayed → Triple 2s triggers timer
Else if 3+ Aces remain → Triple Aces triggers timer
Else if 3+ Kings remain → Triple Kings triggers timer
...
```

### 4-8. FIVE-CARD COMBOS (CRITICAL CORRECTION)

**The highest 5-card combo is CONDITIONAL on what's still possible:**

#### Hierarchy (Check in this order):
1. **Straight Flush (Royal):** `10♠-J♠-Q♠-K♠-A♠`
2. **Straight Flush (Non-Royal):** Next best straight flush still possible
3. **Four of a Kind:** Four 2s, then four Aces, etc.
4. **Full House:** Triple 2s + pair, then triple Aces + pair, etc.
5. **Flush:** Best flush still possible
6. **Straight:** Best straight still possible

**Algorithm:**
```typescript
function isHighestFiveCardCombo(
  cards: Card[], 
  playedCards: Card[]
): boolean {
  const comboType = classifyCards(cards);
  const comboStrength = getComboStrength(comboType);
  
  // Check if any STRONGER combo type is still possible
  for (let str = 8; str > comboStrength; str--) {
    if (canStillFormComboType(str, playedCards)) {
      return false; // A stronger combo exists, this isn't highest
    }
  }
  
  // Same strength - check if this is the best of this type
  const allPossibleCombos = generatePossibleCombos(
    comboType, 
    playedCards
  );
  const strongest = sortByStrength(allPossibleCombos)[allPossibleCombos.length - 1];
  
  return combosAreEqual(cards, strongest);
}
```

**Example Scenario:**
```
Played cards: [10♠, J♠, Q♠, K♠, A♠] (Royal Flush already played)

Next play: Player plays [10♥-J♥-Q♥-K♥-A♥] (Royal Flush in Hearts)
→ Auto-pass timer TRIGGERS (this is now highest remaining straight flush)

Later: Player plays [2♣-2♦-2♥-2♠-3♣] (Four of a Kind with 2s)
→ Check: Can any straight flush still be formed?
→ Answer: Yes! [10♣-J♣-Q♣-K♣-A♣] and [10♦-J♦-Q♦-K♦-A♦] still possible
→ DO NOT trigger timer (straight flush is stronger)
```

---

## Algorithm Design (CORRECTED)

### Function Signature
```typescript
/**
 * Determine if a play is the highest possible play that cannot be beaten
 * given the current game state (cards already played)
 * 
 * @param cards - The cards being played
 * @param playedCards - All cards that have been played so far this game
 * @returns True if this is the highest remaining possible play
 */
function isHighestPossiblePlay(
  cards: Card[], 
  playedCards: Card[]
): boolean
```

### Core Implementation Logic

```typescript
export function isHighestPossiblePlay(
  cards: Card[], 
  playedCards: Card[]
): boolean {
  if (!cards || cards.length === 0) return false;

  const sorted = sortHand(cards);
  const type = classifyCards(cards);
  
  switch (cards.length) {
    case 1: // Single
      return isHighestRemainingSingle(sorted[0], playedCards);
    
    case 2: // Pair
      return isHighestRemainingPair(sorted, playedCards);
    
    case 3: // Triple
      return isHighestRemainingTriple(sorted, playedCards);
    
    case 5: // Five-card combos
      return isHighestRemainingFiveCardCombo(sorted, type, playedCards);
    
    default:
      return false;
  }
}

// ============================================
// SINGLES
// ============================================
function isHighestRemainingSingle(
  card: Card, 
  playedCards: Card[]
): boolean {
  // Get all 52 cards, filter out played ones
  const allCards = FULL_DECK; // Constant from game
  const remainingCards = allCards.filter(c => 
    !playedCards.some(p => p.id === c.id)
  );
  
  // Sort by strength, get highest
  const sorted = sortHand(remainingCards);
  const highestRemaining = sorted[sorted.length - 1];
  
  return card.id === highestRemaining.id;
}

// ============================================
// PAIRS
// ============================================
function isHighestRemainingPair(
  pair: Card[], 
  playedCards: Card[]
): boolean {
  if (pair.length !== 2 || pair[0].rank !== pair[1].rank) {
    return false;
  }
  
  // Generate all possible pairs from remaining cards
  const remainingCards = getRemainingCards(playedCards);
  const possiblePairs = generateAllPairsFromCards(remainingCards);
  
  if (possiblePairs.length === 0) return false;
  
  // Sort pairs by strength
  const sorted = sortPairsByStrength(possiblePairs);
  const highestPair = sorted[sorted.length - 1];
  
  // Check if current pair equals highest
  return pairsAreEqual(pair, highestPair);
}

// ============================================
// TRIPLES
// ============================================
function isHighestRemainingTriple(
  triple: Card[], 
  playedCards: Card[]
): boolean {
  if (triple.length !== 3 || !allSameRank(triple)) {
    return false;
  }
  
  const remainingCards = getRemainingCards(playedCards);
  const possibleTriples = generateAllTriplesFromCards(remainingCards);
  
  if (possibleTriples.length === 0) return false;
  
  // Sort by rank (2 > A > K > ...)
  const sorted = sortTriplesByStrength(possibleTriples);
  const highestTriple = sorted[sorted.length - 1];
  
  return triple[0].rank === highestTriple[0].rank;
}

// ============================================
// FIVE-CARD COMBOS (CRITICAL)
// ============================================
function isHighestRemainingFiveCardCombo(
  cards: Card[],
  type: ComboType,
  playedCards: Card[]
): boolean {
  const currentStrength = COMBO_STRENGTH[type]; // e.g., Straight = 4
  
  // Check if any STRONGER combo type can still be formed
  for (let strength = 8; strength > currentStrength; strength--) {
    if (canFormComboOfStrength(strength, playedCards)) {
      return false; // Stronger combo still possible
    }
  }
  
  // Same strength - is this the best of this type?
  const remainingCards = getRemainingCards(playedCards);
  const allPossibleCombos = generateCombosOfType(type, remainingCards);
  
  if (allPossibleCombos.length === 0) return false;
  
  const sorted = sortCombosByStrength(allPossibleCombos);
  const strongest = sorted[sorted.length - 1];
  
  return combosAreEqual(cards, strongest);
}

// ============================================
// HELPER: Check if combo type can be formed
// ============================================
function canFormComboOfStrength(
  strength: number, 
  playedCards: Card[]
): boolean {
  const remainingCards = getRemainingCards(playedCards);
  
  switch (strength) {
    case 8: // Straight Flush (including Royal)
      return canFormAnyStraightFlush(remainingCards);
    case 7: // Four of a Kind
      return canFormAnyFourOfAKind(remainingCards);
    case 6: // Full House
      return canFormAnyFullHouse(remainingCards);
    case 5: // Flush
      return canFormAnyFlush(remainingCards);
    case 4: // Straight
      return canFormAnyStraight(remainingCards);
    default:
      return false;
  }
}

// ============================================
// Specific combo possibility checks
// ============================================

function canFormAnyStraightFlush(remaining: Card[]): boolean {
  // Check all 4 royal flushes first (highest straight flushes)
  const royals = [
    ['10S', 'JS', 'QS', 'KS', 'AS'],
    ['10H', 'JH', 'QH', 'KH', 'AH'],
    ['10C', 'JC', 'QC', 'KC', 'AC'],
    ['10D', 'JD', 'QD', 'KD', 'AD']
  ];
  
  // If ANY royal can be formed, return true
  for (const royal of royals) {
    if (royal.every(id => remaining.some(c => c.id === id))) {
      return true;
    }
  }
  
  // Check all other straight flush possibilities
  // (9-high, 8-high, etc. in all suits)
  const straightSeqs = [
    ['9', '10', 'J', 'Q', 'K'],
    ['8', '9', '10', 'J', 'Q'],
    ['7', '8', '9', '10', 'J'],
    // ... all valid sequences down to 3-4-5-6-7
  ];
  
  const suits = ['S', 'H', 'C', 'D'];
  
  for (const seq of straightSeqs) {
    for (const suit of suits) {
      const ids = seq.map(rank => rank + suit);
      if (ids.every(id => remaining.some(c => c.id === id))) {
        return true;
      }
    }
  }
  
  return false;
}

function canFormAnyFourOfAKind(remaining: Card[]): boolean {
  // Check if any rank has 4+ cards remaining
  const ranks = ['2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3'];
  
  for (const rank of ranks) {
    const count = remaining.filter(c => c.rank === rank).length;
    if (count >= 4) {
      // Also need a 5th card (kicker) - check if any other card exists
      if (remaining.length >= 5) {
        return true;
      }
    }
  }
  
  return false;
}

function canFormAnyFullHouse(remaining: Card[]): boolean {
  // Need at least 5 cards
  if (remaining.length < 5) return false;
  
  const rankCounts = new Map<string, number>();
  
  for (const card of remaining) {
    rankCounts.set(card.rank, (rankCounts.get(card.rank) || 0) + 1);
  }
  
  // Check if we can form triple + pair
  let hasTriple = false;
  let hasPair = false;
  
  for (const count of rankCounts.values()) {
    if (count >= 3) hasTriple = true;
    if (count >= 2) hasPair = true;
  }
  
  // Need both triple and pair (can be from same rank if 5 of a kind exists)
  return hasTriple && (hasPair || rankCounts.size >= 2);
}

function canFormAnyFlush(remaining: Card[]): boolean {
  // Check if any suit has 5+ cards
  const suits = ['S', 'H', 'C', 'D'];
  
  for (const suit of suits) {
    const count = remaining.filter(c => c.suit === suit).length;
    if (count >= 5) return true;
  }
  
  return false;
}

function canFormAnyStraight(remaining: Card[]): boolean {
  // Generate all possible straight sequences
  const sequences = [
    ['A', '2', '3', '4', '5'],    // 5-high (A can be low)
    ['2', '3', '4', '5', '6'],
    ['3', '4', '5', '6', '7'],
    ['4', '5', '6', '7', '8'],
    ['5', '6', '7', '8', '9'],
    ['6', '7', '8', '9', '10'],
    ['7', '8', '9', '10', 'J'],
    ['8', '9', '10', 'J', 'Q'],
    ['9', '10', 'J', 'Q', 'K'],
    ['10', 'J', 'Q', 'K', 'A']    // A-high
  ];
  
  for (const seq of sequences) {
    // Check if we have at least one card of each rank in sequence
    const hasAll = seq.every(rank => 
      remaining.some(c => c.rank === rank)
    );
    if (hasAll) return true;
  }
  
  return false;
}

// ============================================
// HELPER: Get remaining cards
// ============================================
function getRemainingCards(playedCards: Card[]): Card[] {
  return FULL_DECK.filter(c => 
    !playedCards.some(p => p.id === c.id)
  );
}
```

---

## Edge Cases & Considerations (UPDATED)

### 1. Dynamic "Unbeatable" Scenarios
✅ **Correct behavior:**
- Round 1: `2♠` played → Timer triggers (highest single)
- Round 5: `2♥` played → Timer triggers **AGAIN** (now highest)
- Round 8: `2♣` played → Timer triggers **AGAIN** (now highest)

### 2. Five-Card Conditional Logic (CORRECTED)
✅ **Check if combo type is POSSIBLE, not if all instances are played:**

**Example 1: Early game destruction**
```
Played cards: [10♥, J♣, Q♠, K♦] (just 4 random cards)

Check Royal Flush Spades: Need 10♠,J♠,Q♠,K♠,A♠ → Q♠ played ❌
Check Royal Flush Hearts: Need 10♥,J♥,Q♥,K♥,A♥ → 10♥ played ❌
Check Royal Flush Clubs: Need 10♣,J♣,Q♣,K♣,A♣ → J♣ played ❌
Check Royal Flush Diamonds: Need 10♦,J♦,Q♦,K♦,A♦ → K♦ played ❌

Result: NO royal flush possible (all 4 broken)
→ Straight Flush is now highest 5-card combo type!
```

**Example 2: Someone plays Four of a Kind**
```
Played cards: [10♥, J♣, Q♠, K♦, ...others]

Current Play: Four 2s [2♣-2♦-2♥-2♠-3♣]

Check: Can ANY royal flush be formed?
→ ALL 4 royal flushes broken (per Example 1)
→ NO ❌

Check: Can ANY straight flush be formed?
→ Check 9♠-K♠ straight flush: All cards available? → YES ✅
→ At least ONE straight flush possible

Result: DO NOT trigger (Straight Flush > Four of a Kind)
```

**Example 3: All straight flushes broken**
```
Played cards: [...many cards including key straight flush blockers]

Current Play: Four 2s [2♣-2♦-2♥-2♠-3♣]

Check: Can ANY royal flush be formed? → NO
Check: Can ANY straight flush (non-royal) be formed? → NO
Check: Can ANY four of a kind be formed? → YES (this IS four of a kind)

Result: ✅ TRIGGER TIMER (Four of a Kind is now highest possible!)
```

**Key Algorithm Change:**
```typescript
// OLD (Wrong): Wait until all instances played
if (allRoyalFlushesPlayed) { /* next tier */ }

// NEW (Correct): Check if ANY instance is still possible
if (!canFormAnyRoyalFlush(remainingCards)) { /* next tier */ }
```

### 3. Performance with Card Tracking
- Game must maintain `playedCards[]` array
- Updated after every successful play
- Passed to `isHighestPossiblePlay()` function
- Consider caching "remaining cards" to avoid filtering on every check

### 4. Initial Game State
- At start: `playedCards = []`
- All 52 cards available
- Only absolute highest triggers: `2♠`, `2♥-2♠`, triple 2s, Royal Flush Spades

---

## Integration Points (UPDATED)

### Backend (Server)
```typescript
// In game-logic.ts
import { isHighestPossiblePlay } from './highest-play-detector';

// Game state must track played cards
interface GameState {
  playedCards: Card[];  // ← NEW: All cards played this game
  // ... existing fields
}

// After validating a play
const isHighest = isHighestPossiblePlay(
  playedCards, 
  gameState.playedCards  // ← Pass current game state
);

if (isHighest) {
  // Trigger auto-pass timer for remaining players
  startAutoPassTimer(roomCode, currentPlayerId);
}

// Update played cards AFTER processing
gameState.playedCards.push(...playedCards);
```

### Data Flow
```
1. Player submits play → Validate play
2. Check: isHighestPossiblePlay(play, gameState.playedCards)
3. If true → Start auto-pass timer (10s countdown)
4. Add play to gameState.playedCards
5. Broadcast game state update to all players
```

### Testing Strategy (UPDATED)
```typescript
describe('isHighestPossiblePlay', () => {
  it('detects 2♠ as highest single when no cards played', () => {
    const playedCards: Card[] = [];
    expect(isHighestPossiblePlay([{id:'2S', rank:'2', suit:'S'}], playedCards)).toBe(true);
    expect(isHighestPossiblePlay([{id:'2H', rank:'2', suit:'H'}], playedCards)).toBe(false);
  });
  
  it('detects 2♥ as highest single AFTER 2♠ is played', () => {
    const playedCards: Card[] = [{id:'2S', rank:'2', suit:'S'}];
    expect(isHighestPossiblePlay([{id:'2H', rank:'2', suit:'H'}], playedCards)).toBe(true);
    expect(isHighestPossiblePlay([{id:'2C', rank:'2', suit:'C'}], playedCards)).toBe(false);
  });
  
  it('detects 2♣ as highest single AFTER 2♠ and 2♥ played', () => {
    const playedCards: Card[] = [
      {id:'2S', rank:'2', suit:'S'},
      {id:'2H', rank:'2', suit:'H'}
    ];
    expect(isHighestPossiblePlay([{id:'2C', rank:'2', suit:'C'}], playedCards)).toBe(true);
  });
  
  it('does NOT trigger for four of a kind if royal flush still possible', () => {
    const playedCards: Card[] = []; // No cards played yet
    const fourTwos = [
      {id:'2S', rank:'2', suit:'S'},
      {id:'2H', rank:'2', suit:'H'},
      {id:'2C', rank:'2', suit:'C'},
      {id:'2D', rank:'2', suit:'D'},
      {id:'3C', rank:'3', suit:'C'}
    ];
    
    // Royal flush still possible, so four of a kind is NOT highest
    expect(isHighestPossiblePlay(fourTwos, playedCards)).toBe(false);
  });
  
  it('DOES trigger for four 2s when NO royal/straight flush possible', () => {
    // Break all 4 royal flushes with minimal cards
    const playedCards: Card[] = [
      {id:'10H', rank:'10', suit:'H'},  // Breaks Royal Hearts
      {id:'JC', rank:'J', suit:'C'},    // Breaks Royal Clubs
      {id:'QS', rank:'Q', suit:'S'},    // Breaks Royal Spades
      {id:'KD', rank:'K', suit:'D'},    // Breaks Royal Diamonds
      // Also break all other straight flushes (simplified for test)
      {id:'9H', rank:'9', suit:'H'},
      {id:'9C', rank:'9', suit:'C'},
      {id:'9S', rank:'9', suit:'S'},
      {id:'9D', rank:'9', suit:'D'}
    ];
    
    const fourTwos = [
      {id:'2S', rank:'2', suit:'S'},
      {id:'2H', rank:'2', suit:'H'},
      {id:'2C', rank:'2', suit:'C'},
      {id:'2D', rank:'2', suit:'D'},
      {id:'3C', rank:'3', suit:'C'}
    ];
    
    // No straight flush possible, four of a kind IS highest
    expect(isHighestPossiblePlay(fourTwos, playedCards)).toBe(true);
  });
  
  it('triggers for royal flush when it is highest remaining straight flush', () => {
    const playedCards: Card[] = [
      // Break 3 of the 4 royal flushes
      {id:'10S', rank:'10', suit:'S'},  // Breaks Royal Spades
      {id:'JH', rank:'J', suit:'H'},    // Breaks Royal Hearts
      {id:'QC', rank:'Q', suit:'C'}     // Breaks Royal Clubs
      // Royal Diamonds still possible!
    ];
    
    const royalDiamonds = [
      {id:'10D', rank:'10', suit:'D'},
      {id:'JD', rank:'J', suit:'D'},
      {id:'QD', rank:'Q', suit:'D'},
      {id:'KD', rank:'K', suit:'D'},
      {id:'AD', rank:'A', suit:'D'}
    ];
    
    // This is the highest remaining straight flush - should trigger!
    expect(isHighestPossiblePlay(royalDiamonds, playedCards)).toBe(true);
  });
  
  it('detects when straight flush 9-K becomes highest after royals broken', () => {
    const playedCards: Card[] = [
      // Break ALL royal flushes
      {id:'10S', rank:'10', suit:'S'},
      {id:'JH', rank:'J', suit:'H'},
      {id:'QC', rank:'Q', suit:'C'},
      {id:'KD', rank:'K', suit:'D'}
    ];
    
    const straightFlush9High = [
      {id:'9S', rank:'9', suit:'S'},
      {id:'10H', rank:'10', suit:'H'},  // 10S is played, use 10H
      {id:'JC', rank:'J', suit:'C'},
      {id:'QS', rank:'Q', suit:'S'},    // QC is played, use QS  
      {id:'KS', rank:'K', suit:'S'}
    ];
    
    // Note: This is NOT a valid straight flush (mixed suits)
    // Better test: Check if 9♠-K♠ straight flush is highest
    const validSF = [
      {id:'9D', rank:'9', suit:'D'},
      {id:'10D', rank:'10', suit:'D'},
      {id:'JD', rank:'J', suit:'D'},
      {id:'QD', rank:'Q', suit:'D'},
      {id:'KD', rank:'K', suit:'D'}  // KD is played, so this won't work
    ];
    
    // Need to check highest POSSIBLE straight flush
    // If this is the best one formable, trigger
    // Implementation detail: depends on remaining cards
  });
});
```

---

## Implementation Files

### New File: `/apps/mobile/src/game/engine/highest-play-detector.ts`
Contains:
- `isHighestPossiblePlay(cards: Card[]): boolean` - Main function
- Helper functions for each combo type
- Full test suite

### Modified File: `/apps/mobile/src/game/engine/game-logic.ts`
Import and use `isHighestPossiblePlay()` after validating plays.

---

## Next Steps (Task #339)
1. Implement `highest-play-detector.ts` with all helper functions
2. Write comprehensive unit tests
3. Integrate into existing game logic
4. Verify with edge cases

---

## References
- [Big Two Wikipedia](https://en.wikipedia.org/wiki/Big_two)
- Existing constants: `/apps/mobile/src/game/engine/constants.ts`
- Existing game logic: `/apps/mobile/src/game/engine/game-logic.ts`
- Scoring system: `/docs/SCORING_SYSTEM.md`
