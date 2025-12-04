/**
 * Big2 Mobile Game Constants
 * 
 * Shared constants for game logic consistency.
 * Adapted from battle-tested web application.
 * 
 * @module constants
 */

/**
 * Valid straight sequences in Big Two
 * 
 * Big Two straight rules:
 * - A can be LOW in A-2-3-4-5 (5-high straight)
 * - A can be HIGH in 10-J-Q-K-A (A-high straight)
 * - 2 CAN be LOW in 2-3-4-5-6 (6-high straight)
 * - A CANNOT wrap up to 2: J-Q-K-A-2 is INVALID
 */
export const VALID_STRAIGHT_SEQUENCES = [
  ['A', '2', '3', '4', '5'],   // 5-high (A is low)
  ['2', '3', '4', '5', '6'],   // 6-high (2 is low)
  ['3', '4', '5', '6', '7'],
  ['4', '5', '6', '7', '8'],
  ['5', '6', '7', '8', '9'],
  ['6', '7', '8', '9', '10'],
  ['7', '8', '9', '10', 'J'],
  ['8', '9', '10', 'J', 'Q'],
  ['9', '10', 'J', 'Q', 'K'],
  ['10', 'J', 'Q', 'K', 'A'],  // A-high (highest)
] as const;

/**
 * Rank order (low to high)
 */
export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'] as const;

/**
 * Suit order (low to high)
 * D (Diamonds) < C (Clubs) < H (Hearts) < S (Spades)
 */
export const SUITS = ['D', 'C', 'H', 'S'] as const;

/**
 * Suit values for comparisons
 */
export const SUIT_VALUE: Record<string, number> = {
  D: 0, // Diamonds (lowest)
  C: 1, // Clubs
  H: 2, // Hearts
  S: 3, // Spades (highest)
};

/**
 * Rank values for comparisons
 */
export const RANK_VALUE: Record<string, number> = {
  '3': 0,
  '4': 1,
  '5': 2,
  '6': 3,
  '7': 4,
  '8': 5,
  '9': 6,
  '10': 7,
  'J': 8,
  'Q': 9,
  'K': 10,
  'A': 11,
  '2': 12, // 2 is highest
};

/**
 * Combo type strength hierarchy
 */
export const COMBO_STRENGTH: Record<string, number> = {
  'Single': 1,
  'Pair': 2,
  'Triple': 3,
  'Straight': 4,
  'Flush': 5,
  'Full House': 6,
  'Four of a Kind': 7,
  'Straight Flush': 8,
};

/**
 * Game configuration constants
 */
export const MAX_PLAYERS = 4;
export const CARDS_PER_PLAYER = 13;
export const TOTAL_CARDS = 52;
