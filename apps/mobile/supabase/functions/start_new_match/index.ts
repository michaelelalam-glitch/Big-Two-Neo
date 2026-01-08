// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Card {
  id: string;
  suit: 'D' | 'C' | 'H' | 'S';
  rank: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
}

function createDeck(): Card[] {
  const suits: Array<'D' | 'C' | 'H' | 'S'> = ['D', 'C', 'H', 'S'];
  const ranks: Array<'3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2'> = [
    '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2',
  ];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ id: `${rank}${suit}`, suit, rank });
    }
  }
  return deck;
}

function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { room_id } = await req.json();

    if (!room_id) {
      return new Response(
        JSON.stringify({ error: 'room_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Get current game state
    const { data: gameState, error: gameStateError } = await supabaseClient
      .from('game_state')
      .select('*')
      .eq('room_id', room_id)
      .single();

    if (gameStateError || !gameState) {
      return new Response(
        JSON.stringify({ error: 'Game state not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Get current match winner by finding who has 0 cards (played them all)
    let winner_index: number | null = null;
    for (let i = 0; i < gameState.hands.length; i++) {
      const hand = gameState.hands[i];
      if (Array.isArray(hand) && hand.length === 0) {
        winner_index = i;
        break;
      }
    }
    
    if (winner_index === null) {
      return new Response(
        JSON.stringify({ error: 'No winner found for previous match - no player has 0 cards' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`✅ Match winner: Player ${winner_index} (had 0 cards)`);


    // 3. Create and shuffle new deck
    const deck = createDeck();
    const shuffledDeck = shuffleDeck(deck);

    // 4. Deal cards (13 cards per player)
    const newHands = [
      shuffledDeck.slice(0, 13),
      shuffledDeck.slice(13, 26),
      shuffledDeck.slice(26, 39),
      shuffledDeck.slice(39, 52),
    ];

    // 4.5. Convert array to JSONB object (database expects {"0": [...], "1": [...], ...})
    const handsObject: Record<string, Card[]> = {
      "0": newHands[0],
      "1": newHands[1],
      "2": newHands[2],
      "3": newHands[3],
    };

    // 5. Get cumulative scores from room_players (preserve across matches)
    const { data: roomPlayersData, error: playersError } = await supabaseClient
      .from('room_players')
      .select('player_index, score')
      .eq('room_id', room_id)
      .order('player_index');

    if (playersError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch player scores', details: playersError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build cumulative scores array [player0_score, player1_score, player2_score, player3_score]
    const cumulativeScores = [0, 0, 0, 0];
    for (const rp of roomPlayersData) {
      cumulativeScores[rp.player_index] = rp.score || 0;
    }

    // 6. Increment match number
    const newMatchNumber = (gameState.match_number || 1) + 1;

    // 7. Get existing play_history to preserve across matches
    const existingPlayHistory = (gameState as any).play_history || [];

    // 8. Update game state for new match (preserve cumulative scores AND play_history)
    const { error: updateError } = await supabaseClient
      .from('game_state')
      .update({
        hands: handsObject, // ✅ FIX: Use object format, not array
        game_phase: 'playing',
        current_turn: winner_index, // Winner of previous match starts
        last_play: null,
        passes: 0,  // ✅ FIX: Use "passes" column (pass_count is computed)
        winner: null,
        match_number: newMatchNumber,
        scores: cumulativeScores, // CRITICAL: Preserve cumulative scores
        play_history: existingPlayHistory, // CRITICAL: Preserve all match histories (don't clear!)
        played_cards: [], // ✅ FIX: Clear played cards for new match
        auto_pass_timer: null,
      })
      .eq('id', gameState.id);

    if (updateError) {
      console.error('Failed to update game state:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to start new match', details: updateError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        match_number: newMatchNumber,
        starting_player_index: winner_index,
        message: `Match ${newMatchNumber} started! Player ${winner_index} leads.`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('start_new_match error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
