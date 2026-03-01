/**
 * BotAI for Edge Functions (Deno)
 *
 * Server-side port of apps/mobile/src/game/bot/index.ts.
 * Provides intelligent card playing with configurable difficulty levels.
 *
 * Keep in sync with the client-side BotAI when modifying bot behavior.
 *
 * @module botAI
 */

import {
  sortHand,
  classifyCards,
  canBeatPlay,
  findRecommendedPlay,
  findHighestBeatingSingle,
  type Card,
  type LastPlay,
  type ComboType,
} from './gameEngine.ts';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface BotPlayOptions {
  hand: Card[];
  lastPlay: LastPlay | null;
  isFirstPlayOfGame: boolean;
  matchNumber?: number;
  playerCardCounts: number[];
  currentPlayerIndex: number;
  nextPlayerIndex?: number;
  difficulty?: BotDifficulty;
}

export interface BotPlayResult {
  cards: string[] | null;
  reasoning?: string;
}

/**
 * Bot AI class for Big Two game (server-side)
 *
 * Difficulty levels:
 * - Easy: Random valid plays, high pass rate
 * - Medium: Basic strategy with some mistakes
 * - Hard: Optimal play using game theory
 */
export class BotAI {
  private readonly _difficulty: BotDifficulty;

  constructor(difficulty: BotDifficulty = 'medium') {
    this._difficulty = difficulty;
  }

  get difficulty(): BotDifficulty {
    return this._difficulty;
  }

  public getPlay(options: BotPlayOptions): BotPlayResult {
    const { hand, lastPlay, isFirstPlayOfGame, matchNumber, playerCardCounts, currentPlayerIndex, nextPlayerIndex } = options;

    if (hand.length === 0) {
      return { cards: null, reasoning: 'No cards in hand' };
    }

    const MAX_MATCH_NUMBER = 1000;
    let currentMatch: number;
    if (typeof matchNumber === 'number') {
      if (Number.isInteger(matchNumber) && matchNumber > 0 && matchNumber <= MAX_MATCH_NUMBER) {
        currentMatch = matchNumber;
      } else if (!Number.isInteger(matchNumber)) {
        console.warn(`[BotAI] ⚠️ Non-integer matchNumber "${matchNumber}" received; defaulting to match 1.`);
        currentMatch = 1;
      } else {
        console.warn(`[BotAI] ⚠️ Out-of-range matchNumber "${matchNumber}" received; defaulting to match 1.`);
        currentMatch = 1;
      }
    } else {
      if (matchNumber !== undefined) {
        console.warn(`[BotAI] ⚠️ Non-numeric matchNumber "${String(matchNumber)}" received; defaulting to match 1.`);
      }
      currentMatch = 1;
    }

    if (isFirstPlayOfGame && currentMatch === 1) {
      return this.handleFirstPlay(hand);
    }

    if (!lastPlay) {
      return this.handleLeading(hand, playerCardCounts, currentPlayerIndex, nextPlayerIndex);
    }

    return this.handleFollowing(hand, lastPlay, playerCardCounts, currentPlayerIndex, nextPlayerIndex);
  }

  // ==================== FIRST PLAY ====================

  private handleFirstPlay(hand: Card[]): BotPlayResult {
    const sorted = sortHand(hand);
    const threeD = sorted.find(c => c.rank === '3' && c.suit === 'D');
    if (!threeD) return { cards: null, reasoning: 'No 3D found' };

    if (this._difficulty === 'hard') {
      const comboWith3D = this.findBestComboWith3D(sorted, threeD);
      if (comboWith3D) return { cards: comboWith3D, reasoning: `[HARD] Playing combo with 3D: ${comboWith3D.length} cards` };
    }

    if (this._difficulty === 'medium' && Math.random() < 0.5) {
      const pairs = this.findAllPairs(sorted);
      const candidatePairs = pairs.filter(pair => pair.includes(threeD.id));
      if (candidatePairs.length > 0) {
        const idToIndex = new Map<string, number>();
        for (let i = 0; i < sorted.length; i++) idToIndex.set(sorted[i].id, i);
        let bestPair = candidatePairs[0];
        let bestStrength = Math.max(
          idToIndex.get(bestPair[0]) ?? Number.MAX_SAFE_INTEGER,
          idToIndex.get(bestPair[1]) ?? Number.MAX_SAFE_INTEGER,
        );
        for (let i = 1; i < candidatePairs.length; i++) {
          const pair = candidatePairs[i];
          const strength = Math.max(
            idToIndex.get(pair[0]) ?? Number.MAX_SAFE_INTEGER,
            idToIndex.get(pair[1]) ?? Number.MAX_SAFE_INTEGER,
          );
          if (strength < bestStrength) { bestStrength = strength; bestPair = pair; }
        }
        return { cards: bestPair, reasoning: '[MEDIUM] Playing pair with 3D' };
      }
    }

    return { cards: [threeD.id], reasoning: `[${this._difficulty.toUpperCase()}] Playing 3D as single` };
  }

