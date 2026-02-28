/**
 * ActiveGameBanner - Always rendered on the Home screen.
 *
 * When the user has an active game (offline or online) it shows game info with
 * rejoin/resume/leave actions.  When no game is active it renders a lightweight
 * "No Game in Progress" idle banner so the layout is stable.
 *
 * Features:
 * - Detects offline games via AsyncStorage (@big2_game_state)
 * - Detects online games via Supabase room_players query
 * - For online games: shows a 60-second countdown before bot replacement
 * - Option to rejoin/resume, leave, or replace the bot after 60s
 * - Smooth entrance animation
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';

const GAME_STATE_KEY = '@big2_game_state';
const BOT_REPLACEMENT_SECONDS = 60;

export type ActiveGameType = 'offline' | 'online';

export interface ActiveGameInfo {
  type: ActiveGameType;
  /** For online: room code. For offline: 'LOCAL_AI_GAME' */
  roomCode: string;
  /** For online: room status */
  roomStatus?: 'waiting' | 'playing';
  /** Match number from offline game state */
  matchNumber?: number;
  /** Whether the game is still in progress (not ended) */
  isActive: boolean;
}

interface ActiveGameBannerProps {
  /** Online room code from parent (existing HomeScreen check) */
  onlineRoomCode: string | null;
  /** Online room status */
  onlineRoomStatus?: 'waiting' | 'playing';
  /** Called when user wants to rejoin/resume */
  onResume: (gameInfo: ActiveGameInfo) => void;
  /** Called when user wants to leave/discard */
  onLeave: (gameInfo: ActiveGameInfo) => void;
  /** Called when bot replacement countdown expires (online only) */
  onBotReplaced?: () => void;
  /** Called when user wants to replace the bot after 60s */
  onReplaceBotAndRejoin?: (roomCode: string) => void;
  /** Timestamp when the user left the online game (for countdown) */
  disconnectTimestamp?: number | null;
  /** Increment to force re-check of offline game state (e.g. after discard) */
  refreshTrigger?: number;
}

