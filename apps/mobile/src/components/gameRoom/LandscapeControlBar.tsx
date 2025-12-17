/**
 * LandscapeControlBar Component
 * 
 * Bottom control bar for landscape game room
 * 
 * Features:
 * - 6 button groups (Help, Orientation, Sort, Actions, Hints, Settings)
 * - 44pt minimum touch targets (WCAG AA)
 * - Fixed bottom positioning with safe area
 * - Orientation toggle button (landscape ↔ portrait)
 * - Responsive button sizing
 * 
 * Task #451: Implement control bar with all button groups
 * Date: December 19, 2025
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface LandscapeControlBarProps {
  /** Help button handler */
  onHelp?: () => void;
  /** Orientation toggle handler (landscape ↔ portrait) */
  onOrientationToggle?: () => void;
  /** Sort cards handler */
  onSort?: () => void;
  /** Smart sort handler */
  onSmartSort?: () => void;
  /** Play cards handler */
  onPlay?: () => void;
  /** Pass turn handler */
  onPass?: () => void;
  /** Hint button handler */
  onHint?: () => void;
  /** Settings button handler */
  onSettings?: () => void;
  /** Disabled state for action buttons */
  disabled?: boolean;
  /** Can player play cards */
  canPlay?: boolean;
  /** Can player pass */
  canPass?: boolean;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LandscapeControlBar({
  onHelp,
  onOrientationToggle,
  onSort,
  onSmartSort,
  onPlay,
  onPass,
  onHint,
  onSettings,
  disabled = false,
  canPlay = false,
  canPass = false,
}: LandscapeControlBarProps) {
  // Haptic feedback helper
  const triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Render button
  const renderButton = (
    label: string,
    onPress?: () => void,
    variant: 'default' | 'primary' | 'secondary' | 'ghost' = 'default',
    isDisabled: boolean = false,
    testID?: string
  ) => {
    const handlePress = () => {
      if (isDisabled || !onPress) return;
      triggerHaptic();
      onPress();
    };

    const buttonStyle = [
      styles.button,
      variant === 'primary' && styles.buttonPrimary,
      variant === 'secondary' && styles.buttonSecondary,
      variant === 'ghost' && styles.buttonGhost,
      isDisabled && styles.buttonDisabled,
    ];

    const textStyle = [
      styles.buttonText,
      variant === 'primary' && styles.buttonTextPrimary,
      variant === 'secondary' && styles.buttonTextSecondary,
      variant === 'ghost' && styles.buttonTextGhost,
      isDisabled && styles.buttonTextDisabled,
    ];

    return (
      <Pressable
        style={({ pressed }) => [
          ...buttonStyle,
          pressed && !isDisabled && styles.buttonPressed,
        ]}
        onPress={handlePress}
        disabled={isDisabled}
        testID={testID}
      >
        <Text style={textStyle}>{label}</Text>
      </Pressable>
    );
  };

  // Render icon button
  const renderIconButton = (
    icon: string,
    onPress?: () => void,
    isDisabled: boolean = false,
    testID?: string
  ) => {
    const handlePress = () => {
      if (isDisabled || !onPress) return;
      triggerHaptic();
      onPress();
    };

    return (
      <Pressable
        style={({ pressed }) => [
          styles.iconButton,
          pressed && !isDisabled && styles.iconButtonPressed,
          isDisabled && styles.iconButtonDisabled,
        ]}
        onPress={handlePress}
        disabled={isDisabled}
        testID={testID}
      >
        <Text style={[styles.iconButtonText, isDisabled && styles.iconButtonTextDisabled]}>
          {icon}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['bottom']} style={styles.container}>
      <View style={styles.innerContainer}>
        {/* Group 1: Help */}
        <View style={styles.buttonGroup}>
          {renderIconButton('❓', onHelp, disabled, 'help-button')}
        </View>

        {/* Group 2: Orientation Toggle */}
        <View style={styles.buttonGroup}>
          {renderIconButton('🔄', onOrientationToggle, false, 'orientation-toggle-button')}
        </View>

        {/* Group 3: Sort Buttons */}
        <View style={styles.buttonGroup}>
          {renderButton('Sort', onSort, 'ghost', disabled, 'sort-button')}
          {renderButton('Smart', onSmartSort, 'ghost', disabled, 'smart-sort-button')}
        </View>

        {/* Group 4: Action Buttons (Play & Pass) */}
        <View style={styles.buttonGroup}>
          {renderButton('Play', onPlay, 'primary', !canPlay || disabled, 'play-button')}
          {renderButton('Pass', onPass, 'secondary', !canPass || disabled, 'pass-button')}
        </View>

        {/* Group 5: Hint */}
        <View style={styles.buttonGroup}>
          {renderIconButton('💡', onHint, disabled, 'hint-button')}
        </View>

        {/* Group 6: Settings */}
        <View style={styles.buttonGroup}>
          {renderIconButton('⚙️', onSettings, false, 'settings-button')}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(17, 24, 39, 0.95)', // Dark background with transparency
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },

  innerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 68,
  },

  // Button group
  buttonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // Standard button (text)
  button: {
    minWidth: 64,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  buttonPrimary: {
    backgroundColor: '#10b981', // Green
    borderColor: '#10b981',
  },

  buttonSecondary: {
    backgroundColor: '#6b7280', // Gray
    borderColor: '#6b7280',
  },

  buttonGhost: {
    backgroundColor: 'transparent',
    borderColor: '#d1d5db',
  },

  buttonDisabled: {
    opacity: 0.5,
  },

  buttonPressed: {
    transform: [{ scale: 0.95 }],
  },

  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },

  buttonTextPrimary: {
    color: '#ffffff',
  },

  buttonTextSecondary: {
    color: '#ffffff',
  },

  buttonTextGhost: {
    color: '#d1d5db',
  },

  buttonTextDisabled: {
    opacity: 0.5,
  },

  // Icon button (44×44pt)
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
  },

  iconButtonPressed: {
    transform: [{ scale: 0.95 }],
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },

  iconButtonDisabled: {
    opacity: 0.5,
  },

  iconButtonText: {
    fontSize: 20,
    color: '#374151',
  },

  iconButtonTextDisabled: {
    opacity: 0.5,
  },
});

export default LandscapeControlBar;