  // ==================== LEADING ====================

  private handleLeading(
    hand: Card[], playerCardCounts: number[], currentPlayerIndex: number, nextPlayerIndex?: number,
  ): BotPlayResult {
    const sorted = sortHand(hand);
    const activeOpponentCounts = playerCardCounts.filter((_count, index) => index !== currentPlayerIndex && _count > 0);
    const minOpponentCards = activeOpponentCounts.length > 0 ? Math.min(...activeOpponentCounts) : 0;

    const nextActivePlayer = nextPlayerIndex !== undefined
      ? nextPlayerIndex
      : this.findNextActivePlayer(currentPlayerIndex, playerCardCounts);
    const nextPlayerCardCount = nextActivePlayer !== -1 ? playerCardCounts[nextActivePlayer] : 0;

    if (nextPlayerCardCount === 1) {
      const highestSingle = sorted[sorted.length - 1];
      return { cards: [highestSingle.id], reasoning: `One Card Left rule (leading): must play highest single (${highestSingle.rank}${highestSingle.suit})` };
    }

    // EASY
    if (this._difficulty === 'easy') {
      if (Math.random() < 0.25 && sorted.length > 3) {
        const highIndex = Math.max(sorted.length - 3, Math.floor(sorted.length * 0.7));
        const badCard = sorted[highIndex];
        return { cards: [badCard.id], reasoning: `[EASY] Wastefully leading with high single (${badCard.rank}${badCard.suit})` };
      }
      return { cards: [sorted[0].id], reasoning: '[EASY] Leading with lowest single' };
    }

    // HARD
    if (this._difficulty === 'hard') {
      if (minOpponentCards <= 4) {
        const fiveCardCombo = this.findBest5CardCombo(sorted);
        if (fiveCardCombo) return { cards: fiveCardCombo, reasoning: `[HARD] Opponent has ${minOpponentCards} cards, playing 5-card combo` };
      }
      if (sorted.length > 8) {
        const triples = this.findAllTriples(sorted);
        if (triples.length > 0) return { cards: triples[0], reasoning: '[HARD] Leading with triple to shed cards fast' };
      }
      const lowestPair = this.findLowestPair(sorted);
      if (lowestPair && sorted.length > 4) return { cards: lowestPair, reasoning: '[HARD] Leading with lowest pair' };
      return { cards: [sorted[0].id], reasoning: '[HARD] Leading with lowest single' };
    }

    // MEDIUM
    if (Math.random() < 0.4) {
      const lowestPair = this.findLowestPair(sorted);
      if (lowestPair) return { cards: lowestPair, reasoning: '[MEDIUM] Leading with pair' };
    }
    if (Math.random() < 0.15 && sorted.length >= 5) {
      const fiveCardCombo = this.findBest5CardCombo(sorted);
      if (fiveCardCombo) return { cards: fiveCardCombo, reasoning: '[MEDIUM] Leading with 5-card combo' };
    }
    return { cards: [sorted[0].id], reasoning: '[MEDIUM] Leading with lowest single' };
  }

  // ==================== FOLLOWING ====================

