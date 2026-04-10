/**
 * COMPLETE-GAME EDGE FUNCTION — Integration Tests
 * Task #21 (Tier 4 — P14-1)
 *
 * Covers:
 *   Suite 1 — Unauthenticated request → 401
 *   Suite 2 — Rejected reserved room_code 'LOCAL' → 400
 *   Suite 3 — Invalid game_type → 400 (requires ANON_KEY)
 *   Suite 4 — Valid structure but non-existent room / users (requires SERVICE_ROLE_KEY)
 *
 * The complete-game EF accepts a full GameCompletionRequest body. Suites 1–2 test
 * structural and reserved-value rejections. Suite 3 confirms input validation with a
 * real JWT. Suite 4 exercises the DB lookup path with a lightweight payload.
 *
 * Test strategy: All test users are ephemeral and deleted in afterAll.
 */

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Env / credential flags
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const hasUrl = Boolean(SUPABASE_URL);
const hasAnonKey = hasUrl && Boolean(SUPABASE_ANON_KEY);
const hasServiceRole = hasAnonKey && Boolean(SUPABASE_SERVICE_ROLE);

const EF_URL = `${SUPABASE_URL}/functions/v1/complete-game`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeCrypto = require('crypto') as { randomUUID: () => string };
const uuid = (): string => (globalThis as any).crypto?.randomUUID?.() ?? nodeCrypto.randomUUID();

const now = new Date().toISOString();

/** Build a minimal but structurally-valid GameCompletionRequest body */
function buildMinimalBody(overrides: Record<string, unknown> = {}) {
  const playerId = uuid();
  return {
    room_id: null,
    room_code: 'TESTAB',
    game_type: 'casual' as const,
    bot_difficulty: null,
    players: [
      {
        user_id: playerId,
        username: 'TestPlayer',
        score: 0,
        finish_position: 1,
        cards_left: 0,
        was_bot: false,
        disconnected: false,
        original_username: null,
        combos_played: {
          singles: 0,
          pairs: 0,
          triples: 0,
          straights: 0,
          flushes: 0,
          full_houses: 0,
          four_of_a_kinds: 0,
          straight_flushes: 0,
          royal_flushes: 0,
        },
      },
    ],
    winner_id: playerId,
    game_duration_seconds: 120,
    started_at: now,
    finished_at: now,
    game_completed: true,
    ...overrides,
  };
}

async function callEF(
  body: unknown,
  authToken?: string
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(EF_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

// ---------------------------------------------------------------------------
// Suite 1 — Authentication (URL-only)
// ---------------------------------------------------------------------------
describe('Suite 1 — complete-game: authentication', () => {
  if (!hasUrl) {
    it.todo('skipped — EXPO_PUBLIC_SUPABASE_URL not configured');
    return;
  }

  it('returns 401 when Authorization header is absent', async () => {
    const result = await callEF(buildMinimalBody());
    expect(result.status).toBe(401);
    expect((result.body as any)?.error).toBeTruthy();
  }, 15_000);

  it('returns 401 when Authorization header is not a valid JWT', async () => {
    const result = await callEF(buildMinimalBody(), 'fake-token');
    expect(result.status).toBe(401);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Suite 2 — Reserved room_code 'LOCAL' (URL-only — 401 fires before code check,
//           but LOCAL rejection is visible to any authenticated caller)
// ---------------------------------------------------------------------------
describe('Suite 2 — complete-game: LOCAL room_code rejection', () => {
  if (!hasUrl) {
    it.todo('skipped — EXPO_PUBLIC_SUPABASE_URL not configured');
    return;
  }

  // Without auth the EF returns 401 before it reaches the LOCAL code check.
  it('returns 401 (not 400) for LOCAL room_code when unauthenticated', async () => {
    const result = await callEF(buildMinimalBody({ room_code: 'LOCAL' }));
    expect(result.status).toBe(401);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Suite 3 — Input validation + LOCAL rejection with a real JWT (requires SERVICE_ROLE_KEY)
// ---------------------------------------------------------------------------
describe('Suite 3 — complete-game: input validation (live JWT)', () => {
  if (!hasServiceRole) {
    it.todo('skipped — SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  let userToken: string;
  let testUserId: string;
  const testEmail = `ci-complete-game-s3-${Date.now()}@test.invalid`;
  const testPass = `Ci-T3st-${uuid().slice(0, 8)}!`;

  beforeAll(async () => {
    // Use admin.createUser so the account is email-confirmed immediately
    const srClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await srClient.auth.admin.createUser({
      email: testEmail,
      password: testPass,
      email_confirm: true,
    });
    if (error) throw new Error(`Test setup failed (createUser): ${error.message}`);
    testUserId = data.user?.id ?? '';

    // Sign in via anon client to obtain a JWT
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: testPass,
    });
    if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);
    userToken = signInData.session?.access_token ?? '';
    if (!userToken) throw new Error('Test setup failed: no access token returned');
  }, 30_000);

  afterAll(async () => {
    if (hasServiceRole && testUserId) {
      const srClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await srClient.auth.admin.deleteUser(testUserId);
    }
  }, 15_000);

  it('returns 400 with LOCAL_GAME_REJECTED when room_code is LOCAL', async () => {
    const result = await callEF(buildMinimalBody({ room_code: 'LOCAL' }), userToken);
    expect(result.status).toBe(400);
    expect((result.body as any)?.code).toBe('LOCAL_GAME_REJECTED');
  }, 15_000);

  it('returns 400 for invalid game_type', async () => {
    const result = await callEF(buildMinimalBody({ game_type: 'unknown_type' }), userToken);
    expect(result.status).toBe(400);
  }, 15_000);

  it('returns 400 for game_type of totally wrong type (number)', async () => {
    const result = await callEF(buildMinimalBody({ game_type: 42 }), userToken);
    expect(result.status).toBe(400);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Suite 4 — Non-existent winner_id DB lookup (requires SERVICE_ROLE_KEY)
// ---------------------------------------------------------------------------
describe('Suite 4 — complete-game: non-existent winner lookup (live DB)', () => {
  if (!hasServiceRole) {
    it.todo('skipped — SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  let userToken: string;
  let testUserId: string;
  const testEmail = `ci-cg-room-${Date.now()}@test.invalid`;
  const testPass = `Ci-T3st-${uuid().slice(0, 8)}!`;

  beforeAll(async () => {
    const srClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await srClient.auth.admin.createUser({
      email: testEmail,
      password: testPass,
      email_confirm: true,
    });
    if (error) throw new Error(`Test setup failed: ${error.message}`);
    testUserId = data.user?.id ?? '';

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: testPass,
    });
    if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);
    userToken = signInData.session?.access_token ?? '';
  }, 30_000);

  afterAll(async () => {
    if (testUserId) {
      const srClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await srClient.auth.admin.deleteUser(testUserId);
    }
  }, 15_000);

  it('returns a 4xx error (not 5xx) when winner_id is a non-existent UUID', async () => {
    const body = buildMinimalBody({
      room_code: 'NOROOM',
      winner_id: uuid(), // a random UUID that doesn't exist in profiles
    });
    const result = await callEF(body, userToken);
    // Should return a controlled 4xx, not a 500 crash
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  }, 15_000);
});
