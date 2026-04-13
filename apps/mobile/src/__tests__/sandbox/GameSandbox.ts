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
 *   sb.setHand('player_0', [card('3D'), card('4C')]);
 *   sb.setScores({ 'player_0': 50, 'player_1': 90 });
 *   sb.playCards('player_0', [card('3D')]);
 *   sb.pass('player_1');
 *   expect(sb.state.currentPlayerIndex).toBe(2);
 */

import type { Card, ComboType, LastPlay } from '../../game/types';
import type { GameState, Player } from '../../game/state';
import type { PlayerMatchScore } from '../../game/types';
import {
  sortHand,
  classifyCards,
  canBeatPlay,
  validateOneCardLeftRule,
  canPassWithOneCardLeftRule,
  isHighestPossiblePlay,
} from '../../game/engine';
import { createBotAI, type BotDifficulty, type BotPlayOptions } from '../../game/bot';
import { RANKS, SUITS } from '../../game/engine/constants';

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

/** Deal cards to N players from a deck (optionally pre-shuffled), 13 per player (matches production). */
export function dealCards(numPlayers: number, deck?: Card[]): Card[][] {
  const d = deck ?? shuffle(fullDeck());
  const hands: Card[][] = Array.from({ length: numPlayers }, () => []);
  const limit = Math.min(d.length, numPlayers * 13);
  for (let i = 0; i < limit; i++) {
    hands[i % numPlayers].push(d[i]);
  }
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
    id: isBot ? `bot_${index}` : `player_${index}`,
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
  /** Whether it's the first play of the game (default: true — sandbox starts with no played cards) */
  isFirstPlayOfGame?: boolean;
}

// ─── GameSandbox ─────────────────────────────────────────────────────────────

export class GameSandbox {
  state: GameState;
  private enforceFirstPlay: boolean;

  /** Anticlockwise turn order for 4-player games (matches production GameStateManager.TURN_ORDER) */
  private static readonly TURN_ORDER_4P = [3, 2, 0, 1] as const;

