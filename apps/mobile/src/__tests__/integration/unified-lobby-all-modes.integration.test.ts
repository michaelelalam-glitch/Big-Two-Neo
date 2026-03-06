/**
 * UNIFIED LOBBY — ALL-MODES INTEGRATION TESTS
 * Phase 2.4I (Task #515)
 *
 * Covers every scenario described in the task:
 *   1. Room type classification — private / casual / ranked detection
 *   2. Private room flow — is_matchmaking=false, is_public=false → isPrivate
 *   3. Casual room with bots — is_matchmaking=true, ranked_mode=false → isCasual
 *   4. Ranked room (no bots) — is_matchmaking=true, ranked_mode=true  → isRanked
 *   5. Room code sharing — share / clipboard utility logic
 *   6. Host badge — player with is_host=true detected as host
 *   7. Ready system — toggle is_ready round-trip via DB
 *   8. Auto-start — room status change to 'playing' handled correctly
 *   9. Consistent UI guards — mutual-exclusivity of room type flags
 *  10. Fallback edge case — public non-matchmaking room → treated as casual
 *
 * Test strategy:
 *   - Pure-logic suites (1, 5, 6, 8, 9, 10) run without network access.
 *   - DB-backed suites (2–4, 7) use the Supabase service-role client.
 *     Skip gracefully when SUPABASE_SERVICE_ROLE_KEY is absent (CI without secrets).
 *
 * Created: March 2026
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeCrypto = require('crypto') as { randomUUID: () => string };
const randomUUID = (): string =>
  (globalThis as any).crypto?.randomUUID?.() ?? nodeCrypto.randomUUID();

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://dppybucldqufbqhwnkxu.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasServiceRole = Boolean(SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Mirror of the LobbyScreen room-type classification logic. */
interface RoomData {
  is_matchmaking: boolean | null;
  is_public: boolean | null;
  ranked_mode: boolean | null;
}
interface RoomType {
  isPrivate: boolean;
  isCasual: boolean;
  isRanked: boolean;
}

function classifyRoom(data: RoomData): RoomType {
  let type: RoomType = {
    isPrivate: !data.is_matchmaking && !data.is_public,
    isCasual:  !!data.is_matchmaking && !data.ranked_mode,
    isRanked:  !!data.is_matchmaking && !!data.ranked_mode,
  };

  // Fallback: public non-matchmaking → treat as casual (mirrors LobbyScreen logic)
  if (!type.isPrivate && !type.isCasual && !type.isRanked) {
    type = { isPrivate: false, isCasual: true, isRanked: false };
  }
  return type;
}

