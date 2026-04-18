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
      const twoSpades: Card = { id: '2S', rank: '2' as const, suit: 'S' as const };

      expect(isHighestPossiblePlay([twoSpades], playedCards)).toBe(true);
    });

    it('does NOT detect 2♥ as highest when no cards played (2♠ is higher)', () => {
      const playedCards: Card[] = [];
      const twoHearts: Card = { id: '2H', rank: '2' as const, suit: 'H' as const };

      expect(isHighestPossiblePlay([twoHearts], playedCards)).toBe(false);
    });

    it('detects 2♥ as highest single AFTER 2♠ is played', () => {
      const playedCards: Card[] = [{ id: '2S', rank: '2' as const, suit: 'S' as const }];
      const twoHearts: Card = { id: '2H', rank: '2' as const, suit: 'H' as const };

      expect(isHighestPossiblePlay([twoHearts], playedCards)).toBe(true);
    });

    it('detects 2♣ as highest single AFTER 2♠ and 2♥ played', () => {
      const playedCards: Card[] = [
        { id: '2S', rank: '2' as const, suit: 'S' as const },
        { id: '2H', rank: '2' as const, suit: 'H' as const },
      ];
      const twoClubs: Card = { id: '2C', rank: '2' as const, suit: 'C' as const };

      expect(isHighestPossiblePlay([twoClubs], playedCards)).toBe(true);
    });

    it('detects 2♦ as highest single AFTER all other 2s played', () => {
      const playedCards: Card[] = [
        { id: '2S', rank: '2' as const, suit: 'S' as const },
        { id: '2H', rank: '2' as const, suit: 'H' as const },
        { id: '2C', rank: '2' as const, suit: 'C' as const },
      ];
      const twoDiamonds: Card = { id: '2D', rank: '2' as const, suit: 'D' as const };

      expect(isHighestPossiblePlay([twoDiamonds], playedCards)).toBe(true);
    });

    it('detects A♠ as highest AFTER all 2s played', () => {
      const playedCards: Card[] = [
        { id: '2S', rank: '2' as const, suit: 'S' as const },
        { id: '2H', rank: '2' as const, suit: 'H' as const },
        { id: '2C', rank: '2' as const, suit: 'C' as const },
        { id: '2D', rank: '2' as const, suit: 'D' as const },
      ];
      const aceSpades: Card = { id: 'AS', rank: 'A' as const, suit: 'S' as const };

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
        { id: '2S', rank: '2' as const, suit: 'S' as const },
        { id: '2H', rank: '2' as const, suit: 'H' as const },
      ];

      expect(isHighestPossiblePlay(pair, playedCards)).toBe(true);
    });

    it('does NOT detect pair 2♣-2♦ as highest (2♠ exists)', () => {
      const playedCards: Card[] = [];
      const pair: Card[] = [
        { id: '2C', rank: '2' as const, suit: 'C' as const },
        { id: '2D', rank: '2' as const, suit: 'D' as const },
      ];

      expect(isHighestPossiblePlay(pair, playedCards)).toBe(false);
    });

    it('detects pair 2♣-2♦ as highest AFTER 2♠ and 2♥ played', () => {
      const playedCards: Card[] = [
        { id: '2S', rank: '2' as const, suit: 'S' as const },
        { id: '2H', rank: '2' as const, suit: 'H' as const },
      ];
      const pair: Card[] = [
        { id: '2C', rank: '2' as const, suit: 'C' as const },
        { id: '2D', rank: '2' as const, suit: 'D' as const },
      ];

      expect(isHighestPossiblePlay(pair, playedCards)).toBe(true);
    });

    it('CRITICAL: detects 2♣-2♦ as highest when only 2♠ played (2♥ cannot form pair alone)', () => {
      // This is the bug the user found!
      const playedCards: Card[] = [{ id: '2S', rank: '2' as const, suit: 'S' as const }];
      const pair: Card[] = [
        { id: '2C', rank: '2' as const, suit: 'C' as const },
        { id: '2D', rank: '2' as const, suit: 'D' as const },
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
        { id: '2S', rank: '2' as const, suit: 'S' as const },
        { id: '2H', rank: '2' as const, suit: 'H' as const },
        { id: '2C', rank: '2' as const, suit: 'C' as const },
      ];

      expect(isHighestPossiblePlay(triple, playedCards)).toBe(true);
    });

    it('does NOT detect triple Aces as highest (triple 2s possible)', () => {
      const playedCards: Card[] = [];
      const triple: Card[] = [
        { id: 'AS', rank: 'A' as const, suit: 'S' as const },
        { id: 'AH', rank: 'A' as const, suit: 'H' as const },
        { id: 'AC', rank: 'A' as const, suit: 'C' as const },
      ];

      expect(isHighestPossiblePlay(triple, playedCards)).toBe(false);
    });

    it('detects triple Aces as highest AFTER two 2s are played (triple 2s impossible)', () => {
      const playedCards: Card[] = [
        { id: '2S', rank: '2' as const, suit: 'S' as const },
        { id: '2H', rank: '2' as const, suit: 'H' as const }, // Now only 2 twos left, can't make triple
      ];
      const triple: Card[] = [
        { id: 'AS', rank: 'A' as const, suit: 'S' as const },
        { id: 'AH', rank: 'A' as const, suit: 'H' as const },
        { id: 'AC', rank: 'A' as const, suit: 'C' as const },
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
        { id: '2S', rank: '2' as const, suit: 'S' as const },
        { id: '2H', rank: '2' as const, suit: 'H' as const },
        { id: '2C', rank: '2' as const, suit: 'C' as const },
        { id: '2D', rank: '2' as const, suit: 'D' as const },
        { id: '3C', rank: '3' as const, suit: 'C' as const },
      ];

      // Royal flush still possible, so four of a kind is NOT highest
      expect(isHighestPossiblePlay(fourTwos, playedCards)).toBe(false);
    });

    it('DOES trigger for four 2s when NO royal/straight flush possible', () => {
      // Break all 4 royal flushes with minimal cards
      const playedCards: Card[] = [
        { id: '10H', rank: '10' as const, suit: 'H' as const }, // Breaks Royal Hearts
        { id: 'JC', rank: 'J' as const, suit: 'C' as const }, // Breaks Royal Clubs
        { id: 'QS', rank: 'Q' as const, suit: 'S' as const }, // Breaks Royal Spades
        { id: 'KD', rank: 'K' as const, suit: 'D' as const }, // Breaks Royal Diamonds
        // Also need to break all other straight flushes
        { id: '9H', rank: '9' as const, suit: 'H' as const },
        { id: '9C', rank: '9' as const, suit: 'C' as const },
        { id: '9S', rank: '9' as const, suit: 'S' as const },
        { id: '9D', rank: '9' as const, suit: 'D' as const },
        { id: '8H', rank: '8' as const, suit: 'H' as const },
        { id: '8C', rank: '8' as const, suit: 'C' as const },
        { id: '8S', rank: '8' as const, suit: 'S' as const },
        { id: '8D', rank: '8' as const, suit: 'D' as const },
        { id: '7H', rank: '7' as const, suit: 'H' as const },
        { id: '7C', rank: '7' as const, suit: 'C' as const },
        { id: '7S', rank: '7' as const, suit: 'S' as const },
        { id: '7D', rank: '7' as const, suit: 'D' as const },
        { id: '6H', rank: '6' as const, suit: 'H' as const },
        { id: '6C', rank: '6' as const, suit: 'C' as const },
        { id: '6S', rank: '6' as const, suit: 'S' as const },
        { id: '6D', rank: '6' as const, suit: 'D' as const },
        { id: '5H', rank: '5' as const, suit: 'H' as const },
        { id: '5C', rank: '5' as const, suit: 'C' as const },
        { id: '5S', rank: '5' as const, suit: 'S' as const },
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '4H', rank: '4' as const, suit: 'H' as const },
        { id: '4C', rank: '4' as const, suit: 'C' as const },
        { id: '4S', rank: '4' as const, suit: 'S' as const },
        { id: '4D', rank: '4' as const, suit: 'D' as const },
        { id: '3H', rank: '3' as const, suit: 'H' as const },
        { id: '3S', rank: '3' as const, suit: 'S' as const },
        { id: '3D', rank: '3' as const, suit: 'D' as const },
        { id: 'AH', rank: 'A' as const, suit: 'H' as const },
        { id: 'AC', rank: 'A' as const, suit: 'C' as const },
        { id: 'AD', rank: 'A' as const, suit: 'D' as const },
      ];

      const fourTwos: Card[] = [
        { id: '2S', rank: '2' as const, suit: 'S' as const },
        { id: '2H', rank: '2' as const, suit: 'H' as const },
        { id: '2C', rank: '2' as const, suit: 'C' as const },
        { id: '2D', rank: '2' as const, suit: 'D' as const },
        { id: '3C', rank: '3' as const, suit: 'C' as const },
      ];

      // No straight flush possible, four of a kind IS highest
      expect(isHighestPossiblePlay(fourTwos, playedCards)).toBe(true);
    });

    it('triggers for royal flush when it is highest remaining straight flush', () => {
      const playedCards: Card[] = [
        // Break 3 of the 4 royal flushes
        { id: '10S', rank: '10' as const, suit: 'S' as const }, // Breaks Royal Spades
        { id: 'JH', rank: 'J' as const, suit: 'H' as const }, // Breaks Royal Hearts
        { id: 'QC', rank: 'Q' as const, suit: 'C' as const }, // Breaks Royal Clubs
        // Royal Diamonds still possible!
      ];

      const royalDiamonds: Card[] = [
        { id: '10D', rank: '10' as const, suit: 'D' as const },
        { id: 'JD', rank: 'J' as const, suit: 'D' as const },
        { id: 'QD', rank: 'Q' as const, suit: 'D' as const },
        { id: 'KD', rank: 'K' as const, suit: 'D' as const },
        { id: 'AD', rank: 'A' as const, suit: 'D' as const },
      ];

      // This is the highest remaining straight flush - should trigger!
      expect(isHighestPossiblePlay(royalDiamonds, playedCards)).toBe(true);
    });

    it('does NOT trigger for Royal Hearts if Royal Spades still possible', () => {
      const playedCards: Card[] = [
        // Only break some royals, leaving Royal Spades intact
        { id: 'JC', rank: 'J' as const, suit: 'C' as const }, // Breaks Royal Clubs
        { id: 'JD', rank: 'J' as const, suit: 'D' as const }, // Breaks Royal Diamonds
      ];

      // Attempt to play Royal Hearts
      const royalHearts: Card[] = [
        { id: '10H', rank: '10' as const, suit: 'H' as const },
        { id: 'JH', rank: 'J' as const, suit: 'H' as const },
        { id: 'QH', rank: 'Q' as const, suit: 'H' as const },
        { id: 'KH', rank: 'K' as const, suit: 'H' as const },
        { id: 'AH', rank: 'A' as const, suit: 'H' as const },
      ];

      // Royal Spades is still possible (none of its cards have been played)
      // So Royal Hearts is NOT the highest possible straight flush
      expect(isHighestPossiblePlay(royalHearts, playedCards)).toBe(false);
    });

    it('does NOT detect non-royal straight flush as highest when higher sequence in another suit exists', () => {
      // 3-4-5-6-7♠ is NOT highest because 4-5-6-7-8♥ (a higher sequence in Hearts) is still possible
      const playedCards: Card[] = [];
      const lowStraightFlush: Card[] = [
        { id: '3S', rank: '3' as const, suit: 'S' as const },
        { id: '4S', rank: '4' as const, suit: 'S' as const },
        { id: '5S', rank: '5' as const, suit: 'S' as const },
        { id: '6S', rank: '6' as const, suit: 'S' as const },
        { id: '7S', rank: '7' as const, suit: 'S' as const },
      ];

      expect(isHighestPossiblePlay(lowStraightFlush, playedCards)).toBe(false);
    });

    it('detects non-royal straight flush as highest when all higher cross-suit sequences are broken', () => {
      // 5-6-7-8-9♦ should be highest if all stronger straight flushes are broken
      // by having at least one card from each broken (played cards remove key cards)
      const playedCards: Card[] = [
        // Break all higher straight flushes in ALL suits:
        // 6-10 range: played 10D, 10C, 10H, 10S → breaks 6-7-8-9-10 in every suit
        { id: '10D', rank: '10' as const, suit: 'D' as const },
        { id: '10C', rank: '10' as const, suit: 'C' as const },
        { id: '10H', rank: '10' as const, suit: 'H' as const },
        { id: '10S', rank: '10' as const, suit: 'S' as const },
        // Break JD→ breaks 7-J, 8-Q, 9-K, 10-A in Diamonds (but not other suits)
        // We actually need to break ALL straight flushes that beat 5-6-7-8-9♦
        // Those are: any SF with higher top card, OR same top card but higher suit (impossible, ♦ is lowest)
        // Higher sequences: 6-7-8-9-10 (any suit), 7-8-9-10-J (any suit), etc.
        // Since all 10s are played → 6-7-8-9-10 is broken in ALL suits ✓
        // Need to break 7-8-9-10-J in all suits (10 is gone for all → already broken) ✓
        // All sequences needing 10 are broken. But 9-10-J-Q-K also needs 10 → broken ✓
        // 10-J-Q-K-A also needs 10 → broken ✓
        // So remaining threats: sequences NOT containing 10, which are:
        // 5-6-7-8-9 in C, H, S (same sequence, higher suits than ♦)
        { id: '9C', rank: '9' as const, suit: 'C' as const }, // Breaks 5-6-7-8-9♣
        { id: '9H', rank: '9' as const, suit: 'H' as const }, // Breaks 5-6-7-8-9♥
        { id: '9S', rank: '9' as const, suit: 'S' as const }, // Breaks 5-6-7-8-9♠
      ];

      const straightFlush: Card[] = [
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '6D', rank: '6' as const, suit: 'D' as const },
        { id: '7D', rank: '7' as const, suit: 'D' as const },
        { id: '8D', rank: '8' as const, suit: 'D' as const },
        { id: '9D', rank: '9' as const, suit: 'D' as const },
      ];

      expect(isHighestPossiblePlay(straightFlush, playedCards)).toBe(true);
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
        { id: '3D', rank: '3' as const, suit: 'D' as const },
        { id: '4D', rank: '4' as const, suit: 'D' as const },
        { id: '5D', rank: '5' as const, suit: 'D' as const },
        { id: '6D', rank: '6' as const, suit: 'D' as const },
      ];

      expect(isHighestPossiblePlay(cards, [])).toBe(false);
    });

    it('cross-suit straight flush: cards from different suits are NOT a straight flush', () => {
      // Play 5 consecutive ranks but from mixed suits — NOT a straight flush.
      // Should not trigger highest-play detection for Straight Flush.
      const mixedSuits: Card[] = [
        { id: '10S', rank: '10' as const, suit: 'S' as const },
        { id: 'JH', rank: 'J' as const, suit: 'H' as const },
        { id: 'QS', rank: 'Q' as const, suit: 'S' as const },
        { id: 'KH', rank: 'K' as const, suit: 'H' as const },
        { id: 'AS', rank: 'A' as const, suit: 'S' as const },
      ];

      // No cards played — all straight flushes remain possible,
      // so this mixed-suit straight is NOT the highest play.
      expect(isHighestPossiblePlay(mixedSuits, [])).toBe(false);
    });

    it('cross-suit straight flush: same-suit run IS detected after higher SFs are eliminated', () => {
      // Eliminate Spades Royal (highest SF) by playing a key Spade card.
      // In Stephanos suit ranking: Spades > Hearts > Clubs > Diamonds,
      // so Hearts Royal becomes the highest remaining SF.
      const playedCards: Card[] = [
        // Break Spades straights
        { id: '3S', rank: '3' as const, suit: 'S' as const },
        { id: '6S', rank: '6' as const, suit: 'S' as const },
        { id: '9S', rank: '9' as const, suit: 'S' as const },
        { id: 'QS', rank: 'Q' as const, suit: 'S' as const },
      ];

      const heartsRoyal: Card[] = [
        { id: '10H', rank: '10' as const, suit: 'H' as const },
        { id: 'JH', rank: 'J' as const, suit: 'H' as const },
        { id: 'QH', rank: 'Q' as const, suit: 'H' as const },
        { id: 'KH', rank: 'K' as const, suit: 'H' as const },
        { id: 'AH', rank: 'A' as const, suit: 'H' as const },
      ];

      // Spades Royal is broken (QS played). Hearts > Clubs > Diamonds in suit
      // ranking, so Hearts Royal IS the highest remaining straight flush.
      expect(isHighestPossiblePlay(heartsRoyal, playedCards)).toBe(true);
    });
  });

  // ============================================
  // STRAIGHT LOW-SEQUENCE SUIT TIEBREAK
  // Verifies the fix that uses the sequence's defined top rank (e.g. '5' for
  // A-2-3-4-5, '6' for 2-3-4-5-6) instead of sortHand's last card (which
  // puts the 2 last due to Stephanos rank values, giving the wrong suit).
  //
  // Each test leaves exactly 5 remaining cards — one per sequence rank —
  // that cannot form any Straight Flush, Flush, Four of a Kind, or Full House.
  // All other cards are in playedCards so only a plain Straight is possible.
  // ============================================

  describe('Straight low-sequence suit tiebreak', () => {
    // ── A-2-3-4-5 scenarios ────────────────────────────────────────────────
    // hand = [A♦, 2♣, 3♦, 4♦, 5♠]
    // intended remaining = [A♥, 2♠, 3♥, 4♥, 5♥]
    //   → 4 hearts max (A♥, 3♥, 4♥, 5♥) — not enough for a flush/SF.
    //   → only remaining 5 is 5♥ (suit H = 2), below 5♠ (suit S = 3).
    //   → all higher straight sequences need a 6+ which is not in remaining.
    // playedCards = full deck − hand − remaining (42 cards)
    const aceLowHand: Card[] = [
      { id: 'AD', rank: 'A' as const, suit: 'D' as const },
      { id: '2C', rank: '2' as const, suit: 'C' as const },
      { id: '3D', rank: '3' as const, suit: 'D' as const },
      { id: '4D', rank: '4' as const, suit: 'D' as const },
      { id: '5S', rank: '5' as const, suit: 'S' as const },
    ];
    const aceLowHandLowerSuit: Card[] = [
      { id: 'AD', rank: 'A' as const, suit: 'D' as const },
      { id: '2C', rank: '2' as const, suit: 'C' as const },
      { id: '3D', rank: '3' as const, suit: 'D' as const },
      { id: '4D', rank: '4' as const, suit: 'D' as const },
      { id: '5H', rank: '5' as const, suit: 'H' as const },
    ];
    // Scenario 1: 5♠ in hand; only 5♥ remains → 5♠ wins tiebreak
    const aceLowPlayed: Card[] = [
      { id: 'AS', rank: 'A' as const, suit: 'S' as const },
      { id: 'AC', rank: 'A' as const, suit: 'C' as const },
      { id: '2H', rank: '2' as const, suit: 'H' as const },
      { id: '2D', rank: '2' as const, suit: 'D' as const },
      { id: '3S', rank: '3' as const, suit: 'S' as const },
      { id: '3C', rank: '3' as const, suit: 'C' as const },
      { id: '4S', rank: '4' as const, suit: 'S' as const },
      { id: '4C', rank: '4' as const, suit: 'C' as const },
      { id: '5C', rank: '5' as const, suit: 'C' as const },
      { id: '5D', rank: '5' as const, suit: 'D' as const },
      { id: '6S', rank: '6' as const, suit: 'S' as const },
      { id: '6H', rank: '6' as const, suit: 'H' as const },
      { id: '6C', rank: '6' as const, suit: 'C' as const },
      { id: '6D', rank: '6' as const, suit: 'D' as const },
      { id: '7S', rank: '7' as const, suit: 'S' as const },
      { id: '7H', rank: '7' as const, suit: 'H' as const },
      { id: '7C', rank: '7' as const, suit: 'C' as const },
      { id: '7D', rank: '7' as const, suit: 'D' as const },
      { id: '8S', rank: '8' as const, suit: 'S' as const },
      { id: '8H', rank: '8' as const, suit: 'H' as const },
      { id: '8C', rank: '8' as const, suit: 'C' as const },
      { id: '8D', rank: '8' as const, suit: 'D' as const },
      { id: '9S', rank: '9' as const, suit: 'S' as const },
      { id: '9H', rank: '9' as const, suit: 'H' as const },
      { id: '9C', rank: '9' as const, suit: 'C' as const },
      { id: '9D', rank: '9' as const, suit: 'D' as const },
      { id: '10S', rank: '10' as const, suit: 'S' as const },
      { id: '10H', rank: '10' as const, suit: 'H' as const },
      { id: '10C', rank: '10' as const, suit: 'C' as const },
      { id: '10D', rank: '10' as const, suit: 'D' as const },
      { id: 'JS', rank: 'J' as const, suit: 'S' as const },
      { id: 'JH', rank: 'J' as const, suit: 'H' as const },
      { id: 'JC', rank: 'J' as const, suit: 'C' as const },
      { id: 'JD', rank: 'J' as const, suit: 'D' as const },
      { id: 'QS', rank: 'Q' as const, suit: 'S' as const },
      { id: 'QH', rank: 'Q' as const, suit: 'H' as const },
      { id: 'QC', rank: 'Q' as const, suit: 'C' as const },
      { id: 'QD', rank: 'Q' as const, suit: 'D' as const },
      { id: 'KS', rank: 'K' as const, suit: 'S' as const },
      { id: 'KH', rank: 'K' as const, suit: 'H' as const },
      { id: 'KC', rank: 'K' as const, suit: 'C' as const },
      { id: 'KD', rank: 'K' as const, suit: 'D' as const },
    ];
    // Scenario 2: 5♥ in hand; 5♠ remains → 5♠ beats 5♥, so false
    // playedCards: same as Scenario 1 except swap 5C/5D for 5C/5S...
    // Actually use a separate array: remaining = [AC, 2S, 3C, 4C, 5S]
    const aceLowPlayedLowerSuit: Card[] = [
      { id: 'AS', rank: 'A' as const, suit: 'S' as const },
      { id: 'AH', rank: 'A' as const, suit: 'H' as const },
      { id: '2H', rank: '2' as const, suit: 'H' as const },
      { id: '2D', rank: '2' as const, suit: 'D' as const },
      { id: '3S', rank: '3' as const, suit: 'S' as const },
      { id: '3H', rank: '3' as const, suit: 'H' as const },
      { id: '4S', rank: '4' as const, suit: 'S' as const },
      { id: '4H', rank: '4' as const, suit: 'H' as const },
      { id: '5C', rank: '5' as const, suit: 'C' as const },
      { id: '5D', rank: '5' as const, suit: 'D' as const },
      { id: '6S', rank: '6' as const, suit: 'S' as const },
      { id: '6H', rank: '6' as const, suit: 'H' as const },
      { id: '6C', rank: '6' as const, suit: 'C' as const },
      { id: '6D', rank: '6' as const, suit: 'D' as const },
      { id: '7S', rank: '7' as const, suit: 'S' as const },
      { id: '7H', rank: '7' as const, suit: 'H' as const },
      { id: '7C', rank: '7' as const, suit: 'C' as const },
      { id: '7D', rank: '7' as const, suit: 'D' as const },
      { id: '8S', rank: '8' as const, suit: 'S' as const },
      { id: '8H', rank: '8' as const, suit: 'H' as const },
      { id: '8C', rank: '8' as const, suit: 'C' as const },
      { id: '8D', rank: '8' as const, suit: 'D' as const },
      { id: '9S', rank: '9' as const, suit: 'S' as const },
      { id: '9H', rank: '9' as const, suit: 'H' as const },
      { id: '9C', rank: '9' as const, suit: 'C' as const },
      { id: '9D', rank: '9' as const, suit: 'D' as const },
      { id: '10S', rank: '10' as const, suit: 'S' as const },
      { id: '10H', rank: '10' as const, suit: 'H' as const },
      { id: '10C', rank: '10' as const, suit: 'C' as const },
      { id: '10D', rank: '10' as const, suit: 'D' as const },
      { id: 'JS', rank: 'J' as const, suit: 'S' as const },
      { id: 'JH', rank: 'J' as const, suit: 'H' as const },
      { id: 'JC', rank: 'J' as const, suit: 'C' as const },
      { id: 'JD', rank: 'J' as const, suit: 'D' as const },
      { id: 'QS', rank: 'Q' as const, suit: 'S' as const },
      { id: 'QH', rank: 'Q' as const, suit: 'H' as const },
      { id: 'QC', rank: 'Q' as const, suit: 'C' as const },
      { id: 'QD', rank: 'Q' as const, suit: 'D' as const },
      { id: 'KS', rank: 'K' as const, suit: 'S' as const },
      { id: 'KH', rank: 'K' as const, suit: 'H' as const },
      { id: 'KC', rank: 'K' as const, suit: 'C' as const },
      { id: 'KD', rank: 'K' as const, suit: 'D' as const },
    ];

    it('A-2-3-4-5 with 5♠ (highest suit) is the highest remaining 5-high straight', () => {
      // Remaining after removing hand+playedCards: {AH, 2S, 3H, 4H, 5H}.
      // The only remaining 5 is 5♥ (suit value 2). Our 5♠ (suit value 3) wins.
      expect(isHighestPossiblePlay(aceLowHand, aceLowPlayed)).toBe(true);
    });

    it('A-2-3-4-5 with 5♥ is NOT the highest 5-high straight when 5♠ is still unplayed', () => {
      // Remaining: {AC, 2S, 3C, 4C, 5S}. The remaining 5 is 5♠ (suit value 3).
      // Our 5♥ (suit value 2) loses the tiebreak → not highest.
      expect(isHighestPossiblePlay(aceLowHandLowerSuit, aceLowPlayedLowerSuit)).toBe(false);
    });

    // ── 2-3-4-5-6 scenarios ────────────────────────────────────────────────
    // hand = [2♦, 3♦, 4♦, 5♦, 6♠]
    // intended remaining = [2♥, 3♥, 4♠, 5♥, 6♥]
    //   → only remaining 6 is 6♥ (suit H = 2), below 6♠ (suit S = 3).
    //   → all higher sequences need a 7+ which is not in remaining.
    const twoLowHand: Card[] = [
      { id: '2D', rank: '2' as const, suit: 'D' as const },
      { id: '3D', rank: '3' as const, suit: 'D' as const },
      { id: '4D', rank: '4' as const, suit: 'D' as const },
      { id: '5D', rank: '5' as const, suit: 'D' as const },
      { id: '6S', rank: '6' as const, suit: 'S' as const },
    ];
    const twoLowHandLowerSuit: Card[] = [
      { id: '2C', rank: '2' as const, suit: 'C' as const },
      { id: '3C', rank: '3' as const, suit: 'C' as const },
      { id: '4C', rank: '4' as const, suit: 'C' as const },
      { id: '5C', rank: '5' as const, suit: 'C' as const },
      { id: '6D', rank: '6' as const, suit: 'D' as const },
    ];
    // Scenario 3: 6♠ in hand; remaining 6 is 6♥ → 6♠ wins
    const twoLowPlayed: Card[] = [
      { id: 'AS', rank: 'A' as const, suit: 'S' as const },
      { id: 'AH', rank: 'A' as const, suit: 'H' as const },
      { id: 'AC', rank: 'A' as const, suit: 'C' as const },
      { id: 'AD', rank: 'A' as const, suit: 'D' as const },
      { id: '2S', rank: '2' as const, suit: 'S' as const },
      { id: '2C', rank: '2' as const, suit: 'C' as const },
      { id: '3S', rank: '3' as const, suit: 'S' as const },
      { id: '3C', rank: '3' as const, suit: 'C' as const },
      { id: '4H', rank: '4' as const, suit: 'H' as const },
      { id: '4C', rank: '4' as const, suit: 'C' as const },
      { id: '5S', rank: '5' as const, suit: 'S' as const },
      { id: '5C', rank: '5' as const, suit: 'C' as const },
      { id: '6C', rank: '6' as const, suit: 'C' as const },
      { id: '6D', rank: '6' as const, suit: 'D' as const },
      { id: '7S', rank: '7' as const, suit: 'S' as const },
      { id: '7H', rank: '7' as const, suit: 'H' as const },
      { id: '7C', rank: '7' as const, suit: 'C' as const },
      { id: '7D', rank: '7' as const, suit: 'D' as const },
      { id: '8S', rank: '8' as const, suit: 'S' as const },
      { id: '8H', rank: '8' as const, suit: 'H' as const },
      { id: '8C', rank: '8' as const, suit: 'C' as const },
      { id: '8D', rank: '8' as const, suit: 'D' as const },
      { id: '9S', rank: '9' as const, suit: 'S' as const },
      { id: '9H', rank: '9' as const, suit: 'H' as const },
      { id: '9C', rank: '9' as const, suit: 'C' as const },
      { id: '9D', rank: '9' as const, suit: 'D' as const },
      { id: '10S', rank: '10' as const, suit: 'S' as const },
      { id: '10H', rank: '10' as const, suit: 'H' as const },
      { id: '10C', rank: '10' as const, suit: 'C' as const },
      { id: '10D', rank: '10' as const, suit: 'D' as const },
      { id: 'JS', rank: 'J' as const, suit: 'S' as const },
      { id: 'JH', rank: 'J' as const, suit: 'H' as const },
      { id: 'JC', rank: 'J' as const, suit: 'C' as const },
      { id: 'JD', rank: 'J' as const, suit: 'D' as const },
      { id: 'QS', rank: 'Q' as const, suit: 'S' as const },
      { id: 'QH', rank: 'Q' as const, suit: 'H' as const },
      { id: 'QC', rank: 'Q' as const, suit: 'C' as const },
      { id: 'QD', rank: 'Q' as const, suit: 'D' as const },
      { id: 'KS', rank: 'K' as const, suit: 'S' as const },
      { id: 'KH', rank: 'K' as const, suit: 'H' as const },
      { id: 'KC', rank: 'K' as const, suit: 'C' as const },
      { id: 'KD', rank: 'K' as const, suit: 'D' as const },
    ];
    // Scenario 4: 6♦ in hand; 6♠ remains → 6♠ beats 6♦, so false
    // hand = [2C, 3C, 4C, 5C, 6D]; remaining = [2H, 3H, 4S, 5H, 6S]
    const twoLowPlayedLowerSuit: Card[] = [
      { id: 'AS', rank: 'A' as const, suit: 'S' as const },
      { id: 'AH', rank: 'A' as const, suit: 'H' as const },
      { id: 'AC', rank: 'A' as const, suit: 'C' as const },
      { id: 'AD', rank: 'A' as const, suit: 'D' as const },
      { id: '2S', rank: '2' as const, suit: 'S' as const },
      { id: '2D', rank: '2' as const, suit: 'D' as const },
      { id: '3S', rank: '3' as const, suit: 'S' as const },
      { id: '3D', rank: '3' as const, suit: 'D' as const },
      { id: '4H', rank: '4' as const, suit: 'H' as const },
      { id: '4D', rank: '4' as const, suit: 'D' as const },
      { id: '5S', rank: '5' as const, suit: 'S' as const },
      { id: '5D', rank: '5' as const, suit: 'D' as const },
      { id: '6C', rank: '6' as const, suit: 'C' as const },
      { id: '6H', rank: '6' as const, suit: 'H' as const },
      { id: '7S', rank: '7' as const, suit: 'S' as const },
      { id: '7H', rank: '7' as const, suit: 'H' as const },
      { id: '7C', rank: '7' as const, suit: 'C' as const },
      { id: '7D', rank: '7' as const, suit: 'D' as const },
      { id: '8S', rank: '8' as const, suit: 'S' as const },
      { id: '8H', rank: '8' as const, suit: 'H' as const },
      { id: '8C', rank: '8' as const, suit: 'C' as const },
      { id: '8D', rank: '8' as const, suit: 'D' as const },
      { id: '9S', rank: '9' as const, suit: 'S' as const },
      { id: '9H', rank: '9' as const, suit: 'H' as const },
      { id: '9C', rank: '9' as const, suit: 'C' as const },
      { id: '9D', rank: '9' as const, suit: 'D' as const },
      { id: '10S', rank: '10' as const, suit: 'S' as const },
      { id: '10H', rank: '10' as const, suit: 'H' as const },
      { id: '10C', rank: '10' as const, suit: 'C' as const },
      { id: '10D', rank: '10' as const, suit: 'D' as const },
      { id: 'JS', rank: 'J' as const, suit: 'S' as const },
      { id: 'JH', rank: 'J' as const, suit: 'H' as const },
      { id: 'JC', rank: 'J' as const, suit: 'C' as const },
      { id: 'JD', rank: 'J' as const, suit: 'D' as const },
      { id: 'QS', rank: 'Q' as const, suit: 'S' as const },
      { id: 'QH', rank: 'Q' as const, suit: 'H' as const },
      { id: 'QC', rank: 'Q' as const, suit: 'C' as const },
      { id: 'QD', rank: 'Q' as const, suit: 'D' as const },
      { id: 'KS', rank: 'K' as const, suit: 'S' as const },
      { id: 'KH', rank: 'K' as const, suit: 'H' as const },
      { id: 'KC', rank: 'K' as const, suit: 'C' as const },
      { id: 'KD', rank: 'K' as const, suit: 'D' as const },
    ];

    it('2-3-4-5-6 with 6♠ (highest suit) is the highest remaining 6-high straight', () => {
      // Remaining after removing hand+playedCards: {2H, 3H, 4S, 5H, 6H}.
      // Only remaining 6 is 6♥ (suit value 2). Our 6♠ (suit value 3) wins.
      expect(isHighestPossiblePlay(twoLowHand, twoLowPlayed)).toBe(true);
    });

    it('2-3-4-5-6 with 6♦ is NOT the highest 6-high straight when 6♠ is still unplayed', () => {
      // Remaining: {2H, 3H, 4S, 5H, 6S}. The remaining 6 is 6♠ (suit value 3).
      // Our 6♦ (suit value 0) loses the tiebreak → not highest.
      expect(isHighestPossiblePlay(twoLowHandLowerSuit, twoLowPlayedLowerSuit)).toBe(false);
    });
  });
});
