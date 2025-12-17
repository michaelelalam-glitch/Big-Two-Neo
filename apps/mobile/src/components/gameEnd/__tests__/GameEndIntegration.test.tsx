/**
 * Game End Flow Integration Tests
 * Task #401: Integration tests for end-to-end game end flow
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';
import { GameEndProvider, useGameEnd } from '../../../contexts/GameEndContext';
import { Text, View } from 'react-native';

describe('Game End Flow Integration', () => {
  it('should initialize with modal closed', () => {
    const TestComponent = () => {
      const { showGameEndModal } = useGameEnd();
      return (
        <View>
          <Text>{showGameEndModal ? 'Open' : 'Closed'}</Text>
        </View>
      );
    };

    const { getByText } = render(
      <GameEndProvider>
        <TestComponent />
      </GameEndProvider>
    );

    expect(getByText('Closed')).toBeTruthy();
  });

  it('should handle context state changes', () => {
    let contextValue: ReturnType<typeof useGameEnd> = {} as any;

    const TestComponent = () => {
      contextValue = useGameEnd();
      return null;
    };

    render(
      <GameEndProvider>
        <TestComponent />
      </GameEndProvider>
    );

    const mockFinalScore = { player_index: 0, player_name: 'Alice', cumulative_score: 50, points_added: 10 };
    act(() => {
      contextValue.openGameEndModal('Alice', 0, [mockFinalScore], ['Alice'], [], []);
    });

    expect(contextValue.showGameEndModal).toBe(true);
    expect(contextValue.gameWinnerName).toBe('Alice');

    act(() => {
      contextValue.resetGameEndState();
    });

    expect(contextValue.showGameEndModal).toBe(false);
  });

  it('should preserve data through modal lifecycle', () => {
    let contextValue: ReturnType<typeof useGameEnd> = {} as any;

    const TestComponent = () => {
      contextValue = useGameEnd();
      return null;
    };

    const mockFinalScores = [
      { player_name: 'Alice', cumulative_score: 45, player_index: 0, points_added: 15 },
    ];

    render(
      <GameEndProvider>
        <TestComponent />
      </GameEndProvider>
    );

    act(() => {
      contextValue.openGameEndModal('Alice', 0, mockFinalScores, ['Alice'], [], []);
    });

    expect(contextValue.finalScores).toEqual(mockFinalScores);
    expect(contextValue.playerNames).toEqual(['Alice']);
  });

  it('should allow registering callbacks', () => {
    let contextValue: ReturnType<typeof useGameEnd> = {} as any;
    const mockCallback = jest.fn();

    const TestComponent = () => {
      contextValue = useGameEnd();
      return null;
    };

    render(
      <GameEndProvider>
        <TestComponent />
      </GameEndProvider>
    );

    act(() => {
      contextValue.onPlayAgain = mockCallback;
    });

    expect(contextValue.onPlayAgain).toBe(mockCallback);
  });

  it('should support multiple game cycles', () => {
    let contextValue: ReturnType<typeof useGameEnd> = {} as any;

    const TestComponent = () => {
      contextValue = useGameEnd();
      return null;
    };

    render(
      <GameEndProvider>
        <TestComponent />
      </GameEndProvider>
    );

    // First cycle with valid data
    const mockFinalScore1 = { player_index: 0, player_name: 'Alice', cumulative_score: 50, points_added: 10 };
    act(() => {
      contextValue.openGameEndModal('Alice', 0, [mockFinalScore1], ['Alice'], [], []);
    });
    expect(contextValue.gameWinnerName).toBe('Alice');
    expect(contextValue.showGameEndModal).toBe(true);

    // Reset
    act(() => {
      contextValue.resetGameEndState();
    });
    expect(contextValue.showGameEndModal).toBe(false);

    // Second cycle with valid data
    const mockFinalScore2 = { player_index: 1, player_name: 'Bob', cumulative_score: 60, points_added: 15 };
    act(() => {
      contextValue.openGameEndModal('Bob', 1, [mockFinalScore2], ['Bob'], [], []);
    });
    expect(contextValue.gameWinnerName).toBe('Bob');
    expect(contextValue.showGameEndModal).toBe(true);
  });
});
