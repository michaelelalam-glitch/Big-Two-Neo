import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { COLORS, SPACING, LAYOUT, POSITIONING, SHADOWS } from '../../constants';
import type { AutoPassTimerState } from '../../types/multiplayer';
import type { Card } from '../../game/types';
import type { DragZoneState } from './CardHand';
// Direct imports avoid the index.ts ↔ GameLayout.tsx require cycle
import PlayerInfo from './PlayerInfo';
import CenterPlayArea from './CenterPlayArea';
import AutoPassTimer from './AutoPassTimer';

interface GameLayoutProps {
  /** Array of 4 players in display order [user, top, left, right] */
  players: {
    name: string;
    cardCount: number;
    isActive: boolean;
    totalScore?: number;
    /** fix/rejoin: show disconnect spinner */
    isDisconnected?: boolean;
    /** UTC timestamp when 60s bot-replacement countdown started */
    disconnectTimerStartedAt?: string | null;
    /** UTC timestamp when 60s turn countdown started */
    turnTimerStartedAt?: string | null;
    /** Called when this player's countdown ring expires */
    onCountdownExpired?: () => void;
    // ── Task #651: in-game video chat (Phase 5) ─────────────────────────────
    /** Whether this player's camera is actively streaming (undefined = video chat inactive) */
    isCameraOn?: boolean;
    /** Whether this player's microphone is actively streaming */
    isMicOn?: boolean;
    /** Whether the video connection to this player is being established */
    isVideoChatConnecting?: boolean;
    /** Injected video stream element (<LiveKitVideoSlot />) — renders in the avatar */
    videoStreamSlot?: React.ReactNode;
  }[];
  /** Last played cards to display in center area */
  lastPlayedCards: Card[];
  /** Name of player who made last play */
  lastPlayedBy: string | null;
  /** Type of last combo played */
  lastPlayComboType: string | null;
  /** Display text for last combo */
  lastPlayCombo: string | null;
  /** Auto-pass timer state (if active) */
  autoPassTimerState?: AutoPassTimerState;
  /** Task #652: drag zone state for table perimeter glow */
  dropZoneState?: DragZoneState;
}

/**
 * GameLayout Component
 * Handles the table layout with 4 players positioned around a central play area
 * Extracted from GameScreen.tsx to reduce complexity (Task #426)
 *
 * Layout structure:
 * - Top player (position 1) above table
 * - Left player (position 2) on left side
 * - Center play area with last played cards
 * - Right player (position 3) on right side
 * - Bottom player (position 0) rendered by parent
 */
