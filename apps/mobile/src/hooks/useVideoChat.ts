/**
 * useVideoChat — Manages opt-in in-game video + audio chat state (Tasks #649 / #651).
 *
 * Architecture: provides a stable interface against which any video-chat SDK
 * (LiveKit, Daily.co, etc.) can be plugged in via the `VideoChatAdapter` interface.
 * The default adapter is a `StubVideoChatAdapter` (no-op); inject a
 * `LiveKitVideoChatAdapter` instance (via the `adapter` prop) in native builds.
 *
 * The full `VideoChatAdapter` contract includes both camera AND microphone controls:
 *   connect / disconnect, enableCamera / disableCamera,
 *   enableMicrophone / disableMicrophone, getParticipants,
 *   onParticipantsChanged, onError.
 *
 * Return value (11 fields exposed via GameContext):
 *   isChatConnected   — true while the room session is active (voice OR video).
 *   voiceChatEnabled  — derived: isChatConnected && isLocalMicOn && !isLocalCameraOn.
 *   isLocalCameraOn   — true when the local camera track is publishing.
 *   isLocalMicOn      — true when the local mic track is unmuted.
 *   isConnecting      — true while an async connect/disconnect is in-flight.
 *   remoteParticipants — live array of remote peer states (camera, mic, quality).
 *   toggleVideoChat   — join/leave the full video+audio session (camera+mic).
 *   toggleVoiceChat   — join/leave a voice-only session (mic only, no camera).
 *   toggleCamera      — enable/disable camera track within an active session.
 *   toggleMic         — mute/unmute microphone within an active session.
 *   requestCamera/MicPermission — imperative permission helpers.
 *
 * Prerequisites:
 * - `@livekit/react-native` + `livekit-client` must be installed and
 *   `expo prebuild` run before using `LiveKitVideoChatAdapter` in a native build.
 * - Camera + microphone permissions are declared in app.json.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { gameLogger } from '../utils/logger';
import { i18n } from '../i18n';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MediaPermissionStatus = 'undetermined' | 'granted' | 'denied' | 'restricted';

/**
 * Structural type matching `TrackReference` from `@livekit/components-core`.
 * Defined here to avoid a hard dependency on that package in the interface.
 * Pass this directly as `trackRef` to `<VideoTrack>` from `@livekit/react-native`.
 */
export interface LiveKitTrackRef {
  participant: object; // livekit-client Participant
  publication: object; // livekit-client TrackPublication
  source: unknown; // Track.Source enum value
}

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
  /**
   * Returns a LiveKit-compatible TrackReference for the given participant's
   * camera track, suitable for passing as `trackRef` to `<VideoTrack>` from
   * `@livekit/react-native`. Returns `undefined` when the adapter is not
   * connected, the participant is not found, or has no camera publication.
   * `'__local__'` returns the local participant's camera track reference.
   * Optional: adapters that don't support direct video rendering may omit this.
   */
  getVideoTrackRef?(participantId: string | '__local__'): LiveKitTrackRef | undefined;
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
  getParticipants(): VideoChatParticipant[] {
    return [];
  }
  onParticipantsChanged(_cb: (participants: VideoChatParticipant[]) => void): () => void {
    return () => {};
  }
  onError(_cb: (error: Error) => void): () => void {
    return () => {};
  }
}

/**
 * Thrown by adapters to signal a non-client-initiated (unexpected) disconnect.
 * Using a typed Error subclass lets the hook detect unexpected disconnects via
 * `instanceof` rather than brittle message-string matching.
 */
export class UnexpectedDisconnectError extends Error {
  constructor(message = 'Video chat session ended unexpectedly') {
    super(message);
    this.name = 'UnexpectedDisconnectError';
  }
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
  /**
   * When true, automatically connect to the room in receive-only mode
   * (no local tracks published) so remote participants' camera/mic streams
   * are always visible/audible — even if the local player hasn't opted in.
   * Defaults to false.
   */
  autoConnect?: boolean;
  /**
   * Optional alert callback. When provided, user-facing alerts (permission denied,
   * connect failure) are routed through this instead of native Alert.alert.
   * Game screens should pass `showInGameAlert` so alerts render via InGameAlert
   * (respecting orientation locks on iOS).
   */
  onAlert?: (options: {
    title: string;
    message: string;
    buttons?: {
      text: string;
      style?: 'cancel' | 'default' | 'destructive';
      onPress?: () => void;
    }[];
  }) => void;
}

