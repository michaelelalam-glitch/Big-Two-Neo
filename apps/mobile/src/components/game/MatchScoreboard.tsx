import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONT_SIZES, LAYOUT, OVERLAYS, SCOREBOARD_DETAIL, SHADOWS } from '../../constants';

interface Player {
  name: string;
  score: number;
  isCurrentPlayer?: boolean; // Indicates if this is the authenticated user
}

interface MatchScoreboardProps {
  players: Player[];
  currentMatch: number;
}

export default function MatchScoreboard({ players, currentMatch }: MatchScoreboardProps) {
  const accessibilityLabel = `Match ${currentMatch} scoreboard: ${players.map(p => 
    `${p.name} has ${p.score} point${p.score !== 1 ? 's' : ''}`
  ).join(', ')}`;
  
  return (
    <View 
      style={styles.container}
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Match {currentMatch}</Text>
      </View>

      {/* Player scores */}
      {players.map((player, index) => (
        <View key={index} style={styles.playerRow}>
          {/* Player indicator - only show arrow for current player */}
          <View style={styles.playerIndicator}>
            {player.isCurrentPlayer && (
              <Text style={styles.playerIcon}>▶</Text>
            )}
          </View>

          {/* Player name - blue for current player, black for opponents */}
          <Text 
            style={[
              styles.playerName, 
              player.isCurrentPlayer && styles.currentPlayerName
            ]} 
            numberOfLines={1}
          >
            {player.name}
          </Text>

          {/* Score */}
          <Text style={styles.score}>{player.score}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: OVERLAYS.scoreboardBackground,
    borderRadius: LAYOUT.scoreboardBorderRadius,
    padding: LAYOUT.scoreboardPadding,
    width: LAYOUT.scoreboardWidth,
    minHeight: LAYOUT.scoreboardMinHeight, // Changed to minHeight to fit all 4 players
    shadowColor: COLORS.black,
    shadowOffset: SHADOWS.scoreboard.offset,
    shadowOpacity: SHADOWS.scoreboard.opacity,
    shadowRadius: SHADOWS.scoreboard.radius,
    elevation: SHADOWS.scoreboard.elevation,
  },
  header: {
    borderBottomWidth: SCOREBOARD_DETAIL.headerBorderWidth,
    borderBottomColor: COLORS.gray.medium,
    paddingBottom: SCOREBOARD_DETAIL.headerPaddingBottom,
    marginBottom: SCOREBOARD_DETAIL.headerMarginBottom,
  },
  title: {
    fontSize: FONT_SIZES.md, // Reduced from lg
    fontWeight: 'bold',
    color: COLORS.black,
    textAlign: 'center',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SCOREBOARD_DETAIL.playerRowPaddingVertical,
    gap: SCOREBOARD_DETAIL.playerRowGap,
  },
  playerIndicator: {
    width: SCOREBOARD_DETAIL.indicatorWidth,
    alignItems: 'center',
  },
  playerIcon: {
    fontSize: SCOREBOARD_DETAIL.iconFontSize,
    color: COLORS.secondary,
  },
  playerName: {
    flex: 1,
    fontSize: FONT_SIZES.sm, // Reduced from md
    color: COLORS.black,
    fontWeight: '600',
  },
  currentPlayerName: {
    color: COLORS.blue.primary, // Blue color for current player (you)
  },
  score: {
    fontSize: FONT_SIZES.md, // Reduced from lg
    fontWeight: 'bold',
    color: COLORS.red.active,
    minWidth: SCOREBOARD_DETAIL.scoreMinWidth,
    textAlign: 'right',
  },
});
