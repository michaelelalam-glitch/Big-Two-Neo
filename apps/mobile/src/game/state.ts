/**
 * Game State Manager for Big Two mobile game
 * Handles game initialization, state management, and persistence
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { sortHand, classifyCards, canBeatPlay, validateOneCardLeftRule, canPassWithOneCardLeftRule, isHighestPossiblePlay } from './engine';
import { type Card, type LastPlay, type ComboType, type PlayerMatchScore, type MatchResult, type PlayerMatchScoreDetail } from './types';
import { type AutoPassTimerState } from '../types/multiplayer';
import { createBotAI, type BotDifficulty, type BotPlayResult } from './bot';
import { supabase } from '../services/supabase';
import { API } from '../constants';
import { gameLogger, statsLogger } from '../utils/logger';

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
  startedAt?: number; // Timestamp when the game started (for duration calculation)
  // Auto-pass timer (for highest play detection)
  auto_pass_timer: AutoPassTimerState | null;
  played_cards: Card[]; // All cards played this match (for highest play detection)
}

export interface RoundHistoryEntry {
  playerId: string;
  playerName: string;
  cards: Card[];
  combo_type: ComboType;
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
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private isExecutingAutoPass: boolean = false; // Prevent re-entry

  constructor() {
    this.state = null;
    this.startTimerCountdown();
  }

  /**
   * Start timer countdown interval (runs every 100ms)
   */
  private startTimerCountdown(): void {
    // Prevent starting multiple intervals
    if (this.timerInterval !== null) {
      return;
    }
    
    this.timerInterval = setInterval(() => {
      if (!this.state?.auto_pass_timer?.active) {
        return;
      }

      const startedAt = new Date(this.state.auto_pass_timer.started_at).getTime();
      const now = Date.now();
      const elapsed = now - startedAt;
      const remaining = Math.max(0, this.state.auto_pass_timer.duration_ms - elapsed);

      // Update remaining time
      this.state.auto_pass_timer.remaining_ms = remaining;

      // If timer expired, execute auto-pass
      if (remaining === 0) {
        // Prevent re-entry if auto-pass is already executing
        if (this.isExecutingAutoPass) {
          return;
        }

        gameLogger.info('⏰ [Auto-Pass Timer] Timer expired - executing auto-pass');
        this.state.auto_pass_timer = null;
        this.isExecutingAutoPass = true;
        
        // Safety timeout to force-reset flag if pass() hangs (prevents permanent lock)
        const safetyTimeout = setTimeout(() => {
          if (this.isExecutingAutoPass) {
            gameLogger.warn('⏰ [Auto-Pass Timer] Safety timeout triggered - force-resetting isExecutingAutoPass flag');
            this.isExecutingAutoPass = false;
          }
        }, 10000); // 10 second timeout
        
        // Execute pass action
        this.pass().then((result) => {
          if (result.success) {
            gameLogger.info('⏰ [Auto-Pass Timer] Auto-pass successful');
          } else {
            gameLogger.warn('⏰ [Auto-Pass Timer] Auto-pass failed:', result.error);
          }
        }).catch((error) => {
          gameLogger.error('⏰ [Auto-Pass Timer] Auto-pass error:', error);
        }).finally(() => {
          // Clear safety timeout and reset flag after pass completes
          clearTimeout(safetyTimeout);
          this.isExecutingAutoPass = false;
        });
      }

      // Notify listeners to update UI
      this.notifyListeners();
    }, 100); // Update every 100ms for smooth countdown
  }

  /**
   * Clean up timer interval
   */
  destroy(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
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
      startedAt: Date.now(),
      auto_pass_timer: null,
      played_cards: [],
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

    // Check "One Card Left" rule - cannot pass if next player has 1 card and you have valid single
    const currentPlayer = this.state.players[this.state.currentPlayerIndex];
    // Anticlockwise turn order: 0→3, 1→2, 2→0, 3→1 (sequence: 0→3→1→2→0)
    const turnOrder = [3, 2, 0, 1]; // Next player for indices [0,1,2,3]
    const nextPlayerIndex = turnOrder[this.state.currentPlayerIndex];
    const nextPlayer = this.state.players[nextPlayerIndex];
    const nextPlayerCardCount = nextPlayer.hand.length;
    
    // Debug logging for One Card Left rule
    gameLogger.debug('[OneCardLeft] Checking pass validation:', {
      currentPlayer: currentPlayer.name,
      nextPlayer: nextPlayer.name,
      nextPlayerCardCount,
      lastPlayType: this.state.lastPlay?.combo_type,
      lastPlayCards: this.state.lastPlay?.cards.length,
    });
    
    const passValidation = canPassWithOneCardLeftRule(
      currentPlayer.hand,
      nextPlayerCardCount,
      this.state.lastPlay
    );
    
    gameLogger.debug('[OneCardLeft] Pass validation result:', passValidation);
    
    if (!passValidation.canPass) {
      // Enhance error message with next player's name for clarity
      const baseError = passValidation.error ?? "You cannot pass in this situation.";
      const enhancedError = baseError.replace(
        'opponent has',
        `${nextPlayer.name} (next player) has`
      );
      gameLogger.debug('[OneCardLeft] Blocking pass with error:', enhancedError);
      return { success: false, error: enhancedError };
    }

    currentPlayer.passed = true;
    this.state.consecutivePasses++;

    // Add to history
    this.state.roundHistory.push({
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      cards: [],
      combo_type: 'unknown',
      timestamp: Date.now(),
      passed: true,
    });

    // Cancel auto-pass timer if active AND it's the same player who triggered it
    if (this.state.auto_pass_timer?.active && 
        this.state.auto_pass_timer.player_id === currentPlayer.id) {
      gameLogger.info(`⏹️ [Auto-Pass Timer] Cancelled by manual pass from ${currentPlayer.name}`);
      this.state.auto_pass_timer = null;
    }

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

    gameLogger.debug(`🎲 [GameStateManager] Getting bot play for ${currentPlayer.name}...`);

    // Get bot play
    const botAI = createBotAI(currentPlayer.botDifficulty);
    const playerCardCounts = this.state.players.map(p => p.hand.length);

    const botPlay: BotPlayResult = botAI.getPlay({
      hand: currentPlayer.hand,
      lastPlay: this.state.lastPlay,
      isFirstPlayOfGame: this.state.isFirstPlayOfGame,
      playerCardCounts,
      currentPlayerIndex: this.state.currentPlayerIndex,
      difficulty: currentPlayer.botDifficulty,
    });

    gameLogger.debug(`🃏 [GameStateManager] Bot ${currentPlayer.name} decision:`, 
      botPlay.cards ? `Play ${botPlay.cards.length} card(s)` : 'Pass',
      botPlay.reasoning ? `(${botPlay.reasoning})` : ''
    );

    // Execute bot decision
    if (botPlay.cards === null) {
      await this.pass();
    } else {
      await this.playCards(botPlay.cards);
    }
    
    gameLogger.debug(`✅ [GameStateManager] Bot ${currentPlayer.name} turn complete. Next player: ${this.state.players[this.state.currentPlayerIndex].name}`);
    
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
    } catch (error: any) {
      gameLogger.error('Failed to load game state:', error?.message || String(error));
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
    } catch (error: any) {
      // Only log error message/code to avoid exposing storage internals
      gameLogger.error('Failed to save game state:', error?.message || error?.code || String(error));
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
    } catch (error: any) {
      gameLogger.error('Failed to clear game state:', error?.message || String(error));
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

    // Check "One Card Left" rule
    // Get next player's card count (anticlockwise turn order: 0→3→1→2→0)
    const turnOrder = [3, 2, 0, 1]; // Next player for indices [0,1,2,3]
    const nextPlayerIndex = turnOrder[this.state!.currentPlayerIndex];
    const nextPlayerCardCount = this.state!.players[nextPlayerIndex].hand.length;
    
    const oneCardLeftValidation = validateOneCardLeftRule(
      cards,
      player.hand,
      nextPlayerCardCount,
      this.state!.lastPlay
    );
    
    if (!oneCardLeftValidation.valid) {
      return { valid: false, error: oneCardLeftValidation.error };
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
    this.state!.lastPlay = { position: this.state!.currentPlayerIndex, cards, combo_type: combo };
    this.state!.lastPlayPlayerIndex = this.state!.currentPlayerIndex; // Track trick winner
    this.state!.consecutivePasses = 0;
    this.state!.isFirstPlayOfGame = false;

    // Check if this is the highest possible play BEFORE adding to played_cards
    // (needs to check against cards already played, not including current play)
    const isHighest = isHighestPossiblePlay(cards, this.state!.played_cards);
    
    // Now add cards to played_cards history for future highest play detection
    this.state!.played_cards.push(...cards);

    if (isHighest) {
      gameLogger.info(`🔥 [Auto-Pass Timer] Highest play detected! Starting 10s timer for ${player.name}`);
      const now = new Date().toISOString();
      this.state!.auto_pass_timer = {
        active: true,
        started_at: now,
        duration_ms: 10000, // 10 seconds
        remaining_ms: 10000,
        triggering_play: this.state!.lastPlay,
        player_id: player.id, // Track who triggered the timer
      };
    } else {
      // Clear timer if it was active
      // Note: If highest play was made, no one can beat it, so this should never trigger
      if (this.state!.auto_pass_timer?.active) {
        // This is a critical bug - throw exception to catch it in development/testing
        throw new Error(
          `⏹️ [Auto-Pass Timer] Timer cleared unexpectedly! This indicates a bug in highest play detection logic.\n` +
          `  Player: ${player.name} (ID: ${player.id})\n` +
          `  Cards played: ${JSON.stringify(cards.map(c => `${c.rank}${c.suit}`))}\n` +
          `  Current lastPlay: ${JSON.stringify(this.state!.lastPlay)}\n` +
          `  Triggering play was: ${JSON.stringify(this.state!.auto_pass_timer.triggering_play)}`
        );
      }
    }

    // Reset all passed flags
    for (const p of this.state!.players) {
      p.passed = false;
    }

    // Add to history
    this.state!.roundHistory.push({
      playerId: player.id,
      playerName: player.name,
      cards,
      combo_type: combo,
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

    // Clear auto-pass timer when trick ends
    this.state!.auto_pass_timer = null;

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

    gameLogger.info(`🏆 [Match End] Match ${this.state.currentMatch} won by ${matchWinnerId}`);

    // Calculate scores for this match
    const matchScoreDetails = calculateMatchScores(this.state.players, matchWinnerId);

    // Update cumulative scores
    matchScoreDetails.forEach(detail => {
      const playerScore = this.state!.matchScores.find(s => s.playerId === detail.playerId);
      if (playerScore) {
        playerScore.matchScores.push(detail.finalScore);
        playerScore.score += detail.finalScore;
        gameLogger.debug(`📊 [Scoring] ${playerScore.playerName}: +${detail.finalScore} (total: ${playerScore.score})`);
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
      gameLogger.info(`🎉 [Game Over] Final winner: ${finalWinner?.playerName} with ${finalWinner?.score} points`);
      
      // Save game stats to database (async, don't await to avoid blocking UI)
      statsLogger.info('🔄 [Stats] Starting saveGameStatsToDatabase...');
      let alertShown = false; // Track if alert was shown to prevent duplicate alerts
      this.saveGameStatsToDatabase().catch(err => {
        // Only log error message/code to avoid exposing database internals or sensitive data
        statsLogger.error('❌ [Stats] Failed to save game stats:', err?.message || err?.code || String(err));
        
        // Notify user that stats weren't saved (dismissible, non-blocking)
        // Only show alert if we haven't already shown one (prevents duplicate alerts if user navigates)
        if (!alertShown) {
          alertShown = true;
          setTimeout(() => {
            // Check if game is still active (user hasn't navigated away)
            // If game state still exists, show the alert
            if (this.state && this.state.gameOver) {
              Alert.alert(
                'Stats Not Saved',
                'Your game stats could not be saved. Your progress was recorded, but may not appear in the leaderboard.',
                [{ text: 'OK', style: 'cancel' }],
                { cancelable: true }
              );
            }
          }, 1000); // Delay to avoid interrupting game over UI
        }
      });
    } else {
      // Continue to next match
      this.state.gameEnded = true; // Mark match as ended
      this.state.winnerId = matchWinnerId;
      this.state.lastMatchWinnerId = matchWinnerId;
      
      gameLogger.info(`➡️ [Next Match] Match ${this.state.currentMatch + 1} will start with ${matchWinnerId} leading`);
    }
  }

  /**
   * Save game statistics to Supabase database
   * Calls server-side edge function to validate and update stats with service_role credentials
   */
  private async saveGameStatsToDatabase(): Promise<void> {
    if (!this.state) return;

    statsLogger.debug('📊 [Stats] saveGameStatsToDatabase called');

    try {
      // Get current user
      statsLogger.debug('📊 [Stats] Getting current user...');
      const { data: { user } } = await supabase.auth.getUser();
      statsLogger.debug('📊 [Stats] User:', user?.id ? `Found (${user.id.slice(0, 8)}...)` : 'Not found');
      
      if (!user) {
        statsLogger.warn('⚠️ [Stats] No authenticated user, skipping stats save');
        return;
      }

      // Prepare game completion data for all players (including bots for now)
      // TODO: In multiplayer mode, collect real player data from game state
      const playersData = this.state.players.map(player => {
        const playerScore = this.state!.matchScores.find(s => s.playerId === player.id);
        const sortedScores = [...this.state!.matchScores].sort((a, b) => a.score - b.score);
        const finishPosition = sortedScores.findIndex(s => s.playerId === player.id) + 1;

        // Count combo types for this player
        const playerPlays = this.state!.roundHistory.filter(
          entry => entry.playerId === player.id && !entry.passed
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

        playerPlays.forEach(play => {
          const comboName = play.combo_type.trim().toLowerCase();
          const dbField = comboMapping[comboName];
          if (dbField) {
            comboCounts[dbField]++;
          } else {
            // Warn about unexpected combo names for easier debugging if game engine changes
            statsLogger.warn(`[Stats] Unexpected combo name encountered: "${play.combo_type}" - This combo will not be counted in stats.`);
          }
        });

        return {
          user_id: player.isBot ? `bot_${player.id}` : user.id, // TODO: Real user IDs in multiplayer
          username: player.name,
          score: playerScore?.score || 0,
          finish_position: finishPosition,
          combos_played: comboCounts,
        };
      });

      // Find the winner's user_id (not the internal player ID)
      if (!this.state.finalWinnerId) {
        throw new Error('No final winner ID found in state');
      }
      const finalWinnerId = this.state.finalWinnerId; // Local variable to maintain non-null type after check
      const winnerPlayer = this.state.players.find(p => p.id === finalWinnerId);
      if (!winnerPlayer) {
        throw new Error(`Winner player not found in state for finalWinnerId: ${finalWinnerId}`);
      }
      const winnerUserId = winnerPlayer.isBot ? `bot_${winnerPlayer.id}` : user.id;

      const gameCompletionData = {
        room_id: null, // Local games don't have a room_id (multiplayer will provide real UUID)
        room_code: 'LOCAL', // TODO: Real room code in multiplayer
        players: playersData,
        winner_id: winnerUserId,
        game_duration_seconds: Math.floor((Date.now() - (this.state.startedAt || Date.now())) / 1000),
        started_at: new Date(this.state.startedAt || Date.now()).toISOString(),
        finished_at: new Date().toISOString(),
      };

      statsLogger.info(`📊 [Stats] Calling complete-game edge function`);

      // Call server-side edge function to process game completion
      // This uses service_role credentials on the server to update stats securely
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No active session');
      }

      const response = await fetch(
        `${API.SUPABASE_URL}/functions/v1/complete-game`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(gameCompletionData),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server returned ${response.status}`);
      }

      const result = await response.json();
      statsLogger.info('✅ [Stats] Game completed successfully:', result);
    } catch (error: any) {
      // Only log error message/code to avoid exposing DB internals
      statsLogger.error('❌ [Stats] Exception saving stats:', error?.message || error?.code || String(error));
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

    gameLogger.info(`🆕 [New Match] Starting match ${this.state.currentMatch + 1}`);
    
    // Log existing card counts before dealing
    gameLogger.debug(`🧹 [Pre-Deal] Card counts:`, this.state.players.map(p => `${p.name}: ${p.hand.length}`).join(', '));

    // Increment match number
    this.state.currentMatch++;

    // Deal new cards (this will clear existing hands first)
    const deck = this.createDeck();
    const shuffledDeck = this.shuffleDeck(deck);
    this.dealCards(this.state.players, shuffledDeck);
    
    // Log card counts after dealing
    gameLogger.debug(`🎴 [Post-Deal] Card counts:`, this.state.players.map(p => `${p.name}: ${p.hand.length}`).join(', '));

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
    this.state.auto_pass_timer = null; // Clear timer for new match
    this.state.played_cards = []; // Clear played cards history for new match

    // Reset player states
    for (const player of this.state.players) {
      player.passed = false;
    }

    await this.saveState();
    this.notifyListeners();

    gameLogger.info(`✅ [New Match] Match ${this.state.currentMatch} started, ${this.state.players[startingPlayerIndex].name} leads`);

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