  private handleFollowing(
    hand: Card[], lastPlay: LastPlay, playerCardCounts: number[],
    currentPlayerIndex: number, nextPlayerIndex?: number,
  ): BotPlayResult {
    const sorted = sortHand(hand);
    const activeOpponentCounts = playerCardCounts.filter((_count, index) => index !== currentPlayerIndex && _count > 0);
    const minOpponentCards = activeOpponentCounts.length > 0 ? Math.min(...activeOpponentCounts) : 0;

    const nextActivePlayer = nextPlayerIndex !== undefined
      ? nextPlayerIndex
      : this.findNextActivePlayer(currentPlayerIndex, playerCardCounts);
    const nextPlayerCardCount = nextActivePlayer !== -1 ? playerCardCounts[nextActivePlayer] : 0;

    const lastPlayPosition = lastPlay.position ?? lastPlay.player_index ?? 0;
    const lastPlayPlayerCardCount = playerCardCounts[lastPlayPosition];
    const lastPlayerHasWon = lastPlayPlayerCardCount === 0;

    if (!lastPlayerHasWon && nextPlayerCardCount === 1 && lastPlay.cards.length === 1) {
      const highestSingle = findHighestBeatingSingle(sorted, lastPlay);
      if (highestSingle) {
        return { cards: [highestSingle.id], reasoning: `One Card Left rule: must play highest single (${highestSingle.rank}${highestSingle.suit})` };
      }
    }

    // EASY
    if (this._difficulty === 'easy') {
      if (Math.random() < 0.5) return { cards: null, reasoning: '[EASY] Randomly passing (50% pass rate)' };
      const validPlays = this.findAllValidPlays(sorted, lastPlay);
      if (validPlays.length === 0) return { cards: null, reasoning: '[EASY] Cannot beat last play' };
      if (Math.random() < 0.6) return { cards: validPlays[0], reasoning: '[EASY] Playing lowest valid play' };
      const randomPlay = validPlays[Math.floor(Math.random() * validPlays.length)];
      return { cards: randomPlay, reasoning: '[EASY] Playing random valid play' };
    }

    // HARD
    if (this._difficulty === 'hard') {
      const validPlays = this.findAllValidPlays(sorted, lastPlay);
      if (validPlays.length === 0) return { cards: null, reasoning: '[HARD] Cannot beat last play' };
      if (minOpponentCards <= 2) {
        const highestPlay = validPlays[validPlays.length - 1];
        return { cards: highestPlay, reasoning: `[HARD] Opponent has ${minOpponentCards} cards - playing highest to block` };
      }
      if (minOpponentCards > 6) return { cards: validPlays[0], reasoning: '[HARD] Playing lowest valid - saving high cards' };
      const recommended = findRecommendedPlay(hand, lastPlay, false);
      if (recommended) return { cards: recommended, reasoning: '[HARD] Playing engine-recommended optimal play' };
      return { cards: validPlays[0], reasoning: '[HARD] Playing lowest valid play' };
    }

    // MEDIUM
    if (Math.random() < 0.12) return { cards: null, reasoning: '[MEDIUM] Strategically passing' };
    const recommended = findRecommendedPlay(hand, lastPlay, false);
    if (!recommended) return { cards: null, reasoning: '[MEDIUM] Cannot beat last play' };
    return { cards: recommended, reasoning: `[MEDIUM] Playing recommended: ${recommended.length} cards` };
  }

  // ==================== HELPER METHODS ====================

  private findBestComboWith3D(hand: Card[], threeD: Card): string[] | null {
    const triples = this.findAllTriples(hand);
    for (const triple of triples) {
      if (triple.includes(threeD.id)) return triple;
    }
    const pairs = this.findAllPairs(hand);
    for (const pair of pairs) {
      if (pair.includes(threeD.id)) return pair;
    }
    return null;
  }

  private findBest5CardCombo(hand: Card[]): string[] | null {
    if (hand.length < 5) return null;
    const n = hand.length;
    for (let a = 0; a < n - 4; a++) {
      for (let b = a + 1; b < n - 3; b++) {
        for (let c = b + 1; c < n - 2; c++) {
          for (let d = c + 1; d < n - 1; d++) {
            for (let e = d + 1; e < n; e++) {
              const fiveCards = [hand[a], hand[b], hand[c], hand[d], hand[e]];
              const combo = classifyCards(fiveCards);
              if (this.is5CardCombo(combo)) return fiveCards.map(c => c.id);
            }
          }
        }
      }
    }
    return null;
  }

  private findLowestPair(hand: Card[]): string[] | null {
    for (let i = 0; i < hand.length - 1; i++) {
      if (hand[i].rank === hand[i + 1].rank) return [hand[i].id, hand[i + 1].id];
    }
    return null;
  }

