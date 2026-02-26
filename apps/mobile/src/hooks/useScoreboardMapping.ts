import { useMemo } from 'react';
import type { GameState } from '../game/state';

/**
 * Maps players array to scoreboard display order [0, 3, 1, 2]
 * Matches counter-clockwise physical positions: You → Bot1(right) → Bot2(top) → Bot3(left)
 * @param players - Array of 4 items in game state order
 * @param mapper - Function to extract desired property from each item
 * @returns Array of values in scoreboard display order
 */
function mapPlayersToScoreboardOrder<T, U>(players: T[], mapper: (player: T) => U): U[] {
  // Scoreboard display order: [player 0, player 3, player 1, player 2]
  // Physical layout (both portrait & landscape):
  //   - Player 0: You (bottom)
  //   - Player 3: Bot 1 (right - next in counter-clockwise turn order)
  //   - Player 1: Bot 2 (top)
  //   - Player 2: Bot 3 (left)
  return [mapper(players[0]), mapper(players[3]), mapper(players[1]), mapper(players[2])];
}

/**
 * Maps game state player index to scoreboard display position
 * @param gameIndex - Player index in game state (0-3)
 * @returns Position index in scoreboard display (0-3)
 */
function mapGameIndexToScoreboardPosition(gameIndex: number): number {
  // Mapping: game index -> scoreboard position
  // 0 -> 0 (You)
  // 3 -> 1 (Bot 1, right position)
  // 1 -> 2 (Bot 2, top position)
  // 2 -> 3 (Bot 3, left position)
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

    // Return players in player index order (0, 1, 2, 3) for scoreboard
    // This ensures scoreboard shows: Steve → Bot 1 → Bot 2 → Bot 3
    // regardless of their physical layout positions
    return gameState.players.map((player, index) => {
      // Map player index to layout position
      const positionMap: Record<number, 'bottom' | 'top' | 'left' | 'right'> = {
        0: 'bottom', // Player 0 is always bottom
        1: 'top',    // Player 1 is top (opposite)
        2: 'left',   // Player 2 is left
        3: 'right',  // Player 3 is right
      };

      return {
        name: player.name,
        cardCount: player.hand.length,
        score: getPlayerScore(player.id),
        position: positionMap[index],
        isActive: gameState.currentPlayerIndex === index,
      };
    });
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
