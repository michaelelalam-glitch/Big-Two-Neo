/**
 * Core game logic tests
 * Tests for card sorting, classification, and validation
 */

import {
  sortHand,
  classifyCards,
  classifyAndSortCards,
  canBeatPlay,
  findRecommendedPlay,
  isStraight,
} from '../engine/game-logic';
import type { Card, LastPlay } from '../types';

describe('Game Logic - Card Sorting', () => {
  test('sortHand sorts cards by rank then suit', () => {
    const cards: Card[] = [
      { id: '2S', rank: '2', suit: 'S' },
      { id: '3D', rank: '3', suit: 'D' },
      { id: 'AH', rank: 'A', suit: 'H' },
      { id: '3C', rank: '3', suit: 'C' },
    ];

    const sorted = sortHand(cards);
    expect(sorted[0].id).toBe('3D'); // Lowest rank, lowest suit
    expect(sorted[1].id).toBe('3C');
    expect(sorted[2].id).toBe('AH');
    expect(sorted[3].id).toBe('2S'); // Highest rank, highest suit
  });

  test('sortHand does not mutate original array', () => {
    const cards: Card[] = [
      { id: '2S', rank: '2', suit: 'S' },
      { id: '3D', rank: '3', suit: 'D' },
    ];
    const original = [...cards];

    sortHand(cards);
    expect(cards).toEqual(original);
  });
});

describe('Game Logic - Card Classification', () => {
  test('classifyCards recognizes Single', () => {
    const cards: Card[] = [{ id: '3D', rank: '3', suit: 'D' }];
    expect(classifyCards(cards)).toBe('Single');
  });

  test('classifyCards recognizes Pair', () => {
    const cards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '3C', rank: '3', suit: 'C' },
    ];
    expect(classifyCards(cards)).toBe('Pair');
  });

  test('classifyCards recognizes Triple', () => {
    const cards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '3C', rank: '3', suit: 'C' },
      { id: '3H', rank: '3', suit: 'H' },
    ];
    expect(classifyCards(cards)).toBe('Triple');
  });

  test('classifyCards recognizes Straight', () => {
    const cards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
      { id: '5H', rank: '5', suit: 'H' },
      { id: '6S', rank: '6', suit: 'S' },
      { id: '7D', rank: '7', suit: 'D' },
    ];
    expect(classifyCards(cards)).toBe('Straight');
  });

  test('classifyCards recognizes Flush', () => {
    const cards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '5D', rank: '5', suit: 'D' },
      { id: '7D', rank: '7', suit: 'D' },
      { id: '9D', rank: '9', suit: 'D' },
      { id: 'JD', rank: 'J', suit: 'D' },
    ];
    expect(classifyCards(cards)).toBe('Flush');
  });

  test('classifyCards recognizes Full House', () => {
    const cards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '3C', rank: '3', suit: 'C' },
      { id: '3H', rank: '3', suit: 'H' },
      { id: '4S', rank: '4', suit: 'S' },
      { id: '4D', rank: '4', suit: 'D' },
    ];
    expect(classifyCards(cards)).toBe('Full House');
  });

  test('classifyCards recognizes Four of a Kind', () => {
    const cards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '3C', rank: '3', suit: 'C' },
      { id: '3H', rank: '3', suit: 'H' },
      { id: '3S', rank: '3', suit: 'S' },
      { id: '4D', rank: '4', suit: 'D' },
    ];
    expect(classifyCards(cards)).toBe('Four of a Kind');
  });

  test('classifyCards recognizes Straight Flush', () => {
    const cards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '4D', rank: '4', suit: 'D' },
      { id: '5D', rank: '5', suit: 'D' },
      { id: '6D', rank: '6', suit: 'D' },
      { id: '7D', rank: '7', suit: 'D' },
    ];
    expect(classifyCards(cards)).toBe('Straight Flush');
  });

  test('classifyCards returns unknown for invalid combinations', () => {
    const cards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '5C', rank: '5', suit: 'C' },
    ];
    expect(classifyCards(cards)).toBe('unknown');
  });

  test('classifyCards handles empty array', () => {
    expect(classifyCards([])).toBe('unknown');
  });
});

