/**
 * Tests for Highest Play Detector (Auto-Pass Timer)
 * 
 * Tests dynamic detection based on game state (played cards).
 */

import { isHighestPossiblePlay } from '../engine/highest-play-detector';
import type { Card } from '../types';

describe('Highest Play Detector', () => {
  // ============================================
  // SINGLES
  // ============================================
  
  describe('Singles', () => {
    it('detects 2♠ as highest single when no cards played', () => {
      const playedCards: Card[] = [];
      const twoSpades: Card = { id: '2S', rank: '2', suit: 'S' };
      
      expect(isHighestPossiblePlay([twoSpades], playedCards)).toBe(true);
    });
    
    it('does NOT detect 2♥ as highest when no cards played (2♠ is higher)', () => {
      const playedCards: Card[] = [];
      const twoHearts: Card = { id: '2H', rank: '2', suit: 'H' };
      
      expect(isHighestPossiblePlay([twoHearts], playedCards)).toBe(false);
    });
    
    it('detects 2♥ as highest single AFTER 2♠ is played', () => {
      const playedCards: Card[] = [{ id: '2S', rank: '2', suit: 'S' }];
      const twoHearts: Card = { id: '2H', rank: '2', suit: 'H' };
      
      expect(isHighestPossiblePlay([twoHearts], playedCards)).toBe(true);
    });
    
    it('detects 2♣ as highest single AFTER 2♠ and 2♥ played', () => {
      const playedCards: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
      ];
      const twoClubs: Card = { id: '2C', rank: '2', suit: 'C' };
      
      expect(isHighestPossiblePlay([twoClubs], playedCards)).toBe(true);
    });
    
    it('detects 2♦ as highest single AFTER all other 2s played', () => {
      const playedCards: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
        { id: '2C', rank: '2', suit: 'C' },
      ];
      const twoDiamonds: Card = { id: '2D', rank: '2', suit: 'D' };
      
      expect(isHighestPossiblePlay([twoDiamonds], playedCards)).toBe(true);
    });
    
    it('detects A♠ as highest AFTER all 2s played', () => {
      const playedCards: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
        { id: '2C', rank: '2', suit: 'C' },
        { id: '2D', rank: '2', suit: 'D' },
      ];
      const aceSpades: Card = { id: 'AS', rank: 'A', suit: 'S' };
      
      expect(isHighestPossiblePlay([aceSpades], playedCards)).toBe(true);
    });
  });
  
  // ============================================
  // PAIRS
  // ============================================
  
  describe('Pairs', () => {
    it('detects pair of 2s with Spades as highest when no cards played', () => {
      const playedCards: Card[] = [];
      const pair: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
      ];
      
      expect(isHighestPossiblePlay(pair, playedCards)).toBe(true);
    });
    
    it('does NOT detect pair 2♣-2♦ as highest (2♠ exists)', () => {
      const playedCards: Card[] = [];
      const pair: Card[] = [
        { id: '2C', rank: '2', suit: 'C' },
        { id: '2D', rank: '2', suit: 'D' },
      ];
      
      expect(isHighestPossiblePlay(pair, playedCards)).toBe(false);
    });
    
    it('detects pair 2♣-2♦ as highest AFTER 2♠ and 2♥ played', () => {
      const playedCards: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
      ];
      const pair: Card[] = [
        { id: '2C', rank: '2', suit: 'C' },
        { id: '2D', rank: '2', suit: 'D' },
      ];
      
      expect(isHighestPossiblePlay(pair, playedCards)).toBe(true);
    });
    
    it('CRITICAL: detects 2♣-2♦ as highest when only 2♠ played (2♥ cannot form pair alone)', () => {
      // This is the bug the user found!
      const playedCards: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
      ];
      const pair: Card[] = [
        { id: '2C', rank: '2', suit: 'C' },
        { id: '2D', rank: '2', suit: 'D' },
      ];
      
      // After playing 2♣-2♦, only 2♥ remains (cannot form a pair!)
      expect(isHighestPossiblePlay(pair, playedCards)).toBe(true);
    });
  });
  
  // ============================================
  // TRIPLES
  // ============================================
  
  describe('Triples', () => {
    it('detects triple 2s as highest when no cards played', () => {
      const playedCards: Card[] = [];
      const triple: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
        { id: '2C', rank: '2', suit: 'C' },
      ];
      
      expect(isHighestPossiblePlay(triple, playedCards)).toBe(true);
    });
    
    it('does NOT detect triple Aces as highest (triple 2s possible)', () => {
      const playedCards: Card[] = [];
      const triple: Card[] = [
        { id: 'AS', rank: 'A', suit: 'S' },
        { id: 'AH', rank: 'A', suit: 'H' },
        { id: 'AC', rank: 'A', suit: 'C' },
      ];
      
      expect(isHighestPossiblePlay(triple, playedCards)).toBe(false);
    });
    
    it('detects triple Aces as highest AFTER two 2s are played (triple 2s impossible)', () => {
      const playedCards: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },  // Now only 2 twos left, can't make triple
      ];
      const triple: Card[] = [
        { id: 'AS', rank: 'A', suit: 'S' },
        { id: 'AH', rank: 'A', suit: 'H' },
        { id: 'AC', rank: 'A', suit: 'C' },
      ];
      
      expect(isHighestPossiblePlay(triple, playedCards)).toBe(true);
    });
  });
  
  // ============================================
  // FIVE-CARD COMBOS - CRITICAL TESTS
  // ============================================
  
  describe('Five-Card Combos - Conditional Logic', () => {
    it('does NOT trigger for four of a kind if royal flush still possible', () => {
      const playedCards: Card[] = []; // No cards played yet
      const fourTwos: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
        { id: '2C', rank: '2', suit: 'C' },
        { id: '2D', rank: '2', suit: 'D' },
        { id: '3C', rank: '3', suit: 'C' },
      ];
      
      // Royal flush still possible, so four of a kind is NOT highest
      expect(isHighestPossiblePlay(fourTwos, playedCards)).toBe(false);
    });
    
    it('DOES trigger for four 2s when NO royal/straight flush possible', () => {
      // Break all 4 royal flushes with minimal cards
      const playedCards: Card[] = [
        { id: '10H', rank: '10', suit: 'H' },  // Breaks Royal Hearts
        { id: 'JC', rank: 'J', suit: 'C' },    // Breaks Royal Clubs
        { id: 'QS', rank: 'Q', suit: 'S' },    // Breaks Royal Spades
        { id: 'KD', rank: 'K', suit: 'D' },    // Breaks Royal Diamonds
        // Also need to break all other straight flushes
        { id: '9H', rank: '9', suit: 'H' },
        { id: '9C', rank: '9', suit: 'C' },
        { id: '9S', rank: '9', suit: 'S' },
        { id: '9D', rank: '9', suit: 'D' },
        { id: '8H', rank: '8', suit: 'H' },
        { id: '8C', rank: '8', suit: 'C' },
        { id: '8S', rank: '8', suit: 'S' },
        { id: '8D', rank: '8', suit: 'D' },
        { id: '7H', rank: '7', suit: 'H' },
        { id: '7C', rank: '7', suit: 'C' },
        { id: '7S', rank: '7', suit: 'S' },
        { id: '7D', rank: '7', suit: 'D' },
        { id: '6H', rank: '6', suit: 'H' },
        { id: '6C', rank: '6', suit: 'C' },
        { id: '6S', rank: '6', suit: 'S' },
        { id: '6D', rank: '6', suit: 'D' },
        { id: '5H', rank: '5', suit: 'H' },
        { id: '5C', rank: '5', suit: 'C' },
        { id: '5S', rank: '5', suit: 'S' },
        { id: '5D', rank: '5', suit: 'D' },
        { id: '4H', rank: '4', suit: 'H' },
        { id: '4C', rank: '4', suit: 'C' },
        { id: '4S', rank: '4', suit: 'S' },
        { id: '4D', rank: '4', suit: 'D' },
        { id: '3H', rank: '3', suit: 'H' },
        { id: '3S', rank: '3', suit: 'S' },
        { id: '3D', rank: '3', suit: 'D' },
        { id: 'AH', rank: 'A', suit: 'H' },
        { id: 'AC', rank: 'A', suit: 'C' },
        { id: 'AD', rank: 'A', suit: 'D' },
      ];
      
      const fourTwos: Card[] = [
        { id: '2S', rank: '2', suit: 'S' },
        { id: '2H', rank: '2', suit: 'H' },
        { id: '2C', rank: '2', suit: 'C' },
        { id: '2D', rank: '2', suit: 'D' },
        { id: '3C', rank: '3', suit: 'C' },
      ];
      
      // No straight flush possible, four of a kind IS highest
      expect(isHighestPossiblePlay(fourTwos, playedCards)).toBe(true);
    });
    
    it('triggers for royal flush when it is highest remaining straight flush', () => {
      const playedCards: Card[] = [
        // Break 3 of the 4 royal flushes
        { id: '10S', rank: '10', suit: 'S' },  // Breaks Royal Spades
        { id: 'JH', rank: 'J', suit: 'H' },    // Breaks Royal Hearts
        { id: 'QC', rank: 'Q', suit: 'C' },    // Breaks Royal Clubs
        // Royal Diamonds still possible!
      ];
      
      const royalDiamonds: Card[] = [
        { id: '10D', rank: '10', suit: 'D' },
        { id: 'JD', rank: 'J', suit: 'D' },
        { id: 'QD', rank: 'Q', suit: 'D' },
        { id: 'KD', rank: 'K', suit: 'D' },
        { id: 'AD', rank: 'A', suit: 'D' },
      ];
      
      // This is the highest remaining straight flush - should trigger!
      expect(isHighestPossiblePlay(royalDiamonds, playedCards)).toBe(true);
    });
    
    it('does NOT trigger for Royal Hearts if Royal Spades still possible', () => {
      const playedCards: Card[] = [
        // Only break some royals, leaving Royal Spades intact
        { id: 'JC', rank: 'J', suit: 'C' },   // Breaks Royal Clubs
        { id: 'JD', rank: 'J', suit: 'D' },   // Breaks Royal Diamonds
      ];
      
      // Attempt to play Royal Hearts
      const royalHearts: Card[] = [
        { id: '10H', rank: '10', suit: 'H' },
        { id: 'JH', rank: 'J', suit: 'H' },
        { id: 'QH', rank: 'Q', suit: 'H' },
        { id: 'KH', rank: 'K', suit: 'H' },
        { id: 'AH', rank: 'A', suit: 'H' },
      ];
      
      // Royal Spades is still possible (none of its cards have been played)
      // So Royal Hearts is NOT the highest possible straight flush
      expect(isHighestPossiblePlay(royalHearts, playedCards)).toBe(false);
    });
  });
  
  // ============================================
  // EDGE CASES
  // ============================================
  
  describe('Edge Cases', () => {
    it('returns false for empty cards array', () => {
      expect(isHighestPossiblePlay([], [])).toBe(false);
    });
    
    it('returns false for invalid combo length (4 cards)', () => {
      const cards: Card[] = [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '4D', rank: '4', suit: 'D' },
        { id: '5D', rank: '5', suit: 'D' },
        { id: '6D', rank: '6', suit: 'D' },
      ];
      
      expect(isHighestPossiblePlay(cards, [])).toBe(false);
    });
  });
});
