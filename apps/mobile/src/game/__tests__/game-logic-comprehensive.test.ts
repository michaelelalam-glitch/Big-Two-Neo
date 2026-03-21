/**
 * Task #273 — Comprehensive game-engine edge-case tests
 *
 * Covers:
 *   - Straight / Straight-Flush tiebreaks in canBeatPlay
 *   - Full-House quad-rank comparison in canBeatPlay
 *   - findRecommendedPlay: flush / full-house / four-of-a-kind recommendations,
 *     and the "no play possible" null case
 *   - validateOneCardLeftRule edge cases not covered in game-logic.test.ts
 *   - canPassWithOneCardLeftRule edge cases
 *   - isHighestPossiblePlay: Full House, Flush, Straight, and Four-of-a-Kind
 *     code-paths that were previously at 62 % coverage
 *
 * All tests are pure-function unit tests — no mocks, no async, no network.
 */

import {
  canBeatPlay,
  classifyCards,
  findRecommendedPlay,
  validateOneCardLeftRule,
  canPassWithOneCardLeftRule,
} from '../engine/game-logic';
import { isHighestPossiblePlay } from '../engine/highest-play-detector';
import type { Card, LastPlay } from '../types';

// ── helpers ───────────────────────────────────────────────────────────────────

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { id: `${rank}${suit}`, rank, suit };
}

function lastPlay(cards: Card[], combo_type: LastPlay['combo_type']): LastPlay {
  return { cards, combo_type };
}

// ── Straight same-sequence tiebreak (suit comparison) ─────────────────────────

describe('canBeatPlay — Straight tiebreaks', () => {
  // Mixed suits so classifyCards returns 'Straight' not 'Straight Flush'.
  // The suit tiebreak is determined by the HIGHEST card in the sequence.
  // 3-4-5-6-7: highest rank is 7 → suit on 7 determines the tiebreak.
  const straight3to7_S = [
    card('3', 'C'),
    card('4', 'D'),
    card('5', 'C'),
    card('6', 'D'),
    card('7', 'S'),
  ];
  const straight3to7_H = [
    card('3', 'C'),
    card('4', 'D'),
    card('5', 'C'),
    card('6', 'D'),
    card('7', 'H'),
  ];
  const straight4to8_D = [
    card('4', 'C'),
    card('5', 'H'),
    card('6', 'C'),
    card('7', 'H'),
    card('8', 'D'),
  ];

  it('higher-sequence straight beats lower-sequence straight', () => {
    expect(canBeatPlay(straight4to8_D, lastPlay(straight3to7_H, 'Straight'))).toBe(true);
  });

  it('lower-sequence straight cannot beat higher-sequence straight', () => {
    expect(canBeatPlay(straight3to7_H, lastPlay(straight4to8_D, 'Straight'))).toBe(false);
  });

  it('same-sequence straight with higher suit beats lower suit', () => {
    // Suit tiebreak order: D < C < H < S (Diamonds < Clubs < Hearts < Spades)
    expect(canBeatPlay(straight3to7_S, lastPlay(straight3to7_H, 'Straight'))).toBe(true);
  });

  it('same-sequence straight with lower suit cannot beat higher suit', () => {
    expect(canBeatPlay(straight3to7_H, lastPlay(straight3to7_S, 'Straight'))).toBe(false);
  });
});

// ── Straight Flush tiebreaks ──────────────────────────────────────────────────

describe('canBeatPlay — Straight Flush tiebreaks', () => {
  // A straight flush in this game requires 5 same-suit cards in a straight
  const sfLowH = [card('3', 'H'), card('4', 'H'), card('5', 'H'), card('6', 'H'), card('7', 'H')];
  const sfHighH = [card('5', 'H'), card('6', 'H'), card('7', 'H'), card('8', 'H'), card('9', 'H')];
  const sfLowS = [card('3', 'S'), card('4', 'S'), card('5', 'S'), card('6', 'S'), card('7', 'S')];

  it('higher-sequence SF beats lower-sequence SF', () => {
    expect(canBeatPlay(sfHighH, lastPlay(sfLowH, 'Straight Flush'))).toBe(true);
  });

  it('same-sequence SF with higher suit beats lower suit', () => {
    expect(canBeatPlay(sfLowS, lastPlay(sfLowH, 'Straight Flush'))).toBe(true);
  });
});

