/**
 * Bot AI system for Big Two mobile game
 * Provides intelligent card playing with configurable difficulty levels
 */

import { 
  sortHand, 
  classifyCards, 
  canBeatPlay, 
  findRecommendedPlay,
  findHighestBeatingSingle,
  type Card,
  type LastPlay,
  type ComboType
} from '../engine';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface BotPlayOptions {
  hand: Card[];
  lastPlay: LastPlay | null;
  isFirstPlayOfGame: boolean;
  matchNumber?: number; // Current match number (1, 2, 3, etc.)
  playerCardCounts: number[];
  currentPlayerIndex: number; // Index of the current bot player
  difficulty?: BotDifficulty;
}

export interface BotPlayResult {
  cards: string[] | null; // Card IDs to play, null = pass
  reasoning?: string; // For debugging
}

/**
 * Bot AI class for Big Two game
 * 
 * Difficulty levels:
 * - Easy: Random valid plays, high pass rate
 * - Medium: Basic strategy with some mistakes
 * - Hard: Optimal play using game theory
 */
export class BotAI {
  public readonly difficulty: BotDifficulty;

  constructor(difficulty: BotDifficulty = 'medium') {
    this.difficulty = difficulty;
  }

  /**
   * Get the bot's play decision
   */
  public getPlay(options: BotPlayOptions): BotPlayResult {
    const { hand, lastPlay, isFirstPlayOfGame, matchNumber, playerCardCounts, currentPlayerIndex } = options;
    
    if (hand.length === 0) {
      return { cards: null, reasoning: 'No cards in hand' };
    }

    // First play of MATCH 1 ONLY - must include 3D
    // Match 2+ can start with any valid play
    // Tests: See bot-matchNumber.test.ts for comprehensive unit test coverage
    // @copilot-review-fix (Round 9): Separate warnings for different invalid matchNumber types
    const MAX_MATCH_NUMBER = 1000; // Reasonable upper bound for match count
    let currentMatch: number;
    if (typeof matchNumber === 'number') {
      if (Number.isInteger(matchNumber) && matchNumber > 0 && matchNumber <= MAX_MATCH_NUMBER) {
        currentMatch = matchNumber;
      } else if (!Number.isInteger(matchNumber)) {
        console.warn(`[BotAI] ⚠️ Non-integer matchNumber "${matchNumber}" received (expected integer 1-${MAX_MATCH_NUMBER}); defaulting to match 1.`);
        currentMatch = 1;
      } else {
        console.warn(`[BotAI] ⚠️ Out-of-range matchNumber "${matchNumber}" received (expected: 1-${MAX_MATCH_NUMBER}); defaulting to match 1.`);
        currentMatch = 1;
      }
    } else {
      if (matchNumber !== undefined) {
        console.warn(`[BotAI] ⚠️ Non-numeric matchNumber "${String(matchNumber)}" received (expected integer 1-${MAX_MATCH_NUMBER}); defaulting to match 1.`);
      }
      currentMatch = 1;
    }
    if (isFirstPlayOfGame && currentMatch === 1) {
      return this.handleFirstPlay(hand);
    }

    // Leading (no last play) - Match 2+ or after trick cleared
    if (!lastPlay) {
      return this.handleLeading(hand, playerCardCounts, currentPlayerIndex);
    }

    // Following - try to beat last play
    return this.handleFollowing(hand, lastPlay, playerCardCounts, currentPlayerIndex);
  }

