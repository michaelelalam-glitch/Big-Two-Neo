/**
 * Scoreboard Components - Main Export File
 * 
 * Exports all scoreboard-related components
 * Date: December 12, 2025
 */

// Main container
export { ScoreboardContainer } from './ScoreboardContainer';

// Component exports
export { CompactScoreboard } from './CompactScoreboard';
export { ExpandedScoreboard } from './ExpandedScoreboard';
export { PlayHistoryModal } from './PlayHistoryModal';

// Sub-components
export { HandCard } from './components/HandCard';
export { CardImage } from './components/CardImage';

// Styles
export { scoreboardStyles, responsive } from './styles/scoreboard.styles';
export { ScoreboardColors, getScoreColor, getPointsColor, getPlayerNameColor } from './styles/colors';

// Default export
export { ScoreboardContainer as default } from './ScoreboardContainer';
