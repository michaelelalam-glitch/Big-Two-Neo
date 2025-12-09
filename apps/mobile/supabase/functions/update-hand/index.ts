import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Card {
  id: string;      // e.g., "3D", "AS", "2H"
  rank: string;    // '3'-'10', 'J', 'Q', 'K', 'A', '2'
  suit: string;    // 'D', 'C', 'H', 'S'
}

/**
 * Update Hand Edge Function
 * 
 * Handles server-side hand updates after a player plays cards.
 * This ensures hands are updated correctly and cannot be manipulated by clients.
 * 
 * Flow:
 * 1. Fetch current hand from room_players
 * 2. Remove played cards from hand
 * 3. Update room_players.hand with new hand
 * 4. Check if player won (empty hand)
 * 5. Return updated hand and game status
 * 
 * Security:
 * - Uses service role key (bypasses RLS)
 * - Validates cards exist in hand before removal
 * - Server-authoritative: Client cannot fake card removal
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
    const { room_id, player_id, cards_played } = await req.json();
    
    // Validate input
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
    
    if (!player_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'player_id is required' }),
        { 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }, 
          status: 400 
        }
      );
    }
    
    if (!cards_played || !Array.isArray(cards_played) || cards_played.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'cards_played must be a non-empty array' }),
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
    
    // 3. Fetch current hand
    const { data: playerData, error: fetchError } = await supabase
      .from('room_players')
      .select('hand')
      .eq('room_id', room_id)
      .eq('player_id', player_id)
      .single();
    
    if (fetchError) {
      throw new Error(`Failed to fetch player hand: ${fetchError.message}`);
    }
    
    if (!playerData) {
      throw new Error('Player not found in room');
    }
    
    const currentHand: Card[] = playerData.hand || [];
    
    if (currentHand.length === 0) {
      throw new Error('Player has no cards to play');
    }
    
    console.log(`[update-hand] Player ${player_id} - Current hand: ${currentHand.length} cards`);
    console.log(`[update-hand] Removing ${cards_played.length} cards:`, cards_played.map((c: any) => c.id).join(', '));
    
    // 4. Validate that all played cards exist in hand
    const playedCardIds = new Set(cards_played.map((c: any) => c.id));
    const handCardIds = new Set(currentHand.map(c => c.id));
    
    for (const cardId of playedCardIds) {
      if (!handCardIds.has(cardId)) {
        throw new Error(`Card ${cardId} not in player's hand (possible cheating attempt)`);
      }
    }
    
    // 5. Remove played cards from hand
    const newHand = currentHand.filter(
      (card: Card) => !playedCardIds.has(card.id)
    );
    
    console.log(`[update-hand] New hand: ${newHand.length} cards`);
    
    // 6. Update hand in database
    const { error: updateError } = await supabase
      .from('room_players')
      .update({ hand: newHand })
      .eq('room_id', room_id)
      .eq('player_id', player_id);
    
    if (updateError) {
      throw new Error(`Failed to update hand: ${updateError.message}`);
    }
    
    // 7. Check if player won (empty hand)
    const gameEnded = newHand.length === 0;
    
    if (gameEnded) {
      console.log(`[update-hand] 🎉 Player ${player_id} wins! (empty hand)`);
    }
    
    // 8. Return success
    return new Response(
      JSON.stringify({
        success: true,
        new_hand: newHand,
        hand_count: newHand.length,
        game_ended: gameEnded,
        cards_removed: cards_played.length,
        message: gameEnded 
          ? `Player won! Hand is now empty.`
          : `Removed ${cards_played.length} cards. ${newHand.length} cards remaining.`
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
    console.error('[update-hand] Error:', error);
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
