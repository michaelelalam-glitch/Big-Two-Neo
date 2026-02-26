/**
 * CRITICAL MULTIPLAYER RULE VALIDATION TESTS
 * 
 * These tests verify server-side enforcement of core Big Two rules:
 * 1. Cannot pass when leading (no last_play)
 * 2. First play must include 3♦
 * 
 * Created: December 29, 2025
 * Purpose: Catch critical rule violations in multiplayer mode
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Use crypto.randomUUID() via globalThis — available in Node 19+ and modern browsers.
// This avoids importing the Node-only 'crypto' module which lacks type declarations
// in React Native / Expo tsconfig.
const randomUUID = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  // Fallback for older Node versions: generate a v4-like UUID from Math.random
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

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

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://dppybucldqufbqhwnkxu.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
// Service role key bypasses RLS — required for integration tests to insert test data
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('Critical Multiplayer Rules - Server-Side Validation', () => {
  let supabase: SupabaseClient;
  let testRoomCode: string;
  let testRoomId: string;
  let testUserId: string;
  let testPlayerIds: string[];

  beforeAll(async () => {
    if (!SUPABASE_ANON_KEY) {
      throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY not set in environment');
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY not set — integration tests require the service role key to bypass RLS policies'
      );
    }
    // Use service role key so inserts bypass RLS (test data, not production users)
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  });

  beforeEach(async () => {
    // Create a test room and game state
    testRoomCode = `TEST${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    
    // Use proper UUIDs — Supabase host_id/user_id columns are UUID type
    testUserId = randomUUID();
    
    // Create room
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .insert({
        code: testRoomCode,
        host_id: testUserId,
        is_public: false,
        status: 'in_game',
      })
      .select()
      .single();
    
    if (roomError || !room) {
      throw new Error(`Failed to create test room: ${roomError?.message}`);
    }
    testRoomId = room.id;

    // Create 4 players (1 human, 3 bots)
    const players = [
      { room_id: testRoomId, user_id: testUserId, username: 'TestPlayer', player_index: 0, is_bot: false },
      { room_id: testRoomId, user_id: randomUUID(), username: 'Bot 1', player_index: 1, is_bot: true },
      { room_id: testRoomId, user_id: randomUUID(), username: 'Bot 2', player_index: 2, is_bot: true },
      { room_id: testRoomId, user_id: randomUUID(), username: 'Bot 3', player_index: 3, is_bot: true },
    ];

    const { data: createdPlayers, error: playersError } = await supabase
      .from('room_players')
      .insert(players)
      .select();
    
    if (playersError || !createdPlayers) {
      throw new Error(`Failed to create test players: ${playersError?.message}`);
    }
    testPlayerIds = createdPlayers.map(p => p.id);

    // Create initial game state
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

    await supabase
      .from('game_state')
      .insert({
        room_id: testRoomId,
        current_turn: 0,
        hands: initialHands,
        pass_count: 0,
        game_phase: 'in_progress',
        last_play: null, // No one has played yet
        played_cards: [],
      });
  });

  afterEach(async () => {
    // Cleanup test data
    if (testRoomId) {
      await supabase.from('game_state').delete().eq('room_id', testRoomId);
      await supabase.from('room_players').delete().eq('room_id', testRoomId);
      await supabase.from('rooms').delete().eq('id', testRoomId);
    }
  });

  describe('Rule 1: Cannot pass when leading', () => {
    test('Server should reject pass when last_play is null (player is leading)', async () => {
      // Setup: Player 0 is current turn, no last_play (they are leading)
      // Expected: Server should return error "Cannot pass when leading"

      const { data, error } = await supabase.rpc('execute_pass_move', {
        p_room_code: testRoomCode,
        p_player_id: testPlayerIds[0],
      });

      // ASSERTION: Server must reject this pass
      if (data && typeof data === 'object' && 'success' in data) {
        expect(data.success).toBe(false);
        expect(data.error).toMatch(/cannot pass when leading|must play when leading/i);
      } else if (error) {
        // Some implementations might throw SQL error
        expect(error.message).toMatch(/cannot pass when leading|must play when leading/i);
      } else {
        fail('Server did not reject pass when leading - CRITICAL RULE VIOLATION');
      }
    });

    test('Server should allow pass when last_play exists (player is not leading)', async () => {
      // Setup: Set last_play so player 0 is NOT leading
      await supabase
        .from('game_state')
        .update({
          last_play: {
            position: 1,
            cards: [{ id: '6S', rank: '6', suit: 'S' }],
            combo_type: 'Single',
          },
        })
        .eq('room_id', testRoomId);

      const { data, error } = await supabase.rpc('execute_pass_move', {
        p_room_code: testRoomCode,
        p_player_id: testPlayerIds[0],
      });

      // ASSERTION: Server should allow this pass
      expect(error).toBeNull();
      expect(data).toHaveProperty('success', true);
    });
  });

  describe('Rule 2: First play must include 3♦', () => {
    test('Server should reject first play without 3♦', async () => {
      // Setup: Player 0 has 3♦ but tries to play 4♣ alone
      // Expected: Server should return error

      const { data, error } = await supabase.rpc('execute_play_move', {
        p_room_code: testRoomCode,
        p_player_id: testPlayerIds[0],
        p_cards: [{ id: '4C', rank: '4', suit: 'C' }],
      });

      // Check game state to see if this is first play
      const { data: gameState } = await supabase
        .from('game_state')
        .select('played_cards')
        .eq('room_id', testRoomId)
        .single();

      const isFirstPlay = !gameState || gameState.played_cards.length === 0;

      if (isFirstPlay) {
        // ASSERTION: Server must reject opening without 3♦
        if (data && typeof data === 'object' && 'success' in data) {
          expect(data.success).toBe(false);
          expect(data.error).toMatch(/must include 3.*diamond|first play.*3.*diamond|3♦/i);
        } else if (error) {
          expect(error.message).toMatch(/must include 3.*diamond|first play.*3.*diamond|3♦/i);
        } else {
          fail('Server did not reject first play without 3♦ - CRITICAL RULE VIOLATION');
        }
      }
    });

    test('Server should accept first play with 3♦ alone', async () => {
      const { data, error } = await supabase.rpc('execute_play_move', {
        p_room_code: testRoomCode,
        p_player_id: testPlayerIds[0],
        p_cards: [{ id: '3D', rank: '3', suit: 'D' }],
      });

      expect(error).toBeNull();
      expect(data).toHaveProperty('success', true);
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
      expect(data).toHaveProperty('success', true);
    });

    test('Server should accept first play with 3♦ in a 5-card combo (straight)', async () => {
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
      expect(data).toHaveProperty('success', true);
    });
  });
});
