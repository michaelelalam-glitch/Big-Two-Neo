/**
 * GameEndModal - Main modal container for Game End feature
 * 
 * Features:
 * - Semi-transparent backdrop overlay
 * - Gradient background container
 * - Winner announcement with pulsing animation
 * - Final standings with medal emojis and color coding
 * - Tab interface (Score History / Play History)
 * - Action buttons (Share, Play Again, Return to Menu)
 * - Responsive sizing and safe area handling
 * - Fireworks celebration animation
 * 
 * Created as part of Tasks #406-414: Phase 2 Core Components
 * Date: December 16, 2025
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Animated,
  StyleSheet,
  Dimensions,
  Platform,
  Share,
  Alert,
  useWindowDimensions,
  ActivityIndicator, // CRITICAL FIX: Add loading state
} from 'react-native';
// LinearGradient commented out - requires native rebuild, using View with gradient-like background
// import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useGameEnd } from '../../contexts/GameEndContext';
import { Fireworks } from './Fireworks';
import { CardImage } from '../scoreboard/components/CardImage';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type TabType = 'score' | 'play';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const GameEndModal: React.FC = () => {
  const {
    showGameEndModal,
    setShowGameEndModal,
    gameWinnerName,
    gameWinnerIndex,
    finalScores,
    playerNames,
    scoreHistory,
    playHistory,
    onPlayAgain,
    onReturnToMenu,
  } = useGameEnd();

  const [activeTab, setActiveTab] = useState<TabType>('score');
  const [showFireworks, setShowFireworks] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // CRITICAL FIX: Add loading state
  
  // Task #421: Responsive dimensions and orientation detection
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  
  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const tabIndicatorAnim = useRef(new Animated.Value(0)).current;
  const tabContentOpacity = useRef(new Animated.Value(1)).current; // Task #419: Tab fade transition

  // Start fireworks when modal opens (entrance animation removed for reliability)
  useEffect(() => {
    if (showGameEndModal) {
      setShowFireworks(true);
      startPulseAnimation();
    } else {
      setShowFireworks(false);
    }
  }, [showGameEndModal]);

  // Pulsing animation for winner text
  const startPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  // Task #419: Tab switch with fade animation
  const switchTab = (tab: TabType) => {
    if (tab === activeTab) return;
    
    // Task #420: Haptic feedback on tab switch (CRITICAL FIX: wrapped in try-catch)
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.warn('[GameEndModal] Haptics not supported:', error);
    }
    
    // Fade out current content
    Animated.timing(tabContentOpacity, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      // Switch tab after fade out
      setActiveTab(tab);
      
      // Fade in new content
      Animated.timing(tabContentOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    });
    
    // Animate tab indicator simultaneously
    Animated.timing(tabIndicatorAnim, {
      toValue: tab === 'score' ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  // Share results functionality
  const handleShare = async () => {
    // Task #420: Haptic feedback on share (CRITICAL FIX: wrapped)
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.warn('[GameEndModal] Haptics not supported:', error);
    }
    
    // Format results text
    const resultsText = formatResultsForShare();
    
    try {
      const result = await Share.share({
        message: resultsText,
        title: 'Big Two Game Results',
      });
      
      if (result.action === Share.sharedAction) {

      }
    } catch (error) {
      console.error('Error sharing results:', error);
      Alert.alert('Share Error', 'Failed to share results. Please try again.');
    }
  };

  // Format results for sharing
  const formatResultsForShare = (): string => {
    const sortedScores = [...finalScores].sort((a, b) => a.cumulative_score - b.cumulative_score);
    
    let text = '🎮 Big Two Game Results 🎮\n\n';
    text += `🏆 Winner: ${gameWinnerName}\n\n`;
    text += 'Final Standings:\n';
    
    sortedScores.forEach((player, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
      text += `${medal} ${player.player_name}: ${player.cumulative_score} pts\n`;
    });
    
    return text;
  };

  // Handle modal close
  const handleClose = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.warn('[GameEndModal] Haptics not supported:', error);
    }
    setShowGameEndModal(false);
  };

  // Task #416: Play Again logic
  const handlePlayAgain = async () => {
    // Task #420: Haptic feedback on play again (CRITICAL FIX: wrapped)
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.warn('[GameEndModal] Haptics not supported:', error);
    }
    
    Alert.alert(
      'Play Again',
      'Start a new game with the same players?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'New Game',
          onPress: async () => {
            try {
              // Close the modal first
              setShowGameEndModal(false);
              
              // Call the callback provided by GameScreen (if exists)
              if (onPlayAgain) {
                onPlayAgain();
              }
            } catch (error) {
              console.error('Error restarting game:', error);
              Alert.alert('Error', 'Failed to restart game. Please try again.');
            }
          },
        },
      ]
    );
  };

  // Task #417: Return to Menu logic
  const handleReturnToMenu = async () => {
    // Task #420: Haptic feedback on return to menu (CRITICAL FIX: wrapped)
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.warn('[GameEndModal] Haptics not supported:', error);
    }
    
    Alert.alert(
      'Return to Menu',
      'Leave the current game and return to the main menu?',
      [
        {
          text: 'Stay',
          style: 'cancel',
        },
        {
          text: 'Leave Game',
          style: 'destructive',
          onPress: async () => {
            try {
              // Close the modal first
              setShowGameEndModal(false);
              
              // Call the callback provided by GameScreen (if exists)
              if (onReturnToMenu) {
                onReturnToMenu();
              }
            } catch (error) {
              console.error('Error leaving game:', error);
              Alert.alert('Error', 'Failed to leave game. Please try again.');
            }
          },
        },
      ]
    );
  };

  // CRITICAL DEBUG: Log modal state whenever it changes
  useEffect(() => {
    console.log('🔍 [GameEndModal] Render state:', {
      showGameEndModal,
      gameWinnerName,
      finalScoresCount: finalScores.length,
      playerNamesCount: playerNames.length,
      scoreHistoryCount: scoreHistory.length,
      playHistoryCount: playHistory.length,
    });
  }, [showGameEndModal, gameWinnerName, finalScores, playerNames, scoreHistory, playHistory]);
  
  // CRITICAL FIX: Show loading state while waiting for data
  if (showGameEndModal && (finalScores.length === 0 || !gameWinnerName)) {
    console.warn('⚠️ [GameEndModal] Showing loading state - missing data:', {
      hasFinalScores: finalScores.length > 0,
      hasWinnerName: !!gameWinnerName,
    });
    
    return (
      <Modal
        visible={showGameEndModal}
        transparent={true}
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent={true}
      >
        <View style={[styles.backdrop, { justifyContent: 'center', alignItems: 'center' }]}>
          <View style={[styles.modalContainer, { justifyContent: 'center', alignItems: 'center', padding: 40 }]}>
            <ActivityIndicator size="large" color="#60a5fa" />
            <Text style={{ color: '#f3f4f6', marginTop: 16, fontSize: 16 }}>Loading results...</Text>
          </View>
        </View>
      </Modal>
    );
  }
  
  // CRITICAL FIX: Don't render if modal should not be visible
  if (!showGameEndModal) {
    console.log('✅ [GameEndModal] Modal hidden - not rendering');
    return null;
  }
  
  console.log('✅ [GameEndModal] Rendering full modal with data');
  
  return (
    <>
      {/* Modal */}
      <Modal
        visible={showGameEndModal}
        transparent={true}
        animationType="fade"
        presentationStyle="overFullScreen"
        onRequestClose={handleClose}
        statusBarTranslucent={true}
      >
        {/* CRITICAL FIX: Use regular View instead of SafeAreaView to prevent layout collapse */}
        <View style={styles.safeArea}>
          {/* Fireworks background animation - positioned absolutely */}
          <Fireworks active={showFireworks} duration={5000} />
          
          {/* Semi-transparent backdrop */}
          <View style={styles.backdrop}>
            
            {/* Modal container with gradient - Task #421: Responsive sizing (scale animation removed for reliability) */}
            <View 
              style={[
                styles.modalContainer,
                {
                  width: isLandscape ? windowWidth * 0.7 : windowWidth * 0.9,
                  // Give landscape more vertical space (95%) than portrait (85%) for better use of screen real estate
                  height: isLandscape ? windowHeight * 0.95 : windowHeight * 0.85,
                  maxWidth: 600,
                  maxHeight: isLandscape ? windowHeight * 0.95 : windowHeight * 0.85,
                }
              ]}
            >
              {/* Gradient background using View - LinearGradient requires native rebuild */}
              <View style={styles.gradient}>
                <ScrollView 
                  style={styles.scrollView}
                  contentContainerStyle={styles.scrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Winner Announcement */}
                  <WinnerAnnouncement
                    winnerName={gameWinnerName}
                    pulseAnim={pulseAnim}
                  />
                  
                  {/* Final Standings */}
                  <FinalStandings
                    finalScores={finalScores}
                    winnerIndex={gameWinnerIndex}
                  />
                  
                  {/* Tab Interface */}
                  <TabInterface
                    activeTab={activeTab}
                    onTabChange={switchTab}
                    tabIndicatorAnim={tabIndicatorAnim}
                  />
                  
                  {/* Tab Content - Task #419: Fade transition */}
                  <Animated.View style={{ opacity: tabContentOpacity }}>
                    {activeTab === 'score' ? (
                      <ScoreHistoryTab
                        scoreHistory={scoreHistory}
                        playerNames={playerNames}
                      />
                    ) : (
                      <PlayHistoryTab
                        playHistory={playHistory}
                        playerNames={playerNames}
                      />
                    )}
                  </Animated.View>
                  
                  {/* Action Buttons */}
                  <ActionButtons
                    onShare={handleShare}
                    onPlayAgain={handlePlayAgain}
                    onReturnToMenu={handleReturnToMenu}
                  />
                </ScrollView>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

