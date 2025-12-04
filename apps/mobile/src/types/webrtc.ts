/**
 * Type definitions for WebRTC video chat functionality
 */

import { MediaStream } from 'react-native-webrtc';

// WebRTC signal types for peer-to-peer negotiation
export type WebRTCSignalType = 'offer' | 'answer' | 'ice-candidate';

export interface WebRTCSignal {
  type: WebRTCSignalType;
  from: string; // user_id of sender
  to: string; // user_id of recipient
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
  timestamp: string;
}

// Peer connection states
export type PeerConnectionState = 
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

export interface PeerConnection {
  userId: string;
  username: string;
  position: number;
  connection: RTCPeerConnection;
  state: PeerConnectionState;
  stream: MediaStream | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
}

// Video chat state
export interface VideoChatState {
  localStream: MediaStream | null;
  peerConnections: Map<string, PeerConnection>;
  isInitialized: boolean;
  isCameraEnabled: boolean;
  isMicEnabled: boolean;
  facingMode: 'user' | 'environment';
  error: string | null;
}

// STUN/TURN server configuration
export interface ICEServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const DEFAULT_ICE_SERVERS: ICEServerConfig[] = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
    ],
  },
  // Add TURN servers here if needed for production
  // {
  //   urls: 'turn:your-turn-server.com:3478',
  //   username: 'username',
  //   credential: 'password',
  // },
];

// Media constraints for getUserMedia
export const DEFAULT_MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: {
    width: { ideal: 640, max: 1280 },
    height: { ideal: 480, max: 720 },
    frameRate: { ideal: 30, max: 30 },
    facingMode: 'user',
  },
};

// Hook return type
export interface UseWebRTCReturn {
  // State
  localStream: MediaStream | null;
  peerConnections: Map<string, PeerConnection>;
  isInitialized: boolean;
  isCameraEnabled: boolean;
  isMicEnabled: boolean;
  facingMode: 'user' | 'environment';
  error: string | null;
  
  // Actions
  initializeMedia: () => Promise<void>;
  cleanup: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleMicrophone: () => void;
  switchCamera: () => Promise<void>;
  
  // Peer management
  createPeerConnection: (userId: string, username: string, position: number) => Promise<void>;
  removePeerConnection: (userId: string) => Promise<void>;
  handleSignal: (signal: WebRTCSignal) => Promise<void>;
}

// Broadcast event types for WebRTC signaling
export type WebRTCBroadcastEvent = 
  | 'webrtc:offer'
  | 'webrtc:answer'
  | 'webrtc:ice-candidate'
  | 'webrtc:peer-joined'
  | 'webrtc:peer-left';

export interface WebRTCBroadcastPayload {
  event: WebRTCBroadcastEvent;
  data: WebRTCSignal | { userId: string };
  timestamp: string;
}