// ── Full House rank comparison ────────────────────────────────────────────────

describe('canBeatPlay — Full House', () => {
  const fhAcesOverKings = [
    card('A', 'H'),
    card('A', 'D'),
    card('A', 'C'),
    card('K', 'H'),
    card('K', 'D'),
  ];
  const fhKingsOverAces = [
    card('K', 'H'),
    card('K', 'D'),
    card('K', 'C'),
    card('A', 'H'),
    card('A', 'D'),
  ];
  const fhAcesOverQueens = [
    card('A', 'H'),
    card('A', 'D'),
    card('A', 'C'),
    card('Q', 'H'),
    card('Q', 'D'),
  ];
  const fhTwosOverAces = [
    card('2', 'H'),
    card('2', 'D'),
    card('2', 'C'),
    card('A', 'H'),
    card('A', 'D'),
  ];

  it('higher triple rank beats lower triple rank Full House', () => {
    expect(canBeatPlay(fhTwosOverAces, lastPlay(fhAcesOverKings, 'Full House'))).toBe(true);
  });

  it('Aces-over-Kings beats Kings-over-Aces (triple rank determines winner)', () => {
    expect(canBeatPlay(fhAcesOverKings, lastPlay(fhKingsOverAces, 'Full House'))).toBe(true);
  });

  it('same triple rank with different pair — pair rank does NOT matter for beating', () => {
    // Both have triple Aces — Aces-over-Queens vs Aces-over-Kings
    // Triple rank is equal, so higher pair doesn't give the win (rank diff = 0)
    expect(canBeatPlay(fhAcesOverKings, lastPlay(fhAcesOverQueens, 'Full House'))).toBe(false); // Same triple rank → false (not strictly greater)
  });
});

// ── Four of a Kind rank comparison ───────────────────────────────────────────

describe('canBeatPlay — Four of a Kind', () => {
  const make4k = (rank: Card['rank']): Card[] => {
    const kicker = rank === '3' ? card('A', 'H') : card('3', 'H');
    return [card(rank, 'H'), card(rank, 'D'), card(rank, 'C'), card(rank, 'S'), kicker];
  };

  it('higher-rank Four of a Kind beats lower-rank', () => {
    expect(canBeatPlay(make4k('A'), lastPlay(make4k('K'), 'Four of a Kind'))).toBe(true);
  });

  it('lower-rank Four of a Kind cannot beat higher-rank', () => {
    expect(canBeatPlay(make4k('K'), lastPlay(make4k('A'), 'Four of a Kind'))).toBe(false);
  });

  it('Four of a kind 2s is highest (beats Aces)', () => {
    expect(canBeatPlay(make4k('2'), lastPlay(make4k('A'), 'Four of a Kind'))).toBe(true);
  });
});

// ── findRecommendedPlay: Flush / Full-House / Four-of-a-Kind paths ────────────

describe('findRecommendedPlay — 5-card combo recommendations', () => {
  it('recommends a flush when last play is a straight', () => {
    // Flush beats straight
    const flushHand: Card[] = [
      card('3', 'H'),
      card('5', 'H'),
      card('7', 'H'),
      card('9', 'H'),
      card('K', 'H'),
      card('4', 'D'),
      card('6', 'S'),
    ];
    const lastStraight = lastPlay(
      [card('4', 'S'), card('5', 'S'), card('6', 'D'), card('7', 'D'), card('8', 'D')],
      'Straight'
    );

    const recommended = findRecommendedPlay(flushHand, lastStraight, false);
    expect(recommended).not.toBeNull();
    if (recommended) {
      const playedCards = flushHand.filter(c => recommended.includes(c.id));
      expect(classifyCards(playedCards)).toBe('Flush');
    }
  });

  it('recommends Full House when last play is a Flush', () => {
    const fhHand: Card[] = [
      card('K', 'H'),
      card('K', 'D'),
      card('K', 'C'),
      card('A', 'H'),
      card('A', 'D'),
      card('2', 'S'),
      card('3', 'S'),
    ];
    const lastFlush = lastPlay(
      [card('3', 'H'), card('5', 'H'), card('7', 'H'), card('9', 'H'), card('J', 'H')],
      'Flush'
    );

    const recommended = findRecommendedPlay(fhHand, lastFlush, false);
    expect(recommended).not.toBeNull();
    if (recommended) {
      const playedCards = fhHand.filter(c => recommended.includes(c.id));
      expect(classifyCards(playedCards)).toBe('Full House');
    }
  });

  it('recommends a Four of a Kind when needed', () => {
    const q4Hand: Card[] = [
      card('A', 'H'),
      card('A', 'D'),
      card('A', 'C'),
      card('A', 'S'),
      card('2', 'S'),
      card('3', 'S'),
      card('4', 'S'),
    ];
    const lastFH = lastPlay(
      [card('K', 'H'), card('K', 'D'), card('K', 'C'), card('A', 'H'), card('A', 'D')],
      'Full House'
    );

    const recommended = findRecommendedPlay(q4Hand, lastFH, false);
    expect(recommended).not.toBeNull();
    if (recommended) {
      const playedCards = q4Hand.filter(c => recommended.includes(c.id));
      expect(classifyCards(playedCards)).toBe('Four of a Kind');
    }
  });

  it('returns null when player cannot beat last play', () => {
    // Last play: pair of 2s (highest pair) — player only has low singles
    const weakHand: Card[] = [card('3', 'D'), card('4', 'H'), card('5', 'C')];
    const lastPair2s = lastPlay([card('2', 'S'), card('2', 'H')], 'Pair');

    expect(findRecommendedPlay(weakHand, lastPair2s, false)).toBeNull();
  });
});

