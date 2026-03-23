import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { notifyPlayerJoined } from '../services/pushNotificationTriggers';
import { supabase } from '../services/supabase';
import { RoomPlayerWithRoom } from '../types';
import { showError, showConfirm } from '../utils';
import { roomLogger } from '../utils/logger';

type JoinRoomNavigationProp = StackNavigationProp<RootStackParamList, 'JoinRoom'>;

export default function JoinRoomScreen() {
  const navigation = useNavigation<JoinRoomNavigationProp>();
  const { user, profile } = useAuth();
  const [roomCode, setRoomCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleJoinRoom = async () => {
    if (!user) {
      showError(i18n.t('room.mustBeSignedIn'));
      return;
    }

    if (roomCode.length !== 6) {
      showError(i18n.t('room.invalidCode'), i18n.t('room.invalidCodeTitle'));
      return;
    }

    setIsJoining(true);
    try {
      // Check if user is already in a room
      const { data: existingRoomPlayer, error: checkError } = await supabase
        .from('room_players')
        .select('room_id, rooms!inner(code, status)')
        .eq('user_id', user.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        // PGRST116 = no rows returned
        throw checkError;
      }

      const roomPlayer = existingRoomPlayer as RoomPlayerWithRoom | null;
      if (roomPlayer) {
        const existingCode = roomPlayer.rooms.code;
        const existingStatus = roomPlayer.rooms.status;
        // Check if trying to join the same room they're already in
        if (existingCode === roomCode.toUpperCase()) {
          // Already in this room — navigate directly; if the game is in progress
          // go to the Game screen so we don't attempt a lobby mutation on a
          // playing room.
          if (existingStatus === 'playing') {
            navigation.replace('Game', { roomCode: roomCode.toUpperCase() });
          } else {
            navigation.replace('Lobby', { roomCode: roomCode.toUpperCase() });
          }
          return;
        } else {
          // In a different room — let the user leave and join the requested room, or go back
          showConfirm({
            title: i18n.t('room.alreadyInRoom'),
            message: i18n.t('room.alreadyInDifferentRoom', { code: existingCode }),
            confirmText: i18n.t('room.leaveAndJoin'),
            cancelText: i18n.t('room.goToCurrentRoom'),
            destructive: true,
            onConfirm: async () => {
              try {
                // Check if the user is the host of their current room.
                // Direct DELETE is blocked by RLS for other players' rows, and
                // leaving without host-transfer breaks the room. Use the
                // SECURITY DEFINER RPC when the user is the host.
                const { data: hostCheck, error: hostCheckError } = await supabase
                  .from('room_players')
                  .select('is_host')
                  .eq('room_id', roomPlayer.room_id)
                  .eq('user_id', user.id)
                  .single();
                if (hostCheckError) throw hostCheckError;
                if (hostCheck?.is_host) {
                  const { error: leaveError } = await supabase.rpc('lobby_host_leave', {
                    p_room_id: roomPlayer.room_id,
                    p_leaving_user_id: user.id,
                  });
                  if (leaveError) throw leaveError;
                } else {
                  const { error: leaveError } = await supabase
                    .from('room_players')
                    .delete()
                    .eq('room_id', roomPlayer.room_id)
                    .eq('user_id', user.id);
                  if (leaveError) throw leaveError;
                }
                // Retry the join now that the user has left the previous room
                await handleJoinRoom();
              } catch (err: unknown) {
                roomLogger.error(
                  'Error leaving room before join:',
                  err instanceof Error ? err.message : String(err)
                );
                showError(i18n.t('room.leaveRoomError'));
              }
            },
            onCancel: () => navigation.replace('Lobby', { roomCode: existingCode }),
          });
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
        throw new Error(i18n.t('room.roomNotFound'));
      }

      // Use atomic join function to prevent race conditions
      const username = profile?.username || `Player_${user.id.substring(0, 8)}`;
      const { data: joinResult, error: joinError } = await supabase.rpc('join_room_atomic', {
        p_room_code: roomCode.toUpperCase(),
        p_user_id: user.id,
        p_username: username,
      });

      if (joinError) {
        roomLogger.error(
          '❌ Atomic join error:',
          joinError?.message || joinError?.code || 'Unknown error'
        );

        // Handle specific error cases
        if (joinError.message?.includes('Room is full')) {
          throw new Error(i18n.t('room.roomFull'));
        } else if (joinError.message?.includes('already in another room')) {
          showError(i18n.t('room.alreadyInAnotherRoom'));
          return;
        } else if (joinError.message?.includes('kicked from this private room')) {
          // Fetch the room host name for a more informative error message
          let hostName = 'The host';
          try {
            const { data: hostData } = await supabase
              .from('room_players')
              .select('profiles(username)')
              .eq('room_id', roomData?.id)
              .eq('is_host', true)
              .single();
            const profiles = hostData?.profiles as
              | { username?: string }
              | { username?: string }[]
              | null;
            const profile_ = Array.isArray(profiles) ? profiles[0] : profiles;
            if (profile_?.username) hostName = profile_.username;
          } catch {
            /* best-effort */
          }
          Alert.alert(
            i18n.t('lobby.kickedTitle'),
            i18n.t('room.kickedFromRoomByHost', { hostName }),
            [{ text: i18n.t('common.ok'), style: 'default' }],
            { cancelable: false }
          );
          return;
        }
        // Note: Username conflicts are prevented by the global username uniqueness constraint.
        // The auto-generated Player_{user_id} format ensures each user's username is unique globally.
        throw joinError;
      }

      roomLogger.info('🎉 Successfully joined room (atomic):', joinResult);

      // Notify other players in the room (roomData already fetched above)
      if (roomData?.id) {
        notifyPlayerJoined(roomData.id, roomCode.toUpperCase(), username, user.id).catch(err =>
          console.error('Failed to send player joined notification:', err)
        );
      }

      // Always route to Lobby (consistent routing for all game types)
      roomLogger.info(`[JoinRoom] Routing to Lobby`);
      navigation.replace('Lobby', { roomCode: roomCode.toUpperCase() });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      roomLogger.error('Error joining room:', msg);
      showError(msg || i18n.t('room.joinRoomError'));
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>← {i18n.t('common.back')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: SPACING.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <Text style={styles.title}>{i18n.t('room.joinTitle')}</Text>
          <Text style={styles.subtitle}>{i18n.t('room.joinSubtitle')}</Text>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={roomCode}
              onChangeText={text => setRoomCode(text.toUpperCase())}
              placeholder="ABC123"
              placeholderTextColor={COLORS.gray.medium}
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!isJoining}
              testID="room-code-input"
            />
          </View>

          <TouchableOpacity
            style={[
              styles.joinButton,
              (isJoining || roomCode.length !== 6) && styles.buttonDisabled,
            ]}
            onPress={handleJoinRoom}
            disabled={isJoining || roomCode.length !== 6}
          >
            {isJoining ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.joinButtonText}>{i18n.t('room.joinButton')}</Text>
            )}
          </TouchableOpacity>

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>💡 {i18n.t('room.tip')}:</Text>
            <Text style={styles.infoText}>{i18n.t('room.askFriendForCode')}</Text>
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
