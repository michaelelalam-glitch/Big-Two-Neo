/**
 * ExpandedScoreboard Component
 * 
 * Full match history table view
 * Features:
 * - Table format with columns for each player
 * - Header row with player names (current player highlighted)
 * - Rows for previous completed matches
 * - Current match row showing card counts
 * - Total row with color-coded final scores
 * - Scroll support for many matches
 * 
 * Created as part of Task #346: ExpandedScoreboard component
 * Date: December 12, 2025
 */

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { ExpandedScoreboardProps } from '../../types/scoreboard';
import { useExpandedScoreboardStyles } from './hooks/useResponsiveStyles';
import { ScoreboardColors, getScoreColor, getPointsColor } from './styles/colors';

export const ExpandedScoreboard: React.FC<ExpandedScoreboardProps> = ({
  playerNames,
  currentScores,
  cardCounts,
  currentPlayerIndex,
  matchNumber,
  isGameFinished,
  scoreHistory,
  onToggleExpand,
  onTogglePlayHistory,
  isExpanded: _isExpanded,
}) => {
  // Use responsive styles
  const styles = useExpandedScoreboardStyles();

  return (
    <View pointerEvents={styles.expandedContainerPointerEvents} style={styles.expandedContainer}>
      {/* Header */}
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

      {/* Score Table */}
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
                {match.pointsAdded.map((points, playerIndex) => {
                  // CRITICAL FIX: Calculate true cumulative total UP TO this match
                  // Sum all pointsAdded from match 0 to current match (index)
                  const cumulativeScore = scoreHistory
                    .slice(0, index + 1)
                    .reduce((sum, m) => sum + (m.pointsAdded[playerIndex] || 0), 0);
                  const pointsColor = getPointsColor(points);
                  
                  return (
                    <View key={`match-${match.matchNumber}-p${playerIndex}`} style={styles.tableCell}>
                      <Text style={[styles.tableCellText, { color: pointsColor }]}>
                        {points > 0 ? `+${points}` : points}
                      </Text>
                      <Text style={[styles.tableCellLabel, { color: ScoreboardColors.text.muted }]}>
                        ({cumulativeScore})
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
                <Text style={[styles.tableCellText, { color: ScoreboardColors.text.highlight }]}>
                  #{matchNumber}
                </Text>
              </View>
              
              {/* Card counts */}
              {cardCounts.map((count, playerIndex) => (
                <View key={`current-p${playerIndex}`} style={styles.tableCell}>
                  <Text style={styles.tableCellText}>🃏 {count}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Total Row */}
          <View style={[styles.tableRow, styles.totalRow]}>
            {/* Label */}
            <View style={[styles.tableCell, styles.tableCellFirst, styles.totalCell]}>
              <Text style={[styles.tableCellText, styles.totalCellText]}>
                Total
              </Text>
            </View>
            
            {/* Final scores - calculated by summing all pointsAdded from all matches */}
            {React.useMemo(() => {
              // CRITICAL FIX: Backend's cumulativeScore is broken - calculate true cumulative on frontend
              // Sum all pointsAdded from all matches to get real cumulative totals
              const totalScores = scoreHistory.length > 0
                ? Array.from({ length: 4 }, (_, playerIndex) => 
                    scoreHistory.reduce((sum, match) => sum + (match.pointsAdded[playerIndex] || 0), 0)
                  )
                : currentScores;
              
              return totalScores.map((score, playerIndex) => {
                const scoreColor = getScoreColor(score, isGameFinished, totalScores);
                
                return (
                  <View key={`total-p${playerIndex}`} style={[styles.tableCell, styles.totalCell]}>
                    <Text
                      style={[
                        styles.tableCellText,
                        styles.totalCellText,
                        { color: scoreColor },
                      ]}
                    >
                      {score > 0 ? `+${score}` : score}
                    </Text>
                  </View>
                );
              });
            // eslint-disable-next-line react-hooks/exhaustive-deps -- styles.tableCell etc. come from useExpandedScoreboardStyles() (stable memoized result); including them would add noise without functional benefit since style changes will be captured whenever the parent re-renders
            }, [scoreHistory, currentScores, isGameFinished])}
          </View>
        </ScrollView>
      </View>
    </View>
  );
};

export default ExpandedScoreboard;
