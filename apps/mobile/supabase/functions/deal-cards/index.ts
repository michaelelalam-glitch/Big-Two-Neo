import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Card {
  id: string;      // e.g., "3D", "AS", "2H"
  rank: string;    // '3'-'10', 'J', 'Q', 'K', 'A', '2'
  suit: string;    // 'D', 'C', 'H', 'S'
}

/**
 * Deal Cards Edge Function
 * 
 * Handles server-side card dealing for multiplayer Big Two games.
 * This ensures cards are dealt fairly and cannot be manipulated by clients.
 * 
 * Flow:
 * 1. Verify room is ready to start
 * 2. Create and shuffle 52-card deck
 * 3. Deal cards evenly to all players
 * 4. Find player with 3 of Diamonds (starting player)
 * 5. Store hands in room_players.hand (JSONB)
 * 6. Update game_state to 'playing' phase
 * 
 * Security:
 * - Uses service role key (bypasses RLS)
 * - Stores cards server-side (clients only see their own hand)
 * - Shuffle algorithm uses crypto.getRandomValues() for fairness
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    // 1. Parse request
    const { room_id } = await req.json();
    
    if (!room_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'room_id is required' }),
        { 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }, 
          status: 400 
        }
      );
    }
    
    // 2. Initialize Supabase client with service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // 3. Verify room exists and is ready
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, status')
      .eq('id', room_id)
      .single();
    
    if (roomError) {
      throw new Error(`Room not found: ${roomError.message}`);
    }
    
    if (room.status !== 'playing') {
      throw new Error(`Room not ready (status: ${room.status}). Expected status: 'playing'`);
    }
    
    // 4. Get players (ordered by position)
    const { data: roomPlayers, error: playersError } = await supabase
      .from('room_players')
      .select('player_id, position')
      .eq('room_id', room_id)
      .order('position');
    
    if (playersError) {
      throw new Error(`Failed to fetch players: ${playersError.message}`);
    }
    
    if (!roomPlayers || roomPlayers.length < 2) {
      throw new Error(`Not enough players (found ${roomPlayers?.length || 0}, need at least 2)`);
    }
    
    if (roomPlayers.length > 4) {
      throw new Error(`Too many players (found ${roomPlayers.length}, maximum 4)`);
    }
    
    // 5. Create and shuffle deck
    const deck = createDeck();
    shuffleDeck(deck);
    
    console.log(`[deal-cards] Dealing to ${roomPlayers.length} players`);
    
    // 6. Deal cards (13 per player for 4 players, evenly distributed for 2-3 players)
    const cardsPerPlayer = Math.floor(52 / roomPlayers.length);
    const hands: Card[][] = [];
    
    for (let i = 0; i < roomPlayers.length; i++) {
      const hand = deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer);
      hands.push(hand);
      console.log(`[deal-cards] Player ${i} (${roomPlayers[i].player_id}): ${hand.length} cards`);
    }
    
    // 7. Find player with 3♦ (starting player in Big Two)
    let startingPlayerIndex = 0;
    let startingPlayerId = roomPlayers[0].player_id;
    for (let i = 0; i < hands.length; i++) {
      if (hands[i].some(card => card.id === '3D')) {
        startingPlayerIndex = i;
        startingPlayerId = roomPlayers[i].player_id;
        console.log(`[deal-cards] Player ${i} (${startingPlayerId}) has 3♦ (starting player)`);
        break;
      }
    }
    
    // 8. Update each player's hand in database
    for (let i = 0; i < roomPlayers.length; i++) {
      const { error: handError } = await supabase
        .from('room_players')
        .update({ hand: hands[i] })
        .eq('room_id', room_id)
        .eq('player_id', roomPlayers[i].player_id);
      
      if (handError) {
        throw new Error(`Failed to update hand for player ${i}: ${handError.message}`);
      }
    }
    
    console.log('[deal-cards] All hands stored in database');
    
    // 9. Update game_state to 'playing' phase
    const { error: gameError } = await supabase
      .from('game_state')
      .update({
        game_phase: 'playing',
        current_turn: startingPlayerId,
      })
      .eq('room_id', room_id);
    
    if (gameError) {
      throw new Error(`Failed to update game_state: ${gameError.message}`);
    }
    
    console.log(`[deal-cards] Game started - turn: ${startingPlayerId} (position ${startingPlayerIndex})`);
    
    // 10. Return success
    return new Response(
      JSON.stringify({ 
        success: true,
        starting_player: startingPlayerId,
        starting_player_position: startingPlayerIndex,
        player_count: roomPlayers.length,
        cards_per_player: cardsPerPlayer,
        message: `Dealt ${cardsPerPlayer} cards to ${roomPlayers.length} players. Player ${startingPlayerIndex} starts (has 3♦).`
      }),
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }, 
        status: 200 
      }
    );
    
  } catch (error) {
    console.error('[deal-cards] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Unknown error occurred'
      }),
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }, 
        status: 500 
      }
    );
  }
});

/**
 * Create a standard 52-card deck for Big Two
 * 
 * Ranks: 3 (lowest) to 2 (highest)
 * Suits: D (Diamonds), C (Clubs), H (Hearts), S (Spades)
 * 
 * @returns Array of 52 cards
 */
function createDeck(): Card[] {
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const suits = ['D', 'C', 'H', 'S']; // Diamonds, Clubs, Hearts, Spades
  const deck: Card[] = [];
  
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        id: `${rank}${suit}`,
        rank,
        suit
      });
    }
  }
  
  return deck;
}

/**
 * Fisher-Yates shuffle algorithm with crypto-secure randomness
 * 
 * Shuffles deck in-place using crypto.getRandomValues() for fairness.
 * This ensures the shuffle cannot be predicted or manipulated.
 * 
 * @param deck - Array of cards to shuffle (modified in-place)
 */
function shuffleDeck(deck: Card[]): void {
  const randomValues = new Uint32Array(deck.length);
  crypto.getRandomValues(randomValues);
  
  for (let i = deck.length - 1; i > 0; i--) {
    // Use crypto-secure random value
    const j = randomValues[i] % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}
