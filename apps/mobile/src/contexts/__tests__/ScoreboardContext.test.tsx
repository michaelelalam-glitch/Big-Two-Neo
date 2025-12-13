/**
 * ScoreboardContext Unit Tests
 * 
 * Tests for ScoreboardContext provider:
 * - State management
 * - State updates
 * - History tracking (score history & play history)
 * - Match collapse state
 * - Context hooks
 * 
 * Task #358: ScoreboardContext unit tests
 * Target: 80%+ coverage
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { ScoreboardProvider, useScoreboard } from '../ScoreboardContext';
import { ScoreHistory, PlayHistoryMatch, Card } from '../../types/scoreboard';

// ============================================================================
// MOCK DATA
// ============================================================================

const mockCard = (rank: Card['rank'], suit: Card['suit']): Card => ({
  id: `${rank}${suit}`,
  rank,
  suit,
});

const mockScoreHistory: ScoreHistory = {
  matchNumber: 1,
  pointsAdded: [10, 20, 30, 5],
  scores: [10, 20, 30, 5],
  timestamp: '2025-12-13T10:00:00Z',
};

const mockPlayHistory: PlayHistoryMatch = {
  matchNumber: 1,
  hands: [
    {
      by: 0,
      type: 'single',
      count: 1,
      cards: [mockCard('3', 'D')],
    },
    {
      by: 1,
      type: 'pair',
      count: 2,
      cards: [mockCard('5', 'H'), mockCard('5', 'C')],
    },
  ],
  winner: 1,
  startTime: '2025-12-13T10:00:00Z',
  endTime: '2025-12-13T10:15:00Z',
};

// ============================================================================
// HELPER FUNCTION
// ============================================================================

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ScoreboardProvider>{children}</ScoreboardProvider>
);

const wrapperWithInitialState = ({
  initialExpanded = false,
  initialPlayHistoryOpen = false,
}: {
  initialExpanded?: boolean;
  initialPlayHistoryOpen?: boolean;
}) => {
  return ({ children }: { children: React.ReactNode }) => (
    <ScoreboardProvider
      initialExpanded={initialExpanded}
      initialPlayHistoryOpen={initialPlayHistoryOpen}
    >
      {children}
    </ScoreboardProvider>
  );
};

// ============================================================================
// TESTS
// ============================================================================

describe('ScoreboardContext', () => {
  // --------------------------------------------------------------------------
  // Provider Tests
  // --------------------------------------------------------------------------

  describe('Provider', () => {
    it('should provide default values', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      expect(result.current.isScoreboardExpanded).toBe(false);
      expect(result.current.isPlayHistoryOpen).toBe(false);
      expect(result.current.scoreHistory).toEqual([]);
      expect(result.current.playHistoryByMatch).toEqual([]);
      expect(result.current.collapsedMatches.size).toBe(0);
    });

    it('should accept custom initial expanded state', () => {
      const { result } = renderHook(
        () => useScoreboard(),
        { wrapper: wrapperWithInitialState({ initialExpanded: true }) }
      );

      expect(result.current.isScoreboardExpanded).toBe(true);
    });

    it('should accept custom initial play history open state', () => {
      const { result } = renderHook(
        () => useScoreboard(),
        { wrapper: wrapperWithInitialState({ initialPlayHistoryOpen: true }) }
      );

      expect(result.current.isPlayHistoryOpen).toBe(true);
    });

    it('should throw error when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => {
        renderHook(() => useScoreboard());
      }).toThrow('useScoreboard must be used within a ScoreboardProvider');

      consoleSpy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // Scoreboard Expand/Collapse Tests
  // --------------------------------------------------------------------------

  describe('Scoreboard Expand/Collapse', () => {
    it('should toggle scoreboard expanded state', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      expect(result.current.isScoreboardExpanded).toBe(false);

      act(() => {
        result.current.setIsScoreboardExpanded(true);
      });

      expect(result.current.isScoreboardExpanded).toBe(true);

      act(() => {
        result.current.setIsScoreboardExpanded(false);
      });

      expect(result.current.isScoreboardExpanded).toBe(false);
    });

    it('should handle multiple rapid toggles', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      act(() => {
        result.current.setIsScoreboardExpanded(true);
        result.current.setIsScoreboardExpanded(false);
        result.current.setIsScoreboardExpanded(true);
      });

      expect(result.current.isScoreboardExpanded).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Play History Modal Tests
  // --------------------------------------------------------------------------

  describe('Play History Modal', () => {
    it('should toggle play history open state', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      expect(result.current.isPlayHistoryOpen).toBe(false);

      act(() => {
        result.current.setIsPlayHistoryOpen(true);
      });

      expect(result.current.isPlayHistoryOpen).toBe(true);

      act(() => {
        result.current.setIsPlayHistoryOpen(false);
      });

      expect(result.current.isPlayHistoryOpen).toBe(false);
    });

    it('should handle simultaneous state changes', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      act(() => {
        result.current.setIsScoreboardExpanded(true);
        result.current.setIsPlayHistoryOpen(true);
      });

      expect(result.current.isScoreboardExpanded).toBe(true);
      expect(result.current.isPlayHistoryOpen).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Match Collapse Tests
  // --------------------------------------------------------------------------

  describe('Match Collapse State', () => {
    it('should toggle match collapse state', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      expect(result.current.collapsedMatches.has(1)).toBe(false);

      act(() => {
        result.current.toggleMatchCollapse(1);
      });

      expect(result.current.collapsedMatches.has(1)).toBe(true);

      act(() => {
        result.current.toggleMatchCollapse(1);
      });

      expect(result.current.collapsedMatches.has(1)).toBe(false);
    });

    it('should handle multiple matches collapse state independently', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      act(() => {
        result.current.toggleMatchCollapse(1);
        result.current.toggleMatchCollapse(2);
        result.current.toggleMatchCollapse(3);
      });

      expect(result.current.collapsedMatches.has(1)).toBe(true);
      expect(result.current.collapsedMatches.has(2)).toBe(true);
      expect(result.current.collapsedMatches.has(3)).toBe(true);

      act(() => {
        result.current.toggleMatchCollapse(2);
      });

      expect(result.current.collapsedMatches.has(1)).toBe(true);
      expect(result.current.collapsedMatches.has(2)).toBe(false);
      expect(result.current.collapsedMatches.has(3)).toBe(true);
    });

    it('should persist collapse state across multiple toggles', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      act(() => {
        result.current.toggleMatchCollapse(1);
        result.current.toggleMatchCollapse(1);
        result.current.toggleMatchCollapse(1);
      });

      expect(result.current.collapsedMatches.has(1)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Score History Tests
  // --------------------------------------------------------------------------

  describe('Score History', () => {
    it('should add new score history', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      act(() => {
        result.current.addScoreHistory(mockScoreHistory);
      });

      expect(result.current.scoreHistory).toHaveLength(1);
      expect(result.current.scoreHistory[0]).toEqual(mockScoreHistory);
    });

    it('should add multiple score histories', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      const history1: ScoreHistory = { ...mockScoreHistory, matchNumber: 1 };
      const history2: ScoreHistory = { ...mockScoreHistory, matchNumber: 2 };
      const history3: ScoreHistory = { ...mockScoreHistory, matchNumber: 3 };

      act(() => {
        result.current.addScoreHistory(history1);
        result.current.addScoreHistory(history2);
        result.current.addScoreHistory(history3);
      });

      expect(result.current.scoreHistory).toHaveLength(3);
      expect(result.current.scoreHistory[0].matchNumber).toBe(1);
      expect(result.current.scoreHistory[1].matchNumber).toBe(2);
      expect(result.current.scoreHistory[2].matchNumber).toBe(3);
    });

    it('should update existing score history for same match', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      const history1: ScoreHistory = {
        matchNumber: 1,
        pointsAdded: [10, 20, 30, 5],
        scores: [10, 20, 30, 5],
      };

      const history1Updated: ScoreHistory = {
        matchNumber: 1,
        pointsAdded: [15, 25, 35, 10],
        scores: [15, 25, 35, 10],
      };

      act(() => {
        result.current.addScoreHistory(history1);
      });

      expect(result.current.scoreHistory).toHaveLength(1);
      expect(result.current.scoreHistory[0].pointsAdded).toEqual([10, 20, 30, 5]);

      act(() => {
        result.current.addScoreHistory(history1Updated);
      });

      expect(result.current.scoreHistory).toHaveLength(1);
      expect(result.current.scoreHistory[0].pointsAdded).toEqual([15, 25, 35, 10]);
    });

    it('should preserve history order when updating', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      const history1: ScoreHistory = { ...mockScoreHistory, matchNumber: 1 };
      const history2: ScoreHistory = { ...mockScoreHistory, matchNumber: 2 };
      const history3: ScoreHistory = { ...mockScoreHistory, matchNumber: 3 };
      const history2Updated: ScoreHistory = {
        ...mockScoreHistory,
        matchNumber: 2,
        pointsAdded: [99, 99, 99, 99],
      };

      act(() => {
        result.current.addScoreHistory(history1);
        result.current.addScoreHistory(history2);
        result.current.addScoreHistory(history3);
        result.current.addScoreHistory(history2Updated);
      });

      expect(result.current.scoreHistory).toHaveLength(3);
      expect(result.current.scoreHistory[1].pointsAdded).toEqual([99, 99, 99, 99]);
    });
  });

  // --------------------------------------------------------------------------
  // Play History Tests
  // --------------------------------------------------------------------------

  describe('Play History', () => {
    it('should add new play history', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      act(() => {
        result.current.addPlayHistory(mockPlayHistory);
      });

      expect(result.current.playHistoryByMatch).toHaveLength(1);
      expect(result.current.playHistoryByMatch[0]).toEqual(mockPlayHistory);
    });

    it('should add multiple play histories', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      const play1: PlayHistoryMatch = { ...mockPlayHistory, matchNumber: 1 };
      const play2: PlayHistoryMatch = { ...mockPlayHistory, matchNumber: 2 };
      const play3: PlayHistoryMatch = { ...mockPlayHistory, matchNumber: 3 };

      act(() => {
        result.current.addPlayHistory(play1);
        result.current.addPlayHistory(play2);
        result.current.addPlayHistory(play3);
      });

      expect(result.current.playHistoryByMatch).toHaveLength(3);
      expect(result.current.playHistoryByMatch[0].matchNumber).toBe(1);
      expect(result.current.playHistoryByMatch[1].matchNumber).toBe(2);
      expect(result.current.playHistoryByMatch[2].matchNumber).toBe(3);
    });

    it('should update existing play history for same match', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      const play1: PlayHistoryMatch = {
        ...mockPlayHistory,
        matchNumber: 1,
        hands: [
          {
            by: 0,
            type: 'single',
            count: 1,
            cards: [mockCard('3', 'D')],
          },
        ],
      };

      const play1Updated: PlayHistoryMatch = {
        ...mockPlayHistory,
        matchNumber: 1,
        hands: [
          {
            by: 0,
            type: 'single',
            count: 1,
            cards: [mockCard('3', 'D')],
          },
          {
            by: 1,
            type: 'pair',
            count: 2,
            cards: [mockCard('5', 'H'), mockCard('5', 'C')],
          },
        ],
      };

      act(() => {
        result.current.addPlayHistory(play1);
      });

      expect(result.current.playHistoryByMatch[0].hands).toHaveLength(1);

      act(() => {
        result.current.addPlayHistory(play1Updated);
      });

      expect(result.current.playHistoryByMatch).toHaveLength(1);
      expect(result.current.playHistoryByMatch[0].hands).toHaveLength(2);
    });

    it('should track hands for multiple matches correctly', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      const match1: PlayHistoryMatch = {
        matchNumber: 1,
        hands: [{ by: 0, type: 'single', count: 1, cards: [mockCard('3', 'D')] }],
      };

      const match2: PlayHistoryMatch = {
        matchNumber: 2,
        hands: [
          { by: 1, type: 'pair', count: 2, cards: [mockCard('5', 'H'), mockCard('5', 'C')] },
          { by: 2, type: 'triple', count: 3, cards: [mockCard('7', 'S'), mockCard('7', 'H'), mockCard('7', 'D')] },
        ],
      };

      act(() => {
        result.current.addPlayHistory(match1);
        result.current.addPlayHistory(match2);
      });

      expect(result.current.playHistoryByMatch[0].hands).toHaveLength(1);
      expect(result.current.playHistoryByMatch[1].hands).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // Clear History Tests
  // --------------------------------------------------------------------------

  describe('Clear History', () => {
    it('should clear all history data', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      act(() => {
        result.current.addScoreHistory(mockScoreHistory);
        result.current.addPlayHistory(mockPlayHistory);
        result.current.setIsScoreboardExpanded(true);
        result.current.setIsPlayHistoryOpen(true);
        result.current.toggleMatchCollapse(1);
      });

      expect(result.current.scoreHistory).toHaveLength(1);
      expect(result.current.playHistoryByMatch).toHaveLength(1);
      expect(result.current.isScoreboardExpanded).toBe(true);
      expect(result.current.isPlayHistoryOpen).toBe(true);
      expect(result.current.collapsedMatches.size).toBe(1);

      act(() => {
        result.current.clearHistory();
      });

      expect(result.current.scoreHistory).toHaveLength(0);
      expect(result.current.playHistoryByMatch).toHaveLength(0);
      expect(result.current.isScoreboardExpanded).toBe(false);
      expect(result.current.isPlayHistoryOpen).toBe(false);
      expect(result.current.collapsedMatches.size).toBe(0);
    });

    it('should allow adding history after clearing', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      act(() => {
        result.current.addScoreHistory(mockScoreHistory);
        result.current.clearHistory();
        result.current.addScoreHistory(mockScoreHistory);
      });

      expect(result.current.scoreHistory).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // Integration Tests
  // --------------------------------------------------------------------------

  describe('Integration', () => {
    it('should handle complex state changes in sequence', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      act(() => {
        // Expand scoreboard
        result.current.setIsScoreboardExpanded(true);
        
        // Add some history
        result.current.addScoreHistory({ ...mockScoreHistory, matchNumber: 1 });
        result.current.addPlayHistory({ ...mockPlayHistory, matchNumber: 1 });
        
        // Collapse match 1
        result.current.toggleMatchCollapse(1);
        
        // Open play history
        result.current.setIsPlayHistoryOpen(true);
        
        // Add more history
        result.current.addScoreHistory({ ...mockScoreHistory, matchNumber: 2 });
        result.current.addPlayHistory({ ...mockPlayHistory, matchNumber: 2 });
      });

      expect(result.current.isScoreboardExpanded).toBe(true);
      expect(result.current.isPlayHistoryOpen).toBe(true);
      expect(result.current.scoreHistory).toHaveLength(2);
      expect(result.current.playHistoryByMatch).toHaveLength(2);
      expect(result.current.collapsedMatches.has(1)).toBe(true);
    });

    it('should maintain state consistency across updates', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      const updates = 100;
      
      act(() => {
        for (let i = 1; i <= updates; i++) {
          result.current.addScoreHistory({ ...mockScoreHistory, matchNumber: i });
        }
      });

      expect(result.current.scoreHistory).toHaveLength(updates);
      expect(result.current.scoreHistory[0].matchNumber).toBe(1);
      expect(result.current.scoreHistory[updates - 1].matchNumber).toBe(updates);
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('should handle undefined optional fields in score history', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      const minimalHistory: ScoreHistory = {
        matchNumber: 1,
        pointsAdded: [10, 20, 30, 5],
        scores: [10, 20, 30, 5],
      };

      act(() => {
        result.current.addScoreHistory(minimalHistory);
      });

      expect(result.current.scoreHistory[0].timestamp).toBeUndefined();
    });

    it('should handle undefined optional fields in play history', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      const minimalPlayHistory: PlayHistoryMatch = {
        matchNumber: 1,
        hands: [],
      };

      act(() => {
        result.current.addPlayHistory(minimalPlayHistory);
      });

      expect(result.current.playHistoryByMatch[0].winner).toBeUndefined();
      expect(result.current.playHistoryByMatch[0].startTime).toBeUndefined();
      expect(result.current.playHistoryByMatch[0].endTime).toBeUndefined();
    });

    it('should handle rapid state changes', () => {
      const { result } = renderHook(() => useScoreboard(), { wrapper });

      act(() => {
        for (let i = 0; i < 50; i++) {
          result.current.setIsScoreboardExpanded(i % 2 === 0);
          result.current.setIsPlayHistoryOpen(i % 2 === 1);
        }
      });

      expect(result.current.isScoreboardExpanded).toBe(false);
      expect(result.current.isPlayHistoryOpen).toBe(true);
    });
  });
});
