/**
 * Helper Buttons Component
 * 
 * Three utility buttons for Big Two gameplay:
 * - Sort: Arrange cards lowest to highest
 * - Smart: Group cards by combo type
 * - Hint: Suggest optimal play
 * 
 * Implements GAME_HELPER_BUTTONS_SPEC.md
 * Created as part of Task #387: Helper Buttons UI
 * Date: December 13, 2025
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SPACING, FONT_SIZES } from '../../constants';

interface HelperButtonsProps {
  onSort: () => void;
  onSmartSort: () => void;
  onHint: () => void;
  disabled?: boolean;
}

export const HelperButtons: React.FC<HelperButtonsProps> = ({
  onSort,
  onSmartSort,
  onHint,
  disabled = false,
}) => {
  return (
    <View style={styles.container}>
      {/* Sort Button */}
      <Pressable
        style={({ pressed }) => [
          styles.button,
          styles.sortButton,
          disabled && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
        onPress={onSort}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Sort cards lowest to highest"
        accessibilityState={{ disabled }}
      >
        <Text style={[styles.buttonText, styles.sortButtonText]}>
          Sort
        </Text>
      </Pressable>

      {/* Smart Sort Button */}
      <Pressable
        style={({ pressed }) => [
          styles.button,
          styles.smartButton,
          disabled && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
        onPress={onSmartSort}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Smart sort by combo type"
        accessibilityState={{ disabled }}
      >
        <Text style={[styles.buttonText, styles.smartButtonText]}>
          Smart
        </Text>
      </Pressable>

      {/* Hint Button */}
      <Pressable
        style={({ pressed }) => [
          styles.button,
          styles.hintButton,
          disabled && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
        onPress={onHint}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Get hint for best play"
        accessibilityState={{ disabled }}
      >
        <Text style={[styles.buttonText, styles.hintButtonText]}>
          Hint
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  buttonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.97 }],
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: 'bold', // Match Play/Pass bold text
    color: '#FFFFFF', // White text like Play button
  },
  
  // Sort Button (Gray - match Pass button style)
  sortButton: {
    backgroundColor: '#374151', // Dark gray like Pass button
    borderWidth: 1,
    borderColor: '#6b7280',
  },
  sortButtonText: {
    color: '#D1D5DB', // Light gray text
  },
  
  // Smart Button (Blue/Teal - accent style)
  smartButton: {
    backgroundColor: '#0891b2', // Teal/cyan accent
    borderWidth: 0,
  },
  smartButtonText: {
    color: '#FFFFFF', // White text
  },
  
  // Hint Button (Orange/Amber - warning style)
  hintButton: {
    backgroundColor: '#f59e0b', // Amber/orange accent
    borderWidth: 0,
  },
  hintButtonText: {
    color: '#FFFFFF', // White text
  },
});
