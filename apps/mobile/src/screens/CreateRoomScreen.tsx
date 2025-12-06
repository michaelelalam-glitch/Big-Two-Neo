import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';

type CreateRoomNavigationProp = StackNavigationProp<RootStackParamList, 'CreateRoom'>;

export default function CreateRoomScreen() {
  const navigation = useNavigation<CreateRoomNavigationProp>();
  const { user } = useAuth();
  const [isCreating, setIsCreating] = useState(false);

  const generateRoomCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude O, I, 0, 1 to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handleCreateRoom = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be signed in to create a room');
      return;
    }

    setIsCreating(true);
    try {
      // Check if user is already in a room (with status check)
      const { data: existingRoomPlayer, error: checkError } = await supabase
        .from('room_players')
        .select('room_id, rooms!inner(code, status)')
        .eq('user_id', user.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.error('❌ Error checking existing room:', checkError);
        throw checkError;
      }

      if (existingRoomPlayer) {
        const existingCode = existingRoomPlayer.rooms.code;
        const roomStatus = existingRoomPlayer.rooms.status;
        
        console.log('⚠️ User already in room:', existingCode, 'Status:', roomStatus);
        
        Alert.alert(
          'Already in Room',
          `You're already in room ${existingCode} (${roomStatus}). What would you like to do?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Go to Room', 
              onPress: () => {
                setIsCreating(false);
                navigation.replace('Lobby', { roomCode: existingCode });
              }
            },
            {
              text: 'Leave & Create New',
              style: 'destructive',
              onPress: async () => {
                try {
                  // Leave the existing room
                  const { error: leaveError } = await supabase
                    .from('room_players')
                    .delete()
                    .eq('room_id', existingRoomPlayer.room_id)
                    .eq('user_id', user.id);

                  if (leaveError) {
                    console.error('Error leaving room:', leaveError);
                    Alert.alert('Error', 'Failed to leave existing room');
                    setIsCreating(false);
                    return;
                  }

                  console.log('✅ Left room:', existingCode);
                  
                  // Poll DB to confirm user has left before proceeding
                  const maxAttempts = 10;
                  const pollInterval = 300; // ms
                  let attempt = 0;
                  let isDeleted = false;
                  
                  while (attempt < maxAttempts && !isDeleted) {
                    const { data: checkData, error: checkErr } = await supabase
                      .from('room_players')
                      .select('id')
                      .eq('room_id', existingRoomPlayer.room_id)
                      .eq('user_id', user.id);
                    
                    if (checkErr) break;
                    if (!checkData || checkData.length === 0) {
                      isDeleted = true;
                      break;
                    }
                    
                    attempt++;
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                  }
                  
                  if (!isDeleted) {
                    console.error('❌ Database replication lag: Could not confirm room leave after 3 seconds');
                    Alert.alert(
                      'Timeout', 
                      'Taking longer than expected to leave room. Please try again or wait a moment.',
                      [{ text: 'OK' }]
                    );
                    setIsCreating(false);
                    return;
                  }
                  
                  // Retry creating room
                  handleCreateRoom();
                } catch (error: any) {
                  console.error('Error in leave & create:', error);
                  Alert.alert('Error', 'Failed to leave room');
                  setIsCreating(false);
                }
              }
            }
          ]
        );
        return;
      }

      const roomCode = generateRoomCode();
      
      // Create PRIVATE room in Supabase
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .insert({
          code: roomCode,
          host_id: null, // Let join_room_atomic set the host
          status: 'waiting',
          is_public: false, // PRIVATE room for Create Room
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (roomError) throw roomError;

      // Use atomic join to add creator as host
      const username = user.user_metadata?.username || `Player_${user.id.substring(0, 8)}`;
      const { data: joinResult, error: playerError } = await supabase
        .rpc('join_room_atomic', {
          p_room_code: roomCode,
          p_user_id: user.id,
          p_username: username
        });

      if (playerError) {
        console.error('❌ Atomic join error in CreateRoom:', playerError);
        throw playerError;
      }

      console.log('✅ Host added to room (atomic):', joinResult);

      // Navigate to lobby
      navigation.replace('Lobby', { roomCode });
    } catch (error: any) {
      console.error('Error creating room:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      const errorMessage = error?.message || error?.error_description || error?.msg || 'Failed to create room';
      Alert.alert('Error', errorMessage);
    } finally {
      setIsCreating(false);
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
        <Text style={styles.title}>Create Room</Text>
        <Text style={styles.subtitle}>
          Create a private room and invite your friends
        </Text>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>📋 You'll get a shareable room code</Text>
          <Text style={styles.infoText}>👥 Up to 4 players can join</Text>
          <Text style={styles.infoText}>🤖 Fill empty slots with bots</Text>
          <Text style={styles.infoText}>⚙️ Customize game settings</Text>
        </View>

        <TouchableOpacity
          style={[styles.createButton, isCreating && styles.buttonDisabled]}
          onPress={handleCreateRoom}
          disabled={isCreating}
        >
          {isCreating ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.createButtonText}>Create Room</Text>
          )}
        </TouchableOpacity>
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
  infoBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  infoText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    marginBottom: SPACING.sm,
  },
  createButton: {
    backgroundColor: '#3B82F6',
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
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
});
