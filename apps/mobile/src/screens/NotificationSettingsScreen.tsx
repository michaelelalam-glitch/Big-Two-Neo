import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ScrollView,
  Platform,
  Linking,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { i18n } from '../i18n';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useUserPreferencesStore } from '../store/userPreferencesSlice';
import { showError, showSuccess, showConfirm, showInfo } from '../utils';
import { notificationLogger } from '../utils/logger';

export default function NotificationSettingsScreen() {
  const t = (key: string) => i18n.t(key);
  const { expoPushToken, isRegistered, registerPushNotifications, unregisterPushNotifications } =
    useNotifications();
  const { user } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const {
    notifyGameInvites,
    setNotifyGameInvites,
    notifyYourTurn,
    setNotifyYourTurn,
    notifyGameStarted,
    setNotifyGameStarted,
    notifyFriendRequests,
    setNotifyFriendRequests,
  } = useUserPreferencesStore();

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
        showSuccess(i18n.t('settings.notificationsEnabledSuccess'));
      } else {
        showConfirm({
          title: i18n.t('settings.permissionsRequired'),
          message: i18n.t('settings.permissionsMessage'),
          confirmText: i18n.t('settings.openSettingsButton'),
          onConfirm: () => Linking.openSettings(),
        });
      }
    } else {
      // Unregister
      showConfirm({
        title: i18n.t('settings.disableNotificationsTitle'),
        message: i18n.t('settings.disableNotificationsMessage'),
        confirmText: i18n.t('common.disable'),
        destructive: true,
        onConfirm: async () => {
          await unregisterPushNotifications();
          setNotificationsEnabled(false);
        },
      });
    }
  };

  const testNotification = async () => {
    if (!notificationsEnabled) {
      showError(
        i18n.t('settings.enableNotificationsFirst'),
        i18n.t('settings.notificationsDisabledTitle')
      );
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

      showInfo(
        i18n.t('settings.testNotificationSentMessage'),
        i18n.t('settings.testNotificationSentTitle')
      );
    } catch (error: unknown) {
      // Only log error message/code to avoid exposing notification service internals
      notificationLogger.error(
        'Error sending test notification:',
        error instanceof Error ? error.message : String(error)
      );
      showError(i18n.t('settings.testNotificationFailed'));
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="notification-settings-screen">
      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.pushNotifications')}</Text>
          <Text style={styles.sectionDescription}>{t('settings.stayUpdatedNotifications')}</Text>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>{t('settings.enableNotifications')}</Text>
              <Text style={styles.settingDescription}>
                {t('settings.enableNotificationsDescription')}
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
              <Text style={styles.subsectionTitle}>{t('settings.notificationTypes')}</Text>

              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingTitle}>{t('settings.gameInvites')}</Text>
                  <Text style={styles.settingDescription}>
                    {t('settings.gameInvitesDescription')}
                  </Text>
                </View>
                <Switch
                  value={notifyGameInvites}
                  onValueChange={setNotifyGameInvites}
                  trackColor={{ false: COLORS.secondary, true: COLORS.accent }}
                  thumbColor={notifyGameInvites ? COLORS.white : COLORS.gray.medium}
                />
              </View>

              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingTitle}>{t('settings.yourTurn')}</Text>
                  <Text style={styles.settingDescription}>{t('settings.yourTurnDescription')}</Text>
                </View>
                <Switch
                  value={notifyYourTurn}
                  onValueChange={setNotifyYourTurn}
                  trackColor={{ false: COLORS.secondary, true: COLORS.accent }}
                  thumbColor={notifyYourTurn ? COLORS.white : COLORS.gray.medium}
                />
              </View>

              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingTitle}>{t('settings.gameStarted')}</Text>
                  <Text style={styles.settingDescription}>
                    {t('settings.gameStartedDescription')}
                  </Text>
                </View>
                <Switch
                  value={notifyGameStarted}
                  onValueChange={setNotifyGameStarted}
                  trackColor={{ false: COLORS.secondary, true: COLORS.accent }}
                  thumbColor={notifyGameStarted ? COLORS.white : COLORS.gray.medium}
                />
              </View>

              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingTitle}>{t('settings.friendRequests')}</Text>
                  <Text style={styles.settingDescription}>
                    {t('settings.friendRequestsDescription')}
                  </Text>
                </View>
                <Switch
                  value={notifyFriendRequests}
                  onValueChange={setNotifyFriendRequests}
                  trackColor={{ false: COLORS.secondary, true: COLORS.accent }}
                  thumbColor={notifyFriendRequests ? COLORS.white : COLORS.gray.medium}
                />
              </View>
            </>
          )}
        </View>

        {notificationsEnabled && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.testing')}</Text>
            <TouchableOpacity style={styles.testButton} onPress={testNotification}>
              <Text style={styles.testButtonText}>{t('settings.sendTestNotification')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {expoPushToken && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.debugInfo')}</Text>
            <View style={styles.debugBox}>
              <Text style={styles.debugLabel}>{t('settings.pushToken')}</Text>
              <Text style={styles.debugValue}>{expoPushToken}</Text>
              <Text style={styles.debugLabel}>{t('settings.userIdLabel')}</Text>
              <Text style={styles.debugValue}>{user?.id}</Text>
              <Text style={styles.debugLabel}>{t('settings.platformLabel')}</Text>
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
