/**
 * TypeScript interfaces for the Scoreboard system
 * 
 * This file contains all type definitions for:
 * - Compact Scoreboard (fixed top-left panel)
 * - Expanded Scoreboard (full match history table)
 * - Play History Modal (card-by-card play history)
 * 
 * Created as part of Task #341: TypeScript interfaces
 * Date: December 12, 2025
 */

// Import Card from multiplayer types
export type { Card } from './multiplayer';

// ============================================================================
// SCORE HISTORY TYPES
// ============================================================================

/**
 * Score history for a single completed match
 * Tracks points added and cumulative scores for all players
 */
export interface ScoreHistory {
  matchNumber: number;       // Match index (1, 2, 3, ...)
  pointsAdded: number[];     // Points gained/lost this match per player
  scores: number[];          // Cumulative scores after this match
  timestamp?: string;        // Optional timestamp for when match ended
}

/**
 * Complete score history for the entire game session
 */
export interface GameScoreHistory {
  matches: ScoreHistory[];
  currentMatch: number;
  totalMatches: number;
}

// ============================================================================
// PLAY HISTORY TYPES
// ============================================================================

/**
 * Represents a single hand (card play) in the play history
 */
export interface PlayHistoryHand {
  by: number;                // Player index who played this hand (0-3)
  type: string;              // Combo type: 'single', 'pair', 'triple', 'straight', etc.
  count: number;             // Number of cards in the play
  cards: Card[];             // The actual cards played
  timestamp?: string;        // Optional timestamp for when played
}

/**
 * Play history for a single match
 * Contains all hands played during that match
 */
export interface PlayHistoryMatch {
  matchNumber: number;       // Match index (1, 2, 3, ...)
  hands: PlayHistoryHand[];  // All hands played in this match
  winner?: number;           // Player index who won this match (0-3)
  startTime?: string;        // When match started
  endTime?: string;          // When match ended
}

/**
 * Complete play history for the entire game session
 */
export interface GamePlayHistory {
  matches: PlayHistoryMatch[];
  currentMatch: number;
}

// ============================================================================
// SCOREBOARD COMPONENT PROPS
// ============================================================================

/**
 * Props for the main Scoreboard component
 * Used by both CompactScoreboard and ExpandedScoreboard
 */
export interface ScoreboardProps {
  playerNames: string[];          // Array of player names (length: 2-4)
  currentScores: number[];        // Current cumulative scores for each player
  cardCounts: number[];           // Current card count for each player
  currentPlayerIndex: number;     // Index of player whose turn it is (0-3)
  matchNumber: number;            // Current match number (1, 2, 3, ...)
  isGameFinished: boolean;        // Whether the entire game session is finished
  scoreHistory: ScoreHistory[];   // All completed matches' score history
  playHistory: PlayHistoryMatch[]; // All matches' play history
  onToggleExpand?: () => void;    // Callback for expand/collapse button
  onTogglePlayHistory?: () => void; // Callback for play history button
}

/**
 * Props for the CompactScoreboard component
 * Inherits from ScoreboardProps
 */
export interface CompactScoreboardProps extends ScoreboardProps {
  isExpanded: boolean;            // Whether scoreboard is currently expanded
}

/**
 * Props for the ExpandedScoreboard component
 * Inherits from ScoreboardProps
 */
export interface ExpandedScoreboardProps extends ScoreboardProps {
  isExpanded: boolean;            // Whether scoreboard is currently expanded
}

/**
 * Props for the PlayHistoryModal component
 */
export interface PlayHistoryModalProps {
  visible: boolean;               // Whether modal is visible
  playerNames: string[];          // Array of player names
  playHistory: PlayHistoryMatch[]; // All matches' play history
  currentMatch: number;           // Current match number
  collapsedMatches: Set<number>;  // Set of collapsed match numbers
  onClose: () => void;            // Callback to close modal
  onToggleMatch: (matchNumber: number) => void; // Callback to toggle match collapse
}

/**
 * Props for the HandCard component (displays a single hand)
 */
export interface HandCardProps {
  hand: PlayHistoryHand;          // The hand to display
  playerName: string;             // Name of player who played this hand
  isLatest: boolean;              // Whether this is the most recent hand
  isCurrentMatch: boolean;        // Whether this hand is in the current match
}

/**
 * Props for individual player score row in CompactScoreboard
 */
export interface PlayerScoreRowProps {
  playerName: string;             // Player's name
  score: number;                  // Player's current score
  cardCount: number;              // Player's current card count
  isCurrentPlayer: boolean;       // Whether this is the active player
  position: number;               // Player's position (0-3)
}

/**
 * Props for the score table in ExpandedScoreboard
 */
