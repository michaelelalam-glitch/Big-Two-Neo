/**
 * Shared game engine for Edge Functions (Deno)
 *
 * Self-contained port of the core Big Two game logic used by both
 * the BotAI and the bot-coordinator Edge Function.
 *
 * Source of truth: apps/mobile/src/game/engine/ (client-side)
 * Keep these in sync when modifying game rules.
 *
 * @module gameEngine
 */

// ==================== TYPES ====================

export interface Card {
  id: string;
  suit: 'D' | 'C' | 'H' | 'S';
  rank: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
}

export type ComboType =
  | 'Single'
  | 'Pair'
  | 'Triple'
  | 'Straight'
  | 'Flush'
  | 'Full House'
  | 'Four of a Kind'
  | 'Straight Flush'
  | 'unknown';

export interface LastPlay {
  position?: number;
  player_index?: number;
  cards: Card[];
  combo_type: ComboType;
  timestamp?: number;
}

// ==================== CONSTANTS ====================

export const RANK_VALUE: Record<string, number> = {
  '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '10': 7,
  'J': 8, 'Q': 9, 'K': 10, 'A': 11, '2': 12,
};

export const SUIT_VALUE: Record<string, number> = {
  'D': 0, 'C': 1, 'H': 2, 'S': 3,
};

export const COMBO_STRENGTH: Record<string, number> = {
  'Single': 1, 'Pair': 2, 'Triple': 3, 'Straight': 4,
  'Flush': 5, 'Full House': 6, 'Four of a Kind': 7, 'Straight Flush': 8,
};

export const VALID_STRAIGHT_SEQUENCES: readonly string[][] = [
  ['A', '2', '3', '4', '5'],
  ['2', '3', '4', '5', '6'],
  ['3', '4', '5', '6', '7'],
  ['4', '5', '6', '7', '8'],
  ['5', '6', '7', '8', '9'],
  ['6', '7', '8', '9', '10'],
  ['7', '8', '9', '10', 'J'],
  ['8', '9', '10', 'J', 'Q'],
  ['9', '10', 'J', 'Q', 'K'],
  ['10', 'J', 'Q', 'K', 'A'],
];

// ==================== UTILITY FUNCTIONS ====================

export function findStraightSequenceIndex(ranks: string[]): number {
  if (ranks.length !== 5) return -1;
  const rankSet = new Set(ranks);
  if (rankSet.size !== 5) return -1;
  return VALID_STRAIGHT_SEQUENCES.findIndex(seq => seq.every(rank => rankSet.has(rank)));
}

export function getStraightTopCard(cards: Card[], seqIndex: number): Card | null {
  if (seqIndex < 0 || seqIndex >= VALID_STRAIGHT_SEQUENCES.length) return null;
  const topRank = VALID_STRAIGHT_SEQUENCES[seqIndex][4];
  return cards.find(c => c.rank === topRank) || null;
}

// ==================== CORE GAME LOGIC ====================

export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const rankDiff = RANK_VALUE[a.rank] - RANK_VALUE[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return SUIT_VALUE[a.suit] - SUIT_VALUE[b.suit];
  });
}

function sameRank(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  return cards.every(c => c.rank === cards[0].rank);
}

