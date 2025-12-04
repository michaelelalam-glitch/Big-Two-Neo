/**
 * Big2 Mobile Game Types
 * 
 * Type definitions adapted for React Native mobile application.
 * Battle-tested types from web application.
 * 
 * @module types
 */

/**
 * Represents a playing card in Big Two
 */
export interface Card {
  id: string;      // e.g., "3D", "AS"
  rank: string;    // rank: '3'-'10', 'J', 'Q', 'K', 'A', '2'
  suit: string;    // suit: 'D', 'C', 'H', 'S'
}

/**
 * Result of card classification
 */
export interface ClassificationResult {
  type: string;        // The combo type
  sortedCards: Card[]; // Cards sorted in proper display order
}

/**
 * Information about the last play in the game
 */
export interface LastPlay {
  cards: Card[];
  combo: string;
}

/**
 * Result of straight validation
 */
export interface StraightValidation {
  valid: boolean;
  key?: number;
}

/**
 * Count of cards grouped by rank
 */
export type RankCount = Record<string, number>;

/**
 * Valid combo types in Big Two
 */
export type ComboType =
  | 'Single'
  | 'Pair'
  | 'Triple'
  | 'Straight'
  | 'Flush'
  | 'Full House'
  | 'Four of a Kind'
  | 'Straight Flush'
  | 'unknown';

/**
 * Valid rank values
 */
export type Rank = '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';

/**
 * Valid suit values
 */
export type Suit = 'D' | 'C' | 'H' | 'S';
