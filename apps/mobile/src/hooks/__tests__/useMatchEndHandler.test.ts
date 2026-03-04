/**
 * Tests for useMatchEndHandler
 *
 * Covers the critical paths flagged in the Copilot review:
 *  1. Modal is not opened for non-terminal game phases.
 *  2. Modal opens for 'game_over' (current EF phase).
 *  3. Modal opens for 'finished' (legacy alias).
 *  4. hasOpenedModalRef guard — modal opened at most once per game instance.
 *  5. Guard resets when multiplayerGameState becomes null (new game / room).
 *  6. Score history synthesis — 1-match game (scores_history is empty).
 *  7. Score history synthesis — N-match game with missing final entry.
 *  8. Final standings fallback chain: final_scores → dbScoreHistory → scoreHistory → zeros.
 *  9. Play history derived from DB play_history, not stale React state.
 */

jest.mock('../../utils/logger', () => ({
  gameLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { renderHook } from '@testing-library/react-native';
import { useMatchEndHandler } from '../useMatchEndHandler';

// ─── Helpers ────────────────────────────────────────────────────────────────

const makePlayers = (names: string[]) =>
  names.map((username, i) => ({ player_index: i, username }));

const makeGameState = (overrides: Record<string, unknown> = {}) => ({
  game_phase: 'game_over',
  winner: null,
  game_winner_index: 0,
  final_scores: { '0': 0, '1': 111, '2': 108, '3': 117 },
  match_number: 1,
  scores_history: [],
  play_history: [],
  ...overrides,
} as any);

const PLAYERS = makePlayers(['Steve', 'Craig', 'Mark', 'Lorraine']);

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('useMatchEndHandler', () => {
  let openGameEndModal: jest.Mock;

  beforeEach(() => {
    openGameEndModal = jest.fn();
    jest.clearAllMocks();
  });

  // 1 ─────────────────────────────────────────────────────────────────────────
  it('does not open the modal for a non-terminal game phase', () => {
    renderHook(() =>
      useMatchEndHandler({
        isMultiplayerGame: true,
        multiplayerGameState: makeGameState({ game_phase: 'playing' }),
        multiplayerPlayers: PLAYERS,
        scoreHistory: [],
        playHistoryByMatch: [],
        openGameEndModal,
      }),
    );
    expect(openGameEndModal).not.toHaveBeenCalled();
  });

  // 2 ─────────────────────────────────────────────────────────────────────────
  it('opens the modal when game_phase is "game_over"', () => {
    renderHook(() =>
      useMatchEndHandler({
        isMultiplayerGame: true,
        multiplayerGameState: makeGameState({ game_phase: 'game_over' }),
        multiplayerPlayers: PLAYERS,
        scoreHistory: [],
        playHistoryByMatch: [],
        openGameEndModal,
      }),
    );
    expect(openGameEndModal).toHaveBeenCalledTimes(1);
    const [winnerName] = openGameEndModal.mock.calls[0];
    expect(winnerName).toBe('Steve');
  });

  // 3 ─────────────────────────────────────────────────────────────────────────
  it('opens the modal when game_phase is the legacy "finished" alias', () => {
    renderHook(() =>
      useMatchEndHandler({
        isMultiplayerGame: true,
        multiplayerGameState: makeGameState({ game_phase: 'finished' }),
        multiplayerPlayers: PLAYERS,
        scoreHistory: [],
        playHistoryByMatch: [],
        openGameEndModal,
      }),
    );
    expect(openGameEndModal).toHaveBeenCalledTimes(1);
  });

  // 4 ─────────────────────────────────────────────────────────────────────────
  it('does not open the modal twice for the same game instance', () => {
    const gs = makeGameState();
    const { rerender } = renderHook(() =>
      useMatchEndHandler({
        isMultiplayerGame: true,
        multiplayerGameState: gs,
        multiplayerPlayers: PLAYERS,
        scoreHistory: [],
        playHistoryByMatch: [],
        openGameEndModal,
      }),
    );
    rerender({});
    rerender({});
    expect(openGameEndModal).toHaveBeenCalledTimes(1);
  });

  // 5 ─────────────────────────────────────────────────────────────────────────
  it('resets the once-per-game guard when multiplayerGameState becomes null', () => {
    const gs = makeGameState();
    const { rerender } = renderHook(
      ({ state }: { state: ReturnType<typeof makeGameState> | null }) =>
        useMatchEndHandler({
          isMultiplayerGame: true,
          multiplayerGameState: state,
          multiplayerPlayers: PLAYERS,
          scoreHistory: [],
          playHistoryByMatch: [],
          openGameEndModal,
        }),
      { initialProps: { state: gs } },
    );
    expect(openGameEndModal).toHaveBeenCalledTimes(1);

    // Simulate room reset (new game)
    rerender({ state: null });
    // New game starts with same terminal phase
    rerender({ state: gs });
    expect(openGameEndModal).toHaveBeenCalledTimes(2);
  });

  // 6 ─────────────────────────────────────────────────────────────────────────
  it('synthesises a score history entry for a 1-match game (empty scores_history)', () => {
    const gs = makeGameState({
      match_number: 1,
      scores_history: [], // empty — 1-match game pattern
      final_scores: { '0': 0, '1': 111 },
    });
    const players = makePlayers(['P0', 'P1']);

    renderHook(() =>
      useMatchEndHandler({
        isMultiplayerGame: true,
        multiplayerGameState: gs,
        multiplayerPlayers: players,
        scoreHistory: [],
        playHistoryByMatch: [],
        openGameEndModal,
      }),
    );

    const [, , , , scoreHistory] = openGameEndModal.mock.calls[0];
    expect(scoreHistory).toHaveLength(1);
    expect(scoreHistory[0].matchNumber).toBe(1);
    expect(scoreHistory[0].scores).toEqual([0, 111]);
    expect(scoreHistory[0].pointsAdded).toEqual([0, 111]);
  });

  // 7 ─────────────────────────────────────────────────────────────────────────
  it('synthesises the missing final entry for a multi-match game', () => {
    const gs = makeGameState({
      match_number: 3,
      scores_history: [
        { match_number: 1, scores: [{ player_index: 0, matchScore: 10, cumulativeScore: 10 }, { player_index: 1, matchScore: 20, cumulativeScore: 20 }] },
        { match_number: 2, scores: [{ player_index: 0, matchScore: 5, cumulativeScore: 15 }, { player_index: 1, matchScore: 30, cumulativeScore: 50 }] },
      ],
      final_scores: { '0': 20, '1': 80 }, // match 3 adds 5 and 30
    });
    const players = makePlayers(['P0', 'P1']);

    renderHook(() =>
      useMatchEndHandler({
        isMultiplayerGame: true,
        multiplayerGameState: gs,
        multiplayerPlayers: players,
        scoreHistory: [],
        playHistoryByMatch: [],
        openGameEndModal,
      }),
    );

    const [, , , , scoreHistory] = openGameEndModal.mock.calls[0];
    expect(scoreHistory).toHaveLength(3);
    const lastEntry = scoreHistory[2];
    expect(lastEntry.matchNumber).toBe(3);
    expect(lastEntry.scores).toEqual([20, 80]);
    expect(lastEntry.pointsAdded).toEqual([5, 30]);
  });

  // 8 ─────────────────────────────────────────────────────────────────────────
  it('falls back to React scoreHistory for final standings when final_scores is absent', () => {
    const gs = makeGameState({
      final_scores: null, // not yet persisted
      scores_history: [],
    });
    const reactScoreHistory = [
      { matchNumber: 1, pointsAdded: [0, 50], scores: [0, 50], timestamp: '' },
    ];

    renderHook(() =>
      useMatchEndHandler({
        isMultiplayerGame: true,
        multiplayerGameState: gs,
        multiplayerPlayers: makePlayers(['A', 'B']),
        scoreHistory: reactScoreHistory,
        playHistoryByMatch: [],
        openGameEndModal,
      }),
    );

    const [, , finalScores] = openGameEndModal.mock.calls[0];
    // Should use last ReactScoreHistory cumulative scores (0 and 50)
    const p0 = finalScores.find((s: { player_index: number }) => s.player_index === 0);
    const p1 = finalScores.find((s: { player_index: number }) => s.player_index === 1);
    expect(p0?.cumulative_score).toBe(0);
    expect(p1?.cumulative_score).toBe(50);
  });

  // 9 ─────────────────────────────────────────────────────────────────────────
  it('prefers DB play_history over stale React playHistoryByMatch', () => {
    const dbPlay = {
      position: 0,
      cards: ['3H', '3D'],
      combo_type: 'pair',
      passed: false,
      match_number: 1,
    };
    const gs = makeGameState({ play_history: [dbPlay] });
    const staleReactHistory = []; // stale — missing the last hand

    renderHook(() =>
      useMatchEndHandler({
        isMultiplayerGame: true,
        multiplayerGameState: gs,
        multiplayerPlayers: PLAYERS,
        scoreHistory: [],
        playHistoryByMatch: staleReactHistory,
        openGameEndModal,
      }),
    );

    const [, , , , , playHistory] = openGameEndModal.mock.calls[0];
    expect(playHistory).toHaveLength(1);
    expect(playHistory[0].hands).toHaveLength(1);
    expect(playHistory[0].hands[0].cards).toEqual(['3H', '3D']);
  });
});
