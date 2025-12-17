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
        <ExpandedScoreboard
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
// EXPANDED SCOREBOARD (344pt max height, scrollable)
// ============================================================================

interface ExpandedScoreboardProps {
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

const ExpandedScoreboard: React.FC<ExpandedScoreboardProps> = ({
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
    <View style={styles.expandedContainer}>
      {/* Header (32pt height) */}
      <View style={styles.expandedHeader}>
        <Text style={styles.expandedTitle}>
          {isGameFinished ? '🏁 Final Scores' : `Match ${matchNumber} History`}
        </Text>
        
        <View style={styles.headerButtons}>
          {/* Play History Button */}
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
          
          {/* Close/Minimize Button */}
          {onToggleExpand && (
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onToggleExpand}
              activeOpacity={0.7}
              accessibilityLabel="Minimize scoreboard"
              accessibilityHint="Return to compact scoreboard view"
              accessibilityRole="button"
            >
              <Text style={styles.closeButtonText}>◀ Close</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Score Table (scrollable, max 344pt total height) */}
      <View style={styles.tableContainer}>
        <ScrollView 
          style={styles.tableScrollView}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={false}
        >
          {/* Table Header Row */}
          <View style={styles.tableHeaderRow}>
            {/* Match # column */}
            <View style={[styles.tableHeaderCell, styles.tableHeaderCellFirst]}>
              <Text style={styles.tableHeaderText}>Match</Text>
            </View>
            
            {/* Player name columns */}
            {playerNames.map((name, index) => {
              const isCurrentPlayer = index === currentPlayerIndex;
              return (
                <View key={`header-${index}`} style={styles.tableHeaderCell}>
                  <Text
                    style={[
                      styles.tableHeaderText,
                      isCurrentPlayer && styles.tableHeaderTextCurrent,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {name}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Past Match Rows */}
          {scoreHistory.map((match, index) => {
            const isEvenRow = index % 2 === 0;
            
            return (
              <View
                key={`match-${match.matchNumber}`}
                style={[
                  styles.tableRow,
                  !isEvenRow && styles.tableRowAlt,
                ]}
              >
                {/* Match number */}
                <View style={[styles.tableCell, styles.tableCellFirst]}>
                  <Text style={styles.tableCellText}>#{match.matchNumber}</Text>
                </View>
                
                {/* Player scores for this match */}
                {match.pointsAdded.map((points: number, playerIndex: number) => {
                  const score = match.scores[playerIndex];
                  const pointsColor = getPointsColor(points);
                  
                  return (
                    <View key={`match-${match.matchNumber}-p${playerIndex}`} style={styles.tableCell}>
                      <Text style={[styles.tableCellText, { color: pointsColor }]}>
                        {points > 0 ? `+${points}` : points}
                      </Text>
                      <Text style={[styles.tableCellLabel, { color: ScoreboardColors.text.muted }]}>
                        ({score})
                      </Text>
                    </View>
                  );
                })}
              </View>
            );
          })}

          {/* Current Match Row (only if game not finished) */}
          {!isGameFinished && (
            <View style={[styles.tableRow, styles.tableRowCurrent]}>
              {/* Match number */}
              <View style={[styles.tableCell, styles.tableCellFirst]}>
                <Text style={styles.tableCellText}>#{matchNumber}</Text>
              </View>
              
              {/* Current card counts */}
              {cardCounts.map((count, playerIndex) => (
                <View key={`current-p${playerIndex}`} style={styles.tableCell}>
                  <Text style={styles.tableCellText}>🃏 {count}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Total Row (final scores) */}
          <View style={styles.tableTotalRow}>
            {/* Total label */}
            <View style={[styles.tableCell, styles.tableCellFirst]}>
              <Text style={styles.tableTotalText}>Total</Text>
            </View>
            
            {/* Final scores */}
            {currentScores.map((score, playerIndex) => {
              const scoreColor = getScoreColor(score, isGameFinished, currentScores);
              
              return (
                <View key={`total-p${playerIndex}`} style={styles.tableCell}>
                  <Text style={[styles.tableTotalText, { color: scoreColor }]}>
                    {score}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </View>
  );
};

export default LandscapeScoreboard;