// ── isHighestPossiblePlay: Full House paths ───────────────────────────────────

describe('isHighestPossiblePlay — Full House', () => {
  // blockSFAndNoFourOfAKind: plays all of ranks 4-9 (all suits), royal-flush
  // breakers, 3 of the 4 Aces, and 2♠ so rank-2 has only 3 remaining = {2H,2D,2C}.
  // After this: no SF possible, no 4K possible (max 3 per rank).
  // Remaining: rank-2={2H,2D,2C}, rank-3={3C}, rank-10..K=3 each, rank-A={AS}.
  const blockSFAndNoFourOfAKind: Card[] = [
    card('10', 'H'),
    card('J', 'C'),
    card('Q', 'S'),
    card('K', 'D'),
    card('9', 'H'),
    card('9', 'C'),
    card('9', 'S'),
    card('9', 'D'),
    card('8', 'H'),
    card('8', 'C'),
    card('8', 'S'),
    card('8', 'D'),
    card('7', 'H'),
    card('7', 'C'),
    card('7', 'S'),
    card('7', 'D'),
    card('6', 'H'),
    card('6', 'C'),
    card('6', 'S'),
    card('6', 'D'),
    card('5', 'H'),
    card('5', 'C'),
    card('5', 'S'),
    card('5', 'D'),
    card('4', 'H'),
    card('4', 'C'),
    card('4', 'S'),
    card('4', 'D'),
    card('3', 'H'),
    card('3', 'S'),
    card('3', 'D'),
    card('A', 'H'),
    card('A', 'C'),
    card('A', 'D'),
    card('2', 'S'), // blocks 4K of 2 — remaining rank-2 becomes {2H,2D,2C}=3
  ];

  it('detects triple-2s + pair-Kings as highest FH when SFs and 4K exhausted', () => {
    // With blockSFAndNoFourOfAKind: highest triple = rank-2 (3 remaining);
    // highest available pair ≠ rank-2 = rank-K (KH,KS,KC = 3 remaining).
    const fhTwoKings: Card[] = [
      card('2', 'H'),
      card('2', 'D'),
      card('2', 'C'),
      card('K', 'H'),
      card('K', 'S'),
    ];
    expect(isHighestPossiblePlay(fhTwoKings, blockSFAndNoFourOfAKind)).toBe(true);
  });

  it('does NOT detect Full House of Aces as highest (triple 2s possible)', () => {
    const fhAces: Card[] = [
      card('A', 'H'),
      card('A', 'D'),
      card('A', 'C'),
      card('K', 'H'),
      card('K', 'D'),
    ];
    expect(isHighestPossiblePlay(fhAces, [])).toBe(false);
  });

  it('does NOT detect triple-2s + pair-Queens as highest FH (pair-Kings still available)', () => {
    // Highest pair rank given blockSFAndNoFourOfAKind is K (3 remaining);
    // Queens only has 3 remaining too but K > Q → pair rank mismatch → false.
    const fhTwoQueens: Card[] = [
      card('2', 'H'),
      card('2', 'D'),
      card('2', 'C'),
      card('Q', 'H'),
      card('Q', 'D'),
    ];
    expect(isHighestPossiblePlay(fhTwoQueens, blockSFAndNoFourOfAKind)).toBe(false);
  });

  it('does NOT detect Full House of Aces-over-3s as highest (Aces-over-Ks still possible)', () => {
    const fhAcesThree: Card[] = [
      card('A', 'H'),
      card('A', 'D'),
      card('A', 'C'),
      card('3', 'H'),
      card('3', 'D'),
    ];
    // Kings are still in the deck → Aces-over-Kings would beat Aces-over-3s? No.
    // Full House is compared by triple rank. Since Aces == Aces, pair rank matters.
    // Function returns false because played pair rank (3) ≠ highest pair rank (K)
    expect(isHighestPossiblePlay(fhAcesThree, [])).toBe(false);
  });
});

