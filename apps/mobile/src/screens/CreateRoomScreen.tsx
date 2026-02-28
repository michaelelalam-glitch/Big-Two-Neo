import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../services/supabase';
import { RoomPlayerWithRoom } from '../types';
import { showError, showConfirm } from '../utils';
import { roomLogger } from '../utils/logger';

type CreateRoomNavigationProp = StackNavigationProp<RootStackParamList, 'CreateRoom'>;

export default function CreateRoomScreen() {
  const navigation = useNavigation<CreateRoomNavigationProp>();
  const { user, profile } = useAuth();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateRoom = async () => {
    if (!user) {
      showError(i18n.t('room.mustBeSignedIn'));
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
        roomLogger.error('❌ Error checking existing room:', checkError?.message || checkError?.code || 'Unknown error');
        throw checkError;
      }

      const roomPlayer = existingRoomPlayer as RoomPlayerWithRoom | null;
      if (roomPlayer) {
        const existingCode = roomPlayer.rooms.code;
        const roomStatus = roomPlayer.rooms.status;
        
        roomLogger.warn('⚠️ User already in room:', existingCode, 'Status:', roomStatus);
        
        // Note: Reduced from 3-button (Cancel, Go to Room, Leave & Create) to 2-button dialog.
        // "Go to Room" becomes the cancel action, "Leave & Create" is the confirm action.
        // Users can still dismiss by tapping outside (iOS) or back button (Android).
        const goToRoom = () => {
          setIsCreating(false);
          navigation.replace('Lobby', { roomCode: existingCode });
        };
        
        const leaveAndCreate = async () => {
                try {
                  // Leave the existing room
                  const { error: leaveError } = await supabase
                    .from('room_players')
                    .delete()
                    .eq('room_id', roomPlayer.room_id)
                    .eq('user_id', user.id);

                  if (leaveError) {
                    roomLogger.error('Error leaving room:', leaveError);
                    showError(i18n.t('room.leaveRoomError'));
                    setIsCreating(false);
                    return;
                  }

                  roomLogger.info('✅ Left room:', existingCode);
                  
                  // Poll DB to confirm user has left before proceeding
                  const maxAttempts = 10;
                  const pollInterval = 300; // ms
                  let attempt = 0;
                  let isDeleted = false;
                  
                  while (attempt < maxAttempts && !isDeleted) {
                    const { data: checkData, error: checkErr } = await supabase
                      .from('room_players')
                      .select('id')
                      .eq('room_id', roomPlayer.room_id)
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
                    roomLogger.error('❌ Database replication lag: Could not confirm room leave after 3 seconds');
                    showError(
                      i18n.t('room.leaveTimeout'),
                      i18n.t('common.timeout')
                    );
                    setIsCreating(false);
                    return;
                  }
                  
                  // Retry creating room
                  handleCreateRoom();
                } catch (error: unknown) {
                  // Only log error message/code to avoid exposing DB internals
                  roomLogger.error('Error in leave & create:', error instanceof Error ? error.message : String(error));
                  showError(i18n.t('room.leaveRoomError'));
                  setIsCreating(false);
                }
              };
        
        showConfirm({
          title: i18n.t('room.alreadyInRoom'),
          message: i18n.t('room.alreadyInRoomMessage', { code: existingCode, status: roomStatus }),
          confirmText: i18n.t('room.goToRoom'),
          cancelText: i18n.t('room.leaveAndCreate'),
          destructive: true,
          onConfirm: goToRoom,
          onCancel: leaveAndCreate
        });
        return;
      }

      // CRITICAL FIX: Use get_or_create_room RPC instead of manual INSERT + join_room_atomic
      // This ensures atomic room creation and user join in a single transaction
      const username = profile?.username || `Player_${user.id.substring(0, 8)}`;
      
      const { data: roomResult, error: createError } = await supabase
        .rpc('get_or_create_room', {
          p_user_id: user.id,
          p_username: username,
          p_is_public: false, // PRIVATE room for Create Room
          p_is_matchmaking: false,
          p_ranked_mode: false
        });

      if (createError) {
        roomLogger.error('❌ Room creation failed:', createError);
        throw createError;
      }

      const result = roomResult as { success: boolean; room_code: string; room_id: string };
      
      if (!result || !result.success || !result.room_code) {
        throw new Error('Failed to create room: Invalid response from server');
      }

      roomLogger.info('✅ Room created and joined successfully:', result.room_code);

      // Navigate to lobby
      navigation.replace('Lobby', { roomCode: result.room_code });
    } catch (error: unknown) {
      // Only log error message/code to avoid exposing DB internals or auth tokens
      const msg = error instanceof Error ? error.message : String(error);
      roomLogger.error('Error creating room:', msg);
      showError(msg || i18n.t('room.createRoomError'));
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
          <Text style={styles.backButtonText}>← {i18n.t('common.back')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{i18n.t('room.createTitle')}</Text>
        <Text style={styles.subtitle}>
          {i18n.t('room.createSubtitle')}
        </Text>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>📋 {i18n.t('room.shareableCode')}</Text>
          <Text style={styles.infoText}>👥 {i18n.t('room.upTo4Players')}</Text>
          <Text style={styles.infoText}>🤖 {i18n.t('room.fillWithBots')}</Text>
          <Text style={styles.infoText}>⚙️ {i18n.t('room.customizeSettings')}</Text>
        </View>

        <TouchableOpacity
          style={[styles.createButton, isCreating && styles.buttonDisabled]}
          onPress={handleCreateRoom}
          disabled={isCreating}
        >
          {isCreating ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.createButtonText}>{i18n.t('room.createButton')}</Text>
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
