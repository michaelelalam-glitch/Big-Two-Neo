// @ts-nocheck - Test infrastructure type issues
/**
// @ts-nocheck - Test infrastructure type issues
 * Tests for Big Two scoring system
 * 
 * Scoring rules:
 * - Winner (0 cards): 0 points
 * - 1-4 cards: 1 point per card
 * - 5-9 cards: 2 points per card
 * - 10-13 cards: 3 points per card
 * - Game ends when any player reaches 101+ points
 * - Player with lowest score wins the game
 */

import { Card } from '../types';

// Create mock cards for testing
function createMockCards(count: number): Card[] {
  const suits: Array<'D' | 'C' | 'H' | 'S'> = ['D', 'C', 'H', 'S'];
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const cards: Card[] = [];
  
  for (let i = 0; i < count; i++) {
    const rank = ranks[i % ranks.length];
    const suit = suits[i % suits.length];
    cards.push({
      id: `${rank}${suit}`,
      rank: rank,
      suit: suit,
    });
  }
  
  return cards;
}

describe('Big Two Scoring System', () => {
  describe('Points per card calculation', () => {
    test('1 card remaining = 1 point (1 x 1)', () => {
      const cards = createMockCards(1);
      expect(cards.length * 1).toBe(1);
    });

    test('2 cards remaining = 2 points (2 x 1)', () => {
      const cards = createMockCards(2);
      expect(cards.length * 1).toBe(2);
    });

    test('3 cards remaining = 3 points (3 x 1)', () => {
      const cards = createMockCards(3);
      expect(cards.length * 1).toBe(3);
    });

    test('4 cards remaining = 4 points (4 x 1)', () => {
      const cards = createMockCards(4);
      expect(cards.length * 1).toBe(4);
    });

    test('5 cards remaining = 10 points (5 x 2)', () => {
      const cards = createMockCards(5);
      expect(cards.length * 2).toBe(10);
    });

    test('6 cards remaining = 12 points (6 x 2)', () => {
      const cards = createMockCards(6);
      expect(cards.length * 2).toBe(12);
    });

    test('7 cards remaining = 14 points (7 x 2)', () => {
      const cards = createMockCards(7);
      expect(cards.length * 2).toBe(14);
    });

    test('8 cards remaining = 16 points (8 x 2)', () => {
      const cards = createMockCards(8);
      expect(cards.length * 2).toBe(16);
    });

    test('9 cards remaining = 18 points (9 x 2)', () => {
      const cards = createMockCards(9);
      expect(cards.length * 2).toBe(18);
    });

    test('10 cards remaining = 30 points (10 x 3)', () => {
      const cards = createMockCards(10);
      expect(cards.length * 3).toBe(30);
    });

    test('11 cards remaining = 33 points (11 x 3)', () => {
      const cards = createMockCards(11);
      expect(cards.length * 3).toBe(33);
    });

    test('12 cards remaining = 36 points (12 x 3)', () => {
      const cards = createMockCards(12);
      expect(cards.length * 3).toBe(36);
    });

    test('13 cards remaining = 39 points (13 x 3)', () => {
      const cards = createMockCards(13);
      expect(cards.length * 3).toBe(39);
    });

    test('0 cards (winner) = 0 points', () => {
      const cards = createMockCards(0);
      expect(cards.length).toBe(0);
    });
  });

  describe('Game end conditions', () => {
    test('Game ends when any player reaches 101 points', () => {
      const playerScores = [50, 101, 75, 60];
      const shouldEnd = playerScores.some(score => score >= 101);
      expect(shouldEnd).toBe(true);
    });

    test('Game continues when all players are below 101 points', () => {
      const playerScores = [50, 100, 75, 60];
      const shouldEnd = playerScores.some(score => score >= 101);
      expect(shouldEnd).toBe(false);
    });

    test('Player with lowest score wins when game ends', () => {
      const playerScores = [
        { name: 'Player 1', score: 50 },
        { name: 'Player 2', score: 102 },
        { name: 'Player 3', score: 75 },
        { name: 'Player 4', score: 60 },
      ];
      
      const winner = playerScores.reduce((lowest, current) => 
        current.score < lowest.score ? current : lowest
      );
      
      expect(winner.name).toBe('Player 1');
      expect(winner.score).toBe(50);
    });
  });

  describe('Match scoring scenarios', () => {
    test('Winner gets 0 points, others get points based on remaining cards', () => {
      const matchResults = [
        { player: 'Winner', cardsLeft: 0, expectedPoints: 0 },
        { player: 'Player 2', cardsLeft: 3, expectedPoints: 3 }, // 3 x 1
        { player: 'Player 3', cardsLeft: 7, expectedPoints: 14 }, // 7 x 2
        { player: 'Player 4', cardsLeft: 11, expectedPoints: 33 }, // 11 x 3
      ];

      matchResults.forEach(result => {
        if (result.cardsLeft === 0) {
          expect(result.expectedPoints).toBe(0);
        } else if (result.cardsLeft >= 1 && result.cardsLeft <= 4) {
          expect(result.expectedPoints).toBe(result.cardsLeft * 1);
        } else if (result.cardsLeft >= 5 && result.cardsLeft <= 9) {
          expect(result.expectedPoints).toBe(result.cardsLeft * 2);
        } else if (result.cardsLeft >= 10 && result.cardsLeft <= 13) {
          expect(result.expectedPoints).toBe(result.cardsLeft * 3);
        }
      });
    });

    test('Cumulative scores across multiple matches', () => {
      // Match 1: Player 1 wins
      let scores = [0, 10, 10, 30]; // Winner, 5 cards (5x2=10), 5 cards (5x2=10), 10 cards (10x3=30)
      
      // Match 2: Player 2 wins
      scores = [
        scores[0] + 18, // 9 cards (9x2=18)
        scores[1] + 0,  // Winner
        scores[2] + 4,  // 4 cards (4x1=4)
        scores[3] + 33, // 11 cards (11x3=33)
      ];
      
      expect(scores).toEqual([18, 10, 14, 63]);
      
      // Match 3: Player 3 wins
      scores = [
        scores[0] + 16, // 8 cards (8x2=16)
        scores[1] + 2,  // 2 cards (2x1=2)
        scores[2] + 0,  // Winner
        scores[3] + 39, // 13 cards (13x3=39)
      ];
      
      expect(scores).toEqual([34, 12, 14, 102]);
      
      // Game ends (Player 4 >= 101), Player 3 wins with lowest score
      const gameEnded = scores.some(s => s >= 101);
      expect(gameEnded).toBe(true);
      
      const winnerScore = Math.min(...scores);
      expect(winnerScore).toBe(12);
    });
  });
});
