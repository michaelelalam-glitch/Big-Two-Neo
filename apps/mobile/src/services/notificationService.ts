import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { notificationLogger } from '../utils/logger';
import { useUserPreferencesStore } from '../store/userPreferencesSlice';
import { i18n } from '../i18n';
import { supabase } from './supabase';

// Configure notification handler - determines how notifications appear when app is in foreground
// CRITICAL FIX: Removed deprecated shouldShowAlert - use shouldShowBanner and shouldShowList instead
// This prevents notification dismissal from blocking the game event loop
Notifications.setNotificationHandler({
  handleNotification: async notification => {
    const type = notification.request.content.data?.type as string | undefined;
    const prefs = useUserPreferencesStore.getState();
    const typeMap: Record<string, boolean> = {
      game_invite: prefs.notifyGameInvites,
      room_invite: prefs.notifyGameInvites,
      your_turn: prefs.notifyYourTurn,
      player_turn: prefs.notifyYourTurn,
      game_started: prefs.notifyGameStarted,
      friend_request: prefs.notifyFriendRequests,
      friend_accepted: prefs.notifyFriendRequests,
    };
    const allowed = type ? (typeMap[type] ?? true) : true;
    return {
      shouldPlaySound: allowed,
      shouldSetBadge: allowed,
      shouldShowBanner: allowed,
      shouldShowList: allowed,
    };
  },
});

export interface PushToken {
  token: string;
  platform: 'ios' | 'android' | 'web';
}

/**
 * Registers the device for push notifications and returns the Expo push token
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  let token: string | null = null;

  // Check if we're on a physical device
  if (!Device.isDevice) {
    notificationLogger.warn('Push notifications only work on physical devices');
    return null;
  }

  try {
    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      notificationLogger.warn('Failed to get push notification permissions');
      return null;
    }

    // Get the native FCM push token for Android (required for FCM v1 API)
    if (Platform.OS === 'android') {
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      token = deviceToken.data;
      notificationLogger.info('✅ Native FCM Token (Android):', token);
    } else {
      // For iOS, still use Expo push token
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;

      if (!projectId) {
        notificationLogger.error('Project ID not found in app configuration');
        return null;
      }

      const expoPushToken = await Notifications.getExpoPushTokenAsync({
        projectId,
      });

      token = expoPushToken.data;
      notificationLogger.info('✅ Expo Push Token (iOS):', token);
    }

    // Configure Android notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: i18n.t('notificationChannels.default'),
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF6B6B',
      });

      // Channel for game invites
      await Notifications.setNotificationChannelAsync('game-updates', {
        name: i18n.t('notificationChannels.gameUpdates'),
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF6B6B',
        sound: 'default',
      });

      // Channel for turn notifications
      await Notifications.setNotificationChannelAsync('turn-notifications', {
        name: i18n.t('notificationChannels.turnNotifications'),
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250],
        lightColor: '#4ECDC4',
        sound: 'default',
      });

      // Channel for social interactions (friend requests, etc.)
      await Notifications.setNotificationChannelAsync('social', {
        name: i18n.t('notificationChannels.social'),
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250],
        lightColor: '#95E1D3',
        sound: 'default',
      });
    }

    return token;
  } catch (error: unknown) {
    // Only log error message/code to avoid exposing internal error details (DB connections, stack traces, etc.)
    notificationLogger.error(
      'Error registering for push notifications:',
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

/**
 * Saves the push token to the database for the current user
 */
export async function savePushTokenToDatabase(userId: string, pushToken: string): Promise<boolean> {
  try {
    notificationLogger.info('💾 [savePushToken] Starting database save...', {
      userId: userId.substring(0, 8),
      platform: Platform.OS,
    });

    const platform = Platform.OS as 'ios' | 'android' | 'web';

    const { error } = await supabase.from('push_tokens').upsert(
      {
        user_id: userId,
        push_token: pushToken,
        platform: platform,
        updated_at: new Date().toISOString(),
      },
      {
        // Must match the actual DB unique constraint: UNIQUE (user_id, push_token)
        // Using just 'user_id' would fail — there is no unique constraint on user_id alone.
        onConflict: 'user_id,push_token',
      }
    );

    if (error) {
      // Only log error message/code to avoid exposing internal error details
      notificationLogger.error(
        '❌ [savePushToken] Database error:',
        error?.message || error?.code || 'Unknown error'
      );
      return false;
    }

    notificationLogger.info('✅ [savePushToken] Push token saved successfully to database!');
    return true;
  } catch (error: unknown) {
    // Only log error message/code to avoid exposing internal error details
    notificationLogger.error(
      'Error saving push token to database:',
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Removes the push token from the database (call on sign out)
 */
export async function removePushTokenFromDatabase(userId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('push_tokens').delete().eq('user_id', userId);

    if (error) {
      notificationLogger.error(
        'Error removing push token:',
        error?.message || error?.code || 'Unknown error'
      );
      return false;
    }

    notificationLogger.info('Push token removed successfully');
    return true;
  } catch (error: unknown) {
    // Only log error message/code to avoid exposing internal error details
    notificationLogger.error(
      'Error removing push token from database:',
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Schedules a local notification (for testing purposes)
 */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data || {},
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
    },
  });
}

/**
 * Gets the last notification response (useful for deep linking on app launch)
 */
export async function getLastNotificationResponse() {
  return await Notifications.getLastNotificationResponseAsync();
}

/**
 * Clears app badge count
 */
export async function clearBadgeCount() {
  await Notifications.setBadgeCountAsync(0);
}

/**
 * Sets app badge count
 */
export async function setBadgeCount(count: number) {
  await Notifications.setBadgeCountAsync(count);
}
