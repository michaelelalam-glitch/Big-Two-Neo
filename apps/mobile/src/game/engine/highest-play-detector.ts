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

import { RANKS, SUITS, VALID_STRAIGHT_SEQUENCES, COMBO_STRENGTH, RANK_VALUE, SUIT_VALUE } from './constants';
import { sortHand, classifyCards, isStraight } from './game-logic';
import type { Card, ComboType } from '../types';

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
  return FULL_DECK.filter(
    (card) => !playedCards.some((played) => played.id === card.id)
  );
}

/**
 * Check if all cards in array have same rank
 */
function allSameRank(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  return cards.every((c) => c.rank === cards[0].rank);
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
  const notInCurrentPair = remaining.filter(
    c => !pair.some(p => p.id === c.id)
  );
  
  // Generate all pairs from cards NOT in current play
  const otherPairs = generateAllPairs(notInCurrentPair);
  
  if (otherPairs.length === 0) {
    // No other pairs can be formed - this is highest!
    return true;
  }
  
  // Sort other pairs by strength
  const sortedPairs = otherPairs.map(p => sortHand(p)).sort((a, b) => {
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
  const notInCurrentTriple = remaining.filter(
    c => !triple.some(t => t.id === c.id)
  );
  
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
 * Need triple + pair (can be same rank if 5 of same exist)
 */
function canFormAnyFullHouse(remaining: Card[]): boolean {
  if (remaining.length < 5) return false;
  
  const rankCounts = new Map<string, number>();
  
  for (const card of remaining) {
    rankCounts.set(card.rank, (rankCounts.get(card.rank) || 0) + 1);
  }
  
  let hasTriple = false;
  let hasPair = false;
  
  for (const count of rankCounts.values()) {
    if (count >= 3) hasTriple = true;
    if (count >= 2) hasPair = true;
  }
  
  // Need both triple and pair
  return hasTriple && hasPair;
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
    const hasAll = sequence.every(rank =>
      remaining.some(c => c.rank === rank)
    );
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
  
  // CRITICAL: Check if any STRONGER combo type can still be formed
  for (let strength = 8; strength > currentStrength; strength--) {
    if (canFormComboOfStrength(strength, playedCards)) {
      return false; // A stronger combo type exists
    }
  }
  
  // Same strength - check if this is the best of this type
  const remaining = getRemainingCards(playedCards);
  const sorted = sortHand(cards);
  const _highest = sorted[sorted.length - 1];
  
  switch (type) {
    case 'Straight Flush': {
      const straightInfo = isStraight(cards);
      if (!straightInfo.valid) return false;
      
      const suit = sorted[0].suit;
      const allSameSuit = sorted.every(c => c.suit === suit);
      if (!allSameSuit) return false;
      
      // If this is a royal flush, check if any higher suit royal exists
      if (straightInfo.sequence === '10JQKA') {
        for (const otherSuit of SUITS) {
          if (SUIT_VALUE[otherSuit] > SUIT_VALUE[suit]) {
            const royalIds = ['10', 'J', 'Q', 'K', 'A'].map(r => `${r}${otherSuit}`);
            if (royalIds.every(id => remaining.some(c => c.id === id))) {
              return false;
            }
          }
        }
        return true;
      }
      
      // For non-royal straight flushes, check if any stronger straight flush can still be formed
      // Find the current sequence index
      const currentSeqIdx = VALID_STRAIGHT_SEQUENCES.findIndex(
        seq => seq.join('') === straightInfo.sequence
      );
      
      // Check for same suit, higher sequence
      for (let seqIdx = currentSeqIdx + 1; seqIdx < VALID_STRAIGHT_SEQUENCES.length; seqIdx++) {
        const seq = VALID_STRAIGHT_SEQUENCES[seqIdx];
        const ids = seq.map(rank => `${rank}${suit}`);
        if (ids.every(id => remaining.some(c => c.id === id))) {
          return false; // A higher sequence exists in the same suit
        }
      }
      
      // Check for same sequence, higher suit
      for (const otherSuit of SUITS) {
        if (SUIT_VALUE[otherSuit] > SUIT_VALUE[suit]) {
          const currentSeq = VALID_STRAIGHT_SEQUENCES[currentSeqIdx];
          const ids = currentSeq.map(rank => `${rank}${otherSuit}`);
          if (ids.every(id => remaining.some(c => c.id === id))) {
            return false; // Same sequence exists in a higher suit
          }
        }
      }
      
      return true;
    }
    
    case 'Four of a Kind': {
      // Iterate through all ranks in descending order to find highest possible four of a kind
      for (const rank of [...RANKS].reverse()) {
        const cardsOfRank = remaining.filter(c => c.rank === rank);
        if (cardsOfRank.length >= 4) {
          // If the current play is four of this rank, it's the highest possible
          return sorted.filter(c => c.rank === rank).length === 4;
        }
      }
      // If no four of a kind is possible in remaining, any four of a kind is highest
      return true;
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

      // Check if the played Full House matches the highest possible triple + pair
      const playedCounts: Record<string, number> = {};
      for (const card of sorted) {
        playedCounts[card.rank] = (playedCounts[card.rank] || 0) + 1;
      }
      
      let playedTripleRank: string | null = null;
      let playedPairRank: string | null = null;
      
      for (const rank in playedCounts) {
        if (playedCounts[rank] === 3) {
          playedTripleRank = rank;
        } else if (playedCounts[rank] === 2) {
          playedPairRank = rank;
        }
      }

      // Must have highest triple rank
      if (playedTripleRank !== highestTripleRank) {
        return false;
      }
      
      // If triple ranks match, pair must also be highest (for same triple rank comparison)
      return playedPairRank === highestPairRank;
    }
    
    case 'Flush': {
      // For flush, we already verified no stronger combo types exist (SF, 4K, FH)
      // Now enumerate all possible flushes and check if this is the highest
      
      const currentSuit = sorted[0].suit;
      const allSameSuit = sorted.every(c => c.suit === currentSuit);
      if (!allSameSuit) return false;
      
      // Generate all possible 5-card flushes from remaining cards
      const suitCards = remaining.filter(c => c.suit === currentSuit);
      
      if (suitCards.length < 5) {
        // No other flush possible in this suit
        return true;
      }
      
      // Check if there's a higher 5-card combination in the same suit
      // Sort by rank to find highest 5 cards
      const sortedSuitCards = sortHand(suitCards);
      const top5 = sortedSuitCards.slice(-5);
      
      // Compare current flush with best possible flush
      const currentSorted = sortHand(sorted);
      for (let i = 4; i >= 0; i--) {
        const currentRank = RANK_VALUE[currentSorted[i].rank];
        const bestRank = RANK_VALUE[top5[i].rank];
        
        if (currentRank > bestRank) return true;
        if (currentRank < bestRank) return false;
      }
      
      return true; // Same flush
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
      const highestCard = sorted[sorted.length - 1];
      const currentSeq = VALID_STRAIGHT_SEQUENCES[currentSeqIdx];
      
      // Find all possible straights of the same sequence from remaining cards
      const possibleStraights: Card[][] = [];
      
      // Generate all combinations by trying different suits for each rank
      const generateStraightsRecursive = (rankIdx: number, current: Card[]): void => {
        if (rankIdx === currentSeq.length) {
          possibleStraights.push([...current]);
          return;
        }
        
        const rank = currentSeq[rankIdx];
        const cardsOfRank = remaining.filter(c => c.rank === rank);
        
        for (const card of cardsOfRank) {
          current.push(card);
          generateStraightsRecursive(rankIdx + 1, current);
          current.pop();
        }
      }
      
      generateStraightsRecursive(0, []);
      
      if (possibleStraights.length === 0) {
        return true; // No other straights of same sequence possible
      }
      
      // Find the straight with the highest suit
      let bestStraight = possibleStraights[0];
      for (const straight of possibleStraights) {
        const straightSorted = sortHand(straight);
        const bestSorted = sortHand(bestStraight);
        const straightHigh = straightSorted[straightSorted.length - 1];
        const bestHigh = bestSorted[bestSorted.length - 1];
        
        if (SUIT_VALUE[straightHigh.suit] > SUIT_VALUE[bestHigh.suit]) {
          bestStraight = straight;
        }
      }
      
      const bestSorted = sortHand(bestStraight);
      const bestHigh = bestSorted[bestSorted.length - 1];
      
      return SUIT_VALUE[highestCard.suit] >= SUIT_VALUE[bestHigh.suit];
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
export function isHighestPossiblePlay(
  cards: Card[],
  playedCards: Card[]
): boolean {
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

    case 5: // Five-card combos
      return isHighestRemainingFiveCardCombo(sorted, type, playedCards);

    default:
      return false;
  }
}
