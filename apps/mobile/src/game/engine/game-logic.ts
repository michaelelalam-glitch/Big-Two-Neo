/**
 * Core game logic for Big Two card game
 * Handles card classification, validation, and AI recommendations
 */

import type { Card, ComboType, ClassificationResult, LastPlay } from '../types';
import { RANK_VALUE, SUIT_VALUE, COMBO_STRENGTH, VALID_STRAIGHT_SEQUENCES } from './constants';
import { findStraightSequenceIndex, getStraightTopCard } from './utils';

// ─── Task #280: Memoization caches ───────────────────────────────────────────
// FIFO eviction: evict the oldest-inserted entry when the Map exceeds MAX_SIZE.
// Map iteration order is insertion order, so keys().next() gives the oldest.

const CLASSIFY_CACHE_MAX = 256;
const SORT_CACHE_MAX = 512;
const BEAT_CACHE_MAX = 512;

/** Stable cache key: sorted card IDs joined by comma */
function makeCacheKey(cards: Card[]): string {
  return cards
    .map(c => c.id)
    .sort()
    .join(',');
}

function fifoSet<V>(cache: Map<string, V>, key: string, value: V, max: number): void {
  if (cache.size >= max && !cache.has(key)) {
    cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, value);
}

const _classifyCache = new Map<string, ComboType>();
const _sortHandCache = new Map<string, readonly Card[]>();
const _beatCache = new Map<string, boolean>();

/**
 * Sort cards by rank and suit value (ascending)
 * Results are memoized by card-id set (Task #280).
 *
 * @param cards - Array of cards to sort
 * @returns New sorted array
 * @pure
 */
