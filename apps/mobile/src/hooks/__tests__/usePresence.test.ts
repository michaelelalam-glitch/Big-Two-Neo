/**
 * Unit tests for usePresence hook (Task #646).
 *
 * Key invariants verified:
 *  1. Returns an empty Set when user is not authenticated.
 *  2. Calls supabase.channel when a user is present.
 *  3. Clears online state and removes channel when user signs out.
 *  4. join() removes stale channel before creating a new one.
 *  5. AppState 'background' triggers untrack (with error handling).
 */

jest.mock('../../services/supabase');
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));
jest.mock('../../store/userPreferencesSlice', () => {
  const mockState = { showOnlineStatus: true };
  const mock = jest.fn((selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState
  );
  // Expose state so tests can mutate it
  (mock as any).__state = mockState;
  return { useUserPreferencesStore: mock };
});

// AppState mock — captures the listener so tests can fire AppState changes.
const mockAddEventListener = jest.fn();
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    AppState: {
      ...actual.AppState,
      addEventListener: mockAddEventListener,
    },
  };
});

import { renderHook, act } from '@testing-library/react-native';
import { usePresence } from '../usePresence';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../contexts/AuthContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChannel(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const ch = {
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockReturnThis(),
    untrack: jest.fn().mockResolvedValue({}),
    track: jest.fn().mockResolvedValue({}),
    presenceState: jest.fn().mockReturnValue({}),
    ...overrides,
  };
  return ch;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let appStateListener: ((state: string) => void) | null = null;

beforeEach(() => {
  jest.resetAllMocks();
  appStateListener = null;

  // Capture AppState listener so tests can trigger state changes
  mockAddEventListener.mockImplementation((_event: string, cb: (state: string) => void) => {
    appStateListener = cb;
    return { remove: jest.fn() };
  });

  (supabase.removeChannel as jest.Mock) = jest.fn().mockResolvedValue('ok');
  (supabase.channel as jest.Mock).mockReturnValue(makeChannel());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePresence', () => {
  describe('when user is not authenticated', () => {
    beforeEach(() => {
      (useAuth as jest.Mock).mockReturnValue({ user: null });
    });

    it('returns an empty Set of onlineUserIds', () => {
      const { result } = renderHook(() => usePresence());
      expect(result.current.onlineUserIds.size).toBe(0);
    });

    it('isOnline always returns false', () => {
      const { result } = renderHook(() => usePresence());
      expect(result.current.isOnline('any-user')).toBe(false);
    });

    it('does not create a Supabase presence channel', () => {
      renderHook(() => usePresence());
      expect(supabase.channel).not.toHaveBeenCalled();
    });
  });

  describe('when user is authenticated', () => {
    beforeEach(() => {
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
    });

    it('creates a presence channel on mount', () => {
      renderHook(() => usePresence());
      expect(supabase.channel).toHaveBeenCalledWith(
        'app-presence',
        expect.objectContaining({ config: expect.any(Object) })
      );
    });

    it('removes the channel on unmount', () => {
      const { unmount } = renderHook(() => usePresence());
      unmount();
      expect(supabase.removeChannel).toHaveBeenCalled();
    });
  });

  describe('when user signs out', () => {
    it('clears onlineUserIds and removes the channel', () => {
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
      const { result, rerender } = renderHook(() => usePresence());

      expect(supabase.channel).toHaveBeenCalledTimes(1);

      (useAuth as jest.Mock).mockReturnValue({ user: null });
      rerender({});

      expect(result.current.onlineUserIds.size).toBe(0);
      expect(supabase.removeChannel).toHaveBeenCalled();
    });
  });

  describe('AppState changes', () => {
    beforeEach(() => {
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
    });

    it('calls join (creates a new channel) when app becomes active', async () => {
      renderHook(() => usePresence());
      const callsBefore = (supabase.channel as jest.Mock).mock.calls.length;

      await act(async () => {
        appStateListener?.('active');
        // Flush the removeChannel await inside join()
        await Promise.resolve();
      });

      expect((supabase.channel as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('calls untrack (not throwing) when app goes to background', async () => {
      const untrackMock = jest.fn().mockResolvedValue({});
      (supabase.channel as jest.Mock).mockReturnValue(makeChannel({ untrack: untrackMock }));

      renderHook(() => usePresence());

      await act(async () => {
        appStateListener?.('background');
        // Flush microtasks so the void .catch() resolves
        await Promise.resolve();
      });

      expect(untrackMock).toHaveBeenCalled();
    });

    it('does not throw when untrack rejects', async () => {
      const untrackMock = jest.fn().mockRejectedValue(new Error('network error'));
      (supabase.channel as jest.Mock).mockReturnValue(makeChannel({ untrack: untrackMock }));

      renderHook(() => usePresence());

      await act(async () => {
        // Should NOT propagate; the hook uses void .catch(...)
        expect(() => appStateListener?.('background')).not.toThrow();
        await Promise.resolve();
      });
    });
  });

  describe('join() removes stale channel before creating a new one', () => {
    it('calls removeChannel before subscribing again', () => {
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
      renderHook(() => usePresence());

      // Simulate AppState active → triggers join() again while a channel exists
      act(() => {
        appStateListener?.('active');
      });

      // removeChannel called for the existing channel before the new one
      expect(supabase.removeChannel).toHaveBeenCalled();
    });
  });

  describe('showOnlineStatus=false blocks presence events (guard)', () => {
    /** Helper: builds a channel mock whose .on() captures callbacks by event name. */
    function makeCapturingChannel() {
      const handlers: Record<string, (payload?: unknown) => void> = {};
      const presenceStateMock = jest.fn().mockReturnValue({ key1: [{ user_id: 'user-99' }] });
      const ch = {
        on: jest
          .fn()
          .mockImplementation(
            (_type: string, opts: { event: string }, cb: (payload?: unknown) => void) => {
              handlers[opts.event] = cb;
              return ch;
            }
          ),
        subscribe: jest.fn().mockReturnThis(),
        untrack: jest.fn().mockResolvedValue({}),
        track: jest.fn().mockResolvedValue({}),
        presenceState: presenceStateMock,
      };
      return { ch, handlers };
    }

    it('does not populate onlineUserIds on sync when showOnlineStatus is false', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useUserPreferencesStore } = require('../../store/userPreferencesSlice');
      const mockState = (useUserPreferencesStore as any).__state;
      mockState.showOnlineStatus = false;

      (useAuth as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });

      const { ch, handlers } = makeCapturingChannel();
      (supabase.channel as jest.Mock).mockReturnValue(ch);

      const { result } = renderHook(() => usePresence());

      // Verify the hook actually registered the sync handler before firing
      expect(handlers['sync']).toBeDefined();

      // Fire the sync event — the guard should prevent onlineUserIds from being set
      await act(async () => {
        handlers['sync']?.();
        await Promise.resolve();
      });

      // Guard must have blocked presenceState() call
      expect(ch.presenceState).not.toHaveBeenCalled();
      expect(result.current.onlineUserIds.size).toBe(0);

      // Restore
      mockState.showOnlineStatus = true;
    });

    it('does not populate onlineUserIds on join when showOnlineStatus is false', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useUserPreferencesStore } = require('../../store/userPreferencesSlice');
      const mockState = (useUserPreferencesStore as any).__state;
      mockState.showOnlineStatus = false;

      (useAuth as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });

      const { ch, handlers } = makeCapturingChannel();
      (supabase.channel as jest.Mock).mockReturnValue(ch);

      const { result } = renderHook(() => usePresence());

      // Verify the hook actually registered the join handler before firing
      expect(handlers['join']).toBeDefined();

      const sizeBefore = result.current.onlineUserIds.size;

      // Fire the join event — the guard should prevent onlineUserIds from being updated
      await act(async () => {
        handlers['join']?.({ newPresences: [{ user_id: 'user-99' }] });
        await Promise.resolve();
      });

      // State must not have changed
      expect(result.current.onlineUserIds.size).toBe(sizeBefore);
      expect(result.current.onlineUserIds.has('user-99')).toBe(false);

      // Restore
      mockState.showOnlineStatus = true;
    });
  });

  describe('showOnlineStatus toggle', () => {
    it('calls untrack when showOnlineStatus is disabled', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useUserPreferencesStore } = require('../../store/userPreferencesSlice');
      const mockState = (useUserPreferencesStore as any).__state;

      (useAuth as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
      const untrackMock = jest.fn().mockResolvedValue({});
      const trackMock = jest.fn().mockResolvedValue({});
      (supabase.channel as jest.Mock).mockReturnValue(
        makeChannel({ untrack: untrackMock, track: trackMock })
      );

      const { rerender } = renderHook(() => usePresence());

      // Toggle off
      await act(async () => {
        mockState.showOnlineStatus = false;
        rerender({});
        await Promise.resolve();
      });

      expect(untrackMock).toHaveBeenCalled();

      // Restore for other tests
      mockState.showOnlineStatus = true;
    });
  });
});
