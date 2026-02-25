/**
 * MatchNumberDisplay Component
 * 
 * Displays the current match number centered at the top of the screen,
 * positioned right below the front camera/notch area.
 * 
 * Task #590 - Remove minimized scoreboard, show match number at top center
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../../constants';

interface MatchNumberDisplayProps {
  matchNumber: number;
  isGameFinished: boolean;
}

export function MatchNumberDisplay({ matchNumber, isGameFinished }: MatchNumberDisplayProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { top: insets.top + 4 }]}>
      <View style={styles.badge}>
        <Text style={styles.text}>
          {isGameFinished ? 'Game Over' : `Match ${matchNumber}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 110,
    pointerEvents: 'none',
  },
  badge: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.4)',
  },
  text: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});

export default MatchNumberDisplay;
