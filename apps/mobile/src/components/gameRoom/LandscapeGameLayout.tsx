/**
 * LandscapeGameLayout Component
 * 
 * Complete landscape game room layout
 * 
 * Features:
 * - All Phase 2 components integrated
 * - Scoreboard, table, players, controls
 * - Orientation-aware rendering
 * 
 * Task #450: Add orientation toggle functionality
 * Date: December 18, 2025
 */

import React from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LandscapeScoreboard, PlayHistoryModal } from './LandscapeScoreboard';
import { LandscapeOvalTable } from './LandscapeOvalTable';
import { LandscapeYourPosition } from './LandscapeYourPosition';
import { LandscapeControlBar } from './LandscapeControlBar';
import { LandscapeOpponent } from './LandscapeOpponent';
import { AutoPassTimer } from '../game';
import type { Card as CardType } from '../../game/types';
import type { AutoPassTimerState } from '../../types/multiplayer';
import { gameLogger } from '../../utils/logger';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface LandscapeGameLayoutProps {
  /** Scoreboard data */
  playerNames: string[];
  currentScores: number[];
  cardCounts: number[];
  currentPlayerIndex: number;
  matchNumber: number;
  isGameFinished: boolean;
  scoreHistory?: any[];
  playHistory?: any[];
  autoPassTimerState?: AutoPassTimerState;
  
  /** Table data */
  lastPlayedCards?: CardType[];
  lastPlayedBy?: string;
  lastPlayComboType?: string;
  lastPlayCombo?: string;
  
  /** Player data */
  playerName: string;
  playerCardCount: number;
  playerCards: CardType[];
  isPlayerActive: boolean;
  selectedCardIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onCardsReorder?: (reorderedCards: CardType[]) => void;
  
  /** Drag-to-play callback */
  onPlayCards?: (cards: CardType[]) => void;
  
  /** Control bar callbacks */
  onOrientationToggle: () => void;
  onHelp?: () => void;
  onSort?: () => void;
  onSmartSort?: () => void;
  onPlay?: () => void;
  onPass?: () => void;
  onHint?: () => void;
  onSettings?: () => void;
  
  /** Control states */
  disabled?: boolean;
  canPlay?: boolean;
  canPass?: boolean;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LandscapeGameLayout({
  // Scoreboard
  playerNames,
  currentScores,
  cardCounts,
  currentPlayerIndex,
  matchNumber,
  isGameFinished,
  scoreHistory = [],
  playHistory = [],
  autoPassTimerState,
  
  // Table
  lastPlayedCards,
  lastPlayedBy,
  lastPlayComboType,
  lastPlayCombo,
  
  // Player
  playerName,
  playerCardCount,
  playerCards,
  isPlayerActive,
  selectedCardIds,
  onSelectionChange,
  onCardsReorder,
  onPlayCards: onPlayCardsCallback,
  
  // Controls
  onOrientationToggle,
  onHelp,
  onSort,
  onSmartSort,
  onPlay,
  onPass,
  onHint,
  onSettings,
  disabled = false,
  canPlay = false,
  canPass = false,
}: LandscapeGameLayoutProps) {
  
  // Scoreboard expand/collapse state
  const [isScoreboardExpanded, setIsScoreboardExpanded] = React.useState(false);
  const [showPlayHistory, setShowPlayHistory] = React.useState(false);
  const [collapsedMatches, setCollapsedMatches] = React.useState<Set<number>>(new Set());
  
  // Toggle match collapse in play history
  const handleToggleMatch = (matchNumber: number) => {
    setCollapsedMatches(prev => {
      const newSet = new Set(prev);
      if (newSet.has(matchNumber)) {
        newSet.delete(matchNumber);
      } else {
        newSet.add(matchNumber);
      }
      return newSet;
    });
  };
  
  // Helper function to check if a player index is currently active
  // (scoreboard order is [user, top, left, right])
  const isOpponentActive = (index: number) => {
    return currentPlayerIndex === index;
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
      <View style={styles.contentContainer}>
        {/* Scoreboard - top left */}
        <View style={styles.scoreboardContainer}>
          <LandscapeScoreboard
            playerNames={playerNames}
            currentScores={currentScores}
            cardCounts={cardCounts}
            currentPlayerIndex={currentPlayerIndex}
            matchNumber={matchNumber}
            isGameFinished={isGameFinished}
            isExpanded={isScoreboardExpanded}
            onToggleExpand={() => {
              console.log('[LandscapeGameLayout] Toggle expand clicked, current:', isScoreboardExpanded);
              setIsScoreboardExpanded(!isScoreboardExpanded);
            }}
            onTogglePlayHistory={() => {
              console.log('[LandscapeGameLayout] Toggle play history clicked, current:', showPlayHistory);
              setShowPlayHistory(!showPlayHistory);
            }}
            scoreHistory={scoreHistory}
            playHistory={playHistory}
          />
        </View>
        
        {/* Play History Modal (same as portrait) */}
        {showPlayHistory && (
          <PlayHistoryModal
            visible={showPlayHistory}
            onClose={() => setShowPlayHistory(false)}
            playerNames={playerNames}
            playHistory={playHistory}
            currentMatch={matchNumber}
            collapsedMatches={collapsedMatches}
            onToggleMatch={handleToggleMatch}
          />
        )}

        {/* Top opponent - Player 1 (Bot 2) (horizontal layout with name to right) */}
        <View style={styles.topOpponent}>
          <LandscapeOpponent
            name={playerNames[2] || 'Bot 2'}
            isActive={isOpponentActive(2)}
            layout="horizontal"
          />
        </View>

        {/* Left opponent - Player 2 (Bot 3) (same as portrait) */}
        <View style={styles.leftOpponent}>
          <LandscapeOpponent
            name={playerNames[3] || 'Bot 3'}
            isActive={isOpponentActive(3)}
          />
        </View>

        {/* Right opponent - Player 3 (Bot 1) (same as portrait) */}
        <View style={styles.rightOpponent}>
          <LandscapeOpponent
            name={playerNames[1] || 'Bot 1'}
            isActive={isOpponentActive(1)}
          />
        </View>

        {/* Top-right buttons: Rotation & Settings (SWITCHED ORDER) */}
        <View style={styles.topRightButtons}>
          <Pressable style={styles.actionButton} onPress={onOrientationToggle}>
            <Text style={styles.actionButtonText}>🔄</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={onSettings}>
            {/* Hamburger menu (3 lines like portrait) */}
            <View style={styles.hamburgerMenu}>
              <View style={styles.hamburgerLine} />
              <View style={styles.hamburgerLine} />
              <View style={styles.hamburgerLine} />
            </View>
          </Pressable>
        </View>
        
        {/* Main game area - center */}
        <View style={styles.mainArea}>
          {/* Oval table with last played cards */}
          <LandscapeOvalTable
            lastPlayed={lastPlayedCards ?? null}
            lastPlayedBy={lastPlayedBy ?? null}
            combinationType={lastPlayComboType ?? null}
            comboDisplayText={lastPlayCombo ?? undefined}
          />
          
          {/* Auto-Pass Timer Display (OVERLAY on table) */}
          {autoPassTimerState && (
            <View style={styles.timerOverlay}>
              <AutoPassTimer
                timerState={autoPassTimerState}
                currentPlayerIndex={0}
              />
            </View>
          )}
        </View>
        
        {/* Player (bottom-left) - same design as Bot 2 */}
        <View style={styles.bottomPlayerContainer}>
          <LandscapeOpponent
            name={playerName}
            isActive={isPlayerActive}
            layout="vertical"
          />
        </View>
        
        {/* Play/Pass buttons - RIGHT SIDE (between cards and helper buttons) */}
        <View style={styles.playPassContainer}>
          <Pressable 
            style={[styles.playButton, (!canPlay || disabled) && { opacity: 0.5 }]} 
            onPress={onPlay}
            disabled={!canPlay || disabled}
          >
            <Text style={styles.buttonText}>Play</Text>
          </Pressable>
          <Pressable 
            style={[styles.passButton, (!canPass || disabled) && { opacity: 0.5 }]} 
            onPress={onPass}
            disabled={!canPass || disabled}
          >
            <Text style={styles.buttonText}>Pass</Text>
          </Pressable>
        </View>
        
        {/* Helper buttons - FAR RIGHT (2x2 grid) */}
        <View style={styles.helperButtonsContainer}>
          <Pressable style={styles.helperButton} onPress={onHelp} disabled={disabled}>
            <Text style={styles.helperButtonText}>❓</Text>
          </Pressable>
          <Pressable style={styles.helperButton} onPress={onSort} disabled={disabled}>
            <Text style={styles.helperButtonText}>🔢</Text>
          </Pressable>
          <Pressable style={styles.helperButton} onPress={onSmartSort} disabled={disabled}>
            <Text style={styles.helperButtonText}>✨</Text>
          </Pressable>
          <Pressable style={styles.helperButton} onPress={onHint} disabled={disabled}>
            <Text style={styles.helperButtonText}>💡</Text>
          </Pressable>
        </View>
        
        {/* Your position - BOTTOM OF SCREEN */}
        <View style={styles.yourPosition}>
          <LandscapeYourPosition
            playerName={playerName}
            cards={playerCards}
            isActive={isPlayerActive}
            selectedCardIds={selectedCardIds}
            onSelectionChange={onSelectionChange}
            onPlayCards={onPlayCardsCallback}
            onCardsReorder={onCardsReorder}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#25292e', // Matches portrait COLORS.primary
  },
  contentContainer: {
    flex: 1,
    position: 'relative',
  },
  scoreboardContainer: {
    position: 'absolute',
    top: 0,
    left: -30, // EXTREME LEFT as requested
    zIndex: 10,
  },
  
  // Opponent positions around table
  topOpponent: {
    position: 'absolute',
    top: 8,
    left: '50%',
    transform: [{ translateX: -40 }], // Center horizontally
    zIndex: 5,
  },
  leftOpponent: {
    position: 'absolute',
    left: 60, // Move CLOSER TO TABLE (away from scoreboard)
    top: '50%',
    transform: [{ translateY: -40 }], // Move LOWER (was -50, now +10)
    zIndex: 5,
  },
  rightOpponent: {
    position: 'absolute',
    right: 60,
    top: '50%',
    transform: [{ translateY: -40 }],
    zIndex: 5,
  },
  
  mainArea: {
    position: 'absolute',
    top: '18%', // Raised to touch bottom of top player's avatar circle
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 3,
  },
  
  timerOverlay: {
    position: 'absolute', // Overlay on table (don't push layout)
    top: 20, // MIDDLE OF SCREEN (was -80, under Bot 1)
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100, // Above table
  },
  
  yourPosition: {
    position: 'absolute',
    bottom: 8,
    left: 130, // Leave space for Steve Peterson in FAR LEFT
    right: 150, // Leave space for Play/Pass + helper buttons on right
    zIndex: 50,
  },
  
  topRightButtons: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 8,
    zIndex: 100,
  },
  
  actionButton: {
    width: 44, // EXACT same as helperButton
    height: 44, // EXACT same as helperButton
    borderRadius: 8, // EXACT same as helperButton
    backgroundColor: 'rgba(255, 255, 255, 0.1)', // EXACT same as helperButton
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)', // EXACT same as helperButton
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  actionButtonText: {
    fontSize: 16,
  },
  
  hamburgerMenu: {
    width: 18,
    height: 14,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  
  hamburgerLine: {
    width: 18,
    height: 2,
    backgroundColor: '#ffffff',
    borderRadius: 1,
  },
  
  bottomPlayerContainer: {
    position: 'absolute',
    bottom: 20, // Move WAY UP (closer to table, avoid cards)
    left: -30, // FAR BOTTOM LEFT CORNER
    zIndex: 60,
  },
  
  playPassContainer: {
    position: 'absolute',
    bottom: 12, // Right side, between cards and helper buttons
    right: 112, // 96 (helper buttons width) + 8 (gap) + 8 (padding)
    flexDirection: 'column',
    gap: 6,
    zIndex: 60,
  },
  
  playButton: {
    width: 56,  // Smaller to fit between cards and helper buttons
    height: 40,
    borderRadius: 6,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  passButton: {
    width: 56,  // Smaller to fit between cards and helper buttons
    height: 40,
    borderRadius: 6,
    backgroundColor: '#6b7280',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  helperButtonsContainer: {
    position: 'absolute',
    bottom: 12, // FAR RIGHT (2x2 grid)
    right: 8,
    flexDirection: 'row', // 2x2 grid layout
    flexWrap: 'wrap',
    width: 96, // 2 buttons × 44pt + gap
    gap: 8,
    zIndex: 60,
  },
  
  buttonText: {
    color: '#ffffff',
    fontSize: 12,  // Smaller font for smaller buttons
    fontWeight: '600',
  },
  
  helperButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  helperButtonText: {
    fontSize: 16,
  },
});
