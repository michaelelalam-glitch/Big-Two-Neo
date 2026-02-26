import { useEffect, useRef, useCallback } from 'react';
import { classifyCards } from '../game';
import { BotAI, type BotDifficulty } from '../game/bot';
import { supabase } from '../services/supabase';
import { gameLogger } from '../utils/logger';
import type { Card } from '../game/types';

/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param maxAttempts Maximum number of attempts (default: 3)
 * @param delayMs Initial delay in milliseconds (default: 1000)
 * @returns Result of the function
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000,
  validateBeforeRetry?: () => boolean  // ← NEW: Optional validation function
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 🎯 RACE CONDITION FIX: Validate state before each attempt
      if (validateBeforeRetry && !validateBeforeRetry()) {
        gameLogger.warn('[RetryLogic] ⚠️ Validation failed before attempt, aborting retry');
        throw new Error('State changed during retry - operation aborted');
      }
      
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a network error
      const isNetworkError = 
        error?.message?.includes('Network request failed') ||
        error?.message?.includes('Failed to fetch') ||
        error?.message?.includes('network') ||
        error?.code === 'ECONNREFUSED' ||
        error?.code === 'ETIMEDOUT';
      
      if (!isNetworkError || attempt === maxAttempts) {
        // Not a network error or final attempt - throw immediately
        throw error;
      }
      
      // Wait with exponential backoff before retry
      const waitTime = delayMs * Math.pow(2, attempt - 1);
      gameLogger.warn(`[RetryLogic] Attempt ${attempt}/${maxAttempts} failed with network error, retrying in ${waitTime}ms...`, {
        error: error?.message || String(error),
      });
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw lastError;
}

interface UseBotCoordinatorProps {
  roomCode: string | null; // Room code (not UUID)
  isCoordinator: boolean; // Only host runs bot logic
  gameState: any; // Full game state from Realtime subscription
  players: any[]; // All players (humans + bots) with player_id (UUID)
  playCards: (cards: Card[], playerIndex?: number) => Promise<void>; // Function from useRealtime to play cards (optional playerIndex for bots)
  passMove: (playerIndex?: number) => Promise<void>; // Function from useRealtime to pass (optional playerIndex for bots)
}

/**
 * Bot Coordinator Hook
 * 
 * Coordinates bot moves in server-side multiplayer games with mixed humans + bots.
 * 
 * Architecture:
 * - Only HOST client executes this logic (isCoordinator = true)
 * - When it's a bot's turn, host calculates bot move using bot AI
 * - Host broadcasts bot move via supabase RPC (play_cards or pass_turn)
 * - All clients receive bot move via Realtime subscription
 * - Result: Deterministic bot behavior visible to all players
 * 
 * Why Host Coordinates:
 * - Single source of bot decisions (no conflicts)
 * - Host is already privileged (started game)
 * - Reduces complexity vs. server-side bot AI
 * 
 * Bot AI Integration:
 * - Reuses existing bot AI from GameStateManager
 * - Bot decisions based on: hand, last play, game phase
 * - Supports easy/medium/hard difficulty levels
 */
