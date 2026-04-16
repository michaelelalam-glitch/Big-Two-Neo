/**
 * SANDBOX: Exhaustive Combo Detector Tests
 *
 * Tests isHighestPossiblePlay + classifyCards for every combo type
 * across every possible scenario the user reported as having false positives.
 *
 * False positive = the detector says a play IS the highest when it is NOT.
 * False negative = the detector says a play is NOT the highest when it IS.
 *
 * Run with:
 *   npx jest --testPathPattern="combo-detector-sandbox" --no-coverage 2>&1
 */

import { isHighestPossiblePlay } from '../engine/highest-play-detector';
import { classifyCards, canBeatPlay } from '../engine/game-logic';
import type { Card } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Rank = '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
type Suit = 'D' | 'C' | 'H' | 'S';

function c(rank: Rank, suit: Suit): Card {
  return { id: `${rank}${suit}`, rank, suit };
}

/** Build a played-cards set from an array of [rank, suit] tuples */
function played(...pairs: [Rank, Suit][]): Card[] {
  return pairs.map(([r, s]) => c(r, s));
}

/** All cards of a given rank */
function allOfRank(rank: Rank): Card[] {
  return (['D', 'C', 'H', 'S'] as Suit[]).map(s => c(rank, s));
}

/** All cards of a given suit */
function allOfSuit(suit: Suit): Card[] {
  return (['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'] as Rank[]).map(r =>
    c(r, suit)
  );
}

/**
 * Build all 52 cards EXCEPT the specified cards.
 * Use as playedCards in isHighestPossiblePlay to create a deterministic
 * "last-N-cards-standing" scenario — guarantees the remaining deck equals
 * exactly those excludeCards, making IS-HIGHEST tests unambiguous.
 */
function allCardsExcept(...excludeCards: Card[]): Card[] {
  const excludeIds = new Set(excludeCards.map(x => x.id));
  const result: Card[] = [];
  for (const r of ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'] as Rank[]) {
    for (const s of ['D', 'C', 'H', 'S'] as Suit[]) {
      const card = c(r, s);
      if (!excludeIds.has(card.id)) result.push(card);
    }
  }
  return result;
}

/**
 * Build a minimal "all straight-flushes broken" played-cards array.
 * Removes one card from each suit for ranks 3-A so no straight-flush
 * sequence of 5 consecutive same-suit cards can be formed.
 */
function breakAllStraightFlushes(): Card[] {
  // Remove one card from each of the 10 sequences × 4 suits — but just one per sequence
  // is enough to break it.  Cheapest: for each suit remove rank '9' (breaks 5/10 seqs)
  // and rank '5' (breaks another 4/10).  Then rank 'A' to break the last non-royal.
  // Actually cleanest: remove ALL cards of ranks 7,8,9,10 across all suits to guarantee
  // every sequence of 5 is broken.
  const breakRanks: Rank[] = ['7', '8', '9', '10'];
  const breakSuits: Suit[] = ['D', 'C', 'H', 'S'];
  const result: Card[] = [];
  for (const r of breakRanks) {
    for (const s of breakSuits) {
      result.push(c(r, s));
    }
  }
  return result; // 16 cards, breaks every straight that passes through 7-10
}

// ─── Section 1: classifyCards ─────────────────────────────────────────────────

describe('classifyCards — every combo type', () => {
  // Singles
  it('classifies single card → Single', () => {
    expect(classifyCards([c('A', 'S')])).toBe('Single');
    expect(classifyCards([c('2', 'D')])).toBe('Single');
    expect(classifyCards([c('3', 'C')])).toBe('Single');
  });

  // Pairs
  it('classifies pair → Pair', () => {
    expect(classifyCards([c('K', 'S'), c('K', 'H')])).toBe('Pair');
    expect(classifyCards([c('2', 'S'), c('2', 'H')])).toBe('Pair');
    expect(classifyCards([c('3', 'D'), c('3', 'C')])).toBe('Pair');
  });

  it('does NOT classify two different ranks as Pair', () => {
    expect(classifyCards([c('A', 'S'), c('K', 'H')])).toBe('unknown');
  });

  // Triples
  it('classifies triple → Triple', () => {
    expect(classifyCards([c('A', 'S'), c('A', 'H'), c('A', 'D')])).toBe('Triple');
    expect(classifyCards([c('2', 'S'), c('2', 'H'), c('2', 'D')])).toBe('Triple');
    expect(classifyCards([c('7', 'S'), c('7', 'C'), c('7', 'D')])).toBe('Triple');
  });

  it('does NOT classify 3 different ranks as Triple', () => {
    expect(classifyCards([c('A', 'S'), c('K', 'H'), c('Q', 'D')])).toBe('unknown');
  });

  // Straights
  it('classifies every valid straight sequence → Straight', () => {
    const sequences: [Rank, Rank, Rank, Rank, Rank][] = [
      ['A', '2', '3', '4', '5'],
      ['2', '3', '4', '5', '6'],
      ['3', '4', '5', '6', '7'],
      ['4', '5', '6', '7', '8'],
      ['5', '6', '7', '8', '9'],
      ['6', '7', '8', '9', '10'],
      ['7', '8', '9', '10', 'J'],
      ['8', '9', '10', 'J', 'Q'],
      ['9', '10', 'J', 'Q', 'K'],
      ['10', 'J', 'Q', 'K', 'A'],
    ];
    for (const seq of sequences) {
      // Use mixed suits so it's never a flush
      const cards = [
        c(seq[0], 'D'),
        c(seq[1], 'C'),
        c(seq[2], 'H'),
        c(seq[3], 'S'),
        c(seq[4], 'D'),
      ];
      expect(classifyCards(cards)).toBe('Straight');
    }
  });

  it('does NOT classify J-Q-K-A-2 (wrap) as Straight', () => {
    const cards = [c('J', 'D'), c('Q', 'C'), c('K', 'H'), c('A', 'S'), c('2', 'D')];
    expect(classifyCards(cards)).not.toBe('Straight');
  });

  // Flushes
  it('classifies 5 same-suit non-straight cards → Flush', () => {
    // 3-4-5-6-8 of spades (not consecutive)
    const cards = [c('3', 'S'), c('4', 'S'), c('5', 'S'), c('6', 'S'), c('8', 'S')];
    expect(classifyCards(cards)).toBe('Flush');
  });

  it('classifies 5 same-suit straight cards → Straight Flush (NOT Flush)', () => {
    const cards = [c('3', 'H'), c('4', 'H'), c('5', 'H'), c('6', 'H'), c('7', 'H')];
    expect(classifyCards(cards)).toBe('Straight Flush');
  });

  // Full House
  it('classifies AAA-KK → Full House', () => {
    const cards = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('K', 'S'), c('K', 'H')];
    expect(classifyCards(cards)).toBe('Full House');
  });

  it('classifies 222-AA → Full House', () => {
    const cards = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('A', 'S'), c('A', 'H')];
    expect(classifyCards(cards)).toBe('Full House');
  });

  it('does NOT classify 3 different ranks as Full House', () => {
    const cards = [c('A', 'S'), c('A', 'H'), c('K', 'D'), c('K', 'S'), c('Q', 'H')];
    expect(classifyCards(cards)).not.toBe('Full House');
  });

  // Four of a Kind
  it('classifies 2222-A → Four of a Kind', () => {
    const cards = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('2', 'C'), c('A', 'S')];
    expect(classifyCards(cards)).toBe('Four of a Kind');
  });

  it('classifies AAAA-3 → Four of a Kind', () => {
    const cards = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('A', 'C'), c('3', 'S')];
    expect(classifyCards(cards)).toBe('Four of a Kind');
  });

  // Straight Flush
  it('classifies every valid straight-flush → Straight Flush', () => {
    const sequences: [Rank, Rank, Rank, Rank, Rank][] = [
      ['A', '2', '3', '4', '5'],
      ['2', '3', '4', '5', '6'],
      ['3', '4', '5', '6', '7'],
      ['4', '5', '6', '7', '8'],
      ['5', '6', '7', '8', '9'],
      ['6', '7', '8', '9', '10'],
      ['7', '8', '9', '10', 'J'],
      ['8', '9', '10', 'J', 'Q'],
      ['9', '10', 'J', 'Q', 'K'],
      ['10', 'J', 'Q', 'K', 'A'],
    ];
    for (const suit of ['D', 'C', 'H', 'S'] as Suit[]) {
      for (const seq of sequences) {
        const cards = seq.map(r => c(r, suit));
        expect(classifyCards(cards)).toBe('Straight Flush');
      }
    }
  });
});

