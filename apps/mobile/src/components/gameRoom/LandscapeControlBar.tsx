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
import { i18n } from '../../i18n';

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

  // Render button with portrait-matching styles
  const renderButton = (
    label: string,
    onPress?: () => void,
    variant: 'default' | 'primary' | 'secondary' | 'ghost' | 'sort' | 'smart' | 'hint' = 'default',
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
      variant === 'sort' && styles.buttonSort,  // MATCH PORTRAIT
      variant === 'smart' && styles.buttonSmart,  // MATCH PORTRAIT
      variant === 'hint' && styles.buttonHint,  // MATCH PORTRAIT
      isDisabled && styles.buttonDisabled,
    ];

    const textStyle = [
      styles.buttonText,
      variant === 'primary' && styles.buttonTextPrimary,
      variant === 'secondary' && styles.buttonTextSecondary,
      variant === 'ghost' && styles.buttonTextGhost,
      variant === 'sort' && styles.buttonTextSort,  // MATCH PORTRAIT
      variant === 'smart' && styles.buttonTextSmart,  // MATCH PORTRAIT
      variant === 'hint' && styles.buttonTextHint,  // MATCH PORTRAIT
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
        {/* Group 1: Orientation Toggle (Help button REMOVED in landscape) */}
        <View style={styles.buttonGroup}>
          {renderIconButton('🔄', onOrientationToggle, false, 'orientation-toggle-button')}
        </View>

        {/* Group 2: Sort Buttons (Match portrait styling + TRANSLATIONS) */}
        <View style={styles.buttonGroup}>
          {renderButton(i18n.t('common.sort'), onSort, 'sort', disabled, 'sort-button')}
          {renderButton(i18n.t('common.smart'), onSmartSort, 'smart', disabled, 'smart-sort-button')}
        </View>

        {/* Group 3: Action Buttons (Play & Pass + TRANSLATIONS) */}
        <View style={styles.buttonGroup}>
          {renderButton(i18n.t('common.play'), onPlay, 'primary', !canPlay || disabled, 'play-button')}
          {renderButton(i18n.t('common.pass'), onPass, 'secondary', !canPass || disabled, 'pass-button')}
        </View>

        {/* Group 4: Hint Button (Match portrait styling + TRANSLATIONS) */}
        <View style={styles.buttonGroup}>
          {renderButton(i18n.t('common.hint'), onHint, 'hint', disabled, 'hint-button')}
        </View>

        {/* Group 5: Settings */}
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
    backgroundColor: 'rgba(17, 24, 39, 0.95)', // Dark background with transparency
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },

  innerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 48,
  },

  // Button group
  buttonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // Standard button (text)
  button: {
    minWidth: 50,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,  // MATCH PORTRAIT: 12pt radius (was 6)
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  buttonPrimary: {
    backgroundColor: '#10b981', // Green (matches portrait Play button)
    borderColor: '#10b981',
    borderWidth: 0,  // MATCH PORTRAIT: No border
  },

  buttonSecondary: {
    backgroundColor: '#374151', // MATCH PORTRAIT: Dark gray (was #6b7280)
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

  // MATCH PORTRAIT: Sort button (Gray - like Pass button)
  buttonSort: {
    backgroundColor: '#374151', // Dark gray
    borderWidth: 1,
    borderColor: '#6b7280',
  },

  buttonTextSort: {
    color: '#D1D5DB', // Light gray text
  },

  // MATCH PORTRAIT: Smart button (Blue/Teal accent)
  buttonSmart: {
    backgroundColor: '#0891b2', // Teal/cyan accent
    borderWidth: 0,
  },

  buttonTextSmart: {
    color: '#FFFFFF', // White text
  },

  // MATCH PORTRAIT: Hint button (Orange/Amber accent)
  buttonHint: {
    backgroundColor: '#f59e0b', // Amber/orange accent
    borderWidth: 0,
  },

  buttonTextHint: {
    color: '#FFFFFF', // White text
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
