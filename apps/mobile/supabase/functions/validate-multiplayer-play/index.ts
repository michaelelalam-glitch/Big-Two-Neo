import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Card {
  id: string;
  rank: string;
  suit: string;
}

interface LastPlay {
  cards: Card[];
  combo: string;
}

interface RoomPlayer {
  player_id: string;
  position: number;
  hand: Card[];
}

interface Room {
  id: string;
  current_turn_player_id: string;
  last_play: LastPlay | null;
  room_players: RoomPlayer[];
}

interface ValidatePlayRequest {
  room_id: string;
  player_id: string;
  action: 'play' | 'pass';
  cards?: Card[];
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  next_player_hand_count?: number;
}

// ============================================================================
// CONSTANTS (from game engine)
// ============================================================================

const RANK_VALUE: Record<string, number> = {
  '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6,
  '10': 7, 'J': 8, 'Q': 9, 'K': 10, 'A': 11, '2': 12,
};

const SUIT_VALUE: Record<string, number> = {
  'D': 0, // Diamonds
  'C': 1, // Clubs
  'H': 2, // Hearts
  'S': 3, // Spades
};

const COMBO_STRENGTH: Record<string, number> = {
  'Single': 1,
  'Pair': 2,
  'Triple': 3,
  'Straight': 5,
  'Flush': 6,
  'Full House': 7,
  'Four of a Kind': 8,
  'Straight Flush': 9,
};

const SUIT_SYMBOLS: Record<string, string> = {
  'D': '♦',
  'C': '♣',
  'H': '♥',
  'S': '♠',
};

// ============================================================================
// CORS HEADERS
// ============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get card value for comparison (rank + suit)
 */
function getCardValue(card: Card): number {
  return RANK_VALUE[card.rank] * 10 + SUIT_VALUE[card.suit];
}

/**
 * Sort cards by rank and suit value (ascending)
 */
function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const rankDiff = RANK_VALUE[a.rank] - RANK_VALUE[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return SUIT_VALUE[a.suit] - SUIT_VALUE[b.suit];
  });
}

/**
 * Find the highest card in a hand
 */
function findHighestCard(hand: Card[]): Card {
  const sorted = sortHand(hand);
  return sorted[sorted.length - 1];
}

/**
 * Check if two cards are equal (same rank and suit)
 */
function areCardsEqual(card1: Card, card2: Card): boolean {
  return card1.rank === card2.rank && card1.suit === card2.suit;
}

/**
 * Format a card for display (e.g., "2♠")
 */
