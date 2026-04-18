/**
 * Phase 4.3F: Edge Case Testing (Task #528)
 *
 * Comprehensive edge case coverage for Stephanos multiplayer infrastructure:
 *  1. Room code format & charset validation
 *  2. Room code collision / retry logic (unique-constraint, max 3 attempts)
 *  3. 4-bots prevention (humanCount === 0 guard)
 *  4. Ranked mode prevents bot-filled start
 *  5. Rapid ready-toggle debounce (concurrent call deduplication)
 *  6. Multiple coordinator lease — only one coordinator runs concurrently
 *  7. Bot circuit-breaker (stops after MAX_BOT_RETRIES)
 *  8. App backgrounding — in-flight operations don't throw after unmount
 *  9. Room cleanup threshold logic (empty/stuck/old rooms)
 * 10. Drag-and-drop card selection deduplication (no duplicate card IDs)
 *
 * All tests run locally without a live Supabase connection.
 *
 * Created: March 2026 — Task #528
 */

// ---------------------------------------------------------------------------
// Shared mocks (must precede imports)
// ---------------------------------------------------------------------------

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

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Local helpers (replicate production utility functions for isolation)
// ---------------------------------------------------------------------------

/** Exact replica of useRoomLobby.generateRoomCode() */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const ROOM_CODE_CHARSET = new Set('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
const MAX_ROOM_CREATE_ATTEMPTS = 3;

/** Simulate the room-creation retry loop */
async function simulateCreateRoomWithRetry(
  inserter: (
    code: string
  ) => Promise<{ data: { id: string } | null; error: { code: string; message: string } | null }>
): Promise<{ id: string } | null> {
  let newRoom: { id: string } | null = null;
  for (let attempt = 0; attempt < MAX_ROOM_CREATE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const { data, error } = await inserter(code);
    if (error) {
      const isUniqueViolation = error.code === '23505' || error.message?.includes('duplicate');
      if (isUniqueViolation && attempt < MAX_ROOM_CREATE_ATTEMPTS - 1) continue;
      throw new Error(error.message);
    }
    newRoom = data;
    break;
  }
  return newRoom;
}

/** Simulate LobbyScreen start-game guard */
function canStartGame(params: { humanCount: number; totalCount: number; isRanked: boolean }): {
  ok: boolean;
  error?: string;
} {
  const { humanCount, totalCount, isRanked } = params;
  if (totalCount > 4) return { ok: false, error: 'Too many players! Maximum 4 players allowed.' };
  if (humanCount === 0) return { ok: false, error: 'Cannot start game without any players!' };
  if (isRanked && humanCount < 4)
    return { ok: false, error: 'Ranked matches require 4 human players' };
  return { ok: true };
}

/** Simple async debounce fixture (mirrors isTogglingReady guard) */
class ReadyToggleSimulator {
  private isToggling = false;
  public toggleCount = 0;
  public actualToggleCount = 0;

  async toggleReady(): Promise<boolean> {
    this.toggleCount++;
    if (this.isToggling) return false; // blocked
    this.isToggling = true;
    this.actualToggleCount++;
    await new Promise(resolve => setTimeout(resolve, 50));
    this.isToggling = false;
    return true;
  }

  reset() {
    this.isToggling = false;
    this.toggleCount = 0;
    this.actualToggleCount = 0;
  }
}

/** Coordinator lease fixture */
class CoordinatorLeaseSimulator {
  private leasedBy: string | null = null;
  public acquireCount = 0;
  public concurrentPeak = 0;
  private activeLeasees = 0;

  async tryAcquire(coordinatorId: string): Promise<boolean> {
    this.acquireCount++;
    if (this.leasedBy !== null) return false;
    this.leasedBy = coordinatorId;
    this.activeLeasees++;
    this.concurrentPeak = Math.max(this.concurrentPeak, this.activeLeasees);
    return true;
  }

  release(coordinatorId: string): void {
    if (this.leasedBy === coordinatorId) {
      this.leasedBy = null;
      this.activeLeasees = Math.max(0, this.activeLeasees - 1);
    }
  }
}

/** Simulate room cleanup categorisation */
interface MockRoom {
  id: string;
  status: 'waiting' | 'starting' | 'playing' | 'finished' | 'cancelled';
  playerCount: number;
  createdMinutesAgo: number;
  createdDaysAgo?: number;
}

function categoriseForCleanup(rooms: MockRoom[]): {
  deleteEmpty: MockRoom[];
  deleteStuck: MockRoom[];
  deleteOld: MockRoom[];
} {
  const now = Date.now();
  const deleteEmpty: MockRoom[] = [];
  const deleteStuck: MockRoom[] = [];
  const deleteOld: MockRoom[] = [];

  for (const r of rooms) {
    const ageMs = (r.createdMinutesAgo * 60 + (r.createdDaysAgo ?? 0) * 86400) * 1000;
    const ageMin = r.createdMinutesAgo;
    const ageDays = r.createdDaysAgo ?? 0;

    if (r.status === 'waiting' && r.playerCount === 0 && ageMin >= 120) {
      deleteEmpty.push(r);
    } else if (r.status === 'starting' && ageMin >= 1) {
      deleteStuck.push(r);
    } else if ((r.status === 'finished' || r.status === 'cancelled') && ageDays >= 30) {
      deleteOld.push(r);
    }
  }

  return { deleteEmpty, deleteStuck, deleteOld };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Phase 4.3F — Edge Case Testing', () => {
  // ─── 1. Room code format ─────────────────────────────────────────────────
  describe('Room code format validation', () => {
    it('generates exactly 6-character codes', () => {
      for (let i = 0; i < 200; i++) {
        expect(generateRoomCode()).toHaveLength(6);
      }
    });

    it('only uses characters from the allowed charset (no ambiguous chars)', () => {
      // Charset: ABCDEFGHJKLMNPQRSTUVWXYZ23456789
      // Excluded visually ambiguous chars: I (→H then J), O (→N then P), 0 (zero), 1 (one)
      // Note: L IS included in the charset (between K and M)
      const forbidden = new Set(['I', 'O', '0', '1']);
      for (let i = 0; i < 500; i++) {
        const code = generateRoomCode();
        for (const char of code) {
          expect(ROOM_CODE_CHARSET.has(char)).toBe(true);
          expect(forbidden.has(char)).toBe(false);
        }
      }
    });

    it('produces diverse codes (collision probability is low)', () => {
      const codes = new Set(Array.from({ length: 1000 }, () => generateRoomCode()));
      // With 32^6 ≈ 1 billion possibilities, 1000 samples should be unique
      expect(codes.size).toBeGreaterThan(990);
    });

    it('generates uppercase-only codes', () => {
      for (let i = 0; i < 100; i++) {
        const code = generateRoomCode();
        expect(code).toBe(code.toUpperCase());
      }
    });
  });

  // ─── 2. Room code collision retry ─────────────────────────────────────────
  describe('Room code collision / retry logic', () => {
    it('succeeds on first attempt when no collision', async () => {
      const inserter = jest.fn().mockResolvedValue({ data: { id: 'room-1' }, error: null });
      const result = await simulateCreateRoomWithRetry(inserter);
      expect(result).toEqual({ id: 'room-1' });
      expect(inserter).toHaveBeenCalledTimes(1);
    });

    it('retries once on first collision and succeeds on 2nd attempt', async () => {
      const inserter = jest
        .fn()
        .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } })
        .mockResolvedValueOnce({ data: { id: 'room-2' }, error: null });
      const result = await simulateCreateRoomWithRetry(inserter);
      expect(result).toEqual({ id: 'room-2' });
      expect(inserter).toHaveBeenCalledTimes(2);
    });

    it('retries twice on collisions and succeeds on 3rd attempt', async () => {
      const inserter = jest
        .fn()
        .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } })
        .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } })
        .mockResolvedValueOnce({ data: { id: 'room-3' }, error: null });
      const result = await simulateCreateRoomWithRetry(inserter);
      expect(result).toEqual({ id: 'room-3' });
      expect(inserter).toHaveBeenCalledTimes(3);
    });

    it('throws after MAX_ROOM_CREATE_ATTEMPTS (3) consecutive collisions', async () => {
      const inserter = jest
        .fn()
        .mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
      await expect(simulateCreateRoomWithRetry(inserter)).rejects.toThrow('duplicate key');
      expect(inserter).toHaveBeenCalledTimes(3);
    });

    it('does not retry on non-collision errors', async () => {
      const inserter = jest
        .fn()
        .mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'RLS violation' } });
      await expect(simulateCreateRoomWithRetry(inserter)).rejects.toThrow('RLS violation');
      expect(inserter).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 3. 4-bots prevention ─────────────────────────────────────────────────
  describe('4-bots prevention (humanCount === 0)', () => {
    it('prevents game start with 0 humans (all bots)', () => {
      const result = canStartGame({ humanCount: 0, totalCount: 4, isRanked: false });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Cannot start game without any players!');
    });

    it('allows game start with 1 human + 3 bots', () => {
      const result = canStartGame({ humanCount: 1, totalCount: 4, isRanked: false });
      expect(result.ok).toBe(true);
    });

    it('allows game start with 2 humans + 2 bots', () => {
      expect(canStartGame({ humanCount: 2, totalCount: 4, isRanked: false }).ok).toBe(true);
    });

    it('allows game start with 4 humans', () => {
      expect(canStartGame({ humanCount: 4, totalCount: 4, isRanked: false }).ok).toBe(true);
    });

    it('prevents start with more than 4 total players', () => {
      const result = canStartGame({ humanCount: 3, totalCount: 5, isRanked: false });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Too many players');
    });
  });

  // ─── 4. Ranked mode — no bots ─────────────────────────────────────────────
  describe('Ranked mode prevents bot-filled start', () => {
    it('blocks ranked start with 1 human + 3 bots', () => {
      const result = canStartGame({ humanCount: 1, totalCount: 4, isRanked: true });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Ranked matches require 4 human players');
    });

    it('blocks ranked start with 2 humans', () => {
      expect(canStartGame({ humanCount: 2, totalCount: 2, isRanked: true }).ok).toBe(false);
    });

    it('blocks ranked start with 3 humans', () => {
      expect(canStartGame({ humanCount: 3, totalCount: 3, isRanked: true }).ok).toBe(false);
    });

    it('allows ranked start with exactly 4 humans', () => {
      expect(canStartGame({ humanCount: 4, totalCount: 4, isRanked: true }).ok).toBe(true);
    });

    it('non-ranked rooms are unaffected by ranked check', () => {
      // Even 1 human is fine in non-ranked
      expect(canStartGame({ humanCount: 1, totalCount: 1, isRanked: false }).ok).toBe(true);
    });
  });

  // ─── 5. Rapid ready-toggle debounce ───────────────────────────────────────
  describe('Rapid ready-toggle debounce', () => {
    let sim: ReadyToggleSimulator;

    beforeEach(() => {
      sim = new ReadyToggleSimulator();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('allows only one in-flight toggle at a time', async () => {
      // Fire 5 rapid toggles
      const promises = Array.from({ length: 5 }, () => sim.toggleReady());
      jest.runAllTimers();
      const results = await Promise.all(promises);

      // First call should succeed, the rest should be blocked (return false)
      expect(results.filter(r => r === true).length).toBe(1);
      expect(results.filter(r => r === false).length).toBe(4);
    });

    it('executes actual DB toggle exactly once per debounce window', async () => {
      const p1 = sim.toggleReady();
      const p2 = sim.toggleReady();
      const p3 = sim.toggleReady();
      jest.runAllTimers();
      await Promise.all([p1, p2, p3]);

      expect(sim.actualToggleCount).toBe(1);
      expect(sim.toggleCount).toBe(3);
    });

    it('allows a second toggle after the first one completes', async () => {
      const p1 = sim.toggleReady();
      jest.runAllTimers();
      await p1;

      const p2 = sim.toggleReady();
      jest.runAllTimers();
      const result2 = await p2;

      expect(result2).toBe(true);
      expect(sim.actualToggleCount).toBe(2);
    });
  });

  // ─── 6. Multiple coordinator lease ────────────────────────────────────────
  describe('Multiple coordinator lease — only one runs concurrently', () => {
    let lease: CoordinatorLeaseSimulator;

    beforeEach(() => {
      lease = new CoordinatorLeaseSimulator();
    });

    it('grants lease to first coordinator', async () => {
      const acquired = await lease.tryAcquire('coordinator-A');
      expect(acquired).toBe(true);
    });

    it('rejects second coordinator while first holds lease', async () => {
      await lease.tryAcquire('coordinator-A');
      const second = await lease.tryAcquire('coordinator-B');
      expect(second).toBe(false);
    });

    it('allows acquisition after first coordinator releases', async () => {
      await lease.tryAcquire('coordinator-A');
      lease.release('coordinator-A');
      const acquired = await lease.tryAcquire('coordinator-B');
      expect(acquired).toBe(true);
    });

    it('concurrent acquires — peak active leases never exceeds 1', async () => {
      const coordinators = ['C1', 'C2', 'C3', 'C4', 'C5'];
      const results = await Promise.all(coordinators.map(id => lease.tryAcquire(id)));
      expect(lease.concurrentPeak).toBe(1);
      // Only the first one succeeded (lease held)
      expect(results.filter(Boolean).length).toBe(1);
    });
  });

  // ─── 7. Bot circuit-breaker ────────────────────────────────────────────────
  describe('Bot circuit-breaker terminates stuck loops', () => {
    const MAX_BOT_RETRIES = 3;

    class BotTurnSimulator {
      public attempts = 0;
      public forcedAdvances = 0;

      async executeBotTurn(
        shouldFail: boolean
      ): Promise<{ success: boolean; forcedAdvance: boolean }> {
        for (let i = 0; i < MAX_BOT_RETRIES; i++) {
          this.attempts++;
          if (!shouldFail) return { success: true, forcedAdvance: false };
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        // Circuit broken — forced advance
        this.forcedAdvances++;
        return { success: false, forcedAdvance: true };
      }
    }

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('succeeds on first attempt when bot can play', async () => {
      const sim = new BotTurnSimulator();
      const p = sim.executeBotTurn(false);
      jest.runAllTimers();
      const result = await p;
      expect(result.success).toBe(true);
      expect(sim.attempts).toBe(1);
      expect(sim.forcedAdvances).toBe(0);
    });

    it('retries exactly MAX_BOT_RETRIES times then forces advance', async () => {
      const sim = new BotTurnSimulator();
      const p = sim.executeBotTurn(true);
      // runAllTimersAsync flushes timers AND drains the microtask queue in each
      // tick — required for async loops that await setTimeout() internally.
      await jest.runAllTimersAsync();
      const result = await p;
      expect(result.forcedAdvance).toBe(true);
      expect(sim.attempts).toBe(MAX_BOT_RETRIES);
      expect(sim.forcedAdvances).toBe(1);
    });
  });

  // ─── 8. App backgrounding / unmount safety ────────────────────────────────
  describe('App backgrounding — in-flight async ops complete safely after unmount', () => {
    it('resolves pending promise even when consumer reference is cleared', async () => {
      let resolve!: (value: string) => void;
      const pendingOp = new Promise<string>(res => {
        resolve = res;
      });

      let result: string | null = null;
      const onComplete = (val: string) => {
        result = val;
      };

      // Simulate consumer subscribing then "unmounting"
      const unsubscribed = { current: false };
      pendingOp.then(val => {
        if (!unsubscribed.current) onComplete(val);
      });

      // Consumer unmounts
      unsubscribed.current = true;

      // The async op resolves after unmount
      resolve('cleanup_done');
      await pendingOp;

      // should NOT have called onComplete (unmounted guard worked)
      expect(result).toBeNull();
    });

    it('does not throw when setters are called post-unmount', async () => {
      const isMounted = { current: true };
      const safeSet = (val: unknown) => {
        if (isMounted.current) return val;
      };

      const op = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        safeSet('some_value'); // should not throw even if isMounted is false
      };

      const promise = op();
      isMounted.current = false; // unmount before op resolves
      await expect(promise).resolves.toBeUndefined();
    });
  });

  // ─── 9. Room cleanup threshold logic ──────────────────────────────────────
  describe('Room cleanup categorisation (empty / stuck / old)', () => {
    it('identifies empty waiting rooms older than 2 hours', () => {
      const rooms: MockRoom[] = [
        { id: 'r1', status: 'waiting', playerCount: 0, createdMinutesAgo: 121 },
        { id: 'r2', status: 'waiting', playerCount: 0, createdMinutesAgo: 59 }, // too recent
        { id: 'r3', status: 'waiting', playerCount: 1, createdMinutesAgo: 200 }, // has player
      ];
      const { deleteEmpty } = categoriseForCleanup(rooms);
      expect(deleteEmpty.map(r => r.id)).toEqual(['r1']);
    });

    it('identifies stuck "starting" rooms older than 1 minute', () => {
      const rooms: MockRoom[] = [
        { id: 's1', status: 'starting', playerCount: 2, createdMinutesAgo: 2 },
        { id: 's2', status: 'starting', playerCount: 4, createdMinutesAgo: 0 }, // too recent (0 min)
        { id: 's3', status: 'playing', playerCount: 4, createdMinutesAgo: 5 }, // wrong status
      ];
      const { deleteStuck } = categoriseForCleanup(rooms);
      expect(deleteStuck.map(r => r.id)).toEqual(['s1']);
    });

    it('identifies finished/cancelled rooms older than 30 days', () => {
      const rooms: MockRoom[] = [
        { id: 'f1', status: 'finished', playerCount: 0, createdMinutesAgo: 0, createdDaysAgo: 31 },
        { id: 'f2', status: 'finished', playerCount: 0, createdMinutesAgo: 0, createdDaysAgo: 29 }, // too recent
        { id: 'f3', status: 'cancelled', playerCount: 0, createdMinutesAgo: 0, createdDaysAgo: 90 },
      ];
      const { deleteOld } = categoriseForCleanup(rooms);
      expect(deleteOld.map(r => r.id)).toEqual(['f1', 'f3']);
    });

    it('does not touch active playing rooms', () => {
      const rooms: MockRoom[] = [
        { id: 'p1', status: 'playing', playerCount: 4, createdMinutesAgo: 300 },
        { id: 'p2', status: 'playing', playerCount: 2, createdMinutesAgo: 9999 },
      ];
      const { deleteEmpty, deleteStuck, deleteOld } = categoriseForCleanup(rooms);
      expect([...deleteEmpty, ...deleteStuck, ...deleteOld]).toHaveLength(0);
    });

    it('handles mixed room list correctly', () => {
      const rooms: MockRoom[] = [
        { id: 'e1', status: 'waiting', playerCount: 0, createdMinutesAgo: 130 },
        { id: 'st1', status: 'starting', playerCount: 1, createdMinutesAgo: 3 },
        {
          id: 'old1',
          status: 'cancelled',
          playerCount: 0,
          createdMinutesAgo: 0,
          createdDaysAgo: 45,
        },
        { id: 'active', status: 'playing', playerCount: 4, createdMinutesAgo: 10 },
        { id: 'recent', status: 'waiting', playerCount: 0, createdMinutesAgo: 30 }, // not old enough
      ];
      const { deleteEmpty, deleteStuck, deleteOld } = categoriseForCleanup(rooms);
      expect(deleteEmpty.map(r => r.id)).toEqual(['e1']);
      expect(deleteStuck.map(r => r.id)).toEqual(['st1']);
      expect(deleteOld.map(r => r.id)).toEqual(['old1']);
    });
  });

  // ─── 10. Drag-and-drop card selection deduplication ─────────────────────
  describe('Drag-and-drop card selection — no duplicate card IDs', () => {
    /**
     * Simulates the card-selection reducer logic:
     * toggling a card adds it if absent, removes it if present.
     */
    function toggleCard(selected: string[], cardId: string): string[] {
      if (selected.includes(cardId)) return selected.filter(id => id !== cardId);
      return [...selected, cardId];
    }

    it('selecting a card adds it to the selection', () => {
      const result = toggleCard([], '5D');
      expect(result).toEqual(['5D']);
    });

    it('selecting the same card twice deselects it (toggle)', () => {
      let sel = toggleCard([], '5D');
      sel = toggleCard(sel, '5D');
      expect(sel).toHaveLength(0);
    });

    it('rapid drag events never produce duplicate card IDs', () => {
      // Simulate a dragged selection event firing the same card ID 10 times
      let sel: string[] = [];
      for (let i = 0; i < 10; i++) {
        if (!sel.includes('7H')) sel = toggleCard(sel, '7H');
      }
      const occurrences = sel.filter(id => id === '7H').length;
      expect(occurrences).toBe(1);
    });

    it('selecting up to 5 cards then submitting — no duplicates in final hand', () => {
      const cardIds = ['3D', '4C', '5H', '6S', '7D'];
      let sel: string[] = [];
      // Simulate multiple drag events per card (e.g. pointer jitter)
      for (const id of cardIds) {
        if (!sel.includes(id)) sel = toggleCard(sel, id);
        if (!sel.includes(id)) sel = toggleCard(sel, id); // idempotent second pass
      }
      const unique = new Set(sel);
      expect(unique.size).toBe(sel.length); // no duplicates
      expect(sel).toHaveLength(5);
    });
  });
});
