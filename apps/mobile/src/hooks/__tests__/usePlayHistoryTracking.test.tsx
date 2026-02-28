/**
 * Unit tests for usePlayHistoryTracking hook
 * 
 * Tests:
 * - Converting RoundHistoryEntry to PlayHistoryHand
 * - Converting GameState.roundHistory to PlayHistoryMatch
 * - Automatic updates to ScoreboardContext
 * - Handling of new plays and new matches
 * 
 * Created as part of Task #355: Play history tracking
 * Date: December 12, 2025
 */

import { renderHook, act } from '@testing-library/react-native';
import React from 'react';
import { usePlayHistoryTracking } from '../usePlayHistoryTracking';
import { ScoreboardProvider, useScoreboard } from '../../contexts/ScoreboardContext';
import type { GameState, RoundHistoryEntry } from '../../game/state';
import type { Card } from '../../types/multiplayer';

// Mock data
const mockPlayers = [
  { id: 'p1', name: 'Player 1', hand: [], isBot: false, passed: false },
  { id: 'p2', name: 'Player 2', hand: [], isBot: true, passed: false, botDifficulty: 'medium' as const },
  { id: 'p3', name: 'Player 3', hand: [], isBot: true, passed: false, botDifficulty: 'medium' as const },
  { id: 'p4', name: 'Player 4', hand: [], isBot: true, passed: false, botDifficulty: 'medium' as const },
];

const mockCard1: Card = { id: '3D', suit: 'D', rank: '3' };
const mockCard2: Card = { id: '4D', suit: 'D', rank: '4' };
const mockCard3: Card = { id: '5D', suit: 'D', rank: '5' };

const mockRoundHistory: RoundHistoryEntry[] = [
  {
    playerId: 'p1',
    playerName: 'Player 1',
    cards: [mockCard1],
    combo_type: 'Single',
    timestamp: Date.now(),
    passed: false,
  },
  {
    playerId: 'p2',
    playerName: 'Player 2',
    cards: [],
    combo_type: 'unknown',
    timestamp: Date.now(),
    passed: true, // Pass - should be filtered out
  },
  {
    playerId: 'p3',
    playerName: 'Player 3',
    cards: [mockCard2, mockCard3],
    combo_type: 'Pair',
    timestamp: Date.now(),
    passed: false,
  },
];

const createMockGameState = (overrides?: Partial<GameState>): GameState => ({
  players: mockPlayers,
  currentPlayerIndex: 0,
  lastPlay: null,
  lastPlayPlayerIndex: 0,
  consecutivePasses: 0,
  isFirstPlayOfGame: true,
  gameStarted: true,
  gameEnded: false,
  winnerId: null,
  roundHistory: mockRoundHistory,
  gameRoundHistory: mockRoundHistory, // ADDED: Game-wide history (required field)
  currentMatch: 1,
  matchScores: [],
  lastMatchWinnerId: null,
  gameOver: false,
  finalWinnerId: null,
  startedAt: Date.now(),
  auto_pass_timer: null,
  played_cards: [],
  ...overrides,
});

// Wrapper component for testing
const wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <ScoreboardProvider>{children}</ScoreboardProvider>
);

// Helper hook that combines tracking with reading context state
function usePlayHistoryTrackingWithState(gameState: GameState | null, enabled?: boolean) {
  usePlayHistoryTracking(gameState, enabled);
  const { playHistoryByMatch } = useScoreboard();
  return { playHistoryByMatch };
}

