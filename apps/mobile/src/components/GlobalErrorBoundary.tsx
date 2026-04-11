/**
 * GlobalErrorBoundary Component
 *
 * App-level error boundary placed in AppNavigator around the NavigationContainer.
 * Acts as the last line of defence — catches any render error not handled by a
 * more specific boundary (GameErrorBoundary, ScoreboardErrorBoundary, etc.).
 *
 * Because this sits above NavigationContainer, it cannot use navigation hooks.
 * The recovery action is a simple "Try Again" reset.
 *
 * Created as part of Task #643: Add React Error Boundaries to game screens.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { trackError } from '../services/analytics';
import { sentryCapture } from '../services/sentry';
import { uiLogger } from '../utils/logger';

// ── Theme colors ──────────────────────────────────────────────────────────────
const ERROR_COLOR = '#ff6b6b';
const PRIMARY_COLOR = '#4a9eff';
const BG_DARK = '#25292e';
const TEXT_WHITE = '#ffffff';

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (__DEV__) {
      uiLogger.error('[GlobalErrorBoundary] Uncaught app error:', error);
      uiLogger.error('[GlobalErrorBoundary] Component stack:', errorInfo.componentStack);
    }
    // Forward to Sentry for crash reporting
    sentryCapture.exception(error, {
      context: 'GlobalErrorBoundary',
      extra: {
        componentStack: errorInfo.componentStack?.slice(0, 500) ?? 'unknown',
      },
    });
    // Also log to Firebase Analytics as a fatal error event
    trackError('GlobalErrorBoundary', error.message, true);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.container} accessibilityLiveRegion="polite" accessibilityRole="alert">
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>An unexpected error occurred. Please try again.</Text>

        {__DEV__ && this.state.error && (
          <Text style={styles.details}>{this.state.error.message}</Text>
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={this.handleReset}
          activeOpacity={0.7}
          accessibilityLabel="Try Again"
          accessibilityHint="Attempts to reload the application"
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: BG_DARK,
  },
  icon: {
    fontSize: 56,
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: ERROR_COLOR,
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: TEXT_WHITE,
    textAlign: 'center',
    marginBottom: 20,
    opacity: 0.8,
    lineHeight: 22,
  },
  details: {
    fontSize: 12,
    color: ERROR_COLOR,
    textAlign: 'center',
    marginBottom: 20,
    opacity: 0.7,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: PRIMARY_COLOR,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    minWidth: 160,
    alignItems: 'center',
  },
  buttonText: {
    color: TEXT_WHITE,
    fontSize: 16,
    fontWeight: '600',
  },
});
