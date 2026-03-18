/**
 * Unit tests for useGameChat hook (Task #648).
 */
import { renderHook, act } from '@testing-library/react-native';
import { useGameChat } from '../useGameChat';

// Mock soundManager so audio is never actually played in tests and we can
// assert playSound calls (Copilot PR-151 r2951116747).
// Note: jest.mock() is hoisted, so the factory must not reference outer `const`
// variables declared in this module. Retrieve the mock via jest.requireMock().
jest.mock('../../utils/soundManager', () => ({
  soundManager: { playSound: jest.fn().mockResolvedValue(undefined) },
  SoundType: { CHAT_MESSAGE: 'chat_message' },
}));

// Mock channel
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
    // Helper to simulate incoming broadcast. Supabase delivers the `payload`
    // field of channel.send() directly as the callback argument, so we pass
    // { data } to match the envelope shape used by useGameChat.sendMessage.
    _emit(event: string, data: unknown) {
      const key = `broadcast:${event}`;
      (handlers[key] ?? []).forEach((h) => h({ data }));
    },
    // Helper to emit a raw payload object — used to test the fallback
    // `payload.payload.data` shape (Copilot PR-150 r2950068913).
    _emitRaw(event: string, rawPayload: unknown) {
      const key = `broadcast:${event}`;
      (handlers[key] ?? []).forEach((h) => h(rawPayload));
    },
  };
}

