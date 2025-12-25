import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { BotAI, type BotDifficulty } from '../game/bot';
import type { Card } from '../game/types';
import { classifyCards } from '../game';
import { gameLogger } from '../utils/logger';

interface UseBotCoordinatorProps {
  roomId: string | null;
  isCoordinator: boolean; // Only host runs bot logic
  gameState: any; // Full game state from Realtime subscription
  players: any[]; // All players (humans + bots)
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
  roomId, 
  isCoordinator, 
  gameState,
  players,
}: UseBotCoordinatorProps) {
  const botAICache = useRef(new Map<number, BotAI>());
  const isExecutingRef = useRef(false); // Prevent re-entry
  
  /**
   * Execute bot turn when it's a bot's turn
   */
  const executeBotTurn = useCallback(async () => {
    if (!roomId || !gameState || !isCoordinator) return;
    if (isExecutingRef.current) return; // Prevent concurrent execution
    
    try {
      const currentPlayerIndex = gameState.current_turn;
      const currentPlayer = players[currentPlayerIndex];
      
      // Skip if not a bot's turn
      if (!currentPlayer?.is_bot) {
        gameLogger.debug('[BotCoordinator] Not a bot turn, skipping', {
          currentPlayerIndex,
          is_bot: currentPlayer?.is_bot,
        });
        return;
      }
      
      isExecutingRef.current = true;
      
      gameLogger.info(`🤖 [BotCoordinator] Executing bot turn for ${currentPlayer.player_name}`, {
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
        gameLogger.debug(`[BotCoordinator] Created ${difficulty} bot AI for player ${currentPlayerIndex}`);
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
      
      gameLogger.debug('[BotCoordinator] Bot decision inputs:', {
        hand_size: botHand.length,
        last_play: lastPlay ? lastPlay.combo_type : 'none',
        is_first_play: isFirstPlayOfGame,
      });
      
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
      
      // Add delay for UX (show bot "thinking")
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      if (!botDecision.cards || botDecision.cards.length === 0) {
        // Bot passes
        gameLogger.info(`[BotCoordinator] Bot passing turn`);
        
        const { error } = await supabase.rpc('pass_turn', {
          p_room_id: roomId,
          p_player_index: currentPlayerIndex,
        });
        
        if (error) {
          gameLogger.error('[BotCoordinator] Error passing turn:', error.message);
          throw error;
        }
        
        gameLogger.info(`✅ [BotCoordinator] Bot passed successfully`);
      } else {
        // Bot plays cards (botDecision.cards is string[] of card IDs)
        gameLogger.info(`[BotCoordinator] Bot playing ${botDecision.cards.length} cards: ${botDecision.cards.join(', ')}`);
        
        // Convert card IDs to Card objects to classify combo type
        const cardsToPlay: Card[] = botDecision.cards
          .map((cardId: string) => botHand.find((c: Card) => c.id === cardId))
          .filter((c: Card | undefined): c is Card => c !== undefined);
        
        // Calculate combo type from cards
        const comboType = classifyCards(cardsToPlay);
        
        gameLogger.debug(`[BotCoordinator] Calculated combo type: ${comboType}`);
        
        const { error } = await supabase.rpc('play_cards', {
          p_room_id: roomId,
          p_player_index: currentPlayerIndex,
          p_card_ids: botDecision.cards,
          p_combo_type: comboType,
        });
        
        if (error) {
          gameLogger.error('[BotCoordinator] Error playing cards:', error.message);
          throw error;
        }
        
        gameLogger.info(`✅ [BotCoordinator] Bot played ${botDecision.cards.length} cards successfully`);
      }
      
    } catch (error: any) {
      gameLogger.error('[BotCoordinator] Error executing bot turn:', error?.message || String(error));
      // Don't throw - let game continue
    } finally {
      isExecutingRef.current = false;
    }
  }, [roomId, gameState, isCoordinator, players]);
  
  /**
   * Monitor game state and trigger bot turns
   */
  useEffect(() => {
    if (!isCoordinator || !gameState || !roomId) return;
    
    const currentPlayerIndex = gameState.current_turn;
    const currentPlayer = players[currentPlayerIndex];
    
    // Only execute on bot turns
    if (currentPlayer?.is_bot && gameState.game_phase === 'playing') {
      gameLogger.debug('[BotCoordinator] Bot turn detected, scheduling execution');
      executeBotTurn();
    }
  }, [
    gameState?.current_turn, 
    gameState?.game_phase,
    isCoordinator, 
    roomId, 
    executeBotTurn,
    players,
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
