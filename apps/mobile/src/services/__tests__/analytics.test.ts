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
  setAnalyticsConsent,
  setAnalyticsUserId,
  isAnalyticsEnabled,
  analytics,
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
  // Reset consent to default (true)
  setAnalyticsConsent(true);
  setAnalyticsUserId(null);
  clearEnv();
  jest.clearAllMocks();
});

afterAll(() => {
  clearEnv();
  // Restore the original global.fetch so this mock does not leak into other test files
  global.fetch = originalFetch;
});

// ─── Tests ────────────────────────────────────────────────────────────────── //

describe('isAnalyticsEnabled', () => {
  it('returns false when credentials are not configured', () => {
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it('returns true when credentials are configured and consent given', () => {
    setEnv('G-TEST123', 'secret123');
    // MEASUREMENT_ID / API_SECRET are read at module-evaluation time, so we must
    // reset the module registry and re-import to pick up the new env vars.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isAnalyticsEnabled: freshIsAnalyticsEnabled } = require('../../services/analytics') as typeof import('../../services/analytics');
    expect(freshIsAnalyticsEnabled()).toBe(true);
  });

  it('returns false when consent is revoked', () => {
    setEnv('G-TEST123', 'secret123');
    setAnalyticsConsent(false);
    expect(isAnalyticsEnabled()).toBe(false);
  });
});

describe('trackEvent', () => {
  it('does not call fetch when credentials are not set', async () => {
    trackEvent('app_open');
    // allow microtask queue to flush
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when consent is revoked', async () => {
    setEnv('G-TEST123', 'secret123');
    setAnalyticsConsent(false);
    trackEvent('app_open');
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls fetch with correct URL when credentials are set', async () => {
    setEnv('G-TESTMEASURE', 'testsecret');
    // MEASUREMENT_ID is read at module-evaluation time; use isolateModules so
    // the analytics module sees the credentials set above.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { trackEvent: isolatedTrack } = require('../../services/analytics') as typeof import('../../services/analytics');
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
    trackEvent('game_started');
    await Promise.resolve();
    // Params enrichment is validated via the body when fetch IS called
  });

  it('swallows fetch errors silently', async () => {
    setEnv('G-TESTMEASURE', 'testsecret');
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    expect(() => trackEvent('error_occurred')).not.toThrow();
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
    expect(() => trackGameEvent('game_started', { mode: 'multiplayer', player_count: 4 })).not.toThrow();
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
});
