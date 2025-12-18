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
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { ScoreboardProps } from '../../types/scoreboard';
import { getPlayerNameColor, getScoreColor, getPointsColor, ScoreboardColors } from '../scoreboard/styles/colors';
import { useLandscapeScoreboardStyles } from './hooks/useLandscapeStyles';
import { ExpandedScoreboard as PortraitExpandedScoreboard } from '../scoreboard/ExpandedScoreboard';

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
      {!isExpanded ? (
        <CollapsedScoreboard
          playerNames={playerNames}
          currentScores={currentScores}
          cardCounts={cardCounts}
          currentPlayerIndex={currentPlayerIndex}
          matchNumber={matchNumber}
          isGameFinished={isGameFinished}
          scoreHistory={scoreHistory}
          onToggleExpand={onToggleExpand}
          onTogglePlayHistory={onTogglePlayHistory}
        />
      ) : (
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

// ============================================================================
// COLLAPSED SCOREBOARD (120pt height)
// ============================================================================

interface CollapsedScoreboardProps {
  playerNames: string[];
  currentScores: number[];
  cardCounts: number[];
  currentPlayerIndex: number;
  matchNumber: number;
  isGameFinished: boolean;
  scoreHistory: any[];
  onToggleExpand?: () => void;
  onTogglePlayHistory?: () => void;
}

const CollapsedScoreboard: React.FC<CollapsedScoreboardProps> = ({
  playerNames,
  currentScores,
  cardCounts,
  currentPlayerIndex,
  matchNumber,
  isGameFinished,
  scoreHistory,
  onToggleExpand,
  onTogglePlayHistory,
}) => {
  const styles = useLandscapeScoreboardStyles();

  return (
    <View style={styles.collapsedContainer}>
      {/* Header (24pt height) */}
      <View style={styles.collapsedHeader}>
        <Text style={styles.matchTitle}>
          {isGameFinished ? '🏁 Game Over' : `🃏 Match ${matchNumber}`}
        </Text>
        
        <View style={styles.headerButtons}>
          {/* Play History Button (📜) */}
          {onTogglePlayHistory && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={onTogglePlayHistory}
              activeOpacity={0.7}
              accessibilityLabel="Open play history"
              accessibilityHint="View all card plays from this game"
              accessibilityRole="button"
            >
              <Text style={styles.iconButtonText}>📜</Text>
            </TouchableOpacity>
          )}
          
          {/* Expand Button (▶) */}
          {onToggleExpand && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={onToggleExpand}
              activeOpacity={0.7}
              accessibilityLabel="Expand scoreboard"
              accessibilityHint="Show detailed scoreboard with full statistics"
              accessibilityRole="button"
            >
              <Text style={styles.iconButtonText}>▶</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Player List (4 rows × 22pt = 88pt) */}
      <View style={styles.playerList}>
        {playerNames.map((name, index) => {
          const isCurrentPlayer = index === currentPlayerIndex;
          const score = currentScores[index] || 0;
          const cardCount = cardCounts[index] || 0;
          const scoreColor = getScoreColor(score, isGameFinished, currentScores);
          const nameColor = getPlayerNameColor(isCurrentPlayer);

          return (
            <View
              key={`player-${index}`}
              style={[
                styles.playerRow,
                isCurrentPlayer && styles.playerRowCurrent,
              ]}
            >
              {/* Player name */}
              <Text
                style={[
                  styles.playerName,
                  { color: nameColor },
                  isCurrentPlayer && styles.playerNameCurrent,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {name}
              </Text>

              {/* Stats: card count + score */}
              <View style={styles.playerStats}>
                {/* Card count (only during active game) */}
                {!isGameFinished && (
                  <Text style={styles.cardCount}>
                    🃏 {cardCount}
                  </Text>
                )}

                {/* Score */}
                <Text
                  style={[
                    styles.playerScore,
                    { color: scoreColor },
                  ]}
                >
                  {score} pts
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

// ============================================================================
// NOTE: ExpandedScoreboard now uses portrait version for consistency
// ============================================================================

export default LandscapeScoreboard;
