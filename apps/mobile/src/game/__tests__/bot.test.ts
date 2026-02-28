/**
 * Bot AI tests
 * Tests for bot decision-making and difficulty levels
 */

import { BotAI, createBotAI, getBotPlay, type BotPlayOptions } from '../bot';
import type { Card, LastPlay } from '../types';

describe('Bot AI - Initialization', () => {
  test('creates bot with default medium difficulty', () => {
    const bot = new BotAI();
    expect(bot).toBeInstanceOf(BotAI);
  });

  test('creates bot with specified difficulty', () => {
    const easyBot = new BotAI('easy');
    const hardBot = new BotAI('hard');
    expect(easyBot).toBeInstanceOf(BotAI);
    expect(hardBot).toBeInstanceOf(BotAI);
  });

  test('createBotAI factory function works', () => {
    const bot = createBotAI('hard');
    expect(bot).toBeInstanceOf(BotAI);
  });
});

describe('Bot AI - First Play (3D requirement)', () => {
  test('bot plays 3D on first play of game', () => {
    const hand: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
      { id: '5H', rank: '5', suit: 'H' },
    ];

    const options: BotPlayOptions = {
      hand,
      lastPlay: null,
      isFirstPlayOfGame: true,
      playerCardCounts: [3, 13, 13, 13],
      currentPlayerIndex: 0,
      difficulty: 'medium',
    };

    const result = getBotPlay(options);
    expect(result.cards).toContain('3D');
  });

  test('bot returns null if no 3D on first play', () => {
    const hand: Card[] = [
      { id: '4C', rank: '4', suit: 'C' },
      { id: '5H', rank: '5', suit: 'H' },
    ];

    const options: BotPlayOptions = {
      hand,
      lastPlay: null,
      isFirstPlayOfGame: true,
      playerCardCounts: [2, 13, 13, 13],
      currentPlayerIndex: 0,
      difficulty: 'medium',
    };

    const result = getBotPlay(options);
    expect(result.cards).toBeNull();
  });
});

describe('Bot AI - Leading (no last play)', () => {
  test('bot plays lowest single when leading', () => {
    const hand: Card[] = [
      { id: '5H', rank: '5', suit: 'H' },
      { id: '3D', rank: '3', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
    ];

    const options: BotPlayOptions = {
      hand,
      lastPlay: null,
      isFirstPlayOfGame: false,
      playerCardCounts: [3, 10, 10, 10],
      currentPlayerIndex: 0,
      difficulty: 'easy',
    };

    const result = getBotPlay(options);
    expect(result.cards).not.toBeNull();
    expect(result.cards!.length).toBeGreaterThan(0);
  });

  test('hard bot considers strategic leading', () => {
    const hand: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
      { id: '4H', rank: '4', suit: 'H' },
      { id: '5S', rank: '5', suit: 'S' },
      { id: '6D', rank: '6', suit: 'D' },
      { id: '7C', rank: '7', suit: 'C' },
    ];

    const options: BotPlayOptions = {
      hand,
      lastPlay: null,
      isFirstPlayOfGame: false,
      playerCardCounts: [6, 8, 8, 8],
      currentPlayerIndex: 0,
      difficulty: 'hard',
    };

    const result = getBotPlay(options);
    expect(result.cards).not.toBeNull();
  });
});

describe('Bot AI - Following (beating last play)', () => {
  let randomSpy: jest.SpyInstance;

  beforeEach(() => {
    // Pin Math.random to avoid non-deterministic pass decisions in medium difficulty
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  test('bot finds valid play to beat single', () => {
    const hand: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '5C', rank: '5', suit: 'C' },
      { id: '6H', rank: '6', suit: 'H' },
    ];

    const lastPlay: LastPlay = {
        position: 0,
      cards: [{ id: '4D', rank: '4', suit: 'D' }],
      combo_type: 'Single',
    };

    const options: BotPlayOptions = {
      hand,
      lastPlay,
      isFirstPlayOfGame: false,
      playerCardCounts: [3, 10, 10, 10],
      currentPlayerIndex: 0,
      difficulty: 'medium',
    };

    const result = getBotPlay(options);
    expect(result.cards).not.toBeNull();
    if (result.cards) {
      expect(['5C', '6H']).toContain(result.cards[0]);
    }
  });

  test('bot returns null when cannot beat', () => {
    const hand: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
    ];

    const lastPlay: LastPlay = {
        position: 0,
      cards: [{ id: 'AS', rank: 'A', suit: 'S' }],
      combo_type: 'Single',
    };

    const options: BotPlayOptions = {
      hand,
      lastPlay,
      isFirstPlayOfGame: false,
      playerCardCounts: [2, 10, 10, 10],
      currentPlayerIndex: 0,
      difficulty: 'medium',
    };

    const result = getBotPlay(options);
    expect(result.cards).toBeNull();
  });

  test('bot handles pair beating', () => {
    const hand: Card[] = [
      { id: '5D', rank: '5', suit: 'D' },
      { id: '5C', rank: '5', suit: 'C' },
      { id: '6H', rank: '6', suit: 'H' },
      { id: '6S', rank: '6', suit: 'S' },
    ];

    const lastPlay: LastPlay = {
        position: 0,
      cards: [
        { id: '4D', rank: '4', suit: 'D' },
        { id: '4C', rank: '4', suit: 'C' },
      ],
      combo_type: 'Pair',
    };

    const options: BotPlayOptions = {
      hand,
      lastPlay,
      isFirstPlayOfGame: false,
      playerCardCounts: [4, 10, 10, 10],
      currentPlayerIndex: 0,
      difficulty: 'hard',
    };

    const result = getBotPlay(options);
    expect(result.cards).not.toBeNull();
    if (result.cards) {
      expect(result.cards.length).toBe(2);
    }
  });
});

