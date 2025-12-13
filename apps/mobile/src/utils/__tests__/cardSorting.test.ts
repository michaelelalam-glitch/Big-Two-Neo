/**
 * Card Sorting Tests - Task #313
 * 
 * Tests for sortCardsForDisplay() function
 * Ensures cards are displayed in descending order (highest first)
 * for all combination types
 */

import { sortCardsForDisplay } from '../cardSorting';
import type { Card } from '../../types/multiplayer';

// Helper to create card
const createCard = (rank: Card['rank'], suit: Card['suit']): Card => ({
  id: `${rank}${suit}`,
  rank,
  suit,
});

describe('sortCardsForDisplay - Task #313', () => {
  describe('Singles', () => {
    it('should return single card as-is', () => {
      const cards = [createCard('K', 'S')];
      const result = sortCardsForDisplay(cards);
      
      expect(result).toHaveLength(1);
      expect(result[0].rank).toBe('K');
      expect(result[0].suit).toBe('S');
    });
  });

  describe('Pairs', () => {
    it('should display pair with highest suit first', () => {
      const cards = [
        createCard('7', 'D'), // Lowest suit
        createCard('7', 'S'), // Highest suit
      ];
      
      const result = sortCardsForDisplay(cards, 'Pair');
      
      expect(result).toHaveLength(2);
      expect(result[0].suit).toBe('S'); // Spades first
      expect(result[1].suit).toBe('D'); // Diamonds last
    });
  });

  describe('Triples', () => {
    it('should display triple with highest suit first', () => {
      const cards = [
        createCard('Q', 'C'), // Medium suit
        createCard('Q', 'H'), // High suit
        createCard('Q', 'D'), // Low suit
      ];
      
      const result = sortCardsForDisplay(cards, 'Triple');
      
      expect(result).toHaveLength(3);
      expect(result[0].suit).toBe('H'); // Hearts first
      expect(result[1].suit).toBe('C'); // Clubs second
      expect(result[2].suit).toBe('D'); // Diamonds last
    });
  });

  describe('Straights', () => {
    it('should display straight 3-4-5-6-7 as 7-6-5-4-3 (highest first)', () => {
      const cards = [
        createCard('3', 'D'),
        createCard('4', 'S'),
        createCard('5', 'D'),
        createCard('6', 'S'),
        createCard('7', 'C'),
      ];
      
      const result = sortCardsForDisplay(cards, 'Straight');
      
      expect(result).toHaveLength(5);
      expect(result[0].rank).toBe('7'); // Highest first
      expect(result[1].rank).toBe('6');
      expect(result[2].rank).toBe('5');
      expect(result[3].rank).toBe('4');
      expect(result[4].rank).toBe('3'); // Lowest last
    });

    it('should display high straight with 2 as 2-6-5-4-3 (highest first)', () => {
      const cards = [
        createCard('3', 'D'),
        createCard('4', 'S'),
        createCard('5', 'D'),
        createCard('6', 'S'),
        createCard('2', 'C'), // 2 is highest in Big Two
      ];
      
      const result = sortCardsForDisplay(cards, 'Straight');
      
      expect(result).toHaveLength(5);
      expect(result[0].rank).toBe('6'); // Highest rank in sequence first
      expect(result[1].rank).toBe('5');
      expect(result[2].rank).toBe('4');
      expect(result[3].rank).toBe('3');
      expect(result[4].rank).toBe('2'); // 2 appears last in straight sequence
    });

    it('should display wrap-around straight 5-4-3-2-A as 5-4-3-2-A', () => {
      const cards = [
        createCard('A', 'S'),
        createCard('2', 'H'),
        createCard('3', 'D'),
        createCard('4', 'C'),
        createCard('5', 'S'),
      ];
      
      const result = sortCardsForDisplay(cards, 'Straight');
      
      expect(result).toHaveLength(5);
      expect(result[0].rank).toBe('5'); // Highest in sequence
      expect(result[1].rank).toBe('4');
      expect(result[2].rank).toBe('3');
      expect(result[3].rank).toBe('2');
      expect(result[4].rank).toBe('A'); // Ace at end
    });
  });

  describe('Flushes', () => {
    it('should display flush with highest card first', () => {
      const cards = [
        createCard('3', 'H'),
        createCard('7', 'H'),
        createCard('10', 'H'),
        createCard('K', 'H'),
        createCard('2', 'H'), // Highest card in Big Two
      ];
      
      const result = sortCardsForDisplay(cards, 'Flush');
      
      expect(result).toHaveLength(5);
      expect(result[0].rank).toBe('2'); // 2 is highest
      expect(result[1].rank).toBe('K');
      expect(result[2].rank).toBe('10');
      expect(result[3].rank).toBe('7');
      expect(result[4].rank).toBe('3'); // 3 is lowest
    });
  });

  describe('Full House', () => {
    it('should display full house with triple first, then pair', () => {
      const cards = [
        createCard('9', 'D'), // Pair
        createCard('9', 'S'), // Pair
        createCard('4', 'C'), // Triple
        createCard('4', 'H'), // Triple
        createCard('4', 'S'), // Triple
      ];
      
      const result = sortCardsForDisplay(cards, 'Full House');
      
      expect(result).toHaveLength(5);
      // First 3 cards should be the triple (4s)
      expect(result[0].rank).toBe('4');
      expect(result[1].rank).toBe('4');
      expect(result[2].rank).toBe('4');
      // Last 2 cards should be the pair (9s)
      expect(result[3].rank).toBe('9');
      expect(result[4].rank).toBe('9');
      // Within each group, highest suit first
      expect(result[0].suit).toBe('S'); // Spades highest in triple
      expect(result[3].suit).toBe('S'); // Spades highest in pair
    });
  });

  describe('Four of a Kind', () => {
    it('should display four cards together, then kicker', () => {
      const cards = [
        createCard('8', 'C'), // Kicker
        createCard('2', 'D'), // Quads
        createCard('2', 'H'), // Quads
        createCard('2', 'C'), // Quads
        createCard('2', 'S'), // Quads
      ];
      
      const result = sortCardsForDisplay(cards, 'Four of a Kind');
      
      expect(result).toHaveLength(5);
      // First 4 cards should be the quads (2s)
      expect(result[0].rank).toBe('2');
      expect(result[1].rank).toBe('2');
      expect(result[2].rank).toBe('2');
      expect(result[3].rank).toBe('2');
      // Last card should be kicker
      expect(result[4].rank).toBe('8');
      // Within quads, highest suit first
      expect(result[0].suit).toBe('S'); // Spades highest
    });
  });

  describe('Straight Flush', () => {
    it('should display straight flush with highest card first', () => {
      const cards = [
        createCard('3', 'H'),
        createCard('4', 'H'),
        createCard('5', 'H'),
        createCard('6', 'H'),
        createCard('7', 'H'),
      ];
      
      const result = sortCardsForDisplay(cards, 'Straight Flush');
      
      expect(result).toHaveLength(5);
      expect(result[0].rank).toBe('7'); // Highest first
      expect(result[1].rank).toBe('6');
      expect(result[2].rank).toBe('5');
      expect(result[3].rank).toBe('4');
      expect(result[4].rank).toBe('3'); // Lowest last
      // All same suit
      expect(result.every(c => c.suit === 'H')).toBe(true);
    });
  });

  describe('Auto-detection', () => {
    it('should auto-detect and sort straight without explicit combo type', () => {
      const cards = [
        createCard('8', 'D'),
        createCard('9', 'S'),
        createCard('10', 'H'),
        createCard('J', 'C'),
        createCard('Q', 'D'),
      ];
      
      const result = sortCardsForDisplay(cards); // No combo type provided
      
      expect(result).toHaveLength(5);
      expect(result[0].rank).toBe('Q'); // Highest first
      expect(result[4].rank).toBe('8'); // Lowest last
    });

    it('should auto-detect and sort flush without explicit combo type', () => {
      const cards = [
        createCard('5', 'D'),
        createCard('9', 'D'),
        createCard('K', 'D'),
        createCard('3', 'D'),
        createCard('A', 'D'),
      ];
      
      const result = sortCardsForDisplay(cards); // No combo type provided
      
      expect(result).toHaveLength(5);
      expect(result[0].rank).toBe('A'); // Highest first
      expect(result[4].rank).toBe('3'); // Lowest last
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty array', () => {
      const result = sortCardsForDisplay([]);
      expect(result).toEqual([]);
    });

    it('should handle cards played in random order', () => {
      // User selects cards randomly: 1, 4, 5, 3, 2
      const cards = [
        createCard('A', 'S'), // 1st selected
        createCard('4', 'D'), // 2nd selected
        createCard('5', 'C'), // 3rd selected
        createCard('3', 'H'), // 4th selected
        createCard('2', 'S'), // 5th selected
      ];
      
      const result = sortCardsForDisplay(cards, 'Straight');
      
      // Should be sorted correctly regardless of selection order
      expect(result[0].rank).toBe('5'); // Highest in straight
      expect(result[1].rank).toBe('4');
      expect(result[2].rank).toBe('3');
      expect(result[3].rank).toBe('2');
      expect(result[4].rank).toBe('A'); // Lowest in straight
    });
  });
});
