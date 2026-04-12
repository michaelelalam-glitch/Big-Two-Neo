/**
 * Game Sandbox — Full-control testing environment for Big Two
 *
 * Allows setting arbitrary:
 *  - Player hands (exact cards per player)
 *  - Scores (cumulative and per-match)
 *  - Cards played
 *  - Game phase / turn state
 *  - Simultaneous multi-game sessions (20+ parallel instances)
 *
 * Usage:
 *   const sb = GameSandbox.create({ players: 4 });
 *   sb.setHand('player-1', [card('3D'), card('4C')]);
 *   sb.setScores({ 'player-1': 50, 'player-2': 90 });
 *   sb.playCards('player-1', [card('3D')]);
 *   sb.pass('player-2');
 *   expect(sb.state.currentPlayerIndex).toBe(2);
 */

import type { Card, ComboType, LastPlay } from '../../game/types';
import type { GameState, Player, RoundHistoryEntry, PlayerMatchScore } from '../../game/state';
import {
  sortHand,
  classifyCards,
  canBeatPlay,
  validateOneCardLeftRule,
  canPassWithOneCardLeftRule,
  isHighestPossiblePlay,
} from '../../game/engine';
import { createBotAI, type BotDifficulty, type BotPlayOptions } from '../../game/bot';
import { RANKS, SUITS, RANK_VALUE, SUIT_VALUE } from '../../game/engine/constants';

// ─── Card Factory ────────────────────────────────────────────────────────────

/** Create a Card from shorthand (e.g., "3D", "10S", "AH") */
export function card(id: string): Card {
  const match = id.match(/^(10|[2-9JQKA])([DCHS])$/);
  if (!match) throw new Error(`Invalid card id: ${id}`);
  return {
    id,
    rank: match[1] as Card['rank'],
    suit: match[2] as Card['suit'],
  };
}

/** Create multiple cards from shorthand array */
export function cards(...ids: string[]): Card[] {
  return ids.map(card);
}

/** Generate a full 52-card deck */
export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ id: `${rank}${suit}`, rank, suit });
    }
  }
  return deck;
}

/** Shuffle an array (Fisher-Yates) */
export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Deal cards to N players from a deck (optionally pre-shuffled) */
export function dealCards(numPlayers: number, deck?: Card[]): Card[][] {
  const d = deck ?? shuffle(fullDeck());
  const hands: Card[][] = Array.from({ length: numPlayers }, () => []);
  d.forEach((c, i) => hands[i % numPlayers].push(c));
  return hands.map(h => sortHand(h));
}

// ─── Player Factory ──────────────────────────────────────────────────────────

function createPlayer(
  index: number,
  hand: Card[],
  isBot = false,
  botDifficulty?: BotDifficulty
): Player {
  return {
    id: isBot ? `bot-${index}` : `player-${index}`,
    name: isBot ? `Bot ${index}` : `Player ${index}`,
    hand: [...hand],
    isBot,
    botDifficulty,
    passed: false,
  };
}

// ─── Sandbox Config ──────────────────────────────────────────────────────────

export interface SandboxConfig {
  /** Number of players (2-4, default 4) */
  players?: number;
  /** Pre-assigned hands. Key = player index (0-based), value = cards */
  hands?: Record<number, Card[]>;
  /** Pre-set cumulative scores. Key = player-id, value = score */
  scores?: Record<string, number>;
  /** Bot difficulties per index. Missing = human player */
  bots?: Record<number, BotDifficulty>;
  /** Current match number (default 1) */
  currentMatch?: number;
  /** Whether 3♦ must start first play (default true) */
  enforceFirstPlayRule?: boolean;
  /** Starting player index override (default: whoever has 3♦) */
  startingPlayerIndex?: number;
}

// ─── GameSandbox ─────────────────────────────────────────────────────────────

export class GameSandbox {
  state: GameState;
  private enforceFirstPlay: boolean;

