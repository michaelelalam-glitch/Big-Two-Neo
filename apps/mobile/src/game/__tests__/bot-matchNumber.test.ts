/**
 * Bot AI matchNumber tests
 * Tests for bot 3D requirement based on match number
 * Addresses Copilot PR #75 comment: Critical test coverage for Match 2+ logic
 */

import { BotAI, getBotPlay, type BotPlayOptions } from '../bot';
import type { Card, LastPlay } from '../types';

describe('Bot AI - matchNumber parameter', () => {
  const handWith3D: Card[] = [
    { id: '3D', rank: '3', suit: 'D' },
    { id: '4C', rank: '4', suit: 'C' },
    { id: '5H', rank: '5', suit: 'H' },
    { id: '6S', rank: '6', suit: 'S' },
  ];

  const handWithout3D: Card[] = [
    { id: '4C', rank: '4', suit: 'C' },
    { id: '5H', rank: '5', suit: 'H' },
    { id: '6S', rank: '6', suit: 'S' },
    { id: '7D', rank: '7', suit: 'D' },
  ];

  describe('Match 1 - Requires 3D on first play', () => {
    test('bot plays 3D when matchNumber=1 and isFirstPlayOfGame=true', () => {
      const options: BotPlayOptions = {
        hand: handWith3D,
        lastPlay: null,
        isFirstPlayOfGame: true,
        matchNumber: 1,
        playerCardCounts: [4, 13, 13, 13],
        currentPlayerIndex: 0,
        difficulty: 'medium',
      };

      const result = getBotPlay(options);
      
      expect(result.cards).not.toBeNull();
      expect(result.cards).toContain('3D');
      expect(result.reasoning).toContain('3D');
    });

    test('bot returns null when matchNumber=1, isFirstPlayOfGame=true, but no 3D in hand', () => {
      const options: BotPlayOptions = {
        hand: handWithout3D,
        lastPlay: null,
        isFirstPlayOfGame: true,
        matchNumber: 1,
        playerCardCounts: [4, 13, 13, 13],
        currentPlayerIndex: 0,
        difficulty: 'medium',
      };

      const result = getBotPlay(options);
      
      expect(result.cards).toBeNull();
      expect(result.reasoning).toContain('No 3D');
    });

    test('bot defaults to matchNumber=1 when parameter is undefined', () => {
      const options: BotPlayOptions = {
        hand: handWith3D,
        lastPlay: null,
        isFirstPlayOfGame: true,
        // matchNumber: undefined (not provided)
        playerCardCounts: [4, 13, 13, 13],
        currentPlayerIndex: 0,
        difficulty: 'medium',
      };

      const result = getBotPlay(options);
      
      // Should require 3D since matchNumber defaults to 1
      expect(result.cards).not.toBeNull();
      expect(result.cards).toContain('3D');
    });
  });

  describe('Match 2+ - Can start with any valid play', () => {
    test('bot can start Match 2 without 3D when isFirstPlayOfGame=true', () => {
      const options: BotPlayOptions = {
        hand: handWithout3D,
        lastPlay: null,
        isFirstPlayOfGame: true,
        matchNumber: 2,
        playerCardCounts: [4, 13, 13, 13],
        currentPlayerIndex: 0,
        difficulty: 'medium',
      };

      const result = getBotPlay(options);
      
      // Should play a card even without 3D
      expect(result.cards).not.toBeNull();
      expect(result.cards!.length).toBeGreaterThan(0);
      expect(result.reasoning).not.toContain('No 3D');
    });

    test('bot can start Match 3 without 3D when isFirstPlayOfGame=true', () => {
      const options: BotPlayOptions = {
        hand: handWithout3D,
        lastPlay: null,
        isFirstPlayOfGame: true,
        matchNumber: 3,
        playerCardCounts: [4, 13, 13, 13],
        currentPlayerIndex: 0,
        difficulty: 'medium',
      };

      const result = getBotPlay(options);
      
      expect(result.cards).not.toBeNull();
      expect(result.cards!.length).toBeGreaterThan(0);
      expect(result.reasoning).not.toContain('No 3D');
    });

    test('bot prefers lowest card when leading in Match 2+ (strategic play)', () => {
      const options: BotPlayOptions = {
        hand: handWithout3D,
        lastPlay: null,
        isFirstPlayOfGame: true,
        matchNumber: 2,
        playerCardCounts: [4, 13, 13, 13],
        currentPlayerIndex: 0,
        difficulty: 'medium',
      };

      const result = getBotPlay(options);
      
      expect(result.cards).not.toBeNull();
      // Should play 4C (lowest card) strategically
      expect(result.cards).toContain('4C');
      expect(result.reasoning).toContain('lowest');
    });

    test('bot with 3D in Match 2 does NOT require playing it', () => {
      const options: BotPlayOptions = {
        hand: handWith3D,
        lastPlay: null,
        isFirstPlayOfGame: true,
        matchNumber: 2,
        playerCardCounts: [4, 13, 13, 13],
        currentPlayerIndex: 0,
        difficulty: 'medium',
      };

      const result = getBotPlay(options);
      
      expect(result.cards).not.toBeNull();
      // Should play 3D as lowest card, but NOT because it's required
      // The reasoning should mention "lowest" not "3D required"
      expect(result.reasoning).not.toContain('3D');
      expect(result.reasoning).toContain('lowest');
    });
  });

  describe('Edge cases', () => {
    test('bot handles matchNumber=0 as Match 1 (defensive)', () => {
      const options: BotPlayOptions = {
        hand: handWithout3D,
        lastPlay: null,
        isFirstPlayOfGame: true,
        matchNumber: 0,
        playerCardCounts: [4, 13, 13, 13],
        currentPlayerIndex: 0,
        difficulty: 'medium',
      };

      const result = getBotPlay(options);
      
      // matchNumber || 1 means 0 is treated as falsy, defaults to 1
      // So should require 3D and return null
      expect(result.cards).toBeNull();
      expect(result.reasoning).toContain('No 3D');
    });

    test('isFirstPlayOfGame=false bypasses 3D requirement regardless of matchNumber', () => {
      const options: BotPlayOptions = {
        hand: handWithout3D,
        lastPlay: null,
        isFirstPlayOfGame: false,
        matchNumber: 1,
        playerCardCounts: [4, 13, 13, 13],
        currentPlayerIndex: 0,
        difficulty: 'medium',
      };

      const result = getBotPlay(options);
      
      // Should play normally since isFirstPlayOfGame=false
      expect(result.cards).not.toBeNull();
    });

    test('3D requirement only applies when lastPlay is null (leading)', () => {
      const lastPlay: LastPlay = {
        position: 3,
        cards: [{ id: '5C', rank: '5', suit: 'C' }],
        combo_type: 'Single',
      };

      const options: BotPlayOptions = {
        hand: handWithout3D,
        lastPlay,
        isFirstPlayOfGame: false, // Once someone plays, it's no longer first play
        matchNumber: 1,
        playerCardCounts: [4, 12, 13, 12],
        currentPlayerIndex: 0,
        difficulty: 'medium',
      };

      const result = getBotPlay(options);
      
      // Should try to beat the last play, not require 3D
      expect(result.reasoning).not.toContain('No 3D');
      // Should either beat the play or pass
      expect(result.cards !== null || (result.reasoning && result.reasoning.toLowerCase().includes('pass'))).toBe(true);
    });
  });

  describe('Integration with BotAI class', () => {
    test('BotAI.getPlay() respects matchNumber parameter', () => {
      const bot = new BotAI('medium');

      const result = bot.getPlay({
        hand: handWithout3D,
        lastPlay: null,
        isFirstPlayOfGame: true,
        matchNumber: 2,
        playerCardCounts: [4, 13, 13, 13],
        currentPlayerIndex: 0,
      });

      expect(result.cards).not.toBeNull();
      expect(result.reasoning).not.toContain('No 3D');
    });

    test('BotAI difficulty levels work correctly with matchNumber', () => {
      const difficulties: Array<'easy' | 'medium' | 'hard'> = ['easy', 'medium', 'hard'];

      difficulties.forEach((difficulty) => {
        const bot = new BotAI(difficulty);
        const result = bot.getPlay({
          hand: handWithout3D,
          lastPlay: null,
          isFirstPlayOfGame: true,
          matchNumber: 2,
          playerCardCounts: [4, 13, 13, 13],
          currentPlayerIndex: 0,
        });

        // All difficulties should allow Match 2+ starts without 3D
        expect(result.cards).not.toBeNull();
      });
    });
  });
});
