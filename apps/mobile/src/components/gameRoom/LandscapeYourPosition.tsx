/**
 * LandscapeYourPosition Component (FULL REWRITE)
 *
 * Bottom player position with FULL card hand interaction for landscape mode
 * NOW USES: Portrait Card component with ALL features (drag/drop/select/rearrange)
 *
 * Features:
 * - Full drag-and-drop to play cards on table
 * - Drag to rearrange card order
 * - Selection with visual border (orange - matches portrait)
 * - Lift-up animation for selected cards
 * - Multi-card selection and play
 * - Exactly matches portrait CardHand behavior
 *
 * Task #461: Make landscape cards behave EXACTLY like portrait
 * Date: December 18, 2025
 */

import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';
import { i18n } from '../../i18n';
import { gameLogger } from '../../utils/logger';
import Card from '../game/Card';
import type { Card as CardType } from '../../game/types';
import type { DragZoneState } from '../game/CardHand';

// ============================================================================
// CONSTANTS
// ============================================================================

const CARD_SPACING = 40; // For drag calculations
const DRAG_TO_PLAY_THRESHOLD = -80; // Drag up to play
const DRAG_APPROACH_THRESHOLD = -40; // 50% of threshold — approaching zone

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface LandscapeYourPositionProps {
  /** Player name */
  playerName: string;
  /** Player's cards */
  cards: CardType[];
  /** Selected card IDs */
  selectedCardIds: Set<string>;
  /** Selection change handler */
  onSelectionChange: (ids: Set<string>) => void;
  /** Is player's turn */
  isActive: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Callbacks for playing cards */
  onPlayCards?: (cards: CardType[]) => void;
  onCardsReorder?: (cards: CardType[]) => void;
  /** Drag zone state change callback (for table glow) */
  onDragZoneChange?: (state: DragZoneState) => void;
}

// Drag state interface (matches portrait CardHand)
interface DragState {
  draggedCardId: string | null;
  targetIndex: number | null;
  longPressedCardId: string | null;
  isDraggingMultiple: boolean;
  sharedTranslation: { x: number; y: number };
}