describe('Game Logic - Straight Detection', () => {
  test('isStraight recognizes valid straight', () => {
    const cards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
      { id: '5H', rank: '5', suit: 'H' },
      { id: '6S', rank: '6', suit: 'S' },
      { id: '7D', rank: '7', suit: 'D' },
    ];
    const result = isStraight(cards);
    expect(result.valid).toBe(true);
    expect(result.sequence).toBe('34567');
  });

  test('isStraight recognizes A-high straight (10-J-Q-K-A)', () => {
    const cards: Card[] = [
      { id: '10D', rank: '10', suit: 'D' },
      { id: 'JC', rank: 'J', suit: 'C' },
      { id: 'QH', rank: 'Q', suit: 'H' },
      { id: 'KS', rank: 'K', suit: 'S' },
      { id: 'AD', rank: 'A', suit: 'D' },
    ];
    const result = isStraight(cards);
    expect(result.valid).toBe(true);
    expect(result.sequence).toBe('10JQKA');
  });

  test('isStraight recognizes 2-low straight (2-3-4-5-6)', () => {
    const cards: Card[] = [
      { id: '2D', rank: '2', suit: 'D' },
      { id: '3C', rank: '3', suit: 'C' },
      { id: '4H', rank: '4', suit: 'H' },
      { id: '5S', rank: '5', suit: 'S' },
      { id: '6D', rank: '6', suit: 'D' },
    ];
    const result = isStraight(cards);
    expect(result.valid).toBe(true);
    expect(result.sequence).toBe('23456');
  });

  test('isStraight rejects invalid wrap J-Q-K-A-2', () => {
    const cards: Card[] = [
      { id: 'JD', rank: 'J', suit: 'D' },
      { id: 'QC', rank: 'Q', suit: 'C' },
      { id: 'KH', rank: 'K', suit: 'H' },
      { id: 'AS', rank: 'A', suit: 'S' },
      { id: '2D', rank: '2', suit: 'D' },
    ];
    const result = isStraight(cards);
    expect(result.valid).toBe(false);
    expect(result.sequence).toBe('');
  });

  test('isStraight rejects invalid straight', () => {
    const cards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
      { id: '6H', rank: '6', suit: 'H' },
      { id: '7S', rank: '7', suit: 'S' },
      { id: '8D', rank: '8', suit: 'D' },
    ];
    const result = isStraight(cards);
    expect(result.valid).toBe(false);
  });

  test('isStraight rejects wrong number of cards', () => {
    const cards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
      { id: '5H', rank: '5', suit: 'H' },
    ];
    const result = isStraight(cards);
    expect(result.valid).toBe(false);
  });
});

describe('Game Logic - Beat Validation', () => {
  test('canBeatPlay allows any play when lastPlay is null', () => {
    const cards: Card[] = [{ id: '3D', rank: '3', suit: 'D' }];
    expect(canBeatPlay(cards, null)).toBe(true);
  });

  test('canBeatPlay single beats lower single', () => {
    const newCards: Card[] = [{ id: '4D', rank: '4', suit: 'D' }];
    const lastPlay: LastPlay = {
      cards: [{ id: '3D', rank: '3', suit: 'D' }],
      combo: 'Single',
    };
    expect(canBeatPlay(newCards, lastPlay)).toBe(true);
  });

  test('canBeatPlay single cannot beat higher single', () => {
    const newCards: Card[] = [{ id: '3D', rank: '3', suit: 'D' }];
    const lastPlay: LastPlay = {
      cards: [{ id: '4D', rank: '4', suit: 'D' }],
      combo: 'Single',
    };
    expect(canBeatPlay(newCards, lastPlay)).toBe(false);
  });

  test('canBeatPlay pair beats lower pair', () => {
    const newCards: Card[] = [
      { id: '4D', rank: '4', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
    ];
    const lastPlay: LastPlay = {
      cards: [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '3C', rank: '3', suit: 'C' },
      ],
      combo: 'Pair',
    };
    expect(canBeatPlay(newCards, lastPlay)).toBe(true);
  });

  test('canBeatPlay wrong number of cards cannot beat', () => {
    const newCards: Card[] = [{ id: '4D', rank: '4', suit: 'D' }];
    const lastPlay: LastPlay = {
      cards: [
        { id: '3D', rank: '3', suit: 'D' },
        { id: '3C', rank: '3', suit: 'C' },
      ],
      combo: 'Pair',
    };
    expect(canBeatPlay(newCards, lastPlay)).toBe(false);
  });

  test('canBeatPlay Flush beats Straight', () => {
    const newCards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '5D', rank: '5', suit: 'D' },
      { id: '7D', rank: '7', suit: 'D' },
      { id: '9D', rank: '9', suit: 'D' },
      { id: 'JD', rank: 'J', suit: 'D' },
    ];
    const lastPlay: LastPlay = {
      cards: [
        { id: '3C', rank: '3', suit: 'C' },
        { id: '4H', rank: '4', suit: 'H' },
        { id: '5S', rank: '5', suit: 'S' },
        { id: '6D', rank: '6', suit: 'D' },
        { id: '7C', rank: '7', suit: 'C' },
      ],
      combo: 'Straight',
    };
    expect(canBeatPlay(newCards, lastPlay)).toBe(true);
  });

  test('canBeatPlay Full House beats Flush', () => {
    const newCards: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '3C', rank: '3', suit: 'C' },
      { id: '3H', rank: '3', suit: 'H' },
      { id: '4S', rank: '4', suit: 'S' },
      { id: '4D', rank: '4', suit: 'D' },
    ];
    const lastPlay: LastPlay = {
      cards: [
        { id: '5D', rank: '5', suit: 'D' },
        { id: '7D', rank: '7', suit: 'D' },
        { id: '9D', rank: '9', suit: 'D' },
        { id: 'JD', rank: 'J', suit: 'D' },
        { id: 'KD', rank: 'K', suit: 'D' },
      ],
      combo: 'Flush',
    };
    expect(canBeatPlay(newCards, lastPlay)).toBe(true);
  });

  test('canBeatPlay Full House compares triple ranks', () => {
    const newCards: Card[] = [
      { id: '5D', rank: '5', suit: 'D' },
      { id: '5C', rank: '5', suit: 'C' },
      { id: '5H', rank: '5', suit: 'H' },
      { id: '3S', rank: '3', suit: 'S' },
      { id: '3D', rank: '3', suit: 'D' },
    ];
    const lastPlay: LastPlay = {
      cards: [
        { id: '4D', rank: '4', suit: 'D' },
        { id: '4C', rank: '4', suit: 'C' },
        { id: '4H', rank: '4', suit: 'H' },
        { id: '6S', rank: '6', suit: 'S' },
        { id: '6D', rank: '6', suit: 'D' },
      ],
      combo: 'Full House',
    };
    expect(canBeatPlay(newCards, lastPlay)).toBe(true);
  });
});

