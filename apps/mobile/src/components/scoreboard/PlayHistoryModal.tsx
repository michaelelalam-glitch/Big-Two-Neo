/**
 * PlayHistoryModal Component
 * 
 * Modal overlay displaying card-by-card play history
 * Features:
 * - Modal overlay positioned centrally
 * - Past matches collapsed by default (tap to expand)
 * - Current match always expanded
 * - Each hand shows: player name, combo type, card images
 * - Latest hand in current match highlighted
 * - Smooth animations for expand/collapse
 * - Close button
 * 
 * Created as part of Task #347: PlayHistoryModal component
 * Date: December 12, 2025
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList, Modal } from 'react-native';
import { PlayHistoryModalProps, PlayHistoryMatch, PlayHistoryHand } from '../../types/scoreboard';
import HandCard from './components/HandCard';
import { usePlayHistoryModalStyles } from './hooks/useResponsiveStyles';

// Type for FlatList items (header, current match, past matches)
type ListItem = 
  | { type: 'current'; data: PlayHistoryMatch }
  | { type: 'divider' }
  | { type: 'pastHeader' }
  | { type: 'pastMatch'; data: PlayHistoryMatch; matchNumber: number };

// Static content container style
const CONTENT_CONTAINER_STYLE = { paddingBottom: 20 };

export const PlayHistoryModal: React.FC<PlayHistoryModalProps> = ({
  visible,
  playerNames,
  playHistory,
  currentMatch,
  collapsedMatches,
  onClose,
  onToggleMatch,
}) => {
  // Use responsive styles
  const styles = usePlayHistoryModalStyles();
  
  // Separate past and current matches (sorted once)
  const pastMatches = useMemo(() => {
    return playHistory
      .filter((m) => m.matchNumber < currentMatch)
      .sort((a, b) => b.matchNumber - a.matchNumber); // Newest first
  }, [playHistory, currentMatch]);
  
  const currentMatchData = playHistory.find((m) => m.matchNumber === currentMatch);

  // Build flat list data (memoized for performance)
  const listData = useMemo(() => {
    const items: ListItem[] = [];
    
    // Current match
    if (currentMatchData) {
      items.push({ type: 'current', data: currentMatchData });
    }
    
    // Divider and past header if there are past matches
    if (pastMatches.length > 0) {
      items.push({ type: 'divider' });
      items.push({ type: 'pastHeader' });
      
      // Add past matches (already sorted)
      pastMatches.forEach((match) => {
        items.push({ type: 'pastMatch', data: match, matchNumber: match.matchNumber });
      });
    }
    
    return items;
  }, [currentMatchData, pastMatches]);
  
  // Key extractor
  const keyExtractor = useCallback((item: ListItem, index: number) => {
    if (item.type === 'current') return 'current-match';
    if (item.type === 'divider') return 'divider';
    if (item.type === 'pastHeader') return 'past-header';
    if (item.type === 'pastMatch') return `match-${item.matchNumber}`;
    return `item-${index}`;
  }, []);
  
  // Render item (memoized)
  const renderItem = useCallback(({ item }: { item: ListItem }) => {
    if (item.type === 'current') {
      return (
        <View style={[styles.matchCard, styles.matchCardCurrent]}>
          {/* Match Header */}
          <View style={styles.matchCardHeader}>
            <Text style={styles.matchCardTitle}>
              🎯 Match {currentMatch} (Current)
            </Text>
            <Text style={styles.matchCardIcon}>▼</Text>
          </View>

          {/* Hands */}
          <View style={styles.matchCardContent}>
            {item.data.hands.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>
                  🃏 No cards played yet this match
                </Text>
                <Text style={styles.emptyStateTextSmall}>
                  Cards will appear here after each play
                </Text>
              </View>
            ) : (
              item.data.hands.map((hand: PlayHistoryHand, index: number) => {
                const isLatest = index === item.data.hands.length - 1;
                const playerName = playerNames[hand.by] || `Player ${hand.by + 1}`;
                
                return (
                  <HandCard
                    key={`current-hand-${index}`}
                    hand={hand}
                    playerName={playerName}
                    isLatest={isLatest}
                    isCurrentMatch={true}
                  />
                );
              })
            )}
          </View>
        </View>
      );
    }
    
    if (item.type === 'divider') {
      return <View style={styles.divider} />;
    }
    
    if (item.type === 'pastHeader') {
      return (
        <Text style={styles.pastMatchesHeaderText}>
          Past Matches (tap to expand)
        </Text>
      );
    }
    
    if (item.type === 'pastMatch') {
      const match = item.data;
      const isCollapsed = collapsedMatches.has(match.matchNumber);
      
      return (
        <View style={styles.matchCard}>
          {/* Match Header (Touchable) */}
          <TouchableOpacity
            style={styles.matchCardHeader}
            onPress={() => onToggleMatch(match.matchNumber)}
            activeOpacity={0.7}
            accessibilityLabel={`${isCollapsed ? 'Expand' : 'Collapse'} match ${match.matchNumber}`}
            accessibilityHint={`${isCollapsed ? 'Show' : 'Hide'} card plays for this match`}
            accessibilityRole="button"
          >
            <View style={styles.matchCardHeaderTouchable}>
              <Text style={styles.matchCardTitle}>
                Match {match.matchNumber}
              </Text>
              <Text style={styles.matchCardIcon}>
                {isCollapsed ? '▶' : '▼'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Hands (Collapsible) */}
          {!isCollapsed && (
            <View style={styles.matchCardContent}>
              {match.hands.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateText}>
                    No plays recorded
                  </Text>
                </View>
              ) : (
                match.hands.map((hand: PlayHistoryHand, index: number) => {
                  const playerName = playerNames[hand.by] || `Player ${hand.by + 1}`;
                  
                  return (
                    <HandCard
                      key={`match-${match.matchNumber}-hand-${index}`}
                      hand={hand}
                      playerName={playerName}
                      isLatest={false}
                      isCurrentMatch={false}
                    />
                  );
                })
              )}
            </View>
          )}
        </View>
      );
    }
    
    return null;
  }, [currentMatch, playerNames, collapsedMatches, onToggleMatch, styles]);

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      {/* Overlay */}
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        
        {/* Modal Container (prevent close on tap) */}
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📜 Play History</Text>
            
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityLabel="Close play history"
              accessibilityRole="button"
            >
              <Text style={styles.modalCloseButtonText}>✕ Close</Text>
            </TouchableOpacity>
          </View>

          {/* Content - Optimized FlatList */}
          {playHistory.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                No play history yet. Start playing to see card history!
              </Text>
            </View>
          ) : (
            <FlatList
              data={listData}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              style={styles.modalContent}
              contentContainerStyle={CONTENT_CONTAINER_STYLE}
              showsVerticalScrollIndicator={true}
              // Performance optimizations
              windowSize={5} // Reduce from default 21 to save memory
              removeClippedSubviews={true} // Detach offscreen views
              maxToRenderPerBatch={5} // Reduce from default 10
              initialNumToRender={10} // Cover initial viewport
              updateCellsBatchingPeriod={50} // Default batch delay
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

export default PlayHistoryModal;
