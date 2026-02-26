/**
 * usePlayerTotalScores Hook Tests
 *
 * Task #590: Validates per-player cumulative score calculation.
 * Covers player_index alignment, fallback behavior, and edge cases.
 */

import { renderHook } from '@testing-library/react-native';
import { usePlayerTotalScores } from '../usePlayerTotalScores';
import { ScoreHistory } from '../../types/scoreboard';

describe('usePlayerTotalScores', () => {
  const makeScoreHistory = (
    matchNumber: number,
    pointsAdded: number[],
    scores: number[],
  ): ScoreHistory => ({
    matchNumber,
    pointsAdded,
    scores,
  });

  it('returns zeros when scoreHistory is empty and players have no score field', () => {
    // Omit `score` property entirely so the test genuinely validates the zero-default
    // path rather than accidentally passing via a score fallback of 0.
    const players = [
      { player_index: 0 },
      { player_index: 1 },
      { player_index: 2 },
      { player_index: 3 },
    ];
    const { result } = renderHook(() => usePlayerTotalScores(players, []));
    expect(result.current).toEqual([0, 0, 0, 0]);
  });

  it('falls back to p.score when scoreHistory is empty', () => {
    const players = [
      { player_index: 0, score: 5 },
      { player_index: 1, score: -3 },
      { player_index: 2, score: 10 },
      { player_index: 3, score: 0 },
    ];
    const { result } = renderHook(() => usePlayerTotalScores(players, []));
    expect(result.current).toEqual([5, -3, 10, 0]);
  });

  it('sums scores across multiple matches using player_index', () => {
    const players = [
      { player_index: 0 },
      { player_index: 1 },
      { player_index: 2 },
      { player_index: 3 },
    ];
    const history = [
      makeScoreHistory(1, [3, -1, -1, -1], [3, -1, -1, -1]),
      makeScoreHistory(2, [-2, 6, -2, -2], [1, 5, -3, -3]),
    ];
    const { result } = renderHook(() => usePlayerTotalScores(players, history));
    expect(result.current).toEqual([1, 5, -3, -3]);
  });

  it('handles out-of-order layoutPlayers using player_index', () => {
    // Layout order differs from game index: [p2, p0, p3, p1]
    const players = [
      { player_index: 2 },
      { player_index: 0 },
      { player_index: 3 },
      { player_index: 1 },
    ];
    const history = [
      makeScoreHistory(1, [10, 20, 30, 40], [10, 20, 30, 40]),
    ];
    const { result } = renderHook(() => usePlayerTotalScores(players, history));
    // Each player should get their own column: p2→30, p0→10, p3→40, p1→20
    expect(result.current).toEqual([30, 10, 40, 20]);
  });

  it('falls back to array index when player_index is missing (local AI)', () => {
    // Local AI players typically have no player_index
    const players = [
      { score: 0 },
      { score: 0 },
      { score: 0 },
      { score: 0 },
    ];
    const history = [
      makeScoreHistory(1, [5, -2, -2, -1], [5, -2, -2, -1]),
    ];
    const { result } = renderHook(() => usePlayerTotalScores(players, history));
    expect(result.current).toEqual([5, -2, -2, -1]);
  });

  it('supports playerIndex (camelCase) as alternative', () => {
    const players = [
      { playerIndex: 3 },
      { playerIndex: 1 },
      { playerIndex: 0 },
      { playerIndex: 2 },
    ];
    const history = [
      makeScoreHistory(1, [100, 200, 300, 400], [100, 200, 300, 400]),
    ];
    const { result } = renderHook(() => usePlayerTotalScores(players, history));
    expect(result.current).toEqual([400, 200, 100, 300]);
  });

  it('returns fallback zeros for fewer than 4 players', () => {
    const players = [{ score: 5 }, { score: 10 }];
    const history = [makeScoreHistory(1, [1, 2], [1, 2])];
    const { result } = renderHook(() => usePlayerTotalScores(players, history));
    // Fewer than 4 players → falls back to p.score (matches guard condition)
    expect(result.current).toEqual([5, 10]);
  });

  it('handles missing pointsAdded gracefully', () => {
    const players = [
      { player_index: 0 },
      { player_index: 1 },
      { player_index: 2 },
      { player_index: 3 },
    ];
    const history = [
      { matchNumber: 1, pointsAdded: [], scores: [] } as ScoreHistory,
    ];
    const { result } = renderHook(() => usePlayerTotalScores(players, history));
    expect(result.current).toEqual([0, 0, 0, 0]);
  });
});