describe('useGameChat', () => {
  let channelRef: { current: ReturnType<typeof createMockChannel> | null };

  beforeEach(() => {
    channelRef = { current: createMockChannel() };
    jest.useFakeTimers();
    // Reset the hoisted mock between tests.
    const { soundManager } = jest.requireMock('../../utils/soundManager') as {
      soundManager: { playSound: jest.Mock };
    };
    soundManager.playSound.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const defaultProps = () => ({
    channel: channelRef.current as unknown as import('@supabase/supabase-js').RealtimeChannel | null,
    userId: 'user-1',
    username: 'Alice',
    isDrawerOpen: true,
  });

  it('starts with empty messages', () => {
    const { result } = renderHook(() => useGameChat(defaultProps()));
    expect(result.current.messages).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.isCooldown).toBe(false);
  });

  it('sends a message via channel broadcast', () => {
    const { result } = renderHook(() => useGameChat(defaultProps()));

    act(() => {
      result.current.sendMessage('hello');
    });

    expect(channelRef.current!.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'broadcast',
        event: 'chat_message',
        payload: expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-1',
            username: 'Alice',
            message: 'hello',
          }),
        }),
      }),
    );

    // Optimistic local add
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].message).toBe('hello');
  });

  it('enforces 2-second cooldown between sends', () => {
    const { result } = renderHook(() => useGameChat(defaultProps()));

    act(() => {
      result.current.sendMessage('first');
    });
    expect(result.current.isCooldown).toBe(true);

    act(() => {
      result.current.sendMessage('second'); // should be ignored
    });
    // Only one message sent
    expect(result.current.messages).toHaveLength(1);

    // After cooldown elapses
    act(() => {
      jest.advanceTimersByTime(2100);
    });
    expect(result.current.isCooldown).toBe(false);

    act(() => {
      result.current.sendMessage('second'); // now should work
    });
    expect(result.current.messages).toHaveLength(2);
  });

  it('filters profanity in outgoing messages', () => {
    const { result } = renderHook(() => useGameChat(defaultProps()));

    // Use reversed encoding to avoid plaintext offensive word in test source.
    const profaneInput = 'kcuf'.split('').reverse().join('');
    act(() => {
      result.current.sendMessage(`what the ${profaneInput}`);
    });

    expect(result.current.messages[0].message).toBe('what the ***');
  });

  it('receives messages from other players', () => {
    const { result } = renderHook(() => useGameChat(defaultProps()));

    act(() => {
      channelRef.current!._emit('chat_message', {
        id: 'remote-1',
        user_id: 'user-2',
        username: 'Bob',
        message: 'hey!',
        created_at: new Date().toISOString(),
      });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].username).toBe('Bob');
  });

  it('increments unreadCount when drawer is closed', () => {
    const { result } = renderHook(() =>
      useGameChat({ ...defaultProps(), isDrawerOpen: false }),
    );

    act(() => {
      channelRef.current!._emit('chat_message', {
        id: 'remote-1',
        user_id: 'user-2',
        username: 'Bob',
        message: 'hey',
        created_at: new Date().toISOString(),
      });
    });

    expect(result.current.unreadCount).toBe(1);
  });

  it('does not increment unread for own messages', () => {
    const { result } = renderHook(() =>
      useGameChat({ ...defaultProps(), isDrawerOpen: false }),
    );

    act(() => {
      channelRef.current!._emit('chat_message', {
        id: 'local-1',
        user_id: 'user-1',
        username: 'Alice',
        message: 'my own',
        created_at: new Date().toISOString(),
      });
    });

    expect(result.current.unreadCount).toBe(0);
  });

  it('rejects empty or whitespace-only messages', () => {
    const { result } = renderHook(() => useGameChat(defaultProps()));

    act(() => {
      result.current.sendMessage('');
      result.current.sendMessage('   ');
    });

    expect(result.current.messages).toHaveLength(0);
    expect(channelRef.current!.send).not.toHaveBeenCalled();
  });

  it('caps messages at 100', () => {
    const { result } = renderHook(() => useGameChat(defaultProps()));

    // Simulate 110 incoming messages
    act(() => {
      for (let i = 0; i < 110; i++) {
        channelRef.current!._emit('chat_message', {
          id: `msg-${i}`,
          user_id: 'user-2',
          username: 'Bob',
          message: `msg ${i}`,
          created_at: new Date().toISOString(),
        });
      }
    });

    expect(result.current.messages.length).toBeLessThanOrEqual(100);
  });

  it('receives messages via nested payload.payload.data shape (fallback)', () => {
    // Covers the fallback branch in the receive handler where Supabase delivers
    // `{ payload: { data: msg } }` instead of `{ data: msg }` directly
    // (Copilot PR-150 r2950068913).
    const { result } = renderHook(() => useGameChat(defaultProps()));

    act(() => {
      channelRef.current!._emitRaw('chat_message', {
        // No top-level `data` — only the nested shape
        payload: {
          data: {
            id: 'nested-1',
            user_id: 'user-2',
            username: 'Carol',
            message: 'nested payload',
            created_at: new Date().toISOString(),
          },
        },
      });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].username).toBe('Carol');
  });

  it('deduplicates messages with the same id', () => {
    // Prevents optimistic-add + broadcast-echo from creating duplicates
    // (Copilot PR-150 r2950068891).
    const { result } = renderHook(() => useGameChat(defaultProps()));
    const msg = {
      id: 'dup-1',
      user_id: 'user-2',
      username: 'Dave',
      message: 'hello',
      created_at: new Date().toISOString(),
    };

    act(() => {
      channelRef.current!._emit('chat_message', msg);
      channelRef.current!._emit('chat_message', msg); // duplicate
    });

    expect(result.current.messages).toHaveLength(1);
  });

  // ── Sound notification tests (Copilot PR-151 r2951116747) ────────────────

  it('plays CHAT_MESSAGE sound for incoming messages from other players', () => {
    const { soundManager, SoundType } = jest.requireMock('../../utils/soundManager') as {
      soundManager: { playSound: jest.Mock };
      SoundType: { CHAT_MESSAGE: string };
    };
    const { result } = renderHook(() => useGameChat(defaultProps()));

    act(() => {
      channelRef.current!._emit('chat_message', {
        id: 'sound-1',
        user_id: 'user-2',
        username: 'Bob',
        message: 'ping!',
        created_at: new Date().toISOString(),
      });
    });

    expect(soundManager.playSound).toHaveBeenCalledWith(SoundType.CHAT_MESSAGE);
  });

  it('does NOT play sound for own outgoing messages received via broadcast echo', () => {
    const { soundManager } = jest.requireMock('../../utils/soundManager') as {
      soundManager: { playSound: jest.Mock };
    };
    const { result } = renderHook(() => useGameChat(defaultProps()));

    act(() => {
      channelRef.current!._emit('chat_message', {
        id: 'own-1',
        user_id: 'user-1', // same as localUserId ('user-1')
        username: 'Alice',
        message: 'my own message',
        created_at: new Date().toISOString(),
      });
    });

    expect(soundManager.playSound).not.toHaveBeenCalled();
  });
});
