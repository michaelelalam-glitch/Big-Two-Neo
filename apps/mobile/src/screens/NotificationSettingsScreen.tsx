import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useNotifications } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';
import { notificationLogger } from '../utils/logger';

export default function NotificationSettingsScreen() {
  const { expoPushToken, isRegistered, registerPushNotifications, unregisterPushNotifications } =
    useNotifications();
  const { user } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  // Note: Individual notification type toggles removed until backend preference storage is implemented
  // Current implementation: Master toggle only (enable/disable all notifications)
  // TODO: Add granular notification preferences in future iteration (Task #TBD) with database persistence

  const checkNotificationStatus = useCallback(async () => {
    const { status } = await Notifications.getPermissionsAsync();
    setNotificationsEnabled(status === 'granted' && isRegistered);
  }, [isRegistered]);

  useEffect(() => {
    checkNotificationStatus();
  }, [checkNotificationStatus]);

  const handleToggleNotifications = async (value: boolean) => {
    if (value) {
      // Request permissions and register
      const { status } = await Notifications.requestPermissionsAsync();
      
      if (status === 'granted') {
        await registerPushNotifications();
        setNotificationsEnabled(true);
        Alert.alert('Success', 'Push notifications have been enabled!');
      } else {
        Alert.alert(
          'Permissions Required',
          'Please enable notifications in your device settings to receive game updates.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
            },
            {
              text: 'Open Settings',
              onPress: () => {
                Linking.openSettings();
              },
            },
          ]
        );
      }
    } else {
      // Unregister
      Alert.alert(
        'Disable Notifications',
        'Are you sure you want to disable push notifications? You will not receive game invites or turn notifications.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: async () => {
              await unregisterPushNotifications();
              setNotificationsEnabled(false);
            },
          },
        ]
      );
    }
  };

  const testNotification = async () => {
    if (!notificationsEnabled) {
      Alert.alert('Notifications Disabled', 'Please enable notifications first.');
      return;
    }

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🃏 Big2 Mobile',
          body: 'This is a test notification. Notifications are working!',
          data: { type: 'test' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 2,
        },
      });

      Alert.alert('Test Notification Sent', 'You should receive a notification in 2 seconds!');
    } catch (error: any) {
      // Only log error message/code to avoid exposing notification service internals
      notificationLogger.error('Error sending test notification:', error?.message || error?.code || String(error));
      Alert.alert('Error', 'Failed to send test notification.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Push Notifications</Text>
          <Text style={styles.sectionDescription}>
            Stay updated with game invites, turn notifications, and more.
          </Text>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>Enable Notifications</Text>
              <Text style={styles.settingDescription}>
                Receive push notifications for game events
              </Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleToggleNotifications}
              trackColor={{ false: COLORS.secondary, true: COLORS.accent }}
              thumbColor={notificationsEnabled ? COLORS.white : COLORS.gray.medium}
            />
          </View>

          {notificationsEnabled && (
            <>
              <View style={styles.divider} />
              <Text style={styles.subsectionTitle}>About Notifications</Text>
              <Text style={styles.infoText}>
                You'll receive notifications for game invites, your turn, game start, and friend requests.
                {'\n\n'}
                Granular notification preferences (choose which types to receive) will be available in a future update.
              </Text>
            </>
          )}
        </View>

        {notificationsEnabled && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Testing</Text>
            <TouchableOpacity style={styles.testButton} onPress={testNotification}>
              <Text style={styles.testButtonText}>Send Test Notification</Text>
            </TouchableOpacity>
          </View>
        )}

        {expoPushToken && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Debug Info</Text>
            <View style={styles.debugBox}>
              <Text style={styles.debugLabel}>Push Token:</Text>
              <Text style={styles.debugValue}>{expoPushToken}</Text>
              <Text style={styles.debugLabel}>User ID:</Text>
              <Text style={styles.debugValue}>{user?.id}</Text>
              <Text style={styles.debugLabel}>Platform:</Text>
              <Text style={styles.debugValue}>{Platform.OS}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  content: {
    flex: 1,
  },
  section: {
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.secondary,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: SPACING.sm,
  },
  sectionDescription: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    marginBottom: SPACING.lg,
  },
  subsectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.white,
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  settingInfo: {
    flex: 1,
    marginRight: SPACING.md,
  },
  settingTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: SPACING.xs,
  },
  settingDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.secondary,
    marginVertical: SPACING.md,
  },
  testButton: {
    backgroundColor: COLORS.accent,
    padding: SPACING.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  testButtonText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
  },
  debugBox: {
    backgroundColor: COLORS.secondary,
    padding: SPACING.md,
    borderRadius: 8,
  },
  debugLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.gray.medium,
    marginTop: SPACING.sm,
  },
  debugValue: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.white,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: SPACING.xs,
  },
  infoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.light,
    lineHeight: FONT_SIZES.sm * 1.5,
    marginTop: SPACING.sm,
  },
});
