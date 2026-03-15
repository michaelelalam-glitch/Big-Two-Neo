/**
 * useVideoChat — Manages opt-in in-game video + audio chat state (Task #651).
 *
 * Architecture: provides a stable interface against which any video-chat SDK
 * (LiveKit, Daily.co, etc.) can be plugged in via the `VideoChatAdapter` interface.
 * The default adapter is a `StubVideoChatAdapter` (no-op); the real LiveKit adapter
 * should be wired in once `@livekit/react-native` + `react-native-webrtc` are
 * installed as native dependencies.
 *
 * The full `VideoChatAdapter` contract includes both camera AND microphone controls:
 *   connect / disconnect, enableCamera / disableCamera,
 *   enableMicrophone / disableMicrophone, getParticipants,
 *   onParticipantsChanged, onError.
 * `GameContext` exposes 7 fields: videoChatEnabled, isLocalCameraOn, isLocalMicOn,
 * remoteCameraStates, remoteMicStates, toggleVideoChat, toggleMic.
 *
 * Prerequisites:
 * - F2 (voice chat) and this feature should share the same LiveKit room session —
 *   pass the same `adapter` instance to both hooks once the SDK is installed.
 * - Camera + microphone permissions must be declared in app.json (done in this PR)
 *   before requesting them at runtime.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { gameLogger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MediaPermissionStatus = 'undetermined' | 'granted' | 'denied' | 'restricted';

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
  /**
   * Returns the list of **remote** participants currently in the room.
   * Adapters must exclude the local participant from this list so callers
   * can use it directly to build per-player remote camera/mic state without
   * additional filtering.
   */
  getParticipants(): VideoChatParticipant[];
  /**
   * Subscribes to remote participant list changes.
   * The `participants` array passed to `cb` must also exclude the local
   * participant (same contract as `getParticipants`).
   */
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
  /** Whether the local player has opted in to video chat (camera + mic) */
  videoChatEnabled: boolean;
  /**
   * Whether the local player has opted in to voice-only chat (mic only, no camera).
   * Derived: `videoChatEnabled && !isLocalCameraOn`.
   * True when `toggleVoiceChat` was used to join; false when `toggleVideoChat` was used.
   */
  voiceChatEnabled: boolean;
  /** Whether the local camera is currently streaming */
  isLocalCameraOn: boolean;
  /** Whether the local microphone is currently active */
  isLocalMicOn: boolean;
  /** Permission status for the device camera */
  cameraPermissionStatus: MediaPermissionStatus;
  /** Permission status for the device microphone */
  micPermissionStatus: MediaPermissionStatus;
  /**
   * Remote participants with their current camera and mic state.
   * The local participant is never included (adapters are required to exclude
   * it — see the `getParticipants` / `onParticipantsChanged` contract).
   */
  remoteParticipants: VideoChatParticipant[];
  /** Toggle local video+audio chat on/off. Requests camera+mic permissions if undetermined. */
  toggleVideoChat: () => Promise<void>;
  /**
   * Toggle voice-only chat (audio only — no camera) on/off.
   * Requests microphone permission only. The local camera is never enabled.
   * When voice chat is already active, calling this disconnects the session.
   * When video chat is already active, this is a no-op (use toggleVideoChat to opt out).
   */
  toggleVoiceChat: () => Promise<void>;
  /**
   * True while `toggleVideoChat` or `toggleVoiceChat` is executing an async
   * enable/disable sequence. Use to disable buttons and show spinners.
   */
  isConnecting: boolean;
  /** Toggle local microphone mute/unmute while video or voice chat is active. */
  toggleMic: () => Promise<void>;
  /** Explicitly request camera permission (e.g. from a settings screen). */
  requestCameraPermission: () => Promise<MediaPermissionStatus>;
  /** Explicitly request microphone permission (e.g. from a settings screen). */
  requestMicPermission: () => Promise<MediaPermissionStatus>;
}

