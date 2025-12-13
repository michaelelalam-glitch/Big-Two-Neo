/**
 * Helper Button Utilities
 * 
 * Utilities for Sort, Smart Sort, and Hint buttons
 * Implements the GAME_HELPER_BUTTONS_SPEC.md specification
 * 
 * Created as part of Task #381-392: Game Helper Buttons Implementation
 * Date: December 13, 2025
 */

import { Card } from '../types/multiplayer';
import {
  RANK_VALUE,
  SUIT_VALUE,
  VALID_STRAIGHT_SEQUENCES,
} from '../game/engine/constants';
import {
  sortHand,
  findRecommendedPlay,
  isStraight,
} from '../game/engine/game-logic';
import type { LastPlay } from '../game/types';

/**
 * Sort hand from lowest to highest (Task #382)
 * Wrapper around game-logic.sortHand for consistency
 */
export const sortHandLowestToHighest = sortHand;

/**
 * Find hint play for current game state (Task #386)
 * Wrapper around game-logic.findRecommendedPlay for consistency
 */
export const findHintPlay = findRecommendedPlay;

// ============================================================================
// SMART SORT UTILITIES (Task #383-384)
// ============================================================================

interface ComboCards {
  cards: Card[];
  type: 'single' | 'pair' | 'triple' | 'straight' | 'flush' | 'fullHouse' | 'fourOfAKind' | 'straightFlush';
}

/**
 * Check if cards form a flush (all same suit)
 */
function isFlush(cards: Card[]): boolean {
  if (cards.length < 5) return false;
  const firstSuit = cards[0].suit;
  return cards.every(card => card.suit === firstSuit);
}

/**
 * Check if cards form a straight flush
 */
function isStraightFlush(cards: Card[]): boolean {
  if (cards.length !== 5) return false;
  const straight = isStraight(cards);
  return straight.valid && isFlush(cards);
}

/**
 * Group cards by rank
 */
function groupByRank(cards: Card[]): Record<string, Card[]> {
  const groups: Record<string, Card[]> = {};
  for (const card of cards) {
    if (!groups[card.rank]) {
      groups[card.rank] = [];
    }
    groups[card.rank].push(card);
  }
  return groups;
}

/**
 * Group cards by suit
 */
function groupBySuit(cards: Card[]): Record<string, Card[]> {
  const groups: Record<string, Card[]> = {};
  for (const card of cards) {
    if (!groups[card.suit]) {
      groups[card.suit] = [];
    }
    groups[card.suit].push(card);
  }
  return groups;
}

/**
 * Find all straight flushes in hand (Task #383)
 */
export function findStraightFlushes(hand: Card[], usedCards: Set<string>): Card[][] {
  const result: Card[][] = [];
  const available = hand.filter(c => !usedCards.has(c.id));
  
  if (available.length < 5) return result;
  
  // Group by suit
  const bySuit = groupBySuit(available);
  
  // Check each suit
  for (const suitCards of Object.values(bySuit)) {
    if (suitCards.length < 5) continue;
    
    // Try each straight sequence
    for (const sequence of VALID_STRAIGHT_SEQUENCES) {
      const straightCards: Card[] = [];
      
      for (const rank of sequence) {
        const card = suitCards.find(c => c.rank === rank && !usedCards.has(c.id));
        if (card) {
          straightCards.push(card);
        }
      }
      
      if (straightCards.length === 5 && isStraightFlush(straightCards)) {
        // Mark as used
        straightCards.forEach(c => usedCards.add(c.id));
        result.push(straightCards);
        break; // Only take one straight flush per suit
      }
    }
  }
  
  return result;
}

/**
 * Find all four of a kind combinations (Task #383)
 */
export function findFourOfAKind(hand: Card[], usedCards: Set<string>): Card[][] {
  const result: Card[][] = [];
  const available = hand.filter(c => !usedCards.has(c.id));
  
  if (available.length < 5) return result;
  
  const byRank = groupByRank(available);
  
  for (const [rank, cards] of Object.entries(byRank)) {
    if (cards.length >= 4) {
      const fourCards = cards.slice(0, 4);
      
      // Find a kicker (lowest unused card that's not same rank)
      const kicker = available.find(
        c => c.rank !== rank && !fourCards.includes(c) && !usedCards.has(c.id)
      );
      
      if (kicker) {
        const combo = [...fourCards, kicker];
        combo.forEach(c => usedCards.add(c.id));
        result.push(combo);
      }
    }
  }
  
  return result;
}

/**
 * Find all full house combinations (Task #383)
 */
export function findFullHouses(hand: Card[], usedCards: Set<string>): Card[][] {
  const result: Card[][] = [];
  const available = hand.filter(c => !usedCards.has(c.id));
  
  if (available.length < 5) return result;
  
  const byRank = groupByRank(available);
  const triples: string[] = [];
  const pairs: string[] = [];
  
  // Find triples and pairs
  for (const [rank, cards] of Object.entries(byRank)) {
    if (cards.length >= 3) {
      triples.push(rank);
    }
    if (cards.length >= 2) {
      pairs.push(rank);
    }
  }
  
  // Create full houses (triple + pair)
  for (const tripleRank of triples) {
    for (const pairRank of pairs) {
      if (tripleRank !== pairRank) {
        const tripleCards = byRank[tripleRank].filter(c => !usedCards.has(c.id)).slice(0, 3);
        const pairCards = byRank[pairRank].filter(c => !usedCards.has(c.id)).slice(0, 2);
        
        if (tripleCards.length === 3 && pairCards.length === 2) {
          const combo = [...tripleCards, ...pairCards];
          combo.forEach(c => usedCards.add(c.id));
          result.push(combo);
          break; // Only take one full house per triple
        }
      }
    }
  }
  
  return result;
}

