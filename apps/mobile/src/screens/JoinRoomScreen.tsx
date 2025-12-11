import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { RoomPlayerWithRoom } from '../types';
import { roomLogger } from '../utils/logger';

type JoinRoomNavigationProp = StackNavigationProp<RootStackParamList, 'JoinRoom'>;

export default function JoinRoomScreen() {
  const navigation = useNavigation<JoinRoomNavigationProp>();
  const { user } = useAuth();
  const [roomCode, setRoomCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleJoinRoom = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be signed in to join a room');
      return;
    }

    if (roomCode.length !== 6) {
      Alert.alert('Invalid Code', 'Room code must be 6 characters');
      return;
    }

    setIsJoining(true);
    try {
      // Check if user is already in a room
      const { data: existingRoomPlayer, error: checkError } = await supabase
        .from('room_players')
        .select('room_id, rooms!inner(code)')
        .eq('user_id', user.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw checkError;
      }

      const roomPlayer = existingRoomPlayer as RoomPlayerWithRoom | null;
      if (roomPlayer) {
        const existingCode = roomPlayer.rooms.code;
        // Check if trying to join the same room they're already in
        if (existingCode === roomCode.toUpperCase()) {
          // Already in this room, just navigate
          navigation.replace('Lobby', { roomCode: roomCode.toUpperCase() });
          return;
        } else {
          // In a different room
          Alert.alert(
            'Already in Room',
            `You're already in room ${existingCode}. Leave it first to join a different room.`,
            [
              { text: 'Cancel', style: 'cancel' },
              { 
                text: 'Go to Current Room', 
                onPress: () => navigation.replace('Lobby', { roomCode: existingCode })
              }
            ]
          );
          return;
        }
      }

      // Find room by code
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', roomCode.toUpperCase())
        .single();

      if (roomError || !roomData) {
        throw new Error('Room not found');
      }

      // Use atomic join function to prevent race conditions
      const username = user.user_metadata?.username || `Player_${user.id.substring(0, 8)}`;
      const { data: joinResult, error: joinError } = await supabase
        .rpc('join_room_atomic', {
          p_room_code: roomCode.toUpperCase(),
          p_user_id: user.id,
          p_username: username
        });

      if (joinError) {
        roomLogger.error('❌ Atomic join error:', joinError?.message || joinError?.code || 'Unknown error');
        
        // Handle specific error cases
        if (joinError.message?.includes('Room is full')) {
          throw new Error('Room is full (4/4 players)');
        } else if (joinError.message?.includes('already in another room')) {
          Alert.alert('Error', 'You are already in another room. Please leave it first.');
          return;
        }
        // Note: Username conflicts are prevented by the global username uniqueness constraint.
        // The auto-generated Player_{user_id} format ensures each user's username is unique globally.
        throw joinError;
      }

      roomLogger.info('🎉 Successfully joined room (atomic):', joinResult);
      // Navigate to lobby
      navigation.replace('Lobby', { roomCode: roomCode.toUpperCase() });
    } catch (error: any) {
      roomLogger.error('Error joining room:', error?.message || error?.code || String(error));
      Alert.alert('Error', error.message || 'Failed to join room');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Join Room</Text>
        <Text style={styles.subtitle}>
          Enter a 6-character room code to join
        </Text>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={roomCode}
            onChangeText={(text) => setRoomCode(text.toUpperCase())}
            placeholder="ABC123"
            placeholderTextColor={COLORS.gray.medium}
            maxLength={6}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!isJoining}
          />
        </View>

        <TouchableOpacity
          style={[styles.joinButton, (isJoining || roomCode.length !== 6) && styles.buttonDisabled]}
          onPress={handleJoinRoom}
          disabled={isJoining || roomCode.length !== 6}
        >
          {isJoining ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.joinButtonText}>Join Room</Text>
          )}
        </TouchableOpacity>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>💡 Tip:</Text>
          <Text style={styles.infoText}>
            Ask your friend for the room code and enter it here to join their game
          </Text>
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
    padding: SPACING.md,
  },
  backButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
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
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  inputContainer: {
    width: '100%',
    marginBottom: SPACING.lg,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 2,
    borderColor: '#8B5CF6',
    borderRadius: 12,
    padding: SPACING.lg,
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.white,
    textAlign: 'center',
    letterSpacing: 8,
  },
  joinButton: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 12,
    minWidth: 200,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    marginBottom: SPACING.xl,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  joinButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  infoBox: {
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderRadius: 12,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  infoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.white,
    marginBottom: SPACING.xs,
  },
});
