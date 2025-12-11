import React from 'react';
import { Platform, StyleSheet, TouchableOpacity, Text, View } from 'react-native';
import { authLogger } from '../../utils/logger';

/**
 * Apple Sign In - DISABLED (Backlogged)
 * 
 * This feature has been temporarily disabled and moved to backlog.
 * The button is shown but does nothing when pressed.
 * 
 * TODO: Implement Apple Authentication later
 * - Set up Apple Developer account
 * - Configure Sign in with Apple capability
 * - Integrate with Supabase Auth
 */
const AppleSignInButton = () => {
  const onAppleButtonPress = () => {
    authLogger.info('Apple Sign In is currently disabled (backlogged feature)');
    // No action - feature backlogged
  };

  // iOS - Show disabled button
  if (Platform.OS === 'ios') {
    return (
      <TouchableOpacity 
        style={[styles.customButton, styles.disabledButton]} 
        onPress={onAppleButtonPress}
        activeOpacity={0.7}
        disabled={true}
      >
        <View style={styles.buttonContent}>
          <Text style={styles.buttonText}>Sign in with Apple (Coming Soon)</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // Android - Show disabled button
  if (Platform.OS === 'android') {
    return (
      <TouchableOpacity 
        style={[styles.customButton, styles.disabledButton]} 
        onPress={onAppleButtonPress}
        activeOpacity={0.7}
        disabled={true}
      >
        <View style={styles.buttonContent}>
          <Text style={styles.buttonText}>Sign in with Apple (Coming Soon)</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // Unsupported platform
  return null;
};

const styles = StyleSheet.create({
  customButton: {
    width: '100%',
    height: 50,
    backgroundColor: '#000',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default AppleSignInButton;
