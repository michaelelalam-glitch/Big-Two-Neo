/**
 * Utility functions for game logic
 */

import { VALID_STRAIGHT_SEQUENCES } from './constants';
import type { Card } from '../types';

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
 * @param ranks - Array of 5 rank strings
 * @returns Index of matching sequence, or -1 if not found
 */
export function findStraightSequenceIndex(ranks: string[]): number {
  if (ranks.length !== 5) return -1;
  
  const rankStr = ranks.join('');
  return VALID_STRAIGHT_SEQUENCES.findIndex(seq => seq.join('') === rankStr);
}
