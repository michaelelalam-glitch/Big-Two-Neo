/**
 * TotalScoreBadge Component
 * 
 * Pill-shaped badge displaying a player's total cumulative score,
 * positioned on the avatar similar to CardCountBadge.
 * 
 * Design:
 * - Positioned at bottom-left of avatar (mirrors CardCountBadge at top-right)
 * - Color-coded: green for positive, red for negative, gray for zero
 * - Compact pill shape with score value
 * 
 * Task #590 - Total score badge next to profile photo
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface TotalScoreBadgeProps {
  score: number;
  visible?: boolean;
}

function getScoreBadgeColor(score: number): string {
  if (score > 0) return '#4CAF50'; // Green for positive
  if (score < 0) return '#F44336'; // Red for negative
  return '#78909C';                // Blue-gray for zero
}

function getScoreBadgeTextColor(score: number): string {
  return '#FFFFFF';
}

function formatScore(score: number): string {
  if (score > 0) return `+${score}`;
  return `${score}`;
}

export function TotalScoreBadge({ score, visible = true }: TotalScoreBadgeProps) {
  if (!visible) return null;

  const bgColor = getScoreBadgeColor(score);
  const textColor = getScoreBadgeTextColor(score);

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <Text style={[styles.text, { color: textColor }]}>
        {formatScore(score)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 32,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
  text: {
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
});

export default TotalScoreBadge;
