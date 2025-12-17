import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { soundManager, hapticManager, HapticType } from '../utils';
import { showConfirm, showSuccess, showError } from '../utils';
import { supabase } from '../services/supabase';
import { i18n, LANGUAGES, Language } from '../i18n';

type SettingsScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;

// Storage keys for settings
const CARD_SORT_ORDER_KEY = '@big2_card_sort_order';
const ANIMATION_SPEED_KEY = '@big2_animation_speed';
const AUTO_PASS_TIMER_KEY = '@big2_auto_pass_timer';
const PROFILE_VISIBILITY_KEY = '@big2_profile_visibility';
const SHOW_ONLINE_STATUS_KEY = '@big2_show_online_status';

export type CardSortOrder = 'suit' | 'rank';
export type AnimationSpeed = 'slow' | 'normal' | 'fast';
export type AutoPassTimer = 'disabled' | '30' | '60' | '90';

export default function SettingsScreen() {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { user, signOut } = useAuth();
  
  // Get current translations
  const t = (key: string) => i18n.t(key);
  
  // State for all settings
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [cardSortOrder, setCardSortOrder] = useState<CardSortOrder>('suit');
  const [animationSpeed, setAnimationSpeed] = useState<AnimationSpeed>('normal');
  const [autoPassTimer, setAutoPassTimer] = useState<AutoPassTimer>('60');
  const [profileVisibility, setProfileVisibility] = useState(true);
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);
  const [currentLanguage, setCurrentLanguage] = useState<Language>('en');

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      // Load audio/haptic settings
      const savedSoundEnabled = await soundManager.isAudioEnabled();
      const savedVibrationEnabled = await hapticManager.isHapticsEnabled();
      setSoundEnabled(savedSoundEnabled);
      setVibrationEnabled(savedVibrationEnabled);

      // Load game settings
      const savedCardSort = await AsyncStorage.getItem(CARD_SORT_ORDER_KEY);
      const savedAnimSpeed = await AsyncStorage.getItem(ANIMATION_SPEED_KEY);
      const savedAutoPass = await AsyncStorage.getItem(AUTO_PASS_TIMER_KEY);
      
      if (savedCardSort) setCardSortOrder(savedCardSort as CardSortOrder);
      if (savedAnimSpeed) setAnimationSpeed(savedAnimSpeed as AnimationSpeed);
      if (savedAutoPass) setAutoPassTimer(savedAutoPass as AutoPassTimer);

      // Load privacy settings
      const savedVisibility = await AsyncStorage.getItem(PROFILE_VISIBILITY_KEY);
      const savedOnlineStatus = await AsyncStorage.getItem(SHOW_ONLINE_STATUS_KEY);
      
      if (savedVisibility !== null) setProfileVisibility(savedVisibility === 'true');
      if (savedOnlineStatus !== null) setShowOnlineStatus(savedOnlineStatus === 'true');

      // Load language
      setCurrentLanguage(i18n.getLanguage());
    } catch (error) {
      console.error('[Settings] Failed to load settings:', error);
    }
  };

  // Audio & Haptics handlers
  const handleToggleSound = async () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    await soundManager.setAudioEnabled(newValue);
    if (vibrationEnabled) {
      hapticManager.trigger(HapticType.SELECTION);
    }
  };

  const handleToggleVibration = async () => {
    const newValue = !vibrationEnabled;
    setVibrationEnabled(newValue);
    await hapticManager.setHapticsEnabled(newValue);
    if (newValue) {
      hapticManager.trigger(HapticType.SELECTION);
    }
  };

  // Game settings handlers
  const handleCardSortChange = async (order: CardSortOrder) => {
    setCardSortOrder(order);
    await AsyncStorage.setItem(CARD_SORT_ORDER_KEY, order);
    if (vibrationEnabled) {
      hapticManager.trigger(HapticType.SELECTION);
    }
  };

  const handleAnimationSpeedChange = async (speed: AnimationSpeed) => {
    setAnimationSpeed(speed);
    await AsyncStorage.setItem(ANIMATION_SPEED_KEY, speed);
    if (vibrationEnabled) {
      hapticManager.trigger(HapticType.SELECTION);
    }
  };

  const handleAutoPassTimerChange = async (timer: AutoPassTimer) => {
    setAutoPassTimer(timer);
    await AsyncStorage.setItem(AUTO_PASS_TIMER_KEY, timer);
    if (vibrationEnabled) {
      hapticManager.trigger(HapticType.SELECTION);
    }
  };

  // Privacy handlers
  const handleToggleProfileVisibility = async () => {
    const newValue = !profileVisibility;
    setProfileVisibility(newValue);
    await AsyncStorage.setItem(PROFILE_VISIBILITY_KEY, newValue.toString());
    if (vibrationEnabled) {
      hapticManager.trigger(HapticType.SELECTION);
    }
  };

  const handleToggleOnlineStatus = async () => {
    const newValue = !showOnlineStatus;
    setShowOnlineStatus(newValue);
    await AsyncStorage.setItem(SHOW_ONLINE_STATUS_KEY, newValue.toString());
    if (vibrationEnabled) {
      hapticManager.trigger(HapticType.SELECTION);
    }
  };

  // Language handler
  const handleLanguageChange = async (language: Language) => {
    showConfirm({
      title: t('settings.changeLanguageWarning'),
      message: t('settings.restartRequired'),
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        const requiresRestart = await i18n.setLanguage(language);
        setCurrentLanguage(language);
        
        if (requiresRestart) {
          // For Arabic (RTL), app must restart
          Alert.alert(
            t('settings.restartRequired'),
            t('settings.changeLanguageWarning'),
            [
              {
                text: t('common.ok'),
                onPress: () => {
                  // App will use new language on next launch
                  // User should manually restart the app
                },
              },
            ]
          );
        }
        
        showSuccess('Language changed successfully');
      },
    });
  };

  // Account management handlers
  const handleClearCache = async () => {
    showConfirm({
      title: t('settings.clearCache'),
      message: t('settings.clearCacheConfirm'),
      confirmText: t('common.delete'),
      destructive: true,
      onConfirm: async () => {
        try {
          // Clear all non-essential cached data
          // Keep auth tokens, user preferences, and game settings
          const keysToKeep = [
            '@big2_audio_enabled',
            '@big2_audio_volume',
            '@big2_haptics_enabled',
            '@big2_card_sort_order',
            '@big2_animation_speed',
            '@big2_auto_pass_timer',
            '@big2_profile_visibility',
            '@big2_show_online_status',
            '@big2_language',
            'supabase.auth.token', // Keep auth tokens
          ];

          const allKeys = await AsyncStorage.getAllKeys();
          const keysToRemove = allKeys.filter((key) => !keysToKeep.includes(key));
          
          await AsyncStorage.multiRemove(keysToRemove);
          
          showSuccess(t('settings.clearCacheSuccess'));
          
          if (vibrationEnabled) {
            hapticManager.trigger(HapticType.SUCCESS);
          }
        } catch (error) {
          console.error('[Settings] Failed to clear cache:', error);
          showError('Failed to clear cache');
        }
      },
    });
  };

  const handleDeleteAccount = async () => {
    showConfirm({
      title: t('settings.deleteAccount'),
      message: t('settings.deleteAccountWarning') + '\n\n' + t('settings.deleteAccountConfirm'),
      confirmText: t('common.delete'),
      destructive: true,
      onConfirm: async () => {
        try {
          if (!user) {
            showError('No user logged in');
            return;
          }

          // Call Supabase to delete user data
          // This should trigger database cascades to remove all user-related data
          const { error } = await supabase.rpc('delete_user_account', {
            user_id: user.id,
          });

          if (error) {
            console.error('[Settings] Failed to delete account:', error);
            showError('Failed to delete account. Please contact support.');
            return;
          }

          // Sign out and clear all data
          await AsyncStorage.clear();
          await signOut();
          
          showSuccess('Account deleted successfully');
        } catch (error) {
          console.error('[Settings] Error deleting account:', error);
          showError('Failed to delete account. Please contact support.');
        }
      },
    });
  };

  // External links
  const handleOpenLink = (url: string) => {
    Linking.openURL(url).catch((error) => {
      console.error('[Settings] Failed to open link:', error);
      showError('Failed to open link');
    });
  };

  const appVersion = Application.nativeApplicationVersion || '1.0.0';
  const buildNumber = Application.nativeBuildVersion || '1';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>← {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        {/* Profile Settings */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('settings.profileSettings')}</Text>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonBadgeText}>Coming Soon</Text>
            </View>
          </View>
          
          <View style={styles.comingSoonBanner}>
            <Text style={styles.comingSoonText}>🔮 Profile visibility and online status will be available with online multiplayer!</Text>
          </View>
          
          <View style={[styles.settingRow, { opacity: 0.6 }]}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>{t('settings.profileVisibility')}</Text>
              <Text style={styles.settingDescription}>{t('settings.privacyDescription')}</Text>
            </View>
            <Switch
              value={profileVisibility}
              onValueChange={handleToggleProfileVisibility}
              disabled={true}
              trackColor={{ false: COLORS.gray.dark, true: COLORS.gray.medium }}
              thumbColor={COLORS.gray.medium}
            />
          </View>

          <View style={styles.divider} />

          <View style={[styles.settingRow, { opacity: 0.6 }]}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>{t('settings.showOnlineStatus')}</Text>
            </View>
            <Switch
              value={showOnlineStatus}
              onValueChange={handleToggleOnlineStatus}
              disabled={true}
              trackColor={{ false: COLORS.gray.dark, true: COLORS.gray.medium }}
              thumbColor={COLORS.gray.medium}
            />
          </View>
        </View>

        {/* Game Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.gameSettings')}</Text>
          
          <View style={styles.settingGroup}>
            <Text style={styles.settingTitle}>{t('settings.cardSortOrder')}</Text>
            <Text style={styles.settingDescription}>{t('settings.cardSortOrderDescription')}</Text>
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  cardSortOrder === 'suit' && styles.optionButtonActive,
                ]}
                onPress={() => handleCardSortChange('suit')}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    cardSortOrder === 'suit' && styles.optionButtonTextActive,
                  ]}
                >
                  {t('settings.sortBySuit')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  cardSortOrder === 'rank' && styles.optionButtonActive,
                ]}
                onPress={() => handleCardSortChange('rank')}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    cardSortOrder === 'rank' && styles.optionButtonTextActive,
                  ]}
                >
                  {t('settings.sortByRank')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.settingGroup}>
            <Text style={styles.settingTitle}>{t('settings.animationSpeed')}</Text>
            <Text style={styles.settingDescription}>{t('settings.animationSpeedDescription')}</Text>
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  animationSpeed === 'slow' && styles.optionButtonActive,
                ]}
                onPress={() => handleAnimationSpeedChange('slow')}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    animationSpeed === 'slow' && styles.optionButtonTextActive,
                  ]}
                >
                  {t('settings.slow')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  animationSpeed === 'normal' && styles.optionButtonActive,
                ]}
                onPress={() => handleAnimationSpeedChange('normal')}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    animationSpeed === 'normal' && styles.optionButtonTextActive,
                  ]}
                >
                  {t('settings.normal')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  animationSpeed === 'fast' && styles.optionButtonActive,
                ]}
                onPress={() => handleAnimationSpeedChange('fast')}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    animationSpeed === 'fast' && styles.optionButtonTextActive,
                  ]}
                >
                  {t('settings.fast')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.settingGroup}>
            <Text style={styles.settingTitle}>{t('settings.autoPassTimer')}</Text>
            <Text style={styles.settingDescription}>{t('settings.autoPassTimerDescription')}</Text>
            <View style={styles.comingSoonBanner}>
              <Text style={styles.comingSoonText}>ℹ️ Note: Game currently uses a fixed 10-second timer. Custom durations coming soon!</Text>
            </View>
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  autoPassTimer === 'disabled' && styles.optionButtonActive,
                ]}
                onPress={() => handleAutoPassTimerChange('disabled')}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    autoPassTimer === 'disabled' && styles.optionButtonTextActive,
                  ]}
                >
                  {t('settings.disabled')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  autoPassTimer === '30' && styles.optionButtonActive,
                ]}
                onPress={() => handleAutoPassTimerChange('30')}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    autoPassTimer === '30' && styles.optionButtonTextActive,
                  ]}
                >
                  30s
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  autoPassTimer === '60' && styles.optionButtonActive,
                ]}
                onPress={() => handleAutoPassTimerChange('60')}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    autoPassTimer === '60' && styles.optionButtonTextActive,
                  ]}
                >
                  60s
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  autoPassTimer === '90' && styles.optionButtonActive,
                ]}
                onPress={() => handleAutoPassTimerChange('90')}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    autoPassTimer === '90' && styles.optionButtonTextActive,
                  ]}
                >
                  90s
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.notificationSettings')}</Text>
          
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('NotificationSettings')}
          >
            <Text style={styles.linkText}>{t('settings.pushNotifications')}</Text>
            <Text style={styles.arrowText}>→</Text>
          </TouchableOpacity>
        </View>

        {/* Audio & Haptics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.audioHaptics')}</Text>
          
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>{t('settings.soundEffects')}</Text>
              <Text style={styles.settingDescription}>{t('settings.soundEffectsDescription')}</Text>
            </View>
            <Switch
              value={soundEnabled}
              onValueChange={handleToggleSound}
              trackColor={{ false: COLORS.secondary, true: COLORS.accent }}
              thumbColor={soundEnabled ? COLORS.white : COLORS.gray.medium}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>{t('settings.vibration')}</Text>
              <Text style={styles.settingDescription}>{t('settings.vibrationDescription')}</Text>
            </View>
            <Switch
              value={vibrationEnabled}
              onValueChange={handleToggleVibration}
              trackColor={{ false: COLORS.secondary, true: COLORS.accent }}
              thumbColor={vibrationEnabled ? COLORS.white : COLORS.gray.medium}
            />
          </View>
        </View>

        {/* Language */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
          <Text style={styles.settingDescription}>{t('settings.languageDescription')}</Text>
          
          {Object.entries(LANGUAGES).map(([code, lang]) => (
            <TouchableOpacity
              key={code}
              style={[
                styles.languageRow,
                currentLanguage === code && styles.languageRowActive,
              ]}
              onPress={() => handleLanguageChange(code as Language)}
            >
              <View>
                <Text style={styles.languageText}>{lang.nativeName}</Text>
                <Text style={styles.languageSubtext}>{lang.name}</Text>
              </View>
              {currentLanguage === code && (
                <Text style={styles.checkmark}>✓</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Account */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.accountManagement')}</Text>
          
          <TouchableOpacity style={styles.linkRow} onPress={handleClearCache}>
            <View>
              <Text style={styles.linkText}>{t('settings.clearCache')}</Text>
              <Text style={styles.settingDescription}>{t('settings.clearCacheDescription')}</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.linkRow} onPress={handleDeleteAccount}>
            <View>
              <Text style={[styles.linkText, styles.dangerText]}>{t('settings.deleteAccount')}</Text>
              <Text style={styles.settingDescription}>{t('settings.deleteAccountDescription')}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.about')}</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingTitle}>{t('settings.version')}</Text>
            <Text style={styles.versionText}>
              {appVersion} ({buildNumber})
            </Text>
          </View>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => handleOpenLink('https://example.com/terms')}
          >
            <Text style={styles.linkText}>{t('settings.termsOfService')}</Text>
            <Text style={styles.arrowText}>→</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => handleOpenLink('https://example.com/privacy')}
          >
            <Text style={styles.linkText}>{t('settings.privacyPolicy')}</Text>
            <Text style={styles.arrowText}>→</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom spacing */}
        <View style={styles.bottomSpacer} />
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.secondary,
  },
  backButton: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  backButtonText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.accent,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.white,
  },
  headerSpacer: {
    width: 60, // Balance the back button width
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingVertical: SPACING.md,
  },
  section: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.secondary,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: SPACING.md,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
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
  settingGroup: {
    paddingVertical: SPACING.sm,
  },
  buttonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  optionButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.gray.medium,
    backgroundColor: COLORS.secondary,
  },
  optionButtonActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  optionButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.light,
    fontWeight: '600',
  },
  optionButtonTextActive: {
    color: COLORS.white,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  linkText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
  },
  arrowText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.gray.medium,
  },
  dangerText: {
    color: COLORS.danger,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.secondary,
    marginVertical: SPACING.md,
  },
  languageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: 8,
    marginVertical: SPACING.xs,
    backgroundColor: COLORS.secondary,
  },
  languageRowActive: {
    backgroundColor: COLORS.accent,
  },
  languageText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
  },
  languageSubtext: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.light,
    marginTop: SPACING.xs,
  },
  checkmark: {
    fontSize: FONT_SIZES.xl,
    color: COLORS.white,
    fontWeight: '700',
  },
  versionText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
  },
  bottomSpacer: {
    height: SPACING.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  comingSoonBadge: {
    backgroundColor: '#FCD34D',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs / 2,
    borderRadius: 4,
  },
  comingSoonBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    color: COLORS.primary,
    textTransform: 'uppercase',
  },
  comingSoonBanner: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderRadius: 8,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  comingSoonText: {
    fontSize: FONT_SIZES.sm,
    color: '#93C5FD',
    lineHeight: FONT_SIZES.sm * 1.5,
  },
});