export interface UseVideoChatReturn {
  /**
   * True when the chat room session is connected (video + mic, OR voice-only).
   * Use `isLocalCameraOn` to distinguish: `isChatConnected && isLocalCameraOn`
   * means the camera is streaming; `isChatConnected && !isLocalCameraOn` means
   * voice-only (microphone only). This was formerly called `videoChatEnabled`.
   */
  isChatConnected: boolean;
  /**
   * Whether the session is connected with the camera off (voice-only mode).
   * Derived: `isChatConnected && isLocalMicOn && !isLocalCameraOn`.
   * True whenever the session is connected, the mic is unmuted, and the camera
   * is NOT streaming. False in listener mode (mic muted) even though the session
   * is connected — callers should check `isChatConnected` for session presence.
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
   * Toggle the local camera on/off while a chat session is already connected.
   * No-op when `isChatConnected` is false. Call `toggleVideoChat` to join the
   * video session; use `toggleCamera` only to control the camera track within
   * an active session.
   */
  toggleCamera: () => Promise<void>;
  /**
   * True while `toggleVideoChat` is executing an async enable/disable sequence
   * (camera + mic connect/disconnect). Use to disable the Video button and show
   * a spinner. Does NOT cover `toggleVoiceChat` — see `isAudioConnecting`.
   */
  isConnecting: boolean;
  /**
   * True while `toggleVoiceChat` is executing an async enable/disable sequence
   * (mic-only connect/disconnect). Separate from `isConnecting` so only the
   * Audio button shows a spinner when voice is toggling, without disabling the
   * Video button at the same time.
   */
  isAudioConnecting: boolean;
  /** Toggle local microphone mute/unmute while video or voice chat is active. */
  toggleMic: () => Promise<void>;
  /** Explicitly request camera permission (e.g. from a settings screen). */
  requestCameraPermission: () => Promise<MediaPermissionStatus>;
  /** Explicitly request microphone permission (e.g. from a settings screen). */
  requestMicPermission: () => Promise<MediaPermissionStatus>;
  /**
   * Returns a LiveKit-compatible TrackReference for the given participant's
   * camera track. Pass to `<VideoTrack trackRef={...} />` from `@livekit/react-native`.
   * `'__local__'` returns the local participant's camera track reference.
   * Returns `undefined` when the adapter doesn't support video rendering
   * (e.g. StubVideoChatAdapter in Expo Go), or when the participant has no
   * active camera publication.
   * Note: `remoteParticipants` state drives re-renders when track state changes;
   * call this during render to get fresh track references on each update.
   */
  getVideoTrackRef: (participantId: string | '__local__') => LiveKitTrackRef | undefined;
}

