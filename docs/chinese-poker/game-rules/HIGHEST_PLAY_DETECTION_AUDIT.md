# Highest Play Detection Logic — Comprehensive Audit

**Date:** March 2026  
**Module:** `apps/mobile/src/game/engine/highest-play-detector.ts` (711 lines)  
**Test Suite:** `apps/mobile/src/game/__tests__/highest-play-detector.test.ts` (389 lines)  
**Purpose:** Determines if a play is the highest possible (unbeatable) given cards already played. Triggers the 10-second auto-pass timer when an unbeatable play is made.

---

## Table of Contents

1. [Core Concept](#1-core-concept)
2. [Architecture](#2-architecture)
3. [Card Value Hierarchy](#3-card-value-hierarchy)
4. [Detection by Play Type](#4-detection-by-play-type)
   - [Singles](#41-singles)
   - [Pairs](#42-pairs)
   - [Triples](#43-triples)
   - [Five-Card Combos](#44-five-card-combos)
5. [Five-Card Combo Deep Dive](#5-five-card-combo-deep-dive)
   - [Straight Flush](#51-straight-flush)
   - [Four of a Kind](#52-four-of-a-kind)
   - [Full House](#53-full-house)
   - [Flush](#54-flush)
   - [Straight](#55-straight)
6. [Possibility Checkers](#6-possibility-checkers)
7. [Edge Cases & Known Behaviors](#7-edge-cases--known-behaviors)
8. [Test Coverage Summary](#8-test-coverage-summary)
9. [Potential Issues & Recommendations](#9-potential-issues--recommendations)

---

## 1. Core Concept

Detection is **DYNAMIC** — it considers all cards already played in the game. As the game progresses, plays that were not previously highest can become highest.

**Example flow:**
- Round 1: 2♠ is played → highest single (triggers timer)
- Round 3: Some cards played
- Round 5: 2♥ is played → NOW highest single (2♠ already gone) → triggers timer

**Key principle:** A play is "highest" if no combination of remaining cards (52 − played cards − current play cards) can beat it.

---

## 2. Architecture

```
isHighestPossiblePlay(cards, playedCards)
├── cards.length === 1 → isHighestRemainingSingle()
├── cards.length === 2 → isHighestRemainingPair()
├── cards.length === 3 → isHighestRemainingTriple()
└── cards.length === 5 → isHighestRemainingFiveCardCombo()
    ├── Step 1: Check if ANY stronger combo type can still be formed
    │   └── canFormComboOfStrength(strength, playedCards)
    │       ├── strength 8: canFormAnyStraightFlush()
    │       │   ├── canFormAnyRoyalFlush()
    │       │   └── canFormAnyNonRoyalStraightFlush()
    │       ├── strength 7: canFormAnyFourOfAKind()
    │       ├── strength 6: canFormAnyFullHouse()
    │       ├── strength 5: canFormAnyFlush()
    │       └── strength 4: canFormAnyStraight()
    └── Step 2: Check if this is the best of its type
```

### Helper Functions

| Function | Purpose |
|----------|---------|
| `generateFullDeck()` | Creates static 52-card deck (cached as `FULL_DECK`) |
| `getRemainingCards(playedCards)` | Returns 52 − played cards |
| `allSameRank(cards)` | Validates all cards share a rank |
| `cardsEqual(a, b)` | Compares cards by ID |
| `generateAllPairs(remaining)` | O(n) pair generation via rank grouping |
| `generateAllTriples(remaining)` | O(n) triple generation via rank grouping |

---

## 3. Card Value Hierarchy

### Rank Order (low → high)
```
3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2
```

### Suit Order (low → high)
```
♦ Diamonds (0) < ♣ Clubs (1) < ♥ Hearts (2) < ♠ Spades (3)
```

### Five-Card Combo Strength (low → high)
```
Straight (4) < Flush (5) < Full House (6) < Four of a Kind (7) < Straight Flush (8)
```

### Valid Straight Sequences (10 total)
```
A-2-3-4-5   (5-high, A is low)
2-3-4-5-6   (6-high, 2 is low)
3-4-5-6-7
4-5-6-7-8
5-6-7-8-9
6-7-8-9-10
7-8-9-10-J
8-9-10-J-Q
9-10-J-Q-K
10-J-Q-K-A  (A-high, highest)
```

**Note:** J-Q-K-A-2 is **INVALID** (no wrap-around).

---

## 4. Detection by Play Type

### 4.1 Singles

**Function:** `isHighestRemainingSingle(card, playedCards)`

**Algorithm:**
1. Get all remaining cards (52 − played)
2. Sort remaining cards
3. Compare played card to the last (highest) remaining card

**Comparison:** Uses `sortHand()` which sorts by rank value, then suit value. The highest card is the one with the highest rank, and among equal ranks, the highest suit.

**Examples:**
| State | Play | Result | Reason |
|-------|------|--------|--------|
| No cards played | 2♠ | ✅ Highest | 2♠ is absolute highest card |
| No cards played | 2♥ | ❌ Not highest | 2♠ still exists |
| 2♠ played | 2♥ | ✅ Highest | 2♠ gone, 2♥ is now highest |
| 2♠, 2♥ played | 2♣ | ✅ Highest | Only 2♣ and 2♦ remain of rank 2 |
| All 2s played | A♠ | ✅ Highest | A♠ is now highest card |

---

### 4.2 Pairs

**Function:** `isHighestRemainingPair(pair, playedCards)`

**Algorithm:**
1. Validate pair (2 cards, same rank)
2. Get remaining cards excluding played cards
3. Filter out cards in the current pair
4. Generate all possible pairs from filtered remaining cards
5. If no other pairs possible → highest
6. Sort other pairs by (rank value, highest suit)
7. Compare current pair to the strongest other pair

**Comparison rules:**
- Higher rank always wins
- Same rank: compare the higher-suit card in each pair

**Edge case:** When one of the pair's cards has already been played in a previous round but is included in `playedCards`, the remaining cards won't include it — this is handled correctly because `getRemainingCards` filters by `playedCards`, and the current pair's cards are additionally filtered out.

---

### 4.3 Triples

**Function:** `isHighestRemainingTriple(triple, playedCards)`

**Algorithm:**
1. Validate triple (3 cards, all same rank)
2. Get remaining cards excluding played and current triple
3. Generate all possible triples from remaining
4. If none possible → highest
5. Compare by rank only (no suit comparison for triples)

**Note:** Triple comparison uses rank-only ordering because three-of-a-kind in Big Two is compared solely by rank.

---

### 4.4 Five-Card Combos

**Function:** `isHighestRemainingFiveCardCombo(cards, type, playedCards)`

**Two-phase algorithm:**

#### Phase 1: Cross-Type Check
Check if ANY combo type **stronger** than the current one can still be formed from remaining cards.

```
Playing a Straight? → Can anyone still form a Flush, Full House, 4K, or SF?
Playing a Flush? → Can anyone still form a Full House, 4K, or SF?
...etc.
```

If yes → **not highest** (a stronger type beats any weaker type regardless of cards)

#### Phase 2: Same-Type Check
If no stronger type is possible, check if the current play is the strongest of its own type among remaining cards.

**Critical detail:** `playedCards` passed to this function includes the current play's cards (`[...playedCards, ...cards]`). This prevents the detector from thinking a stronger combo can be formed by re-using the just-played cards.

---

## 5. Five-Card Combo Deep Dive

### 5.1 Straight Flush

**Detection after Phase 1 (no stronger type possible — though SF is the strongest):**

1. Validate: all 5 cards same suit AND form a valid straight
2. Find current sequence index in `VALID_STRAIGHT_SEQUENCES`
3. For each suit, for each straight sequence:
   - Skip if sequence is lower AND (sequence is not same OR suit is not higher)
   - Check if all 5 cards of that sequence+suit exist in remaining
   - If yes → not highest (a beating SF exists)
4. If no beating SF found → **highest**

**Comparison rules for SF vs SF:**
- Higher sequence always wins (10-J-Q-K-A♦ beats 9-10-J-Q-K♠)
- Same sequence: higher suit wins (A-2-3-4-5♠ beats A-2-3-4-5♥)

**Royal Flush:** Simply the 10-J-Q-K-A straight flush in any suit. No special handling needed — it's just the highest straight sequence.

---

### 5.2 Four of a Kind

**Detection after Phase 1 (no SF possible):**

1. Find the highest quad rank still formable from remaining cards (excluding current play)
2. If no quad formable → **highest** (any 4K is unbeatable)
3. Find the quad rank in the current play
4. Compare: current quad rank ≥ highest remaining quad rank → **highest**

**Note:** The 5th card (kicker) is irrelevant for 4K comparison in Big Two. Only the quad's rank matters.

---

### 5.3 Full House

**Detection after Phase 1 (no SF or 4K possible):**

1. Count remaining cards by rank
2. Find the highest rank with ≥ 3 cards (highest possible triple)
3. Find the highest rank (different from triple rank) with ≥ 2 cards (pair)
4. If no triple or no pair formable → **highest**
5. Find the triple rank in the played Full House
6. Compare: played triple rank ≥ highest remaining triple rank → **highest**

**Comparison rule:** Full Houses are compared by **triple rank only**. The pair rank is irrelevant. A Full House of 2-2-2-3-3 beats K-K-K-A-A.

---

### 5.4 Flush

**Detection after Phase 1 (no SF, 4K, or FH possible):**

1. Validate: all 5 cards same suit
2. Calculate current flush's highest card value: `RANK_VALUE × 10 + SUIT_VALUE`
3. For each suit, check if 5+ remaining cards exist in that suit
4. If yes, find that suit's best flush (highest card)
5. Compare highest card values
6. If any other flush has a higher best card → not highest

**Comparison rule:** Flushes are compared by their **highest card** using the composite value `RANK_VALUE × 10 + SUIT_VALUE`. This means a flush with 2♦ as highest beats one with A♠ as highest (rank 2 > rank A).

---

### 5.5 Straight

**Detection after Phase 1 (no SF, 4K, FH, or Flush possible):**

1. Validate: cards form a valid straight via `isStraight()`
2. Find current sequence index
3. Check if any **higher sequence** can still be formed from remaining
4. If yes → not highest
5. If no higher sequence possible, check same-sequence straights:
   - Generate ALL possible straights of the same sequence from remaining cards (recursive)
   - Find the one with the highest suit on its highest card
   - Compare suit values
6. Current play's highest card suit ≥ best remaining → **highest**

**Comparison rules for straights:**
- Higher sequence always wins (10-J-Q-K-A beats 9-10-J-Q-K)
- Same sequence: compare highest card's suit

**Performance note:** The recursive generation of same-sequence straights has exponential worst case (4^5 = 1024 combinations), but in practice this is bounded by the ~30-40 remaining cards at most.

---

## 6. Possibility Checkers

These functions check whether ANY combo of a given type can be formed from remaining cards. They are used in Phase 1 of five-card combo detection.

| Checker | Logic |
|---------|-------|
| `canFormAnyRoyalFlush` | For each suit: check if 10, J, Q, K, A all remain |
| `canFormAnyNonRoyalStraightFlush` | For each suit × each non-royal sequence: check all 5 ranks |
| `canFormAnyStraightFlush` | Royal OR non-royal check |
| `canFormAnyFourOfAKind` | Need any rank with 4+ remaining AND total ≥ 5 |
| `canFormAnyFullHouse` | Need rank with 3+ AND **different** rank with 2+ AND total ≥ 5 |
| `canFormAnyFlush` | Need any suit with 5+ remaining |
| `canFormAnyStraight` | For each valid sequence: check if at least 1 card of each rank remains |

### Full House Possibility — Important Detail

`canFormAnyFullHouse` correctly requires the pair rank to be **different** from the triple rank. A rank with 4 or 5 remaining cards can serve as the triple, but the pair must come from a different rank. This prevents false positives where, e.g., 4 cards of rank K remain but no other pairs exist.

---

## 7. Edge Cases & Known Behaviors

### Edge Case 1: Current Play Cards Are Excluded

When checking five-card combos, the current play's cards are added to `playedCards`:
```typescript
return isHighestRemainingFiveCardCombo(sorted, type, [...playedCards, ...cards]);
```
This prevents the remaining-cards pool from including the just-played cards, which would cause false negatives (thinking a combo can be formed that actually uses the just-played cards).

### Edge Case 2: "Remaining" vs "Not In Current Play"

For pairs and triples, the code correctly uses two-level filtering:
1. `getRemainingCards(playedCards)` — excludes already-played cards
2. `.filter(c => !pair.some(p => p.id === c.id))` — also excludes current play

This double-filter is essential: it prevents the detector from thinking the current pair/triple's own cards are "available" to form a beating combination.

### Edge Case 3: Dynamic 2♠ Detection

2♠ is the highest single card. But if 2♠ is played in round 1, then in round 5 2♥ becomes highest. The system handles this naturally because `getRemainingCards` always reflects the current game state.

### Edge Case 4: Broken Straight Flushes

Even with just 4 cards played, all 4 royal flushes can become impossible (e.g., playing 10♥, J♣, Q♠, K♦ breaks all 4 suits' royal flush potential). The possibility checkers handle this correctly.

### Edge Case 5: Four-of-a-Kind Rank Comparison

The four-of-a-kind detector uses `>=` comparison against the highest remaining quad rank. Since the current play's cards are excluded from remaining, the highest remaining quad may be a lower rank — this is correct behavior.

### Edge Case 6: Same-Sequence Straights

When comparing straights of the same sequence, all possible suit combinations are generated recursively. The comparison is by the **highest card's suit only** (not all cards' suits).

### Edge Case 7: Flush Cross-Suit Comparison

A flush check looks across ALL suits, not just the current flush's suit. A ♠ flush with highest card K♠ can be beaten by a ♥ flush with highest card 2♥ (rank 2 > rank K).

### Edge Case 8: Empty Remaining Cards

When `remaining.length === 0` after filtering, the singles detector returns `false`. For pairs/triples, `generateAllPairs/Triples` returns empty → `true` (no other combos possible = highest).

---

## 8. Test Coverage Summary

The test file covers **7 categories** with ~30+ test cases:

### Singles (6 tests)
- ✅ 2♠ highest when no cards played
- ✅ 2♥ NOT highest when 2♠ exists
- ✅ 2♥ highest AFTER 2♠ played
- ✅ 2♣ highest after 2♠ + 2♥ played
- ✅ 2♦ highest after all other 2s played
- ✅ A♠ highest after ALL 2s played

### Pairs (5 tests)
- ✅ Pair of 2s with ♠ is highest
- ✅ Pair of As NOT highest (2s exist)
- ✅ Pair of 2♣-2♦ highest dynamically after 2♠ played
- ✅ Pair of As highest after all 2 pairs broken
- ✅ Non-pair returns false

### Triples (4 tests)
- ✅ Triple 2s highest with no cards played
- ✅ Triple As NOT highest (2s exist)
- ✅ Triple As highest after 2s broken
- ✅ Non-triple returns false

### Five-Card Combos: Straight (3 tests)
- ✅ 10-J-Q-K-A straight highest when no higher possible
- ✅ Lower straight NOT highest (higher sequence exists)
- ✅ Higher sequence detection across suits

### Five-Card Combos: Flush (2 tests)
- ✅ ♠ flush with 2♠ as highest card
- ✅ Lower flush not highest when stronger exists

### Five-Card Combos: Full House (3 tests)
- ✅ Full house with triple 2s
- ✅ Lower full house not highest
- ✅ Full house comparison by triple rank only

### Five-Card Combos: Four of a Kind (3 tests)
- ✅ Four 2s is highest
- ✅ Lower 4K not highest
- ✅ 4K IS highest when no straight flush possible

### Five-Card Combos: Straight Flush (3 tests)
- ✅ Royal flush (10-J-Q-K-A♠) is highest
- ✅ Lower SF not highest when higher SF exists
- ✅ SF detection across different suits

### Cross-Type Combo Tests (3 tests)
- ✅ 4K NOT highest when SF still possible
- ✅ Full house NOT highest when 4K still possible
- ✅ Flush NOT highest when FH still possible

---

## 9. Potential Issues & Recommendations

### Issue 1: Straight Same-Sequence Performance
The recursive `generateStraightsRecursive` function can generate up to $4^5 = 1024$ combinations for a same-sequence check. While bounded in practice (remaining cards decrease), this could be optimized by only tracking the highest-suit card at the highest rank position:

```
Optimization: For same-sequence straights, only compare the HIGHEST CARD's SUIT.
Skip generating all combinations — just find the highest suit available for the
highest rank in the sequence among remaining cards.
```

### Issue 2: Flush Same-Suit Optimization
The flush check iterates through ALL suits even if only checking same-suit flushes would suffice. However, cross-suit comparison is correct for Big Two rules, so this is not a bug — just a potential area for early termination.

### Issue 3: No Four-Card Play Detection
The detector returns `false` for `cards.length === 4`. This is correct — Big Two does not have 4-card plays. But it silently ignores invalid play sizes rather than throwing.

### Issue 4: Dependency on `classifyCards` Accuracy
The five-card combo detection relies on `classifyCards(cards)` to correctly identify the combo type. If `classifyCards` misidentifies a combo (e.g., calls a straight flush just a "flush"), the wrong detection path executes. This dependency is well-tested but worth noting.

### Issue 5: Full House Pair Rank Ignored
The Full House detector only compares triple ranks, ignoring pair ranks entirely. This matches Big Two rules but could surprise players from other card games where the pair is a tiebreaker. No code change needed, but could be documented in-game.

---

## Summary

The highest-play detection module is well-structured with:
- **Dynamic state tracking** via `playedCards` parameter
- **Correct two-phase five-card evaluation** (cross-type then same-type)
- **Proper card exclusion** to prevent false negatives
- **Comprehensive test suite** covering all play types and dynamic scenarios

The implementation correctly handles all Big Two combo types and their comparison rules, with the critical auto-pass timer triggering only when a play is truly unbeatable given the current game state.
