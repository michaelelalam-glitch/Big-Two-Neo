/**
 * PlayerVideoCircle Component
 * Circular player avatar with WebRTC video integration
 * 
 * Features:
 * - Displays live video feed in circular mask
 * - Falls back to player initials/avatar when video unavailable
 * - Shows connection status indicator
 * - Shows mute/camera-off badges
 * - Works in both lobby and game screens
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { MediaStream } from 'react-native-webrtc';
import { PeerConnection } from '../types/webrtc';

export interface PlayerVideoCircleProps {
  // Player info
  userId: string;
  username: string;
  position: number;
  isCurrentUser?: boolean;
  
  // WebRTC streams
  localStream?: MediaStream | null;
  peerConnection?: PeerConnection | null;
  
  // Visual states
  isCameraEnabled?: boolean;
  isMicEnabled?: boolean;
  size?: number; // diameter in pixels
  showName?: boolean;
  showStatusBadges?: boolean;
  
  // Custom styling
  style?: ViewStyle;
}

export function PlayerVideoCircle({
  userId,
  username,
  position,
  isCurrentUser = false,
  localStream = null,
  peerConnection = null,
  isCameraEnabled = true,
  isMicEnabled = true,
  size = 80,
  showName = true,
  showStatusBadges = true,
  style,
}: PlayerVideoCircleProps) {
  // Determine which stream to use
  const stream = isCurrentUser ? localStream : peerConnection?.stream;
  const shouldShowVideo = stream && (isCurrentUser ? isCameraEnabled : peerConnection?.isVideoEnabled);
  const connectionState = peerConnection?.state;

  // Get player initials for fallback
  const getInitials = () => {
    const trimmed = username.trim();
    if (!trimmed) {
      return '?';
    }
    const names = trimmed.split(' ').filter(Boolean);
    if (names.length >= 2) {
      const firstInitial = names[0][0] || '';
      const lastInitial = names[names.length - 1][0] || '';
      return (firstInitial + lastInitial) || '?';
    }
    // Single word: take up to first two characters, or '?' if empty
    return trimmed.slice(0, 2) || '?';
  };

  return (
    <View style={[styles.container, { width: size, height: size }, style]}>
      {/* Video or placeholder */}
      <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
        {shouldShowVideo ? (
          <RTCView
            streamURL={stream!.toURL()}
            style={[styles.video, { borderRadius: size / 2 }]}
            objectFit="cover"
            mirror={isCurrentUser}
            zOrder={0}
          />
        ) : (
          <View style={[styles.placeholder, { borderRadius: size / 2 }]}>
            <Text style={[styles.initials, { fontSize: size * 0.3 }]}>
              {getInitials().toUpperCase()}
            </Text>
          </View>
        )}

        {/* Connection status indicator (for remote peers only) */}
        {!isCurrentUser && connectionState && showStatusBadges && (
          <View style={[styles.statusIndicator, { width: size * 0.2, height: size * 0.2, borderRadius: size * 0.1 }]}>
            <Text style={{ fontSize: size * 0.12 }}>
              {connectionState === 'connected' ? '🟢' :
               connectionState === 'connecting' ? '🟡' :
               '🔴'}
            </Text>
          </View>
        )}

        {/* Camera off badge */}
        {!isCameraEnabled && showStatusBadges && (
          <View style={[styles.badge, styles.cameraOffBadge, { padding: size * 0.05 }]}>
            <Text style={{ fontSize: size * 0.15 }}>📷</Text>
          </View>
        )}

        {/* Microphone muted badge */}
        {!isMicEnabled && showStatusBadges && (
          <View style={[styles.badge, styles.micMutedBadge, { padding: size * 0.05 }]}>
            <Text style={{ fontSize: size * 0.15 }}>🔇</Text>
          </View>
        )}
      </View>

      {/* Player name */}
      {showName && (
        <Text style={[styles.username, { fontSize: size * 0.14 }]} numberOfLines={1}>
          {username}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    overflow: 'hidden',
    backgroundColor: '#2a2a2a',
    borderWidth: 2,
    borderColor: '#22c55e',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  video: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
  },
  initials: {
    color: '#fff',
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  statusIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 0, 0, 0.8)',
    borderRadius: 4,
  },
  cameraOffBadge: {
    bottom: 4,
    left: 4,
  },
  micMutedBadge: {
    bottom: 4,
    right: 4,
  },
  username: {
    marginTop: 4,
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
});
