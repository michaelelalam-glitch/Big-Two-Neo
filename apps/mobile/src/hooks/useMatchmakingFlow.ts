/**
 * useMatchmakingFlow — H5 Audit fix (Task #637)
 *
 * Owns all matchmaking RPC state and logic for HomeScreen:
 *   - Casual (quick-play) room search / create
 *   - Ranked room search / create
 *   - Find-Game and Bot-Difficulty modal visibility
 *   - Auto-navigate effect when useMatchmaking signals a match found
 *   - Offline practice entry point
 *
 * Extracted from HomeScreen.tsx which was 1,643 LOC.
 */
import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { User } from '@supabase/supabase-js';
import type { Profile } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { showError } from '../utils';
import { roomLogger } from '../utils/logger';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { RoomPlayerWithRoom } from '../types';
import { trackEvent } from '../services/analytics';
import { useMatchmaking } from './useMatchmaking';
import { VOLUNTARILY_LEFT_ROOMS_KEY } from './useActiveGameBanner';

type HomeNavProp = StackNavigationProp<RootStackParamList, 'Home'>;

export interface UseMatchmakingFlowResult {
  isQuickPlaying: boolean;
  isRankedSearching: boolean;
  setIsRankedSearching: React.Dispatch<React.SetStateAction<boolean>>;
  showFindGameModal: boolean;
  setShowFindGameModal: React.Dispatch<React.SetStateAction<boolean>>;
  showDifficultyModal: boolean;
  setShowDifficultyModal: React.Dispatch<React.SetStateAction<boolean>>;
  handleCasualMatch: () => Promise<void>;
  handleRankedMatch: (retryCount?: number) => Promise<void>;
  handleOfflinePractice: () => Promise<void>;
  handleStartOfflineWithDifficulty: (difficulty: 'easy' | 'medium' | 'hard') => void;
}

