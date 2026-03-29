/**
 * Sentry Error Tracking Service — Task #272
 *
 * Initialises Sentry for crash reporting and error tracking.
 * Gracefully no-ops when no DSN is provided (e.g. local dev without secrets).
 *
 * Configuration (add to .env / EAS secrets):
 *   EXPO_PUBLIC_SENTRY_DSN=https://xxxxx@oXXXXX.ingest.sentry.io/YYYYYYY
 *
 * The DSN is found in Sentry Console → Project Settings → Client Keys (DSN).
 *
 * Usage:
 *   import { initSentry, sentryCapture, SentryUser } from './sentry';
 *   // Initialize ONLY after the user has granted analytics consent:
 *   initSentry();
 *   // Call disableSentry() if the user later revokes consent.
 *
 *   // Capture a caught exception:
 *   sentryCapture.exception(error, { context: 'PlayCards' });
 *
 *   // Log a breadcrumb for debugging:
 *   sentryCapture.breadcrumb('Game started', { mode: 'multiplayer' });
 */

import * as Sentry from '@sentry/react-native';

// ─── Configuration ───────────────────────────────────────────────────────── //

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

/** Has Sentry been successfully initialised? */
let _initialized = false;

/** Pending user context to apply once Sentry is initialized. */
let _pendingUser: SentryUser | null | undefined = undefined;

// ─── Types ─────────────────────────────────────────────────────────────────── //

export interface SentryUser {
  id: string;
  username?: string;
}

export interface CaptureOptions {
  /** Short label describing where the error occurred */
  context?: string;
  /** Additional key/value tags shown in Sentry UI */
  tags?: Record<string, string>;
  /** Extra arbitrary data attached to the event */
  extra?: Record<string, unknown>;
  /** Severity level */
  level?: Sentry.SeverityLevel;
}

// ─── Init ─────────────────────────────────────────────────────────────────── //

/**
 * Initialise Sentry. Call once before rendering the React tree.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initSentry(): void {
  if (_initialized) return;

  if (!SENTRY_DSN) {
    // DSN not configured — disable silently (dev environment or un-configured CI)
    return;
  }

  try {
    if (__DEV__) {
      console.log('[Sentry] Initializing');
    }
    Sentry.init({
      dsn: SENTRY_DSN,

      // Breadcrumbs and event sampling
      // In production use a lower rate (0.1–0.2) to control volume/cost.
      tracesSampleRate: __DEV__ ? 0 : 0.1,

      // Enable debug logging in dev so issues are visible in Metro console
      debug: __DEV__,

      // Environment tag shown in Sentry dashboard
      environment: __DEV__ ? 'development' : 'production',

      // Attach app version — read from the EXPO_PUBLIC_APP_VERSION env var set
      // in app.json/EAS secrets. Not sourced from Expo config at runtime here
      // (that would require importing expo-constants), so ensure the env var is
      // populated in CI and production builds.
      release: process.env.EXPO_PUBLIC_APP_VERSION ?? undefined,

      // Enable performance tracing for React Native (navigation, network, etc.)
      integrations: [Sentry.reactNativeTracingIntegration()],

      // Don't send events for known non-fatal orientation errors already
      // swallowed by the global ErrorUtils handler in App.tsx
      beforeSend(event) {
        const msg = event.exception?.values?.[0]?.value ?? '';
        if (msg.includes('supportedInterfaceOrientations') && msg.includes('UIViewController')) {
          return null; // Drop
        }
        // Tag only missing-translation warnings so they can be filtered in Sentry dashboard.
        if (
          msg.includes('[i18n] Translation not found:') ||
          msg.includes('Translation not found')
        ) {
          event.tags = { ...event.tags, category: 'translation' };
          event.level = 'warning';
        }
        return event;
      },

      // Strip ANSI escape codes from console breadcrumbs to prevent the iOS
      // native Sentry SDK from failing to serialize them as JSON breadcrumbs.
      // react-native-logs emits ANSI color sequences (ESC + '[92m' etc.) that
      // contain the ESC character (0x1b) which is not valid in JSON strings,
      // causing SentryCrashScopeObserver "Invalid character" serialisation
      // failures on every log line.
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.category === 'console' && typeof breadcrumb.message === 'string') {
          // eslint-disable-next-line no-control-regex
          breadcrumb.message = breadcrumb.message.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
        }
        return breadcrumb;
      },
    });

    _initialized = true;
    // Apply any pending user context that was set before init.
    // Keep _pendingUser set so it can be re-applied on subsequent init calls
    // (e.g. after disableSentry() + initSentry() in the same session).
    if (_pendingUser !== undefined) {
      Sentry.setUser(_pendingUser);
    }
    // Patch console.error / console.warn so that errors logged via console
    // are forwarded to Sentry whenever Sentry is active in this session.
    _setupConsoleCapture();
    if (__DEV__) {
      console.log('[Sentry] Initialized successfully');
    }
  } catch (err) {
    if (__DEV__) {
      console.warn('[Sentry] init error:', err);
    }
    // Sentry.init failed (e.g. native module unavailable or misconfigured).
    // Leave _initialized = false so all capture helpers remain no-ops and the
    // app continues to function without crash reporting.
    if (__DEV__) {
      console.warn('[Sentry] init failed — Sentry disabled for this session');
    }
  }
}

/** Returns whether Sentry has been initialised with a valid DSN. */
export function isSentryEnabled(): boolean {
  return _initialized;
}

