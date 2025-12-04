/**
 * Game State Manager for Big Two mobile game
 * Handles game initialization, state management, and persistence
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { sortHand, classifyCards, canBeatPlay, type Card, type LastPlay, type ComboType } from '../engine';
import { createBotAI, type BotDifficulty, type BotPlayResult } from '../bot';

const GAME_STATE_KEY = '@big2_game_state';

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  passed: boolean;
}

export interface GameState {
  players: Player[];
  currentPlayerIndex: number;
  lastPlay: LastPlay | null;
  consecutivePasses: number;
  isFirstPlayOfGame: boolean;
  gameStarted: boolean;
  gameEnded: boolean;
  winnerId: string | null;
  roundHistory: RoundHistoryEntry[];
}

export interface RoundHistoryEntry {
  playerId: string;
  playerName: string;
  cards: Card[];
  combo: ComboType;
  timestamp: number;
  passed: boolean;
}

export interface GameConfig {
  playerName: string;
  botCount: number;
  botDifficulty: BotDifficulty;
}

export type GameStateListener = (state: GameState) => void;

/**
 * Game State Manager class
 * Manages game flow, state transitions, and persistence for React Native
 */
export class GameStateManager {
  private state: GameState | null = null;
  private listeners: GameStateListener[] = [];

  constructor() {
    this.state = null;
  }

  /**
   * Initialize a new game
   */
  async initializeGame(config: GameConfig): Promise<GameState> {
    const { playerName, botCount, botDifficulty } = config;

    // Create players (1 human + 3 bots by default)
    const players: Player[] = [
      {
        id: 'player_0',
        name: playerName,
        hand: [],
        isBot: false,
        passed: false,
      },
    ];

    for (let i = 0; i < botCount; i++) {
      players.push({
        id: `bot_${i + 1}`,
        name: `Bot ${i + 1}`,
        hand: [],
        isBot: true,
        botDifficulty,
        passed: false,
      });
    }

    // Deal cards
    const deck = this.createDeck();
    const shuffledDeck = this.shuffleDeck(deck);
    this.dealCards(players, shuffledDeck);

    // Find who has 3D
    const startingPlayerIndex = this.findPlayerWith3D(players);

    // Initialize state
    this.state = {
      players,
      currentPlayerIndex: startingPlayerIndex,
      lastPlay: null,
      consecutivePasses: 0,
      isFirstPlayOfGame: true,
      gameStarted: true,
      gameEnded: false,
      winnerId: null,
      roundHistory: [],
    };

    await this.saveState();
    this.notifyListeners();

    return this.state;
  }

  /**
   * Play cards for current player
   */
  async playCards(cardIds: string[]): Promise<{ success: boolean; error?: string }> {
    if (!this.state || !this.state.gameStarted || this.state.gameEnded) {
      return { success: false, error: 'Game not in progress' };
    }

    const currentPlayer = this.state.players[this.state.currentPlayerIndex];
    const cards = cardIds.map(id => currentPlayer.hand.find(c => c.id === id)).filter(Boolean) as Card[];

    if (cards.length === 0) {
      return { success: false, error: 'Invalid card selection' };
    }

    // Validate play
    const validation = this.validatePlay(cards, currentPlayer);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Execute play
    this.executePlay(currentPlayer, cards);

    // Check for win
    if (currentPlayer.hand.length === 0) {
      this.state.gameEnded = true;
      this.state.winnerId = currentPlayer.id;
      await this.saveState();
      this.notifyListeners();
      return { success: true };
    }

    // Move to next player
    this.advanceToNextPlayer();

    await this.saveState();
    this.notifyListeners();

    return { success: true };
  }

  /**
   * Pass current player's turn
   */
  async pass(): Promise<{ success: boolean; error?: string }> {
    if (!this.state || !this.state.gameStarted || this.state.gameEnded) {
      return { success: false, error: 'Game not in progress' };
    }

    // Cannot pass if leading or on first play
    if (!this.state.lastPlay || this.state.isFirstPlayOfGame) {
      return { success: false, error: 'Cannot pass when leading' };
    }

    const currentPlayer = this.state.players[this.state.currentPlayerIndex];
    currentPlayer.passed = true;
    this.state.consecutivePasses++;

    // Add to history
    this.state.roundHistory.push({
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      cards: [],
      combo: 'unknown',
      timestamp: Date.now(),
      passed: true,
    });

    // If all other players passed, current trick is over
    if (this.state.consecutivePasses >= this.state.players.length - 1) {
      this.startNewTrick();
    } else {
      this.advanceToNextPlayer();
    }

    await this.saveState();
    this.notifyListeners();

    return { success: true };
  }

  /**
   * Get bot's play decision and execute it
   */
  async executeBotTurn(): Promise<void> {
    if (!this.state || !this.state.gameStarted || this.state.gameEnded) {
      return;
    }

    const currentPlayer = this.state.players[this.state.currentPlayerIndex];
    if (!currentPlayer.isBot) {
      return;
    }

    // Get bot play
    const botAI = createBotAI(currentPlayer.botDifficulty);
    const playerCardCounts = this.state.players.map(p => p.hand.length);

    const botPlay: BotPlayResult = botAI.getPlay({
      hand: currentPlayer.hand,
      lastPlay: this.state.lastPlay,
      isFirstPlayOfGame: this.state.isFirstPlayOfGame,
      playerCardCounts,
      difficulty: currentPlayer.botDifficulty,
    });

    // Execute bot decision
    if (botPlay.cards === null) {
      await this.pass();
    } else {
      await this.playCards(botPlay.cards);
    }
  }

