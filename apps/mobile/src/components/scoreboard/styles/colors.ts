/**
 * Scoreboard Color System
 * 
 * Defines all colors used in the scoreboard components
 * Ensures visual parity with the web app
 * 
 * Created as part of Task #343: Color system constants
 * Date: December 12, 2025
 */

// ============================================================================
// BACKGROUND COLORS
// ============================================================================

export const ScoreboardColors = {
  // -------------------------------------------------------------------------
  // Backgrounds
  // -------------------------------------------------------------------------
  background: {
    compact: 'rgba(0, 0, 0, 0.8)',           // Compact scoreboard background
    expanded: 'rgba(0, 0, 0, 0.9)',          // Expanded scoreboard background
    modal: 'rgba(0, 0, 0, 0.85)',            // Play history modal background
    overlay: 'rgba(0, 0, 0, 0.5)',           // Modal overlay
    tableHeader: 'rgba(40, 40, 40, 0.95)',   // Table header background
    tableRow: 'rgba(30, 30, 30, 0.7)',       // Table row background
    tableRowAlt: 'rgba(40, 40, 40, 0.7)',    // Alternating row background
    currentMatch: 'rgba(50, 100, 150, 0.3)', // Current match highlight
    latestHand: 'rgba(59, 130, 246, 0.2)',   // Latest hand highlight (blue)
  },

  // -------------------------------------------------------------------------
  // Text Colors
  // -------------------------------------------------------------------------
  text: {
    primary: '#FFFFFF',                       // Primary text (white)
    secondary: '#B0B0B0',                     // Secondary text (gray)
    muted: '#808080',                         // Muted text (darker gray)
    highlight: '#FFD700',                     // Highlight text (gold)
    currentPlayer: '#4ADE80',                 // Current player name (green)
  },

  // -------------------------------------------------------------------------
  // Score Colors (based on value and game state)
  // -------------------------------------------------------------------------
  score: {
    positive: '#22C55E',                      // Green - positive score
    negative: '#EF4444',                      // Red - negative score
    neutral: '#FFFFFF',                       // White - zero score
    winner: '#FFD700',                        // Gold - winner of game
    loser: '#B91C1C',                         // Dark red - busted/last place
    default: '#E5E5E5',                       // Default gray
  },

  // -------------------------------------------------------------------------
  // Border Colors
  // -------------------------------------------------------------------------
  border: {
    primary: '#404040',                       // Primary border (dark gray)
    highlight: '#4ADE80',                     // Highlight border (green)
    table: '#505050',                         // Table cell borders
    card: '#303030',                          // Card borders
    modal: '#606060',                         // Modal borders
  },

  // -------------------------------------------------------------------------
  // Button Colors
  // -------------------------------------------------------------------------
  button: {
    background: 'rgba(60, 60, 60, 0.9)',      // Button background
    backgroundHover: 'rgba(80, 80, 80, 0.9)', // Button hover (use active state)
    backgroundActive: 'rgba(100, 100, 100, 0.9)', // Button active/pressed
    text: '#FFFFFF',                          // Button text
    textMuted: '#B0B0B0',                     // Button text muted
    icon: '#E5E5E5',                          // Icon color
    iconActive: '#4ADE80',                    // Active icon color
  },

  // -------------------------------------------------------------------------
  // Match Card Colors (Play History)
  // -------------------------------------------------------------------------
  matchCard: {
    background: 'rgba(40, 40, 40, 0.95)',     // Match card background
    backgroundCurrent: 'rgba(50, 100, 150, 0.4)', // Current match background
    border: '#505050',                        // Match card border
    headerText: '#FFD700',                    // Match header text (gold)
    headerBg: 'rgba(30, 30, 30, 0.95)',       // Match header background
  },

  // -------------------------------------------------------------------------
  // Hand Card Colors (Individual Plays)
  // -------------------------------------------------------------------------
  handCard: {
    background: 'rgba(50, 50, 50, 0.8)',      // Hand card background
    backgroundLatest: 'rgba(59, 130, 246, 0.2)', // Latest hand background (blue)
    border: '#404040',                        // Hand card border
    borderLatest: '#3B82F6',                  // Latest hand border (blue)
    playerName: '#4ADE80',                    // Player name (green)
    comboType: '#B0B0B0',                     // Combo type text (gray)
  },

  // -------------------------------------------------------------------------
  // Status Colors
  // -------------------------------------------------------------------------
  status: {
    playing: '#4ADE80',                       // Active/playing (green)
    waiting: '#9CA3AF',                       // Waiting (gray)
    finished: '#FFD700',                      // Finished (gold)
    error: '#EF4444',                         // Error (red)
    warning: '#F59E0B',                       // Warning (amber)
  },

  // -------------------------------------------------------------------------
  // Shadow Colors
  // -------------------------------------------------------------------------
  shadow: {
    light: 'rgba(0, 0, 0, 0.1)',              // Light shadow
    medium: 'rgba(0, 0, 0, 0.3)',             // Medium shadow
    heavy: 'rgba(0, 0, 0, 0.5)',              // Heavy shadow
    card: 'rgba(0, 0, 0, 0.4)',               // Card shadow
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get score color based on value and game state
 * Matches web app color logic exactly
 */
export const getScoreColor = (
  score: number,
  isGameFinished: boolean,
  allScores: number[]
): string => {
  if (isGameFinished) {
    // Game is over - determine winner/loser
    const maxScore = Math.max(...allScores);
    const minScore = Math.min(...allScores);
    
    if (score === maxScore && score > 0) {
      return ScoreboardColors.score.winner; // Gold for winner
    }
    if (score === minScore && score < 0) {
      return ScoreboardColors.score.loser; // Dark red for last place
    }
  }
  
  // Regular scoring
  if (score > 0) {
    return ScoreboardColors.score.positive; // Green
  } else if (score < 0) {
    return ScoreboardColors.score.negative; // Red
  } else {
    return ScoreboardColors.score.neutral; // White
  }
};

/**
 * Get points color based on value
 * Used for individual match point displays
 */
export const getPointsColor = (points: number): string => {
  if (points > 0) {
    return ScoreboardColors.score.positive; // Green
  } else if (points < 0) {
    return ScoreboardColors.score.negative; // Red
  } else {
    return ScoreboardColors.score.neutral; // White
  }
};

/**
 * Get player name color based on current turn
 */
export const getPlayerNameColor = (isCurrentPlayer: boolean): string => {
  return isCurrentPlayer 
    ? ScoreboardColors.text.currentPlayer  // Green highlight
    : ScoreboardColors.text.primary;       // White
};

/**
 * Get background color with opacity
 */
export const getBackgroundWithOpacity = (opacity: number): string => {
  // Clamp opacity between 0 and 1
  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  return `rgba(0, 0, 0, ${clampedOpacity})`;
};

// ============================================================================
// EXPORTS
// ============================================================================

export default ScoreboardColors;
