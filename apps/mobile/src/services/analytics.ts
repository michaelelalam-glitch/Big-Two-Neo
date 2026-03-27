/**
 * Analytics Service — Task #272
 *
 * Sends events to Firebase Analytics via the Measurement Protocol v2 REST API.
 * This is a pure-JS implementation that requires no native SDK, works on both
 * iOS and Android, and gracefully no-ops when credentials are not configured.
 *
 * Configuration (add to .env / EAS secrets):
 *   EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
 *   EXPO_PUBLIC_FIREBASE_API_SECRET=your_api_secret
 *
 * Both values are found in Firebase Console → Analytics → Data Streams
 * → Web Stream details → Measurement Protocol API secrets.
 *
 * Usage:
 *   import { analytics } from './analytics';
 *   analytics.track('game_started', { mode: 'multiplayer', player_count: 4 });
 *
 * GDPR: Call analytics.setConsent(false) to disable tracking. Consent state
 * is stored in-memory (not persisted) and must be set on each app start based
 * on user preferences stored in AsyncStorage / your consent mechanism.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';

// ─── Configuration ─────────────────────────────────────────────────────────── //

/** Firebase Measurement Protocol v2 endpoint */
const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

const MEASUREMENT_ID = process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ?? '';
// NOTE: EXPO_PUBLIC_* vars are bundled into the app binary and are technically
// extractable. The Measurement Protocol API secret is designed for client-side
// use and can ONLY push events to YOUR GA4 property. It is NOT a server-side
// credential. GA4's built-in bot/spam filters provide some protection against
// abuse; for higher assurance, proxy analytics through a server-side endpoint.
const API_SECRET = process.env.EXPO_PUBLIC_FIREBASE_API_SECRET ?? '';

/**
 * Tracks whether the user has consented to analytics.
 * Defaults to FALSE. The app MUST call setAnalyticsConsent(true) before any
 * events are sent. In this app, that call is made in App.tsx at startup once
 * i18n has initialized (per the app's privacy policy). If GDPR opt-in is
 * required, gate that call on a persisted user preference.
 */
let consentGiven = false;

// ─── Types ────────────────────────────────────────────────────────────────── //

/**
 * Event parameter values must be string or number to comply with GA4
 * Measurement Protocol requirements — booleans are not a valid param type
 * and can cause params to be dropped or rejected. Normalise booleans before
 * calling any trackX helper (e.g. `true/false → 1/0` or `'true'/'false'`).
 */
export type AnalyticsEventParams = Record<string, string | number>;

/** Supported analytics event names. Extend as new features are added. */
export type AnalyticsEventName =
  | 'app_open'
  | 'user_signed_in'
  | 'user_signed_out'
  | 'game_started'
  | 'game_completed'
  | 'game_abandoned'
  | 'error_occurred'
  | 'screen_view'
  | 'feature_used';

// ─── Client ID (session-scoped) ────────────────────────────────────────────── //

/**
 * Generate a random UUID v4.
 * Used as client_id — scoped to the app session (not persisted across restarts).
 * For a persistent client_id, save this to AsyncStorage on first launch.
 */
function generateClientId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let _clientId: string | null = null;
/** GA4 session_id must be numeric — use epoch-millisecond timestamp at session start. */
let _sessionId: number | null = null;
let _userId: string | null = null;

function getClientId(): string {
  if (!_clientId) {
    _clientId = generateClientId();
  }
  return _clientId;
}

/**
 * Returns a numeric session id (epoch ms) per GA4 Measurement Protocol requirements.
 * A UUID string causes events to be mis-attributed or dropped by GA4.
 */
function getSessionId(): number {
  if (!_sessionId) {
    _sessionId = Date.now();
  }
  return _sessionId;
}

// ─── Core send function ───────────────────────────────────────────────────── //

/**
 * Send a batch of events to Firebase Measurement Protocol v2.
 * Silently swallows network errors to avoid impacting app UX.
 */
