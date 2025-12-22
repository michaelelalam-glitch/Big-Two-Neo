import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, BADGE, SHADOWS, OPACITIES } from '../../constants';
import { CardCountBadge } from '../scoreboard/CardCountBadge';

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
          {/* Default avatar icon - matches landscape opponent emoji */}
          <Text style={styles.avatarIcon}>👤</Text>
        </View>
        {/* Card count badge positioned on avatar */}
        <View style={styles.badgePosition}>
          <CardCountBadge cardCount={cardCount} visible={true} />
        </View>
      </View>

      {/* Player name badge */}
      <View style={styles.nameBadge}>
        <Text style={styles.nameText} numberOfLines={1}>
          {name}
        </Text>
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
    shadowOffset: SHADOWS.activeAvatar.offset,
    shadowOpacity: SHADOWS.activeAvatar.opacity,
    shadowRadius: SHADOWS.activeAvatar.radius,
    elevation: SHADOWS.activeAvatar.elevation,
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
    fontSize: LAYOUT.avatarIconSize,
    textAlign: 'center',
  },
  nameBadge: {
    backgroundColor: OVERLAYS.nameBadgeBackground,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BADGE.nameBorderRadius,
    borderWidth: BADGE.nameBorderWidth,
    borderColor: COLORS.white,
    minWidth: BADGE.nameMinWidth,
    alignItems: 'center',
  },
  nameText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
  },
  badgePosition: {
    position: 'absolute',
    top: -6,
    right: -6,
    zIndex: 10,
  },
});
