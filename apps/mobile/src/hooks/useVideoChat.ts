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
  /** Whether the participant's microphone is actively streaming audio */
  isMicOn: boolean;
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
  enableMicrophone(): Promise<void>;
  disableMicrophone(): Promise<void>;
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
  async enableMicrophone(): Promise<void> {}
  async disableMicrophone(): Promise<void> {}
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
  /** Whether the local microphone is currently active */
  isLocalMicOn: boolean;
  /** Permission status for the device camera */
  cameraPermissionStatus: CameraPermissionStatus;
  /** Permission status for the device microphone */
  micPermissionStatus: CameraPermissionStatus;
  /** Remote participants with their current camera and mic state */
  remoteParticipants: VideoChatParticipant[];
  /** Toggle local video+audio chat on/off. Requests camera+mic permissions if undetermined. */
  toggleVideoChat: () => Promise<void>;
  /** Toggle local microphone mute/unmute while video chat is active. */
  toggleMic: () => Promise<void>;
  /** Explicitly request camera permission (e.g. from a settings screen). */
  requestCameraPermission: () => Promise<CameraPermissionStatus>;
  /** Explicitly request microphone permission (e.g. from a settings screen). */
  requestMicPermission: () => Promise<CameraPermissionStatus>;
}

export function useVideoChat({
  roomId,
  userId,
  adapter: adapterProp,
}: UseVideoChatOptions): UseVideoChatReturn {
  // Lazy-init: `useRef(new StubVideoChatAdapter())` would allocate a new stub on
  // every render because JS evaluates all arguments before the function call,
  // even though useRef only uses the first call's value. Using `??=` short-circuits
  // the right-hand side once the ref is non-null. (r2936015541)
  const adapterRef = useRef<VideoChatAdapter>(null!);
  adapterRef.current ??= adapterProp ?? new StubVideoChatAdapter();

  const [videoChatEnabled, setVideoChatEnabled] = useState(false);
  const [isLocalCameraOn, setIsLocalCameraOn] = useState(false);
  const [isLocalMicOn, setIsLocalMicOn] = useState(false);
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState<CameraPermissionStatus>('undetermined');
  const [micPermissionStatus, setMicPermissionStatus] = useState<CameraPermissionStatus>('undetermined');
  const [remoteParticipants, setRemoteParticipants] = useState<VideoChatParticipant[]>([]);

  // Keep adapter ref current if a new adapter is injected (e.g. in tests or hot-swap).
  // If the hook is currently connected when the adapter is swapped, best-effort disconnect
  // the previous adapter before switching — prevents a lingering connected session.
  // (r2935998628)
  useEffect(() => {
    if (!adapterProp) return;
    const prevAdapter = adapterRef.current;
    if (prevAdapter !== adapterProp) {
      if (videoChatEnabled) {
        prevAdapter.disableCamera().catch(() => {});
        prevAdapter.disableMicrophone().catch(() => {});
        prevAdapter.disconnect().catch(() => {});
        setVideoChatEnabled(false);
        setIsLocalCameraOn(false);
        setIsLocalMicOn(false);
        setRemoteParticipants([]);
      }
      adapterRef.current = adapterProp;
    }
  }, [adapterProp, videoChatEnabled]);

  // Subscribe to remote participant changes while video chat is active.
  // adapterProp is included so the effect re-runs (and re-subscribes) if the
  // adapter is hot-swapped — the old adapter is unsubscribed via the cleanup
  // return before the new subscription is opened. (r2935394770)
  useEffect(() => {
    if (!videoChatEnabled) return;
    const unsubscribe = adapterRef.current.onParticipantsChanged(setRemoteParticipants);
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoChatEnabled, adapterProp]);

  // Subscribe to SDK errors (log as non-fatal — video is opt-in). (r2935394770)
  useEffect(() => {
    if (!videoChatEnabled) return;
    const unsubscribe = adapterRef.current.onError((err: Error) => {
      gameLogger.warn('[VideoChat] SDK error (non-fatal):', err.message);
    });
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoChatEnabled, adapterProp]);

  // Track the previous roomId so the roomId-change effect can distinguish
  // a genuine room navigation from the initial mount. (r2936027821)
  const prevRoomIdRef = useRef<string | undefined>(undefined);

  // State reset + teardown when roomId changes (runs in the effect BODY, not in
  // the cleanup return). This ensures setVideoChatEnabled / setIsLocalCameraOn /
  // etc. are never called during unmount, which would produce React warnings
  // about updating state on an unmounted component. (r2936027821)
  // Mirror the opt-out path: disable tracks before disconnecting so hardware
  // capture stops immediately on room navigation. (r2935998629)
  useEffect(() => {
    if (prevRoomIdRef.current !== undefined && prevRoomIdRef.current !== roomId) {
      // roomId changed mid-session — tear down the current connection and reset
      // all UI state so the tile/toggle never shows "enabled" for the new room.
      adapterRef.current.disableMicrophone().catch(() => {});
      adapterRef.current.disableCamera().catch(() => {});
      adapterRef.current.disconnect().catch(() => {});
      setVideoChatEnabled(false);
      setIsLocalCameraOn(false);
      setIsLocalMicOn(false);
      setRemoteParticipants([]);
    }
    prevRoomIdRef.current = roomId;
  }, [roomId]);

  // Hardware teardown on unmount ONLY — no setState here to avoid React warnings
  // when the component is already being destroyed. State is discarded on unmount
  // so there is nothing to reset. (r2936027821)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    return () => {
      adapterRef.current.disableMicrophone().catch(() => {});
      adapterRef.current.disableCamera().catch(() => {});
      adapterRef.current.disconnect().catch(() => {});
    };
  }, []);

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
    // triggers the OS permission prompt on the first real enableCamera() call.
    // The stub adapter is a no-op so we return 'granted' to allow stub-mode
    // operation, but we intentionally DO NOT persist that into state — the
    // state stays 'undetermined' so requestCameraPermission() is re-invoked
    // on every toggleVideoChat() attempt, which is the right behaviour until
    // the real SDK is installed and can report the actual OS decision.
    // TODO(F3): replace with: const { status } = await Camera.requestCameraPermissionsAsync();
    //           then setCameraPermissionStatus(status); return status; (r2935998616)
    return 'granted';
  }, []);

  const requestMicPermission = useCallback(async (): Promise<CameraPermissionStatus> => {
    if (Platform.OS === 'android') {
      try {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'Big Two needs microphone access to stream your audio during multiplayer games.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          }
        );
        const status: CameraPermissionStatus =
          result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' :
          result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'restricted' : 'denied';
        setMicPermissionStatus(status);
        return status;
      } catch {
        setMicPermissionStatus('denied');
        return 'denied';
      }
    }

    // iOS: NSMicrophoneUsageDescription in Info.plist (added in app.json)
    // triggers the OS permission prompt on first real enableMicrophone() call.
    // Same stub-mode rationale as requestCameraPermission — do not persist a
    // fake 'granted' into state; keep 'undetermined' until real SDK confirms.
    // TODO(F3): replace with: const { status } = await Microphone.getPermissionsAsync();
    //           then setMicPermissionStatus(status); return status; (r2935998619)
    return 'granted';
  }, []);

  const toggleVideoChat = useCallback(async (): Promise<void> => {
    if (!roomId || !userId) return;

    if (!videoChatEnabled) {
      // ── Opt-in path ────────────────────────────────────────────────────────
      // Request camera permission first. Re-request on 'denied' so users who
      // previously denied can reconsider by tapping the toggle again — matching
      // standard mobile UX. 'restricted' is a go-to-Settings-only path and is
      // intentionally excluded. (r2936015516)
      let camPermission = cameraPermissionStatus;
      if (camPermission === 'undetermined' || camPermission === 'denied') {
        camPermission = await requestCameraPermission();
      }
      // Short-circuit before requesting mic: if camera permission was denied,
      // skip the microphone permission dialog entirely — video chat will be
      // blocked regardless, and prompting for mic when camera is denied is
      // unnecessary and confusing on Android. (r2936027815)
      if (camPermission !== 'granted') {
        gameLogger.info('[VideoChat] Camera permission not granted — video chat blocked.');
        return;
      }
      // Request mic permission only after camera is confirmed granted.
      // Re-request on 'denied' for the same UX reason as camera. (r2936015516)
      let micPermission = micPermissionStatus;
      if (micPermission === 'undetermined' || micPermission === 'denied') {
        micPermission = await requestMicPermission();
      }

      try {
        await adapterRef.current.connect(roomId, userId);
        await adapterRef.current.enableCamera();
        // Enable mic if permission was granted; mic is non-blocking (audio-only block
        // should not prevent video from streaming).
        if (micPermission === 'granted') {
          await adapterRef.current.enableMicrophone();
          setIsLocalMicOn(true);
        }
        // Seed remote participants immediately from current SDK state so the UI
        // shows existing participants without waiting for the next event. (r2935394720)
        setRemoteParticipants(adapterRef.current.getParticipants());
        setVideoChatEnabled(true);
        setIsLocalCameraOn(true);
        // Log reflects what was actually enabled — mic may have been skipped if
        // permission was denied. (r2935977905)
        gameLogger.info(
          micPermission === 'granted'
            ? '[VideoChat] Local camera + mic enabled.'
            : '[VideoChat] Local camera enabled (mic permission not granted — audio stream inactive).'
        );
      } catch (err) {
        // Connection failure is non-fatal — video chat is always opt-in.
        // Best-effort cleanup so the adapter does not remain half-connected. (r2935394739)
        gameLogger.warn('[VideoChat] Failed to enable video chat:', err instanceof Error ? err.message : String(err));
        adapterRef.current.disableMicrophone().catch(() => {});
        adapterRef.current.disableCamera().catch(() => {});
        adapterRef.current.disconnect().catch(() => {});
        setIsLocalMicOn(false);
      }
    } else {
      // ── Opt-out path ──────────────────────────────────────────────────────
      await adapterRef.current.disableMicrophone().catch(() => {});
      await adapterRef.current.disableCamera().catch(() => {});
      await adapterRef.current.disconnect().catch(() => {});
      setVideoChatEnabled(false);
      setIsLocalCameraOn(false);
      setIsLocalMicOn(false);
      setRemoteParticipants([]);
      gameLogger.info('[VideoChat] Local camera + mic disabled.');
    }
  }, [roomId, userId, videoChatEnabled, cameraPermissionStatus, micPermissionStatus, requestCameraPermission, requestMicPermission]);

  const toggleMic = useCallback(async (): Promise<void> => {
    if (!videoChatEnabled) return;
    if (isLocalMicOn) {
      await adapterRef.current.disableMicrophone().catch(() => {});
      setIsLocalMicOn(false);
      gameLogger.info('[VideoChat] Microphone muted.');
    } else {
      // Re-request on 'denied' so users who previously denied can retry in-game.
      // 'restricted' (NEVER_ASK_AGAIN / parental controls) is a go-to-Settings-only path. (r2936015523)
      let permission = micPermissionStatus;
      if (permission === 'undetermined' || permission === 'denied') {
        permission = await requestMicPermission();
      }
      if (permission !== 'granted') {
        gameLogger.info('[VideoChat] Mic permission not granted — mute toggle blocked.');
        return;
      }
      try {
        await adapterRef.current.enableMicrophone();
        setIsLocalMicOn(true);
        gameLogger.info('[VideoChat] Microphone unmuted.');
      } catch (err) {
        gameLogger.warn('[VideoChat] Failed to enable microphone:', err instanceof Error ? err.message : String(err));
      }
    }
  }, [videoChatEnabled, isLocalMicOn, micPermissionStatus, requestMicPermission]);

  return {
    videoChatEnabled,
    isLocalCameraOn,
    isLocalMicOn,
    cameraPermissionStatus,
    micPermissionStatus,
    remoteParticipants,
    toggleVideoChat,
    toggleMic,
    requestCameraPermission,
    requestMicPermission,
  };
}
