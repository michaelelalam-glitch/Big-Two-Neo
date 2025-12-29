import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { BotAI, type BotDifficulty } from '../game/bot';
import type { Card } from '../game/types';
import { classifyCards } from '../game';
import { gameLogger } from '../utils/logger';

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
      
      // CRITICAL: Add thinking delay for smoother gameplay and state propagation
      // Without delay, rapid-fire bot moves cause race conditions in database updates
      gameLogger.info(`🤖 [BotCoordinator] Bot thinking for 1.5s...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      gameLogger.info(`🤖 [BotCoordinator] Executing bot turn for ${currentPlayer.username || currentPlayer.player_name || `Bot ${currentPlayerIndex + 1}`}`, {
        player_index: currentPlayerIndex,
        difficulty: currentPlayer.bot_difficulty,
        hand_size: currentPlayer.cards?.length || 0,
      });
      
      // Get or create bot AI for this player
      let botAI = botAICache.current.get(currentPlayerIndex);
      if (!botAI) {
        const difficulty = (currentPlayer.bot_difficulty || 'medium') as BotDifficulty;
        botAI = new BotAI(difficulty);
        botAICache.current.set(currentPlayerIndex, botAI);
      }
      
      // Prepare bot decision inputs
      const botHand: Card[] = currentPlayer.cards || [];
      const playerCardCounts = players.map((p: any) => p.cards?.length || 0);
      
      const lastPlay = gameState.last_play ? {
        position: gameState.last_play.position,
        cards: gameState.last_play.cards,
        combo_type: gameState.last_play.combo_type,
      } : null;
      
      const isFirstPlayOfGame = gameState.game_phase === 'first_play' || 
                                (gameState.last_play === null && 
                                 players.every((p: any) => p.cards?.length === 13));

      // Calculate bot decision
      const botDecision = botAI.getPlay({
        hand: botHand,
        lastPlay,
        isFirstPlayOfGame,
        playerCardCounts,
        currentPlayerIndex,
      });
      
      gameLogger.info(`[BotCoordinator] Bot decision:`, {
        should_pass: !botDecision.cards,
        cards_to_play: botDecision.cards?.length || 0,
        reasoning: botDecision.reasoning,
      });
      
      if (!botDecision.cards || botDecision.cards.length === 0) {
        // Bot passes - use same passMove function as humans
        gameLogger.info(`[BotCoordinator] Bot passing turn`);
        
        // CRITICAL: Re-verify turn hasn't changed after thinking delay
        if (gameState.current_turn !== currentPlayerIndex) {
          gameLogger.warn('[BotCoordinator] ⚠️ Turn changed during thinking delay, aborting pass', {
            expected_turn: currentPlayerIndex,
            actual_turn: gameState.current_turn,
          });
          // Reset execution flag so next turn can execute
          isExecutingRef.current = null;
          return;
        }
        
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
        }, 3, 1000, async () => {
          // 🎯 VALIDATION: Check turn state before each retry attempt
          const { data: checkState } = await supabase
            .from('game_state')
            .select('current_turn')
            .eq('room_id', gameState.room_id)
            .single();
          return checkState?.current_turn === currentPlayerIndex;
        });
        
        gameLogger.info(`✅ [BotCoordinator] Bot passed successfully`);
        
        // CRITICAL: Wait for Realtime broadcast to propagate before continuing
        // This ensures the next bot sees the updated turn state
        gameLogger.info('⏳ [BotCoordinator] Waiting 300ms for Realtime sync...');
        await new Promise(resolve => setTimeout(resolve, 300));
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
        
        
        // CRITICAL: Re-verify turn hasn't changed after thinking delay
        if (gameState.current_turn !== currentPlayerIndex) {
          gameLogger.warn('[BotCoordinator] ⚠️ Turn changed during thinking delay, aborting play', {
            expected_turn: currentPlayerIndex,
            actual_turn: gameState.current_turn,
          });
          // Reset execution flag so next turn can execute
          isExecutingRef.current = null;
          return;
        }
        
        // Use same playCards function as humans, but pass bot's player_index
        // This allows the host to play cards on behalf of the bot
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
        }, 3, 1000, async () => {
          // 🎯 VALIDATION: Check turn state before each retry attempt
          const { data: checkState } = await supabase
            .from('game_state')
            .select('current_turn')
            .eq('room_id', gameState.room_id)
            .single();
          return checkState?.current_turn === currentPlayerIndex;
        });
        
        gameLogger.info(`✅ [BotCoordinator] Bot played ${botDecision.cards.length} cards successfully`);
        
        // CRITICAL: Wait for Realtime broadcast to propagate before continuing
        // This ensures the next bot sees the updated turn state
        gameLogger.info('⏳ [BotCoordinator] Waiting 300ms for Realtime sync...');
        await new Promise(resolve => setTimeout(resolve, 300));
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
    
    // Only execute on bot turns (works in BOTH first_play and playing phases)
    // 🔥 CRITICAL FIX: Bots must work in 'first_play' phase too! (3D must be played)
    if (currentPlayer?.is_bot && (gameState.game_phase === 'first_play' || gameState.game_phase === 'playing')) {
      gameLogger.info('[BotCoordinator] 🤖 Bot turn detected, scheduling execution');
      executeBotTurn();
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
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      botAICache.current.clear();
      isExecutingRef.current = false;
    };
  }, []);
}
