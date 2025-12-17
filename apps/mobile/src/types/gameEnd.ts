/**
 * Type definitions for Game End feature
 * 
 * These types define the data structures used in the Game End modal,
 * including score history, play history, and modal props.
 */

// Re-export Card from main types (shared interface)
export interface Card {
  id: string;
  rank: string;
  suit: 'diamonds' | 'clubs' | 'hearts' | 'spades';
  r: string; // Short rank notation (for display)
  s: string; // Short suit notation (for display)
}

/**
 * Score history for a single match
 * Tracks cumulative scores and points added per player
 */
export interface ScoreHistory {
  matchNumber: number;
  pointsAdded: number[]; // Points added this match per player
  scores: number[];      // Cumulative scores after this match
}

/**
 * A single hand/play in the card play history
 * Represents one player's card play action
 */
export interface PlayHistoryHand {
  by: number;           // Player index who played
  type: string;         // Combo type (e.g., "Single", "Pair", "Straight")
  count: number;        // Number of cards in this play
  cards: Card[];        // The actual cards played
}

/**
 * Play history for a single match
 * Contains all hands played during one match
 */
export interface PlayHistoryMatch {
  matchNumber: number;
  hands: PlayHistoryHand[];
}

/**
 * Final score entry for a player
 * Used in the game_ended event and final standings
 */
export interface FinalScore {
  player_index: number;
  player_name: string;
  cumulative_score: number;
  points_added: number; // Points added in final round
}

/**
 * Props for the GameEndModal component
 * Contains all data needed to display the game end screen
 */
export interface GameEndModalProps {
  visible: boolean;                  // Show/hide modal
  gameWinnerName: string;            // Winner's name
  gameWinnerIndex: number;           // Winner's player index
  finalScores: FinalScore[];         // All player final scores
  playerNames: string[];             // All player names
  scoreHistory: ScoreHistory[];      // Match-by-match score history
  playHistory: PlayHistoryMatch[];   // Card play history
  onPlayAgain: () => void;           // Restart game callback
  onReturnToMenu: () => void;        // Exit to menu callback
  onClose: () => void;               // Close modal callback
}

/**
 * Backend event data structure for game_ended event
 * Matches the event payload from Supabase Edge Functions
 */
export interface GameEndedEventData {
  game_winner_name: string;
  game_winner_index: number;
  final_scores: FinalScore[];
  round_number: number;
}

/**
 * Props for the Fireworks component
 */
export interface FireworksProps {
  active: boolean;      // Start/stop animation
  duration?: number;    // Animation duration in ms (default: 5000)
}

/**
 * Props for sub-components
 */
export interface WinnerAnnouncementProps {
  winnerName: string;
  winnerScore: number;
}

export interface FinalStandingsProps {
  finalScores: FinalScore[];
}

export interface ScoreHistoryTabProps {
  scoreHistory: ScoreHistory[];
  playerNames: string[];
}

export interface PlayHistoryTabProps {
  playHistory: PlayHistoryMatch[];
  playerNames: string[];
  collapsedMatches: Set<number>;
  toggleMatchCollapse: (matchNumber: number) => void;
}

export interface ActionButtonsProps {
  onShare: () => void;
  onPlayAgain: () => void;
  onReturnToMenu: () => void;
}

export interface CardImageProps {
  rank: string;
  suit: string;
}

export interface HandCardProps {
  hand: PlayHistoryHand;
  playerName: string;
  isLatest: boolean;
}
