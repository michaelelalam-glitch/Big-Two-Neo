import React from 'react';
import { Text, StyleSheet, Animated } from 'react-native';
import { COLORS, FONT_SIZES, SPACING } from '../constants';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
  style?: object;
}

/**
 * ConnectionStatusIndicator - Shows real-time connection status
 * 
 * Usage:
 * ```tsx
 * <ConnectionStatusIndicator status={isConnected ? 'connected' : 'reconnecting'} />
 * ```
 */
export function ConnectionStatusIndicator({ status, style }: ConnectionStatusIndicatorProps) {
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  // Pulse animation for reconnecting state
  React.useEffect(() => {
    if (status === 'reconnecting') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.5,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status, pulseAnim]);

  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return {
          icon: '🟢',
          text: 'Connected',
          color: COLORS.success,
          bg: 'rgba(16, 185, 129, 0.1)',
        };
      case 'reconnecting':
        return {
          icon: '🟡',
          text: 'Reconnecting...',
          color: '#F59E0B',
          bg: 'rgba(245, 158, 11, 0.1)',
        };
      case 'disconnected':
        return {
          icon: '🔴',
          text: 'Disconnected',
          color: COLORS.error,
          bg: 'rgba(239, 68, 68, 0.1)',
        };
    }
  };

  const config = getStatusConfig();

  // Don't show indicator for connected state (only show issues)
  if (status === 'connected') {
    return null;
  }

  return (
    <Animated.View 
      style={[
        styles.container, 
        { backgroundColor: config.bg, opacity: pulseAnim },
        style
      ]}
    >
      <Text style={styles.icon}>{config.icon}</Text>
      <Text style={[styles.text, { color: config.color }]}>
        {config.text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 20,
    gap: SPACING.xs,
  },
  icon: {
    fontSize: 12,
  },
  text: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
});
