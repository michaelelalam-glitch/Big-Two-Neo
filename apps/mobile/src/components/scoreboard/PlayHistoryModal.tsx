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

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { PlayHistoryModalProps } from '../../types/scoreboard';
import { HandCard } from './components/HandCard';
import { usePlayHistoryModalStyles } from './hooks/useResponsiveStyles';

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
  
  // Separate past and current matches
  const pastMatches = playHistory.filter((m) => m.matchNumber < currentMatch);
  const currentMatchData = playHistory.find((m) => m.matchNumber === currentMatch);

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      {/* Overlay */}
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        {/* Modal Container (prevent close on tap) - using View wrapper instead of stopPropagation */}
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

          {/* Content */}
          <ScrollView
            style={styles.modalContent}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
          >
            {/* Current Match (Always Expanded) */}
            {currentMatchData && currentMatchData.hands.length > 0 && (
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
                  {currentMatchData.hands.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyStateText}>
                        No plays yet this match
                      </Text>
                    </View>
                  ) : (
                    currentMatchData.hands.map((hand, index) => {
                      const isLatest = index === currentMatchData.hands.length - 1;
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
            )}

            {/* Past Matches (Collapsible) */}
            {pastMatches.length > 0 && (
              <>
                <View style={styles.divider} />
                <Text style={[styles.tableCellLabel, { marginBottom: 8 }]}>
                  Past Matches (tap to expand)
                </Text>
              </>
            )}

            {pastMatches
              .sort((a, b) => b.matchNumber - a.matchNumber) // Newest first
              .map((match) => {
                const isCollapsed = collapsedMatches.has(match.matchNumber);
                
                return (
                  <View key={`match-${match.matchNumber}`} style={styles.matchCard}>
                    {/* Match Header (Touchable) */}
                    <TouchableOpacity
                      style={styles.matchCardHeader}
                      onPress={() => onToggleMatch(match.matchNumber)}
                      activeOpacity={0.7}
                      accessibilityLabel={`${isCollapsed ? 'Expand' : 'Collapse'} match ${match.matchNumber}`}
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
                          match.hands.map((hand, index) => {
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
              })}

            {/* Empty State */}
            {playHistory.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>
                  No play history yet. Start playing to see card history!
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

export default PlayHistoryModal;
