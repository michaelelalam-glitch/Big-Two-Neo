import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';

type HomeScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { user } = useAuth();
  const [isQuickPlaying, setIsQuickPlaying] = useState(false);

  const generateRoomCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude O, I, 0, 1 to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handleQuickPlay = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be signed in to quick play');
      return;
    }

    console.log('🎮 Quick Play started for user:', user.id);
    setIsQuickPlaying(true);
    try {
      // First, try to find an existing waiting room with space
      console.log('📡 Fetching available rooms...');
      const { data: availableRooms, error: searchError } = await supabase
        .from('rooms')
        .select('id, code, status, created_at')
        .eq('status', 'waiting')
        .order('created_at', { ascending: true });

      console.log('📊 Available rooms:', availableRooms?.length || 0);
      if (searchError) {
        console.error('❌ Search error:', searchError);
        throw searchError;
      }

      // Check each room for space
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

      // If found a room, join it
      if (roomWithSpace) {
        console.log('✅ Joining existing room:', roomWithSpace.code);
        
        // Add player to the room
        const { error: joinError } = await supabase
          .from('room_players')
          .insert({
            room_id: roomWithSpace.id,
            user_id: user.id,
            username: user.user_metadata?.username || `Player_${user.id.substring(0, 8)}`,
            player_index: roomWithSpace.playerCount,
            is_host: false,
            is_ready: false,
          });

        if (joinError) {
          console.error('❌ Join error:', joinError);
          throw joinError;
        }

        console.log('🎉 Successfully joined room!');
        // Navigate to lobby
        navigation.replace('Lobby', { roomCode: roomWithSpace.code, isHost: false });
      } else {
        // No available rooms, create a new one
        console.log('🆕 Creating new room...');
        const roomCode = generateRoomCode();
        
        const { data: roomData, error: roomError } = await supabase
          .from('rooms')
          .insert({
            code: roomCode,
            host_id: user.id,
            status: 'waiting',
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (roomError) {
          console.error('❌ Room creation error:', roomError);
          throw roomError;
        }
        console.log('✅ Room created:', roomCode);

        // Add host as first player
        const { error: playerError } = await supabase
          .from('room_players')
          .insert({
            room_id: roomData.id,
            user_id: user.id,
            username: user.user_metadata?.username || `Player_${user.id.substring(0, 8)}`,
            player_index: 0,
            is_host: true,
            is_ready: false,
          });

        if (playerError) {
          console.error('❌ Player insertion error:', playerError);
          throw playerError;
        }
        console.log('✅ Host added to room');

        // Navigate to lobby
        console.log('🚀 Navigating to lobby...');
        navigation.replace('Lobby', { roomCode, isHost: true });
      }
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
    fontSize: FONT_SIZES.lg,
    color: COLORS.gray.medium,
    marginBottom: SPACING.xl,
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
