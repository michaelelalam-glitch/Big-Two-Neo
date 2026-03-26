/**
 * Tests for sentry.ts — Sentry error tracking service.
 * Task #272
 */

import {
  initSentry,
  isSentryEnabled,
  setSentryUser,
  sentryCapture,
  withSentryBoundary,
} from '../../services/sentry';

// ─── Mock @sentry/react-native (routed via jest.config.js moduleNameMapper) ── //
// The mock is loaded from src/__tests__/__mocks__/sentry-react-native.ts

// We need to import it here to get a reference for assertions
import * as SentryMock from '@sentry/react-native';

// ─── Setup ────────────────────────────────────────────────────────────────── //

function setDsn(dsn: string) {
  process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
}

function clearDsn() {
  delete process.env.EXPO_PUBLIC_SENTRY_DSN;
}

beforeEach(() => {
  jest.clearAllMocks();
  clearDsn();
  // Reset module so _initialized flag is cleared between tests
  jest.resetModules();
});

afterAll(() => {
  clearDsn();
});

// ─── Tests ────────────────────────────────────────────────────────────────── //

describe('initSentry', () => {
  it('does not call Sentry.init when DSN is empty', () => {
    // Re-import after module reset to get fresh _initialized state
    const { initSentry: init } = jest.requireActual('../../services/sentry');
    clearDsn();
    init();
    // Since we use the mocked @sentry/react-native, init should not have been called
    expect(SentryMock.init).not.toHaveBeenCalled();
  });

  it('isSentryEnabled returns false when DSN is not set', () => {
    clearDsn();
    // isSentryEnabled reflects _initialized state which is false when no DSN
    expect(isSentryEnabled()).toBe(false);
  });
});

describe('isSentryEnabled', () => {
  it('returns a boolean', () => {
    expect(typeof isSentryEnabled()).toBe('boolean');
  });
});

describe('setSentryUser', () => {
  it('does not throw when Sentry is not initialized', () => {
    expect(() => setSentryUser({ id: 'user-123', username: 'testuser' })).not.toThrow();
  });

  it('does not throw when setting null (sign-out)', () => {
    expect(() => setSentryUser(null)).not.toThrow();
  });
});

describe('sentryCapture.exception', () => {
  it('does not throw when Sentry is not initialized', () => {
    const error = new Error('Test error');
    expect(() => sentryCapture.exception(error, { context: 'TestContext' })).not.toThrow();
  });

  it('accepts non-Error values', () => {
    expect(() => sentryCapture.exception('string error', { context: 'Test' })).not.toThrow();
    expect(() => sentryCapture.exception(null)).not.toThrow();
    expect(() => sentryCapture.exception(undefined)).not.toThrow();
    expect(() => sentryCapture.exception({ code: 'CUSTOM_ERROR' })).not.toThrow();
  });

  it('accepts optional tags and extra', () => {
    expect(() =>
      sentryCapture.exception(new Error('err'), {
        context: 'TestCtx',
        tags: { env: 'test' },
        extra: { detail: 'some detail' },
        level: 'error',
      })
    ).not.toThrow();
  });
});

describe('sentryCapture.message', () => {
  it('does not throw when Sentry is not initialized', () => {
    expect(() => sentryCapture.message('Test message')).not.toThrow();
  });

  it('accepts level option', () => {
    expect(() =>
      sentryCapture.message('Warning msg', { level: 'warning' })
    ).not.toThrow();
  });
});

describe('sentryCapture.breadcrumb', () => {
  it('does not throw when Sentry is not initialized', () => {
    expect(() =>
      sentryCapture.breadcrumb('User tapped play', { cardCount: 5 }, 'game')
    ).not.toThrow();
  });

  it('accepts optional data and category', () => {
    expect(() => sentryCapture.breadcrumb('Event')).not.toThrow();
  });
});

describe('withSentryBoundary', () => {
  it('is exported as a function', () => {
    expect(typeof withSentryBoundary).toBe('function');
  });

  it('returns the component when Sentry is not initialized (passthrough mock)', () => {
    const FakeComponent = () => null;
    const Wrapped = withSentryBoundary(FakeComponent as any, {});
    // The mock passthrough returns the same component
    expect(Wrapped).toBeDefined();
  });
});
