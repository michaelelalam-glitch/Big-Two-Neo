/**
 * VideoChat Component
 * 4-player video chat grid with controls
 * 
 * Features:
 * - 4-player grid layout
 * - Local video preview
 * - Remote video streams
 * - Mute/unmute controls
 * - Camera toggle
 * - Camera switch (front/back)
 * - Connection status indicators
 */

import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Dimensions,
} from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { PeerConnection } from '../types/webrtc';
import { MediaStream } from 'react-native-webrtc';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface VideoChatProps {
  localStream: MediaStream | null;
  peerConnections: Map<string, PeerConnection>;
  isCameraEnabled: boolean;
  isMicEnabled: boolean;
  onToggleCamera: () => void;
  onToggleMicrophone: () => void;
  onSwitchCamera: () => void;
  currentUserId: string;
}

export function VideoChat({
  localStream,
  peerConnections,
  isCameraEnabled,
  isMicEnabled,
  onToggleCamera,
  onToggleMicrophone,
  onSwitchCamera,
  currentUserId,
}: VideoChatProps) {
  // Convert peer connections to array and sort by position
  const peers = Array.from(peerConnections.values()).sort(
    (a, b) => a.position - b.position
  );

  // Determine grid layout based on player count
  const totalPlayers = peers.length + 1; // +1 for local player
  const gridSize = totalPlayers <= 2 ? 1 : 2; // 1x1 for 1-2 players, 2x2 for 3-4 players

  return (
    <View style={styles.container}>
      {/* Video Grid */}
      <View style={styles.videoGrid}>
        {/* Local Video */}
        <View style={[styles.videoSlot, getSlotStyle(gridSize)]}>
          {localStream ? (
            <RTCView
              streamURL={localStream.toURL()}
              style={styles.video}
              objectFit="cover"
              mirror={true}
              zOrder={0}
            />
          ) : (
            <View style={[styles.video, styles.placeholderVideo]}>
              <Text style={styles.placeholderText}>Camera Off</Text>
            </View>
          )}
          <View style={styles.videoOverlay}>
            <Text style={styles.videoLabel}>You</Text>
            {!isCameraEnabled && (
              <View style={styles.statusBadge}>
                <Text style={styles.statusText}>📷</Text>
              </View>
            )}
            {!isMicEnabled && (
              <View style={styles.statusBadge}>
                <Text style={styles.statusText}>🔇</Text>
              </View>
            )}
          </View>
        </View>

        {/* Remote Videos */}
        {peers.map((peer) => (
          <View key={peer.userId} style={[styles.videoSlot, getSlotStyle(gridSize)]}>
            {peer.stream && peer.isVideoEnabled ? (
              <RTCView
                streamURL={peer.stream.toURL()}
                style={styles.video}
                objectFit="cover"
                mirror={false}
                zOrder={0}
              />
            ) : (
              <View style={[styles.video, styles.placeholderVideo]}>
                <Text style={styles.placeholderText}>
                  {peer.username.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.videoOverlay}>
              <Text style={styles.videoLabel}>{peer.username}</Text>
              <View style={[styles.connectionBadge, getConnectionColor(peer.state)]}>
                <Text style={styles.connectionText}>{getConnectionIcon(peer.state)}</Text>
              </View>
              {!peer.isVideoEnabled && (
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>📷</Text>
                </View>
              )}
              {peer.isMuted && (
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>🔇</Text>
                </View>
              )}
            </View>
          </View>
        ))}

        {/* Empty Slots */}
        {Array.from({ length: 4 - totalPlayers }).map((_, index) => (
          <View key={`empty-${index}`} style={[styles.videoSlot, getSlotStyle(gridSize)]}>
            <View style={[styles.video, styles.emptySlot]}>
              <Text style={styles.emptySlotText}>Empty</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        {/* Camera Toggle */}
        <TouchableOpacity
          style={[styles.controlButton, !isCameraEnabled && styles.controlButtonOff]}
          onPress={onToggleCamera}
        >
          <Text style={styles.controlButtonText}>
            {isCameraEnabled ? '📹' : '📷'}
          </Text>
        </TouchableOpacity>

        {/* Microphone Toggle */}
        <TouchableOpacity
          style={[styles.controlButton, !isMicEnabled && styles.controlButtonOff]}
          onPress={onToggleMicrophone}
        >
          <Text style={styles.controlButtonText}>
            {isMicEnabled ? '🎤' : '🔇'}
          </Text>
        </TouchableOpacity>

        {/* Switch Camera */}
        <TouchableOpacity style={styles.controlButton} onPress={onSwitchCamera}>
          <Text style={styles.controlButtonText}>🔄</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Get slot style based on grid size
 */
function getSlotStyle(gridSize: number): object {
  if (gridSize === 1) {
    return { width: '100%', height: '100%' };
  }
  return { width: '50%', height: '50%' };
}

/**
 * Get connection status icon
 */
function getConnectionIcon(state: string): string {
  switch (state) {
    case 'connected':
      return '🟢';
    case 'connecting':
      return '🟡';
    case 'disconnected':
    case 'failed':
      return '🔴';
    default:
      return '⚪';
  }
}

/**
 * Get connection status color
 */
function getConnectionColor(state: string): object {
  switch (state) {
    case 'connected':
      return { backgroundColor: 'rgba(0, 255, 0, 0.2)' };
    case 'connecting':
      return { backgroundColor: 'rgba(255, 255, 0, 0.2)' };
    case 'disconnected':
    case 'failed':
      return { backgroundColor: 'rgba(255, 0, 0, 0.2)' };
    default:
      return { backgroundColor: 'rgba(128, 128, 128, 0.2)' };
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  videoGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  videoSlot: {
    padding: 2,
  },
  video: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 8,
    overflow: 'hidden',
  },
  placeholderVideo: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
  },
  placeholderText: {
    color: '#fff',
    fontSize: 48,
    fontWeight: 'bold',
  },
  emptySlot: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
  },
  emptySlotText: {
    color: '#666',
    fontSize: 16,
  },
  videoOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  videoLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  connectionBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectionText: {
    fontSize: 12,
  },
  statusBadge: {
    backgroundColor: 'rgba(255, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 10,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  controlButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  controlButtonOff: {
    backgroundColor: 'rgba(255, 0, 0, 0.3)',
    borderColor: '#ff0000',
  },
  controlButtonText: {
    fontSize: 24,
  },
});
