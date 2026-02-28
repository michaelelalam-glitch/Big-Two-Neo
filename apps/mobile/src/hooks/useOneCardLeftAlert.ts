/**
 * useOneCardLeftAlert — Detects when any player has exactly 1 card left and plays
 * a notification sound + haptic vibration (once per player per detection).
 *
 * Extracted from GameScreen.tsx to reduce file size (~35 lines).
 */

import { useEffect, useRef } from 'react';

import { soundManager, hapticManager, HapticType, SoundType } from '../utils';
import { gameLogger } from '../utils/logger';
import type { Player as MultiplayerPlayer } from '../types/multiplayer';

interface UseOneCardLeftAlertOptions {
  isLocalAIGame: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local game state shape differs from multiplayer
  gameState: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- multiplayer game state shape
  multiplayerGameState: any;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local vs multiplayer game state have different shapes
    const effectiveGameState = isLocalAIGame ? gameState : (multiplayerGameState as any);
    const hands = effectiveGameState?.hands;

    if (!hands || typeof hands !== 'object') return;

    Object.entries(hands).forEach(([playerIndex, cards]) => {
      if (!Array.isArray(cards)) return;

      const key = `${roomCode}-${playerIndex}`;

      if (cards.length === 1 && !oneCardLeftDetectedRef.current.has(key)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local game state players shape differs from multiplayer
        const player = isLocalAIGame
          ? (gameState as any)?.players?.[parseInt(playerIndex)]
          : multiplayerPlayers.find(p => p.player_index === parseInt(playerIndex));

        if (player) {
          const playerName = isLocalAIGame ? player.name : player.username;
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
