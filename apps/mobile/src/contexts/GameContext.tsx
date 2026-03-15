/**
 * GameContext — shared game-view state for both Local AI and Multiplayer game modes.
 *
 * Replaces the 50+ individual props previously threaded from MultiplayerGame /
 * LocalAIGame through to GameView and its children.  Consumers call
 * `useGameContext()` to access the full game-view model; they throw if rendered
 * outside a `GameContextProvider`.
 *
 * H4 Audit fix — Task #638.
 */
import React, { createContext, useContext } from 'react';
import type { Card } from '../game/types';
import type { GameStateManager } from '../game/state';
import type { ScoreHistory, PlayHistoryMatch } from '../types/scoreboard';
import type { AutoPassTimerState } from '../types/multiplayer';

// ---------------------------------------------------------------------------
// Player type aliases (mirror the inline types in the old GameViewProps)
// ---------------------------------------------------------------------------

export interface LayoutPlayer {
  name: string;
  cardCount: number;
  score: number;
  isActive: boolean;
  player_index?: number;
  isDisconnected?: boolean;
  disconnectTimerStartedAt?: string | null;
}

export interface LayoutPlayerWithTimer extends LayoutPlayer {
  totalScore?: number;
  turnTimerStartedAt?: string | null;
  onCountdownExpired?: () => void;
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface GameContextType {
  // ── Mode ───────────────────────────────────────────────────────────────
  isLocalAIGame: boolean;

  // ── Orientation ────────────────────────────────────────────────────────
  currentOrientation: 'portrait' | 'landscape';
  toggleOrientation: () => void;

  // ── Status flags ───────────────────────────────────────────────────────
  isInitializing: boolean;
  isConnected: boolean;

  // ── Settings modal ─────────────────────────────────────────────────────
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  roomCode?: string;

  // ── Player hand & selection ────────────────────────────────────────────
  effectivePlayerHand: Card[];
  selectedCardIds: Set<string>;
  setSelectedCardIds: (ids: Set<string>) => void;
  handleCardsReorder: (cards: Card[]) => void;
  selectedCards: Card[];
  customCardOrder: string[];
  setCustomCardOrder: (order: string[]) => void;

  // ── Table state ────────────────────────────────────────────────────────
  effectiveLastPlayedCards: Card[];
  effectiveLastPlayedBy: string | null;
  effectiveLastPlayComboType: string | null;
  effectiveLastPlayCombo: string | null;

  // ── Layout players ─────────────────────────────────────────────────────
  layoutPlayers: LayoutPlayer[];
  layoutPlayersWithScores: LayoutPlayerWithTimer[];
  playerTotalScores: number[];
  currentPlayerName: string;

  // ── Scoreboard UI toggles ──────────────────────────────────────────────
  togglePlayHistory: () => void;
  toggleScoreboardExpanded: () => void;

  // ── Scoreboard display data ────────────────────────────────────────────
  memoizedPlayerNames: string[];
  memoizedCurrentScores: number[];
  memoizedCardCounts: number[];
  memoizedOriginalPlayerNames: string[];
  effectiveAutoPassTimerState: AutoPassTimerState | undefined;
  effectiveScoreboardCurrentPlayerIndex: number;
  matchNumber: number;
  isGameFinished: boolean;
  displayOrderScoreHistory: ScoreHistory[];
  playHistoryByMatch: PlayHistoryMatch[];

  // ── Action callbacks ───────────────────────────────────────────────────
  handlePlayCards: (cards: Card[]) => Promise<void>;
  handlePass: () => Promise<void>;
  handlePlaySuccess: () => void;
  handlePassSuccess: () => void;
  handleCardHandPlayCards: (cards: Card[]) => void;
  handleCardHandPass: () => void;
  handleLeaveGame: () => void;
  handleSort: () => void;
  handleSmartSort: () => void;
  handleHint: () => void;

  // ── Control state ──────────────────────────────────────────────────────
  /** True when it is the local player's turn and the game engine is ready. */
  isPlayerReady: boolean;

  // ── GameControls internals ─────────────────────────────────────────────
  gameManagerRef: React.MutableRefObject<GameStateManager | null>;
  isMountedRef: React.MutableRefObject<boolean>;

  // ── Task #651 / #649: in-game video + audio chat ──────────────────────────
  /**
   * True when the chat room session is active (video+mic OR voice-only).
   * Use `isLocalCameraOn` to distinguish video from voice-only.
   */
  isChatConnected: boolean;
  /**
   * Whether the local player has opted in to voice-only chat (mic only — no camera).
   * Derived: `isChatConnected && !isLocalCameraOn`.
   */
  voiceChatEnabled: boolean;
  /** Whether the local camera is currently streaming. */
  isLocalCameraOn: boolean;
  /** Whether the local microphone is currently active (unmuted). */
  isLocalMicOn: boolean;
  /**
   * Per-player camera state for remote tiles. Key = user_id.
   * Populated from useVideoChat.remoteParticipants while isChatConnected=true.
   */
  remoteCameraStates: Record<string, { isCameraOn: boolean; isConnecting: boolean }>;
  /**
   * Per-player mic state for remote tiles. Key = user_id.
   * Populated from useVideoChat.remoteParticipants while isChatConnected=true.
   */
  remoteMicStates: Record<string, { isMicOn: boolean }>;
  /** Toggle local video+audio chat on/off (requests camera+mic permissions if needed). */
  toggleVideoChat: () => Promise<void>;
  /** Toggle the local camera on/off while session is active (no connect/disconnect). */
  toggleCamera: () => Promise<void>;
  /** Toggle voice-only chat (audio only — no camera) on/off. */
  toggleVoiceChat: () => Promise<void>;
  /** Mute/unmute the local microphone while video or voice chat is active. */
  toggleMic: () => Promise<void>;
  /**
   * True while toggleVideoChat or toggleVoiceChat is in-flight (async connect /
   * permission dialogs / enable calls). Use to disable the VideoTile button and
   * show a spinner during transitions.
   */
  isVideoChatConnecting: boolean;
}

// ---------------------------------------------------------------------------
// Context object
// ---------------------------------------------------------------------------

const GameContext = createContext<GameContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface GameContextProviderProps {
  children: React.ReactNode;
  value: GameContextType;
}

export function GameContextProvider({ children, value }: GameContextProviderProps) {
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

/**
 * Returns the current `GameContextType` value.
 * Throws if called outside a `<GameContextProvider>`.
 */
export function useGameContext(): GameContextType {
  const ctx = useContext(GameContext);
  if (ctx === undefined) {
    throw new Error('useGameContext must be used within a GameContextProvider');
  }
  return ctx;
}
