// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
// parseCards IS used at lines 718, 777, 800 for parsing card arrays
import { parseCards } from '../_shared/parseCards.ts';
import { checkRateLimit, rateLimitResponse } from '../_shared/rateLimiter.ts';
import { concurrentModificationResponse } from '../_shared/responses.ts';
import { checkMinimumVersion } from '../_shared/versionCheck.ts';
// M12: CORS origin controlled by ALLOWED_ORIGIN env var
import { buildCorsHeaders } from '../_shared/cors.ts';

// Rate-limit config for play-cards: max 10 plays per 10-second window per user.
// Normal gameplay is ~1 play every several seconds; 10/10s is generous for legitimate use.
const PLAY_CARDS_RATE_LIMIT_MAX    = 10;
const PLAY_CARDS_RATE_LIMIT_WINDOW = 10; // seconds

// M10: Valid card field values for boundary validation at the edge function entry point.
const VALID_SUITS = new Set(['D', 'C', 'H', 'S']);
const VALID_RANKS = new Set(['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']);

// ==================== TYPES ====================

interface Card {
  id: string;
  suit: 'D' | 'C' | 'H' | 'S';
  rank: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
}

type ComboType = 'Single' | 'Pair' | 'Triple' | 'Straight' | 'Flush' | 'Full House' | 'Four of a Kind' | 'Straight Flush';

interface LastPlay {
  cards: Card[];
  combo_type: ComboType;
  player_index: number;
}

// ==================== CONSTANTS ====================

const RANK_VALUE: Record<string, number> = {
  '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8,
  'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13,
};

const SUIT_VALUE: Record<string, number> = {
  'D': 1, 'C': 2, 'H': 3, 'S': 4,
};

const COMBO_STRENGTH: Record<ComboType, number> = {
  'Single': 1,
  'Pair': 2,
  'Triple': 3,
  'Straight': 4,
  'Flush': 5,
  'Full House': 6,
  'Four of a Kind': 7,
  'Straight Flush': 8,
};

const VALID_STRAIGHT_SEQUENCES: string[][] = [
  ['A', '2', '3', '4', '5'],   // 5-high (A is low)
  ['2', '3', '4', '5', '6'],   // 6-high (2 is low)
  ['3', '4', '5', '6', '7'],
  ['4', '5', '6', '7', '8'],
  ['5', '6', '7', '8', '9'],
  ['6', '7', '8', '9', '10'],
  ['7', '8', '9', '10', 'J'],
  ['8', '9', '10', 'J', 'Q'],
  ['9', '10', 'J', 'Q', 'K'],
  ['10', 'J', 'Q', 'K', 'A'],  // A-high (highest)
];

// ==================== CARD PARSING (Backwards Compatibility) ====================

/**
 * Parse card data that might be in string or object format
 * Handles legacy games with string cards: "D3" -> {id:"D3", rank:"3", suit:"D"}
 * 
 * TODO: Add comprehensive test coverage for:
 * - Normal Card objects, plain string cards, single/double/triple JSON-encoded strings
 * - Malformed data, MAX_ITERATIONS boundary cases
 */
function parseCard(cardData: any): Card | null {
  // Already a proper card object — validate suit/rank values at the boundary
  if (typeof cardData === 'object' && cardData !== null && 'id' in cardData && 'rank' in cardData && 'suit' in cardData) {
    if (!VALID_SUITS.has(cardData.suit) || !VALID_RANKS.has(cardData.rank)) {
      console.warn('[parseCard] Invalid suit/rank in card object:', { suit: cardData.suit, rank: cardData.rank });
      return null;
    }
    return cardData as Card;
  }
  
  // Handle string card (legacy format)
  if (typeof cardData === 'string') {
    let cardStr = cardData;
    
    /**
     * Maximum iterations for JSON parsing loop to handle legacy nested string formats.
     * 
     * RATIONALE:
     * - Legacy data may have cards stored as JSON-encoded strings with up to 2-3 levels
     *   of nesting (e.g., '"{\\"suit\\":\\"D\\",\\"value\\":\\"3\\"}"')
     * - Empirical basis: Maximum observed nesting is 2 levels (from double-encoding
     *   bug in v1.2.3 that affected card data migration)
     * - Setting to 5 provides 2.5x safety margin above observed maximum
     * - Prevents infinite loops while allowing legitimate deeply-nested strings
     * 
     * IMPORTANT: If you encounter legitimate cards that require >5 iterations,
     * investigate the data format issue at its source rather than increasing this limit.
     */
    const MAX_ITERATIONS = 5;
    
    // Handle JSON-encoded strings: "\"D3\"" -> "D3"
    // Safety: max 5 iterations to prevent infinite loops
    let iterations = 0;
    try {
      while (iterations < MAX_ITERATIONS) {
        // Early exit: if string doesn't start with quote or brace, no more parsing needed
        if (typeof cardStr !== 'string' || (!cardStr.startsWith('"') && !cardStr.startsWith('{'))) {
          break;
        }
        iterations++;
        const parsed = JSON.parse(cardStr);
        if (typeof parsed === 'string') {
          // Verify parsed value actually changed (prevent infinite loop)
          const previousCardStr = cardStr;
          cardStr = parsed;
          if (cardStr === previousCardStr) {
            console.warn('[parseCard] JSON.parse returned same value, breaking loop');
            break;
          }
        } else if (typeof parsed === 'object' && parsed !== null) {
          // Validate the parsed object has required Card fields with known-good values
          // before accepting — malformed JSON objects (e.g. {value:"3", suit:"X"}) must
          // not pass through as Cards.
          const p = parsed as Record<string, unknown>;
          if (
            typeof p.id !== 'string' ||
            typeof p.suit !== 'string' ||
            typeof p.rank !== 'string' ||
            !VALID_SUITS.has(p.suit) ||
            !VALID_RANKS.has(p.rank)
          ) {
            console.warn('[parseCard] JSON-parsed object is not a valid Card:', parsed);
            return null;
          }
          return parsed as Card;
        } else {
          break;
        }
      }
    } catch (e) {
      // Not JSON, treat as plain string
      console.debug('[parseCard] JSON parse failed, treating as plain string:', { cardData, error: e });
    }
    
    // Parse plain string - supports BOTH formats:
    // Format 1: Suit-Rank "D3" -> {id:"D3", rank:"3", suit:"D"} (SQL deck format)
    // Format 2: Rank-Suit "3D" -> {id:"3D", rank:"3", suit:"D"} (client format)
    if (cardStr.length >= 2) {
      // Try Suit-Rank format first (D3, C10, etc.) - SQL deck format
      const suitRankMatch = cardStr.match(/^([DCHS])([2-9TJQKA]|10)$/);
      if (suitRankMatch) {
        const [, suit, rank] = suitRankMatch;
        return { id: cardStr, suit: suit as Card['suit'], rank: rank as Card['rank'] };
      }
      
      // Try Rank-Suit format (3D, 10C, etc.) - client format
      const rankSuitMatch = cardStr.match(/^([2-9TJQKA]|10)([DCHS])$/);
      if (rankSuitMatch) {
        const [, rank, suit] = rankSuitMatch;
        return { id: cardStr, suit: suit as Card['suit'], rank: rank as Card['rank'] };
      }
      
      // Fallback for legacy format — validate suit/rank with explicit Sets before accepting
      const suit = cardStr[0];
      const rank = cardStr.substring(1);
      if (!VALID_SUITS.has(suit) || !VALID_RANKS.has(rank)) {
        console.warn('[parseCard] Fallback parse failed suit/rank validation:', { suit, rank, cardStr });
        return null;
      }
      return { id: cardStr, suit: suit as Card['suit'], rank: rank as Card['rank'] };
    }
  }
  
  // Failed to parse - log warning with details
  console.warn('[parseCard] Failed to parse card - returning null:', { cardData, type: typeof cardData });
  return null;
}

