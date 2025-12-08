/**
 * Game State Manager for Big Two mobile game
 * Handles game initialization, state management, and persistence
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { sortHand, classifyCards, canBeatPlay } from './engine';
import { type Card, type LastPlay, type ComboType, type PlayerMatchScore, type MatchResult, type PlayerMatchScoreDetail } from './types';
import { createBotAI, type BotDifficulty, type BotPlayResult } from './bot';
import { supabase } from '../services/supabase';

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
  lastPlayPlayerIndex: number; // Track who made the last play (trick winner)
  consecutivePasses: number;
  isFirstPlayOfGame: boolean;
  gameStarted: boolean;
  gameEnded: boolean;
  winnerId: string | null;
  roundHistory: RoundHistoryEntry[];
  // Match scoring system
  currentMatch: number; // Current match number (starts at 1)
  matchScores: PlayerMatchScore[]; // Cumulative scores for each player
  lastMatchWinnerId: string | null; // Winner of previous match (starts next match)
  gameOver: boolean; // True when a player reaches 101+ points
  finalWinnerId: string | null; // Overall game winner (lowest score)
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
 * Calculate score for a player's remaining hand
 * 
 * Scoring rules:
 * - 1-4 cards: 1 point per card
 * - 5-9 cards: 2 points per card
 * - 10-13 cards: 3 points per card
 * - Winner (0 cards): 0 points
 */
function calculatePlayerScore(hand: Card[]): PlayerMatchScoreDetail {
  const cardsRemaining = hand.length;
  
  // Determine points per card based on card count
  let pointsPerCard: number;
  if (cardsRemaining >= 1 && cardsRemaining <= 4) {
    pointsPerCard = 1;
  } else if (cardsRemaining >= 5 && cardsRemaining <= 9) {
    pointsPerCard = 2;
  } else if (cardsRemaining >= 10 && cardsRemaining <= 13) {
    pointsPerCard = 3;
  } else {
    pointsPerCard = 0; // Winner or invalid
  }
  
  const finalScore = cardsRemaining * pointsPerCard;

  return {
    playerId: '', // Will be set by caller
    cardsRemaining,
    pointsPerCard,
    finalScore,
  };
}

/**
 * Calculate match scores for all players when match ends
 */
function calculateMatchScores(
  players: Player[],
  winnerId: string
): PlayerMatchScoreDetail[] {
  return players.map(player => {
    if (player.id === winnerId) {
      // Winner gets 0 points
      return {
        playerId: player.id,
        cardsRemaining: 0,
        pointsPerCard: 0,
        finalScore: 0,
      };
    }
    
    const scoreDetail = calculatePlayerScore(player.hand);
    scoreDetail.playerId = player.id;
    return scoreDetail;
  });
}

/**
 * Check if game should end (any player >= 101 points)
 */
function shouldGameEnd(matchScores: PlayerMatchScore[]): boolean {
  return matchScores.some(score => score.score >= 101);
}

/**
 * Find final winner (player with lowest score)
 */
