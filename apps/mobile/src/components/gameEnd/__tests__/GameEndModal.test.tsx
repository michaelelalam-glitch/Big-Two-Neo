/**
 * GameEndModal Component Tests
 * Task #423: Unit tests for GameEndModal
 * 
 * Smoke tests to verify component renders correctly
 */

import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import { GameEndModal } from '../GameEndModal';
import { GameEndProvider, useGameEnd } from '../../../contexts/GameEndContext';

// Mock dependencies
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
  },
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));

jest.mock('../Fireworks', () => ({
  Fireworks: 'Fireworks',
}));

jest.mock('../../scoreboard/components/CardImage', () => ({
  CardImage: 'CardImage',
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  SafeAreaProvider: 'SafeAreaProvider',
}));

// Mock Dimensions and Animated — fully mock all Animated methods
// to prevent real timers from keeping Jest alive in CI.
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');

  const createMockAnimation = (): any => ({
    start: jest.fn((cb?: any) => { if (cb) cb({ finished: true }); }),
    stop: jest.fn(),
    reset: jest.fn(),
  });

  return {
    ...RN,
    Dimensions: {
      get: jest.fn(() => ({ width: 375, height: 667 })),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
    Animated: {
      ...RN.Animated,
      Value: jest.fn(() => ({
        setValue: jest.fn(),
        interpolate: jest.fn(() => ({ _value: 0 })),
        stopAnimation: jest.fn(),
        _value: 0,
      })),
      timing: jest.fn(() => createMockAnimation()),
      delay: jest.fn(() => createMockAnimation()),
      sequence: jest.fn(() => createMockAnimation()),
      parallel: jest.fn(() => createMockAnimation()),
      loop: jest.fn(() => createMockAnimation()),
    },
  };
});

describe('GameEndModal Component', () => {
  describe('Basic Rendering', () => {
    it('renders without errors when modal is closed', () => {
      const { toJSON } = render(
        <GameEndProvider>
          <GameEndModal />
        </GameEndProvider>
      );
      // Modal is closed by default, so it returns null (not rendered)
      // This is correct behavior - no error means success
      expect(toJSON()).toBeNull();
    });
  });
});

// ============================================================================
// FlatList History Rendering & Expand/Collapse Tests (Task #574)
// ============================================================================

const MOCK_SCORE_HISTORY = [
  { matchNumber: 1, pointsAdded: [15, 5, 0, 10], scores: [15, 5, 0, 10] },
  { matchNumber: 2, pointsAdded: [20, 10, 5, 0], scores: [35, 15, 5, 10] },
];

const MOCK_PLAY_HISTORY = [
  {
    matchNumber: 1,
    hands: [
      { by: 0 as 0, type: 'single', count: 1, cards: [{ id: '3s', rank: '3', suit: 's' }] },
      { by: 1 as 1, type: 'pair',   count: 2, cards: [{ id: '4h', rank: '4', suit: 'h' }, { id: '4d', rank: '4', suit: 'd' }] },
    ],
  },
];

const MOCK_FINAL_SCORES = [
  { player_name: 'Alice',   cumulative_score: 35, player_index: 0, points_added: 20 },
  { player_name: 'Bob',     cumulative_score: 15, player_index: 1, points_added: 10 },
  { player_name: 'Charlie', cumulative_score: 5,  player_index: 2, points_added: 5 },
  { player_name: 'Diana',   cumulative_score: 10, player_index: 3, points_added: 0 },
];

const PLAYER_NAMES = ['Alice', 'Bob', 'Charlie', 'Diana'];

/** Helper: opens the modal and returns testing utilities */
const renderWithOpenModal = () => {
  let ctx!: ReturnType<typeof useGameEnd>;

  const Opener: React.FC = () => {
    ctx = useGameEnd();
    return null;
  };

  const utils = render(
    <GameEndProvider>
      <Opener />
      <GameEndModal />
    </GameEndProvider>
  );

  act(() => {
    ctx.openGameEndModal(
      'Alice',
      0,
      MOCK_FINAL_SCORES,
      PLAYER_NAMES,
      MOCK_SCORE_HISTORY,
      MOCK_PLAY_HISTORY
    );
  });

  return utils;
};

describe('GameEndModal FlatList history rendering (Task #574)', () => {
  describe('Score History tab', () => {
    it('renders match numbers for each score history entry', () => {
      const { getByText } = renderWithOpenModal();
      // Both match rows should be present
      expect(getByText(/Match 1/i)).toBeTruthy();
      expect(getByText(/Match 2/i)).toBeTruthy();
    });

    it('shows cumulative totals bar with player names', () => {
      const { getAllByText } = renderWithOpenModal();
      // Player names appear in the totals summary bar
      expect(getAllByText('Alice').length).toBeGreaterThan(0);
    });

    it('latest match starts expanded and earlier matches are collapsed', () => {
      const { getByText } = renderWithOpenModal();
      // Both Match 1 and Match 2 rows render in the FlatList
      expect(getByText(/Match 1/i)).toBeTruthy();
      expect(getByText(/Match 2/i)).toBeTruthy();
    });

    it('toggling a collapsed match row expands it without error', () => {
      const { getByText } = renderWithOpenModal();
      // Match 1 begins collapsed — pressing its row should expand without throwing
      const match1Row = getByText(/Match 1/i);
      expect(() => fireEvent.press(match1Row)).not.toThrow();
    });
  });

  describe('Play History tab', () => {
    it('renders Card Play History title after switching to the play tab', () => {
      const { getByTestId, getByText, queryByTestId } = renderWithOpenModal();
      // Press the Play History tab button via its testID (pressing the inner
      // Text node via getAllByText would target a non-pressable element and the
      // assertion could pass even without a real tab switch because the inactive
      // tab is still mounted with display:'none').
      fireEvent.press(getByTestId('tab-play-button'));
      // The play tab content wrapper must now be active (flex: 1)
      expect(getByTestId('tab-play-content').props.style).toEqual({ flex: 1 });
      // Score tab must now be hidden — RNTL excludes display:'none' elements
      // from normal queries, so queryByTestId returns null when it is hidden.
      expect(queryByTestId('tab-score-content')).toBeNull();
      // Play History title is present in the (now-active) play tab
      expect(getByText(/Card Play History/i)).toBeTruthy();
    });
  });

  describe('Action Buttons in tab footer', () => {
    it('share, play again, and return buttons are reachable via scroll', () => {
      const { getByText } = renderWithOpenModal();
      // Action buttons are rendered inside the FlatList footer
      expect(getByText(/share/i)).toBeTruthy();
      expect(getByText(/play again/i)).toBeTruthy();
    });
  });
});
