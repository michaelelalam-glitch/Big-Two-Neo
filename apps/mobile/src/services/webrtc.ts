/**
 * WebRTC Signaling Service
 * Handles WebRTC offer/answer/ICE candidate exchange via Supabase Realtime
 */

import { RealtimeChannel } from '@supabase/supabase-js';
import {
  WebRTCSignal,
  WebRTCSignalType,
  WebRTCBroadcastPayload,
} from '../types/webrtc';

export class WebRTCSignalingService {
  private channel: RealtimeChannel | null = null;
  private userId: string;
  private onSignalCallback: ((signal: WebRTCSignal) => void) | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Set the Realtime channel for signaling
   * This should be the same channel used for game state
   */
  setChannel(channel: RealtimeChannel): void {
    this.channel = channel;
    this.setupSignalingListeners();
  }

  /**
   * Set callback for incoming WebRTC signals
   */
  onSignal(callback: (signal: WebRTCSignal) => void): void {
    this.onSignalCallback = callback;
  }

  /**
   * Setup listeners for WebRTC signaling events
   */
  private setupSignalingListeners(): void {
    if (!this.channel) return;

    // Listen for offers
    this.channel.on('broadcast', { event: 'webrtc:offer' }, (payload) => {
      this.handleIncomingSignal(payload.payload as WebRTCBroadcastPayload);
    });

    // Listen for answers
    this.channel.on('broadcast', { event: 'webrtc:answer' }, (payload) => {
      this.handleIncomingSignal(payload.payload as WebRTCBroadcastPayload);
    });

    // Listen for ICE candidates
    this.channel.on('broadcast', { event: 'webrtc:ice-candidate' }, (payload) => {
      this.handleIncomingSignal(payload.payload as WebRTCBroadcastPayload);
    });
  }

  /**
   * Handle incoming signaling message
   */
  private handleIncomingSignal(payload: WebRTCBroadcastPayload): void {
    const signal = payload.data as WebRTCSignal;
    
    // Only process signals meant for this user
    if (signal.to !== this.userId) {
      return;
    }

    console.log('[WebRTC Signaling] Received signal:', signal.type, 'from:', signal.from);

    if (this.onSignalCallback) {
      this.onSignalCallback(signal);
    }
  }

  /**
   * Send an offer to a specific peer
   */
  async sendOffer(
    toUserId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    await this.sendSignal('offer', toUserId, offer);
  }

  /**
   * Send an answer to a specific peer
   */
  async sendAnswer(
    toUserId: string,
    answer: RTCSessionDescriptionInit
  ): Promise<void> {
    await this.sendSignal('answer', toUserId, answer);
  }

  /**
   * Send an ICE candidate to a specific peer
   */
  async sendIceCandidate(
    toUserId: string,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    await this.sendSignal('ice-candidate', toUserId, candidate);
  }

  /**
   * Generic signal sending method
   */
  private async sendSignal(
    type: WebRTCSignalType,
    toUserId: string,
    payload: RTCSessionDescriptionInit | RTCIceCandidateInit
  ): Promise<void> {
    if (!this.channel) {
      console.error('[WebRTC Signaling] No channel available');
      return;
    }

    const signal: WebRTCSignal = {
      type,
      from: this.userId,
      to: toUserId,
      payload,
      timestamp: new Date().toISOString(),
    };

    const broadcastPayload: WebRTCBroadcastPayload = {
      event: `webrtc:${type}` as any,
      data: signal,
      timestamp: signal.timestamp,
    };

    console.log('[WebRTC Signaling] Sending signal:', type, 'to:', toUserId);

    await this.channel.send({
      type: 'broadcast',
      event: `webrtc:${type}`,
      payload: broadcastPayload,
    });
  }

  /**
   * Notify peers that this user has joined the video chat
   */
  async notifyPeerJoined(): Promise<void> {
    if (!this.channel) {
      console.error('[WebRTC Signaling] No channel available');
      return;
    }

    await this.channel.send({
      type: 'broadcast',
      event: 'webrtc:peer-joined',
      payload: {
        event: 'webrtc:peer-joined',
        data: { userId: this.userId },
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Notify peers that this user has left the video chat
   */
  async notifyPeerLeft(): Promise<void> {
    if (!this.channel) {
      console.error('[WebRTC Signaling] No channel available');
      return;
    }

    await this.channel.send({
      type: 'broadcast',
      event: 'webrtc:peer-left',
      payload: {
        event: 'webrtc:peer-left',
        data: { userId: this.userId },
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.channel = null;
    this.onSignalCallback = null;
  }
}
