// @ts-nocheck - Test infrastructure type issues
/**
 * Integration tests for username uniqueness validation
 *
 * Tests the join_room_atomic RPC function against the live Supabase instance:
 *   - Global username uniqueness (case-insensitive)
 *   - Race condition prevention via pg_advisory_xact_lock
 *   - Empty username rejection
 *   - Auto-generated Player_{uuid} usernames
 *   - Idempotent rejoin behavior
 *
 * Schema notes (live DB as of Feb 2026):
 *   - rooms.code has UNIQUE constraint — test codes use UUID to avoid collisions
 *   - rooms.host_id FK → profiles(id) — profiles auto-created by on_auth_user_created trigger
 *   - join_room_atomic uses WHERE code = UPPER(p_room_code)
 *   - cleanup_empty_rooms trigger: deletes room when last player leaves
 *     → each test MUST create its own rooms (cannot share across tests)
 *
 * Rewritten: February 28, 2026 — per-test room isolation, trigger-safe cleanup
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

/** Generate a collision-safe room code using UUID */
function uniqueRoomCode(): string {
  return `T${randomUUID().replace(/-/g, '').substring(0, 11).toUpperCase()}`;
}

describe('Username Uniqueness - Integration Tests', () => {
  let supabase: SupabaseClient;
  let u1: string;
  let u2: string;
  let u3: string;
  let u4: string;

  const createdUserIds: string[] = [];

  /**
   * Room IDs created during the current test.
   * Reset in beforeEach, cleaned in afterEach.
   * cleanup_empty_rooms trigger will auto-delete rooms when room_players are removed.
   */
  let testRoomIds: string[] = [];

  /** Create a test room and track it for cleanup */
  async function createRoom(hostId: string): Promise<{ id: string; code: string }> {
    const code = uniqueRoomCode();
    const { data: room, error } = await supabase
      .from('rooms')
      .insert({ code, host_id: hostId, is_public: false, status: 'waiting' })
      .select()
      .single();
    if (error || !room) {
      throw new Error(`Failed to create test room ${code}: ${error?.message}`);
    }
    testRoomIds.push(room.id);
    return { id: room.id, code };
  }

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

    u1 = await createUser('u1');
    u2 = await createUser('u2');
    u3 = await createUser('u3');
    u4 = await createUser('u4');
  }, 30_000);

  beforeEach(() => {
    testRoomIds = [];
  });

  afterEach(async () => {
    // Delete room_players for rooms created in this test.
    // The cleanup_empty_rooms trigger will auto-delete the rooms.
    for (const roomId of testRoomIds) {
      await supabase
        .from('room_players')
        .delete()
        .eq('room_id', roomId)
        .then(() => {});
    }
    // Brief delay for trigger propagation
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  afterAll(async () => {
    // Belt-and-suspenders: clean up any lingering room_players by user
    for (const userId of createdUserIds) {
      // Supabase query builder doesn't have .catch(); just await and ignore result
      await supabase.from('room_players').delete().eq('user_id', userId);
    }
    // Delete auth users (profiles cascade or are handled by Supabase)
    for (const userId of createdUserIds) {
      try {
        await supabase.auth.admin.deleteUser(userId);
      } catch {
        // Ignore cleanup errors
      }
    }
  }, 15_000);

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 1: Two users, same username, same room
  // ─────────────────────────────────────────────────────────────────────
  describe('Scenario 1: Two users try same username in same room', () => {
    it('should allow first user to join', async () => {
      const room = await createRoom(u1);

      const { data, error } = await supabase.rpc('join_room_atomic', {
        p_room_code: room.code,
        p_user_id: u1,
        p_username: 'ScenarioOneUser',
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data).toHaveProperty('room_id');
      expect(data).toHaveProperty('player_index');
    });

    it('should reject second user with same username', async () => {
      const room = await createRoom(u1);

      // First user joins
      const { error: joinError } = await supabase.rpc('join_room_atomic', {
        p_room_code: room.code,
        p_user_id: u1,
        p_username: 'DuplicateName',
      });
      expect(joinError).toBeNull();

      // Second user tries same username in same room
      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: room.code,
        p_user_id: u2,
        p_username: 'DuplicateName',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('already taken');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 2: Same username in different rooms (Global Uniqueness)
  // ─────────────────────────────────────────────────────────────────────
  describe('Scenario 2: Same username in different rooms', () => {
    it('should reject same username in different rooms due to global uniqueness', async () => {
      const room1 = await createRoom(u1);
      const room2 = await createRoom(u2);

      // User 1 joins room 1
      const { error: joinError } = await supabase.rpc('join_room_atomic', {
        p_room_code: room1.code,
        p_user_id: u1,
        p_username: 'GlobalTest',
      });
      expect(joinError).toBeNull();

      // User 2 tries room 2 with same username
      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: room2.code,
        p_user_id: u2,
        p_username: 'GlobalTest',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('already taken');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 3: Bot name global uniqueness
  // ─────────────────────────────────────────────────────────────────────
  describe('Scenario 3: Bot names enforce global uniqueness', () => {
    it('should enforce global uniqueness for bot usernames', async () => {
      const room1 = await createRoom(u3);
      const room2 = await createRoom(u4);

      // Bot 1 joins room 1
      const { error: joinError } = await supabase.rpc('join_room_atomic', {
        p_room_code: room1.code,
        p_user_id: u3,
        p_username: 'BotPlayer',
      });
      expect(joinError).toBeNull();

      // Bot 2 tries room 2 with same name
      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: room2.code,
        p_user_id: u4,
        p_username: 'BotPlayer',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('already taken');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 4: Case insensitive validation
  // ─────────────────────────────────────────────────────────────────────
  describe('Scenario 4: Case insensitive validation', () => {
    it('should reject "casetest" when "CaseTest" already exists', async () => {
      const room1 = await createRoom(u1);
      const room2 = await createRoom(u2);

      const { error: joinError } = await supabase.rpc('join_room_atomic', {
        p_room_code: room1.code,
        p_user_id: u1,
        p_username: 'CaseTest',
      });
      expect(joinError).toBeNull();

      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: room2.code,
        p_user_id: u2,
        p_username: 'casetest',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('already taken');
    });

    it('should reject "CASETEST" when "CaseCheck" already exists', async () => {
      const room1 = await createRoom(u1);
      const room2 = await createRoom(u2);

      const { error: joinError } = await supabase.rpc('join_room_atomic', {
        p_room_code: room1.code,
        p_user_id: u1,
        p_username: 'CaseCheck',
      });
      expect(joinError).toBeNull();

      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: room2.code,
        p_user_id: u2,
        p_username: 'CASECHECK',
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('already taken');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 5: Auto-generated username behavior
  // ─────────────────────────────────────────────────────────────────────
  describe('Scenario 5: Auto-generated Player_ usernames', () => {
    it('should allow distinct auto-generated usernames', async () => {
      const room1 = await createRoom(u1);
      const room2 = await createRoom(u2);

      const auto1 = `Player_${u1.substring(0, 8)}`;
      const auto2 = `Player_${u2.substring(0, 8)}`;

      const { error: e1 } = await supabase.rpc('join_room_atomic', {
        p_room_code: room1.code,
        p_user_id: u1,
        p_username: auto1,
      });
      expect(e1).toBeNull();

      const { error: e2 } = await supabase.rpc('join_room_atomic', {
        p_room_code: room2.code,
        p_user_id: u2,
        p_username: auto2,
      });
      expect(e2).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 6: Race condition prevention
  // ─────────────────────────────────────────────────────────────────────
  describe('Scenario 6: Race condition prevention', () => {
    it('should handle concurrent join attempts with same username gracefully', async () => {
      const room = await createRoom(u1);

      const promises = [
        supabase.rpc('join_room_atomic', {
          p_room_code: room.code,
          p_user_id: u1,
          p_username: 'RaceTest',
        }),
        supabase.rpc('join_room_atomic', {
          p_room_code: room.code,
          p_user_id: u2,
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

  // ─────────────────────────────────────────────────────────────────────
  // Edge Cases
  // ─────────────────────────────────────────────────────────────────────
  describe('Edge Cases', () => {
    it('should reject empty username', async () => {
      const room = await createRoom(u1);

      const { error } = await supabase.rpc('join_room_atomic', {
        p_room_code: room.code,
        p_user_id: u1,
        p_username: '',
      });

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/empty|blank|invalid/i);
    });

    it('should allow user to rejoin the same room (idempotent)', async () => {
      const room = await createRoom(u1);

      // First join
      const { error: e1 } = await supabase.rpc('join_room_atomic', {
        p_room_code: room.code,
        p_user_id: u1,
        p_username: 'IdempotentUser',
      });
      expect(e1).toBeNull();

      // Same user, same room, same username → should return already_joined
      const { data, error: e2 } = await supabase.rpc('join_room_atomic', {
        p_room_code: room.code,
        p_user_id: u1,
        p_username: 'IdempotentUser',
      });
      expect(e2).toBeNull();
      expect(data).toHaveProperty('already_joined', true);
    });
  });
});
