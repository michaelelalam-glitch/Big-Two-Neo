import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { RoomPlayerWithRoom } from '../types';
import { roomLogger } from '../utils/logger';
import { showError, showSuccess, showConfirm } from '../utils';
import { i18n } from '../i18n';

type HomeScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { user, profile } = useAuth();
  const [isQuickPlaying, setIsQuickPlaying] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);

  const checkCurrentRoom = React.useCallback(async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('room_players')
        .select('room_id, rooms!inner(code)')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        // Only log error message/code to avoid exposing DB internals
        roomLogger.error('Error checking current room:', error?.message || error?.code || 'Unknown error');
        return;
      }

      const roomData = data as RoomPlayerWithRoom | null;
      if (roomData?.rooms?.code) {
        setCurrentRoom(roomData.rooms.code);
      } else {
        setCurrentRoom(null);
      }
    } catch (error: any) {
      roomLogger.error('Error in checkCurrentRoom:', error?.message || error?.code || String(error));
    }
  }, [user]);

  // Check current room on screen focus
  useFocusEffect(
    React.useCallback(() => {
      checkCurrentRoom();
    }, [checkCurrentRoom])
  );

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
          const { error } = await supabase
            .from('room_players')
            .delete()
            .eq('user_id', user.id);

          if (error) throw error;

          showSuccess(i18n.t('home.leftRoom'));
          setCurrentRoom(null);
        } catch (error: any) {
          // Only log error message/code to avoid exposing DB internals
          roomLogger.error('Error leaving room:', error?.message || error?.code || String(error));
          showError(i18n.t('lobby.leaveRoomError'));
        }
      }
    });
  };

  const generateRoomCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude O, I, 0, 1 to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handleQuickPlay = async (retryCount = 0) => {
    const MAX_RETRIES = 3;
    
    if (!user) {
      showError('You must be signed in to quick play');
      return;
    }

    roomLogger.info(`🎮 Quick Play started for user: ${user.id} (retry ${retryCount}/${MAX_RETRIES})`);
    setIsQuickPlaying(true);
    try {
      // STEP 1: Check if user is already in a room
      roomLogger.info('🔍 Checking if user is already in a room...');
      const { data: existingRoomPlayer, error: checkError } = await supabase
        .from('room_players')
        .select('room_id, rooms!inner(code, status)')
        .eq('user_id', user.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
        roomLogger.error('❌ Error checking existing room:', checkError);
        throw checkError;
      }

      const roomPlayer = existingRoomPlayer as RoomPlayerWithRoom | null;
      if (roomPlayer) {
        roomLogger.info('✅ User already in room:', roomPlayer.rooms.code);
        // User is already in a room, navigate there
        setCurrentRoom(roomPlayer.rooms.code);
        navigation.replace('Lobby', { roomCode: roomPlayer.rooms.code });
        return;
      }

      // STEP 2: Try to find PUBLIC waiting rooms with space
      roomLogger.info('📡 Fetching public waiting rooms...');
      const { data: availableRooms, error: searchError } = await supabase
        .from('rooms')
        .select('id, code, status, created_at, is_public')
        .eq('status', 'waiting')
        .eq('is_public', true)
        .order('created_at', { ascending: true });

      roomLogger.info('📊 Public rooms found:', availableRooms?.length || 0);
      if (searchError) {
        roomLogger.error('❌ Search error:', searchError);
        throw searchError;
      }

      // STEP 3: Check each room for space
      let roomWithSpace = null;
      if (availableRooms && availableRooms.length > 0) {
        roomLogger.info('🔍 Checking rooms for space...');
        for (const room of availableRooms) {
          const { count } = await supabase
            .from('room_players')
            .select('*', { count: 'exact', head: true })
            .eq('room_id', room.id);
          
          roomLogger.info(`  Room ${room.code}: ${count}/4 players`);
          if (count !== null && count < 4) {
            roomWithSpace = { ...room, playerCount: count };
            break;
          }
        }
      }

      // STEP 4: Join existing room OR create new public room
      if (roomWithSpace) {
        roomLogger.info('✅ Joining existing public room via atomic join:', roomWithSpace.code);
        
        const username = profile?.username || `Player_${user.id.substring(0, 8)}`;
        
        // Use atomic join function to prevent race conditions
        const { data: joinResult, error: joinError } = await supabase
          .rpc('join_room_atomic', {
            p_room_code: roomWithSpace.code,
            p_user_id: user.id,
            p_username: username
          });

        if (joinError) {
          roomLogger.error('❌ Atomic join error:', joinError?.message || joinError?.code || 'Unknown error');
          
          // Handle specific error cases
          if (joinError.message?.includes('Room is full') || joinError.message?.includes('Room not found')) {
            roomLogger.info('⚠️ Room unavailable (full or deleted), retrying...');
            // Retry with a different room (early return to prevent loading state issues)
            if (retryCount < MAX_RETRIES) {
              roomLogger.info(`🔄 Retrying Quick Play (${retryCount + 1}/${MAX_RETRIES})...`);
              setIsQuickPlaying(false); // Reset before retry
              return handleQuickPlay(retryCount + 1);
            } else {
              roomLogger.info('⚠️ Max retries reached, creating new room instead...');
              // Fall through to room creation logic
            }
          } else if (joinError.message?.includes('already in another room')) {
            showError('You are already in another room. Please leave it first.');
            return;
          } else {
            // Unexpected error
            throw joinError;
          }
        } else {
          // Success - joined the room
          roomLogger.info('🎉 Successfully joined room (atomic):', joinResult);
          setCurrentRoom(roomWithSpace.code);
          navigation.replace('Lobby', { roomCode: roomWithSpace.code });
          return;
        }
      }

      // Create a new PUBLIC room if no valid room found
      roomLogger.info('🆕 Creating new PUBLIC Quick Play room...');
      const roomCode = generateRoomCode();
      
      const { error: roomError } = await supabase
        .from('rooms')
        .insert({
          code: roomCode,
          host_id: null, // Let join_room_atomic set the host
          status: 'waiting',
          is_public: true, // PUBLIC room for Quick Play
          is_matchmaking: true, // CRITICAL: Mark as matchmaking room
          ranked_mode: false, // Quick Play is always casual (non-ranked)
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (roomError) {
        roomLogger.error('❌ Room creation error:', roomError?.message || roomError?.code || 'Unknown error');
        throw roomError;
      }
      roomLogger.info('✅ Public room created:', roomCode);

      // Use atomic join to add host as first player
      const username = profile?.username || `Player_${user.id.substring(0, 8)}`;
      const { data: joinResult, error: playerError } = await supabase
        .rpc('join_room_atomic', {
          p_room_code: roomCode,
          p_user_id: user.id,
          p_username: username
        });

      if (playerError) {
        roomLogger.error('❌ Player insertion error (atomic):', playerError?.message || playerError?.code || 'Unknown error');
        throw playerError;
      }
      roomLogger.info('✅ Host added to public room (atomic):', joinResult);

      // Navigate to lobby
      roomLogger.info('🚀 Navigating to lobby...');
      setCurrentRoom(roomCode);
      navigation.replace('Lobby', { roomCode });
    } catch (error: any) {
      // Only log error message/code to avoid exposing DB internals, auth tokens, or stack traces
      roomLogger.error('❌ Error with quick play:', error?.message || error?.code || String(error));
      const errorMessage = error?.message || error?.error_description || error?.msg || 'Failed to join or create room';
      showError(errorMessage);
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
        
        {currentRoom && (
          <View style={styles.currentRoomBanner}>
            <Text style={styles.currentRoomText}>📍 {i18n.t('home.currentRoom')}: {currentRoom}</Text>
            <TouchableOpacity
              style={styles.leaveRoomButton}
              onPress={handleLeaveCurrentRoom}
            >
              <Text style={styles.leaveRoomButtonText}>{i18n.t('home.leave')}</Text>
            </TouchableOpacity>
          </View>
        )}
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.mainButton, styles.casualMatchButton, isQuickPlaying && styles.buttonDisabled]}
            onPress={() => void handleQuickPlay()}
            disabled={isQuickPlaying}
          >
            {isQuickPlaying ? (
              <>
                <ActivityIndicator color={COLORS.white} size="small" />
                <Text style={styles.mainButtonSubtext}>{i18n.t('common.loading')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.mainButtonText}>🎮 Casual Match</Text>
                <Text style={styles.mainButtonSubtext}>Join casual game</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mainButton, styles.rankedMatchButton]}
            onPress={() => navigation.navigate('Matchmaking', { matchType: 'ranked' })}
          >
            <Text style={styles.mainButtonText}>🏆 Ranked Match</Text>
            <Text style={styles.mainButtonSubtext}>Competitive matchmaking</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mainButton, styles.createButton]}
            onPress={() => navigation.navigate('CreateRoom')}
          >
            <Text style={styles.mainButtonText}>{i18n.t('home.createRoom')}</Text>
            <Text style={styles.mainButtonSubtext}>{i18n.t('home.createRoomDescription')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mainButton, styles.joinButton]}
            onPress={() => navigation.navigate('JoinRoom')}
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
  findMatchButton: {
    backgroundColor: '#EC4899', // Pink - Highlighted for NEW feature
    borderWidth: 2,
    borderColor: '#F472B6',
  },
  quickPlayButton: {
    backgroundColor: '#10B981', // Green
  },
  createButton: {
    backgroundColor: '#3B82F6', // Blue
  },
  joinButton: {
    backgroundColor: '#8B5CF6', // Purple
  },
  rankedLeaderboardButton: {
    backgroundColor: '#A855F7', // Purple/Violet - Ranked theme
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
});