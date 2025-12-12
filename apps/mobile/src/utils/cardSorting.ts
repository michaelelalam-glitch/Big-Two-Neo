/**
 * Card Sorting Utility
 * 
 * Utilities for sorting and classifying cards
 * Used in play history to properly display straights, flushes, etc.
 * 
 * Created as part of Task #350: Card sorting utility
 * Date: December 12, 2025
 */

import { Card } from '../types/multiplayer';

// Rank order for Big 2 (3 is lowest, 2 is highest)
const RANK_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

// Suit order for Big 2 (Diamonds < Clubs < Hearts < Spades)
const SUIT_ORDER = ['D', 'C', 'H', 'S'];

/**
 * Get rank value for sorting (3 = 0, 2 = 12)
 */
export const getRankValue = (rank: string): number => {
  const index = RANK_ORDER.indexOf(rank);
  return index >= 0 ? index : -1;
};

/**
 * Get suit value for sorting (D = 0, S = 3)
 */
export const getSuitValue = (suit: string): number => {
  // Normalize to single letter
  const suitChar = suit.charAt(0).toUpperCase();
  const index = SUIT_ORDER.indexOf(suitChar);
  return index >= 0 ? index : -1;
};

/**
 * Compare two cards for sorting
 * First by rank, then by suit
 */
export const compareCards = (a: Card, b: Card): number => {
  const aRank = a.rank;
  const bRank = b.rank;
  const aSuit = a.suit;
  const bSuit = b.suit;

  const rankA = getRankValue(aRank);
  const rankB = getRankValue(bRank);

  // Compare by rank first
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  // If ranks are equal, compare by suit
  const suitA = getSuitValue(aSuit);
  const suitB = getSuitValue(bSuit);
  return suitA - suitB;
};

/**
 * Sort cards in ascending order (lowest to highest)
 */
export const sortCards = (cards: Card[]): Card[] => {
  return [...cards].sort(compareCards);
};

/**
 * Check if cards form a straight (consecutive ranks)
 */
export const isStraight = (cards: Card[]): boolean => {
  if (cards.length < 5) return false;

  const sorted = sortCards(cards);
  const firstRank = getRankValue(sorted[0].rank);

  // Normal straight check
  let isNormalStraight = true;
  for (let i = 1; i < sorted.length; i++) {
    const expectedRank = firstRank + i;
    const actualRank = getRankValue(sorted[i].rank);
    if (actualRank !== expectedRank) {
      isNormalStraight = false;
      break;
    }
  }
  if (isNormalStraight) return true;

  // Special case: A-2-3-4-5 straight (wrap-around)
  const ranks = cards.map(card => card.rank);
  const wrapStraight = ['A', '2', '3', '4', '5'];
  if (
    cards.length === 5 &&
    wrapStraight.every(rank => ranks.includes(rank)) &&
    ranks.every(rank => wrapStraight.includes(rank))
  ) {
    return true;
  }

  return false;
};

/**
 * Check if all cards have the same suit
 */
export const isFlush = (cards: Card[]): boolean => {
  if (cards.length < 5) return false;

  const firstSuit = cards[0].suit.charAt(0).toUpperCase();
  return cards.every((card) => {
    const suit = card.suit.charAt(0).toUpperCase();
    return suit === firstSuit;
  });
};

/**
 * Check if cards form a straight flush
 */
export const isStraightFlush = (cards: Card[]): boolean => {
  return isStraight(cards) && isFlush(cards);
};

/**
 * Classify and sort cards based on combo type
 * Returns sorted cards optimized for display
 */
export const classifyAndSortCards = (cards: Card[], comboType?: string): {
  sortedCards: Card[];
  comboType: string;
  isStraight: boolean;
  isFlush: boolean;
} => {
  // Default sort
  let sortedCards = sortCards(cards);
  const detectedStraight = isStraight(cards);
  const detectedFlush = isFlush(cards);
  
  // Determine combo type
  let finalComboType = comboType || 'unknown';
  if (!comboType) {
    if (detectedStraight && detectedFlush) {
      finalComboType = 'straight_flush';
    } else if (detectedStraight) {
      finalComboType = 'straight';
    } else if (detectedFlush) {
      finalComboType = 'flush';
    } else if (cards.length === 1) {
      finalComboType = 'single';
    } else if (cards.length === 2) {
      finalComboType = 'pair';
    } else if (cards.length === 3) {
      finalComboType = 'triple';
    }
  }

  // Cards are already sorted at line 119, no need to sort again

  return {
    sortedCards,
    comboType: finalComboType,
    isStraight: detectedStraight,
    isFlush: detectedFlush,
  };
};

/**
 * Group cards by rank (for full house, four of a kind, etc.)
 */
export const groupCardsByRank = (cards: Card[]): Map<string, Card[]> => {
  const groups = new Map<string, Card[]>();
  
  for (const card of cards) {
    const rank = card.rank;
    const group = groups.get(rank) || [];
    group.push(card);
    groups.set(rank, group);
  }
  
  return groups;
};

/**
 * Format cards for display in play history
 * Applies proper sorting based on combo type
 */
export const formatCardsForDisplay = (cards: Card[], comboType?: string): Card[] => {
  const { sortedCards } = classifyAndSortCards(cards, comboType);
  return sortedCards;
};
