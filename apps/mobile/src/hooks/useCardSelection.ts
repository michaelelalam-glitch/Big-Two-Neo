/**
 * @module useCardSelection
 * Manages card selection state and drag-to-reorder for the game hand.
 */
import { useState, useCallback } from 'react';
import type { Card } from '../game/types';
import { useGameSessionStore } from '../store';

/**
 * useCardSelection — Manages card selection state and drag-to-reorder.
 *
 * Extracted from GameScreen to reduce complexity.
 *
 * Task #431: Removed unnecessary useMemo from getSelectedCards — filter is O(n)
 * on at most 13 cards, so the memoization overhead was counterproductive.
 *
 * C2 Audit fix: customCardOrder now lives in the Zustand gameSessionStore
 * (single source of truth) instead of local useState.
 *
 * @returns {{ selectedCardIds: Set<string>, setSelectedCardIds: (ids: Set<string>) => void, customCardOrder: string[], setCustomCardOrder: (order: string[]) => void, handleCardsReorder: (cards: Card[]) => void, getSelectedCards: (hand: Card[]) => Card[] }}
 */
export function useCardSelection() {
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const customCardOrder = useGameSessionStore(s => s.customCardOrder);
  const setCustomCardOrder = useGameSessionStore(s => s.setCustomCardOrder);

  // Handle card rearrangement
  // useCallback ensures stable reference across re-renders so gameContextValue
  // useMemo (which lists handleCardsReorder as a dep) isn't invalidated on every
  // render (perf/task-628).  setCustomCardOrder is a Zustand action — always stable.
  const handleCardsReorder = useCallback(
    (reorderedCards: Card[]) => {
      setCustomCardOrder(reorderedCards.map(card => card.id));
    },
    [setCustomCardOrder]
  );

  // Get selected cards array - simple filter, no memoization needed for 13 cards
  const getSelectedCards = (playerHand: Card[]) =>
    playerHand.filter(card => selectedCardIds.has(card.id));

  return {
    selectedCardIds,
    setSelectedCardIds,
    customCardOrder,
    setCustomCardOrder,
    handleCardsReorder,
    getSelectedCards,
  };
}
