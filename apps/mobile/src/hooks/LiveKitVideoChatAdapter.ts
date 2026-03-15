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
 * Install prerequisites (run once, then `expo prebuild`):
 *   pnpm add @livekit/react-native livekit-client @livekit/react-native-webrtc
 *   Add "@livekit/react-native-webrtc" to the plugins array in app.json.
 *
 * Wire in:
 *   const livekitAdapter = useMemo(() => new LiveKitVideoChatAdapter(), []);
 *   const { ... } = useVideoChat({ roomId, userId, adapter: livekitAdapter });
 */

import {
  Room,
  RoomEvent,
  Track,
  TrackPublication,
  Participant,
  RemoteParticipant,
  ConnectionState,
  RoomOptions,
} from 'livekit-client';
import { registerGlobals } from '@livekit/react-native';
import { supabase } from '../services/supabase';
import { gameLogger } from '../utils/logger';
import type { VideoChatAdapter, VideoChatParticipant } from './useVideoChat';

// Register LiveKit's custom WebRTC globals once per JS runtime.
// @livekit/react-native guards against multiple calls internally.
try {
  registerGlobals();
} catch (e) {
  gameLogger.warn('[LiveKit] registerGlobals() failed (non-fatal):', String(e));
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function participantToState(p: RemoteParticipant): VideoChatParticipant {
  const cameraPublication = p.getTrackPublication(Track.Source.Camera);
  const micPublication    = p.getTrackPublication(Track.Source.Microphone);

  return {
    participantId: p.identity,
    isCameraOn:    cameraPublication?.isEnabled === true && cameraPublication?.isSubscribed === true,
    isMicOn:       micPublication?.isEnabled    === true && micPublication?.isSubscribed    === true,
    isConnecting:  p.connectionQuality === 'unknown' ||
                   !cameraPublication || !micPublication,
  };
}

function snapshotParticipants(room: Room): VideoChatParticipant[] {
  return Array.from(room.remoteParticipants.values()).map(participantToState);
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast:       true,
  // Audio defaults — let LiveKit handle echo cancellation and noise suppression.
  audioCaptureDefaults: {
    echoCancellation:    true,
    noiseSuppression:    true,
    autoGainControl:     true,
  },
};

export class LiveKitVideoChatAdapter implements VideoChatAdapter {
  private room: Room;
  private livekitUrl = '';
  private participantsChangedCbs: Array<(participants: VideoChatParticipant[]) => void> = [];
  private errorCbs: Array<(error: Error) => void> = [];

  constructor() {
    this.room = new Room(ROOM_OPTIONS);
    this._attachRoomEvents();
  }

  // ── VideoChatAdapter contract ─────────────────────────────────────────────

  async connect(roomId: string, participantId: string): Promise<void> {
    // Fetch a fresh token from our Supabase Edge Function.
    const { data, error } = await supabase.functions.invoke<{
      token: string;
      livekitUrl: string;
    }>('get-livekit-token', {
      body: { roomId },
    });

    if (error || !data?.token || !data?.livekitUrl) {
      throw new Error(
        error instanceof Error
          ? `LiveKit token fetch failed: ${error.message}`
          : 'LiveKit token fetch failed: unknown error',
      );
    }

    this.livekitUrl = data.livekitUrl;
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
      .on(RoomEvent.Disconnected, () => {
        this._notifyParticipants(); // Clear remote participants on disconnect
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
