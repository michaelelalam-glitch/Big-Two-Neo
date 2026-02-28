/**
 * useMultiplayerRoomLoader — Loads multiplayer room data (players) from Supabase.
 *
 * Extracted from GameScreen.tsx to reduce file size (~45 lines).
 * On mount (for multiplayer games only), fetches room_players for the given room code.
 */

import { useEffect } from 'react';
import type { StackNavigationProp } from '@react-navigation/stack';

import { supabase } from '../services/supabase';
import { showError } from '../utils';
import { gameLogger } from '../utils/logger';
import type { Player as MultiplayerPlayer } from '../types/multiplayer';
import type { RootStackParamList } from '../navigation/AppNavigator';

interface UseMultiplayerRoomLoaderOptions {
  isMultiplayerGame: boolean;
  roomCode: string;
  navigation: StackNavigationProp<RootStackParamList, 'Game'>;
  setMultiplayerPlayers: React.Dispatch<React.SetStateAction<MultiplayerPlayer[]>>;
}

export function useMultiplayerRoomLoader({
  isMultiplayerGame,
  roomCode,
  navigation,
  setMultiplayerPlayers,
}: UseMultiplayerRoomLoaderOptions): void {
  useEffect(() => {
    if (!isMultiplayerGame) return;

    const loadMultiplayerRoom = async () => {
      try {
        const { data: roomData, error: roomError } = await supabase
          .from('rooms')
          .select('id')
          .eq('code', roomCode)
          .single();

        if (roomError || !roomData) {
          gameLogger.error('[GameScreen] Multiplayer room not found:', roomError);
          showError('Room not found');
          navigation.replace('Home');
          return;
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
  }, [isMultiplayerGame, roomCode, navigation, setMultiplayerPlayers]);
}