const initialDragState: DragState = {
  draggedCardId: null,
  targetIndex: null,
  longPressedCardId: null,
  isDraggingMultiple: false,
  sharedTranslation: { x: 0, y: 0 },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LandscapeYourPosition({
  playerName: _playerName,
  cards,
  selectedCardIds,
  onSelectionChange,
  isActive: _isActive,
  disabled = false,
  onPlayCards,
  onCardsReorder,
  onDragZoneChange,
}: LandscapeYourPositionProps) {
  // Drag state (matches portrait CardHand)
  const [dragState, setDragState] = useState<DragState>(initialDragState);
  // Track last reported zone to avoid redundant callbacks (matches portrait CardHand)
  const lastZoneRef = useRef<DragZoneState>('idle');
  const optimisticallyRemovedRef = useRef(new Set<string>());
  const optimisticRollbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [displayCards, setDisplayCards] = useState<CardType[]>(cards);

  // Rollback optimistic removals after a timeout if the parent props haven't confirmed
  const scheduleOptimisticRollback = useCallback(() => {
    if (optimisticRollbackTimerRef.current) clearTimeout(optimisticRollbackTimerRef.current);
    optimisticRollbackTimerRef.current = setTimeout(() => {
      if (optimisticallyRemovedRef.current.size > 0) {
        optimisticallyRemovedRef.current.clear();
        setDisplayCards(prev => {
          const parentIds = new Set(cards.map(c => c.id));
          const currentIds = new Set(prev.map(c => c.id));
          if (
            parentIds.size !== currentIds.size ||
            ![...parentIds].every(id => currentIds.has(id))
          ) {
            return cards;
          }
          return prev;
        });
      }
    }, 3000);
  }, [cards]);

  // Clean up the rollback timer on unmount
  React.useEffect(() => {
    return () => {
      if (optimisticRollbackTimerRef.current) {
        clearTimeout(optimisticRollbackTimerRef.current);
      }
    };
  }, []);

  // Update display cards ONLY when cards are added/removed OR parent explicitly reorders
  // CRITICAL: Do NOT auto-reorder during play/pass/button presses
  React.useEffect(() => {
    // Prune confirmed removals from the optimistic set: if parent cards no longer contain
    // an ID we optimistically removed, the play was accepted by the server.
    const newIds = new Set(cards.map(c => c.id));
    for (const id of optimisticallyRemovedRef.current) {
      if (!newIds.has(id)) {
        optimisticallyRemovedRef.current.delete(id);
      }
    }

    // Filter parent cards to exclude anything still optimistically removed
    const filteredCards =
      optimisticallyRemovedRef.current.size > 0
        ? cards.filter(c => !optimisticallyRemovedRef.current.has(c.id))
        : cards;

    const currentIds = new Set(displayCards.map(c => c.id));
    const filteredIds = new Set(filteredCards.map(c => c.id));

    // Check if cards actually changed (not just reordered)
    const sameCardSet =
      currentIds.size === filteredIds.size && [...currentIds].every(id => filteredIds.has(id));

    if (!sameCardSet) {
      // Cards were added or removed (play/pass action) - update display
      // But preserve the relative order of remaining cards
      const remainingCards = displayCards.filter(c => filteredIds.has(c.id));
      const addedCards = filteredCards.filter(c => !currentIds.has(c.id));

      // Combine: keep user's custom order for existing cards, append new cards
      setDisplayCards([...remainingCards, ...addedCards]);
      setDragState(initialDragState);
    }
    // CRITICAL FIX (Issue #1): ALWAYS initialize displayCards if empty
    else if (displayCards.length === 0) {
      setDisplayCards(filteredCards);
    }
    // CRITICAL FIX (Issue #2): If same card set but different order, AND user didn't manually rearrange,
    // update to match parent's order (this allows helper buttons to work)
    else if (sameCardSet && displayCards.length > 0) {
      // Check if order actually changed
      const orderChanged = !displayCards.every((card, idx) => card.id === filteredCards[idx]?.id);
      // Only update if NOT currently dragging (preserve user's manual rearrangement)
      if (orderChanged && !dragState.draggedCardId) {
        gameLogger.info(
          '🔄 [LandscapeYourPosition] Parent reordered cards (helper button), updating display'
        );
        setDisplayCards(filteredCards);
      }
    }
  }, [cards, displayCards, dragState.draggedCardId]);

  const orderedCards = displayCards;

  // Toggle card selection (matches portrait)
  const handleToggleSelect = useCallback(
    (cardId: string) => {
      if (disabled) return;

      const newSet = new Set(selectedCardIds);
      if (newSet.has(cardId)) {
        newSet.delete(cardId);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        newSet.add(cardId);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      onSelectionChange(newSet);
    },
    [disabled, selectedCardIds, onSelectionChange]
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (cardId: string) => {
      const isMultiDrag = selectedCardIds.has(cardId) && selectedCardIds.size > 1;
      setDragState({
        draggedCardId: cardId,
        targetIndex: null,
        longPressedCardId: null,
        isDraggingMultiple: isMultiDrag,
        sharedTranslation: { x: 0, y: 0 },
      });
    },
    [selectedCardIds]
  );

  // Handle long press
  const handleLongPress = useCallback((cardId: string) => {
    setDragState(prev => ({ ...prev, longPressedCardId: cardId }));
    setTimeout(() => {
      setDragState(prev =>
        prev.longPressedCardId === cardId ? { ...prev, longPressedCardId: null } : prev
      );
    }, 300);
  }, []);

  // Handle drag update
  const handleDragUpdate = useCallback(
    (cardId: string, translationX: number, translationY: number) => {
      if (!dragState.draggedCardId || dragState.draggedCardId !== cardId) return;

      // Report drop zone proximity (matches portrait CardHand zone detection)
      if (onDragZoneChange) {
        const zone: DragZoneState =
          translationY < DRAG_TO_PLAY_THRESHOLD
            ? 'active'
            : translationY < DRAG_APPROACH_THRESHOLD
              ? 'approaching'
              : 'idle';
        if (zone !== lastZoneRef.current) {
          lastZoneRef.current = zone;
          onDragZoneChange(zone);
        }
      }

      // Multi-drag: synchronized movement
      if (dragState.isDraggingMultiple) {
        setDragState(prev => ({
          ...prev,
          sharedTranslation: { x: translationX, y: translationY },
          targetIndex: null,
        }));
        return;
      }

      // Single drag: check if horizontal (rearrange) or vertical (play)
      const isHorizontalDrag = Math.abs(translationX) > Math.abs(translationY);
      if (!isHorizontalDrag) {
        // Update sharedTranslation so drop-zone hint UI reacts to single-card vertical drags
        setDragState(prev => ({
          ...prev,
          sharedTranslation: { x: translationX, y: translationY },
          targetIndex: null,
        }));
        return;
      }

      const currentIndex = orderedCards.findIndex(c => c.id === cardId);
      if (currentIndex === -1) return;

      const positionShift = Math.round(translationX / CARD_SPACING);
      const targetIndex = Math.max(
        0,
        Math.min(orderedCards.length - 1, currentIndex + positionShift)
      );

      if (targetIndex !== currentIndex) {
        setDragState(prev => ({ ...prev, targetIndex }));
      } else {
        setDragState(prev => ({ ...prev, targetIndex: null }));
      }
    },
    [dragState.draggedCardId, dragState.isDraggingMultiple, orderedCards, onDragZoneChange]
  );

  // Handle drag end
  const handleDragEnd = useCallback(
    (cardId: string, translationX: number, translationY: number) => {
      // Reset drop zone state on drag end
      if (onDragZoneChange && lastZoneRef.current !== 'idle') {
        lastZoneRef.current = 'idle';
        onDragZoneChange('idle');
      }

      if (dragState.draggedCardId) {
        const isHorizontalDrag = Math.abs(translationX) > Math.abs(translationY);
        const isUpwardDrag = translationY < DRAG_TO_PLAY_THRESHOLD;

        // Multi-drag upward = play all selected
        if (dragState.isDraggingMultiple && isUpwardDrag && onPlayCards) {
          const selected = orderedCards.filter(card => selectedCardIds.has(card.id));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // Optimistically remove cards from display - don't wait for server confirmation
          for (const id of selectedCardIds) {
            optimisticallyRemovedRef.current.add(id);
          }
          setDisplayCards(prev => prev.filter(c => !selectedCardIds.has(c.id)));
          scheduleOptimisticRollback();
          onPlayCards(selected);
          onSelectionChange(new Set());
        }
        // Single drag upward = play this card
        else if (
          isUpwardDrag &&
          !isHorizontalDrag &&
          !dragState.isDraggingMultiple &&
          onPlayCards
        ) {
          const card = orderedCards.find(c => c.id === cardId);
          if (card) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Optimistically remove card from display - don't wait for server confirmation
            optimisticallyRemovedRef.current.add(cardId);
            setDisplayCards(prev => prev.filter(c => c.id !== cardId));
            scheduleOptimisticRollback();
            onPlayCards([card]);
          }
        }
        // Horizontal drag = rearrange
        else if (
          isHorizontalDrag &&
          dragState.targetIndex !== null &&
          !dragState.isDraggingMultiple
        ) {
          const currentIndex = orderedCards.findIndex(c => c.id === cardId);
          if (currentIndex !== -1 && dragState.targetIndex !== currentIndex) {
            const newCards = [...orderedCards];
            const [draggedCard] = newCards.splice(currentIndex, 1);
            newCards.splice(dragState.targetIndex, 0, draggedCard);
            setDisplayCards(newCards);
            if (onCardsReorder) onCardsReorder(newCards);
          }
        }

        setDragState(initialDragState);
      }
    },
    [
      dragState,
      orderedCards,
      selectedCardIds,
      onPlayCards,
      onSelectionChange,
      onCardsReorder,
      onDragZoneChange,
      scheduleOptimisticRollback,
    ]
  );

  // Empty state
  if (cards.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{i18n.t('game.noCards')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="landscape-your-position">
      {/* Drag-to-play drop zone indicator */}
      {dragState.draggedCardId && dragState.sharedTranslation.y < DRAG_TO_PLAY_THRESHOLD && (
        <View style={styles.playDropZone}>
          <Text style={styles.playDropZoneText}>
            {dragState.isDraggingMultiple
              ? `Release to play ${selectedCardIds.size} cards`
              : 'Release to play card'}
          </Text>
        </View>
      )}

      {/* Card hand with FULL portrait Card component */}
      <View style={styles.cardsContainer}>
        {orderedCards.map((card, index) => {
          const isThisCardSelected = selectedCardIds.has(card.id);
          const hasMultipleSelected = selectedCardIds.size > 1;
          const isDraggingThisGroup = dragState.isDraggingMultiple && isThisCardSelected;
          const isTargetPosition =
            dragState.targetIndex === index &&
            dragState.draggedCardId !== card.id &&
            !dragState.isDraggingMultiple;

          return (
            <React.Fragment key={card.id}>
              {/* Drop zone indicator for rearranging */}
              {isTargetPosition && <View style={styles.dropZoneIndicator} />}
              <Card
                card={card}
                isSelected={isThisCardSelected}
                onToggleSelect={handleToggleSelect}
                onDragStart={() => handleDragStart(card.id)}
                onDragUpdate={(tx, ty) => handleDragUpdate(card.id, tx, ty)}
                onDragEnd={(tx, ty) => handleDragEnd(card.id, tx, ty)}
                onLongPress={() => handleLongPress(card.id)}
                disabled={disabled}
                size="hand" // Portrait size
                zIndex={
                  dragState.draggedCardId === card.id
                    ? 3000
                    : dragState.longPressedCardId === card.id
                      ? 2000
                      : index + 1
                }
                hasMultipleSelected={hasMultipleSelected && isThisCardSelected}
                isDraggingGroup={isDraggingThisGroup}
                sharedDragX={dragState.sharedTranslation.x}
                sharedDragY={dragState.sharedTranslation.y}
              />
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },

  cardsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    zIndex: 100, // CRITICAL: Higher than buttons to enable drag/drop (standardized with LandscapeGameLayout)
  },

  dropZoneIndicator: {
    width: 4,
    height: 80,
    backgroundColor: COLORS.accent,
    borderRadius: 2,
    opacity: 0.8,
    marginHorizontal: SPACING.xs,
    alignSelf: 'center',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 5,
  },

  playDropZone: {
    position: 'absolute',
    top: -60,
    left: 20,
    right: 20,
    height: 50,
    backgroundColor: `${COLORS.accent}30`,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },

  playDropZoneText: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  emptyState: {
    padding: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderStyle: 'dashed',
    minHeight: 104,
    justifyContent: 'center',
    alignItems: 'center',
  },

  emptyText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});

export default LandscapeYourPosition;
