import { useMemo } from 'react';
import type { GameState, Player } from '../game/state';

/**
 * Maps players array to scoreboard display order [0, 3, 1, 2]
 * This order places the user at top-left, then arranges bots clockwise
 * @param players - Array of 4 players in game state order
 * @param mapper - Function to extract desired property from each player
 * @returns Array of values in scoreboard display order
 */
function mapPlayersToScoreboardOrder<T>(players: Player[], mapper: (player: Player) => T): T[] {
  // Scoreboard display order: [player 0, player 3, player 1, player 2]
  // This creates a clockwise arrangement: user (top-left), bot3 (top-right), bot1 (bottom-left), bot2 (bottom-right)
  return [mapper(players[0]), mapper(players[3]), mapper(players[1]), mapper(players[2])];
}

/**
 * Maps game state player index to scoreboard display position
 * @param gameIndex - Player index in game state (0-3)
 * @returns Position index in scoreboard display (0-3)
 */
function mapGameIndexToScoreboardPosition(gameIndex: number): number {
  // Mapping: game index -> scoreboard position
  // 0 -> 0 (user stays at position 0)
  // 3 -> 1 (bot3 to position 1)
  // 1 -> 2 (bot1 to position 2)
  // 2 -> 3 (bot2 to position 3)
  const mapping: Record<number, number> = { 0: 0, 3: 1, 1: 2, 2: 3 };
  return mapping[gameIndex] ?? 0;
}

interface UseScoreboardMappingParams {
  gameState: GameState | null;
  currentPlayerName: string;
}

interface PlayerInfo {
  name: string;
  cardCount: number;
  score: number;
  position: 'bottom' | 'top' | 'left' | 'right';
  isActive: boolean;
}

/**
 * Custom hook to handle scoreboard player mapping and data transformation
 * Extracted from GameScreen to reduce complexity
 */
export function useScoreboardMapping({
  gameState,
  currentPlayerName,
}: UseScoreboardMappingParams) {
  // Map game state players to UI format
  const players = useMemo((): PlayerInfo[] => {
    // Return placeholder while loading OR if players don't have hands yet (initialization race condition)
    if (
      !gameState ||
      !gameState.players ||
      gameState.players.length !== 4 ||
      !gameState.players[0]?.hand
    ) {
      // Return placeholder while loading
      return [
        {
          name: currentPlayerName,
          cardCount: 13,
          score: 0,
          position: 'bottom' as const,
          isActive: true,
        },
        {
          name: 'Opponent 1',
          cardCount: 13,
          score: 0,
          position: 'top' as const,
          isActive: false,
        },
        {
          name: 'Opponent 2',
          cardCount: 13,
          score: 0,
          position: 'left' as const,
          isActive: false,
        },
        {
          name: 'Opponent 3',
          cardCount: 13,
          score: 0,
          position: 'right' as const,
          isActive: false,
        },
      ];
    }

    // Helper function to get player score by ID
    const getPlayerScore = (playerId: string): number => {
      const playerScore = gameState.matchScores.find((s) => s.playerId === playerId);
      return playerScore?.score || 0;
    };

    return [
      {
        name: gameState.players[0].name, // Bottom (player)
        cardCount: gameState.players[0].hand.length,
        score: getPlayerScore(gameState.players[0].id),
        position: 'bottom' as const,
        isActive: gameState.currentPlayerIndex === 0,
      },
      {
        name: gameState.players[1].name, // Top
        cardCount: gameState.players[1].hand.length,
        score: getPlayerScore(gameState.players[1].id),
        position: 'top' as const,
        isActive: gameState.currentPlayerIndex === 1,
      },
      {
        name: gameState.players[2].name, // Left
        cardCount: gameState.players[2].hand.length,
        score: getPlayerScore(gameState.players[2].id),
        position: 'left' as const,
        isActive: gameState.currentPlayerIndex === 2,
      },
      {
        name: gameState.players[3].name, // Right
        cardCount: gameState.players[3].hand.length,
        score: getPlayerScore(gameState.players[3].id),
        position: 'right' as const,
        isActive: gameState.currentPlayerIndex === 3,
      },
    ];
  }, [gameState, currentPlayerName]);

  // Memoize scoreboard players to prevent unnecessary re-renders
  const scoreboardPlayers = useMemo(
    () =>
      players.map((p, index) => ({
        name: p.name,
        score: p.score,
        isCurrentPlayer: index === 0, // First player is always the authenticated user
      })),
    [players]
  );

  return {
    players,
    scoreboardPlayers,
    mapPlayersToScoreboardOrder,
    mapGameIndexToScoreboardPosition,
  };
}
