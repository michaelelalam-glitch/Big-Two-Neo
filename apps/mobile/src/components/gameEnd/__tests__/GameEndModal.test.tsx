/**
 * GameEndModal Component Tests
 * Task #423: Unit tests for GameEndModal
 * 
 * Smoke tests to verify component renders correctly
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { GameEndModal } from '../GameEndModal';
import { GameEndProvider } from '../../../contexts/GameEndContext';

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
