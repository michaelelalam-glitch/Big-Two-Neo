/**
 * Unit tests for useThrowables hook.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useThrowables } from '../useThrowables';

// Mock channel that captures broadcast handlers and lets tests emit events.
function createMockChannel() {
  const handlers: Record<string, ((payload: unknown) => void)[]> = {};
  return {
    on: jest.fn((type: string, filter: { event: string }, handler: (payload: unknown) => void) => {
      const key = `${type}:${filter.event}`;
      if (!handlers[key]) handlers[key] = [];
      handlers[key].push(handler);
      return { on: jest.fn().mockReturnThis() };
    }),
    send: jest.fn().mockResolvedValue(undefined),
    /** Simulate an incoming throwable broadcast. */
    _emit(event: string, data: unknown) {
      const key = `broadcast:${event}`;
      (handlers[key] ?? []).forEach(h => h({ data }));
    },
  };
}

const LAYOUT_PLAYERS = [
  { player_index: 0 }, // local / bottom
  { player_index: 1 }, // top
  { player_index: 2 }, // left
  { player_index: 3 }, // right
] as const;

describe('useThrowables', () => {
  let channel: ReturnType<typeof createMockChannel>;

  beforeEach(() => {
    channel = createMockChannel();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function defaultProps(overrides: Partial<Parameters<typeof useThrowables>[0]> = {}) {
    return {
      channel: channel as unknown as import('@supabase/supabase-js').RealtimeChannel,
      userId: 'user-1',
      username: 'Alice',
      layoutPlayers: LAYOUT_PLAYERS,
      myPlayerIndex: 0,
      ...overrides,
    };
  }

  it('initialises with all-null activeEffects and no incomingThrowable', () => {
    const { result } = renderHook(() => useThrowables(defaultProps()));
    expect(result.current.activeEffects).toEqual([null, null, null, null]);
    expect(result.current.incomingThrowable).toBeNull();
  });

  it('sendThrowable calls channel.send with correct payload', () => {
    const { result } = renderHook(() => useThrowables(defaultProps()));

    act(() => {
      result.current.sendThrowable(2, 'egg');
    });

    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'broadcast',
        event: 'throwable_sent',
        payload: expect.objectContaining({
          event: 'throwable_sent',
          data: expect.objectContaining({
            thrower_id: 'user-1',
            thrower_name: 'Alice',
            target_player_index: 2,
            throwable: 'egg',
          }),
        }),
      })
    );
  });

  it('incoming broadcast sets activeEffect for correct display slot', () => {
    const { result } = renderHook(() => useThrowables(defaultProps({ myPlayerIndex: 3 })));

    act(() => {
      channel._emit('throwable_sent', {
        thrower_id: 'user-2',
        thrower_name: 'Bob',
        target_player_index: 1, // top (display slot 1)
        throwable: 'smoke',
      });
    });

    expect(result.current.activeEffects[1]).toMatchObject({
      throwable: 'smoke',
      from_name: 'Bob',
    });
    // Other slots remain null
    expect(result.current.activeEffects[0]).toBeNull();
    expect(result.current.activeEffects[2]).toBeNull();
    expect(result.current.activeEffects[3]).toBeNull();
  });

  it('incomingThrowable is set only when local player is the target', () => {
    const { result } = renderHook(() => useThrowables(defaultProps({ myPlayerIndex: 0 })));

    act(() => {
      channel._emit('throwable_sent', {
        thrower_id: 'user-2',
        thrower_name: 'Bob',
        target_player_index: 0, // targeting local player
        throwable: 'confetti',
      });
    });

    expect(result.current.incomingThrowable).toMatchObject({
      throwable: 'confetti',
      from_name: 'Bob',
    });
  });

  it('incomingThrowable is NOT set when local player is NOT the target', () => {
    const { result } = renderHook(() => useThrowables(defaultProps({ myPlayerIndex: 0 })));

    act(() => {
      channel._emit('throwable_sent', {
        thrower_id: 'user-2',
        thrower_name: 'Bob',
        target_player_index: 1, // targeting top player, not us
        throwable: 'egg',
      });
    });

    expect(result.current.incomingThrowable).toBeNull();
  });

  it('activeEffect auto-dismisses after 5 seconds', () => {
    const { result } = renderHook(() => useThrowables(defaultProps({ myPlayerIndex: 3 })));

    act(() => {
      channel._emit('throwable_sent', {
        thrower_id: 'user-2',
        thrower_name: 'Bob',
        target_player_index: 1,
        throwable: 'egg',
      });
    });

    expect(result.current.activeEffects[1]).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(5_001);
    });

    expect(result.current.activeEffects[1]).toBeNull();
  });

  it('incomingThrowable auto-dismisses after 5 seconds', () => {
    const { result } = renderHook(() => useThrowables(defaultProps({ myPlayerIndex: 0 })));

    act(() => {
      channel._emit('throwable_sent', {
        thrower_id: 'user-2',
        thrower_name: 'Bob',
        target_player_index: 0,
        throwable: 'smoke',
      });
    });

    expect(result.current.incomingThrowable).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(5_001);
    });

    expect(result.current.incomingThrowable).toBeNull();
  });

  it('dismissIncoming clears incomingThrowable immediately', () => {
    const { result } = renderHook(() => useThrowables(defaultProps({ myPlayerIndex: 0 })));

    act(() => {
      channel._emit('throwable_sent', {
        thrower_id: 'user-2',
        thrower_name: 'Bob',
        target_player_index: 0,
        throwable: 'confetti',
      });
    });

    expect(result.current.incomingThrowable).not.toBeNull();

    act(() => {
      result.current.dismissIncoming();
    });

    expect(result.current.incomingThrowable).toBeNull();
  });

  it('ignores broadcasts with unknown target player_index', () => {
    const { result } = renderHook(() => useThrowables(defaultProps()));

    act(() => {
      channel._emit('throwable_sent', {
        thrower_id: 'user-2',
        thrower_name: 'Bob',
        target_player_index: 99, // not in layoutPlayers
        throwable: 'egg',
      });
    });

    expect(result.current.activeEffects).toEqual([null, null, null, null]);
  });

  it('ignores broadcasts with invalid throwable type', () => {
    const { result } = renderHook(() => useThrowables(defaultProps()));

    act(() => {
      channel._emit('throwable_sent', {
        thrower_id: 'user-2',
        thrower_name: 'Bob',
        target_player_index: 1,
        throwable: 'banana', // invalid
      });
    });

    expect(result.current.activeEffects[1]).toBeNull();
  });
});