// parseCards() was moved to the shared utility module (imported at top).
// parseCard() remains defined locally above for single-card parsing within this function.

// ==================== GAME LOGIC ====================

function sortHand(cards: Card[]): Card[] {
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

function findStraightSequenceIndex(ranks: string[]): number {
  const rankSet = new Set(ranks);
  for (let i = 0; i < VALID_STRAIGHT_SEQUENCES.length; i++) {
    const seq = VALID_STRAIGHT_SEQUENCES[i];
    if (seq.every(r => rankSet.has(r))) {
      return i;
    }
  }
  return -1;
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

function classifyFive(cards: Card[]): ComboType | 'unknown' {
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

function classifyCards(cards: Card[]): ComboType | 'unknown' {
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

function canBeatPlay(newCards: Card[], lastPlay: LastPlay | null): boolean {
  if (!lastPlay) return true;
  if (newCards.length !== lastPlay.cards.length) return false;
  
  const newCombo = classifyCards(newCards);
  if (newCombo === 'unknown') return false;
  
  const newStrength = COMBO_STRENGTH[newCombo] || 0;
  const lastStrength = COMBO_STRENGTH[lastPlay.combo_type] || 0;
  
  if (newCombo !== lastPlay.combo_type) {
    return newStrength > lastStrength;
  }
  
  const newSorted = sortHand(newCards);
  const lastSorted = sortHand(lastPlay.cards);
  
  if (newCombo === 'Full House') {
    const newTripleRank = getTripleRank(newSorted);
    const lastTripleRank = getTripleRank(lastSorted);
    return RANK_VALUE[newTripleRank] > RANK_VALUE[lastTripleRank];
  }
  
  if (newCombo === 'Four of a Kind') {
    const newQuadRank = getQuadRank(newSorted);
    const lastQuadRank = getQuadRank(lastSorted);
    return RANK_VALUE[newQuadRank] > RANK_VALUE[lastQuadRank];
  }
  
  // For Straight and Straight Flush, compare by sequence position
  // (A-2-3-4-5 is lowest, 10-J-Q-K-A is highest)
  // Cannot compare by highest card rank because 2 has RANK_VALUE=12
  // which would incorrectly make A-2-3-4-5 the strongest straight
  if (newCombo === 'Straight' || newCombo === 'Straight Flush') {
    const newSeqIdx = findStraightSequenceIndex(newSorted.map((c: Card) => c.rank));
    const lastSeqIdx = findStraightSequenceIndex(lastSorted.map((c: Card) => c.rank));
    if (newSeqIdx !== -1 && lastSeqIdx !== -1) {
      if (newSeqIdx !== lastSeqIdx) {
        return newSeqIdx > lastSeqIdx;
      }
      // Same sequence — tiebreak by top card suit
      const topRank = VALID_STRAIGHT_SEQUENCES[newSeqIdx][4];
      const newTopCard = newCards.find((c: Card) => c.rank === topRank);
      const lastTopCard = lastPlay.cards.find((c: Card) => c.rank === topRank);
      if (newTopCard && lastTopCard) {
        return SUIT_VALUE[newTopCard.suit] > SUIT_VALUE[lastTopCard.suit];
      }
    }
  }
  
  // For other combos (Single, Pair, Triple, Flush), compare highest card
  const newHighest = newSorted[newSorted.length - 1];
  const lastHighest = lastSorted[lastSorted.length - 1];
  
  return getCardValue(newHighest) > getCardValue(lastHighest);
}

// ==================== HIGHEST PLAY DETECTION ====================

function generateFullDeck(): Card[] {
  const deck: Card[] = [];
  const suits: ('D' | 'C' | 'H' | 'S')[] = ['D', 'C', 'H', 'S'];
  const ranks: Card['rank'][] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  for (const suit of suits) {
    for (const rank of ranks) {
      // Note: Card.id here is constructed as rank+suit (e.g., "3D") and MUST match
      // the format used by the client (see BUG_FIX_AUTOPASS_TIMER_AND_BOT_3D_JAN_12_2026.md).
      // Game logic in this module compares cards by their rank and suit fields
      // (see cardsEqual/getRemainingCards), but the id string format is still
      // important for correctly matching cards with client-sent data.
      deck.push({ id: `${rank}${suit}`, rank, suit });
    }
  }
  return deck;
}

const FULL_DECK = generateFullDeck();

function getRemainingCards(playedCards: Card[]): Card[] {
  return FULL_DECK.filter(
    (card) => !playedCards.some((played) => played.rank === card.rank && played.suit === card.suit)
  );
}

function cardsEqual(a: Card, b: Card): boolean {
  // Compare by rank and suit instead of ID to handle format inconsistencies
  return a.rank === b.rank && a.suit === b.suit;
}

function isHighestRemainingSingle(card: Card, playedCards: Card[]): boolean {
  const remaining = getRemainingCards(playedCards);
  
  // Filter out the current card from remaining (since we're checking if IT is highest)
  const notCurrentCard = remaining.filter(c => !(c.rank === card.rank && c.suit === card.suit));
  
  // Debug logging to trace highest card detection
  console.log('🔍 [isHighestRemainingSingle] Checking card:', {
    cardId: card.id,
    cardRank: card.rank,
    cardSuit: card.suit,
    cardValue: getCardValue(card),
    playedCardsCount: playedCards.length,
    remainingCardsCount: remaining.length,
    notCurrentCardCount: notCurrentCard.length,
  });
  
  // If no other cards remain, this is the last card (highest by default)
  if (notCurrentCard.length === 0) {
    console.log('🔍 [isHighestRemainingSingle] ✅ No other cards remain - this is highest!');
    return true;
  }
  
  const sorted = sortHand(notCurrentCard);
  const highestOther = sorted[sorted.length - 1];
  
  // Current card is highest if its value is greater than any other remaining card
  const currentValue = getCardValue(card);
  const highestOtherValue = getCardValue(highestOther);
  
  const isHighest = currentValue > highestOtherValue;
  
  console.log('🔍 [isHighestRemainingSingle] Comparison result:', {
    currentCard: card.id,
    currentValue,
    highestOtherCard: highestOther.id,
    highestOtherValue,
    isHighest,
  });
  
  return isHighest;
}

function generateAllPairs(remaining: Card[]): Card[][] {
  const pairs: Card[][] = [];
  const rankGroups: { [rank: string]: Card[] } = {};
  
  for (const card of remaining) {
    if (!rankGroups[card.rank]) {
      rankGroups[card.rank] = [];
    }
    rankGroups[card.rank].push(card);
  }
  
  for (const rank in rankGroups) {
    const group = rankGroups[rank];
    if (group.length >= 2) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          pairs.push([group[i], group[j]]);
        }
      }
    }
  }
  
  return pairs;
}

function isHighestRemainingPair(pair: Card[], playedCards: Card[]): boolean {
  if (pair.length !== 2 || pair[0].rank !== pair[1].rank) {
    return false;
  }
  
  const remaining = getRemainingCards(playedCards);
  const notInCurrentPair = remaining.filter(
    c => !pair.some(p => p.id === c.id)
  );
  
  const otherPairs = generateAllPairs(notInCurrentPair);
  
  if (otherPairs.length === 0) {
    return true;
  }
  
  const sortedPairs = otherPairs.map(p => sortHand(p)).sort((a, b) => {
    const rankDiff = RANK_VALUE[a[0].rank] - RANK_VALUE[b[0].rank];
    if (rankDiff !== 0) return rankDiff;
    return SUIT_VALUE[a[1].suit] - SUIT_VALUE[b[1].suit];
  });
  
  const highestOtherPair = sortedPairs[sortedPairs.length - 1];
  const sortedCurrentPair = sortHand(pair);
  
  const rankDiff = RANK_VALUE[sortedCurrentPair[0].rank] - RANK_VALUE[highestOtherPair[0].rank];
  if (rankDiff > 0) return true;
  if (rankDiff < 0) return false;
  
  const suitDiff = SUIT_VALUE[sortedCurrentPair[1].suit] - SUIT_VALUE[highestOtherPair[1].suit];
  return suitDiff >= 0;
}

function generateAllTriples(remaining: Card[]): Card[][] {
  const triples: Card[][] = [];
  const rankGroups: { [rank: string]: Card[] } = {};
  
  for (const card of remaining) {
    if (!rankGroups[card.rank]) {
      rankGroups[card.rank] = [];
    }
    rankGroups[card.rank].push(card);
  }
  
  for (const rank in rankGroups) {
    const group = rankGroups[rank];
    if (group.length >= 3) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          for (let k = j + 1; k < group.length; k++) {
            triples.push([group[i], group[j], group[k]]);
          }
        }
      }
    }
  }
  
  return triples;
}

