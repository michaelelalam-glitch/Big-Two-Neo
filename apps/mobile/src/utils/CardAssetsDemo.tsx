/**
 * Card Assets Usage Examples
 * Demonstrates how to use the card image system in your app
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { CardImage } from '../components/scoreboard/components/CardImage';

/**
 * Example: Display some sample cards
 */
export function CardAssetsDemo() {
  // Example cards from a Big Two game
  const sampleHand = [
    { rank: '3', suit: 'D' },  // 3 of Diamonds (starting card)
    { rank: '5', suit: 'H' },  // 5 of Hearts
    { rank: '10', suit: 'S' }, // 10 of Spades
    { rank: 'J', suit: 'C' },  // Jack of Clubs
    { rank: 'A', suit: 'H' },  // Ace of Hearts
    { rank: '2', suit: 'S' },  // 2 of Spades (highest card)
  ];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Card Assets Demo</Text>
      
      {/* Sample Hand */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sample Hand:</Text>
        <View style={styles.cardRow}>
          {sampleHand.map((card, index) => (
            <CardImage
              key={index}
              rank={card.rank}
              suit={card.suit}
              width={60}
              height={84}
              style={styles.card}
            />
          ))}
        </View>
      </View>

      {/* All Suits Example */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>All Suits (Aces):</Text>
        <View style={styles.cardRow}>
          <CardImage rank="A" suit="H" width={60} height={84} style={styles.card} />
          <CardImage rank="A" suit="D" width={60} height={84} style={styles.card} />
          <CardImage rank="A" suit="C" width={60} height={84} style={styles.card} />
          <CardImage rank="A" suit="S" width={60} height={84} style={styles.card} />
        </View>
      </View>

      {/* Scoreboard Size (Smaller) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Scoreboard Size (35×51):</Text>
        <View style={styles.cardRow}>
          <CardImage rank="K" suit="H" width={35} height={51} style={styles.card} />
          <CardImage rank="Q" suit="D" width={35} height={51} style={styles.card} />
          <CardImage rank="J" suit="C" width={35} height={51} style={styles.card} />
          <CardImage rank="10" suit="S" width={35} height={51} style={styles.card} />
        </View>
      </View>

      {/* Play History Example */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Play History Example:</Text>
        <View style={styles.playHistory}>
          <Text style={styles.playText}>Player 1: Pair (2)</Text>
          <View style={styles.cardRow}>
            <CardImage rank="K" suit="H" width={35} height={51} style={styles.card} />
            <CardImage rank="K" suit="S" width={35} height={51} style={styles.card} />
          </View>
        </View>
        <View style={styles.playHistory}>
          <Text style={styles.playText}>Player 2: Straight (5)</Text>
          <View style={styles.cardRow}>
            <CardImage rank="3" suit="D" width={35} height={51} style={styles.card} />
            <CardImage rank="4" suit="H" width={35} height={51} style={styles.card} />
            <CardImage rank="5" suit="C" width={35} height={51} style={styles.card} />
            <CardImage rank="6" suit="S" width={35} height={51} style={styles.card} />
            <CardImage rank="7" suit="D" width={35} height={51} style={styles.card} />
          </View>
        </View>
      </View>

      {/* Usage Instructions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Usage:</Text>
        <Text style={styles.code}>
          {`import { CardImage } from '@/components/scoreboard/components/CardImage';

// Basic usage
<CardImage rank="A" suit="S" />

// Custom size
<CardImage rank="K" suit="H" width={60} height={84} />

// Scoreboard size
<CardImage rank="10" suit="D" width={35} height={51} />`}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f9fafb',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#1f2937',
  },
  section: {
    marginBottom: 30,
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    color: '#374151',
  },
  cardRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  playHistory: {
    marginBottom: 15,
    padding: 10,
    backgroundColor: '#f9fafb',
    borderRadius: 6,
  },
  playText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#1f2937',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 12,
    backgroundColor: '#f3f4f6',
    padding: 10,
    borderRadius: 4,
    color: '#374151',
  },
});