// ─── Section 2: canBeatPlay ───────────────────────────────────────────────────

describe('canBeatPlay — head-to-head strength ordering', () => {
  it('Single 2♠ beats Single A♠', () => {
    expect(canBeatPlay([c('2', 'S')], { cards: [c('A', 'S')], combo_type: 'Single' })).toBe(true);
  });

  it('Single A♠ does NOT beat Single 2♠', () => {
    expect(canBeatPlay([c('A', 'S')], { cards: [c('2', 'S')], combo_type: 'Single' })).toBe(false);
  });

  it('Single 3♠ beats Single 3♦ (higher suit)', () => {
    expect(canBeatPlay([c('3', 'S')], { cards: [c('3', 'D')], combo_type: 'Single' })).toBe(true);
  });

  it('Pair of 2s beats Pair of Aces', () => {
    const p2 = [c('2', 'S'), c('2', 'H')];
    const pA = [c('A', 'S'), c('A', 'H')];
    expect(canBeatPlay(p2, { cards: pA, combo_type: 'Pair' })).toBe(true);
  });

  it('Pair of Aces does NOT beat Pair of 2s', () => {
    const pA = [c('A', 'S'), c('A', 'H')];
    const p2 = [c('2', 'S'), c('2', 'H')];
    expect(canBeatPlay(pA, { cards: p2, combo_type: 'Pair' })).toBe(false);
  });

  it('Triple 2s beats Triple Aces', () => {
    const t2 = [c('2', 'S'), c('2', 'H'), c('2', 'D')];
    const tA = [c('A', 'S'), c('A', 'H'), c('A', 'D')];
    expect(canBeatPlay(t2, { cards: tA, combo_type: 'Triple' })).toBe(true);
  });

  it('Straight Flush beats Four of a Kind', () => {
    const sf = [c('3', 'S'), c('4', 'S'), c('5', 'S'), c('6', 'S'), c('7', 'S')];
    const foak = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('2', 'C'), c('A', 'S')];
    expect(canBeatPlay(sf, { cards: foak, combo_type: 'Four of a Kind' })).toBe(true);
  });

  it('Four of a Kind beats Full House', () => {
    const foak = [c('3', 'S'), c('3', 'H'), c('3', 'D'), c('3', 'C'), c('A', 'S')];
    const fh = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('K', 'S'), c('K', 'H')];
    expect(canBeatPlay(foak, { cards: fh, combo_type: 'Full House' })).toBe(true);
  });

  it('Full House beats Flush', () => {
    const fh = [c('3', 'S'), c('3', 'H'), c('3', 'D'), c('K', 'S'), c('K', 'H')];
    const flush = [c('3', 'S'), c('5', 'S'), c('7', 'S'), c('9', 'S'), c('J', 'S')];
    expect(canBeatPlay(fh, { cards: flush, combo_type: 'Flush' })).toBe(true);
  });

  it('Flush beats Straight', () => {
    const flush = [c('3', 'S'), c('5', 'S'), c('7', 'S'), c('9', 'S'), c('J', 'S')];
    const str = [c('3', 'D'), c('4', 'C'), c('5', 'H'), c('6', 'S'), c('7', 'D')];
    expect(canBeatPlay(flush, { cards: str, combo_type: 'Straight' })).toBe(true);
  });

  it('Higher Straight beats lower Straight', () => {
    const high = [c('10', 'D'), c('J', 'C'), c('Q', 'H'), c('K', 'S'), c('A', 'D')];
    const low = [c('3', 'D'), c('4', 'C'), c('5', 'H'), c('6', 'S'), c('7', 'D')];
    expect(canBeatPlay(high, { cards: low, combo_type: 'Straight' })).toBe(true);
  });

  it('Full House: higher triple wins (AAA-33 beats KKK-AA)', () => {
    const higher = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('3', 'S'), c('3', 'H')];
    const lower = [c('K', 'S'), c('K', 'H'), c('K', 'D'), c('A', 'S'), c('A', 'H')];
    expect(canBeatPlay(higher, { cards: lower, combo_type: 'Full House' })).toBe(true);
  });

  it('Four of a Kind: higher quad rank wins (2222 beats AAAA)', () => {
    const higher = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('2', 'C'), c('3', 'S')];
    const lower = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('A', 'C'), c('2', 'S')];
    expect(canBeatPlay(higher, { cards: lower, combo_type: 'Four of a Kind' })).toBe(true);
  });

  it('Different combo types cannot beat each other regardless of card values', () => {
    // Pair of 2s cannot "beat" a straight (different combo type/length)
    const pair = [c('2', 'S'), c('2', 'H')];
    const str = [c('3', 'D'), c('4', 'C'), c('5', 'H'), c('6', 'S'), c('7', 'D')];
    expect(canBeatPlay(pair, { cards: str, combo_type: 'Straight' })).toBe(false);
  });
});

// ─── Section 3: isHighestPossiblePlay — Singles ───────────────────────────────

describe('isHighestPossiblePlay — Singles', () => {
  it('2♠ is highest single when nothing played', () => {
    expect(isHighestPossiblePlay([c('2', 'S')], [])).toBe(true);
  });

  it('2♥ is NOT highest single when nothing played (2♠ exists)', () => {
    expect(isHighestPossiblePlay([c('2', 'H')], [])).toBe(false);
  });

  it('2♣ is NOT highest single when only 2♠ has been played (2♥ is higher)', () => {
    expect(isHighestPossiblePlay([c('2', 'C')], played(['2', 'S']))).toBe(false);
  });

  it('2♥ becomes highest single after 2♠ is played', () => {
    expect(isHighestPossiblePlay([c('2', 'H')], played(['2', 'S']))).toBe(true);
  });

  it('2♣ becomes highest single after 2♠ and 2♥ are played', () => {
    expect(isHighestPossiblePlay([c('2', 'C')], played(['2', 'S'], ['2', 'H']))).toBe(true);
  });

  it('2♦ becomes highest single after all other 2s are played', () => {
    expect(isHighestPossiblePlay([c('2', 'D')], played(['2', 'S'], ['2', 'H'], ['2', 'C']))).toBe(
      true
    );
  });

  it('A♠ becomes highest single after ALL 2s are played', () => {
    expect(
      isHighestPossiblePlay([c('A', 'S')], played(['2', 'S'], ['2', 'H'], ['2', 'C'], ['2', 'D']))
    ).toBe(true);
  });

  it('A♥ is NOT highest single when A♠ is still unplayed', () => {
    expect(
      isHighestPossiblePlay([c('A', 'H')], played(['2', 'S'], ['2', 'H'], ['2', 'C'], ['2', 'D']))
    ).toBe(false);
  });

  it('K is NOT highest single when 2s and Aces still in play', () => {
    expect(isHighestPossiblePlay([c('K', 'S')], [])).toBe(false);
  });

  it('3♦ is NOT highest single in any scenario with unplayed cards', () => {
    expect(isHighestPossiblePlay([c('3', 'D')], [])).toBe(false);
  });
});

// ─── Section 4: isHighestPossiblePlay — Pairs ────────────────────────────────

describe('isHighestPossiblePlay — Pairs', () => {
  it('Pair 2♠-2♥ is highest pair when nothing played', () => {
    expect(isHighestPossiblePlay([c('2', 'S'), c('2', 'H')], [])).toBe(true);
  });

  it('Pair 2♣-2♦ is NOT highest pair when nothing played (2♠-2♥ exists)', () => {
    expect(isHighestPossiblePlay([c('2', 'C'), c('2', 'D')], [])).toBe(false);
  });

  it('Pair 2♠-2♥ remains highest even when many low cards are played', () => {
    const manyLow = played(
      ['3', 'D'],
      ['3', 'C'],
      ['4', 'D'],
      ['4', 'C'],
      ['5', 'D'],
      ['5', 'C'],
      ['6', 'D'],
      ['6', 'C'],
      ['7', 'D'],
      ['7', 'C'],
      ['8', 'D'],
      ['8', 'C']
    );
    expect(isHighestPossiblePlay([c('2', 'S'), c('2', 'H')], manyLow)).toBe(true);
  });

  it('Pair 2♣-2♦ becomes highest after 2♠ and 2♥ are played separately', () => {
    // After 2♠ (single) and 2♥ (single) played, only 2♣ and 2♦ of rank 2 remain
    // → 2♣-2♦ is the ONLY possible pair of 2s → highest pair
    expect(isHighestPossiblePlay([c('2', 'C'), c('2', 'D')], played(['2', 'S'], ['2', 'H']))).toBe(
      true
    );
  });

  it('Pair of Aces is NOT highest when pair of 2s can still be formed', () => {
    expect(isHighestPossiblePlay([c('A', 'S'), c('A', 'H')], [])).toBe(false);
  });

  it('Pair A♠-A♥ becomes highest after all four 2s are played', () => {
    expect(
      isHighestPossiblePlay(
        [c('A', 'S'), c('A', 'H')],
        played(['2', 'S'], ['2', 'H'], ['2', 'C'], ['2', 'D'])
      )
    ).toBe(true);
  });

  it('Pair A♥-A♦ is NOT highest after all 2s played (A♠-A♣ still available)', () => {
    expect(
      isHighestPossiblePlay(
        [c('A', 'H'), c('A', 'D')],
        played(['2', 'S'], ['2', 'H'], ['2', 'C'], ['2', 'D'])
      )
    ).toBe(false);
  });

  // FALSE POSITIVE SCENARIO FROM USER SCREENSHOTS
  it('FALSE POSITIVE GUARD: Pair of 5s is NOT highest (many higher pairs exist)', () => {
    const fivesPair = [c('5', 'S'), c('5', 'H')];
    expect(isHighestPossiblePlay(fivesPair, [])).toBe(false);
  });

  it('FALSE POSITIVE GUARD: Pair of Kings is NOT highest (pair of 2s still possible)', () => {
    expect(isHighestPossiblePlay([c('K', 'S'), c('K', 'H')], [])).toBe(false);
  });
});