/**
 * Find all flush combinations (Task #383)
 */
export function findFlushes(hand: Card[], usedCards: Set<string>): Card[][] {
  const result: Card[][] = [];
  const available = hand.filter(c => !usedCards.has(c.id));
  
  if (available.length < 5) return result;
  
  const bySuit = groupBySuit(available);
  
  for (const suitCards of Object.values(bySuit)) {
    if (suitCards.length >= 5) {
      // Take lowest 5 cards of this suit
      const sorted = sortHand(suitCards);
      const flush = sorted.slice(0, 5);
      
      // Make sure it's not a straight flush
      if (!isStraightFlush(flush)) {
        flush.forEach(c => usedCards.add(c.id));
        result.push(flush);
      }
    }
  }
  
  return result;
}

/**
 * Find all straight combinations (Task #383)
 */
export function findStraights(hand: Card[], usedCards: Set<string>): Card[][] {
  const result: Card[][] = [];
  const available = hand.filter(c => !usedCards.has(c.id));
  
  if (available.length < 5) return result;
  
  // Try each straight sequence
  for (const sequence of VALID_STRAIGHT_SEQUENCES) {
    const straightCards: Card[] = [];
    
    for (const rank of sequence) {
      const card = available.find(c => c.rank === rank && !usedCards.has(c.id));
      if (card) {
        straightCards.push(card);
      }
    }
    
    if (straightCards.length === 5) {
      const straight = isStraight(straightCards);
      if (straight.valid && !isFlush(straightCards)) {
        // Mark as used
        straightCards.forEach(c => usedCards.add(c.id));
        result.push(straightCards);
      }
    }
  }
  
  return result;
}

/**
 * Smart sort hand by grouping combos (Task #384)
 * 
 * Groups cards in this order:
 * 1. Singles (ungrouped cards)
 * 2. Pairs (2 cards same rank)
 * 3. Triples (3 cards same rank)
 * 4. 5-Card Combos (straight, flush, full house, four of a kind, straight flush)
 * 
 * Within each group, cards are sorted from weakest to strongest.
 */
export function smartSortHand(hand: Card[]): Card[] {
  if (hand.length === 0) return [];
  
  const usedCards = new Set<string>();
  const fiveCardCombos: Card[][] = [];
  const triples: Card[][] = [];
  const pairs: Card[][] = [];
  const singles: Card[] = [];
  
  // 1. Find 5-card combinations (greedy approach)
  fiveCardCombos.push(...findStraightFlushes(hand, usedCards));
  fiveCardCombos.push(...findFourOfAKind(hand, usedCards));
  fiveCardCombos.push(...findFullHouses(hand, usedCards));
  fiveCardCombos.push(...findFlushes(hand, usedCards));
  fiveCardCombos.push(...findStraights(hand, usedCards));
  
  // 2. Find remaining combos from unused cards
  const remaining = hand.filter(c => !usedCards.has(c.id));
  const rankGroups = groupByRank(remaining);
  
  for (const cards of Object.values(rankGroups)) {
    if (cards.length === 4) {
      // Split 4-of-a-kind into two pairs
      pairs.push([cards[0], cards[1]]);
      pairs.push([cards[2], cards[3]]);
    } else if (cards.length === 3) {
      triples.push(cards);
    } else if (cards.length === 2) {
      pairs.push(cards);
    } else if (cards.length === 1) {
      singles.push(cards[0]);
    }
  }
  
  // 3. Sort each category by strength (weakest first)
  const sortByLowestCard = (a: Card[], b: Card[]): number => {
    const sortedA = sortHand(a);
    const sortedB = sortHand(b);
    
    // Compare by highest card's rank
    const aHighest = sortedA[sortedA.length - 1];
    const bHighest = sortedB[sortedB.length - 1];
    
    const rankDiff = RANK_VALUE[aHighest.rank] - RANK_VALUE[bHighest.rank];
    if (rankDiff !== 0) return rankDiff;
    
    return SUIT_VALUE[aHighest.suit] - SUIT_VALUE[bHighest.suit];
  };
  
  singles.sort((a, b) => {
    const rankDiff = RANK_VALUE[a.rank] - RANK_VALUE[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return SUIT_VALUE[a.suit] - SUIT_VALUE[b.suit];
  });
  
  pairs.sort(sortByLowestCard);
  triples.sort(sortByLowestCard);
  fiveCardCombos.sort(sortByLowestCard);
  
  // 4. Assemble final hand: singles → pairs → triples → 5-card combos
  return [
    ...singles,
    ...pairs.flat(),
    ...triples.flat(),
    ...fiveCardCombos.flat(),
  ];
}

/**
 * Get card comparison value for sorting
 * Higher value = stronger card
 */
export function getCardValue(card: Card): number {
  return RANK_VALUE[card.rank] * 10 + SUIT_VALUE[card.suit];
}

/**
 * Compare two cards
 * Returns: negative if a < b, 0 if equal, positive if a > b
 */
export function compareCards(a: Card, b: Card): number {
  return getCardValue(a) - getCardValue(b);
}
