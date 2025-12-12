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
import { scoreboardStyles } from './styles/scoreboard.styles';
import { ScoreboardColors, getPlayerNameColor, getScoreColor, getPointsColor } from './styles/colors';
import { ExpandedScoreboardProps } from '../../types/scoreboard';

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
  isExpanded,
}) => {
  // Don't render if not expanded
  if (!isExpanded) {
    return null;
  }

  const playerCount = playerNames.length;

  return (
    <View style={scoreboardStyles.expandedContainer}>
      {/* Header */}
      <View style={scoreboardStyles.expandedHeader}>
        <Text style={scoreboardStyles.expandedTitle}>
          {isGameFinished ? '🏁 Final Scores' : `Match ${matchNumber} History`}
        </Text>
        
        <View style={scoreboardStyles.headerButtons}>
          {/* Play History Button */}
          {onTogglePlayHistory && (
            <TouchableOpacity
              style={scoreboardStyles.iconButton}
              onPress={onTogglePlayHistory}
              activeOpacity={0.7}
              accessibilityLabel="Open play history"
              accessibilityRole="button"
            >
              <Text style={scoreboardStyles.iconButtonText}>📜</Text>
            </TouchableOpacity>
          )}
          
          {/* Close/Minimize Button */}
          {onToggleExpand && (
            <TouchableOpacity
              style={scoreboardStyles.closeButton}
              onPress={onToggleExpand}
              activeOpacity={0.7}
              accessibilityLabel="Minimize scoreboard"
              accessibilityRole="button"
            >
              <Text style={scoreboardStyles.closeButtonText}>◀ Close</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Score Table */}
      <View style={scoreboardStyles.tableContainer}>
        <ScrollView 
          style={scoreboardStyles.tableScrollView}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
        >
          {/* Table Header Row */}
          <View style={scoreboardStyles.tableHeaderRow}>
            {/* Match # column */}
            <View style={[scoreboardStyles.tableHeaderCell, scoreboardStyles.tableHeaderCellFirst]}>
              <Text style={scoreboardStyles.tableHeaderText}>Match</Text>
            </View>
            
            {/* Player name columns */}
            {playerNames.map((name, index) => {
              const isCurrentPlayer = index === currentPlayerIndex;
              return (
                <View key={`header-${index}`} style={scoreboardStyles.tableHeaderCell}>
                  <Text
                    style={[
                      scoreboardStyles.tableHeaderText,
                      isCurrentPlayer && scoreboardStyles.tableHeaderTextCurrent,
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
                  scoreboardStyles.tableRow,
                  !isEvenRow && scoreboardStyles.tableRowAlt,
                ]}
              >
                {/* Match number */}
                <View style={[scoreboardStyles.tableCell, scoreboardStyles.tableCellFirst]}>
                  <Text style={scoreboardStyles.tableCellText}>#{match.matchNumber}</Text>
                </View>
                
                {/* Player scores for this match */}
                {match.pointsAdded.map((points, playerIndex) => {
                  const score = match.scores[playerIndex];
                  const pointsColor = getPointsColor(points);
                  
                  return (
                    <View key={`match-${match.matchNumber}-p${playerIndex}`} style={scoreboardStyles.tableCell}>
                      <Text style={[scoreboardStyles.tableCellText, { color: pointsColor }]}>
                        {points > 0 ? `+${points}` : points}
                      </Text>
                      <Text style={[scoreboardStyles.tableCellLabel, { color: ScoreboardColors.text.muted }]}>
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
            <View style={[scoreboardStyles.tableRow, scoreboardStyles.tableRowCurrent]}>
              {/* Match number */}
              <View style={[scoreboardStyles.tableCell, scoreboardStyles.tableCellFirst]}>
                <Text style={[scoreboardStyles.tableCellText, { color: ScoreboardColors.text.highlight }]}>
                  #{matchNumber}
                </Text>
              </View>
              
              {/* Card counts */}
              {cardCounts.map((count, playerIndex) => (
                <View key={`current-p${playerIndex}`} style={scoreboardStyles.tableCell}>
                  <Text style={scoreboardStyles.tableCellText}>🃏 {count}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Total Row */}
          <View style={[scoreboardStyles.tableRow, scoreboardStyles.totalRow]}>
            {/* Label */}
            <View style={[scoreboardStyles.tableCell, scoreboardStyles.tableCellFirst, scoreboardStyles.totalCell]}>
              <Text style={[scoreboardStyles.tableCellText, scoreboardStyles.totalCellText]}>
                Total
              </Text>
            </View>
            
            {/* Final scores */}
            {currentScores.map((score, playerIndex) => {
              const scoreColor = getScoreColor(score, isGameFinished, currentScores);
              
              return (
                <View key={`total-p${playerIndex}`} style={[scoreboardStyles.tableCell, scoreboardStyles.totalCell]}>
                  <Text
                    style={[
                      scoreboardStyles.tableCellText,
                      scoreboardStyles.totalCellText,
                      { color: scoreColor },
                    ]}
                  >
                    {score > 0 ? `+${score}` : score}
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

export default ExpandedScoreboard;
