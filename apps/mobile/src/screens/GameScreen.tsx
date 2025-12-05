import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { CardHand } from '../components/game';
import type { Card } from '../game/types';
import { COLORS, SPACING, FONT_SIZES } from '../constants';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;

// Demo utilities for creating test hand
// TODO: Replace with actual game state from GameStateManager in Task #266
function createDemoDeck(): Card[] {
  const suits = ['H', 'D', 'C', 'S'] as const;
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'] as const;
  const deck: Card[] = [];
  
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ id: `${rank}${suit}`, rank, suit });
    }
  }
  
  return deck;
}

function shuffleDemoDeck(cards: Card[]): Card[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export default function GameScreen() {
  const route = useRoute<GameScreenRouteProp>();
  const { roomCode } = route.params;
  const [playerHand, setPlayerHand] = useState<Card[]>([]);

  // Initialize demo hand
  useEffect(() => {
    const deck = createDemoDeck();
    const shuffled = shuffleDemoDeck(deck);
    // Deal 13 cards to player (standard Big2 hand size)
    const hand = shuffled.slice(0, 13);
    setPlayerHand(hand);
  }, []);

  const handlePlayCards = (cards: Card[]) => {
    console.log('Playing cards:', cards);
    // TODO: Validate and send to game logic
    // Remove played cards from hand
    setPlayerHand((prev) => prev.filter((c) => !cards.some((pc) => pc.id === c.id)));
  };

  const handlePass = () => {
    console.log('Player passed');
    // TODO: Send pass action to game logic
  };

  return (
    <View style={styles.container}>
      {/* Game table area - placeholder for Task #266 */}
      <View style={styles.tableArea}>
        <SafeAreaView edges={['top']} style={styles.header}>
          <Text style={styles.roomCode}>Room: {roomCode}</Text>
          <Text style={styles.title}>Big Two</Text>
        </SafeAreaView>

        <View style={styles.playArea}>
          <Text style={styles.placeholder}>
            🃏 Game Table UI{'\n'}(Task #266)
          </Text>
          <Text style={styles.placeholderInfo}>
            • Player positions{'\n'}
            • Last played cards{'\n'}
            • Turn indicator{'\n'}
            • Video chat overlay
          </Text>
        </View>
      </View>

      {/* Player's hand with card interaction */}
      <CardHand
        cards={playerHand}
        onPlayCards={handlePlayCards}
        onPass={handlePass}
        canPlay={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  tableArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roomCode: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
    fontWeight: '600',
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  playArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  placeholder: {
    fontSize: FONT_SIZES.xl,
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    fontWeight: '600',
  },
  placeholderInfo: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.light,
    textAlign: 'center',
    lineHeight: 24,
  },
});
