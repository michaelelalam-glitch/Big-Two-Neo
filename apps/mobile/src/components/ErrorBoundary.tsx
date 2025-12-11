import React, { Component, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT_SIZES } from '../constants';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary component catches React errors in child components
 * and displays a fallback UI instead of crashing the entire app.
 * 
 * Usage:
 * <ErrorBoundary
 *   fallback={<CustomErrorUI />}
 *   onError={(error, info) => logToService(error)}
 *   onReset={() => resetComponentState()}
 * >
 *   <YourComponent />
 * </ErrorBoundary>
 * 
 * Note: onReset is called when user clicks "Try Again" - use it to reset
 * parent component state to prevent the same error from occurring again.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  /**
   * Update state when error is caught
   * This is called during the render phase, so side effects are not allowed
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * Log error details after error is caught
   * This is called during the commit phase, so side effects are allowed
   */
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to console in development
    console.error('ErrorBoundary caught an error:', error);
    console.error('Component stack:', errorInfo.componentStack);

    // Call optional error handler (can be used for error reporting services)
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // TODO: Send to error reporting service in production
    // Example: Sentry.captureException(error, { contexts: { react: errorInfo } });
  }

  /**
   * Reset error state (for retry functionality)
   */
  resetError = () => {
    // Call optional reset handler to allow parent to reset state
    if (this.props.onReset) {
      try {
        this.props.onReset();
      } catch (resetError) {
        console.error('[ErrorBoundary] onReset failed:', resetError);
      }
    }
    
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <View style={styles.container}>
          <View style={styles.errorCard}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.errorMessage}>
              {__DEV__
                ? (this.state.error?.message || 'An unexpected error occurred')
                : 'An unexpected error occurred'}
            </Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={this.resetError}
            >
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  errorCard: {
    backgroundColor: COLORS.secondary,
    borderRadius: 16,
    padding: SPACING.xl,
    alignItems: 'center',
    maxWidth: 400,
    width: '100%',
  },
  errorIcon: {
    fontSize: 64,
    marginBottom: SPACING.md,
  },
  errorTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    opacity: 0.8,
    marginBottom: SPACING.xl,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    backgroundColor: COLORS.accent,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: 8,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
  },
});

export default ErrorBoundary;