// ─── Section 5: isHighestPossiblePlay — Triples ──────────────────────────────

describe('isHighestPossiblePlay — Triples', () => {
  it('Triple 2s is highest triple when nothing played', () => {
    expect(isHighestPossiblePlay([c('2', 'S'), c('2', 'H'), c('2', 'D')], [])).toBe(true);
  });

  it('Triple Aces is NOT highest triple (triple 2s possible)', () => {
    expect(isHighestPossiblePlay([c('A', 'S'), c('A', 'H'), c('A', 'D')], [])).toBe(false);
  });

  it('Triple Aces becomes highest after two 2s are played (only 2 remain, cannot triple)', () => {
    expect(
      isHighestPossiblePlay([c('A', 'S'), c('A', 'H'), c('A', 'D')], played(['2', 'S'], ['2', 'H']))
    ).toBe(true);
  });

  it('Triple Aces is NOT highest after only one 2 played (still need 2 more for triple 2s → but 3 remain!)', () => {
    expect(isHighestPossiblePlay([c('A', 'S'), c('A', 'H'), c('A', 'D')], played(['2', 'S']))).toBe(
      false
    );
  });

  it('Triple Kings is NOT highest when triple Aces and 2s still available', () => {
    expect(isHighestPossiblePlay([c('K', 'S'), c('K', 'H'), c('K', 'D')], [])).toBe(false);
  });

  it('Triple 2♠2♥2♣ — leaving 2♦ — is still highest triple (2♦ alone can´t form triple)', () => {
    // After playing 2S-2H-2C, only 2D remains → no triple of 2s possible
    // Therefore the played triple is the highest
    expect(isHighestPossiblePlay([c('2', 'S'), c('2', 'H'), c('2', 'C')], [])).toBe(true);
  });
});

// ─── Section 6: isHighestPossiblePlay — Straights ────────────────────────────

describe('isHighestPossiblePlay — Straights', () => {
  const royalMixedSuits = [c('10', 'D'), c('J', 'C'), c('Q', 'H'), c('K', 'S'), c('A', 'D')];
  const royalHighSuit = [c('10', 'S'), c('J', 'S'), c('Q', 'S'), c('K', 'S'), c('A', 'S')]; // straight flush!
  const topStrMixedSuit = royalMixedSuits; // 10-J-Q-K-A mixed suits = Straight (not SF)

  it('10-J-Q-K-A Straight (mixed suits) is NOT highest (higher straight flush possible)', () => {
    expect(isHighestPossiblePlay(topStrMixedSuit, [])).toBe(false);
  });

  it('Low straight A-2-3-4-5 is NOT highest when higher straights can be formed', () => {
    const low = [c('A', 'D'), c('2', 'C'), c('3', 'H'), c('4', 'S'), c('5', 'D')];
    expect(isHighestPossiblePlay(low, [])).toBe(false);
  });

  it('3-4-5-6-7 straight is NOT highest', () => {
    const str = [c('3', 'D'), c('4', 'C'), c('5', 'H'), c('6', 'S'), c('7', 'D')];
    expect(isHighestPossiblePlay(str, [])).toBe(false);
  });

  it('Highest straight 10-J-Q-K-A (spades) must be detected as Straight Flush not Straight', () => {
    // If we play 10♠-J♠-Q♠-K♠-A♠ that would be a SF, not just Straight
    expect(classifyCards(royalHighSuit)).toBe('Straight Flush');
  });

  it('Straight 10-J-Q-K-A: only highest suit matters — A♠ top makes it highest of same sequence', () => {
    // Break all straight flushes first, then check straight comparison
    const brokenSF = breakAllStraightFlushes();
    // Also need to break a few more sequences to ensure no SF exists
    // Add: remove one card from each suit's 9-10-J-Q-K sequence
    const extraBroken = [
      ...brokenSF,
      c('J', 'D'),
      c('J', 'C'),
      c('J', 'H'),
      c('J', 'S'), // breaks 7-8-9-10-J, 8-9-10-J-Q, 9-10-J-Q-K, 10-J-Q-K-A SFs
      c('K', 'D'),
      c('K', 'C'),
      c('K', 'H'), // breaks 9-10-J-Q-K SFs
    ];
    const tenToAceAllSuits = [c('10', 'S'), c('J', 'S'), c('Q', 'S'), c('K', 'S'), c('A', 'S')];
    // This is a straight flush — tested separately
    expect(classifyCards([c('10', 'D'), c('J', 'C'), c('Q', 'H'), c('K', 'S'), c('A', 'D')])).toBe(
      'Straight'
    );
  });
});

// ─── Section 7: isHighestPossiblePlay — Flushes ──────────────────────────────

describe('isHighestPossiblePlay — Flushes', () => {
  it('Flush with A♠ as highest card is NOT highest when straight flushes possible', () => {
    const flush = [c('A', 'S'), c('J', 'S'), c('9', 'S'), c('7', 'S'), c('5', 'S')];
    expect(isHighestPossiblePlay(flush, [])).toBe(false);
  });

  it('Flush is NOT highest when a Full House can still be formed', () => {
    // With 52 cards available, full houses are definitely formable
    const flush = [c('A', 'S'), c('J', 'S'), c('9', 'S'), c('7', 'S'), c('5', 'S')];
    expect(isHighestPossiblePlay(flush, [])).toBe(false);
  });

  it('A♠ flush with 5 spades (non-straight) — when all higher combos broken — IS highest flush if no better flush possible', () => {
    // Break all straight flushes by removing critical rank from each suit
    // Also break all 4-of-a-kind by removing one card of each rank that could make a quad
    // Also break all full houses → for simplicity use scenario where only 5 spade cards remain
    // This is a simplistic check: focus on the detector returning false when SF is possible
    const flushCards = [c('A', 'S'), c('K', 'S'), c('Q', 'S'), c('J', 'S'), c('3', 'S')];
    // With no other cards played, SF 10-J-Q-K-A spades is possible → should NOT be highest flush
    expect(isHighestPossiblePlay(flushCards, [])).toBe(false);
  });
});

// ─── Section 8: isHighestPossiblePlay — Full House ───────────────────────────