function countByRank(cards: Card[]): Record<string, number> {
  return cards.reduce((acc, card) => {
    acc[card.rank] = (acc[card.rank] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

function isStraight(cards: Card[]): { valid: boolean; sequence: string } {
  if (cards.length !== 5) return { valid: false, sequence: '' };
  const ranks = cards.map(c => c.rank);
  const seqIndex = findStraightSequenceIndex(ranks);
  if (seqIndex !== -1) {
    return { valid: true, sequence: VALID_STRAIGHT_SEQUENCES[seqIndex].join('') };
  }
  return { valid: false, sequence: '' };
}

function classifyFive(cards: Card[]): ComboType {
  if (cards.length !== 5) return 'unknown';
  const sorted = sortHand(cards);
  const counts = countByRank(sorted);
  const countValues = Object.values(counts).sort((a, b) => b - a);
  const isFlush = sorted.every(c => c.suit === sorted[0].suit);
  const straightInfo = isStraight(sorted);
  if (straightInfo.valid && isFlush) return 'Straight Flush';
  if (countValues[0] === 4) return 'Four of a Kind';
  if (countValues[0] === 3 && countValues[1] === 2) return 'Full House';
  if (isFlush) return 'Flush';
  if (straightInfo.valid) return 'Straight';
  return 'unknown';
}

export function classifyCards(cards: Card[]): ComboType {
  if (!cards || cards.length === 0) return 'unknown';
  const n = cards.length;
  const sorted = sortHand(cards);
  if (n === 1) return 'Single';
  if (n === 2 && sameRank(sorted)) return 'Pair';
  if (n === 3 && sameRank(sorted)) return 'Triple';
  if (n === 5) return classifyFive(sorted);
  return 'unknown';
}

function getCardValue(card: Card): number {
  return RANK_VALUE[card.rank] * 10 + SUIT_VALUE[card.suit];
}

function getTripleRank(cards: Card[]): string {
  const counts = countByRank(cards);
  for (const rank in counts) {
    if (counts[rank] === 3) return rank;
  }
  throw new Error('No triple found in full house');
}

function getQuadRank(cards: Card[]): string {
  const counts = countByRank(cards);
  for (const rank in counts) {
    if (counts[rank] === 4) return rank;
  }
  throw new Error('No quad found in four of a kind');
}

export function canBeatPlay(newCards: Card[], lastPlay: LastPlay | null): boolean {
  if (!lastPlay) return true;
  if (newCards.length !== lastPlay.cards.length) return false;
  const newCombo = classifyCards(newCards);
  if (newCombo === 'unknown') return false;
  const newStrength = COMBO_STRENGTH[newCombo] || 0;
  const lastStrength = COMBO_STRENGTH[lastPlay.combo_type] || 0;

  if (newCombo !== lastPlay.combo_type) return newStrength > lastStrength;

  const newSorted = sortHand(newCards);
  const lastSorted = sortHand(lastPlay.cards);

  if (newCombo === 'Full House') {
    return RANK_VALUE[getTripleRank(newSorted)] > RANK_VALUE[getTripleRank(lastSorted)];
  }
  if (newCombo === 'Four of a Kind') {
    return RANK_VALUE[getQuadRank(newSorted)] > RANK_VALUE[getQuadRank(lastSorted)];
  }
  if (newCombo === 'Straight' || newCombo === 'Straight Flush') {
    const newSeqIdx = findStraightSequenceIndex(newSorted.map(c => c.rank));
    const lastSeqIdx = findStraightSequenceIndex(lastSorted.map(c => c.rank));
    if (newSeqIdx !== -1 && lastSeqIdx !== -1) {
      if (newSeqIdx !== lastSeqIdx) return newSeqIdx > lastSeqIdx;
      const newTopCard = getStraightTopCard(newCards, newSeqIdx);
      const lastTopCard = getStraightTopCard(lastPlay.cards, lastSeqIdx);
      if (newTopCard && lastTopCard) return SUIT_VALUE[newTopCard.suit] > SUIT_VALUE[lastTopCard.suit];
    }
  }

  const newHighest = newSorted[newSorted.length - 1];
  const lastHighest = lastSorted[lastSorted.length - 1];
  return getCardValue(newHighest) > getCardValue(lastHighest);
}

export function findRecommendedPlay(
  hand: Card[],
  lastPlay: LastPlay | null,
  isFirstPlayOfGame: boolean
): string[] | null {
  if (hand.length === 0) return null;
  const sorted = sortHand(hand);

  if (isFirstPlayOfGame) {
    const threeD = sorted.find(c => c.rank === '3' && c.suit === 'D');
    return threeD ? [threeD.id] : null;
  }

  if (!lastPlay) return [sorted[0].id];

  const numCards = lastPlay.cards.length;
  if (numCards === 1) {
    for (const card of sorted) {
      if (canBeatPlay([card], lastPlay)) return [card.id];
    }
  } else if (numCards === 2) {
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].rank === sorted[i + 1].rank) {
        const pair = [sorted[i], sorted[i + 1]];
        if (canBeatPlay(pair, lastPlay)) return pair.map(c => c.id);
      }
    }
  } else if (numCards === 3) {
    for (let i = 0; i < sorted.length - 2; i++) {
      if (sorted[i].rank === sorted[i + 1].rank && sorted[i].rank === sorted[i + 2].rank) {
        const triple = [sorted[i], sorted[i + 1], sorted[i + 2]];
        if (canBeatPlay(triple, lastPlay)) return triple.map(c => c.id);
      }
    }
  } else if (numCards === 5) {
    for (let i = 0; i <= sorted.length - 5; i++) {
      const fiveCards = sorted.slice(i, i + 5);
      const straightInfo = isStraight(fiveCards);
      if (straightInfo.valid && canBeatPlay(fiveCards, lastPlay)) return fiveCards.map(c => c.id);
    }
    const bySuit = sorted.reduce((acc, card) => {
      if (!acc[card.suit]) acc[card.suit] = [];
      acc[card.suit].push(card);
      return acc;
    }, {} as Record<string, Card[]>);
    for (const suitCards of Object.values(bySuit)) {
      if (suitCards.length >= 5) {
        const flush = suitCards.slice(0, 5);
        if (canBeatPlay(flush, lastPlay)) return flush.map(c => c.id);
      }
    }
    const rankCounts = countByRank(sorted);
    const triples = Object.entries(rankCounts).filter(([_, count]) => count >= 3);
    const pairs = Object.entries(rankCounts).filter(([_, count]) => count >= 2);
    if (triples.length > 0 && pairs.length > 0) {
      const tripleRank = triples[0][0];
      const pairRank = pairs.find(([r]) => r !== tripleRank)?.[0];
      if (pairRank) {
        const tripleCards = sorted.filter(c => c.rank === tripleRank).slice(0, 3);
        const pairCards = sorted.filter(c => c.rank === pairRank).slice(0, 2);
        const fullHouse = [...tripleCards, ...pairCards];
        if (canBeatPlay(fullHouse, lastPlay)) return fullHouse.map(c => c.id);
      }
    }
    const quads = Object.entries(rankCounts).filter(([_, count]) => count >= 4);
    if (quads.length > 0) {
      const quadRank = quads[0][0];
      const quadCards = sorted.filter(c => c.rank === quadRank).slice(0, 4);
      const kicker = sorted.find(c => c.rank !== quadRank);
      if (kicker) {
        const fourKind = [...quadCards, kicker];
        if (canBeatPlay(fourKind, lastPlay)) return fourKind.map(c => c.id);
      }
    }
  }

  return null;
}

export function findHighestBeatingSingle(hand: Card[], lastPlay: LastPlay | null): Card | null {
  if (hand.length === 0) return null;
  const sorted = sortHand(hand);
  if (!lastPlay) return sorted[sorted.length - 1];
  const beatingSingles = sorted.filter(card => canBeatPlay([card], lastPlay));
  return beatingSingles.length > 0 ? beatingSingles[beatingSingles.length - 1] : null;
}
