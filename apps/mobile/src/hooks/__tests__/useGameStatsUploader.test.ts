/**
 * Tests for useGameStatsUploader — focused on game_session_summary analytics.
 *
 * Copilot review flagged that there were no unit tests verifying the
 * `game_session_summary` event is emitted with correct bounded params.
 */

const mockTrackGameEvent = jest.fn();

jest.mock('../../services/analytics', () => ({
  trackGameEvent: mockTrackGameEvent,
}));

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-abc' } },
        error: null,
      }),
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'tok-123' } },
        error: null,
      }),
    },
  },
}));

jest.mock('../../services/sentry', () => ({
  sentryCapture: {
    exception: jest.fn(),
    message: jest.fn(),
    breadcrumb: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  statsLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../constants', () => ({
  API: {
    SUPABASE_URL: 'https://test.supabase.co',
  },
}));

// Silence __DEV__ analytics warning in test environment
let _prevDev: any;
let _prevFetch: typeof global.fetch;
beforeAll(() => {
  _prevDev = (global as any).__DEV__;
  (global as any).__DEV__ = false;
  _prevFetch = global.fetch;
});
afterAll(() => {
  (global as any).__DEV__ = _prevDev;
  global.fetch = _prevFetch;
});

import { renderHook } from '@testing-library/react-native';
import { useGameStatsUploader } from '../useGameStatsUploader';

const STARTED_AT = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago

const PLAYERS = [
  {
    player_index: 0,
    username: 'Alice',
    user_id: 'user-abc',
    is_bot: false,
    connection_status: 'connected',
    bot_difficulty: null,
    finish_position: 1,
  },
  {
    player_index: 1,
    username: 'Bob',
    user_id: 'user-def',
    is_bot: false,
    connection_status: 'connected',
    bot_difficulty: null,
    finish_position: 2,
  },
];

const GAME_STATE = {
  game_phase: 'game_over' as const,
  winner: 0,
  game_winner_index: 0,
  final_scores: { '0': 0, '1': 43 },
  hands: { '0': [], '1': ['3S', '4H', '5D'] },
  play_history: [
    { position: 0, combo_type: 'single', passed: false },
    { position: 1, combo_type: 'pair', passed: false },
    { position: 0, combo_type: null, passed: true },
  ],
  scores_history: [
    {
      scores: [
        { player_index: 0, cumulativeScore: 0, cardsRemaining: 0 },
        { player_index: 1, cumulativeScore: 43, cardsRemaining: 3 },
      ],
    },
  ],
  match_number: 1,
  rank_points_history: null,
} as any;

const ROOM_INFO = {
  id: 'room-1',
  code: 'ABCD',
  ranked_mode: false,
  is_public: true,
  is_matchmaking: false,
} as any;

beforeEach(() => {
  jest.clearAllMocks();
  // Mock the complete-game edge function fetch
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({ success: true }),
    text: jest.fn().mockResolvedValue('{"success":true}'),
  } as any);
});

