import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, Pressable, Text, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES, LAYOUT } from '../../constants';
import type { Card as CardType } from '../../game/types';
import { trackEvent } from '../../services/analytics';
import Card from './Card';

// PORTRAIT vs LANDSCAPE CARD SPACING (separate constants for each orientation)
// PORTRAIT: EXACT ORIGINAL VALUES FROM BEFORE LANDSCAPE MODE
// LANDSCAPE: Separate values that don't affect portrait

// Portrait mode: ORIGINAL VALUES - DO NOT CHANGE
// 13 cards with -40px overlap: 60px + (12 × 20px visible) = 300px + 48px padding + 68px marginLeft = fits perfectly
const PORTRAIT_CARD_OVERLAP = -40; // ORIGINAL overlap from main branch
const PORTRAIT_CARD_SPACING = 30; // Original spacing for drag calculations
const PORTRAIT_PADDING = SPACING.lg; // ORIGINAL 24px padding
const PORTRAIT_MARGIN_LEFT = LAYOUT.handAlignmentOffset; // ORIGINAL 68px offset

// Landscape mode: Separate values
const LANDSCAPE_CARD_OVERLAP = -30;
const LANDSCAPE_CARD_SPACING = 30;
const LANDSCAPE_PADDING = SPACING.md;
const LANDSCAPE_MARGIN_LEFT = 0; // No offset in landscape

// Drag threshold for playing cards (matches Card.tsx DRAG_TO_PLAY_THRESHOLD)
const DRAG_TO_PLAY_THRESHOLD = -80;
// Approach threshold: start showing glow when within this range (50% of full threshold)
const DRAG_APPROACH_THRESHOLD = DRAG_TO_PLAY_THRESHOLD * 0.5; // -40

/** Drop zone visual state communicated to parent for table perimeter glow */
export type DragZoneState = 'idle' | 'approaching' | 'active';

interface CardHandProps {
  cards: CardType[];
  onPlayCards: (selectedCards: CardType[]) => void;
  onPass: () => void;
  canPlay?: boolean;
  disabled?: boolean;
  hideButtons?: boolean; // New prop to hide internal buttons
  selectedCardIds?: Set<string>; // Optional: lifted state for external control
  onSelectionChange?: (selected: Set<string>) => void; // Optional: callback for lifted state
  onCardsReorder?: (reorderedCards: CardType[]) => void; // New: callback when cards are rearranged
  onDragZoneChange?: (state: DragZoneState) => void; // Task #652: notify parent of drag zone state for table glow
}

// Consolidated drag state interface
interface DragState {
  draggedCardId: string | null;
  targetIndex: number | null;
  longPressedCardId: string | null;
  isDraggingMultiple: boolean;
  sharedTranslation: { x: number; y: number };
}

// Initial drag state
const initialDragState: DragState = {
  draggedCardId: null,
  targetIndex: null,
  longPressedCardId: null,
  isDraggingMultiple: false,
  sharedTranslation: { x: 0, y: 0 },
};

