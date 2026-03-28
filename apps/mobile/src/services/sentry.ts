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
        return event;
      },
    });

    _initialized = true;
    // Apply any pending user context that was set before init.
    // Keep _pendingUser set so it can be re-applied on subsequent init calls
    // (e.g. after disableSentry() + initSentry() in the same session).
    if (_pendingUser !== undefined) {
      Sentry.setUser(_pendingUser);
    }
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
