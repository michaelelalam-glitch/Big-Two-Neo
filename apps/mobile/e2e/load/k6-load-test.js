/**
 * k6 Load Test — Big Two Neo Edge Functions
 * Task #23 (Tier 4 — P14-3)
 *
 * Targets: play-cards, find-match
 *
 * Usage:
 *   k6 run --env SUPABASE_URL=https://xxx.supabase.co \
 *           --env ANON_KEY=eyJ... \
 *           --env SERVICE_ROLE_KEY=eyJ... \
 *           e2e/load/k6-load-test.js
 *
 * Scenarios:
 *   1. auth-error-flood   — Test that 401 is returned quickly under load (no auth)
 *   2. play-cards-load    — Authenticated play-cards with invalid room (tests throughput
 *                           and that CAS / DB logic doesn't time out under concurrency)
 *   3. find-match-load    — Authenticated find-match calls (tests matchmaking queue stability)
 *
 * Thresholds:
 *   - 95th-percentile response time < 2 s  (all scenarios)
 *   - Error rate < 10 %  (5xx responses only — 4xx are expected for bad input)
 *
 * Requirements:
 *   k6 ≥ 0.46  (https://grafana.com/docs/k6/latest/get-started/installation/)
 */

import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const errorRate    = new Rate('http_errors_5xx');
const playCardsDur = new Trend('play_cards_duration');
const findMatchDur = new Trend('find_match_duration');

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export const options = {
  scenarios: {
    // Scenario 1 — unauthenticated flood (baseline: 401 latency under load)
    auth_error_flood: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '15s', target: 20 },
        { duration: '30s', target: 20 },
        { duration: '10s', target:  0 },
      ],
      gracefulRampDown: '5s',
      exec: 'authErrorFlood',
      tags: { scenario: 'auth_error_flood' },
    },

    // Scenario 2 — authenticated play-cards load
    play_cards_load: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 10 },
        { duration: '40s', target: 10 },
        { duration: '10s', target:  0 },
      ],
      gracefulRampDown: '5s',
      exec: 'playCardsLoad',
      tags: { scenario: 'play_cards_load' },
      startTime: '55s',  // start after auth_error_flood completes
    },

    // Scenario 3 — find-match concurrency
    find_match_load: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 15 },
        { duration: '40s', target: 15 },
        { duration: '10s', target:  0 },
      ],
      gracefulRampDown: '5s',
      exec: 'findMatchLoad',
      tags: { scenario: 'find_match_load' },
      startTime: '55s',  // run alongside play_cards_load
    },
  },

  thresholds: {
    // 95th-percentile < 2 s for all EF calls
    http_req_duration: ['p(95)<2000'],
    // 5xx rate must stay below 10 %
    http_errors_5xx: ['rate<0.10'],
  },
};

// ---------------------------------------------------------------------------
// Config (injected via --env flags)
// ---------------------------------------------------------------------------
const SUPABASE_URL      = __ENV.SUPABASE_URL      ?? '';
const ANON_KEY          = __ENV.ANON_KEY           ?? '';
const SERVICE_ROLE_KEY  = __ENV.SERVICE_ROLE_KEY   ?? '';

// ---------------------------------------------------------------------------
// Setup: obtain a throwaway JWT once before tests start
// ---------------------------------------------------------------------------
export function setup() {
  if (!SUPABASE_URL) {
    fail('[k6] SUPABASE_URL is required. Pass --env SUPABASE_URL=https://xxx.supabase.co');
  }
  if (!ANON_KEY) {
    console.warn('[k6] ANON_KEY not set — authenticated scenarios will produce 401s');
    return { token: '' };
  }

  // Sign in with service-role to create a test user, then sign in as that user
  const email    = `k6-load-${Date.now()}@test.invalid`;
  const password = `K6-T3st-${Math.random().toString(36).slice(2, 10)}!`;

  if (SERVICE_ROLE_KEY) {
    // Create user via admin API
    const createRes = http.post(
      `${SUPABASE_URL}/auth/v1/admin/users`,
      JSON.stringify({ email, password, email_confirm: true }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'apikey': SERVICE_ROLE_KEY,
        },
      },
    );
    if (createRes.status !== 200 && createRes.status !== 201) {
      console.error('[k6] setup: user creation failed', createRes.status, createRes.body);
      return { token: '', userId: '' };
    }
    const userId = JSON.parse(createRes.body).id ?? '';
    console.log('[k6] setup: created test user', userId);

    // Sign in
    const signInRes = http.post(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      JSON.stringify({ email, password }),
      {
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
        },
      },
    );
    if (signInRes.status !== 200) {
      console.error('[k6] setup: sign-in failed', signInRes.status);
      return { token: '', userId };
    }
    const token = JSON.parse(signInRes.body).access_token ?? '';
    console.log('[k6] setup: obtained JWT, length', token.length);
    return { token, userId };
  }

  return { token: '' };
}

// ---------------------------------------------------------------------------
// Teardown: remove the throwaway test user
// ---------------------------------------------------------------------------
export function teardown(data) {
  if (!data.userId || !SERVICE_ROLE_KEY) return;
  http.del(
    `${SUPABASE_URL}/auth/v1/admin/users/${data.userId}`,
    null,
    {
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
      },
    },
  );
  console.log('[k6] teardown: deleted test user', data.userId);
}

// ---------------------------------------------------------------------------
// Scenario executions
// ---------------------------------------------------------------------------

/** Scenario 1 — unauthenticated requests to play-cards → expect 401 quickly */
export function authErrorFlood() {
  const res = http.post(
    `${SUPABASE_URL}/functions/v1/play-cards`,
    JSON.stringify({ room_code: 'LOAD01', player_id: 'fake', cards: [] }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  errorRate.add(res.status >= 500);
  check(res, {
    'play-cards 401 on no auth': (r) => r.status === 401,
    'play-cards response time < 2s': (r) => r.timings.duration < 2000,
  });
  sleep(0.1);
}

/** Scenario 2 — play-cards with valid JWT but invalid room (tests DB lookup + CAS path) */
export function playCardsLoad(data) {
  const token = data.token;
  if (!token) {
    // Degrade gracefully: count as expected 401 under no-creds environment
    authErrorFlood();
    return;
  }

  const res = http.post(
    `${SUPABASE_URL}/functions/v1/play-cards`,
    JSON.stringify({
      room_code: 'XXXXXX',  // non-existent — exercises DB lookup without writing state
      player_id: data.userId ?? 'unused',
      cards: [{ id: 'D3', suit: 'D', rank: '3' }],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    },
  );

  playCardsDur.add(res.timings.duration);
  errorRate.add(res.status >= 500);
  check(res, {
    'play-cards no 5xx under load': (r) => r.status < 500,
    'play-cards response time < 2s': (r) => r.timings.duration < 2000,
  });
  sleep(0.2);
}

/** Scenario 3 — find-match with valid JWT (tests matchmaking queue stability) */
export function findMatchLoad(data) {
  const token = data.token;
  if (!token) {
    sleep(0.1);
    return;
  }

  const res = http.post(
    `${SUPABASE_URL}/functions/v1/find-match`,
    JSON.stringify({
      match_type: 'casual',
      skill_rating: 1000,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    },
  );

  findMatchDur.add(res.timings.duration);
  errorRate.add(res.status >= 500);
  check(res, {
    'find-match no 5xx under load': (r) => r.status < 500,
    'find-match response time < 2s': (r) => r.timings.duration < 2000,
  });
  sleep(0.3);
}