function isHighestRemainingTriple(triple: Card[], playedCards: Card[]): boolean {
  if (triple.length !== 3 || !sameRank(triple)) {
    return false;
  }
  
  const remaining = getRemainingCards(playedCards);
  const notInCurrentTriple = remaining.filter(
    c => !triple.some(t => t.id === c.id)
  );
  
  const otherTriples = generateAllTriples(notInCurrentTriple);
  
  if (otherTriples.length === 0) {
    return true;
  }
  
  const sortedTriples = otherTriples.map(t => sortHand(t)).sort((a, b) => {
    const rankDiff = RANK_VALUE[a[0].rank] - RANK_VALUE[b[0].rank];
    if (rankDiff !== 0) return rankDiff;
    return SUIT_VALUE[a[2].suit] - SUIT_VALUE[b[2].suit];
  });
  
  const highestOtherTriple = sortedTriples[sortedTriples.length - 1];
  const sortedCurrentTriple = sortHand(triple);
  
  const rankDiff = RANK_VALUE[sortedCurrentTriple[0].rank] - RANK_VALUE[highestOtherTriple[0].rank];
  if (rankDiff > 0) return true;
  if (rankDiff < 0) return false;
  
  const suitDiff = SUIT_VALUE[sortedCurrentTriple[2].suit] - SUIT_VALUE[highestOtherTriple[2].suit];
  return suitDiff >= 0;
}

function isHighestRemainingFiveCardCombo(cards: Card[], comboType: ComboType | 'unknown', playedCards: Card[]): boolean {
  if (cards.length !== 5 || comboType === 'unknown') return false;
  
  const comboStrength = COMBO_STRENGTH[comboType as ComboType];
  const remaining = getRemainingCards(playedCards);
  const notInCurrent = remaining.filter(c => !cards.some(p => p.id === c.id));
  
  // Check if any stronger combo type is possible
  for (const [type, strength] of Object.entries(COMBO_STRENGTH)) {
    if (strength > comboStrength) {
      if (canFormCombo(notInCurrent, type as ComboType)) {
        return false;
      }
    }
  }
  
  // For Straight Flush and Four of a Kind we can efficiently check if any
  // stronger same-type combo exists without full combinatorial enumeration.
  // Other types (FH, Flush, Straight) conservatively return false.
  if (comboType === 'Straight Flush') {
    return isHighestRemainingStraightFlush(cards, notInCurrent);
  }
  if (comboType === 'Four of a Kind') {
    return isHighestRemainingFourOfAKind(cards, notInCurrent);
  }
  // Conservative for Full House / Flush / Straight — enumeration is too expensive
  // in an edge function context. This means auto-pass will NOT trigger for these
  // combo types (only Straight Flush and Four of a Kind are checked). This is an
  // intentional trade-off: false negatives are harmless (timer just doesn't fire),
  // while false positives would incorrectly auto-pass when beatable plays exist.
  return false;
}

/** Check if the played SF is the highest remaining Straight Flush. */
function isHighestRemainingStraightFlush(cards: Card[], notInCurrent: Card[]): boolean {
  // Compare by (seqIndex, suit) — same ordering as canBeatPlay.
  // A-2-3-4-5 is seqIndex 0 (lowest), 10-J-Q-K-A is seqIndex 9 (highest).
  const mySeqIdx = findStraightSequenceIndex(cards.map(c => c.rank));
  if (mySeqIdx === -1) return false;
  const myTopRank = VALID_STRAIGHT_SEQUENCES[mySeqIdx][4];
  const myTopCard = cards.find(c => c.rank === myTopRank);
  const mySuitValue = myTopCard ? SUIT_VALUE[myTopCard.suit] : 0;

  // Group remaining cards (excluding current play) by suit
  const bySuit: { [suit: string]: Set<string> } = {};
  for (const c of notInCurrent) {
    if (!bySuit[c.suit]) bySuit[c.suit] = new Set();
    bySuit[c.suit].add(c.rank);
  }

  for (const suit in bySuit) {
    const ranks = bySuit[suit];
    if (ranks.size < 5) continue;
    for (let seqIdx = 0; seqIdx < VALID_STRAIGHT_SEQUENCES.length; seqIdx++) {
      const seq = VALID_STRAIGHT_SEQUENCES[seqIdx];
      if (seq.every(r => ranks.has(r))) {
        // Compare by sequence index first, then by suit of the top-rank card
        if (seqIdx > mySeqIdx) return false;
        if (seqIdx === mySeqIdx && SUIT_VALUE[suit] > mySuitValue) return false;
      }
    }
  }
  return true;
}

/** Check if the played FoaK is the highest remaining Four of a Kind. */
function isHighestRemainingFourOfAKind(cards: Card[], notInCurrent: Card[]): boolean {
  const myQuadRank = getQuadRank(cards);
  const myQuadValue = RANK_VALUE[myQuadRank];

  if (notInCurrent.length < 5) return true;

  const counts = countByRank(notInCurrent);
  for (const rank in counts) {
    if (counts[rank] >= 4 && RANK_VALUE[rank] > myQuadValue) {
      // Verify at least one non-quad kicker exists to form a valid 5-card combo
      const hasKicker = notInCurrent.some(c => c.rank !== rank);
      if (hasKicker) return false;
    }
  }
  return true;
}

function canFormCombo(cards: Card[], comboType: ComboType): boolean {
  if (comboType === 'Straight Flush') {
    return canFormStraightFlush(cards);
  }
  if (comboType === 'Four of a Kind') {
    return canFormFourOfAKind(cards);
  }
  if (comboType === 'Full House') {
    return canFormFullHouse(cards);
  }
  if (comboType === 'Flush') {
    return canFormFlush(cards);
  }
  if (comboType === 'Straight') {
    return canFormStraight(cards);
  }
  return false;
}

function canFormStraightFlush(cards: Card[]): boolean {
  const bySuit: { [suit: string]: Card[] } = {};
  for (const card of cards) {
    if (!bySuit[card.suit]) bySuit[card.suit] = [];
    bySuit[card.suit].push(card);
  }
  
  for (const suit in bySuit) {
    if (bySuit[suit].length >= 5) {
      // Check all valid straight sequences within this suit's cards
      const suitRanks = new Set(bySuit[suit].map(c => c.rank));
      for (const seq of VALID_STRAIGHT_SEQUENCES) {
        if (seq.every(r => suitRanks.has(r))) return true;
      }
    }
  }
  return false;
}