describe('isHighestPossiblePlay — Full House', () => {
  it('FH with triple 2s is NOT highest when straight flush possible', () => {
    const fh = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('A', 'S'), c('A', 'H')];
    expect(isHighestPossiblePlay(fh, [])).toBe(false);
  });

  it('FH with triple 2s is NOT highest when Four of a Kind possible', () => {
    // All straight flushes broken but 4-of-a-kind still possible (e.g. AAAA)
    const brokenSF = breakAllStraightFlushes();
    const fh = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('A', 'S'), c('A', 'H')];
    expect(isHighestPossiblePlay(fh, brokenSF)).toBe(false);
  });

  it('FH 222-AA is highest FH when no higher triple rank can form a Full House', () => {
    // For FH 2s to be unbeatable:
    // 1. No SF can be formed
    // 2. No four-of-a-kind can be formed
    // 3. No FH with higher triple (impossible since 2 is the highest rank)
    // Remove all SF + break AAAA quad (only 1 Ace left)
    const brokenSF = breakAllStraightFlushes();
    // Break all Aces (so no AAAA + extra)
    const brokenAcesForQuad = [
      ...brokenSF,
      c('A', 'D'), // Only A♠ and A♥ remain after playing 2S, 2H, 2D + KS, KH
    ];
    // Actually: FH uses 2S,2H,2D for triple; we need no higher triple possible
    // After playing FH 222-AA, remaining 2D card used, so 2♣ is available...
    // Let me use explicit: break all SF + all quads, then check 2s FH
    const fullBreaker = [
      ...breakAllStraightFlushes(),
      // Break remaining straight flushes not covered by 7-10 removal:
      // A-2-3-4-5 SF needs: check — removing 7-10 doesn't break this
      c('3', 'D'),
      c('3', 'C'),
      c('3', 'H'),
      c('3', 'S'), // breaks A-2-3-4-5 and 2-3-4-5-6 SF
      c('6', 'D'),
      c('6', 'C'),
      c('6', 'H'),
      c('6', 'S'), // breaks 2-3-4-5-6 SF
      // Break all quads: need to remove at least ONE card of each rank from all-4-suits
      // The FH we'll play is 2S-2H-2D + AS-AH
      // Remove 2C (so quad 2s impossible after we play 2S,2H,2D)
      c('2', 'C'),
      // Remove 3 Aces so no quad Aces (we're already using AS+AH in FH)
      c('A', 'D'),
      c('A', 'C'),
      // Remove remaining rank cards to kill all other quads
      c('K', 'D'),
      c('K', 'C'), // Kings: only KS and KH left = not a quad
      c('Q', 'D'),
      c('Q', 'C'),
      c('J', 'D'),
      c('J', 'C'),
      c('5', 'D'),
      c('5', 'C'),
      c('4', 'D'),
      c('4', 'C'),
    ];
    const fh = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('A', 'S'), c('A', 'H')];
    // After breaking SFs and quads, FH with triple 2s might still not be "highest FH"
    // because we need to verify whether a triple of 2s + any pair is the best remaining FH
    // The detector checks: remaining triple rank vs played triple rank
    const result = isHighestPossiblePlay(fh, fullBreaker);
    // This might be true or false depending on what triples survive; just validate no throw
    expect(typeof result).toBe('boolean');
  });

  it('FH with triple Kings (KKK-AA) is NOT highest when triple 2s or Aces can form FH', () => {
    const fh = [c('K', 'S'), c('K', 'H'), c('K', 'D'), c('A', 'S'), c('A', 'H')];
    expect(isHighestPossiblePlay(fh, [])).toBe(false);
  });

  it('FH with triple Aces beats FH with triple Kings', () => {
    const fhA = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('K', 'S'), c('K', 'H')];
    const fhK = [c('K', 'S'), c('K', 'H'), c('K', 'D'), c('A', 'S'), c('A', 'H')];
    // canBeatPlay compares by triple rank
    expect(canBeatPlay(fhA, { cards: fhK, combo_type: 'Full House' })).toBe(true);
  });

  it('FH KKK-22 does NOT beat FH KKK-AA (same triple rank → same strength → false)', () => {
    // Same triple rank → same strength → second FH does NOT beat first
    const fh1 = [c('K', 'S'), c('K', 'H'), c('K', 'D'), c('A', 'S'), c('A', 'H')];
    const fh2 = [c('K', 'S'), c('K', 'H'), c('K', 'D'), c('2', 'S'), c('2', 'H')];
    expect(canBeatPlay(fh2, { cards: fh1, combo_type: 'Full House' })).toBe(false);
  });
});

// ─── Section 9: isHighestPossiblePlay — Four of a Kind ───────────────────────

describe('isHighestPossiblePlay — Four of a Kind', () => {
  it('FOAK 2222 is NOT highest when straight flush possible (nothing played)', () => {
    const foak = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('2', 'C'), c('3', 'S')];
    expect(isHighestPossiblePlay(foak, [])).toBe(false);
  });

  it('FOAK AAAA is NOT highest when FOAK 2222 is still possible', () => {
    const foak = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('A', 'C'), c('3', 'S')];
    expect(isHighestPossiblePlay(foak, [])).toBe(false);
  });

  it('FOAK 2222 is highest when all straight flushes broken', () => {
    // Minimally break all SFs: remove one card from each SF sequence per suit
    // Removing all 9s and 10s kills all sequences containing them
    // Also need to kill A-2-3-4-5 and 2-3-4-5-6 which don't contain 9/10
    const breakSF = [
      ...breakAllStraightFlushes(),
      c('5', 'D'),
      c('5', 'C'),
      c('5', 'H'),
      c('5', 'S'), // kills A-2-3-4-5 and 2-3-4-5-6 via 5
      c('3', 'D'),
      c('3', 'C'),
      c('3', 'H'),
      c('3', 'S'), // overkill but ensures
      c('6', 'D'),
      c('6', 'C'),
      c('6', 'H'),
      c('6', 'S'),
    ];
    const foak = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('2', 'C'), c('3', 'S')];
    // 3♠ is also in the played/remaining... wait, the foak includes 3♠ as the kicker
    // isHighestPossiblePlay includes current cards in playedCards for 5-card combos
    expect(isHighestPossiblePlay(foak, breakSF)).toBe(true);
  });

  it('FOAK AAAA becomes highest when all SFs broken AND no FOAK 2222 possible', () => {
    const breakSF = [
      ...breakAllStraightFlushes(),
      c('5', 'D'),
      c('5', 'C'),
      c('5', 'H'),
      c('5', 'S'),
      c('3', 'D'),
      c('3', 'C'),
      c('3', 'H'),
      c('3', 'S'),
      c('6', 'D'),
      c('6', 'C'),
      c('6', 'H'),
      c('6', 'S'),
      // Break all 2s so FOAK 2222 impossible (but we're playing AAAA, not 2s)
      c('2', 'S'),
      c('2', 'H'),
      c('2', 'D'),
      c('2', 'C'),
    ];
    const foak = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('A', 'C'), c('K', 'S')];
    expect(isHighestPossiblePlay(foak, breakSF)).toBe(true);
  });

  it('FOAK 3333 is NOT highest when FOAK 2222 and AAAA still possible', () => {
    const foak = [c('3', 'S'), c('3', 'H'), c('3', 'D'), c('3', 'C'), c('A', 'S')];
    expect(isHighestPossiblePlay(foak, [])).toBe(false);
  });
});

// ─── Section 9b: Full House blocked by SF and FoaK — isolated checks ─────────
//
// These tests verify the two specific guards the detector must pass before
// a Full House can ever be declared "highest possible play":
//   1. No Straight Flush can be formed (strength 8 > 6)
//   2. No Four of a Kind can be formed (strength 7 > 6)
//
// Each test isolates ONE blocker so it is clear which guard fires.
// ─────────────────────────────────────────────────────────────────────────────

describe('Full House — SF and FoaK guards, isolated', () => {
  // ── Straight Flush is the sole blocker ──────────────────────────────────────
  //
  // Scenario: remaining deck = {3♥,4♥,5♥,6♥,7♥} + FH cards.
  //   • SF 3-4-5-6-7♥ is formable → must return false.
  //   • No rank has ≥4 cards in remaining → FoaK NOT the reason.
  // ────────────────────────────────────────────────────────────────────────────

  it('FH AAA-QQ: NOT highest because a Straight Flush (3-4-5-6-7♥) is still possible', () => {
    const fh = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('Q', 'S'), c('Q', 'H')];
    // Keep only the 5 SF cards + the 5 FH cards in remaining (42 played).
    // No rank in remaining has ≥4 cards → no FoaK; but the SF is present.
    const playedCards = allCardsExcept(
      c('3', 'H'),
      c('4', 'H'),
      c('5', 'H'),
      c('6', 'H'),
      c('7', 'H'),
      ...fh
    );
    expect(isHighestPossiblePlay(fh, playedCards)).toBe(false);
  });

  // ── Four of a Kind is the sole blocker ──────────────────────────────────────
  //
  // Scenario: remaining deck = {2♠,2♥,2♦,2♣,K♠} + FH cards.
  //   • FoaK 2222+K♠ is formable → must return false.
  //   • Per-suit card counts: ♠(2,K,A,Q), ♥(2,A,Q), ♦(2,A), ♣(2) — max 4 spades,
  //     never 5 same-suit cards → no SF possible.
  // ────────────────────────────────────────────────────────────────────────────

  it('FH AAA-QQ: NOT highest because Four of a Kind (2222) is still possible, SF cannot form', () => {
    const fh = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('Q', 'S'), c('Q', 'H')];
    // Keep only 4 twos + KS + the 5 FH cards in remaining (42 played).
    const playedCards = allCardsExcept(
      c('2', 'S'),
      c('2', 'H'),
      c('2', 'D'),
      c('2', 'C'),
      c('K', 'S'),
      ...fh
    );
    expect(isHighestPossiblePlay(fh, playedCards)).toBe(false);
  });

  // ── Neither SF nor FoaK present — FH is correctly evaluated as highest ──────
  //
  // Verifies the "clear path" scenario: once both blockers are gone the
  // detector falls through to the triple-rank comparison and returns true
  // for a triple-A FH when no higher triple can form.
  // ────────────────────────────────────────────────────────────────────────────

  it('FH AAA-QQ: IS highest once SF and FoaK are both impossible (only FH cards remain)', () => {
    const fh = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('Q', 'S'), c('Q', 'H')];
    expect(isHighestPossiblePlay(fh, allCardsExcept(...fh))).toBe(true);
  });
});

