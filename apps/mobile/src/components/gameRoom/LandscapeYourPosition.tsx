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

import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import Card from '../game/Card';
import type { Card as CardType } from '../../game/types';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';
import { i18n } from '../../i18n';
import { gameLogger } from '../../utils/logger';

// ============================================================================
// CONSTANTS
// ============================================================================

const CARD_OVERLAP_MARGIN = -30; // Same as portrait mode
const CARD_SPACING = 40; // For drag calculations
const DRAG_TO_PLAY_THRESHOLD = -80; // Drag up to play

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
  playerName,
  cards,
  selectedCardIds,
  onSelectionChange,
  isActive,
  disabled = false,
  onPlayCards,
  onCardsReorder,
}: LandscapeYourPositionProps) {
  
  // Drag state (matches portrait CardHand)
  const [dragState, setDragState] = useState<DragState>(initialDragState);
  const [displayCards, setDisplayCards] = useState<CardType[]>(cards);
  
  // Update display cards ONLY when cards are added/removed OR parent explicitly reorders
  // CRITICAL: Do NOT auto-reorder during play/pass/button presses
  React.useEffect(() => {
    const currentIds = new Set(displayCards.map(c => c.id));
    const newIds = new Set(cards.map(c => c.id));
    
    // Check if cards actually changed (not just reordered)
    const sameCardSet = currentIds.size === newIds.size && 
                        [...currentIds].every(id => newIds.has(id));
    
    if (!sameCardSet) {
      // Cards were added or removed (play/pass action) - update display
      // But preserve the relative order of remaining cards
      const remainingCards = displayCards.filter(c => newIds.has(c.id));
      const newCards = cards.filter(c => !currentIds.has(c.id));
      
      // Combine: keep user's custom order for existing cards, append new cards
      setDisplayCards([...remainingCards, ...newCards]);
      setDragState(initialDragState);
    }
    // CRITICAL FIX (Issue #1): ALWAYS initialize displayCards if empty OR if cards exist but displayCards doesn't match
    // This fixes drag-drop not working on first game load in landscape mode
    else if (displayCards.length === 0) {
      setDisplayCards(cards);
    }
    // CRITICAL FIX (Issue #2): If same card set but different order, AND user didn't manually rearrange,
    // update to match parent's order (this allows helper buttons to work)
    else if (sameCardSet && displayCards.length > 0) {
      // Check if order actually changed
      const orderChanged = !displayCards.every((card, idx) => card.id === cards[idx]?.id);
      // Only update if NOT currently dragging (preserve user's manual rearrangement)
      if (orderChanged && !dragState.draggedCardId) {
        gameLogger.info('🔄 [LandscapeYourPosition] Parent reordered cards (helper button), updating display');
        setDisplayCards(cards);
      }
    }
  }, [cards, displayCards, dragState.draggedCardId]);

  const orderedCards = displayCards;

  // Toggle card selection (matches portrait)
  const handleToggleSelect = useCallback((cardId: string) => {
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
  }, [disabled, selectedCardIds, onSelectionChange]);

  // Handle drag start
  const handleDragStart = useCallback((cardId: string) => {
    const isMultiDrag = selectedCardIds.has(cardId) && selectedCardIds.size > 1;
    setDragState({
      draggedCardId: cardId,
      targetIndex: null,
      longPressedCardId: null,
      isDraggingMultiple: isMultiDrag,
      sharedTranslation: { x: 0, y: 0 },
    });
  }, [selectedCardIds]);

  // Handle long press
  const handleLongPress = useCallback((cardId: string) => {
    setDragState(prev => ({ ...prev, longPressedCardId: cardId }));
    setTimeout(() => {
      setDragState(prev => 
        prev.longPressedCardId === cardId 
          ? { ...prev, longPressedCardId: null } 
          : prev
      );
    }, 300);
  }, []);

  // Handle drag update
  const handleDragUpdate = useCallback((cardId: string, translationX: number, translationY: number) => {
    if (!dragState.draggedCardId || dragState.draggedCardId !== cardId) return;
    
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
      setDragState(prev => ({ ...prev, targetIndex: null }));
      return;
    }
    
    const currentIndex = orderedCards.findIndex(c => c.id === cardId);
    if (currentIndex === -1) return;
    
    const positionShift = Math.round(translationX / CARD_SPACING);
    const targetIndex = Math.max(0, Math.min(orderedCards.length - 1, currentIndex + positionShift));
    
    if (targetIndex !== currentIndex) {
      setDragState(prev => ({ ...prev, targetIndex }));
    } else {
      setDragState(prev => ({ ...prev, targetIndex: null }));
    }
  }, [dragState.draggedCardId, dragState.isDraggingMultiple, orderedCards]);

  // Handle drag end
  const handleDragEnd = useCallback((cardId: string, translationX: number, translationY: number) => {
    if (dragState.draggedCardId) {
      const isHorizontalDrag = Math.abs(translationX) > Math.abs(translationY);
      const isUpwardDrag = translationY < DRAG_TO_PLAY_THRESHOLD;
      
      // Multi-drag upward = play all selected
      if (dragState.isDraggingMultiple && isUpwardDrag && onPlayCards) {
        const selected = orderedCards.filter((card) => selectedCardIds.has(card.id));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onPlayCards(selected);
        onSelectionChange(new Set());
      }
      // Single drag upward = play this card
      else if (isUpwardDrag && !isHorizontalDrag && !dragState.isDraggingMultiple && onPlayCards) {
        const card = orderedCards.find(c => c.id === cardId);
        if (card) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onPlayCards([card]);
        }
      }
      // Horizontal drag = rearrange
      else if (isHorizontalDrag && dragState.targetIndex !== null && !dragState.isDraggingMultiple) {
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
  }, [dragState, orderedCards, selectedCardIds, onPlayCards, onSelectionChange, onCardsReorder]);

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
          const isTargetPosition = dragState.targetIndex === index && 
                                  dragState.draggedCardId !== card.id &&
                                  !dragState.isDraggingMultiple;
          
          return (
            <React.Fragment key={card.id}>
              {/* Drop zone indicator for rearranging */}
              {isTargetPosition && (
                <View style={styles.dropZoneIndicator} />
              )}
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
                zIndex={dragState.draggedCardId === card.id ? 3000 : (dragState.longPressedCardId === card.id ? 2000 : index + 1)}
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
    zIndex: 150, // CRITICAL: Higher than buttons to enable drag/drop
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
