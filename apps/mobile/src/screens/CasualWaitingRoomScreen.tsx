import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Clipboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { roomLogger } from '../utils/logger';
import { showError, showSuccess } from '../utils';
import { i18n } from '../i18n';

type CasualWaitingRoomScreenRouteProp = RouteProp<RootStackParamList, 'CasualWaitingRoom'>;
type CasualWaitingRoomScreenNavigationProp = StackNavigationProp<RootStackParamList, 'CasualWaitingRoom'>;

interface Player {
  id: string;
  user_id: string | null;
  username: string;
  player_index: number;
  is_bot: boolean;
  is_host: boolean;
  is_ready: boolean;
}

/**
 * Casual Waiting Room Screen
 * 
 * Dedicated UI for casual matchmaking/public rooms.
 * 
 * Features:
 * - Real-time player updates via Supabase Realtime
 * - First player = host (sees "Start with AI Bots" button)
 * - Host transfer when host leaves (second player becomes host)
 * - Room code prominently displayed for sharing with friends
 * - Auto-starts when 4 players join
 * - Clean, focused UI different from private room lobby
 * 
 * Distinction from LobbyScreen:
 * - LobbyScreen: Private rooms with invited friends
 * - CasualWaitingRoomScreen: Public/matchmaking rooms
 */
