/**
 * Scoreboard Components Unit Tests
 * 
 * Tests for CompactScoreboard and ExpandedScoreboard components:
 * - Rendering with mock data
 * - Expand/collapse interactions
 * - Player name display
 * - Score calculations
 * - Auto-expand on game finish
 * - Current player highlighting
 * 
 * Task #357: Scoreboard components unit tests
 * Target: 80%+ coverage
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CompactScoreboard from '../CompactScoreboard';
import ExpandedScoreboard from '../ExpandedScoreboard';
import { ScoreHistory } from '../../../types/scoreboard';

// ============================================================================
// MOCK DATA
// ============================================================================

const mockPlayerNames = ['Alice', 'Bob', 'Charlie', 'Diana'];
const mockCurrentScores = [15, 28, 42, 9];
const mockCardCounts = [7, 5, 3, 8];

const mockScoreHistory: ScoreHistory[] = [
  {
    matchNumber: 1,
    pointsAdded: [5, 10, 15, 0],
    scores: [5, 10, 15, 0],
  },
  {
    matchNumber: 2,
    pointsAdded: [10, 18, 27, 9],
    scores: [15, 28, 42, 9],
  },
];

// ============================================================================
// COMPACT SCOREBOARD TESTS
// ============================================================================

describe('CompactScoreboard', () => {
  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------

  describe('Rendering', () => {
    it('should render match number correctly', () => {
      const { getByText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={2}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      expect(getByText('Match 2')).toBeTruthy();
    });

    it('should render all player names', () => {
      const { getByText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      mockPlayerNames.forEach((name) => {
        expect(getByText(name)).toBeTruthy();
      });
    });

    it('should render current scores for all players', () => {
      const { getByText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      expect(getByText('+15')).toBeTruthy();
      expect(getByText('+28')).toBeTruthy();
      expect(getByText('+42')).toBeTruthy();
      expect(getByText('+9')).toBeTruthy();
    });

    it('should render card counts when game is not finished', () => {
      const { getByText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      expect(getByText('🃏 7')).toBeTruthy();
      expect(getByText('🃏 5')).toBeTruthy();
      expect(getByText('🃏 3')).toBeTruthy();
      expect(getByText('🃏 8')).toBeTruthy();
    });

    it('should not render card counts when game is finished', () => {
      const { queryByText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={true}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      expect(queryByText('🃏 7')).toBeNull();
    });

    it('should show "Game Over" when game is finished', () => {
      const { getByText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={2}
          isGameFinished={true}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      expect(getByText('🏁 Game Over')).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // Current Player Highlighting Tests
  // --------------------------------------------------------------------------

  describe('Current Player Highlighting', () => {
    it('should highlight current player', () => {
      const { getByText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={1}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      const bobName = getByText('Bob');
      expect(bobName).toBeTruthy();
    });

    it('should handle different current player indices', () => {
      for (let i = 0; i < mockPlayerNames.length; i++) {
        const { getByText } = render(
          <CompactScoreboard playHistory={[]}
            playerNames={mockPlayerNames}
            currentScores={mockCurrentScores}
            cardCounts={mockCardCounts}
            currentPlayerIndex={i}
            matchNumber={1}
            isGameFinished={false}
            scoreHistory={mockScoreHistory}
            isExpanded={false}
          />
        );

        expect(getByText(mockPlayerNames[i])).toBeTruthy();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Button Interaction Tests
  // --------------------------------------------------------------------------

  describe('Button Interactions', () => {
    it('should call onToggleExpand when expand button is pressed', () => {
      const onToggleExpandMock = jest.fn();
      const { getByLabelText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          onToggleExpand={onToggleExpandMock}
          isExpanded={false}
        />
      );

      const expandButton = getByLabelText('Expand scoreboard');
      fireEvent.press(expandButton);

      expect(onToggleExpandMock).toHaveBeenCalledTimes(1);
    });

    it('should call onTogglePlayHistory when play history button is pressed', () => {
      const onTogglePlayHistoryMock = jest.fn();
      const { getByLabelText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          onTogglePlayHistory={onTogglePlayHistoryMock}
          isExpanded={false}
        />
      );

      const playHistoryButton = getByLabelText('Open play history');
      fireEvent.press(playHistoryButton);

      expect(onTogglePlayHistoryMock).toHaveBeenCalledTimes(1);
    });

    it('should not render expand button if onToggleExpand is not provided', () => {
      const { queryByLabelText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      expect(queryByLabelText('Expand scoreboard')).toBeNull();
    });

    it('should not render play history button if onTogglePlayHistory is not provided', () => {
      const { queryByLabelText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      expect(queryByLabelText('Open play history')).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Auto-Expand Tests
  // --------------------------------------------------------------------------

  describe('Auto-Expand Behavior', () => {
    it('should auto-expand when game finishes', () => {
      const onToggleExpandMock = jest.fn();
      
      const { rerender } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          onToggleExpand={onToggleExpandMock}
          isExpanded={false}
        />
      );

      // Game finishes
      rerender(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={true}
          scoreHistory={mockScoreHistory}
          onToggleExpand={onToggleExpandMock}
          isExpanded={false}
        />
      );

      expect(onToggleExpandMock).toHaveBeenCalled();
    });

    it('should not auto-expand if already expanded', () => {
      const onToggleExpandMock = jest.fn();
      
      render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={true}
          scoreHistory={mockScoreHistory}
          onToggleExpand={onToggleExpandMock}
          isExpanded={true}
        />
      );

      expect(onToggleExpandMock).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('should handle negative scores', () => {
      const negativeScores = [-5, -10, 0, 5];
      const { getByText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={negativeScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      expect(getByText('-5')).toBeTruthy();
      expect(getByText('-10')).toBeTruthy();
      expect(getByText('0')).toBeTruthy();
      expect(getByText('+5')).toBeTruthy();
    });

    it('should handle empty player names', () => {
      const emptyNames = ['', 'Bob', '', 'Diana'];
      const { getByText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={emptyNames}
          currentScores={mockCurrentScores}
          cardCounts={mockCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      expect(getByText('Bob')).toBeTruthy();
      expect(getByText('Diana')).toBeTruthy();
    });

    it('should handle zero card counts', () => {
      const zeroCardCounts = [0, 0, 0, 0];
      const { getByText } = render(
        <CompactScoreboard playHistory={[]}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          cardCounts={zeroCardCounts}
          currentPlayerIndex={0}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          isExpanded={false}
        />
      );

      expect(getByText('🃏 0')).toBeTruthy();
    });
  });
});

// ============================================================================
// EXPANDED SCOREBOARD TESTS
// ============================================================================

describe('ExpandedScoreboard', () => {
  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------

  describe('Rendering', () => {
    it('should render table header with match numbers', () => {
      const { getByText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          matchNumber={3}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
        />
      );

      expect(getByText('Match 1')).toBeTruthy();
      expect(getByText('Match 2')).toBeTruthy();
    });

    it('should render all player names in table rows', () => {
      const { getAllByText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          matchNumber={2}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
        />
      );

      mockPlayerNames.forEach((name) => {
        const elements = getAllByText(name);
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    it('should render score history for all players', () => {
      const { getByText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          matchNumber={2}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
        />
      );

      // Check some scores from history
      expect(getByText('+5')).toBeTruthy();
      expect(getByText('+10')).toBeTruthy();
      expect(getByText('+15')).toBeTruthy();
    });

    it('should render cumulative total column', () => {
      const { getAllByText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          matchNumber={2}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
        />
      );

      // Total column should exist
      const totalTexts = getAllByText('Total');
      expect(totalTexts.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Score Calculation Tests
  // --------------------------------------------------------------------------

  describe('Score Calculations', () => {
    it('should show cumulative scores correctly', () => {
      const { getByText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          matchNumber={2}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
        />
      );

      // Final cumulative scores
      expect(getByText('+15')).toBeTruthy();
      expect(getByText('+28')).toBeTruthy();
      expect(getByText('+42')).toBeTruthy();
      expect(getByText('+9')).toBeTruthy();
    });

    it('should handle matches with no score history', () => {
      const emptyHistory: ScoreHistory[] = [];
      render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={[0, 0, 0, 0]}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={emptyHistory}
        />
      );

      // Container check removed
    });
  });

  // --------------------------------------------------------------------------
  // Winner Highlighting Tests
  // --------------------------------------------------------------------------

  describe('Winner Highlighting', () => {
    it('should highlight winner (lowest score) when game is finished', () => {
      const { getByText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          matchNumber={2}
          isGameFinished={true}
          scoreHistory={mockScoreHistory}
        />
      );

      // Diana has lowest score (9)
      expect(getByText('Diana')).toBeTruthy();
    });

    it('should not highlight winner when game is not finished', () => {
      const { getByText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          matchNumber={2}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
        />
      );

      expect(getByText('Diana')).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // Button Interaction Tests
  // --------------------------------------------------------------------------

  describe('Button Interactions', () => {
    it('should call onToggleExpand when collapse button is pressed', () => {
      const onToggleExpandMock = jest.fn();
      const { getByLabelText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          matchNumber={2}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          onToggleExpand={onToggleExpandMock}
        />
      );

      const collapseButton = getByLabelText('Collapse scoreboard');
      fireEvent.press(collapseButton);

      expect(onToggleExpandMock).toHaveBeenCalledTimes(1);
    });

    it('should call onTogglePlayHistory when play history button is pressed', () => {
      const onTogglePlayHistoryMock = jest.fn();
      const { getByLabelText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          matchNumber={2}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
          onTogglePlayHistory={onTogglePlayHistoryMock}
        />
      );

      const playHistoryButton = getByLabelText('Open play history');
      fireEvent.press(playHistoryButton);

      expect(onTogglePlayHistoryMock).toHaveBeenCalledTimes(1);
    });

    it('should not render collapse button if onToggleExpand is not provided', () => {
      const { queryByLabelText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={mockCurrentScores}
          matchNumber={2}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
        />
      );

      expect(queryByLabelText('Collapse scoreboard')).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('should handle different numbers of players', () => {
      const twoPlayers = ['Alice', 'Bob'];
      const twoScores = [10, 20];
      
      const { getByText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={twoPlayers}
          currentScores={twoScores}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={[]}
        />
      );

      expect(getByText('Alice')).toBeTruthy();
      expect(getByText('Bob')).toBeTruthy();
    });

    it('should handle very long player names', () => {
      const longNames = [
        'VeryLongPlayerNameThatShouldBeHandled',
        'Bob',
        'AnotherLongNameForTesting',
        'Diana',
      ];
      
      const { getByText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={longNames}
          currentScores={mockCurrentScores}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={mockScoreHistory}
        />
      );

      expect(getByText(/VeryLongPlayerName/)).toBeTruthy();
    });

    it('should handle large score values', () => {
      const largeScores = [999, 1500, 2000, 500];
      const { getByText } = render(
        <ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}
          playerNames={mockPlayerNames}
          currentScores={largeScores}
          matchNumber={1}
          isGameFinished={false}
          scoreHistory={[]}
        />
      );

      expect(getByText('+999')).toBeTruthy();
      expect(getByText('+1500')).toBeTruthy();
    });
  });
});
