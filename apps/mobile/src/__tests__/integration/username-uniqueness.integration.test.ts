// @ts-nocheck - Test infrastructure type issues
/**
 * Integration tests for username uniqueness validation
 *
 * Tests the join_room_atomic RPC function against the live Supabase instance:
 *   - Global username uniqueness (case-insensitive)
 *   - Race condition prevention via pg_advisory_xact_lock
 *   - Empty username rejection
 *   - Auto-generated Player_{uuid} usernames
 *
 * Schema notes (live DB as of Feb 2026):
 *   - rooms.code has UNIQUE constraint — test codes use full UUIDs to avoid collisions
 *   - rooms.host_id FK → profiles(id) — profiles auto-created by on_auth_user_created trigger
 *   - join_room_atomic uses WHERE code = UPPER(p_room_code)
 *   - join_room_atomic validates: empty username, global uniqueness, room status
 *
 * Rewritten: February 28, 2026 — robust error handling, collision-safe codes
 */

// Mock soundManager to prevent .m4a file parse errors
jest.mock('../../utils/soundManager', () => ({
  soundManager: {
    playSound: jest.fn().mockResolvedValue(undefined),
    stopSound: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
  },
  SoundType: {
    GAME_START: 'GAME_START',
    HIGHEST_CARD: 'HIGHEST_CARD',
    CARD_PLAY: 'CARD_PLAY',
    PASS: 'PASS',
    WINNER: 'WINNER',
  },
}));

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeCrypto = require('crypto') as { randomUUID: () => string };
const randomUUID = (): string =>
  (globalThis as any).crypto?.randomUUID?.() ?? nodeCrypto.randomUUID();

