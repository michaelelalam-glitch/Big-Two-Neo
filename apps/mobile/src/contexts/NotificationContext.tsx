import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useRef,
  useCallback,
} from 'react';
import { Alert, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootStackParamList } from '../navigation/AppNavigator';
import {
  registerForPushNotificationsAsync,
  savePushTokenToDatabase,
  removePushTokenFromDatabase,
  getLastNotificationResponse,
  clearBadgeCount,
} from '../services/notificationService';
import { notificationLogger } from '../utils/logger';
import { i18n } from '../i18n';
import { useAuth } from './AuthContext';

export interface AppNotification {
  id: string;
  type:
    | 'game_invite'
    | 'room_invite'
    | 'friend_request'
    | 'friend_accepted'
    | 'game_started'
    | 'your_turn'
    | 'game_ended'
    | 'player_joined'
    | 'auto_pass_warning'
    | 'all_players_ready';
  title: string;
  body: string;
  data: Record<string, unknown>;
  receivedAt: string; // ISO timestamp
  read: boolean;
}

const NOTIFICATIONS_STORAGE_KEY = (userId: string) => `@big2_notifications_${userId}`;
const MAX_STORED_NOTIFICATIONS = 50;

// Module-level set of all valid notification types — used to validate raw
// FCM/Expo payload types before storing or routing so unknown type strings
// (e.g. 'test') are never cast into the typed union unsafely.
const VALID_NOTIFICATION_TYPES = new Set<AppNotification['type']>([
  'game_invite',
  'room_invite',
  'friend_request',
  'friend_accepted',
  'game_started',
  'your_turn',
  'game_ended',
  'player_joined',
  'auto_pass_warning',
  'all_players_ready',
]);

/** Maps raw FCM type strings sent by some Edge Function code paths to the
 *  canonical client-side type. This is the subset of server-side aliases
 *  needed for mobile client compatibility; the Edge Function may define
 *  additional aliases for preference or rate-limit normalization. */
const TYPE_ALIASES: Record<string, AppNotification['type']> = {
  player_turn: 'your_turn', // legacy alias used in send-push-notification
};

interface NotificationContextData {
  expoPushToken: string | null;
  notification: Notifications.Notification | null;
  isRegistered: boolean;
  storedNotifications: AppNotification[];
  unreadCount: number;
  markAllRead: () => void;
  clearAll: () => void;
  registerPushNotifications: () => Promise<void>;
  unregisterPushNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextData>({
  expoPushToken: null,
  notification: null,
  isRegistered: false,
  storedNotifications: [],
  unreadCount: 0,
  markAllRead: () => {},
  clearAll: () => {},
  registerPushNotifications: async () => {},
  unregisterPushNotifications: async () => {},
});

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

interface NotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider = ({ children }: NotificationProviderProps) => {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [storedNotifications, setStoredNotifications] = useState<AppNotification[]>([]);
  const { user, isLoggedIn } = useAuth();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  // Guard so cold-start notification processing runs exactly once per app launch
  // even when handleNotificationResponse is recreated on auth state changes.
  const hasHandledColdStartRef = useRef(false);

  const unreadCount = storedNotifications.filter(n => !n.read).length;

  // Load stored notifications for this user
  useEffect(() => {
    if (!user?.id) {
      setStoredNotifications([]);
      return;
    }
    AsyncStorage.getItem(NOTIFICATIONS_STORAGE_KEY(user.id))
      .then(raw => {
        if (!raw) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Corrupted payload — remove it so the app self-heals on next mount
          // rather than silently retrying the bad value forever.
          notificationLogger.warn(
            '[NotificationContext] Corrupted notification history detected; clearing storage.'
          );
          AsyncStorage.removeItem(NOTIFICATIONS_STORAGE_KEY(user.id)).catch(() => {});
          return;
        }
        if (Array.isArray(parsed)) {
          // Enforce MAX_STORED_NOTIFICATIONS in case an older app version stored
          // more items than the current cap.
          setStoredNotifications((parsed as AppNotification[]).slice(0, MAX_STORED_NOTIFICATIONS));
        }
      })
      .catch(() => {});
  }, [user?.id]);

  const persistNotifications = useCallback(
    (notifs: AppNotification[]) => {
      if (!user?.id) return;
      AsyncStorage.setItem(NOTIFICATIONS_STORAGE_KEY(user.id), JSON.stringify(notifs)).catch(
        () => {}
      );
    },
    [user?.id]
  );

