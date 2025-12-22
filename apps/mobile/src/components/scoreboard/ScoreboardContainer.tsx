/**
 * ScoreboardContainer Component
 * 
 * Main wrapper component that manages scoreboard state and routing
 * Switches between CompactScoreboard and ExpandedScoreboard
 * Integrates with ScoreboardContext for state management
 * 
 * Created as part of Task #348: ScoreboardContainer wrapper
 * Date: December 12, 2025
 */

import React from 'react';
import { View } from 'react-native';
import { useScoreboard } from '../../contexts/ScoreboardContext';
import { ScoreboardProps } from '../../types/scoreboard';
import CompactScoreboard from './CompactScoreboard';
import ExpandedScoreboard from './ExpandedScoreboard';
import PlayHistoryModal from './PlayHistoryModal';
import ScoreboardErrorBoundary from './ScoreboardErrorBoundary';
import { useScoreboardContainerStyles } from './hooks/useResponsiveStyles';

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
      <View style={styles.container}>
        {/* Compact View */}
        {!isScoreboardExpanded && (
          <CompactScoreboard
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

        {/* Expanded View */}
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
        playerNames={originalPlayerNames}
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