async function sendEvents(
  events: { name: string; params?: AnalyticsEventParams }[]
): Promise<void> {
  if (!MEASUREMENT_ID || !API_SECRET) {
    // Credentials not configured — no-op silently
    return;
  }

  if (!consentGiven) {
    return;
  }

  // Always post to the standard endpoint. In dev builds, set debug_mode: 1
  // inside each event's params — this surfaces events in Firebase DebugView
  // without losing the full ingestion pipeline. /debug/mp/collect is
  // validation-only and does NOT show events in DebugView.
  const url = `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(MEASUREMENT_ID)}&api_secret=${encodeURIComponent(API_SECRET)}`;

  const body: Record<string, unknown> = {
    client_id: getClientId(),
    events: events.map(e => {
      const params: Record<string, string | number> = {
        // Caller params (may not override GA4-reserved fields below)
        ...(e.params ?? {}),
        // Standard GA4 params — enforced last
        // Minimum recommended engagement time for GA4 session attribution
        engagement_time_msec: 100,
        session_id: getSessionId(),
      };
      if (__DEV__) {
        // debug_mode: 1 routes events to Firebase DebugView in dev builds
        params.debug_mode = 1;
      }
      return { name: e.name, params };
    }),
  };

  // Associate events with the signed-in user (separate from client_id)
  if (_userId) {
    body.user_id = _userId;
  }

  try {
    if (__DEV__) {
      console.log('[Analytics] Sending events:', events.map(e => e.name).join(', '));
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (__DEV__) {
      console.log('[Analytics] Response status:', response.status);
    }
  } catch (err) {
    if (__DEV__) {
      console.warn('[Analytics] Network error:', err);
    }
    // Network error — swallow silently (analytics must never crash the app)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────── //

/**
 * Set the authenticated user ID so events can be tied to a specific user
 * in Firebase Analytics / BigQuery.
 *
 * `client_id` (random UUID, session-scoped) is kept separate from `user_id`
 * (Supabase UUID) so GA4 session semantics remain correct.
 *
 * @param userId - Supabase user UUID (do NOT use email or PII directly)
 */
export function setAnalyticsUserId(userId: string | null): void {
  _userId = userId;
}

/**
 * Toggle user consent. When false, no events are sent.
 * Call based on user's GDPR/privacy preference.
 */
export function setAnalyticsConsent(hasConsented: boolean): void {
  consentGiven = hasConsented;
}

/** Returns whether analytics is ready to send (credentials configured & consent given). */
export function isAnalyticsEnabled(): boolean {
  return Boolean(MEASUREMENT_ID && API_SECRET && consentGiven);
}

/**
 * Track an analytics event.
 *
 * @param name   - Event name (see {@link AnalyticsEventName})
 * @param params - Optional key/value parameters (strings and numbers only).
 *                 Normalise booleans before calling (e.g. true/false → 1/0).
 *
 * @example
 * analytics.track('game_started', { mode: 'multiplayer', player_count: 4 });
 */
export function trackEvent(name: AnalyticsEventName, params?: AnalyticsEventParams): void {
  const enrichedParams: AnalyticsEventParams = {
    ...params,
    platform: Platform.OS,
    // Prefer the explicit EXPO_PUBLIC_APP_VERSION env var so analytics and
    // Sentry both report the same version string. Falls back to Expo app
    // config if the env var is not set.
    app_version: process.env.EXPO_PUBLIC_APP_VERSION ?? Constants.expoConfig?.version ?? 'unknown',
  };

  // Fire-and-forget — don't await in callers (non-blocking)
  void sendEvents([{ name, params: enrichedParams }]);
}

/**
 * Track a screen view event.
 *
 * @param screenName  - e.g. 'HomeScreen', 'GameScreen'
 * @param screenClass - Optional class name (defaults to screenName)
 */
export function trackScreenView(screenName: string, screenClass?: string): void {
  trackEvent('screen_view', {
    firebase_screen: screenName,
    firebase_screen_class: screenClass ?? screenName,
  });
}

/** Convenience: track an error event (non-fatal, for analytics dashboards). */
export function trackError(context: string, message: string, fatal = false): void {
  trackEvent('error_occurred', {
    error_context: context,
    error_message: message.slice(0, 100), // GA4 param max 100 chars
    fatal: fatal ? 1 : 0,
  });
}

/** Convenience: track auth events. */
export function trackAuthEvent(event: 'user_signed_in' | 'user_signed_out', method?: string): void {
  trackEvent(event, method ? { method } : undefined);
}

/** Convenience: track game lifecycle events. */
export function trackGameEvent(
  event: 'game_started' | 'game_completed' | 'game_abandoned',
  params?: AnalyticsEventParams
): void {
  trackEvent(event, params);
}

/** Named export object for convenience (e.g. analytics.track). */
export const xanalytics = {
  track: trackEvent,
  screenView: trackScreenView,
  error: trackError,
  setUserId: setAnalyticsUserId,
  setConsent: setAnalyticsConsent,
  isEnabled: isAnalyticsEnabled,
};
