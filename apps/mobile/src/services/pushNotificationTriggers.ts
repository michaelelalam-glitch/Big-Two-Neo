/**
 * Push Notification Triggers
 * 
 * Central service for triggering push notifications at key game events.
 * Uses the send-push-notification Edge Function to deliver notifications.
 */

import { supabase } from './supabase';
import { notificationLogger } from '../utils/logger';

interface NotificationPayload {
  user_ids: string[];
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  badge?: number;
}

/**
 * Send push notification via Edge Function
 */
async function sendPushNotification(payload: NotificationPayload): Promise<boolean> {
  try {
    notificationLogger.info('📤 [sendPushNotification] Invoking Edge Function with payload:', {
      user_count: payload.user_ids.length,
      title: payload.title,
      type: payload.data?.type
    });
    
    const response = await supabase.functions.invoke('send-push-notification', {
      body: payload,
    });

    if (response.error) {
      // Try to read the error body
      let errorBody = null;
      try {
        const blob = response.error.context?._bodyInit;
        if (blob && blob._data) {
          // Try to parse error from response
          const errorText = await fetch(`data:application/json;base64,${btoa(JSON.stringify(blob))}`).catch(() => null);
          errorBody = errorText;
        }
      } catch (e) {
        // Ignore blob parsing errors
      }
      
      notificationLogger.error('❌ [sendPushNotification] Edge Function error:', {
        message: response.error.message,
        status: response.error.context?.status,
        error_body: errorBody,
        execution_id: response.error.context?.headers?.map?.['x-deno-execution-id']
      });
      
      notificationLogger.error('🔍 CHECK SUPABASE LOGS:', {
        url: 'https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/logs/edge-functions',
        execution_id: response.error.context?.headers?.map?.['x-deno-execution-id']
      });
      
      return false;
    }
    
    const { data } = response;
    
    // Log the full response for debugging
    notificationLogger.info('📥 [sendPushNotification] Edge Function response:', {
      data: JSON.stringify(data)
    });

    // Check individual ticket results from Expo Push API
    if (data?.results && Array.isArray(data.results)) {
      const errors = data.results.filter((r: any) => r.status === 'error');
      
      if (errors.length > 0) {
        notificationLogger.error('❌ [sendPushNotification] Expo Push API errors:', {
          total: data.results.length,
          failed: errors.length,
          errors: errors.map((e: any) => ({
            error: e.details?.error,
            message: e.message
          }))
        });
        
        // Log specific error details
        errors.forEach((err: any, idx: number) => {
          if (err.details?.error === 'InvalidCredentials') {
            notificationLogger.error(
              `🔐 [sendPushNotification] FCM Configuration Missing!\n` +
              `   Android push notifications require Firebase Cloud Messaging (FCM) credentials.\n` +
              `   See: https://docs.expo.dev/push-notifications/fcm-credentials/`
            );
          } else if (err.details?.error === 'DeviceNotRegistered') {
            notificationLogger.warn('⚠️ [sendPushNotification] Device token expired or invalid');
          } else {
            notificationLogger.error(`❌ [sendPushNotification] Error ${idx + 1}:`, err.message);
          }
        });
        
        return false;
      }
    }

    notificationLogger.info('✅ [sendPushNotification] Success!', {
      sent: data?.sent || 0,
      successful: data?.results?.filter((r: any) => r.status === 'ok').length || 0
    });
    return true;
  } catch (error: any) {
    notificationLogger.error('❌ [sendPushNotification] Exception:', error?.message || String(error));
    return false;
  }
}

/**
 * Get non-bot player IDs from room
 */
async function getRoomPlayerIds(roomId: string, excludeUserId?: string): Promise<string[]> {
  try {
    const query = supabase
      .from('room_players')
      .select('user_id')
      .eq('room_id', roomId)
      .eq('is_bot', false);

    if (excludeUserId) {
      query.neq('user_id', excludeUserId);
    }

    const { data, error } = await query;

    if (error) {
      notificationLogger.error('Failed to fetch room players:', error.message);
      return [];
    }

    return (data || []).map(p => p.user_id).filter(Boolean);
  } catch (error: any) {
    notificationLogger.error('Error fetching room players:', error?.message || String(error));
    return [];
  }
}

/**
 * Notify all players when game starts
 */
export async function notifyGameStarted(roomId: string, roomCode: string): Promise<void> {
  notificationLogger.info('🎮 [notifyGameStarted] Called', { roomId, roomCode });
  
  const userIds = await getRoomPlayerIds(roomId);
  
  notificationLogger.info('👥 [notifyGameStarted] Found players:', { count: userIds.length, userIds });

  if (userIds.length === 0) {
    notificationLogger.warn('⚠️ [notifyGameStarted] No players to notify for game start');
    return;
  }

  const success = await sendPushNotification({
    user_ids: userIds,
    title: '🎮 Game Starting!',
    body: `Your game in room ${roomCode} is beginning. Good luck!`,
    data: {
      type: 'game_started',
      roomCode: roomCode, // FIXED: Use 'roomCode' not 'room_code' (matches Edge Function validation)
      roomId: roomId,
      screen: 'Game',
    },
    sound: 'default',
    badge: 1,
  });
  
  if (success) {
    notificationLogger.info('✅ [notifyGameStarted] Notification sent successfully');
  } else {
    notificationLogger.error('❌ [notifyGameStarted] Notification failed to send');
  }
}