export function sortHand(cards: Card[]): Card[] {
  if (!cards || cards.length === 0) return [];
  const key = makeCacheKey(cards);
  const cached = _sortHandCache.get(key);
  if (cached !== undefined) return [...cached];
  const sorted = [...cards].sort((a, b) => {
    const rankDiff = RANK_VALUE[a.rank] - RANK_VALUE[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return SUIT_VALUE[a.suit] - SUIT_VALUE[b.suit];
  });
  fifoSet(_sortHandCache, key, Object.freeze([...sorted]), SORT_CACHE_MAX);
  return sorted;
}

/**
 * Sort straight cards in sequence order (not by value)
 *
 * @param cards - Array of 5 cards forming a straight
 * @returns Cards sorted in sequence order (low to high in straight)
 */
export function sortStraightCards(cards: Card[]): Card[] {
  if (cards.length !== 5) return sortHand(cards);

  // Get ranks without sorting by value first
  const ranks = cards.map(c => c.rank);
  const seqIndex = findStraightSequenceIndex(ranks);

  if (seqIndex === -1) return sortHand(cards);

  // Sort according to the valid sequence order
  const sequence = VALID_STRAIGHT_SEQUENCES[seqIndex];
  const result: Card[] = [];

  for (const rank of sequence) {
    const card = cards.find(c => c.rank === rank);
    if (card) result.push(card);
  }

  return result;
}

/**
 * Check if all cards have the same rank
 *
 * @param cards - Array of cards
 * @returns True if all cards have same rank
 */
function sameRank(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  return cards.every(c => c.rank === cards[0].rank);
}

/**
 * Count cards by rank
 *
 * @param cards - Array of cards
 * @returns Map of rank to count
 */
function countByRank(cards: Card[]): Record<string, number> {
  return cards.reduce(
    (acc, card) => {
      acc[card.rank] = (acc[card.rank] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

/**
 * Check if 5 cards form a valid straight
 *
 * @param cards - Array of 5 cards
 * @returns Object with valid flag and sequence info
 */
export function isStraight(cards: Card[]): { valid: boolean; sequence: string } {
  if (cards.length !== 5) return { valid: false, sequence: '' };

  // Get ranks (order doesn't matter for checking)
  const ranks = cards.map(c => c.rank);
  const seqIndex = findStraightSequenceIndex(ranks);

  if (seqIndex !== -1) {
    return { valid: true, sequence: VALID_STRAIGHT_SEQUENCES[seqIndex].join('') };
  }

  return { valid: false, sequence: '' };
}

/**
 * Classify 5 cards into a 5-card combo type
 *
 * @param cards - Array of 5 cards
 * @returns Combo type
 */
function classifyFive(cards: Card[]): ComboType {
  if (cards.length !== 5) return 'unknown';

  const sorted = sortHand(cards);
  const counts = countByRank(sorted);
  const countValues = Object.values(counts).sort((a, b) => b - a);

  // Check for flush
  const isFlush = sorted.every(c => c.suit === sorted[0].suit);

  // Check for straight
  const straightInfo = isStraight(sorted);

  if (straightInfo.valid && isFlush) {
    return 'Straight Flush';
  }

  if (countValues[0] === 4) {
    return 'Four of a Kind';
  }

  if (countValues[0] === 3 && countValues[1] === 2) {
    return 'Full House';
  }

  if (isFlush) {
    return 'Flush';
  }

  if (straightInfo.valid) {
    return 'Straight';
  }

  return 'unknown';
}

/**
 * Classify cards into combo type
 * Returns the type as a readable string
 *
 * @param cards - Array of cards to classify
 * @returns Combo type string
 * @pure
 * @example
 * ```typescript
 * classifyCards([{id:'3D',r:'3',s:'D'}]) // 'Single'
 * classifyCards([{id:'3D',r:'3',s:'D'},{id:'3C',r:'3',s:'C'}]) // 'Pair'
 * ```
 */
export function classifyCards(cards: Card[]): ComboType {
  if (!cards || cards.length === 0) return 'unknown';

  const key = makeCacheKey(cards);
  const cached = _classifyCache.get(key);
  if (cached !== undefined) return cached;

  const n = cards.length;
  const sorted = sortHand(cards);

  let result: ComboType;
  if (n === 1) {
    result = 'Single';
  } else if (n === 2 && sameRank(sorted)) {
    result = 'Pair';
  } else if (n === 3 && sameRank(sorted)) {
    result = 'Triple';
  } else if (n === 5) {
    result = classifyFive(sorted);
  } else {
    result = 'unknown';
  }

  fifoSet(_classifyCache, key, result, CLASSIFY_CACHE_MAX);
  return result;
}

/**
 * Classify and sort cards for display
 * Returns { type, sortedCards } where sortedCards are in proper display order
 *
 * @param cards - Array of cards to classify and sort
 * @returns Classification result with sorted cards
 * @pure
 * @example
 * ```typescript
 * const result = classifyAndSortCards(cards);
 * console.log(result.type); // 'Straight'
 * console.log(result.sortedCards); // Cards in sequence order
 * ```
 */
export function classifyAndSortCards(cards: Card[]): ClassificationResult {
  if (!cards || cards.length === 0) return { type: 'unknown', sortedCards: [] };

  const n = cards.length;
  const sorted = sortHand(cards);
  const type = classifyCards(cards);

  // For straights and straight flushes, sort in sequence order
  if (n === 5 && (type === 'Straight' || type === 'Straight Flush')) {
    return { type, sortedCards: sortStraightCards(cards) };
  }

  // For other combos, return regular sorted order
  return { type, sortedCards: sorted };
}

/**
 * Get card value for comparison (rank + suit)
 *
 * @param card - Card to get value for
 * @returns Numeric value for comparison
 * @pure
 */
function getCardValue(card: Card): number {
  return RANK_VALUE[card.rank] * 10 + SUIT_VALUE[card.suit];
}

/**
 * Get the rank that appears 3 times in a full house
 *
 * @param cards - Array of 5 cards forming a full house
 * @returns Rank string of the triple
 * @throws Error if no triple found
 */
function getTripleRank(cards: Card[]): string {
  const counts = countByRank(cards);
  for (const rank in counts) {
    if (counts[rank] === 3) return rank;
  }
  throw new Error('No triple found in full house');
}

/**
 * Get the rank that appears 4 times in four of a kind
 *
 * @param cards - Array of 5 cards with four of a kind
 * @returns Rank string of the quad
 * @throws Error if no quad found
 */
function getQuadRank(cards: Card[]): string {
  const counts = countByRank(cards);
  for (const rank in counts) {
    if (counts[rank] === 4) return rank;
  }
  throw new Error('No quad found in four of a kind');
}

/**
 * Check if a play can beat the last play
 *
 * @param newCards - Cards being played
 * @param lastPlay - Previous play to beat (null if leading)
 * @returns True if newCards beats lastPlay
 * @pure
 * @example
 * ```typescript
 * const canBeat = canBeatPlay(myCards, { cards: theirCards, combo: 'Pair' });
 * ```
 */
export function canBeatPlay(newCards: Card[], lastPlay: LastPlay | null): boolean {
  if (!lastPlay) return true;

  if (newCards.length !== lastPlay.cards.length) return false;

  // Task #280: cache result by card-id keys + last-play combo+card ids
  const newKey = makeCacheKey(newCards);
  const lastKey = makeCacheKey(lastPlay.cards);
  const beatKey = `${newKey}|${lastKey}|${lastPlay.combo_type}`;
  const cachedBeat = _beatCache.get(beatKey);
  if (cachedBeat !== undefined) return cachedBeat;

  const newCombo = classifyCards(newCards);
  if (newCombo === 'unknown') {
    fifoSet(_beatCache, beatKey, false, BEAT_CACHE_MAX);
    return false;
  }

  const newStrength = COMBO_STRENGTH[newCombo] || 0;
  const lastStrength = COMBO_STRENGTH[lastPlay.combo_type] || 0;

  let result: boolean;

  // Different combo types - compare strength
  if (newCombo !== lastPlay.combo_type) {
    result = newStrength > lastStrength;
    fifoSet(_beatCache, beatKey, result, BEAT_CACHE_MAX);
    return result;
  }

  // Same combo type - compare based on combo-specific rules
  const newSorted = sortHand(newCards);
  const lastSorted = sortHand(lastPlay.cards);

  // For Full House, compare the triple rank (not highest card)
  if (newCombo === 'Full House') {
    const newTripleRank = getTripleRank(newSorted);
    const lastTripleRank = getTripleRank(lastSorted);
    result = RANK_VALUE[newTripleRank] > RANK_VALUE[lastTripleRank];
    fifoSet(_beatCache, beatKey, result, BEAT_CACHE_MAX);
    return result;
  }

  // For Four of a Kind, compare the quad rank
  if (newCombo === 'Four of a Kind') {
    const newQuadRank = getQuadRank(newSorted);
    const lastQuadRank = getQuadRank(lastSorted);
    result = RANK_VALUE[newQuadRank] > RANK_VALUE[lastQuadRank];
    fifoSet(_beatCache, beatKey, result, BEAT_CACHE_MAX);
    return result;
  }

  // For Straight and Straight Flush, compare by sequence position
  // (A-2-3-4-5 is Lowest, 10-J-Q-K-A is Highest)
  // Cannot compare by highest card rank because 2 has RANK_VALUE=12
  // which would incorrectly make A-2-3-4-5 the strongest straight
  if (newCombo === 'Straight' || newCombo === 'Straight Flush') {
    const newSeqIdx = findStraightSequenceIndex(newSorted.map(c => c.rank));
    const lastSeqIdx = findStraightSequenceIndex(lastSorted.map(c => c.rank));
    if (newSeqIdx !== -1 && lastSeqIdx !== -1) {
      if (newSeqIdx !== lastSeqIdx) {
        result = newSeqIdx > lastSeqIdx;
        fifoSet(_beatCache, beatKey, result, BEAT_CACHE_MAX);
        return result;
      }
      // Same sequence — tiebreak by top card suit
      const newTopCard = getStraightTopCard(newCards, newSeqIdx);
      const lastTopCard = getStraightTopCard(lastPlay.cards, lastSeqIdx);
      if (newTopCard && lastTopCard) {
        result = SUIT_VALUE[newTopCard.suit] > SUIT_VALUE[lastTopCard.suit];
        fifoSet(_beatCache, beatKey, result, BEAT_CACHE_MAX);
        return result;
      }
    }
  }

  // For other combos (Single, Pair, Triple, Flush), compare highest card
  const newHighest = newSorted[newSorted.length - 1];
  const lastHighest = lastSorted[lastSorted.length - 1];

  result = getCardValue(newHighest) > getCardValue(lastHighest);
  fifoSet(_beatCache, beatKey, result, BEAT_CACHE_MAX);
  return result;
}

/**
 * Find recommended play based on AI strategy
 * Returns array of card IDs to play, or null if should pass
 *
 * @param hand - Player's current hand
 * @param lastPlay - Previous play (null if leading)
 * @param isFirstPlayOfGame - Whether this is the first play of the game
 * @returns Array of card IDs to play, or null to pass
 * @pure
 * @example
 * ```typescript
 * const recommended = findRecommendedPlay(myHand, lastPlay, false);
 * if (recommended) {
 *   playCards(recommended);
 * } else {
 *   pass();
 * }
 * ```
 */
export function findRecommendedPlay(
  hand: Card[],
  lastPlay: LastPlay | null,
  isFirstPlayOfGame: boolean
): string[] | null {
  if (hand.length === 0) return null;

  const sorted = sortHand(hand);

  // First play of game - must include 3 of diamonds
  if (isFirstPlayOfGame) {
    const threeD = sorted.find(c => c.rank === '3' && c.suit === 'D');
    if (threeD) {
      return [threeD.id];
    }
    return null;
  }

  // Leading (no last play) - recommend best combo to shed cards efficiently
  if (!lastPlay) {
    // Find all available combos from hand
    const rankCounts = countByRank(sorted);
    const pairs: Card[][] = [];
    const triples: Card[][] = [];
    const fiveCards: Card[][] = [];

    // Find pairs and triples by scanning sorted hand (preserves rank order)
    // Object.entries on numeric-ish keys reorders them, so we iterate the sorted
    // hand instead to guarantee lowest-rank-first ordering.
    const seenRanks = new Set<string>();
    for (const card of sorted) {
      if (seenRanks.has(card.rank)) continue;
      seenRanks.add(card.rank);
      const count = rankCounts[card.rank] ?? 0;
      const cards = sorted.filter(c => c.rank === card.rank);
      if (count >= 3) {
        triples.push(cards.slice(0, 3));
      }
      if (count >= 2) {
        pairs.push(cards.slice(0, 2));
      }
    }

    // Find 5-card combos: flushes (5 cards of same suit — shed most cards possible)
    const bySuit: Record<string, Card[]> = {};
    for (const card of sorted) {
      if (!bySuit[card.suit]) bySuit[card.suit] = [];
      bySuit[card.suit].push(card);
    }
    for (const suitCards of Object.values(bySuit)) {
      if (suitCards.length >= 5) {
        fiveCards.push(suitCards.slice(0, 5)); // lowest 5 cards of the suit
        break;
      }
    }

    // Find 5-card combos: straights
    for (const seq of VALID_STRAIGHT_SEQUENCES) {
      const straightCards: Card[] = [];
      for (const rank of seq) {
        const card = sorted.find(c => c.rank === rank && !straightCards.some(sc => sc.id === c.id));
        if (card) straightCards.push(card);
      }
      if (straightCards.length === 5) {
        const straightInfo = isStraight(straightCards);
        if (straightInfo.valid) {
          fiveCards.push(straightCards);
          break; // Take lowest straight
        }
      }
    }

    // Find 5-card combos: full houses (triple + pair, lowest triple first)
    if (triples.length > 0 && pairs.length > 0) {
      for (const triple of triples) {
        const tripleRank = triple[0].rank;
        const pairForFullHouse = pairs.find(p => p[0].rank !== tripleRank);
        if (pairForFullHouse) {
          fiveCards.push([...triple, ...pairForFullHouse]);
          break; // Take lowest full house
        }
      }
    }

    // Prefer combos that shed cards: 5-card > triple > pair > single
    if (fiveCards.length > 0) {
      return fiveCards[0].map(c => c.id);
    }
    if (triples.length > 0) {
      return triples[0].map(c => c.id);
    }
    if (pairs.length > 0) {
      return pairs[0].map(c => c.id);
    }
    return [sorted[0].id];
  }

  // Following - try to find lowest beating play
  const numCards = lastPlay.cards.length;

  if (numCards === 1) {
    // Single card - find lowest card that beats it
    for (const card of sorted) {
      if (canBeatPlay([card], lastPlay)) {
        return [card.id];
      }
    }
  } else if (numCards === 2) {
    // Pair - find lowest pair that beats it
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].rank === sorted[i + 1].rank) {
        const pair = [sorted[i], sorted[i + 1]];
        if (canBeatPlay(pair, lastPlay)) {
          return pair.map(c => c.id);
        }
      }
    }
  } else if (numCards === 3) {
    // Triple - find lowest triple that beats it
    for (let i = 0; i < sorted.length - 2; i++) {
      if (sorted[i].rank === sorted[i + 1].rank && sorted[i].rank === sorted[i + 2].rank) {
        const triple = [sorted[i], sorted[i + 1], sorted[i + 2]];
        if (canBeatPlay(triple, lastPlay)) {
          return triple.map(c => c.id);
        }
      }
    }
  } else if (numCards === 5) {
    // 5-card combo - try different combinations
    // Try to find straights
    for (let i = 0; i <= sorted.length - 5; i++) {
      const fiveCards = sorted.slice(i, i + 5);
      const straightInfo = isStraight(fiveCards);
      if (straightInfo.valid && canBeatPlay(fiveCards, lastPlay)) {
        return fiveCards.map(c => c.id);
      }
    }

    // Try to find flushes — iterate all windows of 5 consecutive suited cards
    // (sorted hand guarantees ascending order within each suit) so we pick the
    // minimum-strength beating flush rather than only trying the lowest 5 cards.
    const bySuit = sorted.reduce(
      (acc, card) => {
        if (!acc[card.suit]) acc[card.suit] = [];
        acc[card.suit].push(card);
        return acc;
      },
      {} as Record<string, Card[]>
    );

    for (const suitCards of Object.values(bySuit)) {
      if (suitCards.length >= 5) {
        for (let wi = 0; wi <= suitCards.length - 5; wi++) {
          const flush = suitCards.slice(wi, wi + 5);
          if (canBeatPlay(flush, lastPlay)) {
            return flush.map(c => c.id);
          }
        }
      }
    }

    // Try to find full house
    const rankCounts = countByRank(sorted);
    const triples = Object.entries(rankCounts).filter(([_, count]) => count >= 3);
    const pairs = Object.entries(rankCounts).filter(([_, count]) => count >= 2);

    if (triples.length > 0 && pairs.length > 0) {
      const tripleRank = triples[0][0];
      const pairRank = pairs.find(([r]) => r !== tripleRank)?.[0];

      if (pairRank) {
        const tripleCards = sorted.filter(c => c.rank === tripleRank).slice(0, 3);
        const pairCards = sorted.filter(c => c.rank === pairRank).slice(0, 2);
        const fullHouse = [...tripleCards, ...pairCards];

        if (canBeatPlay(fullHouse, lastPlay)) {
          return fullHouse.map(c => c.id);
        }
      }
    }

    // Try to find four of a kind
    const quads = Object.entries(rankCounts).filter(([_, count]) => count >= 4);
    if (quads.length > 0) {
      const quadRank = quads[0][0];
      const quadCards = sorted.filter(c => c.rank === quadRank).slice(0, 4);
      const kicker = sorted.find(c => c.rank !== quadRank);

      if (kicker) {
        const fourKind = [...quadCards, kicker];
        if (canBeatPlay(fourKind, lastPlay)) {
          return fourKind.map(c => c.id);
        }
      }
    }
  }

  // Can't beat - recommend passing (return null)
  return null;
}

/**
 * Find the highest single card that beats the last play
 *
 * @param hand - Player's current hand
 * @param lastPlay - Previous play (null if leading)
 * @returns The highest single card that beats lastPlay, or null if none exists
 * @pure
 */
export function findHighestBeatingSingle(hand: Card[], lastPlay: LastPlay | null): Card | null {
  if (hand.length === 0) return null;

  const sorted = sortHand(hand);

  // If no last play (leading), return highest card
  if (!lastPlay) {
    return sorted[sorted.length - 1];
  }

  // Find all singles that beat the last play
  const beatingSingles = sorted.filter(card => canBeatPlay([card], lastPlay));

  // Return the highest one
  if (beatingSingles.length > 0) {
    return beatingSingles[beatingSingles.length - 1];
  }

  return null;
}

/**
 * Check if "One Card Left" rule applies
 * When next player has 1 card, current player MUST play their highest single (if playing a single)
 *
 * @param selectedCards - Cards player is trying to play
 * @param currentPlayerHand - Current player's full hand
 * @param nextPlayerCardCount - Number of cards next player has
 * @param lastPlay - Previous play (null if leading)
 * @returns Validation result with error message if rule is violated
 */
export function validateOneCardLeftRule(
  selectedCards: Card[],
  currentPlayerHand: Card[],
  nextPlayerCardCount: number,
  lastPlay: LastPlay | null
): { valid: boolean; error?: string; requiredCard?: Card } {
  // Rule only applies when next player has exactly 1 card
  if (nextPlayerCardCount !== 1) {
    return { valid: true };
  }

  // Rule only applies to singles
  if (selectedCards.length !== 1) {
    return { valid: true };
  }

  // Find the highest single that beats the last play
  const highestSingle = findHighestBeatingSingle(currentPlayerHand, lastPlay);

  // If no valid single exists, rule doesn't apply
  if (!highestSingle) {
    return { valid: true };
  }

  // Check if player is playing the highest single
  const playedCard = selectedCards[0];
  if (playedCard.id !== highestSingle.id) {
    return {
      valid: false,
      error: `Must play highest single (${highestSingle.rank}${highestSingle.suit}) when opponent has 1 card left`,
      requiredCard: highestSingle,
    };
  }

  return { valid: true };
}

/**
 * Check if player can pass when "One Card Left" rule applies
 * Player CANNOT pass if they have a valid single and next player has 1 card
 *
 * @param currentPlayerHand - Current player's full hand
 * @param nextPlayerCardCount - Number of cards next player has
 * @param lastPlay - Previous play (null if leading - can't pass when leading anyway)
 * @returns { canPass: boolean, error?: string }
 */
export function canPassWithOneCardLeftRule(
  currentPlayerHand: Card[],
  nextPlayerCardCount: number,
  lastPlay: LastPlay | null
): { canPass: boolean; error?: string } {
  // Can't pass when leading anyway
  if (!lastPlay) {
    return { canPass: false, error: 'Cannot pass when leading' };
  }

  // Rule only applies when next player has exactly 1 card AND last play was a single.
  // Use combo_type for semantically correct Single detection (guards against a
  // malformed lastPlay where cards.length === 1 but combo_type !== 'Single').
  if (nextPlayerCardCount !== 1 || lastPlay.combo_type !== 'Single') {
    return { canPass: true };
  }

  // Guard: empty hand means nothing to play, allow pass
  if (!Array.isArray(currentPlayerHand) || currentPlayerHand.length === 0) {
    return { canPass: true };
  }

  // Check if player has a valid single that beats the last play
  const highestSingle = findHighestBeatingSingle(currentPlayerHand, lastPlay);

  if (highestSingle) {
    return {
      canPass: false,
      error: `Cannot pass when opponent has 1 card left and you have a valid single (must play ${highestSingle.rank}${highestSingle.suit})`,
    };
  }

  // No valid single, can pass normally
  return { canPass: true };
}
