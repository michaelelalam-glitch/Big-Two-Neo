/**
 * LiveKitVideoSlot — Renders a LiveKit VideoTrack for use as `videoStreamSlot`.
 *
 * Architecture:
 *   Pass the `LiveKitTrackRef` returned by `getVideoTrackRef()` from `useVideoChat`
 *   (or `GameContext`) as the `trackRef` prop. This component wraps the
 *   `<VideoTrack>` component from `@livekit/react-native` and renders it
 *   inside a full-fill `View` so it fills whatever container its parent sets.
 *
 * Expo Go / pre-prebuild guard:
 *   `@livekit/react-native` is loaded at module-evaluation time inside a
 *   try/catch (same pattern as `LiveKitVideoChatAdapter`). When the native
 *   module is not linked the component renders `null` silently — the parent
 *   `PlayerInfo` avatar will fall back to its emoji/stub placeholder.
 *
 * Usage:
 *   const trackRef = getVideoTrackRef(userId);
 *   const slot = trackRef
 *     ? <LiveKitVideoSlot trackRef={trackRef} mirror={isLocal} />
 *     : undefined;
 *   <PlayerInfo ... videoStreamSlot={slot} />
 *
 * Task #651 / #649 — Phase 5: Video Track Rendering
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { LiveKitTrackRef } from '../../hooks/useVideoChat';
import { gameLogger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Error Boundary — catches native render crashes from VideoTrack
// ---------------------------------------------------------------------------

class VideoSlotErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    gameLogger.warn('[LiveKitVideoSlot] Render error caught by boundary:', error.message);
  }

  render(): React.ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Lazy load @livekit/react-native — same guard pattern as LiveKitVideoChatAdapter
// ---------------------------------------------------------------------------

// Loaded once at module-evaluation time inside a try/catch so the module
// evaluates successfully even when native WebRTC is not linked (Expo Go /
// pre-prebuild dev client). React's renderer never sees the throw because
// the error is absorbed here at import time, not inside the render phase.
let _VideoTrack: React.ComponentType<{
  trackRef: unknown;
  style?: object;
  objectFit?: 'cover' | 'contain';
  mirror?: boolean;
  zOrder?: number;
}> | null = null;

try {
  _VideoTrack =
    (
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@livekit/react-native') as {
        VideoTrack?: React.ComponentType<{
          trackRef: unknown;
          style?: object;
          objectFit?: 'cover' | 'contain';
          mirror?: boolean;
          zOrder?: number;
        }>;
      }
    ).VideoTrack ?? null;
  // Module loaded successfully but VideoTrack was not exported — likely a
  // package version/API mismatch. Warn once in DEV so it is easy to diagnose.
  if (!_VideoTrack && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(
      '[LiveKitVideoSlot] @livekit/react-native loaded but did not export ' +
        'VideoTrack — video rendering disabled. Check the package version.'
    );
  }
} catch {
  // @livekit/react-native is not linked — Expo Go or pre-prebuild build.
  // _VideoTrack remains null; LiveKitVideoSlot renders null gracefully.
}

/**
 * True when `@livekit/react-native` is linked and `LiveKitVideoSlot` can
 * render a real video stream. Always `false` in Expo Go.
 */
export const isVideoTrackAvailable = !!_VideoTrack;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LiveKitVideoSlotProps {
  /**
   * TrackReference from `getVideoTrackRef()` — pass directly as `trackRef`
   * to the underlying `<VideoTrack>` component.
   */
  trackRef: LiveKitTrackRef;
  /**
   * Mirror the video horizontally — typically `true` for the local player's
   * front-facing camera so it matches the user's expected "mirror" UX.
   * Default: `false`.
   */
  mirror?: boolean;
  /**
   * How to resize the video to fill its container.
   * `'cover'` (default): fills the container, may crop edges.
   * `'contain'`: letter-boxes the video to show the full frame.
   */
  objectFit?: 'cover' | 'contain';
  /**
   * Z-order hint for the native OpenGL/Metal video layer.
   * Use `0` for remote video (background) and `1` for local video (foreground).
   * Default: `0`.
   */
  zOrder?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders a full-fill LiveKit VideoTrack inside an absolute-fill View.
 *
 * Returns `null` silently when `@livekit/react-native` is not linked
 * (Expo Go / pre-prebuild dev client). The parent `PlayerInfo` avatar will
 * show its placeholder emoji fallback in that case.
 *
 * @public
 */
export function LiveKitVideoSlot({
  trackRef,
  mirror = false,
  objectFit = 'cover',
  zOrder = 0,
}: LiveKitVideoSlotProps): React.ReactElement | null {
  if (!_VideoTrack || !trackRef) return null;

  const VideoTrackComponent = _VideoTrack;

  return (
    <VideoSlotErrorBoundary>
      <View style={styles.container}>
        <VideoTrackComponent
          trackRef={trackRef}
          style={StyleSheet.absoluteFill}
          objectFit={objectFit}
          mirror={mirror}
          zOrder={zOrder}
        />
      </View>
    </VideoSlotErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    // Clip rounded corners on video — the parent avatar View sets the border
    // radius so the video never bleeds outside the circular frame.
    overflow: 'hidden',
  },
});
