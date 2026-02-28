/**
 * @module useCardSelection
 * Manages card selection state and drag-to-reorder for the game hand.
 */
import { useState } from 'react';
import type { Card } from '../game/types';

/**
 * useCardSelection — Manages card selection state and drag-to-reorder.
 *
 * Extracted from GameScreen to reduce complexity.
 *
 * Task #431: Removed unnecessary useMemo from getSelectedCards — filter is O(n)
 * on at most 13 cards, so the memoization overhead was counterproductive.
 *
 * @returns {{ selectedCardIds: Set<string>, setSelectedCardIds: (ids: Set<string>) => void, customCardOrder: string[], setCustomCardOrder: (order: string[]) => void, handleCardsReorder: (cards: Card[]) => void, getSelectedCards: (hand: Card[]) => Card[] }}
 */
export function useCardSelection() {
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [customCardOrder, setCustomCardOrder] = useState<string[]>([]);

  // Handle card rearrangement
  const handleCardsReorder = (reorderedCards: Card[]) => {
    const newOrder = reorderedCards.map((card) => card.id);
    setCustomCardOrder(newOrder);
  };

  // Get selected cards array - simple filter, no memoization needed for 13 cards
  const getSelectedCards = (playerHand: Card[]) =>
    playerHand.filter((card) => selectedCardIds.has(card.id));

  return {
    selectedCardIds,
    setSelectedCardIds,
    customCardOrder,
    setCustomCardOrder,
    handleCardsReorder,
    getSelectedCards,
  };
}