export function useMatchmakingFlow(
  user: User | null | undefined,
  profile: Profile | null,
  navigation: HomeNavProp,
  checkGameExclusivity: (targetType: 'online' | 'offline') => Promise<boolean>,
  setCurrentRoom: (room: string | null) => void
): UseMatchmakingFlowResult {
  const [isQuickPlaying, setIsQuickPlaying] = useState(false);
  const [isRankedSearching, setIsRankedSearching] = useState(false);
  const [showFindGameModal, setShowFindGameModal] = useState(false);
  const [showDifficultyModal, setShowDifficultyModal] = useState(false);

  const { matchFound, roomCode: rankedRoomCode, resetMatch } = useMatchmaking();

  // Auto-navigate when the ranked matchmaking hook signals a match found.
  useEffect(() => {
    if (matchFound && rankedRoomCode) {
      roomLogger.info(`[HomeScreen] 🎉 Ranked match found! Navigating to: ${rankedRoomCode}`);
      setIsRankedSearching(false);
      resetMatch();
      setTimeout(() => {
        navigation.replace('Lobby', { roomCode: rankedRoomCode });
      }, 100);
    }
  }, [matchFound, rankedRoomCode, navigation, resetMatch]);

  const handleRankedMatch = useCallback(
    async (retryCount = 0): Promise<void> => {
      const MAX_RETRIES = 3;
      if (!user || !profile) {
        showError('You must be signed in for ranked matches');
        return;
      }
      if (retryCount === 0) {
        const canProceed = await checkGameExclusivity('online');
        if (!canProceed) return;
      }
      roomLogger.info(
        `🏆 Ranked Match started for user: ${user.id} (attempt ${retryCount + 1}/${MAX_RETRIES})`
      );
      setShowFindGameModal(false);
      setIsRankedSearching(true);
      try {
        roomLogger.info('🧹 Cleaning up any zombie room_player entries...');
        const { error: cleanupError } = await supabase
          .from('room_players')
          .delete()
          .eq('user_id', user.id);
        if (cleanupError) roomLogger.error('⚠️ Cleanup warning:', cleanupError.message);

        await new Promise(resolve => setTimeout(resolve, 100));

        const { data: stillInRoom } = await supabase
          .from('room_players')
          .select('room_id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (stillInRoom) {
          roomLogger.error('❌ Cleanup failed - user still in room:', stillInRoom.room_id);
          throw new Error('Failed to leave previous room. Please try again.');
        }

        roomLogger.info('📡 Searching for joinable ranked rooms...');
        const { data: availableRooms, error: searchError } = await supabase
          .from('rooms')
          .select('id, code, status')
          .eq('status', 'waiting')
          .eq('is_public', true)
          .eq('is_matchmaking', true)
          .eq('ranked_mode', true)
          .order('created_at', { ascending: true })
          .limit(5);
        if (searchError) throw searchError;
        roomLogger.info(`📊 Found ${availableRooms?.length || 0} potential ranked rooms`);

        if (availableRooms && availableRooms.length > 0) {
          for (const room of availableRooms) {
            const { count } = await supabase
              .from('room_players')
              .select('*', { count: 'exact', head: true })
              .eq('room_id', room.id);
            roomLogger.info(`  Ranked Room ${room.code}: ${count}/4 players`);
            if (count !== null && count < 4) {
              roomLogger.info(`✅ Joining ranked room ${room.code}...`);
              const username = profile.username || `Player_${user.id.substring(0, 8)}`;
              const { error: joinError } = await supabase.rpc('join_room_atomic', {
                p_room_code: room.code,
                p_user_id: user.id,
                p_username: username,
              });
              if (joinError) {
                roomLogger.error(`❌ Failed to join ${room.code}:`, joinError.message);
                continue;
              }
              roomLogger.info(`🎉 Successfully joined existing ranked room: ${room.code}`);
              setCurrentRoom(room.code);
              setIsRankedSearching(false);
              trackEvent('room_join_method', { method: 'matchmaking', match_type: 'ranked' });
              navigation.replace('Lobby', { roomCode: room.code });
              return;
            }
          }
        }

        roomLogger.info('🆕 Creating new ranked room...');
        const username = profile.username || `Player_${user.id.substring(0, 8)}`;
        const { data: roomResult, error: createError } = await supabase.rpc('get_or_create_room', {
          p_user_id: user.id,
          p_username: username,
          p_is_public: true,
          p_is_matchmaking: true,
          p_ranked_mode: true,
        });
        if (createError) {
          roomLogger.error('❌ Ranked room creation failed:', createError.message);
          if (createError.message?.includes('collision') && retryCount < MAX_RETRIES) {
            roomLogger.info(
              `🔄 Collision detected, retrying (${retryCount + 1}/${MAX_RETRIES})...`
            );
            setIsRankedSearching(false);
            return handleRankedMatch(retryCount + 1);
          }
          throw createError;
        }
        const result = roomResult as { success: boolean; room_code: string; attempts: number };
        if (!result || !result.success || !result.room_code)
          throw new Error('Failed to create ranked room');
        roomLogger.info(`🎉 Ranked room created: ${result.room_code}`);
        setCurrentRoom(result.room_code);
        setIsRankedSearching(false);
        trackEvent('room_join_method', { method: 'matchmaking', match_type: 'ranked' });
        navigation.replace('Lobby', { roomCode: result.room_code });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        roomLogger.error('❌ Error with ranked match:', msg);
        showError(msg || 'Failed to start ranked match');
        setIsRankedSearching(false);
      }
    },
    [user, profile, navigation, checkGameExclusivity, setCurrentRoom]
  );

  const handleQuickPlay = useCallback(
    async (retryCount = 0): Promise<void> => {
      const MAX_RETRIES = 3;
      if (!user || !profile) {
        showError('You must be signed in to play');
        return;
      }
      roomLogger.info(
        `🎮 Casual Match started for user: ${user.id} (attempt ${retryCount + 1}/${MAX_RETRIES})`
      );
      setIsQuickPlaying(true);
      try {
        roomLogger.info('🔍 Checking for existing active room...');
        const { data: existingRoomPlayer, error: checkError } = await supabase
          .from('room_players')
          .select('room_id, rooms!inner(code, status)')
          .eq('user_id', user.id)
          .in('rooms.status', ['waiting', 'playing'])
          .single();
        if (checkError && checkError.code !== 'PGRST116') {
          roomLogger.error('❌ Error checking existing room:', checkError);
          throw checkError;
        }
        const roomPlayer = existingRoomPlayer as RoomPlayerWithRoom | null;
        if (roomPlayer) {
          // Skip redirect if the user voluntarily left this room (e.g. via banner leave).
          // Voluntarily-left room IDs are persisted in AsyncStorage by useActiveGameBanner.
          let voluntarilyLeft = new Set<string>();
          try {
            const raw = await AsyncStorage.getItem(VOLUNTARILY_LEFT_ROOMS_KEY);
            if (raw) voluntarilyLeft = new Set<string>(JSON.parse(raw));
          } catch {
            /* ignore — proceed without filter */
          }

          if (voluntarilyLeft.has(roomPlayer.room_id)) {
            roomLogger.info(
              '🚫 Skipping stale room (voluntarily left via banner):',
              roomPlayer.rooms.code
            );
            // Fall through to cleanup + create new room
          } else {
            roomLogger.info('✅ User already in active room:', roomPlayer.rooms.code);
            setCurrentRoom(roomPlayer.rooms.code);
            navigation.replace('Lobby', { roomCode: roomPlayer.rooms.code });
            return;
          }
        }

        roomLogger.info('🧹 Cleaning up any zombie room_player entries...');
        const { error: cleanupError } = await supabase
          .from('room_players')
          .delete()
          .eq('user_id', user.id);
        if (cleanupError) roomLogger.error('⚠️ Cleanup warning:', cleanupError.message);

        await new Promise(resolve => setTimeout(resolve, 100));

        const { data: stillInRoom } = await supabase
          .from('room_players')
          .select('room_id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (stillInRoom) {
          roomLogger.error('❌ Cleanup failed - user still in room:', stillInRoom.room_id);
          throw new Error('Failed to leave previous room. Please try again.');
        }

        roomLogger.info('📡 Searching for joinable casual rooms...');
        const { data: availableRooms, error: searchError } = await supabase
          .from('rooms')
          .select('id, code, status')
          .eq('status', 'waiting')
          .eq('is_public', true)
          .eq('is_matchmaking', true)
          .eq('ranked_mode', false)
          .order('created_at', { ascending: true })
          .limit(5);
        if (searchError) {
          roomLogger.error('❌ Search error:', searchError);
          throw searchError;
        }
        roomLogger.info(`📊 Found ${availableRooms?.length || 0} potential rooms`);

        if (availableRooms && availableRooms.length > 0) {
          for (const room of availableRooms) {
            const { count } = await supabase
              .from('room_players')
              .select('*', { count: 'exact', head: true })
              .eq('room_id', room.id);
            roomLogger.info(`  Room ${room.code}: ${count}/4 players`);
            if (count !== null && count < 4) {
              roomLogger.info(`✅ Joining room ${room.code} via atomic join...`);
              const username = profile.username || `Player_${user.id.substring(0, 8)}`;
              const { error: joinError } = await supabase.rpc('join_room_atomic', {
                p_room_code: room.code,
                p_user_id: user.id,
                p_username: username,
              });
              if (joinError) {
                roomLogger.error(`❌ Failed to join ${room.code}:`, joinError.message);
                continue;
              }
              roomLogger.info(`🎉 Successfully joined existing room: ${room.code}`);
              setCurrentRoom(room.code);
              trackEvent('room_join_method', { method: 'matchmaking', match_type: 'casual' });
              navigation.replace('Lobby', { roomCode: room.code });
              return;
            }
          }
        }

        roomLogger.info('🆕 Creating new casual room using get_or_create_room RPC...');
        const username = profile.username || `Player_${user.id.substring(0, 8)}`;
        const { data: roomResult, error: createError } = await supabase.rpc('get_or_create_room', {
          p_user_id: user.id,
          p_username: username,
          p_is_public: true,
          p_is_matchmaking: true,
          p_ranked_mode: false,
        });
        if (createError) {
          roomLogger.error('❌ Room creation failed:', createError.message);
          if (createError.message?.includes('collision') && retryCount < MAX_RETRIES) {
            roomLogger.info(
              `🔄 Collision detected, retrying (${retryCount + 1}/${MAX_RETRIES})...`
            );
            setIsQuickPlaying(false);
            return handleQuickPlay(retryCount + 1);
          }
          throw createError;
        }
        const result = roomResult as { success: boolean; room_code: string; attempts: number };
        if (!result || !result.success || !result.room_code) {
          throw new Error('Failed to create room: Invalid response from server');
        }
        roomLogger.info(
          `🎉 Room created successfully: ${result.room_code} (${result.attempts} attempts)`
        );
        setCurrentRoom(result.room_code);
        trackEvent('room_join_method', { method: 'matchmaking', match_type: 'casual' });
        navigation.replace('Lobby', { roomCode: result.room_code });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        roomLogger.error('❌ Error with quick play:', msg);
        showError(msg || 'Failed to join or create room');
      } finally {
        roomLogger.info('🏁 Quick Play finished');
        setIsQuickPlaying(false);
      }
    },
    [user, profile, navigation, setCurrentRoom]
  );

  const handleCasualMatch = useCallback(async () => {
    const canProceed = await checkGameExclusivity('online');
    if (!canProceed) return;
    setShowFindGameModal(false);
    handleQuickPlay();
  }, [checkGameExclusivity, handleQuickPlay]);

  const handleOfflinePractice = useCallback(async () => {
    const canProceed = await checkGameExclusivity('offline');
    if (!canProceed) return;
    setShowDifficultyModal(true);
  }, [checkGameExclusivity]);

  const handleStartOfflineWithDifficulty = useCallback(
    (difficulty: 'easy' | 'medium' | 'hard') => {
      setShowDifficultyModal(false);
      roomLogger.info(`🤖 Starting Offline Practice Mode with ${difficulty} bots...`);
      navigation.navigate('Game', {
        roomCode: 'LOCAL_AI_GAME',
        forceNewGame: true,
        botDifficulty: difficulty,
      });
    },
    [navigation]
  );

  return {
    isQuickPlaying,
    isRankedSearching,
    setIsRankedSearching,
    showFindGameModal,
    setShowFindGameModal,
    showDifficultyModal,
    setShowDifficultyModal,
    handleCasualMatch,
    handleRankedMatch,
    handleOfflinePractice,
    handleStartOfflineWithDifficulty,
  };
}