export const ActiveGameBanner: React.FC<ActiveGameBannerProps> = ({
  onlineRoomCode,
  onlineRoomStatus,
  onResume,
  onLeave,
  onBotReplaced,
  onReplaceBotAndRejoin,
  disconnectTimestamp,
  refreshTrigger,
}) => {
  const [offlineGameInfo, setOfflineGameInfo] = useState<ActiveGameInfo | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [botHasReplaced, setBotHasReplaced] = useState(false);
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Check for offline game in AsyncStorage
  const checkOfflineGame = useCallback(async () => {
    try {
      const stateJson = await AsyncStorage.getItem(GAME_STATE_KEY);
      if (stateJson) {
        const state = JSON.parse(stateJson);
        // Only show banner if game is not ended
        if (state && !state.gameOver && state.gameStarted && !state.gameEnded) {
          setOfflineGameInfo({
            type: 'offline',
            roomCode: 'LOCAL_AI_GAME',
            matchNumber: state.currentMatch || 1,
            isActive: true,
          });
          return;
        }
      }
      setOfflineGameInfo(null);
    } catch {
      setOfflineGameInfo(null);
    }
  }, []);

  // Re-check offline game every time the screen gains focus
  // (React Navigation keeps screens alive — useEffect only runs on mount)
  useFocusEffect(
    useCallback(() => {
      checkOfflineGame();
    }, [checkOfflineGame])
  );

  // Also re-check when parent increments refreshTrigger (e.g. after discard)
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      checkOfflineGame();
    }
  }, [refreshTrigger, checkOfflineGame]);

  // Calculate countdown for online games
  useEffect(() => {
    if (!onlineRoomCode || onlineRoomStatus !== 'playing' || !disconnectTimestamp) {
      setCountdown(null);
      setBotHasReplaced(false);
      return;
    }

    const updateCountdown = () => {
      const elapsed = Math.floor((Date.now() - disconnectTimestamp) / 1000);
      const remaining = BOT_REPLACEMENT_SECONDS - elapsed;

      if (remaining <= 0) {
        setCountdown(0);
        setBotHasReplaced(true);
        onBotReplaced?.();
      } else {
        setCountdown(remaining);
        setBotHasReplaced(false);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [onlineRoomCode, onlineRoomStatus, disconnectTimestamp, onBotReplaced]);

  // Determine which game info to display (online takes priority)
  const gameInfo: ActiveGameInfo | null = onlineRoomCode
    ? {
        type: 'online',
        roomCode: onlineRoomCode,
        roomStatus: onlineRoomStatus,
        isActive: true,
      }
    : offlineGameInfo;

  // Entrance animation
  useEffect(() => {
    // Always animate in (even for idle/no-game state)
    Animated.spring(slideAnim, {
      toValue: 0,
      friction: 8,
      tension: 50,
      useNativeDriver: true,
    }).start();

    if (gameInfo) {
      // Pulse animation for countdown urgency
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.03,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [gameInfo, slideAnim, pulseAnim]);

  // No active game — show idle state (plain View, no animation needed)
  if (!gameInfo) {
    return (
      <View style={[styles.container, styles.containerIdle]}>
        <View style={styles.headerRow}>
          <Text style={styles.icon}>🃏</Text>
          <View style={styles.headerText}>
            <Text style={styles.title}>No Game in Progress</Text>
            <Text style={styles.subtitle}>Start a new game to play!</Text>
          </View>
        </View>
      </View>
    );
  }

  const isOnline = gameInfo.type === 'online';
  const isPlaying = isOnline && onlineRoomStatus === 'playing';
  const showCountdown = isPlaying && countdown !== null;

  return (
    <Animated.View
      style={[
        styles.container,
        isOnline ? styles.containerOnline : styles.containerOffline,
        {
          transform: [
            { translateY: slideAnim },
            { scale: showCountdown && countdown !== null && countdown <= 15 ? pulseAnim : 1 },
          ],
        },
      ]}
    >
      {/* Icon + Title */}
      <View style={styles.headerRow}>
        <Text style={styles.icon}>{isOnline ? '🌐' : '🤖'}</Text>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            {isOnline ? 'Active Online Game' : 'Active Offline Game'}
          </Text>
          <Text style={styles.subtitle}>
            {isOnline
              ? `Room: ${gameInfo.roomCode} · ${onlineRoomStatus === 'playing' ? 'In Progress' : 'Waiting'}`
              : `Match ${gameInfo.matchNumber || 1} · vs AI`}
          </Text>
        </View>
      </View>

      {/* Countdown for online playing games */}
      {showCountdown && !botHasReplaced && countdown !== null && (
        <View style={styles.countdownRow}>
          <View style={[
            styles.countdownBadge,
            countdown <= 15 && styles.countdownBadgeUrgent,
          ]}>
            <Text style={[
              styles.countdownText,
              countdown <= 15 && styles.countdownTextUrgent,
            ]}>
              {countdown <= 0 ? 'Bot replacing you...' : `⏱ ${countdown}s before bot replaces you`}
            </Text>
          </View>
        </View>
      )}

      {/* Bot has replaced message */}
      {botHasReplaced && isOnline && (
        <View style={styles.countdownRow}>
          <View style={styles.botReplacedBadge}>
            <Text style={styles.botReplacedText}>
              🤖 A bot is playing for you
            </Text>
          </View>
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.buttonRow}>
        {/* Rejoin button (unified wording for online & offline) */}
        {!botHasReplaced ? (
          <TouchableOpacity
            style={[styles.button, styles.resumeButton]}
            onPress={() => onResume(gameInfo)}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>🔄 Rejoin</Text>
          </TouchableOpacity>
        ) : (
          /* Replace bot button (after 60s, online only) */
          <TouchableOpacity
            style={[styles.button, styles.replaceBotButton]}
            onPress={() => onReplaceBotAndRejoin?.(gameInfo.roomCode)}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>🔄 Replace Bot & Rejoin</Text>
          </TouchableOpacity>
        )}

        {/* Leave button (unified wording) */}
        <TouchableOpacity
          style={[styles.button, styles.leaveButton]}
          onPress={() => onLeave(gameInfo)}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>🚪 Leave</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    borderWidth: 1.5,
  },
  containerOnline: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderColor: '#3b82f6',
  },
  containerOffline: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderColor: '#3b82f6',
  },
  containerIdle: {
    backgroundColor: 'rgba(107, 114, 128, 0.12)',
    borderColor: '#6b7280',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  icon: {
    fontSize: 28,
    marginRight: 10,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: '#f3f4f6',
  },
  subtitle: {
    fontSize: FONT_SIZES.sm - 1,
    color: '#9ca3af',
    marginTop: 2,
  },
  countdownRow: {
    marginBottom: 10,
  },
  countdownBadge: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.4)',
  },
  countdownBadgeUrgent: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: '#ef4444',
  },
  countdownText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: '#fbbf24',
    textAlign: 'center',
  },
  countdownTextUrgent: {
    color: '#f87171',
  },
  botReplacedBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.4)',
  },
  botReplacedText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: '#a5b4fc',
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeButton: {
    backgroundColor: '#22c55e',
  },
  replaceBotButton: {
    backgroundColor: '#6366f1',
  },
  leaveButton: {
    backgroundColor: '#ef4444',
  },
  buttonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    color: COLORS.white,
  },
});

export default ActiveGameBanner;