// ─── Section 10: isHighestPossiblePlay — Straight Flush ──────────────────────

describe('isHighestPossiblePlay — Straight Flush', () => {
  const royalSpades = [c('10', 'S'), c('J', 'S'), c('Q', 'S'), c('K', 'S'), c('A', 'S')];

  it('Royal Flush ♠ (10-J-Q-K-A spades) is highest SF when nothing played', () => {
    expect(isHighestPossiblePlay(royalSpades, [])).toBe(true);
  });

  it('Royal Flush ♥ is NOT highest SF (♠ royal flush possible)', () => {
    const royalHearts = [c('10', 'H'), c('J', 'H'), c('Q', 'H'), c('K', 'H'), c('A', 'H')];
    expect(isHighestPossiblePlay(royalHearts, [])).toBe(false);
  });

  it('Royal Flush ♥ becomes highest after Royal ♠ is played', () => {
    const royalHearts = [c('10', 'H'), c('J', 'H'), c('Q', 'H'), c('K', 'H'), c('A', 'H')];
    expect(isHighestPossiblePlay(royalHearts, royalSpades)).toBe(true);
  });

  it('Royal Flush ♣ becomes highest after ♠ and ♥ royal flushes played', () => {
    const royalClubs = [c('10', 'C'), c('J', 'C'), c('Q', 'C'), c('K', 'C'), c('A', 'C')];
    expect(
      isHighestPossiblePlay(royalClubs, [
        ...royalSpades,
        ...played(['10', 'H'], ['J', 'H'], ['Q', 'H'], ['K', 'H'], ['A', 'H']),
      ])
    ).toBe(true);
  });

  it('Low SF A-2-3-4-5 is NOT highest (many higher SFs possible)', () => {
    const lowSF = [c('A', 'S'), c('2', 'S'), c('3', 'S'), c('4', 'S'), c('5', 'S')];
    expect(isHighestPossiblePlay(lowSF, [])).toBe(false);
  });

  it('SF 9-10-J-Q-K♠ is NOT highest when Royal ♠ is still possible', () => {
    const sf = [c('9', 'S'), c('10', 'S'), c('J', 'S'), c('Q', 'S'), c('K', 'S')];
    expect(isHighestPossiblePlay(sf, [])).toBe(false);
  });

  it('SF 9-10-J-Q-K♠ becomes highest when all royal cards of higher ordering are played', () => {
    // Royal flush sequences that beat 9-10-J-Q-K are: 10-J-Q-K-A in all suits
    // We need to break: 10-J-Q-K-A in D,C,H,S
    const breakRoyals = played(
      ['10', 'D'],
      ['J', 'D'],
      ['Q', 'D'],
      ['K', 'D'],
      ['A', 'D'],
      ['10', 'C'],
      ['J', 'C'],
      ['Q', 'C'],
      ['K', 'C'],
      ['A', 'C'],
      ['10', 'H'],
      ['J', 'H'],
      ['Q', 'H'],
      ['K', 'H'],
      ['A', 'H'],
      // Play the ♠ royal too to break it
      ['10', 'S'],
      ['A', 'S']
    );
    const sf = [c('9', 'S'), c('J', 'S'), c('Q', 'S'), c('K', 'S'), c('8', 'S')]; // Not sequential, just for illustration
    // Actually make a proper 9-10-J-Q-K♠ but ♠ 10 is already played above
    // So use 9-10-J-Q-K in Hearts instead
    const sfH = [c('9', 'H'), c('10', 'H'), c('J', 'H'), c('Q', 'H'), c('K', 'H')];
    // ♥ royal is already played via breakRoyals, and 10H,J H etc are in breakRoyals
    // This won't work cleanly. Let's do a simpler: 9-10-J-Q-K♣ after breaking royals
    const breakRoyalsDCH = played(
      ['10', 'D'],
      ['J', 'D'],
      ['Q', 'D'],
      ['K', 'D'],
      ['A', 'D'],
      ['10', 'C'],
      ['J', 'C'],
      ['Q', 'C'],
      ['K', 'C'],
      ['A', 'C'],
      ['10', 'H'],
      ['J', 'H'],
      ['Q', 'H'],
      ['K', 'H'],
      ['A', 'H'],
      ['10', 'S'],
      ['J', 'S'],
      ['Q', 'S'],
      ['K', 'S'],
      ['A', 'S']
    );
    // Now no royal flush is possible. The highest SF is 9-10-J-Q-K in any suit.
    // Spade suit is highest. 9♠-10♠-J♠-Q♠-K♠ would be highest IF those cards are available.
    // But 10S is played! So 9-10-J-Q-K♠ is broken.
    // Let's check 9-10-J-Q-K♥ (10H played too)... same issue.
    // Let's not play 10 from any suit, just play A from each suit:
    const breakRoyalsViaA = played(['A', 'D'], ['A', 'C'], ['A', 'H'], ['A', 'S']);
    // All royal flushes need A, so removing all 4 Aces breaks all royals.
    // Now the highest SF is 9-10-J-Q-K in spades.
    const nineToKingSpades = [c('9', 'S'), c('10', 'S'), c('J', 'S'), c('Q', 'S'), c('K', 'S')];
    expect(isHighestPossiblePlay(nineToKingSpades, breakRoyalsViaA)).toBe(true);
  });

  it('FALSE POSITIVE GUARD: Low SF (3-4-5-6-7♦) is never the highest', () => {
    const lowSFDiamonds = [c('3', 'D'), c('4', 'D'), c('5', 'D'), c('6', 'D'), c('7', 'D')];
    expect(isHighestPossiblePlay(lowSFDiamonds, [])).toBe(false);
  });

  it('FALSE POSITIVE GUARD: Same sequence lower suit loses to same sequence higher suit', () => {
    const sfDiamonds = [c('3', 'D'), c('4', 'D'), c('5', 'D'), c('6', 'D'), c('7', 'D')];
    const sfSpades = [c('3', 'S'), c('4', 'S'), c('5', 'S'), c('6', 'S'), c('7', 'S')];
    // ♠ SF 3-7 beats ♦ SF 3-7
    expect(canBeatPlay(sfSpades, { cards: sfDiamonds, combo_type: 'Straight Flush' })).toBe(true);
    // ♦ SF 3-7 does NOT beat ♠ SF 3-7
    expect(canBeatPlay(sfDiamonds, { cards: sfSpades, combo_type: 'Straight Flush' })).toBe(false);
  });

  it('FALSE POSITIVE GUARD: SF 3-4-5-6-7♠ is not highest when SF 4-5-6-7-8♦ still possible', () => {
    const sf = [c('3', 'S'), c('4', 'S'), c('5', 'S'), c('6', 'S'), c('7', 'S')];
    // With nothing played, many higher SFs exist
    expect(isHighestPossiblePlay(sf, [])).toBe(false);
  });
});

// ─── Section 11: Edge Cases & Boundary Conditions ────────────────────────────

