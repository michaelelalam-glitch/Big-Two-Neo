import React, { useEffect, useState, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Share, Alert } from 'react-native';
// Guarded require: expo-clipboard's native module may not be available in Expo Go / web
// eslint-disable-next-line @typescript-eslint/no-require-imports
let Clipboard: typeof import('expo-clipboard') | null = null;
try { Clipboard = require('expo-clipboard') as typeof import('expo-clipboard'); } catch { /* native module unavailable */ }
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { notifyGameStarted } from '../services/pushNotificationTriggers';
import { supabase } from '../services/supabase';
import { showError } from '../utils';
import { roomLogger } from '../utils/logger';

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

/**
 * Room type classification - exactly one of these flags should be true at a time.
 * Represents mutually exclusive room categories based on matchmaking and ranked flags.
 */
interface RoomType {
  isPrivate: boolean;   // Private room (not matchmaking, not public)
  isCasual: boolean;    // Casual matchmaking (matchmaking + not ranked)
  isRanked: boolean;    // Ranked matchmaking (matchmaking + ranked)
}

export default function LobbyScreen() {
  const navigation = useNavigation<LobbyScreenNavigationProp>();
  const route = useRoute<LobbyScreenRouteProp>();
  const { roomCode, playAgain = false } = route.params;
  const { user, profile } = useAuth();
  
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
  const [, setIsMatchmakingRoom] = useState(false);
  const [isTogglingReady, setIsTogglingReady] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isLeaving, setIsLeavingState] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [isGameInProgress, setIsGameInProgress] = useState(false); // Room already 'playing' (rejoin)
  const isLeavingRef = useRef(false); // Prevent double navigation
  const isStartingRef = useRef(false); // Prevent duplicate start-game calls
  const roomIdRef = useRef<string | null>(null); // Stable ref so subscription callbacks don't use stale closure
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadPlayersRef = useRef<() => Promise<void>>(async () => {});
  
  // Performance optimization: Calculate human player count once using useMemo
  const humanPlayerCount = useMemo(() => players.filter(p => !p.is_bot).length, [players]);

  // All non-host, non-bot players must be ready before the host can start.
  // The host is not required to toggle ready — they are implicitly ready as the initiator.
  const allNonHostHumansReady = useMemo(
    () => players.filter(p => !p.is_bot && !p.is_host).every(p => p.is_ready),
    [players]
  );

  // Always keep loadPlayersRef pointing at latest loadPlayers (avoids stale closures in subscriptions)
  useEffect(() => {
    loadPlayersRef.current = loadPlayers;
  });

  useEffect(() => {
    loadPlayers();
    return subscribeToRoomsTable();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPlayers and subscribeToRoomsTable intentionally excluded; correct trigger is roomCode
  }, [roomCode]);

  // Set up filtered room_players subscription only once roomId is known.
  // Filtering by room_id prevents firing for other rooms' player changes (global subscription bug).
  useEffect(() => {
    if (!roomId) return;
    const channel = supabase
      .channel(`lobby-players:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          loadPlayersRef.current();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roomId is the correct trigger; loadPlayersRef is a stable ref
  }, [roomId]);

  const getRoomId = async () => {
    const { data, error } = await supabase
      .from('rooms')
      .select('id, status, is_matchmaking, is_public, ranked_mode, host_id')
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

    // Track whether room is already in progress (rejoin scenario)
    if (data.status === 'playing') {
      setIsGameInProgress(true);
    }

    // Handle ended/finished rooms: reset to 'waiting' for Play Again, otherwise send home.
    // Accept both 'ended' (legacy) and 'finished' (current complete-game Step 3b value).
    if (data.status === 'ended' || data.status === 'finished') {
      if (playAgain) {
        if (user?.id === data.host_id) {
          // Only the original room host may reset status — other players would
          // be rejected by the RLS UPDATE policy (host_id = auth.uid()).
          const { error: resetError } = await supabase
            .from('rooms')
            .update({ status: 'waiting' })
            .eq('code', roomCode);
          if (resetError) {
            roomLogger.error('[LobbyScreen] Failed to reset ended room for Play Again:', resetError.message);
            if (!isLeavingRef.current) {
              isLeavingRef.current = true;
              navigation.replace('Home');
            }
            return null;
          }
          roomLogger.info('[LobbyScreen] Room reset to waiting for Play Again (host)');
        } else {
          // Non-host: cannot update the room row.  Return the room_id so the
          // subscription channel is established; subscribeToRoomsTable will
          // call loadPlayers() once the host's reset fires status='waiting'.
          roomLogger.info('[LobbyScreen] Play Again: non-host waiting for host to reset room');
          return data.id;
        }
      } else {
        roomLogger.info('[LobbyScreen] Room ended and not a play-again — navigating Home');
        if (!isLeavingRef.current) {
          isLeavingRef.current = true;
          navigation.replace('Home');
        }
        return null;
      }
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
      // Get roomId - prefer the stable ref (always current), fall back to state, then fetch
      let currentRoomId = roomIdRef.current || roomId;
      if (!currentRoomId) {
        currentRoomId = await getRoomId();
        if (!currentRoomId) return; // Room not found, getRoomId handles navigation
        roomIdRef.current = currentRoomId;
        setRoomId(currentRoomId);
      }
      
      // REMOVED: Console spam - subscription triggers this on every room_players change
      // roomLogger.info('[LobbyScreen] Loading players for room:', currentRoomId, 'user:', user?.id);
      
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
      
      // ── Host reassignment fallback ──
      // If no player in the room has is_host = true (e.g. original host left),
      // promote the first human player (lowest player_index) as host.
      // This is a client-side fallback — the SQL migration handles it server-side.
      const hasActiveHost = players.some((p: Player) => p.is_host === true);
      if (!hasActiveHost && players.length > 0 && user?.id) {
        const humanPlayers = players.filter((p: Player) => !p.is_bot && p.user_id);
        const firstHuman = humanPlayers.sort((a: Player, b: Player) => a.player_index - b.player_index)[0];
        if (firstHuman && firstHuman.user_id === user.id) {
          roomLogger.info('[LobbyScreen] 👑 No active host found — promoting current user as host');
          // Update server: room_players.is_host and rooms.host_id
          const { error: playerUpdateError } = await supabase
            .from('room_players')
            .update({ is_host: true })
            .eq('room_id', currentRoomId)
            .eq('user_id', user.id);
          if (playerUpdateError) {
            roomLogger.error('[LobbyScreen] ❌ Failed to update room_players.is_host:', playerUpdateError.message);
          }
          const { error: roomUpdateError } = await supabase
            .from('rooms')
            .update({ host_id: user.id })
            .eq('id', currentRoomId);
          if (roomUpdateError) {
            roomLogger.error('[LobbyScreen] ❌ Failed to update rooms.host_id:', roomUpdateError.message);
          }
          if (!playerUpdateError && !roomUpdateError) {
            // Update local state only on success
            firstHuman.is_host = true;
          } else {
            roomLogger.warn('[LobbyScreen] ⚠️ Host reassignment partially failed — local state not updated');
          }
        }
      }

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

        // Play Again: re-join the reset room atomically. join_room_atomic handles
        // player_index assignment and host promotion so whichever player arrives
        // first becomes the new host naturally.
        if (playAgain && user && !isLeavingRef.current) {
          const username = profile?.username || user.email?.split('@')[0] || 'Player';
          roomLogger.info('[LobbyScreen] Play Again — auto-joining reset room as:', username);
          const { error: joinError } = await supabase.rpc('join_room_atomic', {
            p_room_code: roomCode,
            p_user_id: user.id,
            p_username: username,
          });
          if (joinError) {
            roomLogger.error('[LobbyScreen] Failed to re-join for Play Again:', joinError.message);
          }
          // loadPlayers will be called again via the room_players realtime subscription
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const code = error instanceof Object && 'code' in error ? String((error as Record<string, unknown>).code) : '';
      roomLogger.error('[LobbyScreen] Error loading players:', msg);
      // Don't show alert if room was cleaned up (user left)
      // Just navigate home silently
      if (msg.includes('not found') || code === 'PGRST116') {
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

  // Subscribes only to rooms table changes for this room (status updates, etc.)
  // room_players changes are handled by a separate filtered subscription (see useEffect for roomId).
  const subscribeToRoomsTable = () => {
    roomLogger.info(`[LobbyScreen] Setting up rooms subscription for room: ${roomCode}`);
    const channel = supabase
      .channel(`lobby-rooms:${roomCode}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `code=eq.${roomCode}`,
        },
        (payload: { old?: { status?: string }; new?: { status?: string; code?: string } }) => {
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
            
            // CRITICAL FIX: Add a small delay to ensure game_state INSERT has propagated
            // The backend creates game_state BEFORE updating room status, but Realtime
            // subscriptions may receive events out of order. This 100ms delay ensures
            // the frontend's game_state subscription has time to receive the INSERT event.
            setTimeout(() => {
              // CRITICAL FIX: Pass forceNewGame: true to prevent loading stale cached game state
              // This ensures all players start with fresh state from server, not AsyncStorage.
              // Pass botDifficulty so the host's selected difficulty is preserved in stats.
              navigation.replace('Game', { roomCode, forceNewGame: true, botDifficulty });
            }, 100);
          } else if (payload.new?.status === 'waiting' && playAgain && !isLeavingRef.current) {
            // Host has reset the room for Play Again — non-host players waiting
            // on the ended room can now auto-join via join_room_atomic.
            roomLogger.info('[LobbyScreen] Room reset to waiting (Play Again) — triggering auto-join');
            loadPlayersRef.current();
          }
        }
      )
      .subscribe((status, err) => {
        roomLogger.info(`[LobbyScreen] Rooms subscription status: ${status}`, err ? { error: err } : {});
      });

    return () => {
      roomLogger.info(`[LobbyScreen] Unsubscribing from rooms channel: ${roomCode}`);
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
    } catch (error: unknown) {
      roomLogger.error('Error toggling ready:', error instanceof Error ? error.message : String(error));
      showError(i18n.t('lobby.readyStatusError'));
    } finally {
      setIsTogglingReady(false);
    }
  };

  const handleCopyCode = async () => {
    let copySucceeded = false;
    try {
      if (Clipboard) {
        await Clipboard.setStringAsync(roomCode);
        copySucceeded = true;
      }
    } catch {
      // clipboard unavailable in this environment
    }
    if (copySucceeded) {
      Alert.alert(
        i18n.t('lobby.copiedTitle'),
        i18n.t('lobby.copiedMessage', { roomCode })
      );
    } else {
      // ExpoClipboard unavailable (e.g. Expo Go on beta iOS) — fall back to
      // the native Share sheet which has a Copy option built in.
      try {
        await Share.share({
          message: roomCode,
          title: i18n.t('lobby.shareTitle'),
        });
      } catch {
        // Share also dismissed/unavailable — last resort: show room code
        Alert.alert(
          i18n.t('lobby.copyFailedTitle'),
          i18n.t('lobby.copyFailedMessage', { roomCode })
        );
      }
    }
  };

  const handleShareCode = async () => {
    try {
      // We rely on try-catch to detect platform limitations (e.g., ERR_UNSUPPORTED_ACTIVITY on web).
      await Share.share({
        message: i18n.t('lobby.shareMessage', { roomCode }) || `Join my Big Two game! Room code: ${roomCode}`,
        title: i18n.t('lobby.shareTitle') || 'Join Big Two Game',
      });
    } catch (error: unknown) {
      // User dismissed the share dialog - this is normal behavior, don't show error
      const errorMsg = (error instanceof Error ? error.message : '').toLowerCase();
      const errorCode = (error instanceof Object && 'code' in error ? String((error as Record<string, unknown>).code) : '').toLowerCase();
      const errorName = (error instanceof Error ? error.name : '').toLowerCase();
      
      if (
        errorMsg.includes('cancel') ||
        errorMsg.includes('dismiss') ||
        errorCode === 'abort' ||
        errorName === 'abort' ||
        errorName === 'aborterror'
      ) {
        roomLogger.info('[LobbyScreen] User dismissed share dialog');
        return;
      }
      
      // Actual error occurred
      roomLogger.error('Error sharing room code:', error instanceof Error ? error.message : String(error));
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

    // Guard: all non-host human players must be ready before the host can start
    const nonHostHumans = players.filter(p => !p.is_bot && !p.is_host);
    if (nonHostHumans.some(p => !p.is_ready)) {
      showError(i18n.t('lobby.notAllPlayersReady') || 'All players must be ready before starting');
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

      // If the room already started, don't try to start again
      const { data: roomStatusData, error: roomStatusError } = await supabase
        .from('rooms')
        .select('status')
        .eq('id', currentRoomId)
        .single();
      if (!roomStatusError && roomStatusData?.status === 'playing') {
        roomLogger.info('[LobbyScreen] Room already playing; navigating to game');
        navigation.replace('Game', { roomCode, forceNewGame: true });
        setIsStarting(false);
        return;
      }

      // Host check: Only the host can start the game in ALL room types
      // Server-side RPC also enforces this (coordinator = first human player = host)
      if (!roomPlayerData.is_host) {
        showError(i18n.t('lobby.onlyHostCanStart'));
        return;
      }

      // CRITICAL: Determine bot count using humans (desired) AND current occupancy (safety)
      const humanCount = players.filter((p) => !p.is_bot).length;
      const totalCount = players.length;
      const openSeats = Math.max(0, 4 - totalCount);

      // The RPC historically expects "bot_count based on humans" (human + bot = 4)
      // but we must also handle rooms that already contain bots.
      const desiredBotCount = Math.max(0, 4 - humanCount);

      roomLogger.info(`🎮 [LobbyScreen] Starting game: ${humanCount} humans, ${totalCount}/4 filled, ${openSeats} open seats, desired bots=${desiredBotCount}`);

      if (totalCount > 4) {
        showError('Too many players! Maximum 4 players allowed.');
        return;
      }

      if (humanCount === 0) {
        showError('Cannot start game without any players!');
        return;
      }

      // Call start_game_with_bots RPC function.
      // Navigation is handled by the rooms UPDATE realtime subscription when status becomes 'playing'.
      const { data: startResult, error: startError } = await supabase.rpc('start_game_with_bots', {
        p_room_id: currentRoomId,
        p_bot_count: desiredBotCount,
        p_bot_difficulty: botDifficulty,
      });

      if (startError) {
        throw new Error(`Failed to start game: ${startError.message}`);
      }

      if (!startResult || startResult.success !== true) {
        const errMsg = startResult?.error || 'Failed to start game';
        throw new Error(errMsg);
      }

      roomLogger.info('✅ [LobbyScreen] Game started successfully:', startResult);

      // 🔔 Send push notification
      roomLogger.info('📤 Sending game start notification...');
      notifyGameStarted(currentRoomId, roomCode).catch(err => 
        roomLogger.error('❌ Failed to send game start notification:', err)
      );

      // DO NOT manually navigate - let Realtime subscription handle navigation for ALL players
      // The subscription will fire when room status changes to 'playing'
      // CRITICAL: Set isGameInProgress BEFORE clearing isStarting so the auto-start useEffect
      // (which depends on isStarting) cannot re-fire handleStartWithBots a second time.
      roomLogger.info('⏳ [LobbyScreen] Waiting for Realtime subscription to navigate all players...');
      setIsGameInProgress(true);
      setIsStarting(false);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      roomLogger.error('Error starting game:', msg);
      showError(msg || i18n.t('lobby.startGameError'));
      // Reset immediately on error
      setIsStarting(false);
    } finally {
      // Ensure ref is always reset
      isStartingRef.current = false;
    }
  };

  // Auto-start when the room is full (4 humans) and every non-host has pressed ready.
  // Applies to casual, private, and ranked rooms — no bots are needed.
  // Only the host's client fires start_game_with_bots; isStartingRef prevents double-firing.
  useEffect(() => {
    if (
      humanPlayerCount === 4 &&
      allNonHostHumansReady &&
      isHost &&
      !isStarting &&
      !isStartingRef.current &&
      !isGameInProgress
    ) {
      roomLogger.info('[LobbyScreen] 🚀 Auto-starting: full room of 4 humans, all non-host players ready');
      handleStartWithBots();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleStartWithBots is not memoised; isStartingRef is a stable ref
  }, [humanPlayerCount, allNonHostHumansReady, isHost, isStarting, isGameInProgress]);

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
    } catch (error: unknown) {
      roomLogger.error('Error leaving room:', error instanceof Error ? error.message : String(error));
      isLeavingRef.current = false; // Reset flag on error
      showError(i18n.t('lobby.leaveRoomError'));
    }
  };

  const renderPlayer = ({ item, index: _index }: { item: Player | null; index: number }) => {
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
        ]}>
          <Text style={styles.roomTypeBadgeText}>
            {(roomType.isRanked && i18n.t('lobby.rankedMatch')) ||
             (roomType.isCasual && `🎮 ${i18n.t('lobby.casualMatch')}`) ||
             (roomType.isPrivate && i18n.t('lobby.privateRoom')) ||
             i18n.t('lobby.title')}
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

        {/* Rejoin Game button — shown when room is already 'playing' (rejoin scenario) */}
        {isGameInProgress ? (
          <TouchableOpacity
            style={styles.rejoinButton}
            onPress={() => navigation.replace('Game', { roomCode })}
          >
            <Text style={styles.rejoinButtonText}>🎮 Rejoin Game</Text>
          </TouchableOpacity>
        ) : (
          <>
            {/* The host does not need to toggle ready — only non-host human players do. */}
            {!isHost && (
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
            )}
          </>
        )}

        {/* Bot Filling Controls - Host only, for Casual/Private (NOT Ranked) */}
        {/* Hidden when game is already in progress (rejoin) since bots are already set */}
        {/* Performance: humanPlayerCount calculated once via useMemo */}
        {isHost && !roomType.isRanked && !isGameInProgress ? (
          <>
            {/* Show bot count and start button if less than 4 humans */}
            {humanPlayerCount < 4 && (
              <>
                {/* Bot Difficulty Selector */}
                <View style={styles.difficultyContainer}>
                  <Text style={styles.difficultyLabel}>{i18n.t('lobby.botDifficultyLabel')}</Text>
                  <View style={styles.difficultyButtons}>
                    {(['easy', 'medium', 'hard'] as const).map((level) => (
                      <TouchableOpacity
                        key={level}
                        style={[
                          styles.difficultyButton,
                          botDifficulty === level && styles.difficultyButtonActive,
                        ]}
                        onPress={() => setBotDifficulty(level)}
                      >
                        <Text
                          style={[
                            styles.difficultyButtonText,
                            botDifficulty === level && styles.difficultyButtonTextActive,
                          ]}
                        >
                          {i18n.t(`lobby.${level}`)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </>
            )}
            
            {/* Start button: shown when bots are needed OR when 4 humans are all ready */}
            {/* Always visible for host so there's a manual fallback if auto-start misfires */}
            {(humanPlayerCount < 4 || allNonHostHumansReady) && (
              <TouchableOpacity
                style={[styles.startButton, (isStarting || !allNonHostHumansReady) && styles.buttonDisabled]}
                onPress={handleStartWithBots}
                disabled={isStarting || !allNonHostHumansReady}
              >
                {isStarting ? (
                  <>
                    <ActivityIndicator color={COLORS.white} size="small" />
                    <Text style={[styles.startButtonText, { marginTop: 4 }]}>{i18n.t('lobby.starting')}...</Text>
                  </>
                ) : humanPlayerCount >= 4 ? (
                  <Text style={styles.startButtonText}>🎮 Start Game</Text>
                ) : (
                  <Text style={styles.startButtonText}>
                    {i18n.t('lobby.startWithBotsCount', {
                      count: 4 - humanPlayerCount,
                    }) || `🤖 Start with ${4 - humanPlayerCount} AI Bot(s)`}
                  </Text>
                )}
              </TouchableOpacity>
            )}
            
            <Text style={styles.hostInfo}>
              {i18n.t('lobby.hostInfo') || 'Only the host can start the game'}
            </Text>
          </>
        ) : null}
        
        {/* Ranked mode - require 4 human players (no bots) */}
        {roomType.isRanked && (
          <View style={styles.rankedInfo}>
            <Text style={styles.rankedInfoText}>
              🏆 {i18n.t('lobby.rankedRequirement') || 'Ranked matches require 4 human players'}
            </Text>
            <Text style={styles.rankedInfoText}>
              {humanPlayerCount < 4
                ? i18n.t('lobby.waitingForMorePlayers') || 'Waiting for more players...'
                : isStarting
                  ? i18n.t('lobby.starting') + '...' || 'Starting...'
                  : allNonHostHumansReady
                    ? i18n.t('lobby.allReadyToStart') || 'All ready to start!'
                    : i18n.t('lobby.waitingForPlayers') || 'Waiting for players to ready up...'}
            </Text>
          </View>
        )}
        
        {/* Non-host players: show waiting message in all non-ranked rooms */}
        {!roomType.isRanked && !isHost && !isGameInProgress && (
          <Text style={styles.waitingInfo}>
            {humanPlayerCount === 4 && allNonHostHumansReady
              ? i18n.t('lobby.starting') + '...' || 'Starting...'
              : i18n.t('lobby.waitingForHost') || 'Waiting for host to start the game...'}
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
  rejoinButton: {
    backgroundColor: '#10B981',
    padding: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: SPACING.xl,
  },
  rejoinButtonText: {
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
  difficultyContainer: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    padding: SPACING.md,
    borderRadius: 8,
    marginTop: SPACING.sm,
    alignItems: 'center',
  },
  difficultyLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  difficultyButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  difficultyButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 2,
    borderColor: 'transparent',
    minWidth: 80,
    alignItems: 'center',
  },
  difficultyButtonActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#A78BFA',
  },
  difficultyButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.white,
    fontWeight: '600',
  },
  difficultyButtonTextActive: {
    color: COLORS.white,
    fontWeight: '700',
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