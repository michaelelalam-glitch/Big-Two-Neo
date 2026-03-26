# Analytics & Error Tracking — Manual Test Guide

**Feature:** Task #272 — Firebase Analytics (Measurement Protocol v2) + Sentry Error Tracking  
**Branch:** `feat/task-272-error-tracking-analytics`  
**Services:** `src/services/analytics.ts`, `src/services/sentry.ts`

---

## Prerequisites

### 1. Environment Variables

Add the following to `apps/mobile/.env` (create if it doesn't exist):

```bash
# Firebase Analytics (GA4 Measurement Protocol v2)
# Found in Firebase Console → Analytics → Data Streams → Web Stream → Measurement Protocol API secrets
EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
EXPO_PUBLIC_FIREBASE_API_SECRET=your_api_secret_here

# Sentry Error Tracking
# Found in Sentry Console → Project Settings → Client Keys (DSN)
EXPO_PUBLIC_SENTRY_DSN=https://YOUR_KEY@oXXXXX.ingest.sentry.io/PROJECT_ID

# App version (shown in Sentry release tracking)
EXPO_PUBLIC_APP_VERSION=1.0.0
```

### 2. Firebase Console Setup

1. Open [Firebase Console](https://console.firebase.google.com/) → your project
2. Go to **Analytics → DebugView** (left sidebar)
3. Keep this tab open — events appear here in real time during testing

**Enable DebugView for your device:**
- **iOS Simulator:** DebugView activates automatically when `__DEV__ === true` (the app sends to `debug/mp/collect`)
- **Android Emulator:** Same — `__DEV__` mode auto-routes to the debug endpoint
- **Physical device:** Must be in dev build (`npx expo start`) for `__DEV__` to be true

### 3. Sentry Console Setup

1. Open [Sentry](https://sentry.io/) → your project → **Issues** dashboard
2. Open a second tab to **Performance** → Transactions for trace verification
3. Keep **Sentry Project Settings → Environments** visible (filter to `development` when testing locally)

---

## Test Scenario 1: App Open Event (Firebase)

**What it tests:** `trackEvent('app_open')` called in `App.tsx` after i18n initialises.

**Steps:**

1. Start the app: `cd apps/mobile && npx expo start --clear`
2. Open the app on simulator/device
3. In Firebase Console → **DebugView**, watch for the `app_open` event

**Expected in DebugView:**
```
Event: app_open
Parameters:
  platform: "ios" or "android"
  app_version: "1.0.0" (from EXPO_PUBLIC_APP_VERSION)
  engagement_time_msec: 1
  session_id: <numeric timestamp>
```

**Pass criteria:** `app_open` appears in DebugView within ~30 seconds of app launch.

---

## Test Scenario 2: User Sign-In Event (Firebase)

**What it tests:** `trackAuthEvent('user_signed_in')` + `setAnalyticsUserId()` called in `AuthContext.tsx`.

**Steps:**

1. With the app running, navigate to the sign-in screen
2. Sign in with a valid account
3. In Firebase DebugView, watch for `user_signed_in`

**Expected in DebugView:**
```
Event: user_signed_in
Parameters:
  platform: "ios" or "android"
  app_version: "1.0.0"
  engagement_time_msec: 1
  session_id: <numeric timestamp>
```

**Also verify:** In Firebase Console → **Analytics → User Explorer**, after a few hours (GA4 processing delay), the event appears associated with the `user_id` (Supabase UUID).

**Pass criteria:** `user_signed_in` event appears in DebugView.

---

## Test Scenario 3: User Sign-Out Event (Firebase)

**What it tests:** `trackAuthEvent('user_signed_out')` + `setAnalyticsUserId(null)` called on sign-out.

**Steps:**

1. While signed in, sign out from the app
2. In DebugView, watch for `user_signed_out`

**Expected:** `user_signed_out` event appears in DebugView.

---

## Test Scenario 4: Analytics Disabled Without Credentials (Firebase)

**What it tests:** Service gracefully no-ops when env vars are not set.

**Steps:**

1. Remove `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` and `EXPO_PUBLIC_FIREBASE_API_SECRET` from `.env`
2. Rebuild/restart the app
3. Perform sign-in and sign-out actions

**Expected:**
- No network requests to `www.google-analytics.com` (verify with Reactotron or Flipper network inspector)
- No crashes or console errors
- App functions normally

**Pass criteria:** `isAnalyticsEnabled()` returns `false`; no GA4 requests sent.

---

## Test Scenario 5: Consent Gate (Firebase)

**What it tests:** No events are sent before `setAnalyticsConsent(true)` is called.

**Code reference:** `consentGiven` defaults to `false` in `analytics.ts`; set to `true` in `App.tsx` after i18n init.

**Steps:**

1. Add a temporary breakpoint or log before the `setAnalyticsConsent(true)` call in `App.tsx`
2. Launch the app and quickly trigger an action that calls `trackEvent` before i18n completes
3. Verify no events appear in DebugView until after `setAnalyticsConsent(true)` fires

**Pass criteria:** DebugView shows no events until consent is explicitly given.

---

## Test Scenario 6: Sentry Initialisation

**What it tests:** `initSentry()` runs at app startup and registers with Sentry.

**Steps:**

1. With `EXPO_PUBLIC_SENTRY_DSN` set, start the app
2. In Sentry → **Issues** dashboard, verify the project shows **"Last seen"** updates
3. In the Metro bundler console, verify `[Sentry] Initializing...` debug output (only in `__DEV__`)

**Expected:**
- Sentry **debug mode** active in Metro console (dev builds only)
- No crash; Sentry initialised without errors

**Pass criteria:** Metro console shows Sentry init debug messages; Sentry dashboard is reachable.

---

## Test Scenario 7: Exception Capture (Sentry)

**What it tests:** `sentryCapture.exception()` sends an error event to Sentry.

**Steps:**

1. Temporarily add this code to a button press handler (e.g., in any screen):
   ```typescript
   import { sentryCapture } from '../services/sentry';
   sentryCapture.exception(new Error('Manual test error'), {
     context: 'ManualTest',
     tags: { test: 'true' },
   });
   ```
2. Press the button
3. In Sentry → **Issues**, look for a new issue titled `"Manual test error"`

**Expected in Sentry:**
- Issue appears with title `Error: Manual test error`
- Tags: `context: "ManualTest"`, `test: "true"`
- Environment: `"development"`
- Release: your `EXPO_PUBLIC_APP_VERSION` value

**Pass criteria:** Issue appears in Sentry Issues within ~10 seconds.

---

## Test Scenario 8: Fatal Error Handler (Sentry + App.tsx)

**What it tests:** The global `ErrorUtils.setGlobalHandler` in `App.tsx` captures fatal JS errors and calls `sentryCapture.exception` + `Sentry.flush()`.

**Steps:**

1. Temporarily add an unhandled throw to a component:
   ```typescript
   useEffect(() => {
     throw new Error('Simulated fatal crash');
   }, []);
   ```
2. Navigate to that screen
3. In Sentry → **Issues**, look for the fatal error

**Expected:**
- Fatal error captured with `tags: { fatal: 'true' }`
- Sentry flushes the event before the app terminates

**Pass criteria:** Error appears in Sentry Issues with `fatal: true` tag.

**Cleanup:** Remove the simulated crash after testing.

---

## Test Scenario 9: User Context in Sentry

**What it tests:** `setSentryUser()` attaches user identity to subsequent error events.

**Steps:**

1. Sign in to the app
2. Trigger a test exception (see Scenario 7)
3. In Sentry → Issues → click the issue → scroll to **User** section

**Expected:**
- User **ID** field shows the Supabase UUID
- After sign-out, subsequent errors should show no user context

**Pass criteria:** Sentry issue shows correct user ID linked to the signed-in account.

---

## Test Scenario 10: Sentry Disabled Without DSN

**What it tests:** Service no-ops gracefully when `EXPO_PUBLIC_SENTRY_DSN` is not set.

**Steps:**

1. Remove `EXPO_PUBLIC_SENTRY_DSN` from `.env`
2. Rebuild the app
3. Trigger actions that would normally report to Sentry

**Expected:**
- `isSentryEnabled()` returns `false`
- `sentryCapture.exception()` does nothing (no crash, no output)
- No network requests to `sentry.io`
- App functions normally

---

## Test Scenario 11: beforeSend Filter (Sentry)

**What it tests:** `beforeSend` in `sentry.ts` drops known non-fatal orientation errors.

**Steps:**

1. Simulate (or find in logs) an error containing `"supportedInterfaceOrientations"` and `"UIViewController"`
2. Verify the error does NOT appear in Sentry Issues

**Pass criteria:** The filtered error is silently dropped; no Sentry event created.

---

## Test Scenario 12: Firebase Debug API Validation

**What it tests:** Validate the event payload structure using the Measurement Protocol debug endpoint.

**Steps:**

1. Open Terminal and run a direct cURL against the debug endpoint:
   ```bash
   curl -X POST \
     "https://www.google-analytics.com/debug/mp/collect?measurement_id=G-XXXXXXXXXX&api_secret=YOUR_SECRET" \
     -H "Content-Type: application/json" \
     -d '{
       "client_id": "test-client-001",
       "events": [{
         "name": "app_open",
         "params": {
           "platform": "ios",
           "app_version": "1.0.0",
           "engagement_time_msec": 1,
           "session_id": 1743000000000
         }
       }]
     }'
   ```
2. Check the JSON response for validation errors

**Expected response:**
```json
{
  "validationMessages": []
}
```

**Fail example (booleans in params):**
```json
{
  "validationMessages": [
    {
      "fieldPath": "events[0].params.some_bool",
      "description": "Value is not a string or number.",
      "validationCode": "VALUE_INVALID"
    }
  ]
}
```

**Pass criteria:** `validationMessages` is empty — all event params are valid GA4 types.

---

## Checklist Summary

| # | Scenario | Tool | Pass? |
|---|----------|------|-------|
| 1 | App open event fires | Firebase DebugView | ☐ |
| 2 | Sign-in event fires + user_id set | Firebase DebugView | ☐ |
| 3 | Sign-out event fires | Firebase DebugView | ☐ |
| 4 | No-op without credentials | Network inspector | ☐ |
| 5 | Consent gate works | Firebase DebugView | ☐ |
| 6 | Sentry initialises | Metro console | ☐ |
| 7 | Exception captured | Sentry Issues | ☐ |
| 8 | Fatal error handler | Sentry Issues | ☐ |
| 9 | User context attached | Sentry Issues | ☐ |
| 10 | No-op without DSN | Network inspector | ☐ |
| 11 | beforeSend filter drops noise | Sentry Issues | ☐ |
| 12 | Debug API payload validation | cURL | ☐ |

---

## Troubleshooting

### Events not appearing in Firebase DebugView
- Confirm `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` and `EXPO_PUBLIC_FIREBASE_API_SECRET` are set and the app was **restarted** after adding them (Expo bundles env vars at start time)
- Check the Metro console for network errors
- DebugView only shows events from the past 30 minutes; refresh the page
- Verify the app is running in **dev mode** (`__DEV__ === true`) — production builds send to the non-debug endpoint and may have a ~24h delay before appearing in standard GA4 reports

### Sentry issues not appearing
- Confirm `EXPO_PUBLIC_SENTRY_DSN` is correct (copy from Sentry → Project Settings → Client Keys)
- In dev, Sentry's `debug: true` logs all events to Metro console — look for `Sentry: Sending event`
- Check the **Sentry project** matches the DSN (events go to a specific organization/project)
- Sentry may rate-limit new projects; check **Project Settings → Rate Limits**

### TypeScript errors on `Sentry.flush()`
- `@sentry/react-native@8.5.0` declares `flush(): Promise<boolean>` with no parameters
- Do NOT pass a timeout argument — use `Sentry.flush()` (no args)

### Coverage thresholds
- `analytics.ts` and `sentry.ts` are intentionally excluded from `collectCoverageFrom` in `jest.config.js` because they use native modules (Expo Constants, Sentry native bridge) that require device/simulator testing
- Unit tests mock both services — see `src/__tests__/__mocks__/sentry-react-native.ts` and `src/__tests__/__mocks__/expo-constants.ts`
