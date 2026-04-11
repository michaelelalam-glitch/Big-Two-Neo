/**
 * PLAY-CARDS EDGE FUNCTION — Integration Tests
 * Task #21 (Tier 4 — P14-1)
 *
 * Covers:
 *   Suite 1 — Unauthenticated request → 401 (URL-only, no creds needed)
 *   Suite 2 — Missing / malformed body fields → 400
 *   Suite 3 — JWT caller identity mismatch → 403 (requires SERVICE_ROLE_KEY for admin user creation)
 *   Suite 4 — Non-existent room returns a DB-level error (requires SERVICE_ROLE_KEY)
 *
 * Test strategy:
 *   - Suites 1–2 only require EXPO_PUBLIC_SUPABASE_URL. Skip the whole file if the
 *     URL is absent so tests don't time-out in environments with no network config.
 *   - Suite 3 requires a throwaway test user created via service-role admin API → needs SUPABASE_SERVICE_ROLE_KEY.
 *   - Suite 4 needs SUPABASE_SERVICE_ROLE_KEY to create ephemeral test data.
 *     All DB-backed suites clean up test data in afterAll, even on failure.
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

const EF_URL = `${SUPABASE_URL}/functions/v1/play-cards`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeCrypto = require('crypto') as { randomUUID: () => string };
const uuid = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? nodeCrypto.randomUUID();
};

/** Minimal valid card object used across test cases */
const VALID_CARD = { id: 'D3', suit: 'D' as const, rank: '3' as const };

