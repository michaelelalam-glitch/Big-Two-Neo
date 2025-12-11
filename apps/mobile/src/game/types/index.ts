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
  rank: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
  suit: 'D' | 'C' | 'H' | 'S';    // D=Diamonds, C=Clubs, H=Hearts, S=Spades
}

/**
 * Result of card classification
 */
export interface ClassificationResult {
  type: string;        // The combo type
  sortedCards: Card[]; // Cards sorted in proper display order
}

// Re-export shared types from multiplayer types to avoid duplication
export type { AutoPassTimerState, ComboType, LastPlay } from '../../types/multiplayer';

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
 * Valid rank values
 */
export type Rank = '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';

/**
 * Valid suit values
 */
export type Suit = 'D' | 'C' | 'H' | 'S';

/**
 * Player match score information
 */
export interface PlayerMatchScore {
  playerId: string;
  playerName: string;
  score: number; // Total cumulative score across all matches
  matchScores: number[]; // Score history for each match
}

/**
 * Match result when a player finishes their hand
 */
export interface MatchResult {
  winnerId: string;
  winnerName: string;
  playerScores: PlayerMatchScore[];
  matchNumber: number;
  gameEnded: boolean; // True if someone reached 101+ points
  finalWinnerId?: string; // Player with lowest score when game ends
}

/**
 * Scoring breakdown for a single player in a match
 * Scoring rules:
 * - Winner: 0 points
 * - 1-4 cards: 1 point per card
 * - 5-9 cards: 2 points per card
 * - 10-13 cards: 3 points per card
 * - Game ends when any player reaches 101+ points
 * - Player with lowest score wins the game
 */
export interface PlayerMatchScoreDetail {
  playerId: string;
  cardsRemaining: number;
  pointsPerCard: number; // 1, 2, or 3 based on card count
  finalScore: number; // cardsRemaining * pointsPerCard
}