// ============================================================================
// WINNER ANNOUNCEMENT COMPONENT (Task #407)
// ============================================================================

interface WinnerAnnouncementProps {
  winnerName: string;
  pulseAnim: Animated.Value;
}

const WinnerAnnouncement: React.FC<WinnerAnnouncementProps> = ({
  winnerName,
  pulseAnim,
}) => {
  return (
    <View style={styles.winnerSection}>
      <Text style={styles.winnerLabel}>Game Winner</Text>
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <Text style={styles.winnerName}>
          🏆 {winnerName} 🏆
        </Text>
      </Animated.View>
    </View>
  );
};

// ============================================================================
// FINAL STANDINGS COMPONENT (Task #408)
// ============================================================================

interface FinalStandingsProps {
  finalScores: Array<{
    player_name: string;
    cumulative_score: number;
    player_index: number;
    points_added: number;
  }>;
  winnerIndex: number;
}

const FinalStandings: React.FC<FinalStandingsProps> = ({
  finalScores,
  winnerIndex,
}) => {
  // Sort by score (lowest to highest)
  const sortedScores = [...finalScores].sort((a, b) => a.cumulative_score - b.cumulative_score);
  
  const getMedal = (index: number): string => {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return '';
  };
  
  const getScoreColor = (score: number, isWinner: boolean): string => {
    if (isWinner) return '#4ade80'; // Green for winner
    if (score > 100) return '#f87171'; // Red for busted
    return '#e5e7eb'; // Gray for normal
  };

  return (
    <View style={styles.standingsSection}>
      <Text style={styles.standingsTitle}>Final Standings</Text>
      <View style={styles.standingsList}>
        {sortedScores.map((player, index) => {
          const isWinner = player.player_index === winnerIndex;
          const scoreColor = getScoreColor(player.cumulative_score, isWinner);
          
          return (
            <View key={player.player_index} style={styles.standingsRow}>
              <View style={styles.standingsRank}>
                <Text style={styles.medalEmoji}>{getMedal(index)}</Text>
                <Text style={styles.rankNumber}>{index + 1}</Text>
              </View>
              
              <Text style={[styles.playerName, { color: scoreColor }]}>
                {player.player_name}
              </Text>
              
              <Text style={[styles.playerScore, { color: scoreColor }]}>
                {player.cumulative_score} pts
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

// ============================================================================
// TAB INTERFACE COMPONENT (Task #409)
// ============================================================================

interface TabInterfaceProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  tabIndicatorAnim: Animated.Value;
}

const TabInterface: React.FC<TabInterfaceProps> = ({
  activeTab,
  onTabChange,
  tabIndicatorAnim,
}) => {
  // CRITICAL FIX: Use onLayout to get actual container width dynamically
  const [containerWidth, setContainerWidth] = React.useState(0);
  
  const indicatorTranslateX = tabIndicatorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, containerWidth / 2], // Move by exactly half the container width (one button)
  });

  return (
    <View style={styles.tabContainer}>
      <View 
        style={styles.tabButtons}
        onLayout={(event) => {
          const { width } = event.nativeEvent.layout;
          setContainerWidth(width - 8); // Subtract padding (4px each side)
        }}
      >
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'score' && styles.tabButtonActive]}
          onPress={() => onTabChange('score')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabButtonText, activeTab === 'score' && styles.tabButtonTextActive]}>
            Score History
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'play' && styles.tabButtonActive]}
          onPress={() => onTabChange('play')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabButtonText, activeTab === 'play' && styles.tabButtonTextActive]}>
            Play History
          </Text>
        </TouchableOpacity>
        
        {/* Animated indicator - CRITICAL FIX: Width calculated from actual container */}
        {containerWidth > 0 && (
          <Animated.View
            style={[
              styles.tabIndicator,
              { 
                width: containerWidth / 2 - 4, // Half container minus padding
                transform: [{ translateX: indicatorTranslateX }] 
              }
            ]}
          />
        )}
      </View>
    </View>
  );
};

