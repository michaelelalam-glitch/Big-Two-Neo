/**
 * Unit tests for useFriends hook (Task #646).
 *
 * Key invariants verified:
 *  1. Returns empty state when user is not authenticated.
 *  2. Clears friends/pending lists when user signs out.
 *  3. acceptRequest throws an i18n-keyed error when the update returns no rows.
 *  4. acceptRequest propagates supabase DB errors.
 *  5. sendRequest is a no-op when user is null.
 */

jest.mock('../../services/supabase');
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));
// Stub i18n so translation lookups simply echo the key
jest.mock('../../i18n', () => ({
  i18n: { t: (key: string) => key },
}));

import { renderHook, act } from '@testing-library/react-native';
import { useFriends } from '../useFriends';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../contexts/AuthContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a fully-chainable supabase query builder mock.
 *
 * Two terminal cases:
 *  - `order(...)` → used by fetchAll (.select(fields).or().order())
 *  - `select()` with no args → used by acceptRequest (.update().eq().eq().eq().select())
 *
 * `terminalSelectResult` controls what the no-arg `.select()` promise resolves with.
 */
function makeQueryBuilder(
  fetchAllResult: { data: unknown; error: unknown } = { data: [], error: null },
  terminalSelectResult: { data: unknown; error: unknown } = { data: [], error: null }
) {
  const q: Record<string, jest.Mock> = {};
  const self = () => q as unknown;

  // select: chainable when called with a field-list string (fetchAll),
  //         terminal Promise when called with no args (mutation + .select())
  q.select = jest.fn((fields?: string) =>
    fields ? (q as unknown) : Promise.resolve(terminalSelectResult)
  );
  q.insert = jest.fn(() => Promise.resolve({ data: null, error: null }));
  q.update = jest.fn(self);
  q.delete = jest.fn(self);
  q.eq = jest.fn(self);
  q.or = jest.fn(self);
  // order is the terminal node for fetchAll
  q.order = jest.fn(() => Promise.resolve(fetchAllResult));
  return q;
}

/** A channel mock that supports .on().on().subscribe() chains. */
function makeChannelMock() {
  const ch = {
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockReturnThis(),
    untrack: jest.fn().mockResolvedValue({}),
    track: jest.fn().mockResolvedValue({}),
    presenceState: jest.fn().mockReturnValue({}),
  };
  return ch;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.resetAllMocks();
  (supabase.removeChannel as jest.Mock) = jest.fn();
  (supabase.channel as jest.Mock).mockReturnValue(makeChannelMock());
  // Default: fetchAll returns empty data
  (supabase.from as jest.Mock).mockImplementation(() => makeQueryBuilder());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFriends', () => {
  describe('when user is not authenticated', () => {
    beforeEach(() => {
      (useAuth as jest.Mock).mockReturnValue({ user: null });
    });

    it('returns empty friends, incoming and outgoing arrays', () => {
      const { result } = renderHook(() => useFriends());
      expect(result.current.friends).toEqual([]);
      expect(result.current.incomingPending).toEqual([]);
      expect(result.current.outgoingPending).toEqual([]);
    });

    it('does not create a Supabase realtime channel', () => {
      renderHook(() => useFriends());
      expect(supabase.channel).not.toHaveBeenCalled();
    });
  });

  describe('when user signs out', () => {
    it('clears all friend state immediately', () => {
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
      const { result, rerender } = renderHook(() => useFriends());

      (useAuth as jest.Mock).mockReturnValue({ user: null });
      rerender({});

      expect(result.current.friends).toEqual([]);
      expect(result.current.incomingPending).toEqual([]);
      expect(result.current.outgoingPending).toEqual([]);
    });

    it('removes the Supabase realtime channel on sign-out', () => {
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
      const { rerender, unmount } = renderHook(() => useFriends());

      (useAuth as jest.Mock).mockReturnValue({ user: null });
      rerender({});
      unmount();

      expect(supabase.removeChannel).toHaveBeenCalled();
    });
  });

  describe('acceptRequest', () => {
    beforeEach(() => {
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
    });

    it('throws the i18n-keyed error when supabase returns no rows', async () => {
      // terminalSelectResult = empty array → triggers "already handled" branch
      (supabase.from as jest.Mock).mockReturnValue(
        makeQueryBuilder({ data: [], error: null }, { data: [], error: null })
      );

      const { result } = renderHook(() => useFriends());

      await act(async () => {
        await expect(result.current.acceptRequest('fship-1')).rejects.toThrow(
          'friends.requestAlreadyHandled'
        );
      });
    });

    it('throws a DB error message when supabase returns an error', async () => {
      (supabase.from as jest.Mock).mockReturnValue(
        makeQueryBuilder({ data: [], error: null }, { data: null, error: { message: 'DB error' } })
      );

      const { result } = renderHook(() => useFriends());

      await act(async () => {
        await expect(result.current.acceptRequest('fship-1')).rejects.toThrow('DB error');
      });
    });
  });

  describe('sendRequest', () => {
    it('is a no-op when user is null', async () => {
      (useAuth as jest.Mock).mockReturnValue({ user: null });
      const { result } = renderHook(() => useFriends());

      await act(async () => {
        await result.current.sendRequest('other-user');
      });

      // supabase.from may be called by fetchAll (which itself guards on user),
      // but insert should never be called.
      const fromCalls = (supabase.from as jest.Mock).mock.calls;
      const insertCalls = fromCalls.filter((_, i) => {
        // Check that the returned builder's insert was called
        const builder = (supabase.from as jest.Mock).mock.results[i]?.value;
        return builder?.insert?.mock?.calls?.length > 0;
      });
      expect(insertCalls).toHaveLength(0);
    });
  });
});
