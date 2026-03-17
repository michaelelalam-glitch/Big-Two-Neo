/**
 * LiveKitVideoChatAdapter — Real LiveKit SFU adapter for in-game video + audio chat.
 *
 * Implements the `VideoChatAdapter` interface from `useVideoChat`, replacing the
 * `StubVideoChatAdapter` (no-op) once this adapter is injected as a prop.
 *
 * Architecture:
 *   - SFU (Selective Forwarding Unit) via LiveKit Cloud: each client publishes
 *     one stream to the server; the server forwards it to the other 3 players.
 *     This is O(1) upload vs O(N-1) for peer-to-peer — critical for battery life
 *     and mobile bandwidth.
 *   - Token is fetched from the `get-livekit-token` Supabase Edge Function on
 *     every `connect()` call (token has a 1-hour TTL; reconnect refreshes it).
 *   - Adapter pattern: the `VideoChatAdapter` interface is the only contract the
 *     rest of the app knows about. LiveKit can be swapped for Daily.co or any
 *     other SFU by implementing the same interface.
 *
 * Install prerequisites (run once, then `expo prebuild --clean`):
 *   pnpm add @livekit/react-native livekit-client @livekit/react-native-webrtc
 *   @livekit/react-native-webrtc provides native WebRTC bindings. Its Xcode
 *   framework and Gradle dependency are wired automatically by `expo prebuild`
 *   via CocoaPods / Gradle auto-link — no Expo plugin entry in app.json is
 *   needed for @livekit/react-native-webrtc; auto-linking handles it entirely.
 *
 * Expo Go compatibility (isLiveKitAvailable):
 *   `@livekit/react-native` checks its native module at initialisation and
 *   throws if it is not linked. To prevent this error from surfacing inside
 *   React's render phase (where caught errors are re-thrown in dev/Expo Go for
 *   developer visibility), the `require('@livekit/react-native')` call is made
 *   at MODULE EVALUATION TIME inside a module-level try/catch — not inside the
 *   constructor. This ensures the error is fully absorbed before React ever
 *   sees it. The exported `isLiveKitAvailable` flag lets MultiplayerGame decide
 *   whether to construct this adapter or fall back to StubVideoChatAdapter.
 *
 * Wire in:
 *   const livekitAdapter = useMemo(() => new LiveKitVideoChatAdapter(), []);
 *   const { ... } = useVideoChat({ roomId, userId, adapter: livekitAdapter });
 */

import {
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  RoomOptions,
  DisconnectReason,
} from 'livekit-client';
import { supabase } from '../services/supabase';
import { gameLogger } from '../utils/logger';
import type { VideoChatAdapter, VideoChatParticipant, LiveKitTrackRef } from './useVideoChat';
import { UnexpectedDisconnectError } from './useVideoChat';

// ---------------------------------------------------------------------------
// Expo Go / unlinked-build guard
// ---------------------------------------------------------------------------

// Try to load @livekit/react-native at module-evaluation time (inside a
// module-level try/catch). If it throws (native module not linked — Expo Go,
// pre-prebuild dev client) the error is absorbed here so that:
//   (a) the module evaluates successfully and can be safely require()'d, and
//   (b) React's renderer never sees the throw (caught errors inside useMemo
//       are re-thrown in dev mode for developer visibility — module-level
//       errors are not).
// MultiplayerGame checks `isLiveKitAvailable` before constructing this class.
let _registerGlobals: (() => void) | null = null;
let _AudioSession: { startAudioSession(): Promise<void>; stopAudioSession(): Promise<void> } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _lk = require('@livekit/react-native') as {
    registerGlobals: () => void;
    AudioSession: { startAudioSession(): Promise<void>; stopAudioSession(): Promise<void> };
  };
  _registerGlobals = _lk.registerGlobals;
  // AudioSession.startAudioSession() must be called before connecting on iOS
  // to activate AVAudioSession in playAndRecord mode; without it the OS will
  // not route audio to/from the microphone even with granted permissions.
  // On Android this is a no-op — audio focus is managed internally.
  _AudioSession = _lk.AudioSession;
} catch {
  // @livekit/react-native is not linked — Expo Go or pre-prebuild dev build.
}

