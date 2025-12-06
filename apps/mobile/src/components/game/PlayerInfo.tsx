import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';

interface PlayerInfoProps {
  name: string;
  cardCount: number;
  score: number;
  isActive: boolean; // Current turn indicator
  position: 'top' | 'left' | 'right' | 'bottom';
}

export default function PlayerInfo({
  name,
  cardCount,
  score,
  isActive,
  position,
}: PlayerInfoProps) {
  return (
    <View style={styles.container}>
      {/* Avatar with turn indicator */}
      <View style={[styles.avatarContainer, isActive && styles.activeAvatar]}>
        <View style={styles.avatar}>
          {/* Default avatar icon - using user silhouette placeholder */}
          <View style={styles.avatarIcon} />
        </View>
      </View>

      {/* Player name badge */}
      <View style={styles.nameBadge}>
        <Text style={styles.nameText} numberOfLines={1}>
          {name}
        </Text>
      </View>

      {/* Card count badge */}
      <View style={styles.cardCountBadge}>
        <Text style={styles.cardCountIcon}>🃏</Text>
        <Text style={styles.cardCountText}>{cardCount}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarContainer: {
    width: 70, // Exact Figma width
    height: 70, // Exact Figma height
    borderRadius: 35,
    padding: 4,
    backgroundColor: COLORS.gray.dark,
    marginBottom: SPACING.sm,
  },
  activeAvatar: {
    backgroundColor: '#E74C3C', // Red border for active turn
    shadowColor: '#E74C3C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 31,
    backgroundColor: COLORS.gray.medium,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.gray.light,
    opacity: 0.6,
  },
  nameBadge: {
    backgroundColor: 'rgba(46, 125, 50, 0.9)', // Green badge
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.white,
    minWidth: 80,
    alignItems: 'center',
  },
  nameText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
  },
  cardCountBadge: {
    position: 'absolute',
    top: 52,
    left: -12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.black,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.gray.medium,
  },
  cardCountIcon: {
    fontSize: 12,
  },
  cardCountText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: 'bold',
  },
});
