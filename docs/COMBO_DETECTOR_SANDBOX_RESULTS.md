# Combo Detector Sandbox — Test Results

**Date:** April 16, 2026  
**Branch:** `game/chinese-poker`  
**Test file:** `apps/mobile/src/game/__tests__/combo-detector-sandbox.test.ts`  
**Result:** ✅ **108 / 108 PASSED** — no false positives or false negatives detected

---

## Background

The user reported seeing false positives (the auto-pass timer triggering on plays that are NOT actually unbeatable) as evidenced by three in-game screenshots:

| Screenshot | Match | Reported Suspicious Plays |
|-----------|-------|--------------------------|
| Match 1 | Straight Flush K-Q-J-10-9♠ shown as "highest" | Bot 3 SF then Steve Straight 7-6-5-4-3 |
| Match 2 | Flush A-K-Q-J-3♠ and Four of a Kind (5555+3) | SF 10-9-8-7-6♠ → 4K → FH → Flush |
| Match 3 | Full House 222+66 and Flush AKQJ3♥ in context | Various combos flagged suspiciously |

The goal of this sandbox was to run an **exhaustive test of every combo type** under every relevant game state condition.

---

## Methods

### Files Under Test

| File | Purpose |
|------|---------|
| `src/game/engine/highest-play-detector.ts` | Main detector: `isHighestPossiblePlay()` |
| `src/game/engine/game-logic.ts` | Combo classifier: `classifyCards()`, `canBeatPlay()` |
| `src/game/engine/constants.ts` | Game constants: `RANK_VALUE`, `SUIT_VALUE`, `VALID_STRAIGHT_SEQUENCES`, `COMBO_STRENGTH` |

### Testing Strategy

Each section tests one combo type exhaustively across multiple game-state scenarios:

1. **Baseline:** Is the play correctly identified as highest/not-highest with an empty board?
2. **Progression:** Does the answer change correctly as cards are progressively played?
3. **Threshold:** Is the exact threshold (when a play *becomes* highest) correctly detected?
4. **False Positive Guard:** Explicit tests for low/mid combos that should **never** be highest.
5. **Screenshot Scenarios:** Game states reconstructed directly from the user's screenshots.

### Card Notation

- Cards identified as `{rank}{suit}` — e.g. `2S` = Two of Spades, `10H` = 10 of Hearts
- Suit order (low → high): **Diamonds (D) < Clubs (C) < Hearts (H) < Spades (S)**
- Rank order (low → high): **3 4 5 6 7 8 9 10 J Q K A 2** (2 is highest in Big Two)

### Combo Hierarchy Tested

| Strength | Combo Type |
|----------|-----------|
| 8 | Straight Flush (highest) |
| 7 | Four of a Kind |
| 6 | Full House |
| 5 | Flush |
| 4 | Straight |
| 3 | Triple |
| 2 | Pair |
| 1 | Single (lowest) |

### Straight Sequences Tested

All 10 valid Big Two straight sequences were verified:

```
A-2-3-4-5   (5-high, A as low)
2-3-4-5-6   (6-high, 2 as low)
3-4-5-6-7
4-5-6-7-8
5-6-7-8-9
6-7-8-9-10
7-8-9-10-J
8-9-10-J-Q
9-10-J-Q-K
10-J-Q-K-A  (A-high / Royal, highest)
```

**Invalid wrap-around checked:** `J-Q-K-A-2` — confirmed as `unknown` (correctly rejected).

---

## Test Results by Section

### Section 1 — `classifyCards`: Every Combo Type (15 tests)

| Test | Result |
|------|--------|
| Single card → `Single` | ✅ PASS |
| Same-rank 2 cards → `Pair` | ✅ PASS |
| Different-rank 2 cards → `unknown` | ✅ PASS |
| Same-rank 3 cards → `Triple` | ✅ PASS |
| All 10 straight sequences → `Straight` | ✅ PASS |
| J-Q-K-A-2 wrap → NOT `Straight` | ✅ PASS |
| 5 same-suit non-straight → `Flush` | ✅ PASS |
| 5 same-suit straight → `Straight Flush` (not `Flush`) | ✅ PASS |
| AAA+KK → `Full House` | ✅ PASS |
| 222+AA → `Full House` | ✅ PASS |
| 3 mixed ranks (AA+K) → NOT `Full House` | ✅ PASS |
| 2222+A → `Four of a Kind` | ✅ PASS |
| AAAA+3 → `Four of a Kind` | ✅ PASS |
| All 40 SF combinations (10 seqs × 4 suits) → `Straight Flush` | ✅ PASS |