  private constructor(config: SandboxConfig) {
    const numPlayers = config.players ?? 4;
    if (numPlayers < 2 || numPlayers > 4) {
      throw new Error('players must be 2-4');
    }
    this.enforceFirstPlay = config.enforceFirstPlayRule ?? true;

    // Deal or assign hands — remove overridden cards from deck to prevent duplication
    const overriddenCardIds = new Set<string>();
    if (config.hands) {
      // Validate all hands keys are valid player indices
      for (const key of Object.keys(config.hands)) {
        const idx = Number(key);
        if (!Number.isInteger(idx) || idx < 0 || idx >= numPlayers) {
          throw new Error(
            `Invalid hands index ${key}: must be an integer in [0, ${numPlayers - 1}]`
          );
        }
      }
      for (const h of Object.values(config.hands)) {
        for (const c of h) {
          if (overriddenCardIds.has(c.id)) {
            throw new Error(`Duplicate card '${c.id}' in SandboxConfig.hands`);
          }
          overriddenCardIds.add(c.id);
        }
      }
    }
    const filteredDeck =
      overriddenCardIds.size > 0
        ? shuffle(fullDeck().filter(c => !overriddenCardIds.has(c.id)))
        : undefined;
    // Deal only for non-overridden seats so overridden cards don't reduce
    // card counts for other players.
    const overriddenIndices = new Set(Object.keys(config.hands ?? {}).map(Number));
    const nonOverriddenCount = numPlayers - overriddenIndices.size;
    const dealtHands = nonOverriddenCount > 0 ? dealCards(nonOverriddenCount, filteredDeck) : [];
    const hands: Card[][] = [];
    let dealIdx = 0;
    for (let i = 0; i < numPlayers; i++) {
      if (config.hands?.[i]) {
        hands.push(config.hands[i]);
      } else {
        hands.push(dealtHands[dealIdx++] ?? []);
      }
    }

    // When first-play rule is active and fewer than 4 players are dealt,
    // 3D might not appear in any dealt hand. Swap it into the first
    // non-overridden hand so the game can progress.
    const isFirstPlay = (config.currentMatch ?? 1) === 1;
    const firstPlayActive = (config.enforceFirstPlayRule ?? true) && isFirstPlay;
    if (firstPlayActive && !hands.some(h => h.some(c => c.id === '3D'))) {
      const targetIdx = hands.findIndex((_, i) => !overriddenIndices.has(i) && hands[i].length > 0);
      if (targetIdx !== -1) {
        const threeOfDiamonds = fullDeck().find(c => c.id === '3D')!;
        hands[targetIdx][0] = threeOfDiamonds;
      }
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

    // Ensure starting player has cards — skip to next non-empty hand if needed
    if (players[startIdx].hand.length === 0) {
      for (let offset = 1; offset < players.length; offset++) {
        const next = (startIdx + offset) % players.length;
        if (players[next].hand.length > 0) {
          startIdx = next;
          break;
        }
      }
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
      // First-play rule (3♦ must start) only applies to match 1.
      // For match 2+, default to false to match production behavior.
      isFirstPlayOfGame: config.isFirstPlayOfGame ?? (config.currentMatch ?? 1) === 1,
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

  /** Override last play (trick to beat). Pass playerIndex to also update lastPlayPlayerIndex. */
  setLastPlay(play: LastPlay | null, playerIndex?: number): void {
    this.state.lastPlay = play;

    if (play === null) {
      // Null resets the trick — trick winner (lastPlayPlayerIndex) leads next
      this.state.currentPlayerIndex = this.state.lastPlayPlayerIndex;
      this.state.consecutivePasses = 0;
      this.state.players.forEach(p => {
        p.passed = false;
      });
      return;
    }

    // Explicit playerIndex takes priority, then play.player_index, then deprecated play.position
    if (playerIndex !== undefined) {
      this.state.lastPlayPlayerIndex = playerIndex;
    } else if (
      play.player_index != null &&
      play.player_index >= 0 &&
      play.player_index < this.state.players.length
    ) {
      this.state.lastPlayPlayerIndex = play.player_index;
    } else if (
      play.position != null &&
      play.position >= 0 &&
      play.position < this.state.players.length
    ) {
      this.state.lastPlayPlayerIndex = play.position;
    } else {
      // Default to current player to prevent stale lastPlayPlayerIndex
      this.state.lastPlayPlayerIndex = this.state.currentPlayerIndex;
    }
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

    // Reject duplicate card selections (e.g., ['3D','3D'])
    const selectedIds = new Set(selectedCards.map(c => c.id));
    if (selectedIds.size !== selectedCards.length) {
      return { success: false, error: 'Duplicate cards in selection' };
    }

    // Validate all selected cards exist in the player's hand before any classification
    const handIds = new Set(p.hand.map(c => c.id));
    const missingCards = selectedCards.filter(c => !handIds.has(c.id));
    if (missingCards.length > 0) {
      return {
        success: false,
        error: `Cards not in hand: ${missingCards.map(c => c.id).join(', ')}`,
      };
    }

    // Canonicalize to authoritative Card objects from hand (prevents caller
    // from passing cards with correct id but wrong rank/suit)
    const canonical = selectedCards.map(sc => p.hand.find(hc => hc.id === sc.id)!);

    // Classify the combo (only after hand-membership validation passes)
    const comboType = classifyCards(canonical);
    if (comboType === 'unknown') {
      return { success: false, error: 'Invalid card combination' };
    }

    // First play — must include 3♦
    if (this.state.isFirstPlayOfGame && this.enforceFirstPlay) {
      const has3D = canonical.some(c => c.id === '3D');
      if (!has3D) {
        return { success: false, error: 'First play must include 3♦' };
      }
    }

    // Beat existing play
    if (this.state.lastPlay) {
      if (!canBeatPlay(canonical, this.state.lastPlay)) {
        return { success: false, error: 'Cannot beat the current play' };
      }
    }

    // One-card-left rule — find next active player using production turn order
    const nextActiveForPlay = this.findNextActive(idx);
    const nextPlayerCardCount = this.state.players[nextActiveForPlay].hand.length;
    const oneCardResult = validateOneCardLeftRule(
      canonical,
      p.hand,
      nextPlayerCardCount,
      this.state.lastPlay ?? null
    );
    if (!oneCardResult.valid) {
      return { success: false, error: oneCardResult.error ?? 'One-card-left rule violation' };
    }

    // Execute the play
    const cardIds = new Set(canonical.map(c => c.id));
    p.hand = p.hand.filter(c => !cardIds.has(c.id));

    // Clear all players' passed flags on successful play (matches production GameStateManager.executePlay)
    this.state.players.forEach(pl => {
      pl.passed = false;
    });

    // Update state
    this.state.lastPlay = { cards: canonical, combo_type: comboType };
    this.state.lastPlayPlayerIndex = idx;
    this.state.consecutivePasses = 0;
    this.state.isFirstPlayOfGame = false;
    this.state.played_cards.push(...canonical);

    // Record history
    const playEntry = {
      playerId: p.id,
      playerName: p.name,
      cards: canonical,
      combo_type: comboType,
      timestamp: Date.now(),
      passed: false,
      matchNumber: this.state.currentMatch,
    };
    this.state.roundHistory.push(playEntry);
    this.state.gameRoundHistory.push(playEntry);

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

    // Can't pass on the first play of the game (production alignment)
    if (this.state.isFirstPlayOfGame) {
      return { success: false, error: 'Cannot pass on the first play of the game' };
    }

    // One-card-left pass rule — find next active player using production turn order
    const nextActiveForPass = this.findNextActive(idx);
    const nextPlayerCardCount = this.state.players[nextActiveForPass].hand.length;
    const passRuleResult = canPassWithOneCardLeftRule(
      p.hand,
      nextPlayerCardCount,
      this.state.lastPlay
    );
    if (!passRuleResult.canPass) {
      return {
        success: false,
        error: passRuleResult.error ?? 'Must play — one-card-left rule forces a play',
      };
    }

    // Execute pass
    p.passed = true;
    this.state.consecutivePasses++;

    // Record pass in round history ('unknown' is the canonical combo_type for passes)
    const passEntry = {
      playerId: p.id,
      playerName: p.name,
      cards: [] as Card[],
      combo_type: 'unknown' as ComboType,
      timestamp: Date.now(),
      passed: true,
      matchNumber: this.state.currentMatch,
    };
    this.state.roundHistory.push(passEntry);
    this.state.gameRoundHistory.push(passEntry);

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
        const passResult = this.pass(p.id);
        if (!passResult.success) {
          // One-card-left rule may prevent passing — force play highest single
          const sorted = sortHand(p.hand);
          for (let i = sorted.length - 1; i >= 0; i--) {
            const playResult = this.playCards(p.id, [sorted[i]]);
            if (playResult.success) {
              return { action: 'play', cards: [sorted[i]], comboType: playResult.comboType };
            }
          }
          // No valid play possible — force play lowest card to ensure progress
          const forcedCard = sortHand(p.hand)[0];
          this.forcePlayLowest(p);
          return { action: 'play', cards: forcedCard ? [forcedCard] : [] };
        }
      } else {
        // Leading but bot returned null — must play (cannot pass on leadoff)
        const lowest = sortHand(p.hand)[0];
        if (lowest) {
          const playResult = this.playCards(p.id, [lowest]);
          if (playResult.success) {
            return { action: 'play', cards: [lowest], comboType: playResult.comboType };
          }
          // playCards failed (e.g. first-play 3♦ rule) — force play to ensure progress
          this.forcePlayLowest(p);
          return { action: 'play', cards: [lowest] };
        }
      }
      return { action: 'pass' };
    }

    // Convert card IDs to Card objects from hand — warn on unmatched IDs
    const cardObjects: Card[] = [];
    const unmatchedIds: string[] = [];
    for (const id of result.cards) {
      const found = p.hand.find(c => c.id === id);
      if (found) {
        cardObjects.push(found);
      } else {
        unmatchedIds.push(id);
      }
    }
    if (unmatchedIds.length > 0) {
      console.warn(
        `[GameSandbox] Bot ${p.id} returned card IDs not in hand: ${unmatchedIds.join(', ')}`
      );
    }

    if (cardObjects.length === 0) {
      if (this.state.lastPlay) {
        const passResult = this.pass(p.id);
        if (!passResult.success) {
          // Forced to play — try any single
          const sorted = sortHand(p.hand);
          for (let i = sorted.length - 1; i >= 0; i--) {
            const playResult = this.playCards(p.id, [sorted[i]]);
            if (playResult.success) {
              return { action: 'play', cards: [sorted[i]], comboType: playResult.comboType };
            }
          }
          const forcedCard2 = sortHand(p.hand)[0];
          this.forcePlayLowest(p);
          return { action: 'play', cards: forcedCard2 ? [forcedCard2] : [] };
        }
      } else {
        // Leading with no matching cards — force play to ensure progress
        const forcedCard3 = sortHand(p.hand)[0];
        this.forcePlayLowest(p);
        return { action: 'play', cards: forcedCard3 ? [forcedCard3] : [] };
      }
      return { action: 'pass' };
    }

    const playResult = this.playCards(p.id, cardObjects);
    if (!playResult.success) {
      // Fallback: try to pass, then force play lowest to ensure progress
      if (this.state.lastPlay) {
        const passResult = this.pass(p.id);
        if (!passResult.success) {
          const forcedCard = sortHand(p.hand)[0];
          this.forcePlayLowest(p);
          return { action: 'play', cards: forcedCard ? [forcedCard] : [] };
        }
      } else {
        const forcedCard = sortHand(p.hand)[0];
        this.forcePlayLowest(p);
        return { action: 'play', cards: forcedCard ? [forcedCard] : [] };
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

  /** Get all valid plays for a player's hand (accounts for first-play 3♦ and one-card-left rules) */
  getValidPlays(playerIdOrIndex: string | number): Card[][] {
    const p = this.getPlayer(playerIdOrIndex);
    const idx = this.state.players.indexOf(p);
    const hand = sortHand(p.hand);
    const candidates: Card[][] = [];

    // Singles
    for (const c of hand) {
      if (this.wouldBeatPlay([c])) candidates.push([c]);
    }

    // Pairs
    for (let i = 0; i < hand.length - 1; i++) {
      for (let j = i + 1; j < hand.length; j++) {
        const pair = [hand[i], hand[j]];
        if (classifyCards(pair) !== 'unknown' && this.wouldBeatPlay(pair)) {
          candidates.push(pair);
        }
      }
    }

    // Triples
    for (let i = 0; i < hand.length - 2; i++) {
      for (let j = i + 1; j < hand.length - 1; j++) {
        for (let k = j + 1; k < hand.length; k++) {
          const triple = [hand[i], hand[j], hand[k]];
          if (classifyCards(triple) !== 'unknown' && this.wouldBeatPlay(triple)) {
            candidates.push(triple);
          }
        }
      }
    }

    // Five-card combos — only enumerate when lastPlay is null or exactly 5 cards
    if (hand.length >= 5 && (!this.state.lastPlay || this.state.lastPlay.cards.length === 5)) {
      for (let i = 0; i < hand.length - 4; i++) {
        for (let j = i + 1; j < hand.length - 3; j++) {
          for (let k = j + 1; k < hand.length - 2; k++) {
            for (let l = k + 1; l < hand.length - 1; l++) {
              for (let m = l + 1; m < hand.length; m++) {
                const combo = [hand[i], hand[j], hand[k], hand[l], hand[m]];
                const ct = classifyCards(combo);
                if (ct !== 'unknown' && this.wouldBeatPlay(combo)) {
                  candidates.push(combo);
                }
              }
            }
          }
        }
      }
    }

    // Filter: first-play 3♦ requirement
    let validPlays = candidates;
    if (this.state.isFirstPlayOfGame && this.enforceFirstPlay) {
      validPlays = validPlays.filter(play => play.some(c => c.id === '3D'));
    }

    // Filter: one-card-left rule — use production turn order
    const nextActiveIdx = this.findNextActive(idx);
    const nextPlayerCardCount = this.state.players[nextActiveIdx].hand.length;
    validPlays = validPlays.filter(play => {
      const result = validateOneCardLeftRule(
        play,
        p.hand,
        nextPlayerCardCount,
        this.state.lastPlay ?? null
      );
      return result.valid;
    });

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

  /** Force play the lowest card bypassing all rule checks (public for MultiGameRunner) */
  forcePlayLowestPublic(playerIdOrIndex: string | number): void {
    const p = this.getPlayer(playerIdOrIndex);
    this.forcePlayLowest(p);
  }

  /** Force play the lowest card bypassing all rule checks (ensures game progress). Records to roundHistory. */
  private forcePlayLowest(p: Player): void {
    const sorted = sortHand(p.hand);
    const lowest = sorted[0];
    if (!lowest) return;

    // Remove from hand and clear all players' passed flags (matches playCards behavior)
    p.hand = p.hand.filter(c => c.id !== lowest.id);
    this.state.players.forEach(pl => {
      pl.passed = false;
    });

    // Update state as if a valid play occurred
    const idx = this.state.players.indexOf(p);
    this.state.lastPlay = { cards: [lowest], combo_type: 'Single' };
    this.state.lastPlayPlayerIndex = idx;
    this.state.consecutivePasses = 0;
    this.state.isFirstPlayOfGame = false;
    this.state.played_cards.push(lowest);

    // Record forced play in round history for metric consistency (avgTurns, etc.)
    const forceEntry = {
      playerId: p.id,
      playerName: p.name,
      cards: [lowest],
      combo_type: 'Single' as ComboType,
      timestamp: Date.now(),
      passed: false,
      matchNumber: this.state.currentMatch,
    };
    this.state.roundHistory.push(forceEntry);
    this.state.gameRoundHistory.push(forceEntry);

    // Check win
    if (p.hand.length === 0) {
      this.state.gameEnded = true;
      this.state.winnerId = p.id;
    } else {
      this.advanceTurn();
    }
  }

  /** Find next active player from a given index, using production turn order for 4 players */
  private findNextActive(fromIndex: number): number {
    const numPlayers = this.state.players.length;
    let next: number;
    if (numPlayers === 4) {
      next = GameSandbox.TURN_ORDER_4P[fromIndex];
    } else {
      next = (fromIndex + 1) % numPlayers;
    }
    let attempts = 0;
    while (this.state.players[next].hand.length === 0 && attempts < numPlayers) {
      if (numPlayers === 4) {
        next = GameSandbox.TURN_ORDER_4P[next];
      } else {
        next = (next + 1) % numPlayers;
      }
      attempts++;
    }
    return next;
  }

  private advanceTurn(): void {
    this.state.currentPlayerIndex = this.findNextActive(this.state.currentPlayerIndex);
  }
}

// ─── Multi-Game Runner ───────────────────────────────────────────────────────

/**
 * Run multiple sandbox games in parallel (simulates 20+ devices).
 * Each game runs independently as a separate sandbox instance.
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
      cardsRemaining: Record<string, number>;
    }
  > {
    const results = new Map<
      string,
      {
        winnerId: string | null;
        turns: number;
        cardsRemaining: Record<string, number>;
      }
    >();

    for (const [id, game] of this.games) {
      let turns = 0;
      while (!game.state.gameEnded && turns < maxTurns) {
        const current = game.currentPlayer();
        if (current.isBot) {
          game.runBotTurn();
        } else {
          // For human players, auto-play first valid card or pass/force
          const validPlays = game.getValidPlays(current.id);
          if (validPlays.length > 0) {
            const playResult = game.playCards(current.id, validPlays[0]);
            if (!playResult.success) {
              // Valid-play was rejected (e.g. first-play 3♦) — fall through to pass or force
              if (game.state.lastPlay) {
                const passResult = game.pass(current.id);
                if (!passResult.success) {
                  game.forcePlayLowestPublic(current.id);
                }
              } else {
                game.forcePlayLowestPublic(current.id);
              }
            }
          } else if (game.state.lastPlay) {
            const passResult = game.pass(current.id);
            if (!passResult.success) {
              // One-card-left rule prevents passing — force play
              game.forcePlayLowestPublic(current.id);
            }
          } else {
            // Leading with no valid plays — force play to ensure progress
            game.forcePlayLowestPublic(current.id);
          }
        }
        turns++;
      }

      const cardsRemaining: Record<string, number> = {};
      game.state.players.forEach(p => {
        cardsRemaining[p.id] = p.hand.length;
      });

      results.set(id, {
        winnerId: game.state.winnerId,
        turns,
        cardsRemaining,
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
      // Only count completed games to avoid inflating avgTurns with partial games
      if (game.state.gameEnded) {
        completed++;
        totalTurns += game.state.roundHistory.length;
        if (game.state.winnerId) {
          wins[game.state.winnerId] = (wins[game.state.winnerId] ?? 0) + 1;
        }
      }
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
