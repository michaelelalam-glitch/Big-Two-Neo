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
  // Guard against loading stale persisted selection more than once for the same
  // room key, while still allowing restoration when roomId/storageKey changes.
  const lastRestoredStorageKeyRef = useRef<string | null>(null);

  // P4-8 FIX: Freeze the storage key on the first committed non-null roomId to
  // prevent a double-restore when the caller upgrades from a transient key
  // to a stable UUID. The caller (MultiplayerGame) passes only roomInfo?.id,
  // which is null initially and becomes the stable UUID once the room loads.
  // The freeze ensures the first non-null value (the UUID) is locked in and
  // a re-render that re-passes the same UUID never triggers a second restore.
  // Using useState + useEffect instead of a render-phase ref mutation so this
  // runs only after commit (safe for React Concurrent Mode).
  const [frozenRoomId, setFrozenRoomId] = useState<string | null>(null);
  useEffect(() => {
    if (roomId && !frozenRoomId) {
      setFrozenRoomId(roomId);
    }
  }, [roomId, frozenRoomId]);
  const stableRoomId = frozenRoomId ?? roomId;

  // Build the AsyncStorage key for this room's selection.
  const storageKey = stableRoomId ? `${CARD_SELECTION_KEY_PREFIX}${stableRoomId}` : null;

  // P4-8: Restore persisted selection once per room key (only for multiplayer rooms with a roomId).
  useEffect(() => {
    if (!storageKey || lastRestoredStorageKeyRef.current === storageKey) return;
    // Mark early to prevent concurrent duplicate attempts for the same key.
    const key = storageKey;
    lastRestoredStorageKeyRef.current = key;
    AsyncStorage.getItem(key)
      .then(value => {
        if (!value) return;
        try {
          const ids: string[] = JSON.parse(value);
          if (Array.isArray(ids) && ids.length > 0) {
            setSelectedCardIdsState(new Set(ids));
          }
        } catch {
          // Reset ref so a subsequent restore can retry after malformed data,
          // and remove the bad payload to avoid repeated parse failures.
          if (lastRestoredStorageKeyRef.current === key) {
            lastRestoredStorageKeyRef.current = null;
          }
          AsyncStorage.removeItem(key).catch(() => {});
        }
      })
      .catch(() => {
        // Reset ref so a subsequent mount can retry the restore if getItem failed.
        if (lastRestoredStorageKeyRef.current === key) {
          lastRestoredStorageKeyRef.current = null;
        }
      });
  }, [storageKey]);

  // P4-8: Debounce state — holds the latest pending write so rapid selections coalesce.
  const pendingWriteRef = useRef<{ ids: Set<string>; key: string } | null>(null);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P4-8: Public setter — debounces AsyncStorage writes so rapid tap/drag
  // selections coalesce into a single write (reduces IO jank on low-end devices).
  const setSelectedCardIds = useCallback(
    (ids: Set<string>) => {
      setSelectedCardIdsState(ids);
      if (!storageKey) return;
      // Stage the latest value; any previous pending write is superseded.
      pendingWriteRef.current = { ids, key: storageKey };
      if (writeTimerRef.current !== null) {
        clearTimeout(writeTimerRef.current);
      }
      writeTimerRef.current = setTimeout(() => {
        writeTimerRef.current = null;
        const pending = pendingWriteRef.current;
        if (!pending) return;
        pendingWriteRef.current = null;
        if (pending.ids.size === 0) {
          AsyncStorage.removeItem(pending.key).catch(() => {});
        } else {
          AsyncStorage.setItem(pending.key, JSON.stringify([...pending.ids])).catch(() => {});
        }
      }, 300);
    },
    [storageKey]
  );

  // Flush any pending debounced write on unmount so the final selection is not lost.
  useEffect(() => {
    return () => {
      if (writeTimerRef.current !== null) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
      const pending = pendingWriteRef.current;
      if (!pending) return;
      pendingWriteRef.current = null;
      if (pending.ids.size === 0) {
        AsyncStorage.removeItem(pending.key).catch(() => {});
      } else {
        AsyncStorage.setItem(pending.key, JSON.stringify([...pending.ids])).catch(() => {});
      }
    };
  }, []);

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