**Notable finding:** Straight flush is correctly prioritised over flush — same-suit straight cards are never misclassified as `Flush`.

---

### Section 2 — `canBeatPlay`: Head-to-Head Strength (14 tests)

| Test | Result |
|------|--------|
| 2♠ beats A♠ (single) | ✅ PASS |
| A♠ does NOT beat 2♠ | ✅ PASS |
| 3♠ beats 3♦ (higher suit, same rank) | ✅ PASS |
| Pair of 2s beats pair of Aces | ✅ PASS |
| Pair of Aces does NOT beat pair of 2s | ✅ PASS |
| Triple 2s beats triple Aces | ✅ PASS |
| Straight Flush beats Four of a Kind | ✅ PASS |
| Four of a Kind beats Full House | ✅ PASS |
| Full House beats Flush | ✅ PASS |
| Flush beats Straight | ✅ PASS |
| Higher straight sequence beats lower | ✅ PASS |
| Full House: higher triple rank wins (AAA-33 > KKK-AA) | ✅ PASS |
| Four of a Kind: higher quad rank wins (2222 > AAAA) | ✅ PASS |
| Different card counts cannot beat each other | ✅ PASS |

**Key validation:** Full House comparison correctly uses the **triple rank** only, not the pair rank. `KKK-22` does NOT beat `KKK-AA` (same triple rank = no improvement).

---

### Section 3 — `isHighestPossiblePlay`: Singles (10 tests)

| Test | Result |
|------|--------|
| 2♠ is highest single with nothing played | ✅ PASS |
| 2♥ is NOT highest single with nothing played | ✅ PASS |
| 2♣ is NOT highest when only 2♠ played (2♥ still available) | ✅ PASS |
| 2♥ becomes highest after 2♠ played | ✅ PASS |
| 2♣ becomes highest after 2♠ + 2♥ played | ✅ PASS |
| 2♦ becomes highest after all other 2s played | ✅ PASS |
| A♠ becomes highest after all 4 twos played | ✅ PASS |
| A♥ NOT highest when A♠ still unplayed | ✅ PASS |
| K is NOT highest (2s and Aces unplayed) | ✅ PASS |
| 3♦ is never highest with unplayed cards | ✅ PASS |

---

### Section 4 — `isHighestPossiblePlay`: Pairs (9 tests)

| Test | Result |
|------|--------|
| Pair 2♠-2♥ is highest pair when nothing played | ✅ PASS |
| Pair 2♣-2♦ is NOT highest (2♠-2♥ exists) | ✅ PASS |
| Pair 2♠-2♥ remains highest despite many low cards played | ✅ PASS |
| Pair 2♣-2♦ becomes highest after 2♠ and 2♥ separately played | ✅ PASS |
| Pair of Aces is NOT highest when pair of 2s formable | ✅ PASS |
| Pair A♠-A♥ becomes highest after all four 2s played | ✅ PASS |
| Pair A♥-A♦ NOT highest when A♠-A♣ still available | ✅ PASS |
| FALSE POSITIVE: Pair of 5s is NOT highest | ✅ PASS |
| FALSE POSITIVE: Pair of Kings is NOT highest | ✅ PASS |

**Critical scenario tested:** When 2♠ is played as a single, the remaining pair 2♣-2♦ correctly becomes the highest pair (only 2♥ is left, which cannot form a pair alone).

---

### Section 5 — `isHighestPossiblePlay`: Triples (6 tests)

