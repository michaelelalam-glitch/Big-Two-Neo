/**
 * HomeScreen Smoke Tests — H16 Audit Fix
 *
 * Verifies HomeScreen renders without crashing with all heavy
 * dependencies mocked away. Asserts key UI elements are present.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ── Mock heavy dependencies ──────────────────────────────────────────────────

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, setParams: mockSetParams }),
  useRoute: () => ({ params: {} }),
}));

jest.mock('@react-navigation/stack', () => ({}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user', email: 'test@example.com' },
    profile: { username: 'TestPlayer' },
  }),
}));

jest.mock('../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}));

jest.mock('../../hooks/useActiveGameBanner', () => ({
  useActiveGameBanner: () => ({
    currentRoom: null,
    setCurrentRoom: jest.fn(),
    currentRoomStatus: null,
    disconnectTimestamp: null,
    canRejoinAfterExpiry: false,
    bannerRefreshKey: 0,
    checkGameExclusivity: jest.fn(),
    handleBannerResume: jest.fn(),
    handleBannerLeave: jest.fn(),
    handleReplaceBotAndRejoin: jest.fn(),
    handleTimerExpired: jest.fn(),
  }),
}));

jest.mock('../../hooks/useMatchmakingFlow', () => ({
  useMatchmakingFlow: () => ({
    isQuickPlaying: false,
    isRankedSearching: false,
    setIsRankedSearching: jest.fn(),
    showFindGameModal: false,
    setShowFindGameModal: jest.fn(),
    showDifficultyModal: false,
    setShowDifficultyModal: jest.fn(),
    handleCasualMatch: jest.fn(),
    handleRankedMatch: jest.fn(),
    handleOfflinePractice: jest.fn(),
    handleStartOfflineWithDifficulty: jest.fn(),
  }),
}));

jest.mock('../../hooks/useUnlockOrientationOnIos', () => ({
  useUnlockOrientationOnIos: jest.fn(),
}));

jest.mock('../../components/home/ActiveGameBanner', () => ({
  ActiveGameBanner: () => null,
}));

jest.mock('../../components/BugReportModal', () => {
  return { __esModule: true, default: () => null };
});

jest.mock('../../i18n', () => ({
  i18n: { t: (key: string) => key },
}));

// ── Tests ────────────────────────────────────────────────────────────────────

import HomeScreen from '../HomeScreen';

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { root } = render(<HomeScreen />);
    expect(root).toBeTruthy();
  });

  it('shows leaderboard button', () => {
    const { getByTestId } = render(<HomeScreen />);
    expect(getByTestId('leaderboard-button')).toBeTruthy();
  });

  it('shows settings button', () => {
    const { getByTestId } = render(<HomeScreen />);
    expect(getByTestId('home-settings-button')).toBeTruthy();
  });

  it('shows bug report button', () => {
    const { getByTestId } = render(<HomeScreen />);
    expect(getByTestId('bug-report-button')).toBeTruthy();
  });
});