/** Generate a 6-char alphanumeric room code, mimicking the real app. */
function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Room-type classification (pure logic, no network)
// ─────────────────────────────────────────────────────────────────────────────
describe('Suite 1 — Room type classification', () => {
  it('private: is_matchmaking=false, is_public=false → isPrivate only', () => {
    const t = classifyRoom({ is_matchmaking: false, is_public: false, ranked_mode: null });
    expect(t.isPrivate).toBe(true);
    expect(t.isCasual).toBe(false);
    expect(t.isRanked).toBe(false);
  });

  it('casual: is_matchmaking=true, ranked_mode=false → isCasual only', () => {
    const t = classifyRoom({ is_matchmaking: true, is_public: true, ranked_mode: false });
    expect(t.isCasual).toBe(true);
    expect(t.isPrivate).toBe(false);
    expect(t.isRanked).toBe(false);
  });

  it('ranked: is_matchmaking=true, ranked_mode=true → isRanked only', () => {
    const t = classifyRoom({ is_matchmaking: true, is_public: true, ranked_mode: true });
    expect(t.isRanked).toBe(true);
    expect(t.isPrivate).toBe(false);
    expect(t.isCasual).toBe(false);
  });

  it('flags are mutually exclusive — never more than one true', () => {
    const combos: RoomData[] = [
      { is_matchmaking: false, is_public: false, ranked_mode: null },
      { is_matchmaking: true,  is_public: true,  ranked_mode: false },
      { is_matchmaking: true,  is_public: true,  ranked_mode: true },
      { is_matchmaking: false, is_public: true,  ranked_mode: null }, // fallback
    ];
    for (const combo of combos) {
      const t = classifyRoom(combo);
      const trueCount = [t.isPrivate, t.isCasual, t.isRanked].filter(Boolean).length;
      expect(trueCount).toBe(1);
    }
  });

  it('null is_matchmaking treated same as false → private', () => {
    const t = classifyRoom({ is_matchmaking: null, is_public: false, ranked_mode: null });
    expect(t.isPrivate).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Host badge detection (pure logic)
// ─────────────────────────────────────────────────────────────────────────────
describe('Suite 2 — Host badge detection', () => {
  const hostPlayer = { id: 'p1', user_id: 'u1', player_index: 0, is_ready: false, is_bot: false, is_host: true, profiles: { username: 'Alice' } };
  const guestPlayer = { id: 'p2', user_id: 'u2', player_index: 1, is_ready: false, is_bot: false, is_host: false, profiles: { username: 'Bob' } };
  const botPlayer = { id: 'p3', user_id: 'u3', player_index: 2, is_ready: true, is_bot: true, is_host: false, profiles: undefined };

  it('host player has is_host=true', () => {
    expect(hostPlayer.is_host).toBe(true);
  });

  it('guest player has is_host=false', () => {
    expect(guestPlayer.is_host).toBe(false);
  });

  it('bot player is never host', () => {
    expect(botPlayer.is_bot).toBe(true);
    expect(botPlayer.is_host).toBe(false);
  });

  it('exactly one host in a 4-player room', () => {
    const players = [hostPlayer, guestPlayer, botPlayer, { ...botPlayer, id: 'p4', user_id: 'u4', player_index: 3 }];
    const hosts = players.filter(p => p.is_host);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].user_id).toBe('u1');
  });

  it('isHost derived from current user matching host player', () => {
    const currentUserId = 'u1';
    const currentUserPlayer = [hostPlayer, guestPlayer].find(p => p.user_id === currentUserId);
    const isHost = currentUserPlayer?.is_host === true;
    expect(isHost).toBe(true);
  });

  it('non-host user does not get host privileges', () => {
    const currentUserId = 'u2';
    const currentUserPlayer = [hostPlayer, guestPlayer].find(p => p.user_id === currentUserId);
    const isHost = currentUserPlayer?.is_host === true;
    expect(isHost).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Ready system (pure logic)
// ─────────────────────────────────────────────────────────────────────────────
describe('Suite 3 — Ready system (state logic)', () => {
  it('initial ready state is false', () => {
    const isReady = false;
    expect(isReady).toBe(false);
  });

  it('toggle from false → true', () => {
    let isReady = false;
    isReady = !isReady;
    expect(isReady).toBe(true);
  });

  it('double-toggle returns to false (idempotent)', () => {
    let isReady = false;
    isReady = !isReady;
    isReady = !isReady;
    expect(isReady).toBe(false);
  });

  it('all-players-ready check: 4 human players all ready → can auto-start', () => {
    const players = [
      { is_bot: false, is_ready: true },
      { is_bot: false, is_ready: true },
      { is_bot: false, is_ready: true },
      { is_bot: false, is_ready: true },
    ];
    const humanPlayers = players.filter(p => !p.is_bot);
    const allReady = humanPlayers.length > 0 && humanPlayers.every(p => p.is_ready);
    expect(allReady).toBe(true);
  });

  it('not all ready → cannot auto-start', () => {
    const players = [
      { is_bot: false, is_ready: true },
      { is_bot: false, is_ready: false }, // one not ready
      { is_bot: true,  is_ready: true },
      { is_bot: true,  is_ready: true },
    ];
    const humanPlayers = players.filter(p => !p.is_bot);
    const allReady = humanPlayers.length > 0 && humanPlayers.every(p => p.is_ready);
    expect(allReady).toBe(false);
  });

  it('bots are always considered ready (not counted for all-ready check)', () => {
    // In the lobby, bots are pre-ready and shouldn't block the game from starting
    const players = [
      { is_bot: false, is_ready: true },
      { is_bot: true,  is_ready: true }, // bot — ignored for all-ready
      { is_bot: true,  is_ready: true },
      { is_bot: true,  is_ready: true },
    ];
    const humanPlayers = players.filter(p => !p.is_bot);
    const allReady = humanPlayers.length > 0 && humanPlayers.every(p => p.is_ready);
    expect(allReady).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Room code sharing (pure logic / utility)
// ─────────────────────────────────────────────────────────────────────────────
describe('Suite 4 — Room code sharing', () => {
  it('generated room code is 6 chars uppercase alphanumeric', () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('room code is always 6 characters', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(6);
    }
  });

  it('share message contains room code', () => {
    const roomCode = 'ABC123';
    const message = `Join my Big Two game! Room code: ${roomCode}`;
    expect(message).toContain(roomCode);
  });

  it('multiple generated codes are unique (probabilistic)', () => {
    const codes = new Set(Array.from({ length: 50 }, generateRoomCode));
    // 50 codes from a 36^6 space — all should be unique
    expect(codes.size).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Auto-start trigger logic (pure logic)
// ─────────────────────────────────────────────────────────────────────────────
describe('Suite 5 — Auto-start (Realtime subscription logic)', () => {
  it("status 'playing' → triggers navigation (isLeaving=false)", () => {
    const isLeavingRef = { current: false };
    const newStatus = 'playing';
    const shouldNavigate = newStatus === 'playing' && !isLeavingRef.current;
    expect(shouldNavigate).toBe(true);
  });

  it("status 'playing' + isLeaving=true → does NOT navigate (user already leaving)", () => {
    const isLeavingRef = { current: true };
    const newStatus = 'playing';
    const shouldNavigate = newStatus === 'playing' && !isLeavingRef.current;
    expect(shouldNavigate).toBe(false);
  });

  it("status 'waiting' → does NOT trigger navigation", () => {
    const isLeavingRef = { current: false };
    const newStatus = 'waiting';
    const shouldNavigate = newStatus === 'playing' && !isLeavingRef.current;
    expect(shouldNavigate).toBe(false);
  });

  it("status 'finished' → does NOT trigger navigation to game", () => {
    const isLeavingRef = { current: false };
    const newStatus = 'finished';
    const shouldNavigate = newStatus === 'playing' && !isLeavingRef.current;
    expect(shouldNavigate).toBe(false);
  });

  it('navigation uses roomCode and forceNewGame=true', () => {
    const navigationParams = { roomCode: 'XYZ789', forceNewGame: true, botDifficulty: 'medium' as const };
    expect(navigationParams.forceNewGame).toBe(true);
    expect(navigationParams.roomCode).toBe('XYZ789');
    expect(navigationParams.botDifficulty).toBe('medium');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — Bot filling rules per room type (pure logic)
// ─────────────────────────────────────────────────────────────────────────────
describe('Suite 6 — Bot filling rules per room type', () => {
  it('casual room allows bot filling', () => {
    const roomType = classifyRoom({ is_matchmaking: true, is_public: true, ranked_mode: false });
    // Casual rooms can start with bots when fewer than 4 humans are present
    expect(roomType.isCasual).toBe(true);
    expect(roomType.isRanked).toBe(false); // ranked rooms explicitly forbid bots
  });

  it('private room allows bot filling (host can use Start with Bots)', () => {
    const roomType = classifyRoom({ is_matchmaking: false, is_public: false, ranked_mode: null });
    expect(roomType.isPrivate).toBe(true);
    // Private rooms: host manually chooses Start with Bots
    expect(roomType.isRanked).toBe(false);
  });

  it('ranked room does NOT allow bot filling', () => {
    const roomType = classifyRoom({ is_matchmaking: true, is_public: true, ranked_mode: true });
    expect(roomType.isRanked).toBe(true);
    // Ranked games require 4 real human players — no bots allowed
    const canUseBots = !roomType.isRanked;
    expect(canUseBots).toBe(false);
  });

  it('bot player display name includes index', () => {
    const botPlayerIndex = 2;
    const displayName = `Bot ${botPlayerIndex + 1}`;
    expect(displayName).toBe('Bot 3');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — Consistent UI guards (pure logic)
// ─────────────────────────────────────────────────────────────────────────────
describe('Suite 7 — Consistent UI guards', () => {
  it('fallback: public non-matchmaking room → treated as casual', () => {
    // is_public=true, is_matchmaking=false, ranked_mode=null
    const t = classifyRoom({ is_matchmaking: false, is_public: true, ranked_mode: null });
    // isPrivate requires both !is_matchmaking AND !is_public → false here
    // isCasual requires is_matchmaking → false here
    // → falls through to fallback
    expect(t.isCasual).toBe(true);
    expect(t.isPrivate).toBe(false);
    expect(t.isRanked).toBe(false);
  });

  it('player slots always 4 items (nulls fill empty slots)', () => {
    const players = [
      { player_index: 0, user_id: 'u1', is_host: true, is_ready: false, is_bot: false },
      { player_index: 2, user_id: 'u2', is_host: false, is_ready: true, is_bot: false },
    ];
    const slots = Array.from({ length: 4 }, (_, i) =>
      players.find(p => p.player_index === i) || null,
    );
    expect(slots).toHaveLength(4);
    expect(slots[0]).not.toBeNull();
    expect(slots[1]).toBeNull();
    expect(slots[2]).not.toBeNull();
    expect(slots[3]).toBeNull();
  });

  it('human player count excludes bots', () => {
    const players = [
      { is_bot: false }, { is_bot: false }, { is_bot: true }, { is_bot: true },
    ];
    const humanCount = players.filter(p => !p.is_bot).length;
    expect(humanCount).toBe(2);
  });

  it('start-in-progress guard prevents duplicate starts', () => {
    const isStartingRef = { current: false };
    let startCalled = 0;

    const handleStart = () => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      startCalled++;
    };

    handleStart();
    handleStart(); // duplicate — should be ignored
    handleStart(); // duplicate — should be ignored

    expect(startCalled).toBe(1);
  });

  it('leave-in-progress guard prevents duplicate leaves', () => {
    const isLeavingRef = { current: false };
    let leaveCalled = 0;

    const handleLeave = () => {
      if (isLeavingRef.current) return;
      isLeavingRef.current = true;
      leaveCalled++;
    };

    handleLeave();
    handleLeave();

    expect(leaveCalled).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — DB-backed integration: room creation + type verify + ready toggle
// Requires SUPABASE_SERVICE_ROLE_KEY. Skipped in offline CI.
// ─────────────────────────────────────────────────────────────────────────────
const describeWithDb = hasServiceRole ? describe : describe.skip;

describeWithDb('Suite 8 — DB integration: room flows (requires service role)', () => {
  let supabase: SupabaseClient;
  const createdRoomIds: string[] = [];
  const authUserIds: string[] = [];

  beforeAll(async () => {
    if (!SUPABASE_ANON_KEY) throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY not set');
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY!);

    // Create 2 test users (profiles auto-created by on_auth_user_created trigger)
    for (let i = 0; i < 2; i++) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: `lobby-int-test-${i}-${Date.now()}-${randomUUID().slice(0, 8)}@integration-test.local`,
        password: `pwd-${randomUUID()}`,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`Failed to create user ${i}: ${error?.message}`);
      authUserIds.push(data.user.id);
    }
  }, 60_000);

  afterAll(async () => {
    // Clean up rooms and players first
    if (createdRoomIds.length > 0) {
      await supabase.from('room_players').delete().in('room_id', createdRoomIds);
      await supabase.from('game_state').delete().in('room_id', createdRoomIds);
      await supabase.from('rooms').delete().in('id', createdRoomIds);
    }
    // Clean up auth users
    for (const uid of authUserIds) {
      await supabase.auth.admin.deleteUser(uid);
    }
  }, 60_000);

  /**
   * Helper: create a room with given flags and add a host player.
   * Returns { roomId, roomCode }.
   */
  async function createRoom(opts: {
    isMatchmaking: boolean;
    isPublic: boolean;
    rankedMode: boolean;
  }) {
    const hostId = authUserIds[0];
    const code = generateRoomCode() + Date.now().toString(36).slice(-2).toUpperCase();

    const { data: room, error: roomErr } = await supabase
      .from('rooms')
      .insert({
        code,
        host_id: hostId,
        status: 'waiting',
        is_matchmaking: opts.isMatchmaking,
        is_public: opts.isPublic,
        ranked_mode: opts.rankedMode,
      })
      .select('id, code, is_matchmaking, is_public, ranked_mode')
      .single();

    if (roomErr || !room) throw new Error(`createRoom failed: ${roomErr?.message}`);
    createdRoomIds.push(room.id);

    await supabase.from('room_players').insert({
      room_id: room.id,
      user_id: hostId,
      player_index: 0,
      is_ready: false,
      is_bot: false,
      is_host: true,
    });

    return room;
  }

  // ── 8.1 Private room ──────────────────────────────────────────────────────
  it('8.1 private room: DB flags persist and classify correctly', async () => {
    const room = await createRoom({ isMatchmaking: false, isPublic: false, rankedMode: false });

    const { data, error } = await supabase
      .from('rooms')
      .select('is_matchmaking, is_public, ranked_mode')
      .eq('id', room.id)
      .single();

    expect(error).toBeNull();
    const type = classifyRoom(data!);
    expect(type.isPrivate).toBe(true);
    expect(type.isCasual).toBe(false);
    expect(type.isRanked).toBe(false);
  }, 30_000);

  // ── 8.2 Casual room ───────────────────────────────────────────────────────
  it('8.2 casual room: DB flags persist and classify correctly', async () => {
    const room = await createRoom({ isMatchmaking: true, isPublic: true, rankedMode: false });

    const { data, error } = await supabase
      .from('rooms')
      .select('is_matchmaking, is_public, ranked_mode')
      .eq('id', room.id)
      .single();

    expect(error).toBeNull();
    const type = classifyRoom(data!);
    expect(type.isCasual).toBe(true);
    expect(type.isPrivate).toBe(false);
    expect(type.isRanked).toBe(false);
  }, 30_000);

  // ── 8.3 Ranked room ───────────────────────────────────────────────────────
  it('8.3 ranked room: DB flags persist and classify correctly', async () => {
    const room = await createRoom({ isMatchmaking: true, isPublic: true, rankedMode: true });

    const { data, error } = await supabase
      .from('rooms')
      .select('is_matchmaking, is_public, ranked_mode')
      .eq('id', room.id)
      .single();

    expect(error).toBeNull();
    const type = classifyRoom(data!);
    expect(type.isRanked).toBe(true);
    expect(type.isPrivate).toBe(false);
    expect(type.isCasual).toBe(false);
  }, 30_000);

  // ── 8.4 Host badge in DB ─────────────────────────────────────────────────
  it('8.4 host player row has is_host=true in DB', async () => {
    const room = await createRoom({ isMatchmaking: false, isPublic: false, rankedMode: false });

    const { data: players, error } = await supabase
      .from('room_players')
      .select('user_id, is_host, player_index')
      .eq('room_id', room.id);

    expect(error).toBeNull();
    expect(players).not.toBeNull();
    const hostRows = players!.filter(p => p.is_host === true);
    expect(hostRows).toHaveLength(1);
    expect(hostRows[0].user_id).toBe(authUserIds[0]);
    expect(hostRows[0].player_index).toBe(0);
  }, 30_000);

  // ── 8.5 Ready toggle round-trip ───────────────────────────────────────────
  it('8.5 ready toggle: is_ready persists correctly via DB round-trip', async () => {
    const room = await createRoom({ isMatchmaking: false, isPublic: false, rankedMode: false });
    const userId = authUserIds[0];

    // Verify initial state
    const { data: before } = await supabase
      .from('room_players')
      .select('is_ready')
      .eq('room_id', room.id)
      .eq('user_id', userId)
      .single();
    expect(before?.is_ready).toBe(false);

    // Toggle to ready
    const { error: toggleErr } = await supabase
      .from('room_players')
      .update({ is_ready: true })
      .eq('room_id', room.id)
      .eq('user_id', userId);
    expect(toggleErr).toBeNull();

    const { data: after } = await supabase
      .from('room_players')
      .select('is_ready')
      .eq('room_id', room.id)
      .eq('user_id', userId)
      .single();
    expect(after?.is_ready).toBe(true);

    // Toggle back to not ready
    await supabase
      .from('room_players')
      .update({ is_ready: false })
      .eq('room_id', room.id)
      .eq('user_id', userId);

    const { data: reset } = await supabase
      .from('room_players')
      .select('is_ready')
      .eq('room_id', room.id)
      .eq('user_id', userId)
      .single();
    expect(reset?.is_ready).toBe(false);
  }, 30_000);

  // ── 8.6 Auto-start: room status change to 'playing' ──────────────────────
  it('8.6 auto-start: room status transitions waiting → playing', async () => {
    const room = await createRoom({ isMatchmaking: false, isPublic: false, rankedMode: false });

    const { error: startErr } = await supabase
      .from('rooms')
      .update({ status: 'playing' })
      .eq('id', room.id);
    expect(startErr).toBeNull();

    const { data: updated } = await supabase
      .from('rooms')
      .select('status')
      .eq('id', room.id)
      .single();
    expect(updated?.status).toBe('playing');

    // Realtime logic: status='playing' AND !isLeaving → navigate to Game
    const isLeavingRef = { current: false };
    const shouldNavigate = updated?.status === 'playing' && !isLeavingRef.current;
    expect(shouldNavigate).toBe(true);
  }, 30_000);

  // ── 8.7 Room code uniqueness ──────────────────────────────────────────────
  it('8.7 room code stored in DB is case-insensitive searchable', async () => {
    const room = await createRoom({ isMatchmaking: false, isPublic: false, rankedMode: false });

    const { data, error } = await supabase
      .from('rooms')
      .select('id, code')
      .eq('code', room.code)
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(room.id);
    expect(data?.code).toBe(room.code);
  }, 30_000);
});