  const addStoredNotification = useCallback(
    (notif: Notifications.Notification) => {
      if (!user?.id) return;
      const content = notif.request.content;
      const rawType = content.data?.type as string | undefined;
      // Apply Edge Function type aliases before validating (e.g. player_turn → your_turn)
      const aliasedType = rawType ? (TYPE_ALIASES[rawType] ?? rawType) : undefined;
      const isKnownType =
        !!aliasedType && VALID_NOTIFICATION_TYPES.has(aliasedType as AppNotification['type']);
      // Drop unrecognised types — all real server-sent types are in VALID_NOTIFICATION_TYPES.
      // Silently dropping unknown types avoids incorrect icon/navigation assignments
      // that would result from mapping an unknown type to a known one (e.g. game_invite).
      if (!isKnownType) {
        return;
      }
      const type = aliasedType as AppNotification['type'];
      const data = (content.data ?? {}) as Record<string, unknown>;

      // On Android, FCM background notifications sometimes don't populate
      // content.title / content.body from the FCM notification block.
      // Fall back to constructing display text from the structured data payload.
      let title = content.title || '';
      let body = content.body || '';

      if (!body) {
        if (type === 'room_invite' || type === 'game_invite') {
          const inviter = (data.inviter ?? data.inviterName) as string | undefined;
          const roomCode = data.roomCode as string | undefined;
          if (inviter && roomCode) {
            body = i18n.t('pushContent.roomInviteBody', { inviterName: inviter, roomCode });
          }
        } else if (type === 'friend_request') {
          // data payload only carries senderId (no name); use name if somehow present,
          // otherwise fall back to the title string which is self-contained.
          const senderName = (data.senderName ?? data.sender) as string | undefined;
          body = senderName
            ? i18n.t('pushContent.friendRequestBody', { senderName })
            : i18n.t('pushContent.friendRequestTitle');
        } else if (type === 'friend_accepted') {
          // Same: accepterName may not be in data payload.
          const accepterName = (data.accepterName ?? data.senderName) as string | undefined;
          body = accepterName
            ? i18n.t('pushContent.friendAcceptedBody', { accepterName })
            : i18n.t('pushContent.friendAcceptedTitle');
        } else if (type === 'your_turn') {
          const roomCode = (data.roomCode as string | undefined) ?? '';
          body = i18n.t('pushContent.yourTurnBody', { roomCode });
        } else if (type === 'game_started') {
          const roomCode = (data.roomCode as string | undefined) ?? '';
          body = i18n.t('pushContent.gameStartingBody', { roomCode });
        } else if (type === 'game_ended') {
          // Payload fields from complete-game edge function:
          //   winner      – winner's username (string)
          //   room_code   – snake_case room code
          //   is_winner   – boolean: true for the winning player, false for others
          const winnerName = (data.winner ?? data.winnerName) as string | undefined;
          const roomCode = ((data.room_code ?? data.roomCode) as string | undefined) ?? '';
          const isWinner = data.is_winner === true || data.is_winner === 'true';
          if (isWinner) {
            body = i18n.t('pushContent.victoryBody', { roomCode });
          } else if (winnerName) {
            body = i18n.t('pushContent.gameOverBody', { winnerName, roomCode });
          } else {
            body = i18n.t('pushContent.gameOverTitle'); // minimal safe fallback
          }
        } else if (type === 'player_joined') {
          // data.player_name is set by notifyPlayerJoined; data.roomCode is camelCase
          const joinerName = data.player_name as string | undefined;
          const roomCode = (data.roomCode as string | undefined) ?? '';
          body = joinerName
            ? i18n.t('pushContent.playerJoinedBody', { joinerName, roomCode })
            : i18n.t('pushContent.playerJoinedTitle');
        } else if (type === 'auto_pass_warning') {
          // data.seconds_remaining and data.roomCode are set by notifyAutoPassWarning
          const seconds = (data.seconds_remaining as number | undefined) ?? 0;
          const roomCode = (data.roomCode as string | undefined) ?? '';
          body = i18n.t('pushContent.timeRunningOutBody', { seconds, roomCode });
        } else if (type === 'all_players_ready') {
          // data.roomCode is set by notifyAllPlayersReady
          const roomCode = (data.roomCode as string | undefined) ?? '';
          body = i18n.t('pushContent.readyToStartBody', { roomCode });
        }
      }

      if (!title) {
        if (type === 'room_invite' || type === 'game_invite') {
          title = i18n.t('pushContent.roomInviteTitle');
        } else if (type === 'friend_request') {
          title = i18n.t('pushContent.friendRequestTitle');
        } else if (type === 'friend_accepted') {
          title = i18n.t('pushContent.friendAcceptedTitle');
        } else if (type === 'your_turn') {
          title = i18n.t('pushContent.yourTurnTitle');
        } else if (type === 'game_started') {
          title = i18n.t('pushContent.gameStartingTitle');
        } else if (type === 'game_ended') {
          const isWinner = data.is_winner === true || data.is_winner === 'true';
          title = isWinner
            ? i18n.t('pushContent.victoryTitle')
            : i18n.t('pushContent.gameOverTitle');
        } else if (type === 'player_joined') {
          title = i18n.t('pushContent.playerJoinedTitle');
        } else if (type === 'auto_pass_warning') {
          title = i18n.t('pushContent.timeRunningOutTitle');
        } else if (type === 'all_players_ready') {
          title = i18n.t('pushContent.readyToStartTitle');
        }
      }

      const entry: AppNotification = {
        id: notif.request.identifier,
        type,
        title,
        body,
        data,
        receivedAt: new Date().toISOString(),
        read: false,
      };
      setStoredNotifications(prev => {
        const existingIndex = prev.findIndex(n => n.id === entry.id);
        // 7.6: For friend_request/friend_accepted, deduplicate by a stable
        // identifier from content.data (friendshipId / sender user id) to prevent
        // duplicate entries when the same push fires twice. Avoid deduping by
        // body text, which incorrectly collapses distinct notifications from
        // different users who share the same display name.
        const getFriendDedupKey = (
          notificationType: AppNotification['type'],
          data: Record<string, unknown>
        ): string | null => {
          if (notificationType !== 'friend_request' && notificationType !== 'friend_accepted') {
            return null;
          }
          for (const candidate of [
            data.friendshipId,
            data.senderId,
            data.senderUserId,
            data.userId,
          ]) {
            if (typeof candidate === 'string' && candidate.length > 0) return candidate;
            if (typeof candidate === 'number' || typeof candidate === 'bigint')
              return String(candidate);
          }
          return null;
        };
        const entryDedupKey = getFriendDedupKey(type, entry.data);
        const contentDupIndex =
          existingIndex === -1 && entryDedupKey
            ? prev.findIndex(n => {
                if (n.type !== type) return false;
                return getFriendDedupKey(n.type, n.data) === entryDedupKey;
              })
            : -1;
        const dupeIndex = existingIndex !== -1 ? existingIndex : contentDupIndex;
        let next: AppNotification[];
        if (dupeIndex === -1) {
          next = [entry, ...prev];
        } else {
          const withoutExisting = [...prev];
          withoutExisting.splice(dupeIndex, 1);
          next = [entry, ...withoutExisting];
        }
        const limited = next.slice(0, MAX_STORED_NOTIFICATIONS);
        persistNotifications(limited);
        return limited;
      });
    },
    [persistNotifications, user?.id]
  );

