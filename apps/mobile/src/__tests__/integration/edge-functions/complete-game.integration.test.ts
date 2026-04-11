/**
 * COMPLETE-GAME EDGE FUNCTION — Integration Tests
 * Task #21 (Tier 4 — P14-1)
 *
 * Covers:
 *   Suite 1 — Unauthenticated request → 401
 *   Suite 2 — Unauthenticated reserved room_code 'LOCAL' request → 401
 *   Suite 3 — Rejected reserved room_code 'LOCAL' / invalid game_type → 400
 *             (requires SERVICE_ROLE_KEY for admin user creation)
 *   Suite 4 — Valid structure but non-existent room / users (requires SERVICE_ROLE_KEY)
 *
 * The complete-game EF accepts a full GameCompletionRequest body. Suites 1–2 test
 * unauthenticated rejection paths. Suite 3 confirms authenticated input validation,
 * including reserved-value rejection, with a real JWT. Suite 4 exercises the DB
 * lookup path with a lightweight payload.
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
const uuid = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? nodeCrypto.randomUUID();
};

const now = new Date().toISOString();

/** Build a minimal, structurally-valid GameCompletionRequest body with 4 players by default. */
function buildMinimalBody(overrides: Record<string, unknown> = {}) {
  const playerIds = [uuid(), uuid(), uuid(), uuid()];
  const players = playerIds.map((playerId, index) => ({
    user_id: playerId,
    username: `TestPlayer${index + 1}`,
    score: 0,
    finish_position: index + 1,
    cards_left: index === 0 ? 0 : 13,
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
  }));

  return {
    room_id: null,
    room_code: 'TESTAB',
    game_type: 'casual' as const,
    bot_difficulty: null,
    players,
    winner_id: playerIds[0],
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
// Suite 1 — Authentication (URL-only)
// ---------------------------------------------------------------------------
(hasUrl ? describe : describe.skip)('Suite 1 — complete-game: authentication', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const result = await callEF(buildMinimalBody());
    expect(result.status).toBe(401);
    // Gateway may return { message } (verify_jwt=true) or function may return
    // { error } (verify_jwt=false); either is a valid non-empty error body.
    const body = result.body as Record<string, unknown>;
    expect(body?.error ?? body?.message).toBeTruthy();
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
(hasUrl ? describe : describe.skip)('Suite 2 — complete-game: LOCAL room_code rejection', () => {
  // Without auth the EF returns 401 before it reaches the LOCAL code check.
  it('returns 401 (not 400) for LOCAL room_code when unauthenticated', async () => {
    const result = await callEF(buildMinimalBody({ room_code: 'LOCAL' }));
    expect(result.status).toBe(401);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Suite 3 — Input validation + LOCAL rejection with a real JWT (requires SERVICE_ROLE_KEY)
// ---------------------------------------------------------------------------
(hasServiceRole ? describe : describe.skip)(
  'Suite 3 — complete-game: input validation (live JWT)',
  () => {
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
      expect((result.body as Record<string, unknown>)?.code).toBe('LOCAL_GAME_REJECTED');
    }, 15_000);

    it('returns 400 for invalid game_type', async () => {
      const result = await callEF(buildMinimalBody({ game_type: 'unknown_type' }), userToken);
      expect(result.status).toBe(400);
    }, 15_000);

    it('returns 400 for game_type of totally wrong type (number)', async () => {
      const result = await callEF(buildMinimalBody({ game_type: 42 }), userToken);
      expect(result.status).toBe(400);
    }, 15_000);
  }
);

// ---------------------------------------------------------------------------
// Suite 4 — winner validation with live JWT (authenticated caller in 4-player payload)
// ---------------------------------------------------------------------------
// Tests that the EF correctly returns 400 when all auth and structural
// validations pass but winner_id is not one of the players — confirming the
// test actually reaches the winner-id validation layer (not just auth or schema
// validation). Room existence is not checked at this validation stage.
// ---------------------------------------------------------------------------
(hasServiceRole ? describe : describe.skip)(
  'Suite 4 — complete-game: winner validation (live DB)',
  () => {
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
      if (!testUserId) throw new Error('Test setup failed: created user has no ID');

      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

    it('returns 400 when winner_id is not in the players array', async () => {
      // Build a fully valid 4-player payload (caller + 3 bots) so all structural
      // validations pass. Set winner_id to a random UUID that is NOT in the
      // players array — EF must return 400 "Invalid winner_id".
      const nonExistentWinner = uuid();
      const makeCombos = () => ({
        singles: 0,
        pairs: 0,
        triples: 0,
        straights: 0,
        flushes: 0,
        full_houses: 0,
        four_of_a_kinds: 0,
        straight_flushes: 0,
        royal_flushes: 0,
      });
      const body = buildMinimalBody({
        room_code: `TST${uuid().slice(0, 5).toUpperCase()}`,
        players: [
          {
            user_id: testUserId,
            username: 'TestPlayer',
            score: 100,
            finish_position: 1,
            cards_left: 0,
            was_bot: false,
            disconnected: false,
            original_username: null,
            combos_played: makeCombos(),
          },
          {
            user_id: 'bot_player-1',
            username: 'Bot 1',
            score: 50,
            finish_position: 2,
            cards_left: 3,
            was_bot: true,
            disconnected: false,
            original_username: null,
            combos_played: makeCombos(),
          },
          {
            user_id: 'bot_player-2',
            username: 'Bot 2',
            score: 25,
            finish_position: 3,
            cards_left: 6,
            was_bot: true,
            disconnected: false,
            original_username: null,
            combos_played: makeCombos(),
          },
          {
            user_id: 'bot_player-3',
            username: 'Bot 3',
            score: 10,
            finish_position: 4,
            cards_left: 9,
            was_bot: true,
            disconnected: false,
            original_username: null,
            combos_played: makeCombos(),
          },
        ],
        winner_id: nonExistentWinner,
      });
      const result = await callEF(body, userToken);
      expect(result.status).not.toBe(401); // confirms auth token was accepted
      expect(result.status).not.toBe(403); // confirms caller IS in players list
      expect(result.status).toBe(400); // EF validates winner must be in players
    }, 15_000);
  }
);
