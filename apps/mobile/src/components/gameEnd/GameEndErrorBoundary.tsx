/**
 * GameEndErrorBoundary - Error boundary for Game End Modal
 * CRITICAL FIX: Prevents entire game crash if modal encounters an error
 * 
 * Features:
 * - Catches React errors in Game End components
 * - Shows user-friendly error message
 * - Allows user to retry or dismiss
 * - Logs errors for debugging
 * 
 * Created: December 16, 2025
 */

import React, { Component, ReactNode, ErrorInfo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class GameEndErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console for debugging
    console.error('❌ [GameEndErrorBoundary] Caught error:', error);
    console.error('📍 [GameEndErrorBoundary] Component stack:', errorInfo.componentStack);
    
    // Update state with error info
    this.setState({
      error,
      errorInfo,
    });
    
    // TODO: Send error to logging service (e.g., Sentry)
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    
    // Call parent reset callback if provided
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.errorCard}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>Game End Error</Text>
            <Text style={styles.errorMessage}>
              Something went wrong while displaying the game results.
            </Text>
            
            {__DEV__ && this.state.error && (
              <View style={styles.debugInfo}>
                <Text style={styles.debugTitle}>Debug Info:</Text>
                <Text style={styles.debugText}>{this.state.error.toString()}</Text>
                {this.state.errorInfo && (
                  <Text style={styles.debugText} numberOfLines={5}>
                    {this.state.errorInfo.componentStack}
                  </Text>
                )}
              </View>
            )}
            
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.button, styles.retryButton]}
                onPress={this.handleReset}
                activeOpacity={0.7}
              >
                <Text style={styles.buttonText}>Try Again</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.button, styles.dismissButton]}
                onPress={() => {
                  // Just reset the error state
                  this.handleReset();
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.buttonText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
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
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorCard: {
    backgroundColor: '#1f2937',
    borderRadius: 16,
    padding: 24,
    maxWidth: 400,
    width: '100%',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  errorIcon: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f3f4f6',
    textAlign: 'center',
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  debugInfo: {
    backgroundColor: '#111827',
    borderRadius: 8,
    padding: 12,
    marginBottom: 24,
  },
  debugTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fbbf24',
    marginBottom: 8,
  },
  debugText: {
    fontSize: 11,
    color: '#6b7280',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 50,
  },
  retryButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  dismissButton: {
    backgroundColor: 'rgba(156, 163, 175, 0.2)',
    borderWidth: 1,
    borderColor: '#6b7280',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f3f4f6',
  },
});

export default GameEndErrorBoundary;
