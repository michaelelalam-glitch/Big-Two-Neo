/**
 * LandscapeOpponent Component
 * 
 * Displays opponent player position with profile photo and name
 * Used for top, left, and right opponent positions in landscape mode
 * 
 * Features:
 * - Profile photo display (or placeholder icon)
 * - Player name label
 * - Active turn indicator (green glow)
 * - No card count shown (per user requirement)
 * - Matches portrait PlayerInfo component styling
 * 
 * Task #461: Show other players' profile photos and names in landscape
 * Date: December 18, 2025
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, LAYOUT } from '../../constants';
import { CardCountBadge } from '../scoreboard/CardCountBadge';
import { getScoreBadgeColor, formatScore, scoreDisplayStyles } from '../../styles/scoreDisplayStyles';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface LandscapeOpponentProps {
  /** Player name */
  name: string;
  /** Number of cards in hand */
  cardCount: number;
  /** Is player's turn (shows green indicator) */
  isActive: boolean;
  /** Profile photo URL (optional) */
  photoUrl?: string | null;
  /** Layout direction: 'vertical' (name below avatar) or 'horizontal' (name to right of avatar) */
  layout?: 'vertical' | 'horizontal';
  /** Total cumulative score (Task #590) */
  totalScore?: number;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LandscapeOpponent({
  name,
  cardCount,
  isActive,
  photoUrl,
  layout = 'vertical',
  totalScore,
}: LandscapeOpponentProps) {
  
  return (
    <View style={[styles.container, layout === 'horizontal' && styles.containerHorizontal]} testID="landscape-opponent">
      {/* Avatar Circle */}
      <View style={[
        styles.avatarContainer,
        isActive && styles.avatarContainerActive,
      ]}>
        <View style={styles.avatarInner}>
          {photoUrl ? (
            // TODO: Render actual profile photo when available
            <Text style={styles.avatarIcon}>👤</Text>
          ) : (
            <Text style={styles.avatarIcon}>👤</Text>
          )}
        </View>
        {/* Card count badge positioned on avatar */}
        <View style={styles.badgePosition}>
          <CardCountBadge cardCount={cardCount} visible={true} />
        </View>
        {/* Total score badge positioned on avatar (bottom-left) - Task #590 */}
        {totalScore !== undefined && (
          <View
            style={scoreDisplayStyles.scoreBadgePosition}
            accessibilityLabel={`Score: ${formatScore(totalScore)}`}
          >
            <View style={[scoreDisplayStyles.scoreBadge, { backgroundColor: getScoreBadgeColor(totalScore) }]}>
              <Text style={scoreDisplayStyles.scoreBadgeText}>{formatScore(totalScore)}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Player Name Badge */}
      <View style={[
        styles.nameBadge,
        isActive && styles.nameBadgeActive,
      ]}>
        <Text style={styles.nameText} numberOfLines={1}>
          {name}
        </Text>
      </View>
    </View>
  );
}

// ============================================================================
// STYLES (Match portrait PlayerInfo component)
// ============================================================================

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 8,
  },

  containerHorizontal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  // Avatar (matches portrait LAYOUT.avatarSize = 70)
  avatarContainer: {
    width: LAYOUT.avatarSize,
    height: LAYOUT.avatarSize,
    borderRadius: LAYOUT.avatarBorderRadius,
    padding: LAYOUT.avatarBorderWidth, // CHANGED: Use padding instead of borderWidth for proper ring
    backgroundColor: COLORS.gray.dark, // MATCHES PORTRAIT: Dark gray ring
    justifyContent: 'center',
    alignItems: 'center',
  },

  avatarContainerActive: {
    backgroundColor: COLORS.red.active, // MATCHES PORTRAIT: Orange/red border for active turn
    shadowColor: COLORS.red.active, // MATCHES PORTRAIT: Orange glow
    shadowOffset: { width: 0, height: 0 }, // MATCHES PORTRAIT: Even glow all around
    shadowOpacity: 0.8, // MATCHES PORTRAIT: Strong glow
    shadowRadius: 8, // MATCHES PORTRAIT: Softer than before
    elevation: 8, // MATCHES PORTRAIT
  },

  avatarInner: {
    width: '100%', // MATCHES PORTRAIT: Fill parent minus padding
    height: '100%', // MATCHES PORTRAIT: Fill parent minus padding
    borderRadius: LAYOUT.avatarInnerRadius,
    backgroundColor: COLORS.gray.medium, // MATCHES PORTRAIT: Medium gray background (not darker)
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden', // MATCHES PORTRAIT: Clip contents
  },

  avatarIcon: {
    fontSize: LAYOUT.avatarIconSize,
    textAlign: 'center',
  },

  // Name Badge (matches portrait PlayerInfo component with green background)
  nameBadge: {
    backgroundColor: 'rgba(46, 125, 50, 0.9)', // Green background (matches portrait OVERLAYS.nameBadgeBackground)
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: COLORS.white, // White border (matches portrait)
    minWidth: 80,
    alignItems: 'center',
  },

  nameBadgeActive: {
    backgroundColor: 'rgba(46, 125, 50, 0.9)', // Keep green background when active
    borderColor: COLORS.white, // Keep white border
  },

  nameText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
    textAlign: 'center',
  },

  badgePosition: {
    position: 'absolute',
    top: -6,
    right: -6,
    zIndex: 10,
  },
});

export default LandscapeOpponent;
