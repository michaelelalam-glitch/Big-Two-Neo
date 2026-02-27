/**
 * ScoreboardContainer Component
 * 
 * Main wrapper component that manages scoreboard state and routing.
 * Shows ExpandedScoreboard when toggled open via inline action buttons in the game screens.
 * When collapsed, renders an empty container (no scoreboard content visible).
 * (Task #590: CompactScoreboard removed — match badge, action buttons, and score
 *  badges are now rendered directly in the game screen components)
 * Integrates with ScoreboardContext for state management
 * 
 * Created as part of Task #348: ScoreboardContainer wrapper
 * Date: December 12, 2025
 */

import React from 'react';
import { View } from 'react-native';
import ExpandedScoreboard from './ExpandedScoreboard';
import { useScoreboardContainerStyles } from './hooks/useResponsiveStyles';
import PlayHistoryModal from './PlayHistoryModal';
import ScoreboardErrorBoundary from './ScoreboardErrorBoundary';
import { useScoreboard } from '../../contexts/ScoreboardContext';
import { ScoreboardProps } from '../../types/scoreboard';

export const ScoreboardContainer: React.FC<ScoreboardProps> = ({
  playerNames,
  currentScores,
  cardCounts,
  currentPlayerIndex,
  matchNumber,
  isGameFinished,
  scoreHistory,
  playHistory,
  originalPlayerNames,
}) => {
  // Use responsive container styles
  const styles = useScoreboardContainerStyles();
  
  const {
    isScoreboardExpanded,
    setIsScoreboardExpanded,
    isPlayHistoryOpen,
    setIsPlayHistoryOpen,
    collapsedMatches,
    toggleMatchCollapse,
  } = useScoreboard();

  // Handlers
  const handleToggleExpand = () => {
    setIsScoreboardExpanded(!isScoreboardExpanded);
  };

  const handleTogglePlayHistory = () => {
    setIsPlayHistoryOpen(!isPlayHistoryOpen);
  };

  const handleClosePlayHistory = () => {
    setIsPlayHistoryOpen(false);
  };

  return (
    <ScoreboardErrorBoundary>
      {/* Main Scoreboard Container */}
      <View pointerEvents={styles.containerPointerEvents} style={styles.container}>
        {/* Task #590: CompactScoreboard removed - match badge + action buttons + score badges are now inline in screens */}

        {/* Expanded View (toggled via ScoreActionButtons) */}
        {isScoreboardExpanded && (
          <ExpandedScoreboard
            playerNames={playerNames}
            currentScores={currentScores}
            cardCounts={cardCounts}
            currentPlayerIndex={currentPlayerIndex}
            matchNumber={matchNumber}
            isGameFinished={isGameFinished}
            scoreHistory={scoreHistory}
            playHistory={playHistory}
            isExpanded={isScoreboardExpanded}
            onToggleExpand={handleToggleExpand}
            onTogglePlayHistory={handleTogglePlayHistory}
          />
        )}
      </View>

      {/* Play History Modal */}
      <PlayHistoryModal
        visible={isPlayHistoryOpen}
        playerNames={originalPlayerNames || []}
        playHistory={playHistory}
        currentMatch={matchNumber}
        collapsedMatches={collapsedMatches}
        onClose={handleClosePlayHistory}
        onToggleMatch={toggleMatchCollapse}
      />
    </ScoreboardErrorBoundary>
  );
};

export default ScoreboardContainer;
