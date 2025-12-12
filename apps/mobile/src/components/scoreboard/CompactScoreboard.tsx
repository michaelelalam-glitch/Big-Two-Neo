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
import { scoreboardStyles } from './styles/scoreboard.styles';
import { getPlayerNameColor, getScoreColor } from './styles/colors';
import { CompactScoreboardProps } from '../../types/scoreboard';

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
  // Auto-expand when game finishes
  const onToggleExpandRef = useRef(onToggleExpand);
  onToggleExpandRef.current = onToggleExpand;

  useEffect(() => {
    if (isGameFinished && !isExpanded && onToggleExpandRef.current) {
      onToggleExpandRef.current();
    }
  }, [isGameFinished, isExpanded]);

  // Don't render if expanded (show ExpandedScoreboard instead)
  if (isExpanded) {
    return null;
  }

  return (
    <View style={scoreboardStyles.compactContainer}>
      {/* Header with match number and action buttons */}
      <View style={scoreboardStyles.compactHeader}>
        <Text style={scoreboardStyles.matchTitle}>
          {isGameFinished ? '🏁 Game Over' : `Match ${matchNumber}`}
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
          
          {/* Expand Button */}
          {onToggleExpand && (
            <TouchableOpacity
              style={scoreboardStyles.iconButton}
              onPress={onToggleExpand}
              activeOpacity={0.7}
              accessibilityLabel="Expand scoreboard"
              accessibilityRole="button"
            >
              <Text style={scoreboardStyles.iconButtonText}>▶</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Player scores list */}
      <ScrollView 
        style={scoreboardStyles.playerList}
        showsVerticalScrollIndicator={false}
      >
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
                scoreboardStyles.playerRow,
                isCurrentPlayer && scoreboardStyles.playerRowCurrent,
              ]}
            >
              {/* Player name */}
              <Text
                style={[
                  scoreboardStyles.playerName,
                  { color: nameColor },
                  isCurrentPlayer && scoreboardStyles.playerNameCurrent,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {name}
              </Text>

              {/* Stats: card count + score */}
              <View style={scoreboardStyles.playerStats}>
                {/* Card count (only show during active game) */}
                {!isGameFinished && (
                  <Text style={scoreboardStyles.cardCount}>
                    🃏 {cardCount}
                  </Text>
                )}

                {/* Score */}
                <Text
                  style={[
                    scoreboardStyles.playerScore,
                    { color: scoreColor },
                  ]}
                >
                  {score > 0 ? `+${score}` : score}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

export default CompactScoreboard;
