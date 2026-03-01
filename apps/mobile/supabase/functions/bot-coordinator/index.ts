// deno-lint-ignore-file no-explicit-any
/**
 * Bot Coordinator Edge Function
 *
 * Server-side bot turn executor for Big Two multiplayer games.
 * Replaces the client-side useBotCoordinator hook, eliminating:
 * - Race conditions from Realtime propagation delays
 * - Single point of failure when host disconnects
 * - 16+ critical-fix patches for client-side timing issues
 *
 * Architecture:
 * 1. Triggered after play-cards / player-pass / start_new_match when next turn is a bot
 * 2. Loops through consecutive bot turns, calling play-cards/player-pass via HTTP
 * 3. Adds configurable delays between moves for Realtime animation sync
 * 4. Uses Postgres advisory lock to prevent concurrent coordinators
 *
 * @module bot-coordinator
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { BotAI, type BotDifficulty } from '../_shared/botAI.ts';
import { parseCards } from '../_shared/parseCards.ts';
import type { Card } from '../_shared/gameEngine.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Delay between bot moves (ms) — allows Realtime to propagate for smooth client animations */
const BOT_MOVE_DELAY_MS = 500;

/** Maximum bot moves per invocation — prevents infinite loops */
const MAX_BOT_MOVES = 20;

/** Lock timeout — abandon if we can't acquire lock within this duration (ms) */
const LOCK_TIMEOUT_MS = 30_000;

// ==================== HELPERS ====================

interface GameState {
  id: string;
  room_id: string;
  current_turn: number;
  game_phase: string;
  hands: Record<string, any[]>;
  last_play: any;
  match_number: number;
  played_cards: any[];
  passes: number;
  auto_pass_timer: any;
  [key: string]: any;
}

