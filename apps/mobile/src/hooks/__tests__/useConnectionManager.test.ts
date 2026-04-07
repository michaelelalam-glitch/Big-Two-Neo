/**
 * useConnectionManager Hook Tests — H15 Audit Fix
 *
 * Tests for player connection lifecycle:
 * - Initial state and heartbeat startup
 * - Heartbeat success/failure/backoff
 * - App state transitions (background/foreground)
 * - Reconnect and disconnect flows
 * - Bot replacement detection
 * - forceSweep fire-and-forget
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AppState, AppStateStatus } from 'react-native';

// ── Mock setup (before imports) ──────────────────────────────────────────────

const mockInvoke = jest.fn();
const mockChannel = jest.fn();
const mockRemoveChannel = jest.fn();

jest.mock('../../services/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

jest.mock('../../utils/logger', () => ({
  networkLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../services/analytics', () => ({
  trackConnection: jest.fn(),
  trackEvent: jest.fn(),
}));

jest.mock('../../services/sentry', () => ({
  sentryCapture: {
    breadcrumb: jest.fn(),
    message: jest.fn(),
    exception: jest.fn(),
  },
}));

jest.mock('../../utils/soundManager', () => ({
  soundManager: { cleanup: jest.fn() },
}));

import { useConnectionManager } from '../useConnectionManager';
import { trackConnection, trackEvent } from '../../services/analytics';

// ── AppState mock ────────────────────────────────────────────────────────────

type AppStateCallback = (state: AppStateStatus) => void;
let appStateCallback: AppStateCallback | null = null;
const mockRemoveListener = jest.fn();

jest
  .spyOn(AppState, 'addEventListener')
  .mockImplementation((type: string, listener: AppStateCallback) => {
    if (type === 'change') appStateCallback = listener;
    return { remove: mockRemoveListener } as ReturnType<typeof AppState.addEventListener>;
  });

// ── Realtime channel mock ────────────────────────────────────────────────────

function makeMockRealtimeChannel() {
  const ch = {
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockReturnThis(),
    unsubscribe: jest.fn(),
  };
  return ch;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-123';
const PLAYER_ID = 'player-456';

function makeOpts(overrides: Record<string, unknown> = {}) {
  return {
    roomId: ROOM_ID,
    playerId: PLAYER_ID,
    enabled: true,
    onBotReplaced: jest.fn(),
    onRoomClosed: jest.fn(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useConnectionManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    appStateCallback = null;

    // Default: heartbeat succeeds
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });

    // Default realtime channel
    const ch = makeMockRealtimeChannel();
    mockChannel.mockReturnValue(ch);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Initial state ──────────────────────────────────────────────────────

  it('returns connected status on mount', () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useConnectionManager(opts));

    expect(result.current.connectionStatus).toBe('connected');
    expect(result.current.isReconnecting).toBe(false);
    expect(result.current.isSpectator).toBe(false);
    expect(result.current.rejoinStatus).toBeNull();
  });

  it('sends immediate heartbeat on mount when enabled', async () => {
    const opts = makeOpts();
    renderHook(() => useConnectionManager(opts));

    // Heartbeat fires immediately on mount → sendHeartbeat called
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('update-heartbeat', expect.any(Object));
    });
  });

  it('does not send heartbeat when enabled=false', () => {
    const opts = makeOpts({ enabled: false });
    renderHook(() => useConnectionManager(opts));

    expect(mockInvoke).not.toHaveBeenCalledWith('update-heartbeat', expect.any(Object));
  });

  // ── Heartbeat backoff ──────────────────────────────────────────────────

  it('enters reconnecting state after 3 consecutive heartbeat failures', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('network') });

    const opts = makeOpts();
    const { result } = renderHook(() => useConnectionManager(opts));

    // Fire 3 heartbeats by advancing timer
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });
    }

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('reconnecting');
    });

    expect(trackEvent).toHaveBeenCalledWith('heartbeat_backoff', expect.any(Object));
  });

  // ── Bot replacement via heartbeat ──────────────────────────────────────

  it('stops heartbeat and calls onBotReplaced when server reports replaced_by_bot', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { replaced_by_bot: true }, error: null });

    const opts = makeOpts();
    const { result } = renderHook(() => useConnectionManager(opts));

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('disconnected');
    });

    expect(opts.onBotReplaced).toHaveBeenCalled();
  });

  // ── Disconnect (intentional leave) ────────────────────────────────────

  it('calls mark-disconnected on explicit disconnect', async () => {
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });

    const opts = makeOpts();
    const { result } = renderHook(() => useConnectionManager(opts));

    await act(async () => {
      await result.current.disconnect();
    });

    expect(mockInvoke).toHaveBeenCalledWith('mark-disconnected', {
      body: { room_id: ROOM_ID, player_id: PLAYER_ID },
    });

    expect(result.current.connectionStatus).toBe('disconnected');
    expect(trackConnection).toHaveBeenCalledWith(
      'disconnect',
      expect.objectContaining({
        reason: 'intentional_leave',
      })
    );
  });

  // ── Reconnect ──────────────────────────────────────────────────────────

  it('reconnect calls reconnect-player and resumes heartbeat on success', async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useConnectionManager(opts));

    mockInvoke.mockResolvedValueOnce({ data: { success: true }, error: null });

    await act(async () => {
      await result.current.reconnect();
    });

    expect(mockInvoke).toHaveBeenCalledWith('reconnect-player', {
      body: { room_id: ROOM_ID },
    });
    expect(result.current.connectionStatus).toBe('connected');
    expect(result.current.isReconnecting).toBe(false);
  });

  it('reconnect calls onRoomClosed when server reports room_closed', async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useConnectionManager(opts));

    mockInvoke.mockResolvedValueOnce({ data: { success: false, room_closed: true }, error: null });

    await act(async () => {
      await result.current.reconnect();
    });

    expect(opts.onRoomClosed).toHaveBeenCalled();
  });

  // ── forceSweep ──────────────────────────────────────────────────────────

  it('forceSweep sends heartbeat with force_sweep=true', () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useConnectionManager(opts));

    act(() => {
      result.current.forceSweep();
    });

    expect(mockInvoke).toHaveBeenCalledWith('update-heartbeat', {
      body: expect.objectContaining({
        room_id: ROOM_ID,
        player_id: PLAYER_ID,
        force_sweep: true,
      }),
    });
  });

  // ── stopHeartbeats ────────────────────────────────────────────────────

  it('stopHeartbeats clears interval without calling mark-disconnected', async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useConnectionManager(opts));

    act(() => {
      result.current.stopHeartbeats();
    });

    // Advance time — no more heartbeats should fire
    const callCountBefore = mockInvoke.mock.calls.filter(
      (c: unknown[]) => c[0] === 'update-heartbeat'
    ).length;

    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });

    const callCountAfter = mockInvoke.mock.calls.filter(
      (c: unknown[]) => c[0] === 'update-heartbeat'
    ).length;

    expect(callCountAfter).toBe(callCountBefore);
    // mark-disconnected should NOT have been called
    expect(mockInvoke).not.toHaveBeenCalledWith('mark-disconnected', expect.any(Object));
  });

  // ── Disabled when no roomId/playerId ──────────────────────────────────

  it('does nothing when roomId/playerId are empty', () => {
    const opts = makeOpts({ roomId: '', playerId: '' });
    renderHook(() => useConnectionManager(opts));

    expect(mockInvoke).not.toHaveBeenCalledWith('update-heartbeat', expect.any(Object));
  });

  // ── AppState transitions (H22 — Network Resilience) ────────────────────

  it('pauses heartbeat when app goes to background', async () => {
    const opts = makeOpts();
    renderHook(() => useConnectionManager(opts));

    // Wait for initial heartbeat
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('update-heartbeat', expect.any(Object));
    });

    const heartbeatCountBefore = mockInvoke.mock.calls.filter(
      (c: unknown[]) => c[0] === 'update-heartbeat'
    ).length;

    // Simulate app going to background
    await act(async () => {
      appStateCallback?.('background' as AppStateStatus);
    });

    // Advance time — no more heartbeats should fire
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    const heartbeatCountAfter = mockInvoke.mock.calls.filter(
      (c: unknown[]) => c[0] === 'update-heartbeat'
    ).length;

    expect(heartbeatCountAfter).toBe(heartbeatCountBefore);
    expect(trackEvent).toHaveBeenCalledWith(
      'app_state_changed',
      expect.objectContaining({
        to: 'background',
      })
    );
  });

  it('checks rejoin status and resumes heartbeat on foreground (connected)', async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useConnectionManager(opts));

    // Simulate background → foreground
    await act(async () => {
      appStateCallback?.('background' as AppStateStatus);
    });

    // Server reports connected on foreground
    mockInvoke.mockImplementation((fn: string) => {
      if (fn === 'get-rejoin-status')
        return Promise.resolve({ data: { success: true, status: 'connected' }, error: null });
      return Promise.resolve({ data: { success: true }, error: null });
    });

    await act(async () => {
      appStateCallback?.('active' as AppStateStatus);
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get-rejoin-status', expect.any(Object));
    });

    // Status should remain connected
    expect(result.current.connectionStatus).toBe('connected');
  });

  it('triggers reconnect on foreground when server reports disconnected', async () => {
    const opts = makeOpts();
    renderHook(() => useConnectionManager(opts));

    await act(async () => {
      appStateCallback?.('background' as AppStateStatus);
    });

    // Route mock by function name so heartbeat calls don't consume the response
    mockInvoke.mockImplementation((fn: string) => {
      if (fn === 'get-rejoin-status')
        return Promise.resolve({ data: { success: true, status: 'disconnected' }, error: null });
      if (fn === 'reconnect-player')
        return Promise.resolve({ data: { success: true }, error: null });
      return Promise.resolve({ data: { success: true }, error: null });
    });

    await act(async () => {
      appStateCallback?.('active' as AppStateStatus);
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('reconnect-player', expect.any(Object));
    });
  });

  it('calls onBotReplaced on foreground when server reports replaced_by_bot', async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useConnectionManager(opts));

    await act(async () => {
      appStateCallback?.('background' as AppStateStatus);
    });

    mockInvoke.mockImplementation((fn: string) => {
      if (fn === 'get-rejoin-status')
        return Promise.resolve({ data: { success: true, status: 'replaced_by_bot' }, error: null });
      return Promise.resolve({ data: { success: true }, error: null });
    });

    await act(async () => {
      appStateCallback?.('active' as AppStateStatus);
    });

    await waitFor(() => {
      expect(opts.onBotReplaced).toHaveBeenCalled();
      expect(result.current.connectionStatus).toBe('disconnected');
    });
  });

  it('calls onRoomClosed on foreground when server reports room_closed', async () => {
    const opts = makeOpts();
    renderHook(() => useConnectionManager(opts));

    await act(async () => {
      appStateCallback?.('background' as AppStateStatus);
    });

    mockInvoke.mockImplementation((fn: string) => {
      if (fn === 'get-rejoin-status')
        return Promise.resolve({ data: { success: true, status: 'room_closed' }, error: null });
      return Promise.resolve({ data: { success: true }, error: null });
    });

    await act(async () => {
      appStateCallback?.('active' as AppStateStatus);
    });

    await waitFor(() => {
      expect(opts.onRoomClosed).toHaveBeenCalled();
    });
  });

  it('resumes heartbeat on foreground when rejoin-status call fails (network issue)', async () => {
    const opts = makeOpts();
    renderHook(() => useConnectionManager(opts));

    await act(async () => {
      appStateCallback?.('background' as AppStateStatus);
    });

    // Network error on rejoin-status — hook should cautiously resume heartbeat
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new Error('network timeout'),
    });

    await act(async () => {
      appStateCallback?.('active' as AppStateStatus);
    });

    // After network failure, heartbeat should resume (next interval fires)
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });

    const heartbeatCalls = mockInvoke.mock.calls.filter(
      (c: unknown[]) => c[0] === 'update-heartbeat'
    );
    expect(heartbeatCalls.length).toBeGreaterThan(0);
  });

  it('skips AppState handling when disabled', async () => {
    const opts = makeOpts({ enabled: false });
    renderHook(() => useConnectionManager(opts));

    await act(async () => {
      appStateCallback?.('background' as AppStateStatus);
    });

    await act(async () => {
      appStateCallback?.('active' as AppStateStatus);
    });

    // Should not have called get-rejoin-status
    expect(mockInvoke).not.toHaveBeenCalledWith('get-rejoin-status', expect.any(Object));
  });

  // ── Heartbeat recovery after transient failures (H22) ─────────────────

  it('resets failure count after a successful heartbeat', async () => {
    // First 2 heartbeats fail, then one succeeds, then another fails
    mockInvoke
      .mockResolvedValueOnce({ data: null, error: new Error('fail 1') })
      .mockResolvedValueOnce({ data: null, error: new Error('fail 2') })
      .mockResolvedValueOnce({ data: { success: true }, error: null }) // recovery
      .mockResolvedValueOnce({ data: null, error: new Error('fail 3') });

    const opts = makeOpts();
    const { result } = renderHook(() => useConnectionManager(opts));

    // 2 failures
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });
    }

    // Not yet reconnecting (threshold is 3)
    expect(result.current.connectionStatus).not.toBe('reconnecting');

    // 1 success — should reset counter
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });

    expect(result.current.connectionStatus).toBe('connected');

    // 1 more failure — should NOT trigger reconnecting (counter was reset)
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });

    expect(result.current.connectionStatus).not.toBe('reconnecting');
  });
});
