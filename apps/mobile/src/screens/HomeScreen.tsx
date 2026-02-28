import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Modal, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { ActiveGameBanner, ActiveGameInfo } from '../components/home/ActiveGameBanner';
import { useAuth } from '../contexts/AuthContext';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../services/supabase';
import { RoomPlayerWithRoom } from '../types';
import { showError, showSuccess, showConfirm } from '../utils';
import { roomLogger } from '../utils/logger';

type HomeScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { user, profile } = useAuth();
  const [isQuickPlaying, setIsQuickPlaying] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [currentRoomStatus, setCurrentRoomStatus] = useState<'waiting' | 'playing' | undefined>(undefined);
  const [disconnectTimestamp, setDisconnectTimestamp] = useState<number | null>(null);
  const [showFindGameModal, setShowFindGameModal] = useState(false);
  const [showDifficultyModal, setShowDifficultyModal] = useState(false);
  const [bannerRefreshKey, setBannerRefreshKey] = useState(0);
  
  // Ranked matchmaking hook
  const { matchFound, roomCode: rankedRoomCode, resetMatch } = useMatchmaking();
  const [isRankedSearching, setIsRankedSearching] = useState(false);
  
  // Auto-navigate when ranked match found
  useEffect(() => {
    if (matchFound && rankedRoomCode) {
      roomLogger.info(`[HomeScreen] 🎉 Ranked match found! Navigating to: ${rankedRoomCode}`);
      setIsRankedSearching(false);
      resetMatch();
      // Small delay to ensure UI updates
      setTimeout(() => {
        navigation.replace('Lobby', { roomCode: rankedRoomCode });
      }, 100);
    }
  }, [matchFound, rankedRoomCode, navigation, resetMatch]);

  const checkCurrentRoom = React.useCallback(async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('room_players')
        .select('room_id, rooms!inner(code, status)')
        .eq('user_id', user.id)
        .in('rooms.status', ['waiting', 'playing']) // CRITICAL: Only show banner for active rooms
        .single();

      if (error && error.code !== 'PGRST116') {
        // Only log error message/code to avoid exposing DB internals
        roomLogger.error('Error checking current room:', error?.message || error?.code || 'Unknown error');
        
        // CRITICAL: Clean up zombie entries if room doesn't exist
        if (error.code === 'PGRST116') {
          await supabase
            .from('room_players')
            .delete()
            .eq('user_id', user.id);
          roomLogger.info('🧹 Cleaned up zombie room_player entry');
        }
        return;
      }

      const roomData = data as RoomPlayerWithRoom | null;
      if (roomData?.rooms?.code) {
        setCurrentRoom(roomData.rooms.code);
        setCurrentRoomStatus(roomData.rooms.status as 'waiting' | 'playing');
        // Track disconnect time for countdown (only set once when we detect an active playing room)
        if (roomData.rooms.status === 'playing' && !disconnectTimestamp) {
          setDisconnectTimestamp(Date.now());
        }
      } else {
        setCurrentRoom(null);
        setCurrentRoomStatus(undefined);
        setDisconnectTimestamp(null);
      }
    } catch (error: unknown) {
      roomLogger.error('Error in checkCurrentRoom:', error instanceof Error ? error.message : String(error));
    }
  }, [user]);

  // Check current room on screen focus
  useFocusEffect(
    React.useCallback(() => {
      checkCurrentRoom();
    }, [checkCurrentRoom])
  );

  // ── Game exclusivity helper ──
  // A user can only be in ONE game at a time (online OR offline).
  // This helper checks for an existing game and asks to leave or re-enter it.
  // Returns true if the user is clear to start a new game, false if blocked.
  const checkGameExclusivity = useCallback(async (
    targetType: 'online' | 'offline',
  ): Promise<boolean> => {
    // Check for active offline game
    try {
      const stateJson = await AsyncStorage.getItem('@big2_game_state');
      if (stateJson) {
        const state = JSON.parse(stateJson);
        if (state && !state.gameOver && state.gameStarted && !state.gameEnded) {
          // Active offline game exists
          if (targetType === 'offline') {
            // Starting another offline game — ask to discard current one
            return new Promise<boolean>((resolve) => {
              showConfirm({
                title: 'Game In Progress',
                message: 'You have an offline game in progress. Discard it and start a new one?',
                confirmText: 'Discard & Start New',
                cancelText: 'Resume Current Game',
                destructive: true,
                onConfirm: async () => {
                  await AsyncStorage.removeItem('@big2_game_state');
                  await AsyncStorage.removeItem('@big2_score_history');
                  setBannerRefreshKey(k => k + 1);
                  resolve(true);
                },
                onCancel: () => {
                  // Resume the existing offline game
                  navigation.navigate('Game', { roomCode: 'LOCAL_AI_GAME' });
                  resolve(false);
                },
              });
            });
          } else {
            // Trying to join online, but offline game active
            return new Promise<boolean>((resolve) => {
              showConfirm({
                title: 'Game In Progress',
                message: 'You have an offline game in progress. You must leave it before joining an online game.',
                confirmText: 'Discard Offline Game',
                cancelText: 'Resume Offline Game',
                destructive: true,
                onConfirm: async () => {
                  await AsyncStorage.removeItem('@big2_game_state');
                  await AsyncStorage.removeItem('@big2_score_history');
                  setBannerRefreshKey(k => k + 1);
                  resolve(true);
                },
                onCancel: () => {
                  navigation.navigate('Game', { roomCode: 'LOCAL_AI_GAME' });
                  resolve(false);
                },
              });
            });
          }
        }
      }
    } catch {
      // AsyncStorage read failed — proceed
    }

    // Check for active online room
    if (user && targetType === 'offline' && currentRoom) {
      return new Promise<boolean>((resolve) => {
        showConfirm({
          title: 'Game In Progress',
          message: `You are in online room ${currentRoom}. You must leave it before starting an offline game.`,
          confirmText: 'Leave Online Room',
          cancelText: 'Go to Room',
          destructive: true,
          onConfirm: async () => {
            try {
              await supabase.from('room_players').delete().eq('user_id', user.id);
              setCurrentRoom(null);
              setCurrentRoomStatus(undefined);
              setDisconnectTimestamp(null);
              await checkCurrentRoom();
              resolve(true);
            } catch {
              showError('Failed to leave the room. Try again.');
              resolve(false);
            }
          },
          onCancel: () => {
            navigation.replace('Lobby', { roomCode: currentRoom });
            resolve(false);
          },
        });
      });
    }

    return true;
  }, [user, currentRoom, navigation, checkCurrentRoom]);

  const handleOfflinePractice = async () => {
    const canProceed = await checkGameExclusivity('offline');
    if (!canProceed) return;
    // Show difficulty picker modal instead of navigating directly
    setShowDifficultyModal(true);
  };

  const handleStartOfflineWithDifficulty = (difficulty: 'easy' | 'medium' | 'hard') => {
    setShowDifficultyModal(false);
    roomLogger.info(`🤖 Starting Offline Practice Mode with ${difficulty} bots...`);
    navigation.navigate('Game', { 
      roomCode: 'LOCAL_AI_GAME',
      forceNewGame: true,
      botDifficulty: difficulty,
    });
  };

  const handleLeaveCurrentRoom = async () => {
    if (!user || !currentRoom) return;

    showConfirm({
      title: i18n.t('home.leaveRoomConfirm'),
      message: `${i18n.t('home.leave')} ${currentRoom}?`,
      confirmText: i18n.t('home.leave'),
      cancelText: i18n.t('common.cancel'),
      destructive: true,
      onConfirm: async () => {
        try {
          roomLogger.info(`🚪 Leaving room ${currentRoom}...`);
          
          // Delete from room_players (trigger will auto-delete room if empty)
          const { error } = await supabase
            .from('room_players')
            .delete()
            .eq('user_id', user.id);

          if (error) throw error;

          roomLogger.info('✅ Successfully left room - auto-cleanup triggered');
          showSuccess(i18n.t('home.leftRoom'));
          setCurrentRoom(null);
          
          // Force refresh to ensure banner is cleared
          await checkCurrentRoom();
        } catch (error: unknown) {
          // Only log error message/code to avoid exposing DB internals
          roomLogger.error('Error leaving room:', error instanceof Error ? error.message : String(error));
          showError(i18n.t('lobby.leaveRoomError'));
        }
      }
    });
  };

  // ── Active Game Banner handlers ──
  const handleBannerResume = useCallback((gameInfo: ActiveGameInfo) => {
    if (gameInfo.type === 'online') {
      // Navigate to the existing online room
      navigation.replace('Lobby', { roomCode: gameInfo.roomCode });
    } else {
      // Resume offline game (don't force new game)
      navigation.navigate('Game', { roomCode: 'LOCAL_AI_GAME' });
    }
  }, [navigation]);

  const handleBannerLeave = useCallback((gameInfo: ActiveGameInfo) => {
    if (gameInfo.type === 'online') {
      handleLeaveCurrentRoom();
    } else {
      // Discard offline game
      showConfirm({
        title: 'Discard Game?',
        message: 'Your offline game progress will be lost.',
        confirmText: 'Discard',
        cancelText: 'Cancel',
        destructive: true,
        onConfirm: async () => {
          try {
            await AsyncStorage.removeItem('@big2_game_state');
            setBannerRefreshKey(k => k + 1);
            showSuccess('Offline game discarded');
          } catch {
            showError('Failed to discard game');
          }
        },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleLeaveCurrentRoom]);

  const handleReplaceBotAndRejoin = useCallback((roomCode: string) => {
    // Navigate back to the room - the server-side logic will handle bot → player swap
    roomLogger.info(`🔄 Replacing bot and rejoining room: ${roomCode}`);
    setDisconnectTimestamp(null);
    navigation.replace('Lobby', { roomCode });
  }, [navigation]);

  // 🔥 FIXED Task #XXX: Ranked match now works like casual - immediate lobby!
  // Creates room with ranked_mode=true, goes to lobby immediately (doesn't wait for 4 players)
  const handleRankedMatch = async (retryCount = 0) => {
    const MAX_RETRIES = 3;
    
    if (!user || !profile) {
      showError('You must be signed in for ranked matches');
      return;
    }

    // Check game exclusivity — can't join online if offline game active
    if (retryCount === 0) {
      const canProceed = await checkGameExclusivity('online');
      if (!canProceed) return;
    }

    roomLogger.info(`🏆 Ranked Match started for user: ${user.id} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    setShowFindGameModal(false);
    setIsRankedSearching(true);
    
    try {
      // Clean up any zombie entries first (same as casual)
      roomLogger.info('🧹 Cleaning up any zombie room_player entries...');
      await supabase.from('room_players').delete().eq('user_id', user.id);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // STEP 1: Try to find existing RANKED room with space (same as casual)
      roomLogger.info('📡 Searching for joinable ranked rooms...');
      const { data: availableRooms, error: searchError } = await supabase
        .from('rooms')
        .select('id, code, status')
        .eq('status', 'waiting')
        .eq('is_public', true)
        .eq('is_matchmaking', true)
        .eq('ranked_mode', true) // 🔥 RANKED rooms only
        .order('created_at', { ascending: true })
        .limit(5);

      if (searchError) throw searchError;

      roomLogger.info(`📊 Found ${availableRooms?.length || 0} potential ranked rooms`);

      // STEP 2: Try to join first available ranked room with space
      if (availableRooms && availableRooms.length > 0) {
        for (const room of availableRooms) {
          const { count } = await supabase
            .from('room_players')
            .select('*', { count: 'exact', head: true })
            .eq('room_id', room.id);
          
          roomLogger.info(`  Ranked Room ${room.code}: ${count}/4 players`);
          
          if (count !== null && count < 4) {
            roomLogger.info(`✅ Joining ranked room ${room.code}...`);
            
            const username = profile.username || `Player_${user.id.substring(0, 8)}`;
            const { error: joinError } = await supabase.rpc('join_room_atomic', {
              p_room_code: room.code,
              p_user_id: user.id,
              p_username: username
            });

            if (joinError) {
              roomLogger.error(`❌ Failed to join ${room.code}:`, joinError.message);
              continue;
            }

            // Success!
            roomLogger.info(`🎉 Successfully joined existing ranked room: ${room.code}`);
            setCurrentRoom(room.code);
            setIsRankedSearching(false);
            navigation.replace('Lobby', { roomCode: room.code });
            return;
          }
        }
      }

      // STEP 3: No joinable ranked room found - create new one
      roomLogger.info('🆕 Creating new ranked room...');
      const username = profile.username || `Player_${user.id.substring(0, 8)}`;
      
      const { data: roomResult, error: createError } = await supabase.rpc('get_or_create_room', {
        p_user_id: user.id,
        p_username: username,
        p_is_public: true,
        p_is_matchmaking: true,
        p_ranked_mode: true // 🔥 RANKED flag
      });

      if (createError) {
        roomLogger.error('❌ Ranked room creation failed:', createError.message);
        
        if (createError.message?.includes('collision') && retryCount < MAX_RETRIES) {
          roomLogger.info(`🔄 Collision detected, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
          setIsRankedSearching(false);
          return handleRankedMatch(retryCount + 1);
        }
        
        throw createError;
      }

      const result = roomResult as { success: boolean; room_code: string; attempts: number };
      
      if (!result || !result.success || !result.room_code) {
        throw new Error('Failed to create ranked room');
      }

      roomLogger.info(`🎉 Ranked room created: ${result.room_code}`);
      setCurrentRoom(result.room_code);
      setIsRankedSearching(false);
      navigation.replace('Lobby', { roomCode: result.room_code });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      roomLogger.error('❌ Error with ranked match:', msg);
      showError(msg || 'Failed to start ranked match');
      setIsRankedSearching(false);
    }
  };
  
  const handleCasualMatch = async () => {
    // Check game exclusivity — can't join online if offline game active
    const canProceed = await checkGameExclusivity('online');
    if (!canProceed) return;
    setShowFindGameModal(false);
    handleQuickPlay();
  };

  const handleQuickPlay = async (retryCount = 0) => {
    const MAX_RETRIES = 3;
    
    if (!user || !profile) {
      showError('You must be signed in to play');
      return;
    }

    roomLogger.info(`🎮 Casual Match started for user: ${user.id} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    setIsQuickPlaying(true);
    
    try {
      // STEP 1: Check if user is ALREADY in an active room
      roomLogger.info('🔍 Checking for existing active room...');
      const { data: existingRoomPlayer, error: checkError } = await supabase
        .from('room_players')
        .select('room_id, rooms!inner(code, status)')
        .eq('user_id', user.id)
        .in('rooms.status', ['waiting', 'playing'])
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        roomLogger.error('❌ Error checking existing room:', checkError);
        throw checkError;
      }

      const roomPlayer = existingRoomPlayer as RoomPlayerWithRoom | null;
      if (roomPlayer) {
        roomLogger.info('✅ User already in active room:', roomPlayer.rooms.code);
        setCurrentRoom(roomPlayer.rooms.code);
        navigation.replace('Lobby', { roomCode: roomPlayer.rooms.code });
        return;
      }

      // STEP 2: Clean up any zombie entries from old sessions
      roomLogger.info('🧹 Cleaning up any zombie room_player entries...');
      const { error: cleanupError } = await supabase
        .from('room_players')
        .delete()
        .eq('user_id', user.id);
      
      if (cleanupError) {
        roomLogger.error('⚠️ Cleanup warning:', cleanupError.message);
        // Don't throw - continue anyway
      }
      
      // CRITICAL FIX: Wait for cleanup to propagate through Postgres
      // Without this, join_room_atomic may still see user in old room
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify cleanup succeeded
      const { data: stillInRoom } = await supabase
        .from('room_players')
        .select('room_id')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (stillInRoom) {
        roomLogger.error('❌ Cleanup failed - user still in room:', stillInRoom.room_id);
        throw new Error('Failed to leave previous room. Please try again.');
      }

      // STEP 3: Try to find existing PUBLIC casual room with space
      roomLogger.info('📡 Searching for joinable casual rooms...');
      const { data: availableRooms, error: searchError } = await supabase
        .from('rooms')
        .select('id, code, status')
        .eq('status', 'waiting')
        .eq('is_public', true)
        .eq('is_matchmaking', true)
        .eq('ranked_mode', false) // Casual rooms only
        .order('created_at', { ascending: true })
        .limit(5);

      if (searchError) {
        roomLogger.error('❌ Search error:', searchError);
        throw searchError;
      }

      roomLogger.info(`📊 Found ${availableRooms?.length || 0} potential rooms`);

      // STEP 4: Try to join first available room with space
      if (availableRooms && availableRooms.length > 0) {
        for (const room of availableRooms) {
          const { count } = await supabase
            .from('room_players')
            .select('*', { count: 'exact', head: true })
            .eq('room_id', room.id);
          
          roomLogger.info(`  Room ${room.code}: ${count}/4 players`);
          
          if (count !== null && count < 4) {
            roomLogger.info(`✅ Joining room ${room.code} via atomic join...`);
            
            const username = profile.username || `Player_${user.id.substring(0, 8)}`;
            const { error: joinError } = await supabase
              .rpc('join_room_atomic', {
                p_room_code: room.code,
                p_user_id: user.id,
                p_username: username
              });

            if (joinError) {
              roomLogger.error(`❌ Failed to join ${room.code}:`, joinError.message);
              continue; // Try next room
            }

            // Success!
            roomLogger.info(`🎉 Successfully joined existing room: ${room.code}`);
            setCurrentRoom(room.code);
            navigation.replace('Lobby', { roomCode: room.code });
            return;
          }
        }
      }

      // STEP 5: No joinable room found - create new one using RPC (guaranteed unique)
      roomLogger.info('🆕 Creating new casual room using get_or_create_room RPC...');
      const username = profile.username || `Player_${user.id.substring(0, 8)}`;
      
      const { data: roomResult, error: createError } = await supabase
        .rpc('get_or_create_room', {
          p_user_id: user.id,
          p_username: username,
          p_is_public: true,
          p_is_matchmaking: true,
          p_ranked_mode: false
        });

      if (createError) {
        roomLogger.error('❌ Room creation failed:', createError.message);
        
        // Check if it's a collision error - retry
        if (createError.message?.includes('collision') && retryCount < MAX_RETRIES) {
          roomLogger.info(`🔄 Collision detected, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
          setIsQuickPlaying(false);
          return handleQuickPlay(retryCount + 1);
        }
        
        throw createError;
      }

      const result = roomResult as { success: boolean; room_code: string; attempts: number };
      
      if (!result || !result.success || !result.room_code) {
        throw new Error('Failed to create room: Invalid response from server');
      }

      roomLogger.info(`🎉 Room created successfully: ${result.room_code} (${result.attempts} attempts)`);
      setCurrentRoom(result.room_code);
      navigation.replace('Lobby', { roomCode: result.room_code });
    } catch (error: unknown) {
      // Only log error message/code to avoid exposing DB internals, auth tokens, or stack traces
      const msg = error instanceof Error ? error.message : String(error);
      roomLogger.error('❌ Error with quick play:', msg);
      showError(msg || 'Failed to join or create room');
    } finally {
      roomLogger.info('🏁 Quick Play finished');
      setIsQuickPlaying(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        bounces={true}
      >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.leaderboardButton}
          onPress={() => navigation.navigate('Leaderboard')}
        >
          <Text style={styles.leaderboardButtonText}>{i18n.t('home.leaderboard')}</Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.settingsButtonText}>⚙️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => navigation.navigate('Profile')}
          >
            <Text style={styles.profileButtonText}>{i18n.t('home.profile')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{i18n.t('home.title')}</Text>
        <Text style={styles.subtitle}>{i18n.t('home.welcome')}, {profile?.username || user?.email || 'Player'}!</Text>
        
        {/* Active Game Banner - shows for both offline and online open games */}
        <ActiveGameBanner
          onlineRoomCode={currentRoom}
          onlineRoomStatus={currentRoomStatus}
          disconnectTimestamp={disconnectTimestamp}
          onResume={handleBannerResume}
          onLeave={handleBannerLeave}
          onReplaceBotAndRejoin={handleReplaceBotAndRejoin}
          refreshTrigger={bannerRefreshKey}
        />
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.mainButton, styles.findGameButton, (isQuickPlaying || isRankedSearching) && styles.buttonDisabled]}
            onPress={() => setShowFindGameModal(true)}
            disabled={isQuickPlaying || isRankedSearching}
          >
            {(isQuickPlaying || isRankedSearching) ? (
              <>
                <ActivityIndicator color={COLORS.white} size="small" />
                <Text style={styles.mainButtonSubtext}>
                  {isRankedSearching ? i18n.t('home.findingRankedMatch') : i18n.t('common.loading')}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.mainButtonText}>🎮 Find a Game</Text>
                <Text style={styles.mainButtonSubtext}>Play online matches</Text>
              </>
            )}
          </TouchableOpacity>
          
          {isRankedSearching && (
            <TouchableOpacity
              style={[styles.mainButton, styles.cancelButton]}
              onPress={() => {
                setIsRankedSearching(false);
              }}
            >
              <Text style={styles.mainButtonText}>❌ Cancel Search</Text>
              <Text style={styles.mainButtonSubtext}>Stop looking for ranked match</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.mainButton, styles.createButton]}
            onPress={async () => {
              const canProceed = await checkGameExclusivity('online');
              if (canProceed) navigation.navigate('CreateRoom');
            }}
          >
            <Text style={styles.mainButtonText}>{i18n.t('home.createRoom')}</Text>
            <Text style={styles.mainButtonSubtext}>{i18n.t('home.createRoomDescription')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mainButton, styles.offlinePracticeButton]}
            onPress={handleOfflinePractice}
          >
            <Text style={styles.mainButtonText}>🤖 Offline Practice</Text>
            <Text style={styles.mainButtonSubtext}>Play with 3 AI bots</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mainButton, styles.joinButton]}
            onPress={async () => {
              const canProceed = await checkGameExclusivity('online');
              if (canProceed) navigation.navigate('JoinRoom');
            }}
          >
            <Text style={styles.mainButtonText}>{i18n.t('home.joinRoom')}</Text>
            <Text style={styles.mainButtonSubtext}>{i18n.t('home.joinRoomDescription')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mainButton, styles.howToPlayButton]}
            onPress={() => navigation.navigate('HowToPlay')}
          >
            <Text style={styles.mainButtonText}>{i18n.t('home.howToPlay')}</Text>
            <Text style={styles.mainButtonSubtext}>{i18n.t('home.howToPlayDescription')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </ScrollView>
      
      {/* Bot Difficulty Picker Modal */}
      <Modal
        visible={showDifficultyModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowDifficultyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>🤖 Bot Difficulty</Text>
            <Text style={styles.modalSubtitle}>Choose how smart the bots will be</Text>
            
            <View style={styles.modalButtonContainer}>
              <TouchableOpacity
                style={[styles.modalButton, styles.difficultyEasyButton]}
                onPress={() => handleStartOfflineWithDifficulty('easy')}
              >
                <Text style={styles.modalButtonIcon}>😊</Text>
                <Text style={styles.modalButtonText}>Easy</Text>
                <Text style={styles.modalButtonSubtext}>Bots make mistakes and pass often. Great for learning!</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.difficultyMediumButton]}
                onPress={() => handleStartOfflineWithDifficulty('medium')}
              >
                <Text style={styles.modalButtonIcon}>🧠</Text>
                <Text style={styles.modalButtonText}>Medium</Text>
                <Text style={styles.modalButtonSubtext}>Balanced play with basic strategy. A fair challenge.</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.difficultyHardButton]}
                onPress={() => handleStartOfflineWithDifficulty('hard')}
              >
                <Text style={styles.modalButtonIcon}>🔥</Text>
                <Text style={styles.modalButtonText}>Hard</Text>
                <Text style={styles.modalButtonSubtext}>Optimal play with advanced combos. Think you can win?</Text>
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setShowDifficultyModal(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Find a Game Modal */}
      <Modal
        visible={showFindGameModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowFindGameModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>🎮 Find a Game</Text>
            <Text style={styles.modalSubtitle}>Choose your game mode</Text>
            
            <View style={styles.modalButtonContainer}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCasualButton]}
                onPress={handleCasualMatch}
                disabled={isQuickPlaying}
              >
                <Text style={styles.modalButtonIcon}>🎮</Text>
                <Text style={styles.modalButtonText}>{i18n.t('home.casualMatch')}</Text>
                <Text style={styles.modalButtonSubtext}>{i18n.t('home.casualMatchDescription')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.modalRankedButton]}
                onPress={() => handleRankedMatch(0)}
                disabled={isRankedSearching}
              >
                <Text style={styles.modalButtonIcon}>🏆</Text>
                <Text style={styles.modalButtonText}>{i18n.t('home.rankedMatch')}</Text>
                <Text style={styles.modalButtonSubtext}>{i18n.t('home.rankedMatchDescription')}</Text>
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setShowFindGameModal(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
  },
  headerRight: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  leaderboardButton: {
    backgroundColor: COLORS.gold,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  leaderboardButtonText: {
    color: COLORS.primary,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  settingsButton: {
    backgroundColor: COLORS.gray.dark,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  settingsButtonText: {
    fontSize: FONT_SIZES.lg,
  },
  profileButton: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  profileButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.md,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    marginBottom: SPACING.xl,
  },
  currentRoomBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 8,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  currentRoomText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: '#FCD34D',
    fontWeight: '600',
  },
  leaveRoomButton: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  leaveRoomButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  buttonContainer: {
    width: '100%',
    gap: SPACING.md,
  },
  mainButton: {
    padding: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  findGameButton: {
    backgroundColor: '#10B981', // Vibrant Green
    borderWidth: 2,
    borderColor: '#34D399',
  },
  cancelButton: {
    backgroundColor: '#EF4444', // Red
    borderWidth: 2,
    borderColor: '#F87171',
  },
  createButton: {
    backgroundColor: '#3B82F6', // Blue
  },
  offlinePracticeButton: {
    backgroundColor: '#6366F1', // Indigo
    borderWidth: 2,
    borderColor: '#818CF8',
  },
  joinButton: {
    backgroundColor: '#8B5CF6', // Purple
  },
  howToPlayButton: {
    backgroundColor: '#F59E0B', // Amber/Orange
  },
  mainButtonText: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.xs,
  },
  mainButtonSubtext: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.white,
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalContainer: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    padding: SPACING.xl,
    width: '100%',
    maxWidth: 400,
    borderWidth: 2,
    borderColor: COLORS.secondary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  modalSubtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  modalButtonContainer: {
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  modalButton: {
    padding: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalCasualButton: {
    backgroundColor: '#10B981',
    borderColor: '#34D399',
  },
  modalRankedButton: {
    backgroundColor: '#F59E0B',
    borderColor: '#FBBF24',
  },
  difficultyEasyButton: {
    backgroundColor: '#10B981',
    borderColor: '#34D399',
  },
  difficultyMediumButton: {
    backgroundColor: '#F59E0B',
    borderColor: '#FBBF24',
  },
  difficultyHardButton: {
    backgroundColor: '#EF4444',
    borderColor: '#F87171',
  },
  modalButtonIcon: {
    fontSize: 32,
    marginBottom: SPACING.xs,
  },
  modalButtonText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.xs,
  },
  modalButtonSubtext: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.white,
    opacity: 0.9,
    textAlign: 'center',
  },
  modalCancelButton: {
    padding: SPACING.md,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    fontWeight: '600',
  },
});