interface RoomPlayer {
  id: string;
  user_id: string;
  username: string;
  player_index: number;
  is_bot: boolean;
  bot_difficulty: BotDifficulty | null;
  room_id: string;
  [key: string]: any;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call the play-cards Edge Function to execute a bot's card play.
 * Uses HTTP fetch to reuse all existing validation logic.
 */
async function callPlayCards(
  supabaseUrl: string,
  serviceKey: string,
  roomCode: string,
  playerId: string,
  cards: Card[],
): Promise<{ success: boolean; error?: string; match_ended?: boolean; game_over?: boolean }> {
  const url = `${supabaseUrl}/functions/v1/play-cards`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'x-bot-coordinator': 'true', // Signal to skip recursive bot trigger
    },
    body: JSON.stringify({
      room_code: roomCode,
      player_id: playerId,
      cards: cards.map(c => ({ id: c.id, rank: c.rank, suit: c.suit })),
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    console.error(`[bot-coordinator] ❌ play-cards failed:`, data);
    return { success: false, error: data.error || `HTTP ${res.status}` };
  }
  return {
    success: true,
    match_ended: data.match_ended,
    game_over: data.game_over,
  };
}

/**
 * Call the player-pass Edge Function to execute a bot's pass.
 */
async function callPlayerPass(
  supabaseUrl: string,
  serviceKey: string,
  roomCode: string,
  playerId: string,
): Promise<{ success: boolean; error?: string }> {
  const url = `${supabaseUrl}/functions/v1/player-pass`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'x-bot-coordinator': 'true',
    },
    body: JSON.stringify({
      room_code: roomCode,
      player_id: playerId,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    console.error(`[bot-coordinator] ❌ player-pass failed:`, data);
    return { success: false, error: data.error || `HTTP ${res.status}` };
  }
  return { success: true };
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabaseClient = createClient(supabaseUrl, serviceKey);

    const { room_code } = await req.json();

    if (!room_code) {
      return new Response(
        JSON.stringify({ success: false, error: 'room_code is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`🤖 [bot-coordinator] Starting for room: ${room_code}`);

    // 1. Get room
    const { data: room, error: roomError } = await supabaseClient
      .from('rooms')
      .select('id, code, status')
      .eq('code', room_code)
      .single();

    if (roomError || !room) {
      console.error('[bot-coordinator] Room not found:', roomError);
      return new Response(
        JSON.stringify({ success: false, error: 'Room not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 2. Get all room players (including bots)
    const { data: roomPlayers, error: playersError } = await supabaseClient
      .from('room_players')
      .select('*')
      .eq('room_id', room.id)
      .order('player_index', { ascending: true });

    if (playersError || !roomPlayers) {
      console.error('[bot-coordinator] Room players not found:', playersError);
      return new Response(
        JSON.stringify({ success: false, error: 'Room players not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 3. Try to acquire an advisory lock to prevent concurrent coordinators
    // Use room.id hash as the lock key
    const lockKey = Math.abs(hashCode(room.id)) % 2147483647; // Postgres int4 range
    const { data: lockResult } = await supabaseClient
      .rpc('acquire_bot_coordinator_lock', { lock_key: lockKey })
      .single();

    // acquire_bot_coordinator_lock returns true if lock acquired, false if another session holds it
    const lockAcquired = lockResult === true;

    if (!lockAcquired) {
      console.log('[bot-coordinator] ⏳ Another coordinator is already running for this room, skipping');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'concurrent_coordinator' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 4. Bot turn execution loop
    let movesExecuted = 0;
    let lastError: string | null = null;

    try {
      for (let iteration = 0; iteration < MAX_BOT_MOVES; iteration++) {
        // Check timeout
        if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
          console.warn('[bot-coordinator] ⏰ Timeout reached, stopping');
          break;
        }

        // Fetch fresh game state
        const { data: gameState, error: gsError } = await supabaseClient
          .from('game_state')
          .select('*')
          .eq('room_id', room.id)
          .single();

        if (gsError || !gameState) {
          console.error('[bot-coordinator] Game state not found:', gsError);
          lastError = 'Game state not found';
          break;
        }

        const gs = gameState as GameState;

        // Check if game is still active
        if (gs.game_phase === 'finished' || gs.game_phase === 'game_over') {
          console.log(`[bot-coordinator] 🏁 Game phase is '${gs.game_phase}', stopping`);
          break;
        }

        // Check if current turn is a bot
        const currentPlayer = roomPlayers.find(p => p.player_index === gs.current_turn) as RoomPlayer | undefined;
        if (!currentPlayer || !currentPlayer.is_bot) {
          console.log(`[bot-coordinator] 👤 Turn ${gs.current_turn} is human (${currentPlayer?.username || 'unknown'}), stopping`);
          break;
        }

        console.log(`🤖 [bot-coordinator] Bot turn: ${currentPlayer.username} (index ${currentPlayer.player_index}, difficulty ${currentPlayer.bot_difficulty || 'medium'})`);

        // Get bot's hand
        const botHandRaw = gs.hands?.[currentPlayer.player_index] || [];
        const botHand = parseCards(botHandRaw) as Card[];

        if (botHand.length === 0) {
          console.warn(`[bot-coordinator] ⚠️ Bot ${currentPlayer.username} has no cards, skipping`);
          break;
        }

        // Build player card counts for BotAI
        const playerCardCounts: number[] = [];
        for (let i = 0; i < 4; i++) {
          const handRaw = gs.hands?.[i] || [];
          playerCardCounts.push(Array.isArray(handRaw) ? handRaw.length : 0);
        }

        // Calculate next player index (counterclockwise: 0→1→2→3→0)
        const nextPlayerIndex = (currentPlayer.player_index + 1) % 4;

        // Parse last play
        const lastPlay = gs.last_play || null;

        // Determine if this is the first play of the game
        const playedCards = gs.played_cards || [];
        const isFirstPlay = playedCards.length === 0;
        const matchNumber = gs.match_number || 1;

        // Create BotAI and make decision
        const difficulty: BotDifficulty = (currentPlayer.bot_difficulty as BotDifficulty) || 'medium';
        const botAI = new BotAI(difficulty);
        const decision = botAI.getPlay({
          hand: botHand,
          lastPlay,
          isFirstPlayOfGame: isFirstPlay,
          matchNumber,
          playerCardCounts,
          currentPlayerIndex: currentPlayer.player_index,
          nextPlayerIndex,
        });

        console.log(`[bot-coordinator] 🎯 Bot decision: ${decision.cards ? `play ${decision.cards.length} cards` : 'pass'} — ${decision.reasoning}`);

        // Execute the decision
        if (decision.cards) {
          // Map card IDs to full card objects from hand
          const cardsToPlay: Card[] = [];
          for (const cardId of decision.cards) {
            const card = botHand.find(c => c.id === cardId);
            if (card) {
              cardsToPlay.push(card);
            } else {
              console.error(`[bot-coordinator] ❌ Card ${cardId} not found in bot's hand`);
              lastError = `Card ${cardId} not found in bot's hand`;
              break;
            }
          }

          if (lastError) break;

          const result = await callPlayCards(supabaseUrl, serviceKey, room.code, currentPlayer.user_id, cardsToPlay);
          if (!result.success) {
            lastError = result.error || 'play-cards failed';
            console.error(`[bot-coordinator] ❌ Bot play failed: ${lastError}`);
            break;
          }

          movesExecuted++;
          console.log(`✅ [bot-coordinator] Bot played successfully (move #${movesExecuted})`);

          // If match ended or game over, stop
          if (result.match_ended || result.game_over) {
            console.log(`[bot-coordinator] 🏁 Match/game ended after bot play`);
            break;
          }
        } else {
          // Pass
          const result = await callPlayerPass(supabaseUrl, serviceKey, room.code, currentPlayer.user_id);
          if (!result.success) {
            lastError = result.error || 'player-pass failed';
            console.error(`[bot-coordinator] ❌ Bot pass failed: ${lastError}`);
            break;
          }

          movesExecuted++;
          console.log(`✅ [bot-coordinator] Bot passed successfully (move #${movesExecuted})`);
        }

        // Delay for Realtime propagation and smooth animation
        await delay(BOT_MOVE_DELAY_MS);
      }
    } finally {
      // 5. Release advisory lock
      await supabaseClient
        .rpc('release_bot_coordinator_lock', { lock_key: lockKey })
        .single()
        .catch((err: any) => console.error('[bot-coordinator] Lock release error:', err));
    }

    const elapsed = Date.now() - startTime;
    console.log(`🤖 [bot-coordinator] Done: ${movesExecuted} moves in ${elapsed}ms${lastError ? ` (last error: ${lastError})` : ''}`);

    return new Response(
      JSON.stringify({
        success: true,
        moves_executed: movesExecuted,
        elapsed_ms: elapsed,
        error: lastError,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    console.error('[bot-coordinator] ❌ Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// ==================== UTILITY ====================

/**
 * Simple string hash (Java-style) for advisory lock keys.
 * Produces a deterministic int32 from a string.
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}
