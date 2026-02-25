/**
 * ScoreActionButtons Component
 * 
 * Top-left action buttons for expanding scoreboard and opening play history.
 * Replaces the header buttons that were part of the now-removed CompactScoreboard.
 * 
 * Buttons:
 * - 📜 Open Play History modal
 * - ▶ Expand full scoreboard
 * 
 * Task #590 - Keep expanded scoreboard + play history buttons visible at top-left
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ScoreActionButtonsProps {
  onToggleExpand: () => void;
  onTogglePlayHistory: () => void;
}

export function ScoreActionButtons({ onToggleExpand, onTogglePlayHistory }: ScoreActionButtonsProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { top: insets.top + 4 }]}>
      {/* Play History Button */}
      <TouchableOpacity
        style={styles.button}
        onPress={onTogglePlayHistory}
        activeOpacity={0.7}
        accessibilityLabel="Open play history"
        accessibilityHint="View all card plays from this game"
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>📜</Text>
      </TouchableOpacity>

      {/* Expand Scoreboard Button */}
      <TouchableOpacity
        style={styles.button}
        onPress={onToggleExpand}
        activeOpacity={0.7}
        accessibilityLabel="Expand scoreboard"
        accessibilityHint="Show detailed scoreboard with full statistics"
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>▶</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    flexDirection: 'row',
    gap: 8,
    zIndex: 100,
  },
  button: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  buttonText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

export default ScoreActionButtons;