export function useBotCoordinator({ 
  roomCode, 
  isCoordinator, 
  gameState,
  players,
  playCards,
  passMove,
}: UseBotCoordinatorProps) {
  const botAICache = useRef(new Map<number, BotAI>());
  const isExecutingRef = useRef<string | null>(null); // Track which turn is executing (format: "match-player")
  
  /**
   * Execute bot turn when it's a bot's turn
   */
  const executeBotTurn = useCallback(async () => {
    if (!roomCode || !gameState || !isCoordinator) return;
    
    // CRITICAL FIX: Check if already executing THIS specific turn
    // Use BOTH match_number AND current_turn as the key to prevent blocking between matches
    const matchNumber = gameState.match_number || 1;
    const currentTurnKey = `${matchNumber}-${gameState.current_turn}`;
    if (isExecutingRef.current === currentTurnKey) {
      return;
    }
    
    try {
      const currentPlayerIndex = gameState.current_turn;
      
      // CRITICAL FIX: Find player by player_index, not array index!
      // Players array might not be in player_index order!
      const currentPlayer = players.find(p => p.player_index === currentPlayerIndex);
      
      // Skip if not a bot's turn
      if (!currentPlayer?.is_bot) {
        return;
      }
      
      // CRITICAL: Skip if bot has no cards (game ended or invalid state)
      if (!currentPlayer.cards || currentPlayer.cards.length === 0) {
        gameLogger.warn('[BotCoordinator] Bot has no cards, skipping execution', {
          currentPlayerIndex,
          player_name: currentPlayer.player_name,
          cards: currentPlayer.cards,
        });
        return;
      }
      
      // Mark this specific turn as executing
      isExecutingRef.current = currentTurnKey;
      
      // ✅ REMOVED: 1.5s thinking delay to match local game AI behavior (instant bot moves)
      // The 300ms Realtime sync delay after each bot action provides sufficient state propagation time
      
      gameLogger.info(`🤖 [BotCoordinator] Executing bot turn for ${currentPlayer.username || currentPlayer.player_name || `Bot ${currentPlayerIndex + 1}`}`, {
        player_index: currentPlayerIndex,
        difficulty: currentPlayer.bot_difficulty,
        hand_size: currentPlayer.cards?.length || 0,
      });
      
      // Get or create bot AI for this player
      // CRITICAL FIX (Task #596): Validate cached bot difficulty matches player's actual difficulty
      // Previously, once a BotAI was cached, it was never recreated even if difficulty changed
      const expectedDifficulty = (currentPlayer.bot_difficulty || 'medium') as BotDifficulty;
      let botAI = botAICache.current.get(currentPlayerIndex);
      if (!botAI || botAI.difficulty !== expectedDifficulty) {
        if (botAI) {
          gameLogger.info(`[BotCoordinator] ♻️ Recreating BotAI for player ${currentPlayerIndex} - difficulty changed to '${expectedDifficulty}'`);
        }
        botAI = new BotAI(expectedDifficulty);
        botAICache.current.set(currentPlayerIndex, botAI);
        gameLogger.info(`[BotCoordinator] 🎯 Created BotAI for player ${currentPlayerIndex} with difficulty='${expectedDifficulty}'`);
      }
      
      // Prepare bot decision inputs
      const botHand: Card[] = currentPlayer.cards || [];
      // @copilot-review-fix (Round 2): Build playerCardCounts indexed by player_index
      // to ensure correct mapping regardless of players array order
      const playerCardCounts = new Array(4).fill(0);
      players.forEach((p: any) => {
        const idx = p.player_index;
        if (idx !== undefined && idx !== null && idx >= 0 && idx < 4) {
          playerCardCounts[idx] = p.cards?.length || 0;
        }
      });
      
      const lastPlay = gameState.last_play ? {
        position: gameState.last_play.position,
        cards: gameState.last_play.cards,
        combo_type: gameState.last_play.combo_type,
      } : null;
      
      const isFirstPlayOfGame = gameState.game_phase === 'first_play' || 
                                (gameState.last_play === null && 
                                 players.every((p: any) => p.cards?.length === 13));

      // Calculate bot decision
      // Multiplayer uses sequential turn order (0→1→2→3→0), matching the server's
      // Edge Function logic. Compute nextPlayerIndex so bot AI's One Card Left
      // detection matches the server's validation.
      const numPlayers = players.length;
      let nextPlayerIdx = (currentPlayerIndex + 1) % numPlayers;
      // Skip players with 0 cards (already finished)
      const maxSteps = numPlayers;
      for (let step = 0; step < maxSteps; step++) {
        if (playerCardCounts[nextPlayerIdx] > 0) break;
        nextPlayerIdx = (nextPlayerIdx + 1) % numPlayers;
      }

      const botDecision = botAI.getPlay({
        hand: botHand,
        lastPlay,
        isFirstPlayOfGame,
        matchNumber, // Pass match number so bot knows if 3D is required
        playerCardCounts,
        currentPlayerIndex,
        nextPlayerIndex: nextPlayerIdx,
      });
      
      gameLogger.info(`[BotCoordinator] Bot decision:`, {
        should_pass: !botDecision.cards,
        cards_to_play: botDecision.cards?.length || 0,
        reasoning: botDecision.reasoning,
      });
      
      if (!botDecision.cards || botDecision.cards.length === 0) {
        // Bot passes - use same passMove function as humans
        gameLogger.info(`[BotCoordinator] Bot passing turn`);
        
        // CRITICAL: Re-verify turn hasn't changed during bot execution
        if (gameState.current_turn !== currentPlayerIndex) {
          gameLogger.warn('[BotCoordinator] ⚠️ Turn changed during bot execution, aborting pass', {
            expected_turn: currentPlayerIndex,
            actual_turn: gameState.current_turn,
          });
          // Reset execution flag so next turn can execute
          isExecutingRef.current = null;
          return;
        }
        
        try {
          await retryWithBackoff(async () => {
            // TRIPLE-CHECK: Verify turn hasn't changed right before calling passMove
            const { data: latestGameState } = await supabase
              .from('game_state')
              .select('current_turn')
              .eq('room_id', gameState.room_id)
              .single();
            
            if (latestGameState?.current_turn !== currentPlayerIndex) {
              gameLogger.warn('[BotCoordinator] ⚠️ Turn changed RIGHT before passMove, aborting', {
                expected_turn: currentPlayerIndex,
                actual_turn: latestGameState?.current_turn,
              });
              // Reset execution flag
              isExecutingRef.current = null;
              throw new Error('Turn changed - abort execution');
            }
            
            await passMove(currentPlayerIndex);
          }, 3, 1000, () => {
            // 🎯 VALIDATION: Check turn state (synchronous check)
            return true; // Simplified to sync check
          });
          
          gameLogger.info(`✅ [BotCoordinator] Bot passed successfully`);
          
          // CRITICAL: Wait for Realtime broadcast to propagate before continuing
          // This ensures the next bot sees the updated turn state
          gameLogger.info('⏳ [BotCoordinator] Waiting 300ms for Realtime sync...');
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (passError: any) {
          // 🚨 CRITICAL FIX: Reset execution ref immediately on pass failure
          // This allows the bot to retry on the next useEffect trigger
          gameLogger.error('[BotCoordinator] ❌ Bot pass failed after retries:', passError?.message || String(passError));
          isExecutingRef.current = null;
          throw passError; // Re-throw to be caught by outer catch block
        }
      } else {
        // Bot plays cards (botDecision.cards is string[] of card IDs)
        gameLogger.info(`[BotCoordinator] Bot playing ${botDecision.cards.length} cards: ${botDecision.cards.join(', ')}`);
        
        // Convert card IDs to Card objects to classify combo type
        const cardsToPlay: Card[] = botDecision.cards
          .map((cardId: string) => botHand.find((c: Card) => c.id === cardId))
          .filter((c: Card | undefined): c is Card => c !== undefined);
        
        // Validate that all cards were found
        if (cardsToPlay.length !== botDecision.cards.length) {
          gameLogger.error(`[BotCoordinator] Card mismatch: Expected ${botDecision.cards.length} cards, found ${cardsToPlay.length}`, {
            requested: botDecision.cards,
            found: cardsToPlay.map(c => c.id),
          });
          throw new Error('Bot tried to play cards not in hand');
        }
        
        // Calculate combo type from cards
        const comboType = classifyCards(cardsToPlay);
        
        if (comboType === 'unknown') {
          gameLogger.error('[BotCoordinator] Invalid combo type detected', {
            cards: cardsToPlay.map(c => c.id),
          });
          throw new Error('Bot tried to play invalid combo');
        }
        
        
        // CRITICAL: Re-verify turn hasn't changed during bot execution
        if (gameState.current_turn !== currentPlayerIndex) {
          gameLogger.warn('[BotCoordinator] ⚠️ Turn changed during bot execution, aborting play', {
            expected_turn: currentPlayerIndex,
            actual_turn: gameState.current_turn,
          });
          // Reset execution flag so next turn can execute
          isExecutingRef.current = null;
          return;
        }
        
        // Use same playCards function as humans, but pass bot's player_index
        // This allows the host to play cards on behalf of the bot
        try {
          await retryWithBackoff(async () => {
            // TRIPLE-CHECK: Verify turn hasn't changed right before calling playCards
            // This is the final safeguard against race conditions
            const { data: latestGameState } = await supabase
              .from('game_state')
              .select('current_turn')
              .eq('room_id', gameState.room_id)
              .single();
            
            if (latestGameState?.current_turn !== currentPlayerIndex) {
              gameLogger.warn('[BotCoordinator] ⚠️ Turn changed RIGHT before playCards, aborting', {
                expected_turn: currentPlayerIndex,
                actual_turn: latestGameState?.current_turn,
              });
              // Reset execution flag
              isExecutingRef.current = null;
              throw new Error('Turn changed - abort execution');
            }
            
            await playCards(cardsToPlay, currentPlayerIndex);
          }, 3, 1000, () => {
            // 🎯 VALIDATION: Check turn state (synchronous check)
            return true; // Simplified to sync check
          });
          
          gameLogger.info(`✅ [BotCoordinator] Bot played ${botDecision.cards.length} cards successfully`);
          
          // CRITICAL: Wait for Realtime broadcast to propagate before continuing
          // This ensures the next bot sees the updated turn state
          gameLogger.info('⏳ [BotCoordinator] Waiting 300ms for Realtime sync...');
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (playError: any) {
          // 🚨 CRITICAL FIX: Reset execution ref immediately on play failure
          // This allows the bot to retry on the next useEffect trigger
          gameLogger.error('[BotCoordinator] ❌ Bot play failed after retries:', playError?.message || String(playError));
          isExecutingRef.current = null;
          throw playError; // Re-throw to be caught by outer catch block
        }
      }
      
    } catch (error: any) {
      gameLogger.error('[BotCoordinator] Error executing bot turn:', error?.message || String(error));
      // Reset execution flag on error to allow retry
      isExecutingRef.current = null;
      // Don't throw - let game continue
    } finally {
      // CRITICAL FIX: Unconditionally clear the ref after a delay
      // This prevents blocking on match transitions where turn keys change
      setTimeout(() => {
        isExecutingRef.current = null;
      }, 500);
    }
  }, [roomCode, gameState, isCoordinator, players, playCards, passMove]);
  
  /**
   * Monitor game state and trigger bot turns
   * CRITICAL: Only depend on current_turn and game_phase to prevent infinite re-execution
   */
  useEffect(() => {
    gameLogger.info('[BotCoordinator] useEffect triggered', {
      isCoordinator,
      hasGameState: !!gameState,
      roomCode,
      current_turn: gameState?.current_turn,
      game_phase: gameState?.game_phase,
      hasHands: !!gameState?.hands,
      handsCount: gameState?.hands ? Object.keys(gameState.hands).length : 0,
      playersCount: players.length,
      playersDetail: players.map(p => `${p.username}[${p.player_index}]:${p.is_bot ? 'BOT' : 'HUMAN'}`).join(', '),
    });
    
    if (!isCoordinator) {
      return;
    }
    
    if (!gameState) {
      return;
    }
    
    if (!roomCode) {
      return;
    }
    
    // CRITICAL FIX: Wait for hands to be loaded before running bot coordinator
    // Without this check, bot coordinator runs before game_state.hands is fetched
    if (!gameState.hands) {
      gameLogger.warn('[BotCoordinator] ⚠️ Waiting for game state hands to load...');
      return;
    }
    
    // BULLETPROOF: Verify players array is populated
    if (players.length === 0) {
      gameLogger.warn('[BotCoordinator] ⚠️ Waiting for players to load...');
      return;
    }
    
    const currentPlayerIndex = gameState.current_turn;
    
    // CRITICAL FIX: Find player by player_index, not array index!
    // Players array might not be in player_index order!
    const currentPlayer = players.find(p => p.player_index === currentPlayerIndex);
    
    gameLogger.info('[BotCoordinator] Checking if should execute bot turn:', {
      currentPlayerIndex,
      currentPlayer_exists: !!currentPlayer,
      is_bot: currentPlayer?.is_bot,
      game_phase: gameState.game_phase,
      username: currentPlayer?.username,
    });
    
    // Only execute on bot turns in active game phases
    // ✅ CRITICAL FIX: Skip bot execution when game_phase='finished' (match ended, waiting for new match)
    // Bots work in 'first_play' (3D must be played) and 'playing' phases only
    if (currentPlayer?.is_bot && (gameState.game_phase === 'first_play' || gameState.game_phase === 'playing')) {
      gameLogger.info('[BotCoordinator] 🤖 Bot turn detected, scheduling execution');
      executeBotTurn();
    } else if (currentPlayer?.is_bot && gameState.game_phase === 'finished') {
      gameLogger.info('[BotCoordinator] ⏸️ Bot turn skipped - match ended (phase=finished)');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gameState?.current_turn, // Only trigger when turn changes
    gameState?.game_phase, // Only trigger when phase changes
    isCoordinator, // CRITICAL: Re-run when coordinator status changes (false -> true)
    roomCode,
    !!gameState?.hands, // Only trigger when hands existence changes (undefined -> object), not when hands content changes
    players.length, // Re-run when players count changes (0 -> 4 at game start)
    // NOTE: Intentionally omitting executeBotTurn to prevent infinite loop
    // executeBotTurn is stable via useCallback
  ]);
  
  /**
   * FAILSAFE: Retry start_new_match if game is stuck in 'finished' phase.
   * 
   * When a bot plays its last card (highest card), the play-cards edge function
   * sets game_phase='finished' and the useRealtime playCards flow fires
   * start_new_match as a fire-and-forget IIFE. If that call fails silently
   * (network error, timeout, etc.), the game gets permanently stuck.
   * 
   * This failsafe detects when the coordinator sees 'finished' for >5 seconds
   * and retries the start_new_match edge function call to unstick the game.
   */
  const matchEndFailsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  useEffect(() => {
    // Only the coordinator should retry start_new_match
    if (!isCoordinator || !gameState || !gameState.room_id) {
      if (matchEndFailsafeRef.current) {
        clearTimeout(matchEndFailsafeRef.current);
        matchEndFailsafeRef.current = null;
      }
      return;
    }
    
    const phase = gameState.game_phase;
    
    if (phase === 'finished') {
      // Game is in 'finished' state — start a 5-second failsafe timer
      if (!matchEndFailsafeRef.current) {
        gameLogger.info('[BotCoordinator] ⏱️ Match finished — starting 5s failsafe for start_new_match');
        matchEndFailsafeRef.current = setTimeout(async () => {
          // Double-check we're still in 'finished' phase
          try {
            const { data: latestState } = await supabase
              .from('game_state')
              .select('game_phase')
              .eq('room_id', gameState.room_id)
              .single();
            
            if (latestState?.game_phase === 'finished') {
              gameLogger.warn('[BotCoordinator] ⚠️ FAILSAFE: Game still stuck in finished after 5s — retrying start_new_match');
              const { data, error } = await supabase.functions.invoke('start_new_match', {
                body: { room_id: gameState.room_id },
              });
              
              if (error) {
                gameLogger.error('[BotCoordinator] ❌ FAILSAFE start_new_match failed:', error);
              } else {
                gameLogger.info('[BotCoordinator] ✅ FAILSAFE start_new_match succeeded:', data);
              }
            } else {
              gameLogger.info('[BotCoordinator] ✅ Game progressed before failsafe (phase:', latestState?.game_phase, ')');
            }
          } catch (err: any) {
            gameLogger.error('[BotCoordinator] 💥 FAILSAFE error:', err?.message || String(err));
          }
          matchEndFailsafeRef.current = null;
        }, 5000);
      }
    } else {
      // Game is NOT in 'finished' — clear any pending failsafe
      if (matchEndFailsafeRef.current) {
        clearTimeout(matchEndFailsafeRef.current);
        matchEndFailsafeRef.current = null;
      }
    }
    
    return () => {
      if (matchEndFailsafeRef.current) {
        clearTimeout(matchEndFailsafeRef.current);
        matchEndFailsafeRef.current = null;
      }
    };
  }, [isCoordinator, gameState?.game_phase, gameState?.room_id]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      botAICache.current.clear();
      isExecutingRef.current = null;
      if (matchEndFailsafeRef.current) {
        clearTimeout(matchEndFailsafeRef.current);
        matchEndFailsafeRef.current = null;
      }
    };
  }, []);
}
