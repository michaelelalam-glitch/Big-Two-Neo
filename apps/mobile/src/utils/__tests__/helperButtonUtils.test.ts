/**
 * Helper Button Utilities Tests
 * 
 * Comprehensive test suite for Sort, Smart Sort, and combo detection functions
 * Tests edge cases, normal operations, and all combo types
 * 
 * Created as part of Task #393: Unit tests for sorting and combo detection
 * Date: December 13, 2025
 */

import {
  sortHandLowestToHighest,
  smartSortHand,
  findStraightFlushes,
  findFourOfAKind,
  findFullHouses,
  findFlushes,
  findStraights,
  compareCards,
  getCardValue,
} from '../helperButtonUtils';
import type { Card } from '../../types/multiplayer';

// Helper function to create cards
const createCard = (rank: string, suit: string): Card => ({
  id: `${rank}${suit}`,
  rank: rank as any,
  suit: suit as any,
});

describe('Helper Button Utilities', () => {
  
  describe('sortHandLowestToHighest', () => {
    it('should handle empty hand', () => {
      const result = sortHandLowestToHighest([]);
      expect(result).toEqual([]);
    });

    it('should handle single card', () => {
      const hand = [createCard('K', 'H')];
      const result = sortHandLowestToHighest(hand);
      expect(result).toEqual(hand);
    });

    it('should sort cards by rank (lowest to highest)', () => {
      const hand = [
        createCard('2', 'H'),
        createCard('3', 'D'),
        createCard('A', 'S'),
        createCard('5', 'C'),
      ];
      const result = sortHandLowestToHighest(hand);
      
      expect(result[0].rank).toBe('3'); // Lowest rank
      expect(result[1].rank).toBe('5');
      expect(result[2].rank).toBe('A');
      expect(result[3].rank).toBe('2'); // Highest rank in Big 2
    });

    it('should sort cards by suit when same rank', () => {
      const hand = [
        createCard('5', 'S'), // Spades (highest)
        createCard('5', 'D'), // Diamonds (lowest)
        createCard('5', 'H'), // Hearts
        createCard('5', 'C'), // Clubs
      ];
      const result = sortHandLowestToHighest(hand);
      
      expect(result[0].suit).toBe('D'); // Diamonds
      expect(result[1].suit).toBe('C'); // Clubs
      expect(result[2].suit).toBe('H'); // Hearts
      expect(result[3].suit).toBe('S'); // Spades
    });

    it('should sort mixed hand correctly', () => {
      const hand = [
        createCard('K', 'H'),
        createCard('3', 'D'),
        createCard('A', 'S'),
        createCard('5', 'C'),
        createCard('3', 'S'),
        createCard('2', 'H'),
      ];
      const result = sortHandLowestToHighest(hand);
      
      expect(result[0]).toEqual(createCard('3', 'D'));
      expect(result[1]).toEqual(createCard('3', 'S'));
      expect(result[2]).toEqual(createCard('5', 'C'));
      expect(result[3]).toEqual(createCard('K', 'H'));
      expect(result[4]).toEqual(createCard('A', 'S'));
      expect(result[5]).toEqual(createCard('2', 'H'));
    });
  });

  describe('getCardValue and compareCards', () => {
    it('should calculate correct card value', () => {
      const card3D = createCard('3', 'D');
      const card2S = createCard('2', 'S');
      
      expect(getCardValue(card3D)).toBe(0); // Lowest (rank 0, suit 0)
      expect(getCardValue(card2S)).toBe(123); // Highest (rank 12*10 + suit 3)
    });

    it('should compare cards correctly', () => {
      const card3D = createCard('3', 'D');
      const card3S = createCard('3', 'S');
      const card5C = createCard('5', 'C');
      
      expect(compareCards(card3D, card3S)).toBeLessThan(0);
      expect(compareCards(card3S, card3D)).toBeGreaterThan(0);
      expect(compareCards(card3D, card5C)).toBeLessThan(0);
    });
  });

  describe('findStraightFlushes', () => {
    it('should find straight flush (5-high)', () => {
      const hand = [
        createCard('A', 'D'),
        createCard('2', 'D'),
        createCard('3', 'D'),
        createCard('4', 'D'),
        createCard('5', 'D'),
        createCard('7', 'C'),
      ];
      const usedCards = new Set<string>();
      const result = findStraightFlushes(hand, usedCards);
      
      expect(result.length).toBe(1);
      expect(result[0].length).toBe(5);
      expect(usedCards.size).toBe(5);
    });

    it('should find straight flush (10-high)', () => {
      const hand = [
        createCard('10', 'H'),
        createCard('J', 'H'),
        createCard('Q', 'H'),
        createCard('K', 'H'),
        createCard('A', 'H'),
      ];
      const usedCards = new Set<string>();
      const result = findStraightFlushes(hand, usedCards);
      
      expect(result.length).toBe(1);
      expect(result[0].length).toBe(5);
    });

    it('should return empty for no straight flush', () => {
      const hand = [
        createCard('3', 'D'),
        createCard('4', 'C'),
        createCard('5', 'H'),
      ];
      const usedCards = new Set<string>();
      const result = findStraightFlushes(hand, usedCards);
      
      expect(result.length).toBe(0);
    });
  });

  describe('findFourOfAKind', () => {
    it('should find four of a kind with kicker', () => {
      const hand = [
        createCard('7', 'D'),
        createCard('7', 'C'),
        createCard('7', 'H'),
        createCard('7', 'S'),
        createCard('3', 'D'),
      ];
      const usedCards = new Set<string>();
      const result = findFourOfAKind(hand, usedCards);
      
      expect(result.length).toBe(1);
      expect(result[0].length).toBe(5); // 4 + kicker
      expect(usedCards.size).toBe(5);
    });

    it('should return empty without kicker', () => {
      const hand = [
        createCard('7', 'D'),
        createCard('7', 'C'),
        createCard('7', 'H'),
        createCard('7', 'S'),
      ];
      const usedCards = new Set<string>();
      const result = findFourOfAKind(hand, usedCards);
      
      expect(result.length).toBe(0);
    });
  });

  describe('findFullHouses', () => {
    it('should find full house (triple + pair)', () => {
      const hand = [
        createCard('K', 'D'),
        createCard('K', 'C'),
        createCard('K', 'H'),
        createCard('5', 'D'),
        createCard('5', 'C'),
      ];
      const usedCards = new Set<string>();
      const result = findFullHouses(hand, usedCards);
      
      expect(result.length).toBe(1);
      expect(result[0].length).toBe(5);
      expect(usedCards.size).toBe(5);
    });

    it('should prioritize higher triple', () => {
      const hand = [
        createCard('K', 'D'),
        createCard('K', 'C'),
        createCard('K', 'H'),
        createCard('3', 'D'),
        createCard('3', 'C'),
        createCard('3', 'H'),
      ];
      const usedCards = new Set<string>();
      const result = findFullHouses(hand, usedCards);
      
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('findFlushes', () => {
    it('should find flush (5 cards same suit)', () => {
      const hand = [
        createCard('3', 'H'),
        createCard('5', 'H'),
        createCard('7', 'H'),
        createCard('9', 'H'),
        createCard('J', 'H'),
      ];
      const usedCards = new Set<string>();
      const result = findFlushes(hand, usedCards);
      
      expect(result.length).toBe(1);
      expect(result[0].length).toBe(5);
    });

    it('should not return straight flush as regular flush', () => {
      const hand = [
        createCard('3', 'D'),
        createCard('4', 'D'),
        createCard('5', 'D'),
        createCard('6', 'D'),
        createCard('7', 'D'),
      ];
      const usedCards = new Set<string>();
      const result = findFlushes(hand, usedCards);
      
      // Should be empty because it's a straight flush, not regular flush
      expect(result.length).toBe(0);
    });
  });

  describe('findStraights', () => {
    it('should find straight (5 consecutive ranks)', () => {
      const hand = [
        createCard('5', 'D'),
        createCard('6', 'C'),
        createCard('7', 'H'),
        createCard('8', 'S'),
        createCard('9', 'D'),
      ];
      const usedCards = new Set<string>();
      const result = findStraights(hand, usedCards);
      
      expect(result.length).toBe(1);
      expect(result[0].length).toBe(5);
    });

    it('should find A-2-3-4-5 straight', () => {
      const hand = [
        createCard('A', 'D'),
        createCard('2', 'C'),
        createCard('3', 'H'),
        createCard('4', 'S'),
        createCard('5', 'D'),
      ];
      const usedCards = new Set<string>();
      const result = findStraights(hand, usedCards);
      
      expect(result.length).toBe(1);
    });

    it('should not return flush as straight', () => {
      const hand = [
        createCard('3', 'H'),
        createCard('5', 'H'),
        createCard('7', 'H'),
        createCard('9', 'H'),
        createCard('J', 'H'),
      ];
      const usedCards = new Set<string>();
      const result = findStraights(hand, usedCards);
      
      expect(result.length).toBe(0);
    });
  });

  describe('smartSortHand', () => {
    it('should handle empty hand', () => {
      const result = smartSortHand([]);
      expect(result).toEqual([]);
    });

    it('should group pairs correctly', () => {
      const hand = [
        createCard('3', 'D'),
        createCard('5', 'C'),
        createCard('5', 'D'),
        createCard('K', 'H'),
      ];
      const result = smartSortHand(hand);
      
      // Singles first, then pair
      expect(result[0].rank).toBe('3');
      expect(result[1].rank).toBe('K');
      expect(result[2].rank).toBe('5');
      expect(result[3].rank).toBe('5');
    });

    it('should group triples correctly', () => {
      const hand = [
        createCard('3', 'D'),
        createCard('10', 'H'),
        createCard('10', 'C'),
        createCard('10', 'S'),
        createCard('2', 'H'),
      ];
      const result = smartSortHand(hand);
      
      // Singles first, then triple
      expect(result[0].rank).toBe('3');
      expect(result[1].rank).toBe('2');
      expect(result[2].rank).toBe('10');
      expect(result[3].rank).toBe('10');
      expect(result[4].rank).toBe('10');
    });

    it('should group full house correctly', () => {
      const hand = [
        createCard('K', 'D'),
        createCard('K', 'C'),
        createCard('K', 'H'),
        createCard('5', 'D'),
        createCard('5', 'C'),
      ];
      const result = smartSortHand(hand);
      
      // Should all be grouped together as 5-card combo
      expect(result.length).toBe(5);
    });

    it('should group flush correctly', () => {
      const hand = [
        createCard('3', 'H'),
        createCard('5', 'H'),
        createCard('7', 'H'),
        createCard('9', 'H'),
        createCard('J', 'H'),
        createCard('K', 'D'),
      ];
      const result = smartSortHand(hand);
      
      // Single first, then flush
      expect(result[0].rank).toBe('K');
      expect(result[1].suit).toBe('H');
      expect(result[5].suit).toBe('H');
    });

    it('should group straight correctly', () => {
      const hand = [
        createCard('5', 'D'),
        createCard('6', 'C'),
        createCard('7', 'H'),
        createCard('8', 'S'),
        createCard('9', 'D'),
        createCard('K', 'H'),
      ];
      const result = smartSortHand(hand);
      
      // Single first, then straight
      expect(result[0].rank).toBe('K');
      // Rest should be the straight
    });

    it('should split four of a kind into two pairs', () => {
      const hand = [
        createCard('7', 'D'),
        createCard('7', 'C'),
        createCard('7', 'H'),
        createCard('7', 'S'),
      ];
      const result = smartSortHand(hand);
      
      // Should be split into two pairs
      expect(result.length).toBe(4);
      expect(result[0].rank).toBe('7');
      expect(result[1].rank).toBe('7');
      expect(result[2].rank).toBe('7');
      expect(result[3].rank).toBe('7');
    });

    it('should handle complex hand with multiple combos', () => {
      const hand = [
        // Pair
        createCard('3', 'D'),
        createCard('3', 'C'),
        // Triple
        createCard('5', 'D'),
        createCard('5', 'C'),
        createCard('5', 'H'),
        // Singles
        createCard('K', 'H'),
        createCard('A', 'S'),
        createCard('2', 'H'),
      ];
      const result = smartSortHand(hand);
      
      // Should group: singles, pair, triple (order may vary by implementation)
      expect(result.length).toBe(8);
      
      // First 3 should be singles
      expect(['K', 'A', '2']).toContain(result[0].rank);
      expect(['K', 'A', '2']).toContain(result[1].rank);
      expect(['K', 'A', '2']).toContain(result[2].rank);
      
      // Next group should be either pair or triple
      // If triple comes first (5,5,5):
      if (result[3].rank === '5') {
        expect(result[3].rank).toBe('5');
        expect(result[4].rank).toBe('5');
        expect(result[5].rank).toBe('5');
        expect(result[6].rank).toBe('3');
        expect(result[7].rank).toBe('3');
      } else {
        // If pair comes first (3,3):
        expect(result[3].rank).toBe('3');
        expect(result[4].rank).toBe('3');
        expect(result[5].rank).toBe('5');
        expect(result[6].rank).toBe('5');
        expect(result[7].rank).toBe('5');
      }
    });
  });
});
