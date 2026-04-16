/**
 * Tests for analytics.ts — Firebase Measurement Protocol v2 service.
 * Task #272
 */

import {
  trackEvent,
  trackScreenView,
  trackError,
  trackAuthEvent,
  trackGameEvent,
  trackGameplayAction,
  trackFeatureUsage,
  trackConnection,
  trackSocial,
  setAnalyticsConsent,
  setAnalyticsUserId,
  isAnalyticsEnabled,
  analytics,
  screenTimeStart,
  screenTimeEnd,
  setLastHintCards,
  checkHintFollowed,
  turnTimeStart,
  turnTimeEnd,
  featureDurationStart,
  featureDurationEnd,
} from '../../services/analytics';

// ─── Mocks ────────────────────────────────────────────────────────────────── //

// Mock global fetch — save original so it can be restored after all tests
const originalFetch = global.fetch;
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock expo-constants
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { version: '1.0.0' },
  },
}));

// Mock react-native Platform
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────── //

function setEnv(measurementId: string, apiSecret: string) {
  process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID = measurementId;
  // analytics.ts reads FIREBASE_TEST_API_SECRET (non-EXPO_PUBLIC_) in Jest so the
  // real secret never appears in the client bundle (P10-2 fix).
  process.env.FIREBASE_TEST_API_SECRET = apiSecret;
}

function clearEnv() {
  delete process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID;
  delete process.env.FIREBASE_TEST_API_SECRET;
}

// ─── Setup ────────────────────────────────────────────────────────────────── //

beforeEach(() => {
  mockFetch.mockResolvedValue({ ok: true });
  // Keep consent DISABLED on the top-level module instance so "does not throw"
  // tests cannot schedule background fetch() calls even if a developer has
  // EXPO_PUBLIC_FIREBASE_* env vars set in their shell.
  // Tests that need consent + credentials use jest.isolateModules() and call
  // isolatedSetConsent(true) on their own isolated module instance.
  setAnalyticsConsent(false);
  setAnalyticsUserId(null);
  clearEnv();
  jest.clearAllMocks();
  // Clear the module registry so that any subsequent require() calls (e.g. inside
  // jest.isolateModules) always load a fresh analytics module instance.
  // NOTE: this does NOT rebind the top-level ES-import bindings declared at the
  // top of this file. Those imports are intentionally kept top-level ONLY for
  // structural / "does not throw" tests whose assertions are env-var-agnostic.
  // Every test that depends on module-level constants (MEASUREMENT_ID, API_SECRET)
  // uses jest.isolateModules() or an explicit jest.resetModules() + require() to
  // obtain a hermetically-isolated module instance.
  jest.resetModules();
});

afterAll(() => {
  clearEnv();
  // Restore the original global.fetch so this mock does not leak into other test files
  global.fetch = originalFetch;
});

// ─── Tests ────────────────────────────────────────────────────────────────── //

describe('isAnalyticsEnabled', () => {
  it('returns false when credentials are not configured', () => {
    // Use isolateModules so MEASUREMENT_ID / API_SECRET are captured fresh
    // without any env vars, even if the developer has them set in their shell.
    jest.isolateModules(() => {
      clearEnv();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { isAnalyticsEnabled: freshEnabled, setAnalyticsConsent: freshSetConsent } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      freshSetConsent(true); // consent defaults to false; explicitly enable
      expect(freshEnabled()).toBe(false);
    });
  });

  it('returns true when credentials are configured and consent given', () => {
    setEnv('G-TEST123', 'secret123');
    // MEASUREMENT_ID / API_SECRET are read at module-evaluation time, so we must
    // reset the module registry and re-import to pick up the new env vars.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isAnalyticsEnabled: freshEnabled, setAnalyticsConsent: freshSetConsent } =
      require('../../services/analytics') as typeof import('../../services/analytics');
    freshSetConsent(true); // default is false (opt-in); explicitly enable
    expect(freshEnabled()).toBe(true);
  });

  it('returns false when consent is revoked', () => {
    setEnv('G-TEST123', 'secret123');
    // MEASUREMENT_ID / API_SECRET are read at module-evaluation time, so we must
    // reset the module registry and re-import to pick up the new env vars.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isAnalyticsEnabled: freshEnabled, setAnalyticsConsent: freshSetConsent } =
      require('../../services/analytics') as typeof import('../../services/analytics');
    freshSetConsent(true); // first enable so we're testing revocation
    freshSetConsent(false); // then revoke
    expect(freshEnabled()).toBe(false);
  });
});

