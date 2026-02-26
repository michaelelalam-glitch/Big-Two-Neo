/**
 * Tests for LandscapeOvalTable Component
 * 
 * Task #455: Implement oval poker table play area
 * Date: December 19, 2025
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { LandscapeOvalTable } from '../LandscapeOvalTable';
import type { Card } from '../../../game/types';

// Mock dependencies
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children, testID, style, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, { testID, style, ...props }, children);
  },
}));

jest.mock('../../../i18n', () => ({
  i18n: {
    t: (key: string) => {
      const translations: Record<string, string> = {
        'game.noCardsYet': 'No cards played yet',
        'game.lastPlayedBy': 'Last played by',
      };
      return translations[key] || key;
    },
  },
}));
jest.mock('../../../utils/cardSorting', () => ({
  sortCardsForDisplay: jest.fn((cards: Card[]) => cards), // Return as-is for testing
}));
jest.mock('../LandscapeCard', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ card }: any) => {
      const { View, Text } = require('react-native');
      return React.createElement(
        View,
        { testID: `landscape-card-${card.id}` },
        React.createElement(Text, null, `${card.rank}${card.suit}`)
      );
    },
  };
});

// ============================================================================
// TEST DATA
// ============================================================================

const mockCards: Card[] = [
  { id: '1', suit: 'H' as const, rank: 'A' as const },
  { id: '2', suit: 'H' as const, rank: 'K' as const },
  { id: '3', suit: 'D' as const, rank: 'Q' as const },
];

const mockSingleCard: Card[] = [
  { id: '1', suit: 'S' as const, rank: '3' as const },
];

// ============================================================================
// TEST SUITE: EMPTY STATE
// ============================================================================

describe('LandscapeOvalTable - Empty State', () => {
  it('renders empty state when no cards played', () => {
    const { getByText } = render(
      <LandscapeOvalTable
        lastPlayed={null}
        lastPlayedBy={null}
      />
    );

    expect(getByText('No cards played yet')).toBeTruthy();
  });

  it('renders empty state when empty card array', () => {
    const { getByText } = render(
      <LandscapeOvalTable
        lastPlayed={[]}
        lastPlayedBy={null}
      />
    );

    expect(getByText('No cards played yet')).toBeTruthy();
  });

  it('does not render last play info in empty state', () => {
    const { queryByText } = render(
      <LandscapeOvalTable
        lastPlayed={null}
        lastPlayedBy="Alice"
        comboDisplayText="Pair"
      />
    );

    expect(queryByText(/Last played by/)).toBeNull();
    expect(queryByText('Pair')).toBeNull();
  });
});

// ============================================================================
// TEST SUITE: ACTIVE STATE (CARDS DISPLAYED)
// ============================================================================

describe('LandscapeOvalTable - Active State', () => {
  it('renders cards when cards are played', () => {
    const { getAllByTestId } = render(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Alice"
      />
    );

    const cards = getAllByTestId(/^landscape-card-/);
    expect(cards).toHaveLength(3);
  });

  it('renders last played by text', () => {
    const { getByText } = render(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Bob"
      />
    );

    expect(getByText(/Last played by Bob/)).toBeTruthy();
  });

  it('renders combo display text when provided', () => {
    const { getByText } = render(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Carol"
        comboDisplayText="Straight to 6"
      />
    );

    // Combined format: "Last played by Carol: Straight to 6"
    expect(getByText(/Last played by Carol: Straight to 6/)).toBeTruthy();
  });

  it('does not render combo text when not provided', () => {
    const { queryByText } = render(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Dave"
      />
    );

    // Should not crash, just no combo text
    expect(queryByText(/Straight|Flush|Pair/)).toBeNull();
  });

  it('handles single card correctly', () => {
    const { getAllByTestId, getByText } = render(
      <LandscapeOvalTable
        lastPlayed={mockSingleCard}
        lastPlayedBy="Alice"
        comboDisplayText="Single (3♠)"
      />
    );

    const cards = getAllByTestId(/^landscape-card-/);
    expect(cards).toHaveLength(1);
    // Combined format: "Last played by Alice: Single (3♠)"
    expect(getByText(/Last played by Alice: Single/)).toBeTruthy();
  });
});

// ============================================================================
// TEST SUITE: DIMENSIONS (MIGRATION PLAN COMPLIANCE)
// ============================================================================

describe('LandscapeOvalTable - Dimensions', () => {
  it('applies correct oval table dimensions (420×240pt)', () => {
    const { getByTestId } = render(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Alice"
      />
    );

    const container = getByTestId('oval-table-container');
    const styles = container.props.style;

    // Container should have width: 420, height: 240
    expect(styles).toMatchObject({
      width: 420,
      height: 240,
    });
  });

  it('applies correct border radius (120pt for oval ends)', () => {
    const { getByTestId } = render(
      <LandscapeOvalTable
        lastPlayed={null}
        lastPlayedBy={null}
      />
    );

    const container = getByTestId('oval-table-container');
    const styles = container.props.style;

    expect(styles.borderRadius).toBe(120); // Half of height
  });

  it('applies poker table styling (green gradient)', () => {
    const { getByTestId } = render(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Bob"
      />
    );

    const gradient = getByTestId('oval-table-container');
    
    // LinearGradient is mocked as View, so check it exists
    expect(gradient).toBeTruthy();
    expect(gradient.props.testID).toBe('oval-table-container');
  });
});

// ============================================================================
// TEST SUITE: CARD SORTING INTEGRATION
// ============================================================================

describe('LandscapeOvalTable - Card Sorting', () => {
  it('calls sortCardsForDisplay with cards and combo type', () => {
    const sortCardsForDisplay = require('../../../utils/cardSorting').sortCardsForDisplay;
    
    render(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Alice"
        combinationType="Straight"
      />
    );

    expect(sortCardsForDisplay).toHaveBeenCalledWith(
      mockCards,
      'Straight'
    );
  });

  it('handles null combinationType gracefully', () => {
    const sortCardsForDisplay = require('../../../utils/cardSorting').sortCardsForDisplay;
    
    render(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Bob"
        combinationType={null}
      />
    );

    expect(sortCardsForDisplay).toHaveBeenCalledWith(
      mockCards,
      undefined
    );
  });
});

// ============================================================================
// TEST SUITE: INTEGRATION
// ============================================================================

describe('LandscapeOvalTable - Integration', () => {
  it('transitions from empty to active state', () => {
    const { getByText, rerender, queryByText } = render(
      <LandscapeOvalTable
        lastPlayed={null}
        lastPlayedBy={null}
      />
    );

    // Initially empty
    expect(getByText('No cards played yet')).toBeTruthy();

    // Update with cards
    rerender(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Alice"
        comboDisplayText="Triple (A)"
      />
    );

    // Now showing cards
    expect(queryByText('No cards played yet')).toBeNull();
    expect(getByText(/Last played by Alice/)).toBeTruthy();
    expect(getByText(/Triple \(A\)/)).toBeTruthy();
  });

  it('updates when player changes', () => {
    const { getByText, rerender } = render(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Alice"
      />
    );

    expect(getByText(/Last played by Alice/)).toBeTruthy();

    rerender(
      <LandscapeOvalTable
        lastPlayed={mockSingleCard}
        lastPlayedBy="Bob"
      />
    );

    expect(getByText(/Last played by Bob/)).toBeTruthy();
  });

  it('handles rapid state changes gracefully', () => {
    const { rerender, getByText } = render(
      <LandscapeOvalTable
        lastPlayed={null}
        lastPlayedBy={null}
      />
    );

    // Rapid transitions
    rerender(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Alice"
      />
    );

    rerender(
      <LandscapeOvalTable
        lastPlayed={null}
        lastPlayedBy={null}
      />
    );

    rerender(
      <LandscapeOvalTable
        lastPlayed={mockSingleCard}
        lastPlayedBy="Bob"
      />
    );

    // Should render final state correctly
    expect(getByText(/Last played by Bob/)).toBeTruthy();
  });
});

// ============================================================================
// TEST SUITE: PROPS VALIDATION
// ============================================================================

describe('LandscapeOvalTable - Props Validation', () => {
  it('handles all optional props being undefined', () => {
    const { getByText } = render(
      <LandscapeOvalTable
        lastPlayed={null}
        lastPlayedBy={null}
      />
    );

    expect(getByText('No cards played yet')).toBeTruthy();
  });

  it('handles lastPlayedBy null with cards', () => {
    const { queryByText, getAllByTestId } = render(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy={null}
      />
    );

    // Should render cards but no "Last played by" text
    const cards = getAllByTestId(/^landscape-card-/);
    expect(cards).toHaveLength(3);
    expect(queryByText(/Last played by/)).toBeNull();
  });

  it('handles comboDisplayText without combinationType', () => {
    const { getByText } = render(
      <LandscapeOvalTable
        lastPlayed={mockCards}
        lastPlayedBy="Carol"
        comboDisplayText="Full House (A)"
      />
    );

    expect(getByText(/Full House \(A\)/)).toBeTruthy();
  });
});
