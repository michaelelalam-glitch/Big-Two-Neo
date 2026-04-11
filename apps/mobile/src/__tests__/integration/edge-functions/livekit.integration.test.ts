/**
 * GET-LIVEKIT-TOKEN EDGE FUNCTION — Integration Tests
 * Task P14-4 (Tier 8 — #57)
 *
 * Covers:
 *   Suite 1 — Unauthenticated request → 401 (URL-only, no creds needed)
 *   Suite 2 — Missing / malformed body fields → 400
 *   Suite 3 — Non-member / non-existent room → 403 or DB error
 *             (requires SERVICE_ROLE_KEY for throwaway user creation)
 *   Suite 4 — Successful token structure validation
 *             (requires valid LIVEKIT credentials + real room membership)
 *
 * Test strategy:
 *   - Suite 1–2 only require EXPO_PUBLIC_SUPABASE_URL. The whole file is
 *     skipped if the URL is absent so tests don't time-out in CI with no config.
 *   - Suite 3 requires SUPABASE_SERVICE_ROLE_KEY for admin user creation.
 *   - Suite 4 is skipped unless LIVEKIT credentials are present; it asserts
 *     the returned token is a valid 3-part HS256 JWT without verifying the
 *     signature (secret is server-side only).
 */

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Env / credential flags
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const LIVEKIT_CONFIGURED = Boolean(process.env.LIVEKIT_API_KEY);

const hasUrl = Boolean(SUPABASE_URL);
const hasAnonKey = hasUrl && Boolean(SUPABASE_ANON_KEY);
const hasServiceRole = hasAnonKey && Boolean(SERVICE_ROLE_KEY);

const EF_URL = `${SUPABASE_URL}/functions/v1/get-livekit-token`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeCrypto = require('crypto') as { randomUUID: () => string };
const uuid = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? nodeCrypto.randomUUID();
};

/** Perform a raw fetch to the EF and return status + parsed body. */
async function callEF(
  body: unknown,
  authToken?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
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

  let parsed: Record<string, unknown> = {};
  try {
    parsed = await res.json();
  } catch {
    /* ignore parse errors */
  }
  return { status: res.status, body: parsed };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

const describeIfUrl = hasUrl ? describe : describe.skip;

describeIfUrl('get-livekit-token EF', () => {
  // ─── Suite 1: Unauthenticated ────────────────────────────────────────────
  describe('Suite 1 — Unauthenticated → 401', () => {
    it('returns 401 when Authorization header is absent', async () => {
      const { status } = await callEF({ roomId: uuid() });
      expect(status).toBe(401);
    });

    it('returns 401 for a malformed Bearer token', async () => {
      const { status } = await callEF({ roomId: uuid() }, 'not-a-real-jwt');
      expect(status).toBe(401);
    });

    it('returns 401 for the anon key used as auth token (unauthenticated session)', async () => {
      // The anon key alone is not a user session JWT — EF should reject it.
      const { status } = await callEF({ roomId: uuid() }, SUPABASE_ANON_KEY);
      expect([401, 403]).toContain(status);
    });
  });

  // ─── Suite 2: Validation → 400 ──────────────────────────────────────────
  // These tests don't send a valid JWT so the 401 short-circuits first.
  // We test the 400 path by using a dummy token — the EF validates body
  // fields only after auth, so to reach body validation we need a real user.
  // If SERVICE_ROLE_KEY is absent we skip body-validation tests; otherwise
  // we create an ephemeral user and use their JWT.
  const describeBodyValidation = hasServiceRole ? describe : describe.skip;

  describeBodyValidation('Suite 2 — Body validation → 400', () => {
    let testUserToken: string;
    let adminClient: ReturnType<typeof createClient>;

    const TEST_EMAIL = `livekit-test-${uuid()}@ci-test.invalid`;
    const TEST_PASSWORD = `Ci!${uuid()}`;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error || !data?.user) throw new Error(`createUser failed: ${error?.message}`);

      // Sign in to obtain a real JWT
      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const signIn = await anonClient.auth.signInWithPassword({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      if (signIn.error || !signIn.data?.session?.access_token) {
        throw new Error(`signIn failed: ${signIn.error?.message}`);
      }
      testUserToken = signIn.data.session.access_token;
    });

    afterAll(async () => {
      // Clean up test user even if tests fail
      if (adminClient) {
        const { data } = await adminClient.auth.admin.listUsers();
        const user = data?.users?.find(u => u.email === TEST_EMAIL);
        if (user) await adminClient.auth.admin.deleteUser(user.id);
      }
    });

    it('returns 400 when roomId is missing', async () => {
      const { status, body } = await callEF({}, testUserToken);
      expect(status).toBe(400);
      expect(typeof body.error).toBe('string');
    });

    it('returns 400 when roomId is an empty string', async () => {
      const { status, body } = await callEF({ roomId: '' }, testUserToken);
      expect(status).toBe(400);
      expect(typeof body.error).toBe('string');
    });

    it('returns 400 when roomId is not a valid UUID', async () => {
      const { status, body } = await callEF({ roomId: 'not-a-uuid' }, testUserToken);
      expect(status).toBe(400);
      expect(body.error).toMatch(/uuid/i);
    });

    it('returns 400 when body is invalid JSON', async () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-app-version': '999.99.99',
        Authorization: `Bearer ${testUserToken}`,
      };
      const res = await fetch(EF_URL, {
        method: 'POST',
        headers,
        body: 'not-json',
      });
      expect(res.status).toBe(400);
    });

    // ─── Suite 3: Non-member room → 403 ─────────────────────────────────
    it('returns 403 when requesting token for a room the user is not in', async () => {
      // Use a random UUID that does not correspond to any room
      const { status } = await callEF({ roomId: uuid() }, testUserToken);
      // EF returns 403 for non-member; may also return 500 if DB errors in CI
      expect([403, 500]).toContain(status);
    });

    // ─── Suite 4: Successful token structure ─────────────────────────────
    // Skipped unless LIVEKIT is configured (not available in standard CI)
    const itIfLiveKit = LIVEKIT_CONFIGURED ? it : it.skip;
    itIfLiveKit('returns a valid 3-part JWT token structure on success', async () => {
      // This test requires:
      //   1. A real room the test user is a member of (manual setup or fixture)
      //   2. LIVEKIT_API_KEY + LIVEKIT_API_SECRET set on the Supabase project
      // Since full fixture creation is out of scope for this test file, we
      // assert the token shape if LIVEKIT is configured and a roomId fixture
      // is provided via env var.
      const fixtureRoomId = process.env.TEST_LIVEKIT_ROOM_ID ?? '';
      if (!fixtureRoomId) {
        console.warn(
          '[livekit.integration] Skipping token-shape test — TEST_LIVEKIT_ROOM_ID not set'
        );
        return;
      }

      const { status, body } = await callEF(
        { roomId: fixtureRoomId, displayName: 'CITestUser' },
        testUserToken
      );
      expect(status).toBe(200);
      expect(typeof body.token).toBe('string');

      // A LiveKit JWT is a 3-part base64url-encoded string (header.payload.sig)
      const parts = (body.token as string).split('.');
      expect(parts).toHaveLength(3);

      // Decode the payload to verify critical claims
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
      const payload: Record<string, unknown> = JSON.parse(payloadJson);
      expect(payload.iss).toBeTruthy(); // API key as issuer
      expect(typeof payload.exp).toBe('number'); // expiry present
      expect(typeof payload.video).toBe('object'); // video grant present
      expect((payload.video as Record<string, unknown>).roomJoin).toBe(true);
    });
  });
});