/**
 * True when `@livekit/react-native` is linked and `LiveKitVideoChatAdapter`
 * can be safely instantiated. Always `false` in Expo Go.
 */
export const isLiveKitAvailable = _registerGlobals !== null;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function participantToState(p: RemoteParticipant): VideoChatParticipant {
  const cameraPublication = p.getTrackPublication(Track.Source.Camera);
  const micPublication    = p.getTrackPublication(Track.Source.Microphone);

  // Derive camera/mic state from publication *presence* and remote-mute state,
  // not from `isSubscribed`. `isSubscribed` reflects the local subscription
  // state (can be false due to adaptiveStream/dynacast or background unsubscribes)
  // even when the remote participant is actively publishing. Using mute state
  // means we correctly show "on" whenever the track exists and is not muted,
  // regardless of whether we are currently subscribed.
  return {
    participantId: p.identity,
    isCameraOn:    cameraPublication != null && !cameraPublication.isMuted,
    isMicOn:       micPublication    != null && !micPublication.isMuted,
    // isConnecting reflects connection quality only — not track presence.
    // A participant with no camera/mic publication is simply not publishing those
    // tracks (audio-only or camera-off), not "connecting". Using track absence
    // would permanently mark voice-only participants as connecting.
    isConnecting:  p.connectionQuality === 'unknown',
  };
}