describe('useGameStatsUploader — game_session_summary', () => {
  it('emits game_session_summary once when game_phase is game_over', async () => {
    const { unmount } = renderHook(() =>
      useGameStatsUploader({
        isMultiplayerGame: true,
        multiplayerGameState: GAME_STATE,
        multiplayerPlayers: PLAYERS,
        roomInfo: ROOM_INFO,
        gameStartedAt: STARTED_AT,
      })
    );

    // Allow the async upload path to run
    await new Promise(resolve => setTimeout(resolve, 0));

    const summaryCall = mockTrackGameEvent.mock.calls.find(
      ([event]) => event === 'game_session_summary'
    );
    expect(summaryCall).toBeDefined();

    const params = summaryCall![1];
    expect(params).toMatchObject({
      game_mode: 'online_casual',
      player_count: 2,
      winner_player_index: 0,
      total_plays: 2, // 2 non-passed entries in play_history
      total_passes: 1,
    });
    // Verify string params are size-bounded (combos_by_player <= 100 chars)
    expect(typeof params.combos_by_player).toBe('string');
    expect(params.combos_by_player.length).toBeLessThanOrEqual(100);

    unmount();
  });

  it('emits game_session_summary exactly once (no duplicates on re-render)', async () => {
    const { rerender, unmount } = renderHook(
      (props: Parameters<typeof useGameStatsUploader>[0]) => useGameStatsUploader(props),
      {
        initialProps: {
          isMultiplayerGame: true,
          multiplayerGameState: GAME_STATE,
          multiplayerPlayers: PLAYERS,
          roomInfo: ROOM_INFO,
          gameStartedAt: STARTED_AT,
        },
      }
    );

    await new Promise(resolve => setTimeout(resolve, 0));

    // Re-render with the same game_over state (simulates extra state ticks)
    rerender({
      isMultiplayerGame: true,
      multiplayerGameState: { ...GAME_STATE },
      multiplayerPlayers: PLAYERS,
      roomInfo: ROOM_INFO,
      gameStartedAt: STARTED_AT,
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    const summaryCalls = mockTrackGameEvent.mock.calls.filter(
      ([event]) => event === 'game_session_summary'
    );
    expect(summaryCalls).toHaveLength(1);

    unmount();
  });
});

describe('useGameStatsUploader — complete-game fetch retry & timeout', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('retries up to MAX_RETRIES times on 5xx then succeeds', async () => {
    const { statsLogger } = jest.requireMock('../../utils/logger');

    // Override setTimeout so backoff pauses are instant during the test
    const origSetTimeout = global.setTimeout;
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((fn: TimerHandler, _delay?: number, ...args: any[]) =>
        origSetTimeout(fn as (...a: any[]) => void, 0, ...args)
      );

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: jest.fn().mockResolvedValue({}),
      } as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: jest.fn().mockResolvedValue({}),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true }),
      } as any);

    const { unmount } = renderHook(() =>
      useGameStatsUploader({
        isMultiplayerGame: true,
        multiplayerGameState: GAME_STATE,
        multiplayerPlayers: PLAYERS,
        roomInfo: ROOM_INFO,
        gameStartedAt: STARTED_AT,
      })
    );

    // Drain all pending micro/macro tasks until fetch has been called 3 times
    const MAX_WAIT_MS = 5_000;
    await new Promise<void>((resolve, reject) => {
      const startTime = Date.now();
      const check = () => {
        if ((global.fetch as jest.Mock).mock.calls.length >= 3) {
          resolve();
          return;
        }
        if (Date.now() - startTime > MAX_WAIT_MS) {
          reject(new Error('Timed out waiting for fetch to be called 3 times'));
          return;
        }
        origSetTimeout(check, 10);
      };
      check();
    });

    jest.restoreAllMocks();
    unmount();

    expect(global.fetch).toHaveBeenCalledTimes(3);
    const warnCalls: string[] = statsLogger.warn.mock.calls.map((c: any[]) => c[0] as string);
    expect(warnCalls.some(msg => msg.includes('retrying'))).toBe(true);
  });

  it('aborts a hanging fetch after timeout and calls Sentry', async () => {
    const { sentryCapture } = jest.requireMock('../../services/sentry');

    // Simulate fetch that only resolves once AbortController fires
    global.fetch = jest.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (signal) {
            signal.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            );
          }
        })
    );

    // Override setTimeout so the 30 s abort timer fires immediately
    const origSetTimeout = global.setTimeout;
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((fn: TimerHandler, _delay?: number, ...args: any[]) =>
        origSetTimeout(fn as (...a: any[]) => void, 0, ...args)
      );

    const { unmount } = renderHook(() =>
      useGameStatsUploader({
        isMultiplayerGame: true,
        multiplayerGameState: GAME_STATE,
        multiplayerPlayers: PLAYERS,
        roomInfo: ROOM_INFO,
        gameStartedAt: STARTED_AT,
      })
    );

    // Wait until Sentry exception is captured (all 3 abort attempts exhausted)
    const MAX_WAIT_MS = 5_000;
    await new Promise<void>((resolve, reject) => {
      const startTime = Date.now();
      const check = () => {
        if ((sentryCapture.exception as jest.Mock).mock.calls.length >= 1) {
          resolve();
          return;
        }
        if (Date.now() - startTime > MAX_WAIT_MS) {
          reject(new Error('Timed out waiting for Sentry exception to be captured'));
          return;
        }
        origSetTimeout(check, 10);
      };
      origSetTimeout(check, 10);
    });

    jest.restoreAllMocks();
    unmount();

    expect(sentryCapture.exception).toHaveBeenCalled();
  });
});
