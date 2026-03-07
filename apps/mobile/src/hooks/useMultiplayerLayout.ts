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
}

export function useMultiplayerLayout({
  multiplayerPlayers,
  multiplayerHandsByIndex,
  multiplayerGameState,
  userId,
}: UseMultiplayerLayoutOptions) {
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
    const p = multiplayerPlayers.find((pl) => pl.player_index === playerIdx);
    return p?.username ?? `Player ${playerIdx + 1}`;
  }, [multiplayerLastPlay, multiplayerPlayers]);

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
      const p = multiplayerPlayers.find((pl) => pl.player_index === idx);
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

    // fix/rejoin: a player is "disconnected" (shows spinner overlay) ONLY while they
    // are in the process of disconnecting — i.e. connection_status = 'disconnected'.
    // Once a replacement bot takes the seat (status = 'replaced_by_bot'), the bot
    // is actively playing and should show a normal avatar without a spinner overlay.
    //
    // DEFENSIVE: We also gate on cardCount === 0 so that transient heartbeat
    // hiccups (e.g., the server cron marking a player 'disconnected' before the
    // next heartbeat arrives) don't flash the disconnect spinner mid-game for
    // players who are still actively in the hand.  The primary accuracy source
    // is useConnectionManager (heartbeat) integrated in MultiplayerGame — this
    // cardCount check is a UI-level fallback that prevents misleading visuals
    // when all players are genuinely playing.
    const isDisconnected = (idx: number): boolean => {
      const p = multiplayerPlayers.find((pl) => pl.player_index === idx);
      if (!p) return false;

      // Only show the disconnected spinner when the server explicitly marks
      // the player as 'disconnected' AND the player is not currently in the
      // active game (no cards).  This prevents transient server-side races
      // or heartbeat hiccups from showing all avatars as disconnected while
      // players remain actively in the match.
      const explicitlyDisconnected = p.connection_status === 'disconnected';
      if (!explicitlyDisconnected) return false;

      const cardCount = getCount(idx);
      // If the player still has cards, treat them as active for UI purposes.
      return cardCount === 0;
    };

    // CRITICAL: RELATIVE positioning — each player sees THEMSELVES at bottom
    const bottom = multiplayerSeatIndex;
    const top = (multiplayerSeatIndex + 2) % 4;
    const left = (multiplayerSeatIndex + 3) % 4;
    const right = (multiplayerSeatIndex + 1) % 4;

    return [
      { name: getName(bottom), cardCount: getCount(bottom), score: getScore(bottom), isActive: isActive(bottom), player_index: bottom, isDisconnected: isDisconnected(bottom) },
      { name: getName(top), cardCount: getCount(top), score: getScore(top), isActive: isActive(top), player_index: top, isDisconnected: isDisconnected(top) },
      { name: getName(left), cardCount: getCount(left), score: getScore(left), isActive: isActive(left), player_index: left, isDisconnected: isDisconnected(left) },
      { name: getName(right), cardCount: getCount(right), score: getScore(right), isActive: isActive(right), player_index: right, isDisconnected: isDisconnected(right) },
    ];
  }, [multiplayerPlayers, multiplayerHandsByIndex, multiplayerGameState, multiplayerSeatIndex]);

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
