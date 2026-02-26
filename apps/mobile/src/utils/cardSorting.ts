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
  const wrapStraight: Card['rank'][] = ['A', '2', '3', '4', '5'];
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
  const sortedCards = sortCards(cards);
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

/**
 * Sort cards for visual display (descending order - highest card first)
 * 
 * This function implements Big Two display conventions where cards are shown
 * with the highest card first (descending order), as seen in standard gameplay.
 * 
 * Display Rules:
 * - Straights/Straight Flushes: Highest rank first (e.g., 6-5-4-3-2)
 * - Flushes: Highest rank first within same suit
 * - Full House: Three-of-a-kind first, then pair
 * - Four of a Kind: Four cards together, then kicker
 * - Pairs/Triples: Highest suit first
 * - Singles: Returned as single-element array
 * 
 * Suit hierarchy (highest to lowest): Spades > Hearts > Clubs > Diamonds
 * (See SUIT_ORDER constant: ['D', 'C', 'H', 'S'])
 * 
 * @param cards - Cards to sort for display
 * @param comboType - Optional combo type (if known)
 * @returns Cards sorted in descending order for visual display
 * 
 * @example
 * // Straight: Input [3♦, 4♠, 5♦, 6♠, 2♣] → Output [6♠, 5♦, 4♠, 3♦, 2♣]
 * sortCardsForDisplay([...cards], 'Straight')
 */
export const sortCardsForDisplay = (cards: Card[], comboType?: string): Card[] => {
  if (!cards || cards.length === 0) return [];
  
  // Single card - return as-is
  if (cards.length === 1) return [...cards];
  
  // First, sort cards in ascending order (lowest to highest)
  const sortedAsc = sortCards(cards);
  
  // Detect combo type if not provided
  let finalComboType = comboType;
  if (!finalComboType) {
    const detectedStraight = isStraight(cards);
    const detectedFlush = isFlush(cards);
    
    if (cards.length === 5) {
      if (detectedStraight && detectedFlush) {
        finalComboType = 'Straight Flush';
      } else if (detectedStraight) {
        finalComboType = 'Straight';
      } else if (detectedFlush) {
        finalComboType = 'Flush';
      } else {
        // Check for Full House or Four of a Kind
        const rankGroups = groupCardsByRank(cards);
        const groupSizes = Array.from(rankGroups.values()).map(g => g.length).sort((a, b) => b - a);
        
        if (groupSizes[0] === 4) {
          finalComboType = 'Four of a Kind';
        } else if (groupSizes[0] === 3 && groupSizes[1] === 2) {
          finalComboType = 'Full House';
        }
      }
    } else if (cards.length === 2) {
      finalComboType = 'Pair';
    } else if (cards.length === 3) {
      finalComboType = 'Triple';
    }
  }
  
  // Normalize combo type for comparison
  const normalized = (finalComboType || '').toLowerCase().replace(/[\s_-]/g, '');
  
  // Apply display rules based on combo type
  switch (normalized) {
    case 'straight':
    case 'straightflush': {
      // For straights: show in descending sequence order (highest in sequence first)
      // Special handling for 2-high and A-low straights
      
      const ranks = sortedAsc.map(c => c.rank);
      
      // Check for A-2-3-4-5 (wrap-around straight where A acts as low)
      const wrapStraight: Card['rank'][] = ['A', '2', '3', '4', '5'];
      const isWrapAround = wrapStraight.every(rank => ranks.includes(rank)) && 
                           ranks.every(rank => wrapStraight.includes(rank));
      
      if (isWrapAround) {
        // A-2-3-4-5: Display as 5-4-3-2-A (5 is highest in sequence, A is lowest)
        // sortedAsc for this would be [3, 4, 5, A(14), 2(15)]
        // We want: 5, 4, 3, 2, A
        const card5 = cards.find(c => c.rank === '5');
        const card4 = cards.find(c => c.rank === '4');
        const card3 = cards.find(c => c.rank === '3');
        const card2 = cards.find(c => c.rank === '2');
        const cardA = cards.find(c => c.rank === 'A');
        if (!card5 || !card4 || !card3 || !card2 || !cardA) {
          // Data corruption: fallback to regular reverse
          return sortedAsc.slice().reverse();
        }
        return [card5, card4, card3, card2, cardA];
      }
      
      // Check if this is a 2-high straight (e.g., 3-4-5-6-2)
      const has2 = ranks.includes('2');
      if (has2 && cards.length === 5) {
        // In Big Two, 2 is highest value but in straights it acts as high card
        // For sequence like 3-4-5-6-2: Display as 6-5-4-3-2
        // We need to find the second-highest rank value to determine sequence
        const cardsWithout2 = sortedAsc.filter(c => c.rank !== '2');
        const card2 = sortedAsc.find(c => c.rank === '2');
        if (!card2) {
          // Data corruption: fallback to regular reverse
          return sortedAsc.slice().reverse();
        }
        
        // Reverse the non-2 cards and append 2 at the end
        return [...cardsWithout2.reverse(), card2];
      }
      
      // Normal straight: just reverse
      return sortedAsc.slice().reverse();
    }
    case 'flush':
      // For flushes: show highest card first
      // Reverse the ascending sort to get descending order
      return [...sortedAsc].reverse();
      
    case 'fullhouse': {
      // Full House: show three-of-a-kind first, then pair
      const rankGroups = groupCardsByRank(cards);
      let triple: Card[] = [];
      let pair: Card[] = [];
      
      for (const group of rankGroups.values()) {
        if (group.length === 3) {
          triple = sortCards(group).reverse(); // Highest suit first
        } else if (group.length === 2) {
          pair = sortCards(group).reverse(); // Highest suit first
        }
      }
      
      // Fallback: if groups not found, return descending order
      if (triple.length === 0 || pair.length === 0) {
        return [...sortedAsc].reverse();
      }
      
      return [...triple, ...pair];
    }
      
    case 'fourofakind': {
      // Four of a Kind: show four cards together, then kicker
      const rankGroups = groupCardsByRank(cards);
      let quads: Card[] = [];
      let kicker: Card[] = [];
      
      for (const group of rankGroups.values()) {
        if (group.length === 4) {
          quads = sortCards(group).reverse(); // Highest suit first
        } else {
          kicker = sortCards(group).reverse(); // Highest suit first (for consistency)
        }
      }
      
      // Fallback: if groups not found, return descending order
      if (quads.length === 0) {
        return [...sortedAsc].reverse();
      }
      
      return [...quads, ...kicker];
    }
      
    case 'pair':
    case 'triple':
      // Pairs and triples: show highest suit first
      return [...sortedAsc].reverse();
      
    default:
      // For unknown combo types, show highest card first
      return [...sortedAsc].reverse();
  }
};
