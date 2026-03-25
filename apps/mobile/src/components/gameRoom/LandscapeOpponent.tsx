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

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { COLORS, LAYOUT } from '../../constants';
import { useUserPreferencesStore } from '../../store/userPreferencesSlice';
import {
  getScoreBadgeColor,
  formatScore,
  scoreDisplayStyles,
} from '../../styles/scoreDisplayStyles';
import { CardCountBadge } from '../scoreboard/CardCountBadge';
import InactivityCountdownRing from '../game/InactivityCountdownRing';
import { i18n } from '../../i18n';

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
  /** Called when the player name badge is long-pressed (e.g. to add as friend) */
  onNameLongPress?: () => void;
  /** Whether this player's mic is on (undefined = mic state unknown / not applicable) */
  isMicOn?: boolean;
  /** Called when the mic toggle button is pressed (local player only) */
  onMicToggle?: () => void;
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
  onNameLongPress,
  isMicOn,
  onMicToggle,
}: LandscapeOpponentProps) {
  // Profile photo size preference (mirrors PlayerInfo scaling)
  const profilePhotoSize = useUserPreferencesStore(s => s.profilePhotoSize);
  const avatarScale = useMemo(() => {
    const scaleMap = { small: 0.85, medium: 1.0, large: 1.25 } as const;
    const scale = scaleMap[profilePhotoSize] ?? 1.0;
    const size = Math.round(LAYOUT.avatarSize * scale);
    return {
      size,
      borderRadius: Math.round(size / 2),
      innerRadius: Math.round((size - LAYOUT.avatarBorderWidth * 2) / 2),
      iconSize: Math.round(LAYOUT.avatarIconSize * scale),
    };
  }, [profilePhotoSize]);

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
          style={[
            styles.avatarContainer,
            {
              width: avatarScale.size,
              height: avatarScale.size,
              borderRadius: avatarScale.borderRadius,
            },
            isActive && !showRing && styles.avatarContainerActive,
          ]}
        >
          <View
            style={[
              styles.avatarInner,
              { borderRadius: avatarScale.innerRadius },
              isDisconnected && styles.avatarInnerDisconnected,
            ]}
          >
            {photoUrl ? (
              // TODO: Render actual profile photo when available
              <Text
                style={[
                  styles.avatarIcon,
                  { fontSize: avatarScale.iconSize },
                  isDisconnected && styles.avatarIconFaded,
                ]}
              >
                👤
              </Text>
            ) : (
              <Text
                style={[
                  styles.avatarIcon,
                  { fontSize: avatarScale.iconSize },
                  isDisconnected && styles.avatarIconFaded,
                ]}
              >
                👤
              </Text>
            )}
          </View>
          {/* Countdown ring (yellow = turn, charcoal grey = disconnect) */}
          {showRing && ringStartedAt && (
            <InactivityCountdownRing
              key={ringStartedAt}
              type={ringType}
              startedAt={ringStartedAt}
              onExpired={ringType === 'connection' ? onCountdownExpired : undefined}
              size={avatarScale.size}
            />
          )}
          {/* Disconnect spinner overlay */}
          {isDisconnected && (
            <View
              style={[styles.disconnectOverlay, { borderRadius: avatarScale.innerRadius }]}
              pointerEvents="none"
            >
              <ActivityIndicator size="small" color={COLORS.white} />
            </View>
          )}
          {/* Card count badge positioned on avatar */}
          <View style={styles.badgePosition}>
            <CardCountBadge cardCount={cardCount} visible={true} />
          </View>
          {/* Mic toggle/indicator — mid-right of avatar (landscape) */}
          {isMicOn !== undefined &&
            (onMicToggle ? (
              <Pressable
                style={styles.micToggleLandscape}
                onPress={onMicToggle}
                accessibilityRole="button"
                accessibilityLabel={
                  isMicOn ? i18n.t('chat.muteMicrophone') : i18n.t('chat.unmuteMicrophone')
                }
                hitSlop={6}
              >
                <Text style={styles.micToggleIcon}>{isMicOn ? '🎤' : '🔇'}</Text>
              </Pressable>
            ) : (
              <View
                style={styles.micToggleLandscape}
                accessible={true}
                accessibilityRole="text"
                accessibilityLabel={
                  isMicOn ? i18n.t('chat.microphoneOn') : i18n.t('chat.microphoneOff')
                }
                pointerEvents="none"
              >
                <Text style={styles.micToggleIcon}>{isMicOn ? '🎤' : '🔇'}</Text>
              </View>
            ))}
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
        onLongPress={onNameLongPress}
        disabled={!onNameLongPress}
        activeOpacity={onNameLongPress ? 0.7 : 1}
        accessibilityRole={onNameLongPress ? 'button' : undefined}
        accessibilityLabel={onNameLongPress ? `Long-press to add ${name} as a friend` : name}
        accessibilityHint={
          onNameLongPress ? 'Long-press to add this player as a friend.' : undefined
        }
        accessibilityState={!onNameLongPress ? { disabled: true } : undefined}
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
  micToggleLandscape: {
    position: 'absolute',
    right: -10,
    top: '50%',
    marginTop: -10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 12,
  },
  micToggleIcon: {
    fontSize: 11,
  },
});

export default LandscapeOpponent;
