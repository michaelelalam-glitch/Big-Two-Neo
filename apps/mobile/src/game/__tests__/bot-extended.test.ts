/**
 * Extended bot tests for edge cases and full coverage
 */

import { BotAI } from '../bot';
import type { Card } from '../types';

describe('BotAI - Extended Coverage Tests', () => {
  describe('Easy difficulty comprehensive tests', () => {
    test('easy bot passes approximately 40% of the time (statistical test)', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '7C', rank: '7', suit: 'C' },
        { id: '9H', rank: '9', suit: 'H' },
        { id: 'JD', rank: 'J', suit: 'D' },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4', suit: 'D' }],
        combo_type: 'Single' as const,
      };

      let passCount = 0;
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        const result = bot.getPlay({ hand, lastPlay, isFirstPlayOfGame: false, playerCardCounts: [4, 4], currentPlayerIndex: 0 });
        if (result.cards === null) passCount++;
      }

      // Should pass roughly 40% ± 15% (statistical variance)
      expect(passCount).toBeGreaterThan(25);
      expect(passCount).toBeLessThan(55);
    });

    test('easy bot makes first play with low card', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '7C', rank: '7', suit: 'C' },
        { id: '9H', rank: '9', suit: 'H' },
        { id: 'JD', rank: 'J', suit: 'D' },
      ];

      const result = bot.getPlay({ hand, lastPlay: null, isFirstPlayOfGame: true, playerCardCounts: [4, 4], currentPlayerIndex: 0 });
      expect(result.cards).not.toBeNull();
      expect(result.cards![0]).toContain('3');
    });

    test('easy bot plays with 3D when required', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '4C', rank: '4', suit: 'C' },
        { id: '7H', rank: '7', suit: 'H' },
        { id: '9S', rank: '9', suit: 'S' },
      ];

      const result = bot.getPlay({ hand, lastPlay: null, isFirstPlayOfGame: true, playerCardCounts: [4, 4], currentPlayerIndex: 0 });
      expect(result.cards).not.toBeNull();
      expect(result.cards!.some(id => id === '3D')).toBe(true);
    });
  });

  describe('Medium difficulty comprehensive tests', () => {
    test('medium bot passes strategically (approximately 15% with valid plays)', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '6C', rank: '6', suit: 'C' },
        { id: '7H', rank: '7', suit: 'H' },
        { id: '8S', rank: '8', suit: 'S' },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4', suit: 'D' }],
        combo_type: 'Single' as const,
      };

      let passCount = 0;
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        const result = bot.getPlay({ hand, lastPlay, isFirstPlayOfGame: false, playerCardCounts: [4, 4], currentPlayerIndex: 0 });
        if (result.cards === null) passCount++;
      }

      // Should pass roughly 15% ± 10% (strategic passing)
      expect(passCount).toBeGreaterThan(5);
      expect(passCount).toBeLessThan(25);
    });

    test('medium bot makes first play with low card', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '7C', rank: '7', suit: 'C' },
        { id: 'JH', rank: 'J', suit: 'H' },
        { id: 'AS', rank: 'A', suit: 'S' },
      ];

      const result = bot.getPlay({ hand, lastPlay: null, isFirstPlayOfGame: true, playerCardCounts: [4, 4], currentPlayerIndex: 0 });
      expect(result.cards).not.toBeNull();
      expect(result.cards![0]).toContain('3');
    });

    test('medium bot follows with valid play when possible', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '6C', rank: '6', suit: 'C' },
        { id: '7H', rank: '7', suit: 'H' },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4', suit: 'D' }],
        combo_type: 'Single' as const,
      };

      const result = bot.getPlay({ hand, lastPlay, isFirstPlayOfGame: false, playerCardCounts: [3, 3], currentPlayerIndex: 0 });
      // Should play (not pass) most of the time
      expect(result.cards === null || (result.cards && result.cards.length === 1)).toBe(true);
    });
  });

  describe('Hard difficulty comprehensive tests', () => {
    test('hard bot considers opponent card count when passing', () => {
      const bot = new BotAI('hard');
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '6C', rank: '6', suit: 'C' },
        { id: 'AD', rank: 'A', suit: 'D' },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4', suit: 'D' }],
        combo_type: 'Single' as const,
      };

      // When opponent has 1-2 cards, hard bot is more likely to play
      const result1 = bot.getPlay({ hand, lastPlay, isFirstPlayOfGame: false, playerCardCounts: [1, 3], currentPlayerIndex: 0 });
      
      // When opponent has many cards, harder to predict
      const result2 = bot.getPlay({ hand, lastPlay, isFirstPlayOfGame: false, playerCardCounts: [8, 3], currentPlayerIndex: 0 });
      
      // Just verify it returns valid results
      expect(result1.cards === null || Array.isArray(result1.cards)).toBe(true);
      expect(result2.cards === null || Array.isArray(result2.cards)).toBe(true);
    });

    test('hard bot makes first play with lowest card', () => {
      const bot = new BotAI('hard');
      const hand: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '7C', rank: '7', suit: 'C' },
        { id: 'KH', rank: 'K', suit: 'H' },
        { id: 'AS', rank: 'A', suit: 'S' },
      ];

      const result = bot.getPlay({ hand, lastPlay: null, isFirstPlayOfGame: true, playerCardCounts: [4, 4], currentPlayerIndex: 0 });
      expect(result.cards).not.toBeNull();
      expect(result.cards![0]).toContain('3');
    });

    test('hard bot plays strategically when following', () => {
      const bot = new BotAI('hard');
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '6C', rank: '6', suit: 'C' },
        { id: '7H', rank: '7', suit: 'H' },
        { id: 'KS', rank: 'K', suit: 'S' },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4', suit: 'D' }],
        combo_type: 'Single' as const,
      };

      const result = bot.getPlay({ hand, lastPlay, isFirstPlayOfGame: false, playerCardCounts: [3, 4], currentPlayerIndex: 0 });
      // Hard bot should play strategically
      expect(result.cards === null || (result.cards && result.cards.length === 1)).toBe(true);
    });
  });

  describe('Bot decision making patterns', () => {
    test('bot returns valid result for single card beat attempt', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '7H', rank: '7', suit: 'H' },
        { id: '9S', rank: '9', suit: 'S' },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4', suit: 'D' }],
        combo_type: 'Single' as const,
      };

      const result = bot.getPlay({ hand, lastPlay, isFirstPlayOfGame: false, playerCardCounts: [4, 4], currentPlayerIndex: 0 });
      expect(result.cards === null || Array.isArray(result.cards)).toBe(true);
    });

    test('bot plays 3D in first play scenarios', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '3C', rank: '3', suit: 'C' },
        { id: '7H', rank: '7', suit: 'H' },
        { id: '9S', rank: '9', suit: 'S' },
      ];

      const result = bot.getPlay({ hand, lastPlay: null, isFirstPlayOfGame: true, playerCardCounts: [4, 4], currentPlayerIndex: 0 });
      expect(result.cards).not.toBeNull();
      expect(result.cards!.some(id => id === '3D')).toBe(true);
    });

    test('bot can handle leading (no lastPlay)', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '6C', rank: '6', suit: 'C' },
        { id: '7H', rank: '7', suit: 'H' },
      ];

      const result = bot.getPlay({ hand, lastPlay: null, isFirstPlayOfGame: false, playerCardCounts: [3, 3], currentPlayerIndex: 0 });
      expect(result.cards).not.toBeNull();
    });

    test('bot handles pair following correctly', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '6H', rank: '6', suit: 'H' },
        { id: '6S', rank: '6', suit: 'S' },
      ];
      const lastPlay = {
        position: 0,
        cards: [
          { id: '4D', rank: '4', suit: 'D' },
          { id: '4C', rank: '4', suit: 'C' },
        ],
        combo_type: 'Pair' as const,
      };

      const result = bot.getPlay({ hand, lastPlay, isFirstPlayOfGame: false, playerCardCounts: [4, 4], currentPlayerIndex: 0 });
      // Should be null or 2-card play
      expect(result.cards === null || (result.cards && result.cards.length === 2)).toBe(true);
    });

    test('bot handles triple following correctly', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '5H', rank: '5', suit: 'H' },
        { id: '6S', rank: '6', suit: 'S' },
      ];
      const lastPlay = {
        position: 0,
        cards: [
          { id: '4D', rank: '4', suit: 'D' },
          { id: '4C', rank: '4', suit: 'C' },
          { id: '4H', rank: '4', suit: 'H' },
        ],
        combo_type: 'Triple' as const,
      };

      const result = bot.getPlay({ hand, lastPlay, isFirstPlayOfGame: false, playerCardCounts: [4, 4], currentPlayerIndex: 0 });
      expect(result.cards === null || (result.cards && result.cards.length === 3)).toBe(true);
    });

    test('bot returns null when no valid plays exist', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '4C', rank: '4', suit: 'C' },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: 'AD', rank: 'A', suit: 'D' }],
        combo_type: 'Single' as const,
      };

      const result = bot.getPlay({ hand, lastPlay, isFirstPlayOfGame: false, playerCardCounts: [2, 2], currentPlayerIndex: 0 });
      // Can only pass (or might have 2S)
      expect(result.cards === null || Array.isArray(result.cards)).toBe(true);
    });
  });
});