  /**
   * Handle first play of game (must include 3D)
   */
  private handleFirstPlay(hand: Card[]): BotPlayResult {
    const sorted = sortHand(hand);
    const threeD = sorted.find(c => c.rank === '3' && c.suit === 'D');

    if (!threeD) {
      return { cards: null, reasoning: 'No 3D found' };
    }

    // Hard: Always search for best combo with 3D (pair/triple)
    if (this.difficulty === 'hard') {
      const comboWith3D = this.findBestComboWith3D(sorted, threeD);
      if (comboWith3D) {
        return { 
          cards: comboWith3D, 
          reasoning: `[HARD] Playing combo with 3D: ${comboWith3D.length} cards` 
        };
      }
    }

    // Medium: 50% chance to search for pair with 3D
    // @copilot-review-fix (Round 1): Use sorted hand index to pick lowest-strength pair with 3D
    if (this.difficulty === 'medium' && Math.random() < 0.5) {
      const pairs = this.findAllPairs(sorted);
      const candidatePairs = pairs.filter(pair => pair.includes(threeD.id));

      if (candidatePairs.length > 0) {
        // Build lookup from card id to its index in the Big Two-sorted hand
        const idToIndex = new Map<string, number>();
        for (let i = 0; i < sorted.length; i++) {
          idToIndex.set(sorted[i].id, i);
        }

        // Choose the "lowest" pair by Big Two order, based on positions in `sorted`
        let bestPair = candidatePairs[0];
        let bestStrength = Math.max(
          idToIndex.get(bestPair[0]) ?? Number.MAX_SAFE_INTEGER,
          idToIndex.get(bestPair[1]) ?? Number.MAX_SAFE_INTEGER
        );

        for (let i = 1; i < candidatePairs.length; i++) {
          const pair = candidatePairs[i];
          const strength = Math.max(
            idToIndex.get(pair[0]) ?? Number.MAX_SAFE_INTEGER,
            idToIndex.get(pair[1]) ?? Number.MAX_SAFE_INTEGER
          );

          if (strength < bestStrength) {
            bestStrength = strength;
            bestPair = pair;
          }
        }

        return {
          cards: bestPair,
          reasoning: `[MEDIUM] Playing pair with 3D`
        };
      }
    }

    // Easy: Always just play 3D as single (no combo search)
    // Medium fallback: play 3D as single
    return { cards: [threeD.id], reasoning: `[${this.difficulty.toUpperCase()}] Playing 3D as single` };
  }

  /**
   * Handle leading (no previous play to beat)
   * 
   * Difficulty behavior:
   * - EASY: Always leads with lowest single. No strategy. Sometimes leads with HIGHEST single (bad play).
   * - MEDIUM: Occasionally leads with pairs (40%). Basic strategy.
   * - HARD: Strategic combo play. Leads with pairs/triples to preserve singles. 5-card combos when opponent is low.
   */
  private handleLeading(hand: Card[], playerCardCounts: number[], currentPlayerIndex: number): BotPlayResult {
    const sorted = sortHand(hand);
    // @copilot-review-fix (Round 1): Compute opponent cards by index, not by value comparison
    const opponentCounts = playerCardCounts
      .map((count, index) => (index !== currentPlayerIndex && count > 0 ? count : Number.POSITIVE_INFINITY));
    const minOpponentCards = Math.min(...opponentCounts);

    // CRITICAL: Check "One Card Left" rule when leading
    // Anticlockwise turn order matching game engine: 0→3→1→2→0
    const nextActivePlayer = this.findNextActivePlayer(currentPlayerIndex, playerCardCounts);
    const nextPlayerCardCount = nextActivePlayer !== -1 ? playerCardCounts[nextActivePlayer] : 0;
    
    // If next player has 1 card, MUST lead with highest single to block them
    if (nextPlayerCardCount === 1) {
      const highestSingle = sorted[sorted.length - 1];
      return {
        cards: [highestSingle.id],
        reasoning: `One Card Left rule (leading): must play highest single (${highestSingle.rank}${highestSingle.suit}) - next player has 1 card`
      };
    }

    // ========== EASY DIFFICULTY: Dumb leading ==========
    if (this.difficulty === 'easy') {
      // 25% chance to make a BAD play: lead with a high single (wasting good cards)
      if (Math.random() < 0.25 && sorted.length > 3) {
        const highIndex = Math.max(sorted.length - 3, Math.floor(sorted.length * 0.7));
        const badCard = sorted[highIndex];
        return { cards: [badCard.id], reasoning: `[EASY] Wastefully leading with high single (${badCard.rank}${badCard.suit})` };
      }
      // Default: always lead with lowest single (no pair/combo strategy)
      return { cards: [sorted[0].id], reasoning: '[EASY] Leading with lowest single (no combo awareness)' };
    }

    // ========== HARD DIFFICULTY: Strategic leading ==========
    if (this.difficulty === 'hard') {
      // If opponent is low on cards, try 5-card combo to force a pass
      if (minOpponentCards <= 4) {
        const fiveCardCombo = this.findBest5CardCombo(sorted);
        if (fiveCardCombo) {
          return { 
            cards: fiveCardCombo, 
            reasoning: `[HARD] Opponent has ${minOpponentCards} cards, playing 5-card combo to force pass` 
          };
        }
      }

      // If we have many cards, try to lead with triples to shed cards fast
      if (sorted.length > 8) {
        const triples = this.findAllTriples(sorted);
        if (triples.length > 0) {
          return { cards: triples[0], reasoning: '[HARD] Leading with triple to shed cards fast' };
        }
      }

      // Try to lead with pairs to preserve singles for endgame
      const lowestPair = this.findLowestPair(sorted);
      if (lowestPair && sorted.length > 4) {
        return { cards: lowestPair, reasoning: '[HARD] Leading with lowest pair (preserving singles)' };
      }

      // If low on cards, play lowest single
      return { cards: [sorted[0].id], reasoning: '[HARD] Leading with lowest single' };
    }

    // ========== MEDIUM DIFFICULTY: Balanced leading ==========
    // 40% chance to lead with pairs
    if (Math.random() < 0.4) {
      const lowestPair = this.findLowestPair(sorted);
      if (lowestPair) {
        return { cards: lowestPair, reasoning: '[MEDIUM] Leading with pair' };
      }
    }

    // 15% chance to try 5-card combo
    if (Math.random() < 0.15 && sorted.length >= 5) {
      const fiveCardCombo = this.findBest5CardCombo(sorted);
      if (fiveCardCombo) {
        return { cards: fiveCardCombo, reasoning: '[MEDIUM] Leading with 5-card combo' };
      }
    }

    // Default: lead with lowest single
    return { cards: [sorted[0].id], reasoning: '[MEDIUM] Leading with lowest single' };
  }

