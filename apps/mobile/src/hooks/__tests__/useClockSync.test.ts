/**
 * useClockSync Hook Tests — C7 Audit Fix
 *
 * Comprehensive tests for NTP-style clock drift measurement:
 * - Server offset calculation via round-trip ping
 * - Error handling (ping failure → drift=0)
 * - Fallback drift from server timestamp
 * - `enabled=false` bypasses ping
 * - `getCorrectedNow()` returns Date.now() + drift
 * - Cache TTL and deduplication
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useClockSync, __resetCacheForTesting } from '../useClockSync';

// ── Mock supabase edge function ─────────────────────────────────────────────
const mockInvoke = jest.fn();
jest.mock('../../services/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

// ── Mock logger (suppress console noise) ────────────────────────────────────
jest.mock('../../utils/logger', () => ({
  networkLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Controllable Date.now mock
let _now = 100_000;
const originalDateNow = Date.now;
const dateNowSpy = jest.spyOn(Date, 'now');

beforeEach(() => {
  __resetCacheForTesting();
  mockInvoke.mockReset();
  _now += 60_000; // ensure fresh cache window per test
  dateNowSpy.mockImplementation(() => _now);
});

afterAll(() => {
  dateNowSpy.mockRestore();
});

describe('useClockSync', () => {
  // ── Basic behavior ──────────────────────────────────────────────────────

  it('returns initial state with drift=0 and isSynced=false', () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useClockSync(null));
    expect(result.current.offsetMs).toBe(0);
    expect(result.current.isSynced).toBe(false);
    expect(typeof result.current.getCorrectedNow).toBe('function');
  });

  it('measures positive drift when client is behind server', async () => {
    const t0 = _now;
    mockInvoke.mockImplementation(async () => {
      _now = t0 + 100; // 100ms rtt
      return { data: { timestamp: t0 + 200 }, error: null };
    });

    const { result } = renderHook(() => useClockSync(null));

    await waitFor(() => expect(result.current.isSynced).toBe(true));
    // drift = (t0+200) - t0 - round(100/2) = 150
    expect(result.current.offsetMs).toBe(150);
  });

  it('measures negative drift when client is ahead of server', async () => {
    const t0 = _now;
    mockInvoke.mockImplementation(async () => {
      _now = t0 + 100;
      return { data: { timestamp: t0 - 200 }, error: null };
    });

    const { result } = renderHook(() => useClockSync(null));

    await waitFor(() => expect(result.current.isSynced).toBe(true));
    // drift = (t0-200) - t0 - round(100/2) = -250
    expect(result.current.offsetMs).toBe(-250);
  });

  // ── getCorrectedNow ─────────────────────────────────────────────────────

  it('getCorrectedNow returns Date.now() + drift', async () => {
    const t0 = _now;
    mockInvoke.mockImplementation(async () => {
      _now = t0 + 50; // 50ms rtt
      return { data: { timestamp: t0 + 200 }, error: null };
    });

    const { result } = renderHook(() => useClockSync(null));
    await waitFor(() => expect(result.current.isSynced).toBe(true));

    // drift = (t0+200) - t0 - round(50/2) = 175
    const drift = result.current.offsetMs;
    expect(drift).toBe(175);

    _now = t0 + 10_000;
    expect(result.current.getCorrectedNow()).toBe(_now + drift);
  });

  // ── enabled=false ───────────────────────────────────────────────────────

  it('skips NTP ping when enabled=false and reports isSynced=true', async () => {
    const { result } = renderHook(() => useClockSync(null, null, false));
    await waitFor(() => expect(result.current.isSynced).toBe(true));
    expect(result.current.offsetMs).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  // ── Error handling ──────────────────────────────────────────────────────

  it('falls back to drift=0 when server-time returns an error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('network timeout') });
    const { result } = renderHook(() => useClockSync(null));
    await waitFor(() => expect(result.current.isSynced).toBe(true));
    expect(result.current.offsetMs).toBe(0);
  });

  it('falls back to drift=0 when server-time returns invalid data', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { timestamp: 'not a number' }, error: null });
    const { result } = renderHook(() => useClockSync(null));
    await waitFor(() => expect(result.current.isSynced).toBe(true));
    expect(result.current.offsetMs).toBe(0);
  });

  it('falls back to drift=0 when server-time throws', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('fetch failed'));
    const { result } = renderHook(() => useClockSync(null));
    await waitFor(() => expect(result.current.isSynced).toBe(true));
    expect(result.current.offsetMs).toBe(0);
  });

  // ── Fallback drift from server timestamp ───────────────────────────────

  it('applies fallback drift from server timestamp before NTP completes', async () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves
    const serverTs = _now + 2000; // 2s ahead → rough drift of 2000

    const { result } = renderHook(() => useClockSync(null, serverTs));

    await waitFor(() => expect(result.current.offsetMs).toBe(2000));
    expect(result.current.isSynced).toBe(false);
  });

  it('ignores fallback drift when rough <= 1000ms', () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    const serverTs = _now + 500; // only 500ms ahead — below 1s threshold

    const { result } = renderHook(() => useClockSync(null, serverTs));
    expect(result.current.offsetMs).toBe(0);
  });

  // ── Cache behavior ──────────────────────────────────────────────────────

  it('reuses cached drift within 30s TTL (no second network call)', async () => {
    const t0 = _now;
    mockInvoke.mockImplementation(async () => {
      _now = t0 + 50;
      return { data: { timestamp: t0 + 100 }, error: null };
    });

    const { result: r1 } = renderHook(() => useClockSync(null));
    await waitFor(() => expect(r1.current.isSynced).toBe(true));
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Advance 5s (within 30s TTL)
    _now = t0 + 5_000;

    const { result: r2 } = renderHook(() => useClockSync(null));
    await waitFor(() => expect(r2.current.isSynced).toBe(true));
    expect(mockInvoke).toHaveBeenCalledTimes(1); // still only 1
  });

  // ── Deduplication ───────────────────────────────────────────────────────

  it('deduplicates concurrent NTP pings', async () => {
    const t0 = _now;
    let resolvePromise: ((v: { data: { timestamp: number }; error: null }) => void) | null = null;
    mockInvoke.mockImplementation(
      () =>
        new Promise(resolve => {
          resolvePromise = resolve;
        })
    );

    const { result: r1 } = renderHook(() => useClockSync(null));
    const { result: r2 } = renderHook(() => useClockSync(null));

    expect(mockInvoke).toHaveBeenCalledTimes(1);

    _now = t0 + 100;
    await act(async () => {
      resolvePromise!({ data: { timestamp: t0 + 200 }, error: null });
    });

    await waitFor(() => {
      expect(r1.current.isSynced).toBe(true);
      expect(r2.current.isSynced).toBe(true);
    });
  });
});
