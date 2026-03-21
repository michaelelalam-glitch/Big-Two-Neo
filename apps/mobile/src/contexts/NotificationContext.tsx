import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useRef,
  useCallback,
} from 'react';
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
import { useAuth } from './AuthContext';

export interface AppNotification {
  id: string;
  type: 'game_invite' | 'friend_request' | 'game_started' | 'your_turn';
  title: string;
  body: string;
  data: Record<string, unknown>;
  receivedAt: string; // ISO timestamp
  read: boolean;
}

const NOTIFICATIONS_STORAGE_KEY = (userId: string) => `@big2_notifications_${userId}`;
const MAX_STORED_NOTIFICATIONS = 50;

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

  const unreadCount = storedNotifications.filter(n => !n.read).length;

  // Load stored notifications for this user
  useEffect(() => {
    if (!user?.id) {
      setStoredNotifications([]);
      return;
    }
    AsyncStorage.getItem(NOTIFICATIONS_STORAGE_KEY(user.id))
      .then(raw => {
        if (raw) setStoredNotifications(JSON.parse(raw) as AppNotification[]);
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
      const type = (content.data?.type as AppNotification['type']) || 'game_invite';
      const entry: AppNotification = {
        id: notif.request.identifier,
        type,
        title: content.title || '',
        body: content.body || '',
        data: (content.data ?? {}) as Record<string, unknown>,
        receivedAt: new Date().toISOString(),
        read: false,
      };
      setStoredNotifications(prev => {
        const existingIndex = prev.findIndex(n => n.id === entry.id);
        let next: AppNotification[];
        if (existingIndex === -1) {
          next = [entry, ...prev];
        } else {
          const withoutExisting = [...prev];
          withoutExisting.splice(existingIndex, 1);
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
      // Only log notification type and room code, redact user IDs and other sensitive data
      const sanitizedData = {
        type: data.type,
        roomCode: data.roomCode,
        // Omit userId, sender info, etc.
      };
      notificationLogger.info('Handling notification tap:', sanitizedData);

      // Clear badge when user interacts with notification
      clearBadgeCount();

      // Navigate based on notification type
      if (data.type === 'game_invite' && data.roomCode) {
        navigation.navigate('Lobby', { roomCode: data.roomCode as string, joining: true });
      } else if (data.type === 'your_turn' && data.roomCode) {
        navigation.navigate('Game', { roomCode: data.roomCode as string });
      } else if (data.type === 'game_started' && data.roomCode) {
        navigation.navigate('Game', { roomCode: data.roomCode as string });
      } else if (data.type === 'friend_request') {
        navigation.navigate('Profile');
      }
    },
    [navigation]
  );

  // Setup notification listeners
  useEffect(() => {
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

    // Check for notification that opened the app
    getLastNotificationResponse()
      .then(response => {
        if (response && navigation) {
          // Log only essential fields to avoid exposing sensitive user data
          const title = response?.notification?.request?.content?.title;
          const type = response?.notification?.request?.content?.data?.type;
          notificationLogger.info('App opened from notification:', { title, type });
          // Ensure cold-start notification is recorded in history before navigating
          addStoredNotification(response.notification);
          handleNotificationResponse(response);
        }
      })
      .catch((error: unknown) => {
        notificationLogger.error(
          'Error getting last notification response:',
          error instanceof Error ? error.message : String(error)
        );
      });

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
  }, [handleNotificationResponse, addStoredNotification]);

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