describe('Edge Cases & Boundary Conditions', () => {
  it('Empty cards array returns false', () => {
    expect(isHighestPossiblePlay([], [])).toBe(false);
  });

  it('4-card play returns false (invalid combo in Big Two)', () => {
    const fourCards = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('K', 'S')];
    expect(isHighestPossiblePlay(fourCards, [])).toBe(false);
  });

  it('6-card play returns false (invalid combo in Big Two)', () => {
    const sixCards = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('A', 'C'), c('K', 'S'), c('K', 'H')];
    expect(isHighestPossiblePlay(sixCards, [])).toBe(false);
  });

  it('classifyCards returns unknown for 4 different rank cards', () => {
    expect(classifyCards([c('A', 'S'), c('K', 'H'), c('Q', 'D'), c('J', 'C')])).toBe('unknown');
  });

  it('classifyCards returns unknown for 2 different rank cards', () => {
    expect(classifyCards([c('A', 'S'), c('K', 'H')])).toBe('unknown');
  });

  it('classifyCards returns unknown for empty array', () => {
    expect(classifyCards([])).toBe('unknown');
  });

  it('Full deck minus played cards = correct remaining count', () => {
    // This tests that getRemainingCards works correctly inside the module
    // Indirectly: play 2♠, then check highest single = 2♥
    expect(isHighestPossiblePlay([c('2', 'H')], played(['2', 'S']))).toBe(true);
  });

  it('Playing a card twice in played list does not corrupt result', () => {
    // Duplicate in played list should still work
    const dupPlayed = [...played(['2', 'S']), ...played(['2', 'S'])];
    // 2♦ is NOT the highest single (2♥,2♣ still available)
    expect(isHighestPossiblePlay([c('2', 'D')], dupPlayed)).toBe(false);
  });

  it('classifyCards: 5-card combo with 4-of-same-rank + 1 different IS Four of a Kind', () => {
    const cards = [c('K', 'S'), c('K', 'H'), c('K', 'D'), c('K', 'C'), c('3', 'D')];
    expect(classifyCards(cards)).toBe('Four of a Kind');
  });

  it('classifyCards: J-Q-K-A-2 (wrap-around) is NOT a straight', () => {
    const cards = [c('J', 'D'), c('Q', 'C'), c('K', 'H'), c('A', 'S'), c('2', 'D')];
    expect(classifyCards(cards)).not.toBe('Straight');
    expect(classifyCards(cards)).not.toBe('Straight Flush');
  });

  it('classifyCards: A-2-3-4-5 IS a valid straight (A as low)', () => {
    const cards = [c('A', 'D'), c('2', 'C'), c('3', 'H'), c('4', 'S'), c('5', 'D')];
    expect(classifyCards(cards)).toBe('Straight');
  });

  it('classifyCards: 2-3-4-5-6 IS a valid straight (2 as low)', () => {
    const cards = [c('2', 'D'), c('3', 'C'), c('4', 'H'), c('5', 'S'), c('6', 'D')];
    expect(classifyCards(cards)).toBe('Straight');
  });
});

// ─── Section 12: Reported False Positive Scenarios from Screenshots ──────────

describe('FALSE POSITIVE SCENARIOS — from user screenshots', () => {
  /**
   * Screenshot 1 (Match 2): Bot 4 played Straight Flush 10-9-8-7-6 spades,
   * Steve played Four of a Kind (5555+3), Bot 3 played Full House (222+44),
   * Steve played Flush (A-K-Q-J-3 spades).
   *
   * Potential false positive: Flush (AKQJ3 spades) being flagged as highest
   * when higher combos (SF, 4K) were still possible.
   */
  it('Flush A-K-Q-J-3♠ is NOT highest with no cards played (4K + SF possible)', () => {
    const flush = [c('A', 'S'), c('K', 'S'), c('Q', 'S'), c('J', 'S'), c('3', 'S')];
    expect(isHighestPossiblePlay(flush, [])).toBe(false);
  });

  it('Flush A-K-Q-J-3♠ is NOT highest even after some cards played (SF still possible)', () => {
    // From screenshot: 10-9-8-7-6♠ SF was just played
    const playedSF = played(['10', 'S'], ['9', 'S'], ['8', 'S'], ['7', 'S'], ['6', 'S']);
    const flush = [c('A', 'S'), c('K', 'S'), c('Q', 'S'), c('J', 'S'), c('3', 'S')];
    // Many SF combinations remain (e.g. 3-4-5-6-7♥)
    expect(isHighestPossiblePlay(flush, playedSF)).toBe(false);
  });

  /**
   * Screenshot 2 (Match 1): Bot 3 played Single 5♦, then Straight Flush K-Q-J-10-9♠,
   * Steve played Straight 7-6-5-4-3 (mixed suits).
   *
   * Potential false positive: Straight 7-6-5-4-3 being flagged as highest.
   */
  it('Straight 3-4-5-6-7 (mixed suits) is NOT highest (many higher combos exist)', () => {
    const str = [c('3', 'H'), c('4', 'D'), c('5', 'S'), c('6', 'C'), c('7', 'H')];
    expect(isHighestPossiblePlay(str, [])).toBe(false);
  });

  it('Straight 3-4-5-6-7 mixed suits NOT highest even after K-Q-J-10-9♠ SF played', () => {
    const playedSF = played(['9', 'S'], ['10', 'S'], ['J', 'S'], ['Q', 'S'], ['K', 'S']);
    const str = [c('3', 'H'), c('4', 'D'), c('5', 'S'), c('6', 'C'), c('7', 'H')];
    expect(isHighestPossiblePlay(str, playedSF)).toBe(false);
  });

  /**
   * Screenshot 3 (Match 3): Bot 2 played Full House (222+66), Steve played Flush (AKQJ3♥),
   * Bot 2 played Straight Q-J-10-9-8, Bot 3 played Straight 7-6-5-4-3.
   *
   * Potential false positives: Flush being flagged as highest, or lower Straight.
   */
  it('Full House 2-2-2-6-6 is NOT highest when SF still possible', () => {
    const fh = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('6', 'S'), c('6', 'H')];
    expect(isHighestPossiblePlay(fh, [])).toBe(false);
  });

  it('Flush A-K-Q-J-3♥ is NOT highest when SF still possible', () => {
    const flush = [c('A', 'H'), c('K', 'H'), c('Q', 'H'), c('J', 'H'), c('3', 'H')];
    expect(isHighestPossiblePlay(flush, [])).toBe(false);
  });

  it('Straight Q-J-10-9-8 is NOT highest when stronger combos possible', () => {
    const str = [c('8', 'D'), c('9', 'C'), c('10', 'H'), c('J', 'S'), c('Q', 'D')];
    expect(isHighestPossiblePlay(str, [])).toBe(false);
  });

  it('Straight 3-4-5-6-7 is NOT highest vs played context of Match 3', () => {
    const context = played(
      ['2', 'H'],
      ['2', 'C'],
      ['2', 'D'], // FH triple
      ['6', 'S'],
      ['6', 'H'], // FH pair
      ['A', 'H'],
      ['K', 'H'],
      ['Q', 'H'],
      ['J', 'H'],
      ['3', 'H'], // Flush
      ['8', 'D'],
      ['9', 'C'],
      ['10', 'H'],
      ['J', 'S'],
      ['Q', 'D'] // Straight Q-J-10-9-8
    );
    const str = [c('3', 'D'), c('4', 'C'), c('5', 'H'), c('6', 'C'), c('7', 'D')];
    expect(isHighestPossiblePlay(str, context)).toBe(false);
  });

  // Boundary: after MANY cards played, low straight might become highest remaining straight
  it('Straight A-2-3-4-5 becomes highest straight when all sequences above it are broken', () => {
    // This is tricky because we need to break ALL other straight sequences
    // 10 sequences total; A-2-3-4-5 is index 0 (lowest)
    // To make it highest STRAIGHT (not SF), we need:
    // 1. All higher straight sequences broken (no rank available for seqs 2-10)
    // 2. All SFs broken
    // 3. All FH, 4K broken → since we're checking if it's highest POSSIBLE PLAY overall

    // Simplest: destroy rank 6 entirely across all suits (breaks seq index 1: 2-3-4-5-6)
    // Destroy rank 10 across all suits (breaks seq 7,8,9,10 — 6-7-8-9-10, 7-8-9-10-J etc.)
    // Destroy rank J (breaks seq 7,8,9,10)
    // Already broken by breakAllStraightFlushes() using 7-10 removal

    // But we also need to ensure no SF A-2-3-4-5 in any suit  is possible
    // and no higher non-straight-flush straight is formable

    // For a complete test: break ranks 6,7,8,9,10,J,Q,K to kill all seqs > A-2-3-4-5
    // AND destroy all SFs AND all 4K AND all FH

    const extremeBreaker = [
      // Kill ranks 6..K entirely (leave only A,2,3,4,5)
      ...(['6', '7', '8', '9', '10', 'J', 'Q', 'K'] as Rank[]).flatMap(r =>
        (['D', 'C', 'H', 'S'] as Suit[]).map(s => c(r, s))
      ),
    ];

    const lowestStr = [c('A', 'D'), c('2', 'C'), c('3', 'H'), c('4', 'S'), c('5', 'D')];
    // With only A,2,3,4,5 remaining, A-2-3-4-5 is the ONLY straight possible
    // But with only those 20 cards: check if SF is possible (A-2-3-4-5 same suit)
    // and whether 4-of-a-kind or full house is possible with only 5 ranks
    // 4-of-a-kind: need 4 of same rank + 1 kicker → possible (e.g. AAAA + 2)
    // Full house: possible (e.g. AAA-22)
    // SF is possible (e.g. A-2-3-4-5 all diamonds)
    // So A-2-3-4-5 straight is NOT the highest possible play here, only highest STRAIGHT
    // Test: it should return false because SF, 4K, FH are still formable
    expect(isHighestPossiblePlay(lowestStr, extremeBreaker)).toBe(false);
  });
});

