/**
 * Tests for LandscapeYourPosition Component
 * 
 * Task #452: Build bottom player position with card hand display
 * Date: December 19, 2025
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { LandscapeYourPosition } from '../LandscapeYourPosition';
import type { Card } from '../../../game/types';

// Mock dependencies
jest.mock('../../../i18n', () => ({
  i18n: {
    t: (key: string) => {
      const translations: Record<string, string> = {
        'game.noCards': 'No cards',
      };
      return translations[key] || key;
    },
  },
}));

jest.mock('../LandscapeCard', () => {
  return function MockLandscapeCard({ card, selected }: any) {
    const React = require('react');
    const { View, Text } = require('react-native');
    return React.createElement(
      View,
      { testID: `landscape-card-${card.id}` },
      React.createElement(Text, {}, `${card.rank}${card.suit}${selected ? ' (selected)' : ''}`)
    );
  };
});

jest.mock('../../../utils/cardOverlap', () => ({
  calculateCardOverlap: jest.fn((cardCount, cardWidth, availableWidth) => ({
    cardSpacing: 36,
    totalWidth: cardWidth + (36 * (cardCount - 1)),
    overlapPercentage: 0.5,
  })),
}));

// ============================================================================
// MOCK DATA
// ============================================================================

const mockCards: Card[] = [
  { id: '1', suit: 'S', rank: '3' },
  { id: '2', suit: 'H', rank: '4' },
  { id: '3', suit: 'D', rank: '5' },
  { id: '4', suit: 'C', rank: '6' },
  { id: '5', suit: 'S', rank: '7' },
];

const mockSelectedCardIds = new Set(['1', '3']);

// ============================================================================
// TEST SUITE: RENDERING
// ============================================================================

describe('LandscapeYourPosition - Rendering', () => {
  it('renders player name', () => {
    const { getByText } = render(
      <LandscapeYourPosition
        playerName="Alice"
        cards={mockCards}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    expect(getByText('Alice')).toBeTruthy();
  });

  it('renders active player name with highlight', () => {
    const { getByText } = render(
      <LandscapeYourPosition
        playerName="Bob"
        cards={mockCards}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={true}
      />
    );

    const playerName = getByText('Bob');
    expect(playerName).toBeTruthy();
    expect(playerName.props.style).toContainEqual(
      expect.objectContaining({ color: '#10b981' })
    );
  });

  it('renders card count badge', () => {
    const { getByText } = render(
      <LandscapeYourPosition
        playerName="Carol"
        cards={mockCards}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    expect(getByText('5')).toBeTruthy(); // 5 cards
  });

  it('renders all cards', () => {
    const { getByTestId } = render(
      <LandscapeYourPosition
        playerName="Dave"
        cards={mockCards}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    mockCards.forEach((card) => {
      expect(getByTestId(`card-${card.id}`)).toBeTruthy();
    });
  });

  it('renders empty state when no cards', () => {
    const { getByText } = render(
      <LandscapeYourPosition
        playerName="Eve"
        cards={[]}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    expect(getByText('No cards')).toBeTruthy();
  });
});

// ============================================================================
// TEST SUITE: CARD SELECTION
// ============================================================================

describe('LandscapeYourPosition - Card Selection', () => {
  it('calls onSelectionChange with toggled selection when card pressed (Task #457)', () => {
    const onSelectionChange = jest.fn();
    const { getByTestId } = render(
      <LandscapeYourPosition
        playerName="Alice"
        cards={mockCards}
        selectedCardIds={new Set()}
        onSelectionChange={onSelectionChange}
        isActive={true}
      />
    );

    fireEvent.press(getByTestId('card-1'));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1']));
  });

  it('does not call onCardSelect when disabled', () => {
    const onCardSelect = jest.fn();
    const { getByTestId } = render(
      <LandscapeYourPosition
        playerName="Bob"
        cards={mockCards}
        selectedCardIds={new Set()}
        onSelectionChange={onCardSelect}
        isActive={false}
        disabled={true}
      />
    );

    fireEvent.press(getByTestId('card-1'));
    expect(onCardSelect).not.toHaveBeenCalled();
  });

  it('renders selected cards with lift animation', () => {
    const { getByTestId } = render(
      <LandscapeYourPosition
        playerName="Carol"
        cards={mockCards}
        selectedCardIds={mockSelectedCardIds}
        onSelectionChange={jest.fn()}
        isActive={true}
      />
    );

    const card1 = getByTestId('card-1');
    const card2 = getByTestId('card-2');

    // Card 1 should be lifted (selected)
    expect(card1.props.style).toContainEqual(
      expect.objectContaining({ transform: [{ translateY: -20 }] })
    );

    // Card 2 should not be lifted (not selected)
    expect(card2.props.style).toContainEqual(
      expect.objectContaining({ transform: [{ translateY: 0 }] })
    );
  });

  it('applies correct z-index to selected cards', () => {
    const { getByTestId } = render(
      <LandscapeYourPosition
        playerName="Dave"
        cards={mockCards}
        selectedCardIds={mockSelectedCardIds}
        onSelectionChange={jest.fn()}
        isActive={true}
      />
    );

    const card1 = getByTestId('card-1');
    const card2 = getByTestId('card-2');

    // Card 1 is selected (z-index: 1000+)
    expect(card1.props.style).toContainEqual(
      expect.objectContaining({ zIndex: 1000 })
    );

    // Card 2 is not selected (z-index: index only)
    expect(card2.props.style).toContainEqual(
      expect.objectContaining({ zIndex: 1 })
    );
  });
});

// ============================================================================
// TEST SUITE: ADAPTIVE OVERLAP
// ============================================================================

describe('LandscapeYourPosition - Adaptive Overlap', () => {
  it('calls calculateCardOverlap with correct parameters', () => {
    const { calculateCardOverlap } = require('../../../utils/cardOverlap');
    
    render(
      <LandscapeYourPosition
        playerName="Alice"
        cards={mockCards}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    expect(calculateCardOverlap).toHaveBeenCalledWith(
      5,   // cardCount
      72,  // cardWidth
      760, // availableWidth (800 - 40 padding)
      36,  // preferredSpacing
      20   // minSpacing
    );
  });

  it('applies adaptive card spacing', () => {
    const { calculateCardOverlap } = require('../../../utils/cardOverlap');
    calculateCardOverlap.mockReturnValue({
      cardSpacing: 24, // Reduced spacing
      totalWidth: 168,
      overlapPercentage: 0.67,
    });

    const { getByTestId } = render(
      <LandscapeYourPosition
        playerName="Bob"
        cards={mockCards.slice(0, 3)} // 3 cards
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    const card2 = getByTestId('card-2');
    expect(card2.props.style).toContainEqual(
      expect.objectContaining({ marginLeft: 24 })
    );
  });

  it('sets total width on cards container', () => {
    const { calculateCardOverlap } = require('../../../utils/cardOverlap');
    calculateCardOverlap.mockReturnValue({
      cardSpacing: 36,
      totalWidth: 216,
      overlapPercentage: 0.5,
    });

    const { getByTestId } = render(
      <LandscapeYourPosition
        playerName="Carol"
        cards={mockCards.slice(0, 4)}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    const container = getByTestId('cards-container');
    expect(container.props.style).toContainEqual({ width: 216 });
  });
});

// ============================================================================
// TEST SUITE: EDGE CASES
// ============================================================================

describe('LandscapeYourPosition - Edge Cases', () => {
  it('renders with single card', () => {
    const { getByTestId, getByText } = render(
      <LandscapeYourPosition
        playerName="Alice"
        cards={[mockCards[0]]}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    expect(getByTestId('card-1')).toBeTruthy();
    expect(getByText('1')).toBeTruthy(); // Badge shows 1
  });

  it('renders with 13 cards (full hand)', () => {
    const fullHand: Card[] = Array.from({ length: 13 }, (_, i) => ({
      id: `${i + 1}`,
      suit: 'S' as const,
      rank: '3' as const,
    }));

    const { getByText } = render(
      <LandscapeYourPosition
        playerName="Bob"
        cards={fullHand}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    expect(getByText('13')).toBeTruthy();
  });

  it('handles undefined containerWidth', () => {
    const { getByTestId } = render(
      <LandscapeYourPosition
        playerName="Carol"
        cards={mockCards}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
        // containerWidth not provided (uses default 932)
      />
    );

    expect(getByTestId('landscape-your-position')).toBeTruthy();
  });
});

// ============================================================================
// TEST SUITE: ACCESSIBILITY
// ============================================================================

describe('LandscapeYourPosition - Accessibility', () => {
  it('provides testID for component', () => {
    const { getByTestId } = render(
      <LandscapeYourPosition
        playerName="Dave"
        cards={mockCards}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    expect(getByTestId('landscape-your-position')).toBeTruthy();
  });

  it('provides testID for each card', () => {
    const { getByTestId } = render(
      <LandscapeYourPosition
        playerName="Eve"
        cards={mockCards}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    mockCards.forEach((card) => {
      expect(getByTestId(`card-${card.id}`)).toBeTruthy();
    });
  });

  it('provides testID for cards container', () => {
    const { getByTestId } = render(
      <LandscapeYourPosition
        playerName="Frank"
        cards={mockCards}
        selectedCardIds={new Set()}
        onSelectionChange={jest.fn()}
        isActive={false}
      />
    );

    expect(getByTestId('cards-container')).toBeTruthy();
  });
});
