import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Card from './Card';
import { sortHand } from '../../game/engine/game-logic';
import type { Card as CardType } from '../../game/types';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';

// Removed CARD_HAND_MAX_HEIGHT - cards fit without scrolling on most devices
// With 13 cards: 60px + (12 × 20px overlap) = 300px total width
// If needed for very small screens, could add conditional ScrollView

// Card spacing for drag rearrangement calculation
// Each card takes up about 20px due to overlap (60px width - 40px overlap)
const CARD_SPACING = 20;

// Drag threshold for playing cards (matches Card.tsx DRAG_TO_PLAY_THRESHOLD)
const DRAG_TO_PLAY_THRESHOLD = -80;

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

export default function CardHand({
  cards,
  onPlayCards,
  onPass,
  canPlay = true,
  disabled = false,
  hideButtons = false,
  selectedCardIds: externalSelectedCardIds,
  onSelectionChange,
  onCardsReorder,
}: CardHandProps) {
  // Consolidated state: selection
  const [internalSelectedCardIds, setInternalSelectedCardIds] = useState<Set<string>>(new Set());
  
  // Consolidated state: drag operations
  const [dragState, setDragState] = useState<DragState>(initialDragState);
  
  // Separate state: display cards (managed independently)
  const [displayCards, setDisplayCards] = useState<CardType[]>(cards);
  
  // Selection state: If external state is provided, use it; otherwise use internal state.
  // The setter pattern (const setSelectedCardIds = onSelectionChange ?? setInternalSelectedCardIds)
  // was intentionally removed because:
  // 1. Better type safety: TypeScript can't infer correct types for conditional setter assignment
  // 2. Clearer intent: Explicit checks make it obvious when using lifted vs internal state
  // 3. Avoids re-renders: Conditional setter reference changes on every render when onSelectionChange changes
  // All selection updates use explicit checks for onSelectionChange (see handleToggleSelect, handleClearSelection, etc.)
  const selectedCardIds = externalSelectedCardIds ?? internalSelectedCardIds;
  
  // Update display cards when prop cards change
  React.useEffect(() => {
    // Reset all drag state when cards change
    setDragState(initialDragState);
    // Always update displayCards to match cards prop
    setDisplayCards(cards);
  }, [cards]);

  // Use displayCards directly. The parent manages the order via the cards prop (e.g., customCardOrder),
  // but CardHand also manages displayCards locally during drag-and-drop operations.
  const orderedCards = displayCards;

  // Toggle card selection (memoized to prevent card re-renders)
  const handleToggleSelect = useCallback((cardId: string) => {
    if (disabled) return;

    const updateSelection = (prev: Set<string>) => {
      const newSet = new Set(prev);
      const wasSelected = newSet.has(cardId);
      
      if (wasSelected) {
        newSet.delete(cardId);
        // Light haptic for deselection
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        newSet.add(cardId);
        // Medium haptic for selection (more pronounced feedback)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
  }, [disabled, selectedCardIds, onSelectionChange]);

  // Clear selection (memoized)
  const handleClearSelection = useCallback(() => {
    const emptySet = new Set<string>();
    if (onSelectionChange) {
      onSelectionChange(emptySet);
    } else {
      setInternalSelectedCardIds(emptySet);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [onSelectionChange]);

  // Play selected cards (memoized)
  const handlePlay = useCallback(() => {
    if (selectedCardIds.size === 0) return;

    const selected = orderedCards.filter((card) => selectedCardIds.has(card.id));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPass();
    // Note: Keep selection intact after pass - user may want to adjust before playing
    // setSelectedCardIds(new Set()); // Removed per Copilot feedback
  }, [onPass]);

  // Handle drag start for rearranging or multi-card play
  const handleDragStart = useCallback((cardId: string) => {
    // Check if dragging a selected card when multiple are selected
    const isMultiDrag = selectedCardIds.has(cardId) && selectedCardIds.size > 1;
    
    setDragState({
      draggedCardId: cardId,
      targetIndex: null,
      longPressedCardId: null,
      isDraggingMultiple: isMultiDrag,
      sharedTranslation: { x: 0, y: 0 },
    });
    // Haptic feedback handled in Card.tsx pan gesture to avoid duplication
  }, [selectedCardIds]);

  // Handle long press - brings card to front temporarily
  const handleLongPress = useCallback((cardId: string) => {
    setDragState(prev => ({
      ...prev,
      longPressedCardId: cardId,
    }));
    
    // Clear long press state after animation completes (if not dragging)
    setTimeout(() => {
      setDragState(prev => 
        prev.longPressedCardId === cardId 
          ? { ...prev, longPressedCardId: null } 
          : prev
      );
    }, 300); // Match the spring animation duration
  }, []);

  // Handle drag update for rearranging or playing
  const handleDragUpdate = useCallback((cardId: string, translationX: number, translationY: number) => {
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
    
    // Only rearrange if dragging horizontally (not trying to play on table)
    const isHorizontalDrag = Math.abs(translationX) > Math.abs(translationY);
    if (!isHorizontalDrag) {
      setDragState(prev => ({ ...prev, targetIndex: null }));
      return;
    }
    
    const currentIndex = orderedCards.findIndex(c => c.id === cardId);
    if (currentIndex === -1) return;
    
    // Calculate which position the card should swap to based on drag distance
    const positionShift = Math.round(translationX / CARD_SPACING);
    const targetIndex = Math.max(0, Math.min(orderedCards.length - 1, currentIndex + positionShift));
    
    // Only store the target index, don't actually move the card yet
    if (targetIndex !== currentIndex) {
      setDragState(prev => ({ ...prev, targetIndex }));
    } else {
      setDragState(prev => ({ ...prev, targetIndex: null }));
    }
  }, [dragState.draggedCardId, dragState.isDraggingMultiple, orderedCards]);

  // Handle drag end for rearranging or playing
  const handleDragEnd = useCallback((cardId: string, translationX: number, translationY: number) => {
    if (dragState.draggedCardId) {
      const isHorizontalDrag = Math.abs(translationX) > Math.abs(translationY);
      const isUpwardDrag = translationY < DRAG_TO_PLAY_THRESHOLD;
      
      // If dragging multiple selected cards and dragged upward, play them
      if (dragState.isDraggingMultiple && isUpwardDrag) {
        const selected = orderedCards.filter((card) => selectedCardIds.has(card.id));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      else if (isUpwardDrag && !isHorizontalDrag && !dragState.isDraggingMultiple) {
        // Play just this card
        const card = orderedCards.find(c => c.id === cardId);
        if (card) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onPlayCards([card]);
        }
      } else if (isHorizontalDrag && dragState.targetIndex !== null && !dragState.isDraggingMultiple) {
        // Horizontal drag = rearrange (only for single card) - NOW apply the position change
        const currentIndex = orderedCards.findIndex(c => c.id === cardId);
        if (currentIndex !== -1 && dragState.targetIndex !== currentIndex) {
          const newCards = [...orderedCards];
          const [draggedCard] = newCards.splice(currentIndex, 1);
          newCards.splice(dragState.targetIndex, 0, draggedCard);
          setDisplayCards(newCards);
          
          if (onCardsReorder && newCards.length > 0) {
            onCardsReorder(newCards);
          }
        }
      }
      
      // Reset all drag state
      setDragState(initialDragState);
    }
  }, [dragState, orderedCards, selectedCardIds, onPlayCards, onSelectionChange, onCardsReorder]);

  // Card display order is managed by the parent (e.g., via customCardOrder) or user rearrangement.
  // Future enhancement: Allow user to choose different sort options (e.g., by rank/suit).

  return (
    <SafeAreaView edges={['bottom']} style={styles.container}>
      {/* Card display area with horizontal scroll for small screens */}
      <View style={styles.cardsWrapper}>
        {orderedCards.map((card, index) => {
          const isThisCardSelected = selectedCardIds.has(card.id);
          const hasMultipleSelected = selectedCardIds.size > 1;
          const isDraggingThisGroup = dragState.isDraggingMultiple && isThisCardSelected;
          
          return (
            <Card
              key={card.id}
              card={card}
              isSelected={isThisCardSelected}
              onToggleSelect={handleToggleSelect}
              onDragStart={() => handleDragStart(card.id)}
              onDragUpdate={(translationX, translationY) => handleDragUpdate(card.id, translationX, translationY)}
              onDragEnd={(translationX, translationY) => handleDragEnd(card.id, translationX, translationY)}
              onLongPress={() => handleLongPress(card.id)}
              disabled={disabled}
              zIndex={dragState.draggedCardId === card.id ? 3000 : (dragState.longPressedCardId === card.id ? 2000 : index + 1)}
              hasMultipleSelected={hasMultipleSelected && isThisCardSelected}
              isDraggingGroup={isDraggingThisGroup}
              sharedDragX={dragState.sharedTranslation.x}
              sharedDragY={dragState.sharedTranslation.y}
            />
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
              <Text style={styles.clearButtonText}>
                Clear ({selectedCardIds.size})
              </Text>
            </Pressable>
          )}

          {/* Main actions */}
          <View style={styles.mainActions}>
            <Pressable
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
                (selectedCardIds.size === 0 || !canPlay || disabled) &&
                  styles.buttonDisabled,
              ]}
              onPress={handlePlay}
              disabled={selectedCardIds.size === 0 || !canPlay || disabled}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Play ${selectedCardIds.size} selected card${selectedCardIds.size !== 1 ? 's' : ''}`}
              accessibilityState={{ disabled: selectedCardIds.size === 0 || !canPlay || disabled }}
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
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center', // Center the cards horizontally
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
