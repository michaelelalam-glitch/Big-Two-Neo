/**
 * GameLobbyScreen
 * Waiting room for 4 players with video chat integration
 * 
 * Features:
 * - 4 player slots in 2x2 grid
 * - Live video feeds in player circles
 * - Ready status indicators
 * - Host controls (Start Game, Add Bot)
 * - Room code display
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useRealtime } from '../hooks/useRealtime';
import { useWebRTC } from '../hooks/useWebRTC';
import { useAuth } from '../contexts/AuthContext';
import { PlayerVideoCircle } from '../components/PlayerVideoCircle';
import { COLORS, SPACING, FONT_SIZES } from '../constants';

type GameLobbyScreenNavigationProp = StackNavigationProp<RootStackParamList, 'GameLobby'>;
type GameLobbyScreenRouteProp = RouteProp<RootStackParamList, 'GameLobby'>;

export default function GameLobbyScreen() {
  const navigation = useNavigation<GameLobbyScreenNavigationProp>();
  const route = useRoute<GameLobbyScreenRouteProp>();
  const { user } = useAuth();
  const { roomCode } = route.params || {};

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (!user) {
      console.log('[GameLobby] No user, redirecting to SignIn');
      navigation.replace('SignIn');
    }
  }, [user, navigation]);

  // Don't render anything if no user
  if (!user) {
    return null;
  }

  // Real-time multiplayer
  const {
    room,
    players,
    isHost,
    channel,
    createRoom,
    joinRoom,
    setReady,
    startGame,
    leaveRoom,
    loading,
    error,
  } = useRealtime({
    userId: user?.id || '',
    username: user?.email?.split('@')[0] || 'Player',
  });

  const [isReady, setIsReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const hasInitializedRef = useRef(false);

  // Create or join room on mount (only once)
  useEffect(() => {
    const initializeRoom = async () => {
      if (!user?.id || hasInitializedRef.current) {
        return;
      }

      hasInitializedRef.current = true;
      console.log('[GameLobby] Initializing room (once)');

      try {
        if (roomCode) {
          console.log('[GameLobby] Joining room:', roomCode);
          await joinRoom(roomCode);
        } else {
          console.log('[GameLobby] Creating new room');
          await createRoom();
        }
      } catch (err) {
        console.error('[GameLobby] Failed to initialize room:', err);
        hasInitializedRef.current = false; // Reset on error so user can retry
      } finally {
        setIsInitializing(false);
      }
    };

    if (user?.id && !hasInitializedRef.current) {
      initializeRoom();
    }
  }, [user?.id, roomCode, createRoom, joinRoom]);

  // WebRTC video chat - only enable when room is ready
  const webrtc = useWebRTC({
    userId: user?.id || '',
    roomId: room?.id || '',
    channel: channel, // Pass the Realtime channel
    players: players.map(p => ({
      user_id: p.user_id,
      username: p.username,
      position: p.position,
    })),
    enabled: !!room && !!channel, // Enable video when room and channel are ready
  });

  // Fill empty slots (0-3)
  const playerSlots = Array.from({ length: 4 }, (_, position) => {
    return players.find(p => p.position === position) || null;
  });

  const handleReadyToggle = async () => {
    const newReadyState = !isReady;
    await setReady(newReadyState);
    setIsReady(newReadyState);
  };

  const handleStartGame = async () => {
    if (isHost) {
      await startGame();
      // Navigate to game screen
      // navigation.navigate('Game');
    }
  };

  const handleLeaveRoom = async () => {
    await leaveRoom();
    navigation.goBack();
  };

  if (loading || isInitializing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.loadingText}>
            {roomCode ? 'Joining room...' : 'Creating room...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || (!room && !isInitializing)) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorText}>
            {error?.message || 'Could not connect to server'}
          </Text>
          <Text style={styles.errorHint}>
            Make sure you're connected to the internet and try again.
          </Text>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Guard: room must exist beyond this point
  if (!room) {
    return null;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Game Lobby</Text>
            <Text style={styles.roomCode}>Room: {room.code}</Text>
          </View>
          <TouchableOpacity style={styles.leaveButton} onPress={handleLeaveRoom}>
            <Text style={styles.leaveButtonText}>Leave</Text>
          </TouchableOpacity>
        </View>

        {/* Player Grid with Video */}
        <View style={styles.playerGrid}>
          {playerSlots.map((player, index) => (
            <View key={index} style={styles.playerSlot}>
              {player ? (
                <View style={styles.playerContent}>
                  <PlayerVideoCircle
                    userId={player.user_id}
                    username={player.username}
                    position={player.position}
                    isCurrentUser={player.user_id === user?.id}
                    localStream={webrtc.localStream}
                    peerConnection={player.user_id === user?.id ? undefined : webrtc.peerConnections.get(player.user_id)}
                    isCameraEnabled={webrtc.isCameraEnabled}
                    isMicEnabled={webrtc.isMicEnabled}
                    size={100}
                    showName={true}
                    showStatusBadges={true}
                  />
                  <View style={styles.playerInfo}>
                    {player.is_host && (
                      <View style={styles.hostBadge}>
                        <Text style={styles.hostBadgeText}>👑 Host</Text>
                      </View>
                    )}
                    {player.is_ready ? (
                      <View style={styles.readyBadge}>
                        <Text style={styles.readyBadgeText}>✓ Ready</Text>
                      </View>
                    ) : (
                      <View style={styles.waitingBadge}>
                        <Text style={styles.waitingBadgeText}>⏳ Waiting</Text>
                      </View>
                    )}
                  </View>
                </View>
              ) : (
                <View style={styles.emptySlot}>
                  <Text style={styles.emptySlotText}>Slot {index + 1}</Text>
                  <Text style={styles.emptySlotSubtext}>Waiting...</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Video Controls */}
        <View style={styles.videoControls}>
          <TouchableOpacity
            style={[styles.videoControl, !webrtc.isCameraEnabled && styles.videoControlOff]}
            onPress={webrtc.toggleCamera}
          >
            <Text style={styles.videoControlText}>
              {webrtc.isCameraEnabled ? '📹 Camera' : '📷 Camera Off'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.videoControl, !webrtc.isMicEnabled && styles.videoControlOff]}
            onPress={webrtc.toggleMicrophone}
          >
            <Text style={styles.videoControlText}>
              {webrtc.isMicEnabled ? '🎤 Mic' : '🔇 Muted'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.videoControl} onPress={webrtc.switchCamera}>
            <Text style={styles.videoControlText}>🔄 Flip</Text>
          </TouchableOpacity>
        </View>

        {/* Game Controls */}
        <View style={styles.gameControls}>
          {isHost ? (
            <TouchableOpacity
              style={[styles.startButton, players.length < 2 && styles.startButtonDisabled]}
              onPress={handleStartGame}
              disabled={players.length < 2}
            >
              <Text style={styles.startButtonText}>
                {players.length < 2 ? 'Need 2+ Players' : 'Start Game'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.readyButton, isReady && styles.readyButtonActive]}
              onPress={handleReadyToggle}
            >
              <Text style={styles.readyButtonText}>
                {isReady ? '✓ Ready' : 'Mark Ready'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Player count */}
        <Text style={styles.playerCount}>
          {players.length} / 4 Players
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  scrollContent: {
    padding: SPACING.lg,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  roomCode: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    marginTop: 4,
  },
  leaveButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  leaveButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  playerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: SPACING.xl,
  },
  playerSlot: {
    width: '48%',
    aspectRatio: 1,
    marginBottom: SPACING.md,
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: SPACING.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerContent: {
    alignItems: 'center',
  },
  playerInfo: {
    marginTop: SPACING.sm,
    gap: 4,
  },
  hostBadge: {
    backgroundColor: '#fbbf24',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  hostBadgeText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
  },
  readyBadge: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  readyBadgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  waitingBadge: {
    backgroundColor: '#6b7280',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  waitingBadgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  emptySlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySlotText: {
    color: COLORS.gray.medium,
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
  },
  emptySlotSubtext: {
    color: COLORS.gray.light,
    fontSize: FONT_SIZES.sm,
    marginTop: 4,
  },
  videoControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  videoControl: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  videoControlOff: {
    backgroundColor: 'rgba(255, 0, 0, 0.3)',
  },
  videoControlText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  gameControls: {
    marginBottom: SPACING.md,
  },
  startButton: {
    backgroundColor: '#22c55e',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  startButtonDisabled: {
    backgroundColor: '#374151',
    opacity: 0.5,
  },
  startButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  readyButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  readyButtonActive: {
    backgroundColor: '#22c55e',
  },
  readyButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  playerCount: {
    color: COLORS.gray.medium,
    fontSize: FONT_SIZES.md,
    textAlign: 'center',
  },
  loadingText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
  },
  errorTitle: {
    color: '#ef4444',
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  errorText: {
    color: '#ef4444',
    fontSize: FONT_SIZES.md,
    marginBottom: SPACING.sm,
    textAlign: 'center',
    paddingHorizontal: SPACING.lg,
  },
  errorHint: {
    color: COLORS.gray.medium,
    fontSize: FONT_SIZES.sm,
    marginBottom: SPACING.lg,
    textAlign: 'center',
    paddingHorizontal: SPACING.lg,
  },
  backButton: {
    backgroundColor: '#4A90E2',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
});
