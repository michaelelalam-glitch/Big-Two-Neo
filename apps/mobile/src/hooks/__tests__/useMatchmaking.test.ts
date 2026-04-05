/**
 * Unit tests for useMatchmaking — Task #641
 *
 * Key invariants verified:
 *  1.  No polling interval is ever created (single Realtime data source).
 *  2.  Immediate match (find-match returns matched:true) resolves without
 *      starting a Realtime subscription.
 *  3.  Waiting path subscribes to Realtime.
 *  4.  Realtime UPDATE event for this user transitions to matchFound.
 *  5.  isCancelledRef — Realtime callback arriving after cancelMatchmaking()
 *      does NOT transition to matchFound.
 *  6.  isCancelledRef — async room-fetch completing after cancel is also
 *      guarded.
 *  7.  isStartingRef debounce — second startMatchmaking() call while a first
 *      is in-flight creates only ONE channel subscription.
 *  8.  cancelMatchmaking() tears down channel and calls edge function.
 *  9.  Cleanup on unmount tears down channel.
 *  10. resetMatch() clears matchFound / roomCode / roomId.
 *  11. Auth failure surfaces as error string; isSearching reset to false.
 *  12. Invalid find-match response surfaces as error string.
 */

jest.mock('../../services/supabase');

import { renderHook, act } from '@testing-library/react-native';
import { useMatchmaking } from '../useMatchmaking';
import { supabase } from '../../services/supabase';

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type PostgresChangeHandler = (payload: object) => void;

interface MockChannel {
  on: jest.Mock;
  subscribe: jest.Mock;
  _postgresHandler: PostgresChangeHandler | null;
}

/** Build a fresh mock Realtime channel that captures the postgres_changes CB. */
function makeMockChannel(): MockChannel {
  const channel: MockChannel = {
    _postgresHandler: null,
    on: jest.fn().mockImplementation((_event, _filter, handler) => {
      channel._postgresHandler = handler;
      return channel;
    }),
    // subscribe returns the channel itself; use a getter to avoid the TDZ issue
    subscribe: jest.fn().mockImplementation(() => channel),
  };
  return channel;
}

/** Build a minimal waiting-room UPDATE payload for a matched row. */
function makeMatchedPayload(userId: string, roomId: string) {
  return {
    eventType: 'UPDATE',
    new: {
      user_id: userId,
      status: 'matched',
      matched_room_id: roomId,
    },
    old: {},
  };
}

const USER_ID = 'user-abc';
const ROOM_ID = 'room-xyz';
const ROOM_CODE = 'ABCDEF';

// ---------------------------------------------------------------------------
// Global mock setup
// ---------------------------------------------------------------------------

afterEach(() => {
  // Restore setInterval / clearInterval spies so the real implementations are
  // in place for subsequent tests (and for other test files in the same worker).
  jest.restoreAllMocks();
});

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) flushes mockResolvedValueOnce queues so
  // unconsumed one-time implementations from a previous test cannot leak.
  jest.resetAllMocks();
  jest.spyOn(global, 'setInterval');
  jest.spyOn(global, 'clearInterval');

  // Re-establish defaults after reset
  (supabase.auth.getUser as jest.Mock).mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({
    data: null,
    error: null,
  });
  supabase.removeChannel = jest.fn() as unknown as typeof supabase.removeChannel;
});

// ---------------------------------------------------------------------------
// 1. No polling interval
// ---------------------------------------------------------------------------