  /**
   * Handle following (trying to beat last play)
   * 
   * Difficulty behavior:
   * - EASY: 50% pass rate. When plays, picks weakest valid play. Sometimes plays random.
   * - MEDIUM: 12% pass rate. Uses recommended (optimal lowest) play.
   * - HARD: 0% random pass. Plays optimally. Saves high cards. Exploits low-card opponents.
   */
  private handleFollowing(
    hand: Card[], 
    lastPlay: LastPlay, 
    playerCardCounts: number[],
    currentPlayerIndex: number
  ): BotPlayResult {
    const sorted = sortHand(hand);
    // @copilot-review-fix (Round 1): Compute opponent cards by index, not by value comparison
    const opponentCounts = playerCardCounts
      .map((count, index) => (index !== currentPlayerIndex && count > 0 ? count : Number.POSITIVE_INFINITY));
    const minOpponentCards = Math.min(...opponentCounts);

    // Check "One Card Left" rule
    // Anticlockwise turn order matching game engine: 0→3→1→2→0
    const nextActivePlayer = this.findNextActivePlayer(currentPlayerIndex, playerCardCounts);
    const nextPlayerCardCount = nextActivePlayer !== -1 ? playerCardCounts[nextActivePlayer] : 0;
    
    // CRITICAL FIX: Check if the player who made lastPlay has won the round (0 cards)
    const lastPlayPlayerCardCount = playerCardCounts[lastPlay.position];
    const lastPlayerHasWon = lastPlayPlayerCardCount === 0;
    
    // If next player has 1 card and last play was a single, MUST play highest single
    if (!lastPlayerHasWon && nextPlayerCardCount === 1 && lastPlay.cards.length === 1) {
      const highestSingle = findHighestBeatingSingle(sorted, lastPlay);
      if (highestSingle) {
        return {
          cards: [highestSingle.id],
          reasoning: `One Card Left rule: must play highest single (${highestSingle.rank}${highestSingle.suit}) - opponent has 1 card`
        };
      }
    }

    // ========== EASY DIFFICULTY: Dumb following ==========
    if (this.difficulty === 'easy') {
      // 50% chance to pass even if can beat (very passive)
      if (Math.random() < 0.5) {
        return { cards: null, reasoning: '[EASY] Randomly passing (50% pass rate)' };
      }

      const validPlays = this.findAllValidPlays(sorted, lastPlay);
      if (validPlays.length === 0) {
        return { cards: null, reasoning: '[EASY] Cannot beat last play' };
      }

      // Easy: 60% play the LOWEST valid play, 40% play random valid play
      // This means easy bots sometimes waste high cards, sometimes play too conservatively
      if (Math.random() < 0.6) {
        // Play lowest (weakest) valid play
        return { 
          cards: validPlays[0], 
          reasoning: '[EASY] Playing lowest valid play (no optimization)' 
        };
      } else {
        // Play random valid play (could be wastefully high)
        const randomPlay = validPlays[Math.floor(Math.random() * validPlays.length)];
        return { 
          cards: randomPlay, 
          reasoning: '[EASY] Playing random valid play' 
        };
      }
    }

    // ========== HARD DIFFICULTY: Optimal following ==========
    if (this.difficulty === 'hard') {
      const validPlays = this.findAllValidPlays(sorted, lastPlay);
      if (validPlays.length === 0) {
        return { cards: null, reasoning: '[HARD] Cannot beat last play' };
      }

      // If opponent is about to win (1-2 cards), play highest possible to block
      if (minOpponentCards <= 2) {
        const highestPlay = validPlays[validPlays.length - 1];
        return { 
          cards: highestPlay, 
          reasoning: `[HARD] Opponent has ${minOpponentCards} cards - playing highest to block` 
        };
      }

      // Strategic card saving: if we have high value cards and opponent has lots of cards,
      // save them and play the LOWEST valid play
      if (minOpponentCards > 6) {
        // Always play lowest valid play when opponents have many cards (save high cards)
        return { 
          cards: validPlays[0], 
          reasoning: '[HARD] Playing lowest valid - saving high cards (opponents have many)' 
        };
      }

      // Mid-game: use recommended play (engine's optimal choice)
      const recommended = findRecommendedPlay(hand, lastPlay, false);
      if (recommended) {
        return { 
          cards: recommended, 
          reasoning: '[HARD] Playing engine-recommended optimal play' 
        };
      }

      // Fallback to lowest valid
      return { cards: validPlays[0], reasoning: '[HARD] Playing lowest valid play' };
    }

    // ========== MEDIUM DIFFICULTY: Balanced following ==========
    // 12% chance to strategically pass
    if (Math.random() < 0.12) {
      return { cards: null, reasoning: '[MEDIUM] Strategically passing' };
    }

    const recommended = findRecommendedPlay(hand, lastPlay, false);
    if (!recommended) {
      return { cards: null, reasoning: '[MEDIUM] Cannot beat last play' };
    }

    return { 
      cards: recommended, 
      reasoning: `[MEDIUM] Playing recommended: ${recommended.length} cards` 
    };
  }

