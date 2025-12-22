import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONT_SIZES, SPACING } from '../constants';

export type Rank = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Master' | 'Grandmaster';

interface RankBadgeProps {
  rank: Rank;
  elo: number;
  size?: 'small' | 'medium' | 'large';
  showElo?: boolean;
  style?: object;
}

const RANK_CONFIG: Record<Rank, { emoji: string; color: string; bgColor: string }> = {
  Bronze: { emoji: '🥉', color: '#CD7F32', bgColor: 'rgba(205, 127, 50, 0.1)' },
  Silver: { emoji: '🥈', color: '#C0C0C0', bgColor: 'rgba(192, 192, 192, 0.1)' },
  Gold: { emoji: '🥇', color: '#FFD700', bgColor: 'rgba(255, 215, 0, 0.1)' },
  Platinum: { emoji: '💎', color: '#E5E4E2', bgColor: 'rgba(229, 228, 226, 0.1)' },
  Diamond: { emoji: '💠', color: '#B9F2FF', bgColor: 'rgba(185, 242, 255, 0.1)' },
  Master: { emoji: '👑', color: '#9370DB', bgColor: 'rgba(147, 112, 219, 0.1)' },
  Grandmaster: { emoji: '🏆', color: '#FF6B35', bgColor: 'rgba(255, 107, 53, 0.1)' },
};

const SIZE_CONFIG = {
  small: { emoji: 16, text: FONT_SIZES.xs, elo: FONT_SIZES.xs, padding: SPACING.xs },
  medium: { emoji: 24, text: FONT_SIZES.md, elo: FONT_SIZES.sm, padding: SPACING.sm },
  large: { emoji: 32, text: FONT_SIZES.xl, elo: FONT_SIZES.md, padding: SPACING.md },
};

/**
 * RankBadge - Displays player rank with emoji, color, and ELO rating
 * 
 * Usage:
 * ```tsx
 * <RankBadge rank="Gold" elo={1250} size="medium" showElo={true} />
 * ```
 */
export function RankBadge({ rank, elo, size = 'medium', showElo = true, style }: RankBadgeProps) {
  const config = RANK_CONFIG[rank];
  const sizeConfig = SIZE_CONFIG[size];

  return (
    <View style={[styles.container, { backgroundColor: config.bgColor }, style]}>
      <View style={[styles.badge, { padding: sizeConfig.padding }]}>
        <Text style={{ fontSize: sizeConfig.emoji }}>{config.emoji}</Text>
        <View style={styles.textContainer}>
          <Text style={[styles.rankText, { fontSize: sizeConfig.text, color: config.color }]}>
            {rank}
          </Text>
          {showElo && (
            <Text style={[styles.eloText, { fontSize: sizeConfig.elo }]}>
              {elo} ELO
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  textContainer: {
    flexDirection: 'column',
  },
  rankText: {
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  eloText: {
    color: COLORS.gray.medium,
    fontWeight: '600',
  },
});
