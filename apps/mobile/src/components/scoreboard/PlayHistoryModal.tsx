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
import { scoreboardStyles } from './styles/scoreboard.styles';
import { PlayHistoryModalProps } from '../../types/scoreboard';
import { HandCard } from './components/HandCard';

export const PlayHistoryModal: React.FC<PlayHistoryModalProps> = ({
  visible,
  playerNames,
  playHistory,
  currentMatch,
  collapsedMatches,
  onClose,
  onToggleMatch,
}) => {
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
        style={scoreboardStyles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        {/* Modal Container (prevent close on tap) - using View wrapper instead of stopPropagation */}
        <View style={scoreboardStyles.modalContainer}>
          {/* Header */}
          <View style={scoreboardStyles.modalHeader}>
            <Text style={scoreboardStyles.modalTitle}>📜 Play History</Text>
            
            <TouchableOpacity
              style={scoreboardStyles.modalCloseButton}
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityLabel="Close play history"
              accessibilityRole="button"
            >
              <Text style={scoreboardStyles.modalCloseButtonText}>✕ Close</Text>
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView
            style={scoreboardStyles.modalContent}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
          >
            {/* Current Match (Always Expanded) */}
            {currentMatchData && currentMatchData.hands.length > 0 && (
              <View style={[scoreboardStyles.matchCard, scoreboardStyles.matchCardCurrent]}>
                {/* Match Header */}
                <View style={scoreboardStyles.matchCardHeader}>
                  <Text style={scoreboardStyles.matchCardTitle}>
                    🎯 Match {currentMatch} (Current)
                  </Text>
                  <Text style={scoreboardStyles.matchCardIcon}>▼</Text>
                </View>

                {/* Hands */}
                <View style={scoreboardStyles.matchCardContent}>
                  {currentMatchData.hands.length === 0 ? (
                    <View style={scoreboardStyles.emptyState}>
                      <Text style={scoreboardStyles.emptyStateText}>
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
                <View style={scoreboardStyles.divider} />
                <Text style={[scoreboardStyles.tableCellLabel, { marginBottom: 8 }]}>
                  Past Matches (tap to expand)
                </Text>
              </>
            )}

            {pastMatches
              .sort((a, b) => b.matchNumber - a.matchNumber) // Newest first
              .map((match) => {
                const isCollapsed = collapsedMatches.has(match.matchNumber);
                
                return (
                  <View key={`match-${match.matchNumber}`} style={scoreboardStyles.matchCard}>
                    {/* Match Header (Touchable) */}
                    <TouchableOpacity
                      style={scoreboardStyles.matchCardHeader}
                      onPress={() => onToggleMatch(match.matchNumber)}
                      activeOpacity={0.7}
                      accessibilityLabel={`${isCollapsed ? 'Expand' : 'Collapse'} match ${match.matchNumber}`}
                      accessibilityRole="button"
                    >
                      <View style={scoreboardStyles.matchCardHeaderTouchable}>
                        <Text style={scoreboardStyles.matchCardTitle}>
                          Match {match.matchNumber}
                        </Text>
                        <Text style={scoreboardStyles.matchCardIcon}>
                          {isCollapsed ? '▶' : '▼'}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Hands (Collapsible) */}
                    {!isCollapsed && (
                      <View style={scoreboardStyles.matchCardContent}>
                        {match.hands.length === 0 ? (
                          <View style={scoreboardStyles.emptyState}>
                            <Text style={scoreboardStyles.emptyStateText}>
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
              <View style={scoreboardStyles.emptyState}>
                <Text style={scoreboardStyles.emptyStateText}>
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