describe('trackEvent', () => {
  it('does not call fetch when credentials are not set', async () => {
    // Use isolateModules + clearEnv so this test is hermetic even if the
    // developer has EXPO_PUBLIC_ vars set in their shell environment.
    // (Module-level constants are captured at import time, so a top-level
    // import would see whatever env vars were present when the file loaded.)
    jest.isolateModules(() => {
      clearEnv();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackEvent: isolatedTrack } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      isolatedTrack('app_open');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when consent is revoked', async () => {
    setEnv('G-TEST123', 'secret123');
    // Use isolateModules so the analytics module sees the credentials AND we can
    // properly test consent gating (credentials are module-level constants).
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackEvent: isolatedTrack, setAnalyticsConsent: isolatedSetConsent } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      isolatedSetConsent(true); // enable first so we're testing revocation
      isolatedSetConsent(false); // now revoke
      isolatedTrack('app_open');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls fetch with correct URL when credentials are set', async () => {
    setEnv('G-TESTMEASURE', 'testsecret');
    // MEASUREMENT_ID is read at module-evaluation time; use isolateModules so
    // the analytics module sees the credentials set above.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackEvent: isolatedTrack, setAnalyticsConsent: isolatedSetConsent } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      isolatedSetConsent(true); // consent defaults to false (opt-in); enable explicitly
      isolatedTrack('game_started', { mode: 'local' });
    });

    // Flush microtask queue so the fire-and-forget sendEvents promise resolves
    await Promise.resolve();
    await Promise.resolve();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    expect(url).toContain('G-TESTMEASURE');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body) as { events: Array<{ name: string }> };
    expect(body.events[0].name).toBe('game_started');
  });

  it('includes platform and app_version in params', async () => {
    setEnv('G-TESTMEASURE', 'testsecret');
    // Use isolateModules to load analytics with credentials so fetch is actually called.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackEvent: isolatedTrack, setAnalyticsConsent: isolatedSetConsent } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      isolatedSetConsent(true);
      isolatedTrack('game_started');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(options.body) as { events: Array<{ params: Record<string, unknown> }> };
    expect(body.events[0].params).toHaveProperty('platform');
    expect(body.events[0].params).toHaveProperty('app_version');
  });

  it('swallows fetch errors silently', async () => {
    setEnv('G-TESTMEASURE', 'testsecret');
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    // Use isolateModules to load analytics with credentials so the error path is exercised.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackEvent: isolatedTrack, setAnalyticsConsent: isolatedSetConsent } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      isolatedSetConsent(true);
      expect(() => isolatedTrack('error_occurred')).not.toThrow();
    });
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe('trackScreenView', () => {
  it('does not throw', () => {
    expect(() => trackScreenView('HomeScreen')).not.toThrow();
  });

  it('accepts optional screenClass', () => {
    expect(() => trackScreenView('GameScreen', 'GameScreenClass')).not.toThrow();
  });

  it('calls fetch when credentials and consent are set', async () => {
    setEnv('G-TESTMEASURE', 'testsecret');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackScreenView: isolatedTrackScreen, setAnalyticsConsent: isolatedSetConsent } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      isolatedSetConsent(true);
      isolatedTrackScreen('HomeScreen');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(options.body) as { events: Array<{ name: string }> };
    expect(body.events[0].name).toBe('screen_view');
  });
});

describe('trackError', () => {
  it('does not throw', () => {
    expect(() => trackError('TestContext', 'Something failed')).not.toThrow();
  });

  it('accepts fatal flag', () => {
    expect(() => trackError('TestContext', 'Fatal error', true)).not.toThrow();
  });
});

describe('trackAuthEvent', () => {
  it('tracks user_signed_in', () => {
    expect(() => trackAuthEvent('user_signed_in', 'google')).not.toThrow();
  });

  it('tracks user_signed_out', () => {
    expect(() => trackAuthEvent('user_signed_out')).not.toThrow();
  });
});

describe('trackGameEvent', () => {
  it('tracks game_started', () => {
    expect(() =>
      trackGameEvent('game_started', { mode: 'multiplayer', player_count: 4 })
    ).not.toThrow();
  });

  it('tracks game_completed', () => {
    expect(() => trackGameEvent('game_completed', { winner: 'player1' })).not.toThrow();
  });

  it('tracks game_abandoned', () => {
    expect(() => trackGameEvent('game_abandoned')).not.toThrow();
  });
});

