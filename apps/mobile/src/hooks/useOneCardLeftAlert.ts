/**
 * useOneCardLeftAlert — Detects when any player has exactly 1 card left and plays
 * a notification sound + haptic vibration (once per player per detection).
 *
 * Extracted from GameScreen.tsx to reduce file size (~35 lines).
 */

import { useEffect, useRef } from 'react';

import { soundManager, hapticManager, HapticType, SoundType } from '../utils';
import { gameLogger } from '../utils/logger';
import type { Player as MultiplayerPlayer, GameState as MultiplayerGameState } from '../types/multiplayer';
import type { GameState as LocalGameState } from '../game/state';

interface UseOneCardLeftAlertOptions {
  isLocalAIGame: boolean;
  gameState: LocalGameState | null;
  multiplayerGameState: MultiplayerGameState | null;
  multiplayerPlayers: MultiplayerPlayer[];
  roomCode: string;
}

export function useOneCardLeftAlert({
  isLocalAIGame,
  gameState,
  multiplayerGameState,
  multiplayerPlayers,
  roomCode,
}: UseOneCardLeftAlertOptions): void {
  const oneCardLeftDetectedRef = useRef(new Set<string>());

  useEffect(() => {
    // Derive hands map from either local or multiplayer game state
    let hands: Record<string, unknown[]> | undefined;

    if (isLocalAIGame) {
      const players = gameState?.players;
      if (!players || !Array.isArray(players)) return;
      hands = players.reduce<Record<string, unknown[]>>((acc, player, index) => {
        acc[String(index)] = Array.isArray(player.hand) ? player.hand : [];
        return acc;
      }, {});
    } else {
      hands = multiplayerGameState?.hands as Record<string, unknown[]> | undefined;
    }

    if (!hands || typeof hands !== 'object') return;

    Object.entries(hands).forEach(([playerIndex, cards]) => {
      if (!Array.isArray(cards)) return;

      const key = `${roomCode}-${playerIndex}`;

      if (cards.length === 1 && !oneCardLeftDetectedRef.current.has(key)) {
        const player = isLocalAIGame
          ? gameState?.players?.[parseInt(playerIndex)]
          : multiplayerPlayers.find(p => p.player_index === parseInt(playerIndex));

        if (player) {
          const playerName = 'name' in player ? player.name : ('username' in player ? player.username : 'Unknown');
          gameLogger.info(`🚨 [One Card Alert] ${playerName} (index ${playerIndex}) has 1 card remaining`);

          try {
            soundManager.playSound(SoundType.TURN_NOTIFICATION);
            hapticManager.trigger(HapticType.WARNING);
          } catch (error) {
            gameLogger.error('Error showing one-card-left notification', { error, playerName, playerIndex });
          }

          oneCardLeftDetectedRef.current.add(key);
        }
      } else if (cards.length > 1 && oneCardLeftDetectedRef.current.has(key)) {
        oneCardLeftDetectedRef.current.delete(key);
      }
    });
  }, [isLocalAIGame, gameState, multiplayerGameState, multiplayerPlayers, roomCode]);
}
