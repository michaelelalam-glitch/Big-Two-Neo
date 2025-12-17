import { useState } from 'react';
import type { Card } from '../game/types';

/**
 * Custom hook to manage card selection state and reordering
 * Extracted from GameScreen to reduce complexity
 * 
 * Task #431: Removed unnecessary useMemo from getSelectedCards - filter operation is O(n) which is fast enough
 * The memoization overhead was actually slower than just filtering on each call
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
