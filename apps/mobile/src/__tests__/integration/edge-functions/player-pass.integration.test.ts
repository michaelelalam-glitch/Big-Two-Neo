/**
 * PLAYER-PASS EDGE FUNCTION — Integration Tests
 * Task #21 (Tier 4 — P14-1)
 *
 * Covers:
 *   Suite 1 — Unauthenticated request → 401
 *   Suite 2 — Missing / malformed body fields → 400
 *   Suite 3 — JWT caller identity mismatch → 403 (requires SERVICE_ROLE_KEY for admin user creation)
 *   Suite 4 — Non-existent room returns a controlled error (requires SERVICE_ROLE_KEY)
 *
 * Test strategy mirrors play-cards.integration.test.ts — see header there for details.
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

const EF_URL = `${SUPABASE_URL}/functions/v1/player-pass`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeCrypto = require('crypto') as { randomUUID: () => string };
const uuid = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? nodeCrypto.randomUUID();
};

async function callEF(
  body: unknown,
  authToken?: string
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-app-version': '1.0.0',
  };
  if (authToken !== undefined) headers['Authorization'] = `Bearer ${authToken}`;

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
// Suite 1 — Authentication (no credentials needed beyond URL)
// ---------------------------------------------------------------------------
describe('Suite 1 — player-pass: authentication', () => {
  if (!hasUrl) {
    it.todo('skipped — EXPO_PUBLIC_SUPABASE_URL not configured');
    return;
  }

  it('returns 401 when Authorization header is absent', async () => {
    const result = await callEF({ room_code: 'ABCDEF', player_id: uuid() });
    expect(result.status).toBe(401);
  }, 15_000);

  it('returns 401 when Authorization header is an unrecognized token', async () => {
    const result = await callEF({ room_code: 'ABCDEF', player_id: uuid() }, 'garbage-token-value');
    expect(result.status).toBe(401);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Suite 2 — Request body validation (no credentials needed)
// ---------------------------------------------------------------------------
describe('Suite 2 — player-pass: body validation (no auth)', () => {
  if (!hasUrl) {
    it.todo('skipped — EXPO_PUBLIC_SUPABASE_URL not configured');
    return;
  }

  it('returns 400 or 401 for empty body', async () => {
    const res = await fetch(EF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-version': '1.0.0' },
      body: '',
    });
    expect([400, 401]).toContain(res.status);
  }, 15_000);

  it('returns 400 or 401 for non-JSON body', async () => {
    const res = await fetch(EF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-version': '1.0.0' },
      body: 'not json',
    });
    expect([400, 401]).toContain(res.status);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Suite 3 — Identity + body validation with real JWT (requires SERVICE_ROLE_KEY)
// ---------------------------------------------------------------------------
describe('Suite 3 — player-pass: body validation + identity (live JWT)', () => {
  if (!hasServiceRole) {
    it.todo('skipped — SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  let userToken: string;
  let testUserId: string;
  const testEmail = `ci-player-pass-s3-${Date.now()}@test.invalid`;
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

  it('returns 400 when room_code is missing from body', async () => {
    const result = await callEF({ player_id: testUserId }, userToken);
    expect(result.status).toBe(400);
  }, 15_000);

  it('returns 400 when player_id is missing from body', async () => {
    const result = await callEF({ room_code: 'ABCDEF' }, userToken);
    expect(result.status).toBe(400);
  }, 15_000);

  it('returns 400 when both required fields are missing', async () => {
    const result = await callEF({}, userToken);
    expect(result.status).toBe(400);
  }, 15_000);

  it('returns 403 when JWT user_id does not match player_id in body', async () => {
    const differentId = uuid();
    const result = await callEF({ room_code: 'ABCDEF', player_id: differentId }, userToken);
    // player-pass mirrors play-cards: returns 403 on identity mismatch
    expect(result.status).toBe(403);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Suite 4 — Non-existent room (requires SERVICE_ROLE_KEY)
// ---------------------------------------------------------------------------
describe('Suite 4 — player-pass: non-existent room (live DB lookup)', () => {
  if (!hasServiceRole) {
    it.todo('skipped — SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  let userToken: string;
  let testUserId: string;
  const testEmail = `ci-pass-room-${Date.now()}@test.invalid`;
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

  it('returns a 4xx error (not 5xx) when room_code does not exist', async () => {
    const result = await callEF({ room_code: 'ZZZZZZ', player_id: testUserId }, userToken);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  }, 15_000);
});