// ── isHighestPossiblePlay: Flush paths ───────────────────────────────────────

describe('isHighestPossiblePlay — Flush', () => {
  // blockForFlush: blocks SF, 4K, and FH so the Flush branch actually runs.
  // After this: remaining Spades = {2S,10S,JS,KS,AS} = exactly our flush;
  //             all other suits have ≤ 3 remaining ⇒ no flush in other suits.
  // Rank counts ≤ 2 in remaining → no triple → FH impossible.
  const blockForFlush: Card[] = [
    // blockSF base (34 cards):
    card('10', 'H'),
    card('J', 'C'),
    card('Q', 'S'),
    card('K', 'D'),
    card('3', 'H'),
    card('3', 'S'),
    card('3', 'D'),
    card('4', 'H'),
    card('4', 'C'),
    card('4', 'S'),
    card('4', 'D'),
    card('5', 'H'),
    card('5', 'C'),
    card('5', 'S'),
    card('5', 'D'),
    card('6', 'H'),
    card('6', 'C'),
    card('6', 'S'),
    card('6', 'D'),
    card('7', 'H'),
    card('7', 'C'),
    card('7', 'S'),
    card('7', 'D'),
    card('8', 'H'),
    card('8', 'C'),
    card('8', 'S'),
    card('8', 'D'),
    card('9', 'H'),
    card('9', 'C'),
    card('9', 'S'),
    card('9', 'D'),
    card('A', 'H'),
    card('A', 'C'),
    card('A', 'D'),
    // Extra: reduce every rank to ≤ 2 remaining so no FH triple forms,
    //        and no other suit accumulates ≥ 5 cards for a competing flush.
    card('2', 'H'),
    card('2', 'D'), // rank-2: {2C,2S}=2 (no triple-2, no 4K-2)
    card('J', 'D'), // rank-J: {JH,JS}=2 (JS in flush hand)
    card('K', 'C'), // rank-K: {KH,KS}=2 (KS in flush hand, KD in blockSF)
    card('Q', 'D'), // rank-Q: {QH,QC}=2
    card('10', 'C'), // rank-10: {10S,10D}=2 (10S in flush hand, 10H in blockSF)
  ];

  it('detects best Spades flush as highest when all stronger combos exhausted', () => {
    // {2S,10S,JS,KS,AS} is the only possible Spades flush after blockForFlush.
    // 2-10-J-K-A♠ is NOT a straight sequence → classified as Flush ✓
    const bestFlushS: Card[] = [
      card('2', 'S'),
      card('10', 'S'),
      card('J', 'S'),
      card('K', 'S'),
      card('A', 'S'),
    ];
    expect(isHighestPossiblePlay(bestFlushS, blockForFlush)).toBe(true);
  });

  it('does NOT detect a medium flush as highest when stronger flush possible', () => {
    const medFlush: Card[] = [
      card('3', 'H'),
      card('5', 'H'),
      card('7', 'H'),
      card('9', 'H'),
      card('J', 'H'),
    ];
    expect(isHighestPossiblePlay(medFlush, [])).toBe(false);
  });
});

// ── isHighestPossiblePlay: Straight paths ────────────────────────────────────

