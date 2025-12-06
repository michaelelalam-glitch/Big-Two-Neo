import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { RoomPlayerWithRoom } from '../types';

type HomeScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { user } = useAuth();
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
        console.error('Error checking current room:', error);
        return;
      }

      const roomData = data as RoomPlayerWithRoom | null;
      if (roomData?.rooms?.code) {
        setCurrentRoom(roomData.rooms.code);
      } else {
        setCurrentRoom(null);
      }
    } catch (error) {
      console.error('Error in checkCurrentRoom:', error);
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

    Alert.alert(
      'Leave Room',
      `Leave room ${currentRoom}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('room_players')
                .delete()
                .eq('user_id', user.id);

              if (error) throw error;

              Alert.alert('Success', 'Left the room');
              setCurrentRoom(null);
            } catch (error: any) {
              console.error('Error leaving room:', error);
              Alert.alert('Error', 'Failed to leave room');
            }
          }
        }
      ]
    );
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
      Alert.alert('Error', 'You must be signed in to quick play');
      return;
    }

    console.log(`🎮 Quick Play started for user: ${user.id} (retry ${retryCount}/${MAX_RETRIES})`);
    setIsQuickPlaying(true);
    try {
      // STEP 1: Check if user is already in a room
      console.log('🔍 Checking if user is already in a room...');
      const { data: existingRoomPlayer, error: checkError } = await supabase
        .from('room_players')
        .select('room_id, rooms!inner(code, status)')
        .eq('user_id', user.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.error('❌ Error checking existing room:', checkError);
        throw checkError;
      }

      const roomPlayer = existingRoomPlayer as RoomPlayerWithRoom | null;
      if (roomPlayer) {
        console.log('✅ User already in room:', roomPlayer.rooms.code);
        // User is already in a room, navigate there
        setCurrentRoom(roomPlayer.rooms.code);
        navigation.replace('Lobby', { roomCode: roomPlayer.rooms.code });
        return;
      }

      // STEP 2: Try to find PUBLIC waiting rooms with space
      console.log('📡 Fetching public waiting rooms...');
      const { data: availableRooms, error: searchError } = await supabase
        .from('rooms')
        .select('id, code, status, created_at, is_public')
        .eq('status', 'waiting')
        .eq('is_public', true)
        .order('created_at', { ascending: true });

      console.log('📊 Public rooms found:', availableRooms?.length || 0);
      if (searchError) {
        console.error('❌ Search error:', searchError);
        throw searchError;
      }

      // STEP 3: Check each room for space
      let roomWithSpace = null;
      if (availableRooms && availableRooms.length > 0) {
        console.log('🔍 Checking rooms for space...');
        for (const room of availableRooms) {
          const { count } = await supabase
            .from('room_players')
            .select('*', { count: 'exact', head: true })
            .eq('room_id', room.id);
          
          console.log(`  Room ${room.code}: ${count}/4 players`);
          if (count !== null && count < 4) {
            roomWithSpace = { ...room, playerCount: count };
            break;
          }
        }
      }

      // STEP 4: Join existing room OR create new public room
      if (roomWithSpace) {
        console.log('✅ Joining existing public room via atomic join:', roomWithSpace.code);
        
        const username = user.user_metadata?.username || `Player_${user.id.substring(0, 8)}`;
        
        // Use atomic join function to prevent race conditions
        const { data: joinResult, error: joinError } = await supabase
          .rpc('join_room_atomic', {
            p_room_code: roomWithSpace.code,
            p_user_id: user.id,
            p_username: username
          });

        if (joinError) {
          console.error('❌ Atomic join error:', joinError);
          
          // Handle specific error cases
          if (joinError.message?.includes('Room is full') || joinError.message?.includes('Room not found')) {
            console.log('⚠️ Room unavailable (full or deleted), retrying...');
            // Retry with a different room (early return to prevent loading state issues)
            if (retryCount < MAX_RETRIES) {
              console.log(`🔄 Retrying Quick Play (${retryCount + 1}/${MAX_RETRIES})...`);
              setIsQuickPlaying(false); // Reset before retry
              return handleQuickPlay(retryCount + 1);
            } else {
              console.log('⚠️ Max retries reached, creating new room instead...');
              // Fall through to room creation logic
            }
          } else if (joinError.message?.includes('already in another room')) {
            Alert.alert('Error', 'You are already in another room. Please leave it first.');
            return;
          } else {
            // Unexpected error
            throw joinError;
          }
        } else {
          // Success - joined the room
          console.log('🎉 Successfully joined room (atomic):', joinResult);
          setCurrentRoom(roomWithSpace.code);
          navigation.replace('Lobby', { roomCode: roomWithSpace.code });
          return;
        }
      }

      // Create a new PUBLIC room if no valid room found
      console.log('🆕 Creating new PUBLIC room...');
      const roomCode = generateRoomCode();
      
      const { error: roomError } = await supabase
        .from('rooms')
        .insert({
          code: roomCode,
          host_id: null, // Let join_room_atomic set the host
          status: 'waiting',
          is_public: true, // PUBLIC room for Quick Play
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (roomError) {
        console.error('❌ Room creation error:', roomError);
        throw roomError;
      }
      console.log('✅ Public room created:', roomCode);

      // Use atomic join to add host as first player
      const username = user.user_metadata?.username || `Player_${user.id.substring(0, 8)}`;
      const { data: joinResult, error: playerError } = await supabase
        .rpc('join_room_atomic', {
          p_room_code: roomCode,
          p_user_id: user.id,
          p_username: username
        });

      if (playerError) {
        console.error('❌ Player insertion error (atomic):', playerError);
        throw playerError;
      }
      console.log('✅ Host added to public room (atomic):', joinResult);

      // Navigate to lobby
      console.log('🚀 Navigating to lobby...');
      setCurrentRoom(roomCode);
      navigation.replace('Lobby', { roomCode });
    } catch (error: any) {
      console.error('❌ Error with quick play:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      const errorMessage = error?.message || error?.error_description || error?.msg || 'Failed to join or create room';
      Alert.alert('Error', errorMessage);
    } finally {
      console.log('🏁 Quick Play finished');
      setIsQuickPlaying(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.profileButton}
          onPress={() => navigation.navigate('Profile')}
        >
          <Text style={styles.profileButtonText}>Profile</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Big2 Mobile</Text>
        <Text style={styles.subtitle}>Welcome, {user?.email || 'Player'}!</Text>
        
        {currentRoom && (
          <View style={styles.currentRoomBanner}>
            <Text style={styles.currentRoomText}>📍 Currently in room: {currentRoom}</Text>
            <TouchableOpacity
              style={styles.leaveRoomButton}
              onPress={handleLeaveCurrentRoom}
            >
              <Text style={styles.leaveRoomButtonText}>Leave</Text>
            </TouchableOpacity>
          </View>
        )}
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.mainButton, styles.quickPlayButton, isQuickPlaying && styles.buttonDisabled]}
            onPress={handleQuickPlay}
            disabled={isQuickPlaying}
          >
            {isQuickPlaying ? (
              <>
                <ActivityIndicator color={COLORS.white} size="small" />
                <Text style={styles.mainButtonSubtext}>Finding a game...</Text>
              </>
            ) : (
              <>
                <Text style={styles.mainButtonText}>⚡ Quick Play</Text>
                <Text style={styles.mainButtonSubtext}>Join a random game</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mainButton, styles.createButton]}
            onPress={() => navigation.navigate('CreateRoom')}
          >
            <Text style={styles.mainButtonText}>➕ Create Room</Text>
            <Text style={styles.mainButtonSubtext}>Host a private game</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mainButton, styles.joinButton]}
            onPress={() => navigation.navigate('JoinRoom')}
          >
            <Text style={styles.mainButtonText}>🔗 Join Room</Text>
            <Text style={styles.mainButtonSubtext}>Enter a room code</Text>
          </TouchableOpacity>
        </View>
      </View>
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
    justifyContent: 'flex-end',
    padding: SPACING.md,
  },
  profileButton: {
    backgroundColor: '#4A90E2',
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
  quickPlayButton: {
    backgroundColor: '#10B981', // Green
  },
  createButton: {
    backgroundColor: '#3B82F6', // Blue
  },
  joinButton: {
    backgroundColor: '#8B5CF6', // Purple
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
