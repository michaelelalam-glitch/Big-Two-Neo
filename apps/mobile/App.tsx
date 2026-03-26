// Side-effect 'react-native-gesture-handler' import lives in index.ts (the entry point)
// so it executes before any other app code, per the library's setup requirements.
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// Explicit import removed - Babel plugin handles initialization in v4.1.6+
// See: https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/installation
import 'react-native-reanimated';
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/contexts/AuthContext';
import { i18n } from './src/i18n';
import AppNavigator from './src/navigation/AppNavigator';
import { initSentry, sentryCapture } from './src/services/sentry';
import { trackEvent } from './src/services/analytics';

// ── Sentry: initialise before any React tree renders ─────────────────────────
// Placing init here (module-level) ensures Sentry is ready before the first
// render cycle, so any early errors are captured.
initSentry();

// ── Global unhandled native error handler ─────────────────────────────────────
// Catches native bridge errors (e.g. modal orientation mismatches) that error
// boundaries cannot intercept. Logs and swallows them to prevent hard crashes.
// ErrorUtils is a React Native runtime global — guard for non-RN environments (tests, web).
// Guard with a flag to prevent re-wrapping on hot-reload / fast-refresh.
if (
  typeof (globalThis as Record<string, unknown>).ErrorUtils !== 'undefined' &&
  !(globalThis as Record<string, unknown>).__big2ErrorHandlerInstalled
) {
  (globalThis as Record<string, unknown>).__big2ErrorHandlerInstalled = true;
  const EU = (globalThis as Record<string, unknown>).ErrorUtils as {
    getGlobalHandler: () => (error: Error, isFatal?: boolean) => void;
    setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
  };
  const originalHandler = EU.getGlobalHandler();
  EU.setGlobalHandler((error: Error, isFatal?: boolean) => {
    if (__DEV__) {
      console.error('[GlobalErrorHandler] Unhandled error (fatal:', isFatal, '):', error?.message);
    }
    // Only suppress known non-fatal orientation/modal errors
    if (
      !isFatal &&
      error?.message?.includes('supportedInterfaceOrientations') &&
      error?.message?.includes('UIViewController')
    ) {
      // Swallow — already fixed in AppDelegate; this is a safety net
      return;
    }
    // Report fatal errors to Sentry before forwarding to the original handler
    if (isFatal) {
      sentryCapture.exception(error, {
        context: 'GlobalErrorHandler',
        tags: { fatal: 'true' },
      });
    }
    // Forward everything else to the original handler
    originalHandler?.(error, isFatal);
  });
}

export default function App() {
  const [i18nInitialized, setI18nInitialized] = useState(false);

  useEffect(() => {
    // Initialize i18n system on app start
    i18n.initialize().then(() => {
      setI18nInitialized(true);
      // Track app_open after i18n is ready (first meaningful milestone)
      trackEvent('app_open');
    });
  }, []);

  if (!i18nInitialized) {
    // Show loading screen while i18n initializes
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#25292e' }}>
        <ActivityIndicator size="large" color="#4A90E2" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <StatusBar style="light" />
        <AppNavigator />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