export default function CasualWaitingRoomScreen() {
  const navigation = useNavigation<CasualWaitingRoomScreenNavigationProp>();
  const route = useRoute<CasualWaitingRoomScreenRouteProp>();
  const { roomCode } = route.params;
  const { user } = useAuth();
  
  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const isLeavingRef = useRef(false);
  const isStartingRef = useRef(false);
  
  /**
   * Load room and players
   */
  const loadPlayers = useCallback(async () => {
    try {
      // Get room
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('id')
        .eq('code', roomCode)
        .single();
      
      if (roomError || !roomData) {
        roomLogger.error('[CasualWaitingRoom] Room not found');
        if (!isLeavingRef.current) {
          showError('Room not found');
          navigation.replace('Home');
        }
        return;
      }
      
      setRoomId(roomData.id);
      
      // Get players
      const { data: playersData, error: playersError } = await supabase
        .from('room_players')
        .select('id, user_id, username, player_index, is_bot, is_host, is_ready')
        .eq('room_id', roomData.id)
        .order('player_index');
      
      if (playersError) throw playersError;
      
      setPlayers(playersData || []);
      
      // Check if current user is host
      const currentUserPlayer = playersData?.find(p => p.user_id === user?.id);
      setIsHost(currentUserPlayer?.is_host || false);
      
      setIsLoading(false);
    } catch (error: any) {
      roomLogger.error('[CasualWaitingRoom] Error loading players:', error?.message || String(error));
      setIsLoading(false);
    }
  }, [roomCode, user?.id, navigation]);
  
  /**
   * Subscribe to real-time updates
   */
  useEffect(() => {
    loadPlayers();
    
    if (!roomId) return;
    
    const channel = supabase
      .channel(`casual_room:${roomCode}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'room_players',
        filter: `room_id=eq.${roomId}`,
      }, () => {
        roomLogger.info('[CasualWaitingRoom] Players updated via Realtime');
        loadPlayers();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${roomId}`,
      }, (payload) => {
        roomLogger.info('[CasualWaitingRoom] Room updated via Realtime', payload.new);
        
        // If room status changed to 'playing', navigate to game
        if (payload.new.status === 'playing') {
          navigation.replace('Game', { roomCode });
        }
      })
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomCode, roomId, loadPlayers, navigation]);
  
  /**
   * Auto-start when 4 players join
   */
  useEffect(() => {
    if (players.length === 4 && isHost && !isStartingRef.current) {
      roomLogger.info('[CasualWaitingRoom] 4 players detected, auto-starting game');
      handleStartGame();
    }
  }, [players.length, isHost]);
  
  /**
   * Copy room code to clipboard
   */
  const handleCopyCode = () => {
    Clipboard.setString(roomCode);
    showSuccess('Room code copied!');
  };
  
  /**
   * Start game with AI bots filling empty seats
   */
  const handleStartGame = async () => {
    if (isStartingRef.current || isStarting) return;
    
    try {
      isStartingRef.current = true;
      setIsStarting(true);
      
      if (!isHost) {
        showError('Only the host can start the game');
        return;
      }
      
      if (!roomId) {
        showError('Room ID not found');
        return;
      }
      
      const humanCount = players.filter(p => !p.is_bot).length;
      const botsNeeded = 4 - humanCount;
      
      roomLogger.info(`[CasualWaitingRoom] Starting game: ${humanCount} humans, ${botsNeeded} bots`);
      
      // Call start_game_with_bots RPC
      const { error } = await supabase.rpc('start_game_with_bots', {
        p_room_id: roomId,
        p_bot_count: botsNeeded,
        p_bot_difficulty: 'medium',
      });
      
      if (error) throw error;
      
      roomLogger.info('[CasualWaitingRoom] Game started successfully');
      
      // Navigation will happen via Realtime subscription when room status changes to 'playing'
    } catch (error: any) {
      roomLogger.error('[CasualWaitingRoom] Error starting game:', error?.message || String(error));
      showError(error?.message || 'Failed to start game');
      setIsStarting(false);
    } finally {
      isStartingRef.current = false;
    }
  };
  
  /**
   * Leave room and return to home
   */
  const handleLeave = async () => {
    if (isLeavingRef.current || isLeaving) return;
    
    try {
      isLeavingRef.current = true;
      setIsLeaving(true);
      
      if (!roomId) {
        navigation.replace('Home');
        return;
      }
      
      // Remove player from room
      const { error } = await supabase
        .from('room_players')
        .delete()
        .eq('room_id', roomId)
        .eq('user_id', user?.id);
      
      if (error) throw error;
      
      roomLogger.info('[CasualWaitingRoom] Left room successfully');
      navigation.replace('Home');
    } catch (error: any) {
      roomLogger.error('[CasualWaitingRoom] Error leaving room:', error?.message || String(error));
      showError('Failed to leave room');
      setIsLeaving(false);
      isLeavingRef.current = false;
    }
  };
  
  /**
   * Render player slot
   */
  const renderPlayerSlot = (index: number) => {
    const player = players.find(p => p.player_index === index);
    
    if (player) {
      const isCurrentUser = player.user_id === user?.id;
      return (
        <View key={index} style={[styles.playerSlot, styles.playerSlotFilled]}>
          <Text style={styles.playerName}>
            {player.username}
            {player.is_host && ' 👑'}
          </Text>
          {isCurrentUser && (
            <Text style={styles.youBadge}>You</Text>
          )}
        </View>
      );
    }
    
    return (
      <View key={index} style={[styles.playerSlot, styles.playerSlotEmpty]}>
        <Text style={styles.emptySlotText}>Waiting...</Text>
      </View>
    );
  };
  
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.success} />
      </SafeAreaView>
    );
  }
  
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.content}>
          {/* Header */}
          <Text style={styles.title}>🎮 Finding Players</Text>
          <Text style={styles.subtitle}>
            {players.length}/4 players in room
          </Text>
          
          {/* Room Code Card */}
          <View style={styles.roomCodeCard}>
            <Text style={styles.roomCodeLabel}>Share this code with friends:</Text>
            <View style={styles.roomCodeBox}>
              <Text style={styles.roomCodeText}>{roomCode}</Text>
            </View>
            <TouchableOpacity 
              style={styles.copyButton}
              onPress={handleCopyCode}
            >
              <Text style={styles.copyButtonText}>📋 Copy Code</Text>
            </TouchableOpacity>
          </View>
          
          {/* Player Grid */}
          <View style={styles.playerGrid}>
            {[0, 1, 2, 3].map(index => renderPlayerSlot(index))}
          </View>
          
          {/* Host Badge and Start Button */}
          {isHost && (
            <View style={styles.hostSection}>
              <Text style={styles.hostBadge}>👑 You're the Host</Text>
              <TouchableOpacity 
                style={[styles.startButton, isStarting && styles.buttonDisabled]}
                onPress={handleStartGame}
                disabled={isStarting || players.length === 0}
              >
                {isStarting ? (
                  <>
                    <ActivityIndicator color={COLORS.white} size="small" />
                    <Text style={[styles.startButtonText, { marginTop: 4 }]}>
                      Starting...
                    </Text>
                  </>
                ) : (
                  <Text style={styles.startButtonText}>
                    🤖 Start with AI Bots ({4 - players.length} bots)
                  </Text>
                )}
              </TouchableOpacity>
              <Text style={styles.hostInfo}>
                Game will start automatically when 4 players join,{'\n'}
                or you can start now with AI bots filling empty seats
              </Text>
            </View>
          )}
          
          {/* Non-Host Message */}
          {!isHost && (
            <Text style={styles.waitingInfo}>
              Waiting for host to start the game...
            </Text>
          )}
          
          {/* Cancel Button */}
          <TouchableOpacity 
            style={styles.cancelButton}
            onPress={handleLeave}
            disabled={isLeaving}
          >
            {isLeaving ? (
              <ActivityIndicator color={COLORS.white} size="small" />
            ) : (
              <Text style={styles.cancelButtonText}>Cancel & Leave</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.success,
    marginBottom: SPACING.xl,
  },
  roomCodeCard: {
    width: '100%',
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderWidth: 2,
    borderColor: COLORS.info,
    borderRadius: 16,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    alignItems: 'center',
  },
  roomCodeLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.light,
    marginBottom: SPACING.sm,
  },
  roomCodeBox: {
    backgroundColor: COLORS.secondary,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: 12,
    marginBottom: SPACING.md,
  },
  roomCodeText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.white,
    letterSpacing: 4,
  },
  copyButton: {
    backgroundColor: COLORS.info,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: 8,
  },
  copyButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  playerGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: SPACING.xl,
  },
  playerSlot: {
    width: '48%',
    height: 100,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerSlotFilled: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 2,
    borderColor: COLORS.success,
  },
  playerSlotEmpty: {
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
    borderWidth: 2,
    borderColor: COLORS.gray.medium,
    borderStyle: 'dashed',
  },
  playerName: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.white,
    textAlign: 'center',
  },
  youBadge: {
    marginTop: SPACING.xs,
    fontSize: FONT_SIZES.sm,
    color: COLORS.success,
    fontWeight: '600',
  },
  emptySlotText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
  },
  hostSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  hostBadge: {
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
    color: COLORS.warning,
    marginBottom: SPACING.md,
  },
  startButton: {
    width: '100%',
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  startButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  hostInfo: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.light,
    textAlign: 'center',
    lineHeight: 20,
  },
  waitingInfo: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.light,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  cancelButton: {
    width: '100%',
    backgroundColor: COLORS.error,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
});
