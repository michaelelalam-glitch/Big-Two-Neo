import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, BADGE, SHADOWS } from '../../constants';
import { i18n } from '../../i18n';
import {
  getScoreBadgeColor,
  formatScore,
  scoreDisplayStyles,
} from '../../styles/scoreDisplayStyles';
import { CardCountBadge } from '../scoreboard/CardCountBadge';
import { useUserPreferencesStore } from '../../store/userPreferencesSlice';
import InactivityCountdownRing from './InactivityCountdownRing';

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
  /** Whether this player's microphone is actively streaming audio */
  isMicOn?: boolean;
  /** Whether this is the local player's tile (adds tap-to-toggle) */
  isLocalPlayer?: boolean;
  /** Whether the video connection is being established */
  isVideoChatConnecting?: boolean;
  /** Called when the local player presses their video tile to toggle camera */
  onVideoChatToggle?: () => void;
  /** Injected video stream element (RTCView/VideoView from the real SDK) */
  videoStreamSlot?: React.ReactNode;
  /** Called when the player name badge is long-pressed (e.g. to add as friend) */
  onNameLongPress?: () => void;
  /** Called when the local player presses the mic toggle button on the avatar */
  onMicToggle?: () => void;
}

// ---------------------------------------------------------------------------
// Avatar video content helper
// ---------------------------------------------------------------------------

/**
 * Renders the inner content of the avatar when video chat state is known.
 * - Camera ON + videoStreamSlot: live video feed fills the avatar
 * - Camera ON + no slot: stub LIVE placeholder (SDK not yet wired)
 * - Camera OFF: profile photo
 */
function renderAvatarVideoContent({
  isCameraOn,
  isMicOn,
  isLocalPlayer,
  isDisconnected,
  isVideoChatConnecting,
  videoStreamSlot,
  innerRadius,
  iconSize,
}: {
  isCameraOn: boolean;
  isMicOn?: boolean;
  isLocalPlayer: boolean;
  isDisconnected: boolean;
  isVideoChatConnecting: boolean;
  videoStreamSlot?: React.ReactNode;
  innerRadius: number;
  iconSize: number;
}): React.ReactNode {
  if (isVideoChatConnecting) {
    return <ActivityIndicator size="small" color={COLORS.white} />;
  }

  if (isCameraOn) {
    return videoStreamSlot ? (
      // Real SDK video stream fills the full avatar circle
      <View style={[avatarStyles.videoFill, { borderRadius: innerRadius }]}>{videoStreamSlot}</View>
    ) : (
      // Stub placeholder until LiveKit SDK is installed
      <View style={[avatarStyles.videoPlaceholder, { borderRadius: innerRadius }]}>
        <Text style={[avatarStyles.videoPlaceholderIcon, { fontSize: iconSize }]}>📷</Text>
        {isLocalPlayer && (
          <View style={avatarStyles.liveBadge}>
            <Text style={avatarStyles.liveBadgeText}>LIVE</Text>
          </View>
        )}
        {isMicOn !== undefined && (
          <View style={avatarStyles.micIndicator}>
            <Text style={avatarStyles.micIndicatorIcon}>{isMicOn ? '🎤' : '🔇'}</Text>
          </View>
        )}
      </View>
    );
  }

  // Camera off — show profile photo
  return (
    <>
      <Text
        style={[
          avatarStyles.avatarProfileIcon,
          { fontSize: iconSize },
          isDisconnected && avatarStyles.avatarIconFaded,
        ]}
      >
        👤
      </Text>
      {isMicOn !== undefined && (
        <View style={avatarStyles.micIndicator}>
          <Text style={avatarStyles.micIndicatorIcon}>{isMicOn ? '🎤' : '🔇'}</Text>
        </View>
      )}
    </>
  );
}

