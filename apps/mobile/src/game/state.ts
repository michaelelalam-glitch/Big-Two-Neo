/**
 * Game State Manager for Big Two mobile game
 * Handles game initialization, state management, and persistence
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBotAI, type BotDifficulty, type BotPlayResult } from './bot';
import { sortHand, classifyCards, canBeatPlay, validateOneCardLeftRule, canPassWithOneCardLeftRule, isHighestPossiblePlay, findHighestBeatingSingle } from './engine';
import { type Card, type LastPlay, type ComboType, type PlayerMatchScore, type MatchResult, type PlayerMatchScoreDetail } from './types';
import { API } from '../constants';
import { supabase } from '../services/supabase';
import { type AutoPassTimerState } from '../types/multiplayer';
import { showError, soundManager, SoundType } from '../utils';
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
  roundHistory: RoundHistoryEntry[]; // Current match plays only
  gameRoundHistory: RoundHistoryEntry[]; // ALL plays across ALL matches (for stats)
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
   * CRITICAL: Checks gameEnded to prevent infinite loop
   */
  private startTimerCountdown(): void {
    // Prevent starting multiple intervals
    if (this.timerInterval !== null) {
      return;
    }
    
    // Track last notified second to prevent excessive notifications
    let lastNotifiedSecond: number | null = null;
    
    this.timerInterval = setInterval(() => {
      // CRITICAL FIX: Stop timer if match/game has ended
      if (this.state?.gameEnded || this.state?.gameOver) {
        if (this.state.auto_pass_timer) {
          gameLogger.info('⏹️ [Auto-Pass Timer] Cancelled - game ended');
          this.state.auto_pass_timer = null;
        }
        return;
      }

      if (!this.state?.auto_pass_timer?.active) {
        return;
      }

      const startedAt = new Date(this.state.auto_pass_timer.started_at).getTime();
      const now = Date.now();
      const elapsed = now - startedAt;
      const remaining = Math.max(0, this.state.auto_pass_timer.duration_ms - elapsed);

      // Update remaining time
      this.state.auto_pass_timer.remaining_ms = remaining;
      
      // Calculate current displayed second
      const currentSecond = Math.ceil(remaining / 1000);

      // If timer expired, execute auto-pass
      if (remaining === 0) {
        // Prevent re-entry if auto-pass is already executing
        if (this.isExecutingAutoPass) {
          return;
        }

        gameLogger.info('⏰ [Auto-Pass Timer] Timer expired - executing auto-pass');
        this.state.auto_pass_timer = null;
        this.isExecutingAutoPass = true;
        
        // Reset lastNotifiedSecond for next timer
        lastNotifiedSecond = null;
        
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

      // Only notify listeners when the displayed second changes (not every 100ms)
      // This prevents console spam: 10 notifications instead of 100+ during countdown
      if (currentSecond !== lastNotifiedSecond) {
        lastNotifiedSecond = currentSecond;
        this.notifyListeners();
      }
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

    // ✅ Bot names now match player indices for scoreboard clarity
    // Player array: [0: Steve, 1: Bot 1, 2: Bot 2, 3: Bot 3]
    // Turn order: Steve (0) → Bot 1 (1) → Bot 2 (2) → Bot 3 (3)
    // Physical layout: [bottom: 0, top: 1, left: 2, right: 3]
    for (let i = 0; i < botCount; i++) {
      const botNumber = i + 1; // Bot 1, Bot 2, Bot 3
      players.push({
        id: `bot_${botNumber}`,
        name: `Bot ${botNumber}`,
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
      matchComboStats: {
        singles: [],
        pairs: [],
        triples: [],
        straights: [],
        flushes: [],
        full_houses: [],
        four_of_a_kinds: [],
        straight_flushes: [],
        royal_flushes: [],
      },
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
      gameRoundHistory: [], // ALL plays across ALL matches (for stats)
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

    // 🎯 LOG PLAY ATTEMPT
    gameLogger.info(`🃏 [playCards] ${currentPlayer.name} (${currentPlayer.id}) attempting to play ${cards.length} card(s): ${cards.map(c => `${c.rank}${c.suit}`).join(', ')}`);

    // Validate play
    const validation = this.validatePlay(cards, currentPlayer);
    if (!validation.valid) {
      gameLogger.warn(`❌ [playCards] INVALID: ${validation.error}`);
      return { success: false, error: validation.error };
    }

    gameLogger.info(`✅ [playCards] VALID - Executing play`);

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
    // Skip players who have already finished (0 cards) to find actual next player
    const turnOrderPass = [3, 2, 0, 1]; // Next player for indices [0,1,2,3]
    let nextPlayerIndex = turnOrderPass[this.state.currentPlayerIndex];
    const startPassIdx = nextPlayerIndex;
    while (this.state.players[nextPlayerIndex].hand.length === 0 && nextPlayerIndex !== this.state.currentPlayerIndex) {
      nextPlayerIndex = turnOrderPass[nextPlayerIndex];
      if (nextPlayerIndex === startPassIdx) break; // Safety: prevent infinite loop
    }
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
    const passEntry: RoundHistoryEntry = {
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      cards: [],
      combo_type: 'unknown',
      timestamp: Date.now(),
      passed: true,
    };
    this.state.roundHistory.push(passEntry);
    this.state.gameRoundHistory.push(passEntry); // Also add to game-wide history
    
    // 🎯 LOG ROUNDHISTORY ENTRY FOR PASS
    gameLogger.info(`📝 [roundHistory] Added entry #${this.state.roundHistory.length} (game total: ${this.state.gameRoundHistory.length}): ${currentPlayer.name}(${currentPlayer.id}) PASSED`);

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

    // Execute bot decision with circuit breaker to prevent infinite loops
    const MAX_BOT_RETRIES = 3;
    let retryCount = 0;
    let result: { success: boolean; error?: string };

    if (botPlay.cards === null) {
      result = await this.pass();
    } else {
      result = await this.playCards(botPlay.cards);
    }

    // If play was rejected, retry with fallback logic
    while (!result.success && retryCount < MAX_BOT_RETRIES) {
      retryCount++;
      gameLogger.warn(`⚠️ [GameStateManager] Bot ${currentPlayer.name} play rejected (attempt ${retryCount}/${MAX_BOT_RETRIES}): ${result.error}`);

      // @copilot-review-fix (Round 3): Broaden One Card Left error matching.
      // pass() rewrites the message with player names, so also check for
      // "Cannot pass" + "1 card left" to catch all variants.
      const errorMsg = result.error ?? '';
      if (
        errorMsg.includes('Must play highest single') ||
        errorMsg.includes('opponent has 1 card') ||
        (errorMsg.includes('Cannot pass') && errorMsg.includes('1 card left'))
      ) {
        const sorted = sortHand(currentPlayer.hand);
        if (this.state.lastPlay) {
          const highestSingle = findHighestBeatingSingle(sorted, this.state.lastPlay);
          if (highestSingle) {
            gameLogger.info(`🔧 [GameStateManager] Bot ${currentPlayer.name} fallback: playing highest single ${highestSingle.rank}${highestSingle.suit}`);
            result = await this.playCards([highestSingle.id]);
            continue;
          }
        }
        // When leading, play highest card in hand
        const highestCard = sorted[sorted.length - 1];
        gameLogger.info(`🔧 [GameStateManager] Bot ${currentPlayer.name} fallback: leading with highest single ${highestCard.rank}${highestCard.suit}`);
        result = await this.playCards([highestCard.id]);
        continue;
      }

      // Generic fallback: try to pass
      if (this.state.lastPlay && !this.state.isFirstPlayOfGame) {
        gameLogger.info(`🔧 [GameStateManager] Bot ${currentPlayer.name} fallback: attempting pass`);
        result = await this.pass();
      } else {
        // Can't pass when leading - play lowest card
        const sorted = sortHand(currentPlayer.hand);
        gameLogger.info(`🔧 [GameStateManager] Bot ${currentPlayer.name} fallback: playing lowest card`);
        result = await this.playCards([sorted[0].id]);
      }
    }

    if (!result.success) {
      gameLogger.error(`❌ [GameStateManager] Bot ${currentPlayer.name} STUCK after ${MAX_BOT_RETRIES} retries: ${result.error}. Force-passing.`);
      // Last resort: force advance to prevent infinite loop
      this.advanceToNextPlayer();
      await this.saveState();
      this.notifyListeners();
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
        
        // Migration: Ensure arrays added in newer versions exist
        // This prevents "Cannot read property 'push' of undefined" errors
        if (this.state && !this.state.gameRoundHistory) {
          gameLogger.warn('[Migration] Adding missing gameRoundHistory array to loaded state');
          this.state.gameRoundHistory = [];
        }
        if (this.state && !this.state.played_cards) {
          gameLogger.warn('[Migration] Adding missing played_cards array to loaded state');
          this.state.played_cards = [];
        }
        // CRITICAL: Migrate matchComboStats structure for each player
        if (this.state && this.state.matchScores) {
          this.state.matchScores.forEach(matchScore => {
            if (!matchScore?.matchComboStats) {
              gameLogger.warn(`[Migration] Adding missing matchComboStats for player ${matchScore?.playerId}`);
              if (matchScore) {
                matchScore.matchComboStats = {
                  singles: [],
                  pairs: [],
                  triples: [],
                  straights: [],
                  flushes: [],
                  full_houses: [],
                  four_of_a_kinds: [],
                  straight_flushes: [],
                  royal_flushes: [],
                };
              }
            }
          });
        }
        
        // Save migrated state to prevent future migrations
        await this.saveState();
        
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
    const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'] as const;
    const suits: ('D' | 'C' | 'H' | 'S')[] = ['D', 'C', 'H', 'S'];
    const deck: Card[] = [];

    for (const rank of ranks) {
      for (const suit of suits) {
        deck.push({
          id: `${rank}${suit}`,
          rank: rank as Card['rank'],
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
    // Get next ACTIVE player's card count (anticlockwise, skipping finished players)
    const turnOrder = [3, 2, 0, 1]; // Next player for indices [0,1,2,3]
    let nextPlayerIndex = turnOrder[this.state!.currentPlayerIndex];
    const startCheckIdx = nextPlayerIndex;
    // Skip players who have already finished (0 cards)
    while (this.state!.players[nextPlayerIndex].hand.length === 0 && nextPlayerIndex !== this.state!.currentPlayerIndex) {
      nextPlayerIndex = turnOrder[nextPlayerIndex];
      if (nextPlayerIndex === startCheckIdx) break; // Safety: prevent infinite loop
    }
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
        // Log critical bug but don't crash - clear timer and allow game to continue
        gameLogger.error(
          `⏹️ [Auto-Pass Timer] Timer cleared unexpectedly! This indicates a bug in highest play detection logic.`,
          {
            player: player.name,
            playerId: player.id,
            cardsPlayed: cards.map(c => `${c.rank}${c.suit}`),
            currentLastPlay: this.state!.lastPlay,
            triggeringPlay: this.state!.auto_pass_timer.triggering_play
          }
        );
        // Clear timer to prevent crash and allow game to continue
        this.state!.auto_pass_timer = null;
        gameLogger.warn('⏹️ [Auto-Pass Timer] Timer forcibly cleared to prevent crash');
      }
    }

    // Reset all passed flags
    for (const p of this.state!.players) {
      p.passed = false;
    }

    // Add to history
    const historyEntry = {
      playerId: player.id,
      playerName: player.name,
      cards,
      combo_type: combo,
      timestamp: Date.now(),
      passed: false,
    };
    this.state!.roundHistory.push(historyEntry);
    this.state!.gameRoundHistory.push(historyEntry); // Also add to game-wide history
    
    // 🎯 LOG ROUNDHISTORY ENTRY
    gameLogger.info(`📝 [roundHistory] Added entry #${this.state!.roundHistory.length} (game total: ${this.state!.gameRoundHistory.length}): ${player.name}(${player.id}) played ${combo} - ${cards.map(c => `${c.rank}${c.suit}`).join(', ')}`);
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

    // 🎯 CALCULATE COMBO STATS FOR THIS MATCH (before roundHistory is cleared!)
    statsLogger.info(`📊 [Match Stats] Calculating combo stats for match ${this.state.currentMatch}...`);
    for (const player of this.state.players) {
      const playerPlays: typeof this.state.roundHistory = this.state.roundHistory.filter(
        entry => entry.playerId === player.id && !entry.passed
      );
      
      const matchCombos = {
        singles: 0,
        pairs: 0,
        triples: 0,
        straights: 0,
        flushes: 0,
        full_houses: 0,
        four_of_a_kinds: 0,
        straight_flushes: 0,
        royal_flushes: 0,
      };
      
      const comboMapping: { [key: string]: keyof typeof matchCombos } = {
        'single': 'singles',
        'pair': 'pairs',
        'triple': 'triples',
        'straight': 'straights',
        'flush': 'flushes',
        'full house': 'full_houses',
        'four of a kind': 'four_of_a_kinds',
        'straight flush': 'straight_flushes',
        'royal flush': 'royal_flushes',
      };
      
      for (const play of playerPlays) {
        const normalizedCombo: string = play.combo_type.toLowerCase();
        const mappedField: keyof typeof matchCombos | undefined = comboMapping[normalizedCombo];
        if (mappedField && mappedField in matchCombos) {
          matchCombos[mappedField]++;
        }
      }
      
      // Store this match's combo stats (using immutable pattern for React re-rendering safety)
      const matchScore = this.state.matchScores.find(s => s.playerId === player.id);
      if (matchScore) {
        matchScore.matchComboStats = {
          singles: [...matchScore.matchComboStats.singles, matchCombos.singles],
          pairs: [...matchScore.matchComboStats.pairs, matchCombos.pairs],
          triples: [...matchScore.matchComboStats.triples, matchCombos.triples],
          straights: [...matchScore.matchComboStats.straights, matchCombos.straights],
          flushes: [...matchScore.matchComboStats.flushes, matchCombos.flushes],
          full_houses: [...matchScore.matchComboStats.full_houses, matchCombos.full_houses],
          four_of_a_kinds: [...matchScore.matchComboStats.four_of_a_kinds, matchCombos.four_of_a_kinds],
          straight_flushes: [...matchScore.matchComboStats.straight_flushes, matchCombos.straight_flushes],
          royal_flushes: [...matchScore.matchComboStats.royal_flushes, matchCombos.royal_flushes],
        };
        
        statsLogger.info(`✅ [Match Stats] ${player.name} match ${this.state.currentMatch}: ${JSON.stringify(matchCombos)}`);
      }
    }

    // CRITICAL FIX: Cancel auto-pass timer when match ends
    // This prevents infinite loop when bot plays last card + highest play
    if (this.state.auto_pass_timer?.active) {
      gameLogger.info('⏹️ [Auto-Pass Timer] Cancelled - match ended');
      this.state.auto_pass_timer = null;
    }

    // Calculate scores for this match
    const matchScoreDetails = calculateMatchScores(this.state.players, matchWinnerId);

    // Prepare score history data for scoreboard
    const pointsAdded: number[] = [];
    const cumulativeScores: number[] = [];

    // Update cumulative scores and build history arrays
    matchScoreDetails.forEach(detail => {
      const playerScore = this.state!.matchScores.find(s => s.playerId === detail.playerId);
      if (playerScore) {
        playerScore.matchScores.push(detail.finalScore);
        playerScore.score += detail.finalScore;
        gameLogger.debug(`📊 [Scoring] ${playerScore.playerName}: +${detail.finalScore} (total: ${playerScore.score})`);
        
        // Build history arrays (in player order)
        pointsAdded.push(detail.finalScore);
        cumulativeScores.push(playerScore.score);
      }
    });

    // Emit score history for scoreboard (Task #351)
    // This allows ScoreboardContext to track match score history
    gameLogger.info(`📊 [Score History] Match ${this.state.currentMatch}: points=${JSON.stringify(pointsAdded)}, totals=${JSON.stringify(cumulativeScores)}`);
    
    // Notify listeners with updated state (includes score history in matchScores)
    this.notifyListeners();

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
      
      // CRITICAL FIX: Notify listeners so GameScreen receives gameOver + gameEnded state
      // This triggers the Game End Modal to appear (fixes missing modal bug)
      this.notifyListeners();
      
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
              showError(
                'Your game stats could not be saved. Your progress was recorded, but may not appear in the leaderboard.',
                'Stats Not Saved'
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

        // 🎯 SUM COMBO STATS FROM ALL MATCHES (stored in matchComboStats)
        const matchScore = this.state!.matchScores.find(s => s.playerId === player.id);
        
        // Default to zeros if matchScore not found (shouldn't happen but defensive)
        const comboCounts = matchScore ? {
          singles: matchScore.matchComboStats.singles.reduce((sum, val) => sum + val, 0),
          pairs: matchScore.matchComboStats.pairs.reduce((sum, val) => sum + val, 0),
          triples: matchScore.matchComboStats.triples.reduce((sum, val) => sum + val, 0),
          straights: matchScore.matchComboStats.straights.reduce((sum, val) => sum + val, 0),
          flushes: matchScore.matchComboStats.flushes.reduce((sum, val) => sum + val, 0),
          full_houses: matchScore.matchComboStats.full_houses.reduce((sum, val) => sum + val, 0),
          four_of_a_kinds: matchScore.matchComboStats.four_of_a_kinds.reduce((sum, val) => sum + val, 0),
          straight_flushes: matchScore.matchComboStats.straight_flushes.reduce((sum, val) => sum + val, 0),
          royal_flushes: matchScore.matchComboStats.royal_flushes.reduce((sum, val) => sum + val, 0),
        } : {
          singles: 0,
          pairs: 0,
          triples: 0,
          straights: 0,
          flushes: 0,
          full_houses: 0,
          four_of_a_kinds: 0,
          straight_flushes: 0,
          royal_flushes: 0,
        };
        
        if (matchScore) {
          statsLogger.debug(`[Stats] Player: ${player.name} (ID: ${player.id})`);
          statsLogger.debug(`[Stats] Total matches played: ${matchScore.matchComboStats.singles.length}`);
          
          // Match-by-match breakdown only in debug mode to prevent console spam
          if (matchScore.matchComboStats.singles.length <= 5) {
            // Only log details for short games (5 matches or less)
            statsLogger.debug(`[Stats] Match-by-match breakdown for ${player.name}:`);
            for (let i = 0; i < matchScore.matchComboStats.singles.length; i++) {
              statsLogger.debug(`  Match ${i + 1}: Singles=${matchScore.matchComboStats.singles[i]}, Pairs=${matchScore.matchComboStats.pairs[i]}, Triples=${matchScore.matchComboStats.triples[i]}, Straights=${matchScore.matchComboStats.straights[i]}, Flushes=${matchScore.matchComboStats.flushes[i]}, FullHouses=${matchScore.matchComboStats.full_houses[i]}, FourOfAKind=${matchScore.matchComboStats.four_of_a_kinds[i]}, StraightFlush=${matchScore.matchComboStats.straight_flushes[i]}, RoyalFlush=${matchScore.matchComboStats.royal_flushes[i]}`);
            }
          }
          statsLogger.info(`[Stats] Final totals for ${player.name}: ${JSON.stringify(comboCounts)}`);
        } else {
          statsLogger.error(`❌ [Stats] No matchScore found for ${player.name}!`);
        }
        
        statsLogger.info(`[Stats] Final combo counts for ${player.name}: ${JSON.stringify(comboCounts)}`);

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
      // ✅ FIX: winnerPlayer.id is already "bot_1", "bot_2", etc. - don't double-prefix
      const winnerUserId = winnerPlayer.isBot ? winnerPlayer.id : user.id;

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

      // Try Edge Function first (preferred for production)
      let edgeFunctionSuccess = false;
      try {
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

        if (response.ok) {
          const result = await response.json();
          statsLogger.info('✅ [Stats] Game completed via Edge Function:', result);
          edgeFunctionSuccess = true;
        } else {
          const errorData = await response.json();
          throw new Error(errorData.error || `Server returned ${response.status}`);
        }
      } catch (edgeError: any) {
        // Edge Function failed - try fallback RPC
        if (edgeError?.message?.includes('503') || edgeError?.message?.includes('404')) {
          statsLogger.warn('⚠️ [Stats] Edge Function unavailable, using fallback RPC');
        } else {
          statsLogger.warn('⚠️ [Stats] Edge Function error, using fallback RPC:', edgeError?.message);
        }
      }

      // Fallback: Use client-accessible RPC function
      if (!edgeFunctionSuccess) {
        statsLogger.info('📊 [Stats] Calling fallback RPC: complete_game_from_client');
        
        const { data: rpcResult, error: rpcError } = await supabase.rpc('complete_game_from_client', {
          p_room_id: gameCompletionData.room_id,
          p_room_code: gameCompletionData.room_code,
          p_players: gameCompletionData.players,
          p_winner_id: gameCompletionData.winner_id,
          p_game_duration_seconds: gameCompletionData.game_duration_seconds,
          p_started_at: gameCompletionData.started_at,
          p_finished_at: gameCompletionData.finished_at,
        });

        if (rpcError) {
          throw rpcError;
        }

        statsLogger.info('✅ [Stats] Game completed via RPC fallback:', rpcResult);
      }
    } catch (error: any) {
      // Suppress 503 errors (Edge Function not deployed/cold start)
      // Game still works - this only affects stats tracking
      const statusCode = error?.status || error?.statusCode || error?.code;
      if (statusCode === 503 || statusCode === '503' || error?.message?.includes('503')) {
        statsLogger.warn('⚠️ [Stats] Stats service unavailable (503) - skipping stats save');
      } else {
        statsLogger.error('❌ [Stats] Exception saving stats:', error?.message || error?.code || String(error));
      }
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
    this.state.roundHistory = []; // Clear match history (but gameRoundHistory persists!)
    // NOTE: gameRoundHistory is NOT cleared - it accumulates across ALL matches
    gameLogger.info(`🔄 [New Match] roundHistory cleared for match ${this.state.currentMatch}, gameRoundHistory has ${this.state.gameRoundHistory.length} total plays`);
    this.state.auto_pass_timer = null; // Clear timer for new match
    this.state.played_cards = []; // Clear played cards history for new match

    // Reset player states
    for (const player of this.state.players) {
      player.passed = false;
    }

    await this.saveState();
    this.notifyListeners();

    gameLogger.info(`✅ [New Match] Match ${this.state.currentMatch} started, ${this.state.players[startingPlayerIndex].name} leads`);
    
    // Play match start sound ("here we go again")
    soundManager.playSound(SoundType.GAME_START);
    gameLogger.info('🎵 [Audio] Match start sound triggered');

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
    const startingPlayer = this.state!.currentPlayerIndex;
    const turnOrder = [3, 2, 0, 1]; // Next player for indices [0,1,2,3]
    let nextPlayerIndex = turnOrder[this.state!.currentPlayerIndex];

    // Try to find the next player with cards, looping at most once through all players
    while (nextPlayerIndex !== startingPlayer) {
      if (this.state!.players[nextPlayerIndex].hand.length > 0) {
        this.state!.currentPlayerIndex = nextPlayerIndex;
        return;
      }
      nextPlayerIndex = turnOrder[nextPlayerIndex];
    }

    // If we get here, either only the starting player has cards, or no one has cards
    if (this.state!.players[startingPlayer].hand.length > 0) {
      this.state!.currentPlayerIndex = startingPlayer;
      // Only the starting player has cards; continue with them
    } else {
      // No players have cards remaining - endgame scenario
      gameLogger.warn('[advanceToNextPlayer] No players with cards remaining. Game should end.');
      // The game should have already ended via checkGameOver() after the last card was played.
      // This is a safeguard in case we reach an invalid state.
      this.state!.gameEnded = true;
    }
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
