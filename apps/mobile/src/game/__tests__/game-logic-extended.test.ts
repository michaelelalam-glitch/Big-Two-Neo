/**
// @ts-nocheck - Test infrastructure type issues
 * Additional game logic tests for edge cases and full coverage
 */

import {
  classifyCards,
  canBeatPlay,
  findRecommendedPlay,
  sortStraightCards,
} from '../engine/game-logic';
import type { Card, LastPlay } from '../types';

describe('Game Logic - Additional Coverage Tests', () => {
  describe('sortStraightCards edge cases', () => {
    test('handles non-5 card arrays', () => {
      const cards: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '4C', rank: '4', suit: 'C' },
      ];
      const result = sortStraightCards(cards);
      expect(result.length).toBe(2);
    });

    test('handles invalid straight (returns regular sort)', () => {
      const cards: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '7H', rank: '7', suit: 'H' },
        { id: '9S', rank: '9', suit: 'S' },
        { id: 'JD', rank: 'J', suit: 'D' },
      ];
      const result = sortStraightCards(cards);
      expect(result[0].rank).toBe('3');
    });

    test('sorts A-low straight correctly (A-2-3-4-5)', () => {
      const cards: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: 'AH', rank: 'A', suit: 'H' },
        { id: '3C', rank: '3', suit: 'C' },
        { id: '2S', rank: '2', suit: 'S' },
        { id: '4D', rank: '4', suit: 'D' },
      ];
      const result = sortStraightCards(cards);
      expect(result.map(c => c.rank)).toEqual(['A', '2', '3', '4', '5']);
    });
  });

  describe('canBeatPlay - Full House edge cases', () => {
    test('lower Full House cannot beat higher Full House', () => {
      const newCards: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '3C', rank: '3', suit: 'C' },
        { id: '3H', rank: '3', suit: 'H' },
        { id: '4S', rank: '4', suit: 'S' },
        { id: '4D', rank: '4', suit: 'D' },
      ];
      const lastPlay: LastPlay = {
        position: 0,
        cards: [
          { id: '5D', rank: '5', suit: 'D' },
          { id: '5C', rank: '5', suit: 'C' },
          { id: '5H', rank: '5', suit: 'H' },
          { id: '6S', rank: '6', suit: 'S' },
          { id: '6D', rank: '6', suit: 'D' },
        ],
        combo_type: 'Full House',
      };
      expect(canBeatPlay(newCards, lastPlay)).toBe(false);
    });
  });

  describe('canBeatPlay - Four of a Kind edge cases', () => {
    test('higher Four of a Kind beats lower Four of a Kind', () => {
      const newCards: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '5H', rank: '5', suit: 'H' },
        { id: '5S', rank: '5', suit: 'S' },
        { id: '3D', rank: '3', suit: 'D' },
      ];
      const lastPlay: LastPlay = {
        position: 0,
        cards: [
          { id: '4D', rank: '4', suit: 'D' },
          { id: '4C', rank: '4', suit: 'C' },
          { id: '4H', rank: '4', suit: 'H' },
          { id: '4S', rank: '4', suit: 'S' },
          { id: '6D', rank: '6', suit: 'D' },
        ],
        combo: 'Four of a Kind',
      };
      expect(canBeatPlay(newCards, lastPlay)).toBe(true);
    });

    test('lower Four of a Kind cannot beat higher Four of a Kind', () => {
      const newCards: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '3C', rank: '3', suit: 'C' },
        { id: '3H', rank: '3', suit: 'H' },
        { id: '3S', rank: '3', suit: 'S' },
        { id: '4D', rank: '4', suit: 'D' },
      ];
      const lastPlay: LastPlay = {
        position: 0,
        cards: [
          { id: '5D', rank: '5', suit: 'D' },
          { id: '5C', rank: '5', suit: 'C' },
          { id: '5H', rank: '5', suit: 'H' },
          { id: '5S', rank: '5', suit: 'S' },
          { id: '6D', rank: '6', suit: 'D' },
        ],
        combo: 'Four of a Kind',
      };
      expect(canBeatPlay(newCards, lastPlay)).toBe(false);
    });
  });

  describe('canBeatPlay - Straight Flush edge cases', () => {
    test('Straight Flush beats Four of a Kind', () => {
      const newCards: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '4D', rank: '4', suit: 'D' },
        { id: '5D', rank: '5', suit: 'D' },
        { id: '6D', rank: '6', suit: 'D' },
        { id: '7D', rank: '7', suit: 'D' },
      ];
      const lastPlay: LastPlay = {
        position: 0,
        cards: [
          { id: 'AC', rank: 'A', suit: 'C' },
          { id: 'AH', rank: 'A', suit: 'H' },
          { id: 'AS', rank: 'A', suit: 'S' },
          { id: 'AD', rank: 'A', suit: 'D' },
          { id: '2D', rank: '2', suit: 'D' },
        ],
        combo: 'Four of a Kind',
      };
      expect(canBeatPlay(newCards, lastPlay)).toBe(true);
    });
  });

  describe('findRecommendedPlay - comprehensive coverage', () => {
    test('finds pair when following pair', () => {
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
      const result = findRecommendedPlay(hand, lastPlay, false);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(2);
    });

    test('finds triple when following triple', () => {
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '5H', rank: '5', suit: 'H' },
        { id: '6S', rank: '6', suit: 'S' },
      ];
      const lastPlay: LastPlay = {
        position: 0,
        cards: [
          { id: '4D', rank: '4', suit: 'D' },
          { id: '4C', rank: '4', suit: 'C' },
          { id: '4H', rank: '4', suit: 'H' },
        ],
        combo_type: 'Triple',
      };
      const result = findRecommendedPlay(hand, lastPlay, false);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(3);
    });

    test('finds straight when following 5-card combo', () => {
      const hand: Card[] = [
        { id: '7D', rank: '7', suit: 'D' },
        { id: '8C', rank: '8', suit: 'C' },
        { id: '9H', rank: '9', suit: 'H' },
        { id: '10S', rank: '10', suit: 'S' },
        { id: 'JD', rank: 'J', suit: 'D' },
        { id: 'QC', rank: 'Q', suit: 'C' },
      ];
      const lastPlay: LastPlay = {
        position: 0,
        cards: [
          { id: '3D', rank: '3', suit: 'D' },
          { id: '4C', rank: '4', suit: 'C' },
          { id: '5H', rank: '5', suit: 'H' },
          { id: '6S', rank: '6', suit: 'S' },
          { id: '7C', rank: '7', suit: 'C' },
        ],
        combo_type: 'Straight',
      };
      const result = findRecommendedPlay(hand, lastPlay, false);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(5);
    });

    test('finds flush when possible', () => {
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '7D', rank: '7', suit: 'D' },
        { id: '9D', rank: '9', suit: 'D' },
        { id: 'JD', rank: 'J', suit: 'D' },
        { id: 'KD', rank: 'K', suit: 'D' },
      ];
      const lastPlay: LastPlay = {
        position: 0,
        cards: [
          { id: '3C', rank: '3', suit: 'C' },
          { id: '4H', rank: '4', suit: 'H' },
          { id: '5S', rank: '5', suit: 'S' },
          { id: '6D', rank: '6', suit: 'D' },
          { id: '7C', rank: '7', suit: 'C' },
        ],
        combo_type: 'Straight',
      };
      const result = findRecommendedPlay(hand, lastPlay, false);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(5);
    });

    test('finds full house when possible', () => {
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '5H', rank: '5', suit: 'H' },
        { id: '6S', rank: '6', suit: 'S' },
        { id: '6D', rank: '6', suit: 'D' },
        { id: '7C', rank: '7', suit: 'C' },
      ];
      const lastPlay: LastPlay = {
        position: 0,
        cards: [
          { id: '3D', rank: '3', suit: 'D' },
          { id: '4C', rank: '4', suit: 'C' },
          { id: '5S', rank: '5', suit: 'S' },
          { id: '6H', rank: '6', suit: 'H' },
          { id: '7H', rank: '7', suit: 'H' },
        ],
        combo_type: 'Straight',
      };
      const result = findRecommendedPlay(hand, lastPlay, false);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(5);
    });

    test('finds four of a kind when possible', () => {
      const hand: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '5H', rank: '5', suit: 'H' },
        { id: '5S', rank: '5', suit: 'S' },
        { id: '6D', rank: '6', suit: 'D' },
      ];
      const lastPlay: LastPlay = {
        position: 0,
        cards: [
          { id: '7D', rank: '7', suit: 'D' },
          { id: '8D', rank: '8', suit: 'D' },
          { id: '9D', rank: '9', suit: 'D' },
          { id: '10D', rank: '10', suit: 'D' },
          { id: 'JD', rank: 'J', suit: 'D' },
        ],
        combo_type: 'Straight Flush',
      };
      const result = findRecommendedPlay(hand, lastPlay, false);
      // Four of a kind cannot beat straight flush
      expect(result).toBeNull();
    });

    test('returns null when cannot find valid 5-card combo', () => {
      const hand: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '7H', rank: '7', suit: 'H' },
        { id: '9S', rank: '9', suit: 'S' },
        { id: 'JD', rank: 'J', suit: 'D' },
      ];
      const lastPlay: LastPlay = {
        position: 0,
        cards: [
          { id: 'KD', rank: 'K', suit: 'D' },
          { id: 'KC', rank: 'K', suit: 'C' },
          { id: 'KH', rank: 'K', suit: 'H' },
          { id: 'KS', rank: 'K', suit: 'S' },
          { id: 'AD', rank: 'A', suit: 'D' },
        ],
        combo: 'Four of a Kind',
      };
      const result = findRecommendedPlay(hand, lastPlay, false);
      expect(result).toBeNull();
    });
  });

  describe('classifyCards - edge cases', () => {
    test('handles pair with same suit', () => {
      const cards: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
      ];
      expect(classifyCards(cards)).toBe('Pair');
    });

    test('handles triple with all same suit', () => {
      const cards: Card[] = [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '5H', rank: '5', suit: 'H' },
      ];
      expect(classifyCards(cards)).toBe('Triple');
    });

    test('rejects 5 cards that are not a valid combo', () => {
      const cards: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '7H', rank: '7', suit: 'H' },
        { id: '9S', rank: '9', suit: 'S' },
        { id: 'JD', rank: 'J', suit: 'D' },
      ];
      expect(classifyCards(cards)).toBe('unknown');
    });
  });
});
