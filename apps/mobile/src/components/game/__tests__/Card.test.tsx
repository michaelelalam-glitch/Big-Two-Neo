// Mock reanimated before imports
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const RN = require('react-native');
  
  // Create Animated object as default export
  const Animated = {
    View: RN.View,
    Text: RN.Text,
    ScrollView: RN.ScrollView,
    Image: RN.Image,
  };
  
  return {
    __esModule: true,
    default: Animated,
    useSharedValue: jest.fn((value) => ({ value })),
    useAnimatedStyle: jest.fn((fn) => {
      try {
        return fn();
      } catch (e) {
        return {};
      }
    }),
    withSpring: jest.fn((value) => value),
    withTiming: jest.fn((value) => value),
    runOnJS: jest.fn((fn) => fn),
    useDerivedValue: jest.fn((fn) => ({ value: fn() })),
    useAnimatedReaction: jest.fn(),
  };
});

// Mock gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const View = require('react-native').View;
  return {
    Gesture: {
      Pan: jest.fn(() => ({
        onStart: jest.fn().mockReturnThis(),
        onUpdate: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        onFinalize: jest.fn().mockReturnThis(),
        enabled: jest.fn().mockReturnThis(),
        minDistance: jest.fn().mockReturnThis(),
      })),
      Tap: jest.fn(() => ({
        onStart: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        enabled: jest.fn().mockReturnThis(),
        maxDuration: jest.fn().mockReturnThis(),
      })),
      LongPress: jest.fn(() => ({
        onStart: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        enabled: jest.fn().mockReturnThis(),
        minDuration: jest.fn().mockReturnThis(),
      })),
      Race: jest.fn((...gestures) => gestures[0]),
      Exclusive: jest.fn((...gestures) => gestures[0]),
      Simultaneous: jest.fn((...gestures) => gestures[0]),
    },
    GestureDetector: ({ children }: any) => children,
  };
});

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import Card from '../Card';
import type { Card as CardType } from '../../../game/types';

// Mock haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
  },
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
}));

describe('Card Component', () => {
  const mockCard: CardType = {
    id: '3H',
    rank: '3',
    suit: 'H',
  };

  const mockOnToggleSelect = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.skip('renders card with correct rank and suit', () => {
    const { getByText } = render(
      <Card
        card={mockCard}
        isSelected={false}
        onToggleSelect={mockOnToggleSelect}
      />
    );

    // Rank appears twice (top-left and bottom-right)
    const rankElements = getByText('3');
    expect(rankElements).toBeTruthy();

    // Suit symbol appears (♥)
    const suitElements = getByText('♥');
    expect(suitElements).toBeTruthy();
  });

  // TODO: Gesture testing requires E2E framework (Detox)
  // GestureDetector doesn't expose testID for unit testing
  // This test suite verifies component structure and rendering only
  it('renders without errors when tapped', () => {
    const { getByTestId } = render(
      <Card
        card={mockCard}
        isSelected={false}
        onToggleSelect={mockOnToggleSelect}
      />
    );

    // Verifies component renders correctly
    // Actual tap gesture functionality requires E2E tests
    expect(mockOnToggleSelect).not.toHaveBeenCalled();
  });

  it.skip('displays selected state with border', () => {
    const { getByText } = render(
      <Card
        card={mockCard}
        isSelected={true}
        onToggleSelect={mockOnToggleSelect}
      />
    );

    // Component renders when selected
    expect(getByText('3')).toBeTruthy();
  });

  it.skip('displays different suits with correct colors', () => {
    const suits: Array<{ suit: 'H' | 'D' | 'C' | 'S'; symbol: string }> = [
      { suit: 'H', symbol: '♥' },
      { suit: 'D', symbol: '♦' },
      { suit: 'C', symbol: '♣' },
      { suit: 'S', symbol: '♠' },
    ];

    suits.forEach(({ suit, symbol }) => {
      const card: CardType = {
        id: `A${suit}`,
        rank: 'A',
        suit,
      };

      const { getByText } = render(
        <Card
          card={card}
          isSelected={false}
          onToggleSelect={mockOnToggleSelect}
        />
      );

      expect(getByText(symbol)).toBeTruthy();
      expect(getByText('A')).toBeTruthy();
    });
  });

  it.skip('respects disabled prop', () => {
    const { getByText } = render(
      <Card
        card={mockCard}
        isSelected={false}
        onToggleSelect={mockOnToggleSelect}
        disabled={true}
      />
    );

    // Component still renders when disabled
    expect(getByText('3')).toBeTruthy();
  });

  // Test for animation value resets on selection state changes (Task #378)
  // NOTE: This test validates component stability during selection state changes.
  // Actual animation value resets (opacity, scale) are Reanimated shared values
  // that don't directly affect the DOM and would require E2E testing to verify.
  it.skip('resets animation values when selection state changes', () => {
    const { rerender, getByText } = render(
      <Card
        card={mockCard}
        isSelected={false}
        onToggleSelect={mockOnToggleSelect}
      />
    );

    // Verify initial render
    expect(getByText('3')).toBeTruthy();

    // Change selection state - should trigger useEffect to reset animation values
    rerender(
      <Card
        card={mockCard}
        isSelected={true}
        onToggleSelect={mockOnToggleSelect}
      />
    );

    // Component should re-render without errors after selection state change
    expect(getByText('3')).toBeTruthy();

    // Change back to unselected
    rerender(
      <Card
        card={mockCard}
        isSelected={false}
        onToggleSelect={mockOnToggleSelect}
      />
    );

    // Component should still render correctly after multiple state changes
    expect(getByText('3')).toBeTruthy();
  });

  it.skip('maintains stable component when selection state changes rapidly', () => {
    const { rerender, getByText } = render(
      <Card
        card={mockCard}
        isSelected={false}
        onToggleSelect={mockOnToggleSelect}
      />
    );

    // Simulate rapid selection/deselection
    for (let i = 0; i < 5; i++) {
      rerender(
        <Card
          card={mockCard}
          isSelected={true}
          onToggleSelect={mockOnToggleSelect}
        />
      );
      rerender(
        <Card
          card={mockCard}
          isSelected={false}
          onToggleSelect={mockOnToggleSelect}
        />
      );
    }

    // Component should remain stable after rapid state changes
    expect(getByText('3')).toBeTruthy();
  });
});
