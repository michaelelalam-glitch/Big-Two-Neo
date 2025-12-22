import { canPassWithOneCardLeftRule, findHighestBeatingSingle } from '../engine/game-logic';
import type { Card, LastPlay } from '../types';

describe('One Card Left Rule - Debug User Issue', () => {
  it('should prevent passing when next player has 1 card and current player has beating single', () => {
    // Scenario: Last play was 4♠ (single)
    // Current player has 5♥ (beats it)
    // Next player has 1 card
    
    const currentPlayerHand: Card[] = [
      { id: '3H', rank: '3' as const, suit: 'H' as const },
      { id: '5H', rank: '5' as const, suit: 'H' as const },
      { id: '7D', rank: '7' as const, suit: 'D' as const },
    ];
    
    const lastPlay: LastPlay = {
        position: 0,
      cards: [{ id: '4S', rank: '4' as const, suit: 'S' as const }],
      combo_type: 'Single',
    };
    
    const nextPlayerCardCount = 1; // Next player has 1 card
    
    const result = canPassWithOneCardLeftRule(
      currentPlayerHand,
      nextPlayerCardCount,
      lastPlay
    );
    
    console.log('Result:', result);
    console.log('Highest beating single:', findHighestBeatingSingle(currentPlayerHand, lastPlay));
    
    expect(result.canPass).toBe(false);
    expect(result.error).toContain('Cannot pass');
  });
  
  it('should find the highest beating single correctly', () => {
    const hand: Card[] = [
      { id: '3H', rank: '3' as const, suit: 'H' as const },
      { id: '5H', rank: '5' as const, suit: 'H' as const },
      { id: '7D', rank: '7' as const, suit: 'D' as const },
    ];
    
    const lastPlay: LastPlay = {
        position: 0,
      cards: [{ id: '4S', rank: '4' as const, suit: 'S' as const }],
      combo_type: 'Single',
    };
    
    const highest = findHighestBeatingSingle(hand, lastPlay);
    console.log('Highest beating single:', highest);
    
    expect(highest).not.toBeNull();
    expect(highest?.rank).toBe('7'); // 7♦ is the highest
  });
  
  it('should allow passing when last play was a pair (not a single)', () => {
    const hand: Card[] = [
      { id: '3H', rank: '3' as const, suit: 'H' as const },
      { id: '5H', rank: '5' as const, suit: 'H' as const },
      { id: '7D', rank: '7' as const, suit: 'D' as const },
    ];
    
    const lastPlay: LastPlay = {
        position: 0,
      cards: [
        { id: '4S', rank: '4' as const, suit: 'S' as const },
        { id: '4H', rank: '4' as const, suit: 'H' as const },
      ],
      combo_type: 'Pair',
    };
    
    const nextPlayerCardCount = 1;
    
    const result = canPassWithOneCardLeftRule(
      hand,
      nextPlayerCardCount,
      lastPlay
    );
    
    console.log('Pair scenario - Result:', result);
    expect(result.canPass).toBe(true); // Should allow pass for pairs
  });
  
  it('should allow passing when next player does NOT have 1 card', () => {
    const hand: Card[] = [
      { id: '3H', rank: '3' as const, suit: 'H' as const },
      { id: '5H', rank: '5' as const, suit: 'H' as const },
      { id: '7D', rank: '7' as const, suit: 'D' as const },
    ];
    
    const lastPlay: LastPlay = {
        position: 0,
      cards: [{ id: '4S', rank: '4' as const, suit: 'S' as const }],
      combo_type: 'Single',
    };
    
    const nextPlayerCardCount = 3; // Next player has 3 cards
    
    const result = canPassWithOneCardLeftRule(
      hand,
      nextPlayerCardCount,
      lastPlay
    );
    
    console.log('3 cards scenario - Result:', result);
    expect(result.canPass).toBe(true); // Should allow pass when next player has >1 card
  });
});
