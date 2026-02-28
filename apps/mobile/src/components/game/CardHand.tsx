import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, Text, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from './Card';
import { COLORS, SPACING, FONT_SIZES, LAYOUT } from '../../constants';
import type { Card as CardType } from '../../game/types';

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
  // Detect orientation for responsive card spacing
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  
  // Select spacing based on orientation
  const CARD_SPACING = isLandscape ? LANDSCAPE_CARD_SPACING : PORTRAIT_CARD_SPACING;
  
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
    // CRITICAL FIX: Only update if cards actually changed (not just reordered)
    // Compare card IDs to detect if it's the same set of cards
    const currentIds = new Set(displayCards.map(c => c.id));
    const newIds = new Set(cards.map(c => c.id));
    
    // Check if it's the same set of cards (just potentially reordered)
    const sameCardSet = currentIds.size === newIds.size && 
                        [...currentIds].every(id => newIds.has(id));
    
    if (!sameCardSet) {
      // Cards actually changed (added/removed) - reset drag state and update display
      setDragState(initialDragState);
      setDisplayCards(cards);
    } else {
      // Same cards, potentially reordered by parent (via customCardOrder)
      // Check if the parent order is different from current display order
      const orderChanged = cards.some((card, index) => {
        return displayCards[index]?.id !== card.id;
      });
      
      if (orderChanged || displayCards.length === 0) {
        // Parent changed the order (via customCardOrder) OR initial load
        // Update displayCards to match parent's order
        setDisplayCards(cards);
      }
    }
  }, [cards, displayCards]);

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
  }, [dragState.draggedCardId, dragState.isDraggingMultiple, orderedCards, CARD_SPACING]);

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
      {/* Card display area with orientation-aware spacing */}
      <View style={[
        styles.cardsWrapper, 
        { 
          paddingHorizontal: isLandscape ? LANDSCAPE_PADDING : PORTRAIT_PADDING,
          marginLeft: isLandscape ? LANDSCAPE_MARGIN_LEFT : PORTRAIT_MARGIN_LEFT,
        }
      ]}>
        {/* Drop zone indicator when dragging upward to play */}
        {dragState.draggedCardId && dragState.sharedTranslation.y < DRAG_TO_PLAY_THRESHOLD && (
          <View style={styles.playDropZone}>
            <Text style={styles.playDropZoneText}>
              {dragState.isDraggingMultiple 
                ? `Release to play ${selectedCardIds.size} cards` 
                : 'Release to play card'}
            </Text>
          </View>
        )}
        
        {orderedCards.map((card, index) => {
          const isThisCardSelected = selectedCardIds.has(card.id);
          const hasMultipleSelected = selectedCardIds.size > 1;
          const isDraggingThisGroup = dragState.isDraggingMultiple && isThisCardSelected;
          const isTargetPosition = dragState.targetIndex === index && 
                                  dragState.draggedCardId !== card.id &&
                                  !dragState.isDraggingMultiple;
          
          return (
            <React.Fragment key={card.id}>
              {/* Drop zone indicator for rearranging cards */}
              {isTargetPosition && (
                <View style={styles.dropZoneIndicator} />
              )}
              <Card
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
  // Drop zone visual feedback styles
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
    left: 0,
    right: 0,
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
