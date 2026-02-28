/**
 * CRITICAL MULTIPLAYER RULE VALIDATION TESTS
 *
 * These tests verify server-side enforcement of core Big Two rules:
 * 1. Cannot pass when leading (no last_play)
 * 2. First play must include 3♦
 *
 * These rules are enforced in the Supabase RPC functions:
 *   - execute_pass_move: rejects pass when last_play IS NULL
 *   - execute_play_move: rejects first play without 3♦ when game_phase = 'first_play'
 *
 * Fixture notes (matches live game_state schema as of Feb 2026):
 *   - game_phase CHECK: ('first_play', 'playing', 'finished', 'game_over')
 *   - No 'current_player' column — only 'current_turn' exists
 *   - 'passes' column (INTEGER, nullable, default 0)
 *   - 'passes_in_row' and 'last_player' columns exist
 *   - rooms.host_id FK → profiles(id) — auto-created via on_auth_user_created trigger
 *
 * Created: December 29, 2025
 * Rewritten: February 28, 2026 — fix schema mismatches, align with deployed RPCs
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeCrypto = require('crypto') as { randomUUID: () => string };
const randomUUID = (): string =>
  (globalThis as any).crypto?.randomUUID?.() ?? nodeCrypto.randomUUID();

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

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://dppybucldqufbqhwnkxu.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('Critical Multiplayer Rules - Server-Side Validation', () => {
  let supabase: SupabaseClient;
  let testRoomCode: string;
  let testRoomId: string;
  let testPlayerIds: string[];

  // Auth user IDs created via Admin API — reused across tests.
  // rooms.host_id FK → profiles(id); profiles auto-created by on_auth_user_created trigger.
  const authUserIds: string[] = [];

  beforeAll(async () => {
    if (!SUPABASE_ANON_KEY) {
      throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY not set');
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Create 4 auth users (profiles auto-created by trigger)
    for (let i = 0; i < 4; i++) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: `test-critical-${i}-${Date.now()}-${randomUUID().slice(0, 8)}@integration-test.local`,
        password: `pwd-${randomUUID()}`,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(
          `Failed to create test auth user ${i}: ${error?.message}`
        );
      }
      authUserIds.push(data.user.id);
    }
  }, 30_000);

  afterAll(async () => {
    for (const userId of authUserIds) {
      await supabase.auth.admin.deleteUser(userId).catch(() => {});
    }
  }, 15_000);

  beforeEach(async () => {
    // Each test gets a fresh room + game_state
    testRoomCode = `TEST${randomUUID().replace(/-/g, '').substring(0, 10).toUpperCase()}`;

    // Create room (host_id → profiles.id, auto-created by trigger)
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .insert({
        code: testRoomCode,
        host_id: authUserIds[0],
        is_public: false,
        status: 'playing', // game in progress
      })
      .select()
      .single();

    if (roomError || !room) {
      throw new Error(`Failed to create test room: ${roomError?.message}`);
    }
    testRoomId = room.id;

    // Create 4 players — use unique usernames to avoid global uniqueness conflicts
    const players = [
      { room_id: testRoomId, user_id: authUserIds[0], username: `TestPlayer_${randomUUID().slice(0, 6)}`, player_index: 0, is_bot: false },
      { room_id: testRoomId, user_id: authUserIds[1], username: `Bot1_${randomUUID().slice(0, 6)}`, player_index: 1, is_bot: true },
      { room_id: testRoomId, user_id: authUserIds[2], username: `Bot2_${randomUUID().slice(0, 6)}`, player_index: 2, is_bot: true },
      { room_id: testRoomId, user_id: authUserIds[3], username: `Bot3_${randomUUID().slice(0, 6)}`, player_index: 3, is_bot: true },
    ];

    const { data: createdPlayers, error: playersError } = await supabase
      .from('room_players')
      .insert(players)
      .select();

    if (playersError || !createdPlayers) {
      throw new Error(
        `Failed to create test players: ${playersError?.message}`
      );
    }
    testPlayerIds = createdPlayers.map((p) => p.id);

    // Create initial game state with VALID schema values:
    //   game_phase: 'first_play' (valid CHECK value — 'in_progress' violates constraint!)
    //   current_turn: 0
    //   No 'current_player' column in live schema
    const initialHands = {
      '0': [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '4C', rank: '4', suit: 'C' },
        { id: '5H', rank: '5', suit: 'H' },
      ],
      '1': [
        { id: '6S', rank: '6', suit: 'S' },
        { id: '7D', rank: '7', suit: 'D' },
      ],
      '2': [
        { id: '8C', rank: '8', suit: 'C' },
        { id: '9H', rank: '9', suit: 'H' },
      ],
      '3': [
        { id: '10S', rank: '10', suit: 'S' },
        { id: 'JD', rank: 'J', suit: 'D' },
      ],
    };

    const { error: gsError } = await supabase.from('game_state').insert({
      room_id: testRoomId,
      current_turn: 0,
      hands: initialHands,
      game_phase: 'first_play', // MUST be valid CHECK value
      last_play: null,
      played_cards: [],
      passes: 0,
    });

    if (gsError) {
      throw new Error(`Failed to create game_state: ${gsError.message}`);
    }
  }, 15_000);

  afterEach(async () => {
    if (testRoomId) {
      await supabase.from('game_state').delete().eq('room_id', testRoomId);
      await supabase.from('room_players').delete().eq('room_id', testRoomId);
      await supabase.from('rooms').delete().eq('id', testRoomId);
    }
  }, 10_000);

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 1: Cannot pass when leading (last_play IS NULL)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Rule 1: Cannot pass when leading', () => {
    test('Server should reject pass when last_play is null (player is leading)', async () => {
      // game_phase is 'first_play', last_play is null → player is leading
      // execute_pass_move should reject with "Cannot pass when leading"
      const { data, error } = await supabase.rpc('execute_pass_move', {
        p_room_code: testRoomCode,
        p_player_id: testPlayerIds[0],
      });

      // RPC returns a JSON result, not a Postgres exception
      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/cannot pass when leading/i);
    });

    test('Server should allow pass when last_play exists (player is not leading)', async () => {
      // Transition to 'playing' and set last_play (simulates mid-game trick)
      const { error: updateError } = await supabase
        .from('game_state')
        .update({
          game_phase: 'playing',
          last_play: {
            player_index: 1,
            cards: [{ id: '6S', rank: '6', suit: 'S' }],
          },
        })
        .eq('room_id', testRoomId);

      if (updateError) {
        throw new Error(
          `Failed to update game_state for test: ${updateError.message}`
        );
      }

      const { data, error } = await supabase.rpc('execute_pass_move', {
        p_room_code: testRoomCode,
        p_player_id: testPlayerIds[0],
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 2: First play must include 3♦
  // ─────────────────────────────────────────────────────────────────────────
  describe('Rule 2: First play must include 3♦', () => {
    test('Server should reject first play without 3♦', async () => {
      // game_phase is 'first_play', player tries to play 4♣ without 3♦
      const { data, error } = await supabase.rpc('execute_play_move', {
        p_room_code: testRoomCode,
        p_player_id: testPlayerIds[0],
        p_cards: [{ id: '4C', rank: '4', suit: 'C' }],
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/3 of Diamonds|3.*diamond/i);
    });

    test('Server should accept first play with 3♦ alone', async () => {
      const { data, error } = await supabase.rpc('execute_play_move', {
        p_room_code: testRoomCode,
        p_player_id: testPlayerIds[0],
        p_cards: [{ id: '3D', rank: '3', suit: 'D' }],
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(true);
    });

    test('Server should accept first play with 3♦ in a pair', async () => {
      // Update hand to include a pair with 3♦
      await supabase
        .from('game_state')
        .update({
          hands: {
            '0': [
              { id: '3D', rank: '3', suit: 'D' },
              { id: '3C', rank: '3', suit: 'C' },
              { id: '5H', rank: '5', suit: 'H' },
            ],
            '1': [{ id: '6S', rank: '6', suit: 'S' }],
            '2': [{ id: '8C', rank: '8', suit: 'C' }],
            '3': [{ id: '10S', rank: '10', suit: 'S' }],
          },
        })
        .eq('room_id', testRoomId);

      const { data, error } = await supabase.rpc('execute_play_move', {
        p_room_code: testRoomCode,
        p_player_id: testPlayerIds[0],
        p_cards: [
          { id: '3D', rank: '3', suit: 'D' },
          { id: '3C', rank: '3', suit: 'C' },
        ],
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(true);
    });

    test('Server should accept first play with 3♦ in a 5-card combo', async () => {
      // Update hand to include a straight with 3♦
      await supabase
        .from('game_state')
        .update({
          hands: {
            '0': [
              { id: '3D', rank: '3', suit: 'D' },
              { id: '4C', rank: '4', suit: 'C' },
              { id: '5H', rank: '5', suit: 'H' },
              { id: '6S', rank: '6', suit: 'S' },
              { id: '7D', rank: '7', suit: 'D' },
            ],
            '1': [{ id: '8C', rank: '8', suit: 'C' }],
            '2': [{ id: '9H', rank: '9', suit: 'H' }],
            '3': [{ id: '10S', rank: '10', suit: 'S' }],
          },
        })
        .eq('room_id', testRoomId);

      const { data, error } = await supabase.rpc('execute_play_move', {
        p_room_code: testRoomCode,
        p_player_id: testPlayerIds[0],
        p_cards: [
          { id: '3D', rank: '3', suit: 'D' },
          { id: '4C', rank: '4', suit: 'C' },
          { id: '5H', rank: '5', suit: 'H' },
          { id: '6S', rank: '6', suit: 'S' },
          { id: '7D', rank: '7', suit: 'D' },
        ],
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(true);
    });

    test('Server transitions game_phase from first_play to playing after valid first play', async () => {
      // Play 3♦ to complete the first play
      await supabase.rpc('execute_play_move', {
        p_room_code: testRoomCode,
        p_player_id: testPlayerIds[0],
        p_cards: [{ id: '3D', rank: '3', suit: 'D' }],
      });

      // Verify game_phase transitioned
      const { data: gs } = await supabase
        .from('game_state')
        .select('game_phase')
        .eq('room_id', testRoomId)
        .single();

      expect(gs?.game_phase).toBe('playing');
    });
  });
});
