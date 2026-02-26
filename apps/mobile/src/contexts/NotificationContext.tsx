import React, { createContext, useContext, useEffect, useState, ReactNode, useRef, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Notifications from 'expo-notifications';
import { useAuth } from './AuthContext';
import { RootStackParamList } from '../navigation/AppNavigator';
import {
  registerForPushNotificationsAsync,
  savePushTokenToDatabase,
  removePushTokenFromDatabase,
  getLastNotificationResponse,
  clearBadgeCount,
} from '../services/notificationService';
import { notificationLogger } from '../utils/logger';

interface NotificationContextData {
  expoPushToken: string | null;
  notification: Notifications.Notification | null;
  isRegistered: boolean;
  registerPushNotifications: () => Promise<void>;
  unregisterPushNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextData>({
  expoPushToken: null,
  notification: null,
  isRegistered: false,
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
  const { user, isLoggedIn } = useAuth();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

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
    } catch (error: any) {
      notificationLogger.error('Error registering push notifications:', error?.message || error?.code || String(error));
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
    } catch (error: any) {
      // Only log error message/code to avoid exposing internal error details
      notificationLogger.error('Error unregistering push notifications:', error?.message || error?.code || String(error));
    }
  }, [user]);

  // Handle deep linking from notifications
  const handleNotificationResponse = useCallback((response: Notifications.NotificationResponse) => {
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
      navigation.navigate('Lobby', { roomCode: data.roomCode as string });
    } else if (data.type === 'your_turn' && data.roomCode) {
      navigation.navigate('Game', { roomCode: data.roomCode as string });
    } else if (data.type === 'game_started' && data.roomCode) {
      navigation.navigate('Game', { roomCode: data.roomCode as string });
    } else if (data.type === 'friend_request') {
      navigation.navigate('Profile');
    }
  }, [navigation]);

  // Setup notification listeners
  useEffect(() => {
    // Handle notification received while app is open
    notificationListener.current = Notifications.addNotificationReceivedListener((notif) => {
      // Log only essential fields to avoid exposing sensitive user data
      const { title, body } = notif.request.content;
      const notifType = notif.request.content.data?.type;
      notificationLogger.info('📱 Notification received:', { title, body, type: notifType });
      setNotification(notif);
    });

    // Handle notification tap
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

    // Check for notification that opened the app
    getLastNotificationResponse().then((response) => {
      if (response && navigation) {
        // Log only essential fields to avoid exposing sensitive user data
        const title = response?.notification?.request?.content?.title;
        const type = response?.notification?.request?.content?.data?.type;
        notificationLogger.info('App opened from notification:', { title, type });
        handleNotificationResponse(response);
      }
    }).catch((error: any) => {
      notificationLogger.error('Error getting last notification response:', error?.message || error?.code || String(error));
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
  }, [handleNotificationResponse]);

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
    registerPushNotifications,
    unregisterPushNotifications,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};
