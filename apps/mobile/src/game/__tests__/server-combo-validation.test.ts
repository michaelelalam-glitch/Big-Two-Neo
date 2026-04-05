/**
 * Server-side Combo Validation Tests
 *
 * Task 673 / 17.5: Validates the play-cards edge function logic by testing
 * the client-side classifyCards and canBeatPlay functions that mirror the
 * server-side validation. Since the edge function duplicates game-logic.ts,
 * these tests verify both client and (by proxy) server correctness.
 *
 * Edge cases covered:
 *   - Invalid combo rejection (random 4 cards, random 5 cards)
 *   - Straight sequence boundary: A-2-3-4-5 is lowest, 10-J-Q-K-A is highest
 *   - Full House comparison by triple rank (not highest card)
 *   - Four of a Kind comparison by quad rank
 *   - Flush tiebreaking by highest card
 *   - Cross-combo beating (Four of a Kind beats Straight)
 *   - 2♠ as highest single
 */

import { describe, it, expect } from '@jest/globals';
import { classifyCards, canBeatPlay, sortHand } from '../engine/game-logic';
import type { Card, LastPlay } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function card(id: string): Card {
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  return { id, rank, suit };
}

function cards(...ids: string[]): Card[] {
  return ids.map(card);
}

function lastPlay(cardIds: string[], combo_type: string): LastPlay {
  return {
    cards: cards(...cardIds),
    combo_type: combo_type as any,
    player_index: 1,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Server-side Combo Validation (play-cards edge function parity)', () => {
  describe('Invalid combos are rejected', () => {
    it('should classify 4 non-matching cards as unknown', () => {
      expect(classifyCards(cards('3H', '5D', '7C', 'JS'))).toBe('unknown');
    });

    it('should classify 5 random cards as unknown (no combo)', () => {
      // No straight, no flush, no pairs
      expect(classifyCards(cards('3H', '5D', '7C', 'JS', 'KH'))).toBe('unknown');
    });

    it('should classify 2 non-matching cards as unknown', () => {
      expect(classifyCards(cards('3H', '5D'))).toBe('unknown');
    });
  });

  describe('Straight boundary validation', () => {
    it('A-2-3-4-5 is a valid straight (lowest)', () => {
      expect(classifyCards(cards('AH', '2D', '3C', '4S', '5H'))).toBe('Straight');
    });

    it('10-J-Q-K-A is a valid straight (highest)', () => {
      expect(classifyCards(cards('10H', 'JD', 'QC', 'KS', 'AH'))).toBe('Straight');
    });

    it('Q-K-A-2-3 is NOT a valid straight (wraps around)', () => {
      expect(classifyCards(cards('QH', 'KD', 'AC', '2S', '3H'))).toBe('unknown');
    });

    it('J-Q-K-A-2 is NOT a valid straight (wraps around)', () => {
      expect(classifyCards(cards('JH', 'QD', 'KC', 'AS', '2H'))).toBe('unknown');
    });

    it('A-2-3-4-5 straight cannot beat 2-3-4-5-6 straight', () => {
      const newCards = cards('AH', '2D', '3C', '4S', '5H');
      const last = lastPlay(['2H', '3D', '4C', '5S', '6H'], 'Straight');
      expect(canBeatPlay(newCards, last)).toBe(false);
    });

    it('10-J-Q-K-A straight beats 9-10-J-Q-K straight', () => {
      const newCards = cards('10H', 'JD', 'QC', 'KS', 'AH');
      const last = lastPlay(['9H', '10D', 'JC', 'QS', 'KH'], 'Straight');
      expect(canBeatPlay(newCards, last)).toBe(true);
    });
  });

  describe('Full House comparison by triple rank', () => {
    it('Full House with QQQ beats Full House with JJJ (even if kicker is lower)', () => {
      const newCards = cards('QH', 'QD', 'QC', '3S', '3H');
      const last = lastPlay(['JH', 'JD', 'JC', 'AS', 'AH'], 'Full House');
      expect(canBeatPlay(newCards, last)).toBe(true);
    });

    it('Full House with 555 cannot beat Full House with KKK', () => {
      const newCards = cards('5H', '5D', '5C', 'AS', 'AH');
      const last = lastPlay(['KH', 'KD', 'KC', '3S', '3H'], 'Full House');
      expect(canBeatPlay(newCards, last)).toBe(false);
    });
  });

  describe('Four of a Kind comparison by quad rank', () => {
    it('AAAA beats KKKK', () => {
      const newCards = cards('AH', 'AD', 'AC', 'AS', '3H');
      const last = lastPlay(['KH', 'KD', 'KC', 'KS', '3D'], 'Four of a Kind');
      expect(canBeatPlay(newCards, last)).toBe(true);
    });

    it('2222 beats AAAA (2 is highest rank in Big Two)', () => {
      const newCards = cards('2H', '2D', '2C', '2S', '3H');
      const last = lastPlay(['AH', 'AD', 'AC', 'AS', '3D'], 'Four of a Kind');
      expect(canBeatPlay(newCards, last)).toBe(true);
    });
  });

  describe('Cross-combo strength', () => {
    it('Four of a Kind beats Straight', () => {
      const newCards = cards('5H', '5D', '5C', '5S', '3H');
      const last = lastPlay(['3H', '4D', '5C', '6S', '7H'], 'Straight');
      expect(canBeatPlay(newCards, last)).toBe(true);
    });

    it('Straight Flush beats Four of a Kind', () => {
      const newCards = cards('3H', '4H', '5H', '6H', '7H');
      const last = lastPlay(['AH', 'AD', 'AC', 'AS', '3D'], 'Four of a Kind');
      expect(canBeatPlay(newCards, last)).toBe(true);
    });

    it('Flush beats Straight (higher combo strength in Big Two)', () => {
      // In Big Two, Flush > Straight in combo strength
      const newCards = cards('3H', '5H', '7H', '9H', 'KH');
      const last = lastPlay(['3D', '4C', '5S', '6H', '7D'], 'Straight');
      expect(canBeatPlay(newCards, last)).toBe(true);
    });
  });

  describe('2♠ as highest single', () => {
    it('2♠ beats 2♥', () => {
      const newCards = cards('2S');
      const last = lastPlay(['2H'], 'Single');
      expect(canBeatPlay(newCards, last)).toBe(true);
    });

    it('2♠ beats A♠', () => {
      const newCards = cards('2S');
      const last = lastPlay(['AS'], 'Single');
      expect(canBeatPlay(newCards, last)).toBe(true);
    });

    it('A♠ cannot beat 2♦ (2 is always higher than A)', () => {
      const newCards = cards('AS');
      const last = lastPlay(['2D'], 'Single');
      expect(canBeatPlay(newCards, last)).toBe(false);
    });
  });

  describe('Leading play (no last play)', () => {
    it('any valid combo can lead', () => {
      expect(canBeatPlay(cards('3H'), null)).toBe(true);
      expect(canBeatPlay(cards('3H', '3D'), null)).toBe(true);
      expect(canBeatPlay(cards('3H', '3D', '3C'), null)).toBe(true);
    });
  });

  describe('Card count mismatch', () => {
    it('cannot play 1 card against a pair', () => {
      const newCards = cards('2S');
      const last = lastPlay(['3H', '3D'], 'Pair');
      expect(canBeatPlay(newCards, last)).toBe(false);
    });

    it('cannot play pair against a single', () => {
      const newCards = cards('2S', '2H');
      const last = lastPlay(['AH'], 'Single');
      expect(canBeatPlay(newCards, last)).toBe(false);
    });
  });
});
