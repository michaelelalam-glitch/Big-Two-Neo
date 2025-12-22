// Mock supabase before imports
jest.mock('../../services/supabase');

// Mock soundManager to prevent .m4a file parse errors
jest.mock('../../utils/soundManager', () => ({
  soundManager: {
    playSound: jest.fn(),
    stopSound: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
  },
  SoundType: {
    GAME_START: 'GAME_START',
    HIGHEST_CARD: 'HIGHEST_CARD',
    CARD_PLAY: 'CARD_PLAY',
    PASS: 'PASS',
    WINNER: 'WINNER',
  },
}));
// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));
import { GameStateManager } from '../state';
import type { Card } from '../types';

describe('One Card Left Rule - Integration Test', () => {
  it('should prevent passing in GameStateManager when next player has 1 card', async () => {
    const manager = new GameStateManager();
    
    // Initialize a normal game
    await manager.initializeGame({
      playerName: 'Player 1',
      botCount: 2,
      botDifficulty: 'medium',
    });
    
    // Manually set up game state for testing
    const state = (manager as any).state;
    if (!state) throw new Error('State not initialized');
    
    // Give Player 1 (human) some cards including cards higher than 4
    state.players[0].hand = [
      { id: '5H', rank: '5', suit: 'H' },
      { id: '7D', rank: '7', suit: 'D' },
      { id: 'KS', rank: 'K', suit: 'S' },
    ];
    
    // Give Bot 1 (next player) exactly 1 card
    state.players[1].hand = [
      { id: 'AH', rank: 'A', suit: 'H' },
    ];
    
    // Give Bot 2 some cards
    state.players[2].hand = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '6C', rank: '6', suit: 'C' },
    ];
    
    // Set current player to Player 1 (index 0)
    state.currentPlayerIndex = 0;
    state.gameStarted = true;
    state.isFirstPlayOfGame = false;
    
    // Set last play to a single 4♠
    state.lastPlay = {
        position: 0,
      cards: [{ id: '4S', rank: '4', suit: 'S' }],
      combo_type: 'Single',
    };
    
    console.log('\n=== Test Scenario ===');
    console.log('Current Player: Player 1 (index 0)');
    console.log('Player 1 hand:', state.players[0].hand.map((c: Card) => c.id));
    console.log('Bot 1 hand (next player):', state.players[1].hand.map((c: Card) => c.id), '← HAS 1 CARD!');
    console.log('Last play: 4♠ (single)');
    console.log('Player 1 can beat with: 5♥, 7♦, K♠');
    console.log('Expected: Should NOT allow passing');
    console.log('===================\n');
    
    // Try to pass - should be rejected
    const result = await manager.pass();
    
    console.log('Pass result:', result);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot pass');
    expect(result.error).toContain('1 card left');
  });
  
  it('should allow passing when next player has MORE than 1 card', async () => {
    const manager = new GameStateManager();
    
    await manager.initializeGame({
      playerName: 'Player 1',
      botCount: 2,
      botDifficulty: 'medium',
    });
    
    const state = (manager as any).state;
    if (!state) throw new Error('State not initialized');
    
    state.players[0].hand = [
      { id: '3H', rank: '3', suit: 'H' },
      { id: '3S', rank: '3', suit: 'S' },
    ];
    
    state.players[1].hand = [
      { id: '6H', rank: '6', suit: 'H' },
      { id: '7H', rank: '7', suit: 'H' },
      { id: '8H', rank: '8', suit: 'H' },
    ]; // 3 cards - rule doesn't apply
    
    state.players[2].hand = [
      { id: '9C', rank: '9', suit: 'C' },
      { id: 'TC', rank: '10', suit: 'C' },
    ];
    
    state.currentPlayerIndex = 0;
    state.gameStarted = true;
    state.isFirstPlayOfGame = false;
    
    state.lastPlay = {
        position: 0,
      cards: [{ id: 'KS', rank: 'K', suit: 'S' }],
      combo_type: 'Single',
    };
    
    console.log('\n=== Test Scenario (Should Allow Pass) ===');
    console.log('Current Player: Player 1 (index 0)');
    console.log('Bot 1 hand (next player):', state.players[1].hand.length, 'cards ← NOT 1 card');
    console.log('Last play: K♠ (single)');
    console.log('Expected: Should ALLOW passing (next player has >1 card)');
    console.log('=========================================\n');
    
    const result = await manager.pass();
    
    console.log('Pass result:', result);
    
    expect(result.success).toBe(true);
  });
});