describe('isHighestPossiblePlay — Straight', () => {
  it('detects 10-J-Q-K-A as highest straight when all stronger combos exhausted', () => {
    // blockForStraight: blocks SF, 4K, FH, and Flush so the Straight branch runs.
    // Mixed-suit [10C,JD,QH,KC,AS]: valid 10-J-Q-K-A straight (seqIdx=9, highest).
    // AS is the top card with suit S (highest suit) → this IS the best 10-J-Q-K-A straight.
    const blockForStraight: Card[] = [
      // blockSF base (34 cards — same as highest-play-detector.test.ts):
      card('10', 'H'),
      card('J', 'C'),
      card('Q', 'S'),
      card('K', 'D'),
      card('3', 'H'),
      card('3', 'S'),
      card('3', 'D'),
      card('4', 'H'),
      card('4', 'C'),
      card('4', 'S'),
      card('4', 'D'),
      card('5', 'H'),
      card('5', 'C'),
      card('5', 'S'),
      card('5', 'D'),
      card('6', 'H'),
      card('6', 'C'),
      card('6', 'S'),
      card('6', 'D'),
      card('7', 'H'),
      card('7', 'C'),
      card('7', 'S'),
      card('7', 'D'),
      card('8', 'H'),
      card('8', 'C'),
      card('8', 'S'),
      card('8', 'D'),
      card('9', 'H'),
      card('9', 'C'),
      card('9', 'S'),
      card('9', 'D'),
      card('A', 'H'),
      card('A', 'C'),
      card('A', 'D'),
      // Extra 7 cards to eliminate 4K, FH, and Flush:
      card('2', 'H'),
      card('2', 'D'), // rank-2: {2C,2S}=2 (no 4K-2, no triple-2)
      card('3', 'C'), // rank-3: 0 remaining (break Clubs 3C)
      card('K', 'S'), // Spades→{2S,JS,AS}=3 (≤4, no flush)
      card('J', 'H'), // rank-J: {JD,JS}=2 (no triple-J)
      card('Q', 'D'), // rank-Q: {QH,QC}=2 (no triple-Q)
      card('10', 'S'), // rank-10: {10C,10D}=2 (no triple-10)
    ];
    // [10C,JD,QH,KC,AS] — none conflict with blockForStraight above
    const mixedRoyalStraight: Card[] = [
      card('10', 'C'),
      card('J', 'D'),
      card('Q', 'H'),
      card('K', 'C'),
      card('A', 'S'),
    ];
    expect(isHighestPossiblePlay(mixedRoyalStraight, blockForStraight)).toBe(true);
  });

  it('does NOT detect low straight as highest when higher sequences possible', () => {
    const low: Card[] = [
      card('3', 'S'),
      card('4', 'H'),
      card('5', 'D'),
      card('6', 'C'),
      card('7', 'S'),
    ];
    expect(isHighestPossiblePlay(low, [])).toBe(false);
  });

  it('does NOT detect a low straight as highest when lower-rank SFs remain unblocked', () => {
    // blockHigher plays all A/K/Q/J/10 cards (plus 8♠/9♠).
    // It blocks all higher straight sequences but does NOT break lower-rank SFs
    // (ranks 3–7 / 4–8 still fully available in the remaining deck),
    // so a straight flush is still possible → isHighestPossiblePlay returns false.
    const blockHigher: Card[] = [
      card('A', 'S'),
      card('K', 'S'),
      card('Q', 'S'),
      card('J', 'S'),
      card('10', 'S'),
      card('9', 'S'),
      card('8', 'S'),
      card('A', 'H'),
      card('K', 'H'),
      card('Q', 'H'),
      card('J', 'H'),
      card('10', 'H'),
      card('A', 'D'),
      card('K', 'D'),
      card('Q', 'D'),
      card('J', 'D'),
      card('10', 'D'),
      card('A', 'C'),
      card('K', 'C'),
      card('Q', 'C'),
      card('J', 'C'),
      card('10', 'C'),
    ];
    const lowStraight: Card[] = [
      card('3', 'H'),
      card('4', 'D'),
      card('5', 'C'),
      card('6', 'S'),
      card('7', 'H'),
    ];
    expect(isHighestPossiblePlay(lowStraight, blockHigher)).toBe(false);
  });
});

// ── isHighestPossiblePlay: Four of a Kind paths ──────────────────────────────

