/**
 * Auto-Pass Timer: Highest Play Detection
 *
 * Determines if a play is the highest possible play given current game state.
 * Used to trigger 10-second auto-pass timer when unbeatable plays are made.
 *
 * Key Concept: Detection is DYNAMIC based on cards already played.
 * Example: 2♠ triggers timer in round 1, then 2♥ triggers in round 5 after 2♠ played.
 *
 * @module highest-play-detector
 */

import type { Card, ComboType } from '../types';
import {
  RANKS,
  SUITS,
  VALID_STRAIGHT_SEQUENCES,
  COMBO_STRENGTH,
  RANK_VALUE,
  SUIT_VALUE,
} from './constants';
import { sortHand, classifyCards, isStraight } from './game-logic';

/**
 * Generate full 52-card deck for comparison
 */
function generateFullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${rank}${suit}`,
        rank,
        suit,
      });
    }
  }
  return deck;
}

const FULL_DECK = generateFullDeck();

/**
 * Get cards that haven't been played yet
 */
function getRemainingCards(playedCards: Card[]): Card[] {
  return FULL_DECK.filter(card => !playedCards.some(played => played.id === card.id));
}

/**
 * Check if all cards in array have same rank
 */
function allSameRank(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  return cards.every(c => c.rank === cards[0].rank);
}

/**
 * Check if two cards are equal
 */
function cardsEqual(a: Card, b: Card): boolean {
  return a.id === b.id;
}

// ============================================
// SINGLES
// ============================================

/**
 * Check if single card is highest remaining single
 *
 * Example: If 2♠ played, 2♥ becomes highest. If 2♠ and 2♥ played, 2♣ is highest.
 */
function isHighestRemainingSingle(card: Card, playedCards: Card[]): boolean {
  const remaining = getRemainingCards(playedCards);
  if (remaining.length === 0) return false;

  const sorted = sortHand(remaining);
  const highest = sorted[sorted.length - 1];

  return cardsEqual(card, highest);
}

// ============================================
// PAIRS
// ============================================

/**
 * Generate all possible pairs from remaining cards
 * Optimized: O(n) by grouping cards by rank first
 */
function generateAllPairs(remaining: Card[]): Card[][] {
  const pairs: Card[][] = [];

  // Group cards by rank
  const rankGroups: { [rank: string]: Card[] } = {};
  for (const card of remaining) {
    if (!rankGroups[card.rank]) {
      rankGroups[card.rank] = [];
    }
    rankGroups[card.rank].push(card);
  }

  // For each group with at least 2 cards, generate all unique pairs
  for (const rank in rankGroups) {
    const group = rankGroups[rank];
    if (group.length >= 2) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          pairs.push([group[i], group[j]]);
        }
      }
    }
  }

  return pairs;
}

/**
 * Check if pair is highest remaining pair
 *
 * CRITICAL LOGIC:
 * - Check all pairs that can be formed from cards NOT in this play and NOT yet played
 * - If none of those pairs can beat this pair, trigger timer
 *
 * Example: Played=[2♠], Current=[2♣-2♦]
 * - Cards not in play and not played: [2♥, A♠, A♥, K♠, ...]
 * - Possible pairs from those: [2♥ can't pair with anything rank 2], [A♠-A♥], [K♠-K♥], ...
 * - Highest from those: A♠-A♥
 * - Does A♠-A♥ beat 2♣-2♦? NO (rank 2 > rank A)
 * - Result: TRUE (trigger timer)
 */
function isHighestRemainingPair(pair: Card[], playedCards: Card[]): boolean {
  if (pair.length !== 2 || pair[0].rank !== pair[1].rank) {
    return false;
  }

  // Get cards that are:
  // 1. Not already played
  // 2. Not in the current pair being played
  const remaining = getRemainingCards(playedCards);
  const notInCurrentPair = remaining.filter(c => !pair.some(p => p.id === c.id));

  // Generate all pairs from cards NOT in current play
  const otherPairs = generateAllPairs(notInCurrentPair);

  if (otherPairs.length === 0) {
    // No other pairs can be formed - this is highest!
    return true;
  }

  // Sort other pairs by strength
  const sortedPairs = otherPairs
    .map(p => sortHand(p))
    .sort((a, b) => {
      const rankDiff = RANK_VALUE[a[0].rank] - RANK_VALUE[b[0].rank];
      if (rankDiff !== 0) return rankDiff;
      return SUIT_VALUE[a[1].suit] - SUIT_VALUE[b[1].suit];
    });

  const highestOtherPair = sortedPairs[sortedPairs.length - 1];
  const sortedCurrentPair = sortHand(pair);

  // Compare current pair to highest other pair
  const rankDiff = RANK_VALUE[sortedCurrentPair[0].rank] - RANK_VALUE[highestOtherPair[0].rank];
  if (rankDiff > 0) return true; // Current pair has higher rank
  if (rankDiff < 0) return false; // Other pair has higher rank

  // Same rank, compare highest suit
  const suitDiff = SUIT_VALUE[sortedCurrentPair[1].suit] - SUIT_VALUE[highestOtherPair[1].suit];
  return suitDiff >= 0; // Current pair has equal or higher suit
}

// ============================================
// TRIPLES
// ============================================

/**
 * Generate all possible triples from remaining cards
 * Optimized: O(n) by grouping cards by rank first
 */
function generateAllTriples(remaining: Card[]): Card[][] {
  const triples: Card[][] = [];

  // Group cards by rank
  const rankGroups: { [rank: string]: Card[] } = {};
  for (const card of remaining) {
    if (!rankGroups[card.rank]) {
      rankGroups[card.rank] = [];
    }
    rankGroups[card.rank].push(card);
  }

  // For each group with at least 3 cards, generate all unique triples
  for (const rank in rankGroups) {
    const group = rankGroups[rank];
    if (group.length >= 3) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          for (let k = j + 1; k < group.length; k++) {
            triples.push([group[i], group[j], group[k]]);
          }
        }
      }
    }
  }

  return triples;
}

/**
 * Check if triple is highest remaining triple
 *
 * CRITICAL LOGIC: Check triples that can be formed from cards NOT in this play
 */
function isHighestRemainingTriple(triple: Card[], playedCards: Card[]): boolean {
  if (triple.length !== 3 || !allSameRank(triple)) {
    return false;
  }

  // Get cards not in current triple and not already played
  const remaining = getRemainingCards(playedCards);
  const notInCurrentTriple = remaining.filter(c => !triple.some(t => t.id === c.id));

  // Generate all triples from cards NOT in current play
  const otherTriples = generateAllTriples(notInCurrentTriple);

  if (otherTriples.length === 0) {
    // No other triples can be formed - this is highest!
    return true;
  }

  // Sort triples by rank only (highest rank wins)
  const sortedTriples = otherTriples.sort((a, b) => {
    return RANK_VALUE[a[0].rank] - RANK_VALUE[b[0].rank];
  });

  const highestOtherTriple = sortedTriples[sortedTriples.length - 1];

  // Compare ranks
  return RANK_VALUE[triple[0].rank] >= RANK_VALUE[highestOtherTriple[0].rank];
}

// ============================================
// FIVE-CARD COMBOS - POSSIBILITY CHECKERS
// ============================================

/**
 * Check if any royal flush can still be formed
 * A royal flush is 10-J-Q-K-A in same suit
 */
function canFormAnyRoyalFlush(remaining: Card[]): boolean {
  const royalRanks = ['10', 'J', 'Q', 'K', 'A'];

  for (const suit of SUITS) {
    const royalIds = royalRanks.map(rank => `${rank}${suit}`);
    if (royalIds.every(id => remaining.some(c => c.id === id))) {
      return true;
    }
  }

  return false;
}

/**
 * Check if any non-royal straight flush can be formed
 */
function canFormAnyNonRoyalStraightFlush(remaining: Card[]): boolean {
  // Check all straight sequences except the royal (10-J-Q-K-A)
  const nonRoyalSequences = VALID_STRAIGHT_SEQUENCES.slice(0, -1);

  for (const suit of SUITS) {
    for (const sequence of nonRoyalSequences) {
      const ids = sequence.map(rank => `${rank}${suit}`);
      if (ids.every(id => remaining.some(c => c.id === id))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if any straight flush (royal or not) can be formed
 */
function canFormAnyStraightFlush(remaining: Card[]): boolean {
  return canFormAnyRoyalFlush(remaining) || canFormAnyNonRoyalStraightFlush(remaining);
}

/**
 * Check if any four of a kind can be formed
 * Need 4 cards of same rank + any 5th card
 */
function canFormAnyFourOfAKind(remaining: Card[]): boolean {
  if (remaining.length < 5) return false;

  for (const rank of RANKS) {
    const count = remaining.filter(c => c.rank === rank).length;
    if (count >= 4) {
      return true;
    }
  }

  return false;
}

/**
 * Check if any full house can be formed
 * Requires a triple of one rank and a pair of a DIFFERENT rank.
 */
function canFormAnyFullHouse(remaining: Card[]): boolean {
  if (remaining.length < 5) return false;

  const rankCounts = new Map<string, number>();

  for (const card of remaining) {
    rankCounts.set(card.rank, (rankCounts.get(card.rank) || 0) + 1);
  }

  // Find a rank with at least 3 cards (triple)
  let tripleRank: string | null = null;
  for (const [rank, count] of rankCounts.entries()) {
    if (count >= 3) {
      tripleRank = rank;
      break;
    }
  }

  if (!tripleRank) return false;

  // Require a pair of a DIFFERENT rank (same-rank triple does not also count as the pair)
  for (const [rank, count] of rankCounts.entries()) {
    if (rank !== tripleRank && count >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Check if any flush can be formed
 * Need 5+ cards of same suit
 */
function canFormAnyFlush(remaining: Card[]): boolean {
  if (remaining.length < 5) return false;

  for (const suit of SUITS) {
    const count = remaining.filter(c => c.suit === suit).length;
    if (count >= 5) return true;
  }

  return false;
}

/**
 * Check if any straight can be formed
 * Need at least one card of each rank in any valid sequence
 */
function canFormAnyStraight(remaining: Card[]): boolean {
  if (remaining.length < 5) return false;

  for (const sequence of VALID_STRAIGHT_SEQUENCES) {
    const hasAll = sequence.every(rank => remaining.some(c => c.rank === rank));
    if (hasAll) return true;
  }

  return false;
}

/**
 * Check if a combo type of given strength can still be formed
 *
 * CRITICAL: This checks POSSIBILITY, not actual instances.
 * Example: If 10♥, J♣, Q♠, K♦ are played, NO royal flush can be formed
 * (all 4 royals are broken with just 4 cards played).
 */
function canFormComboOfStrength(strength: number, playedCards: Card[]): boolean {
  const remaining = getRemainingCards(playedCards);

  switch (strength) {
    case 8: // Straight Flush
      return canFormAnyStraightFlush(remaining);
    case 7: // Four of a Kind
      return canFormAnyFourOfAKind(remaining);
    case 6: // Full House
      return canFormAnyFullHouse(remaining);
    case 5: // Flush
      return canFormAnyFlush(remaining);
    case 4: // Straight
      return canFormAnyStraight(remaining);
    default:
      return false;
  }
}

// ============================================
// FIVE-CARD COMBO EVALUATION
// ============================================

/**
 * Check if five-card combo is highest remaining of its type
 *
 * Algorithm:
 * 1. Check if ANY stronger combo type can still be formed
 * 2. If yes → return false (not highest)
 * 3. If no → check if this is the best of its type
 */
function isHighestRemainingFiveCardCombo(
  cards: Card[],
  type: ComboType,
  playedCards: Card[]
): boolean {
  const currentStrength = COMBO_STRENGTH[type];
  const currentCardIds = new Set(cards.map(c => c.id));

  // CRITICAL: Check if any STRONGER combo type can still be formed
  for (let strength = 8; strength > currentStrength; strength--) {
    if (canFormComboOfStrength(strength, playedCards)) {
      return false; // A stronger combo type exists
    }
  }

  // Same strength - check if this is the best of this type
  const remaining = getRemainingCards(playedCards).filter(c => {
    return !currentCardIds.has(c.id);
  });
  const sorted = sortHand(cards);

  switch (type) {
    case 'Straight Flush': {
      const straightInfo = isStraight(cards);
      if (!straightInfo.valid) return false;

      const suit = sorted[0].suit;
      const allSameSuit = sorted.every(c => c.suit === suit);
      if (!allSameSuit) return false;

      // Find the current sequence index
      const currentSeqIdx = VALID_STRAIGHT_SEQUENCES.findIndex(
        seq => seq.join('') === straightInfo.sequence
      );
      if (currentSeqIdx === -1) return false;

      // Check ALL suits for ANY straight flush that beats this one:
      // - Higher sequence in ANY suit beats this (regardless of suit value)
      // - Same sequence in a HIGHER suit beats this
      // This covers royal flushes, non-royal straight flushes, and cross-suit comparisons.
      for (const checkSuit of SUITS) {
        for (let seqIdx = 0; seqIdx < VALID_STRAIGHT_SEQUENCES.length; seqIdx++) {
          const isHigherSequence = seqIdx > currentSeqIdx;
          const isSameSequenceHigherSuit =
            seqIdx === currentSeqIdx && SUIT_VALUE[checkSuit] > SUIT_VALUE[suit];

          if (!isHigherSequence && !isSameSequenceHigherSuit) continue;

          const seq = VALID_STRAIGHT_SEQUENCES[seqIdx];
          const ids = seq.map(rank => `${rank}${checkSuit}`);
          if (ids.every(id => remaining.some(c => c.id === id))) {
            return false; // A stronger straight flush can be formed
          }
        }
      }

      return true;
    }

    case 'Four of a Kind': {
      // Find the highest quad rank still formable from remaining (excludes current play).
      // Use rank-value comparison (not equality) — the current cards are excluded from
      // remaining, so the highest remaining quad may be a LOWER rank than the played quad.
      let highestQuadRank: string | null = null;
      for (const rank of [...RANKS].reverse()) {
        if (remaining.filter(c => c.rank === rank).length >= 4) {
          highestQuadRank = rank;
          break;
        }
      }

      // No four of a kind possible from remaining — any 4K is highest
      if (!highestQuadRank) return true;

      // Find the rank being played as the quad
      const playedQuadRank =
        [...RANKS].reverse().find(rank => sorted.filter(c => c.rank === rank).length >= 4) ?? null;
      if (!playedQuadRank) return false;

      // Current quad must be >= the highest remaining quad (rank-value comparison)
      return RANK_VALUE[playedQuadRank] >= RANK_VALUE[highestQuadRank];
    }

    case 'Full House': {
      // Find the highest possible triple rank and pair from remaining cards
      const rankCounts: Record<string, number> = {};
      for (const card of remaining) {
        rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
      }

      // Iterate ranks in descending order to find highest possible triple
      let highestTripleRank: string | null = null;
      for (const rank of [...RANKS].reverse()) {
        if (rankCounts[rank] && rankCounts[rank] >= 3) {
          highestTripleRank = rank;
          break;
        }
      }

      // If no triple can be formed, allow the play
      if (!highestTripleRank) {
        return true;
      }

      // Find highest possible pair for this triple
      let highestPairRank: string | null = null;
      for (const rank of [...RANKS].reverse()) {
        if (rank !== highestTripleRank && rankCounts[rank] && rankCounts[rank] >= 2) {
          highestPairRank = rank;
          break;
        }
      }

      // If no pair can be formed, allow the play
      if (!highestPairRank) {
        return true;
      }

      // Check if the played Full House has the highest possible triple rank.
      // canBeatPlay compares Full Houses by triple rank only (not pair rank),
      // so any Full House with the highest triple rank is unbeatable regardless of pair.
      const playedCounts: Record<string, number> = {};
      for (const card of sorted) {
        playedCounts[card.rank] = (playedCounts[card.rank] || 0) + 1;
      }

      let playedTripleRank: string | null = null;

      for (const rank in playedCounts) {
        if (playedCounts[rank] === 3) {
          playedTripleRank = rank;
          break;
        }
      }

      // Must have the highest triple rank — pair rank is irrelevant.
      // Use rank-value comparison (not equality) since the current cards are
      // excluded from remaining, so highestTripleRank may be a LOWER rank
      // than the played triple rank (which is both valid and correct).
      return (
        playedTripleRank !== null && RANK_VALUE[playedTripleRank] >= RANK_VALUE[highestTripleRank]
      );
    }

    case 'Flush': {
      // For flush, we already verified no stronger combo types exist (SF, 4K, FH)
      // Now check if any flush from ANY suit beats this one.
      // canBeatPlay compares Flush by highest card value (rank*10 + suit).

      const currentSuit = sorted[0].suit;
      const allSameSuit = sorted.every(c => c.suit === currentSuit);
      if (!allSameSuit) return false;

      const currentHighest = sorted[sorted.length - 1];
      const currentHighestValue =
        RANK_VALUE[currentHighest.rank] * 10 + SUIT_VALUE[currentHighest.suit];

      // Issue 2 note: Cross-suit comparison is correct for Big Two flush rules.
      // Early termination via `return false` is already applied as soon as a
      // beating flush is found — no further suits are checked at that point.
      for (const checkSuit of SUITS) {
        const suitCards = remaining.filter(c => c.suit === checkSuit);
        if (suitCards.length < 5) continue;
        const sortedSuit = sortHand(suitCards);
        const bestCard = sortedSuit[sortedSuit.length - 1];
        const bestValue = RANK_VALUE[bestCard.rank] * 10 + SUIT_VALUE[bestCard.suit];
        if (bestValue > currentHighestValue) return false; // early termination
      }

      return true; // No flush from any suit beats this one
    }

    case 'Straight': {
      // For straight, we already verified no stronger combo types exist
      // Now check if this is the highest possible straight

      const straightInfo = isStraight(sorted);
      if (!straightInfo.valid) return false;

      // Find the current sequence index
      const currentSeqIdx = VALID_STRAIGHT_SEQUENCES.findIndex(
        seq => seq.join('') === straightInfo.sequence
      );

      if (currentSeqIdx === -1) return false;

      // Check if any higher sequence can be formed
      for (let seqIdx = currentSeqIdx + 1; seqIdx < VALID_STRAIGHT_SEQUENCES.length; seqIdx++) {
        const seq = VALID_STRAIGHT_SEQUENCES[seqIdx];
        const canForm = seq.every(rank => remaining.some(c => c.rank === rank));

        if (canForm) {
          return false; // A higher straight is possible
        }
      }

      // No higher straight possible - check if this is the best of current sequence
      // For same sequence, compare highest suit
      const currentSeq = VALID_STRAIGHT_SEQUENCES[currentSeqIdx];

      // sortHand uses Big-Two rank values (where 2 is the highest rank), which produces
      // the wrong card for suit comparison in low straights (A-2-3-4-5 and 2-3-4-5-6)
      // where 2 is the LOWEST card in the sequence, not the highest.
      // Use the sequence's defined top rank to find the correct card.
      const topSeqRank = currentSeq[currentSeq.length - 1];
      const highestCard = sorted.find(c => c.rank === topSeqRank) ?? sorted[sorted.length - 1];

      // Issue 1 optimization: Only the highest-rank card's suit determines which
      // same-sequence straight wins. Instead of generating all 4^5 suit combinations,
      // check that the full sequence is completable and then compare the best available
      // suit at the highest rank position — O(n) vs O(4^5).
      const allRanksAvailable = currentSeq.every(rank => remaining.some(c => c.rank === rank));
      if (!allRanksAvailable) {
        return true; // No other straight of same sequence can be formed
      }

      // Find the highest suit available for the top rank in the sequence
      const cardsAtHighestRank = remaining.filter(c => c.rank === topSeqRank);
      let bestAvailableSuitValue = -1;
      for (const card of cardsAtHighestRank) {
        const sv = SUIT_VALUE[card.suit];
        if (sv > bestAvailableSuitValue) bestAvailableSuitValue = sv;
      }

      return SUIT_VALUE[highestCard.suit] >= bestAvailableSuitValue;
    }

    default:
      return false;
  }
}

// ============================================
// MAIN FUNCTION
// ============================================

/**
 * Determine if a play is the highest possible play that cannot be beaten
 * given the current game state (cards already played)
 *
 * @param cards - The cards being played
 * @param playedCards - All cards that have been played so far this game
 * @returns True if this is the highest remaining possible play
 *
 * @example
 * ```typescript
 * // Round 1: No cards played yet
 * isHighestPossiblePlay([{id:'2S',rank:'2',suit:'S'}], []) // true (2♠ is highest)
 *
 * // Round 5: 2♠ was played earlier
 * const played = [{id:'2S',rank:'2',suit:'S'}];
 * isHighestPossiblePlay([{id:'2H',rank:'2',suit:'H'}], played) // true (2♥ now highest)
 *
 * // Four of a kind when royals are impossible
 * const manyPlayed = [{id:'10H',rank:'10',suit:'H'}, {id:'JC',rank:'J',suit:'C'}, ...];
 * isHighestPossiblePlay(fourTwos, manyPlayed) // true if no SF possible
 * ```
 */
export function isHighestPossiblePlay(cards: Card[], playedCards: Card[]): boolean {
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

    case 4:
      // Issue 3: Big Two has no 4-card plays — warn instead of silently returning false.
      // eslint-disable-next-line no-console
      console.warn(
        '[isHighestPossiblePlay] Received invalid 4-card play — Big Two has no 4-card combos'
      );
      return false;

    case 5: {
      // Five-card combos
      // Issue 4: Defensive guard — classifyCards should return a valid 5-card combo type.
      // If it doesn't, log a warning so misclassification bugs are surface-visible.
      const validFiveCardTypes: ComboType[] = [
        'Straight Flush',
        'Four of a Kind',
        'Full House',
        'Flush',
        'Straight',
      ];
      if (!validFiveCardTypes.includes(type)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[isHighestPossiblePlay] classifyCards returned '${type}' for a 5-card play — expected a five-card combo type`
        );
        return false;
      }
      // Pass allUsedCards (playedCards + current play) so that `remaining` inside
      // isHighestRemainingFiveCardCombo excludes the just-played cards. Without
      // this, canFormComboOfStrength could think a stronger combo can be formed
      // by combining the current play's cards with other remaining cards, causing
      // false-negative auto-pass timer triggers.
      return isHighestRemainingFiveCardCombo(sorted, type, [...playedCards, ...cards]);
    }

    default:
      // eslint-disable-next-line no-console
      console.warn(`[isHighestPossiblePlay] Received invalid play of ${cards.length} cards`);
      return false;
  }
}