function findFinalWinner(matchScores: PlayerMatchScore[]): string {
  let lowestScore = Infinity;
  let winnerId = matchScores[0].playerId;
  
  matchScores.forEach(score => {
    if (score.score < lowestScore) {
      lowestScore = score.score;
      winnerId = score.playerId;
    }
  });
  
  return winnerId;
}

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

    // Initialize match scores for all players
    const matchScores: PlayerMatchScore[] = players.map(player => ({
      playerId: player.id,
      playerName: player.name,
      score: 0,
      matchScores: [],
    }));

    // Initialize state
    this.state = {
      players,
      currentPlayerIndex: startingPlayerIndex,
      lastPlay: null,
      lastPlayPlayerIndex: startingPlayerIndex,
      consecutivePasses: 0,
      isFirstPlayOfGame: true,
      gameStarted: true,
      gameEnded: false,
      winnerId: null,
      roundHistory: [],
      currentMatch: 1,
      matchScores,
      lastMatchWinnerId: null,
      gameOver: false,
      finalWinnerId: null,
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

    // Check for match end (player finished all cards)
    if (currentPlayer.hand.length === 0) {
      await this.handleMatchEnd(currentPlayer.id);
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
  async executeBotTurn(): Promise<GameState | null> {
    if (!this.state || !this.state.gameStarted || this.state.gameEnded) {
      return null;
    }

    const currentPlayer = this.state.players[this.state.currentPlayerIndex];
    if (!currentPlayer.isBot) {
      return null;
    }

    console.log(`🎲 [GameStateManager] Getting bot play for ${currentPlayer.name}...`);

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

    console.log(`🃏 [GameStateManager] Bot ${currentPlayer.name} decision:`, 
      botPlay.cards ? `Play ${botPlay.cards.length} card(s)` : 'Pass',
      botPlay.reasoning ? `(${botPlay.reasoning})` : ''
    );

    // Execute bot decision
    if (botPlay.cards === null) {
      await this.pass();
    } else {
      await this.playCards(botPlay.cards);
    }
    
    console.log(`✅ [GameStateManager] Bot ${currentPlayer.name} turn complete. Next player: ${this.state.players[this.state.currentPlayerIndex].name}`);
    
    // Return updated state
    return this.state;
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
    // CRITICAL: Clear all existing hands first!
    for (const player of players) {
      player.hand = [];
    }
    
    // Deal 13 cards to each player
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
    this.state!.lastPlayPlayerIndex = this.state!.currentPlayerIndex; // Track trick winner
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

    // Trick winner (last player who played) leads the next trick
    this.state!.currentPlayerIndex = this.state!.lastPlayPlayerIndex;
  }

  /**
   * Handle match end: calculate scores, check if game is over, start new match or end game
   */
  private async handleMatchEnd(matchWinnerId: string): Promise<void> {
    if (!this.state) return;

    console.log(`🏆 [Match End] Match ${this.state.currentMatch} won by ${matchWinnerId}`);

    // Calculate scores for this match
    const matchScoreDetails = calculateMatchScores(this.state.players, matchWinnerId);

    // Update cumulative scores
    matchScoreDetails.forEach(detail => {
      const playerScore = this.state!.matchScores.find(s => s.playerId === detail.playerId);
      if (playerScore) {
        playerScore.matchScores.push(detail.finalScore);
        playerScore.score += detail.finalScore;
        console.log(`📊 [Scoring] ${playerScore.playerName}: +${detail.finalScore} (total: ${playerScore.score})`);
      }
    });

    // Check if game should end (someone reached 101+ points)
    const gameEnds = shouldGameEnd(this.state.matchScores);

    if (gameEnds) {
      // Game Over: find winner (lowest score)
      this.state.gameOver = true;
      this.state.gameEnded = true;
      this.state.finalWinnerId = findFinalWinner(this.state.matchScores);
      this.state.winnerId = matchWinnerId; // Last match winner
      
      const finalWinner = this.state.matchScores.find(s => s.playerId === this.state!.finalWinnerId);
      console.log(`🎉 [Game Over] Final winner: ${finalWinner?.playerName} with ${finalWinner?.score} points`);
      
      // Save game stats to database (async, don't await to avoid blocking UI)
      console.log('🔄 [Stats] Starting saveGameStatsToDatabase...');
      this.saveGameStatsToDatabase().catch(err => {
        console.error('❌ [Stats] Failed to save game stats:', err);
        console.error('❌ [Stats] Error details:', JSON.stringify(err, null, 2));
        
        // Notify user that stats weren't saved (dismissible, non-blocking)
        setTimeout(() => {
          Alert.alert(
            'Stats Not Saved',
            'Your game stats could not be saved. Your progress was recorded, but may not appear in the leaderboard.',
            [{ text: 'OK', style: 'cancel' }],
            { cancelable: true }
          );
        }, 1000); // Delay to avoid interrupting game over UI
      });
    } else {
      // Continue to next match
      this.state.gameEnded = true; // Mark match as ended
      this.state.winnerId = matchWinnerId;
      this.state.lastMatchWinnerId = matchWinnerId;
      
      console.log(`➡️ [Next Match] Match ${this.state.currentMatch + 1} will start with ${matchWinnerId} leading`);
    }
  }

  /**
   * Save game statistics to Supabase database
   * Updates player_stats for the human player (not bots)
   */
  private async saveGameStatsToDatabase(): Promise<void> {
    if (!this.state) return;

    console.log('📊 [Stats] saveGameStatsToDatabase called');

    try {
      // Get current user
      console.log('📊 [Stats] Getting current user...');
      const { data: { user } } = await supabase.auth.getUser();
      console.log('📊 [Stats] User:', user?.id ? `Found (${user.id})` : 'Not found');
      
      if (!user) {
        console.log('⚠️ [Stats] No authenticated user, skipping stats save');
        return;
      }

      // Find human player in the game
      const humanPlayer = this.state.players.find(p => !p.isBot);
      if (!humanPlayer) {
        console.log('⚠️ [Stats] No human player found');
        return;
      }

      const humanScore = this.state.matchScores.find(s => s.playerId === humanPlayer.id);
      if (!humanScore) {
        console.log('⚠️ [Stats] No score found for human player');
        return;
      }

      // Determine if player won (lowest score wins in Big Two)
      const won = this.state.finalWinnerId === humanPlayer.id;
      
      // Calculate finish position (1st = winner with lowest score, 4th = loser with highest score)
      // This is intentional Big Two game logic where lower scores are better
      const sortedScores = [...this.state.matchScores].sort((a, b) => a.score - b.score);
      const finishPosition = sortedScores.findIndex(s => s.playerId === humanPlayer.id) + 1;

      // Count combo types from round history
      const humanPlays = this.state.roundHistory.filter(
        entry => entry.playerId === humanPlayer.id && !entry.passed
      );
      
      const comboCounts = {
        singles: 0,
        pairs: 0,
        triples: 0,
        straights: 0,
        full_houses: 0,
        four_of_a_kinds: 0,
        straight_flushes: 0,
        royal_flushes: 0,
      };

      // Explicit mapping from combo display names to database field names
      // Using case-insensitive matching to handle variations in combo name formats
      const comboMapping: Record<string, keyof typeof comboCounts> = {
        'single': 'singles',
        'pair': 'pairs',
        'triple': 'triples',
        'straight': 'straights',
        'full house': 'full_houses',
        'four of a kind': 'four_of_a_kinds',
        'straight flush': 'straight_flushes',
        'royal flush': 'royal_flushes',
      };

      humanPlays.forEach(play => {
        // Normalize combo name: trim whitespace and convert to lowercase for matching
        const comboName = play.combo.trim().toLowerCase();
        const dbField = comboMapping[comboName];
        if (dbField) {
          comboCounts[dbField]++;
        } else {
          // Log unmatched combos for debugging
          console.warn(`[Stats] Unmatched combo name: "${play.combo}" (normalized: "${comboName}")`);
        }
      });

      console.log(`📊 [Stats] Saving: won=${won}, position=${finishPosition}, score=${humanScore.score}`);

      // Call Supabase RPC function to update stats
      const { error: statsError } = await supabase.rpc('update_player_stats_after_game', {
        p_user_id: user.id,
        p_won: won,
        p_finish_position: finishPosition,
        p_score: humanScore.score,
        p_combos_played: comboCounts,
      });

      if (statsError) {
        console.error('❌ [Stats] Error updating player stats:', statsError);
        // Don't refresh leaderboard if stats update failed
        throw new Error(`Stats update failed: ${statsError.message}`);
      }

      console.log('✅ [Stats] Player stats updated successfully');
      
      // Only refresh leaderboard if stats update succeeded
      const { error: leaderboardError } = await supabase.rpc('refresh_leaderboard');
      if (leaderboardError) {
        console.error('⚠️ [Stats] Leaderboard refresh failed (non-critical):', leaderboardError);
        // Don't throw - leaderboard refresh failure is non-critical
      } else {
        console.log('✅ [Stats] Leaderboard refreshed');
      }
    } catch (error) {
      console.error('❌ [Stats] Exception saving stats:', error);
    }
  }

  /**
   * Start a new match (after previous match ended)
   * Winner of previous match starts first
   */
  async startNewMatch(): Promise<{ success: boolean; error?: string }> {
    if (!this.state || !this.state.gameEnded || this.state.gameOver) {
      return { success: false, error: 'Cannot start new match' };
    }

    console.log(`🆕 [New Match] Starting match ${this.state.currentMatch + 1}`);
    
    // Log existing card counts before dealing
    console.log(`🧹 [Pre-Deal] Card counts:`, this.state.players.map(p => `${p.name}: ${p.hand.length}`).join(', '));

    // Increment match number
    this.state.currentMatch++;

    // Deal new cards (this will clear existing hands first)
    const deck = this.createDeck();
    const shuffledDeck = this.shuffleDeck(deck);
    this.dealCards(this.state.players, shuffledDeck);
    
    // Log card counts after dealing
    console.log(`🎴 [Post-Deal] Card counts:`, this.state.players.map(p => `${p.name}: ${p.hand.length}`).join(', '));

    // Find the previous match winner and make them start
    let startingPlayerIndex = 0;
    if (this.state.lastMatchWinnerId) {
      startingPlayerIndex = this.state.players.findIndex(p => p.id === this.state!.lastMatchWinnerId);
      if (startingPlayerIndex === -1) startingPlayerIndex = 0;
    }

    // Reset match state
    this.state.currentPlayerIndex = startingPlayerIndex;
    this.state.lastPlayPlayerIndex = startingPlayerIndex;
    this.state.lastPlay = null;
    this.state.consecutivePasses = 0;
    this.state.isFirstPlayOfGame = false; // Only first match requires 3D, subsequent matches don't
    this.state.gameEnded = false;
    this.state.winnerId = null;
    this.state.roundHistory = [];

    // Reset player states
    for (const player of this.state.players) {
      player.passed = false;
    }

    await this.saveState();
    this.notifyListeners();

    console.log(`✅ [New Match] Match ${this.state.currentMatch} started, ${this.state.players[startingPlayerIndex].name} leads`);

    return { success: true };
  }

  /**
   * Get match result for UI display
   */
  getMatchResult(): MatchResult | null {
    if (!this.state || !this.state.winnerId) return null;

    const winner = this.state.players.find(p => p.id === this.state!.winnerId);
    
    return {
      winnerId: this.state.winnerId,
      winnerName: winner?.name || 'Unknown',
      playerScores: [...this.state.matchScores],
      matchNumber: this.state.currentMatch,
      gameEnded: this.state.gameOver,
      finalWinnerId: this.state.finalWinnerId || undefined,
    };
  }

  /**
   * Advance to next player (anticlockwise for 4-player game)
   * Layout: 0=Bottom(Player), 1=Top, 2=Left, 3=Right
   * Anticlockwise order: 0 → 3 → 1 → 2 → 0
   */
  private advanceToNextPlayer(): void {
    do {
      // Anticlockwise turn order mapping for visual layout
      const turnOrder = [3, 2, 0, 1]; // Next player for indices [0,1,2,3]
      this.state!.currentPlayerIndex = turnOrder[this.state!.currentPlayerIndex];
    } while (this.state!.players[this.state!.currentPlayerIndex].hand.length === 0);
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    if (this.state) {
      // Create a deep copy to ensure React detects changes
      const stateCopy: GameState = {
        ...this.state,
        players: this.state.players.map(p => ({
          ...p,
          hand: [...p.hand],
        })),
        lastPlay: this.state.lastPlay ? {
          ...this.state.lastPlay,
          cards: [...this.state.lastPlay.cards],
        } : null,
        roundHistory: [...this.state.roundHistory],
        matchScores: this.state.matchScores.map(s => ({
          ...s,
          matchScores: [...s.matchScores],
        })),
      };
      
      for (const listener of this.listeners) {
        listener(stateCopy);
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
