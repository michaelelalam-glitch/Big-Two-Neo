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

// Database stores hands as JSONB object with string keys "0"-"3"
type HandsObject = {
  "0": Card[];
  "1": Card[];
  "2": Card[];
  "3": Card[];
};

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

    // 2. Get winner from last_match_winner_index column (set by play-cards when match ends)
    // play-cards sets this when a player finishes all cards
    let winner_index = gameState.last_match_winner_index;
    
    if (winner_index === null || winner_index === undefined) {
      // Fallback: Try to find player with 0 cards (backwards compatibility)
      console.log('⚠️ No last_match_winner_index set, falling back to 0-card search...');
      const hands = gameState.hands as HandsObject;
      for (let i = 0; i < 4; i++) {
        const hand = hands[String(i) as keyof HandsObject];
        if (!hand || !Array.isArray(hand)) {
          continue; // Skip if hand is malformed
        }
        if (hand.length === 0) {
          winner_index = i;
          break;
        }
      }
      
      if (winner_index === null || winner_index === undefined) {
        return new Response(
          JSON.stringify({ 
            error: 'No winner found for previous match - no last_match_winner_index set and no player has 0 cards',
            debug: {
              has_winner_index: gameState.last_match_winner_index !== undefined,
              hand_counts: Object.entries(gameState.hands as HandsObject).map(([idx, hand]) => ({
                player: idx,
                cards: Array.isArray(hand) ? hand.length : 'invalid'
              }))
            }
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log(`✅ Fallback winner found: Player ${winner_index} (had 0 cards)`);
    } else {
      console.log(`✅ Match winner from game_state.last_match_winner_index: Player ${winner_index}`);
    }


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
    // Integration test coverage needed:
    // - Hands conversion to object format works correctly
    // - Winner detection with JSONB object structure  
    // - played_cards reset between matches
    const handsObject: HandsObject = {
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
    // Reset match-specific fields but keep game-level tracking
    const { error: updateError } = await supabaseClient
      .from('game_state')
      .update({
        hands: handsObject, // ✅ FIX: Use object format, not array
        game_phase: 'playing',
        current_turn: winner_index, // Winner of previous match starts
        last_play: null,
        passes: 0,  // ✅ FIX: Use "passes" column (pass_count is computed)
        last_match_winner_index: null, // Clear previous match winner
        match_ended_at: null, // Clear match end timestamp
        match_number: newMatchNumber,
        play_history: existingPlayHistory, // CRITICAL: Preserve all match histories (don't clear!)
        played_cards: [], // ✅ FIX: Clear played cards for new match
        auto_pass_timer: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameState.id);

    if (updateError) {
      console.error('Failed to update game state:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to start new match', details: updateError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 9. Trigger bot-coordinator if the starting player (winner) is a bot (Task #551)
    try {
      const { data: startingPlayer } = await supabaseClient
        .from('room_players')
        .select('is_bot')
        .eq('room_id', room_id)
        .eq('player_index', winner_index)
        .single();

      if (startingPlayer?.is_bot) {
        // Need room_code to invoke bot-coordinator
        const { data: roomRow } = await supabaseClient
          .from('rooms')
          .select('code')
          .eq('id', room_id)
          .single();

        if (roomRow?.code) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
          fetch(`${supabaseUrl}/functions/v1/bot-coordinator`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              'x-bot-coordinator': 'true',
            },
            body: JSON.stringify({ room_code: roomRow.code }),
          }).catch((err) => console.error('[start_new_match] ⚠️ Bot coordinator trigger failed:', err));
          console.log(`🤖 [start_new_match] Bot coordinator triggered — starting player ${winner_index} is a bot`);
        }
      }
    } catch (err) {
      console.error('[start_new_match] ⚠️ Bot starting check failed (non-critical):', err);
    }

    return new Response(
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
