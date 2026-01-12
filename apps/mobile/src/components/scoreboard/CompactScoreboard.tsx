/**
 * CompactScoreboard Component
 * 
 * Fixed top-left panel showing current match scores
 * Features:
 * - Current match number display
 * - Player scores list with current player highlighted
 * - Two action buttons: Play History (📜) and Expand (▶)
 * - Auto-expand on game finish
 * 
 * Created as part of Task #345: CompactScoreboard component
 * Date: December 12, 2025
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { getPlayerNameColor, getScoreColor } from './styles/colors';
import { CompactScoreboardProps } from '../../types/scoreboard';
import { useCompactScoreboardStyles, useScoreboardContainerStyles } from './hooks/useResponsiveStyles';

export const CompactScoreboard: React.FC<CompactScoreboardProps> = ({
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
  // Use responsive styles
  const styles = useCompactScoreboardStyles();

  // Note: Scoreboard expansion is now MANUAL ONLY per user request.
  // Auto-expansion on game finish was removed to give user full control.

  return (
    <View style={styles.compactContainer}>
      {/* Header with match number and action buttons */}
      <View style={styles.compactHeader}>
        <Text style={styles.matchTitle}>
          {isGameFinished ? '🏁 Game Over' : `🃏 Match ${matchNumber}`}
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
          
          {/* Expand Button */}
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

      {/* Player scores list */}
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

              {/* Stats: score only */}
              <View style={styles.playerStats}>
                {/* Score */}
                <Text
                  style={[
                    styles.playerScore,
                    { color: scoreColor },
                  ]}
                >
                  {score > 0 ? `+${score}` : score}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

export default CompactScoreboard;