// ============================================================================
// SCORE HISTORY TAB (Task #410)
// ============================================================================

interface ScoreHistoryTabProps {
  scoreHistory: Array<{
    matchNumber: number;
    pointsAdded: number[];
    scores: number[];
  }>;
  playerNames: string[];
}

const ScoreHistoryTab: React.FC<ScoreHistoryTabProps> = ({
  scoreHistory,
  playerNames,
}) => {
  if (scoreHistory.length === 0) {
    return (
      <View style={styles.tabContent}>
        <View style={styles.emptyStateContainer}>
          <Text style={styles.emptyStateIcon}>📊</Text>
          <Text style={styles.emptyText}>No score history available</Text>
          <Text style={styles.emptySubtext}>Scores will appear here as matches are played</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView 
      style={styles.tabContent}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.tabScrollContent}
    >
      <Text style={styles.historyTitle}>Match-by-Match Scores</Text>
      
      {scoreHistory.map((match, matchIndex) => {
        // Calculate if any player busted (>100) in this match
        const hasBustedPlayer = match.scores.some(score => score > 100);
        
        return (
          <View 
            key={match.matchNumber} 
            style={[
              styles.scoreHistoryCard,
              hasBustedPlayer && styles.scoreHistoryCardBusted,
              matchIndex === scoreHistory.length - 1 && styles.scoreHistoryCardLatest
            ]}
          >
            <View style={styles.scoreHistoryHeader}>
              <Text style={styles.matchNumber}>
                Match {match.matchNumber}
              </Text>
              {matchIndex === scoreHistory.length - 1 && (
                <View style={styles.latestBadge}>
                  <Text style={styles.latestBadgeText}>Latest</Text>
                </View>
              )}
            </View>
            
            <View style={styles.scoreHistoryGrid}>
              {playerNames.map((name, playerIndex) => {
                const score = match.scores[playerIndex] || 0;
                const pointsAdded = match.pointsAdded[playerIndex] || 0;
                const isBusted = score > 100;
                
                return (
                  <View key={playerIndex} style={styles.scoreHistoryRow}>
                    <View style={styles.scoreHistoryPlayerInfo}>
                      <Text style={styles.scoreHistoryPlayerName}>{name}</Text>
                      <View style={styles.scoreHistoryPoints}>
                        <Text 
                          style={[
                            styles.scoreHistoryCumulativeScore,
                            isBusted && styles.scoreHistoryBustedText
                          ]}
                        >
                          {score} pts
                        </Text>
                        <Text 
                          style={[
                            styles.scoreHistoryPointsAdded,
                            pointsAdded > 0 && styles.scoreHistoryPointsAddedPositive
                          ]}
                        >
                          {pointsAdded > 0 ? `+${pointsAdded}` : pointsAdded}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
      
      <View style={styles.tabContentFooter}>
        <Text style={styles.tabContentFooterText}>
          {scoreHistory.length} {scoreHistory.length === 1 ? 'match' : 'matches'} played
        </Text>
      </View>
    </ScrollView>
  );
};

// ============================================================================
// PLAY HISTORY TAB (Tasks #411, #412, #397)
// ============================================================================

interface PlayHistoryTabProps {
  playHistory: Array<{
    matchNumber: number;
    hands: Array<{
      by: number;
      type: string;
      count: number;
      cards: any[];
    }>;
  }>;
  playerNames: string[];
}

const PlayHistoryTab: React.FC<PlayHistoryTabProps> = ({
  playHistory,
  playerNames,
}) => {
  const [expandedMatches, setExpandedMatches] = useState<Set<number>>(new Set());
  
  // Toggle match expansion
  const toggleMatchExpansion = (matchNumber: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedMatches(prev => {
      const newSet = new Set(prev);
      if (newSet.has(matchNumber)) {
        newSet.delete(matchNumber);
      } else {
        newSet.add(matchNumber);
      }
      return newSet;
    });
  };
  
  if (playHistory.length === 0) {
    return (
      <View style={styles.tabContent}>
        <View style={styles.emptyStateContainer}>
          <Text style={styles.emptyStateIcon}>🃏</Text>
          <Text style={styles.emptyText}>No play history available</Text>
          <Text style={styles.emptySubtext}>Card plays will appear here as hands are played</Text>
        </View>
      </View>
    );
  }

  // Flatten all hands for FlatList virtualization (Task #397)
  const flattenedData = playHistory.flatMap((match) => {
    const isExpanded = expandedMatches.has(match.matchNumber);
    const isLatestMatch = match.matchNumber === playHistory[playHistory.length - 1].matchNumber;
    
    // Always include match header
    const items: Array<{ type: 'header' | 'hand'; data: any }> = [
      {
        type: 'header',
        data: {
          matchNumber: match.matchNumber,
          handCount: match.hands.length,
          isExpanded,
          isLatestMatch,
        }
      }
    ];
    
    // Add hands if expanded
    if (isExpanded) {
      match.hands.forEach((hand, handIndex) => {
        items.push({
          type: 'hand',
          data: {
            ...hand,
            handIndex,
            matchNumber: match.matchNumber,
            isLatestHand: handIndex === match.hands.length - 1 && isLatestMatch,
          }
        });
      });
    }
    
    return items;
  });

  const renderItem = ({ item }: { item: { type: 'header' | 'hand'; data: any } }) => {
    if (item.type === 'header') {
      return (
        <TouchableOpacity
          style={[
            styles.playHistoryMatchHeader,
            item.data.isLatestMatch && styles.playHistoryMatchHeaderLatest
          ]}
          onPress={() => toggleMatchExpansion(item.data.matchNumber)}
          activeOpacity={0.7}
        >
          <View style={styles.playHistoryMatchHeaderLeft}>
            <Text style={styles.matchNumber}>
              Match {item.data.matchNumber}
            </Text>
            <Text style={styles.playHistoryHandCount}>
              {item.data.handCount} {item.data.handCount === 1 ? 'hand' : 'hands'}
            </Text>
          </View>
          
          <View style={styles.playHistoryMatchHeaderRight}>
            {item.data.isLatestMatch && (
              <View style={styles.latestBadge}>
                <Text style={styles.latestBadgeText}>Latest</Text>
              </View>
            )}
            <Text style={styles.expandIcon}>
              {item.data.isExpanded ? '▼' : '▶'}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }
    
    // Render hand (card play)
    const hand = item.data;
    const playerName = playerNames[hand.by] || `Player ${hand.by + 1}`;
    
    return (
      <View 
        style={[
          styles.playHistoryHand,
          hand.isLatestHand && styles.playHistoryHandLatest
        ]}
      >
        <View style={styles.playHistoryHandHeader}>
          <Text style={styles.playHistoryPlayerName}>{playerName}</Text>
          <Text style={styles.playHistoryComboType}>{hand.type}</Text>
        </View>
        
        {/* Card Images (Task #412) */}
        <View style={styles.playHistoryCards}>
          {hand.cards && hand.cards.length > 0 ? (
            hand.cards.map((card: any, cardIndex: number) => (
              <CardImage
                key={cardIndex}
                rank={card.rank || card.r}
                suit={card.suit || card.s}
                width={35}
                height={51}
              />
            ))
          ) : (
            <Text style={styles.playHistoryNoCards}>
              {hand.count} {hand.count === 1 ? 'card' : 'cards'}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <ScrollView 
      style={styles.tabContent}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.tabScrollContent}
    >
      <Text style={styles.historyTitle}>Card Play History</Text>
      
      {flattenedData.map((item, index) => (
        <React.Fragment key={`${item.type}-${index}`}>
          {renderItem({ item })}
        </React.Fragment>
      ))}
      
      <View style={styles.tabContentFooter}>
        <Text style={styles.tabContentFooterText}>
          Tap matches to expand/collapse
        </Text>
      </View>
    </ScrollView>
  );
};

// ============================================================================
// ACTION BUTTONS COMPONENT (Task #413)
// ============================================================================

interface ActionButtonsProps {
  onShare: () => void;
  onPlayAgain: () => void;
  onReturnToMenu: () => void;
}

const ActionButtons: React.FC<ActionButtonsProps> = ({
  onShare,
  onPlayAgain,
  onReturnToMenu,
}) => {
  return (
    <View style={styles.actionButtons}>
      <TouchableOpacity
        style={[styles.actionButton, styles.shareButton]}
        onPress={onShare}
        activeOpacity={0.8}
      >
        <Text style={styles.actionButtonText}>📤 Share Results</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.actionButton, styles.playAgainButton]}
        onPress={onPlayAgain}
        activeOpacity={0.8}
      >
        <Text style={styles.actionButtonText}>🔄 Play Again</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.actionButton, styles.menuButton]}
        onPress={onReturnToMenu}
        activeOpacity={0.8}
      >
        <Text style={styles.actionButtonText}>🏠 Return to Menu</Text>
      </TouchableOpacity>
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)', // Semi-transparent dark backdrop
    zIndex: 99999, // CRITICAL FIX: Ensure modal is above EVERYTHING (scoreboard has zIndex: 100)
  },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    // Task #421: Width and height now applied dynamically via inline styles
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#16213e', // CRITICAL FIX: Solid background for modal content
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  gradient: {
    flex: 1,
    backgroundColor: '#1a1a2e', // Rich dark blue-purple background (matches intended gradient top color)
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  
  // Winner Announcement (Task #407)
  winnerSection: {
    alignItems: 'center',
    paddingVertical: 20,
    marginBottom: 20,
  },
  winnerLabel: {
    fontSize: 18,
    color: '#9ca3af',
    marginBottom: 10,
    fontWeight: '500',
  },
  winnerName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fbbf24',
    textAlign: 'center',
    textShadowColor: 'rgba(251, 191, 36, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 15,
  },
  
  // Final Standings (Task #408)
  standingsSection: {
    marginBottom: 24,
  },
  standingsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f3f4f6',
    marginBottom: 12,
  },
  standingsList: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 12,
  },
  standingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  standingsRank: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 60,
  },
  medalEmoji: {
    fontSize: 20,
    marginRight: 4,
  },
  rankNumber: {
    fontSize: 16,
    color: '#9ca3af',
    fontWeight: '600',
  },
  playerName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  playerScore: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  
  // Tab Interface (Task #409)
  tabContainer: {
    marginBottom: 16,
  },
  tabButtons: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 10,
    padding: 4,
    position: 'relative', // CRITICAL FIX: Contain absolute positioned indicator
    overflow: 'hidden', // CRITICAL FIX: Clip indicator to stay within bounds
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: 'transparent',
    zIndex: 1, // Ensure text appears above indicator
  },
  tabButtonActive: {
    // No background - let the animated indicator handle the visual feedback
  },
  tabButtonText: {
    fontSize: 14,
    color: '#9ca3af',
    fontWeight: '600',
  },
  tabButtonTextActive: {
    color: '#60a5fa',
  },
  tabIndicator: {
    position: 'absolute',
    top: 4,
    left: 4,
    // Width calculated dynamically via inline style
    height: 44,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.4)',
  },
  
  // Tab Content (Tasks #410, #411, #412, #397)
  tabContent: {
    flex: 1,
    minHeight: 250,
  },
  tabScrollContent: {
    paddingBottom: 16,
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f3f4f6',
    marginBottom: 12,
  },
  
  // Empty State
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
  },
  
  // Score History Tab (Task #410)
  scoreHistoryCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  scoreHistoryCardBusted: {
    borderColor: 'rgba(248, 113, 113, 0.3)',
    backgroundColor: 'rgba(248, 113, 113, 0.05)',
  },
  scoreHistoryCardLatest: {
    borderColor: 'rgba(96, 165, 250, 0.4)',
    backgroundColor: 'rgba(96, 165, 250, 0.08)',
  },
  scoreHistoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  matchNumber: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#60a5fa',
  },
  latestBadge: {
    backgroundColor: 'rgba(96, 165, 250, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#60a5fa',
  },
  latestBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#60a5fa',
    textTransform: 'uppercase',
  },
  scoreHistoryGrid: {
    gap: 8,
  },
  scoreHistoryRow: {
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderRadius: 8,
    padding: 10,
  },
  scoreHistoryPlayerInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreHistoryPlayerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e5e7eb',
  },
  scoreHistoryPoints: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scoreHistoryCumulativeScore: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#f3f4f6',
  },
  scoreHistoryBustedText: {
    color: '#f87171',
  },
  scoreHistoryPointsAdded: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9ca3af',
  },
  scoreHistoryPointsAddedPositive: {
    color: '#fbbf24',
  },
  
  // Play History Tab (Tasks #411, #412)
  playHistoryList: {
    paddingBottom: 8,
  },
  playHistoryMatchHeader: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  playHistoryMatchHeaderLatest: {
    borderColor: 'rgba(96, 165, 250, 0.4)',
    backgroundColor: 'rgba(96, 165, 250, 0.08)',
  },
  playHistoryMatchHeaderLeft: {
    flex: 1,
  },
  playHistoryMatchHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playHistoryHandCount: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  expandIcon: {
    fontSize: 14,
    color: '#60a5fa',
    fontWeight: 'bold',
  },
  playHistoryHand: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
    marginLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255, 255, 255, 0.15)',
  },
  playHistoryHandLatest: {
    borderLeftColor: '#60a5fa',
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
  },
  playHistoryHandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  playHistoryPlayerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f3f4f6',
  },
  playHistoryComboType: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fbbf24',
  },
  playHistoryCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  playHistoryNoCards: {
    fontSize: 13,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  
  // Tab Footer
  tabContentFooter: {
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'center',
  },
  tabContentFooterText: {
    fontSize: 12,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  
  // Action Buttons (Task #413)
  actionButtons: {
    gap: 12,
    paddingTop: 8,
  },
  actionButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 56,
    justifyContent: 'center',
  },
  shareButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  playAgainButton: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  menuButton: {
    backgroundColor: 'rgba(156, 163, 175, 0.2)',
    borderWidth: 1,
    borderColor: '#6b7280',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f3f4f6',
  },
});

export default GameEndModal;