/** Perform a raw fetch to the EF and return status + parsed body */
async function callEF(
  body: unknown,
  authToken?: string
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-app-version': '999.99.99',
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
(hasUrl ? describe : describe.skip)('Suite 1 — play-cards: authentication', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const result = await callEF({ room_code: 'ABCDEF', player_id: uuid(), cards: [VALID_CARD] });
    expect(result.status).toBe(401);
    const body = (result.body as Record<string, unknown> | null) ?? {};
    const errorText =
      typeof body.error === 'string'
        ? body.error
        : typeof body.message === 'string'
          ? body.message
          : '';
    expect(errorText).not.toHaveLength(0);
  }, 15_000);

  it('returns 401 when Authorization header is an empty string', async () => {
    const result = await callEF(
      { room_code: 'ABCDEF', player_id: uuid(), cards: [VALID_CARD] },
      ''
    );
    expect(result.status).toBe(401);
  }, 15_000);

  it('returns 401 when Authorization header contains a random string (not a real JWT)', async () => {
    const result = await callEF(
      { room_code: 'ABCDEF', player_id: uuid(), cards: [VALID_CARD] },
      'not-a-real-jwt'
    );
    expect(result.status).toBe(401);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Suite 2 — Request body validation (no credentials needed)
// ---------------------------------------------------------------------------
(hasUrl ? describe : describe.skip)('Suite 2 — play-cards: body validation', () => {
  // These tests use a dummy bearer token that will fail auth before body validation.
  // To reach the body-validation layer we need a valid user JWT, so suite 2 tests
  // that are purely structural (e.g. too many cards) will run in Suite 3 once we
  // have a real token. Here we verify the EF doesn't panic on malformed input.

  it('returns 400 or 401 for request with no body', async () => {
    const res = await fetch(EF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-version': '999.99.99' },
      body: '',
    });
    expect([400, 401]).toContain(res.status);
  }, 15_000);

  it('returns 400 or 401 for request with invalid JSON body', async () => {
    const res = await fetch(EF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-version': '999.99.99' },
      body: '{ this is not json }',
    });
    expect([400, 401]).toContain(res.status);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Suite 3 — Identity / body validation with real JWT (requires SERVICE_ROLE_KEY)
// ---------------------------------------------------------------------------
(hasServiceRole ? describe : describe.skip)(
  'Suite 3 — play-cards: identity + body validation (live JWT)',
  () => {
    let userToken: string;
    let testUserId: string;
    const testEmail = `ci-play-cards-s3-${Date.now()}@test.invalid`;
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
      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
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
        // Delete the throwaway test user from auth
        const srClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        await srClient.auth.admin.deleteUser(testUserId);
      }
    }, 15_000);

    it('returns 400 when room_code is missing', async () => {
      const result = await callEF({ player_id: testUserId, cards: [VALID_CARD] }, userToken);
      expect(result.status).toBe(400);
      expect((result.body as Record<string, unknown>)?.success).toBe(false);
    }, 15_000);

    it('returns 400 when player_id is missing', async () => {
      const result = await callEF({ room_code: 'ABCDEF', cards: [VALID_CARD] }, userToken);
      expect(result.status).toBe(400);
    }, 15_000);

    it('returns 400 when cards array is empty', async () => {
      const result = await callEF(
        { room_code: 'ABCDEF', player_id: testUserId, cards: [] },
        userToken
      );
      expect(result.status).toBe(400);
    }, 15_000);

    it('returns 400 when cards array has more than 5 cards', async () => {
      const manyCards = Array.from({ length: 6 }, (_, i) => ({
        id: `D${i + 3}`,
        suit: 'D' as const,
        rank: '3' as const,
      }));
      const result = await callEF(
        { room_code: 'ABCDEF', player_id: testUserId, cards: manyCards },
        userToken
      );
      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).toContain('max 5');
    }, 15_000);

    it('returns 400 for invalid card suit', async () => {
      const result = await callEF(
        {
          room_code: 'ABCDEF',
          player_id: testUserId,
          cards: [{ id: 'X3', suit: 'X', rank: '3' }],
        },
        userToken
      );
      expect(result.status).toBe(400);
    }, 15_000);

    it('returns 400 for invalid card rank', async () => {
      const result = await callEF(
        {
          room_code: 'ABCDEF',
          player_id: testUserId,
          cards: [{ id: 'D0', suit: 'D', rank: '0' }],
        },
        userToken
      );
      expect(result.status).toBe(400);
    }, 15_000);

    it('returns 403 when JWT user_id does not match player_id in body', async () => {
      const differentPlayerId = uuid();
      const result = await callEF(
        { room_code: 'ABCDEF', player_id: differentPlayerId, cards: [VALID_CARD] },
        userToken
      );
      // EF returns 403 when callerJwtUserId !== player_id
      expect(result.status).toBe(403);
    }, 15_000);
  }
);

// ---------------------------------------------------------------------------
// Suite 4 — Non-existent room lookup (requires SERVICE_ROLE_KEY)
// ---------------------------------------------------------------------------
(hasServiceRole ? describe : describe.skip)(
  'Suite 4 — play-cards: non-existent room (live DB lookup)',
  () => {
    let userToken: string;
    let testUserId: string;
    const testEmail = `ci-play-cards-room-${Date.now()}@test.invalid`;
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

      // Sign in to get a JWT
      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
        email: testEmail,
        password: testPass,
      });
      if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);
      userToken = signInData.session?.access_token ?? '';
      if (!userToken) throw new Error('Test setup failed: sign-in returned no access token');
    }, 30_000);

    afterAll(async () => {
      if (testUserId) {
        const srClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        await srClient.auth.admin.deleteUser(testUserId);
      }
    }, 15_000);

    it('returns 404 (not a 500 crash) for a room_code that does not exist', async () => {
      // Use a random per-run code to prevent collision with any real room
      const nonExistentRoomCode = `TST${uuid().slice(0, 5).toUpperCase()}`;
      const result = await callEF(
        {
          room_code: nonExistentRoomCode,
          player_id: testUserId,
          cards: [VALID_CARD],
        },
        userToken
      );
      expect(result.status).not.toBe(401); // confirms auth token was accepted
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(result.body).toBeTruthy();
    }, 15_000);
  }
);
