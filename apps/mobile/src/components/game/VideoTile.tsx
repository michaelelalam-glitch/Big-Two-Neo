/**
 * VideoTile — Floating opt-in video tile for in-game video chat (Task #651).
 *
 * Displays a small picture-in-picture style tile near each player's avatar.
 *
 * When isCameraOn=true and a `videoStreamSlot` is provided (real SDK wired in),
 * the live video feed is rendered inside the tile. Until the LiveKit or Daily.co
 * SDK is installed, the tile shows a placeholder camera icon with connection state.
 *
 * Integration steps for real SDK (LiveKit / Daily.co):
 *   1. Install: pnpm add @livekit/react-native react-native-webrtc
 *   2. Add LiveKit plugin to app.json plugins array
 *   3. Pass <VideoView trackRef={trackRef} /> as `videoStreamSlot`
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ViewStyle, StyleProp } from 'react-native';
import { COLORS } from '../../constants';

export const VIDEO_TILE_SIZE = 64;

export interface VideoTileProps {
  /** Whether this player's camera is actively streaming */
  isCameraOn: boolean;
  /** Whether the SDK connection is being established */
  isConnecting?: boolean;
  /** True for the local player's tile — adds tap-to-toggle behaviour */
  isLocal?: boolean;
  /** Called when the local player toggles their camera on/off by tapping the tile */
  onCameraToggle?: () => void;
  /**
   * Injected video stream element from the real SDK.
   * Pass <VideoView trackRef={trackRef} /> (LiveKit) or <VideoComponent /> (Daily).
   * When omitted, a placeholder camera icon is rendered.
   */
  videoStreamSlot?: React.ReactNode;
  testID?: string;
}

/**
 * VideoTile — 64 × 64 picture-in-picture video tile.
 *
 * The tile is positioned as an absolute overlay by its parent (PlayerInfo).
 * Local player tiles are pressable and toggle camera on/off.
 * Remote tiles are read-only and reflect the other player's camera state.
 */
export function VideoTile({
  isCameraOn,
  isConnecting = false,
  isLocal = false,
  onCameraToggle,
  videoStreamSlot,
  testID,
}: VideoTileProps) {
  const cameraActiveLabel = isLocal
    ? isCameraOn
      ? 'Your camera is on. Tap to turn off.'
      : 'Your camera is off. Tap to turn on.'
    : isCameraOn
      ? "Opponent's camera is on."
      : "Opponent's camera is off.";

  const tileStyle: StyleProp<ViewStyle> = [styles.tile, !isCameraOn && styles.tileOff];

  const content = (
    <>
      {isConnecting ? (
        /* Connecting spinner */
        <ActivityIndicator
          size="small"
          color={COLORS.white}
          testID={`${testID ?? 'video-tile'}-connecting`}
        />
      ) : videoStreamSlot ? (
        /* Real SDK video stream — rendered when LiveKit/Daily adapter is wired */
        videoStreamSlot
      ) : (
        /* Placeholder UI until SDK is installed */
        <View style={styles.iconContainer}>
          <Text
            style={[styles.cameraIcon, !isCameraOn && styles.cameraIconOff]}
            accessible={false}
          >
            {isCameraOn ? '📷' : '📵'}
          </Text>
          {isLocal && (
            <Text style={[styles.localLabel, !isCameraOn && styles.localLabelOff]}>
              {isCameraOn ? 'LIVE' : 'OFF'}
            </Text>
          )}
        </View>
      )}

      {/* Dim overlay when camera is off (does not block presses) */}
      {!isCameraOn && !isConnecting && (
        <View style={styles.offOverlay} pointerEvents="none" />
      )}
    </>
  );

  // Local player: use Pressable so tapping toggles camera.
  // Remote player: use View — the tile is read-only and onPress must never fire.
  if (isLocal) {
    return (
      <Pressable
        testID={testID}
        onPress={onCameraToggle}
        accessible
        accessibilityRole="button"
        accessibilityLabel={cameraActiveLabel}
        style={tileStyle}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={cameraActiveLabel}
      style={tileStyle}
    >
      {content}
    </View>
  );
}

const BORDER_RADIUS = 8;

const styles = StyleSheet.create({
  tile: {
    width: VIDEO_TILE_SIZE,
    height: VIDEO_TILE_SIZE,
    borderRadius: BORDER_RADIUS,
    backgroundColor: COLORS.background.dark,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: COLORS.success, // Green border when camera is active
  },
  tileOff: {
    borderColor: COLORS.gray.medium,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraIcon: {
    fontSize: 22,
  },
  cameraIconOff: {
    opacity: 0.4,
  },
  localLabel: {
    color: COLORS.success,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
    letterSpacing: 0.5,
  },
  localLabelOff: {
    color: COLORS.gray.medium,
  },
  offOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 10, 0.50)',
    borderRadius: BORDER_RADIUS,
  },
});
