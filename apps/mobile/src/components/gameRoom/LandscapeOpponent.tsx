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
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { COLORS, LAYOUT } from '../../constants';
import {
  getScoreBadgeColor,
  formatScore,
  scoreDisplayStyles,
} from '../../styles/scoreDisplayStyles';
import { CardCountBadge } from '../scoreboard/CardCountBadge';
import InactivityCountdownRing from '../game/InactivityCountdownRing';

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
  /** fix/rejoin: show spinner when player is disconnected */
  isDisconnected?: boolean;
  /** UTC timestamp when 60s bot-replacement countdown started (null = no countdown) */
  disconnectTimerStartedAt?: string | null;
  /** UTC timestamp when 60s turn countdown started (null = no countdown) */
  turnTimerStartedAt?: string | null;
  /** Called when countdown ring expires */
  onCountdownExpired?: () => void;
  /** Called when the avatar is tapped (e.g. to add as friend) */
  onAvatarPress?: () => void;
  /** Called when the player name badge is double-tapped */
  onNameDoubleTap?: () => void;
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
  isDisconnected = false,
  disconnectTimerStartedAt,
  turnTimerStartedAt,
  onCountdownExpired,
  onAvatarPress,
  onNameDoubleTap,
}: LandscapeOpponentProps) {
  const hasConnectionTimer = !!disconnectTimerStartedAt;
  const hasTurnTimer = !!turnTimerStartedAt;
  const showRing = hasConnectionTimer || hasTurnTimer;
  // Connection ring (charcoal grey) ALWAYS takes priority over turn ring (yellow)
  const ringType: 'turn' | 'connection' = hasConnectionTimer ? 'connection' : 'turn';
  const ringStartedAt: string | undefined = (() => {
    if (!showRing) {
      return undefined;
    }
    // Anchor connection ring strictly to disconnectTimerStartedAt so its
    // countdown matches the server-side bot-replacement timer exactly.
    if (ringType === 'connection') {
      return disconnectTimerStartedAt!;
    }
    return turnTimerStartedAt!;
  })();

  return (
    <View
      style={[styles.container, layout === 'horizontal' && styles.containerHorizontal]}
      testID="landscape-opponent"
    >
      {/* Avatar Circle */}
      <TouchableOpacity
        onPress={onAvatarPress}
        disabled={!onAvatarPress}
        activeOpacity={onAvatarPress ? 0.7 : 1}
        accessibilityRole={onAvatarPress ? 'button' : undefined}
        accessibilityLabel={onAvatarPress ? `Show options for ${name}` : undefined}
        accessibilityHint={onAvatarPress ? 'Opens actions and details for this player.' : undefined}
        accessibilityState={!onAvatarPress ? { disabled: true } : undefined}
      >
        <View
          style={[styles.avatarContainer, isActive && !showRing && styles.avatarContainerActive]}
        >
          <View style={[styles.avatarInner, isDisconnected && styles.avatarInnerDisconnected]}>
            {photoUrl ? (
              // TODO: Render actual profile photo when available
              <Text style={[styles.avatarIcon, isDisconnected && styles.avatarIconFaded]}>👤</Text>
            ) : (
              <Text style={[styles.avatarIcon, isDisconnected && styles.avatarIconFaded]}>👤</Text>
            )}
          </View>
          {/* Countdown ring (yellow = turn, charcoal grey = disconnect) */}
          {showRing && ringStartedAt && (
            <InactivityCountdownRing
              key={ringStartedAt}
              type={ringType}
              startedAt={ringStartedAt}
              onExpired={ringType === 'connection' ? onCountdownExpired : undefined}
            />
          )}
          {/* Disconnect spinner overlay */}
          {isDisconnected && (
            <View style={styles.disconnectOverlay} pointerEvents="none">
              <ActivityIndicator size="small" color={COLORS.white} />
            </View>
          )}
          {/* Card count badge positioned on avatar */}
          <View style={styles.badgePosition}>
            <CardCountBadge cardCount={cardCount} visible={true} />
          </View>
          {/* Total score badge positioned on avatar (bottom-left) - Task #590 */}
          {totalScore !== undefined && (
            <View
              style={scoreDisplayStyles.scoreBadgePosition}
              accessible={true}
              accessibilityRole="text"
              accessibilityLabel={`Score: ${formatScore(totalScore)}`}
            >
              <View
                style={[
                  scoreDisplayStyles.scoreBadge,
                  { backgroundColor: getScoreBadgeColor(totalScore) },
                ]}
              >
                <Text style={scoreDisplayStyles.scoreBadgeText}>{formatScore(totalScore)}</Text>
              </View>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Player Name Badge — long-press to open friend actions */}
      <TouchableOpacity
        onLongPress={onNameDoubleTap}
        disabled={!onNameDoubleTap}
        activeOpacity={onNameDoubleTap ? 0.7 : 1}
        accessibilityRole={onNameDoubleTap ? 'button' : undefined}
        accessibilityLabel={onNameDoubleTap ? `Long-press to add ${name} as a friend` : name}
        accessibilityHint={
          onNameDoubleTap ? 'Long-press to add this player as a friend.' : undefined
        }
        accessibilityState={!onNameDoubleTap ? { disabled: true } : undefined}
      >
        <View
          style={[
            styles.nameBadge,
            isActive && styles.nameBadgeActive,
            isDisconnected && styles.nameBadgeDisconnected,
          ]}
        >
          <Text style={styles.nameText} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </TouchableOpacity>
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

  // Disconnect styles (fix/rejoin)
  avatarInnerDisconnected: {
    opacity: 0.5,
  },
  avatarIconFaded: {
    opacity: 0.6,
  },
  disconnectOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: LAYOUT.avatarInnerRadius,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  nameBadgeDisconnected: {
    opacity: 0.6,
  },
});

export default LandscapeOpponent;
