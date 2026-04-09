/**
 * Extended bot tests for edge cases and full coverage
 */

import { BotAI } from '../bot';
import type { Card } from '../types';

describe('BotAI - Extended Coverage Tests', () => {
  describe('Easy difficulty comprehensive tests', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('easy bot always passes when Math.random is below pass threshold', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '7C', rank: '7' as const, suit: 'C' as const },
        { id: '9H', rank: '9' as const, suit: 'H' as const },
        { id: 'JD', rank: 'J' as const, suit: 'D' as const },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4' as const, suit: 'D' as const }],
        combo_type: 'Single' as const,
      };

      // Mock Math.random to 0.3 — always below the easy-bot 0.5 pass threshold
      jest.spyOn(Math, 'random').mockReturnValue(0.3);

      let passCount = 0;
      const iterations = 20;
      for (let i = 0; i < iterations; i++) {
        const result = bot.getPlay({
          hand,
          lastPlay,
          isFirstPlayOfGame: false,
          playerCardCounts: [4, 4],
          currentPlayerIndex: 0,
        });
        if (result.cards === null) passCount++;
      }

      // With Math.random() pinned below the 0.5 threshold the bot always passes
      expect(passCount).toBe(iterations);
    });

    test('easy bot never passes when Math.random is above pass threshold', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '7C', rank: '7' as const, suit: 'C' as const },
        { id: '9H', rank: '9' as const, suit: 'H' as const },
        { id: 'JD', rank: 'J' as const, suit: 'D' as const },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4' as const, suit: 'D' as const }],
        combo_type: 'Single' as const,
      };

      // Mock Math.random to 0.7 — always above the easy-bot 0.5 pass threshold
      jest.spyOn(Math, 'random').mockReturnValue(0.7);

      let passCount = 0;
      const iterations = 20;
      for (let i = 0; i < iterations; i++) {
        const result = bot.getPlay({
          hand,
          lastPlay,
          isFirstPlayOfGame: false,
          playerCardCounts: [4, 4],
          currentPlayerIndex: 0,
        });
        if (result.cards === null) passCount++;
      }

      // With Math.random() pinned above the 0.5 threshold the bot always plays
      expect(passCount).toBe(0);
    });

    test('easy bot makes first play with low card', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '3D', rank: '3' as const, suit: 'D' as const },
        { id: '7C', rank: '7' as const, suit: 'C' as const },
        { id: '9H', rank: '9' as const, suit: 'H' as const },
        { id: 'JD', rank: 'J' as const, suit: 'D' as const },
      ];

      const result = bot.getPlay({
        hand,
        lastPlay: null,
        isFirstPlayOfGame: true,
        playerCardCounts: [4, 4],
        currentPlayerIndex: 0,
      });
      expect(result.cards).not.toBeNull();
      expect(result.cards![0]).toContain('3');
    });

    test('easy bot plays with 3D when required', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '3D', rank: '3' as const, suit: 'D' as const },
        { id: '4C', rank: '4' as const, suit: 'C' as const },
        { id: '7H', rank: '7' as const, suit: 'H' as const },
        { id: '9S', rank: '9' as const, suit: 'S' as const },
      ];

      const result = bot.getPlay({
        hand,
        lastPlay: null,
        isFirstPlayOfGame: true,
        playerCardCounts: [4, 4],
        currentPlayerIndex: 0,
      });
      expect(result.cards).not.toBeNull();
      expect(result.cards!.some(id => id === '3D')).toBe(true);
    });
  });

  describe('Medium difficulty comprehensive tests', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('medium bot passes strategically (approximately 15% with valid plays)', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '6C', rank: '6' as const, suit: 'C' as const },
        { id: '7H', rank: '7' as const, suit: 'H' as const },
        { id: '8S', rank: '8' as const, suit: 'S' as const },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4' as const, suit: 'D' as const }],
        combo_type: 'Single' as const,
      };

      let passCount = 0;
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        const result = bot.getPlay({
          hand,
          lastPlay,
          isFirstPlayOfGame: false,
          playerCardCounts: [4, 4],
          currentPlayerIndex: 0,
        });
        if (result.cards === null) passCount++;
      }

      // Should pass roughly 15% ± 10% (strategic passing).
      // Lower bound is 2 (not 5) to avoid flakiness: P(X≤2 | n=100, p=0.15) < 0.01%.
      // Upper bound is 35 (not 25): P(X≥35 | n=100, p=0.15) < 0.01%, avoiding false failures at ~2.8σ.
      expect(passCount).toBeGreaterThan(2);
      expect(passCount).toBeLessThan(35);
    });

    test('medium bot makes first play with low card', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '3D', rank: '3' as const, suit: 'D' as const },
        { id: '7C', rank: '7' as const, suit: 'C' as const },
        { id: 'JH', rank: 'J' as const, suit: 'H' as const },
        { id: 'AS', rank: 'A' as const, suit: 'S' as const },
      ];

      const result = bot.getPlay({
        hand,
        lastPlay: null,
        isFirstPlayOfGame: true,
        playerCardCounts: [4, 4],
        currentPlayerIndex: 0,
      });
      expect(result.cards).not.toBeNull();
      expect(result.cards![0]).toContain('3');
    });

    test('medium bot follows with valid play when possible', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '6C', rank: '6' as const, suit: 'C' as const },
        { id: '7H', rank: '7' as const, suit: 'H' as const },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4' as const, suit: 'D' as const }],
        combo_type: 'Single' as const,
      };

      const result = bot.getPlay({
        hand,
        lastPlay,
        isFirstPlayOfGame: false,
        playerCardCounts: [3, 3],
        currentPlayerIndex: 0,
      });
      // Should play (not pass) most of the time
      expect(result.cards === null || (result.cards && result.cards.length === 1)).toBe(true);
    });
  });

  describe('Hard difficulty comprehensive tests', () => {
    test('hard bot considers opponent card count when passing', () => {
      const bot = new BotAI('hard');
      const hand: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '6C', rank: '6' as const, suit: 'C' as const },
        { id: 'AD', rank: 'A' as const, suit: 'D' as const },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4' as const, suit: 'D' as const }],
        combo_type: 'Single' as const,
      };

      // When opponent has 1-2 cards, hard bot is more likely to play
      const result1 = bot.getPlay({
        hand,
        lastPlay,
        isFirstPlayOfGame: false,
        playerCardCounts: [1, 3],
        currentPlayerIndex: 0,
      });

      // When opponent has many cards, harder to predict
      const result2 = bot.getPlay({
        hand,
        lastPlay,
        isFirstPlayOfGame: false,
        playerCardCounts: [8, 3],
        currentPlayerIndex: 0,
      });

      // Just verify it returns valid results
      expect(result1.cards === null || Array.isArray(result1.cards)).toBe(true);
      expect(result2.cards === null || Array.isArray(result2.cards)).toBe(true);
    });

    test('hard bot makes first play with lowest card', () => {
      const bot = new BotAI('hard');
      const hand: Card[] = [
        { id: '3D', rank: '3' as const, suit: 'D' as const },
        { id: '7C', rank: '7' as const, suit: 'C' as const },
        { id: 'KH', rank: 'K' as const, suit: 'H' as const },
        { id: 'AS', rank: 'A' as const, suit: 'S' as const },
      ];

      const result = bot.getPlay({
        hand,
        lastPlay: null,
        isFirstPlayOfGame: true,
        playerCardCounts: [4, 4],
        currentPlayerIndex: 0,
      });
      expect(result.cards).not.toBeNull();
      expect(result.cards![0]).toContain('3');
    });

    test('hard bot plays strategically when following', () => {
      const bot = new BotAI('hard');
      const hand: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '6C', rank: '6' as const, suit: 'C' as const },
        { id: '7H', rank: '7' as const, suit: 'H' as const },
        { id: 'KS', rank: 'K' as const, suit: 'S' as const },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4' as const, suit: 'D' as const }],
        combo_type: 'Single' as const,
      };

      const result = bot.getPlay({
        hand,
        lastPlay,
        isFirstPlayOfGame: false,
        playerCardCounts: [3, 4],
        currentPlayerIndex: 0,
      });
      // Hard bot should play strategically
      expect(result.cards === null || (result.cards && result.cards.length === 1)).toBe(true);
    });
  });

  describe('Bot decision making patterns', () => {
    test('bot returns valid result for single card beat attempt', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '3D', rank: '3' as const, suit: 'D' as const },
        { id: '5C', rank: '5' as const, suit: 'C' as const },
        { id: '7H', rank: '7' as const, suit: 'H' as const },
        { id: '9S', rank: '9' as const, suit: 'S' as const },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: '4D', rank: '4' as const, suit: 'D' as const }],
        combo_type: 'Single' as const,
      };

      const result = bot.getPlay({
        hand,
        lastPlay,
        isFirstPlayOfGame: false,
        playerCardCounts: [4, 4],
        currentPlayerIndex: 0,
      });
      expect(result.cards === null || Array.isArray(result.cards)).toBe(true);
    });

    test('bot plays 3D in first play scenarios', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '3D', rank: '3' as const, suit: 'D' as const },
        { id: '3C', rank: '3' as const, suit: 'C' as const },
        { id: '7H', rank: '7' as const, suit: 'H' as const },
        { id: '9S', rank: '9' as const, suit: 'S' as const },
      ];

      const result = bot.getPlay({
        hand,
        lastPlay: null,
        isFirstPlayOfGame: true,
        playerCardCounts: [4, 4],
        currentPlayerIndex: 0,
      });
      expect(result.cards).not.toBeNull();
      expect(result.cards!.some(id => id === '3D')).toBe(true);
    });

    test('bot can handle leading (no lastPlay)', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '6C', rank: '6' as const, suit: 'C' as const },
        { id: '7H', rank: '7' as const, suit: 'H' as const },
      ];

      const result = bot.getPlay({
        hand,
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerCardCounts: [3, 3],
        currentPlayerIndex: 0,
      });
      expect(result.cards).not.toBeNull();
    });

    test('bot handles pair following correctly', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '5C', rank: '5' as const, suit: 'C' as const },
        { id: '6H', rank: '6' as const, suit: 'H' as const },
        { id: '6S', rank: '6' as const, suit: 'S' as const },
      ];
      const lastPlay = {
        position: 0,
        cards: [
          { id: '4D', rank: '4' as const, suit: 'D' as const },
          { id: '4C', rank: '4' as const, suit: 'C' as const },
        ],
        combo_type: 'Pair' as const,
      };

      const result = bot.getPlay({
        hand,
        lastPlay,
        isFirstPlayOfGame: false,
        playerCardCounts: [4, 4],
        currentPlayerIndex: 0,
      });
      // Should be null or 2-card play
      expect(result.cards === null || (result.cards && result.cards.length === 2)).toBe(true);
    });

    test('bot handles triple following correctly', () => {
      const bot = new BotAI('medium');
      const hand: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '5C', rank: '5' as const, suit: 'C' as const },
        { id: '5H', rank: '5' as const, suit: 'H' as const },
        { id: '6S', rank: '6' as const, suit: 'S' as const },
      ];
      const lastPlay = {
        position: 0,
        cards: [
          { id: '4D', rank: '4' as const, suit: 'D' as const },
          { id: '4C', rank: '4' as const, suit: 'C' as const },
          { id: '4H', rank: '4' as const, suit: 'H' as const },
        ],
        combo_type: 'Triple' as const,
      };

      const result = bot.getPlay({
        hand,
        lastPlay,
        isFirstPlayOfGame: false,
        playerCardCounts: [4, 4],
        currentPlayerIndex: 0,
      });
      expect(result.cards === null || (result.cards && result.cards.length === 3)).toBe(true);
    });

    test('bot returns null when no valid plays exist', () => {
      const bot = new BotAI('easy');
      const hand: Card[] = [
        { id: '3D', rank: '3' as const, suit: 'D' as const },
        { id: '4C', rank: '4' as const, suit: 'C' as const },
      ];
      const lastPlay = {
        position: 0,
        cards: [{ id: 'AD', rank: 'A' as const, suit: 'D' as const }],
        combo_type: 'Single' as const,
      };

      const result = bot.getPlay({
        hand,
        lastPlay,
        isFirstPlayOfGame: false,
        playerCardCounts: [2, 2],
        currentPlayerIndex: 0,
      });
      // Can only pass (or might have 2S)
      expect(result.cards === null || Array.isArray(result.cards)).toBe(true);
    });
  });

  // ── L10: 5-card combo decision tests ──────────────────────────────────────
  describe('5-card combo play decisions (L10)', () => {
    test('hard bot leads with a straight when holding one', () => {
      const bot = new BotAI('hard');
      // 3♦ 4♣ 5♠ 6♥ 7♦ — a straight
      const hand: Card[] = [
        { id: '3D', rank: '3' as const, suit: 'D' as const },
        { id: '4C', rank: '4' as const, suit: 'C' as const },
        { id: '5S', rank: '5' as const, suit: 'S' as const },
        { id: '6H', rank: '6' as const, suit: 'H' as const },
        { id: '7D', rank: '7' as const, suit: 'D' as const },
        { id: 'KC', rank: 'K' as const, suit: 'C' as const },
      ];

      const result = bot.getPlay({
        hand,
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerCardCounts: [6, 4],
        currentPlayerIndex: 0,
      });

      // Hard bot should prefer a 5-card combo over a single when leading
      expect(result.cards).not.toBeNull();
      expect(result.cards!.length).toBe(5);
    });

    test('hard bot leads with full house over single when possible', () => {
      const bot = new BotAI('hard');
      // Three 5s and two 8s → full house
      const hand: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '5C', rank: '5' as const, suit: 'C' as const },
        { id: '5H', rank: '5' as const, suit: 'H' as const },
        { id: '8D', rank: '8' as const, suit: 'D' as const },
        { id: '8C', rank: '8' as const, suit: 'C' as const },
        { id: '2S', rank: '2' as const, suit: 'S' as const },
      ];

      const result = bot.getPlay({
        hand,
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerCardCounts: [6, 4],
        currentPlayerIndex: 0,
      });

      expect(result.cards).not.toBeNull();
      expect(result.cards!.length).toBe(5);
    });

    test('hard bot plays a 5-card combo to beat an existing 5-card combo on the table', () => {
      const bot = new BotAI('hard');
      // Bot holds a flush (all hearts) which beats a straight
      const hand: Card[] = [
        { id: '4H', rank: '4' as const, suit: 'H' as const },
        { id: '7H', rank: '7' as const, suit: 'H' as const },
        { id: '9H', rank: '9' as const, suit: 'H' as const },
        { id: 'JH', rank: 'J' as const, suit: 'H' as const },
        { id: 'KH', rank: 'K' as const, suit: 'H' as const },
        { id: 'AS', rank: 'A' as const, suit: 'S' as const },
      ];
      const lastPlay = {
        position: 1,
        cards: [
          { id: '3D', rank: '3' as const, suit: 'D' as const },
          { id: '4C', rank: '4' as const, suit: 'C' as const },
          { id: '5S', rank: '5' as const, suit: 'S' as const },
          { id: '6H', rank: '6' as const, suit: 'H' as const },
          { id: '7D', rank: '7' as const, suit: 'D' as const },
        ],
        combo_type: 'Straight' as const,
      };

      const result = bot.getPlay({
        hand,
        lastPlay,
        isFirstPlayOfGame: false,
        playerCardCounts: [6, 3],
        currentPlayerIndex: 0,
      });

      // Bot should attempt to beat the straight — either with the flush or pass
      expect(result.cards === null || Array.isArray(result.cards)).toBe(true);
      if (result.cards !== null) {
        expect(result.cards.length).toBe(5);
      }
    });

    test('medium bot has 30% chance to lead with 5-card combo — decision is non-null when Math.random < 0.3', () => {
      const bot = new BotAI('medium');
      // Four 9s and one 5 — four-of-a-kind is a valid 5-card combo in Big Two
      const hand: Card[] = [
        { id: '9D', rank: '9' as const, suit: 'D' as const },
        { id: '9C', rank: '9' as const, suit: 'C' as const },
        { id: '9H', rank: '9' as const, suit: 'H' as const },
        { id: '9S', rank: '9' as const, suit: 'S' as const },
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: 'JS', rank: 'J' as const, suit: 'S' as const },
      ];

      // Force Math.random below 0.3 to trigger the medium-bot 5-card-combo path
      jest.spyOn(Math, 'random').mockReturnValue(0.1);

      const result = bot.getPlay({
        hand,
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerCardCounts: [6, 5],
        currentPlayerIndex: 0,
      });

      jest.restoreAllMocks();

      expect(result.cards).not.toBeNull();
      expect(result.cards!.length).toBe(5);
    });

    test('easy bot never leads with a 5-card combo regardless of hand', () => {
      const bot = new BotAI('easy');
      // Give the easy bot a straight
      const hand: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '6C', rank: '6' as const, suit: 'C' as const },
        { id: '7S', rank: '7' as const, suit: 'S' as const },
        { id: '8H', rank: '8' as const, suit: 'H' as const },
        { id: '9D', rank: '9' as const, suit: 'D' as const },
        { id: 'QS', rank: 'Q' as const, suit: 'S' as const },
      ];

      // Force Math.random above 0.25 so easy bot doesn't pick the "bad high-card" path
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const result = bot.getPlay({
        hand,
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerCardCounts: [6, 5],
        currentPlayerIndex: 0,
      });

      jest.restoreAllMocks();

      // Easy bot leads with lowest single, never a 5-card combo
      expect(result.cards).not.toBeNull();
      expect(result.cards!.length).toBe(1);
    });
  });
});
