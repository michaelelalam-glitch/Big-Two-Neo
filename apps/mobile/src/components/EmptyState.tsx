import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, OVERLAYS, CENTER_PLAY } from '../constants';

interface EmptyStateProps {
  /** Primary message displayed to user */
  title: string;
  
  /** Optional secondary message with more context */
  subtitle?: string;
  
  /** Optional icon/emoji to display above text */
  icon?: string;
  
  /** Optional action button configuration */
  action?: {
    label: string;
    onPress: () => void;
  };
  
  /** Visual style variant - defaults to 'default' */
  variant?: 'default' | 'dashed' | 'minimal';
}

/**
 * Reusable empty state component for screens with no data.
 * Based on CenterPlayArea empty state design pattern.
 * 
 * Usage:
 * ```tsx
 * <EmptyState
 *   icon="🏆"
 *   title="No rankings yet"
 *   subtitle="Play some games to appear on the leaderboard!"
 *   action={{ label: "Play Now", onPress: handlePlay }}
 * />
 * ```
 */
export default function EmptyState({
  title,
  subtitle,
  icon,
  action,
  variant = 'default',
}: EmptyStateProps) {
  const containerStyle = [
    styles.container,
    variant === 'dashed' && styles.containerDashed,
    variant === 'minimal' && styles.containerMinimal,
  ];

  return (
    <View style={containerStyle}>
      {icon && <Text style={styles.icon}>{icon}</Text>}
      
      <Text style={styles.title}>{title}</Text>
      
      {subtitle && (
        <Text style={styles.subtitle}>{subtitle}</Text>
      )}
      
      {action && (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={action.onPress}
          activeOpacity={0.7}
        >
          <Text style={styles.actionButtonText}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xl,
  },
  containerDashed: {
    backgroundColor: OVERLAYS.emptyStateBackground,
    borderRadius: CENTER_PLAY.emptyStateBorderRadius,
    borderWidth: CENTER_PLAY.emptyStateBorderWidth,
    borderColor: OVERLAYS.emptyStateBorder,
    borderStyle: 'dashed',
  },
  containerMinimal: {
    backgroundColor: 'transparent',
  },
  icon: {
    fontSize: 64,
    marginBottom: SPACING.md,
  },
  title: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  subtitle: {
    color: `${COLORS.white}99`, // 60% opacity (hex: 99 = 60%)
    fontSize: FONT_SIZES.md,
    textAlign: 'center',
    marginBottom: SPACING.xl,
    lineHeight: FONT_SIZES.md * 1.5,
  },
  actionButton: {
    backgroundColor: COLORS.accent,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: 8,
    marginTop: SPACING.md,
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
});
