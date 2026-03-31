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
import { View, Modal, TouchableOpacity } from 'react-native';
import { useScoreboard } from '../../contexts/ScoreboardContext';
import type { ScoreboardProps } from '../../types/scoreboard';
import { MODAL_SUPPORTED_ORIENTATIONS } from '../../constants';
import ExpandedScoreboard from './ExpandedScoreboard';
import { useScoreboardContainerStyles } from './hooks/useResponsiveStyles';
import PlayHistoryModal from './PlayHistoryModal';
import ScoreboardErrorBoundary from './ScoreboardErrorBoundary';

// Task #628: React.memo — bail out of re-renders driven by GameContext changes
// (e.g. timer ticks, card selection) when scoreboard props are reference-equal.
const ScoreboardContainerComponent: React.FC<ScoreboardProps> = ({
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
      {/* Empty container — keeps the component mounted in the tree when collapsed.
          The expanded scoreboard now renders in a Modal (floats above all UI including
          the player avatar, matching PlayHistoryModal behaviour and dimensions). */}
      <View pointerEvents="none" style={styles.container} />

      {/* Expanded Scoreboard Modal — same pattern as PlayHistoryModal so it floats
          above the player avatar/name/cards with identical size and centering. */}
      <Modal
        visible={isScoreboardExpanded}
        transparent
        animationType="fade"
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
        statusBarTranslucent={true}
        onRequestClose={handleToggleExpand}
      >
        <View style={styles.modalOverlay}>
          {/* Tapping the backdrop closes the scoreboard */}
          <TouchableOpacity
            style={styles.modalBackdrop}
            onPress={handleToggleExpand}
            activeOpacity={1}
            accessibilityLabel="Close scoreboard"
          />
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
        </View>
      </Modal>

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

export const ScoreboardContainer = React.memo(ScoreboardContainerComponent);

export default ScoreboardContainer;