function snapshotParticipants(room: Room): VideoChatParticipant[] {
  return Array.from(room.remoteParticipants.values()).map(participantToState);
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const ROOM_OPTIONS: RoomOptions = {
  // Disable adaptive stream and dynacast for a 4-player mobile card game.
  // adaptiveStream pauses video tracks when tiles are small/off-screen —
  // in a game UI, video tiles are always small, which makes adaptive stream
  // permanently pause all remote video. dynacast at a 4-player scale is
  // unnecessary overhead. Both must be off for reliable audio and video.
  adaptiveStream: false,
  dynacast: false,
  // Audio defaults — let LiveKit handle echo cancellation and noise suppression.
  audioCaptureDefaults: {
    echoCancellation:    true,
    noiseSuppression:    true,
    autoGainControl:     true,
  },
};

export class LiveKitVideoChatAdapter implements VideoChatAdapter {
  private room: Room;
  private participantsChangedCbs: ((participants: VideoChatParticipant[]) => void)[] = [];
  private errorCbs: ((error: Error) => void)[] = [];

  constructor() {
    // _registerGlobals is set at module-evaluation time (see top of file).
    // If it is null, @livekit/react-native is not linked; throw so the caller
    // (MultiplayerGame useMemo try/catch) falls back to StubVideoChatAdapter.
    if (!_registerGlobals) {
      throw new Error(
        '[LiveKit] @livekit/react-native is not linked. ' +
        'Check isLiveKitAvailable before constructing LiveKitVideoChatAdapter.',
      );
    }
    _registerGlobals();
    this.room = new Room(ROOM_OPTIONS);
    this._attachRoomEvents();
  }

  // ── VideoChatAdapter contract ─────────────────────────────────────────────

  async connect(roomId: string, participantId: string): Promise<void> {
    // Fetch a fresh token from our Supabase Edge Function.
    // `participantId` is the Supabase user UUID; the server uses it as the
    // LiveKit participant identity. Pass it as `displayName` so the Edge
    // Function prefers it over the email-prefix fallback. To show a
    // human-readable username instead, plumb the player's in-game `username`
    // through `UseVideoChatOptions` and forward it here.
    const { data, error } = await supabase.functions.invoke<{
      token: string;
      livekitUrl: string;
    }>('get-livekit-token', {
      body: { roomId, displayName: participantId },
    });

    if (error || !data?.token || !data?.livekitUrl) {
      throw new Error(
        error instanceof Error
          ? `LiveKit token fetch failed: ${error.message}`
          : 'LiveKit token fetch failed: unknown error',
      );
    }

    // iOS: activate AVAudioSession before connecting so that both the
    // microphone and the camera operate correctly on physical devices and
    // the simulator. The `iosCategoryEnforce` patch inside `registerGlobals`
    // sets the category to `playAndRecord` when getUserMedia is called, but
    // `startAudioSession` is also required to *activate* the session — without
    // it, AVAudioSession remains inactive and capture silently fails on iOS.
    if (_AudioSession) {
      try {
        await _AudioSession.startAudioSession();
      } catch (audioErr) {
        // startAudioSession itself failed — the session was never activated so
        // there is nothing to clean up.  Rethrow with a user-actionable message
        // (Copilot PR-149 r2946350450).
        throw new Error(
          `LiveKit: AVAudioSession activation failed — audio unavailable: ${
            audioErr instanceof Error ? audioErr.message : String(audioErr)
          }`,
        );
      }
    }
    gameLogger.info(`[LiveKit] Connecting participant ${participantId} to room ${roomId}`);
    try {
      await this.room.connect(data.livekitUrl, data.token);
    } catch (connectErr) {
      // connect() failed — stop the audio session we just started so it does
      // not stay active after a failed join attempt.
      if (_AudioSession) {
        await _AudioSession.stopAudioSession().catch(stopErr =>
          gameLogger.warn('[LiveKit] stopAudioSession (connect-failure cleanup) error:', stopErr instanceof Error ? stopErr.message : String(stopErr))
        );
      }
      throw connectErr;
    }
    gameLogger.info('[LiveKit] Connected.');
  }

  async disconnect(): Promise<void> {
    try {
      await this.room.disconnect();
      gameLogger.info('[LiveKit] Disconnected.');
    } finally {
      // iOS: deactivate AVAudioSession so other apps (e.g. music player) can
      // resume audio after the chat session ends. Safe to call on Android.
      // Uses try/finally so teardown happens even if disconnect() rejects.
      if (_AudioSession) {
        await _AudioSession.stopAudioSession().catch(e =>
          gameLogger.warn('[LiveKit] stopAudioSession error (ignored):', e instanceof Error ? e.message : String(e))
        );
      }
    }
  }

  async enableCamera(): Promise<void> {
    await this.room.localParticipant.setCameraEnabled(true);
    gameLogger.info('[LiveKit] Camera enabled.');
  }

  async disableCamera(): Promise<void> {
    await this.room.localParticipant.setCameraEnabled(false);
    gameLogger.info('[LiveKit] Camera disabled.');
  }

  async enableMicrophone(): Promise<void> {
    await this.room.localParticipant.setMicrophoneEnabled(true);
    gameLogger.info('[LiveKit] Microphone enabled.');
  }

  async disableMicrophone(): Promise<void> {
    await this.room.localParticipant.setMicrophoneEnabled(false);
    gameLogger.info('[LiveKit] Microphone disabled.');
  }

  getParticipants(): VideoChatParticipant[] {
    return snapshotParticipants(this.room);
  }

  onParticipantsChanged(
    cb: (participants: VideoChatParticipant[]) => void,
  ): () => void {
    this.participantsChangedCbs.push(cb);
    return () => {
      this.participantsChangedCbs = this.participantsChangedCbs.filter(fn => fn !== cb);
    };
  }

  onError(cb: (error: Error) => void): () => void {
    this.errorCbs.push(cb);
    return () => {
      this.errorCbs = this.errorCbs.filter(fn => fn !== cb);
    };
  }

  /**
   * Returns a LiveKit TrackReference for the given participant's camera track,
   * suitable for passing as `trackRef` to `<VideoTrack>` from `@livekit/react-native`.
   *
   * - `'__local__'` → local participant's camera publication
   * - any other string → remote participant matched by `identity` (= Supabase user_id)
   *
   * Returns `undefined` when:
   *   - the room is not connected (no local participant)
   *   - the participant identity is not found in the room
   *   - the participant has no camera `TrackPublication` (camera is disabled / not published)
   *
   * The `isMuted` flag is intentionally NOT checked here — callers decide whether
   * to render based on `isCameraOn` state from `remoteParticipants`; the track
   * reference is returned even when the track is muted so `<VideoTrack>` can
   * handle its own mute-state rendering gracefully.
   */
  getVideoTrackRef(participantId: string | '__local__'): LiveKitTrackRef | undefined {
    if (participantId === '__local__') {
      // Room.localParticipant is always present once the Room object is created,
      // but publications are only available after connect(). Guard with identity
      // check: an empty identity string means we are not connected yet.
      if (!this.room.localParticipant.identity) return undefined;
      const pub = this.room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (!pub) return undefined;
      return {
        participant: this.room.localParticipant,
        publication: pub,
        source: Track.Source.Camera,
      };
    }

    // Remote participant — look up by identity (= Supabase user_id)
    const remote = Array.from(this.room.remoteParticipants.values())
      .find(p => p.identity === participantId);
    if (!remote) return undefined;
    const pub = remote.getTrackPublication(Track.Source.Camera);
    if (!pub) return undefined;
    return {
      participant: remote,
      publication: pub,
      source: Track.Source.Camera,
    };
  }

  // ── Internal event wiring ─────────────────────────────────────────────────

  private _notifyParticipants(overrideSnapshot?: VideoChatParticipant[]): void {
    const snapshot = overrideSnapshot ?? snapshotParticipants(this.room);
    for (const cb of this.participantsChangedCbs) {
      try { cb(snapshot); } catch (e) {
        gameLogger.warn('[LiveKit] participantsChanged callback threw:', e instanceof Error ? e.message : String(e));
      }
    }
  }

  private _notifyError(err: Error): void {
    for (const cb of this.errorCbs) {
      try { cb(err); } catch (e) {
        gameLogger.warn('[LiveKit] error callback threw:', e instanceof Error ? e.message : String(e));
      }
    }
  }

  private _attachRoomEvents(): void {
    // Participant join / leave
    this.room
      .on(RoomEvent.ParticipantConnected,    this._handleParticipantChange)
      .on(RoomEvent.ParticipantDisconnected, this._handleParticipantChange)
      // Track publish / subscribe state changes drive isCameraOn / isMicOn
      .on(RoomEvent.TrackPublished,          this._handleParticipantChange)
      .on(RoomEvent.TrackUnpublished,        this._handleParticipantChange)
      .on(RoomEvent.TrackSubscribed,         this._handleParticipantChange)
      .on(RoomEvent.TrackUnsubscribed,       this._handleParticipantChange)
      .on(RoomEvent.TrackMuted,              this._handleParticipantChange)
      .on(RoomEvent.TrackUnmuted,            this._handleParticipantChange)
      // Connection quality changes can flip `isConnecting`
      .on(RoomEvent.ConnectionQualityChanged, this._handleParticipantChange)
      // Disconnect / reconnect
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        // Explicitly pass an empty array — room.remoteParticipants may still
        // hold stale entries during/after disconnect. Callers always see a
        // clean empty state once the room disconnects.
        this._notifyParticipants([]);
        // Only surface unexpected disconnects (network drop, server kick, etc.).
        // CLIENT_INITIATED means adapter.disconnect() was called intentionally.
        // Undefined reason (e.g. server-initiated with no code) is treated as
        // unexpected so the hook can surface it and reset state.
        if (reason !== DisconnectReason.CLIENT_INITIATED) {
          this._notifyError(new UnexpectedDisconnectError());
        }
      })
      .on(RoomEvent.MediaDevicesError, (err: Error) => {
        gameLogger.warn('[LiveKit] Media device error:', err.message);
        this._notifyError(err);
      });
  }

  // Arrow function so `this` is captured by the closure — used as event handler.
  private _handleParticipantChange = (): void => {
    this._notifyParticipants();
  };
}
