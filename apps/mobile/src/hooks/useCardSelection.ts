/**
 * @module useCardSelection
 * Manages card selection state and drag-to-reorder for the game hand.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Card } from '../game/types';
import { useGameSessionStore } from '../store';

const CARD_SELECTION_KEY_PREFIX = '@big2_card_selection_';

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
 * P4-8 FIX: selectedCardIds is persisted to AsyncStorage keyed by roomId so
 * card selections survive app-background / rejoin without the player having
 * to re-select cards after reconnecting.
 *
 * @returns {{ selectedCardIds: Set<string>, setSelectedCardIds: (ids: Set<string>) => void, customCardOrder: string[], setCustomCardOrder: (order: string[]) => void, handleCardsReorder: (cards: Card[]) => void, getSelectedCards: (hand: Card[]) => Card[] }}
 */
export function useCardSelection(roomId?: string | null) {
  const [selectedCardIds, setSelectedCardIdsState] = useState<Set<string>>(new Set());
  const customCardOrder = useGameSessionStore(s => s.customCardOrder);
  const setCustomCardOrder = useGameSessionStore(s => s.setCustomCardOrder);
  // Guard against loading stale persisted selection after we've already cleared it
  // (e.g. user deselects then the app comes back to foreground).
  const isRestoredRef = useRef(false);

  // Build the AsyncStorage key for this room's selection.
  const storageKey = roomId ? `${CARD_SELECTION_KEY_PREFIX}${roomId}` : null;

  // P4-8: Restore persisted selection on mount (only for multiplayer rooms with a roomId).
  useEffect(() => {
    if (!storageKey || isRestoredRef.current) return;
    isRestoredRef.current = true;
    AsyncStorage.getItem(storageKey)
      .then(value => {
        if (!value) return;
        try {
          const ids: string[] = JSON.parse(value);
          if (Array.isArray(ids) && ids.length > 0) {
            setSelectedCardIdsState(new Set(ids));
          }
        } catch {
          // Ignore malformed stored value.
        }
      })
      .catch(() => {});
  }, [storageKey]);

  // P4-8: Public setter that also persists to AsyncStorage.
  const setSelectedCardIds = useCallback(
    (ids: Set<string>) => {
      setSelectedCardIdsState(ids);
      if (!storageKey) return;
      if (ids.size === 0) {
        AsyncStorage.removeItem(storageKey).catch(() => {});
      } else {
        AsyncStorage.setItem(storageKey, JSON.stringify([...ids])).catch(() => {});
      }
    },
    [storageKey]
  );

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
