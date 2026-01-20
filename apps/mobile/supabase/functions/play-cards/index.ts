// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
// @copilot-review-fix: Using shared parseCards utility (parseCard not needed here)
import { parseCards } from '../_shared/parseCards.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  // Already a proper card object
  if (typeof cardData === 'object' && cardData !== null && 'id' in cardData && 'rank' in cardData && 'suit' in cardData) {
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
      
      // Fallback for legacy format without regex validation
      const suit = cardStr[0] as 'D' | 'C' | 'H' | 'S';
      const rank = cardStr.substring(1) as Card['rank'];
      return { id: cardStr, suit, rank };
    }
  }
  
  // Failed to parse - log warning with details
  console.warn('[parseCard] Failed to parse card - returning null:', { cardData, type: typeof cardData });
  return null;
}

// @copilot-review-fix: parseCards imported from shared utility at top. parseCard() is defined locally above for single-card parsing.

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
  
  // Check if same combo type but stronger exists
  const sameTypeCombos = generateCombosOfType(notInCurrent, comboType as ComboType);
  if (sameTypeCombos.length === 0) {
    return true;
  }
  
  const sorted = sortHand(cards);
  const highest = sorted[sorted.length - 1];
  
  for (const combo of sameTypeCombos) {
    const comboSorted = sortHand(combo);
    const comboHighest = comboSorted[comboSorted.length - 1];
    
    if (getCardValue(comboHighest) > getCardValue(highest)) {
      return false;
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
      const straightInfo = isStraight(bySuit[suit].slice(0, 5));
      if (straightInfo.valid) return true;
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

function generateCombosOfType(cards: Card[], comboType: ComboType): Card[][] {
  // Simplified implementation - return empty for now
  // Full implementation would generate all possible combos of that type
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

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { room_code, player_id, cards } = await req.json();

    console.log('🎮 [play-cards] Request received:', {
      room_code,
      player_id: player_id?.substring(0, 8),
      cards_count: Array.isArray(cards) ? cards.length : 'not array',
    });

    if (!room_code || !player_id || !cards || cards.length === 0) {
      console.log('❌ [play-cards] Missing required fields');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Get room ID
    const { data: room, error: roomError } = await supabaseClient
      .from('rooms')
      .select('id')
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

    // 3. Get player info (using user_id column, not id)
    const { data: player, error: playerError } = await supabaseClient
      .from('room_players')
      .select('*')
      .eq('user_id', player_id)  // ✅ FIX: Use user_id column (not id which is the record UUID)
      .eq('room_id', room.id)
      .single();

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

    // 4. Verify it's this player's turn
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
    // @copilot-review-fix (Round 8): Clarified - we intentionally pass played_cards (BEFORE adding current cards)
    // NOT updatedPlayedCards. This is correct because isHighestPossiblePlay() needs to know what cards
    // were played BEFORE this turn to determine if the current play is the highest remaining.
    // The updatedPlayedCards is only used for the database update below.
    const isHighestPlay = isHighestPossiblePlay(cards, played_cards);
    let autoPassTimerState = null;

    console.log('⏰ Auto-pass timer check:', {
      isHighestPlay,
      cardsLength: cards.length,
      cardsPlayed: cards.map(c => c.id),
      totalPlayedCards: updatedPlayedCards.length,
      playedCardsBeforeCurrent: played_cards.length,
    });

    if (isHighestPlay) {
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

      console.log('✅ Auto-pass timer CREATED (highest play detected):', {
        serverTimeMs,
        endTimestamp,
        sequenceId,
        cards: cards.map(c => c.id),
        comboType,
      });
    } else {
      console.log('ℹ️ Auto-pass timer NOT created - not highest play');
    }

    // 14. Update game state (including timer and match winner)
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
      
      // If game is over (someone >= 101), also record game end
      if (gameOver && finalWinnerIndex !== null) {
        updateData.game_phase = 'game_over'; // Game completely finished
        updateData.game_winner_index = finalWinnerIndex; // Store game winner (lowest score)
        updateData.game_ended_at = new Date().toISOString(); // Record game end time
        console.log(`🎉 GAME OVER recorded! Winner: Player ${finalWinnerIndex}`);
      }
    }

    // NOTE: game_phase transition from "first_play" to "playing" is handled automatically
    // by database trigger 'trigger_transition_game_phase' (see migration 20260106222754)
    // No manual transition needed here to avoid race conditions

    const { error: updateError } = await supabaseClient
      .from('game_state')
      .update(updateData)
      .eq('room_id', room.id);

    if (updateError) {
      console.error('Failed to update game state:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update game state' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 15. Success response (includes timer state and match scores)
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
