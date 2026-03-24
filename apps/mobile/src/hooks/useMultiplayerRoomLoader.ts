/**
 * useMultiplayerRoomLoader — Loads multiplayer room data (players + room info) from Supabase.
 *
 * Extracted from GameScreen.tsx to reduce file size (~45 lines).
 * On mount (for multiplayer games only), fetches room_players for the given room code.
 * Also fetches room metadata (ranked_mode, is_public) used to determine game_type for stats.
 */

import { useEffect } from 'react';
import type { StackNavigationProp } from '@react-navigation/stack';

import { supabase } from '../services/supabase';
import { showError } from '../utils';
import { gameLogger } from '../utils/logger';
import type { Player as MultiplayerPlayer } from '../types/multiplayer';
import type { RootStackParamList } from '../navigation/AppNavigator';

export interface RoomInfo {
  id: string;
  code: string;
  ranked_mode: boolean;
  is_public: boolean;
  is_matchmaking: boolean;
}

interface UseMultiplayerRoomLoaderOptions {
  isMultiplayerGame: boolean;
  roomCode: string;
  navigation: StackNavigationProp<RootStackParamList, 'Game'>;
  setMultiplayerPlayers: React.Dispatch<React.SetStateAction<MultiplayerPlayer[]>>;
  setRoomInfo?: React.Dispatch<React.SetStateAction<RoomInfo | null>>;
}

export function useMultiplayerRoomLoader({
  isMultiplayerGame,
  roomCode,
  navigation,
  setMultiplayerPlayers,
  setRoomInfo,
}: UseMultiplayerRoomLoaderOptions): void {
  useEffect(() => {
    if (!isMultiplayerGame) return;

    const loadMultiplayerRoom = async () => {
      try {
        const { data: roomData, error: roomError } = await supabase
          .from('rooms')
          .select('id, code, ranked_mode, is_public, is_matchmaking')
          .eq('code', roomCode)
          .single();

        if (roomError || !roomData) {
          gameLogger.error('[GameScreen] Multiplayer room not found:', roomError);
          showError('Room not found');
          navigation.replace('Home');
          return;
        }

        // Store room info for stats upload
        if (setRoomInfo) {
          setRoomInfo({
            id: roomData.id,
            code: roomData.code,
            ranked_mode: roomData.ranked_mode ?? false,
            is_public: roomData.is_public ?? true,
            is_matchmaking: roomData.is_matchmaking ?? false,
          });
        }

        // Load players
        const { data: playersData, error: playersError } = await supabase
          .from('room_players')
          .select('*')
          .eq('room_id', roomData.id)
          .order('player_index');

        if (playersError) throw playersError;

        setMultiplayerPlayers(playersData || []);
        gameLogger.info(`[GameScreen] Loaded ${playersData?.length || 0} players from room`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        gameLogger.error('[GameScreen] Error loading multiplayer room:', msg);
      }
    };

    loadMultiplayerRoom();
  }, [isMultiplayerGame, roomCode, navigation, setMultiplayerPlayers, setRoomInfo]);
}