function canFormFourOfAKind(cards: Card[]): boolean {
  const counts = countByRank(cards);
  return Object.values(counts).some(count => count >= 4);
}

function canFormFullHouse(cards: Card[]): boolean {
  const counts = countByRank(cards);
  const values = Object.values(counts).sort((a, b) => b - a);
  return values[0] >= 3 && values[1] >= 2;
}

function canFormFlush(cards: Card[]): boolean {
  const bySuit: { [suit: string]: number } = {};
  for (const card of cards) {
    bySuit[card.suit] = (bySuit[card.suit] || 0) + 1;
  }
  return Object.values(bySuit).some(count => count >= 5);
}

function canFormStraight(cards: Card[]): boolean {
  const ranks = [...new Set(cards.map(c => c.rank))];
  for (const seq of VALID_STRAIGHT_SEQUENCES) {
    if (seq.every(r => ranks.includes(r))) {
      return true;
    }
  }
  return false;
}

function generateCombosOfType(_cards: Card[], _comboType: ComboType): Card[][] {
  // Stub — full combinatorial generation is handled client-side.
  // isHighestRemainingFiveCardCombo uses conservative return false instead.
  return [];
}

function isHighestPossiblePlay(cards: Card[], playedCards: Card[]): boolean {
  if (!cards || cards.length === 0) return false;

  const sorted = sortHand(cards);
  const type = classifyCards(cards);

  switch (cards.length) {
    case 1:
      return isHighestRemainingSingle(sorted[0], playedCards);
    case 2:
      return isHighestRemainingPair(sorted, playedCards);
    case 3:
      return isHighestRemainingTriple(sorted, playedCards);
    case 5:
      return isHighestRemainingFiveCardCombo(sorted, type, playedCards);
    default:
      return false;
  }
}