/**
 * Notify player when it's their turn
 */
export async function notifyPlayerTurn(
  userId: string,
  roomCode: string,
  roomId: string,
  playerName?: string
): Promise<void> {
  await sendPushNotification({
    user_ids: [userId],
    title: '⏰ Your Turn!',
    body: `It's your turn to play in room ${roomCode}`,
    data: {
      type: 'player_turn',
      roomCode: roomCode, // camelCase
      roomId: roomId,     // camelCase
      screen: 'Game',
    },
    sound: 'default',
    badge: 1,
  });
}

/**
 * Notify all players when game ends
 */
export async function notifyGameEnded(
  roomId: string,
  roomCode: string,
  winnerName: string,
  winnerUserId: string
): Promise<void> {
  const allUserIds = await getRoomPlayerIds(roomId);

  if (allUserIds.length === 0) {
    notificationLogger.warn('No players to notify for game end');
    return;
  }

  // Notify winner
  await sendPushNotification({
    user_ids: [winnerUserId],
    title: '🎉 Victory!',
    body: `Congratulations! You won in room ${roomCode}!`,
    data: {
      type: 'game_ended',
      roomCode: roomCode,   // camelCase
      roomId: roomId,       // camelCase
      winner: winnerName,
      is_winner: true,
      screen: 'Game',
    },
    sound: 'default',
    badge: 1,
  });

  // Notify other players
  const otherUserIds = allUserIds.filter(id => id !== winnerUserId);
  if (otherUserIds.length > 0) {
    await sendPushNotification({
      user_ids: otherUserIds,
      title: '🏁 Game Over',
      body: `${winnerName} won the game in room ${roomCode}`,
      data: {
        type: 'game_ended',
        roomCode: roomCode,   // camelCase
        roomId: roomId,       // camelCase
        winner: winnerName,
        is_winner: false,
        screen: 'Game',
      },
      sound: 'default',
      badge: 1,
    });
  }
}

/**
 * Notify player when invited to room
 */
export async function notifyRoomInvite(
  recipientUserId: string,
  roomCode: string,
  roomId: string,
  inviterName: string
): Promise<void> {
  await sendPushNotification({
    user_ids: [recipientUserId],
    title: '🎴 Room Invite',
    body: `${inviterName} invited you to join room ${roomCode}`,
    data: {
      type: 'room_invite',
      roomCode: roomCode,   // camelCase
      roomId: roomId,       // camelCase
      inviter: inviterName,
      screen: 'JoinRoom',
    },
    sound: 'default',
    badge: 1,
  });
}

/**
 * Notify player when someone joins their room
 */
export async function notifyPlayerJoined(
  roomId: string,
  roomCode: string,
  joinerName: string,
  excludeUserId?: string
): Promise<void> {
  const userIds = await getRoomPlayerIds(roomId, excludeUserId);

  if (userIds.length === 0) {
    return;
  }

  await sendPushNotification({
    user_ids: userIds,
    title: '👋 Player Joined',
    body: `${joinerName} joined room ${roomCode}`,
    data: {
      type: 'player_joined',
      roomCode: roomCode,   // camelCase
      roomId: roomId,       // camelCase
      player_name: joinerName,
      screen: 'Lobby',
    },
    sound: 'default',
  });
}

/**
 * Notify players when auto-pass timer is about to expire
 */
export async function notifyAutoPassWarning(
  userId: string,
  roomCode: string,
  roomId: string,
  secondsRemaining: number
): Promise<void> {
  await sendPushNotification({
    user_ids: [userId],
    title: '⚠️ Time Running Out!',
    body: `${secondsRemaining}s left to play in room ${roomCode}`,
    data: {
      type: 'auto_pass_warning',
      roomCode: roomCode,   // camelCase
      roomId: roomId,       // camelCase
      seconds_remaining: secondsRemaining,
      screen: 'Game',
    },
    sound: 'default',
    badge: 1,
  });
}

/**
 * Notify when all players are ready
 */
export async function notifyAllPlayersReady(
  hostUserId: string,
  roomCode: string,
  roomId: string
): Promise<void> {
  await sendPushNotification({
    user_ids: [hostUserId],
    title: '✅ Ready to Start',
    body: `All players are ready in room ${roomCode}. You can start the game!`,
    data: {
      type: 'all_players_ready',
      roomCode: roomCode,   // camelCase
      roomId: roomId,       // camelCase
      screen: 'Lobby',
    },
    sound: 'default',
    badge: 1,
  });
}