describe('setAnalyticsConsent', () => {
  it('can be toggled on and off without throwing', () => {
    expect(() => {
      setAnalyticsConsent(false);
      setAnalyticsConsent(true);
    }).not.toThrow();
  });
});

describe('setAnalyticsUserId', () => {
  it('accepts a user ID string', () => {
    expect(() => setAnalyticsUserId('user-123')).not.toThrow();
  });

  it('accepts null to clear user', () => {
    expect(() => setAnalyticsUserId(null)).not.toThrow();
  });
});

describe('analytics convenience object', () => {
  it('exposes track, screenView, error, setUserId, setConsent, isEnabled', () => {
    expect(typeof analytics.track).toBe('function');
    expect(typeof analytics.screenView).toBe('function');
    expect(typeof analytics.error).toBe('function');
    expect(typeof analytics.setUserId).toBe('function');
    expect(typeof analytics.setConsent).toBe('function');
    expect(typeof analytics.isEnabled).toBe('function');
  });

  it('exposes gameplay, feature, connection, social, game, auth helpers', () => {
    expect(typeof analytics.gameplay).toBe('function');
    expect(typeof analytics.feature).toBe('function');
    expect(typeof analytics.connection).toBe('function');
    expect(typeof analytics.social).toBe('function');
    expect(typeof analytics.game).toBe('function');
    expect(typeof analytics.auth).toBe('function');
  });
});

describe('trackGameplayAction', () => {
  it('does not throw for card_play', () => {
    expect(() => trackGameplayAction('card_play', { combo: 'pair' })).not.toThrow();
  });

  it('does not throw for card_pass', () => {
    expect(() => trackGameplayAction('card_pass')).not.toThrow();
  });

  it('does not throw for play_error', () => {
    expect(() => trackGameplayAction('play_error', { reason: 'invalid' })).not.toThrow();
  });

  it('calls fetch when credentials and consent are set', async () => {
    setEnv('G-TESTMEASURE', 'testsecret');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackGameplayAction: isolatedAction, setAnalyticsConsent: isolatedSetConsent } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      isolatedSetConsent(true);
      isolatedAction('card_play', { combo: 'straight' });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(options.body) as { events: Array<{ name: string }> };
    expect(body.events[0].name).toBe('card_play');
  });
});

describe('trackFeatureUsage', () => {
  it('does not throw', () => {
    expect(() => trackFeatureUsage('chat', { source: 'game' })).not.toThrow();
  });

  it('calls fetch with feature_name param when enabled', async () => {
    setEnv('G-TESTMEASURE', 'testsecret');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackFeatureUsage: isolatedFeature, setAnalyticsConsent: isolatedSetConsent } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      isolatedSetConsent(true);
      isolatedFeature('camera');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(options.body) as {
      events: Array<{ name: string; params: Record<string, unknown> }>;
    };
    expect(body.events[0].name).toBe('feature_used');
    expect(body.events[0].params.feature_name).toBe('camera');
  });

  it('feature_name cannot be overridden by caller params', async () => {
    setEnv('G-TESTMEASURE', 'testsecret');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackFeatureUsage: isolatedFeature, setAnalyticsConsent: isolatedSetConsent } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      isolatedSetConsent(true);
      isolatedFeature('camera', { feature_name: 'hacked' });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(options.body) as { events: Array<{ params: Record<string, unknown> }> };
    expect(body.events[0].params.feature_name).toBe('camera');
  });
});

describe('trackConnection', () => {
  it('does not throw for disconnect', () => {
    expect(() => trackConnection('disconnect')).not.toThrow();
  });

  it('does not throw for reconnect', () => {
    expect(() => trackConnection('reconnect', { duration_ms: 500 })).not.toThrow();
  });
});

describe('trackSocial', () => {
  it('does not throw for friend_added', () => {
    expect(() => trackSocial('friend_added')).not.toThrow();
  });

  it('does not throw for room_created', () => {
    expect(() => trackSocial('room_created', { room_type: 'private' })).not.toThrow();
  });

  it('does not throw for matchmaking_started', () => {
    expect(() => trackSocial('matchmaking_started')).not.toThrow();
  });
});

// ─── Screen Time Tracking ─────────────────────────────────────────────────── //