// Task #628: React.memo — bail out when all props are reference-equal.
function PlayerInfoComponent({
  name,
  cardCount,
  isActive,
  totalScore,
  isDisconnected = false,
  disconnectTimerStartedAt,
  turnTimerStartedAt,
  onCountdownExpired,
  isCameraOn,
  isMicOn,
  isLocalPlayer = false,
  isVideoChatConnecting = false,
  onVideoChatToggle,
  videoStreamSlot,
  onNameLongPress,
  onMicToggle,
}: PlayerInfoProps) {
  // Profile photo size preference
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

  // Show the video tile when:
  //  a) isCameraOn is explicitly provided (remote player camera state known), OR
  //  b) This is the local player and the opt-in handler is wired (tile is the
  //     entry point — even before camera is on the tile must be reachable). (r2935394764)
  const showVideoTile = isCameraOn !== undefined || (isLocalPlayer && !!onVideoChatToggle);
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

  const videoChatLabel =
    isCameraOn !== undefined ? (isCameraOn ? `, camera on` : `, camera off`) : '';
  const accessibilityLabel = `${name}, ${cardCount} card${cardCount !== 1 ? 's' : ''}${isActive ? ', current turn' : ''}${isDisconnected ? ', disconnected' : ''}${showRing ? `, ${ringType} countdown active` : ''}${videoChatLabel}`;

  return (
    <View
      style={styles.container}
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
    >
      {/* Avatar with turn indicator */}
      <View
        style={[
          styles.avatarContainer,
          {
            width: avatarScale.size,
            height: avatarScale.size,
            borderRadius: avatarScale.borderRadius,
          },
          isActive && !showRing && styles.activeAvatar,
        ]}
      >
        {/* Avatar body — video feed replaces profile photo when camera is on */}
        {showVideoTile ? (
          // Video-aware avatar: tap to toggle camera (local player only)
          isLocalPlayer ? (
            <Pressable
              style={[
                styles.avatar,
                { borderRadius: avatarScale.innerRadius },
                isDisconnected && styles.avatarDisconnected,
              ]}
              onPress={onVideoChatToggle}
              disabled={!onVideoChatToggle || isVideoChatConnecting}
              accessibilityRole="button"
              accessibilityLabel={
                isVideoChatConnecting
                  ? i18n.t('chat.connectingVideo')
                  : isCameraOn
                    ? `${i18n.t('chat.camera')}, ${i18n.t('common.on')} — ${i18n.t('chat.leaveVideo')}`
                    : `${i18n.t('chat.camera')}, ${i18n.t('common.off')} — ${i18n.t('chat.joinVideo')}`
              }
              accessibilityState={{
                disabled: !onVideoChatToggle || isVideoChatConnecting,
                busy: isVideoChatConnecting,
              }}
            >
              {renderAvatarVideoContent({
                isCameraOn: !!isCameraOn,
                // Hide inner mic indicator when outer toggle overlay is shown
                isMicOn: isLocalPlayer && onMicToggle ? undefined : isMicOn,
                isLocalPlayer,
                isDisconnected,
                isVideoChatConnecting,
                videoStreamSlot,
                innerRadius: avatarScale.innerRadius,
                iconSize: avatarScale.iconSize,
              })}
            </Pressable>
          ) : (
            <View
              style={[
                styles.avatar,
                { borderRadius: avatarScale.innerRadius },
                isDisconnected && styles.avatarDisconnected,
              ]}
            >
              {renderAvatarVideoContent({
                isCameraOn: !!isCameraOn,
                isMicOn,
                isLocalPlayer,
                isDisconnected,
                isVideoChatConnecting: false,
                videoStreamSlot,
                innerRadius: avatarScale.innerRadius,
                iconSize: avatarScale.iconSize,
              })}
            </View>
          )
        ) : (
          // Standard avatar — no video chat
          <View
            style={[
              styles.avatar,
              { borderRadius: avatarScale.innerRadius },
              isDisconnected && styles.avatarDisconnected,
            ]}
          >
            <Text
              style={[
                styles.avatarIcon,
                { fontSize: avatarScale.iconSize },
                isDisconnected && styles.avatarIconFaded,
              ]}
            >
              👤
            </Text>
          </View>
        )}
        {/* Dual-mode countdown ring (yellow = turn, charcoal grey = disconnect) */}
        {showRing && (
          <InactivityCountdownRing
            key={ringStartedAt} // Remount only when start time changes; color/type changes without remount for seamless yellow→charcoal-grey transition
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
        {/* Mic toggle/indicator — top-left of avatar (portrait) */}
        {isMicOn !== undefined &&
          (isLocalPlayer && onMicToggle ? (
            <Pressable
              style={styles.micTogglePortrait}
              onPress={onMicToggle}
              accessibilityRole="button"
              accessibilityLabel={
                isMicOn ? i18n.t('chat.muteMicrophone') : i18n.t('chat.unmuteMicrophone')
              }
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.micToggleIcon}>{isMicOn ? '🎤' : '🔇'}</Text>
            </Pressable>
          ) : (
            <View
              style={styles.micTogglePortrait}
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

      {/* Player name badge */}
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
        <View style={[styles.nameBadge, isDisconnected && styles.nameBadgeDisconnected]}>
          <Text style={styles.nameText} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </TouchableOpacity>
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
    // borderRadius set dynamically via inline style (avatarScale.innerRadius)
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
    // borderRadius set dynamically via inline style (avatarScale.innerRadius)
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  nameBadgeDisconnected: {
    opacity: 0.6,
  },
  micTogglePortrait: {
    position: 'absolute',
    top: -4,
    left: -4,
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

// ---------------------------------------------------------------------------
// Styles shared by renderAvatarVideoContent (defined at module level to avoid
// recreation on every render — React Native StyleSheet.create is idempotent).
// ---------------------------------------------------------------------------
const avatarStyles = StyleSheet.create({
  videoFill: {
    width: '100%',
    height: '100%',
    // borderRadius set dynamically via inline style (avatarScale.innerRadius)
    overflow: 'hidden',
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    // borderRadius set dynamically via inline style (avatarScale.innerRadius)
    backgroundColor: '#1a3a5c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlaceholderIcon: {
    // fontSize set dynamically via inline style (avatarScale.iconSize)
    textAlign: 'center',
  },
  liveBadge: {
    position: 'absolute',
    bottom: 2,
    alignSelf: 'center',
    backgroundColor: '#dc2626',
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  liveBadgeText: {
    color: COLORS.white,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  micIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
  },
  micIndicatorIcon: {
    fontSize: 10,
  },
  // Profile photo (camera off) styles — fontSize set dynamically via iconSize
  avatarProfileIcon: {
    textAlign: 'center',
  },
  avatarIconFaded: {
    opacity: 0.6,
  },
});

export default React.memo(PlayerInfoComponent);