// Load .env.test if it exists (local development only)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');
  const envTestPath = path.join(__dirname, '../../../.env.test');
  if (fs.existsSync(envTestPath)) {
    const envConfig = fs.readFileSync(envTestPath, 'utf8');
    envConfig.split('\n').forEach((line: string) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=');
        if (key && value) {
          process.env[key] = value;
        }
      }
    });
  }
} catch {
  // .env.test not available — env vars should be set by CI secrets
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Generate a collision-safe room code using full UUID */
function uniqueRoomCode(): string {
  // rooms.code has UNIQUE constraint — use UUID-based codes to avoid collisions
  return `T${randomUUID().replace(/-/g, '').substring(0, 11).toUpperCase()}`;
}

describe('Username Uniqueness - Integration Tests', () => {
  let supabase: SupabaseClient;
  let testRoomCode1: string;
  let testRoomCode2: string;
  let testUserId1: string;
  let testUserId2: string;
  let testUserId3: string;
  let testUserId4: string;

  const createdUserIds: string[] = [];
  const createdRoomIds: string[] = [];

  beforeAll(async () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'Missing Supabase credentials. Set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      );
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Create 4 auth users via Admin API (profiles auto-created by trigger)
    const createUser = async (label: string): Promise<string> => {
      const { data, error } = await supabase.auth.admin.createUser({
        email: `test-usr-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@integration-test.local`,
        password: `pwd-${randomUUID()}`,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(
          `Failed to create test auth user (${label}): ${error?.message}`
        );
      }
      createdUserIds.push(data.user.id);
      return data.user.id;
    };

    testUserId1 = await createUser('u1');
    testUserId2 = await createUser('u2');
    testUserId3 = await createUser('u3');
    testUserId4 = await createUser('u4');

    // Create 2 test rooms with collision-safe codes
    testRoomCode1 = uniqueRoomCode();
    testRoomCode2 = uniqueRoomCode();

    for (const code of [testRoomCode1, testRoomCode2]) {
      const { data: room, error } = await supabase
        .from('rooms')
        .insert({
          code,
          host_id: testUserId1,
          is_public: false,
          status: 'waiting',
        })
        .select()
        .single();
      if (error || !room) {
        throw new Error(`Failed to create test room ${code}: ${error?.message}`);
      }
      createdRoomIds.push(room.id);
    }
  }, 30_000);

  beforeEach(async () => {
    // Clean up room_players before each test for isolation
    for (const roomId of createdRoomIds) {
      await supabase.from('room_players').delete().eq('room_id', roomId);
    }
    // Small delay for cleanup propagation
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    for (const roomId of createdRoomIds) {
      await supabase.from('room_players').delete().eq('room_id', roomId);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    for (const roomId of createdRoomIds) {
      await supabase.from('room_players').delete().eq('room_id', roomId);
      await supabase.from('rooms').delete().eq('id', roomId);
    }
    for (const userId of createdUserIds) {
      await supabase.auth.admin.deleteUser(userId).catch(() => {});
    }
  }, 15_000);

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 1: Two users, same username, same room
  // ─────────────────────────────────────────────────────────────────────────
  describe('Scenario 1: Two users try same username in same room', () => {
    it('should allow first user to join', async () => {
      const { data, error } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode1,
        p_user_id: testUserId1,
        p_username: 'TestUser1',
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data).toHaveProperty('room_id');
      expect(data).toHaveProperty('player_index');
    });

    it('should reject second user with same username', async () => {
      // First user joins
      const { error: joinError } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode1,
        p_user_id: testUserId1,
        p_username: 'TestUser1',
      });
      expect(joinError).toBeNull(); // Verify first join succeeded

      // Second user tries same username
      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode1,
        p_user_id: testUserId2,
        p_username: 'TestUser1',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('already taken');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 2: Same username in different rooms (Global Uniqueness)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Scenario 2: Same username in different rooms', () => {
    it('should reject same username in different rooms due to global uniqueness', async () => {
      // User 1 joins room 1
      const { error: joinError } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode1,
        p_user_id: testUserId1,
        p_username: 'GlobalTest',
      });
      expect(joinError).toBeNull();

      // User 2 tries room 2 with same username
      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode2,
        p_user_id: testUserId2,
        p_username: 'GlobalTest',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('already taken');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 3: Bot name global uniqueness
  // ─────────────────────────────────────────────────────────────────────────
  describe('Scenario 3: Bot names enforce global uniqueness', () => {
    it('should enforce global uniqueness for bot usernames', async () => {
      // Bot 1 joins room 1
      const { error: joinError } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode1,
        p_user_id: testUserId3,
        p_username: 'Bot',
      });
      expect(joinError).toBeNull();

      // Bot 2 tries room 2 with same name
      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode2,
        p_user_id: testUserId4,
        p_username: 'Bot',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('already taken');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 4: Case insensitive validation
  // ─────────────────────────────────────────────────────────────────────────
  describe('Scenario 4: Case insensitive validation', () => {
    it('should reject "casetest" when "CaseTest" already exists', async () => {
      const { error: joinError } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode1,
        p_user_id: testUserId1,
        p_username: 'CaseTest',
      });
      expect(joinError).toBeNull();

      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode2,
        p_user_id: testUserId2,
        p_username: 'casetest',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('already taken');
    });

    it('should reject "CASETEST" when "CaseTest" already exists', async () => {
      const { error: joinError } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode1,
        p_user_id: testUserId1,
        p_username: 'CaseTest',
      });
      expect(joinError).toBeNull();

      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode2,
        p_user_id: testUserId2,
        p_username: 'CASETEST',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('already taken');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 5: Auto-generated username behavior
  // ─────────────────────────────────────────────────────────────────────────
  describe('Scenario 5: Auto-generated Player_ usernames', () => {
    it('should allow distinct auto-generated usernames', async () => {
      const auto1 = `Player_${testUserId1.substring(0, 8)}`;
      const auto2 = `Player_${testUserId2.substring(0, 8)}`;

      const { error: e1 } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode1,
        p_user_id: testUserId1,
        p_username: auto1,
      });
      expect(e1).toBeNull();

      const { error: e2 } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode2,
        p_user_id: testUserId2,
        p_username: auto2,
      });
      expect(e2).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 6: Race condition prevention
  // ─────────────────────────────────────────────────────────────────────────
  describe('Scenario 6: Race condition prevention', () => {
    it('should handle concurrent join attempts with same username gracefully', async () => {
      const promises = [
        supabase.rpc('join_room_atomic', {
          p_room_code: testRoomCode1,
          p_user_id: testUserId1,
          p_username: 'RaceTest',
        }),
        supabase.rpc('join_room_atomic', {
          p_room_code: testRoomCode1,
          p_user_id: testUserId2,
          p_username: 'RaceTest',
        }),
      ];

      const results = await Promise.allSettled(promises);

      // Both promises resolve (Supabase returns errors in response, not rejections)
      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<{ data: any; error: any }> =>
          r.status === 'fulfilled'
      );
      expect(fulfilled).toHaveLength(2);

      const successes = fulfilled.filter((r) => !r.value.error);
      const failures = fulfilled.filter((r) => r.value.error);

      // Exactly one should succeed and one should fail
      expect(successes.length).toBeGreaterThanOrEqual(1);
      expect(failures.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge Cases
  // ─────────────────────────────────────────────────────────────────────────
  describe('Edge Cases', () => {
    it('should reject empty username', async () => {
      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode1,
        p_user_id: testUserId1,
        p_username: '',
      });

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/empty|blank|invalid/i);
    });

    it('should allow user to rejoin the same room (idempotent)', async () => {
      // First join
      const { error: e1 } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode1,
        p_user_id: testUserId1,
        p_username: 'IdempotentUser',
      });
      expect(e1).toBeNull();

      // Same user, same room, same username → should return already_joined
      const { data, error: e2 } = await supabase.rpc('join_room_atomic', {
        p_room_code: testRoomCode1,
        p_user_id: testUserId1,
        p_username: 'IdempotentUser',
      });
      expect(e2).toBeNull();
      expect(data).toHaveProperty('already_joined', true);
    });
  });
});