export function useVideoChat({
  roomId,
  userId,
  adapter: adapterProp,
}: UseVideoChatOptions): UseVideoChatReturn {
  const adapterRef = useRef<VideoChatAdapter>(null!);
  // Synchronize the ref during render so render-phase reads/callbacks in the
  // same cycle always see the current adapter. With ??= alone, a change of
  // adapterProp (undefined → real, or A → B) would not be reflected until the
  // post-commit effect fires — too late for same-render calls.
  // When adapterProp is provided it always wins; otherwise lazy-init the stub
  // once (avoids allocating a new StubVideoChatAdapter on every render).
  if (adapterProp != null) {
    adapterRef.current = adapterProp;
  } else {
    adapterRef.current ??= new StubVideoChatAdapter();
  }

  const [videoChatEnabled, setVideoChatEnabled] = useState(false);
  const [isLocalCameraOn, setIsLocalCameraOn] = useState(false);
  const [isLocalMicOn, setIsLocalMicOn] = useState(false);
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState<MediaPermissionStatus>('undetermined');
  const [micPermissionStatus, setMicPermissionStatus] = useState<MediaPermissionStatus>('undetermined');
  const [remoteParticipants, setRemoteParticipants] = useState<VideoChatParticipant[]>([]);
  // True while toggleVideoChat is executing — exposed to the UI so tiles can
  // disable the toggle button and prevent re-entrant rapid taps.
  const [isConnecting, setIsConnecting] = useState(false);
  // Ref companion: used to short-circuit re-entrant calls before setState
  // triggers a re-render (ref reads are synchronous, state reads are not).
  const isTogglingRef = useRef(false);

  // Track the previous adapterProp so the swap-teardown effect can detect a
  // genuine adapter change. adapterRef.current is already updated during render
  // (above), so comparing adapterRef.current to adapterProp in the effect would
  // always be equal — a separate prevAdapterPropRef is required.
  const prevAdapterPropRef = useRef<VideoChatAdapter | undefined>(undefined);

  // Teardown the old adapter when adapterProp is hot-swapped (e.g. DI in tests),
  // including the case where adapterProp changes to undefined (real → undefined).
  // If the hook is currently connected when the adapter is swapped, best-effort
  // disconnect the previous adapter before switching — prevents a lingering
  // connected session. The !adapterProp guard is intentionally absent so that
  // removing the injected adapter while connected still triggers cleanup.
  useEffect(() => {
    const prevAdapter = prevAdapterPropRef.current;
    prevAdapterPropRef.current = adapterProp;
    if (!prevAdapter || prevAdapter === adapterProp) return;
    if (videoChatEnabled) {
      prevAdapter.disableCamera().catch(() => {});
      prevAdapter.disableMicrophone().catch(() => {});
      prevAdapter.disconnect().catch(() => {});
      setVideoChatEnabled(false);
      setIsLocalCameraOn(false);
      setIsLocalMicOn(false);
      setRemoteParticipants([]);
    }
  }, [adapterProp, videoChatEnabled]);

  // Subscribe to remote participant changes while video chat is active.
  // adapterProp is included so the effect re-runs (and re-subscribes) if the
  // adapter is hot-swapped — the old adapter is unsubscribed via the cleanup
  // return before the new subscription is opened.
  useEffect(() => {
    if (!videoChatEnabled) return;
    const unsubscribe = adapterRef.current.onParticipantsChanged(setRemoteParticipants);
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoChatEnabled, adapterProp]);

  // Subscribe to SDK errors (log as non-fatal — video is opt-in).
  useEffect(() => {
    if (!videoChatEnabled) return;
    const unsubscribe = adapterRef.current.onError((err: Error) => {
      gameLogger.warn('[VideoChat] SDK error (non-fatal):', err.message);
    });
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoChatEnabled, adapterProp]);

  // Track the previous roomId so the roomId-change effect can distinguish
  // a genuine room navigation from the initial mount.
  const prevRoomIdRef = useRef<string | undefined>(undefined);

  // State reset + teardown when roomId changes (runs in the effect BODY, not in
  // the cleanup return). This ensures setVideoChatEnabled / setIsLocalCameraOn /
  // etc. are never called during unmount, which would produce React warnings
  // about updating state on an unmounted component.
  // Mirror the opt-out path: disable tracks before disconnecting so hardware
  // capture stops immediately on room navigation.
  useEffect(() => {
    if (
      prevRoomIdRef.current !== undefined &&
      prevRoomIdRef.current !== roomId &&
      // Only tear down when there is an active session — avoids unnecessary
      // disconnect/disable calls (and potential interference with a shared
      // adapter used by voice chat) when roomId changes but video is already
      // off.
      videoChatEnabled
    ) {
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
  // videoChatEnabled included so the effect sees the current session state when
  // roomId fires. Re-runs on videoChatEnabled change are harmless: the roomId
  // comparison always fails (prevRoomIdRef.current === roomId) so no teardown
  // fires — only prevRoomIdRef.current is updated (no-op, same value).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, videoChatEnabled]);

  // Hardware teardown on unmount ONLY — no setState here to avoid React warnings
  // when the component is already being destroyed. State is discarded on unmount
  // so there is nothing to reset.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    return () => {
      adapterRef.current.disableMicrophone().catch(() => {});
      adapterRef.current.disableCamera().catch(() => {});
      adapterRef.current.disconnect().catch(() => {});
    };
  }, []);

  const requestCameraPermission = useCallback(async (): Promise<MediaPermissionStatus> => {
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
        const status: MediaPermissionStatus =
          result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' :
          result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'restricted' : 'denied';
        setCameraPermissionStatus(status);
        return status;
      } catch {
        setCameraPermissionStatus('denied');
        return 'denied';
      }
    }

    if (Platform.OS === 'ios') {
      // iOS: NSCameraUsageDescription in Info.plist triggers the OS prompt on
      // the first real enableCamera() call. Stub is a no-op — return 'granted'
      // to allow stub-mode operation, but intentionally DO NOT persist to state
      // so requestCameraPermission() is re-invoked on every toggleVideoChat().
      // TODO(F3): replace with Camera.requestCameraPermissionsAsync()
      return 'granted';
    }

    // Unsupported platform (e.g. web) — video chat is not supported.
    // Block opt-in by returning 'restricted' (treated as go-to-Settings only).
    return 'restricted';
  }, []);

  const requestMicPermission = useCallback(async (): Promise<MediaPermissionStatus> => {
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
        const status: MediaPermissionStatus =
          result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' :
          result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'restricted' : 'denied';
        setMicPermissionStatus(status);
        return status;
      } catch {
        setMicPermissionStatus('denied');
        return 'denied';
      }
    }

    if (Platform.OS === 'ios') {
      // iOS: NSMicrophoneUsageDescription in Info.plist triggers the OS prompt on
      // the first real enableMicrophone() call. Same rationale as requestCameraPermission.
      // TODO(F3): replace with Audio.requestPermissionsAsync() from expo-av
      //          (or the LiveKit / Daily SDK's own permission flow once wired in)
      return 'granted';
    }

    // Unsupported platform (e.g. web) — mic capture not supported.
    return 'restricted';
  }, []);

  const toggleVideoChat = useCallback(async (): Promise<void> => {
    // Re-entrant guard: if a previous toggle is still executing (e.g. waiting
    // for connect() or permission dialogs), ignore this call. Use both a ref
    // (synchronous, checked before any await) and state (triggers re-render so
    // the tile can show a spinner and be disabled).
    if (isTogglingRef.current) return;
    isTogglingRef.current = true;
    setIsConnecting(true);
    try {
      if (!videoChatEnabled) {
        // ── Opt-in path ──────────────────────────────────────────────────────
        // Guard roomId + userId here (not at the top) so the opt-out path below
        // can always run even when roomId/userId becomes transiently undefined
        // while video chat is already active (e.g. a partial re-render during
        // navigation).
        if (!roomId || !userId) return;
        // Request camera permission first. Re-request on 'denied' so users who
        // previously denied can reconsider by tapping the toggle again — matching
        // standard mobile UX. 'restricted' is a go-to-Settings-only path and is
        // intentionally excluded.
        let camPermission = cameraPermissionStatus;
        if (camPermission === 'undetermined' || camPermission === 'denied') {
          camPermission = await requestCameraPermission();
        }
        // Short-circuit before requesting mic: if camera permission was denied,
        // skip the microphone permission dialog entirely — video chat will be
        // blocked regardless, and prompting for mic when camera is denied is
        // unnecessary and confusing on Android.
        if (camPermission !== 'granted') {
          gameLogger.info('[VideoChat] Camera permission not granted — video chat blocked.');
          return;
        }
        // Request mic permission only after camera is confirmed granted.
        // Re-request on 'denied' for the same UX reason as camera.
        let micPermission = micPermissionStatus;
        if (micPermission === 'undetermined' || micPermission === 'denied') {
          micPermission = await requestMicPermission();
        }

        try {
          await adapterRef.current.connect(roomId, userId);
          await adapterRef.current.enableCamera();
          // Mic is opt-in and non-blocking: wrap in its own try/catch so a mic
          // hardware error or OS permission surprise does NOT propagate to the
          // outer catch and tear down the camera connection. Camera-only video chat
          // is fully supported even when mic fails.
          // Track whether mic was actually enabled — micPermission may be 'granted'
          // but enableMicrophone() can still throw (hardware error, OS surprise).
          // Base the log on the actual outcome, not the permission status.
          let micEnabled = false;
          if (micPermission === 'granted') {
            try {
              await adapterRef.current.enableMicrophone();
              micEnabled = true;
              setIsLocalMicOn(true);
            } catch (micErr) {
              gameLogger.warn(
                '[VideoChat] Mic enable failed (non-fatal — camera still active):',
                micErr instanceof Error ? micErr.message : String(micErr)
              );
            }
          }
          // Seed remote participants immediately from current SDK state so the UI
          // shows existing participants without waiting for the next event.
          setRemoteParticipants(adapterRef.current.getParticipants());
          setVideoChatEnabled(true);
          setIsLocalCameraOn(true);
          // Log reflects what was actually enabled — permission 'granted' does not
          // guarantee enableMicrophone() succeeded (may have thrown).
          gameLogger.info(
            micEnabled
              ? '[VideoChat] Local camera + mic enabled.'
              : '[VideoChat] Local camera enabled (mic not active — audio stream inactive).'
          );
        } catch (err) {
          // Connection failure is non-fatal — video chat is always opt-in.
          // Best-effort cleanup so the adapter does not remain half-connected.
          gameLogger.warn('[VideoChat] Failed to enable video chat:', err instanceof Error ? err.message : String(err));
          adapterRef.current.disableMicrophone().catch(() => {});
          adapterRef.current.disableCamera().catch(() => {});
          adapterRef.current.disconnect().catch(() => {});
          // Reset all local/remote state to mirror the opt-out path — ensures
          // the UI cannot remain in a partially-enabled state after a failure.
          setVideoChatEnabled(false);
          setIsLocalCameraOn(false);
          setIsLocalMicOn(false);
          setRemoteParticipants([]);
        }
      } else {
        // ── Opt-out path ────────────────────────────────────────────────────
        await adapterRef.current.disableMicrophone().catch(() => {});
        await adapterRef.current.disableCamera().catch(() => {});
        await adapterRef.current.disconnect().catch(() => {});
        setVideoChatEnabled(false);
        setIsLocalCameraOn(false);
        setIsLocalMicOn(false);
        setRemoteParticipants([]);
        gameLogger.info('[VideoChat] Local camera + mic disabled.');
      }
    } finally {
      // Always clear the in-flight guard — even if an error escapes or an early
      // return fires (try/finally guarantees execution).
      isTogglingRef.current = false;
      setIsConnecting(false);
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
      // 'restricted' (NEVER_ASK_AGAIN / parental controls) is a go-to-Settings-only path.
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

  /**
   * Toggle voice-only chat (audio only — no camera).
   *
   * - If a full video chat session is already active, this is a no-op: use
   *   `toggleVideoChat()` to opt out instead (prevents confusing half-teardowns).
   * - If voice chat is already active (`videoChatEnabled && !isLocalCameraOn`),
   *   this disconnects the session.
   * - Otherwise, requests mic permission, connects to the room, and enables the
   *   microphone. Camera is never touched.
   */
  const toggleVoiceChat = useCallback(async (): Promise<void> => {
    if (isTogglingRef.current) return;

    // If video chat (camera on) is already active, ignore — user must use
    // toggleVideoChat to manage that session.
    if (videoChatEnabled && isLocalCameraOn) return;

    isTogglingRef.current = true;
    setIsConnecting(true);
    try {
      if (!videoChatEnabled) {
        // ── Opt-in (voice only) ────────────────────────────────────────────
        if (!roomId || !userId) return;

        let micPermission = micPermissionStatus;
        if (micPermission === 'undetermined' || micPermission === 'denied') {
          micPermission = await requestMicPermission();
        }
        if (micPermission !== 'granted') {
          gameLogger.info('[VoiceChat] Mic permission not granted — voice chat blocked.');
          return;
        }

        try {
          await adapterRef.current.connect(roomId, userId);
          await adapterRef.current.enableMicrophone();
          setRemoteParticipants(adapterRef.current.getParticipants());
          setVideoChatEnabled(true);
          // isLocalCameraOn remains false — this is the voice-only indicator.
          setIsLocalMicOn(true);
          gameLogger.info('[VoiceChat] Mic enabled (audio-only mode).');
        } catch (err) {
          gameLogger.warn('[VoiceChat] Failed to enable voice chat:', err instanceof Error ? err.message : String(err));
          adapterRef.current.disableMicrophone().catch(() => {});
          adapterRef.current.disconnect().catch(() => {});
          setVideoChatEnabled(false);
          setIsLocalMicOn(false);
          setRemoteParticipants([]);
        }
      } else {
        // ── Opt-out (voice was on, camera was off) ─────────────────────────
        await adapterRef.current.disableMicrophone().catch(() => {});
        await adapterRef.current.disconnect().catch(() => {});
        setVideoChatEnabled(false);
        setIsLocalMicOn(false);
        setRemoteParticipants([]);
        gameLogger.info('[VoiceChat] Voice chat disconnected.');
      }
    } finally {
      isTogglingRef.current = false;
      setIsConnecting(false);
    }
  }, [roomId, userId, videoChatEnabled, isLocalCameraOn, micPermissionStatus, requestMicPermission]);

  // voiceChatEnabled is a derived value: connected but camera is off.
  const voiceChatEnabled = videoChatEnabled && !isLocalCameraOn;

  return {
    videoChatEnabled,
    voiceChatEnabled,
    isLocalCameraOn,
    isLocalMicOn,
    isConnecting,
    cameraPermissionStatus,
    micPermissionStatus,
    remoteParticipants,
    toggleVideoChat,
    toggleVoiceChat,
    toggleMic,
    requestCameraPermission,
    requestMicPermission,
  };
}
