/**
 * Analytics Service — Task #272
 *
 * Sends events to Firebase Analytics via the Measurement Protocol v2 REST API.
 * This is a pure-JS implementation that requires no native SDK, works on both
 * iOS and Android, and gracefully no-ops when credentials are not configured.
 *
 * Configuration (add to .env.local / EAS secrets):
 *   EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
 *   EXPO_PUBLIC_FIREBASE_API_SECRET=your_api_secret
 *
 * MEASUREMENT_ID and API_SECRET are found in Firebase Console → Analytics
 * → Data Streams → Web Stream details → Measurement Protocol API secrets.
 * Note: firebase_app_id is intentionally omitted from payloads to avoid
 * VALUE_INVALID errors when using a web-stream measurement ID.
 *
 * Usage:
 *   import { analytics } from './analytics';
 *   analytics.track('game_started', { mode: 'multiplayer', player_count: 4 });
 *
 * GDPR: Call analytics.setConsent(false) to disable tracking. Consent state
 * is stored in-memory (not persisted) and must be set on each app start based
 * on user preferences stored in AsyncStorage / your consent mechanism.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
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
// TODO(security): move analytics ingestion behind a Supabase Edge Function so
// the API secret is never shipped in the client bundle. Until that migration,
// the risk is scoped to a malicious actor spamming YOUR property's event stream;
// it does not expose end-user data. Tracked in task backlog.
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
  // ── Core lifecycle ──
  | 'app_open'
  | 'user_signed_in'
  | 'user_signed_out'
  | 'screen_view'
  | 'screen_time'
  | 'error_occurred'
  | 'feature_used'
  // ── Game lifecycle ──
  | 'game_started'
  | 'game_completed'
  | 'game_abandoned'
  | 'game_voided'
  | 'game_not_completed'
  | 'game_session_summary'
  // ── Gameplay actions ──
  | 'card_play'
  | 'card_pass'
  | 'combo_played'
  | 'turn_started'
  | 'turn_completed'
  | 'play_error'
  | 'play_validation_error'
  | 'turn_duration'
  // ── Game features ──
  | 'chat_opened'
  | 'chat_message_sent'
  | 'chat_closed'
  | 'chat_session_duration'
  | 'camera_toggled'
  | 'camera_session_duration'
  | 'microphone_toggled'
  | 'microphone_session_duration'
  | 'video_chat_connected'
  | 'video_chat_disconnected'
  | 'video_chat_session_duration'
  | 'video_chat_permission_denied'
  | 'throwable_sent'
  | 'throwable_received'
  | 'hint_used'
  | 'hint_result_played'
  | 'hint_result_ignored'
  | 'hint_no_valid_play'
  | 'sort_used'
  | 'smart_sort_used'
  | 'orientation_changed'
  | 'orientation_session_duration'
  | 'play_method_used'
  | 'card_rearranged'
  | 'room_join_method'
  | 'play_history_viewed'
  | 'play_history_session_duration'
  | 'scoreboard_expanded'
  | 'scoreboard_session_duration'
  // ── Social ──
  | 'friend_added'
  | 'friend_removed'
  | 'room_created'
  | 'room_joined'
  | 'matchmaking_started'
  | 'matchmaking_cancelled'
  | 'matchmaking_found'
  // ── Connection ──
  | 'disconnect'
  | 'reconnect'
  | 'reconnect_attempted'
  | 'reconnect_succeeded'
  | 'reconnect_failed'
  | 'connection_status_changed'
  | 'player_replaced_by_bot'
  | 'heartbeat_backoff'
  | 'app_state_changed'
  | 'room_closed_while_away'
  // ── Navigation / session ──
  | 'session_start'
  | 'session_end'
  | 'deep_link_received'
  // ── Settings ──
  | 'setting_changed'
  | 'language_changed'
  | 'cache_cleared'
  | 'delete_account_initiated'
  | 'delete_account_confirmed'
  | 'bug_report_submitted'
  | 'bug_report_opened';

// ─── Client ID (device-persistent) ─────────────────────────────────────────── //

const CLIENT_ID_KEY = '@analytics/client_id';

/**
 * Generate a random UUID v4.
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

/**
 * Returns the persistent client_id for this device, loading from AsyncStorage
 * on first call and creating a new UUID if none exists.
 * Persistence is critical for Firebase DebugView: each new random UUID creates
 * a brand-new "device" entry in DebugView, so without persistence the user
 * sees a different device every app restart (burying screen_view/screen_time).
 */
