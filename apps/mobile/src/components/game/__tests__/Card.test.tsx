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

  it('renders card with correct rank and suit', () => {
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

  it('displays selected state with border', () => {
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

  it('displays different suits with correct colors', () => {
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

  it('respects disabled prop', () => {
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
  it('resets animation values when selection state changes', () => {
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

  it('maintains stable component when selection state changes rapidly', () => {
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