describe('isHighestPossiblePlay — Four of a Kind', () => {
  it('detects Four 2s as highest when no royal/SF possible', () => {
    // Exact same blockSF as highest-play-detector.test.ts — blocks ALL straight
    // flushes: plays every card in ranks 4-9 (all suits) to break non-royal SFs,
    // 3 of each A/3 suit to sever A-low/3-low SF options, and one card per suit
    // to break each royal flush. Four 2s (strength-7) only needs SF (strength-8)
    // to be impossible — the 4K-check is done inside the case, not in the loop.
    const blockSF: Card[] = [
      card('10', 'H'),
      card('J', 'C'),
      card('Q', 'S'),
      card('K', 'D'),
      card('9', 'H'),
      card('9', 'C'),
      card('9', 'S'),
      card('9', 'D'),
      card('8', 'H'),
      card('8', 'C'),
      card('8', 'S'),
      card('8', 'D'),
      card('7', 'H'),
      card('7', 'C'),
      card('7', 'S'),
      card('7', 'D'),
      card('6', 'H'),
      card('6', 'C'),
      card('6', 'S'),
      card('6', 'D'),
      card('5', 'H'),
      card('5', 'C'),
      card('5', 'S'),
      card('5', 'D'),
      card('4', 'H'),
      card('4', 'C'),
      card('4', 'S'),
      card('4', 'D'),
      card('3', 'H'),
      card('3', 'S'),
      card('3', 'D'),
      card('A', 'H'),
      card('A', 'C'),
      card('A', 'D'),
    ];
    const four2s: Card[] = [
      card('2', 'S'),
      card('2', 'H'),
      card('2', 'D'),
      card('2', 'C'),
      card('3', 'C'),
    ];
    expect(isHighestPossiblePlay(four2s, blockSF)).toBe(true);
  });

  it('does NOT detect Four Aces as highest when Four 2s still possible', () => {
    const fourAces: Card[] = [
      card('A', 'S'),
      card('A', 'H'),
      card('A', 'D'),
      card('A', 'C'),
      card('3', 'H'),
    ];
    expect(isHighestPossiblePlay(fourAces, [])).toBe(false);
  });
});

// ── validateOneCardLeftRule: additional edge cases ────────────────────────────

describe('validateOneCardLeftRule — edge cases', () => {
  it('handles playing a non-single with next player having 1 card (allowed)', () => {
    const pair: Card[] = [card('A', 'H'), card('A', 'D')];
    const hand: Card[] = [...pair, card('K', 'S')];
    const result = validateOneCardLeftRule(pair, hand, 1, null);
    expect(result.valid).toBe(true);
  });

  it('handles leading play (null lastPlay) with next player having 1 card', () => {
    const single: Card[] = [card('3', 'D')];
    const hand: Card[] = [card('3', 'D'), card('A', 'S'), card('2', 'S')];
    // When leading (null lastPlay), findHighestBeatingSingle returns the highest card in hand,
    // and validateOneCardLeftRule still enforces playing that highest single if the next player has 1 card
    const result = validateOneCardLeftRule(single, hand, 1, null);
    // Must play 2♠ (highest single) when leading and next player has 1 card
    expect(result.valid).toBe(false);
    expect(result.requiredCard?.id).toBe('2S');
  });
});

// ── canPassWithOneCardLeftRule: edge cases ────────────────────────────────────

describe('canPassWithOneCardLeftRule — edge cases', () => {
  it('blocks pass when last play is a single and next player has 1 card', () => {
    const hand: Card[] = [card('A', 'S'), card('K', 'H'), card('2', 'S')];
    const lastSingle = lastPlay([card('J', 'H')], 'Single');
    const result = canPassWithOneCardLeftRule(hand, 1, lastSingle);
    expect(result.canPass).toBe(false);
    expect(result.error).toMatch(/cannot pass/i);
  });

  it('allows pass when last play is a pair (not a single) even with 1 card left opponent', () => {
    const hand: Card[] = [card('A', 'S'), card('K', 'H')];
    const lastPair = lastPlay([card('J', 'H'), card('J', 'D')], 'Pair');
    const result = canPassWithOneCardLeftRule(hand, 1, lastPair);
    expect(result.canPass).toBe(true);
  });

  it('allows pass when player has no single that beats the last play', () => {
    const hand: Card[] = [card('3', 'D'), card('4', 'H')]; // Low cards
    const lastSingle = lastPlay([card('2', 'S')], 'Single'); // Highest card
    const result = canPassWithOneCardLeftRule(hand, 1, lastSingle);
    expect(result.canPass).toBe(true);
  });
});
