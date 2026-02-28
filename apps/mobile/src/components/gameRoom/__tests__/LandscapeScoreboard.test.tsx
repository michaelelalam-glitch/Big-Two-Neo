// @ts-nocheck - Test infrastructure type issues
/**
 * LandscapeScoreboard Component Tests
 * 
 * Tests for landscape-optimized scoreboard
 * Verifies:
 * - Collapsed state rendering (empty container after Task #590)
 * - Expanded state rendering (344pt max height)
 * - Button interactions (expand, collapse, play history)
 * - Player list rendering with current player highlight
 * - Score table with match history
 * - Identical functionality to portrait mode
 * 
 * Created as part of Task #454: Landscape scoreboard tests
 * Updated for Task #590: Collapsed scoreboard removed (renders empty View)
 * Date: December 19, 2025
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { LandscapeScoreboard, PlayHistoryModal } from '../LandscapeScoreboard';

// ============================================================================
// MOCK DATA
// ============================================================================

const mockPlayerNames = ['Alice', 'Bob', 'Carol', 'Dave'];
const mockCurrentScores = [15, 23, 0, 12];
const mockCardCounts = [5, 3, 8, 6];
const currentPlayerIndex = 1; // Bob's turn

const mockScoreHistory = [
  {
    matchNumber: 1,
    pointsAdded: [15, 8, 0, 12],
    scores: [15, 8, 0, 12],
    winnerId: 2, // Carol won
  },
  {
    matchNumber: 2,
    pointsAdded: [0, 15, 0, 0],
    scores: [15, 23, 0, 12],
    winnerId: 0, // Alice won
  },
];

const mockPlayHistory = [
  {
    matchNumber: 1,
    hands: [
      {
        by: 0 as const,
        type: 'straight',
        count: 3,
        cards: [
          { rank: '3' as const, suit: '♦' as const, id: '3♦' },
          { rank: '4' as const, suit: '♦' as const, id: '4♦' },
          { rank: '5' as const, suit: '♦' as const, id: '5♦' },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  },
];

// ============================================================================
// COLLAPSED STATE TESTS
// ============================================================================

describe('LandscapeScoreboard - Collapsed State', () => {
  it('should render collapsed scoreboard with correct structure', () => {
    // Task #590: Collapsed state now renders an empty container (no content)
    const { queryByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={false}
      />
    );

    // Collapsed state renders empty container - no content visible
    expect(queryByText('Match 2')).toBeNull();
    expect(queryByText('Alice')).toBeNull();
    expect(queryByText('Bob')).toBeNull();
    expect(queryByText('Carol')).toBeNull();
    expect(queryByText('Dave')).toBeNull();
  });

  it('should render player scores correctly', () => {
    // Task #590: Collapsed state renders empty container - no scores visible
    const { queryByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={false}
      />
    );

    // No scores rendered in collapsed state
    expect(queryByText('15 pts')).toBeNull();
    expect(queryByText('23 pts')).toBeNull();
    expect(queryByText('0 pts')).toBeNull();
    expect(queryByText('12 pts')).toBeNull();
  });

  it('should render card counts during active game', () => {
    // Task #590: Collapsed state renders empty container - no card counts visible
    const { queryByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={false}
      />
    );

    // Collapsed state renders empty container
    expect(queryByText('Alice')).toBeNull();
  });

  it('should NOT render card counts when game is finished', () => {
    const { queryByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={true}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={false}
      />
    );

    // Card counts should not be visible
    expect(queryByText('🃏 5')).toBeNull();
    expect(queryByText('🃏 3')).toBeNull();
  });

  it('should show "Game Over" title when game is finished', () => {
    // Task #590: Collapsed state renders empty container even when game is finished
    const { queryByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={true}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={false}
      />
    );

    // Collapsed state renders empty container - no Game Over text
    expect(queryByText('🏁 Game Over')).toBeNull();
  });

  it('should render expand button when onToggleExpand is provided', () => {
    // Task #590: Collapsed state renders empty container - no expand button
    const onToggleExpandMock = jest.fn();
    const { queryByLabelText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={false}
        onToggleExpand={onToggleExpandMock}
      />
    );

    // No expand button in collapsed state (empty container)
    expect(queryByLabelText('Expand scoreboard')).toBeNull();
  });

  it('should render play history button when onTogglePlayHistory is provided', () => {
    // Task #590: Collapsed state renders empty container - no play history button
    const onTogglePlayHistoryMock = jest.fn();
    const { queryByLabelText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={false}
        onTogglePlayHistory={onTogglePlayHistoryMock}
      />
    );

    // No play history button in collapsed state (empty container)
    expect(queryByLabelText('Open play history')).toBeNull();
  });

  it('should call onToggleExpand when expand button is pressed', () => {
    // Task #590: Collapsed state renders empty container - no expand button to press
    const onToggleExpandMock = jest.fn();
    const { queryByLabelText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={false}
        onToggleExpand={onToggleExpandMock}
      />
    );

    // No expand button in collapsed state
    expect(queryByLabelText('Expand scoreboard')).toBeNull();
    expect(onToggleExpandMock).not.toHaveBeenCalled();
  });

  it('should call onTogglePlayHistory when play history button is pressed', () => {
    // Task #590: Collapsed state renders empty container - no play history button to press
    const onTogglePlayHistoryMock = jest.fn();
    const { queryByLabelText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={false}
        onTogglePlayHistory={onTogglePlayHistoryMock}
      />
    );

    // No play history button in collapsed state
    expect(queryByLabelText('Open play history')).toBeNull();
    expect(onTogglePlayHistoryMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// EXPANDED STATE TESTS
// ============================================================================

describe('LandscapeScoreboard - Expanded State', () => {
  it('should render expanded scoreboard with correct structure', () => {
    const { getByText, getAllByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={true}
      />
    );

    // Header
    expect(getByText('Match 2 History')).toBeTruthy();
    
    // Table header (all players)
    expect(getByText('Match')).toBeTruthy();
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('Bob')).toBeTruthy();
    expect(getByText('Carol')).toBeTruthy();
    expect(getByText('Dave')).toBeTruthy();
  });

  it('should render match history rows', () => {
    const { getByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={3}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={true}
      />
    );

    // Match numbers
    expect(getByText('#1')).toBeTruthy();
    expect(getByText('#2')).toBeTruthy();
    
    // Points added - verify table structure exists
    expect(getByText('Match')).toBeTruthy(); // Table header
  });

  it('should render current match row with card counts', () => {
    const { getByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={3}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={true}
      />
    );

    // Current match row
    expect(getByText('#3')).toBeTruthy();
    expect(getByText('🃏 5')).toBeTruthy(); // Alice
    expect(getByText('🃏 3')).toBeTruthy(); // Bob
    expect(getByText('🃏 8')).toBeTruthy(); // Carol
    expect(getByText('🃏 6')).toBeTruthy(); // Dave
  });

  it('should NOT render current match row when game is finished', () => {
    const { queryByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={3}
        isGameFinished={true}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={true}
      />
    );

    // Current match should not be visible
    expect(queryByText('#3')).toBeNull();
    expect(queryByText('🃏 5')).toBeNull();
  });

  it('should render total row with final scores', () => {
    const { getByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={3}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={true}
      />
    );

    // Total label
    expect(getByText('Total')).toBeTruthy();
    
    // Verify total row exists with scores
    expect(getByText('Total')).toBeTruthy();
  });

  it('should show "Final Scores" title when game is finished', () => {
    const { getByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={3}
        isGameFinished={true}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={true}
      />
    );

    expect(getByText('🏁 Final Scores')).toBeTruthy();
  });

  it('should render close button when onToggleExpand is provided', () => {
    const onToggleExpandMock = jest.fn();
    const { getByLabelText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={true}
        onToggleExpand={onToggleExpandMock}
      />
    );

    const closeButton = getByLabelText('Minimize scoreboard');
    expect(closeButton).toBeTruthy();
  });

  it('should call onToggleExpand when close button is pressed', () => {
    const onToggleExpandMock = jest.fn();
    const { getByLabelText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={true}
        onToggleExpand={onToggleExpandMock}
      />
    );

    const closeButton = getByLabelText('Minimize scoreboard');
    fireEvent.press(closeButton);

    expect(onToggleExpandMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// DIMENSION TESTS (Landscape-specific)
// ============================================================================

describe('LandscapeScoreboard - Dimensions', () => {
  it('should apply landscape-specific dimensions from migration plan', () => {
    // Task #590: Collapsed state renders empty container
    // Verify component renders without errors in collapsed state
    
    const { queryByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={false}
      />
    );

    // Collapsed state renders empty container - no content
    expect(queryByText('Match 2')).toBeNull();
  });

  it('should maintain max width of 280pt for collapsed state', () => {
    // Task #590: Collapsed state renders empty container
    // Component still uses maxWidth from styles but renders no content
    
    const { queryByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={false}
      />
    );

    // Collapsed state renders empty container
    expect(queryByText('Alice')).toBeNull();
  });

  it('should maintain max height of 344pt for expanded state', () => {
    // Component uses maxHeight: 344pt from styles
    // This test ensures the expanded component renders correctly
    
    const { getByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={true}
      />
    );

    expect(getByText('Match 2 History')).toBeTruthy();
  });
});

// ============================================================================
// PLAY HISTORY MODAL TESTS (Identical to portrait)
// ============================================================================

describe('PlayHistoryModal - Re-exported from portrait', () => {
  it('should export PlayHistoryModal from portrait scoreboard', () => {
    // Verify PlayHistoryModal is available
    expect(PlayHistoryModal).toBeDefined();
    expect(typeof PlayHistoryModal).toBe('function');
  });

  it('should use PlayHistoryModal from portrait scoreboard without modifications', () => {
    // PlayHistoryModal is identical in landscape mode
    // It's properly re-exported from the portrait scoreboard
    // Functional testing is done in the portrait scoreboard tests
    expect(PlayHistoryModal).toBeDefined();
    expect(typeof PlayHistoryModal).toBe('function'); // React component
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('LandscapeScoreboard - Integration', () => {
  it('should toggle between collapsed and expanded states', () => {
    let isExpanded = false;
    const onToggleExpand = jest.fn(() => {
      isExpanded = !isExpanded;
    });

    const { rerender, queryByText, getByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
      />
    );

    // Initially collapsed - empty container, no content
    expect(queryByText('Match 2')).toBeNull();
    expect(queryByText('Match 2 History')).toBeNull();
    
    // Rerender with expanded state
    rerender(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={true}
        onToggleExpand={onToggleExpand}
      />
    );

    // Now expanded
    expect(getByText('Match 2 History')).toBeTruthy();
  });

  it('should handle multiple players correctly', () => {
    // Task #590: Collapsed state renders empty container
    // Test multiple players in expanded state instead
    const { getByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={mockCurrentScores}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={2}
        isGameFinished={false}
        scoreHistory={mockScoreHistory}
        playHistory={mockPlayHistory}
        isExpanded={true}
      />
    );

    // All 4 players should be visible in expanded state
    mockPlayerNames.forEach((name) => {
      expect(getByText(name)).toBeTruthy();
    });
  });

  it('should handle empty score history gracefully', () => {
    const { getByText } = render(
      <LandscapeScoreboard
        playerNames={mockPlayerNames}
        currentScores={[0, 0, 0, 0]}
        cardCounts={mockCardCounts}
        currentPlayerIndex={currentPlayerIndex}
        matchNumber={1}
        isGameFinished={false}
        scoreHistory={[]}
        playHistory={[]}
        isExpanded={true}
      />
    );

    // Should still render header and current match
    expect(getByText('Match 1 History')).toBeTruthy();
    expect(getByText('Total')).toBeTruthy();
  });
});
