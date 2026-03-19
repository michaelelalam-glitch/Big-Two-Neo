/**
 * GameErrorBoundary Component
 *
 * Error boundary for game screens (MultiplayerGame, LocalAIGame).
 * A single hook failure inside either game component would previously crash the
 * whole app. This boundary catches render errors, shows a recovery UI, and lets
 * the player retry or return to the main menu without losing navigation state.
 *
 * Modelled on ScoreboardErrorBoundary (Task #364).
 * Created as part of Task #643: Add React Error Boundaries to game screens.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';

// ── Theme colors ──────────────────────────────────────────────────────────────
const ERROR_COLOR = '#ff6b6b';
const PRIMARY_COLOR = '#4a9eff';
const BG_DARK = '#1a1a2e';
const TEXT_WHITE = '#ffffff';

// ── Class component (error boundaries must be class-based) ────────────────────

interface BaseProps {
  children: ReactNode;
  /** Called when the navigation back to Home is requested. */
  onReturnHome: () => void;
  /** Optional external error reporter (e.g. Sentry). */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class GameErrorBoundaryBase extends Component<BaseProps, State> {
  constructor(props: BaseProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (__DEV__) {
      console.error('[GameErrorBoundary] Error caught:', error);
      console.error('[GameErrorBoundary] Component stack:', errorInfo.componentStack);
    }
    this.props.onError?.(error, errorInfo);
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
        <View style={styles.card}>
          <Text style={styles.icon}>🎮</Text>
          <Text style={styles.title}>Game Error</Text>
          <Text style={styles.message}>
            Something went wrong during the game. You can try again or return to the main menu.
          </Text>

          {__DEV__ && this.state.error && (
            <Text style={styles.details}>{this.state.error.message}</Text>
          )}

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={this.handleReset}
            activeOpacity={0.7}
            accessibilityLabel="Try Again"
            accessibilityHint="Attempts to restart the current game screen"
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Try Again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={this.props.onReturnHome}
            activeOpacity={0.7}
            accessibilityLabel="Return to Menu"
            accessibilityHint="Navigates back to the main menu"
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Return to Menu</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

// ── Public wrapper (provides navigation hook to the class boundary) ────────────

interface Props {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

type GameNavProp = StackNavigationProp<RootStackParamList, 'Game'>;

export function GameErrorBoundary({ children, onError }: Props) {
  const navigation = useNavigation<GameNavProp>();

  const handleReturnHome = React.useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [navigation]);

  return (
    <GameErrorBoundaryBase onReturnHome={handleReturnHome} onError={onError}>
      {children}
    </GameErrorBoundaryBase>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: BG_DARK,
  },
  card: {
    backgroundColor: '#2a2a3e',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    maxWidth: 400,
    width: '100%',
    borderWidth: 2,
    borderColor: ERROR_COLOR,
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: ERROR_COLOR,
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: TEXT_WHITE,
    textAlign: 'center',
    marginBottom: 16,
    opacity: 0.8,
    lineHeight: 20,
  },
  details: {
    fontSize: 12,
    color: ERROR_COLOR,
    textAlign: 'center',
    marginBottom: 16,
    opacity: 0.7,
    fontFamily: 'monospace',
  },
  primaryButton: {
    backgroundColor: PRIMARY_COLOR,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
    minWidth: 160,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: TEXT_WHITE,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: TEXT_WHITE,
    minWidth: 160,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: TEXT_WHITE,
    fontSize: 16,
    fontWeight: '500',
    opacity: 0.8,
  },
});
