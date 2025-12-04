import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
} from 'react-native';
import AppleSignInButton from '../components/auth/AppleSignInButton';
import GoogleSignInButton from '../components/auth/GoogleSignInButton';

const SignInScreen = () => {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Welcome to Big2</Text>
          <Text style={styles.subtitle}>
            Sign in to play with friends and track your progress
          </Text>
        </View>

        <View style={styles.buttonsContainer}>
          {Platform.OS === 'ios' && (
            <View style={styles.buttonWrapper}>
              <AppleSignInButton />
            </View>
          )}

          <View style={styles.buttonWrapper}>
            <GoogleSignInButton />
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            By signing in, you agree to our Terms of Service and Privacy Policy
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#25292e',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 60,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: '#a0a0a0',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  buttonsContainer: {
    width: '100%',
    maxWidth: 400,
  },
  buttonWrapper: {
    marginBottom: 16,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    paddingHorizontal: 40,
  },
  footerText: {
    fontSize: 12,
    color: '#707070',
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default SignInScreen;
