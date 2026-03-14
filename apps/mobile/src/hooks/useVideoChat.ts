/**
 * useVideoChat — Manages opt-in in-game video chat state (Task #651).
 *
 * Architecture: provides a stable interface against which any video-chat SDK
 * (LiveKit, Daily.co, etc.) can be plugged in via the `VideoChatAdapter` interface.
 * The default adapter is a `StubVideoChatAdapter` (no-op); the real LiveKit adapter
 * should be wired in once `@livekit/react-native` + `react-native-webrtc` are
 * installed as native dependencies.
 *
 * Prerequisites:
 * - F2 (voice chat) and this feature should share the same LiveKit room session —
 *   pass the same `adapter` instance to both hooks once the SDK is installed.
 * - Camera permission must be declared in app.json (done in this PR) before
 *   requesting it at runtime.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { gameLogger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CameraPermissionStatus = 'undetermined' | 'granted' | 'denied' | 'restricted';

export interface VideoChatParticipant {
  /** Matches room_players.user_id so the caller can pair with MultiplayerPlayer */
  participantId: string;
  isCameraOn: boolean;
  isConnecting: boolean;
}

/**
 * SDK-agnostic adapter interface.
 * Swap in the LiveKit or Daily.co adapter by implementing this contract.
 */
export interface VideoChatAdapter {
  connect(roomId: string, participantId: string): Promise<void>;
  disconnect(): Promise<void>;
  enableCamera(): Promise<void>;
  disableCamera(): Promise<void>;
  getParticipants(): VideoChatParticipant[];
  onParticipantsChanged(cb: (participants: VideoChatParticipant[]) => void): () => void;
  onError(cb: (error: Error) => void): () => void;
}

// ---------------------------------------------------------------------------
// Stub adapter (no-op — used until real SDK is installed)
// ---------------------------------------------------------------------------

/** No-op stub used until the real SDK adapter is plugged in (F2+F3 follow-up). */
export class StubVideoChatAdapter implements VideoChatAdapter {
  async connect(_roomId: string, _participantId: string): Promise<void> {}
  async disconnect(): Promise<void> {}
  async enableCamera(): Promise<void> {}
  async disableCamera(): Promise<void> {}
  getParticipants(): VideoChatParticipant[] { return []; }
  onParticipantsChanged(_cb: (participants: VideoChatParticipant[]) => void): () => void { return () => {}; }
  onError(_cb: (error: Error) => void): () => void { return () => {}; }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseVideoChatOptions {
  /** Supabase room UUID — used as the LiveKit/Daily room identifier */
  roomId: string | undefined;
  /** The local player's auth.users UUID */
  userId: string | undefined;
  /**
   * Override the default StubVideoChatAdapter.
   * Supply the real LiveKit / Daily.co adapter in production.
   */
  adapter?: VideoChatAdapter;
}

export interface UseVideoChatReturn {
  /** Whether the local player has opted in to video chat */
  videoChatEnabled: boolean;
  /** Whether the local camera is currently streaming */
  isLocalCameraOn: boolean;
  /** Permission status for the device camera */
  cameraPermissionStatus: CameraPermissionStatus;
  /** Remote participants with their current camera state */
  remoteParticipants: VideoChatParticipant[];
  /** Toggle local video chat on/off. Requests camera permission if undetermined. */
  toggleVideoChat: () => Promise<void>;
  /** Explicitly request camera permission (e.g. from a settings screen). */
  requestCameraPermission: () => Promise<CameraPermissionStatus>;
}

export function useVideoChat({
  roomId,
  userId,
  adapter: adapterProp,
}: UseVideoChatOptions): UseVideoChatReturn {
  const adapterRef = useRef<VideoChatAdapter>(adapterProp ?? new StubVideoChatAdapter());

  const [videoChatEnabled, setVideoChatEnabled] = useState(false);
  const [isLocalCameraOn, setIsLocalCameraOn] = useState(false);
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState<CameraPermissionStatus>('undetermined');
  const [remoteParticipants, setRemoteParticipants] = useState<VideoChatParticipant[]>([]);

  // Keep adapter ref current if a new adapter is injected (e.g. in tests or hot-swap)
  useEffect(() => {
    if (adapterProp) {
      adapterRef.current = adapterProp;
    }
  }, [adapterProp]);

  // Subscribe to remote participant camera changes while video chat is active
  useEffect(() => {
    if (!videoChatEnabled) return;
    const unsubscribe = adapterRef.current.onParticipantsChanged(setRemoteParticipants);
    return unsubscribe;
  }, [videoChatEnabled]);

  // Subscribe to SDK errors (log as non-fatal — video is opt-in)
  useEffect(() => {
    if (!videoChatEnabled) return;
    const unsubscribe = adapterRef.current.onError((err: Error) => {
      gameLogger.warn('[VideoChat] SDK error (non-fatal):', err.message);
    });
    return unsubscribe;
  }, [videoChatEnabled]);

  // Disconnect from video when roomId changes (navigating away mid-game) or on unmount
  useEffect(() => {
    return () => {
      adapterRef.current.disconnect().catch(() => {});
    };
  }, [roomId]);

  const requestCameraPermission = useCallback(async (): Promise<CameraPermissionStatus> => {
    if (Platform.OS === 'android') {
      try {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'Big Two needs camera access to stream your video during multiplayer games.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          }
        );
        const status: CameraPermissionStatus =
          result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' :
          result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'restricted' : 'denied';
        setCameraPermissionStatus(status);
        return status;
      } catch {
        setCameraPermissionStatus('denied');
        return 'denied';
      }
    }

    // iOS: the NSCameraUsageDescription Info.plist entry (added in app.json)
    // triggers the system prompt on the first non-stub enableCamera() call.
    // The stub adapter is a no-op, so we optimistically report 'granted' here;
    // when the real SDK is installed, replace with:
    //   const { status } = await Camera.requestCameraPermissionsAsync();
    setCameraPermissionStatus('granted');
    return 'granted';
  }, []);

  const toggleVideoChat = useCallback(async (): Promise<void> => {
    if (!roomId || !userId) return;

    if (!videoChatEnabled) {
      // ── Opt-in path ────────────────────────────────────────────────────────
      let permission = cameraPermissionStatus;
      if (permission === 'undetermined') {
        permission = await requestCameraPermission();
      }
      if (permission !== 'granted') {
        gameLogger.info('[VideoChat] Camera permission not granted — video chat blocked.');
        return;
      }

      try {
        await adapterRef.current.connect(roomId, userId);
        await adapterRef.current.enableCamera();
        setVideoChatEnabled(true);
        setIsLocalCameraOn(true);
        gameLogger.info('[VideoChat] Local camera enabled.');
      } catch (err) {
        // Connection failure is non-fatal — video chat is always opt-in
        gameLogger.warn('[VideoChat] Failed to enable camera:', err instanceof Error ? err.message : String(err));
      }
    } else {
      // ── Opt-out path ──────────────────────────────────────────────────────
      await adapterRef.current.disableCamera().catch(() => {});
      await adapterRef.current.disconnect().catch(() => {});
      setVideoChatEnabled(false);
      setIsLocalCameraOn(false);
      setRemoteParticipants([]);
      gameLogger.info('[VideoChat] Local camera disabled.');
    }
  }, [roomId, userId, videoChatEnabled, cameraPermissionStatus, requestCameraPermission]);

  return {
    videoChatEnabled,
    isLocalCameraOn,
    cameraPermissionStatus,
    remoteParticipants,
    toggleVideoChat,
    requestCameraPermission,
  };
}
