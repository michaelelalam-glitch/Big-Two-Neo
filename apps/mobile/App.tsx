// Side-effect 'react-native-gesture-handler' import lives in index.ts (the entry point)
// so it executes before any other app code, per the library's setup requirements.
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// Explicit import removed - Babel plugin handles initialization in v4.1.6+
// See: https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/installation
import 'react-native-reanimated';
import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/contexts/AuthContext';
import { i18n } from './src/i18n';
import AppNavigator from './src/navigation/AppNavigator';
import { initSentry, isSentryEnabled, sentryCapture, Sentry } from './src/services/sentry';
import { trackEvent, setAnalyticsConsent } from './src/services/analytics';
import PrivacyConsentModal from './src/components/privacy/PrivacyConsentModal';
import { SETTINGS_KEYS } from './src/utils/settings';

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
    // Report fatal errors to Sentry best-effort, then immediately forward to
    // the original handler. Fire-and-forget the flush so the crash path is
    // never blocked on network I/O.
    if (isFatal) {
      sentryCapture.exception(error, {
        context: 'GlobalErrorHandler',
        tags: { fatal: 'true' },
      });
      // Best-effort flush — only if Sentry is initialized; do not await, never delay the crash path.
      if (isSentryEnabled()) {
        void Sentry.flush().catch(() => {
          if (__DEV__) {
            console.warn('[GlobalErrorHandler] Sentry.flush failed after fatal error');
          }
        });
      }
      originalHandler?.(error, isFatal);
      return;
    }
    // Forward non-fatal errors to the original handler
    originalHandler?.(error, isFatal);
  });
}

export default function App() {
  const [i18nInitialized, setI18nInitialized] = useState(false);
  // null = not yet decided (show modal); true/false = persisted choice
  const [consentDecision, setConsentDecision] = useState<boolean | null | 'loading'>('loading');

  useEffect(() => {
    // Read consent decision and initialise i18n in parallel.
    // Both must complete before rendering the main app or showing the modal.
    void Promise.all([
      i18n.initialize(),
      AsyncStorage.getItem(SETTINGS_KEYS.ANALYTICS_CONSENT),
    ]).then(([, consentRaw]) => {
      setI18nInitialized(true);

      if (consentRaw === null) {
        // First launch — show consent modal (do NOT enable analytics or Sentry yet)
        setConsentDecision(null);
      } else if (consentRaw === 'true' || consentRaw === 'false') {
        const consented = consentRaw === 'true';
        setConsentDecision(consented);
        setAnalyticsConsent(consented);
        if (consented) {
          initSentry();
          trackEvent('app_open');
        }
      } else {
        // Corrupted/unexpected value — wipe it and re-prompt rather than silently assuming decline
        if (__DEV__) {
          console.warn('[App] Unexpected consent storage value:', consentRaw, '— re-prompting');
        }
        void AsyncStorage.removeItem(SETTINGS_KEYS.ANALYTICS_CONSENT).catch(() => {});
        setConsentDecision(null);
      }
    }).catch((error) => {
      // If init fails (e.g. AsyncStorage corrupted), fall back to showing the
      // consent modal with analytics disabled so the app stays usable.
      if (__DEV__) {
        console.warn('[App] init Promise.all failed:', error);
      }
      setI18nInitialized(true);
      setConsentDecision(null);
      setAnalyticsConsent(false);
    });
  }, []);

  const handleConsentAccept = useCallback(async () => {
    try {
      await AsyncStorage.setItem(SETTINGS_KEYS.ANALYTICS_CONSENT, 'true');
    } catch (error) {
      if (__DEV__) {
        console.warn('[App] Failed to persist analytics consent (accept):', error);
      }
      try {
        sentryCapture.exception(error, { context: 'ConsentAccept' });
      } catch {
        // Swallow secondary errors from reporting
      }
    }
    setConsentDecision(true);
    setAnalyticsConsent(true);
    initSentry();
    trackEvent('app_open');
  }, []);

  const handleConsentDecline = useCallback(() => {
    void AsyncStorage.setItem(SETTINGS_KEYS.ANALYTICS_CONSENT, 'false').catch((error) => {
      if (__DEV__) {
        console.warn('[App] Failed to persist analytics consent (decline):', error);
      }
      // Sentry not initialized on decline path — error is dev-logged only
    });
    setConsentDecision(false);
    setAnalyticsConsent(false);
  }, []);

  if (!i18nInitialized || consentDecision === 'loading') {
    // Show loading screen while i18n and AsyncStorage initialise
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
        {/* Consent modal is shown above everything else on first launch */}
        <PrivacyConsentModal
          visible={consentDecision === null}
          onAccept={handleConsentAccept}
          onDecline={handleConsentDecline}
        />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
