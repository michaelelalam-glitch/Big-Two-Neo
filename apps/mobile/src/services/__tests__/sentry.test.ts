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
  submitBugReport,
  reportMissingTranslation,
} from '../../services/sentry';

// ─── Mock @sentry/react-native (routed via jest.config.js moduleNameMapper) ── //
// The mock is loaded from src/__tests__/__mocks__/sentry-react-native.ts
// Note: import the mock inside jest.isolateModules() for enabled-path tests
// so each test gets a fresh module registry (and fresh _initialized state).

// ─── Setup ────────────────────────────────────────────────────────────────── //

function clearDsn() {
  delete process.env.EXPO_PUBLIC_SENTRY_DSN;
}

beforeEach(() => {
  jest.clearAllMocks();
  clearDsn();
  // Note: top-level imports are stale after jest.resetModules() — tests that
  // require a fresh module state (e.g. _initialized) must use jest.isolateModules().
});

afterAll(() => {
  clearDsn();
});

// ─── Tests ────────────────────────────────────────────────────────────────── //

describe('initSentry', () => {
  it('does not call Sentry.init when DSN is empty', () => {
    // Use isolateModules so we get a fresh _initialized=false state AND the
    // @sentry/react-native mock is loaded into the same isolated registry.
    jest.isolateModules(() => {
      clearDsn();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initSentry: init } =
        require('../../services/sentry') as typeof import('../../services/sentry');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const MockSentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
      init();
      expect(MockSentry.init).not.toHaveBeenCalled();
    });
  });

  it('isSentryEnabled returns false when DSN is not set', () => {
    clearDsn();
    // isSentryEnabled reflects _initialized state which is false when no DSN
    expect(isSentryEnabled()).toBe(false);
  });
});

describe('initSentry (enabled path)', () => {
  it('calls Sentry.init and enables capture helpers when DSN is set', () => {
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://test@sentry.io/123456';
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const {
          initSentry: init,
          isSentryEnabled: isEnabled,
          sentryCapture: capture,
        } = require('../../services/sentry') as typeof import('../../services/sentry');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const MockSentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
        init();
        expect(MockSentry.init).toHaveBeenCalledWith(
          expect.objectContaining({ dsn: 'https://test@sentry.io/123456' })
        );
        expect(isEnabled()).toBe(true);
        // captureException should forward to the underlying Sentry mock
        capture.exception(new Error('sentry test error'), { context: 'TestCtx' });
        expect(MockSentry.captureException).toHaveBeenCalled();
      } finally {
        delete process.env.EXPO_PUBLIC_SENTRY_DSN;
      }
    });
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
    expect(() => sentryCapture.message('Warning msg', { level: 'warning' })).not.toThrow();
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

describe('submitBugReport', () => {
  it('does not throw when Sentry is not initialized', () => {
    expect(() => submitBugReport('Test bug')).not.toThrow();
  });

  it('does not call captureFeedback when Sentry is not initialized', () => {
    jest.isolateModules(() => {
      clearDsn();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { submitBugReport: isolatedSubmit } =
        require('../../services/sentry') as typeof import('../../services/sentry');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const MockSentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
      isolatedSubmit('Bug description');
      expect((MockSentry as any).captureFeedback).not.toHaveBeenCalled();
    });
  });

  it('calls captureMessage and captureFeedback when Sentry is initialized', () => {
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://test@sentry.io/123456';
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { initSentry: init, submitBugReport: isolatedSubmit } =
          require('../../services/sentry') as typeof import('../../services/sentry');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const MockSentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
        init();
        isolatedSubmit('Something broke', 'user@test.com', 'TestUser');
        expect(MockSentry.captureMessage).toHaveBeenCalledWith(
          'Bug Report',
          expect.objectContaining({ level: 'info' })
        );
        expect((MockSentry as any).captureFeedback).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Something broke',
            email: 'user@test.com',
            name: 'TestUser',
          })
        );
      } finally {
        delete process.env.EXPO_PUBLIC_SENTRY_DSN;
      }
    });
  });

  it('works with only description (no email or name)', () => {
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://test@sentry.io/123456';
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { initSentry: init, submitBugReport: isolatedSubmit } =
          require('../../services/sentry') as typeof import('../../services/sentry');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const MockSentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
        init();
        isolatedSubmit('Minimal bug report');
        expect((MockSentry as any).captureFeedback).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Minimal bug report',
          })
        );
      } finally {
        delete process.env.EXPO_PUBLIC_SENTRY_DSN;
      }
    });
  });
});

// ─── reportMissingTranslation ─────────────────────────────────────────────── //

describe('reportMissingTranslation', () => {
  it('does not throw when Sentry is not initialized', () => {
    expect(() => reportMissingTranslation('some.key', 'en')).not.toThrow();
  });

  it('adds a breadcrumb when Sentry is initialized', () => {
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://test@sentry.io/123456';
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { initSentry: init, reportMissingTranslation: report } =
          require('../../services/sentry') as typeof import('../../services/sentry');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const MockSentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
        init();
        report('game.title', 'fr');
        expect(MockSentry.addBreadcrumb).toHaveBeenCalledWith(
          expect.objectContaining({
            category: 'i18n',
            message: 'Missing translation: game.title',
            level: 'warning',
            data: { key: 'game.title', language: 'fr' },
          })
        );
      } finally {
        delete process.env.EXPO_PUBLIC_SENTRY_DSN;
      }
    });
  });
});

// ─── beforeSend translation tagging ───────────────────────────────────────── //

describe('beforeSend translation tagging', () => {
  it('tags events with "Translation not found" as translation category', () => {
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://test@sentry.io/123456';
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { initSentry: init } =
          require('../../services/sentry') as typeof import('../../services/sentry');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const MockSentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
        init();
        const initCall = (MockSentry.init as jest.Mock).mock.calls[0][0] as {
          beforeSend: (event: any) => any;
        };
        const beforeSend = initCall.beforeSend;

        const event = {
          exception: { values: [{ value: '[i18n] Translation not found: game.title' }] },
          tags: {},
        };
        const result = beforeSend(event);
        expect(result).not.toBeNull();
        expect(result.tags.category).toBe('translation');
        expect(result.level).toBe('warning');
      } finally {
        delete process.env.EXPO_PUBLIC_SENTRY_DSN;
      }
    });
  });

  it('does not tag unrelated errors containing "i18n" in path', () => {
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://test@sentry.io/123456';
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { initSentry: init } =
          require('../../services/sentry') as typeof import('../../services/sentry');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const MockSentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
        init();
        const initCall = (MockSentry.init as jest.Mock).mock.calls[0][0] as {
          beforeSend: (event: any) => any;
        };
        const beforeSend = initCall.beforeSend;

        const event = {
          exception: { values: [{ value: 'Module not found: /src/i18n/config.ts' }] },
          tags: {},
        };
        const result = beforeSend(event);
        expect(result).not.toBeNull();
        expect(result.tags.category).toBeUndefined();
        expect(result.level).toBeUndefined();
      } finally {
        delete process.env.EXPO_PUBLIC_SENTRY_DSN;
      }
    });
  });
});