function formatCard(card: Card): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit] || card.suit}`;
}

/**
 * Count cards by rank
 */
function countByRank(cards: Card[]): Record<string, number> {
  return cards.reduce((acc, card) => {
    acc[card.rank] = (acc[card.rank] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

/**
 * Get the rank that appears 3 times in a full house
 */
function getTripleRank(cards: Card[]): string {
  const counts = countByRank(cards);
  for (const rank in counts) {
    if (counts[rank] === 3) return rank;
  }
  throw new Error('No triple found in full house');
}

/**
 * Get the rank that appears 4 times in four of a kind
 */
function getQuadRank(cards: Card[]): string {
  const counts = countByRank(cards);
  for (const rank in counts) {
    if (counts[rank] === 4) return rank;
  }
  throw new Error('No quad found in four of a kind');
}

/**
 * Simplified card classification (just enough for canBeatPlay)
 */
function classifyCards(cards: Card[]): string {
  if (cards.length === 1) return 'Single';
  if (cards.length === 2) {
    return cards[0].rank === cards[1].rank ? 'Pair' : 'unknown';
  }
  if (cards.length === 3) {
    return cards.every(c => c.rank === cards[0].rank) ? 'Triple' : 'unknown';
  }
  if (cards.length === 5) {
    // Simplified 5-card classification
    const counts = countByRank(cards);
    const countValues = Object.values(counts).sort((a, b) => b - a);
    
    if (countValues[0] === 4) return 'Four of a Kind';
    if (countValues[0] === 3 && countValues[1] === 2) return 'Full House';
    
    // Check for flush
    const allSameSuit = cards.every(c => c.suit === cards[0].suit);
    
    // Check for straight (simplified - just check if ranks form sequence)
    const sorted = sortHand(cards);
    let isStraight = true;
    for (let i = 1; i < sorted.length; i++) {
      const prevRank = RANK_VALUE[sorted[i - 1].rank];
      const currRank = RANK_VALUE[sorted[i].rank];
      if (currRank !== prevRank + 1) {
        isStraight = false;
        break;
      }
    }
    
    if (allSameSuit && isStraight) return 'Straight Flush';
    if (isStraight) return 'Straight';
    if (allSameSuit) return 'Flush';
  }
  
  return 'unknown';
}

/**
 * Check if new cards can beat the last play
 * (Simplified version of game engine logic)
 */
function canBeatPlay(newCards: Card[], lastPlay: LastPlay | null): boolean {
  if (!lastPlay) return true;
  
  if (newCards.length !== lastPlay.cards.length) return false;
  
  const newCombo = classifyCards(newCards);
  if (newCombo === 'unknown') return false;
  
  const newStrength = COMBO_STRENGTH[newCombo] || 0;
  const lastStrength = COMBO_STRENGTH[lastPlay.combo] || 0;
  
  // Different combo types - compare strength
  if (newCombo !== lastPlay.combo) {
    return newStrength > lastStrength;
  }
  
  // Same combo type - compare based on combo-specific rules
  const newSorted = sortHand(newCards);
  const lastSorted = sortHand(lastPlay.cards);
  
  // For Full House, compare the triple rank
  if (newCombo === 'Full House') {
    const newTripleRank = getTripleRank(newSorted);
    const lastTripleRank = getTripleRank(lastSorted);
    return RANK_VALUE[newTripleRank] > RANK_VALUE[lastTripleRank];
  }
  
  // For Four of a Kind, compare the quad rank
  if (newCombo === 'Four of a Kind') {
    const newQuadRank = getQuadRank(newSorted);
    const lastQuadRank = getQuadRank(lastSorted);
    return RANK_VALUE[newQuadRank] > RANK_VALUE[lastQuadRank];
  }
  
  // For other combos, compare highest card
  const newHighest = newSorted[newSorted.length - 1];
  const lastHighest = lastSorted[lastSorted.length - 1];
  
  return getCardValue(newHighest) > getCardValue(lastHighest);
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role key
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Parse request body
    const requestData: ValidatePlayRequest = await req.json();
    const { room_id, player_id, action, cards } = requestData;

    console.log('[Validate Play] Request:', {
      room_id,
      player_id,
      action,
      cards_count: cards?.length || 0,
    });

    // Validate required fields
    if (!room_id || !player_id || !action) {
      return new Response(
        JSON.stringify({
          valid: false,
          error: 'Missing required fields: room_id, player_id, action',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'play' && (!cards || cards.length === 0)) {
      return new Response(
        JSON.stringify({
          valid: false,
          error: 'Cards required for play action',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========================================================================
    // STEP 1: FETCH ROOM STATE AND PLAYER HANDS
    // ========================================================================

    const { data: room, error: roomError } = await supabaseAdmin
      .from('rooms')
      .select(`
        id,
        current_turn_player_id,
        last_play,
        room_players!inner(
          player_id,
          position,
          hand
        )
      `)
      .eq('id', room_id)
      .single();

    if (roomError || !room) {
      console.error('[Validate Play] Room fetch error:', roomError);
      return new Response(
        JSON.stringify({
          valid: false,
          error: 'Room not found',
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cast to proper type
    const roomData = room as unknown as Room;

    // Verify it's the player's turn
    if (roomData.current_turn_player_id !== player_id) {
      return new Response(
        JSON.stringify({
          valid: false,
          error: 'Not your turn',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========================================================================
    // STEP 2: DETERMINE NEXT PLAYER
    // ========================================================================

    const sortedPlayers = roomData.room_players.sort((a, b) => a.position - b.position);
    const currentPlayerIndex = sortedPlayers.findIndex(p => p.player_id === player_id);
    
    if (currentPlayerIndex === -1) {
      return new Response(
        JSON.stringify({
          valid: false,
          error: 'Player not found in room',
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const nextPlayerIndex = (currentPlayerIndex + 1) % sortedPlayers.length;
    const nextPlayer = sortedPlayers[nextPlayerIndex];
    const currentPlayer = sortedPlayers[currentPlayerIndex];

    console.log('[Validate Play] Players:', {
      current_player: player_id,
      next_player: nextPlayer.player_id,
      next_player_hand_count: nextPlayer.hand?.length || 0,
    });

    // ========================================================================
    // STEP 3: ONE-CARD-LEFT RULE VALIDATION
    // ========================================================================

    const nextPlayerHandCount = nextPlayer.hand?.length || 0;

    if (nextPlayerHandCount === 1) {
      console.log('[Validate Play] One-card-left rule active');

      if (action === 'play') {
        // Rule: Must play highest card when playing a single
        if (cards!.length === 1) {
          const playerHand = currentPlayer.hand || [];
          
          if (playerHand.length === 0) {
            return new Response(
              JSON.stringify({
                valid: false,
                error: 'Player has no cards',
              }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          const highestCard = findHighestCard(playerHand);
          const playingCard = cards![0];

          console.log('[Validate Play] Checking highest card:', {
            highest: formatCard(highestCard),
            playing: formatCard(playingCard),
          });

          if (!areCardsEqual(playingCard, highestCard)) {
            return new Response(
              JSON.stringify({
                valid: false,
                error: `Next player has 1 card! You must play your highest card: ${formatCard(highestCard)}`,
                next_player_hand_count: 1,
              }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
        // Allow multi-card plays (pairs, triples, 5-card combos) without restriction
        
      } else if (action === 'pass') {
        // Rule: Cannot pass if you can beat the last play
        if (roomData.last_play) {
          const playerHand = currentPlayer.hand || [];
          const canBeat = canBeatPlay(playerHand, roomData.last_play);

          console.log('[Validate Play] Checking pass legality:', {
            can_beat: canBeat,
            last_play: roomData.last_play.combo,
          });

          if (canBeat) {
            return new Response(
              JSON.stringify({
                valid: false,
                error: 'Next player has 1 card! You cannot pass when you can beat the play.',
                next_player_hand_count: 1,
              }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
      }
    }

    // ========================================================================
    // STEP 4: VALIDATION PASSED
    // ========================================================================

    console.log('[Validate Play] Validation passed');

    return new Response(
      JSON.stringify({
        valid: true,
        next_player_hand_count: nextPlayerHandCount,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Validate Play] Error:', error);
    return new Response(
      JSON.stringify({
        valid: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