function getClientId(): string {
  if (!_clientId) {
    // Return the in-memory fallback synchronously for the current send call;
    // the async load below will populate it for all subsequent calls.
    _clientId = generateClientId();
    void AsyncStorage.getItem(CLIENT_ID_KEY)
      .then(stored => {
        if (stored) {
          _clientId = stored;
        } else {
          // First launch — persist the freshly-generated id.
          void AsyncStorage.setItem(CLIENT_ID_KEY, _clientId!).catch(() => {
            /* non-critical — fallback id already in memory */
          });
        }
      })
      .catch(() => {
        /* AsyncStorage unavailable — in-memory fallback id is used */
      });
  }
  return _clientId;
}

/**
 * Must be called once at app startup (before any trackEvent calls).
 * Eagerly loads the persisted client_id so that all events in the session,
 * including the very first ones, carry the stable device identifier.
 */
export async function initClientId(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(CLIENT_ID_KEY);
    if (stored) {
      _clientId = stored;
    } else {
      const fresh = generateClientId();
      _clientId = fresh;
      await AsyncStorage.setItem(CLIENT_ID_KEY, fresh);
    }
  } catch {
    // AsyncStorage unavailable — fall back to session-scoped id (non-fatal)
    if (!_clientId) {
      _clientId = generateClientId();
    }
  }
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

  // In dev, POST to the validation endpoint first so GA4 validation errors
  // are printed to the console. The validation endpoint returns 200 with a
  // JSON body describing any issues — it does NOT ingest the event.
  // Then always POST to the real endpoint so events actually land in GA4.
  //
  // NOTE: GA4 DebugView with the Measurement Protocol requires sending
  // `debug_mode: 1` at the TOP LEVEL of the request body (not inside event
  // params). This service does NOT set `debug_mode` — all events land in
  // standard GA4 Realtime reports. To use DebugView during local development,
  // add `debug_mode: 1` to the `body` object below before the `events` key.
  // You can also inspect live traffic via:
  //   GA4 → Reports → Realtime → "Event count in last 30 min by Event name"
  const url = `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(MEASUREMENT_ID)}&api_secret=${encodeURIComponent(API_SECRET)}`;
  const validationUrl = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(MEASUREMENT_ID)}&api_secret=${encodeURIComponent(API_SECRET)}`;

  const body: Record<string, unknown> = {
    client_id: getClientId(),
    // NOTE: firebase_app_id is NOT valid for web streams (G- measurement IDs).
    // Sending it causes GA4 to reject the entire payload with VALUE_INVALID, so
    // events never appear in Realtime reports. Field omitted intentionally.
    events: events.map(e => {
      const params: Record<string, string | number> = {
        // Caller params (may not override GA4-reserved fields below)
        ...(e.params ?? {}),
        // Standard GA4 params — enforced last
        // Minimum recommended engagement time for GA4 session attribution
        engagement_time_msec: 100,
        session_id: getSessionId(),
      };
      return { name: e.name, params };
    }),
  };

  // Associate events with the signed-in user (separate from client_id)
  if (_userId) {
    body.user_id = _userId;
  }

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[Analytics] Sending events:', events.map(e => e.name).join(', '));
  }

  if (__DEV__ && !process.env.JEST_WORKER_ID) {
    // Hit the validation endpoint and log any issues GA4 reports.
    // Skipped in Jest (JEST_WORKER_ID is set) to avoid a second fetch call
    // that would break toHaveBeenCalledTimes(1) assertions.
    fetch(validationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(json => {
        const issues = json?.validationMessages ?? [];
        if (issues.length > 0) {
          // eslint-disable-next-line no-console
          console.warn('[Analytics] GA4 validation issues:', JSON.stringify(issues, null, 2));
        } else {
          // eslint-disable-next-line no-console
          console.log(
            '[Analytics] GA4 validation: ✅ all events valid — check GA4 → Reports → Realtime'
          );
        }
      })
      .catch(() => {
        /* ignore validation network errors */
      });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (__DEV__) {
      if (response.ok) {
        // eslint-disable-next-line no-console
        console.log('[Analytics] ✅', response.status, '— events ingested by GA4');
      } else {
        // eslint-disable-next-line no-console
        console.warn('[Analytics] ❌', response.status, '— GA4 rejected events');
        const text = await response.text().catch(() => '');
        // eslint-disable-next-line no-console
        console.warn('[Analytics] Response body:', text.slice(0, 300));
      }
    }
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
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
    screen_name: screenName,
    screen_class: screenClass ?? screenName,
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
  event:
    | 'game_started'
    | 'game_completed'
    | 'game_session_summary'
    | 'game_abandoned'
    | 'game_voided'
    | 'game_not_completed',
  params?: AnalyticsEventParams
): void {
  trackEvent(event, params);
}

/** Track a card play or combo event during gameplay. */
export function trackGameplayAction(
  action:
    | 'card_play'
    | 'card_pass'
    | 'combo_played'
    | 'play_error'
    | 'play_validation_error'
    | 'play_method_used',
  params?: AnalyticsEventParams
): void {
  trackEvent(action, params);
}

/** Track feature usage events (chat, camera, hints, throwables, etc.). */
export function trackFeatureUsage(feature: string, params?: AnalyticsEventParams): void {
  trackEvent('feature_used', { ...params, feature_name: feature });
}

/** Track connection state changes. */
export function trackConnection(
  event: 'disconnect' | 'reconnect',
  params?: AnalyticsEventParams
): void {
  trackEvent(event, params);
}

/** Track social events (friends, rooms). */
export function trackSocial(
  event:
    | 'friend_added'
    | 'friend_removed'
    | 'room_created'
    | 'room_joined'
    | 'matchmaking_started'
    | 'matchmaking_cancelled'
    | 'matchmaking_found',
  params?: AnalyticsEventParams
): void {
  trackEvent(event, params);
}

/** Named export object for convenience (e.g. analytics.track). */
export const analytics = {
  track: trackEvent,
  screenView: trackScreenView,
  error: trackError,
  setUserId: setAnalyticsUserId,
  setConsent: setAnalyticsConsent,
  isEnabled: isAnalyticsEnabled,
  gameplay: trackGameplayAction,
  feature: trackFeatureUsage,
  connection: trackConnection,
  social: trackSocial,
  game: trackGameEvent,
  auth: trackAuthEvent,
};

// ─── Screen time tracking ─────────────────────────────────────────────────── //

/**
 * Tracks time spent on each screen. Call `screenTimeStart` when entering a screen
 * and `screenTimeEnd` when leaving. Emits a `screen_time` event with duration.
 */
const _screenTimeStarts = new Map<string, number>();

export function screenTimeStart(screenName: string): void {
  // Always record the start time regardless of consent state so that if consent
  // loads from AsyncStorage after navigation fires (async gap at app startup),
  // the duration is still measured correctly when screenTimeEnd is called.
  _screenTimeStarts.set(screenName, Date.now());
}

export function screenTimeEnd(screenName: string): void {
  const startTime = _screenTimeStarts.get(screenName);
  _screenTimeStarts.delete(screenName);
  if (!isAnalyticsEnabled()) return;
  if (startTime !== undefined) {
    const durationMs = Date.now() - startTime;
    const durationSec = Math.round(durationMs / 1000);
    if (durationSec > 0) {
      trackEvent('screen_time', {
        screen_name: screenName,
        duration_seconds: durationSec,
        duration_ms: durationMs,
      });
    }
  }
}

// ─── Hint tracking (hint → play vs hint → different play) ─────────────────── //

let _lastHintCardIds: string[] | null = null;

let _lastHintPlayerHand: string | null = null; // serialized card IDs of full hand at hint time
let _lastHintLastPlayCards: string | null = null; // serialized last-play cards at hint time

/**
 * Record which cards the hint suggested, plus full hand and last-play context.
 * Call from useHelperButtons.
 */
export function setLastHintCards(
  cardIds: string[] | null,
  playerHandIds?: string[] | null,
  lastPlayCardIds?: string[] | null
): void {
  _lastHintCardIds = cardIds;
  _lastHintPlayerHand = playerHandIds ? playerHandIds.join(',') : null;
  _lastHintLastPlayCards = lastPlayCardIds ? lastPlayCardIds.join(',') : null;
}

/** After a play, check if it matched the hint. Call from useGameActions on play. */
export function checkHintFollowed(playedCardIds: string[]): void {
  if (!_lastHintCardIds) return;
  const hintSet = new Set(_lastHintCardIds);
  const matched =
    playedCardIds.length === _lastHintCardIds.length && playedCardIds.every(id => hintSet.has(id));
  if (matched) {
    const params: AnalyticsEventParams = {
      played_cards: playedCardIds.length,
      hint_cards: _lastHintCardIds.length,
      hint_card_ids: _lastHintCardIds.join(',').slice(0, 100),
      played_was: playedCardIds.join(',').slice(0, 100),
    };
    if (_lastHintPlayerHand) params.player_hand = _lastHintPlayerHand.slice(0, 200);
    if (_lastHintLastPlayCards) params.last_play = _lastHintLastPlayCards.slice(0, 100);
    trackEvent('hint_result_played', params);
  } else {
    const params: AnalyticsEventParams = {
      played_cards: playedCardIds.length,
      hint_cards: _lastHintCardIds.length,
      hint_card_ids: _lastHintCardIds.join(',').slice(0, 100),
      played_was: playedCardIds.join(',').slice(0, 100),
    };
    if (_lastHintPlayerHand) params.player_hand = _lastHintPlayerHand.slice(0, 200);
    if (_lastHintLastPlayCards) params.last_play = _lastHintLastPlayCards.slice(0, 100);
    trackEvent('hint_result_ignored', params);
  }
  _lastHintCardIds = null;
  _lastHintPlayerHand = null;
  _lastHintLastPlayCards = null;
}

// ─── Turn time tracking ──────────────────────────────────────────────────── //

let _turnStartTime: number | null = null;

export function turnTimeStart(): void {
  // Always record start time regardless of consent, mirroring screenTimeStart /
  // featureDurationStart. The consent gate in turnTimeEnd prevents emission.
  _turnStartTime = Date.now();
}

export function turnTimeEnd(action: 'play' | 'pass' | 'timeout'): void {
  if (_turnStartTime !== null) {
    const durationMs = Date.now() - _turnStartTime;
    const durationSec = Math.round(durationMs / 1000);
    _turnStartTime = null;
    if (!isAnalyticsEnabled()) return;
    if (durationSec > 0) {
      trackEvent('turn_duration', {
        action,
        duration_seconds: durationSec,
        duration_ms: durationMs,
      });
    }
  }
}

// ─── Feature duration helpers ──────────────────────────────────────────────── //

const _featureStarts = new Map<string, number>();

/** Start tracking duration for a toggled-on feature (camera, mic, chat, etc.)
 * Records the start time unconditionally so duration is captured even if analytics
 * consent/credentials load asynchronously after the feature is opened. */
export function featureDurationStart(feature: string): void {
  _featureStarts.set(feature, Date.now());
}

/** End tracking duration and emit an analytics event with the session duration. */
export function featureDurationEnd(feature: string, eventName: AnalyticsEventName): void {
  const startTime = _featureStarts.get(feature);
  _featureStarts.delete(feature);
  if (!isAnalyticsEnabled()) return;
  if (startTime !== undefined) {
    const durationMs = Date.now() - startTime;
    const durationSec = Math.round(durationMs / 1000);
    if (durationSec > 0) {
      trackEvent(eventName, {
        feature_name: feature,
        duration_seconds: durationSec,
        duration_ms: durationMs,
      });
    }
  }
}