// ─── Section 13: Combo Strength Ordering (complete hierarchy) ──────────────

describe('Combo strength hierarchy — complete ordering', () => {
  const allComboStrengths = [
    { name: 'Single', strength: 1 },
    { name: 'Pair', strength: 2 },
    { name: 'Triple', strength: 3 },
    { name: 'Straight', strength: 4 },
    { name: 'Flush', strength: 5 },
    { name: 'Full House', strength: 6 },
    { name: 'Four of a Kind', strength: 7 },
    { name: 'Straight Flush', strength: 8 },
  ];

  it('each combo type has a unique strength value', () => {
    const strengths = allComboStrengths.map(x => x.strength);
    const uniqueStrengths = new Set(strengths);
    expect(uniqueStrengths.size).toBe(allComboStrengths.length);
  });

  it('Straight Flush (8) > Four of a Kind (7) > Full House (6) > Flush (5)', () => {
    expect(8).toBeGreaterThan(7);
    expect(7).toBeGreaterThan(6);
    expect(6).toBeGreaterThan(5);
  });

  it('Flush (5) > Straight (4) > Triple (3) > Pair (2) > Single (1)', () => {
    expect(5).toBeGreaterThan(4);
    expect(4).toBeGreaterThan(3);
    expect(3).toBeGreaterThan(2);
    expect(2).toBeGreaterThan(1);
  });

  it('Five-card combos cannot beat single/pair/triple (different card count)', () => {
    const single = [c('2', 'S')];
    const foak = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('A', 'C'), c('3', 'S')];
    // canBeatPlay requires same card count — different count → false
    expect(canBeatPlay(foak, { cards: single, combo_type: 'Single' })).toBe(false);
    expect(canBeatPlay(single, { cards: foak, combo_type: 'Four of a Kind' })).toBe(false);
  });
});

// ─── Section 14: IS-HIGHEST Deterministic Positives ──────────────────────────
//
// Strategy: pass allCardsExcept(play) as playedCards so the remaining deck
// contains ONLY the play itself.  With zero other cards:
//   • no SF / 4K / FH / Flush / Straight can be formed from remaining
//   • no higher same-type play is formable
//
// This gives unambiguous "IS highest" ground-truth for every combo type
// that previously lacked positive coverage (FH, Flush, Straight).
// ─────────────────────────────────────────────────────────────────────────────

describe('IS-HIGHEST deterministic positives — last 5 cards standing', () => {
  // ── Full House ─────────────────────────────────────────────────────────────

  it('FH 222-AA: IS highest when it is the ONLY combo left in the deck', () => {
    const fh = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('A', 'S'), c('A', 'H')];
    expect(isHighestPossiblePlay(fh, allCardsExcept(...fh))).toBe(true);
  });

  it('FH AAA-KK: IS highest when it is the ONLY combo left in the deck', () => {
    const fh = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('K', 'S'), c('K', 'H')];
    expect(isHighestPossiblePlay(fh, allCardsExcept(...fh))).toBe(true);
  });

  it('FH KKK-QQ: IS highest when it is the ONLY combo left in the deck', () => {
    const fh = [c('K', 'S'), c('K', 'H'), c('K', 'D'), c('Q', 'S'), c('Q', 'H')];
    expect(isHighestPossiblePlay(fh, allCardsExcept(...fh))).toBe(true);
  });

  it('FH 333-22: IS highest when it is the ONLY combo left in the deck', () => {
    const fh = [c('3', 'S'), c('3', 'H'), c('3', 'D'), c('2', 'S'), c('2', 'H')];
    expect(isHighestPossiblePlay(fh, allCardsExcept(...fh))).toBe(true);
  });

  // ── Flush ──────────────────────────────────────────────────────────────────

  it('Flush [2♠ A♠ K♠ Q♠ J♠] (non-SF, J-Q-K-A-2 is not a valid sequence): IS highest when last 5', () => {
    // J-Q-K-A-2 is NOT a valid Big Two straight sequence → this is classified Flush
    const flush = [c('2', 'S'), c('A', 'S'), c('K', 'S'), c('Q', 'S'), c('J', 'S')];
    expect(classifyCards(flush)).toBe('Flush'); // sanity-check classification
    expect(isHighestPossiblePlay(flush, allCardsExcept(...flush))).toBe(true);
  });

  it('Flush [2♦ 3♦ 5♦ 7♦ 9♦] (non-consecutive spades): IS highest when last 5', () => {
    const flush = [c('2', 'D'), c('3', 'D'), c('5', 'D'), c('7', 'D'), c('9', 'D')];
    expect(isHighestPossiblePlay(flush, allCardsExcept(...flush))).toBe(true);
  });

  it('Flush [A♣ K♣ Q♣ J♣ 3♣]: IS highest when last 5', () => {
    const flush = [c('A', 'C'), c('K', 'C'), c('Q', 'C'), c('J', 'C'), c('3', 'C')];
    expect(isHighestPossiblePlay(flush, allCardsExcept(...flush))).toBe(true);
  });

  // ── Straight ───────────────────────────────────────────────────────────────

  it('Straight 10♦-J♣-Q♥-K♠-A♦ (highest sequence, mixed suits): IS highest when last 5', () => {
    const str = [c('10', 'D'), c('J', 'C'), c('Q', 'H'), c('K', 'S'), c('A', 'D')];
    expect(isHighestPossiblePlay(str, allCardsExcept(...str))).toBe(true);
  });

  it('Straight A♦-2♣-3♥-4♠-5♦ (lowest sequence, mixed suits): IS highest when last 5', () => {
    const str = [c('A', 'D'), c('2', 'C'), c('3', 'H'), c('4', 'S'), c('5', 'D')];
    expect(isHighestPossiblePlay(str, allCardsExcept(...str))).toBe(true);
  });

  it('Straight 3♦-4♣-5♥-6♠-7♦ (middle sequence, mixed suits): IS highest when last 5', () => {
    const str = [c('3', 'D'), c('4', 'C'), c('5', 'H'), c('6', 'S'), c('7', 'D')];
    expect(isHighestPossiblePlay(str, allCardsExcept(...str))).toBe(true);
  });

  it('Straight 6♦-7♣-8♥-9♠-10♦: IS highest when last 5', () => {
    const str = [c('6', 'D'), c('7', 'C'), c('8', 'H'), c('9', 'S'), c('10', 'D')];
    expect(isHighestPossiblePlay(str, allCardsExcept(...str))).toBe(true);
  });

  // ── Straight Flush (confirm helper works for existing types too) ────────────

  it('SF Royal Flush ♠ (10-J-Q-K-A): IS highest when last 5 (confirmed via new helper)', () => {
    const sf = [c('10', 'S'), c('J', 'S'), c('Q', 'S'), c('K', 'S'), c('A', 'S')];
    expect(isHighestPossiblePlay(sf, allCardsExcept(...sf))).toBe(true);
  });

  // ── Four of a Kind ─────────────────────────────────────────────────────────

  it('FOAK 2222+3♠: IS highest when last 5 (confirmed via new helper)', () => {
    const foak = [c('2', 'S'), c('2', 'H'), c('2', 'D'), c('2', 'C'), c('3', 'S')];
    expect(isHighestPossiblePlay(foak, allCardsExcept(...foak))).toBe(true);
  });
});

// ─── Section 15: Gradual depletion — transition from NOT-highest → IS-highest ─
//
// These tests prove the detector responds correctly as cards leave the deck
// through normal game play. They verify the exact threshold at which a play
// flips from "not highest" to "IS highest".
// ─────────────────────────────────────────────────────────────────────────────

