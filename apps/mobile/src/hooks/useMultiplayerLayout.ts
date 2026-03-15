/**
 * useMultiplayerLayout — Computes player layout and last-play display data for multiplayer games.
 *
 * Extracted from GameScreen.tsx to reduce file size (~120 lines).
 * Handles:
 * - Seat index computation (relative positioning: current player is always bottom)
 * - Player hand for the current user
 * - Layout players array with name, cardCount, score, isActive
 * - Last played cards/combo formatting for display
 */

import React from 'react';

import { sortCardsForDisplay } from '../utils/cardSorting';
import type { Card as GameCard } from '../game/types';
import type { ParsedCard } from '../utils/parseMultiplayerHands';
import type { GameState as MultiplayerGameState, Player as MultiplayerPlayer } from '../types/multiplayer';

type ParsedHands = Record<string, ParsedCard[]> | undefined;

interface UseMultiplayerLayoutOptions {
  multiplayerPlayers: MultiplayerPlayer[];
  multiplayerHandsByIndex: ParsedHands;
  multiplayerGameState: MultiplayerGameState | null;
  userId: string | undefined;
}

export interface LayoutPlayer {
  name: string;
  cardCount: number;
  score: number;
  isActive: boolean;
  player_index: number;
  /** fix/rejoin: true when the player is disconnected or replaced by a bot */
  isDisconnected?: boolean;
  /** UTC timestamp when the 60s bot-replacement countdown started (null = no countdown) */
  disconnectTimerStartedAt?: string | null;
}

