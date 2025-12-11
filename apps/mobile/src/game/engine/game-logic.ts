/**
 * Core game logic for Big Two card game
 * Handles card classification, validation, and AI recommendations
 */

import { RANK_VALUE, SUIT_VALUE, COMBO_STRENGTH, VALID_STRAIGHT_SEQUENCES } from './constants';
import { findStraightSequenceIndex } from './utils';
import type { Card, ComboType, ClassificationResult, LastPlay } from '../types';

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
  return cards.reduce((acc, card) => {
    acc[card.rank] = (acc[card.rank] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
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
  
  const n = cards.length;
  const sorted = sortHand(cards);
  
  if (n === 1) {
    return 'Single';
  }
  
  if (n === 2 && sameRank(sorted)) {
    return 'Pair';
  }
  
  if (n === 3 && sameRank(sorted)) {
    return 'Triple';
  }
  
  if (n === 5) {
    return classifyFive(sorted);
  }
  
  return 'unknown';
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
  
  const newCombo = classifyCards(newCards);
  if (newCombo === 'unknown') return false;
  
  const newStrength = COMBO_STRENGTH[newCombo] || 0;
  const lastStrength = COMBO_STRENGTH[lastPlay.combo] || 0;
  
  // Different combo types - compare strength
  if (newCombo !== lastPlay.combo) {
    return newStrength > lastStrength;
  }
  
  // Same combo type - compare based on combo-specific rules
  const newSorted = sortHand(newCards);
  const lastSorted = sortHand(lastPlay.cards);
  
  // For Full House, compare the triple rank (not highest card)
  if (newCombo === 'Full House') {
    const newTripleRank = getTripleRank(newSorted);
    const lastTripleRank = getTripleRank(lastSorted);
    return RANK_VALUE[newTripleRank] > RANK_VALUE[lastTripleRank];
  }
  
  // For Four of a Kind, compare the quad rank
  if (newCombo === 'Four of a Kind') {
    const newQuadRank = getQuadRank(newSorted);
    const lastQuadRank = getQuadRank(lastSorted);
    return RANK_VALUE[newQuadRank] > RANK_VALUE[lastQuadRank];
  }
  
  // For other combos, compare highest card
  const newHighest = newSorted[newSorted.length - 1];
  const lastHighest = lastSorted[lastSorted.length - 1];
  
  return getCardValue(newHighest) > getCardValue(lastHighest);
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
  
  // Leading (no last play) - play lowest single
  if (!lastPlay) {
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
    
    // Try to find flushes
    const bySuit = sorted.reduce((acc, card) => {
      if (!acc[card.suit]) acc[card.suit] = [];
      acc[card.suit].push(card);
      return acc;
    }, {} as Record<string, Card[]>);
    
    for (const suitCards of Object.values(bySuit)) {
      if (suitCards.length >= 5) {
        const flush = suitCards.slice(0, 5);
        if (canBeatPlay(flush, lastPlay)) {
          return flush.map(c => c.id);
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
export function findHighestBeatingSingle(
  hand: Card[],
  lastPlay: LastPlay | null
): Card | null {
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
      requiredCard: highestSingle
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
  
  // Rule only applies when next player has exactly 1 card AND last play was a single
  if (nextPlayerCardCount !== 1 || lastPlay.cards.length !== 1) {
    return { canPass: true };
  }
  
  // Check if player has a valid single that beats the last play
  const highestSingle = findHighestBeatingSingle(currentPlayerHand, lastPlay);
  
  if (highestSingle) {
    return {
      canPass: false,
      error: `Cannot pass when opponent has 1 card left and you have a valid single (must play ${highestSingle.rank}${highestSingle.suit})`
    };
  }
  
  // No valid single, can pass normally
  return { canPass: true };
}