describe('usePlayHistoryTracking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should initialize without errors', () => {
    const { result } = renderHook(
      () => usePlayHistoryTracking(null),
      { wrapper }
    );

    expect(result.current).toBeUndefined();
  });

  test('should not process when gameState is null', () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    renderHook(
      () => usePlayHistoryTracking(null),
      { wrapper }
    );

    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[PlayHistory] Updated')
    );

    consoleLogSpy.mockRestore();
  });

  test('should not process when game not started', () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    const gameState = createMockGameState({ gameStarted: false });

    renderHook(
      () => usePlayHistoryTracking(gameState),
      { wrapper }
    );

    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[PlayHistory] Updated')
    );

    consoleLogSpy.mockRestore();
  });

  test('should convert roundHistory to PlayHistoryMatch', () => {
    const gameState = createMockGameState();

    const { result } = renderHook(
      () => usePlayHistoryTrackingWithState(gameState),
      { wrapper }
    );

    // Should have added match 1 with 2 hands (pass entry filtered)
    const match1 = result.current.playHistoryByMatch.find((m: any) => m.matchNumber === 1);
    expect(match1).toBeDefined();
    expect(match1!.hands.length).toBe(2);
  });

  test('should filter out passed entries (no cards played)', () => {
    const gameState = createMockGameState();

    const { result } = renderHook(
      () => usePlayHistoryTrackingWithState(gameState),
      { wrapper }
    );

    // Should log 2 hands (1 single + 1 pair), not 3 (pass entry filtered out)
    const match1 = result.current.playHistoryByMatch.find((m: any) => m.matchNumber === 1);
    expect(match1).toBeDefined();
    expect(match1!.hands.length).toBe(2);
  });

  test('should update when new plays are added', () => {
    const gameState = createMockGameState();

    const { result, rerender } = renderHook(
      ({ state }: { state: GameState }) => usePlayHistoryTrackingWithState(state),
      { 
        wrapper,
        initialProps: { state: gameState }
      }
    );

    // Initial: 2 hands
    expect(result.current.playHistoryByMatch.find((m: any) => m.matchNumber === 1)?.hands.length).toBe(2);

    // Add new play
    const newHistory: RoundHistoryEntry = {
      playerId: 'p4',
      playerName: 'Player 4',
      cards: [{ id: '6D', suit: 'D', rank: '6' }],
      combo_type: 'Single',
      timestamp: Date.now(),
      passed: false,
    };

    const updatedGameState = createMockGameState({
      roundHistory: [...mockRoundHistory, newHistory],
    });

    act(() => {
      rerender({ state: updatedGameState });
    });

    // Should now have 3 hands
    expect(result.current.playHistoryByMatch.find((m: any) => m.matchNumber === 1)?.hands.length).toBe(3);
  });

  test('should update when match number changes', () => {
    const gameState = createMockGameState({ currentMatch: 1 });

    const { result, rerender } = renderHook(
      ({ state }: { state: GameState }) => usePlayHistoryTrackingWithState(state),
      { 
        wrapper,
        initialProps: { state: gameState }
      }
    );

    // Change to match 2 with new history
    const newHistory: RoundHistoryEntry[] = [
      {
        playerId: 'p2',
        playerName: 'Player 2',
        cards: [mockCard1],
        combo_type: 'Single',
        timestamp: Date.now(),
        passed: false,
      },
    ];

    const updatedGameState = createMockGameState({
      currentMatch: 2,
      roundHistory: newHistory,
    });

    act(() => {
      rerender({ state: updatedGameState });
    });

    // Should have match 2 with 1 hand
    const match2 = result.current.playHistoryByMatch.find((m: any) => m.matchNumber === 2);
    expect(match2).toBeDefined();
    expect(match2!.hands.length).toBe(1);
  });

  test('should handle match end (winnerId set)', () => {
    const gameState = createMockGameState({
      gameEnded: true,
      winnerId: 'p1',
    });

    const { result } = renderHook(
      () => usePlayHistoryTrackingWithState(gameState),
      { wrapper }
    );

    // Should still update and include winner info
    const match1 = result.current.playHistoryByMatch.find((m: any) => m.matchNumber === 1);
    expect(match1).toBeDefined();
    expect(match1!.hands.length).toBe(2);
    expect(match1!.winner).toBe(0); // p1 = index 0
  });

  test('should respect enabled flag', () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    const gameState = createMockGameState();

    renderHook(
      () => usePlayHistoryTracking(gameState, false), // disabled
      { wrapper }
    );

    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[PlayHistory] Updated')
    );

    consoleLogSpy.mockRestore();
  });

  test('should handle unknown player IDs gracefully', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    const badHistory: RoundHistoryEntry[] = [
      {
        playerId: 'unknown_player', // Invalid player ID
        playerName: 'Unknown',
        cards: [mockCard1],
        combo_type: 'Single',
        timestamp: Date.now(),
        passed: false,
      },
    ];

    const gameState = createMockGameState({
      roundHistory: badHistory,
    });

    renderHook(
      () => usePlayHistoryTracking(gameState),
      { wrapper }
    );

    // Should log warning about unknown player
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PlayHistory] Unknown player ID')
    );

    consoleWarnSpy.mockRestore();
  });

  test('should not update if same match and history length', () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    const gameState = createMockGameState();

    const { rerender } = renderHook<void, { state: GameState }>(
      ({ state }: { state: GameState }) => usePlayHistoryTracking(state),
      { 
        wrapper,
        initialProps: { state: gameState }
      }
    );

    // Clear logs
    consoleLogSpy.mockClear();

    // Rerender with same state
    act(() => {
      rerender({ state: gameState });
    });

    // Should NOT log another update (no changes)
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[PlayHistory] Updated')
    );

    consoleLogSpy.mockRestore();
  });
});
