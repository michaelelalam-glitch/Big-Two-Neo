import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, LAYOUT } from '../../constants';

interface PlayerInfoProps {
  name: string;
  cardCount: number;
  isActive: boolean; // Current turn indicator
}

export default function PlayerInfo({
  name,
  cardCount,
  isActive,
}: PlayerInfoProps) {
  const accessibilityLabel = `${name}, ${cardCount} card${cardCount !== 1 ? 's' : ''}${isActive ? ', current turn' : ''}`;
  
  return (
    <View 
      style={styles.container}
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
    >
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
        <Text style={styles.cardCountText}>{cardCount} {cardCount === 1 ? 'Card' : 'Cards'}</Text>
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
    width: LAYOUT.avatarSize,
    height: LAYOUT.avatarSize,
    borderRadius: LAYOUT.avatarBorderRadius,
    padding: LAYOUT.avatarBorderWidth,
    backgroundColor: COLORS.gray.dark,
    marginBottom: SPACING.sm,
  },
  activeAvatar: {
    backgroundColor: COLORS.red.active, // Red border for active turn
    shadowColor: COLORS.red.active,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: LAYOUT.avatarInnerRadius,
    backgroundColor: COLORS.gray.medium,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarIcon: {
    width: LAYOUT.avatarIconSize,
    height: LAYOUT.avatarIconSize,
    borderRadius: LAYOUT.avatarIconRadius,
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
    backgroundColor: COLORS.black,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.gray.medium,
  },
  cardCountText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: 'bold',
  },
});
