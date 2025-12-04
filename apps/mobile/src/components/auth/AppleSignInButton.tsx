import React from 'react';
import { Platform, StyleSheet, TouchableOpacity, Text, View } from 'react-native';
import { AppleButton, appleAuth } from '@invertase/react-native-apple-authentication';
import { supabase } from '../../services/supabase';
import type { SignInWithIdTokenCredentials } from '@supabase/supabase-js';

const AppleSignInButton = () => {
  const onAppleButtonPress = async () => {
    try {
      // Perform Apple sign-in request
      const appleAuthRequestResponse = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
      });

      // Get credential state (only works on real devices)
      let credentialState;
      try {
        credentialState = await appleAuth.getCredentialStateForUser(
          appleAuthRequestResponse.user
        );
      } catch (e) {
        console.log('Credential state check failed (expected on simulator):', e);
        // Continue anyway for simulator testing
        credentialState = appleAuth.State.AUTHORIZED;
      }

      console.log('Apple sign in successful:', {
        credentialState,
        appleAuthRequestResponse,
      });

      if (
        credentialState === appleAuth.State.AUTHORIZED &&
        appleAuthRequestResponse.identityToken &&
        appleAuthRequestResponse.authorizationCode
      ) {
        const signInWithIdTokenCredentials: SignInWithIdTokenCredentials = {
          provider: 'apple',
          token: appleAuthRequestResponse.identityToken,
          nonce: appleAuthRequestResponse.nonce,
          access_token: appleAuthRequestResponse.authorizationCode,
        };

        const { data, error } = await supabase.auth.signInWithIdToken(
          signInWithIdTokenCredentials
        );

        if (error) {
          console.error('Error signing in with Apple:', error);
          throw error;
        }

        if (data) {
          console.log('Apple sign in successful:', data);
        }
      }
    } catch (error: any) {
      console.error('Error during Apple sign in:', error);
      if (error.code === appleAuth.Error.CANCELED) {
        console.log('User canceled Apple Sign in');
      } else {
        throw error;
      }
    }
  };

  // iOS - Show native Apple Button
  if (Platform.OS === 'ios') {
    return (
      <AppleButton
        buttonStyle={AppleButton.Style.BLACK}
        buttonType={AppleButton.Type.SIGN_IN}
        style={styles.appleButton}
        onPress={onAppleButtonPress}
      />
    );
  }

  // Android - Show custom button
  if (Platform.OS === 'android') {
    return (
      <TouchableOpacity style={styles.customButton} onPress={onAppleButtonPress}>
        <View style={styles.buttonContent}>
          <Text style={styles.buttonText}>Sign in with Apple</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // Unsupported platform
  return null;
};

const styles = StyleSheet.create({
  appleButton: {
    width: '100%',
    height: 50,
  },
  customButton: {
    width: '100%',
    height: 50,
    backgroundColor: '#000',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
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
