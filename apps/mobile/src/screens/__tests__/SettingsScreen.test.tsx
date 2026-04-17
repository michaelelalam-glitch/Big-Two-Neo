/**
 * SettingsScreen Smoke Tests — H16 Audit Fix
 *
 * Verifies SettingsScreen renders without crashing with all
 * heavy dependencies mocked away (Zustand, AsyncStorage, Supabase,
 * analytics, sentry). Asserts section headers are visible.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// ── Mock heavy dependencies ──────────────────────────────────────────────────

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('@react-navigation/stack', () => ({}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user', email: 'test@example.com' },
    signOut: jest.fn(),
  }),
}));

jest.mock('../../i18n', () => ({
  i18n: {
    t: (key: string) => key,
    getLanguage: () => 'en',
    setLanguage: jest.fn(),
  },
  LANGUAGES: [{ code: 'en', label: 'English' }],
}));

jest.mock('../../services/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

jest.mock('../../utils', () => ({
  showConfirm: jest.fn(),
  showSuccess: jest.fn(),
  showError: jest.fn(),
  hapticManager: { trigger: jest.fn() },
  HapticType: { SELECTION: 'selection', SUCCESS: 'success' },
}));

jest.mock('../../store', () => ({
  useUserPreferencesStore: () => ({
    soundEnabled: true,
    vibrationEnabled: true,
    profileVisibility: true,
    showOnlineStatus: true,
    setSoundEnabled: jest.fn(),
    setVibrationEnabled: jest.fn(),
    setProfileVisibility: jest.fn(),
    setShowOnlineStatus: jest.fn(),
    profilePhotoSize: 'medium',
    setProfilePhotoSize: jest.fn(),
    hydrate: jest.fn(),
  }),
}));

jest.mock('../../utils/settings', () => ({
  SETTINGS_KEYS: {
    AUDIO_ENABLED: 'audio-enabled',
    AUDIO_VOLUME: 'audio-volume',
    HAPTICS_ENABLED: 'haptics-enabled',
    CARD_SORT_ORDER: 'card-sort-order',
    ANIMATION_SPEED: 'animation-speed',
    AUTO_PASS_TIMER: 'auto-pass-timer',
    PROFILE_VISIBILITY: 'profile-visibility',
    SHOW_ONLINE_STATUS: 'show-online-status',
    LANGUAGE: 'language',
    AUDIO_SETTINGS_PERSIST: 'stephanos-audio-settings',
    AUDIO_SETTINGS_MIGRATION_COMPLETE: 'audio-migration-complete',
    ANALYTICS_CONSENT: 'analytics-consent',
  },
}));

jest.mock('../../utils/migrateLegacyUserPreferences', () => ({
  migrateLegacyUserPreferences: jest.fn(),
}));

jest.mock('../../services/analytics', () => ({
  setAnalyticsConsent: jest.fn(),
  trackEvent: jest.fn(),
}));

jest.mock('../../services/sentry', () => ({
  initSentry: jest.fn(),
  disableSentry: jest.fn(),
}));

jest.mock('../../components/BugReportModal', () => {
  return { __esModule: true, default: () => null };
});

// ── Tests ────────────────────────────────────────────────────────────────────

import SettingsScreen from '../SettingsScreen';

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', async () => {
    const { root } = render(<SettingsScreen />);
    await waitFor(() => expect(root).toBeTruthy());
  });

  it('shows settings title', async () => {
    const { getAllByText } = render(<SettingsScreen />);
    await waitFor(() => {
      // i18n.t returns the key, so the title renders 'settings.title'
      expect(getAllByText('settings.title').length).toBeGreaterThan(0);
    });
  });

  it('shows back button', async () => {
    const { getByText } = render(<SettingsScreen />);
    await waitFor(() => {
      // Back button text: "← {t('common.back')}"
      expect(getByText(/common\.back/)).toBeTruthy();
    });
  });

  it('shows profile settings section', async () => {
    const { getByText } = render(<SettingsScreen />);
    await waitFor(() => {
      expect(getByText('settings.profileSettings')).toBeTruthy();
    });
  });
});
