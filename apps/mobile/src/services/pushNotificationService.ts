/**
 * Push Notification Service
 *
 * @deprecated P10-M2: This module is DEPRECATED in favour of pushNotificationTriggers.ts,
 * which uses the authenticated Supabase client (user JWT) instead of the anon key.
 * Using SUPABASE_ANON_KEY here bypasses the room-membership check enforced by the
 * send-push-notification edge function for user-JWT callers.
 *
 * All new call-sites should import from pushNotificationTriggers.ts. This file is
 * retained only for backwards-compatibility during the migration period. It will be
 * removed in a future release.
 *
 * @see pushNotificationTriggers.ts — the canonical push notification entry point.
 */

import { notificationLogger } from '../utils/logger';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  notificationLogger.warn('⚠️ Supabase credentials not found. Push notifications will not work.');
}

const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/send-push-notification`;

interface NotificationData {
  type: 'game_invite' | 'your_turn' | 'game_started' | 'friend_request' | 'friend_accepted';
  roomCode?: string;
  [key: string]: unknown;
}

interface SendNotificationOptions {
  userIds: string[];
  title: string;
  body: string;
  data?: NotificationData;
  badge?: number;
}

/**
 * Send push notifications to multiple users
 */
async function sendPushNotifications(options: SendNotificationOptions): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    notificationLogger.warn('Skipping push notification: Supabase not configured');
    return false;
  }

  try {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        user_ids: options.userIds,
        title: options.title,
        body: options.body,
        data: options.data,
        badge: options.badge,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      // Log only error message, not full response (may contain API keys)
      notificationLogger.error(
        'Failed to send push notifications:',
        error?.message || error?.error || 'API request failed'
      );
      return false;
    }

    const result = await response.json();
    notificationLogger.info(`✅ Sent ${result.sent} notification(s)`);
    return true;
  } catch (error: unknown) {
    notificationLogger.error(
      'Error sending push notifications:',
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Send game invite notification
 */
export async function notifyGameInvite(
  userIds: string[],
  roomCode: string,
  inviterName: string
): Promise<boolean> {
  return sendPushNotifications({
    userIds,
    title: 'Game Invite',
    body: `${inviterName} invited you to join a game!`,
    data: {
      type: 'game_invite',
      roomCode,
    },
  });
}

/**
 * Send "your turn" notification
 */
export async function notifyYourTurn(
  userId: string,
  roomCode: string,
  gameInfo?: string
): Promise<boolean> {
  return sendPushNotifications({
    userIds: [userId],
    title: "It's Your Turn!",
    body: gameInfo || 'Make your move in Stephanos',
    data: {
      type: 'your_turn',
      roomCode,
    },
    badge: 1,
  });
}

/**
 * Send game started notification
 */
export async function notifyGameStarted(userIds: string[], roomCode: string): Promise<boolean> {
  return sendPushNotifications({
    userIds,
    title: 'Game Started!',
    body: 'Your Stephanos game is starting now',
    data: {
      type: 'game_started',
      roomCode,
    },
  });
}

/**
 * Send friend request notification
 */
export async function notifyFriendRequest(
  userId: string,
  senderName: string,
  senderId: string
): Promise<boolean> {
  return sendPushNotifications({
    userIds: [userId],
    title: 'Friend Request',
    body: `${senderName} sent you a friend request`,
    data: {
      type: 'friend_request',
      senderId,
    },
  });
}

/**
 * Send notification when a friend request is accepted
 */
export async function notifyFriendAccepted(
  userId: string,
  accepterName: string,
  accepterId: string
): Promise<boolean> {
  return sendPushNotifications({
    userIds: [userId],
    title: 'Friend Request Accepted',
    body: `${accepterName} accepted your friend request`,
    data: {
      type: 'friend_accepted',
      senderId: accepterId,
    },
  });
}

/**
 * Batch notify all players except the current player
 */
export async function notifyOtherPlayers(
  allPlayerIds: string[],
  currentPlayerId: string,
  title: string,
  body: string,
  roomCode: string,
  notificationType: 'game_invite' | 'your_turn' | 'game_started' | 'friend_request' = 'game_started'
): Promise<boolean> {
  const otherPlayerIds = allPlayerIds.filter(id => id !== currentPlayerId);

  if (otherPlayerIds.length === 0) {
    return true; // No one to notify
  }

  return sendPushNotifications({
    userIds: otherPlayerIds,
    title,
    body,
    data: {
      type: notificationType,
      roomCode,
    },
  });
}

export default {
  notifyGameInvite,
  notifyYourTurn,
  notifyGameStarted,
  notifyFriendRequest,
  notifyFriendAccepted,
  notifyOtherPlayers,
};