export function useVideoChat({
  roomId,
  userId,
  adapter: adapterProp,
  autoConnect = false,
  onAlert,
}: UseVideoChatOptions): UseVideoChatReturn {
  // Stable ref for the onAlert callback so effects/callbacks always see the latest.
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  /** Show an alert via onAlert (InGameAlert) when provided, else native Alert.alert. */
  const showAlert = useCallback(
    (
      title: string,
      message: string,
      buttons?: {
        text: string;
        style?: 'cancel' | 'default' | 'destructive';
        onPress?: () => void;
      }[]
    ) => {
      if (onAlertRef.current) {
        onAlertRef.current({ title, message, buttons });
      } else {
        Alert.alert(title, message, buttons);
      }
    },
    []
  );

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

  const [isChatConnected, setIsChatConnected] = useState(false);
  const [isLocalCameraOn, setIsLocalCameraOn] = useState(false);
  const [isLocalMicOn, setIsLocalMicOn] = useState(false);
  const [cameraPermissionStatus, setCameraPermissionStatus] =
    useState<MediaPermissionStatus>('undetermined');
  const [micPermissionStatus, setMicPermissionStatus] =
    useState<MediaPermissionStatus>('undetermined');
  const [remoteParticipants, setRemoteParticipants] = useState<VideoChatParticipant[]>([]);
  // Separate connecting states for video (camera+session) and audio (mic-only).
  // Splitting lets the UI show a spinner only on the button that is in-flight
  // rather than on both simultaneously.
  const [isConnecting, setIsConnecting] = useState(false); // video/session toggle
  const [isAudioConnecting, setIsAudioConnecting] = useState(false); // voice-only toggle
  // Ref companion: used to short-circuit re-entrant calls before setState
  // triggers a re-render (ref reads are synchronous, state reads are not).
  const isTogglingRef = useRef(false);

  // ── Persist desired mic / camera state per room (Task: remember on reconnect) ──
  // When camera/mic is toggled on, persist `{ camera: true, mic: true }` to
  // AsyncStorage keyed by roomId. On component remount (e.g. leaving and
  // returning to a game screen), read the stored prefs and auto-enable.
  const chatPrefsKey = roomId ? `@big2_chat_prefs_${roomId}` : null;
  const desiredCameraRef = useRef(false);
  const desiredMicRef = useRef(false);
  const hasRestoredPrefsRef = useRef(false);
  const hasAutoConnectedRef = useRef(false);

  /** Persist desired camera/mic state to AsyncStorage. */
  const persistChatPrefs = useCallback(
    (camera: boolean, mic: boolean) => {
      if (!chatPrefsKey) return;
      if (!camera && !mic) {
        // Both off: remove the key entirely so stale prefs don't accumulate.
        AsyncStorage.removeItem(chatPrefsKey).catch(() => {});
      } else {
        AsyncStorage.setItem(chatPrefsKey, JSON.stringify({ camera, mic })).catch(() => {});
      }
    },
    [chatPrefsKey]
  );

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
    if (isChatConnected) {
      prevAdapter.disableCamera().catch(() => {});
      prevAdapter.disableMicrophone().catch(() => {});
      prevAdapter.disconnect().catch(() => {});
      setIsChatConnected(false);
      setIsLocalCameraOn(false);
      setIsLocalMicOn(false);
      setRemoteParticipants([]);
    }
    // Reset one-time guards so auto-restore/autoConnect can re-run with the new adapter.
    hasRestoredPrefsRef.current = false;
    hasAutoConnectedRef.current = false;
    setRestoreFinished(false);
    desiredCameraRef.current = false;
    desiredMicRef.current = false;
  }, [adapterProp, isChatConnected]);

  // Subscribe to remote participant changes while video chat is active.
  // adapterProp is included so the effect re-runs (and re-subscribes) if the
  // adapter is hot-swapped — the old adapter is unsubscribed via the cleanup
  // return before the new subscription is opened.
  useEffect(() => {
    if (!isChatConnected) return;
    const unsubscribe = adapterRef.current.onParticipantsChanged(setRemoteParticipants);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChatConnected, adapterProp]);

  // Subscribe to SDK errors. Disconnect errors (emitted by LiveKitVideoChat-
  // Adapter on RoomEvent.Disconnected) are treated as fatal: reset all local
  // and remote chat state so the UI never sticks in a "connected" state after
  // an unexpected network drop or server-side kick.
  useEffect(() => {
    if (!isChatConnected) return;
    const unsubscribe = adapterRef.current.onError((err: Error) => {
      gameLogger.warn('[VideoChat] SDK error:', err.message);
      // Treat disconnect errors as fatal — reset the full session state so the
      // UI reflects the true "disconnected" state even without an explicit
      // toggleVideoChat() call.
      if (err instanceof UnexpectedDisconnectError) {
        // Best-effort adapter teardown so hardware capture stops even if the
        // adapter itself hasn't fully cleaned up after the unexpected drop.
        adapterRef.current.disableMicrophone().catch(() => {});
        adapterRef.current.disableCamera().catch(() => {});
        adapterRef.current.disconnect().catch(() => {});
        setIsChatConnected(false);
        setIsLocalCameraOn(false);
        setIsLocalMicOn(false);
        setRemoteParticipants([]);
        gameLogger.warn('[VideoChat] Session reset after unexpected disconnect.');
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChatConnected, adapterProp]);

  // Track the previous roomId so the roomId-change effect can distinguish
  // a genuine room navigation from the initial mount.
  const prevRoomIdRef = useRef<string | undefined>(undefined);

  // State reset + teardown when roomId changes (runs in the effect BODY, not in
  // the cleanup return). This ensures setIsChatConnected / setIsLocalCameraOn /
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
      isChatConnected
    ) {
      // roomId changed mid-session — tear down the current connection and reset
      // all UI state so the tile/toggle never shows "enabled" for the new room.
      adapterRef.current.disableMicrophone().catch(() => {});
      adapterRef.current.disableCamera().catch(() => {});
      adapterRef.current.disconnect().catch(() => {});
      setIsChatConnected(false);
      setIsLocalCameraOn(false);
      setIsLocalMicOn(false);
      setRemoteParticipants([]);
      // Reset one-time guards so auto-restore/autoConnect can re-run for the new room.
      hasRestoredPrefsRef.current = false;
      hasAutoConnectedRef.current = false;
      setRestoreFinished(false);
      desiredCameraRef.current = false;
      desiredMicRef.current = false;
    }
    prevRoomIdRef.current = roomId;
    // isChatConnected included so the effect sees the current session state when
    // roomId fires. Re-runs on isChatConnected change are harmless: the roomId
    // comparison always fails (prevRoomIdRef.current === roomId) so no teardown
    // fires — only prevRoomIdRef.current is updated (no-op, same value).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, isChatConnected]);

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

  // Tracks when the restore async IIFE has fully finished (connected + tracks enabled)
  // so the auto-connect effect below doesn't race with an in-flight restore.
  // Uses state (not ref) so the autoConnect effect re-runs when restore completes.
  const [restoreFinished, setRestoreFinished] = useState(false);

  // ── Auto-restore chat prefs on mount (Task: remember mic/camera on reconnect) ──
  // Reads stored camera/mic prefs from AsyncStorage and auto-enables media when
  // the player returns to a room where they previously had chat active.
  useEffect(() => {
    if (!chatPrefsKey || !roomId || !userId || hasRestoredPrefsRef.current) return;
    // Mark as attempted immediately to avoid duplicate runs.
    hasRestoredPrefsRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(chatPrefsKey);
        if (!stored || cancelled) {
          if (!cancelled) setRestoreFinished(true);
          return;
        }
        const prefs = JSON.parse(stored) as { camera?: boolean; mic?: boolean };
        if (!prefs.camera && !prefs.mic) {
          if (!cancelled) setRestoreFinished(true);
          return;
        }

        desiredCameraRef.current = false;
        desiredMicRef.current = false;

        gameLogger.info(
          '[VideoChat] Restoring chat prefs — camera:',
          prefs.camera,
          'mic:',
          prefs.mic
        );

        // Connect to the room and re-enable the tracks the player had on.
        await adapterRef.current.connect(roomId, userId);
        if (cancelled) return;

        if (prefs.camera) {
          try {
            await adapterRef.current.enableCamera();
            if (!cancelled) {
              desiredCameraRef.current = true;
              setIsLocalCameraOn(true);
              setCameraPermissionStatus('granted');
            }
          } catch (err) {
            gameLogger.warn(
              '[VideoChat] Auto-restore camera failed:',
              err instanceof Error ? err.message : String(err)
            );
          }
        }
        if (prefs.mic) {
          try {
            await adapterRef.current.enableMicrophone();
            if (!cancelled) {
              desiredMicRef.current = true;
              setIsLocalMicOn(true);
              setMicPermissionStatus('granted');
            }
          } catch (err) {
            gameLogger.warn(
              '[VideoChat] Auto-restore mic failed:',
              err instanceof Error ? err.message : String(err)
            );
          }
        }
        if (!cancelled) {
          // Persist actual restored state so stale prefs don't accumulate from
          // partially successful restores (e.g. camera denied but mic OK).
          persistChatPrefs(desiredCameraRef.current, desiredMicRef.current);
          setRemoteParticipants(adapterRef.current.getParticipants());
          setIsChatConnected(true);
          gameLogger.info('[VideoChat] Chat prefs restored successfully.');
        }
      } catch (err) {
        gameLogger.warn(
          '[VideoChat] Auto-restore chat prefs failed:',
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        if (!cancelled) {
          setRestoreFinished(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally only depend on the stable key + identifiers to run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatPrefsKey, roomId, userId]);

  // ── Auto-connect as listener (Task: other players see/hear video/mic) ────
  // When autoConnect=true, connect to the room in receive-only mode (no local
  // tracks) so remote participants' streams are always visible/audible — even
  // if the local player hasn't opted in to publish their own camera/mic.
  // Skipped when the auto-restore effect above already connected with stored
  // prefs (hasRestoredPrefsRef + isChatConnected guard).
  // Retry key: incremented on transient failure (after a delay) so the effect
  // re-runs even when no other deps change.
  const [autoConnectRetryKey, setAutoConnectRetryKey] = useState(0);
  useEffect(() => {
    if (!autoConnect || !roomId || !userId || hasAutoConnectedRef.current) return;
    // Wait for restore async IIFE to finish before deciding — prevents duplicate
    // connect() calls when restore is still in-flight.
    if (!restoreFinished) return;
    // If restore already connected us, skip.
    if (isChatConnected) {
      hasAutoConnectedRef.current = true;
      return;
    }
    let cancelled = false;
    let retryCleanup: (() => void) | undefined;

    (async () => {
      try {
        gameLogger.info('[VideoChat] Auto-connecting as listener (receive-only)...');
        await adapterRef.current.connect(roomId, userId);
        if (cancelled) return;
        // Only mark auto-connect done after a successful connect so transient
        // failures or adapter swaps allow a retry on the next effect run.
        hasAutoConnectedRef.current = true;
        setRemoteParticipants(adapterRef.current.getParticipants());
        setIsChatConnected(true);
        gameLogger.info('[VideoChat] Auto-connected as listener — remote streams active.');
      } catch (err) {
        gameLogger.warn(
          '[VideoChat] Auto-connect failed (non-fatal):',
          err instanceof Error ? err.message : String(err)
        );
        // Schedule a retry after 3 s so the effect re-runs via the retryKey dep.
        if (!cancelled) {
          const retryTimer = setTimeout(() => {
            if (!cancelled) setAutoConnectRetryKey(k => k + 1);
          }, 3000);
          retryCleanup = () => clearTimeout(retryTimer);
        }
      }
    })();

    return () => {
      cancelled = true;
      retryCleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, roomId, userId, isChatConnected, restoreFinished, autoConnectRetryKey]);

  const requestCameraPermission = useCallback(async (): Promise<MediaPermissionStatus> => {
    if (Platform.OS === 'android') {
      try {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
          title: i18n.t('chat.cameraPermissionTitle'),
          message: i18n.t('chat.cameraPermissionMessage'),
          buttonPositive: i18n.t('common.ok'),
        });
        const status: MediaPermissionStatus =
          result === PermissionsAndroid.RESULTS.GRANTED
            ? 'granted'
            : result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
              ? 'restricted'
              : 'denied';
        setCameraPermissionStatus(status);
        return status;
      } catch {
        setCameraPermissionStatus('denied');
        return 'denied';
      }
    }

    if (Platform.OS === 'ios') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Camera } = require('expo-camera') as typeof import('expo-camera');
        const existing = await Camera.getCameraPermissionsAsync();
        if (existing.status === 'granted') {
          setCameraPermissionStatus('granted');
          return 'granted';
        }
        // iOS: if the user permanently denied and canAskAgain is false, the OS
        // will never re-prompt — treat as 'restricted' so callers skip re-requesting.
        if (existing.status === 'denied' && !existing.canAskAgain) {
          setCameraPermissionStatus('restricted');
          return 'restricted';
        }
        // 'undetermined' or 'denied' with canAskAgain: true — call the request
        // API. On iOS this triggers the OS dialog if the user hasn't been asked
        // yet; if they've already responded, the OS returns the stored status
        // immediately without re-prompting.
        const result = await Camera.requestCameraPermissionsAsync();
        const mapped: MediaPermissionStatus =
          result.status === 'granted' ? 'granted' : !result.canAskAgain ? 'restricted' : 'denied';
        setCameraPermissionStatus(mapped);
        return mapped;
      } catch {
        // expo-camera native module is not linked in this dev-client build
        // (the binary was compiled before expo-camera was added to the project).
        // Fall back to @livekit/react-native-webrtc's Permissions API, which IS
        // always linked because the audio chat depends on it.  Functionally
        // equivalent: query() calls AVCaptureDevice.authorizationStatus and
        // request() calls AVCaptureDevice.requestAccess — no extra native module
        // needed, and the iOS Settings entry for Camera is registered via the
        // Info.plist NSCameraUsageDescription key in app.json rather than by the
        // expo-camera plugin.
        try {
          /* eslint-disable @typescript-eslint/no-require-imports */
          const { permissions: webRTCPerms, mediaDevices: webRTCDevices } =
            require('@livekit/react-native-webrtc') as {
              permissions: { query(d: { name: string }): Promise<string> };
              mediaDevices: {
                getUserMedia(c: object): Promise<{ getTracks(): { stop(): void }[] }>;
              };
            };
          /* eslint-enable @typescript-eslint/no-require-imports */
          const current = await webRTCPerms.query({ name: 'camera' });
          if (current === 'granted') {
            setCameraPermissionStatus('granted');
            return 'granted';
          }
          if (current === 'denied') {
            // iOS: already denied — OS will not re-show the dialog
            // (canAskAgain is false after first denial). Treat as 'restricted'
            // so callers show the "open Settings" prompt.
            setCameraPermissionStatus('restricted');
            return 'restricted';
          }
          // 'prompt' — trigger the iOS system permission dialog via getUserMedia.
          // getUserMedia internally calls AVCaptureDevice.requestAccess which is
          // the same mechanism that expo-camera uses.
          const stream = await webRTCDevices.getUserMedia({ video: true, audio: false });
          stream.getTracks().forEach(t => t.stop()); // release tracks — only needed permission
          setCameraPermissionStatus('granted');
          return 'granted';
        } catch {
          setCameraPermissionStatus('denied');
          return 'denied';
        }
      }
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
            title: i18n.t('chat.micPermissionTitle'),
            message: i18n.t('chat.micPermissionMessage'),
            buttonPositive: i18n.t('common.ok'),
          }
        );
        const status: MediaPermissionStatus =
          result === PermissionsAndroid.RESULTS.GRANTED
            ? 'granted'
            : result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
              ? 'restricted'
              : 'denied';
        setMicPermissionStatus(status);
        return status;
      } catch {
        setMicPermissionStatus('denied');
        return 'denied';
      }
    }

    if (Platform.OS === 'ios') {
      try {
        const existing = await Audio.getPermissionsAsync();
        if (existing.status === 'granted') {
          setMicPermissionStatus('granted');
          return 'granted';
        }
        // iOS: if the user permanently denied and canAskAgain is false, the OS
        // will never re-prompt — treat as 'restricted' so callers skip re-requesting.
        if (existing.status === 'denied' && !existing.canAskAgain) {
          setMicPermissionStatus('restricted');
          return 'restricted';
        }
        // 'undetermined' or 'denied' with canAskAgain: true — call the request
        // API. On iOS this triggers the OS dialog if the user hasn't been asked
        // yet; if they've already responded, the OS returns the stored status
        // immediately without re-prompting.
        const result = await Audio.requestPermissionsAsync();
        const mapped: MediaPermissionStatus =
          result.status === 'granted' ? 'granted' : !result.canAskAgain ? 'restricted' : 'denied';
        setMicPermissionStatus(mapped);
        return mapped;
      } catch {
        setMicPermissionStatus('denied');
        return 'denied';
      }
    }

    // Unsupported platform (e.g. web) — mic capture not supported.
    return 'restricted';
  }, []);

  /**
   * Show a user-facing alert explaining why camera or microphone access was
   * denied and offering a one-tap "Open Settings" deep-link so they can
   * grant the permission without restarting the app.
   *
   * @param permissionType - 'camera' or 'mic'
   */
  const showPermissionDeniedAlert = useCallback(
    (permissionType: 'camera' | 'mic') => {
      // Video chat requires native APIs (camera/mic/settings deep-link) that are
      // unavailable on web. Permission requests are blocked at the request layer
      // for non-native platforms, so this alert should never fire there — guard
      // anyway to prevent a misleading "open Settings" message and an unimplemented
      // Linking.openSettings() call on web.
      if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
      const isCamera = permissionType === 'camera';
      showAlert(
        isCamera
          ? i18n.t('chat.permissionDeniedCameraTitle')
          : i18n.t('chat.permissionDeniedMicTitle'),
        isCamera
          ? i18n.t('chat.permissionDeniedCameraMessage')
          : i18n.t('chat.permissionDeniedMicMessage'),
        [
          { text: i18n.t('common.cancel'), style: 'cancel' },
          {
            text: i18n.t('chat.openSettings'),
            // Attach .catch() to handle the rare case where the Settings app
            // is unavailable (e.g. deep-link restricted by MDM) without leaving
            // an unhandled promise rejection.
            onPress: () => {
              Linking.openSettings().catch(() => {});
            },
          },
        ]
      );
    },
    [showAlert]
  );

  const toggleVideoChat = useCallback(async (): Promise<void> => {
    // Re-entrant guard: if a previous toggle is still executing (e.g. waiting
    // for connect() or permission dialogs), ignore this call. Use both a ref
    // (synchronous, checked before any await) and state (triggers re-render so
    // the tile can show a spinner and be disabled).
    if (isTogglingRef.current) return;
    isTogglingRef.current = true;
    setIsConnecting(true);
    try {
      if (!isChatConnected) {
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
          showPermissionDeniedAlert('camera');
          return;
        }
        // Request mic permission only after camera is confirmed granted.
        // Re-request on 'denied' for the same UX reason as camera.
        let micPermission = micPermissionStatus;
        if (micPermission === 'undetermined' || micPermission === 'denied') {
          micPermission = await requestMicPermission();
        }
        // Block video chat when mic permission is denied — both camera and mic
        // are required to start a video+audio session.
        if (micPermission !== 'granted') {
          gameLogger.info('[VideoChat] Mic permission not granted — video chat blocked.');
          showPermissionDeniedAlert('mic');
          return;
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
          setIsChatConnected(true);
          setIsLocalCameraOn(true);
          desiredCameraRef.current = true;
          desiredMicRef.current = micEnabled;
          persistChatPrefs(true, micEnabled);
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
          gameLogger.warn(
            '[VideoChat] Failed to enable video chat:',
            err instanceof Error ? err.message : String(err)
          );
          adapterRef.current.disableMicrophone().catch(() => {});
          adapterRef.current.disableCamera().catch(() => {});
          adapterRef.current.disconnect().catch(() => {});
          // Reset all local/remote state to mirror the opt-out path — ensures
          // the UI cannot remain in a partially-enabled state after a failure.
          setIsChatConnected(false);
          setIsLocalCameraOn(false);
          setIsLocalMicOn(false);
          setRemoteParticipants([]);
          // Alert the user so the toggle reverting to off is not silent/confusing.
          if (Platform.OS === 'ios' || Platform.OS === 'android') {
            showAlert(i18n.t('chat.connectFailedTitle'), i18n.t('chat.connectFailedMessage'));
          }
        }
      } else if (!isLocalCameraOn) {
        // ── Upgrade: voice-only → video — enable camera without disconnecting ──
        // The user is already connected (audio-only or listener). Pressing
        // "join video chat" should enable the camera track (+ mic if not on)
        // rather than tearing down the session and re-connecting, which would
        // create a noticeable audio gap for other players.
        let camPermission = cameraPermissionStatus;
        if (camPermission === 'undetermined' || camPermission === 'denied') {
          camPermission = await requestCameraPermission();
        }
        if (camPermission !== 'granted') {
          gameLogger.info(
            '[VideoChat] Camera permission not granted — voice→video upgrade blocked.'
          );
          showPermissionDeniedAlert('camera');
          return;
        }
        try {
          await adapterRef.current.enableCamera();
          setIsLocalCameraOn(true);
          desiredCameraRef.current = true;

          // Also enable mic if not already on (covers listener→video upgrade).
          if (!isLocalMicOn) {
            let micPerm = micPermissionStatus;
            if (micPerm === 'undetermined' || micPerm === 'denied') {
              micPerm = await requestMicPermission();
            }
            if (micPerm === 'granted') {
              try {
                await adapterRef.current.enableMicrophone();
                setIsLocalMicOn(true);
                desiredMicRef.current = true;
              } catch (micErr) {
                gameLogger.warn(
                  '[VideoChat] Mic enable failed during upgrade (non-fatal):',
                  micErr instanceof Error ? micErr.message : String(micErr)
                );
              }
            }
          }

          persistChatPrefs(true, desiredMicRef.current);
          gameLogger.info('[VideoChat] Camera enabled — upgraded to full video chat.');
        } catch (err) {
          gameLogger.warn(
            '[VideoChat] Camera enable failed during upgrade:',
            err instanceof Error ? err.message : String(err)
          );
        }
      } else {
        // ── Opt-out path — camera is on, disable local tracks ────────────────
        await adapterRef.current.disableMicrophone().catch(() => {});
        await adapterRef.current.disableCamera().catch(() => {});
        setIsLocalCameraOn(false);
        setIsLocalMicOn(false);
        desiredCameraRef.current = false;
        desiredMicRef.current = false;
        persistChatPrefs(false, false);
        if (autoConnect) {
          // Keep the room connection alive so remote streams remain visible/audible.
          gameLogger.info('[VideoChat] Local tracks disabled — staying connected as listener.');
        } else {
          await adapterRef.current.disconnect().catch(() => {});
          setIsChatConnected(false);
          setRemoteParticipants([]);
          gameLogger.info('[VideoChat] Local camera + mic disabled — disconnected.');
        }
      }
    } finally {
      // Always clear the in-flight guard — even if an error escapes or an early
      // return fires (try/finally guarantees execution).
      isTogglingRef.current = false;
      setIsConnecting(false);
    }
  }, [
    roomId,
    userId,
    isChatConnected,
    isLocalCameraOn,
    isLocalMicOn,
    autoConnect,
    cameraPermissionStatus,
    micPermissionStatus,
    requestCameraPermission,
    requestMicPermission,
    showPermissionDeniedAlert,
    persistChatPrefs,
  ]);

  const toggleMic = useCallback(async (): Promise<void> => {
    if (!isChatConnected) return;
    if (isLocalMicOn) {
      await adapterRef.current.disableMicrophone().catch(() => {});
      setIsLocalMicOn(false);
      desiredMicRef.current = false;
      persistChatPrefs(desiredCameraRef.current, false);
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
        showPermissionDeniedAlert('mic');
        return;
      }
      try {
        await adapterRef.current.enableMicrophone();
        setIsLocalMicOn(true);
        desiredMicRef.current = true;
        persistChatPrefs(desiredCameraRef.current, true);
        gameLogger.info('[VideoChat] Microphone unmuted.');
      } catch (err) {
        gameLogger.warn(
          '[VideoChat] Failed to enable microphone:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }, [
    isChatConnected,
    isLocalMicOn,
    micPermissionStatus,
    requestMicPermission,
    showPermissionDeniedAlert,
    persistChatPrefs,
  ]);

  /**
   * Toggle voice-only chat (audio only — no camera).
   *
   * - If a full video chat session is already active, this is a no-op: use
   *   `toggleVideoChat()` to opt out instead (prevents confusing half-teardowns).
   * - If voice chat is already active (`isChatConnected && !isLocalCameraOn`),
   *   this disconnects the session.
   * - Otherwise, requests mic permission, connects to the room, and enables the
   *   microphone. Camera is never touched.
   */
  const toggleVoiceChat = useCallback(async (): Promise<void> => {
    if (isTogglingRef.current) return;

    // If video chat (camera on) is already active, ignore — user must use
    // toggleVideoChat to manage that session.
    if (isChatConnected && isLocalCameraOn) return;

    isTogglingRef.current = true;
    setIsAudioConnecting(true);
    try {
      if (!isChatConnected) {
        // ── Opt-in (voice only — not yet connected) ────────────────────────
        if (!roomId || !userId) return;

        let micPermission = micPermissionStatus;
        if (micPermission === 'undetermined' || micPermission === 'denied') {
          micPermission = await requestMicPermission();
        }
        if (micPermission !== 'granted') {
          gameLogger.info('[VoiceChat] Mic permission not granted — voice chat blocked.');
          showPermissionDeniedAlert('mic');
          return;
        }

        try {
          await adapterRef.current.connect(roomId, userId);
          await adapterRef.current.enableMicrophone();
          setRemoteParticipants(adapterRef.current.getParticipants());
          setIsChatConnected(true);
          // isLocalCameraOn remains false — this is the voice-only indicator.
          setIsLocalMicOn(true);
          desiredMicRef.current = true;
          persistChatPrefs(false, true);
          gameLogger.info('[VoiceChat] Mic enabled (audio-only mode).');
        } catch (err) {
          gameLogger.warn(
            '[VoiceChat] Failed to enable voice chat:',
            err instanceof Error ? err.message : String(err)
          );
          adapterRef.current.disableMicrophone().catch(() => {});
          adapterRef.current.disconnect().catch(() => {});
          setIsChatConnected(false);
          setIsLocalMicOn(false);
          setRemoteParticipants([]);
          // Alert the user so the toggle reverting to off is not silent/confusing.
          if (Platform.OS === 'ios' || Platform.OS === 'android') {
            showAlert(
              i18n.t('chat.voiceConnectFailedTitle'),
              i18n.t('chat.voiceConnectFailedMessage')
            );
          }
        }
      } else if (!isLocalMicOn) {
        // ── Upgrade: listener → voice-only (already connected, enable mic) ──
        let micPermission = micPermissionStatus;
        if (micPermission === 'undetermined' || micPermission === 'denied') {
          micPermission = await requestMicPermission();
        }
        if (micPermission !== 'granted') {
          gameLogger.info('[VoiceChat] Mic permission not granted — voice upgrade blocked.');
          showPermissionDeniedAlert('mic');
          return;
        }
        try {
          await adapterRef.current.enableMicrophone();
          setIsLocalMicOn(true);
          desiredMicRef.current = true;
          persistChatPrefs(desiredCameraRef.current, true);
          gameLogger.info('[VoiceChat] Mic enabled — upgraded from listener to voice.');
        } catch (err) {
          gameLogger.warn(
            '[VoiceChat] Mic enable failed during listener→voice upgrade:',
            err instanceof Error ? err.message : String(err)
          );
        }
      } else {
        // ── Opt-out (voice was on, camera was off) ─────────────────────────
        await adapterRef.current.disableMicrophone().catch(() => {});
        setIsLocalMicOn(false);
        desiredCameraRef.current = false;
        desiredMicRef.current = false;
        persistChatPrefs(false, false);
        if (autoConnect) {
          // Keep connected as listener so remote streams remain visible/audible.
          gameLogger.info('[VoiceChat] Mic disabled — staying connected as listener.');
        } else {
          await adapterRef.current.disconnect().catch(() => {});
          setIsChatConnected(false);
          setRemoteParticipants([]);
          gameLogger.info('[VoiceChat] Voice chat disconnected.');
        }
      }
    } finally {
      isTogglingRef.current = false;
      setIsAudioConnecting(false);
    }
  }, [
    roomId,
    userId,
    isChatConnected,
    isLocalCameraOn,
    isLocalMicOn,
    autoConnect,
    micPermissionStatus,
    requestMicPermission,
    showPermissionDeniedAlert,
    persistChatPrefs,
  ]);

  // voiceChatEnabled is a derived value: connected, mic on, and camera off.
  // In listener mode (autoConnect, no local tracks), this is correctly false.
  const voiceChatEnabled = isChatConnected && isLocalMicOn && !isLocalCameraOn;

  /**
   * Returns the LiveKit TrackReference for a participant's camera track.
   * Delegates to `adapter.getVideoTrackRef?.()` — returns undefined for the
   * stub adapter (Expo Go / pre-prebuild) and for participants without an
   * active camera publication.
   *
   * Calling this function during render (not in a side-effect) ensures the
   * returned reference is always fresh: `remoteParticipants` state drives
   * re-renders when track state changes.
   */
  const getVideoTrackRef = useCallback(
    (participantId: string | '__local__'): LiveKitTrackRef | undefined =>
      adapterRef.current.getVideoTrackRef?.(participantId),
    // adapterProp in deps so the callback is recreated when the adapter is
    // hot-swapped (e.g. real adapter injected after Expo Go guard fires).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapterProp]
  );

  /**
   * Must only be called while `isChatConnected` is true; no-op otherwise.
   * This is independent from `toggleVideoChat` (which connects/disconnects the
   * entire room session) and separate from `toggleVoiceChat`.
   */
  const toggleCamera = useCallback(async (): Promise<void> => {
    if (!isChatConnected) return;
    try {
      if (isLocalCameraOn) {
        await adapterRef.current.disableCamera();
        setIsLocalCameraOn(false);
        desiredCameraRef.current = false;
        persistChatPrefs(false, desiredMicRef.current);
        gameLogger.info('[VideoChat] Camera disabled (session remains active).');
      } else {
        let camPermission = cameraPermissionStatus;
        if (camPermission === 'undetermined' || camPermission === 'denied') {
          camPermission = await requestCameraPermission();
        }
        if (camPermission !== 'granted') {
          gameLogger.info('[VideoChat] Camera permission not granted — camera toggle blocked.');
          showPermissionDeniedAlert('camera');
          return;
        }
        await adapterRef.current.enableCamera();
        setIsLocalCameraOn(true);
        desiredCameraRef.current = true;
        persistChatPrefs(true, desiredMicRef.current);
        gameLogger.info('[VideoChat] Camera enabled (session already active).');
      }
    } catch (err) {
      gameLogger.warn(
        '[VideoChat] Camera toggle failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }, [
    isChatConnected,
    isLocalCameraOn,
    cameraPermissionStatus,
    requestCameraPermission,
    showPermissionDeniedAlert,
    persistChatPrefs,
  ]);

  return {
    isChatConnected,
    voiceChatEnabled,
    isLocalCameraOn,
    isLocalMicOn,
    isConnecting,
    isAudioConnecting,
    cameraPermissionStatus,
    micPermissionStatus,
    remoteParticipants,
    toggleVideoChat,
    toggleVoiceChat,
    toggleCamera,
    toggleMic,
    requestCameraPermission,
    requestMicPermission,
    getVideoTrackRef,
  };
}
