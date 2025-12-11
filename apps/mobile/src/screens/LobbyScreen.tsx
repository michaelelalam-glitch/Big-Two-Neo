import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import ErrorBoundary from '../components/ErrorBoundary';

type LobbyScreenRouteProp = RouteProp<RootStackParamList, 'Lobby'>;
type LobbyScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Lobby'>;

interface Player {
  id: string;
  user_id: string;
  player_index: number;
  is_ready: boolean;
  is_bot: boolean;
  is_host: boolean;
  profiles?: {
    username?: string;
  };
}

export default function LobbyScreen() {
  const navigation = useNavigation<LobbyScreenNavigationProp>();
  const route = useRoute<LobbyScreenRouteProp>();
  const { roomCode } = route.params;
  const { user } = useAuth();
  
  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [isTogglingReady, setIsTogglingReady] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isLeaving, setIsLeavingState] = useState(false);
  const isLeavingRef = useRef(false); // Prevent double navigation
  const isStartingRef = useRef(false); // Prevent duplicate start-game calls

  useEffect(() => {
    loadPlayers();
    return subscribeToPlayers();
  }, [roomCode]);

  const getRoomId = async () => {
    const { data, error } = await supabase
      .from('rooms')
      .select('id')
      .eq('code', roomCode)
      .single();
    
    if (error || !data) {
      console.log('[LobbyScreen] Room not found, navigating to Home (likely cleaned up)');
      // Silently navigate home instead of showing error
      // This happens when user leaves game and cleanup removes them from room
      if (!isLeavingRef.current) {
        isLeavingRef.current = true;
        navigation.replace('Home');
      }
      return null;
    }
    
    return data.id;
  };

  const loadPlayers = async () => {
    try {
      // Get roomId - either from state or fetch it
      let currentRoomId = roomId;
      if (!currentRoomId) {
        currentRoomId = await getRoomId();
        if (!currentRoomId) return; // Room not found, getRoomId handles navigation
        setRoomId(currentRoomId);
      }
      
      console.log('[LobbyScreen] Loading players for room:', currentRoomId, 'user:', user?.id);
      
      // Use the username column to avoid N+1 query problem
      const { data, error } = await supabase
        .from('room_players')
        .select(`
          id,
          user_id,
          player_index,
          is_ready,
          is_bot,
          is_host,
          username
        `)
        .eq('room_id', currentRoomId)
        .order('player_index');

      if (error) {
        console.error('[LobbyScreen] Query error:', error);
        throw error;
      }
      
      console.log('[LobbyScreen] Raw query data:', JSON.stringify(data, null, 2));
      
      // Transform data to match Player interface (with profiles object for backward compatibility)
      const players = (data || []).map(player => ({
        ...player,
        profiles: player.username ? { username: player.username } : undefined,
      }));
      
      setPlayers(players);
      
      // Check if current user is the host - MUST happen after data is fetched
      const currentUserPlayer = players.find(p => p.user_id === user?.id);
      if (currentUserPlayer) {
        const hostStatus = currentUserPlayer.is_host === true;
        console.log('[LobbyScreen] ✅ Current user found:', {
          user_id: user?.id,
          is_host: currentUserPlayer.is_host,
          hostStatus,
          player_index: currentUserPlayer.player_index,
          raw_player_data: JSON.stringify(currentUserPlayer),
        });
        setIsHost(hostStatus);
      } else {
        console.log('[LobbyScreen] ❌ Current user NOT found in players list!', {
          user_id: user?.id,
          all_user_ids: players.map(p => p.user_id),
        });
        setIsHost(false);
      }
    } catch (error: any) {
      console.error('[LobbyScreen] Error loading players:', error);
      // Don't show alert if room was cleaned up (user left)
      // Just navigate home silently
      if (error?.message?.includes('not found') || error?.code === 'PGRST116') {
        console.log('[LobbyScreen] Room no longer exists, navigating home');
        if (!isLeavingRef.current) {
          isLeavingRef.current = true;
          navigation.replace('Home');
        }
      } else {
        Alert.alert('Error', 'Failed to load players');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const subscribeToPlayers = () => {
    const channel = supabase
      .channel(`lobby:${roomCode}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
        },
        () => {
          loadPlayers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleToggleReady = async () => {
    if (isTogglingReady) return;
    
    try {
      setIsTogglingReady(true);
      const currentRoomId = roomId || await getRoomId();
      if (!currentRoomId) return;
      
      const { error } = await supabase
        .from('room_players')
        .update({ is_ready: !isReady })
        .eq('room_id', currentRoomId)
        .eq('user_id', user?.id);

      if (error) throw error;
      setIsReady(!isReady);
    } catch (error: any) {
      console.error('Error toggling ready:', error);
      Alert.alert('Error', 'Failed to update ready status');
    } finally {
      setIsTogglingReady(false);
    }
  };

  const handleStartWithBots = async () => {
    if (isStarting || isStartingRef.current) {
      console.log('⏭️ [LobbyScreen] Start already in progress, ignoring...');
      return;
    }
    
    try {
      isStartingRef.current = true;
      setIsStarting(true);
      const currentRoomId = roomId || await getRoomId();
      if (!currentRoomId) return;

      // Get current user's room_player data
      const { data: roomPlayerData, error: roomPlayerError } = await supabase
        .from('room_players')
        .select('id, username, player_index, is_host')
        .eq('room_id', currentRoomId)
        .eq('user_id', user?.id)
        .single();

      if (roomPlayerError || !roomPlayerData) {
        console.error('Room player lookup error:', roomPlayerError);
        Alert.alert('Error', 'Could not find your player data');
        return;
      }

      // Check if user is host
      if (!roomPlayerData.is_host) {
        Alert.alert('Error', 'Only the host can start the game with bots');
        return;
      }

      // Check if player already exists in players table
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('id')
        .eq('room_id', currentRoomId)
        .eq('player_index', roomPlayerData.player_index)
        .single();

      let playerIdToUse = existingPlayer?.id;

      // If no player entry exists, create one
      if (!playerIdToUse) {
        console.log('Creating player entry for host...');
        const { data: newPlayer, error: createPlayerError } = await supabase
          .from('players')
          .insert({
            room_id: currentRoomId,
            player_name: roomPlayerData.username || 'Player',
            player_index: roomPlayerData.player_index,
            is_bot: false,
            status: 'online',
            cards: [],
            card_order: [],
            score: 0,
            tricks_won: 0,
          })
          .select('id')
          .single();

        if (createPlayerError || !newPlayer) {
          console.error('Error creating player:', createPlayerError);
          Alert.alert('Error', 'Failed to create player entry');
          return;
        }

        playerIdToUse = newPlayer.id;

        // Update room's host_player_id
        await supabase
          .from('rooms')
          .update({ host_player_id: playerIdToUse })
          .eq('id', currentRoomId);

        console.log('Player entry created:', playerIdToUse);
      }

      console.log('Starting game for room:', currentRoomId);

      // ARCHITECTURE: Single-player bot games use CLIENT-SIDE game initialization
      // 
      // Why no RPC call here:
      // - Bots are local AI created by GameStateManager.initializeGame() in GameScreen
      // - No start_game RPC exists (nor is it needed for client-side bots)
      // - GameScreen auto-initializes when mounting: creates 3 bot players, deals cards, starts game
      //
      // Server role: Only tracks room status for lobby UI
      // Bot creation: Happens in apps/mobile/src/game/state.ts:157-180
      // Game state: Stored in client memory (not database) for single-player
      //
      // Note: Multiplayer (4 humans) uses DIFFERENT code path in useRealtime.ts:383-429
      const { error: updateError } = await supabase
        .from('rooms')
        .update({ status: 'playing' })
        .eq('id', currentRoomId);

      if (updateError) {
        throw new Error(`Failed to start game: ${updateError.message}`);
      }

      // Navigate to GameScreen which will:
      // 1. Call createGameStateManager()
      // 2. Run manager.initializeGame({ playerName, botCount: 3, botDifficulty: 'medium' })
      // 3. Create bot players (Bot 1, Bot 2, Bot 3)
      // 4. Deal cards and start game
      navigation.replace('Game', { roomCode });
      setIsStarting(false);
    } catch (error: any) {
      console.error('Error starting game:', error);
      Alert.alert('Error', error.message || 'Failed to start game');
      // Reset immediately on error
      setIsStarting(false);
    } finally {
      // Ensure ref is always reset
      isStartingRef.current = false;
    }
  };

  const handleLeaveRoom = async () => {
    if (isLeavingRef.current || isLeaving) return;
    
    try {
      // Set flag to prevent duplicate navigation
      isLeavingRef.current = true;
      setIsLeavingState(true);
      
      const currentRoomId = roomId || await getRoomId();
      if (!currentRoomId) {
        navigation.replace('Home');
        return;
      }
      
      if (isHost) {
        // Delete the room if host leaves
        const { error } = await supabase
          .from('rooms')
          .delete()
          .eq('id', currentRoomId);
        
        if (error) throw error;
      } else {
        // Remove player from room
        const { error } = await supabase
          .from('room_players')
          .delete()
          .eq('room_id', currentRoomId)
          .eq('user_id', user?.id);
        
        if (error) throw error;
      }
      
      navigation.replace('Home');
    } catch (error: any) {
      console.error('Error leaving room:', error);
      isLeavingRef.current = false; // Reset flag on error
      Alert.alert('Error', 'Failed to leave room');
    }
  };

  const renderPlayer = ({ item }: { item: Player | null }) => {
    if (!item) {
      return (
        <View style={[styles.playerCard, styles.emptySlot]}>
          <Text style={styles.emptyText}>Empty Slot</Text>
        </View>
      );
    }

    const isCurrentUser = item.user_id === user?.id;
    const displayName = item.is_bot 
      ? `Bot ${item.player_index + 1}`
      : item.profiles?.username || 'Player';

    return (
      <View style={[styles.playerCard, isCurrentUser && styles.currentUserCard]}>
        <View style={styles.playerInfo}>
          <Text style={styles.playerName}>{displayName}</Text>
          {isCurrentUser && <Text style={styles.youLabel}>(You)</Text>}
        </View>
        {item.is_ready && (
          <View style={styles.readyBadge}>
            <Text style={styles.readyText}>✓ Ready</Text>
          </View>
        )}
      </View>
    );
  };

  // Create array of 4 slots, filling empty ones with null
  const playerSlots = Array.from({ length: 4 }, (_, i) => 
    players.find(p => p.player_index === i) || null
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.white} />
      </SafeAreaView>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.leaveButton, isLeaving && styles.buttonDisabled]}
          onPress={handleLeaveRoom}
          disabled={isLeaving}
        >
          {isLeaving ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Text style={styles.leaveButtonText}>← Leave</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Game Lobby</Text>
        <View style={styles.roomCodeContainer}>
          <Text style={styles.roomCodeLabel}>Room Code:</Text>
          <Text style={styles.roomCode}>{roomCode}</Text>
        </View>

        <Text style={styles.playersLabel}>
          Players ({players.length}/4)
        </Text>

        <FlatList
          data={playerSlots}
          renderItem={renderPlayer}
          keyExtractor={(_, index) => index.toString()}
          contentContainerStyle={styles.playerList}
        />

        <TouchableOpacity
          style={[styles.readyButton, isReady && styles.readyButtonActive, isTogglingReady && styles.buttonDisabled]}
          onPress={handleToggleReady}
          disabled={isTogglingReady}
        >
          {isTogglingReady ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Text style={styles.readyButtonText}>
              {isReady ? '✓ Ready' : 'Ready Up'}
            </Text>
          )}
        </TouchableOpacity>

        {isHost ? (
          <>
            <TouchableOpacity
              style={[styles.startButton, isStarting && styles.buttonDisabled]}
              onPress={handleStartWithBots}
              disabled={isStarting}
            >
              {isStarting ? (
                <>
                  <ActivityIndicator color={COLORS.white} size="small" />
                  <Text style={[styles.startButtonText, { marginTop: 4 }]}>Starting...</Text>
                </>
              ) : (
                <Text style={styles.startButtonText}>
                  🤖 Start with AI Bots
                </Text>
              )}
            </TouchableOpacity>
            <Text style={styles.hostInfo}>
              You're the host. Start with bots or wait for players.
            </Text>
          </>
        ) : (
          <Text style={styles.waitingInfo}>
            Waiting for host to start the game...
          </Text>
        )}
      </View>
    </SafeAreaView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  header: {
    flexDirection: 'row',
    padding: SPACING.md,
  },
  leaveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  leaveButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
  },
  content: {
    flex: 1,
    padding: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  roomCodeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.xl,
    padding: SPACING.md,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 8,
  },
  roomCodeLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    marginRight: SPACING.sm,
  },
  roomCode: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
    letterSpacing: 2,
  },
  playersLabel: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.white,
    marginBottom: SPACING.md,
  },
  playerList: {
    gap: SPACING.sm,
  },
  playerCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  currentUserCard: {
    borderColor: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  emptySlot: {
    opacity: 0.5,
  },
  playerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  playerName: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    fontWeight: '600',
  },
  youLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
  },
  emptyText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    fontStyle: 'italic',
  },
  readyBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  readyText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  readyButton: {
    backgroundColor: '#3B82F6',
    padding: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: SPACING.xl,
  },
  readyButtonActive: {
    backgroundColor: '#10B981',
  },
  readyButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  startButton: {
    backgroundColor: '#8B5CF6',
    padding: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  startButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  hostInfo: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  waitingInfo: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
    textAlign: 'center',
    marginTop: SPACING.md,
    fontStyle: 'italic',
  },
});