| Test | Result |
|------|--------|
| Triple 2s is highest with nothing played | ✅ PASS |
| Triple Aces is NOT highest (triple 2s possible) | ✅ PASS |
| Triple Aces becomes highest after 2 twos played (only 2 remain) | ✅ PASS |
| Triple Aces NOT highest after only 1 two played (3 twos still available) | ✅ PASS |
| Triple Kings is NOT highest (Aces and 2s still available) | ✅ PASS |
| Triple 2♠-2♥-2♣ is correctly highest (2♦ alone can't form triple) | ✅ PASS |

---

### Section 6 — `isHighestPossiblePlay`: Straights (5 tests)

| Test | Result |
|------|--------|
| 10-J-Q-K-A mixed suits is NOT highest (SFs possible) | ✅ PASS |
| Low straight A-2-3-4-5 is NOT highest | ✅ PASS |
| 3-4-5-6-7 straight is NOT highest | ✅ PASS |
| 10♠-J♠-Q♠-K♠-A♠ classified as `Straight Flush`, not `Straight` | ✅ PASS |
| Suite comparison logic for same-sequence straights | ✅ PASS |

**Key finding:** The highest straight in the straight hierarchy is 10-J-Q-K-A. However, when all same-suit cards exist, this becomes a Straight Flush — the classifier correctly distinguishes these.

---

### Section 7 — `isHighestPossiblePlay`: Flushes (3 tests)

| Test | Result |
|------|--------|
| Flush A-K-Q-J-3♠ is NOT highest when SF possible | ✅ PASS |
| Flush is NOT highest when Full House formable | ✅ PASS |
| A♠ flush — detector correctly accounts for stronger combos | ✅ PASS |

---

### Section 8 — `isHighestPossiblePlay`: Full House (6 tests)

| Test | Result |
|------|--------|
| FH 222+AA is NOT highest when SF possible | ✅ PASS |
| FH 222+AA is NOT highest when 4-of-a-kind possible | ✅ PASS |
| FH 222+AA highest when no SF/4K and no higher triple | ✅ PASS |
| FH KKK+AA is NOT highest when triple 2s or Aces can form FH | ✅ PASS |
| canBeatPlay: AAA+KK beats KKK+AA (triple rank comparison) | ✅ PASS |
| canBeatPlay: KKK+22 does NOT beat KKK+AA (same triple rank) | ✅ PASS |

---

### Section 9 — `isHighestPossiblePlay`: Four of a Kind (5 tests)

| Test | Result |
|------|--------|
| FOAK 2222 is NOT highest when SFs possible | ✅ PASS |
| FOAK AAAA is NOT highest when 2222 still possible | ✅ PASS |
| FOAK 2222 IS highest when all SFs broken | ✅ PASS |
| FOAK AAAA IS highest when all SFs broken AND no 2222 possible | ✅ PASS |
| FOAK 3333 is NOT highest when AAAA and 2222 still possible | ✅ PASS |

---

### Section 10 — `isHighestPossiblePlay`: Straight Flush (10 tests)

| Test | Result |
|------|--------|
| Royal Flush ♠ (10-J-Q-K-A♠) is highest SF with nothing played | ✅ PASS |
| Royal Flush ♥ is NOT highest (♠ royal still possible) | ✅ PASS |
| Royal Flush ♥ becomes highest after ♠ royal played | ✅ PASS |
| Royal Flush ♣ becomes highest after ♠ and ♥ royals played | ✅ PASS |
| Low SF A-2-3-4-5 is NOT highest | ✅ PASS |
| SF 9-10-J-Q-K♠ is NOT highest when Royal ♠ still possible | ✅ PASS |
| SF 9-10-J-Q-K♠ becomes highest when all royals broken | ✅ PASS |
| FALSE POSITIVE: Low SF 3-4-5-6-7♦ is never the highest | ✅ PASS |
| FALSE POSITIVE: Same-sequence lower suit does NOT beat higher suit | ✅ PASS |
| FALSE POSITIVE: SF 3-7♠ is NOT highest when 4-7-8♦ SF possible | ✅ PASS |

---

### Section 11 — Edge Cases & Boundary Conditions (12 tests)

| Test | Result |
|------|--------|
| Empty cards array → returns `false` | ✅ PASS |
| 4-card play → returns `false` (invalid Big Two combo) | ✅ PASS |
| 6-card play → returns `false` (invalid Big Two combo) | ✅ PASS |
| `classifyCards` returns `unknown` for 4 different-rank cards | ✅ PASS |
| `classifyCards` returns `unknown` for 2 different-rank cards | ✅ PASS |
| `classifyCards` returns `unknown` for empty array | ✅ PASS |
| Remaining-card tracking is accurate after single card removal | ✅ PASS |
| Duplicate in played-cards list does not corrupt result | ✅ PASS |
| KKKK+3 correctly classified as `Four of a Kind` | ✅ PASS |
| J-Q-K-A-2 (wrap) NOT classified as `Straight` or `Straight Flush` | ✅ PASS |
| A-2-3-4-5 IS a valid straight (Ace as low) | ✅ PASS |
| 2-3-4-5-6 IS a valid straight (2 as low) | ✅ PASS |

---

### Section 12 — False Positive Scenarios from Screenshots (9 tests)

These tests directly reconstruct the game states visible in the user's screenshots.

| Screenshot Context | Test | Result |
|-------------------|------|--------|
| Match 2 | Flush A-K-Q-J-3♠ with no cards played: NOT highest | ✅ PASS |
| Match 2 | Flush A-K-Q-J-3♠ after 10-9-8-7-6♠ SF played: NOT highest | ✅ PASS |
| Match 1 | Straight 3-4-5-6-7 (mixed suits): NOT highest | ✅ PASS |
| Match 1 | Straight 3-4-5-6-7 after K-Q-J-10-9♠ SF played: NOT highest | ✅ PASS |
| Match 3 | Full House 222+66 with no played cards: NOT highest | ✅ PASS |
| Match 3 | Flush A-K-Q-J-3♥ when SF still possible: NOT highest | ✅ PASS |
| Match 3 | Straight Q-J-10-9-8 when stronger combos possible: NOT highest | ✅ PASS |
| Match 3 | Straight 3-4-5-6-7 in full Match 3 context: NOT highest | ✅ PASS |
| Extreme | A-2-3-4-5 straight IS highest when ranks 6-K all removed | ✅ PASS |

---

### Section 13 — Combo Strength Hierarchy Validation (4 tests)

| Test | Result |
|------|--------|
| Each combo type has a unique strength value | ✅ PASS |
| SF > 4K > FH > Flush ordering | ✅ PASS |
| Flush > Straight > Triple > Pair > Single ordering | ✅ PASS |
| 5-card combos cannot beat 1/2/3-card combos (length mismatch) | ✅ PASS |

---

## Summary

### Overall

```
Test Suites: 1 passed, 1 total
Tests:       108 passed, 108 total  
Snapshots:   0 total
Time:        1.003 s
```

### Findings

**No bugs found in the combo detection logic itself.** All 108 tests—including direct reconstructions of the screenshot scenarios—pass correctly. Specifically:

1. **`classifyCards`** correctly identifies all 8 combo types, including the trickiest cases: Straight Flush vs Flush, A-2-3-4-5 and 2-3-4-5-6 as valid straights, and J-Q-K-A-2 wrap as invalid.

2. **`canBeatPlay`** correctly applies the strength hierarchy. Full House comparison uses triple rank only (pair rank ignored). Four of a Kind uses quad rank. Straight/Straight Flush use sequence index then suit.

3. **`isHighestPossiblePlay`** correctly gates on stronger combo types before checking within a type. A Four of a Kind is never "highest" while a Straight Flush can still be formed. A Flush is never "highest" while a Full House can still be formed.

4. **Screenshot scenarios**: The combos shown in the screenshots (Flush AKQJ3♠, Straight 3-4-5-6-7, Full House 222+66, etc.) all correctly return `false` — they are NOT flagged as highest plays in those game states.

### Possible Causes of the Reported False Positives

Since the core logic is sound, the false positives in the screenshots are likely caused by one or more of:

| Candidate | Where to Investigate |
|-----------|---------------------|
| **The `playedCards` array passed to the detector is incomplete** — e.g. only tracking cards from the current round, not the full game | `GameContext` / `useGameState` — wherever `isHighestPossiblePlay` is called |
| **Cards played in previous matches are not being reset** between Match 1 → 2 → 3 | Match transition logic, `playedCards` state reset |
| **Auto-pass timer triggered for the wrong reason** — e.g. a different code path, not the highest-play detector | `useAutoPassTimer` hook, `onActionTimeout` |
| **The combo type passed to the detector mismatches the actual cards** | Caller site of `isHighestPossiblePlay` — validate `type` argument |

### Recommended Next Steps

1. **Add logging at the call site** of `isHighestPossiblePlay` to print the `cards`, `playedCards.length`, and `result` whenever it returns `true`.
2. **Verify `playedCards` is the full game-level card history**, not just the current round.
3. **Check the auto-pass timer trigger** — confirm it reads from `isHighestPossiblePlay` exclusively and not from a separate (possibly stale) state flag.

---

*Test file location:* `apps/mobile/src/game/__tests__/combo-detector-sandbox.test.ts`
