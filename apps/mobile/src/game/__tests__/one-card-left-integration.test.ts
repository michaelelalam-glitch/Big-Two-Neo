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
  let manager: GameStateManager;

  afterEach(() => {
    manager?.destroy();
  });

  it('should prevent passing in GameStateManager when next player has 1 card', async () => {
    manager = new GameStateManager();
    
    // Initialize a 4-player game (required for anticlockwise turn order)
    await manager.initializeGame({
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'medium',
    });
    
    // Manually set up game state for testing
    const state = (manager as any).state;
    if (!state) throw new Error('State not initialized');
    
    // Anticlockwise turn order: Player 0's next is Player 3
    // Give Player 1 (human, index 0) cards including singles higher than 4
    state.players[0].hand = [
      { id: '5H', rank: '5', suit: 'H' },
      { id: '7D', rank: '7', suit: 'D' },
      { id: 'KS', rank: 'K', suit: 'S' },
    ];
    
    state.players[1].hand = [
      { id: '3D', rank: '3', suit: 'D' },
      { id: '6C', rank: '6', suit: 'C' },
    ];
    
    state.players[2].hand = [
      { id: '8H', rank: '8', suit: 'H' },
      { id: '9C', rank: '9', suit: 'C' },
    ];
    
    // Bot 3 (index 3) is the ACTUAL next player for Player 0 — give exactly 1 card
    state.players[3].hand = [
      { id: 'AH', rank: 'A', suit: 'H' },
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
    
    // Try to pass - should be rejected (next player has 1 card left)
    const result = await manager.pass();
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot pass');
    expect(result.error).toContain('1 card left');
  });
  
  it('should allow passing when next player has MORE than 1 card', async () => {
    manager = new GameStateManager();
    
    await manager.initializeGame({
      playerName: 'Player 1',
      botCount: 3,
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
    ];
    
    state.players[2].hand = [
      { id: '9C', rank: '9', suit: 'C' },
      { id: 'TC', rank: '10', suit: 'C' },
    ];
    
    // Bot 3 (index 3, actual next player per anticlockwise order) has 3 cards
    state.players[3].hand = [
      { id: 'JH', rank: 'J', suit: 'H' },
      { id: 'QD', rank: 'Q', suit: 'D' },
      { id: '4C', rank: '4', suit: 'C' },
    ];
    
    state.currentPlayerIndex = 0;
    state.gameStarted = true;
    state.isFirstPlayOfGame = false;
    
    state.lastPlay = {
      position: 0,
      cards: [{ id: 'KS', rank: 'K', suit: 'S' }],
      combo_type: 'Single',
    };
    
    // Should be allowed to pass (next player has >1 card)
    const result = await manager.pass();
    
    expect(result.success).toBe(true);
  });
});
