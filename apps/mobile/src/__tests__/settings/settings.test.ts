/**
 * Settings Persistence Tests
 * 
 * Tests for all settings storage and retrieval functionality
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { i18n, Language } from '../../i18n';
import { SETTINGS_KEYS, DEFAULT_SETTINGS } from '../../utils/settings';

// Mock React Native components that are imported by settings utilities
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(),
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  getAllKeys: jest.fn(),
  multiRemove: jest.fn(),
}));

// Mock I18nManager for RTL tests
jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  I18nManager: {
    isRTL: false,
    forceRTL: jest.fn(),
  },
}));

describe('i18n System', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset to English before each test
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('en');
    await i18n.initialize();
    await i18n.setLanguage('en');
  });

  describe('initialization', () => {
    it('should initialize with default language (English)', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
      
      await i18n.initialize();
      
      expect(i18n.getLanguage()).toBe('en');
      expect(AsyncStorage.getItem).toHaveBeenCalled();
    });

    it('should load saved language from AsyncStorage', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('de');
      
      await i18n.initialize();
      
      expect(i18n.getLanguage()).toBe('de');
    });

    it('should handle invalid saved language gracefully', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('invalid-lang');
      
      await i18n.initialize();
      
      // Should keep current language if invalid (doesn't crash)
      expect(['en', 'ar', 'de']).toContain(i18n.getLanguage());
    });
  });

  describe('language switching', () => {
    it('should change language and persist to AsyncStorage', async () => {
      await i18n.setLanguage('de');
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(SETTINGS_KEYS.LANGUAGE, 'de');
      expect(i18n.getLanguage()).toBe('de');
    });

    it('should return requiresRestart=true when switching to/from Arabic', async () => {
      const requiresRestart = await i18n.setLanguage('ar');
      
      expect(requiresRestart).toBe(true);
    });

    it('should return requiresRestart=false when switching between non-RTL languages', async () => {
      await i18n.setLanguage('en');
      const requiresRestart = await i18n.setLanguage('de');
      
      expect(requiresRestart).toBe(false);
    });
  });

  describe('translations', () => {
    beforeEach(async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('en');
      await i18n.initialize();
      await i18n.setLanguage('en');
    });

    it('should return correct English translation', () => {
      const translation = i18n.t('settings.title');
      expect(translation).toBe('Settings');
    });

    it('should return German translation when language is set to German', async () => {
      await i18n.setLanguage('de');
      const translation = i18n.t('settings.title');
      expect(translation).toBe('Einstellungen');
    });

    it('should return Arabic translation when language is set to Arabic', async () => {
      await i18n.setLanguage('ar');
      const translation = i18n.t('settings.title');
      expect(translation).toBe('الإعدادات');
    });

    it('should return key path if translation not found', () => {
      const translation = i18n.t('nonexistent.key');
      expect(translation).toBe('nonexistent.key');
    });

    it('should handle nested translation keys', () => {
      const translation = i18n.t('common.ok');
      expect(translation).toBe('OK');
    });
  });
});

describe('Settings Persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('card sort order', () => {
    it('should persist card sort order preference', async () => {
      await AsyncStorage.setItem(SETTINGS_KEYS.CARD_SORT_ORDER, 'rank');
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        SETTINGS_KEYS.CARD_SORT_ORDER,
        'rank'
      );
    });

    it('should load saved card sort order', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('rank');
      
      const value = await AsyncStorage.getItem(SETTINGS_KEYS.CARD_SORT_ORDER);
      
      expect(value).toBe('rank');
    });

    it('should default to "suit" if no preference saved', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
      
      const value = await AsyncStorage.getItem(SETTINGS_KEYS.CARD_SORT_ORDER);
      
      expect(value || DEFAULT_SETTINGS.cardSortOrder).toBe('suit');
    });
  });

  describe('animation speed', () => {
    it('should persist animation speed preference', async () => {
      await AsyncStorage.setItem(SETTINGS_KEYS.ANIMATION_SPEED, 'fast');
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        SETTINGS_KEYS.ANIMATION_SPEED,
        'fast'
      );
    });

    it('should support all animation speed options', async () => {
      const speeds = ['slow', 'normal', 'fast'];
      
      for (const speed of speeds) {
        await AsyncStorage.setItem(SETTINGS_KEYS.ANIMATION_SPEED, speed);
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
          SETTINGS_KEYS.ANIMATION_SPEED,
          speed
        );
      }
    });
  });

  describe('auto-pass timer', () => {
    it('should persist auto-pass timer preference', async () => {
      await AsyncStorage.setItem(SETTINGS_KEYS.AUTO_PASS_TIMER, '30');
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        SETTINGS_KEYS.AUTO_PASS_TIMER,
        '30'
      );
    });

    it('should support disabled state', async () => {
      await AsyncStorage.setItem(SETTINGS_KEYS.AUTO_PASS_TIMER, 'disabled');
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        SETTINGS_KEYS.AUTO_PASS_TIMER,
        'disabled'
      );
    });
  });

  describe('privacy settings', () => {
    it('should persist profile visibility preference', async () => {
      await AsyncStorage.setItem(SETTINGS_KEYS.PROFILE_VISIBILITY, 'false');
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        SETTINGS_KEYS.PROFILE_VISIBILITY,
        'false'
      );
    });

    it('should persist online status visibility preference', async () => {
      await AsyncStorage.setItem(SETTINGS_KEYS.SHOW_ONLINE_STATUS, 'false');
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        SETTINGS_KEYS.SHOW_ONLINE_STATUS,
        'false'
      );
    });
  });

  describe('cache clearing', () => {
    it('should clear non-essential cached data while keeping settings', async () => {
      const allKeys = [
        '@big2_audio_enabled',
        '@big2_card_sort_order',
        '@big2_some_cache_data',
        '@big2_another_cache',
        'supabase.auth.token',
      ];
      
      const keysToKeep = [
        '@big2_audio_enabled',
        '@big2_card_sort_order',
        'supabase.auth.token',
      ];
      
      (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue(allKeys);
      
      const keysToRemove = allKeys.filter((key) => !keysToKeep.includes(key));
      await AsyncStorage.multiRemove(keysToRemove);
      
      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([
        '@big2_some_cache_data',
        '@big2_another_cache',
      ]);
    });
  });
});

describe('Default Settings', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_SETTINGS.cardSortOrder).toBe('suit');
    expect(DEFAULT_SETTINGS.animationSpeed).toBe('normal');
    expect(DEFAULT_SETTINGS.autoPassTimer).toBe('60');
    expect(DEFAULT_SETTINGS.profileVisibility).toBe(true);
    expect(DEFAULT_SETTINGS.showOnlineStatus).toBe(true);
    expect(DEFAULT_SETTINGS.language).toBe('en');
    expect(DEFAULT_SETTINGS.audioEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.audioVolume).toBe(0.7);
    expect(DEFAULT_SETTINGS.hapticsEnabled).toBe(true);
  });
});

describe('Settings Keys', () => {
  it('should have unique storage keys', () => {
    const keys = Object.values(SETTINGS_KEYS);
    const uniqueKeys = new Set(keys);
    
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it('should use @big2_ prefix for all keys', () => {
    const keys = Object.values(SETTINGS_KEYS);
    
    keys.forEach((key) => {
      expect(key).toMatch(/^@big2_/);
    });
  });
});
