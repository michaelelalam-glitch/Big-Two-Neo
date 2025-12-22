/**
 * Hint Logic Tests
 * 
 * Comprehensive test suite for findHintPlay function
 * Tests first play, leading, following, and pass scenarios
 * 
 * Created as part of Task #394: Unit tests for hint logic
 * Date: December 13, 2025
 */

import { findHintPlay } from '../helperButtonUtils';
import type { Card } from '../../types/multiplayer';
import type { LastPlay } from '../../game/types';

// Helper function to create cards
const createCard = (rank: string, suit: string): Card => ({
  id: `${rank}${suit}`,
  rank: rank as any,
  suit: suit as any,
});

// Helper to create LastPlay
const createLastPlay = (cards: Card[], comboType: string): LastPlay => ({
  cards,
  combo_type: comboType as any,
  position: 0,
});

describe('findHintPlay - Hint Button Logic', () => {
  
  describe('First play of game (must include 3♦)', () => {
    it('should recommend 3♦ when available', () => {
      const hand = [
        createCard('3', 'D'),
        createCard('5', 'H'),
        createCard('K', 'S'),
      ];
      
      const result = findHintPlay(hand, null, true);
      
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0]).toBe('3D');
    });

    it('should return null when 3♦ not available', () => {
      const hand = [
        createCard('3', 'C'),
        createCard('5', 'H'),
        createCard('K', 'S'),
      ];
      
      const result = findHintPlay(hand, null, true);
      
      expect(result).toBeNull();
    });

    it('should recommend 3♦ even with better cards available', () => {
      const hand = [
        createCard('3', 'D'),
        createCard('2', 'S'), // Highest card
        createCard('A', 'H'),
      ];
      
      const result = findHintPlay(hand, null, true);
      
      expect(result).toEqual(['3D']);
    });
  });

  describe('Leading (no last play)', () => {
    it('should recommend lowest single card', () => {
      const hand = [
        createCard('7', 'H'),
        createCard('3', 'D'),
        createCard('K', 'S'),
      ];
      
      const result = findHintPlay(hand, null, false);
      
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0]).toBe('3D');
    });

    it('should recommend lowest card even with pairs', () => {
      const hand = [
        createCard('5', 'D'),
        createCard('5', 'C'),
        createCard('3', 'H'),
      ];
      
      const result = findHintPlay(hand, null, false);
      
      expect(result).toEqual(['3H']);
    });

    it('should handle single card hand', () => {
      const hand = [createCard('K', 'H')];
      
      const result = findHintPlay(hand, null, false);
      
      expect(result).toEqual(['KH']);
    });
  });

  describe('Following - Singles', () => {
    it('should recommend lowest card that beats last play', () => {
      const hand = [
        createCard('5', 'D'),
        createCard('7', 'H'),
        createCard('K', 'S'),
      ];
      const lastPlay = createLastPlay([createCard('4', 'C')], 'Single');
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0]).toBe('5D');
    });

    it('should consider suit when same rank', () => {
      const hand = [
        createCard('5', 'H'), // Higher suit
        createCard('5', 'C'), // Lower suit
      ];
      const lastPlay = createLastPlay([createCard('5', 'D')], 'Single');
      
      const result = findHintPlay(hand, lastPlay, false);
      
      // Should recommend 5H (higher suit beats 5D)
      expect(result).toEqual(['5H']);
    });

    it('should return null when cannot beat single', () => {
      const hand = [
        createCard('3', 'D'),
        createCard('4', 'C'),
      ];
      const lastPlay = createLastPlay([createCard('2', 'S')], 'Single');
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).toBeNull();
    });
  });

  describe('Following - Pairs', () => {
    it('should recommend lowest pair that beats last play', () => {
      const hand = [
        createCard('5', 'D'),
        createCard('5', 'C'),
        createCard('7', 'H'),
        createCard('7', 'S'),
      ];
      const lastPlay = createLastPlay(
        [createCard('4', 'D'), createCard('4', 'C')],
        'Pair'
      );
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result!.every(id => id.startsWith('5'))).toBe(true);
    });

    it('should return null when no pair available', () => {
      const hand = [
        createCard('5', 'D'),
        createCard('7', 'H'),
        createCard('K', 'S'),
      ];
      const lastPlay = createLastPlay(
        [createCard('4', 'D'), createCard('4', 'C')],
        'Pair'
      );
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).toBeNull();
    });

    it('should return null when pair does not beat last play', () => {
      const hand = [
        createCard('3', 'D'),
        createCard('3', 'C'),
      ];
      const lastPlay = createLastPlay(
        [createCard('5', 'D'), createCard('5', 'C')],
        'Pair'
      );
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).toBeNull();
    });
  });

  describe('Following - Triples', () => {
    it('should recommend lowest triple that beats last play', () => {
      const hand = [
        createCard('7', 'D'),
        createCard('7', 'C'),
        createCard('7', 'H'),
        createCard('K', 'S'),
      ];
      const lastPlay = createLastPlay(
        [createCard('5', 'D'), createCard('5', 'C'), createCard('5', 'H')],
        'Triple'
      );
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).not.toBeNull();
      expect(result).toHaveLength(3);
      expect(result!.every(id => id.startsWith('7'))).toBe(true);
    });

    it('should return null when no triple available', () => {
      const hand = [
        createCard('7', 'D'),
        createCard('7', 'C'),
        createCard('K', 'S'),
      ];
      const lastPlay = createLastPlay(
        [createCard('5', 'D'), createCard('5', 'C'), createCard('5', 'H')],
        'Triple'
      );
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).toBeNull();
    });
  });

  describe('Following - 5-Card Combos', () => {
    it('should recommend straight that beats last play', () => {
      const hand = [
        createCard('6', 'D'),
        createCard('7', 'C'),
        createCard('8', 'H'),
        createCard('9', 'S'),
        createCard('10', 'D'),
      ];
      const lastPlay = createLastPlay(
        [
          createCard('3', 'D'),
          createCard('4', 'C'),
          createCard('5', 'H'),
          createCard('6', 'S'),
          createCard('7', 'D'),
        ],
        'Straight'
      );
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).not.toBeNull();
      expect(result).toHaveLength(5);
    });

    it('should recommend flush that beats last play', () => {
      const hand = [
        createCard('3', 'H'),
        createCard('5', 'H'),
        createCard('7', 'H'),
        createCard('9', 'H'),
        createCard('J', 'H'),
      ];
      const lastPlay = createLastPlay(
        [
          createCard('3', 'D'),
          createCard('4', 'D'),
          createCard('5', 'D'),
          createCard('6', 'D'),
          createCard('7', 'D'),
        ],
        'Straight'
      );
      
      const result = findHintPlay(hand, lastPlay, false);
      
      // Flush beats straight
      expect(result).not.toBeNull();
      expect(result).toHaveLength(5);
    });

    it('should return null when cannot beat 5-card combo', () => {
      const hand = [
        createCard('3', 'D'),
        createCard('4', 'C'),
        createCard('5', 'H'),
      ];
      const lastPlay = createLastPlay(
        [
          createCard('3', 'D'),
          createCard('4', 'D'),
          createCard('5', 'D'),
          createCard('6', 'D'),
          createCard('7', 'D'),
        ],
        'Straight'
      );
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty hand', () => {
      const result = findHintPlay([], null, false);
      
      expect(result).toBeNull();
    });

    it('should handle hand with only high cards against low single', () => {
      const hand = [
        createCard('A', 'S'),
        createCard('2', 'H'),
      ];
      const lastPlay = createLastPlay([createCard('3', 'D')], 'Single');
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).not.toBeNull();
      // Should recommend lowest beating card (A)
      expect(result![0]).toBe('AS');
    });

    it('should handle multiple valid plays and recommend lowest', () => {
      const hand = [
        createCard('5', 'D'),
        createCard('5', 'C'),
        createCard('7', 'H'),
        createCard('7', 'S'),
        createCard('K', 'D'),
      ];
      const lastPlay = createLastPlay(
        [createCard('4', 'D'), createCard('4', 'C')],
        'Pair'
      );
      
      const result = findHintPlay(hand, lastPlay, false);
      
      // Should recommend 5 pair (lower than 7 pair)
      expect(result).not.toBeNull();
      expect(result!.every(id => id.startsWith('5'))).toBe(true);
    });
  });

  describe('Pass Scenarios', () => {
    it('should return null when all cards are lower than last play', () => {
      const hand = [
        createCard('3', 'D'),
        createCard('4', 'C'),
      ];
      const lastPlay = createLastPlay([createCard('K', 'S')], 'Single');
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).toBeNull();
    });

    it('should return null when hand has no matching combo type', () => {
      const hand = [
        createCard('3', 'D'),
        createCard('5', 'C'),
        createCard('7', 'H'),
      ];
      const lastPlay = createLastPlay(
        [createCard('4', 'D'), createCard('4', 'C')],
        'Pair'
      );
      
      const result = findHintPlay(hand, lastPlay, false);
      
      expect(result).toBeNull();
    });
  });
});