// Task #628: React.memo — bail out when hand/selection/callbacks are reference-equal.
function CardHandComponent({
  cards,
  onPlayCards,
  onPass,
  canPlay = true,
  disabled = false,
  hideButtons = false,
  selectedCardIds: externalSelectedCardIds,
  onSelectionChange,
  onCardsReorder,
  onDragZoneChange,
}: CardHandProps) {
  // Detect orientation for responsive card spacing
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Select spacing based on orientation
  const CARD_SPACING = isLandscape ? LANDSCAPE_CARD_SPACING : PORTRAIT_CARD_SPACING;

  // Track whether cards have entered the drop zone (for haptic on entry)
  const wasInDropZone = useRef(false);
  // Ref-based zone tracking for single-card drag: avoids calling setDragState
  // on every gesture frame (~60/s) when translation stays within the same zone.
  // State is only updated on zone-boundary crossings (idle ↔ approaching ↔ active).
  const lastSingleDragZoneRef = useRef<'idle' | 'approaching' | 'active'>('idle');
  // Tracks lastTargetIndex via ref to avoid stale-closure reads in handleDragUpdate
  // and to gate horizontal state updates to slot-change events only.
  const lastTargetIndexRef = useRef<number | null>(null);

  // Consolidated state: selection
  const [internalSelectedCardIds, setInternalSelectedCardIds] = useState<Set<string>>(new Set());

  // Consolidated state: drag operations
  const [dragState, setDragState] = useState<DragState>(initialDragState);

  // Drop zone glow & haptic on entry (must be after dragState declaration)
  const dragY = dragState.sharedTranslation.y;
  const isDragging = !!dragState.draggedCardId;
  // Gate drop-zone detection behind canPlay && !disabled so glow/haptic
  // feedback and the drag-to-play path match the disabled Play button UX.
  const canDragToPlay = canPlay && !disabled;
  const isInDropZone = canDragToPlay && isDragging && dragY < DRAG_TO_PLAY_THRESHOLD;
  const isApproaching =
    canDragToPlay &&
    isDragging &&
    dragY < DRAG_APPROACH_THRESHOLD &&
    dragY >= DRAG_TO_PLAY_THRESHOLD;

  useEffect(() => {
    if (isInDropZone && !wasInDropZone.current) {
      // Card just entered the drop zone — fire haptic
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {
        // swallow — unsupported on some simulators/devices
      });
      wasInDropZone.current = true;
    } else if (!isInDropZone) {
      wasInDropZone.current = false;
    }
  }, [isInDropZone]);

  // Task #652: Notify parent of drag zone state for table perimeter glow.
  // No return cleanup here — returning 'idle' from the dep-change cleanup would
  // fire an extra 'idle' on every isApproaching/isInDropZone toggle, causing
  // table-glow flicker. Unmount cleanup is handled by the separate effect below.
  useEffect(() => {
    if (!onDragZoneChange) return;
    if (isInDropZone) {
      onDragZoneChange('active');
    } else if (isApproaching) {
      onDragZoneChange('approaching');
    } else {
      onDragZoneChange('idle');
    }
  }, [isInDropZone, isApproaching, onDragZoneChange]);

  // Best-effort reset on unmount only (separate from the above so it doesn't
  // fire on every dep change — avoids the flicker described above).
  useEffect(
    () => () => {
      onDragZoneChange?.('idle');
    },
    [onDragZoneChange]
  );

  // Separate state: display cards (managed independently)
  const [displayCards, setDisplayCards] = useState<CardType[]>(cards);

  // Track card IDs that were optimistically removed via drag-to-play.
  // The sync effect below must not re-add them until the parent's `cards` prop
  // actually drops them (confirming the play was accepted).
  const optimisticallyRemovedRef = useRef(new Set<string>());
  const optimisticRollbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rollback optimistic removals after a timeout if the parent props haven't confirmed
  const scheduleOptimisticRollback = useCallback(() => {
    if (optimisticRollbackTimerRef.current) clearTimeout(optimisticRollbackTimerRef.current);
    optimisticRollbackTimerRef.current = setTimeout(() => {
      if (optimisticallyRemovedRef.current.size > 0) {
        optimisticallyRemovedRef.current.clear();
        // Re-sync display cards with parent cards
        setDisplayCards(prev => {
          // Only update if the parent cards are different
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
    }, 3000); // 3s safety net — server should respond well within
  }, [cards]);

  // Clean up the rollback timer on unmount to avoid setState on unmounted component
  useEffect(() => {
    return () => {
      if (optimisticRollbackTimerRef.current) {
        clearTimeout(optimisticRollbackTimerRef.current);
      }
    };
  }, []);

  // Selection state: If external state is provided, use it; otherwise use internal state.
  // The setter pattern (const setSelectedCardIds = onSelectionChange ?? setInternalSelectedCardIds)
  // was intentionally removed because:
  // 1. Better type safety: TypeScript can't infer correct types for conditional setter assignment
  // 2. Clearer intent: Explicit checks make it obvious when using lifted vs internal state
  // 3. Avoids re-renders: Conditional setter reference changes on every render when onSelectionChange changes
  // All selection updates use explicit checks for onSelectionChange (see handleToggleSelect, handleClearSelection, etc.)
  const selectedCardIds = externalSelectedCardIds ?? internalSelectedCardIds;

  // Update display cards when prop cards change
  const displayCardsRef = useRef(displayCards);
  displayCardsRef.current = displayCards;
  React.useEffect(() => {
    // Prune confirmed removals from the optimistic set: if the parent's cards no
    // longer contain an ID we optimistically removed, the play was accepted.
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

    // CRITICAL FIX: Only update if cards actually changed (not just reordered)
    // Use ref to avoid re-triggering this effect when displayCards updates
    const currentIds = new Set(displayCardsRef.current.map(c => c.id));
    const filteredIds = new Set(filteredCards.map(c => c.id));

    const sameCardSet =
      currentIds.size === filteredIds.size && [...currentIds].every(id => filteredIds.has(id));

    if (!sameCardSet) {
      // Cards actually changed (added/removed) - reset drag state and update display
      setDragState(initialDragState);
      setDisplayCards(filteredCards);
    } else {
      // Same cards, potentially reordered by parent (via customCardOrder)
      const orderChanged = filteredCards.some((card, index) => {
        return displayCardsRef.current[index]?.id !== card.id;
      });

      if (orderChanged || displayCardsRef.current.length === 0) {
        setDisplayCards(filteredCards);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  // Use displayCards directly. The parent manages the order via the cards prop (e.g., customCardOrder),
  // but CardHand also manages displayCards locally during drag-and-drop operations.
  const orderedCards = displayCards;

  // Toggle card selection (memoized to prevent card re-renders)
  const handleToggleSelect = useCallback(
    (cardId: string) => {
      if (disabled) return;

      const updateSelection = (prev: Set<string>) => {
        const newSet = new Set(prev);
        const wasSelected = newSet.has(cardId);

        if (wasSelected) {
          newSet.delete(cardId);
          // Light haptic for deselection
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } else {
          newSet.add(cardId);
          // Medium haptic for selection (more pronounced feedback)
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        }

        return newSet;
      };

      if (onSelectionChange) {
        // Lifted state: selectedCardIds is in deps array, so callback recreates when it changes
        // This ensures we always have the latest value (no stale closure)
        onSelectionChange(updateSelection(selectedCardIds));
      } else {
        // Internal state: update directly with functional form
        setInternalSelectedCardIds(updateSelection);
      }
    },
    [disabled, selectedCardIds, onSelectionChange]
  );

  // Clear selection (memoized)
  const handleClearSelection = useCallback(() => {
    const emptySet = new Set<string>();
    if (onSelectionChange) {
      onSelectionChange(emptySet);
    } else {
      setInternalSelectedCardIds(emptySet);
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [onSelectionChange]);

  // Play selected cards (memoized)
  const handlePlay = useCallback(() => {
    if (selectedCardIds.size === 0) return;

    const selected = orderedCards.filter(card => selectedCardIds.has(card.id));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onPlayCards(selected);

    // Clear selection after playing
    const emptySet = new Set<string>();
    if (onSelectionChange) {
      onSelectionChange(emptySet);
    } else {
      setInternalSelectedCardIds(emptySet);
    }
  }, [selectedCardIds, orderedCards, onPlayCards, onSelectionChange]);

  // Pass turn (memoized)
  const handlePass = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPass();
    // Note: Keep selection intact after pass - user may want to adjust before playing
    // setSelectedCardIds(new Set()); // Removed per Copilot feedback
  }, [onPass]);

  // Handle drag start for rearranging or multi-card play
  const handleDragStart = useCallback(
    (cardId: string) => {
      // Check if dragging a selected card when multiple are selected
      const isMultiDrag = selectedCardIds.has(cardId) && selectedCardIds.size > 1;

      // Reset per-drag zone tracking refs
      lastSingleDragZoneRef.current = 'idle';
      lastTargetIndexRef.current = null;
      setDragState({
        draggedCardId: cardId,
        targetIndex: null,
        longPressedCardId: null,
        isDraggingMultiple: isMultiDrag,
        sharedTranslation: { x: 0, y: 0 },
      });
      // Haptic feedback handled in Card.tsx pan gesture to avoid duplication
    },
    [selectedCardIds]
  );

  // Handle long press - brings card to front temporarily
  const handleLongPress = useCallback((cardId: string) => {
    setDragState(prev => ({
      ...prev,
      longPressedCardId: cardId,
    }));

    // Clear long press state after animation completes (if not dragging)
    setTimeout(() => {
      setDragState(prev =>
        prev.longPressedCardId === cardId ? { ...prev, longPressedCardId: null } : prev
      );
    }, 300); // Match the spring animation duration
  }, []);

  // Handle drag update for rearranging or playing
  const handleDragUpdate = useCallback(
    (cardId: string, translationX: number, translationY: number) => {
      if (!dragState.draggedCardId || dragState.draggedCardId !== cardId) return;

      // If dragging multiple selected cards, update shared drag values for synchronized movement
      if (dragState.isDraggingMultiple) {
        setDragState(prev => ({
          ...prev,
          sharedTranslation: { x: translationX, y: translationY },
          targetIndex: null, // No rearranging when multi-dragging
        }));
        return;
      }

      // Track vertical translation for drop zone glow (even for single-card drags).
      // Only rearrange if dragging horizontally (not trying to play on table).
      const isHorizontalDrag = Math.abs(translationX) > Math.abs(translationY);
      if (!isHorizontalDrag) {
        // Only call setDragState when the drag crosses a zone boundary, not on every
        // gesture frame. sharedTranslation.y is only visually consumed by
        // isDraggingGroup cards (multi-drag), so single-card vertical drag can batch
        // state updates to zone-boundary crossings only (~2-3 per drag vs ~60/s).
        const newZone: 'idle' | 'approaching' | 'active' =
          translationY < DRAG_TO_PLAY_THRESHOLD
            ? 'active'
            : translationY < DRAG_APPROACH_THRESHOLD
              ? 'approaching'
              : 'idle';
        if (newZone !== lastSingleDragZoneRef.current || lastTargetIndexRef.current !== null) {
          lastSingleDragZoneRef.current = newZone;
          lastTargetIndexRef.current = null;
          setDragState(prev => ({
            ...prev,
            targetIndex: null,
            sharedTranslation: { x: translationX, y: translationY },
          }));
        }
        return;
      }

      // Horizontal drag: reset Y so drop-zone detection doesn't stay "stuck" if
      // the gesture transitioned from vertical (negative Y) to horizontal.
      const currentIndex = orderedCards.findIndex(c => c.id === cardId);
      if (currentIndex === -1) return;

      // Calculate which position the card should swap to based on drag distance
      const positionShift = Math.round(translationX / CARD_SPACING);
      const targetIndex = Math.max(
        0,
        Math.min(orderedCards.length - 1, currentIndex + positionShift)
      );
      const newTargetIndex = targetIndex !== currentIndex ? targetIndex : null;

      // Only update state when the target slot changes (not on every translationX update).
      // sharedTranslation.x is not consumed by single-card rendering; per-frame updates
      // caused all card components to re-render at gesture-frame rate.
      if (newTargetIndex !== lastTargetIndexRef.current) {
        lastTargetIndexRef.current = newTargetIndex;
        setDragState(prev => ({
          ...prev,
          targetIndex: newTargetIndex,
          sharedTranslation: { x: translationX, y: 0 },
        }));
      }
    },
    [dragState.draggedCardId, dragState.isDraggingMultiple, orderedCards, CARD_SPACING]
  );

  // Handle drag end for rearranging or playing
  const handleDragEnd = useCallback(
    (cardId: string, translationX: number, translationY: number) => {
      if (dragState.draggedCardId) {
        const isHorizontalDrag = Math.abs(translationX) > Math.abs(translationY);
        const isUpwardDrag = translationY < DRAG_TO_PLAY_THRESHOLD;

        // If dragging multiple selected cards and dragged upward, play them
        // Guard behind canPlay && !disabled so drag-to-play matches button UX
        if (canDragToPlay && dragState.isDraggingMultiple && isUpwardDrag) {
          const selected = orderedCards.filter(card => selectedCardIds.has(card.id));
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

          // Track optimistically removed cards so the sync effect doesn't re-add them
          for (const id of selectedCardIds) {
            optimisticallyRemovedRef.current.add(id);
          }

          // Immediately remove played cards from display so they don't flash back
          setDisplayCards(prev => prev.filter(c => !selectedCardIds.has(c.id)));
          scheduleOptimisticRollback();

          onPlayCards(selected);

          // Clear selection after playing
          const emptySet = new Set<string>();
          if (onSelectionChange) {
            onSelectionChange(emptySet);
          } else {
            setInternalSelectedCardIds(emptySet);
          }
        }
        // If dragged upward significantly (single card), treat as play attempt
        else if (
          canDragToPlay &&
          isUpwardDrag &&
          !isHorizontalDrag &&
          !dragState.isDraggingMultiple
        ) {
          // Play just this card
          const card = orderedCards.find(c => c.id === cardId);
          if (card) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
              () => {}
            );

            // Track optimistically removed card
            optimisticallyRemovedRef.current.add(cardId);

            // Immediately remove played card from display so it doesn't flash back
            setDisplayCards(prev => prev.filter(c => c.id !== cardId));
            scheduleOptimisticRollback();

            onPlayCards([card]);
          }
        } else if (
          isHorizontalDrag &&
          dragState.targetIndex !== null &&
          !dragState.isDraggingMultiple
        ) {
          // Horizontal drag = rearrange (only for single card) - NOW apply the position change
          const currentIndex = orderedCards.findIndex(c => c.id === cardId);
          if (currentIndex !== -1 && dragState.targetIndex !== currentIndex) {
            const newCards = [...orderedCards];
            const [draggedCard] = newCards.splice(currentIndex, 1);
            newCards.splice(dragState.targetIndex, 0, draggedCard);
            setDisplayCards(newCards);

            if (onCardsReorder && newCards.length > 0) {
              trackEvent('card_rearranged', {
                hand_size: newCards.length,
                hand_before: JSON.stringify(orderedCards.map(c => c.id)).slice(0, 200),
                hand_after: JSON.stringify(newCards.map(c => c.id)).slice(0, 200),
              });
              onCardsReorder(newCards);
            }
          }
        }

        // Reset all drag state
        setDragState(initialDragState);
      }
    },
    [
      canDragToPlay,
      dragState,
      orderedCards,
      selectedCardIds,
      onPlayCards,
      onSelectionChange,
      onCardsReorder,
      scheduleOptimisticRollback,
    ]
  );

  // Card display order is managed by the parent (e.g., via customCardOrder) or user rearrangement.
  // Future enhancement: Allow user to choose different sort options (e.g., by rank/suit).

  return (
    <SafeAreaView edges={['bottom']} style={styles.container}>
      {/* Card display area with orientation-aware spacing */}
      <View
        style={[
          styles.cardsWrapper,
          {
            paddingHorizontal: isLandscape ? LANDSCAPE_PADDING : PORTRAIT_PADDING,
            marginLeft: isLandscape ? LANDSCAPE_MARGIN_LEFT : PORTRAIT_MARGIN_LEFT,
          },
        ]}
      >
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
              {/* Drop zone indicator for rearranging cards */}
              {isTargetPosition && <View style={styles.dropZoneIndicator} />}
              <Card
                card={card}
                isSelected={isThisCardSelected}
                onToggleSelect={handleToggleSelect}
                onDragStart={() => handleDragStart(card.id)}
                onDragUpdate={(translationX, translationY) =>
                  handleDragUpdate(card.id, translationX, translationY)
                }
                onDragEnd={(translationX, translationY) =>
                  handleDragEnd(card.id, translationX, translationY)
                }
                onLongPress={() => handleLongPress(card.id)}
                disabled={disabled}
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
                cardOverlap={isLandscape ? LANDSCAPE_CARD_OVERLAP : PORTRAIT_CARD_OVERLAP}
              />
            </React.Fragment>
          );
        })}
      </View>

      {/* Action buttons - only show if not hidden */}
      {!hideButtons && (
        <View style={styles.actionsContainer}>
          {/* Selection info */}
          {selectedCardIds.size > 0 && (
            <Pressable
              style={styles.clearButton}
              onPress={handleClearSelection}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${selectedCardIds.size} selected card${selectedCardIds.size !== 1 ? 's' : ''}`}
            >
              <Text style={styles.clearButtonText}>Clear ({selectedCardIds.size})</Text>
            </Pressable>
          )}

          {/* Main actions */}
          <View style={styles.mainActions}>
            <Pressable
              testID="pass-button"
              style={[styles.button, styles.passButton, !canPlay && styles.buttonDisabled]}
              onPress={handlePass}
              disabled={!canPlay || disabled}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Pass turn"
              accessibilityState={{ disabled: !canPlay || disabled }}
            >
              <Text style={[styles.buttonText, styles.passButtonText]}>Pass</Text>
            </Pressable>

            <Pressable
              style={[
                styles.button,
                styles.playButton,
                (selectedCardIds.size === 0 || !canPlay || disabled) && styles.buttonDisabled,
              ]}
              onPress={handlePlay}
              disabled={selectedCardIds.size === 0 || !canPlay || disabled}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Play ${selectedCardIds.size} selected card${selectedCardIds.size !== 1 ? 's' : ''}`}
              accessibilityState={{ disabled: selectedCardIds.size === 0 || !canPlay || disabled }}
              testID="play-button"
            >
              <Text style={styles.buttonText}>
                Play {selectedCardIds.size > 0 ? `(${selectedCardIds.size})` : ''}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.primary,
  },
  cardsWrapper: {
    flexDirection: 'row',
    // Padding and marginLeft are dynamic - set via inline style based on orientation
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsContainer: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  // Reserved for future sort options feature (Task #266+)
  clearButton: {
    alignSelf: 'flex-start',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.gray.medium,
    borderRadius: 8,
  },
  clearButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  mainActions: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  button: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Drop zone visual feedback styles (card-reorder indicator only)
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
  playButton: {
    backgroundColor: COLORS.accent,
  },
  passButton: {
    backgroundColor: COLORS.gray.dark,
    borderWidth: 1,
    borderColor: COLORS.gray.medium,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  passButtonText: {
    color: COLORS.gray.light,
  },
});

const CardHandMemo = React.memo(CardHandComponent);

// P8-6 FIX: DEV-only Profiler wrapper — surfaces render timing in React
// DevTools / Flipper without any overhead in production builds.
export default __DEV__
  ? function CardHandProfiled(props: React.ComponentProps<typeof CardHandMemo>) {
      return (
        <React.Profiler id="CardHand" onRender={() => {}}>
          <CardHandMemo {...props} />
        </React.Profiler>
      );
    }
  : CardHandMemo;
