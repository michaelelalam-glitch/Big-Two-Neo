import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, BADGE, SHADOWS } from '../../constants';
import { getScoreBadgeColor, formatScore, scoreDisplayStyles } from '../../styles/scoreDisplayStyles';
import { CardCountBadge } from '../scoreboard/CardCountBadge';
import InactivityCountdownRing from './InactivityCountdownRing';
import { VideoTile } from './VideoTile';

interface PlayerInfoProps {
  name: string;
  cardCount: number;
  isActive: boolean; // Current turn indicator
  totalScore?: number; // Cumulative total score (Task #590)
  /** fix/rejoin: show spinner when player is disconnected */
  isDisconnected?: boolean;
  /** UTC timestamp when the 60s bot-replacement countdown started (null = no countdown) */
  disconnectTimerStartedAt?: string | null;
  /** UTC timestamp when the 60s turn countdown started (null = no countdown) */
  turnTimerStartedAt?: string | null;
  /** Called when the countdown ring expires (timer reaches 0) */
  onCountdownExpired?: () => void;
  // ── Task #651: in-game video chat ──────────────────────────────────────────
  /** Whether this player's camera is actively streaming (undefined = video chat inactive) */
  isCameraOn?: boolean;
  /** Whether this is the local player's tile (adds tap-to-toggle) */
  isLocalPlayer?: boolean;
  /** Whether the video connection is being established */
  isVideoChatConnecting?: boolean;
  /** Called when the video tile is pressed (local player opt-in/out) */
  /** Called when the local player presses their video tile to toggle camera */
  onVideoChatToggle?: () => void;
  /** Injected video stream element (RTCView/VideoView from the real SDK) */
  videoStreamSlot?: React.ReactNode;
}

export default function PlayerInfo({
  name,
  cardCount,
  isActive,
  totalScore,
  isDisconnected = false,
  disconnectTimerStartedAt,
  turnTimerStartedAt,
  onCountdownExpired,
  isCameraOn,
  isLocalPlayer = false,
  isVideoChatConnecting = false,
  onVideoChatToggle,
  videoStreamSlot,
}: PlayerInfoProps) {
  const showVideoTile = isCameraOn !== undefined;
  const hasConnectionTimer = !!disconnectTimerStartedAt;
  const hasTurnTimer = !!turnTimerStartedAt;
  const showRing = hasConnectionTimer || hasTurnTimer;
  // Connection ring (charcoal grey) ALWAYS takes priority over turn ring (yellow).
  const ringType: 'turn' | 'connection' = hasConnectionTimer ? 'connection' : 'turn';
  // Always anchor the connection ring to disconnectTimerStartedAt so its
  // countdown matches the server-side bot-replacement timer exactly
  // (disconnect_timer_started_at + 60s). The turn ring uses turnTimerStartedAt.
  const ringStartedAt: string = (() => {
    if (ringType === 'connection') {
      return disconnectTimerStartedAt!;
    }
    return turnTimerStartedAt!;
  })();
  
  const videoChatLabel = showVideoTile
    ? isCameraOn ? `, camera on` : `, camera off`
    : '';
  const accessibilityLabel = `${name}, ${cardCount} card${cardCount !== 1 ? 's' : ''}${isActive ? ', current turn' : ''}${isDisconnected ? ', disconnected' : ''}${showRing ? `, ${ringType} countdown active` : ''}${videoChatLabel}`;
  
  return (
    <View 
      style={styles.container}
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
    >
      {/* Avatar with turn indicator */}
      <View style={[styles.avatarContainer, isActive && !showRing && styles.activeAvatar]}>
        <View style={[styles.avatar, isDisconnected && styles.avatarDisconnected]}>
          {/* Default avatar icon - matches landscape opponent emoji */}
          <Text style={[styles.avatarIcon, isDisconnected && styles.avatarIconFaded]}>👤</Text>
        </View>
        {/* Dual-mode countdown ring (yellow = turn, charcoal grey = disconnect) */}
        {showRing && (
          <InactivityCountdownRing 
            key={ringStartedAt} // Remount only when start time changes; color/type changes without remount for seamless yellow→charcoal-grey transition
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
            <View style={[scoreDisplayStyles.scoreBadge, { backgroundColor: getScoreBadgeColor(totalScore) }]}>
              <Text style={scoreDisplayStyles.scoreBadgeText}>
                {formatScore(totalScore)}
              </Text>
            </View>
          </View>
        )}
        {/* In-game video tile (Task #651) — absolute overlay, top-left of avatar */}
        {showVideoTile && (
          <View style={styles.videoTilePosition}>
            <VideoTile
              isCameraOn={!!isCameraOn}
              isConnecting={isVideoChatConnecting}
              isLocal={isLocalPlayer}
              onCameraToggle={onVideoChatToggle}
              videoStreamSlot={videoStreamSlot}
              testID={`video-tile-${name}`}
            />
          </View>
        )}
      </View>

      {/* Player name badge */}
      <View style={[styles.nameBadge, isDisconnected && styles.nameBadgeDisconnected]}>
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
  // Task #651: video tile is anchored top-left of the avatar so it doesn't clash
  // with the card-count badge (top-right) or score badge (bottom-left).
  videoTilePosition: {
    position: 'absolute',
    top: -6,
    left: -6,
    zIndex: 12,
  },
  // Disconnect overlay styles (fix/rejoin)
  avatarDisconnected: {
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
