import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Clipboard, Share, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { roomLogger } from '../utils/logger';
import { showError } from '../utils';
import { notifyGameStarted } from '../services/pushNotificationTriggers';
import { i18n } from '../i18n';

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

interface RoomType {
  isPrivate: boolean;   // Private room (not matchmaking, not public)
  isCasual: boolean;    // Casual matchmaking (matchmaking + not ranked)
  isRanked: boolean;    // Ranked matchmaking (matchmaking + ranked)
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
  const [roomType, setRoomType] = useState<RoomType>({
    isPrivate: false,
    isCasual: false,
    isRanked: false,
  });
  const [isMatchmakingRoom, setIsMatchmakingRoom] = useState(false); // Keep for backward compatibility
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
      .select('id, is_matchmaking, is_public, ranked_mode')
      .eq('code', roomCode)
      .single();
    
    if (error || !data) {
      roomLogger.info('[LobbyScreen] Room not found, navigating to Home (likely cleaned up)');
      // Silently navigate home instead of showing error
      // This happens when user leaves game and cleanup removes them from room
      if (!isLeavingRef.current) {
        isLeavingRef.current = true;
        navigation.replace('Home');
      }
      return null;
    }
    
    // Set matchmaking status (backward compatibility)
    setIsMatchmakingRoom(data.is_matchmaking || false);
    
    // Determine room type
    let newRoomType: RoomType = {
      isPrivate: !data.is_matchmaking && !data.is_public,
      isCasual: !!data.is_matchmaking && !data.ranked_mode,
      isRanked: !!data.is_matchmaking && !!data.ranked_mode,
    };

    // Fallback: handle edge case where no room type is detected.
    // This occurs for public non-matchmaking rooms (is_public=true, is_matchmaking=false).
    // These are treated as "casual" rooms since they allow bot filling and aren't ranked.
    // Note: This is intentional - public rooms without matchmaking should behave like casual games.
    if (!newRoomType.isPrivate && !newRoomType.isCasual && !newRoomType.isRanked) {
      roomLogger.warn('[LobbyScreen] Room type fallback applied - treating public non-matchmaking as casual', {
        code: roomCode,
        is_matchmaking: data.is_matchmaking,
        is_public: data.is_public,
        ranked_mode: data.ranked_mode,
      });
      newRoomType = { isPrivate: false, isCasual: true, isRanked: false };
    }
    
    setRoomType(newRoomType);
    roomLogger.info('[LobbyScreen] Room type detected:', newRoomType);
    
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
      