  private findAllPairs(hand: Card[]): string[][] {
    const pairs: string[][] = [];
    const rankGroups: Record<string, Card[]> = {};
    for (const card of hand) {
      if (!rankGroups[card.rank]) rankGroups[card.rank] = [];
      rankGroups[card.rank].push(card);
    }
    for (const rank in rankGroups) {
      const group = rankGroups[rank];
      if (group.length >= 2) {
        pairs.push([group[0].id, group[1].id]);
        if (group.length >= 3) {
          pairs.push([group[0].id, group[2].id]);
          pairs.push([group[1].id, group[2].id]);
        }
        if (group.length === 4) {
          pairs.push([group[0].id, group[3].id]);
          pairs.push([group[1].id, group[3].id]);
          pairs.push([group[2].id, group[3].id]);
        }
      }
    }
    return pairs;
  }

  private findAllTriples(hand: Card[]): string[][] {
    const triples: string[][] = [];
    const rankGroups: Record<string, Card[]> = {};
    for (const card of hand) {
      if (!rankGroups[card.rank]) rankGroups[card.rank] = [];
      rankGroups[card.rank].push(card);
    }
    for (const rank in rankGroups) {
      const group = rankGroups[rank];
      if (group.length >= 3) {
        triples.push([group[0].id, group[1].id, group[2].id]);
        if (group.length === 4) {
          triples.push([group[0].id, group[1].id, group[3].id]);
          triples.push([group[0].id, group[2].id, group[3].id]);
          triples.push([group[1].id, group[2].id, group[3].id]);
        }
      }
    }
    return triples;
  }

  private findAllValidPlays(hand: Card[], lastPlay: LastPlay): string[][] {
    const validPlays: string[][] = [];
    const numCards = lastPlay.cards.length;

    if (numCards === 1) {
      for (const card of hand) {
        if (canBeatPlay([card], lastPlay)) validPlays.push([card.id]);
      }
    } else if (numCards === 2) {
      const pairs = this.findAllPairs(hand);
      for (const pair of pairs) {
        const pairCards = pair.map(id => hand.find(c => c.id === id)!);
        if (canBeatPlay(pairCards, lastPlay)) validPlays.push(pair);
      }
    } else if (numCards === 3) {
      const triples = this.findAllTriples(hand);
      for (const triple of triples) {
        const tripleCards = triple.map(id => hand.find(c => c.id === id)!);
        if (canBeatPlay(tripleCards, lastPlay)) validPlays.push(triple);
      }
    } else if (numCards === 5) {
      const n = hand.length;
      if (n > 13) return validPlays;
      for (let a = 0; a < n - 4; a++) {
        for (let b = a + 1; b < n - 3; b++) {
          for (let c = b + 1; c < n - 2; c++) {
            for (let d = c + 1; d < n - 1; d++) {
              for (let e = d + 1; e < n; e++) {
                const fiveCards = [hand[a], hand[b], hand[c], hand[d], hand[e]];
                if (canBeatPlay(fiveCards, lastPlay)) validPlays.push(fiveCards.map(c => c.id));
              }
            }
          }
        }
      }
      if (validPlays.length > 1) {
        const byId = new Map(hand.map(c => [c.id, c] as const));
        validPlays.sort((a, b) => {
          const cardsA = a.map(id => byId.get(id)!);
          const cardsB = b.map(id => byId.get(id)!);
          const classA = classifyCards(cardsA);
          const classB = classifyCards(cardsB);
          const aBeatsB = canBeatPlay(cardsA, { position: 0, cards: cardsB, combo_type: classB });
          const bBeatsA = canBeatPlay(cardsB, { position: 0, cards: cardsA, combo_type: classA });
          if (aBeatsB && !bBeatsA) return 1;
          if (!aBeatsB && bBeatsA) return -1;
          return 0;
        });
      }
    }

    return validPlays;
  }

  private findNextActivePlayer(currentPlayerIndex: number, playerCardCounts: number[]): number {
    // Counterclockwise: 0→1→2→3→0 (matches Edge Function turn order)
    const numPlayers = playerCardCounts.length;
    let nextIndex = (currentPlayerIndex + 1) % numPlayers;
    const startIndex = nextIndex;
    let iterations = 0;
    do {
      if (playerCardCounts[nextIndex] > 0) return nextIndex;
      nextIndex = (nextIndex + 1) % numPlayers;
    } while (nextIndex !== startIndex && ++iterations < numPlayers);
    return -1;
  }

  private is5CardCombo(combo: ComboType): boolean {
    return ['Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'].includes(combo);
  }
}

export function createBotAI(difficulty: BotDifficulty = 'medium'): BotAI {
  return new BotAI(difficulty);
}
