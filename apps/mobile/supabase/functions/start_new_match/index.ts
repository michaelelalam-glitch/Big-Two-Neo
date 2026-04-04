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
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // ── Authentication gate ───────────────────────────────────────────────────
    // start_new_match advances game state (deals cards, resets match).  All callers
    // must be authenticated.  Service-role callers (bot-coordinator, internal
    // automation) are identified by their bearer token or x-bot-auth header;
    // client fallback callers (useMatchTransition, realtimeActions) must supply a
    // valid user JWT via the Authorization header.
    const authHeader  = req.headers.get('authorization') ?? '';
    const botAuthHdr  = req.headers.get('x-bot-auth') ?? '';
    const internalKey = Deno.env.get('INTERNAL_BOT_AUTH_KEY') ?? '';
    const isServiceRole =
      (serviceKey !== '' && authHeader === `Bearer ${serviceKey}`) ||
      (internalKey !== '' && botAuthHdr === internalKey);

    let authenticatedUserId: string | null = null;
    let anonClientForMembershipCheck: ReturnType<typeof createClient> | null = null;
    if (!isServiceRole) {
      const anonClient = createClient(
        supabaseUrl,
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error: authError } = await anonClient.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      authenticatedUserId = user.id;
      anonClientForMembershipCheck = anonClient;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const supabaseClient = createClient(supabaseUrl, serviceKey);

    const { room_id, expected_match_number: rawExpectedMatchNumber } = await req.json();
    // Coerce to a number so string callers (e.g. HTTP tools) don't break the strict === comparison.
    const expected_match_number = rawExpectedMatchNumber != null ? Number(rawExpectedMatchNumber) : undefined;

    if (!room_id) {
      return new Response(
        JSON.stringify({ error: 'room_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // expected_match_number is now REQUIRED. Callers must supply the current match_number
    // from their game state snapshot so start_new_match can detect double-advance:
    //   caller A reads match_number=1, calls start_new_match(expected=1)  → advances to 2
    //   caller B's stale call also has expected=1 → idempotency guard returns no-op
    // Without this, a stale or duplicate HTTP retry skips the idempotency guard at
    // step 1b and can advance the match a second time.
    if (
      expected_match_number === undefined ||
      expected_match_number === null ||
      !Number.isFinite(expected_match_number) ||
      !Number.isInteger(expected_match_number) ||
      expected_match_number < 1
    ) {
      return new Response(
        JSON.stringify({ error: 'expected_match_number must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Room membership gate (non-service-role callers only) ─────────────────
    // Any authenticated user who knows a room_id could otherwise call
    // start_new_match to advance game state. Verify the caller is an active
    // member of the room before proceeding with service-role mutations.
    if (authenticatedUserId && anonClientForMembershipCheck) {
      const { data: memberRow, error: memberError } = await anonClientForMembershipCheck
        .from('room_players')
        .select('id')
        .eq('room_id', room_id)
        .eq('user_id', authenticatedUserId)
        .limit(1)
        .maybeSingle();
      if (memberError) {
        return new Response(
          JSON.stringify({ error: 'Membership check failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (!memberRow) {
        return new Response(
          JSON.stringify({ error: 'Forbidden' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

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

    // 1b. Idempotency guard — two-step:
    //   Step 1 (unconditional): if game_phase is not 'finished' the match has already been
    //     advanced by a concurrent caller.  This covers ALL callers regardless of whether
    //     they supply expected_match_number (e.g. realtimeActions, bot-coordinator).
    //   Step 2 (conditional): if expected_match_number is supplied and doesn't match the
    //     current match_number, we're also out of sync — treat as a no-op.
    if (gameState.game_phase !== 'finished') {
      console.log(
        `[start_new_match] ✅ Idempotency (phase): match already advanced ` +
        `(current match=${gameState.match_number}, phase=${gameState.game_phase})`
      );
      return new Response(
        JSON.stringify({
          success: true,
          already_advanced: true,
          match_number: gameState.match_number,
          message: 'Match already advanced',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (expected_match_number !== undefined && expected_match_number !== null &&
        gameState.match_number !== expected_match_number) {
      console.log(
        `[start_new_match] ✅ Idempotency (match_number): match already advanced ` +
        `(expected match=${expected_match_number}, current match=${gameState.match_number})`
      );
      return new Response(
        JSON.stringify({
          success: true,
          already_advanced: true,
          match_number: gameState.match_number,
          message: 'Match already advanced',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1c. SAFETY GUARD: Check if any player has already busted (>= 101 points).
    // play-cards SHOULD have set game_phase='game_over' in this case, but a race
    // condition (or bug) can leave phase='finished' even though the game is over.
    // Guard here so we never deal a new match when the game should be finished.
    {
      const { data: currentScores } = await supabaseClient
        .from('room_players')
        .select('player_index, score')
        .eq('room_id', room_id);

      if (currentScores?.some(p => (p.score || 0) >= 101)) {
        console.log('[start_new_match] 🏆 Safety guard: player has ≥ 101 points — forcing game_over');
        // Ensure game_phase reflects game_over (it may still be 'finished' due to the race)
        const { error: gamePhaseUpdateError } = await supabaseClient
          .from('game_state')
          .update({ game_phase: 'game_over' })
          .eq('room_id', room_id)
          .neq('game_phase', 'playing'); // Do not clobber a legitimately running game

        if (gamePhaseUpdateError) {
          console.error(
            '[start_new_match] ❌ Failed to force game_phase=game_over for room',
            room_id,
            gamePhaseUpdateError
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            game_over: true,
            already_advanced: true,
            match_number: gameState.match_number,
            message: 'Game is over: a player has reached 101+ points',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
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
    // Reset match-specific fields but keep game-level tracking.
    // The WHERE clause includes game_phase='finished' AND match_number=<current> so the
    // UPDATE is atomic with the idempotency guard: two concurrent callers that both pass
    // the soft checks above will race on this write and only the first will match rows.
    // 0 rows updated → the other caller already advanced the match — safe no-op.
    const { data: updatedRows, error: updateError } = await supabaseClient
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
      .eq('id', gameState.id)
      .eq('game_phase', 'finished')           // Atomic guard: only update if still 'finished'
      .eq('match_number', gameState.match_number) // Atomic guard: only update if match unchanged
      .select('id');

    if (updateError) {
      console.error('Failed to update game state:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to start new match', details: updateError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 0 rows updated — a concurrent caller already advanced this match; no-op safely.
    if (!updatedRows || updatedRows.length === 0) {
      console.log('[start_new_match] ✅ Atomic idempotency: match already advanced by concurrent caller');
      return new Response(
        JSON.stringify({
          success: true,
          already_advanced: true,
          match_number: gameState.match_number,
          message: 'Match already advanced by concurrent caller',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
          // Fire-and-forget via EdgeRuntime.waitUntil: the new-match response returns
          // immediately to the client while bot-coordinator runs in the background.
          // This prevents start_new_match from blocking on cold-start + bot turn execution.
          const botPromise = fetch(`${supabaseUrl}/functions/v1/bot-coordinator`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              'x-bot-coordinator': 'true',
            },
            body: JSON.stringify({ room_code: roomRow.code }),
          }).then(res => {
            if (res.ok) {
              console.log(`🤖 [start_new_match] Bot coordinator triggered — starting player ${winner_index} is a bot`);
            } else {
              res.text().then(body => console.error(`[start_new_match] ⚠️ Bot coordinator non-2xx: ${res.status}`, body)).catch(() => {});
            }
          }).catch(err => {
            console.error('[start_new_match] ⚠️ Bot coordinator trigger failed:', err);
          });
          try { (globalThis as any).EdgeRuntime?.waitUntil(botPromise); } catch (_) {}
        }
      }
    } catch (err) {
      console.error('[start_new_match] ⚠️ Bot starting check failed (non-critical):', err);
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
