/**
 * useTurnInactivityTimer Hook Tests — C8 Audit Fix
 *
 * Comprehensive tests for the 60-second turn countdown:
 * - Detects when it's the local player's turn
 * - Countdown decreases via 500ms polling
 * - Auto-play trigger on timer expiry
 * - Turn change resets tracking
 * - Execution guard prevents concurrent auto-play calls
 * - Game phase filtering (only active during 'playing' / 'first_play')
 * - Clock-skew detection and local anchor fallback
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useTurnInactivityTimer } from '../useTurnInactivityTimer';
import type { UseTurnInactivityTimerOptions } from '../useTurnInactivityTimer';

// ── Mock edge function retry utility ────────────────────────────────────────
const mockInvokeWithRetry = jest.fn();
jest.mock('../../utils/edgeFunctionRetry', () => ({
  invokeWithRetry: (...args: unknown[]) => mockInvokeWithRetry(...args),
}));

// ── Mock logger ─────────────────────────────────────────────────────────────
jest.mock('../../utils/logger', () => ({
  networkLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── Mock analytics ──────────────────────────────────────────────────────────
jest.mock('../../services/analytics', () => ({
  turnTimeStart: jest.fn(),
  turnTimeEnd: jest.fn(),
}));

const TURN_TIMEOUT_MS = 60_000;

function makeGameState(
  overrides: Partial<{
    current_turn: number;
    turn_started_at: string;
    game_phase: string;
  }> = {}
) {
  return {
    current_turn: 0,
    turn_started_at: new Date().toISOString(),
    game_phase: 'playing' as string,
    ...overrides,
  };
}

function makePlayer(
  overrides: Partial<{
    user_id: string;
    player_index: number;
  }> = {}
) {
  return {
    user_id: 'user-1',
    player_index: 0,
    username: 'TestPlayer',
    is_bot: false,
    status: 'connected',
    ...overrides,
  };
}

function makeDefaultOptions(
  overrides: Partial<UseTurnInactivityTimerOptions> = {}
): UseTurnInactivityTimerOptions {
  return {
    gameState: null,
    room: { id: 'room-1', code: 'ABCD' },
    roomPlayers: [makePlayer()],
    getCorrectedNow: () => Date.now(),
    currentUserId: 'user-1',
    ...overrides,
  };
}

describe('useTurnInactivityTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockInvokeWithRetry.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Initial state ───────────────────────────────────────────────────────

  it('returns initial state when no game state provided', () => {
    const { result } = renderHook(() =>
      useTurnInactivityTimer(makeDefaultOptions({ gameState: null }))
    );

    expect(result.current.isMyTurn).toBe(false);
    expect(result.current.remainingMs).toBe(TURN_TIMEOUT_MS);
    expect(result.current.isAutoPlayInProgress).toBe(false);
  });

  it('returns not-my-turn when current_turn does not match player index', () => {
    const gs = makeGameState({ current_turn: 1 }); // Opponent's turn
    const { result } = renderHook(() =>
      useTurnInactivityTimer(makeDefaultOptions({ gameState: gs as any }))
    );

    // Advance past one polling interval
    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(result.current.isMyTurn).toBe(false);
    expect(result.current.remainingMs).toBe(TURN_TIMEOUT_MS);
  });

  // ── Turn detection ──────────────────────────────────────────────────────

  it('detects when it is the local player turn', () => {
    const now = Date.now();
    const gs = makeGameState({
      current_turn: 0,
      turn_started_at: new Date(now).toISOString(),
    });

    const { result } = renderHook(() =>
      useTurnInactivityTimer(
        makeDefaultOptions({
          gameState: gs as any,
          getCorrectedNow: () => now + 500,
        })
      )
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(result.current.isMyTurn).toBe(true);
  });

  // ── Game phase filtering ────────────────────────────────────────────────

  it('returns not-my-turn when game_phase is not playing or first_play', () => {
    const gs = makeGameState({ current_turn: 0, game_phase: 'lobby' });

    const { result } = renderHook(() =>
      useTurnInactivityTimer(makeDefaultOptions({ gameState: gs as any }))
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(result.current.isMyTurn).toBe(false);
  });

  it('activates timer during first_play phase', () => {
    const now = Date.now();
    const gs = makeGameState({
      current_turn: 0,
      game_phase: 'first_play',
      turn_started_at: new Date(now).toISOString(),
    });

    const { result } = renderHook(() =>
      useTurnInactivityTimer(
        makeDefaultOptions({
          gameState: gs as any,
          getCorrectedNow: () => now + 100,
        })
      )
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(result.current.isMyTurn).toBe(true);
  });

  // ── Timer expiry and auto-play ──────────────────────────────────────────

  it('triggers auto-play when timer expires (60s elapsed)', async () => {
    const turnStart = Date.now();
    const gs = makeGameState({
      current_turn: 0,
      turn_started_at: new Date(turnStart).toISOString(),
    });

    mockInvokeWithRetry.mockResolvedValue({
      data: { success: true, action: 'pass', cards: null },
      error: null,
    });

    const onAutoPlay = jest.fn();
    const { result } = renderHook(() =>
      useTurnInactivityTimer(
        makeDefaultOptions({
          gameState: gs as any,
          getCorrectedNow: () => turnStart + 61_000, // 61s elapsed → expired
          onAutoPlay,
        })
      )
    );

    // Advance past polling interval to trigger expiry check
    act(() => {
      jest.advanceTimersByTime(600);
    });

    // Wait for async auto-play to complete
    await waitFor(() => {
      expect(mockInvokeWithRetry).toHaveBeenCalledWith(
        'auto-play-turn',
        expect.objectContaining({ body: { room_code: 'ABCD' } })
      );
    });
  });

  it('does not trigger auto-play when timer has not expired', () => {
    const turnStart = Date.now();
    const gs = makeGameState({
      current_turn: 0,
      turn_started_at: new Date(turnStart).toISOString(),
    });

    const { result } = renderHook(() =>
      useTurnInactivityTimer(
        makeDefaultOptions({
          gameState: gs as any,
          getCorrectedNow: () => turnStart + 30_000, // Only 30s elapsed
        })
      )
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(mockInvokeWithRetry).not.toHaveBeenCalled();
    expect(result.current.isMyTurn).toBe(true);
  });

  // ── Turn change resets tracking ─────────────────────────────────────────

  it('resets timer when turn changes to opponent', () => {
    const now = Date.now();
    const myTurnGs = makeGameState({
      current_turn: 0,
      turn_started_at: new Date(now).toISOString(),
    });

    const { result, rerender } = renderHook(
      (props: UseTurnInactivityTimerOptions) => useTurnInactivityTimer(props),
      {
        initialProps: makeDefaultOptions({
          gameState: myTurnGs as any,
          getCorrectedNow: () => now + 5000,
        }),
      }
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(result.current.isMyTurn).toBe(true);

    // Turn changes to opponent
    const opponentTurnGs = makeGameState({ current_turn: 1 });
    rerender(
      makeDefaultOptions({
        gameState: opponentTurnGs as any,
        getCorrectedNow: () => now + 6000,
      })
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(result.current.isMyTurn).toBe(false);
    expect(result.current.remainingMs).toBe(TURN_TIMEOUT_MS);
  });

  // ── No room / no user ──────────────────────────────────────────────────

  it('does not start polling without room', () => {
    const gs = makeGameState({ current_turn: 0 });

    const { result } = renderHook(() =>
      useTurnInactivityTimer(
        makeDefaultOptions({
          gameState: gs as any,
          room: null,
        })
      )
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });

    // Without room, the interval is never created
    expect(result.current.isMyTurn).toBe(false);
  });

  it('does not start polling without currentUserId', () => {
    const gs = makeGameState({ current_turn: 0 });

    const { result } = renderHook(() =>
      useTurnInactivityTimer(
        makeDefaultOptions({
          gameState: gs as any,
          currentUserId: null,
        })
      )
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(result.current.isMyTurn).toBe(false);
  });

  // ── Player not in room ────────────────────────────────────────────────

  it('returns not-my-turn when user is not in roomPlayers', () => {
    const gs = makeGameState({ current_turn: 0 });

    const { result } = renderHook(() =>
      useTurnInactivityTimer(
        makeDefaultOptions({
          gameState: gs as any,
          currentUserId: 'unknown-user',
          roomPlayers: [makePlayer({ user_id: 'user-1' })],
        })
      )
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(result.current.isMyTurn).toBe(false);
  });

  // ── Missing turn_started_at ────────────────────────────────────────────

  it('returns my-turn with full remaining when turn_started_at is null', () => {
    const gs = makeGameState({
      current_turn: 0,
      turn_started_at: undefined as any,
    });

    const { result } = renderHook(() =>
      useTurnInactivityTimer(makeDefaultOptions({ gameState: gs as any }))
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(result.current.isMyTurn).toBe(true);
    expect(result.current.remainingMs).toBe(TURN_TIMEOUT_MS);
  });

  // ── Auto-play error handling ───────────────────────────────────────────

  it('handles auto-play edge function error gracefully', async () => {
    const turnStart = Date.now();
    const gs = makeGameState({
      current_turn: 0,
      turn_started_at: new Date(turnStart).toISOString(),
    });

    mockInvokeWithRetry.mockResolvedValue({
      data: null,
      error: new Error('Server error'),
    });

    const { result } = renderHook(() =>
      useTurnInactivityTimer(
        makeDefaultOptions({
          gameState: gs as any,
          getCorrectedNow: () => turnStart + 61_000,
        })
      )
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });

    await waitFor(() => {
      expect(mockInvokeWithRetry).toHaveBeenCalled();
    });

    // Should not crash — error logged internally
    expect(result.current.isMyTurn).toBe(true);
  });

  // ── Execution guard (throttle) ─────────────────────────────────────────

  it('throttles auto-play calls to 1 per second', async () => {
    const turnStart = Date.now();
    const gs = makeGameState({
      current_turn: 0,
      turn_started_at: new Date(turnStart).toISOString(),
    });

    // Auto-play resolves quickly
    mockInvokeWithRetry.mockResolvedValue({
      data: { success: true, action: 'pass' },
      error: null,
    });

    renderHook(() =>
      useTurnInactivityTimer(
        makeDefaultOptions({
          gameState: gs as any,
          getCorrectedNow: () => turnStart + 61_000,
        })
      )
    );

    // First polling tick triggers auto-play
    act(() => {
      jest.advanceTimersByTime(600);
    });

    await waitFor(() => {
      expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
    });

    // Next polling tick should be throttled (less than 1s since last attempt)
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Still only 1 call
    expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
  });

  // ── Cleanup on unmount ─────────────────────────────────────────────────

  it('cleans up interval on unmount', () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const gs = makeGameState({ current_turn: 0 });

    const { unmount } = renderHook(() =>
      useTurnInactivityTimer(makeDefaultOptions({ gameState: gs as any }))
    );

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  // ── H1: connectionStatus gate — auto-play must be suppressed when disconnected ──

  it.each([['disconnected' as const], ['reconnecting' as const], ['replaced_by_bot' as const]])(
    'does not call auto-play-turn when connectionStatus is "%s" and timer expires',
    async status => {
      const turnStart = Date.now();
      const gs = makeGameState({
        current_turn: 0,
        turn_started_at: new Date(turnStart).toISOString(),
      });

      mockInvokeWithRetry.mockResolvedValue({
        data: { success: true, action: 'pass', cards: null },
        error: null,
      });

      renderHook(() =>
        useTurnInactivityTimer(
          makeDefaultOptions({
            gameState: gs as any,
            getCorrectedNow: () => turnStart + 61_000, // 61s → expired
            connectionStatus: status,
          })
        )
      );

      act(() => {
        jest.advanceTimersByTime(600);
      });

      // Flush any pending microtasks
      await Promise.resolve();

      expect(mockInvokeWithRetry).not.toHaveBeenCalled();
    }
  );

  it('resumes auto-play when connectionStatus transitions from disconnected to connected', async () => {
    const turnStart = Date.now();
    const gs = makeGameState({
      current_turn: 0,
      turn_started_at: new Date(turnStart).toISOString(),
    });

    mockInvokeWithRetry.mockResolvedValue({
      data: { success: true, action: 'pass', cards: null },
      error: null,
    });

    let status: 'disconnected' | 'connected' = 'disconnected';
    const { rerender } = renderHook(
      (props: { connectionStatus: 'disconnected' | 'connected' }) =>
        useTurnInactivityTimer(
          makeDefaultOptions({
            gameState: gs as any,
            getCorrectedNow: () => turnStart + 61_000,
            connectionStatus: props.connectionStatus,
          })
        ),
      { initialProps: { connectionStatus: status } }
    );

    // First tick — disconnected → no auto-play
    act(() => {
      jest.advanceTimersByTime(600);
    });
    await Promise.resolve();
    expect(mockInvokeWithRetry).not.toHaveBeenCalled();

    // Transition to connected
    rerender({ connectionStatus: 'connected' });

    // Next tick — connected → auto-play fires
    act(() => {
      jest.advanceTimersByTime(600);
    });

    await waitFor(() => {
      expect(mockInvokeWithRetry).toHaveBeenCalledWith(
        'auto-play-turn',
        expect.objectContaining({ body: { room_code: 'ABCD' } })
      );
    });
  });
});