      roomLogger.info('[LobbyScreen] Loading players for room:', currentRoomId, 'user:', user?.id);
      
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
        // Only log error message/code to avoid exposing DB internals
        roomLogger.error('[LobbyScreen] Query error:', error?.message || error?.code || 'Unknown error');
        throw error;
      }
      
      roomLogger.info('[LobbyScreen] Raw query data:', JSON.stringify(data, null, 2));
      
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
        roomLogger.info('[LobbyScreen] ✅ Current user found:', {
          user_id: user?.id,
          is_host: currentUserPlayer.is_host,
          hostStatus,
          player_index: currentUserPlayer.player_index,
          raw_player_data: JSON.stringify(currentUserPlayer),
        });
        setIsHost(hostStatus);
      } else {
        roomLogger.info('[LobbyScreen] ❌ Current user NOT found in players list!', {
          user_id: user?.id,
          all_user_ids: players.map(p => p.user_id),
        });
        setIsHost(false);
      }
    } catch (error: any) {
      roomLogger.error('[LobbyScreen] Error loading players:', error?.message || error?.code || String(error));
      // Don't show alert if room was cleaned up (user left)
      // Just navigate home silently
      if (error?.message?.includes('not found') || error?.code === 'PGRST116') {
        roomLogger.info('[LobbyScreen] Room no longer exists, navigating home');
        if (!isLeavingRef.current) {
          isLeavingRef.current = true;
          navigation.replace('Home');
        }
      } else {
        showError(i18n.t('lobby.loadPlayersError'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const subscribeToPlayers = () => {
    roomLogger.info(`[LobbyScreen] Setting up subscriptions for room: ${roomCode}`);
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
          roomLogger.info('[LobbyScreen] room_players changed, reloading players...');
          loadPlayers();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `code=eq.${roomCode}`,
        },
        (payload: any) => {
          roomLogger.info('[LobbyScreen] Rooms table UPDATE event received:', {
            oldStatus: payload.old?.status,
            newStatus: payload.new?.status,
            roomCode: payload.new?.code,
            isLeaving: isLeavingRef.current
          });
          
          // CRITICAL: Auto-navigate ALL players (including host) when game starts
          // Do NOT check isStartingRef - let subscription handle navigation for everyone
          if (payload.new?.status === 'playing' && !isLeavingRef.current) {
            roomLogger.info('[LobbyScreen] Room status changed to playing, navigating ALL players to game...');
            // CRITICAL FIX: Pass forceNewGame: true to prevent loading stale cached game state
            // This ensures all players start with fresh state from server, not AsyncStorage
            navigation.replace('Game', { roomCode, forceNewGame: true });
          }
        }
      )
      .subscribe((status, err) => {
        roomLogger.info(`[LobbyScreen] Subscription status: ${status}`, err ? { error: err } : {});
      });

    return () => {
      roomLogger.info(`[LobbyScreen] Unsubscribing from room: ${roomCode}`);
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
      roomLogger.error('Error toggling ready:', error?.message || error?.code || String(error));
      showError(i18n.t('lobby.readyStatusError'));
    } finally {
      setIsTogglingReady(false);
    }
  };

  const handleCopyCode = () => {
    Clipboard.setString(roomCode);
    Alert.alert(
      i18n.t('lobby.copiedTitle') || 'Copied!',
      i18n.t('lobby.copiedMessage', { roomCode }) || `Room code ${roomCode} copied to clipboard`
    );
  };

  const handleShareCode = async () => {
    try {
      // Note: Share object is always truthy when imported from react-native, even if unsupported.
      // We rely on try-catch to detect platform limitations (e.g., ERR_UNSUPPORTED_ACTIVITY on web).
      if (!Share || typeof Share.share !== 'function') {
        handleCopyCode();
        Alert.alert(
          i18n.t('lobby.shareNotAvailable') || 'Sharing not available',
          i18n.t('lobby.shareNotAvailableMessage') || 'Sharing is not supported on this device. The room code has been copied to your clipboard.'
        );
        return;
      }

      await Share.share({
        message: i18n.t('lobby.shareMessage', { roomCode }) || `Join my Big Two game! Room code: ${roomCode}`,
        title: i18n.t('lobby.shareTitle') || 'Join Big Two Game',
      });
    } catch (error: any) {
      // User dismissed the share dialog - this is normal behavior, don't show error
      const errorMsg = error?.message?.toLowerCase() || '';
      if (errorMsg.includes('cancel') || errorMsg.includes('dismiss') || error?.code === 'ABORT') {
        roomLogger.info('[LobbyScreen] User dismissed share dialog');
        return;
      }
      
      // Actual error occurred
      roomLogger.error('Error sharing room code:', error?.message || error);
      Alert.alert(
        i18n.t('lobby.shareError') || 'Unable to share',
        i18n.t('lobby.shareErrorMessage') || 'There was a problem sharing the room code. You can copy and share it manually.'
      );
    }
  };

  const handleStartWithBots = async () => {
    if (isStarting || isStartingRef.current) {
      roomLogger.info('⏭️ [LobbyScreen] Start already in progress, ignoring...');
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
        roomLogger.error('Room player lookup error:', roomPlayerError?.message || roomPlayerError?.code || 'Unknown error');
        showError(i18n.t('lobby.playerDataNotFound'));
        return;
      }

      // Check if user is host
      if (!roomPlayerData.is_host) {
        showError(i18n.t('lobby.onlyHostCanStart'));
        return;
      }

      // CRITICAL: Count human players to determine bot count
      const humanCount = players.filter(p => !p.is_bot).length;
      const botsNeeded = 4 - humanCount;

      roomLogger.info(`🎮 [LobbyScreen] Starting game: ${humanCount} humans, ${botsNeeded} bots needed`);

      if (botsNeeded < 0) {
        showError('Too many players! Maximum 4 players allowed.');
        return;
      }

      if (humanCount === 0) {
        showError('Cannot start game without any players!');
        return;
      }

      // ARCHITECTURE DECISION: 
      // - Solo game (1 human + 3 bots): Use CLIENT-SIDE game engine
      // - Multiplayer (2-4 humans + bots): Use SERVER-SIDE game engine with bot support
      
      if (humanCount === 1 && botsNeeded === 3) {
        // SOLO GAME: Navigate to GameScreen with LOCAL_AI_GAME flag
        // GameScreen will use GameStateManager (client-side engine)
        roomLogger.info('📱 [LobbyScreen] Solo game - using client-side engine');
        
        // Update room status
        const { error: updateError } = await supabase
          .from('rooms')
          .update({ status: 'playing' })
          .eq('id', currentRoomId);

        if (updateError) throw updateError;

        // Navigate with forceNewGame flag to clear cached state
        navigation.replace('Game', { roomCode: 'LOCAL_AI_GAME', forceNewGame: true });
        setIsStarting(false);
        return;
      }

      // MULTIPLAYER GAME: Use server-side engine with bot support
      roomLogger.info(`🌐 [LobbyScreen] Multiplayer game - using server-side engine with ${botsNeeded} bots`);

      // Call start_game_with_bots RPC function
      const { data: startResult, error: startError } = await supabase
        .rpc('start_game_with_bots', {
          p_room_id: currentRoomId,
          p_bot_count: botsNeeded,
          p_bot_difficulty: 'medium',
        });

      if (startError) {
        throw new Error(`Failed to start game: ${startError.message}`);
      }

      roomLogger.info('✅ [LobbyScreen] Game started successfully:', startResult);

      // 🔔 Send push notification
      roomLogger.info('📤 Sending game start notification...');
      notifyGameStarted(currentRoomId, roomCode).catch(err => 
        roomLogger.error('❌ Failed to send game start notification:', err)
      );

      // DO NOT manually navigate - let Realtime subscription handle navigation for ALL players
      // The subscription will fire when room status changes to 'playing'
      roomLogger.info('⏳ [LobbyScreen] Waiting for Realtime subscription to navigate all players...');
      setIsStarting(false);
    } catch (error: any) {
      roomLogger.error('Error starting game:', error?.message || error?.code || String(error));
      showError(error.message || i18n.t('lobby.startGameError'));
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
      roomLogger.error('Error leaving room:', error?.message || error?.code || String(error));
      isLeavingRef.current = false; // Reset flag on error
      showError(i18n.t('lobby.leaveRoomError'));
    }
  };

  const renderPlayer = ({ item, index }: { item: Player | null; index: number }) => {
    if (!item) {
      return (
        <View style={[styles.playerCard, styles.emptySlot]}>
          <Text style={styles.emptyText}>{i18n.t('lobby.emptySlot')}</Text>
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
          {item.is_host && (
            <View style={styles.hostBadge}>
              <Text style={styles.hostText}>👑 HOST</Text>
            </View>
          )}
          <Text style={styles.playerName}>{displayName}</Text>
          {isCurrentUser && <Text style={styles.youLabel}>({i18n.t('lobby.you')})</Text>}
        </View>
        {item.is_ready && (
          <View style={styles.readyBadge}>
            <Text style={styles.readyText}>✓ {i18n.t('lobby.ready')}</Text>
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
            <Text style={styles.leaveButtonText}>← {i18n.t('lobby.leaveRoom')}</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
      <View style={styles.content}>
        <Text style={styles.title}>{i18n.t('lobby.title')}</Text>
        
        {/* Room Type Badge - Color-coded by room type for visual distinction */}
        {/* Uses chained OR for clean fallback: evaluates left-to-right, stops at first truthy value */}
        <View style={[
          styles.roomTypeBadge,
          roomType.isRanked && styles.roomTypeBadgeRanked,
          roomType.isCasual && styles.roomTypeBadgeCasual,
          roomType.isPrivate && styles.roomTypeBadgePrivate,
        ]}>
          <Text style={styles.roomTypeBadgeText}>
            {(roomType.isRanked && `🏆 ${i18n.t('lobby.rankedMatch') || 'Ranked Match'}`) ||
             (roomType.isCasual && `🎮 ${i18n.t('lobby.casualMatch') || 'Casual Match'}`) ||
             (roomType.isPrivate && `🔒 ${i18n.t('lobby.privateRoom') || 'Private Room'}`) ||
             (i18n.t('lobby.roomLoading') || 'Loading...')}
          </Text>
        </View>
        
        {/* Room Code Card with Copy/Share */}
        <View style={styles.roomCodeCard}>
          <View style={styles.roomCodeHeader}>
            <Text style={styles.roomCodeLabel}>{i18n.t('lobby.roomCode')}:</Text>
            <Text style={styles.roomCode}>{roomCode}</Text>
          </View>
          <View style={styles.roomCodeActions}>
            <TouchableOpacity 
              style={styles.roomCodeButton}
              onPress={handleCopyCode}
            >
              <Text style={styles.roomCodeButtonText}>{i18n.t('lobby.copy') || '📋 Copy'}</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.roomCodeButton}
              onPress={handleShareCode}
            >
              <Text style={styles.roomCodeButtonText}>{i18n.t('lobby.share') || '📤 Share'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.playersLabel}>
          {i18n.t('lobby.players')} ({players.length}/4)
        </Text>

        <View style={styles.playerList}>
          {playerSlots.map((item, index) => (
            <View key={`player-slot-${index}`}>
              {renderPlayer({ item, index })}
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.readyButton, isReady && styles.readyButtonActive, isTogglingReady && styles.buttonDisabled]}
          onPress={handleToggleReady}
          disabled={isTogglingReady}
        >
          {isTogglingReady ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Text style={styles.readyButtonText}>
              {isReady ? `✓ ${i18n.t('lobby.ready')}` : i18n.t('lobby.readyUp')}
            </Text>
          )}
        </TouchableOpacity>

        {/* Bot Filling Controls - Only for Casual/Private (NOT Ranked) */}
        {/* Calculate once for performance and consistency */}
        {(() => {
          const humanPlayerCount = players.filter(p => !p.is_bot).length;
          const botsNeeded = 4 - humanPlayerCount;
          
          return (isHost || isMatchmakingRoom) && !roomType.isRanked ? (
            <>
              {/* Show bot count and start button if less than 4 humans */}
              {humanPlayerCount < 4 && (
                <View style={styles.botFillingContainer}>
                  <Text style={styles.botFillingLabel}>
                    {i18n.t('lobby.humanPlayers') || 'Human Players'}: {humanPlayerCount}/4
                  </Text>
                  <Text style={styles.botFillingLabel}>
                    {i18n.t('lobby.botsNeeded') || 'Bots needed'}: {botsNeeded}
                  </Text>
                </View>
              )}
              
              {/* Start button shows when less than 4 humans (consistent with bot count display) */}
              {humanPlayerCount < 4 && (
                <TouchableOpacity
                  style={[styles.startButton, isStarting && styles.buttonDisabled]}
                  onPress={handleStartWithBots}
                  disabled={isStarting}
                >
                  {isStarting ? (
                    <>
                      <ActivityIndicator color={COLORS.white} size="small" />
                      <Text style={[styles.startButtonText, { marginTop: 4 }]}>{i18n.t('lobby.starting')}...</Text>
                    </>
                  ) : (
                    <Text style={styles.startButtonText}>
                      {i18n.t('lobby.startWithBotsCount', {
                        count: botsNeeded,
                      }) || `🤖 Start with ${botsNeeded} AI Bot(s)`}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
              
              <Text style={styles.hostInfo}>
                {roomType.isCasual 
                  ? i18n.t('lobby.casualRoomInfo') || 'Anyone can start this casual game'
                  : i18n.t('lobby.hostInfo')
                }
              </Text>
            </>
          ) : null;
        })()}
        
        {/* Ranked mode - require 4 human players (no bots) */}
        {roomType.isRanked && (() => {
          const humanPlayerCount = players.filter(p => !p.is_bot).length;
          return (
            <View style={styles.rankedInfo}>
              <Text style={styles.rankedInfoText}>
                🏆 {i18n.t('lobby.rankedRequirement') || 'Ranked matches require 4 human players'}
              </Text>
              <Text style={styles.rankedInfoText}>
                {humanPlayerCount < 4
                  ? i18n.t('lobby.waitingForMorePlayers') || 'Waiting for more players...'
                  : i18n.t('lobby.allReadyToStart') || 'All ready to start!'}
              </Text>
            </View>
          );
        })()}
        
        {/* Non-host in private room */}
        {!roomType.isRanked && !isHost && !isMatchmakingRoom && (
          <Text style={styles.waitingInfo}>
            {i18n.t('lobby.waitingForHost')}
          </Text>
        )}
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
  header: {
    flexDirection: 'row',
    padding: SPACING.md,
    backgroundColor: COLORS.primary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: SPACING.xl,
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
  roomTypeBadge: {
    alignSelf: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
    borderRadius: 12,
    marginBottom: SPACING.md,
  },
  roomTypeBadgeText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
  },
  roomCodeCard: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 12,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    borderWidth: 2,
    borderColor: 'rgba(59, 130, 246, 0.4)',
  },
  roomCodeHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  roomCodeActions: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  roomCodeButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
    minWidth: 100,
    marginHorizontal: SPACING.sm,
  },
  roomCodeButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    textAlign: 'center',
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
  },
  hostBadge: {
    marginRight: SPACING.sm,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  hostText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  playerName: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    fontWeight: '600',
    marginRight: SPACING.sm,
  },
  // Note: youLabel gets marginRight even as last element for visual balance
  // Alternative would be conditional styling based on badge presence
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
  botFillingContainer: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    padding: SPACING.md,
    borderRadius: 8,
    marginTop: SPACING.md,
  },
  botFillingLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    textAlign: 'center',
    marginVertical: 2,
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
  rankedInfo: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    padding: SPACING.lg,
    borderRadius: 8,
    marginTop: SPACING.md,
  },
  rankedInfoText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    textAlign: 'center',
    marginVertical: 4,
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