  const markAllRead = useCallback(() => {
    setStoredNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }));
      persistNotifications(updated);
      return updated;
    });
  }, [persistNotifications]);

  const clearAll = useCallback(() => {
    setStoredNotifications([]);
    if (user?.id) {
      AsyncStorage.removeItem(NOTIFICATIONS_STORAGE_KEY(user.id)).catch(() => {});
    }
  }, [user?.id]);

  // Register for push notifications when user logs in
  const registerPushNotifications = useCallback(async () => {
    if (!user) {
      notificationLogger.warn('Cannot register push notifications: No user logged in');
      return;
    }

    try {
      const token = await registerForPushNotificationsAsync();

      if (token) {
        setExpoPushToken(token);

        // Save token to database
        const saved = await savePushTokenToDatabase(user.id, token);
        if (saved) {
          setIsRegistered(true);
          notificationLogger.info('✅ Push notifications registered successfully');
        }
      }
    } catch (error: unknown) {
      notificationLogger.error(
        'Error registering push notifications:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, [user]);

  // Unregister push notifications (call on sign out)
  const unregisterPushNotifications = useCallback(async () => {
    if (!user) return;

    try {
      await removePushTokenFromDatabase(user.id);
      setExpoPushToken(null);
      setIsRegistered(false);
      notificationLogger.info('✅ Push notifications unregistered successfully');
    } catch (error: unknown) {
      // Only log error message/code to avoid exposing internal error details
      notificationLogger.error(
        'Error unregistering push notifications:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, [user]);

  // Handle deep linking from notifications
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      // Normalise raw FCM type through aliases (mirrors addStoredNotification)
      const rawNotifType = data.type as string | undefined;
      const notifType: string | undefined = rawNotifType
        ? (TYPE_ALIASES[rawNotifType] ?? rawNotifType)
        : undefined;
      // Only log notification type and room code, redact user IDs and other sensitive data
      const sanitizedData = {
        type: data.type,
        roomCode: data.roomCode,
        // Omit userId, sender info, etc.
      };
      notificationLogger.info('Handling notification tap:', sanitizedData);

      // Clear badge when user interacts with notification
      clearBadgeCount();

      // Navigate based on notification type.
      // Guard against navigating to authenticated routes when the user is
      // logged out (NotificationProvider wraps the whole navigator, so these
      // routes may not exist in the auth stack).
      if (!isLoggedIn) {
        // Convert the payload to a deep link and fire via Linking so that
        // AppNavigator's pendingLinkRef captures it and replays the navigation
        // after the user signs in.
        let pendingUrl: string | null = null;
        if ((notifType === 'game_invite' || notifType === 'room_invite') && data.roomCode) {
          pendingUrl = `big2mobile://lobby/${data.roomCode as string}?joining=true`;
        } else if ((notifType === 'your_turn' || notifType === 'game_started') && data.roomCode) {
          pendingUrl = `big2mobile://game/${data.roomCode as string}`;
        } else if (notifType === 'game_ended') {
          // game_ended payload uses snake_case room_code; support camelCase fallback too.
          const rc = (data.room_code ?? data.roomCode) as string | undefined;
          if (rc) pendingUrl = `big2mobile://game/${rc}`;
        } else if (
          (notifType === 'player_joined' || notifType === 'all_players_ready') &&
          data.roomCode
        ) {
          pendingUrl = `big2mobile://lobby/${data.roomCode as string}`;
        } else if (notifType === 'auto_pass_warning' && data.roomCode) {
          pendingUrl = `big2mobile://game/${data.roomCode as string}`;
        } else if (notifType === 'friend_request' || notifType === 'friend_accepted') {
          pendingUrl = 'big2mobile://profile';
        }
        if (pendingUrl) {
          Linking.openURL(pendingUrl).catch((err: unknown) =>
            notificationLogger.warn(
              '[NotificationContext] Failed to queue pending notification deep link:',
              String(err)
            )
          );
        }
        return;
      }

      // User is logged in: record notification in history before navigating.
      // Covers backgrounded/closed-app cases that bypass addNotificationReceivedListener.
      addStoredNotification(response.notification);

      // L16: If the user is actively in a Game, confirm before deep-linking them away.
      const navState = navigation.getState();
      const navRoutes = navState?.routes;
      const navIdx = typeof navState?.index === 'number' ? navState.index : 0;
      const activeRoute =
        navRoutes && navIdx >= 0 && navIdx < navRoutes.length ? navRoutes[navIdx]?.name : undefined;
      const isInGame = activeRoute === 'Game';

      const doNavigate = () => {
        if ((notifType === 'game_invite' || notifType === 'room_invite') && data.roomCode) {
          navigation.navigate('Lobby', { roomCode: data.roomCode as string, joining: true });
        } else if (notifType === 'your_turn' && data.roomCode) {
          navigation.navigate('Game', { roomCode: data.roomCode as string });
        } else if (notifType === 'game_started' && data.roomCode) {
          navigation.navigate('Game', { roomCode: data.roomCode as string });
        } else if (notifType === 'game_ended') {
          // game_ended payload uses snake_case room_code from complete-game edge function.
          const rc = (data.room_code ?? data.roomCode) as string | undefined;
          if (rc) navigation.navigate('Game', { roomCode: rc });
        } else if (
          (notifType === 'player_joined' || notifType === 'all_players_ready') &&
          data.roomCode
        ) {
          navigation.navigate('Lobby', { roomCode: data.roomCode as string });
        } else if (notifType === 'auto_pass_warning' && data.roomCode) {
          navigation.navigate('Game', { roomCode: data.roomCode as string });
        } else if (notifType === 'friend_request' || notifType === 'friend_accepted') {
          // Don't yank user out of an active Lobby/Game session for friend
          // notifications — navigate to Notifications instead so they can see
          // the update without losing their current game context.
          const state = navigation.getState();
          const routes = state?.routes;
          const idx = typeof state?.index === 'number' ? state.index : 0;
          const currentRoute =
            routes && idx >= 0 && idx < routes.length ? routes[idx]?.name : undefined;
          if (currentRoute === 'Lobby' || currentRoute === 'Game') {
            navigation.navigate('Notifications');
          } else {
            navigation.navigate('Profile');
          }
        }
      };

      // For navigations that would move the user to a different game/lobby, confirm
      // if they are currently mid-game; social notifications navigate within app, no confirm.
      const requiresConfirm =
        isInGame &&
        (notifType === 'game_invite' ||
          notifType === 'room_invite' ||
          notifType === 'your_turn' ||
          notifType === 'game_started');

      if (requiresConfirm) {
        Alert.alert(
          'Leave current game?',
          'You have a notification that would navigate you away from your active game. Leave now?',
          [
            { text: 'Stay', style: 'cancel' },
            { text: 'Leave', style: 'destructive', onPress: doNavigate },
          ]
        );
      } else {
        doNavigate();
      }
    },
    [navigation, addStoredNotification, isLoggedIn]
  );

  // Setup notification listeners
  useEffect(() => {
    // 7.7: When logged out, remove any stale listeners so they never fire
    // against a null-user context (prevent spurious setNotification calls
    // and ensure addStoredNotification's user?.id guard is never relied upon
    // as the sole protection).
    if (!isLoggedIn) {
      notificationListener.current?.remove();
      notificationListener.current = null;
      responseListener.current?.remove();
      responseListener.current = null;
      return;
    }

    // Handle notification received while app is open
    notificationListener.current = Notifications.addNotificationReceivedListener(notif => {
      // Log only essential fields to avoid exposing sensitive user data
      const { title, body } = notif.request.content;
      const notifType = notif.request.content.data?.type;
      notificationLogger.info('📱 Notification received:', { title, body, type: notifType });
      setNotification(notif);
      addStoredNotification(notif);
    });

    // Handle notification tap
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

    // Check for notification that opened the app (cold-start / killed-app).
    // Guarded by hasHandledColdStartRef so that when handleNotificationResponse
    // is recreated on sign-in (isLoggedIn dep change), this block does not
    // re-fire and cause duplicate navigation or AppNavigator pendingLinkRef races.
    if (!hasHandledColdStartRef.current) {
      hasHandledColdStartRef.current = true;
      getLastNotificationResponse()
        .then(response => {
          if (response && navigation) {
            // Log only essential fields to avoid exposing sensitive user data
            const title = response?.notification?.request?.content?.title;
            const type = response?.notification?.request?.content?.data?.type;
            notificationLogger.info('App opened from notification:', { title, type });
            // handleNotificationResponse now records the notification internally;
            // no separate addStoredNotification call is needed here.
            handleNotificationResponse(response);
          }
        })
        .catch((error: unknown) => {
          notificationLogger.error(
            'Error getting last notification response:',
            error instanceof Error ? error.message : String(error)
          );
        });
    }

    // Cleanup
    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigation intentionally excluded: React Navigation's navigation object is stable across renders; adding it would add noise and risk re-subscribing to notification listeners unnecessarily
  }, [handleNotificationResponse, addStoredNotification, isLoggedIn]);

  // Auto-register when user logs in
  useEffect(() => {
    if (isLoggedIn && user && !isRegistered) {
      registerPushNotifications();
    }
  }, [isLoggedIn, user, isRegistered, registerPushNotifications]);

  const value: NotificationContextData = {
    expoPushToken,
    notification,
    isRegistered,
    storedNotifications,
    unreadCount,
    markAllRead,
    clearAll,
    registerPushNotifications,
    unregisterPushNotifications,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};