export function useMultiplayerLayout({
  multiplayerPlayers,
  multiplayerHandsByIndex,
  multiplayerGameState,
  userId,
}: UseMultiplayerLayoutOptions) {
  // O(1) lookup map: player_index → Player.  Rebuilt only when multiplayerPlayers changes.
  // Eliminates 12 linear O(N) .find() calls per multiplayerLayoutPlayers re-evaluation
  // (3 lookups × 4 layout seats) plus the 1 call in multiplayerLastPlayedBy.
  const playerByIndexMap = React.useMemo(
    () => new Map(multiplayerPlayers.map((p) => [p.player_index, p])),
    [multiplayerPlayers],
  );

  const multiplayerSeatIndex = React.useMemo(() => {
    // Primary lookup: match by user_id.
    // Fallback: match by human_user_id for rejoin/bot-replacement scenarios where
    // the row's user_id has been switched to the bot's ID but human_user_id still
    // references the original human player.  Without this, myIndex defaults to 0
    // and the player sees the wrong seat as "active", making play/pass buttons
    // permanently disabled when it's actually their turn.
    const me =
      multiplayerPlayers.find((p) => p.user_id === userId) ??
      multiplayerPlayers.find((p) => p.human_user_id === userId);
    const myIndex = typeof me?.player_index === 'number' ? me.player_index : 0;
    return myIndex;
  }, [multiplayerPlayers, userId]);

  const multiplayerPlayerHand = React.useMemo(() => {
    const raw = multiplayerHandsByIndex?.[String(multiplayerSeatIndex)];
    return Array.isArray(raw) ? raw : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- multiplayerGameState is an unnecessary dep; multiplayerHandsByIndex already changes whenever the game state updates hand data
  }, [multiplayerHandsByIndex, multiplayerSeatIndex]);

  const multiplayerLastPlay = multiplayerGameState?.last_play ?? null;

  const multiplayerLastPlayedCards = React.useMemo(() => {
    const cards = multiplayerLastPlay?.cards;
    return Array.isArray(cards) ? cards : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiplayerLastPlay]);

  const multiplayerLastPlayedBy = React.useMemo(() => {
    const playerIdx = multiplayerLastPlay?.player_index ?? multiplayerLastPlay?.position;
    if (typeof playerIdx !== 'number') return null;
    const p = playerByIndexMap.get(playerIdx);
    return p?.username ?? `Player ${playerIdx + 1}`;
  }, [multiplayerLastPlay, playerByIndexMap]);

  const multiplayerLastPlayComboType: string | null =
    (multiplayerLastPlay?.combo_type as string | null) ?? null;

  const multiplayerLastPlayCombo = React.useMemo(() => {
    if (!multiplayerLastPlayComboType) return null;
    const cards = multiplayerLastPlayedCards;
    if (!Array.isArray(cards) || cards.length === 0) return multiplayerLastPlayComboType;

    if (multiplayerLastPlayComboType === 'Single') return `Single ${cards[0].rank}`;
    if (multiplayerLastPlayComboType === 'Pair') return `Pair of ${cards[0].rank}s`;
    if (multiplayerLastPlayComboType === 'Triple') return `Triple ${cards[0].rank}s`;
    if (multiplayerLastPlayComboType === 'Straight') {
      const sorted = sortCardsForDisplay(cards as GameCard[], 'Straight');
      const high = sorted[0];
      return high ? `Straight to ${high.rank}` : 'Straight';
    }
    if (multiplayerLastPlayComboType === 'Flush') {
      const sorted = sortCardsForDisplay(cards as GameCard[], 'Flush');
      const high = sorted[0];
      return high ? `Flush (${high.rank} high)` : 'Flush';
    }
    if (multiplayerLastPlayComboType === 'Straight Flush') {
      const sorted = sortCardsForDisplay(cards as GameCard[], 'Straight Flush');
      const high = sorted[0];
      return high ? `Straight Flush to ${high.rank}` : 'Straight Flush';
    }

    return multiplayerLastPlayComboType;
  }, [multiplayerLastPlayComboType, multiplayerLastPlayedCards]);

  const multiplayerLayoutPlayers: LayoutPlayer[] = React.useMemo(() => {
    const getName = (idx: number): string => {
      const p = playerByIndexMap.get(idx);
      // Server already sets username to 'Bot <original name>' when replacing with a bot.
      // Do NOT add another 'Bot ' prefix here — that would produce 'Bot Bot <name>'.
      return p?.username ?? `Player ${idx + 1}`;
    };

    const getCount = (idx: number): number => {
      const hand = multiplayerHandsByIndex?.[String(idx)];
      return Array.isArray(hand) ? hand.length : 13;
    };

    const getScore = (idx: number): number => {
      const scores = multiplayerGameState?.scores;
      if (!Array.isArray(scores)) return 0;
      return scores[idx] || 0;
    };

    const currentTurn = multiplayerGameState?.current_turn;
    const isActive = (idx: number) => typeof currentTurn === 'number' && currentTurn === idx;

    // fix/rejoin: a player is "disconnected" (shows spinner overlay) when their
    // connection_status = 'disconnected' (heartbeat stopped). The charcoal grey ring
    // countdown shows the time until bot replacement.
    // Once replacement happens (status = 'replaced_by_bot'), the avatar shows
    // normally without spinner since the bot is actively playing.
    const isDisconnected = (idx: number): boolean => {
      const p = playerByIndexMap.get(idx);
      if (!p) return false;
      // Show spinner whenever explicitly disconnected (not just when cardCount=0)
      return p.connection_status === 'disconnected';
    };

    /** Get disconnect_timer_started_at for a player (non-null while 60s countdown is active) */
    const getDisconnectTimerStartedAt = (idx: number): string | null => {
      const p = playerByIndexMap.get(idx);
      if (!p) return null;
      // Show countdown whenever the timer is running, regardless of connection_status.
      // This handles:
      //   - 'disconnected': player's heartbeat went stale
      //   - 'connected': player resumed heartbeat but timer is still running (persistent timer)
      // Once 'replaced_by_bot', the countdown is irrelevant.
      if (p.connection_status === 'replaced_by_bot') return null;
      return p.disconnect_timer_started_at ?? null;
    };

    // CRITICAL: RELATIVE positioning — each player sees THEMSELVES at bottom
    const bottom = multiplayerSeatIndex;
    const top = (multiplayerSeatIndex + 2) % 4;
    const left = (multiplayerSeatIndex + 3) % 4;
    const right = (multiplayerSeatIndex + 1) % 4;

    return [
      { name: getName(bottom), cardCount: getCount(bottom), score: getScore(bottom), isActive: isActive(bottom), player_index: bottom, isDisconnected: isDisconnected(bottom), disconnectTimerStartedAt: getDisconnectTimerStartedAt(bottom) },
      { name: getName(top), cardCount: getCount(top), score: getScore(top), isActive: isActive(top), player_index: top, isDisconnected: isDisconnected(top), disconnectTimerStartedAt: getDisconnectTimerStartedAt(top) },
      { name: getName(left), cardCount: getCount(left), score: getScore(left), isActive: isActive(left), player_index: left, isDisconnected: isDisconnected(left), disconnectTimerStartedAt: getDisconnectTimerStartedAt(left) },
      { name: getName(right), cardCount: getCount(right), score: getScore(right), isActive: isActive(right), player_index: right, isDisconnected: isDisconnected(right), disconnectTimerStartedAt: getDisconnectTimerStartedAt(right) },
    ];
  }, [playerByIndexMap, multiplayerHandsByIndex, multiplayerGameState, multiplayerSeatIndex]);

  return {
    multiplayerSeatIndex,
    multiplayerPlayerHand,
    multiplayerLastPlay,
    multiplayerLastPlayedCards,
    multiplayerLastPlayedBy,
    multiplayerLastPlayComboType,
    multiplayerLastPlayCombo,
    multiplayerLayoutPlayers,
  };
}