describe('no polling interval', () => {
  it('does not call setInterval for an immediate match', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { matched: true, room_code: ROOM_CODE, room_id: ROOM_ID, waiting_count: 4 },
      error: null,
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    expect(setInterval).not.toHaveBeenCalled();
  });

  it('does not call setInterval for a waiting match', async () => {
    const channel = makeMockChannel();
    (supabase.channel as jest.Mock).mockReturnValue(channel);
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { matched: false, waiting_count: 2 },
      error: null,
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    expect(setInterval).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Immediate match resolution
// ---------------------------------------------------------------------------

describe('immediate match', () => {
  it('sets matchFound, roomCode, roomId; clears isSearching', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { matched: true, room_code: ROOM_CODE, room_id: ROOM_ID, waiting_count: 4 },
      error: null,
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    expect(result.current.matchFound).toBe(true);
    expect(result.current.roomCode).toBe(ROOM_CODE);
    expect(result.current.roomId).toBe(ROOM_ID);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.waitingCount).toBe(4);
  });

  it('does not create a Realtime channel for an immediate match', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { matched: true, room_code: ROOM_CODE, room_id: ROOM_ID, waiting_count: 4 },
      error: null,
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    expect(supabase.channel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Waiting path subscribes to Realtime
// ---------------------------------------------------------------------------

describe('waiting path', () => {
  it('creates a Realtime channel when not immediately matched', async () => {
    const channel = makeMockChannel();
    (supabase.channel as jest.Mock).mockReturnValue(channel);
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { matched: false, waiting_count: 1 },
      error: null,
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    expect(supabase.channel).toHaveBeenCalledWith('waiting_room_updates');
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    expect(result.current.isSearching).toBe(true);
    expect(result.current.waitingCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Realtime UPDATE → matchFound
// ---------------------------------------------------------------------------

describe('Realtime match detection', () => {
  it('transitions to matchFound when the Realtime UPDATE arrives', async () => {
    const channel = makeMockChannel();
    (supabase.channel as jest.Mock).mockReturnValue(channel);
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { matched: false, waiting_count: 1 },
      error: null,
    });

    // Mock the follow-up rooms fetch
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { code: ROOM_CODE },
            error: null,
          }),
        }),
      }),
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    // Fire the Realtime event
    await act(async () => {
      channel._postgresHandler!(makeMatchedPayload(USER_ID, ROOM_ID));
      // allow async room fetch to settle
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current.matchFound).toBe(true);
    expect(result.current.roomCode).toBe(ROOM_CODE);
    expect(result.current.roomId).toBe(ROOM_ID);
    expect(result.current.isSearching).toBe(false);
  });

  it('ignores UPDATE events for other users', async () => {
    const channel = makeMockChannel();
    (supabase.channel as jest.Mock).mockReturnValue(channel);
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { matched: false, waiting_count: 2 },
      error: null,
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    await act(async () => {
      // Different userId
      channel._postgresHandler!(makeMatchedPayload('other-user', ROOM_ID));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current.matchFound).toBe(false);
    expect(result.current.isSearching).toBe(true);
  });

  it('updates waitingCount from server-written waiting_count field in UPDATE payload', async () => {
    const channel = makeMockChannel();
    (supabase.channel as jest.Mock).mockReturnValue(channel);
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { matched: false, waiting_count: 2 },
      error: null,
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    expect(result.current.waitingCount).toBe(2);

    // Server writes waiting_count=3 to the user's row (queue grew)
    await act(async () => {
      channel._postgresHandler!({
        eventType: 'UPDATE',
        new: { user_id: USER_ID, status: 'waiting', waiting_count: 3 },
        old: {},
      });
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current.waitingCount).toBe(3);
    expect(result.current.matchFound).toBe(false);
    expect(result.current.isSearching).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. isCancelledRef — Realtime callback after cancel is ignored
// ---------------------------------------------------------------------------

describe('isCancelledRef guard on Realtime callback', () => {
  it('does not set matchFound if Realtime fires after cancelMatchmaking', async () => {
    const channel = makeMockChannel();
    (supabase.channel as jest.Mock).mockReturnValue(channel);
    (supabase.functions.invoke as jest.Mock)
      // startMatchmaking call
      .mockResolvedValueOnce({ data: { matched: false, waiting_count: 1 }, error: null })
      // cancelMatchmaking call
      .mockResolvedValueOnce({ data: { success: true }, error: null });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    // Cancel first
    await act(async () => {
      await result.current.cancelMatchmaking();
    });

    // Now a buffered Realtime event fires
    await act(async () => {
      channel._postgresHandler!(makeMatchedPayload(USER_ID, ROOM_ID));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current.matchFound).toBe(false);
    expect(result.current.isSearching).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. isCancelledRef — async room-fetch completing after cancel is guarded
// ---------------------------------------------------------------------------

describe('isCancelledRef guard on async room-fetch', () => {
  it('does not set matchFound if cancel races the room fetch', async () => {
    const channel = makeMockChannel();
    (supabase.channel as jest.Mock).mockReturnValue(channel);
    (supabase.functions.invoke as jest.Mock)
      .mockResolvedValueOnce({ data: { matched: false, waiting_count: 1 }, error: null })
      .mockResolvedValueOnce({ data: { success: true }, error: null });

    // Room fetch resolves only after cancel
    let resolveRoomFetch!: (v: { data: { code: string } | null; error: null }) => void;
    const roomFetchPromise = new Promise<{ data: { code: string } | null; error: null }>(r => {
      resolveRoomFetch = r;
    });
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockReturnValue(roomFetchPromise),
        }),
      }),
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    // Fire Realtime event — kicks off the room fetch
    act(() => {
      channel._postgresHandler!(makeMatchedPayload(USER_ID, ROOM_ID));
    });

    // Cancel while room fetch is still in flight
    await act(async () => {
      await result.current.cancelMatchmaking();
    });

    // Now the room fetch resolves
    await act(async () => {
      resolveRoomFetch({ data: { code: ROOM_CODE }, error: null });
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current.matchFound).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. isStartingRef debounce — concurrent calls create only one channel
// ---------------------------------------------------------------------------

describe('isStartingRef debounce', () => {
  it('ignores a second startMatchmaking call fired before the first resolves', async () => {
    const channel = makeMockChannel();
    (supabase.channel as jest.Mock).mockReturnValue(channel);

    let resolveFirst!: (v: object) => void;
    const firstCall = new Promise<object>(r => {
      resolveFirst = r;
    });

    (supabase.functions.invoke as jest.Mock)
      .mockReturnValueOnce(firstCall)
      .mockResolvedValueOnce({ data: { matched: false, waiting_count: 1 }, error: null });

    const { result } = renderHook(() => useMatchmaking());

    // Fire two calls almost simultaneously
    const p1 = result.current.startMatchmaking('Player1');
    const p2 = result.current.startMatchmaking('Player1');

    // Resolve the first call
    resolveFirst({ data: { matched: false, waiting_count: 1 }, error: null });
    await act(async () => {
      await Promise.all([p1, p2]);
    });

    // channel should only have been created once (second call was debounced)
    expect(supabase.channel).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 8. cancelMatchmaking tears down channel + calls edge function
// ---------------------------------------------------------------------------

describe('cancelMatchmaking', () => {
  it('removes channel and calls cancel-matchmaking edge function', async () => {
    const channel = makeMockChannel();
    (supabase.channel as jest.Mock).mockReturnValue(channel);
    (supabase.functions.invoke as jest.Mock)
      .mockResolvedValueOnce({ data: { matched: false, waiting_count: 1 }, error: null })
      .mockResolvedValueOnce({ data: { success: true }, error: null });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });
    await act(async () => {
      await result.current.cancelMatchmaking();
    });

    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
    expect(supabase.functions.invoke).toHaveBeenCalledWith('cancel-matchmaking', expect.anything());
    expect(result.current.isSearching).toBe(false);
  });

  it('is a no-op when not currently searching', async () => {
    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.cancelMatchmaking(); // userId not set → early return
    });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. Cleanup on unmount
// ---------------------------------------------------------------------------

describe('unmount cleanup', () => {
  it('removes the Realtime channel on unmount', async () => {
    const channel = makeMockChannel();
    (supabase.channel as jest.Mock).mockReturnValue(channel);
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { matched: false, waiting_count: 1 },
      error: null,
    });

    const { result, unmount } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    unmount();

    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('does not call removeChannel on unmount when no channel was created', () => {
    const { unmount } = renderHook(() => useMatchmaking());
    unmount();
    expect(supabase.removeChannel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 10. resetMatch
// ---------------------------------------------------------------------------

describe('resetMatch', () => {
  it('clears matchFound, roomCode, roomId, and waitingCount', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { matched: true, room_code: ROOM_CODE, room_id: ROOM_ID, waiting_count: 4 },
      error: null,
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    expect(result.current.matchFound).toBe(true);

    act(() => {
      result.current.resetMatch();
    });

    expect(result.current.matchFound).toBe(false);
    expect(result.current.roomCode).toBeNull();
    expect(result.current.roomId).toBeNull();
    expect(result.current.waitingCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Auth failure
// ---------------------------------------------------------------------------

describe('auth failure', () => {
  it('sets error and resets isSearching when getUser fails', async () => {
    (supabase.auth.getUser as jest.Mock).mockResolvedValueOnce({
      data: { user: null },
      error: new Error('Not authenticated'),
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    expect(result.current.error).toBe('User not authenticated');
    expect(result.current.isSearching).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. Invalid find-match response
// ---------------------------------------------------------------------------

describe('invalid response handling', () => {
  it('sets error when find-match returns null', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    expect(result.current.error).toBe('Invalid response format from find-match');
    expect(result.current.isSearching).toBe(false);
  });

  it('sets error when matched:true but room_code is missing', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { matched: true, waiting_count: 4 },
      error: null,
    });

    const { result } = renderHook(() => useMatchmaking());
    await act(async () => {
      await result.current.startMatchmaking('Player1');
    });

    expect(result.current.error).toBe('Matched response missing room details');
    expect(result.current.isSearching).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13. isCancelledRef — cancel while find-match is still in flight
// ---------------------------------------------------------------------------
// Fix 8.3: after find-match resolves with isCancelledRef=true, the hook
// invokes cancel-matchmaking best-effort so the server-side waiting_room
// entry is cleaned up even when the cancel() call raced the find-match
// registration.
// ---------------------------------------------------------------------------

describe('isCancelledRef guard — cancel while find-match is in flight', () => {
  it('invokes cancel-matchmaking when cancel is called before find-match resolves', async () => {
    let resolveFindMatch!: (v: { data: object; error: null }) => void;
    const findMatchPromise = new Promise<{ data: object; error: null }>(r => {
      resolveFindMatch = r;
    });

    (supabase.functions.invoke as jest.Mock).mockImplementation((fnName: string) => {
      if (fnName === 'find-match') return findMatchPromise;
      // cancel-matchmaking and any other invocations resolve immediately
      return Promise.resolve({ data: { success: true }, error: null });
    });

    const { result } = renderHook(() => useMatchmaking());

    // Start matchmaking in the background (do not await — find-match is held)
    let startPromise!: ReturnType<typeof result.current.startMatchmaking>;
    await act(async () => {
      startPromise = result.current.startMatchmaking('Player1');
    });

    // Yield enough microtasks for getUser() to resolve and userIdRef to be set
    // so that cancelMatchmaking() is called at the right point in the flow.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Cancel while find-match is still in flight; userIdRef is now set
    await act(async () => {
      await result.current.cancelMatchmaking();
    });

    // Resolve find-match — the post-cancel guard should invoke cancel-matchmaking
    await act(async () => {
      resolveFindMatch({ data: { matched: false, waiting_count: 1 }, error: null });
      await startPromise;
    });

    // cancel-matchmaking must have been called at least once (from the post-
    // find-match guard, and possibly also directly from cancelMatchmaking())
    expect(supabase.functions.invoke).toHaveBeenCalledWith('cancel-matchmaking', expect.anything());
    expect(result.current.matchFound).toBe(false);
    expect(result.current.isSearching).toBe(false);
  });
});