  /**
   * Load saved game state
   */
  async loadState(): Promise<GameState | null> {
    try {
      const stateJson = await AsyncStorage.getItem(GAME_STATE_KEY);
      if (stateJson) {
        this.state = JSON.parse(stateJson);
        this.notifyListeners();
        return this.state;
      }
    } catch (error) {
      console.error('Failed to load game state:', error);
    }
    return null;
  }

  /**
   * Save current game state
   */
  async saveState(): Promise<void> {
    if (!this.state) return;

    try {
      const stateJson = JSON.stringify(this.state);
      await AsyncStorage.setItem(GAME_STATE_KEY, stateJson);
    } catch (error) {
      console.error('Failed to save game state:', error);
    }
  }

  /**
   * Clear saved game state
   */
  async clearState(): Promise<void> {
    try {
      await AsyncStorage.removeItem(GAME_STATE_KEY);
      this.state = null;
      this.notifyListeners();
    } catch (error) {
      console.error('Failed to clear game state:', error);
    }
  }

  /**
   * Get current game state
   */
  getState(): GameState | null {
    return this.state;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: GameStateListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Create a standard 52-card deck
   */
  private createDeck(): Card[] {
    const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    const suits: ('D' | 'C' | 'H' | 'S')[] = ['D', 'C', 'H', 'S'];
    const deck: Card[] = [];

    for (const rank of ranks) {
      for (const suit of suits) {
        deck.push({
          id: `${rank}${suit}`,
          rank: rank,
          suit: suit,
        });
      }
    }

    return deck;
  }

  /**
   * Shuffle deck using Fisher-Yates algorithm
   */
  private shuffleDeck(deck: Card[]): Card[] {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Deal 13 cards to each player
   */
  private dealCards(players: Player[], deck: Card[]): void {
    for (let i = 0; i < 13; i++) {
      for (const player of players) {
        const card = deck.pop();
        if (card) {
          player.hand.push(card);
        }
      }
    }

    // Sort each player's hand
    for (const player of players) {
      player.hand = sortHand(player.hand);
    }
  }

  /**
   * Find player who has 3D
   */
  private findPlayerWith3D(players: Player[]): number {
    for (let i = 0; i < players.length; i++) {
      if (players[i].hand.some(c => c.id === '3D')) {
        return i;
      }
    }
    return 0; // Fallback
  }

  /**
   * Validate if a play is legal
   */
  private validatePlay(cards: Card[], player: Player): { valid: boolean; error?: string } {
    // Check if player has all cards
    for (const card of cards) {
      if (!player.hand.some(c => c.id === card.id)) {
        return { valid: false, error: 'Card not in hand' };
      }
    }

    // First play must include 3D
    if (this.state!.isFirstPlayOfGame) {
      if (!cards.some(c => c.id === '3D')) {
        return { valid: false, error: 'First play must include 3♦' };
      }
    }

    // Check combo validity
    const combo = classifyCards(cards);
    if (combo === 'unknown') {
      return { valid: false, error: 'Invalid card combination' };
    }

    // Check if beats last play
    if (this.state!.lastPlay) {
      if (!canBeatPlay(cards, this.state!.lastPlay)) {
        return { valid: false, error: 'Cannot beat last play' };
      }
    }

    return { valid: true };
  }

  /**
   * Execute a valid play
   */
  private executePlay(player: Player, cards: Card[]): void {
    // Remove cards from hand
    player.hand = player.hand.filter(c => !cards.some(pc => pc.id === c.id));

    // Update game state
    const combo = classifyCards(cards);
    this.state!.lastPlay = { cards, combo };
    this.state!.consecutivePasses = 0;
    this.state!.isFirstPlayOfGame = false;

    // Reset all passed flags
    for (const p of this.state!.players) {
      p.passed = false;
    }

    // Add to history
    this.state!.roundHistory.push({
      playerId: player.id,
      playerName: player.name,
      cards,
      combo,
      timestamp: Date.now(),
      passed: false,
    });
  }

  /**
   * Start a new trick (all players passed)
   */
  private startNewTrick(): void {
    this.state!.lastPlay = null;
    this.state!.consecutivePasses = 0;

    // Reset passed flags
    for (const player of this.state!.players) {
      player.passed = false;
    }

    // Current player leads
  }

  /**
   * Advance to next player
   */
  private advanceToNextPlayer(): void {
    do {
      this.state!.currentPlayerIndex = (this.state!.currentPlayerIndex + 1) % this.state!.players.length;
    } while (this.state!.players[this.state!.currentPlayerIndex].hand.length === 0);
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    if (this.state) {
      for (const listener of this.listeners) {
        listener(this.state);
      }
    }
  }
}

/**
 * Create a game state manager instance
 */
export function createGameStateManager(): GameStateManager {
  return new GameStateManager();
}
