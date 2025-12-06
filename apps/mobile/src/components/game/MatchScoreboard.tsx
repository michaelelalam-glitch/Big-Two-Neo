import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';

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
  return (
    <View style={styles.container}>
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
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 8,
    padding: 8,
    width: 140,
    minHeight: 130, // Changed to minHeight to fit all 4 players
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.gray.medium,
    paddingBottom: 4,
    marginBottom: 4,
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
    paddingVertical: 2,
    gap: 6,
  },
  playerIndicator: {
    width: 16,
    alignItems: 'center',
  },
  playerIcon: {
    fontSize: 10,
    color: COLORS.secondary,
  },
  playerName: {
    flex: 1,
    fontSize: FONT_SIZES.sm, // Reduced from md
    color: COLORS.black,
    fontWeight: '600',
  },
  currentPlayerName: {
    color: '#4A90E2', // Blue color for current player (you)
  },
  score: {
    fontSize: FONT_SIZES.md, // Reduced from lg
    fontWeight: 'bold',
    color: '#E74C3C',
    minWidth: 24,
    textAlign: 'right',
  },
});