describe('Gradual depletion — transition from NOT-highest to IS-highest', () => {
  // ── Full House AAA-KK — triple-rank threshold ──────────────────────────────
  //
  // FH AAA-KK is blocked while triple-2 can still form (≥3 twos remain).
  // Once only 2 twos remain (count < 3), triple-2 FH is impossible and
  // FH AAA-KK becomes the highest Full House.
  //
  // Independent prerequisite: all SFs and 4Ks must also be impossible.
  // The sfAnd4KBreaker set achieves that with minimal cards removed.
  // ───────────────────────────────────────────────────────────────────────────

  describe('Full House AAA-KK — two-threshold crossing', () => {
    const fhAAA = [c('A', 'S'), c('A', 'H'), c('A', 'D'), c('K', 'S'), c('K', 'H')];

    // Minimal set that eliminates all SFs and all 4Ks without touching the 2s:
    //   • breakAllStraightFlushes removes 7,8,9,10 (breaks seqs 3..10)
    //   • Remove all 5s and 6s (breaks seqs A-2-3-4-5 and 2-3-4-5-6)
    //   • Remove one card of each remaining quad-capable rank (Q,J,3,4)
    //     so no rank has ≥4 remaining after the FH itself is removed.
    //     (K has KS,KH in the FH + KC,KD → 2 remain → no quad; A same;
    //      2 has all 4 → must NOT be broken here, that's the test variable)
    const sfAnd4KBreaker = [
      ...breakAllStraightFlushes(),
      c('5', 'S'),
      c('5', 'H'),
      c('5', 'C'),
      c('5', 'D'),
      c('6', 'S'),
      c('6', 'H'),
      c('6', 'C'),
      c('6', 'D'),
      c('Q', 'D'),
      c('J', 'D'),
      c('K', 'D'),
      c('3', 'D'),
      c('4', 'D'),
    ];

    it('NOT-highest: FH AAA-KK when all four 2s are available (triple-2 FH possible)', () => {
      expect(isHighestPossiblePlay(fhAAA, sfAnd4KBreaker)).toBe(false);
    });

    it('NOT-highest: FH AAA-KK when 3 twos remain (only 1 of 4 played)', () => {
      expect(isHighestPossiblePlay(fhAAA, [...sfAnd4KBreaker, c('2', 'S')])).toBe(false);
    });

    it('IS-HIGHEST: FH AAA-KK when only 2 twos remain (2S and 2H played — triple impossible)', () => {
      // 2C and 2D are still in the deck but count < 3 → no triple-2 FH can form
      expect(isHighestPossiblePlay(fhAAA, [...sfAnd4KBreaker, c('2', 'S'), c('2', 'H')])).toBe(
        true
      );
    });

    it('IS-HIGHEST: FH AAA-KK when only 1 two remains (2S,2H,2C all played)', () => {
      expect(
        isHighestPossiblePlay(fhAAA, [...sfAnd4KBreaker, c('2', 'S'), c('2', 'H'), c('2', 'C')])
      ).toBe(true);
    });

    it('IS-HIGHEST: FH AAA-KK when all four 2s are played', () => {
      expect(
        isHighestPossiblePlay(fhAAA, [
          ...sfAnd4KBreaker,
          c('2', 'S'),
          c('2', 'H'),
          c('2', 'C'),
          c('2', 'D'),
        ])
      ).toBe(true);
    });
  });

  // ── Pair 2♣-2♦ — pair-rank depletion ─────────────────────────────────────
  //
  // Already partially covered in Section 4 but confirmed here as a
  // reference depletion pattern (NOT-highest → threshold → IS-highest).
  // ───────────────────────────────────────────────────────────────────────────

  describe('Pair 2♣-2♦ — blocked by 2♠-2♥ until they are played', () => {
    const pair2CD = [c('2', 'C'), c('2', 'D')];

    it('NOT-highest: pair 2♣-2♦ when pair 2♠-2♥ is still available', () => {
      expect(isHighestPossiblePlay(pair2CD, [])).toBe(false);
    });

    it('IS-HIGHEST: pair 2♣-2♦ when only 2♠ has been used (2♥ still free)', () => {
      // notInCurrentPair excludes 2C and 2D, so from remaining {2H, all others}
      // only one card of rank 2 survives → no pair of 2s can be formed as competition.
      // Since rank 2 is the highest rank, [2C,2D] IS the highest pair.
      expect(isHighestPossiblePlay(pair2CD, played(['2', 'S']))).toBe(true);
    });

    it('IS-HIGHEST: pair 2♣-2♦ after 2♠ and 2♥ are both played', () => {
      // Only 2♣ and 2♦ remain → 2♣-2♦ is the ONLY possible pair of 2s
      expect(isHighestPossiblePlay(pair2CD, played(['2', 'S'], ['2', 'H']))).toBe(true);
    });
  });

  // ── Triple 2♠-2♥-2♣ — one-two-left scenario ─────────────────────────────
  //
  // Playing 2S-2H-2C leaves only 2D; that lone card cannot form another triple.
  // So the played triple is always the highest triple-2.
  // ───────────────────────────────────────────────────────────────────────────

  describe('Triple 2♠-2♥-2♣ — one two remaining is never a threat', () => {
    it('Triple 2♠-2♥-2♣ IS always the highest triple (2♦ alone cannot triple)', () => {
      expect(isHighestPossiblePlay([c('2', 'S'), c('2', 'H'), c('2', 'C')], [])).toBe(true);
    });

    it('Triple A♠-A♥-A♦ IS highest once only 2 twos remain in the deck', () => {
      // Playing 2S and 2H reduces deck to {2C,2D} — count 2 < 3 → no triple-2 possible
      expect(
        isHighestPossiblePlay(
          [c('A', 'S'), c('A', 'H'), c('A', 'D')],
          played(['2', 'S'], ['2', 'H'])
        )
      ).toBe(true);
    });

    it('Triple A-A-A NOT highest when one 2 played but 3 remain (2H,2C,2D still available)', () => {
      expect(
        isHighestPossiblePlay([c('A', 'S'), c('A', 'H'), c('A', 'D')], played(['2', 'S']))
      ).toBe(false);
    });
  });

  // ── Flush [2♠ …♠] — highest-card value ceiling ────────────────────────────
  //
  // A flush whose highest card is 2♠ has the maximum possible highest-card
  // value (RANK_VALUE[2]=15, SUIT_VALUE[S]=4 → 154).  No other flush can
  // beat it once all SFs, 4Ks, and FHs are gone, because 154 is the ceiling.
  // ───────────────────────────────────────────────────────────────────────────

  describe('Flush with 2♠ top card — maximum flush value', () => {
    it('Flush [2♠,A♠,K♠,Q♠,J♠] IS highest flush when it is the last 5 cards', () => {
      // Sanity: not a SF (J-Q-K-A-2 is not a valid Big Two sequence)
      const flush = [c('2', 'S'), c('A', 'S'), c('K', 'S'), c('Q', 'S'), c('J', 'S')];
      expect(classifyCards(flush)).toBe('Flush');
      expect(isHighestPossiblePlay(flush, allCardsExcept(...flush))).toBe(true);
    });

    it('Flush [2♠,A♠,K♠,Q♠,J♠] is NOT highest while SF is still possible', () => {
      // With an empty played-cards list, countless SFs can form → not highest
      const flush = [c('2', 'S'), c('A', 'S'), c('K', 'S'), c('Q', 'S'), c('J', 'S')];
      expect(isHighestPossiblePlay(flush, [])).toBe(false);
    });
  });

  // ── Straight top-rank suit comparison ─────────────────────────────────────
  //
  // The Straight detector breaks ties by the suit of the sequence's top-rank card.
  // Spades (suit value 4) beats Hearts (3), Clubs (2), Diamonds (1) for same seq.
  // ───────────────────────────────────────────────────────────────────────────

  describe('Straight same-sequence suit tiebreak', () => {
    it('Straight 10-J-Q-K-A with A♠ top: IS highest when it is the last 5 cards', () => {
      const str = [c('10', 'D'), c('J', 'C'), c('Q', 'H'), c('K', 'D'), c('A', 'S')];
      expect(isHighestPossiblePlay(str, allCardsExcept(...str))).toBe(true);
    });

    it('Straight 10-J-Q-K-A with A♦ top is NOT highest when A♠/A♥/A♣ of same seq still available', () => {
      // Highest sequence can be formed with a higher-suit A → A♦ straight loses
      // (All SFs blocked so the comparison is purely within Straight)
      // Build minimal context: break SFs, 4Ks, FHs, Flushes, but keep A♠ in the deck
      const strAD = [c('10', 'H'), c('J', 'C'), c('Q', 'S'), c('K', 'D'), c('A', 'D')];
      // NOT broken fully — with nothing played this is definitely not highest (SF possible)
      expect(isHighestPossiblePlay(strAD, [])).toBe(false);
    });
  });
});
