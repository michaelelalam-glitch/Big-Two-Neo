import React from 'react';
import { View, StyleSheet } from 'react-native';
import { PlayerInfo, CenterPlayArea, AutoPassTimer } from './index';
import type { AutoPassTimerState } from '../../types/multiplayer';
import { COLORS, SPACING, LAYOUT, POSITIONING, SHADOWS } from '../../constants';

interface GameLayoutProps {
  /** Array of 4 players in display order [user, top, left, right] */
  players: {
    name: string;
    cardCount: number;
    isActive: boolean;
    totalScore?: number;
  }[];
  /** Last played cards to display in center area */
  lastPlayedCards: any[];
  /** Name of player who made last play */
  lastPlayedBy: string | null;
  /** Type of last combo played */
  lastPlayComboType: string | null;
  /** Display text for last combo */
  lastPlayCombo: string | null;
  /** Auto-pass timer state (if active) */
  autoPassTimerState?: AutoPassTimerState;
}

/**
 * GameLayout Component
 * Handles the table layout with 4 players positioned around a central play area
 * Extracted from GameScreen.tsx to reduce complexity (Task #426)
 * 
 * Layout structure:
 * - Top player (position 1) above table
 * - Left player (position 2) on left side
 * - Center play area with last played cards
 * - Right player (position 3) on right side
 * - Bottom player (position 0) rendered by parent
 */
export function GameLayout({
  players,
  lastPlayedCards,
  lastPlayedBy,
  lastPlayComboType,
  lastPlayCombo,
  autoPassTimerState,
}: GameLayoutProps) {
  return (
    <>
      {/* Top player (position 1) - OUTSIDE table, above it */}
      <View style={styles.topPlayerAboveTable}>
        <PlayerInfo
          name={players[1].name}
          cardCount={players[1].cardCount}
          isActive={players[1].isActive}
          totalScore={players[1].totalScore}
        />
      </View>

      {/* Game table area */}
      <View style={styles.tableArea}>
        {/* Middle row: Left player, Center play area, Right player */}
        <View style={styles.middleRow}>
          {/* Left player (position 2) */}
          <View style={styles.leftPlayerContainer}>
            <PlayerInfo
              name={players[2].name}
              cardCount={players[2].cardCount}
              isActive={players[2].isActive}
              totalScore={players[2].totalScore}
            />
          </View>

          {/* Center play area (last played cards) */}
          <View style={styles.centerPlayArea}>
            <CenterPlayArea
              lastPlayed={lastPlayedCards}
              lastPlayedBy={lastPlayedBy || null}
              combinationType={lastPlayComboType}
              comboDisplayText={lastPlayCombo || undefined}
            />

            {/* Auto-Pass Timer Display */}
            {autoPassTimerState && (
              <AutoPassTimer
                timerState={autoPassTimerState}
                currentPlayerIndex={0} // Player is always at index 0 in local game
              />
            )}
          </View>

          {/* Right player (position 3) */}
          <View style={styles.rightPlayerContainer}>
            <PlayerInfo
              name={players[3].name}
              cardCount={players[3].cardCount}
              isActive={players[3].isActive}
              totalScore={players[3].totalScore}
            />
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  topPlayerAboveTable: {
    alignItems: 'center',
    paddingTop: LAYOUT.topPlayerSpacing,
    // Task #590: Removed leftPlayerOffset since compact scoreboard no longer occupies top-left
    marginBottom: LAYOUT.topPlayerOverlap,
    zIndex: 50,
  },
  tableArea: {
    width: LAYOUT.tableWidth,
    height: LAYOUT.tableHeight,
    backgroundColor: COLORS.table.background,
    alignSelf: 'center',
    borderRadius: LAYOUT.tableBorderRadius,
    borderWidth: LAYOUT.tableBorderWidth,
    borderColor: COLORS.table.border,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
    shadowColor: COLORS.black,
    shadowOffset: SHADOWS.table.offset,
    shadowOpacity: SHADOWS.table.opacity,
    shadowRadius: SHADOWS.table.radius,
    elevation: SHADOWS.table.elevation,
  },
  middleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  leftPlayerContainer: {
    alignItems: 'center',
    position: 'absolute',
    left: LAYOUT.playerOverlapOffset,
    top: POSITIONING.sidePlayerTop,
  },
  centerPlayArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  rightPlayerContainer: {
    alignItems: 'center',
    position: 'absolute',
    right: LAYOUT.playerOverlapOffset,
    top: POSITIONING.sidePlayerTop,
  },
});
