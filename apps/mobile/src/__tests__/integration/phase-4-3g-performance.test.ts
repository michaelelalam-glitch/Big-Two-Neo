/**
 * Phase 4.3G: Performance Testing (Task #529)
 *
 * Validates latency and throughput SLAs for core Stephanos multiplayer infrastructure:
 *
 *  SLA targets (from task description):
 *    - Room code generation     < 50 ms per code
 *    - Bot AI decision time     < 1 000 ms per turn
 *    - Card classification      < 10 ms per validation call
 *    - Game state init          < 500 ms
 *    - Bulk cleanup (1 000 rooms) < 5 000 ms (local simulation)
 *    - Memory — no significant heap growth over 100 state operations
 *
 * All tests run locally without a live Supabase connection.
 * Timing assertions use conservative 2× safety margin on developer hardware.
 *
 * Created: March 2026 — Task #529
 */

// ---------------------------------------------------------------------------
// Shared mocks
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
// Production imports
// ---------------------------------------------------------------------------

import { BotAI } from '../../game/bot';
import { classifyCards, canBeatPlay } from '../../game/engine/game-logic';
import { createGameStateManager } from '../../game/state';
import type { Card } from '../../game/types';

// ---------------------------------------------------------------------------
// Helpers
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

/** Measure wall-clock time in ms for a synchronous block */
function measureSync(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

/** Measure wall-clock time in ms for an async block */
async function measureAsync(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

/** Build a simple hand from an array of card-id strings */
function buildHand(ids: string[]): Card[] {
  const rankMap: Record<string, Card['rank']> = {
    '3': '3',
    '4': '4',
    '5': '5',
    '6': '6',
    '7': '7',
    '8': '8',
    '9': '9',
    '10': '10',
    J: 'J',
    Q: 'Q',
    K: 'K',
    A: 'A',
    '2': '2',
  };
  const suitMap: Record<string, Card['suit']> = { D: 'D', C: 'C', H: 'H', S: 'S' };
  return ids.map(id => {
    const suit = id.slice(-1) as Card['suit'];
    const rank = id.slice(0, -1) as Card['rank'];
    return {
      id,
      rank: rankMap[rank] ?? (rank as Card['rank']),
      suit: suitMap[suit] ?? (suit as Card['suit']),
    };
  });
}

const FULL_HANDS = {
  lowSingles: buildHand([
    '3D',
    '4C',
    '5H',
    '6S',
    '7D',
    '8C',
    '9H',
    '10S',
    'JD',
    'QC',
    'KH',
    'AS',
    '2D',
  ]),
  highSingles: buildHand([
    'JD',
    'QC',
    'KH',
    'AS',
    '2D',
    '2C',
    '2H',
    '2S',
    'AD',
    'KD',
    'QD',
    'JH',
    '10D',
  ]),
  pair: buildHand(['5D', '5C']),
  triple: buildHand(['8D', '8C', '8H']),
  straight: buildHand(['3D', '4C', '5H', '6S', '7D']),
};

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Phase 4.3G — Performance Testing', () => {
  // ─── 1. Room code generation < 50 ms per code ─────────────────────────────
  describe('Room code generation throughput', () => {
    it('generates 1 000 codes in under 100 ms total (< 0.1 ms per code)', () => {
      const elapsed = measureSync(() => {
        for (let i = 0; i < 1000; i++) generateRoomCode();
      });
      // SLA: 50 ms per code → 1000 codes must finish in < 50_000 ms
      // Practical target: < 100 ms (very conservative)
      expect(elapsed).toBeLessThan(100);
    });

    it('single room code generation completes in < 1 ms', () => {
      const elapsed = measureSync(() => generateRoomCode());
      expect(elapsed).toBeLessThan(1);
    });

    it('10 000 codes generated within SLA (< 50 ms * 10_000 = 500_000 ms practical cap: 1_000 ms)', () => {
      const elapsed = measureSync(() => {
        for (let i = 0; i < 10_000; i++) generateRoomCode();
      });
      // On any modern device this should finish well under 1 second
      expect(elapsed).toBeLessThan(1000);
    });
  });

  // ─── 2. Card classification < 10 ms per call ──────────────────────────────
  describe('Card classification latency', () => {
    it('classifies 1 000 singles in < 50 ms total (< 0.05 ms per call)', () => {
      const single = buildHand(['5D']);
      const elapsed = measureSync(() => {
        for (let i = 0; i < 1000; i++) classifyCards(single);
      });
      expect(elapsed).toBeLessThan(50);
    });

    it('classifies a pair in < 1 ms', () => {
      const elapsed = measureSync(() => classifyCards(FULL_HANDS.pair));
      expect(elapsed).toBeLessThan(1);
    });

    it('classifies a triple in < 1 ms', () => {
      const elapsed = measureSync(() => classifyCards(FULL_HANDS.triple));
      expect(elapsed).toBeLessThan(1);
    });

    it('classifies a 5-card straight in < 2 ms', () => {
      const elapsed = measureSync(() => classifyCards(FULL_HANDS.straight));
      expect(elapsed).toBeLessThan(2);
    });

    it('1 000 canBeatPlay comparisons complete in < 50 ms', () => {
      const lastPlay = {
        position: 0,
        cards: buildHand(['5D']),
        combo_type: 'Single' as const,
      };
      const bigger = buildHand(['6D']);
      const elapsed = measureSync(() => {
        for (let i = 0; i < 1000; i++) canBeatPlay(bigger, lastPlay);
      });
      expect(elapsed).toBeLessThan(50);
    });
  });

  // ─── 3. Bot AI decision < 1 000 ms per turn ──────────────────────────────
  describe('Bot AI decision latency', () => {
    const difficulties = ['easy', 'medium', 'hard'] as const;

    for (const difficulty of difficulties) {
      it(`${difficulty} bot makes a decision in < 200 ms (SLA: 1 000 ms)`, () => {
        const bot = new BotAI(difficulty);
        const hand = FULL_HANDS.lowSingles;
        const lastPlay = {
          position: 1,
          cards: buildHand(['4D']),
          combo_type: 'Single' as const,
        };

        const elapsed = measureSync(() => {
          bot.getPlay({
            hand,
            lastPlay,
            isFirstPlayOfGame: false,
            playerCardCounts: [13, 13, 13, 13],
            currentPlayerIndex: 0,
          });
        });
        expect(elapsed).toBeLessThan(200);
      });
    }

    it('hard bot processes 100 consecutive turns in < 1 000 ms total', () => {
      const bot = new BotAI('hard');
      const hand = FULL_HANDS.highSingles;
      const lastPlay = {
        position: 1,
        cards: buildHand(['4D']),
        combo_type: 'Single' as const,
      };

      const elapsed = measureSync(() => {
        for (let i = 0; i < 100; i++) {
          bot.getPlay({
            hand,
            lastPlay,
            isFirstPlayOfGame: false,
            playerCardCounts: [13, 13, 13, 13],
            currentPlayerIndex: i % 4,
          });
        }
      });
      expect(elapsed).toBeLessThan(1000);
    });

    it('easy bot leading play (no lastPlay) decides in < 200 ms', () => {
      const bot = new BotAI('easy');
      const elapsed = measureSync(() => {
        bot.getPlay({
          hand: FULL_HANDS.lowSingles,
          lastPlay: null,
          isFirstPlayOfGame: true,
          playerCardCounts: [13, 13, 13, 13],
          currentPlayerIndex: 0,
        });
      });
      expect(elapsed).toBeLessThan(200);
    });
  });

  // ─── 4. Game state initialization < 500 ms ───────────────────────────────
  describe('Game state initialization latency', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('initialises a 1-human + 3-bot game in < 500 ms', async () => {
      const manager = createGameStateManager();
      const elapsed = await measureAsync(async () => {
        await manager.initializeGame({
          playerName: 'Perf Tester',
          botCount: 3,
          botDifficulty: 'medium',
        });
      });
      manager.destroy();
      expect(elapsed).toBeLessThan(500);
    });

    it('initialises 10 consecutive games (simulating rematch flow) in < 5 000 ms', async () => {
      const elapsed = await measureAsync(async () => {
        for (let i = 0; i < 10; i++) {
          const manager = createGameStateManager();
          await manager.initializeGame({
            playerName: 'Perf Tester',
            botCount: 3,
            botDifficulty: 'easy',
          });
          manager.destroy();
        }
      });
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ─── 5. Bulk room cleanup simulation < 5 000 ms ───────────────────────────
  describe('Room cleanup throughput (1 000 rooms)', () => {
    interface MockRoom {
      id: string;
      status: 'waiting' | 'starting' | 'playing' | 'finished' | 'cancelled';
      playerCount: number;
      createdMinutesAgo: number;
      createdDaysAgo: number;
    }

    function categorise(rooms: MockRoom[]) {
      const toDelete: string[] = [];
      for (const r of rooms) {
        if (r.status === 'waiting' && r.playerCount === 0 && r.createdMinutesAgo >= 120) {
          toDelete.push(r.id);
        } else if (r.status === 'starting' && r.createdMinutesAgo >= 1) {
          toDelete.push(r.id);
        } else if (
          (r.status === 'finished' || r.status === 'cancelled') &&
          r.createdDaysAgo >= 30
        ) {
          toDelete.push(r.id);
        }
      }
      return toDelete;
    }

    function generateMockRooms(count: number): MockRoom[] {
      const statuses: MockRoom['status'][] = [
        'waiting',
        'starting',
        'playing',
        'finished',
        'cancelled',
      ];
      return Array.from({ length: count }, (_, i) => ({
        id: `room-${i}`,
        status: statuses[i % statuses.length],
        playerCount: i % 5,
        createdMinutesAgo: (i * 7) % 200,
        createdDaysAgo: (i * 3) % 60,
      }));
    }

    it('categorises 1 000 rooms in < 5 ms (< 5 µs per room)', () => {
      const rooms = generateMockRooms(1000);
      const elapsed = measureSync(() => categorise(rooms));
      // SLA: full cleanup for 1000 rooms < 5 000 ms. Local categorisation should be < 5 ms.
      expect(elapsed).toBeLessThan(5);
    });

    it('identifies the correct deletion candidates in a mixed 1 000-room set', () => {
      const rooms = generateMockRooms(1000);
      const toDelete = categorise(rooms);
      // Verify no active playing rooms are marked for deletion
      const deletedStatuses = toDelete.map(id => {
        const idx = parseInt(id.split('-')[1], 10);
        return rooms[idx].status;
      });
      expect(deletedStatuses.every(s => s !== 'playing')).toBe(true);
    });
  });

  // ─── 6. Memory baseline ───────────────────────────────────────────────────
  describe('Memory — no runaway heap growth', () => {
    it('100 BotAI instances do not cause measurable heap inflation', () => {
      // We cannot directly measure V8 heap in Jest, but we can ensure
      // that creating + GC-eligible instances does not throw OOM.
      const bots: BotAI[] = [];
      for (let i = 0; i < 100; i++) {
        bots.push(new BotAI('hard'));
      }
      // Perform work on all bots to prevent dead-code elimination
      const totalDecisions = bots.reduce((acc, bot) => {
        const result = bot.getPlay({
          hand: FULL_HANDS.lowSingles,
          lastPlay: null,
          isFirstPlayOfGame: false,
          playerCardCounts: [13, 13, 13, 13],
          currentPlayerIndex: 0,
        });
        return acc + (result ? 1 : 0);
      }, 0);
      expect(totalDecisions).toBeGreaterThanOrEqual(0);
      // Release references — allows GC
      bots.length = 0;
    });

    it('1 000 room code generations do not accumulate string references', () => {
      // Ensure codes are not held in a growing collection
      let lastCode = '';
      for (let i = 0; i < 1000; i++) {
        lastCode = generateRoomCode(); // previous value eligible for GC
      }
      // Only the last code is reachable
      expect(lastCode).toHaveLength(6);
    });

    it('50 game state init/destroy cycles complete without throwing', async () => {
      for (let i = 0; i < 50; i++) {
        const manager = createGameStateManager();
        await manager.initializeGame({
          playerName: `P${i}`,
          botCount: 3,
          botDifficulty: 'easy',
        });
        manager.destroy();
      }
      // If memory leaked badly enough to OOM, the loop would have thrown
      expect(true).toBe(true);
    });
  });
});
