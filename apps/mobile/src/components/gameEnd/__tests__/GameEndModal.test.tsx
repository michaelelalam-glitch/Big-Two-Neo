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

// Mock Dimensions and Animated
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
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
        interpolate: jest.fn(() => ({
          _value: 0,
        })),
        stopAnimation: jest.fn(),
        _value: 0,
      })),
      timing: jest.fn(() => ({
        start: jest.fn(),
        stop: jest.fn(),
      })),
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
      expect(toJSON()).toBeTruthy();
    });
  });
});
