/**
 * LandscapeScoreboard Component
 * 
 * Landscape-optimized scoreboard for game room layout
 * Identical functionality to portrait mode, only dimensional differences
 * 
 * Features:
 * - Collapsed state (top-left panel, 120pt height)
 * - Expanded state (full match history table, 344pt max height scrollable)
 * - Play history modal (identical to portrait)
 * - Same color scheme, animations, and interactions as portrait
 * 
 * Dimensional Differences (from migration plan):
 * - Collapsed: 120pt height (vs portrait dimensions)
 * - Expanded: 344pt max height scrollable (vs portrait dimensions)
 * - Position: Absolute top-left (20pt, 60pt from safe area)
 * - Max width: 280pt (compact for landscape screens)
 * 
 * Created as part of Task #454: Landscape scoreboard component
 * Date: December 19, 2025
 */

import React from 'react';
import { View } from 'react-native';
import { ScoreboardProps } from '../../types/scoreboard';
import { ExpandedScoreboard as PortraitExpandedScoreboard } from '../scoreboard/ExpandedScoreboard';
import { useLandscapeScoreboardStyles } from './hooks/useLandscapeStyles';

// Re-export PlayHistoryModal from scoreboard (identical in landscape)
export { default as PlayHistoryModal } from '../scoreboard/PlayHistoryModal';

/**
 * Landscape Scoreboard Container Props
 * Extends base ScoreboardProps with landscape-specific state
 */
export interface LandscapeScoreboardProps extends ScoreboardProps {
  isExpanded: boolean;
  onToggleExpand?: () => void;
  onTogglePlayHistory?: () => void;
}

/**
 * Main Landscape Scoreboard Container
 * Switches between collapsed and expanded states
 */
export const LandscapeScoreboard: React.FC<LandscapeScoreboardProps> = ({
  playerNames,
  currentScores,
  cardCounts,
  currentPlayerIndex,
  matchNumber,
  isGameFinished,
  scoreHistory,
  playHistory,
  isExpanded,
  onToggleExpand,
  onTogglePlayHistory,
}) => {
  const styles = useLandscapeScoreboardStyles();

  return (
    <View style={styles.container}>
      {/* Task #590: Collapsed scoreboard removed - match number pill and action buttons are now separate */}
      {isExpanded && (
        <PortraitExpandedScoreboard
          playerNames={playerNames}
          currentScores={currentScores}
          cardCounts={cardCounts}
          currentPlayerIndex={currentPlayerIndex}
          matchNumber={matchNumber}
          isGameFinished={isGameFinished}
          scoreHistory={scoreHistory}
          playHistory={playHistory}
          onToggleExpand={onToggleExpand}
          onTogglePlayHistory={onTogglePlayHistory}
          isExpanded={isExpanded}
        />
      )}
    </View>
  );
};

export default LandscapeScoreboard;
