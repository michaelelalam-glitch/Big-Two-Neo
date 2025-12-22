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
import { HelperButtons } from '../game/HelperButtons';
import type { Card as CardType } from '../../game/types';
import type { AutoPassTimerState } from '../../types/multiplayer';
import { gameLogger } from '../../utils/logger';
import { i18n } from '../../i18n';

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
  originalPlayerNames?: string[]; // Original player names for play history (game state order)
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
  originalPlayerNames,
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
            originalPlayerNames={originalPlayerNames}
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
            playerNames={originalPlayerNames || []}
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
            cardCount={cardCounts[2] || 0}
            isActive={isOpponentActive(2)}
            layout="horizontal"
          />
        </View>

        {/* Left opponent - Player 2 (Bot 3) (same as portrait) */}
        <View style={styles.leftOpponent}>
          <LandscapeOpponent
            name={playerNames[3] || 'Bot 3'}
            cardCount={cardCounts[3] || 0}
            isActive={isOpponentActive(3)}
          />
        </View>

        {/* Right opponent - Player 3 (Bot 1) (same as portrait) */}
        <View style={styles.rightOpponent}>
          <LandscapeOpponent
            name={playerNames[1] || 'Bot 1'}
            cardCount={cardCounts[1] || 0}
            isActive={isOpponentActive(1)}
          />
        </View>

        {/* Top-right buttons: Rotation & Settings (SWITCHED ORDER) */}
        <View style={styles.topRightButtons}>
          <Pressable 
            style={styles.actionButton} 
            onPress={onOrientationToggle}
            accessibilityLabel="Toggle orientation"
            accessibilityRole="button"
          >
            <Text style={styles.actionButtonText}>🔄</Text>
          </Pressable>
          <Pressable 
            style={styles.actionButton} 
            onPress={onSettings}
            accessibilityLabel="Settings"
            accessibilityRole="button"
          >
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
            cardCount={playerCardCount}
            isActive={isPlayerActive}
            layout="vertical"
          />
        </View>
        
        {/* Action buttons - RIGHT SIDE (2-row layout) */}
        <View style={styles.actionButtonsContainer}>
          {/* Top row: Play + Smart */}
          <View style={styles.buttonRow}>
            <Pressable 
              style={[styles.playButton, (!canPlay || disabled) && { opacity: 0.5 }]} 
              onPress={onPlay}
              disabled={!canPlay || disabled}
              accessibilityLabel="Play cards"
              accessibilityRole="button"
            >
              <Text style={styles.playButtonText}>{i18n.t('game.play')}</Text>
            </Pressable>
            <Pressable 
              style={[styles.smartButton, disabled && { opacity: 0.5 }]} 
              onPress={onSmartSort}
              disabled={disabled}
              accessibilityLabel="Smart sort"
              accessibilityRole="button"
            >
              <Text style={styles.smartButtonText}>{i18n.t('game.smart')}</Text>
            </Pressable>
          </View>
          
          {/* Bottom row: Pass + Sort + Hint */}
          <View style={styles.buttonRow}>
            <Pressable 
              style={[styles.passButton, (!canPass || disabled) && { opacity: 0.5 }]} 
              onPress={onPass}
              disabled={!canPass || disabled}
              accessibilityLabel="Pass turn"
              accessibilityRole="button"
            >
              <Text style={styles.passButtonText}>{i18n.t('game.pass')}</Text>
            </Pressable>
            <Pressable 
              style={[styles.sortButton, disabled && { opacity: 0.5 }]} 
              onPress={onSort}
              disabled={disabled}
              accessibilityLabel="Sort cards"
              accessibilityRole="button"
            >
              <Text style={[
                styles.sortButtonText,
                i18n.getLanguage() === 'de' && styles.sortButtonTextGerman
              ]}>
                {i18n.t('game.sort')}
              </Text>
            </Pressable>
            <Pressable 
              style={[styles.hintButton, disabled && { opacity: 0.5 }]} 
              onPress={onHint}
              disabled={disabled}
              accessibilityLabel="Get hint"
              accessibilityRole="button"
            >
              <Text style={styles.hintButtonText}>{i18n.t('game.hint')}</Text>
            </Pressable>
          </View>
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
    zIndex: 100, // CRITICAL: Must be higher than buttons (60) to allow drag/drop
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
  
  actionButtonsContainer: {
    position: 'absolute',
    bottom: 12,
    right: -24,
    flexDirection: 'column',
    gap: 6,
    zIndex: 60,
    pointerEvents: 'box-none', // CRITICAL: Allow touches to pass through container but buttons receive touches
  },
  
  buttonRow: {
    flexDirection: 'row',
    gap: 6,
    pointerEvents: 'box-none', // IMPORTANT: Allow button touches while maintaining gesture handling
  },
  
  // Play button (Green)
  playButton: {
    width: 60,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  playButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  
  // Smart button (Teal/Cyan)
  smartButton: {
    width: 70,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#0891b2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  smartButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  
  // Pass button (Gray)
  passButton: {
    width: 60,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#374151',
    borderWidth: 1,
    borderColor: '#6b7280',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  passButtonText: {
    color: '#D1D5DB',
    fontSize: 13,
    fontWeight: 'bold',
  },
  
  // Sort button (Gray) - WIDER for German 'Sortieren'
  sortButton: {
    width: 85, // Increased from 55 to fit 'Sortieren'
    height: 40,
    borderRadius: 12,
    backgroundColor: '#374151',
    borderWidth: 1,
    borderColor: '#6b7280',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  sortButtonText: {
    color: '#D1D5DB',
    fontSize: 13, // Default size for English/Arabic
    fontWeight: 'bold',
  },
  
  sortButtonTextGerman: {
    fontSize: 11, // Smaller size for German 'Sortieren'
  },
  
  // Hint button (Orange)
  hintButton: {
    width: 55,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  hintButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