describe('Bot AI - Difficulty Levels', () => {
  test('easy bot sometimes passes even when can beat', () => {
    const hand: Card[] = [
      { id: '5D', rank: '5', suit: 'D' },
      { id: '6C', rank: '6', suit: 'C' },
      { id: '7H', rank: '7', suit: 'H' },
    ];

    const lastPlay: LastPlay = {
        position: 0,
      cards: [{ id: '4D', rank: '4', suit: 'D' }],
      combo_type: 'Single',
    };

    const options: BotPlayOptions = {
      hand,
      lastPlay,
      isFirstPlayOfGame: false,
      playerCardCounts: [3, 10, 10, 10],
      currentPlayerIndex: 0,
      difficulty: 'easy',
    };

    // Run multiple times to test randomness
    let passCount = 0;
    let playCount = 0;

    for (let i = 0; i < 20; i++) {
      const result = getBotPlay(options);
      if (result.cards === null) {
        passCount++;
      } else {
        playCount++;
      }
    }

    // Easy bot should pass sometimes
    expect(passCount).toBeGreaterThan(0);
    expect(playCount).toBeGreaterThan(0);
  });

  test('medium bot plays more consistently', () => {
    const hand: Card[] = [
      { id: '5D', rank: '5', suit: 'D' },
      { id: '6C', rank: '6', suit: 'C' },
    ];

    const lastPlay: LastPlay = {
        position: 0,
      cards: [{ id: '4D', rank: '4', suit: 'D' }],
      combo_type: 'Single',
    };

    const options: BotPlayOptions = {
      hand,
      lastPlay,
      isFirstPlayOfGame: false,
      playerCardCounts: [2, 10, 10, 10],
      currentPlayerIndex: 0,
      difficulty: 'medium',
    };

    const result = getBotPlay(options);
    // Medium bot should either play or pass, but not error
    expect(result).toBeDefined();
    expect(result.reasoning).toBeDefined();
  });

  test('hard bot makes strategic decisions', () => {
    const hand: Card[] = [
      { id: 'AD', rank: 'A', suit: 'D' },
      { id: '2C', rank: '2', suit: 'C' },
    ];

    const lastPlay: LastPlay = {
        position: 0,
      cards: [{ id: '3D', rank: '3', suit: 'D' }],
      combo_type: 'Single',
    };

    const options: BotPlayOptions = {
      hand,
      lastPlay,
      isFirstPlayOfGame: false,
      playerCardCounts: [2, 12, 12, 12],
      currentPlayerIndex: 0, // Opponents have many cards
      difficulty: 'hard',
    };

    // Hard bot might pass to save high cards
    const result = getBotPlay(options);
    expect(result).toBeDefined();
  });
});

describe('Bot AI - Edge Cases', () => {
  test('bot handles empty hand', () => {
    const options: BotPlayOptions = {
      hand: [],
      lastPlay: null,
      isFirstPlayOfGame: false,
      playerCardCounts: [0, 10, 10, 10],
      currentPlayerIndex: 0,
      difficulty: 'medium',
    };

    const result = getBotPlay(options);
    expect(result.cards).toBeNull();
  });

  test('bot handles single card hand', () => {
    const hand: Card[] = [{ id: '3D', rank: '3', suit: 'D' }];

    const options: BotPlayOptions = {
      hand,
      lastPlay: null,
      isFirstPlayOfGame: false,
      playerCardCounts: [1, 10, 10, 10],
      currentPlayerIndex: 0,
      difficulty: 'medium',
    };

    const result = getBotPlay(options);
    expect(result.cards).toEqual(['3D']);
  });

  test('bot provides reasoning in result', () => {
    const hand: Card[] = [{ id: '3D', rank: '3', suit: 'D' }];

    const options: BotPlayOptions = {
      hand,
      lastPlay: null,
      isFirstPlayOfGame: false,
      playerCardCounts: [1, 10, 10, 10],
      currentPlayerIndex: 0,
      difficulty: 'medium',
    };

    const result = getBotPlay(options);
    expect(result.reasoning).toBeDefined();
    expect(typeof result.reasoning).toBe('string');
  });
});