/**
 * Disable Sentry in response to user revoking analytics consent.
 * Marks Sentry as uninitialised so all subsequent capture calls become no-ops,
 * and closes the underlying client asynchronously.
 */
export function disableSentry(): void {
  _initialized = false;
  void Sentry.close().catch(e => {
    if (__DEV__) {
      console.warn('[Sentry] close error:', e);
    }
  });
}

// ─── User context ─────────────────────────────────────────────────────────── //

/**
 * Set Sentry user context. Call after successful sign-in.
 * @param user - Pass null to clear the user (on sign-out).
 */
export function setSentryUser(user: SentryUser | null): void {
  // Always cache the latest user so it can be reapplied after re-initialization
  _pendingUser = user;

  if (!_initialized) {
    // Will be applied once Sentry initializes after consent
    return;
  }
  Sentry.setUser(user);
}

// ─── Capture helpers ──────────────────────────────────────────────────────── //

function buildScope(opts: CaptureOptions): Sentry.Scope {
  const scope = new Sentry.Scope();
  if (opts.context) scope.setTag('context', opts.context);
  if (opts.level) scope.setLevel(opts.level);
  if (opts.tags) {
    Object.entries(opts.tags).forEach(([k, v]) => scope.setTag(k, v));
  }
  if (opts.extra) {
    Object.entries(opts.extra).forEach(([k, v]) => scope.setExtra(k, v));
  }
  return scope;
}

/**
 * Capture a caught exception.
 *
 * @param error - The caught value (any type).
 * @param opts  - Optional context / tags / extra data.
 *
 * @example
 * try {
 *   await riskyOp();
 * } catch (err) {
 *   sentryCapture.exception(err, { context: 'RiskyOp' });
 * }
 */
function captureException(error: unknown, opts: CaptureOptions = {}): void {
  if (!_initialized) return;
  const scope = buildScope(opts);
  Sentry.captureException(error, scope);
}

/**
 * Capture a non-exception message (e.g. warning, informational event).
 */
function captureMessage(
  message: string,
  opts: CaptureOptions & { level?: Sentry.SeverityLevel } = {}
): void {
  if (!_initialized) return;
  const scope = buildScope(opts);
  Sentry.captureMessage(message, scope);
}

/**
 * Add a breadcrumb to the current Sentry event trail.
 * Breadcrumbs appear in the "Breadcrumbs" section of Sentry events.
 */
function captureBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  category = 'app'
): void {
  if (!_initialized) return;
  Sentry.addBreadcrumb({
    message,
    data,
    category,
    level: 'info',
  });
}

/** Named export object for ergonomic call-sites. */
export const sentryCapture = {
  exception: captureException,
  message: captureMessage,
  breadcrumb: captureBreadcrumb,
};