// Task #628: React.memo prevents re-renders from GameView context updates when
// player/table props for THIS layout haven't changed.
function GameLayoutComponent({
  players,
  lastPlayedCards,
  lastPlayedBy,
  lastPlayComboType,
  lastPlayCombo,
  autoPassTimerState,
  dropZoneState = 'idle',
}: GameLayoutProps) {
  // Task #652: Animated glow for table perimeter when dragging cards
  const glowAnim = useRef(new Animated.Value(0)).current;
  const glowPulse = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    // Stop any running animation
    if (glowPulse.current) {
      glowPulse.current.stop();
      glowPulse.current = null;
    }

    if (dropZoneState === 'active') {
      // Pulsing glow when cards are in drop zone
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 400, useNativeDriver: false }),
          Animated.timing(glowAnim, { toValue: 0.5, duration: 400, useNativeDriver: false }),
        ])
      );
      glowPulse.current = pulse;
      pulse.start();
    } else if (dropZoneState === 'approaching') {
      // Fade in glow as cards approach
      Animated.timing(glowAnim, { toValue: 0.4, duration: 200, useNativeDriver: false }).start();
    } else {
      // Fade out
      Animated.timing(glowAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
    }
  }, [dropZoneState, glowAnim]);
  // Cleanup on unmount: stop any running pulse animation to avoid native animation leaks
  useEffect(() => {
    return () => {
      if (glowPulse.current) {
        try {
          glowPulse.current.stop();
        } catch (e) {
          // best-effort
        }
        glowPulse.current = null;
      }
    };
  }, []);

  // Interpolate glow color and shadow
  const glowBorderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [COLORS.table.border, COLORS.accent],
  });
  const glowShadowRadius = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SHADOWS.table.radius, 24],
  });
  const glowShadowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SHADOWS.table.opacity, 0.8],
  });

  // Drop zone text for CenterPlayArea
  const dropZoneText =
    dropZoneState === 'active'
      ? 'Release to play'
      : dropZoneState === 'approaching'
        ? 'Drop to play'
        : undefined;

  return (
    <>
      {/* Top player (position 1) - OUTSIDE table, above it */}
      <View style={styles.topPlayerAboveTable}>
        <PlayerInfo
          name={players[1].name}
          cardCount={players[1].cardCount}
          isActive={players[1].isActive}
          totalScore={players[1].totalScore}
          isDisconnected={players[1].isDisconnected}
          disconnectTimerStartedAt={players[1].disconnectTimerStartedAt}
          turnTimerStartedAt={players[1].turnTimerStartedAt}
          onCountdownExpired={players[1].onCountdownExpired}
          isCameraOn={players[1].isCameraOn}
          isMicOn={players[1].isMicOn}
          isVideoChatConnecting={players[1].isVideoChatConnecting}
          videoStreamSlot={players[1].videoStreamSlot}
        />
      </View>

      {/* Game table area — Task #652: animated border glow on drag */}
      <Animated.View
        style={[
          styles.tableArea,
          {
            borderColor: glowBorderColor,
            shadowColor: dropZoneState !== 'idle' ? COLORS.accent : COLORS.black,
            shadowRadius: glowShadowRadius,
            shadowOpacity: glowShadowOpacity,
          },
        ]}
      >
        {/* Middle row: Left player, Center play area, Right player */}
        <View style={styles.middleRow}>
          {/* Left player (position 2) */}
          <View style={styles.leftPlayerContainer}>
            <PlayerInfo
              name={players[2].name}
              cardCount={players[2].cardCount}
              isActive={players[2].isActive}
              totalScore={players[2].totalScore}
              isDisconnected={players[2].isDisconnected}
              disconnectTimerStartedAt={players[2].disconnectTimerStartedAt}
              turnTimerStartedAt={players[2].turnTimerStartedAt}
              onCountdownExpired={players[2].onCountdownExpired}
              isCameraOn={players[2].isCameraOn}
              isMicOn={players[2].isMicOn}
              isVideoChatConnecting={players[2].isVideoChatConnecting}
              videoStreamSlot={players[2].videoStreamSlot}
            />
          </View>

          {/* Center play area (last played cards) */}
          <View style={styles.centerPlayArea}>
            <CenterPlayArea
              lastPlayed={lastPlayedCards}
              lastPlayedBy={lastPlayedBy || null}
              combinationType={lastPlayComboType}
              comboDisplayText={lastPlayCombo || undefined}
              dropZoneText={dropZoneText}
            />

            {/* Auto-Pass Timer Display */}
            {autoPassTimerState && (
              <AutoPassTimer
                timerState={autoPassTimerState}
                currentPlayerIndex={0} // Player is always at index 0 in local game
              />
            )}
          </View>

          {/* Right player (position 3) */}
          <View style={styles.rightPlayerContainer}>
            <PlayerInfo
              name={players[3].name}
              cardCount={players[3].cardCount}
              isActive={players[3].isActive}
              totalScore={players[3].totalScore}
              isDisconnected={players[3].isDisconnected}
              disconnectTimerStartedAt={players[3].disconnectTimerStartedAt}
              turnTimerStartedAt={players[3].turnTimerStartedAt}
              onCountdownExpired={players[3].onCountdownExpired}
              isCameraOn={players[3].isCameraOn}
              isMicOn={players[3].isMicOn}
              isVideoChatConnecting={players[3].isVideoChatConnecting}
              videoStreamSlot={players[3].videoStreamSlot}
            />
          </View>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  topPlayerAboveTable: {
    alignItems: 'center',
    paddingTop: LAYOUT.topPlayerSpacing,
    // Task #590: Removed leftPlayerOffset since compact scoreboard no longer occupies top-left
    marginBottom: LAYOUT.topPlayerOverlap,
    zIndex: 50,
  },
  tableArea: {
    width: LAYOUT.tableWidth,
    height: LAYOUT.tableHeight,
    backgroundColor: COLORS.table.background,
    alignSelf: 'center',
    borderRadius: LAYOUT.tableBorderRadius,
    borderWidth: LAYOUT.tableBorderWidth,
    borderColor: COLORS.table.border,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
    shadowColor: COLORS.black,
    shadowOffset: SHADOWS.table.offset,
    shadowOpacity: SHADOWS.table.opacity,
    shadowRadius: SHADOWS.table.radius,
    elevation: SHADOWS.table.elevation,
  },
  middleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  leftPlayerContainer: {
    alignItems: 'center',
    position: 'absolute',
    left: LAYOUT.playerOverlapOffset,
    top: POSITIONING.sidePlayerTop,
  },
  centerPlayArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  rightPlayerContainer: {
    alignItems: 'center',
    position: 'absolute',
    right: LAYOUT.playerOverlapOffset,
    top: POSITIONING.sidePlayerTop,
  },
});

export const GameLayout = React.memo(GameLayoutComponent);
