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
}

export function useMultiplayerLayout({
  multiplayerPlayers,
  multiplayerHandsByIndex,
  multiplayerGameState,
  userId,
}: UseMultiplayerLayoutOptions) {
  const multiplayerSeatIndex = React.useMemo(() => {
    const me = multiplayerPlayers.find((p) => p.user_id === userId);
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

    // CRITICAL: RELATIVE positioning — each player sees THEMSELVES at bottom
    const bottom = multiplayerSeatIndex;
    const top = (multiplayerSeatIndex + 2) % 4;
    const left = (multiplayerSeatIndex + 3) % 4;
    const right = (multiplayerSeatIndex + 1) % 4;

    return [
      { name: getName(bottom), cardCount: getCount(bottom), score: getScore(bottom), isActive: isActive(bottom), player_index: bottom },
      { name: getName(top), cardCount: getCount(top), score: getScore(top), isActive: isActive(top), player_index: top },
      { name: getName(left), cardCount: getCount(left), score: getScore(left), isActive: isActive(left), player_index: left },
      { name: getName(right), cardCount: getCount(right), score: getScore(right), isActive: isActive(right), player_index: right },
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