export interface ScoreTableProps {
  playerNames: string[];          // Array of player names
  currentPlayerIndex: number;     // Index of current player
  scoreHistory: ScoreHistory[];   // All completed matches
  currentScores: number[];        // Current match scores
  cardCounts: number[];           // Current card counts
  matchNumber: number;            // Current match number
  isGameFinished: boolean;        // Whether game is finished
}

/**
 * Props for a single match history row in the score table
 */
export interface MatchHistoryRowProps {
  matchNumber: number;            // Match index
  pointsAdded: number[];          // Points for this match
  scores: number[];               // Cumulative scores after match
  playerCount: number;            // Number of players
}

/**
 * Props for the current match row in the score table
 */
export interface CurrentMatchRowProps {
  matchNumber: number;            // Current match number
  cardCounts: number[];           // Current card counts
  playerCount: number;            // Number of players
}

/**
 * Props for the total score row in the score table
 */
export interface TotalScoreRowProps {
  currentScores: number[];        // Final scores
  playerCount: number;            // Number of players
  isGameFinished: boolean;        // Whether game is finished
}

// ============================================================================
// SCOREBOARD STATE MANAGEMENT
// ============================================================================

/**
 * Context state for Scoreboard management
 */
export interface ScoreboardContextState {
  isScoreboardExpanded: boolean;  // Whether scoreboard is expanded
  setIsScoreboardExpanded: (value: boolean) => void;
  isPlayHistoryOpen: boolean;     // Whether play history modal is open
  setIsPlayHistoryOpen: (value: boolean) => void;
  collapsedMatches: Set<number>;  // Set of collapsed match numbers in play history
  toggleMatchCollapse: (matchNumber: number) => void;
  scoreHistory: ScoreHistory[];   // All score history
  addScoreHistory: (history: ScoreHistory) => void;
  playHistoryByMatch: PlayHistoryMatch[]; // All play history
  addPlayHistory: (history: PlayHistoryMatch) => void;
  clearHistory: () => void;       // Clear all history (new game)
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Score color coding based on value and game state
 */
export type ScoreColorType = 
  | 'positive'      // Green - positive score
  | 'negative'      // Red - negative score
  | 'neutral'       // White/gray - zero score
  | 'winner'        // Gold - winner of game
  | 'loser'         // Dark red - busted/last place
  | 'default';      // Default color

/**
 * Player position in the game (0-3 for 4 players)
 */
export type PlayerPosition = 0 | 1 | 2 | 3;

/**
 * Game phase for scoreboard display
 */
export type GamePhase = 
  | 'waiting'       // Waiting for players
  | 'dealing'       // Cards being dealt
  | 'playing'       // Active gameplay
  | 'finished';     // Game completed

/**
 * Match result for a single player
 */
export interface PlayerMatchResult {
  position: PlayerPosition;       // Player's position
  name: string;                   // Player's name
  pointsAdded: number;            // Points gained/lost this match
  cumulativeScore: number;        // Total score after this match
  cardsRemaining: number;         // Cards left when match ended
  isWinner: boolean;              // Whether player won this match
  isBusted: boolean;              // Whether player busted (negative score threshold)
}

/**
 * Complete match result
 */
export interface MatchResult {
  matchNumber: number;            // Match index
  players: PlayerMatchResult[];   // Results for all players
  duration?: number;              // Match duration in seconds
  totalHands: number;             // Total hands played in match
  timestamp: string;              // When match ended
}

// ============================================================================
// CARD SORTING & DISPLAY
// ============================================================================

/**
 * Card sorting result for play history display
 */
export interface SortedCards {
  sortedCards: Card[];            // Cards sorted for display
  comboType: string;              // The combo type detected
  isStraight: boolean;            // Whether cards form a straight
  isFlush: boolean;               // Whether cards form a flush
}

/**
 * Card display configuration
 */
export interface CardDisplayConfig {
  width: number;                  // Card width in pixels
  height: number;                 // Card height in pixels
  overlap: number;                // Overlap amount for multiple cards
  showShadow: boolean;            // Whether to show card shadow
  highlightLatest: boolean;       // Whether to highlight latest play
}

// ============================================================================
// ANIMATION TYPES
// ============================================================================

/**
 * Animation configuration for scoreboard transitions
 */
export interface ScoreboardAnimationConfig {
  expandDuration: number;         // Duration for expand/collapse (ms)
  collapseDuration: number;       // Duration for match collapse (ms)
  fadeInDuration: number;         // Duration for fade in (ms)
  fadeOutDuration: number;        // Duration for fade out (ms)
  springConfig: {
    damping: number;
    stiffness: number;
    mass: number;
  };
}

/**
 * Animation state for a collapsible match card
 */
export interface MatchCardAnimationState {
  isCollapsed: boolean;           // Current collapsed state
  height: number;                 // Current height
  opacity: number;                // Current opacity
}

// ============================================================================
// EXPORTS
// ============================================================================