/**
 * Higher-order component: wraps a React component with Sentry's ErrorBoundary.
 * Any render error inside the wrapped component will be reported to Sentry.
 *
 * @example
 * export default withSentryBoundary(GameScreen);
 */
export const withSentryBoundary = Sentry.withErrorBoundary;

/**
 * Export the raw Sentry module for advanced use cases
 * (e.g. tracing, profiling, custom integrations).
 */
export { Sentry };

// ─── In-app bug reporting ─────────────────────────────────────────────────── //

/**
 * Submit a user bug report via Sentry user feedback.
 * This creates a new Sentry "Bug Report" event and attaches the feedback to it.
 *
 * @param description - User-provided description of the bug
 * @param email - Optional email for follow-up
 * @param name - Optional display name
 */
export function submitBugReport(description: string, email?: string, name?: string): void {
  if (!_initialized) return;

  // Create a Sentry event to attach feedback to
  const eventId = Sentry.captureMessage('Bug Report', {
    level: 'info',
  });

  Sentry.captureFeedback({
    message: description,
    email,
    name,
    associatedEventId: eventId,
  });
}

// ─── Console capture ──────────────────────────────────────────────────────── //

// Track whether the console patch has been applied to avoid double-patching.
let _consolePatchApplied = false;

const _originalConsoleError = console.error;
const _originalConsoleWarn = console.warn;

/**
 * Intercept console.error and console.warn to forward them to Sentry.
 * This uses a pure-JS patch that does not depend on the native Sentry module
 * (e.g. it is safe in Expo Go or outdated dev builds), but actual forwarding
 * to Sentry only occurs after initSentry() has successfully initialized
 * Sentry (i.e. when `_initialized` is true).
 * Called automatically by initSentry() after successful initialization.
 */
function _setupConsoleCapture(): void {
  if (_consolePatchApplied) return;
  _consolePatchApplied = true;

  const safeStringify = (a: unknown): string => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.message}${a.stack ? `\n${a.stack}` : ''}`;
    try {
      // JSON.stringify returns undefined for functions/symbols/void — fall back to String().
      return JSON.stringify(a) ?? String(a);
    } catch {
      return String(a);
    }
  };
  const MAX_SENTRY_MSG_LEN = 1000;

  console.error = (...args: unknown[]) => {
    _originalConsoleError(...args);
    if (!_initialized) return;
    const message = args.map(safeStringify).join(' ').slice(0, MAX_SENTRY_MSG_LEN);
    // Skip React/RN internal "Warning:" noise — those are not real errors.
    if (message.startsWith('Warning:')) return;
    // Skip Sentry's own internal debug/error messages to prevent feedback loops
    // where Sentry's logger output gets re-captured and sent as Sentry events.
    if (message.includes('[Native] [Sentry') || message.includes('Sentry Logger')) return;
    Sentry.captureMessage(`[console.error] ${message}`, {
      level: 'error',
      tags: { source: 'console' },
    } as Parameters<typeof Sentry.captureMessage>[1]);
  };

  console.warn = (...args: unknown[]) => {
    _originalConsoleWarn(...args);
    if (!_initialized) return;
    const message = args.map(safeStringify).join(' ').slice(0, MAX_SENTRY_MSG_LEN);
    // Skip noisy RN / Expo warnings that aren't application bugs.
    if (
      message.startsWith('Warning:') ||
      message.includes('VirtualizedLists') ||
      message.includes('RNSentry') ||
      // Skip Sentry's own internal warning messages to prevent feedback loops.
      message.includes('[Native] [Sentry') ||
      message.includes('Sentry Logger')
    )
      return;
    Sentry.addBreadcrumb({
      message: `[console.warn] ${message}`,
      level: 'warning',
      category: 'console',
    });
  };
}

// ─── Translation error reporting ──────────────────────────────────────────── //

/**
 * Report a missing i18n translation key to Sentry.
 * Adds a breadcrumb when Sentry is initialized — never throws.
 */
export function reportMissingTranslation(key: string, language: string): void {
  if (!_initialized) return;
  Sentry.addBreadcrumb({
    category: 'i18n',
    message: `Missing translation: ${key}`,
    level: 'warning',
    data: { key, language },
  });
}
