/**
 * useWebRTC Hook
 * Manages WebRTC peer connections for 4-player video chat
 * 
 * Features:
 * - Local media stream (camera + microphone)
 * - Peer connection management (full mesh topology)
 * - Signaling via Supabase Realtime
 * - Camera/microphone controls
 * - Automatic cleanup
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import { RealtimeChannel } from '@supabase/supabase-js';
import {
  PeerConnection,
  PeerConnectionState,
  DEFAULT_ICE_SERVERS,
  WebRTCSignal,
  UseWebRTCReturn,
} from '../types/webrtc';
import { WebRTCSignalingService } from '../services/webrtc';

interface UseWebRTCOptions {
  userId: string;
  roomId: string;
  channel: RealtimeChannel | null;
  players: Array<{ user_id: string; username: string; position: number }>;
  enabled?: boolean; // Allow enabling/disabling video chat
}

export function useWebRTC(options: UseWebRTCOptions): UseWebRTCReturn {
  const { userId, roomId, channel, players, enabled = false } = options;

  // State
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peerConnections, setPeerConnections] = useState<Map<string, PeerConnection>>(new Map());
  const [isInitialized, setIsInitialized] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);

  // Refs
  const signalingServiceRef = useRef<WebRTCSignalingService | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, PeerConnection>>(new Map());

  /**
   * Initialize signaling service
   */
  useEffect(() => {
    if (!channel || !userId) return;

    signalingServiceRef.current = new WebRTCSignalingService(userId);
    signalingServiceRef.current.setChannel(channel);
    signalingServiceRef.current.onSignal(handleIncomingSignal);

    return () => {
      signalingServiceRef.current?.cleanup();
      signalingServiceRef.current = null;
    };
  }, [channel, userId]);

  /**
   * Initialize local media stream
   */
  const initializeMedia = useCallback(async (): Promise<void> => {
    if (isInitialized || !enabled) return;

    try {
      console.log('[WebRTC] Requesting camera and microphone access...');

      // Use react-native-webrtc constraints format
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: 640,
          height: 480,
          frameRate: 30,
          facingMode: 'user',
        },
      });
      
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsInitialized(true);
      setError(null);

      console.log('[WebRTC] Media initialized:', stream.toURL());

      // Notify other peers that we've joined
      await signalingServiceRef.current?.notifyPeerJoined();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to access camera/microphone';
      console.error('[WebRTC] Media initialization failed:', errorMessage);
      setError(errorMessage);
    }
  }, [isInitialized, enabled]);

  /**
   * Create peer connection for a specific user
   */
  const createPeerConnection = useCallback(
    async (targetUserId: string, username: string, position: number): Promise<void> => {
      if (!localStreamRef.current || !signalingServiceRef.current) {
        console.warn('[WebRTC] Cannot create peer connection: not initialized');
        return;
      }

      // Don't create connection to ourselves
      if (targetUserId === userId) return;

      // Don't create duplicate connections
      if (peerConnectionsRef.current.has(targetUserId)) {
        console.log('[WebRTC] Peer connection already exists for:', targetUserId);
        return;
      }

      console.log('[WebRTC] Creating peer connection to:', username, '(position:', position, ')');

      try {
        // Create RTCPeerConnection
        const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS }) as any;

        // Add local stream tracks
        localStreamRef.current.getTracks().forEach((track: any) => {
          pc.addTrack(track, localStreamRef.current!);
        });

        // Handle ICE candidates
        pc.onicecandidate = (event: any) => {
          if (event.candidate) {
            console.log('[WebRTC] Sending ICE candidate to:', targetUserId);
            signalingServiceRef.current?.sendIceCandidate(
              targetUserId,
              event.candidate.toJSON()
            );
          }
        };

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
          console.log('[WebRTC] Connection state changed:', pc.connectionState);
          updatePeerState(targetUserId, pc.connectionState as PeerConnectionState);
        };

        // Handle remote stream
        pc.ontrack = (event: any) => {
          console.log('[WebRTC] Received remote track from:', targetUserId);
          if (event.streams && event.streams[0]) {
            updatePeerStream(targetUserId, event.streams[0]);
          }
        };

        // Store peer connection
        const peerConnection: PeerConnection = {
          userId: targetUserId,
          username,
          position,
          connection: pc,
          state: 'new',
          stream: null,
          isMuted: false,
          isVideoEnabled: true,
        };

        peerConnectionsRef.current.set(targetUserId, peerConnection);
        setPeerConnections(new Map(peerConnectionsRef.current));

        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await signalingServiceRef.current.sendOffer(targetUserId, offer);

        console.log('[WebRTC] Offer sent to:', targetUserId);
      } catch (err) {
        console.error('[WebRTC] Failed to create peer connection:', err);
        setError('Failed to establish video connection');
      }
    },
    [userId]
  );

  /**
   * Handle incoming WebRTC signals
   */
  const handleIncomingSignal = useCallback(
    async (signal: WebRTCSignal): Promise<void> => {
      const { type, from, payload } = signal;

      console.log('[WebRTC] Processing signal:', type, 'from:', from);

      let pc = peerConnectionsRef.current.get(from)?.connection;

      // If no peer connection exists and this is an offer, create one
      if (!pc && type === 'offer') {
        const fromPlayer = players.find((p) => p.user_id === from);
        if (!fromPlayer) {
          console.warn('[WebRTC] Received offer from unknown player:', from);
          return;
        }

        // Create peer connection
        pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS }) as any;

        // Add local stream tracks
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track: any) => {
            (pc as any).addTrack(track, localStreamRef.current);
          });
        }

        // Setup handlers (pc is definitely not undefined here)
        const pcInstance = pc as any;
        
        pcInstance.onicecandidate = (event: any) => {
          if (event.candidate) {
            signalingServiceRef.current?.sendIceCandidate(from, event.candidate.toJSON());
          }
        };

        pcInstance.onconnectionstatechange = () => {
          updatePeerState(from, pcInstance.connectionState as PeerConnectionState);
        };

        pcInstance.ontrack = (event: any) => {
          if (event.streams && event.streams[0]) {
            updatePeerStream(from, event.streams[0]);
          }
        };

        // Store peer connection
        const peerConnection: PeerConnection = {
          userId: from,
          username: fromPlayer.username,
          position: fromPlayer.position,
          connection: pc as any,
          state: 'connecting',
          stream: null,
          isMuted: false,
          isVideoEnabled: true,
        };

        peerConnectionsRef.current.set(from, peerConnection);
        setPeerConnections(new Map(peerConnectionsRef.current));
      }

      if (!pc) {
        console.warn('[WebRTC] No peer connection for:', from);
        return;
      }

      try {
        switch (type) {
          case 'offer':
            const offerDesc = payload as any;
            await pc.setRemoteDescription(offerDesc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await signalingServiceRef.current?.sendAnswer(from, answer);
            console.log('[WebRTC] Answer sent to:', from);
            break;

          case 'answer':
            const answerDesc = payload as any;
            await pc.setRemoteDescription(answerDesc);
            console.log('[WebRTC] Answer processed from:', from);
            break;

          case 'ice-candidate':
            const candidate = new RTCIceCandidate(payload as any);
            await pc.addIceCandidate(candidate);
            console.log('[WebRTC] ICE candidate added from:', from);
            break;
        }
      } catch (err) {
        console.error('[WebRTC] Error processing signal:', err);
      }
    },
    [players]
  );

  /**
   * Update peer connection state
   */
  const updatePeerState = useCallback((userId: string, state: PeerConnectionState) => {
    const peer = peerConnectionsRef.current.get(userId);
    if (peer) {
      peer.state = state;
      peerConnectionsRef.current.set(userId, peer);
      setPeerConnections(new Map(peerConnectionsRef.current));
    }
  }, []);

  /**
   * Update peer stream
   */
  const updatePeerStream = useCallback((userId: string, stream: MediaStream) => {
    const peer = peerConnectionsRef.current.get(userId);
    if (peer) {
      peer.stream = stream;
      peerConnectionsRef.current.set(userId, peer);
      setPeerConnections(new Map(peerConnectionsRef.current));
    }
  }, []);

  /**
   * Remove peer connection
   */
  const removePeerConnection = useCallback(async (targetUserId: string): Promise<void> => {
    const peer = peerConnectionsRef.current.get(targetUserId);
    if (peer) {
      peer.connection.close();
      peerConnectionsRef.current.delete(targetUserId);
      setPeerConnections(new Map(peerConnectionsRef.current));
      console.log('[WebRTC] Removed peer connection:', targetUserId);
    }
  }, []);

  /**
   * Toggle camera on/off
   */
  const toggleCamera = useCallback(async (): Promise<void> => {
    if (!localStreamRef.current) return;

    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      const newState = !videoTrack.enabled;
      videoTrack.enabled = newState;
      setIsCameraEnabled(newState);
      console.log('[WebRTC] Camera toggled:', newState);
    }
  }, []);

  /**
   * Toggle microphone on/off
   */
  const toggleMicrophone = useCallback((): void => {
    if (!localStreamRef.current) return;

    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      const newState = !audioTrack.enabled;
      audioTrack.enabled = newState;
      setIsMicEnabled(newState);
      console.log('[WebRTC] Microphone toggled:', newState);
    }
  }, []);

  /**
   * Switch between front and back camera
   */
  const switchCamera = useCallback(async (): Promise<void> => {
    if (!localStreamRef.current) return;

    try {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        // @ts-ignore - _switchCamera exists but not in types
        await videoTrack._switchCamera();
        setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
        console.log('[WebRTC] Camera switched');
      }
    } catch (err) {
      console.error('[WebRTC] Failed to switch camera:', err);
    }
  }, []);

  /**
   * Cleanup all connections
   */
  const cleanup = useCallback(async (): Promise<void> => {
    console.log('[WebRTC] Cleaning up...');

    // Notify peers we're leaving
    await signalingServiceRef.current?.notifyPeerLeft();

    // Close all peer connections
    peerConnectionsRef.current.forEach((peer) => {
      peer.connection.close();
    });
    peerConnectionsRef.current.clear();
    setPeerConnections(new Map());

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }

    setIsInitialized(false);
  }, []);

  /**
   * Auto-create peer connections when players change
   */
  useEffect(() => {
    if (!isInitialized || !enabled) return;

    // Create connections to new players
    players.forEach((player) => {
      if (player.user_id !== userId && !peerConnectionsRef.current.has(player.user_id)) {
        createPeerConnection(player.user_id, player.username, player.position);
      }
    });

    // Remove connections for players who left
    const currentPlayerIds = new Set(players.map((p) => p.user_id));
    peerConnectionsRef.current.forEach((peer, peerId) => {
      if (!currentPlayerIds.has(peerId)) {
        removePeerConnection(peerId);
      }
    });
  }, [players, isInitialized, enabled, userId, createPeerConnection, removePeerConnection]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  /**
   * Auto-initialize when enabled
   */
  useEffect(() => {
    if (enabled && !isInitialized) {
      initializeMedia();
    } else if (!enabled && isInitialized) {
      cleanup();
    }
  }, [enabled, isInitialized, initializeMedia, cleanup]);

  return {
    localStream,
    peerConnections,
    isInitialized,
    isCameraEnabled,
    isMicEnabled,
    facingMode,
    error,
    initializeMedia,
    cleanup,
    toggleCamera,
    toggleMicrophone,
    switchCamera,
    createPeerConnection,
    removePeerConnection,
    handleSignal: handleIncomingSignal,
  };
}
