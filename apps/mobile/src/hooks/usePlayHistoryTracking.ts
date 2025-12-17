/**
 * usePlayHistoryTracking - Hook for tracking play history from GameState
 * 
 * Converts GameState.roundHistory into PlayHistoryMatch format
 * for the scoreboard system and automatically updates ScoreboardContext.
 * 
 * RACE CONDITION FIX:
 * Tracks gameEnded state to ensure the final match is processed when the game ends.
 * Without this, the Game End modal may open before this hook processes the gameEnded
 * state change, resulting in the winning hand being missing from play history.
 * The lastProcessedRef includes gameEnded tracking to detect match completion reliably.
 * 
 * Created as part of Task #355: Play history tracking
 * Date: December 12, 2025
 */

import { useEffect, useRef } from 'react';
import { type GameState, type RoundHistoryEntry } from '../game/state';
import { type PlayHistoryMatch, type PlayHistoryHand, type PlayerPosition } from '../types/scoreboard';
import { useScoreboard } from '../contexts/ScoreboardContext';

/**
 * Convert RoundHistoryEntry to PlayHistoryHand
 */
function convertToPlayHistoryHand(entry: RoundHistoryEntry, playerIndex: number): PlayHistoryHand | null {
  // Skip passed entries (they don't represent actual card plays)
  if (entry.passed || entry.cards.length === 0) {
    return null;
  }

  return {
    by: playerIndex as PlayerPosition,
    type: entry.combo_type,
    count: entry.cards.length,
    cards: entry.cards,
    timestamp: new Date(entry.timestamp).toISOString(),
  };
}

/**
 * Convert GameState.roundHistory to PlayHistoryMatch
 */
function convertToPlayHistoryMatch(
  matchNumber: number,
  roundHistory: RoundHistoryEntry[],
  players: Array<{ id: string; name: string }>,
  winnerId?: string,
  startTime?: number,
  endTime?: number
): PlayHistoryMatch {
  // Create player ID to index map for fast lookup
  const playerIdToIndex = new Map<string, number>();
  players.forEach((player, index) => {
    playerIdToIndex.set(player.id, index);
  });

  // Convert all non-pass entries to PlayHistoryHand
  const hands: PlayHistoryHand[] = [];
  
  for (const entry of roundHistory) {
    const playerIndex = playerIdToIndex.get(entry.playerId);
    
    if (playerIndex === undefined) {
      console.warn(`[PlayHistory] Unknown player ID in history: ${entry.playerId}`);
      continue;
    }

    const hand = convertToPlayHistoryHand(entry, playerIndex);
    if (hand) {
      hands.push(hand);
    }
  }

  return {
    matchNumber,
    hands,
    winner: winnerId ? playerIdToIndex.get(winnerId) : undefined,
    startTime: startTime ? new Date(startTime).toISOString() : undefined,
    endTime: endTime ? new Date(endTime).toISOString() : undefined,
  };
}

/**
 * Hook for tracking play history from GameState
 * 
 * @param gameState - Current game state (can be null if game not started)
 * @param enabled - Whether to track play history (default: true)
 * 
 * Usage:
 * ```tsx
 * const gameState = useGameStore(state => state.gameState);
 * usePlayHistoryTracking(gameState);
 * ```
 */
export function usePlayHistoryTracking(
  gameState: GameState | null,
  enabled: boolean = true
): void {
  const { addPlayHistory } = useScoreboard();
  
  // Track last processed match and history length to detect changes
  const lastProcessedRef = useRef<{
    matchNumber: number;
    historyLength: number;
    gameEnded: boolean; // Track if we've processed the match end state
  }>({ matchNumber: 0, historyLength: 0, gameEnded: false });

  useEffect(() => {
    // Skip if disabled or no game state
    if (!enabled || !gameState || !gameState.gameStarted) {
      return;
    }

    const currentMatch = gameState.currentMatch;
    const currentHistoryLength = gameState.roundHistory.length;
    const lastProcessed = lastProcessedRef.current;

    // CRITICAL FIX: Check if we need to update (new match, new plays, OR match just ended)
    // The gameEnded check ensures we capture the final hand with winner info
    const matchNumberChanged = currentMatch !== lastProcessed.matchNumber;
    const historyLengthChanged = currentHistoryLength !== lastProcessed.historyLength;
    const matchJustEnded = gameState.gameEnded && !lastProcessed.gameEnded;
    
    const shouldUpdate = matchNumberChanged || historyLengthChanged || matchJustEnded;

    if (!shouldUpdate) {
      return;
    }

    // Build player list with consistent indexing
    const players = gameState.players.map((p) => ({
      id: p.id,
      name: p.name,
    }));

    // Determine if match has ended
    const matchEnded = gameState.gameEnded;
    const winnerId = matchEnded ? gameState.winnerId : undefined;
    const endTime = matchEnded ? Date.now() : undefined;

    // Convert current match history
    const playHistory = convertToPlayHistoryMatch(
      currentMatch,
      gameState.roundHistory,
      players,
      winnerId ?? undefined,
      gameState.startedAt,
      endTime
    );

    // Update scoreboard context
    addPlayHistory(playHistory);

    // Update tracking ref
    lastProcessedRef.current = {
      matchNumber: currentMatch,
      historyLength: currentHistoryLength,
      gameEnded: gameState.gameEnded,
    };

    console.log(`[PlayHistory] Updated match ${currentMatch} with ${playHistory.hands.length} hands (matchEnded: ${matchEnded}, winnerId: ${winnerId})`);
  }, [
    gameState,
    enabled,
    addPlayHistory,
  ]);
}

export default usePlayHistoryTracking;
