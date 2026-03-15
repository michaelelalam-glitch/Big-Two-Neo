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
 *   via CocoaPods / Gradle auto-link. No Expo plugin entry in app.json is
 *   required for @livekit/react-native-webrtc — auto-linking handles it entirely.
 *   (The PR description that previously claimed a plugin entry was needed was
 *   incorrect; the current app.json does not include it and native builds work.)
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
import type { VideoChatAdapter, VideoChatParticipant } from './useVideoChat';

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
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _registerGlobals = (require('@livekit/react-native') as { registerGlobals: () => void }).registerGlobals;
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
  private participantsChangedCbs: Array<(participants: VideoChatParticipant[]) => void> = [];
  private errorCbs: Array<(error: Error) => void> = [];

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

    gameLogger.info(`[LiveKit] Connecting participant ${participantId} to room ${roomId}`);
    await this.room.connect(data.livekitUrl, data.token);
    gameLogger.info('[LiveKit] Connected.');
  }

  async disconnect(): Promise<void> {
    await this.room.disconnect();
    gameLogger.info('[LiveKit] Disconnected.');
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

  // ── Internal event wiring ─────────────────────────────────────────────────

  private _notifyParticipants(): void {
    const snapshot = snapshotParticipants(this.room);
    for (const cb of this.participantsChangedCbs) {
      cb(snapshot);
    }
  }

  private _notifyError(err: Error): void {
    for (const cb of this.errorCbs) {
      cb(err);
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
      .on(RoomEvent.Disconnected, (reason) => {
        this._notifyParticipants(); // Clear remote participants on disconnect
        // Only surface unexpected disconnects (network drop, server kick, etc.).
        // CLIENT_INITIATED means adapter.disconnect() was called intentionally —
        // do NOT treat normal leave flows as errors or useVideoChat would reset
        // isChatConnected during the ordinary opt-out path.
        if (reason !== DisconnectReason.CLIENT_INITIATED) {
          this._notifyError(new Error('LiveKit disconnected unexpectedly'));
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
