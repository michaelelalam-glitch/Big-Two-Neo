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
  process.env.EXPO_PUBLIC_FIREBASE_API_SECRET = apiSecret;
}

function clearEnv() {
  delete process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID;
  delete process.env.EXPO_PUBLIC_FIREBASE_API_SECRET;
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
    expect(body.events[0].params.firebase_screen).toBe('Game');
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