  /**
   * Find best combo that includes a specific card (for 3D requirement)
   */
  private findBestComboWith3D(hand: Card[], threeD: Card): string[] | null {
    // Try to find triple with 3D
    const triples = this.findAllTriples(hand);
    for (const triple of triples) {
      if (triple.includes(threeD.id)) {
        return triple;
      }
    }

    // Try to find pair with 3D
    const pairs = this.findAllPairs(hand);
    for (const pair of pairs) {
      if (pair.includes(threeD.id)) {
        return pair;
      }
    }

    return null;
  }

  /**
   * Find a valid 5-card combo in hand (returns weakest available).
   * @copilot-review-fix (Round 1): Search all C(n,5) combinations, not just contiguous slices,
   * so non-contiguous combos like flushes are found.
   * @copilot-review-fix (Round 2): Removed dead bestCombo variable. Since the hand is sorted
   * by Big Two rank order and we iterate from lowest indices, the first valid combo found
   * uses the weakest cards, conserving stronger cards for later plays.
   */
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
              if (this.is5CardCombo(combo)) {
                // Return first valid combo found (hand is sorted, so lowest-indexed cards are weakest)
                return fiveCards.map(c => c.id);
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Find lowest pair in hand
   */
  private findLowestPair(hand: Card[]): string[] | null {
    for (let i = 0; i < hand.length - 1; i++) {
      if (hand[i].rank === hand[i + 1].rank) {
        return [hand[i].id, hand[i + 1].id];
      }
    }
    return null;
  }

  /**
   * Find all pairs in hand
   */
  private findAllPairs(hand: Card[]): string[][] {
    const pairs: string[][] = [];
    const rankGroups: Record<string, Card[]> = {};
    
    // Group cards by rank
    for (const card of hand) {
      if (!rankGroups[card.rank]) {
        rankGroups[card.rank] = [];
      }
      rankGroups[card.rank].push(card);
    }
    
    // Find all pairs (groups of 2+ cards with same rank)
    for (const rank in rankGroups) {
      const group = rankGroups[rank];
      if (group.length >= 2) {
        // Add first pair found for this rank
        pairs.push([group[0].id, group[1].id]);
        
        // If 3+ cards of same rank, add other pair combinations
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

  /**
   * Find all triples in hand
   */
  private findAllTriples(hand: Card[]): string[][] {
    const triples: string[][] = [];
    const rankGroups: Record<string, Card[]> = {};
    
    // Group cards by rank
    for (const card of hand) {
      if (!rankGroups[card.rank]) {
        rankGroups[card.rank] = [];
      }
      rankGroups[card.rank].push(card);
    }
    
    // Find all triples (groups of 3+ cards with same rank)
    for (const rank in rankGroups) {
      const group = rankGroups[rank];
      if (group.length >= 3) {
        // Add first triple found for this rank
        triples.push([group[0].id, group[1].id, group[2].id]);
        
        // If 4 cards of same rank, add other triple combination
        if (group.length === 4) {
          triples.push([group[0].id, group[1].id, group[3].id]);
          triples.push([group[0].id, group[2].id, group[3].id]);
          triples.push([group[1].id, group[2].id, group[3].id]);
        }
      }
    }
    
    return triples;
  }

  /**
   * Find all valid plays that beat last play
   */
  private findAllValidPlays(hand: Card[], lastPlay: LastPlay): string[][] {
    const validPlays: string[][] = [];
    const numCards = lastPlay.cards.length;

    if (numCards === 1) {
      // Singles
      for (const card of hand) {
        if (canBeatPlay([card], lastPlay)) {
          validPlays.push([card.id]);
        }
      }
    } else if (numCards === 2) {
      // Pairs
      const pairs = this.findAllPairs(hand);
      for (const pair of pairs) {
        const pairCards = pair.map(id => hand.find(c => c.id === id)!);
        if (canBeatPlay(pairCards, lastPlay)) {
          validPlays.push(pair);
        }
      }
    } else if (numCards === 3) {
      // Triples
      const triples = this.findAllTriples(hand);
      for (const triple of triples) {
        const tripleCards = triple.map(id => hand.find(c => c.id === id)!);
        if (canBeatPlay(tripleCards, lastPlay)) {
          validPlays.push(triple);
        }
      }
    } else if (numCards === 5) {
      // 5-card combos - search all C(n,5) combinations
      // @copilot-review-fix (Round 1): Use full combinations, not just contiguous slices
      const n = hand.length;
      for (let a = 0; a < n - 4; a++) {
        for (let b = a + 1; b < n - 3; b++) {
          for (let c = b + 1; c < n - 2; c++) {
            for (let d = c + 1; d < n - 1; d++) {
              for (let e = d + 1; e < n; e++) {
                const fiveCards = [hand[a], hand[b], hand[c], hand[d], hand[e]];
                if (canBeatPlay(fiveCards, lastPlay)) {
                  validPlays.push(fiveCards.map(c => c.id));
                }
              }
            }
          }
        }
      }
      // @copilot-review-fix (Round 2): Sort 5-card combos by strength so validPlays[0]
      // is truly the weakest and validPlays[last] is truly the strongest.
      // Uses canBeatPlay to determine relative ordering between combos.
      if (validPlays.length > 1) {
        validPlays.sort((a, b) => {
          const cardsA = a.map(id => hand.find(c => c.id === id)!);
          const cardsB = b.map(id => hand.find(c => c.id === id)!);
          const classB = classifyCards(cardsB);
          const aBeatsB = canBeatPlay(cardsA, {
            position: 0,
            cards: cardsB,
            combo_type: classB,
          });
          return aBeatsB ? 1 : -1;
        });
      }
    }

    return validPlays;
  }

  /**
   * Find the next active player (with cards > 0) in anticlockwise turn order.
   * Matches the game engine's turn order: 0→3→1→2→0
   * Skips players who have already finished (0 cards).
   * Returns -1 if no active player found.
   */
  private findNextActivePlayer(currentPlayerIndex: number, playerCardCounts: number[]): number {
    // Anticlockwise turn order matching game engine (state.ts)
    const turnOrder = [3, 2, 0, 1]; // Next player for indices [0,1,2,3]
    let nextIndex = turnOrder[currentPlayerIndex];
    const startIndex = nextIndex;
    
    // Walk through turn order, skipping players with 0 cards (already finished)
    do {
      if (playerCardCounts[nextIndex] > 0) {
        return nextIndex;
      }
      nextIndex = turnOrder[nextIndex];
    } while (nextIndex !== startIndex);
    
    return -1; // No active player found
  }

  /**
   * Check if combo type is a 5-card combo
   */
  private is5CardCombo(combo: ComboType): boolean {
    return ['Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'].includes(combo);
  }

  /**
   * Check if play uses high-value cards
   */
  private isHighValuePlay(cardIds: string[], hand: Card[]): boolean {
    const playCards = cardIds.map(id => hand.find(c => c.id === id)!);
    const highRanks = ['A', '2'];
    return playCards.some(c => highRanks.includes(c.rank));
  }
}

/**
 * Create a bot AI instance with specified difficulty
 */
export function createBotAI(difficulty: BotDifficulty = 'medium'): BotAI {
  return new BotAI(difficulty);
}

/**
 * Get a single bot play (convenience function)
 */
export function getBotPlay(options: BotPlayOptions): BotPlayResult {
  const bot = new BotAI(options.difficulty || 'medium');
  return bot.getPlay(options);
}