describe('Game Logic - Recommended Play', () => {
  test('findRecommendedPlay plays 3D on first play', () => {
    const hand: Card[] = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
      { id: '5H', rank: '5', suit: 'H' },
    ];
    const result = findRecommendedPlay(hand, null, true);
    expect(result).toEqual(['3D']);
  });

  test('findRecommendedPlay returns null if no 3D on first play', () => {
    const hand: Card[] = [
      { id: '4C', rank: '4', suit: 'C' },
      { id: '5H', rank: '5', suit: 'H' },
    ];
    const result = findRecommendedPlay(hand, null, true);
    expect(result).toBeNull();
  });

  test('findRecommendedPlay plays lowest single when leading', () => {
    const hand: Card[] = [
      { id: '5H', rank: '5', suit: 'H' },
      { id: '3D', rank: '3', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
    ];
    const result = findRecommendedPlay(hand, null, false);
    expect(result).toEqual(['3D']); // Lowest after sorting
  });

  test('findRecommendedPlay finds lowest beating single', () => {
    const hand: Card[] = [
      { id: '5H', rank: '5', suit: 'H' },
      { id: '6D', rank: '6', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
    ];
    const lastPlay: LastPlay = {
      cards: [{ id: '4D', rank: '4', suit: 'D' }],
      combo: 'Single',
    };
    const result = findRecommendedPlay(hand, lastPlay, false);
    expect(result).toEqual(['4C']); // Lowest that beats 4D
  });

  test('findRecommendedPlay returns null if cannot beat', () => {
    const hand: Card[] = [
      { id: '3H', rank: '3', suit: 'H' },
      { id: '4C', rank: '4', suit: 'C' },
    ];
    const lastPlay: LastPlay = {
      cards: [{ id: '2S', rank: '2', suit: 'S' }],
      combo: 'Single',
    };
    const result = findRecommendedPlay(hand, lastPlay, false);
    expect(result).toBeNull();
  });

  test('findRecommendedPlay handles empty hand', () => {
    const result = findRecommendedPlay([], null, false);
    expect(result).toBeNull();
  });
});

describe('Game Logic - classifyAndSortCards', () => {
  test('classifyAndSortCards returns sorted straight in sequence order', () => {
    const cards: Card[] = [
      { id: '7D', rank: '7', suit: 'D' },
      { id: '3D', rank: '3', suit: 'D' },
      { id: '5H', rank: '5', suit: 'H' },
      { id: '4C', rank: '4', suit: 'C' },
      { id: '6S', rank: '6', suit: 'S' },
    ];
    const result = classifyAndSortCards(cards);
    expect(result.type).toBe('Straight');
    expect(result.sortedCards.map(c => c.rank)).toEqual(['3', '4', '5', '6', '7']);
  });

  test('classifyAndSortCards returns sorted cards for non-straight', () => {
    const cards: Card[] = [
      { id: '5H', rank: '5', suit: 'H' },
      { id: '3D', rank: '3', suit: 'D' },
    ];
    const result = classifyAndSortCards(cards);
    expect(result.sortedCards[0].id).toBe('3D');
    expect(result.sortedCards[1].id).toBe('5H');
  });

  test('classifyAndSortCards handles empty array', () => {
    const result = classifyAndSortCards([]);
    expect(result.type).toBe('unknown');
    expect(result.sortedCards).toEqual([]);
  });
});
