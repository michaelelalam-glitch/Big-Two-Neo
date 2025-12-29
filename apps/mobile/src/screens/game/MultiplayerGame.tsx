import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRealtime } from '../../hooks/useRealtime';
import { useBotCoordinator } from '../../hooks/useBotCoordinator';
import { supabase } from '../../services/supabase';
import { gameLogger } from '../../utils/logger';
import { showError } from '../../utils';
import type { MultiplayerGameState } from './types';
import type { ScoreHistory, PlayHistoryMatch, PlayHistoryHand, PlayerPosition } from '../../types/scoreboard';

interface MultiplayerGameProps {
  roomCode: string;
  userId: string;
  currentPlayerName: string;
  addScoreHistory: (entry: ScoreHistory) => void;
  addPlayHistory: (entry: PlayHistoryMatch) => void;
  children: (state: MultiplayerGameState) => React.ReactNode;
}

/**
 * MultiplayerGame - Manages server-side multiplayer game logic
 * Extracts all multiplayer state management from GameScreen
 */
export function MultiplayerGame({
  roomCode,
  userId,
  currentPlayerName,
  addScoreHistory,
  addPlayHistory,
  children,
}: MultiplayerGameProps) {
  // State for multiplayer room data
  const [multiplayerRoomId, setMultiplayerRoomId] = useState<string | null>(null);
  const [multiplayerPlayers, setMultiplayerPlayers] = useState<any[]>([]);

  // Initialize multiplayer room data
  useEffect(() => {
    const loadMultiplayerRoom = async () => {
      try {
        const { data: roomData, error: roomError } = await supabase
          .from('rooms')
          .select('id')
          .eq('code', roomCode)
          .single();

        if (roomError || !roomData) {
          gameLogger.error('[MultiplayerGame] Failed to load room:', roomError);
          return;
        }

        setMultiplayerRoomId(roomData.id);

        const { data: playersData, error: playersError } = await supabase
          .from('room_players')
          .select('*')
          .eq('room_id', roomData.id)
          .order('player_index');

        if (playersError) {
          gameLogger.error('[MultiplayerGame] Failed to load players:', playersError);
          return;
        }

        setMultiplayerPlayers(playersData || []);
      } catch (error: any) {
        gameLogger.error('[MultiplayerGame] Error loading room:', error);
      }
    };

    loadMultiplayerRoom();
  }, [roomCode]);

  // Server-side multiplayer game state
  const {
    gameState: multiplayerGameState,
    playerHands,
    isConnected: isMultiplayerConnected,
    isHost: isMultiplayerHost,
    isDataReady: isMultiplayerDataReady,
    players: realtimePlayers,
    playCards: multiplayerPlayCards,
    pass: multiplayerPass,
    connectToRoom: multiplayerConnectToRoom,
  } = useRealtime({
    userId,
    username: currentPlayerName,
    onError: (error) => {
      gameLogger.error('[MultiplayerGame] Error:', error.message);
      if (!error.message.includes('connection') && !error.message.includes('reconnect')) {
        showError(error.message);
      }
    },
    onDisconnect: () => {
      gameLogger.warn('[MultiplayerGame] Disconnected');
    },
    onReconnect: () => {
      gameLogger.info('[MultiplayerGame] Reconnected successfully');
    },
    onMatchEnded: (matchNumber, matchScores) => {
      gameLogger.info(`[MultiplayerGame] 🏆 Match ${matchNumber} ended!`, matchScores);

      const pointsAdded: number[] = [];
      const cumulativeScores: number[] = [];

      const sortedScores = [...matchScores].sort((a, b) => a.player_index - b.player_index);

      sortedScores.forEach((score) => {
        pointsAdded.push(score.matchScore);
        cumulativeScores.push(score.cumulativeScore);
      });

      const scoreHistoryEntry: ScoreHistory = {
        matchNumber,
        pointsAdded,
        scores: cumulativeScores,
        timestamp: new Date().toISOString(),
      };

      addScoreHistory(scoreHistoryEntry);
    },
  });

  // Connect to room when component mounts
  useEffect(() => {
    if (!userId) return;

    multiplayerConnectToRoom(roomCode).catch((error: any) => {
      console.error('[MultiplayerGame] ❌ Failed to connect:', error);
      gameLogger.error('[MultiplayerGame] Failed to connect:', error?.message || String(error));
      showError(error?.message || 'Failed to connect to room');
    });
  }, [roomCode, userId, multiplayerConnectToRoom]);

  // Extract hands by player index
  const multiplayerHandsByIndex = useMemo(() => {
    const hands = (multiplayerGameState as any)?.hands as
      | Record<string, Array<{ id: string; rank: string; suit: string }>>
      | undefined;
    return hands;
  }, [multiplayerGameState]);

  // Merge player hands into players for bot coordinator
  const playersWithCards = useMemo(() => {
    if (!multiplayerPlayers) {
      return [];
    }

    const hasHands = !!multiplayerHandsByIndex;

    return multiplayerPlayers.map((player) => {
      const playerHandKey = String(player.player_index);
      const playerHand = hasHands ? multiplayerHandsByIndex[playerHandKey] : undefined;

      return {
        ...player,
        player_id: player.id,
        cards: Array.isArray(playerHand) ? playerHand : [],
      };
    });
  }, [multiplayerHandsByIndex, multiplayerPlayers]);

  // Bot coordinator (MULTIPLAYER games with bots, HOST only)
  useBotCoordinator({
    roomCode,
    isCoordinator:
      isMultiplayerDataReady && isMultiplayerHost && playersWithCards.length > 0,
    gameState: multiplayerGameState,
    players: playersWithCards,
    playCards: multiplayerPlayCards,
    passMove: multiplayerPass,
  });

  // Calculate seat index for current player
  const multiplayerSeatIndex = useMemo(() => {
    const me = multiplayerPlayers.find((p) => p.user_id === userId);
    return typeof me?.player_index === 'number' ? me.player_index : 0;
  }, [multiplayerPlayers, userId]);

  // Extract current player's hand
  const multiplayerPlayerHand = useMemo(() => {
    const raw = multiplayerHandsByIndex?.[String(multiplayerSeatIndex)];
    return Array.isArray(raw) ? (raw as any[]) : [];
  }, [multiplayerHandsByIndex, multiplayerSeatIndex]);

  // Sync play history from multiplayer game state to scoreboard
  useEffect(() => {
    if (!multiplayerGameState) return;

    const playHistoryArray = (multiplayerGameState as any)?.play_history;

    if (!Array.isArray(playHistoryArray) || playHistoryArray.length === 0) {
      return;
    }

    const playsByMatch: Record<number, PlayHistoryHand[]> = {};

    playHistoryArray.forEach((play: any) => {
      if (play.passed || !play.cards || play.cards.length === 0) return;

      const matchNum = play.match_number || 1;

      if (!playsByMatch[matchNum]) {
        playsByMatch[matchNum] = [];
      }

      playsByMatch[matchNum].push({
        by: play.position as PlayerPosition,
        type: play.combo_type || 'single',
        count: play.cards.length,
        cards: play.cards,
      });
    });

    Object.entries(playsByMatch).forEach(([matchNumStr, hands]) => {
      const matchNum = parseInt(matchNumStr, 10);
      const matchData: PlayHistoryMatch = {
        matchNumber: matchNum,
        hands,
      };
      addPlayHistory(matchData);
    });
  }, [multiplayerGameState, addPlayHistory]);

  // Return render prop with multiplayer game state
  return (
    <>
      {children({
        gameState: multiplayerGameState,
        playerHands: playerHands as any,
        isConnected: isMultiplayerConnected,
        isHost: isMultiplayerHost,
        isDataReady: isMultiplayerDataReady,
        players: multiplayerPlayers,
        multiplayerSeatIndex,
        multiplayerPlayerHand,
        playCards: multiplayerPlayCards,
        pass: multiplayerPass,
      })}
    </>
  );
}
