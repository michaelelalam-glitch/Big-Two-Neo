/**
 * Utility functions for game logic
 */

import type { Card } from '../types';
import { VALID_STRAIGHT_SEQUENCES } from './constants';

/**
 * Check if two sets of cards are identical (same ranks and suits)
 * 
 * @param a - First set of cards
 * @param b - Second set of cards
 * @returns True if sets are identical
 */
export function isSameSet(a: Card[], b: Card[]): boolean {
  if (a.length !== b.length) return false;
  
  // Sort both arrays by id for comparison
  const sortedA = [...a].sort((x, y) => x.id.localeCompare(y.id));
  const sortedB = [...b].sort((x, y) => x.id.localeCompare(y.id));
  
  return sortedA.every((card, i) => card.id === sortedB[i].id);
}

/**
 * Find the index of a valid straight sequence that matches the given ranks
 * 
 * @param ranks - Array of 5 rank strings (can be in any order)
 * @returns Index of matching sequence, or -1 if not found
 */
export function findStraightSequenceIndex(ranks: string[]): number {
  if (ranks.length !== 5) return -1;
  
  // Create a set for order-independent matching
  const rankSet = new Set(ranks);
  
  // Ensure all ranks are unique (no duplicates)
  if (rankSet.size !== 5) return -1;
  
  // Check each valid sequence
  return VALID_STRAIGHT_SEQUENCES.findIndex(seq => {
    // All ranks in the sequence must be present in the input
    return seq.every(rank => rankSet.has(rank));
  });
}

/**
 * Get the top card of a straight (the card matching the highest rank in the sequence)
 * 
 * Used for tiebreaking when two straights have the same sequence (compare by suit).
 * 
 * @param cards - Array of 5 cards forming a straight
 * @param seqIndex - Index into VALID_STRAIGHT_SEQUENCES
 * @returns The card matching the top rank in the sequence, or null
 */
export function getStraightTopCard(cards: Card[], seqIndex: number): Card | null {
  if (seqIndex < 0 || seqIndex >= VALID_STRAIGHT_SEQUENCES.length) return null;
  const topRank = VALID_STRAIGHT_SEQUENCES[seqIndex][4]; // Last rank in sequence = highest
  return cards.find(c => c.rank === topRank) || null;
}
