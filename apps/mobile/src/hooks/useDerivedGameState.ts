import { useMemo } from 'react';
import { sortCardsForDisplay } from '../utils/cardSorting';
import type { GameState } from '../game/state';
import type { Card } from '../game/types';

// Constants
const SUIT_NAMES: Record<string, string> = { D: '♦', C: '♣', H: '♥', S: '♠' };

// Helper functions
const getRankCounts = (cards: Card[]): Record<string, number> => {
  const rankCounts: Record<string, number> = {};
  cards.forEach((card) => {
    rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
  });
  return rankCounts;
};

interface UseDerivedGameStateParams {
  gameState: GameState | null;
  customCardOrder: string[];
  setCustomCardOrder: (order: string[]) => void;
}

/**
 * Custom hook to derive UI state from game engine state
 * Includes player hand, last played cards, and formatted combo displays
 * Extracted from GameScreen to reduce complexity
 */
export function useDerivedGameState({
  gameState,
  customCardOrder,
  setCustomCardOrder,
}: UseDerivedGameStateParams) {
  // Player hand with custom ordering support
  const playerHand = useMemo(() => {
    if (!gameState) return [];
    const hand = gameState.players[0].hand; // Player is always at index 0

    // Reset custom order if hand is empty (new round starting)
    if (hand.length === 0 && customCardOrder.length > 0) {
      setCustomCardOrder([]);
    }

    // If user has manually reordered cards, use that order
    if (customCardOrder.length > 0) {
      const orderedHand: Card[] = [];

      // First, add cards in custom order that are still in hand
      for (const cardId of customCardOrder) {
        const card = hand.find((c) => c.id === cardId);
        if (card) orderedHand.push(card);
      }

      // Then add any new cards that aren't in custom order (at the end)
      for (const card of hand) {
        if (!orderedHand.some((c) => c.id === card.id)) {
          orderedHand.push(card);
        }
      }

      // Only use custom order if we found at least some matching cards
      if (orderedHand.length > 0) {
        return orderedHand;
      }
    }

    return hand;
  }, [gameState, customCardOrder, setCustomCardOrder]);

  const lastPlayedCards = useMemo(() => {
    if (!gameState || !gameState.lastPlay) return [];
    return gameState.lastPlay.cards;
  }, [gameState]);

  const lastPlayedBy = useMemo(() => {
    if (!gameState || gameState.roundHistory.length === 0) return null;
    // Task #379: Find the last entry where cards were actually played (not a pass)
    const lastPlayEntry = [...gameState.roundHistory]
      .reverse()
      .find((entry) => !entry.passed && entry.cards.length > 0);
    return lastPlayEntry?.playerName || null;
  }, [gameState]);

  // Raw combo type for card sorting (e.g., "Straight", "Flush")
  const lastPlayComboType = useMemo(() => {
    if (!gameState || !gameState.lastPlay) return null;
    return gameState.lastPlay.combo_type;
  }, [gameState]);

  // Formatted combo display text (e.g., "Straight to 6", "Flush ♥ (A high)")
  const lastPlayCombo = useMemo(() => {
    if (!gameState || !gameState.lastPlay) return null;

    const combo = gameState.lastPlay.combo_type;
    const cards = gameState.lastPlay.cards;

    // Format combo type with high card details
    if (combo === 'Single' && cards.length > 0) {
      return `Single ${cards[0].rank}`;
    } else if (combo === 'Pair' && cards.length > 0) {
      return `Pair of ${cards[0].rank}s`;
    } else if (combo === 'Triple' && cards.length > 0) {
      return `Triple ${cards[0].rank}s`;
    } else if (combo === 'Full House' && cards.length > 0) {
      // Find the triple (3 of a kind) - it's the combo's key rank
      const rankCounts = getRankCounts(cards);
      const tripleRank = Object.keys(rankCounts).find((rank) => rankCounts[rank] === 3);
      return tripleRank ? `Full House (${tripleRank}s)` : 'Full House';
    } else if (combo === 'Four of a Kind' && cards.length > 0) {
      const rankCounts = getRankCounts(cards);
      const quadRank = Object.keys(rankCounts).find((rank) => rankCounts[rank] === 4);
      return quadRank ? `Four ${quadRank}s` : 'Four of a Kind';
    } else if (combo === 'Straight' && cards.length > 0) {
      // Get highest card in straight (sort descending, take first)
      const sorted = sortCardsForDisplay(cards, 'Straight');
      const highCard = sorted[0];
      if (!highCard) return 'Straight';
      return `Straight to ${highCard.rank}`;
    } else if (combo === 'Flush' && cards.length > 0) {
      const sorted = sortCardsForDisplay(cards, 'Flush');
      const highCard = sorted[0];
      if (!highCard) return 'Flush';
      return `Flush ${SUIT_NAMES[highCard.suit] || highCard.suit} (${highCard.rank} high)`;
    } else if (combo === 'Straight Flush' && cards.length > 0) {
      const sorted = sortCardsForDisplay(cards, 'Straight Flush');
      const highCard = sorted[0];
      if (!highCard) return 'Straight Flush';
      return `Straight Flush ${SUIT_NAMES[highCard.suit] || highCard.suit} to ${highCard.rank}`;
    }

    return combo;
  }, [gameState]);

  return {
    playerHand,
    lastPlayedCards,
    lastPlayedBy,
    lastPlayComboType,
    lastPlayCombo,
  };
}