  private constructor(config: SandboxConfig) {
    const numPlayers = config.players ?? 4;
    if (numPlayers < 2 || numPlayers > 4) {
      throw new Error('players must be 2-4');
    }
    this.enforceFirstPlay = config.enforceFirstPlayRule ?? true;

    // Deal or assign hands
    const allHands = dealCards(numPlayers);
    const hands: Card[][] = [];
    for (let i = 0; i < numPlayers; i++) {
      hands.push(config.hands?.[i] ?? allHands[i]);
    }

    // Create players
    const players: Player[] = hands.map((hand, i) => {
      const botDiff = config.bots?.[i];
      return createPlayer(i, hand, !!botDiff, botDiff);
    });

    // Figure out starting player (whoever has 3♦, or override)
    let startIdx = config.startingPlayerIndex ?? -1;
    if (startIdx === -1) {
      startIdx = players.findIndex(p => p.hand.some(c => c.id === '3D'));
      if (startIdx === -1) startIdx = 0;
    }

    // Initialize match scores
    const matchScores: PlayerMatchScore[] = players.map(p => ({
      playerId: p.id,
      playerName: p.name,
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

    // Apply pre-set scores
    if (config.scores) {
      for (const [pid, score] of Object.entries(config.scores)) {
        const ms = matchScores.find(m => m.playerId === pid);
        if (ms) ms.score = score;
      }
    }

    this.state = {
      players,
      currentPlayerIndex: startIdx,
      lastPlay: null,
      lastPlayPlayerIndex: startIdx,
      consecutivePasses: 0,
      isFirstPlayOfGame: true,
      gameStarted: true,
      gameEnded: false,
      winnerId: null,
      roundHistory: [],
      gameRoundHistory: [],
      currentMatch: config.currentMatch ?? 1,
      matchScores,
      lastMatchWinnerId: null,
      gameOver: false,
      finalWinnerId: null,
      startedAt: Date.now(),
      auto_pass_timer: null,
      played_cards: [],
    };
  }

  /** Create a new sandbox game instance */
  static create(config: SandboxConfig = {}): GameSandbox {
    return new GameSandbox(config);
  }

  // ─── State Mutation Helpers ──────────────────────────────────────────────

  /** Set exact hand for a player by index or id */
  setHand(playerIdOrIndex: string | number, hand: Card[]): void {
    const p = this.getPlayer(playerIdOrIndex);
    p.hand = [...hand];
  }

  /** Set cumulative scores for multiple players */
  setScores(scores: Record<string, number>): void {
    for (const [pid, score] of Object.entries(scores)) {
      const ms = this.state.matchScores.find(m => m.playerId === pid);
      if (ms) ms.score = score;
    }
  }

  /** Override current turn to a specific player */
  setCurrentPlayer(playerIdOrIndex: string | number): void {
    const idx =
      typeof playerIdOrIndex === 'number'
        ? playerIdOrIndex
        : this.state.players.findIndex(p => p.id === playerIdOrIndex);
    if (idx < 0 || idx >= this.state.players.length) {
      throw new Error(`Invalid player: ${playerIdOrIndex}`);
    }
    this.state.currentPlayerIndex = idx;
  }

  /** Override last play (trick to beat) */
  setLastPlay(play: LastPlay | null): void {
    this.state.lastPlay = play;
  }

  /** Set the first-play flag */
  setIsFirstPlay(value: boolean): void {
    this.state.isFirstPlayOfGame = value;
  }

  /** Set played cards (used for highest-play detection) */
  setPlayedCards(played: Card[]): void {
    this.state.played_cards = [...played];
  }

  /** Reset all pass flags */
  resetPasses(): void {
    this.state.players.forEach(p => {
      p.passed = false;
    });
    this.state.consecutivePasses = 0;
  }

  // ─── Game Actions ────────────────────────────────────────────────────────

  /** Play cards for the current player. Returns validation result. */
  playCards(
    playerIdOrIndex: string | number,
    selectedCards: Card[]
  ): { success: boolean; error?: string; comboType?: ComboType } {
    const p = this.getPlayer(playerIdOrIndex);
    const idx = this.state.players.indexOf(p);

    // Turn check
    if (idx !== this.state.currentPlayerIndex) {
      return { success: false, error: 'Not your turn' };
    }

    if (selectedCards.length === 0) {
      return { success: false, error: 'Must select at least one card' };
    }

    // Classify the combo
    const comboType = classifyCards(selectedCards);
    if (comboType === 'unknown') {
      return { success: false, error: 'Invalid card combination' };
    }

    // First play — must include 3♦
    if (this.state.isFirstPlayOfGame && this.enforceFirstPlay) {
      const has3D = selectedCards.some(c => c.id === '3D');
      if (!has3D) {
        return { success: false, error: 'First play must include 3♦' };
      }
    }

    // Beat existing play
    if (this.state.lastPlay) {
      if (!canBeatPlay(selectedCards, this.state.lastPlay)) {
        return { success: false, error: 'Cannot beat the current play' };
      }
    }

    // One-card-left rule
    const oneCardResult = validateOneCardLeftRule(
      selectedCards,
      p.hand,
      this.state.lastPlay?.cards ?? null,
      this.state.played_cards
    );
    if (!oneCardResult.valid) {
      return { success: false, error: oneCardResult.reason ?? 'One-card-left rule violation' };
    }

    // Execute the play
    const cardIds = new Set(selectedCards.map(c => c.id));
    p.hand = p.hand.filter(c => !cardIds.has(c.id));
    p.passed = false;

    // Update state
    this.state.lastPlay = { cards: selectedCards, combo_type: comboType };
    this.state.lastPlayPlayerIndex = idx;
    this.state.consecutivePasses = 0;
    this.state.isFirstPlayOfGame = false;
    this.state.played_cards.push(...selectedCards);

    // Record history
    this.state.roundHistory.push({
      playerId: p.id,
      playerName: p.name,
      cards: selectedCards,
      combo_type: comboType,
      timestamp: Date.now(),
      passed: false,
      matchNumber: this.state.currentMatch,
    });

    // Check win
    if (p.hand.length === 0) {
      this.state.gameEnded = true;
      this.state.winnerId = p.id;
    } else {
      this.advanceTurn();
    }

    return { success: true, comboType };
  }

  /** Pass for the current player */
  pass(playerIdOrIndex: string | number): { success: boolean; error?: string } {
    const p = this.getPlayer(playerIdOrIndex);
    const idx = this.state.players.indexOf(p);

    if (idx !== this.state.currentPlayerIndex) {
      return { success: false, error: 'Not your turn' };
    }

    // Can't pass if you're leading
    if (!this.state.lastPlay) {
      return { success: false, error: 'Cannot pass when leading — must play' };
    }

    // One-card-left pass rule
    if (!canPassWithOneCardLeftRule(p.hand, this.state.lastPlay.cards, this.state.played_cards)) {
      return { success: false, error: 'Must play — one-card-left rule forces a play' };
    }

    // Execute pass
    p.passed = true;
    this.state.consecutivePasses++;

    // Record history
    this.state.roundHistory.push({
      playerId: p.id,
      playerName: p.name,
      cards: [],
      combo_type: 'Pass' as ComboType,
      timestamp: Date.now(),
      passed: true,
      matchNumber: this.state.currentMatch,
    });

    // Check if all other players passed → trick winner starts new trick
    const activePlayers = this.state.players.filter(pl => pl.hand.length > 0);
    if (this.state.consecutivePasses >= activePlayers.length - 1) {
      // Trick winner starts fresh
      this.state.lastPlay = null;
      this.state.consecutivePasses = 0;
      this.state.players.forEach(pl => {
        pl.passed = false;
      });
      this.state.currentPlayerIndex = this.state.lastPlayPlayerIndex;
    } else {
      this.advanceTurn();
    }

    return { success: true };
  }

  /** Run a bot turn (returns what the bot played) */
  runBotTurn(botDifficulty?: BotDifficulty): {
    action: 'play' | 'pass';
    cards?: Card[];
    comboType?: ComboType;
  } {
    const p = this.state.players[this.state.currentPlayerIndex];
    if (!p.isBot) throw new Error(`Player ${p.id} is not a bot`);

    const difficulty = botDifficulty ?? p.botDifficulty ?? 'easy';
    const botAI = createBotAI(difficulty);
    const playerCardCounts = this.state.players.map(pl => pl.hand.length);
    const botOptions: BotPlayOptions = {
      hand: p.hand,
      lastPlay: this.state.lastPlay,
      isFirstPlayOfGame: this.state.isFirstPlayOfGame,
      matchNumber: this.state.currentMatch,
      playerCardCounts,
      currentPlayerIndex: this.state.currentPlayerIndex,
      difficulty,
    };
    const result = botAI.getPlay(botOptions);

    if (!result.cards || result.cards.length === 0) {
      // Bot passes
      if (this.state.lastPlay) {
        this.pass(p.id);
      } else {
        // Leading but bot returned null — play lowest single
        const lowest = sortHand(p.hand)[0];
        if (lowest) {
          this.playCards(p.id, [lowest]);
          return { action: 'play', cards: [lowest] };
        }
      }
      return { action: 'pass' };
    }

    // Convert card IDs to Card objects from hand
    const cardObjects = result.cards
      .map(id => p.hand.find(c => c.id === id))
      .filter((c): c is Card => c !== undefined);

    if (cardObjects.length === 0) {
      if (this.state.lastPlay) {
        this.pass(p.id);
      }
      return { action: 'pass' };
    }

    const playResult = this.playCards(p.id, cardObjects);
    if (!playResult.success) {
      // Fallback: pass if play failed
      if (this.state.lastPlay) {
        this.pass(p.id);
      }
      return { action: 'pass' };
    }

    return {
      action: 'play',
      cards: cardObjects,
      comboType: playResult.comboType,
    };
  }

  // ─── Query Helpers ───────────────────────────────────────────────────────

  /** Get current player */
  currentPlayer(): Player {
    return this.state.players[this.state.currentPlayerIndex];
  }

  /** Get player by id or index */
  getPlayer(idOrIndex: string | number): Player {
    if (typeof idOrIndex === 'number') {
      const p = this.state.players[idOrIndex];
      if (!p) throw new Error(`No player at index ${idOrIndex}`);
      return p;
    }
    const p = this.state.players.find(pl => pl.id === idOrIndex);
    if (!p) throw new Error(`No player with id ${idOrIndex}`);
    return p;
  }

  /** Get all valid plays for a player's hand */
  getValidPlays(playerIdOrIndex: string | number): Card[][] {
    const p = this.getPlayer(playerIdOrIndex);
    const hand = sortHand(p.hand);
    const validPlays: Card[][] = [];

    // Singles
    for (const c of hand) {
      if (this.wouldBeatPlay([c])) validPlays.push([c]);
    }

    // Pairs
    for (let i = 0; i < hand.length - 1; i++) {
      for (let j = i + 1; j < hand.length; j++) {
        const pair = [hand[i], hand[j]];
        if (classifyCards(pair) !== 'unknown' && this.wouldBeatPlay(pair)) {
          validPlays.push(pair);
        }
      }
    }

    // Triples
    for (let i = 0; i < hand.length - 2; i++) {
      for (let j = i + 1; j < hand.length - 1; j++) {
        for (let k = j + 1; k < hand.length; k++) {
          const triple = [hand[i], hand[j], hand[k]];
          if (classifyCards(triple) !== 'unknown' && this.wouldBeatPlay(triple)) {
            validPlays.push(triple);
          }
        }
      }
    }

    // Five-card combos (simplified — check all sorted 5-card subsets)
    if (hand.length >= 5) {
      for (let i = 0; i < hand.length - 4; i++) {
        for (let j = i + 1; j < hand.length - 3; j++) {
          for (let k = j + 1; k < hand.length - 2; k++) {
            for (let l = k + 1; l < hand.length - 1; l++) {
              for (let m = l + 1; m < hand.length; m++) {
                const combo = [hand[i], hand[j], hand[k], hand[l], hand[m]];
                const ct = classifyCards(combo);
                if (ct !== 'unknown' && this.wouldBeatPlay(combo)) {
                  validPlays.push(combo);
                }
              }
            }
          }
        }
      }
    }

    return validPlays;
  }

  /** Check if a set of cards would beat the current last play */
  wouldBeatPlay(selectedCards: Card[]): boolean {
    if (!this.state.lastPlay) return classifyCards(selectedCards) !== 'unknown';
    return canBeatPlay(selectedCards, this.state.lastPlay);
  }

  /** Check if the highest play detection identifies a play as highest */
  checkHighestPlay(selectedCards: Card[]): boolean {
    return isHighestPossiblePlay(selectedCards, this.state.played_cards);
  }

  /** Get score for a player */
  getScore(playerId: string): number {
    return this.state.matchScores.find(m => m.playerId === playerId)?.score ?? 0;
  }

  /** Snapshot the current state (for comparison) */
  snapshot(): GameState {
    return JSON.parse(JSON.stringify(this.state));
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private advanceTurn(): void {
    let next = (this.state.currentPlayerIndex + 1) % this.state.players.length;
    let attempts = 0;
    // Skip players with empty hands
    while (this.state.players[next].hand.length === 0 && attempts < this.state.players.length) {
      next = (next + 1) % this.state.players.length;
      attempts++;
    }
    this.state.currentPlayerIndex = next;
  }
}

// ─── Multi-Game Runner ───────────────────────────────────────────────────────

/**
 * Run multiple sandbox games in parallel (simulates 20+ devices).
 * Each game runs independently with its own RNG seed.
 */
export class MultiGameRunner {
  private games: Map<string, GameSandbox> = new Map();

  /** Create N games with optional per-game config overrides */
  createGames(
    count: number,
    baseConfig: SandboxConfig = {},
    perGameOverrides?: (index: number) => Partial<SandboxConfig>
  ): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `game-${i}`;
      const overrides = perGameOverrides?.(i) ?? {};
      this.games.set(id, GameSandbox.create({ ...baseConfig, ...overrides }));
      ids.push(id);
    }
    return ids;
  }

  /** Get a specific game */
  getGame(id: string): GameSandbox {
    const g = this.games.get(id);
    if (!g) throw new Error(`Game not found: ${id}`);
    return g;
  }

  /** Run all games to completion using bot AI */
  runAllToCompletion(maxTurns = 1000): Map<
    string,
    {
      winnerId: string | null;
      turns: number;
      finalScores: Record<string, number>;
    }
  > {
    const results = new Map<
      string,
      {
        winnerId: string | null;
        turns: number;
        finalScores: Record<string, number>;
      }
    >();

    for (const [id, game] of this.games) {
      let turns = 0;
      while (!game.state.gameEnded && turns < maxTurns) {
        const current = game.currentPlayer();
        if (current.isBot) {
          game.runBotTurn();
        } else {
          // For human players, auto-play best card or pass
          const validPlays = game.getValidPlays(current.id);
          if (validPlays.length > 0) {
            game.playCards(current.id, validPlays[0]);
          } else if (game.state.lastPlay) {
            game.pass(current.id);
          }
        }
        turns++;
      }

      const finalScores: Record<string, number> = {};
      game.state.players.forEach(p => {
        finalScores[p.id] = p.hand.length;
      });

      results.set(id, {
        winnerId: game.state.winnerId,
        turns,
        finalScores,
      });
    }

    return results;
  }

  /** Get aggregate stats across all games */
  getAggregateStats(): {
    totalGames: number;
    completed: number;
    avgTurns: number;
    winRates: Record<string, number>;
  } {
    let completed = 0;
    let totalTurns = 0;
    const wins: Record<string, number> = {};

    for (const [, game] of this.games) {
      if (game.state.gameEnded) {
        completed++;
        if (game.state.winnerId) {
          wins[game.state.winnerId] = (wins[game.state.winnerId] ?? 0) + 1;
        }
      }
      totalTurns += game.state.roundHistory.length;
    }

    const winRates: Record<string, number> = {};
    for (const [pid, count] of Object.entries(wins)) {
      winRates[pid] = completed > 0 ? count / completed : 0;
    }

    return {
      totalGames: this.games.size,
      completed,
      avgTurns: completed > 0 ? totalTurns / completed : 0,
      winRates,
    };
  }

  /** Get all game instances */
  getAllGames(): Map<string, GameSandbox> {
    return this.games;
  }

  /** Destroy all games */
  clear(): void {
    this.games.clear();
  }
}
