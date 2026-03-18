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
import type { ChatMessage } from '../types/chat';
import type { GameStateManager } from '../game/state';
import type { ScoreHistory, PlayHistoryMatch } from '../types/scoreboard';
import type { AutoPassTimerState } from '../types/multiplayer';
import type { LiveKitTrackRef } from '../hooks/useVideoChat';

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
   * Session is connected with the camera off (voice-only mode).
   * Derived: `isChatConnected && !isLocalCameraOn`. Does NOT guarantee that the
   * mic is unmuted — check `isLocalMicOn` to confirm audio is sending.
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
  /**
   * User IDs of remote players in display order: [top, left, right].
   * Empty array for local AI games.
   * Entries may be `''` (empty string) when no remote player occupies that display
   * slot (e.g. a 2-player game has no top/left/right seat filled). GameView guards
   * against empty-string entries with `remotePlayerIds[idx - 1] || undefined`.
   * Used by GameView to map display positions (indices 1–3 of layoutPlayers) to
   * LiveKit participant identities for building `videoStreamSlot` nodes.
   */
  remotePlayerIds: readonly string[];
  /** Toggle local video+audio chat on/off (requests camera+mic permissions if needed). */
  toggleVideoChat: () => Promise<void>;
  /** Toggle the local camera on/off while session is active (no connect/disconnect). */
  toggleCamera: () => Promise<void>;
  /** Toggle voice-only chat (audio only — no camera) on/off. */
  toggleVoiceChat: () => Promise<void>;
  /** Mute/unmute the local microphone while video or voice chat is active. */
  toggleMic: () => Promise<void>;
  /**
   * True while toggleVideoChat is executing (camera + session connect/disconnect).
   * Use to disable the Video button / show its spinner.
   */
  isVideoChatConnecting: boolean;
  /**
   * True while toggleVoiceChat is executing (mic-only connect/disconnect).
   * Separate from isVideoChatConnecting so only the Audio button spins.
   */
  isAudioConnecting: boolean;
  /**
   * Returns a LiveKit TrackReference for the given participant's camera track.
   * Pass directly to `<LiveKitVideoSlot trackRef={...} />` as `videoStreamSlot`.
   * `'__local__'` returns the local participant's camera track reference.
   * Returns `undefined` when the adapter doesn't support video rendering
   * (Expo Go / stub adapter) or when no camera publication is available.
   */
  getVideoTrackRef: (participantId: string | '__local__') => LiveKitTrackRef | undefined;

  // ── Task #648: in-game text chat ──────────────────────────────────────
  /** Chat messages received during this game session. */
  chatMessages: ChatMessage[];
  /** Send a text chat message (profanity-filtered, rate-limited). Returns true if sent, false if no-op (cooldown/no channel). */
  sendChatMessage: (text: string) => boolean;
  /** Number of unread chat messages (resets when drawer opens). */
  chatUnreadCount: number;
  /** True during the 2-second post-send cooldown. */
  isChatCooldown: boolean;
  /** Whether the chat drawer is currently open. */
  isChatDrawerOpen: boolean;
  /** Toggle the chat drawer open/closed. */
  toggleChatDrawer: () => void;
  /** Current user's Supabase ID (for identifying own chat messages). */
  localUserId: string;
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
