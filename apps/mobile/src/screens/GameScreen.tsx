import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useNavigation, NavigationProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { CardHand, PlayerInfo, MatchScoreboard, CenterPlayArea, GameSettingsModal } from '../components/game';
import type { Card } from '../game/types';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, POSITIONING, SHADOWS, OPACITIES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;
type GameScreenNavigationProp = NavigationProp<RootStackParamList>;

// Demo utilities for creating test hand
// TODO: Replace with actual game state from GameStateManager in Task #266
function createDemoDeck(): Card[] {
  const suits = ['H', 'D', 'C', 'S'];
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const deck: Card[] = [];
  
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ id: `${rank}${suit}`, rank, suit });
    }
  }
  
  return deck;
}

// ⚠️ WARNING: Not cryptographically secure - uses Math.random()
// Fisher-Yates shuffle for DEMO purposes only
// TODO (Task #266): MUST replace with GameStateManager's secure shuffling in production
// This is acceptable ONLY for UI demo; production requires proper game logic
function shuffleDemoDeck(cards: Card[]): Card[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export default function GameScreen() {
  const route = useRoute<GameScreenRouteProp>();
  const navigation = useNavigation<GameScreenNavigationProp>();
  const { user } = useAuth();
  const { roomCode } = route.params;
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  
  // TODO: Replace with actual game state from GameStateManager/Supabase realtime
  // Demo game state for UI testing
  const [currentTurn] = useState<number>(0); // 0=you (bottom), 1=top, 2=left, 3=right
  const [lastPlayedCards] = useState<Card[]>([
    { id: 'AS', rank: 'A', suit: 'S' },
    { id: 'AH', rank: 'A', suit: 'H' },
    { id: 'AC', rank: 'A', suit: 'C' },
    { id: 'KD', rank: 'K', suit: 'D' },
    { id: 'KS', rank: 'K', suit: 'S' },
  ]);

  // Get player username from auth context (fallback to email prefix if no username)
  const currentPlayerName = user?.user_metadata?.username || 
                           user?.email?.split('@')[0] || 
                           'Player';

  // Demo player data - In production, this will come from game state
  // Position 0 (bottom) is always the current authenticated user
  // Positions 1-3 are opponents (bots or other real players)
  const players = useMemo(() => [
    { 
      name: currentPlayerName, // Authenticated user
      cardCount: 13, 
      score: 0, 
      position: 'bottom' as const, 
      isActive: currentTurn === 0 
    },
    { 
      name: 'Opponent 1', // Will be real player name or "Bot 1" from game state
      cardCount: 8, 
      score: 0, 
      position: 'top' as const, 
      isActive: currentTurn === 1 
    },
    { 
      name: 'Opponent 2', // Will be real player name or "Bot 2" from game state
      cardCount: 0, 
      score: 0, 
      position: 'left' as const, 
      isActive: currentTurn === 2 
    },
    { 
      name: 'Opponent 3', // Will be real player name or "Bot 3" from game state
      cardCount: 0, 
      score: 0, 
      position: 'right' as const, 
      isActive: currentTurn === 3 
    },
  ], [currentPlayerName, currentTurn]);

  // Initialize demo hand
  useEffect(() => {
    const deck = createDemoDeck();
    const shuffled = shuffleDemoDeck(deck);
    // Deal 13 cards to player (standard Big2 hand size)
    const hand = shuffled.slice(0, 13);
    setPlayerHand(hand);
  }, [roomCode]);

  // Cleanup: Remove player from room when unmounting
  useEffect(() => {
    return () => {
      // Only cleanup if user exists and we have a valid room code
      if (user?.id && roomCode) {
        console.log(`🧹 [GameScreen] Cleanup: Removing user ${user.id} from room ${roomCode}`);
        
        // Use non-blocking cleanup (don't await)
        // Note: DELETE queries don't support joined table filters, only user_id is sufficient
        supabase
          .from('room_players')
          .delete()
          .eq('user_id', user.id)
          .then(({ error }) => {
            if (error) {
              console.error('❌ [GameScreen] Cleanup error:', error);
            } else {
              console.log('✅ [GameScreen] Successfully removed from room');
            }
          });
      }
    };
  }, [user, roomCode]);

  const handlePlayCards = (cards: Card[]) => {
    console.log('Playing cards:', cards);
    // TODO: Validate and send to game logic
    // Remove played cards from hand
    setPlayerHand((prev) => prev.filter((c) => !cards.some((pc) => pc.id === c.id)));
  };

  const handlePass = () => {
    console.log('Player passed');
    // TODO: Send pass action to game logic
  };

  const handleLeaveGame = () => {
    // Navigate to home screen (resets the navigation stack)
    navigation.reset({
      index: 0,
      routes: [{ name: 'Home' }],
    });
  };

  // Memoize scoreboard players to prevent unnecessary re-renders
  const scoreboardPlayers = useMemo(() => 
    players.map((p, index) => ({ 
      name: p.name, 
      score: p.score,
      isCurrentPlayer: index === 0 // First player is always the authenticated user
    }))
  , [players]);

  return (
    <View style={styles.container}>
      {/* Match Scoreboard (top-left, outside table) */}
      <View style={styles.scoreboardContainer}>
        <MatchScoreboard
          players={scoreboardPlayers}
          currentMatch={1}
        />
      </View>

      {/* Hamburger menu (top-right, outside table) */}
      <Pressable 
        style={styles.menuContainer} 
        onPress={() => setShowSettings(true)}
        accessibilityRole="button"
        accessibilityLabel="Open settings menu"
        accessibilityHint="Opens game settings and options"
      >
        <View style={styles.menuIcon}>
          <View style={styles.menuLine} />
          <View style={styles.menuLine} />
          <View style={styles.menuLine} />
        </View>
      </Pressable>

      {/* Game Settings Modal */}
      <GameSettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        onLeaveGame={handleLeaveGame}
      />

      {/* Top player (Jad) - OUTSIDE table, above it */}
      <View style={styles.topPlayerAboveTable}>
        <PlayerInfo
          name={players[1].name}
          cardCount={players[1].cardCount}
          isActive={players[1].isActive}
        />
      </View>

      {/* Game table area */}
      <View style={styles.tableArea}>
        {/* Middle row: Left player, Center play area, Right player */}
        <View style={styles.middleRow}>
          {/* Left player (Roben) */}
          <View style={styles.leftPlayerContainer}>
            <PlayerInfo
              name={players[2].name}
              cardCount={players[2].cardCount}
              isActive={players[2].isActive}
            />
          </View>

          {/* Center play area (last played cards) */}
          <View style={styles.centerPlayArea}>
            <CenterPlayArea
              lastPlayed={lastPlayedCards}
              lastPlayedBy={players[1].name} // TODO: Track who played last from game state
              combinationType="Full house (A)" // TODO: Calculate from game logic
            />
          </View>

          {/* Right player (James) */}
          <View style={styles.rightPlayerContainer}>
            <PlayerInfo
              name={players[3].name}
              cardCount={players[3].cardCount}
              isActive={players[3].isActive}
            />
          </View>
        </View>
      </View>

      {/* Bottom section: Player info, action buttons, and hand */}
      <View style={styles.bottomSection}>
        {/* Player info with action buttons next to it */}
        <View style={styles.bottomPlayerWithActions}>
          <PlayerInfo
            name={players[0].name}
            cardCount={players[0].cardCount}
            isActive={players[0].isActive}
          />
          
          {/* Action buttons next to player */}
          <View style={styles.actionButtons}>
            <Pressable
              style={[styles.actionButton, styles.passButton, !players[0].isActive && styles.buttonDisabled]}
              onPress={handlePass}
              disabled={!players[0].isActive}
              accessibilityRole="button"
              accessibilityLabel="Pass turn"
              accessibilityState={{ disabled: !players[0].isActive }}
            >
              <Text style={[styles.actionButtonText, styles.passButtonText]}>Pass</Text>
            </Pressable>

            <Pressable
              style={[
                styles.actionButton,
                styles.playButton,
                (!players[0].isActive || selectedCardIds.size === 0) && styles.buttonDisabled,
              ]}
              onPress={() => {
                if (selectedCardIds.size === 0) return;
                const selected = playerHand.filter((card) => selectedCardIds.has(card.id));
                handlePlayCards(selected);
                setSelectedCardIds(new Set()); // Clear selection after play
              }}
              disabled={!players[0].isActive || selectedCardIds.size === 0}
              accessibilityRole="button"
              accessibilityLabel="Play selected cards"
              accessibilityState={{ disabled: !players[0].isActive || selectedCardIds.size === 0 }}
            >
              <Text style={styles.actionButtonText}>Play</Text>
            </Pressable>
          </View>
        </View>

        {/* Player's hand */}
        <View style={styles.cardHandContainer}>
          <CardHand
            cards={playerHand}
            onPlayCards={handlePlayCards}
            onPass={handlePass}
            canPlay={players[0].isActive}
            hideButtons={true} // Hide internal buttons since we display them externally
            selectedCardIds={selectedCardIds}
            onSelectionChange={setSelectedCardIds}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary, // Dark background outside table
  },
  scoreboardContainer: {
    position: 'absolute',
    top: POSITIONING.scoreboardTop,
    left: POSITIONING.scoreboardLeft,
    zIndex: 100,
  },
  menuContainer: {
    position: 'absolute',
    top: POSITIONING.menuTop,
    right: SPACING.md,
    zIndex: 100,
  },
  menuIcon: {
    width: LAYOUT.menuIconSize,
    height: LAYOUT.menuIconSize,
    backgroundColor: OVERLAYS.menuBackground,
    borderRadius: LAYOUT.menuBorderRadius,
    alignItems: 'center',
    justifyContent: 'center',
    gap: LAYOUT.menuLineGap,
  },
  menuLine: {
    width: LAYOUT.menuLineWidth,
    height: LAYOUT.menuLineHeight,
    backgroundColor: COLORS.white,
    borderRadius: POSITIONING.menuLineBorderRadius,
  },
  topPlayerAboveTable: {
    alignItems: 'center',
    paddingTop: LAYOUT.topPlayerSpacing, // Space for scoreboard above
    marginBottom: LAYOUT.topPlayerOverlap, // Slight overlap with table
    zIndex: 50,
  },
  tableArea: {
    width: LAYOUT.tableWidth,
    height: LAYOUT.tableHeight,
    backgroundColor: COLORS.table.background, // Green felt color
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
    top: POSITIONING.sidePlayerTop, // Align with green circle indicator
  },
  bottomSection: {
    marginTop: POSITIONING.bottomSectionMarginTop,
    zIndex: 50,
  },
  bottomPlayerWithActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  actionButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: POSITIONING.actionButtonBorderRadius,
    minWidth: POSITIONING.actionButtonMinWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    backgroundColor: COLORS.accent,
  },
  passButton: {
    backgroundColor: COLORS.gray.dark,
    borderWidth: POSITIONING.passButtonBorderWidth,
    borderColor: COLORS.gray.medium,
  },
  buttonDisabled: {
    opacity: OPACITIES.disabled,
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
  },
  passButtonText: {
    color: COLORS.gray.light,
  },
  cardHandContainer: {
    // Cards display below player and buttons
  },
});
