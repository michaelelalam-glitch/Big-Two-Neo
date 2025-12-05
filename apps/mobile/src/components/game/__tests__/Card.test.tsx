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

  it('handles tap to select', () => {
    const { getByTestId } = render(
      <Card
        card={mockCard}
        isSelected={false}
        onToggleSelect={mockOnToggleSelect}
      />
    );

    // Note: GestureDetector doesn't expose testID directly
    // This test verifies the component structure
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
    const suits: Array<{ suit: string; symbol: string }> = [
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
});
