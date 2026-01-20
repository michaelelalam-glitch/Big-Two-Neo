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
  private difficulty: BotDifficulty;

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
    // @copilot-review-fix: Validate matchNumber is positive integer, normalize invalid values to 1
    // Note: matchNumber <= 0 values are treated as invalid and normalized to match 1 for safety
    const currentMatch =
      typeof matchNumber === 'number' && matchNumber > 0 ? matchNumber : 1;
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

    // Try to find combo with 3D
    if (this.difficulty === 'hard') {
      const comboWith3D = this.findBestComboWith3D(sorted, threeD);
      if (comboWith3D) {
        return { 
          cards: comboWith3D, 
          reasoning: `Playing combo with 3D: ${comboWith3D.length} cards` 
        };
      }
    }

    // Just play 3D as single
    return { cards: [threeD.id], reasoning: 'Playing 3D as single' };
  }

  /**
   * Handle leading (no previous play to beat)
   */
  private handleLeading(hand: Card[], playerCardCounts: number[], currentPlayerIndex: number): BotPlayResult {
    const sorted = sortHand(hand);
    const minOpponentCards = Math.min(...playerCardCounts.filter(c => c > 0 && c !== hand.length));

    // CRITICAL: Check "One Card Left" rule when leading
    // Find the next player's card count (player after current bot)
    // Use counterclockwise turn order: for each player index i, turnOrder[i] gives the next player.
    // Counterclockwise: 0→1→2→3→0, so sequence maps to: 0→1, 1→2, 2→3, 3→0
    const turnOrder = [1, 2, 3, 0]; // Next player for indices [0,1,2,3]
    const nextPlayerIndex = turnOrder[currentPlayerIndex];
    const nextPlayerCardCount = playerCardCounts[nextPlayerIndex];
    
    // If next player has 1 card, MUST lead with highest single to block them
    if (nextPlayerCardCount === 1) {
      const highestSingle = sorted[sorted.length - 1]; // Last card is highest
      return {
        cards: [highestSingle.id],
        reasoning: `One Card Left rule (leading): must play highest single (${highestSingle.rank}${highestSingle.suit}) - next player has 1 card`
      };
    }

    // Hard difficulty: strategic leading
    if (this.difficulty === 'hard') {
      // If opponent is low on cards, try 5-card combo to force a pass
      if (minOpponentCards <= 3) {
        const fiveCardCombo = this.findBest5CardCombo(sorted);
        if (fiveCardCombo) {
          return { 
            cards: fiveCardCombo, 
            reasoning: 'Opponent low on cards, playing 5-card combo' 
          };
        }
      }

      // Try to lead with pairs to preserve singles
      const lowestPair = this.findLowestPair(sorted);
      if (lowestPair && sorted.length > 5) {
        return { cards: lowestPair, reasoning: 'Leading with lowest pair' };
      }
    }

    // Medium difficulty: occasionally lead with pairs
    if (this.difficulty === 'medium' && Math.random() < 0.3) {
      const lowestPair = this.findLowestPair(sorted);
      if (lowestPair) {
        return { cards: lowestPair, reasoning: 'Leading with pair' };
      }
    }

    // Default: lead with lowest single
    return { cards: [sorted[0].id], reasoning: 'Leading with lowest single' };
  }

  /**
   * Handle following (trying to beat last play)
   */
  private handleFollowing(
    hand: Card[], 
    lastPlay: LastPlay, 
    playerCardCounts: number[],
    currentPlayerIndex: number
  ): BotPlayResult {
    const sorted = sortHand(hand);
    const minOpponentCards = Math.min(...playerCardCounts.filter(c => c > 0 && c !== hand.length));

    // Check "One Card Left" rule
    // Find the next player's card count (player after current bot)
    // Use counterclockwise turn order: 0→1→2→3→0 (sequence: 0→1→2→3→0)
    const turnOrder = [1, 2, 3, 0]; // Next player for indices [0,1,2,3]
    const nextPlayerIndex = turnOrder[currentPlayerIndex];
    const nextPlayerCardCount = playerCardCounts[nextPlayerIndex];
    
    // CRITICAL FIX: Check if the player who made lastPlay has won the round (0 cards)
    // If so, don't apply One Card Left rule (they already won, no need to block them)
    const lastPlayPlayerCardCount = playerCardCounts[lastPlay.position];
    const lastPlayerHasWon = lastPlayPlayerCardCount === 0;
    
    // If next player has 1 card and last play was a single, MUST play highest single
    // UNLESS the lastPlay player already won (has 0 cards), then bot can play normally
    if (!lastPlayerHasWon && nextPlayerCardCount === 1 && lastPlay.cards.length === 1) {
      const highestSingle = findHighestBeatingSingle(sorted, lastPlay);
      if (highestSingle) {
        return {
          cards: [highestSingle.id],
          reasoning: `One Card Left rule: must play highest single (${highestSingle.rank}${highestSingle.suit}) - opponent has 1 card`
        };
      }
      // If no valid single, can pass (but shouldn't happen often)
    }

    // Easy difficulty: random decisions
    if (this.difficulty === 'easy') {
      // 40% chance to pass even if can beat
      if (Math.random() < 0.4) {
        return { cards: null, reasoning: 'Easy bot randomly passing' };
      }

      const validPlays = this.findAllValidPlays(sorted, lastPlay);
      if (validPlays.length === 0) {
        return { cards: null, reasoning: 'Cannot beat last play' };
      }

      // Play random valid play
      const randomPlay = validPlays[Math.floor(Math.random() * validPlays.length)];
      return { 
        cards: randomPlay, 
        reasoning: 'Easy bot playing random valid play' 
      };
    }

    // Medium/Hard: use recommended play logic
    const recommended = findRecommendedPlay(hand, lastPlay, false);

    if (!recommended) {
      return { cards: null, reasoning: 'Cannot beat last play' };
    }

    // Hard difficulty: strategic passing
    if (this.difficulty === 'hard') {
      // If opponent has many cards and we're playing high value, consider passing
      if (minOpponentCards > 7 && this.isHighValuePlay(recommended, sorted)) {
        // 30% chance to pass and save high cards
        if (Math.random() < 0.3) {
          return { cards: null, reasoning: 'Saving high cards for later' };
        }
      }

      // If opponent is low on cards, play highest possible
      if (minOpponentCards <= 2) {
        const validPlays = this.findAllValidPlays(sorted, lastPlay);
        if (validPlays.length > 0) {
          const highestPlay = validPlays[validPlays.length - 1];
          return { 
            cards: highestPlay, 
            reasoning: 'Opponent low on cards, playing highest' 
          };
        }
      }
    }

    // Medium difficulty: occasional strategic passing
    if (this.difficulty === 'medium' && Math.random() < 0.15) {
      return { cards: null, reasoning: 'Medium bot strategically passing' };
    }

    return { 
      cards: recommended, 
      reasoning: `Playing recommended: ${recommended.length} cards` 
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
   * Find best 5-card combo in hand
   */
  private findBest5CardCombo(hand: Card[]): string[] | null {
    if (hand.length < 5) return null;

    // Try combinations from lowest cards first
    for (let i = 0; i <= hand.length - 5; i++) {
      const fiveCards = hand.slice(i, i + 5);
      const combo = classifyCards(fiveCards);
      
      if (this.is5CardCombo(combo)) {
        return fiveCards.map(c => c.id);
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
      // 5-card combos
      for (let i = 0; i <= hand.length - 5; i++) {
        const fiveCards = hand.slice(i, i + 5);
        if (canBeatPlay(fiveCards, lastPlay)) {
          validPlays.push(fiveCards.map(c => c.id));
        }
      }
    }

    return validPlays;
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
