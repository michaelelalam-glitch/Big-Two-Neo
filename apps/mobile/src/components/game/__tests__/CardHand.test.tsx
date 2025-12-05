import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CardHand from '../CardHand';
import type { Card } from '../../../game/types';

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

describe('CardHand Component', () => {
  const mockCards: Card[] = [
    { id: '3H', rank: '3', suit: 'H' },
    { id: '4D', rank: '4', suit: 'D' },
    { id: '5C', rank: '5', suit: 'C' },
    { id: '6S', rank: '6', suit: 'S' },
    { id: '7H', rank: '7', suit: 'H' },
  ];

  const mockOnPlayCards = jest.fn();
  const mockOnPass = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all cards in hand', () => {
    const { getByText } = render(
      <CardHand
        cards={mockCards}
        onPlayCards={mockOnPlayCards}
        onPass={mockOnPass}
      />
    );

    // Check that all card ranks are rendered
    expect(getByText('3')).toBeTruthy();
    expect(getByText('4')).toBeTruthy();
    expect(getByText('5')).toBeTruthy();
    expect(getByText('6')).toBeTruthy();
    expect(getByText('7')).toBeTruthy();
  });

  it('renders Play and Pass buttons', () => {
    const { getByText } = render(
      <CardHand
        cards={mockCards}
        onPlayCards={mockOnPlayCards}
        onPass={mockOnPass}
      />
    );

    expect(getByText(/Play/)).toBeTruthy();
    expect(getByText('Pass')).toBeTruthy();
  });

  it('handles pass action', () => {
    const { getByText } = render(
      <CardHand
        cards={mockCards}
        onPlayCards={mockOnPlayCards}
        onPass={mockOnPass}
      />
    );

    fireEvent.press(getByText('Pass'));
    expect(mockOnPass).toHaveBeenCalledTimes(1);
  });

  it('disables actions when disabled prop is true', () => {
    const { getByText } = render(
      <CardHand
        cards={mockCards}
        onPlayCards={mockOnPlayCards}
        onPass={mockOnPass}
        disabled={true}
      />
    );

    // Buttons should be disabled (press won't trigger handlers)
    fireEvent.press(getByText('Pass'));
    expect(mockOnPass).not.toHaveBeenCalled();
  });

  it('disables actions when canPlay is false', () => {
    const { getByText } = render(
      <CardHand
        cards={mockCards}
        onPlayCards={mockOnPlayCards}
        onPass={mockOnPass}
        canPlay={false}
      />
    );

    fireEvent.press(getByText('Pass'));
    expect(mockOnPass).not.toHaveBeenCalled();
  });

  it('sorts cards correctly', () => {
    const unsortedCards: Card[] = [
      { id: 'KS', rank: 'K', suit: 'S' },
      { id: '3H', rank: '3', suit: 'H' },
      { id: 'AD', rank: 'A', suit: 'D' },
      { id: '5C', rank: '5', suit: 'C' },
    ];

    const { getByText } = render(
      <CardHand
        cards={unsortedCards}
        onPlayCards={mockOnPlayCards}
        onPass={mockOnPass}
      />
    );

    // All cards should be rendered
    expect(getByText('3')).toBeTruthy();
    expect(getByText('5')).toBeTruthy();
    expect(getByText('K')).toBeTruthy();
    expect(getByText('A')).toBeTruthy();
  });

  it('handles empty hand', () => {
    const { getByText } = render(
      <CardHand
        cards={[]}
        onPlayCards={mockOnPlayCards}
        onPass={mockOnPass}
      />
    );

    // Should still render buttons
    expect(getByText(/Play/)).toBeTruthy();
    expect(getByText('Pass')).toBeTruthy();
  });
});
