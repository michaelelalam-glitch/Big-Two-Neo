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
      // eslint-disable-next-line no-console
      console.log('[Sentry] Initializing');
    }
    Sentry.init({
      dsn: SENTRY_DSN,

      // Performance tracing: 20% of production sessions. Zero in dev to avoid quota.
      tracesSampleRate: __DEV__ ? 0 : 0.2,

      // Keep native SDK debug logging OFF even in dev — it floods the Metro
      // console with breadcrumb/watchdog/network-tracker noise on every frame.
      // JS-level Sentry logs ([Sentry] Initialized, etc.) are still emitted
      // via console.log below and are sufficient for dev diagnostics.
      debug: false,

      // Environment tag shown in Sentry dashboard
      environment: __DEV__ ? 'development' : 'production',

      // Attach app version — read from the EXPO_PUBLIC_APP_VERSION env var set
      // in app.json/EAS secrets. Not sourced from Expo config at runtime here
      // (that would require importing expo-constants), so ensure the env var is
      // populated in CI and production builds.
      release: process.env.EXPO_PUBLIC_APP_VERSION ?? undefined,

      // Enable performance tracing for React Native (navigation, network, etc.).
      // App start tracking, native frames tracking, and stall tracking are
      // auto-enabled by the SDK as separate integrations in @sentry/react-native v8.
      // They are NOT Sentry dashboard toggles — they are SDK-level features.
      integrations: [Sentry.reactNativeTracingIntegration()],

      // Session Replay: disabled in dev (both rates = 0) to prevent the
      // "Detected environment potentially causing PII leaks" red console error
      // on every dev/simulator launch. Enabled on error only in production.
      // Profiling: 10% of production sessions captures JS + native CPU profiles
      // tied to performance traces (requires tracesSampleRate > 0).
      _experiments: {
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: __DEV__ ? 0 : 1.0,
        profilesSampleRate: __DEV__ ? 0 : 0.1,
      },

      // Filter hook: runs before every event is transmitted to Sentry.
      // Return null to drop the event. Return the (optionally mutated) event to send.
      beforeSend(event) {
        // Drop ALL events from development environment. Dev sessions run on the
        // simulator with your own account — they generate noise (App Hang, network
        // errors, ImagePicker, audio-session hang) that pollutes the issue list.
        // Double-check both event.environment AND __DEV__ global to handle the
        // edge case where a production build is compiled with __DEV__=true.
        if (event.environment === 'development' || __DEV__) {
          return null;
        }

        const msg = event.exception?.values?.[0]?.value ?? '';
        const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
        const hasSwiftValueFrame = frames.some(f => (f.function ?? '').includes('SwiftValue'));

        // NSInvalidArgumentException + SwiftValue bridge crash — third-party
        // iOS SDK (LiveKit/CallKit) touching bridged Swift types. No first-party
        // fix is possible. Group all occurrences under a single stable fingerprint
        // so a resolved issue doesn't re-open on each occurrence.
        if (
          msg.includes('NSInvalidArgumentException') ||
          event.exception?.values?.[0]?.type === 'NSInvalidArgumentException' ||
          hasSwiftValueFrame
        ) {
          event.fingerprint = ['third-party-swift-bridge'];
        }

        // Drop non-fatal orientation errors already swallowed by ErrorUtils in App.tsx
        if (msg.includes('supportedInterfaceOrientations') && msg.includes('UIViewController')) {
          return null; // Drop
        }
        // Drop spurious "Object captured as exception with keys: _bubbles, _cancelable..."
        // events — these arise when a Promise is rejected with a native DOM/RN Event object
        // (e.g. from XHR onerror or fetch polyfill) instead of an Error instance.
        // They carry no actionable stack trace and only pollute the issue list.
        if (msg.includes('Object captured as exception with keys:') && msg.includes('_bubbles')) {
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
      // eslint-disable-next-line no-console
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
 *
 * Rate-limited to {@link BREADCRUMB_RATE_LIMIT} per second to prevent
 * excessive breadcrumb volume from high-frequency console patches.
 */
const BREADCRUMB_RATE_LIMIT = 50; // max breadcrumbs per second
let _breadcrumbCount = 0;
let _breadcrumbWindowStart = 0;

function captureBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  category = 'app'
): void {
  if (!_initialized) return;

  const now = Date.now();
  if (now - _breadcrumbWindowStart >= 1000 || now < _breadcrumbWindowStart) {
    // Reset window (also handles clock going backwards, e.g. NTP correction)
    _breadcrumbCount = 0;
    _breadcrumbWindowStart = now;
  }
  if (++_breadcrumbCount > BREADCRUMB_RATE_LIMIT) return; // drop excess

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

// ─── Enhanced bug report ───────────────────────────────────────────────────── //

/**
 * Union of the supported bug-report categories.
 * Shared between BugReportModal and submitBugReportWithOptions so the
 * type is the single source of truth and cannot drift between producer
 * and consumer.
 */
export type BugReportCategory = 'Bug' | 'Suggestion' | 'Performance' | 'Crash' | 'Other';

export interface BugReportOptions {
  description: string;
  category: BugReportCategory;
  email?: string;
  name?: string;
  /** Base64-encoded screenshot image data (JPEG or PNG). */
  screenshotBase64?: string;
  /**
   * MIME type of the screenshot (e.g. 'image/jpeg', 'image/png').
   * Used to set the correct filename and contentType on the Sentry attachment.
   * Defaults to 'image/jpeg' when absent.
   */
  screenshotMimeType?: string;
  /** Tail of the on-device console log file to include as an attachment. */
  consoleLog?: string;
}

/**
 * Submit an enhanced user bug report with category, optional screenshot,
 * and optional console log attachment.
 *
 * Unlike `submitBugReport`, this accepts structured options and supports
 * Sentry scope attachments for binary / text files.
 */
export function submitBugReportWithOptions(opts: BugReportOptions): void {
  if (!_initialized) return;

  const title = `[${opts.category}] Bug Report`;
  const fullMessage = `Category: ${opts.category}\n\n${opts.description}`;

  Sentry.withScope(scope => {
    scope.setTag('bug_category', opts.category);

    // Group ALL bug report submissions under one stable fingerprint so
    // repeated submissions don't re-open a previously resolved Sentry issue
    // and don't create the confusing 'Sentry.withScope$argument_0' title.
    scope.setFingerprint(['bug-report-submission']);

    if (opts.screenshotBase64) {
      const mime = opts.screenshotMimeType ?? 'image/jpeg';
      const ext = mime === 'image/png' ? 'png' : 'jpg';
      scope.addAttachment({
        filename: `screenshot.${ext}`,
        data: opts.screenshotBase64,
        contentType: mime,
      });
    }

    if (opts.consoleLog) {
      scope.addAttachment({
        filename: 'console.log',
        data: opts.consoleLog,
        contentType: 'text/plain',
      });
    }

    const eventId = Sentry.captureMessage(title, { level: 'info' });

    Sentry.captureFeedback({
      message: fullMessage,
      email: opts.email,
      name: opts.name,
      associatedEventId: eventId,
    });
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

  // Rate limiter: token bucket for breadcrumb/event capture (max 50/sec)
  let _breadcrumbTokens = 50;
  const _breadcrumbMaxTokens = 50;
  let _lastRefillTime = Date.now();
  const _refillBreadcrumbTokens = (): boolean => {
    const now = Date.now();
    const elapsed = now - _lastRefillTime;
    _breadcrumbTokens = Math.min(
      _breadcrumbMaxTokens,
      _breadcrumbTokens + (elapsed / 1000) * _breadcrumbMaxTokens
    );
    _lastRefillTime = now;
    if (_breadcrumbTokens >= 1) {
      _breadcrumbTokens -= 1;
      return true;
    }
    return false;
  };

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
    if (!_refillBreadcrumbTokens()) return; // Rate limit check before stringify
    const message = args.map(safeStringify).join(' ').slice(0, MAX_SENTRY_MSG_LEN);
    // Skip React/RN internal "Warning:" noise — those are not real errors.
    if (message.startsWith('Warning:')) return;
    // Skip Sentry's own internal debug/error messages to prevent feedback loops
    // where Sentry's logger output gets re-captured and sent as Sentry events.
    if (message.includes('[Native] [Sentry') || message.includes('Sentry Logger')) return;
    // Skip LiveKit internal track-dimension noise — this is a LiveKit SDK log,
    // not an app error, and floods Sentry with non-actionable events.
    if (message.includes('could not determine track dimensions')) return;
    // Skip native-module-not-found errors for optional modules (expo-image-picker,
    // expo-audio). These occur in old builds before the native modules were linked and
    // are handled gracefully by lazy-require guards in the app. Newer builds won't
    // encounter them at all.
    if (
      message.includes("Cannot find native module 'ExponentImagePicker'") ||
      message.includes("Cannot find native module 'ExpoAudio'")
    )
      return;
    // Skip GameErrorBoundary's component-stack console.error — the actual error is
    // already captured directly by GameErrorBoundary via sentryCapture.exception,
    // so these console.error duplicates only pollute the Sentry issue list.
    if (message.includes('[GameErrorBoundary]')) return;
    Sentry.captureMessage(`[console.error] ${message}`, {
      level: 'error',
      tags: { source: 'console' },
    } as Parameters<typeof Sentry.captureMessage>[1]);
  };

  console.warn = (...args: unknown[]) => {
    _originalConsoleWarn(...args);
    if (!_initialized) return;
    if (!_refillBreadcrumbTokens()) return; // Rate limit check before stringify
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