// Module-level cache: stableId → playerHash (SHA-256 hex).
// Computed once per Edge Function instance so repeated plays from the same
// player don't re-hash on every hot path invocation.
// Bounded to prevent unbounded growth in long-lived instances with many players.
const PLAYER_HASH_CACHE_MAX = 1000;
const _playerHashCache = new Map<string, string>();
function _cachedPlayerHash(hash: string, id: string): void {
  if (_playerHashCache.size >= PLAYER_HASH_CACHE_MAX) {
    // Evict the oldest entry (insertion-order first key)
    const firstKey = _playerHashCache.keys().next().value;
    if (firstKey !== undefined) _playerHashCache.delete(firstKey);
  }
  _playerHashCache.set(id, hash);
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  // M12: CORS origin controlled by ALLOWED_ORIGIN env var
  const corsHeaders = buildCorsHeaders();

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

    // C3: Enforce minimum app version (service-role callers auto-detected)
    const versionError = checkMinimumVersion(req, corsHeaders);
    if (versionError) return versionError;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabaseClient = createClient(supabaseUrl, serviceKey);

    // ── Request size guard (DoS mitigation) ─────────────────────────────────
    // When Content-Length is present and valid, reject early (before body read).
    // When absent (e.g., chunked transfer encoding), allow the request through
    // but enforce a hard byte cap during streaming so an oversized body is
    // rejected while reading rather than after full buffering.
    // Legitimate play-cards payloads (room_code + player_id + card array + optional
    // _bot_auth) are well under 4 KB even for a full 13-card hand; 10 KB is a
    // generous cap.
    const PC_MAX_BODY_BYTES = 10_240;
    const clHeader = req.headers.get('content-length');
    if (clHeader !== null) {
      const cl = Number(clHeader);
      if (!Number.isFinite(cl) || cl < 0 || cl > PC_MAX_BODY_BYTES) {
        return new Response(
          JSON.stringify({ success: false, error: 'Request body too large' }),
          { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ── Early body peek for bot-coordinator authentication ─────────────────────
    // Body is streamed with a hard byte cap so oversized bodies are rejected
    // during reading (not after buffering). JSON parse errors are caught below.
    let bodyJson: Record<string, any> | null = null;
    let rawBodyText = '';
    if (req.body) {
      const reader = req.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          totalBytes += value.byteLength;
          if (totalBytes > PC_MAX_BODY_BYTES) {
            await reader.cancel().catch(() => undefined);
            return new Response(
              JSON.stringify({ success: false, error: 'Request body too large' }),
              { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          chunks.push(value);
        }
      } catch { /* fall through — rawBodyText stays '' */ } finally { reader.releaseLock(); }
      if (chunks.length > 0) {
        const bodyBytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) { bodyBytes.set(chunk, offset); offset += chunk.byteLength; }
        rawBodyText = new TextDecoder().decode(bodyBytes);
      }
    }
    try { bodyJson = rawBodyText ? JSON.parse(rawBodyText) : null; } catch { /* handled below */ }

    // ── Authorization check (BEFORE body parse, matching bot-coordinator pattern) ──
    // Service-role callers (bot-coordinator) may act for any player_id.
    // Non-service-role callers (clients) must present a valid user JWT; the resolved
    // user.id is compared against player_id after the body is parsed below.
    //
    // Three equivalent ways to identify a service-role / bot-coordinator caller:
    //   1. SUPABASE_SERVICE_ROLE_KEY bearer match (may fail due to key rotation lag)
    //   2. INTERNAL_BOT_AUTH_KEY custom header (may be stripped by internal routing)
    //   3. _bot_auth field in the request body — guaranteed to pass through unchanged
    const authHeader  = req.headers.get('authorization') ?? '';
    const botAuthHdr  = req.headers.get('x-bot-auth') ?? '';
    const internalKey = Deno.env.get('INTERNAL_BOT_AUTH_KEY') ?? '';
    const hasInternalKey = internalKey !== '';
    const botBodyAuth = bodyJson?._bot_auth ?? '';
    const isServiceRole =
      (serviceKey !== '' && authHeader === `Bearer ${serviceKey}`) ||
      (hasInternalKey && botAuthHdr === internalKey) ||
      (hasInternalKey && botBodyAuth === internalKey);

    let callerJwtUserId: string | null = null;

    if (!isServiceRole) {
      const anonClient = createClient(
        supabaseUrl,
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error: authError } = await anonClient.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      callerJwtUserId = user.id;
    }
    // ────────────────────────────────────────────────────────────────────────

    // Parse body AFTER auth — re-use the pre-parsed bodyJson from the early peek.
    // If the body was invalid JSON (bodyJson === null), return 400.
    let room_code: string, player_id: string, cards: any[];
    try {
      if (!bodyJson) throw new Error('no body');
      room_code = bodyJson.room_code;
      player_id = bodyJson.player_id;
      cards     = bodyJson.cards;
    } catch (_e) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate required fields before the identity check so a missing/empty
    // player_id returns 400 (Bad Request) instead of a misleading 403 (Forbidden).
    if (!room_code || !player_id || !Array.isArray(cards) || cards.length === 0) {
      console.log('❌ [play-cards] Missing required fields');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // M10: Validate and normalize card format at the boundary — reject malformed input before any
    // game logic. Normalizes both object cards { suit, rank, id } and legacy string cards (e.g.
    // "D3") via parseCard so downstream logic always receives typed Card objects with a valid .id.
    if (cards.length > 5) {
      return new Response(
        JSON.stringify({ success: false, error: 'Too many cards: max 5 per play' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const normalizedCards: Card[] = [];
    for (const rawCard of cards) {
      const parsed = parseCard(rawCard);
      if (!parsed) {
        console.warn('[play-cards] ❌ M10: Invalid card at boundary:', rawCard);
        return new Response(
          JSON.stringify({ success: false, error: `Invalid card format: ${JSON.stringify(rawCard)}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      normalizedCards.push(parsed);
    }
    cards = normalizedCards;

    // Now that we have a valid player_id, complete the identity check for client callers.
    if (!isServiceRole && callerJwtUserId !== player_id) {
      console.warn('[play-cards] 🔒 Forbidden: JWT user', callerJwtUserId?.substring(0, 8), '≠ player_id', player_id?.substring(0, 8));
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: player_id does not match authenticated user' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Rate limiting (client callers only; service-role / bot-coordinator bypass) ──
    // Prevents rapid-fire abuse of play-cards (e.g. scripted card spam).
    // Uses the shared rate_limit_tracking table — Task #556.
    if (!isServiceRole) {
      const rl = await checkRateLimit(
        supabaseClient,
        player_id,
        'play_cards',
        PLAY_CARDS_RATE_LIMIT_MAX,
        PLAY_CARDS_RATE_LIMIT_WINDOW,
      );
      if (!rl.allowed) {
        return rateLimitResponse(rl.retryAfterMs, corsHeaders);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    console.log('🎮 [play-cards] Request received:', {
      room_code,
      player_id: player_id?.substring(0, 8),
      cards_count: cards.length,
    });

    // 1. Get room ID
    const { data: room, error: roomError } = await supabaseClient
      .from('rooms')
      .select('id, ranked_mode, is_public')
      .eq('code', room_code)
      .single();

    if (roomError || !room) {
      return new Response(
        JSON.stringify({ success: false, error: 'Room not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Get game state WITH ROW LOCK
    const { data: gameState, error: gameStateError } = await supabaseClient
      .from('game_state')
      .select('*')
      .eq('room_id', room.id)
      .single();

    if (gameStateError || !gameState) {
      return new Response(
        JSON.stringify({ success: false, error: 'Game state not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Get player info
    // Service-role callers (bot-coordinator) pass room_players.id which works
    // for replacement bots that have user_id = NULL.
    // Client callers pass their auth user_id.
    let player: any, playerError: any;
    if (isServiceRole) {
      const result = await supabaseClient
        .from('room_players')
        .select('*')
        .eq('id', player_id)
        .eq('room_id', room.id)
        .single();
      player = result.data;
      playerError = result.error;
    } else {
      const result = await supabaseClient
        .from('room_players')
        .select('*')
        .eq('user_id', player_id)
        .eq('room_id', room.id)
        .single();
      player = result.data;
      playerError = result.error;
    }

    if (playerError || !player) {
      console.log('❌ [play-cards] Player not found:', {
        player_id: player_id?.substring(0, 8),
        room_id: room.id,
        error: playerError?.message,
        errorDetails: JSON.stringify(playerError),
      });
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Player not found in room',
          debug: {
            player_id: player_id?.substring(0, 8),
            room_id: room.id,
            error: playerError?.message
          }
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3b. Clear persistent disconnect timer — player is actively playing.
    // This proves the player is engaged and should not be replaced by a bot.
    // Only applies to human players who have a timer running.
    if (!player.is_bot && player.disconnect_timer_started_at) {
      await supabaseClient
        .from('room_players')
        .update({ disconnect_timer_started_at: null })
        .eq('id', player.id)
        .eq('room_id', room.id);
    }

    // 4a. Reject plays when game is already finished/game_over.
    //
    // IDEMPOTENCY EXCEPTION — "lost response" retry:
    // When a player plays their last card the server sets game_phase='finished'.
    // If the HTTP response is lost in transit (FunctionsFetchError on client), the
    // client retries via invokeWithRetry.  On the retry, game_phase is already
    // 'finished', so without this guard the client would receive a 400 error and
    // NEVER call start_new_match — leaving the game permanently stuck.
    //
    // Fix: if the requester IS the match winner AND the match ended within the last
    // 60 seconds, return a synthetic match_ended=true success so the client can
    // proceed to call start_new_match normally.
    if (gameState.game_phase === 'finished' || gameState.game_phase === 'game_over') {
      const matchEndedAt  = gameState.match_ended_at ? new Date(gameState.match_ended_at as string).getTime() : 0;
      const isRecentEnd   = (Date.now() - matchEndedAt) < 60_000; // within last 60 s
      const isMatchWinner =
        gameState.game_phase === 'finished' &&
        (gameState as any).last_match_winner_index !== null &&
        (gameState as any).last_match_winner_index !== undefined &&
        player.player_index === (gameState as any).last_match_winner_index &&
        isRecentEnd;

      if (isMatchWinner) {
        console.log(
          `[play-cards] ✅ Idempotency: winner retry — player ${player.player_index} ` +
          `already won match ${gameState.match_number}. Returning match_ended=true.`
        );
        return new Response(
          JSON.stringify({
            success: true,
            match_ended: true,
            already_finished: true,  // Tells client the phase was already 'finished'
            game_over: false,
            cards_remaining: 0,
            next_turn: gameState.current_turn,
            combo_type: (gameState.last_play as any)?.combo_type ?? 'Single',
            match_scores: null,      // Scores were already committed; client reads from Realtime
            highest_play_detected: false,
            auto_pass_timer: null,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // C11 Fix: Non-winner idempotency guard — if a non-winner retries play-cards
      // after the match ended (e.g. lost HTTP response), return a graceful success
      // instead of a hard 400 so the client can transition to the results screen.
      if (isRecentEnd) {
        console.log(
          `[play-cards] ✅ Idempotency: non-winner retry — player ${player.player_index} ` +
          `retried after match ${gameState.match_number} ended. Returning already_finished=true.`
        );
        return new Response(
          JSON.stringify({
            success: true,
            match_ended: true,
            already_finished: true,
            game_over: gameState.game_phase === 'game_over',
            cards_remaining: player.cards_in_hand ?? 0,
            next_turn: gameState.current_turn,
            combo_type: (gameState.last_play as any)?.combo_type ?? 'Single',
            match_scores: null,
            highest_play_detected: false,
            auto_pass_timer: null,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('❌ [play-cards] Game already ended:', { game_phase: gameState.game_phase });
      return new Response(
        JSON.stringify({
          success: false,
          error: `Game already ended (phase: ${gameState.game_phase})`,
          game_phase: gameState.game_phase,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4b. Verify it's this player's turn
    if (gameState.current_turn !== player.player_index) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Not your turn',
          current_turn: gameState.current_turn,
          your_index: player.player_index,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. ✅ Validate 3♦ requirement (ONLY first play of FIRST MATCH)
    const match_number = gameState.match_number || 1;
    // 🔧 FIX: Parse played_cards to handle legacy string format (e.g., "D3" → {id:"D3", rank:"3", suit:"D"})
    // This is critical for isHighestPossiblePlay() detection to work correctly
    const played_cards_raw = gameState.played_cards || [];
    const played_cards = parseCards(played_cards_raw);
    const is_first_play = played_cards.length === 0;

    if (is_first_play && match_number === 1) {
      // ✅ FIX: SQL generates 'D3' (suit-first), not '3D' (rank-first)
      const has_three_diamond = cards.some((c: Card) => c.id === 'D3' || c.id === '3D');
      if (!has_three_diamond) {
        console.log('❌ [play-cards] Missing 3D on first play:', {
          cards: cards.map(c => c.id),
          match_number,
          is_first_play,
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: 'First play of first match must include 3♦ (three of diamonds)',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 6. ✅ Classify combo and validate
    const comboType = classifyCards(cards);
    if (comboType === 'unknown') {
      console.log('❌ [play-cards] Invalid card combination:', {
        cards: cards.map(c => c.id),
        comboType,
      });
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid card combination' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. ✅ Check if play beats last play
    const lastPlay = gameState.last_play as LastPlay | null;
    if (!canBeatPlay(cards, lastPlay)) {
      const lastCombo = lastPlay?.combo_type || 'None';
      console.log('❌ [play-cards] Cannot beat last play:', {
        cards: cards.map(c => c.id),
        comboType,
        lastPlay: lastPlay ? {
          cards: lastPlay.cards.map(c => c.id),
          combo_type: lastPlay.combo_type
        } : null,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: `Cannot beat ${lastCombo} with ${comboType}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 9. ✅ Verify player has all the cards (with backwards compatibility for string cards)
    const currentHands = gameState.hands || {};
    const playerHandRaw = currentHands[player.player_index] || [];
    const playerHand = parseCards(playerHandRaw); // Parse cards (handles strings and objects)
    
    for (const card of cards) {
      const hasCard = playerHand.some((c: Card) => c.id === card.id);
      if (!hasCard) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Card not in hand: ${card.id}`,
            debug: {
              requested_card: card.id,
              player_hand_ids: playerHand.map(c => c.id),
              raw_hand_sample: playerHandRaw.slice(0, 3),
            }
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 10. ✅ ONE CARD LEFT RULE: Validate using Postgres function
    const nextPlayerIndex = (player.player_index + 1) % 4;
    const nextPlayerHandRaw = currentHands[nextPlayerIndex] || [];
    const nextPlayerHand = parseCards(nextPlayerHandRaw);
    
    // Only check if next player has 1 card and current play is a single
    if (nextPlayerHand.length === 1 && cards.length === 1) {
      console.log('🎯 One Card Left check triggered:', {
        nextPlayerIndex,
        nextPlayerCards: nextPlayerHand.length,
        playingCards: cards.length,
      });

      try {
        // Create a timeout promise (5 seconds max)
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('One Card Left validation timeout (5s)')), 5000);
        });

        // Call SQL function with proper JSONB formatting
        const validationPromise = supabaseClient
          .rpc('validate_one_card_left_rule', {
            p_selected_cards: cards,           // Array of Card objects
            p_current_player_hand: playerHand, // Array of Card objects
            p_next_player_card_count: nextPlayerHand.length, // INTEGER
            p_last_play: lastPlay || null      // LastPlay object or null
          });

        // Race between validation and timeout
        const { data: oneCardLeftValidation, error: validationError } = await Promise.race([
          validationPromise,
          timeoutPromise
        ]) as any;

        if (validationError) {
          console.error('❌ One Card Left SQL error:', {
            message: validationError.message,
            details: validationError.details,
            hint: validationError.hint,
            code: validationError.code,
          });
          // Don't block gameplay if SQL function fails - just log and continue
        } else if (oneCardLeftValidation && !oneCardLeftValidation.valid) {
          console.log('❌ One Card Left Rule violation:', oneCardLeftValidation);
          return new Response(
            JSON.stringify({
              success: false,
              error: oneCardLeftValidation.error,
              required_card: oneCardLeftValidation.required_card,
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          console.log('✅ One Card Left validation passed');
        }
      } catch (err) {
        console.error('❌ One Card Left exception:', err);
        // Don't block gameplay if validation throws - log and continue
      }
    }

    // 11. ✅ Remove cards from player's hand
    const cardIdsToRemove = new Set(cards.map((c: Card) => c.id));
    const updatedHand = playerHand.filter((c: Card) => !cardIdsToRemove.has(c.id));
    
    const updatedHands = {
      ...currentHands,
      [player.player_index]: updatedHand,
    };

    // 11. Check if match ended (player played last card)
    const matchEnded = updatedHand.length === 0;
    
    // 12. Calculate match scores if match ended
    let matchScores: any[] | null = null;
    let gameOver = false;
    let finalWinnerIndex: number | null = null;
    
    if (matchEnded) {
      console.log('🏁 Match ended! Calculating scores...');
      
      // Get all room players with current scores
      const { data: roomPlayersData, error: playersError } = await supabaseClient
        .from('room_players')
        .select('*')
        .eq('room_id', room.id)
        .order('player_index', { ascending: true });

      if (playersError || !roomPlayersData) {
        console.error('Failed to get room players for scoring:', playersError);
      } else {
        // Calculate scores for each player
        matchScores = roomPlayersData.map((rp) => {
          const hand = updatedHands[rp.player_index];
          const cardsRemaining = hand ? hand.length : 0;
          const currentScore = rp.score || 0;
          
          // Scoring logic
          let pointsPerCard: number;
          if (cardsRemaining >= 1 && cardsRemaining <= 4) {
            pointsPerCard = 1;
          } else if (cardsRemaining >= 5 && cardsRemaining <= 9) {
            pointsPerCard = 2;
          } else if (cardsRemaining >= 10 && cardsRemaining <= 13) {
            pointsPerCard = 3;
          } else {
            pointsPerCard = 0; // Winner
          }
          
          const matchScore = cardsRemaining * pointsPerCard;
          const cumulativeScore = currentScore + matchScore;
          
          return {
            player_index: rp.player_index,
            user_id: rp.user_id,
            cardsRemaining,
            pointsPerCard,
            matchScore,
            cumulativeScore,
          };
        });

        console.log('📊 Match scores calculated:', matchScores);

        // Update room_players with new cumulative scores
        for (const score of matchScores) {
          await supabaseClient
            .from('room_players')
            .update({ score: score.cumulativeScore })
            .eq('room_id', room.id)
            .eq('player_index', score.player_index);
        }

        // Check if game should end (someone >= 101 points)
        gameOver = matchScores.some(s => s.cumulativeScore >= 101);
        
        if (gameOver) {
          // Find final winner (lowest score)
          let lowestScore = Infinity;
          let winnerIndex = matchScores[0].player_index;
          
          for (const score of matchScores) {
            if (score.cumulativeScore < lowestScore) {
              lowestScore = score.cumulativeScore;
              winnerIndex = score.player_index;
            }
          }
          
          finalWinnerIndex = winnerIndex;
          console.log('🎉 GAME OVER! Final winner:', finalWinnerIndex, 'Scores:', matchScores);
        }
      }
    }

    // 13. Calculate next turn (COUNTERCLOCKWISE: 0→1→2→3→0)
    /*
     * Turn order mapping by player_index: 0→1, 1→2, 2→3, 3→0
     * Example sequence starting from player 0: 0→1→2→3→0 (counterclockwise around the table)
     * NOTE: This MUST match local game AI turn-order logic and player-pass function
     */
    const turnOrder = [1, 2, 3, 0]; // Next player index for current indices [0, 1, 2, 3]
    const nextTurn = turnOrder[player.player_index];

    // 12. Update played_cards (all cards played so far)
    const updatedPlayedCards = [...played_cards, ...cards];

    // 13. Detect highest play and create auto-pass timer
    // We pass played_cards (BEFORE current cards), not updatedPlayedCards.
    // WHY: isHighestPossiblePlay() checks if ANY unplayed cards can beat the current play.
    // - played_cards = cards already played in previous turns (unavailable to beat current play)
    // - cards = the current play being evaluated
    // By excluding 'cards' from played_cards, we correctly identify all cards that COULD beat this play.
    // If no unplayed cards can beat it, we know this is the highest possible play and trigger auto-pass.
    const isHighestPlay = isHighestPossiblePlay(cards, played_cards);
    let autoPassTimerState = null;

    console.log('⏰ Auto-pass timer check:', {
      isHighestPlay,
      cardsLength: cards.length,
      cardsPlayed: cards.map(c => c.id),
      totalPlayedCards: updatedPlayedCards.length,
      playedCardsBeforeCurrent: played_cards.length,
    });

    // CRITICAL FIX: Do NOT create auto-pass timer when match has ended.
    // When a player plays their last card (matchEnded=true), the match is over —
    // there's no one left to auto-pass. Creating a timer here causes the client-side
    // AutoPassTimer to loop at remaining=0 indefinitely, spamming logs and potentially
    // blocking the start_new_match transition.

    // Also check if all opponents can't respond because they have fewer cards than
    // the combo size — they physically cannot play a response, so auto-pass should
    // trigger even if the play isn't strictly the "highest possible".
    const comboSize = cards.length;
    const allOpponentsCantRespond = comboSize > 1 && [0, 1, 2, 3]
      .filter(i => i !== player.player_index)
      .every(i => {
        const hand = updatedHands[i];
        return !hand || (Array.isArray(hand) ? hand.length : 0) < comboSize;
      });

    if (allOpponentsCantRespond && !isHighestPlay) {
      console.log('⏰ All opponents have fewer cards than combo size:', {
        comboSize,
        opponentHandSizes: [0, 1, 2, 3]
          .filter(i => i !== player.player_index)
          .map(i => ({ player: i, cards: Array.isArray(updatedHands[i]) ? updatedHands[i].length : 0 })),
      });
    }

    const shouldCreateTimer = (isHighestPlay || allOpponentsCantRespond) && !matchEnded;

    if (shouldCreateTimer) {
      const serverTimeMs = Date.now();
      const durationMs = 10000; // 10 seconds
      const endTimestamp = serverTimeMs + durationMs;
      const existingSequenceId = (gameState.auto_pass_timer as any)?.sequence_id || 0;
      const sequenceId = existingSequenceId + 1;

      autoPassTimerState = {
        active: true,
        started_at: new Date(serverTimeMs).toISOString(),
        duration_ms: durationMs,
        remaining_ms: durationMs,
        end_timestamp: endTimestamp,
        sequence_id: sequenceId,
        server_time_at_creation: serverTimeMs,
        triggering_play: {
          position: player.player_index,
          cards,
          combo_type: comboType,
        },
        player_id: player.user_id,
        // Add player_index at top level for client compatibility
        player_index: player.player_index,
      };

      console.log('✅ Auto-pass timer CREATED:', {
        reason: isHighestPlay ? 'highest_play' : 'opponents_cant_respond',
        serverTimeMs,
        endTimestamp,
        sequenceId,
        cards: cards.map(c => c.id),
        comboType,
      });
    } else if (matchEnded) {
      console.log('ℹ️ Auto-pass timer NOT created - match ended (player played last card)');
    } else {
      console.log('ℹ️ Auto-pass timer NOT created - not highest play');
    }

    // 14. Update game state (including timer and match winner)
    // Append this play to play_history server-side so bot plays (which bypass the client)
    // are also captured. The client-side play_history write in realtimeActions.ts has been
    // removed to avoid duplicates — the EF is now the single source of truth.
    const updatedPlayHistory = [
      ...(Array.isArray(gameState.play_history) ? gameState.play_history : []),
      {
        match_number: gameState.match_number || 1,
        position: player.player_index,
        cards,
        combo_type: comboType,
        passed: false,
      },
    ];

    const updateData: any = {
      hands: updatedHands,
      last_play: {
        player_index: player.player_index,
        cards,
        combo_type: comboType,
        timestamp: Date.now(),
      },
      current_turn: nextTurn,
      passes: 0,
      played_cards: updatedPlayedCards,
      auto_pass_timer: autoPassTimerState,
      play_history: updatedPlayHistory,
      // Monotonic action counter — never resets. Used by game_hands_training to
      // produce a unique play_sequence per action without relying on the
      // consecutive-pass counter (gameState.passes) which resets after each trick.
      total_training_actions: (typeof gameState.total_training_actions === 'number' && Number.isFinite(gameState.total_training_actions)
        ? gameState.total_training_actions : 0) + 1,
      updated_at: new Date().toISOString(),
    };

    // ✅ CRITICAL FIX: Freeze game when match ends to prevent bots from playing during transition
    // Set game_phase='finished' to stop all further plays until start_new_match resets it
    // Also store match winner and timestamps for proper tracking
    if (matchEnded) {
      updateData.game_phase = 'finished'; // ← FREEZE THE GAME
      updateData.last_match_winner_index = player.player_index; // Store match winner
      updateData.match_ended_at = new Date().toISOString(); // Record match end time
      console.log(`✅ Match ended! Player ${player.player_index} won. Game frozen (phase=finished)`);

      // Persist match scores to scores_history so clients can reconstruct the
      // scoreboard from game_state alone — critical for bot-triggered match ends
      // where no HTTP response/broadcast reaches the human client.
      if (matchScores) {
        const existingHistory = Array.isArray(gameState.scores_history) ? gameState.scores_history : [];
        updateData.scores_history = [
          ...existingHistory,
          {
            match_number: gameState.match_number || 1,
            scores: matchScores.map((s: any) => ({
              player_index: s.player_index,
              matchScore: s.matchScore,
              cumulativeScore: s.cumulativeScore,
              cardsRemaining: s.cardsRemaining,
            })),
          },
        ];
        console.log(`📊 Persisted match ${gameState.match_number || 1} scores to scores_history`);
      }
      
      // If game is over (someone >= 101), also record game end
      if (gameOver && finalWinnerIndex !== null) {
        updateData.game_phase = 'game_over'; // Game completely finished
        updateData.game_winner_index = finalWinnerIndex; // Store game winner (lowest score)
        updateData.winner = finalWinnerIndex; // Legacy alias used by client stats uploader
        updateData.game_ended_at = new Date().toISOString(); // Record game end time

        // Build final_scores map for client consumption (keyed by player_index string)
        if (matchScores) {
          const finalScoresMap: Record<string, number> = {};
          for (const s of matchScores) {
            finalScoresMap[String(s.player_index)] = s.cumulativeScore;
          }
          updateData.final_scores = finalScoresMap;
        }
        console.log(`🎉 GAME OVER recorded! Winner: Player ${finalWinnerIndex}`);
      }
    }

    // NOTE: game_phase transition from "first_play" to "playing" is handled automatically
    // by database trigger 'trigger_transition_game_phase' (see migration 20260106222754)
    // No manual transition needed here to avoid race conditions

    // Optimistic concurrency control: only update if total_training_actions hasn't
    // changed since we read the game state.  This prevents play-cards and
    // auto-play-turn (via player-pass) from both succeeding on the same turn.
    // Column is NOT NULL DEFAULT 0, so coerce missing/invalid values to 0 (matching
    // the derivation used for the incremented value in updateData above).
    const totalTrainingActions = typeof gameState.total_training_actions === 'number' && Number.isFinite(gameState.total_training_actions)
      ? gameState.total_training_actions : 0;
    const updateQuery = supabaseClient
      .from('game_state')
      .update(updateData)
      .eq('id', gameState.id)
      .eq('total_training_actions', totalTrainingActions);
    const { data: updatedRows, error: updateError } = await updateQuery.select('id');

    if (updateError) {
      console.error('Failed to update game state:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update game state' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!updatedRows || updatedRows.length === 0) {
      return concurrentModificationResponse('play-cards CAS', corsHeaders, 'play-cards');
    }

    // 14b. Fire-and-forget: insert training row into game_hands_training.
    // Non-blocking — runs in background via EdgeRuntime.waitUntil so it never
    // delays the response to the client. Failures are logged but not fatal.
    // game_state does not have a game_session_id column; use room.id (a stable
    // UUID) as the session identifier — combined with round_number it uniquely
    // identifies each match played in a room.
    const trainingInsert = (async () => {
      try {
        // Prefer real user_id; fall back to stable player.id for bots/service roles.
        const stableId = (player.user_id ?? player.id)?.toString();
        if (!stableId) throw new Error('Missing stable identifier for player');

        // Anonymise the identifier with a stable hash for privacy (cached per EF instance)
        let playerHash = _playerHashCache.get(stableId);
        if (!playerHash) {
          const encoder = new TextEncoder();
          const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(stableId));
          playerHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
          _cachedPlayerHash(playerHash, stableId);
        }

        // opponent_hand_sizes: 4-element array indexed by player seat.
        // Own seat is null (not an opponent); the three opponent slots hold
        // the number of cards each opponent has after this play.
        const opponentHandSizes: (number | null)[] = [null, null, null, null];
        for (const idx of [0, 1, 2, 3]) {
          if (idx !== player.player_index) {
            const h = updatedHands[idx];
            opponentHandSizes[idx] = Array.isArray(h) ? h.length : 0;
          }
        }
        const totalCardsRemaining = Object.values(updatedHands as Record<string, unknown[]>)
          .reduce((sum, h) => sum + (Array.isArray(h) ? h.length : 0), 0);

        // play_sequence: derived from total_training_actions, a session-global
        // monotonically increasing counter persisted in game_state.total_training_actions
        // (added in migration 20260718000003). It increments on every play (here)
        // and every pass (player-pass). It NEVER resets between rounds/tricks, so
        // play_sequence values accumulate across rounds within a session. This is
        // intentional: the unique index on (game_session_id, round_number,
        // play_sequence, player_index) is still satisfied because the counter
        // grows strictly — no two actions in the same session share the same value.
        const playSequence = (typeof gameState.total_training_actions === 'number' && Number.isFinite(gameState.total_training_actions)
          ? gameState.total_training_actions : 0) + 1;

        // is_first_play_of_round: no last_play (trick was just won or game start).
        // 4-player game: all 3 opponents passing means passes === 3.
        const PLAYER_COUNT = 4;
        const isFirstPlayOfRound = !gameState.last_play || (gameState.passes ?? 0) >= PLAYER_COUNT - 1;

        const trainingRow = {
          room_id: room.id,
          room_code: room_code,
          game_session_id: room.id, // room.id is the stable session UUID
          round_number: gameState.match_number || 1,
          play_sequence: playSequence,
          player_index: player.player_index,
          is_bot: player.is_bot ?? false,
          player_hash: playerHash,
          hand_before_play: playerHand,
          hand_size_before: playerHand.length,
          cards_played: cards,
          combo_type: comboType,
          combo_key: null, // could add numeric sort key later
          last_play_before: gameState.last_play ?? null,
          last_play_combo_type: (gameState.last_play as any)?.combo_type ?? null,
          is_first_play_of_round: isFirstPlayOfRound,
          is_first_play_of_game: (gameState.match_number || 1) === 1 && !gameState.last_play,
          passes_before_this_play: gameState.passes || 0,
          opponent_hand_sizes: opponentHandSizes,
          total_cards_remaining: totalCardsRemaining,
          won_trick: isHighestPlay || allOpponentsCantRespond,
          won_round: matchEnded,
          won_game: gameOver && finalWinnerIndex === player.player_index,
          cards_remaining_after_play: updatedHand.length,
          was_highest_possible: isHighestPlay,
          alternative_plays_available: null, // expensive to compute; leave for later
          risk_score: null,
          game_ended_at: (gameOver && updateData.game_ended_at) ? updateData.game_ended_at : null,
          game_type: room.ranked_mode === true
            ? 'ranked'
            : (room.is_public ?? true) === true
              ? 'casual'
              : 'private',
          bot_difficulty: player.is_bot ? (player.bot_difficulty ?? null) : null,
        };

        const { error: tErr } = await supabaseClient
          .from('game_hands_training')
          .upsert(trainingRow, { onConflict: 'game_session_id,round_number,play_sequence,player_index', ignoreDuplicates: true });
        if (tErr) console.warn('[play-cards] Training insert warning:', tErr.message);
      } catch (trainingErr) {
        console.warn('[play-cards] Training data prep failed (non-critical):', trainingErr);
      }
    })();

    try { (globalThis as any).EdgeRuntime?.waitUntil(trainingInsert); } catch (_) { /* non-critical */ }

    // 15. Trigger bot-coordinator if next player is a bot (Task #551)
    // Only suppress the trigger when this call came from the coordinator itself.
    // Accept either the service-role key match OR the stable internal bot auth key —
    // the same dual-check used at the top of this function for isServiceRole.
    const serviceKeyForCheck  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const internalKeyForCheck = Deno.env.get('INTERNAL_BOT_AUTH_KEY') ?? '';
    const hasInternalKeyForCheck = internalKeyForCheck !== '';
    const authHeaderForCheck  = req.headers.get('authorization') ?? '';
    const botAuthHdrForCheck  = req.headers.get('x-bot-auth') ?? '';
    const botBodyAuthForCheck = bodyJson?._bot_auth ?? '';
    const isInternalCoordinatorCall =
      req.headers.get('x-bot-coordinator') === 'true' &&
      (
        (serviceKeyForCheck !== '' && authHeaderForCheck === `Bearer ${serviceKeyForCheck}`) ||
        (hasInternalKeyForCheck && botAuthHdrForCheck === internalKeyForCheck) ||
        (hasInternalKeyForCheck && botBodyAuthForCheck === internalKeyForCheck)
      );

    if (!isInternalCoordinatorCall && !matchEnded && !gameOver) {
      try {
        const { data: nextPlayer } = await supabaseClient
          .from('room_players')
          .select('is_bot')
          .eq('room_id', room.id)
          .eq('player_index', nextTurn)
          .single();

        if (nextPlayer?.is_bot) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
          // Use EdgeRuntime.waitUntil so the response returns immediately to the client
          // and bot-coordinator executes as a background task. This prevents the player's
          // play-cards call from blocking while all consecutive bot turns execute (~1–10 s),
          // which was causing the spinner to stay on and bots to appear slow.
          const botPromise = fetch(`${supabaseUrl}/functions/v1/bot-coordinator`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              'x-bot-coordinator': 'true',
            },
            body: JSON.stringify({ room_code }),
          }).then(res => {
            if (res.ok) {
              console.log(`🤖 [play-cards] Bot coordinator triggered for next player ${nextTurn}`);
            } else {
              res.text().then(body => console.error(`[play-cards] ⚠️ Bot coordinator non-2xx: ${res.status}`, body)).catch(() => {});
            }
          }).catch(err => {
            console.error('[play-cards] ⚠️ Bot coordinator trigger failed:', err);
          });
          try { (globalThis as any).EdgeRuntime?.waitUntil(botPromise); } catch (_) {
            // EdgeRuntime.waitUntil not available in test/local environments
          }
        }
      } catch (err) {
        console.error('[play-cards] ⚠️ Bot next-player check failed (non-critical):', err);
      }
    }

    // 16. Success response (includes timer state and match scores)
    return new Response(
      JSON.stringify({
        success: true,
        next_turn: nextTurn,
        combo_type: comboType,
        cards_remaining: updatedHand.length,
        match_ended: matchEnded,
        auto_pass_timer: autoPassTimerState,
        highest_play_detected: isHighestPlay,
        match_scores: matchScores,
        game_over: gameOver,
        final_winner_index: finalWinnerIndex,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('play-cards error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