describe('screenTimeStart / screenTimeEnd', () => {
  it('suppresses zero-duration screen_time events', async () => {
    jest.isolateModules(() => {
      setEnv('G-TEST123', 'test-secret');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {
        screenTimeStart: start,
        screenTimeEnd: end,
        setAnalyticsConsent: consent,
      } = require('../../services/analytics') as typeof import('../../services/analytics');
      consent(true);

      // Simulate screen start and immediate end (duration rounds to 0 → suppressed)
      start('Home');
      end('Home');
    });
    // zero-duration events should be suppressed
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('emits screen_time with duration when time is positive', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000); // start time
    nowSpy.mockReturnValueOnce(5000); // end time (4s)
    jest.isolateModules(() => {
      setEnv('G-TEST123', 'test-secret');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {
        screenTimeStart: start,
        screenTimeEnd: end,
        setAnalyticsConsent: consent,
      } = require('../../services/analytics') as typeof import('../../services/analytics');
      consent(true);
      start('Game');
      end('Game');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(options.body) as {
      events: Array<{ name: string; params: Record<string, unknown> }>;
    };
    expect(body.events[0].name).toBe('screen_time');
    expect(body.events[0].params.screen_name).toBe('Game');
    expect(body.events[0].params.duration_seconds).toBe(4);
    nowSpy.mockRestore();
  });

  it('does not throw when ending a screen that was never started', () => {
    expect(() => screenTimeEnd('NonExistent')).not.toThrow();
  });

  it('does not throw for start/end calls', () => {
    expect(() => {
      screenTimeStart('Test');
      screenTimeEnd('Test');
    }).not.toThrow();
  });
});

// ─── Hint Tracking ────────────────────────────────────────────────────────── //

describe('setLastHintCards / checkHintFollowed', () => {
  it('emits hint_result_played when played cards match hint', async () => {
    jest.isolateModules(() => {
      setEnv('G-TEST123', 'test-secret');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {
        setLastHintCards: setHint,
        checkHintFollowed: check,
        setAnalyticsConsent: consent,
      } = require('../../services/analytics') as typeof import('../../services/analytics');
      consent(true);
      setHint(['card_1', 'card_2']);
      check(['card_1', 'card_2']);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(options.body) as { events: Array<{ name: string }> };
    expect(body.events[0].name).toBe('hint_result_played');
  });

  it('emits hint_result_ignored when played cards differ from hint', async () => {
    jest.isolateModules(() => {
      setEnv('G-TEST123', 'test-secret');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {
        setLastHintCards: setHint,
        checkHintFollowed: check,
        setAnalyticsConsent: consent,
      } = require('../../services/analytics') as typeof import('../../services/analytics');
      consent(true);
      setHint(['card_1', 'card_2']);
      check(['card_3', 'card_4']);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(options.body) as { events: Array<{ name: string }> };
    expect(body.events[0].name).toBe('hint_result_ignored');
  });

  it('does not emit when no hint was set', () => {
    checkHintFollowed(['card_1']);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('clears hint state after checking', () => {
    setLastHintCards(['card_1']);
    checkHintFollowed(['card_1']);
    // Second call should be a no-op (hint cleared)
    mockFetch.mockClear();
    checkHintFollowed(['card_1']);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── Turn Time Tracking ───────────────────────────────────────────────────── //

describe('turnTimeStart / turnTimeEnd', () => {
  it('does not throw for start/end cycle', () => {
    expect(() => {
      turnTimeStart();
      turnTimeEnd('play');
    }).not.toThrow();
  });

  it('does not throw for timeout action', () => {
    expect(() => {
      turnTimeStart();
      turnTimeEnd('timeout');
    }).not.toThrow();
  });

  it('does not emit when end is called without start', () => {
    turnTimeEnd('pass');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── Feature Duration Helpers ─────────────────────────────────────────────── //

describe('featureDurationStart / featureDurationEnd', () => {
  it('does not throw for start/end cycle', () => {
    expect(() => {
      featureDurationStart('camera');
      featureDurationEnd('camera', 'camera_session_duration');
    }).not.toThrow();
  });

  it('does not emit when end is called without start', () => {
    featureDurationEnd('nonexistent_feature', 'camera_session_duration');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('clears state after ending', () => {
    featureDurationStart('mic');
    featureDurationEnd('mic', 'microphone_session_duration');
    // Second end should not emit
    mockFetch.mockClear();
    featureDurationEnd('mic', 'microphone_session_duration');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('emits correct event and params when duration is positive', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000); // start time
    nowSpy.mockReturnValueOnce(4000); // end time (3s)
    jest.isolateModules(() => {
      setEnv('G-TEST123', 'test-secret');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {
        featureDurationStart: start,
        featureDurationEnd: end,
        setAnalyticsConsent: consent,
      } = require('../../services/analytics') as typeof import('../../services/analytics');
      consent(true);
      start('mic');
      end('mic', 'microphone_session_duration');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(options.body) as {
      events: Array<{ name: string; params: Record<string, unknown> }>;
    };
    expect(body.events[0].name).toBe('microphone_session_duration');
    expect(body.events[0].params.feature_name).toBe('mic');
    expect(body.events[0].params.duration_ms).toBe(3000);
    nowSpy.mockRestore();
  });
});

// ─── BigQuery Full-Fidelity Parameter Tests ────────────────────────────────── //
// These tests verify that every event type emits the correct payload shape in the
// direct-to-GA4 path (USE_PROXY=false in Jest). They do NOT exercise the proxy or
// the analytics_raw_events DB insert — those paths require integration tests
// against a live Supabase instance. In production (USE_PROXY=true), the proxy
// receives full untruncated params and saves them verbatim to analytics_raw_events
// before forwarding truncated data to GA4.

/**
 * Shared helper: fires a single analytics event in Jest's direct-to-GA4 mode
 * (USE_PROXY=false) and returns the parsed fetch body so callers can assert on
 * event name, params, and GA4 payload structure.
 */
async function expectEventSent(
  name: import('../../services/analytics').AnalyticsEventName,
  params?: Record<string, string | number>
): Promise<{ events: Array<{ name: string; params: Record<string, unknown> }> }> {
  setEnv('G-TESTMEASURE', 'testsecret');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { trackEvent: isolatedTrack, setAnalyticsConsent: isolatedSetConsent } =
      require('../../services/analytics') as typeof import('../../services/analytics');
    isolatedSetConsent(true);
    isolatedTrack(name, params);
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
  return JSON.parse(options.body) as {
    events: Array<{ name: string; params: Record<string, unknown> }>;
  };
}

describe('BigQuery: client-side truncation IS enforced in direct-GA4 mode (USE_PROXY=false / Jest)', () => {
  it('enforces 100-char limit on long string params in direct-GA4 mode', async () => {
    // In Jest mode USE_PROXY=false → client-side truncation IS applied.
    const longString = 'x'.repeat(200);
    setEnv('G-TESTMEASURE', 'testsecret');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackEvent: isolatedTrack, setAnalyticsConsent: isolatedSetConsent } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      isolatedSetConsent(true);
      isolatedTrack('game_completed', { standings_json: longString });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(options.body) as {
      events: Array<{ params: Record<string, unknown> }>;
    };
    // In direct-GA4 mode (Jest), client enforces 100-char limit
    expect((body.events[0].params.standings_json as string).length).toBeLessThanOrEqual(100);
  });

  it('does not truncate numeric params', async () => {
    setEnv('G-TESTMEASURE', 'testsecret');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackEvent: isolatedTrack, setAnalyticsConsent: isolatedSetConsent } =
        require('../../services/analytics') as typeof import('../../services/analytics');
      isolatedSetConsent(true);
      isolatedTrack('game_session_summary', {
        match_count: 10,
        total_score: 500,
        win_count: 7,
        loss_count: 3,
      });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(options.body) as {
      events: Array<{ params: Record<string, unknown> }>;
    };
    // Numeric params must never be truncated
    expect(body.events[0].params.match_count).toBe(10);
    expect(body.events[0].params.total_score).toBe(500);
    expect(body.events[0].params.win_count).toBe(7);
    expect(body.events[0].params.loss_count).toBe(3);
  });
});

describe('BigQuery: comprehensive event coverage — core lifecycle', () => {
  const EVENTS_TO_TEST: Array<{
    name: import('../../services/analytics').AnalyticsEventName;
    params?: Record<string, string | number>;
  }> = [
    { name: 'app_open', params: { source: 'cold_start', first_launch: 1 } },
    // trackAuthEvent('user_signed_in', method) only passes { method } to trackEvent
    { name: 'user_signed_in', params: { method: 'google' } },
    // trackAuthEvent('user_signed_out') passes no event-specific params
    { name: 'user_signed_out' },
    { name: 'screen_view', params: { screen_name: 'GameScreen', screen_class: 'GameScreen' } },
    { name: 'screen_time', params: { screen_name: 'HomeScreen', duration_seconds: 30 } },
    {
      name: 'error_occurred',
      params: { error_context: 'game_start', error_message: 'room not found', fatal: 0 },
    },
    { name: 'feature_used', params: { feature_name: 'hint', source: 'game' } },
  ];

  it.each(EVENTS_TO_TEST)('$name fires with all expected params', async ({ name, params }) => {
    const body = await expectEventSent(name, params);
    expect(body.events[0].name).toBe(name);
    expect(body.events[0].params).toHaveProperty('platform');
    expect(body.events[0].params).toHaveProperty('app_version');
    if (params) {
      for (const key of Object.keys(params)) {
        expect(body.events[0].params).toHaveProperty(key);
      }
    }
  });
});

describe('BigQuery: comprehensive event coverage — game lifecycle', () => {
  const EVENTS_TO_TEST: Array<{
    name: import('../../services/analytics').AnalyticsEventName;
    params?: Record<string, string | number>;
  }> = [
    {
      name: 'game_started',
      params: { mode: 'multiplayer', player_count: 4, room_code: 'ABCD', bot_count: 0 },
    },
    {
      name: 'game_completed',
      params: { mode: 'multiplayer', winner_position: 1, match_count: 3, duration_seconds: 900 },
    },
    {
      name: 'game_abandoned',
      params: { mode: 'multiplayer', reason: 'user_quit', match_count: 2, duration_seconds: 300 },
    },
    {
      name: 'game_voided',
      params: { reason: 'insufficient_players', match_count: 1 },
    },
    {
      name: 'game_not_completed',
      params: { reason: 'disconnect', match_count: 1 },
    },
    {
      name: 'game_session_summary',
      params: {
        match_count: 5,
        win_count: 3,
        loss_count: 2,
        total_score: 150,
        avg_turn_duration_ms: 4200,
      },
    },
  ];

  it.each(EVENTS_TO_TEST)('$name fires with all expected params', async ({ name, params }) => {
    const body = await expectEventSent(name, params);
    expect(body.events[0].name).toBe(name);
    expect(body.events[0].params).toHaveProperty('platform');
    expect(body.events[0].params).toHaveProperty('app_version');
    if (params) {
      for (const key of Object.keys(params)) {
        expect(body.events[0].params).toHaveProperty(key);
      }
    }
  });
});

describe('BigQuery: comprehensive event coverage — gameplay actions', () => {
  const EVENTS_TO_TEST: Array<{
    name: import('../../services/analytics').AnalyticsEventName;
    params?: Record<string, string | number>;
  }> = [
    {
      name: 'card_play',
      params: { combo_type: 'pair', rank: 'ace', suit: 'spades', card_count: 2 },
    },
    { name: 'card_pass', params: { hand_size: 8, turn_number: 5 } },
    { name: 'combo_played', params: { combo_type: 'straight_flush', card_count: 5, rank: 'king' } },
    { name: 'turn_started', params: { turn_number: 3, hand_size: 10, is_first_turn: 0 } },
    { name: 'turn_completed', params: { turn_number: 3, action: 'play', duration_ms: 3500 } },
    {
      name: 'play_error',
      params: { reason: 'lower_than_table', combo_type: 'single', hand_size: 7 },
    },
    { name: 'play_validation_error', params: { error_code: 'INVALID_COMBO', combo_type: 'pair' } },
    { name: 'turn_duration', params: { duration_ms: 5000, action: 'play', turn_number: 4 } },
  ];

  it.each(EVENTS_TO_TEST)('$name fires with all expected params', async ({ name, params }) => {
    const body = await expectEventSent(name, params);
    expect(body.events[0].name).toBe(name);
    if (params) {
      for (const key of Object.keys(params)) {
        expect(body.events[0].params).toHaveProperty(key);
      }
    }
  });
});

describe('BigQuery: comprehensive event coverage — game features', () => {
  const EVENTS_TO_TEST: Array<{
    name: import('../../services/analytics').AnalyticsEventName;
    params?: Record<string, string | number>;
  }> = [
    { name: 'chat_opened', params: { source: 'game_screen' } },
    { name: 'chat_message_sent', params: { message_length: 42, source: 'game_screen' } },
    { name: 'chat_closed', params: { session_duration_seconds: 90 } },
    { name: 'chat_session_duration', params: { duration_ms: 90000, message_count: 5 } },
    { name: 'camera_toggled', params: { enabled: 1, source: 'game_screen' } },
    { name: 'camera_session_duration', params: { feature_name: 'camera', duration_ms: 60000 } },
    { name: 'microphone_toggled', params: { enabled: 1, source: 'game_screen' } },
    {
      name: 'microphone_session_duration',
      params: { feature_name: 'microphone', duration_ms: 45000 },
    },
    { name: 'video_chat_connected', params: { peer_count: 3, connection_time_ms: 1200 } },
    {
      name: 'video_chat_disconnected',
      params: { reason: 'user_action', session_duration_ms: 120000 },
    },
    {
      name: 'video_chat_session_duration',
      params: { feature_name: 'video_chat', duration_ms: 120000 },
    },
    {
      name: 'video_chat_permission_denied',
      params: { permission_type: 'camera', source: 'game_screen' },
    },
    { name: 'throwable_sent', params: { throwable_type: 'tomato', target_player: 2 } },
    { name: 'throwable_received', params: { throwable_type: 'tomato', from_player: 1 } },
    { name: 'hint_used', params: { hand_size: 8, combo_type: 'single' } },
    { name: 'hint_result_played', params: { hand_size: 7, combo_type: 'pair' } },
    { name: 'hint_result_ignored', params: { hand_size: 7, combo_type: 'pair' } },
    { name: 'hint_no_valid_play', params: { hand_size: 5 } },
    { name: 'sort_used', params: { sort_type: 'value', hand_size: 12 } },
    { name: 'smart_sort_used', params: { hand_size: 13, combos_detected: 3 } },
    { name: 'orientation_changed', params: { orientation: 'landscape', previous: 'portrait' } },
    {
      name: 'orientation_session_duration',
      params: { feature_name: 'orientation', duration_ms: 30000 },
    },
    { name: 'play_method_used', params: { method: 'tap', action: 'play' } },
    { name: 'card_rearranged', params: { hand_size: 10, rearrange_count: 3 } },
    { name: 'room_join_method', params: { method: 'qr_code', room_code: 'ABCD' } },
    { name: 'play_history_viewed', params: { match_number: 2, history_length: 5 } },
    {
      name: 'play_history_session_duration',
      params: { feature_name: 'play_history', duration_ms: 15000 },
    },
    { name: 'scoreboard_expanded', params: { match_number: 1, player_count: 4 } },
    {
      name: 'scoreboard_session_duration',
      params: { feature_name: 'scoreboard', duration_ms: 8000 },
    },
  ];

  it.each(EVENTS_TO_TEST)('$name fires with all expected params', async ({ name, params }) => {
    const body = await expectEventSent(name, params);
    expect(body.events[0].name).toBe(name);
    if (params) {
      for (const key of Object.keys(params)) {
        expect(body.events[0].params).toHaveProperty(key);
      }
    }
  });
});

describe('BigQuery: comprehensive event coverage — social & connection & navigation & settings', () => {
  const EVENTS_TO_TEST: Array<{
    name: import('../../services/analytics').AnalyticsEventName;
    params?: Record<string, string | number>;
  }> = [
    // Social
    { name: 'friend_added', params: { source: 'game_end', friend_count: 5 } },
    { name: 'friend_removed', params: { source: 'profile', friend_count: 4 } },
    { name: 'room_created', params: { room_type: 'private', player_limit: 4, bot_count: 0 } },
    { name: 'room_joined', params: { room_type: 'private', method: 'room_code', player_count: 3 } },
    { name: 'matchmaking_started', params: { mode: 'ranked', region: 'us-east' } },
    { name: 'matchmaking_cancelled', params: { mode: 'ranked', wait_time_seconds: 45 } },
    {
      name: 'matchmaking_found',
      params: { mode: 'ranked', wait_time_seconds: 23, player_count: 4 },
    },
    // Connection
    {
      name: 'disconnect',
      params: { reason: 'network', duration_seconds: 5, reconnect_attempted: 1 },
    },
    { name: 'reconnect', params: { attempt_count: 1, duration_ms: 2000 } },
    { name: 'reconnect_attempted', params: { attempt_number: 2, backoff_ms: 4000 } },
    { name: 'reconnect_succeeded', params: { attempt_count: 3, total_duration_ms: 8000 } },
    { name: 'reconnect_failed', params: { attempt_count: 5, reason: 'timeout' } },
    { name: 'connection_status_changed', params: { status: 'offline', previous_status: 'online' } },
    {
      name: 'player_replaced_by_bot',
      params: { position: 2, reason: 'disconnect', turn_number: 8 },
    },
    { name: 'heartbeat_backoff', params: { backoff_seconds: 30, consecutive_failures: 3 } },
    { name: 'app_state_changed', params: { state: 'background', previous_state: 'active' } },
    { name: 'room_closed_while_away', params: { room_code: 'ABCD', away_duration_seconds: 120 } },
    // Navigation / session
    { name: 'session_start', params: { source: 'app_open', user_type: 'returning' } },
    { name: 'session_end', params: { duration_seconds: 1800, screen_count: 8 } },
    { name: 'deep_link_received', params: { type: 'room_invite', room_code: 'XYZW' } },
    // Settings
    {
      name: 'setting_changed',
      params: { setting_name: 'sound_enabled', old_value: 1, new_value: 0 },
    },
    { name: 'language_changed', params: { from: 'en', to: 'zh' } },
    { name: 'cache_cleared', params: { cache_size_kb: 2048, items_cleared: 150 } },
    { name: 'delete_account_initiated', params: { source: 'settings', step: 1 } },
    { name: 'delete_account_confirmed', params: { source: 'settings' } },
    {
      name: 'bug_report_submitted',
      params: { category: 'gameplay', severity: 2, has_screenshot: 1 },
    },
    { name: 'bug_report_opened', params: { source: 'settings' } },
  ];

  it.each(EVENTS_TO_TEST)('$name fires with all expected params', async ({ name, params }) => {
    const body = await expectEventSent(name, params);
    expect(body.events[0].name).toBe(name);
    if (params) {
      for (const key of Object.keys(params)) {
        expect(body.events[0].params).toHaveProperty(key);
      }
    }
  });
});

describe('BigQuery: all events include mandatory base params (platform, app_version, session_id, engagement_time_msec)', () => {
  const ALL_EVENT_NAMES: import('../../services/analytics').AnalyticsEventName[] = [
    'app_open',
    'user_signed_in',
    'user_signed_out',
    'screen_view',
    'screen_time',
    'error_occurred',
    'feature_used',
    'game_started',
    'game_completed',
    'game_abandoned',
    'game_voided',
    'game_not_completed',
    'game_session_summary',
    'card_play',
    'card_pass',
    'combo_played',
    'turn_started',
    'turn_completed',
    'play_error',
    'play_validation_error',
    'turn_duration',
    'chat_opened',
    'chat_message_sent',
    'chat_closed',
    'chat_session_duration',
    'camera_toggled',
    'camera_session_duration',
    'microphone_toggled',
    'microphone_session_duration',
    'video_chat_connected',
    'video_chat_disconnected',
    'video_chat_session_duration',
    'video_chat_permission_denied',
    'throwable_sent',
    'throwable_received',
    'hint_used',
    'hint_result_played',
    'hint_result_ignored',
    'hint_no_valid_play',
    'sort_used',
    'smart_sort_used',
    'orientation_changed',
    'orientation_session_duration',
    'play_method_used',
    'card_rearranged',
    'room_join_method',
    'play_history_viewed',
    'play_history_session_duration',
    'scoreboard_expanded',
    'scoreboard_session_duration',
    'friend_added',
    'friend_removed',
    'room_created',
    'room_joined',
    'matchmaking_started',
    'matchmaking_cancelled',
    'matchmaking_found',
    'disconnect',
    'reconnect',
    'reconnect_attempted',
    'reconnect_succeeded',
    'reconnect_failed',
    'connection_status_changed',
    'player_replaced_by_bot',
    'heartbeat_backoff',
    'app_state_changed',
    'room_closed_while_away',
    'session_start',
    'session_end',
    'deep_link_received',
    'setting_changed',
    'language_changed',
    'cache_cleared',
    'delete_account_initiated',
    'delete_account_confirmed',
    'bug_report_submitted',
    'bug_report_opened',
  ];

  it.each(ALL_EVENT_NAMES)(
    '%s includes platform, app_version, session_id, engagement_time_msec',
    async name => {
      const body = await expectEventSent(name);
      expect(body.events[0].name).toBe(name);
      // Every BigQuery row must have these base params for event attribution
      expect(body.events[0].params).toHaveProperty('platform');
      expect(body.events[0].params).toHaveProperty('app_version');
      expect(body.events[0].params).toHaveProperty('session_id');
      expect(body.events[0].params).toHaveProperty('engagement_time_msec', 100);
    }
  );
});
