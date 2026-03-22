/**
 * ThrowButton — standalone floating action button for throwing items at opponents.
 *
 * Shows a 🎯 emoji normally. During the 30-second cooldown it displays a spinner
 * + remaining seconds so the player knows when they can throw again.
 *
 * Deliberately separate from HelperButtons (Sort/Smart/Hint) per user request.
 */

import React from 'react';
import { Pressable, View, Text, ActivityIndicator, StyleSheet } from 'react-native';

interface ThrowButtonProps {
  onPress: () => void;
  isThrowCooldown: boolean;
  cooldownRemaining: number;
  isDisabled?: boolean;
}

export function ThrowButton({
  onPress,
  isThrowCooldown,
  cooldownRemaining,
  isDisabled = false,
}: ThrowButtonProps) {
  const disabled = isThrowCooldown || isDisabled;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
      accessibilityLabel="Throw a throwable"
      accessibilityHint="Throw an egg, smoke, or confetti at another player"
    >
      {isThrowCooldown ? (
        <View style={styles.cooldownContent}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.cooldownText}>{cooldownRemaining}s</Text>
        </View>
      ) : (
        <Text style={styles.emoji}>🎯</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0D9488',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  buttonDisabled: {
    backgroundColor: '#374151',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  cooldownContent: {
    alignItems: 'center',
    gap: 2,
  },
  cooldownText: {
    fontSize: 9,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  emoji: {
    fontSize: 22,
  },
});
