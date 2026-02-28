/**
 * Type definitions for multiplayer game state and real-time synchronization
 * 
 * NOTE: Player interface represents data from the `room_players` table,
 * which is used for lobby management. The separate `players` table is
 * used only by Edge Functions for game logic.
 */

export interface Room {
  id: string;
  code: string;
  host_id: string;
  status: 'waiting' | 'playing' | 'finished';
  max_players: number;
  created_at: string;
  updated_at: string;
}

/**
 * Player in room lobby (from room_players table)
 * This represents a player in the lobby/matchmaking phase,
 * NOT the active game state (which is managed by Edge Functions).
 */
export interface Player {
  id: string;
  room_id: string;
  user_id: string;
  username: string;
  player_index: number; // 0-3 for 4-player game
  is_host: boolean;
  is_ready: boolean;
  is_bot: boolean;
  bot_difficulty?: 'easy' | 'medium' | 'hard'; // Bot difficulty level (only for bot players)
  joined_at: string;
}

export interface GameState {
  id: string;
  room_id: string;
  current_turn: number; // position of player whose turn it is
  turn_timer: number; // seconds remaining in turn
  last_play: LastPlay | null;
  pass_count: number; // consecutive passes
  game_phase: 'dealing' | 'first_play' | 'playing' | 'finished' | 'game_over';
  winner: number | null; // FIXED: Use 'winner' to match database column
  match_number: number; // Current match number (starts at 1, increments when match ends)
  hands: Record<string, Card[]>; // Player hands indexed by player_index (string keys from JSON)
  play_history: PlayHistoryEntry[]; // Array of all plays made in the game
  scores: number[]; // Cumulative scores per player [p0, p1, p2, p3]
  final_scores: Record<string, number> | null; // Final scores when game_phase='finished', keyed by player_index

  // Auto-pass timer state (for highest play detection)
  auto_pass_timer: AutoPassTimerState | null;
  played_cards: Card[]; // All cards played this game (for highest play detection)

  created_at: string;
  updated_at: string;
}

/**
 * Auto-pass timer state (SERVER-AUTHORITATIVE ARCHITECTURE)
 * Triggered when the highest possible card/combo is played
 * Gives players 10 seconds to manually pass before auto-passing
 * 
 * CRITICAL: All devices calculate remaining time from end_timestamp using clock-sync
 * This ensures tight realtime sync (within 100ms) across 4 devices
 */
export interface AutoPassTimerState {
  active: boolean;
  started_at: string; // ISO timestamp when timer started (server UTC)
  duration_ms: number; // Total duration in milliseconds (default: 10000)
  remaining_ms: number; // DEPRECATED: Clients should calculate from end_timestamp
  triggering_play: LastPlay; // The play that triggered the timer
  player_id: string; // ID of player who triggered the timer
  
  // ⏰ NEW: Server-authoritative fields for tight sync
  end_timestamp?: number; // Server epoch ms when timer expires (CRITICAL for sync)
  sequence_id?: number; // Monotonic sequence for conflict resolution
  server_time_at_creation?: number; // Server epoch ms when created (for clock sync)
}

/** A single play entry recorded in the game's play_history array */
export interface PlayHistoryEntry {
  match_number: number;
  position: number;
  cards: Card[];
  combo_type: ComboType | string;
  passed: boolean;
}

export interface LastPlay {
  position: number;
  cards: Card[];
  combo_type: ComboType;
}

export interface Card {
  id: string; // Unique identifier, e.g., "3D", "AS" (rank + suit abbreviation, no dash)
  suit: 'D' | 'C' | 'H' | 'S'; // D=Diamonds, C=Clubs, H=Hearts, S=Spades
  rank: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
}

export type ComboType = 
  | 'Single'
  | 'Pair'
  | 'Triple'
  | 'Straight'
  | 'Flush'
  | 'Full House'
  | 'Four of a Kind'
  | 'Straight Flush'
  | 'unknown';

export interface PlayerHand {
  player_id: string;
  player_index: number;
  cards: Card[];
  card_count: number;
}

export type GameActionPayload =
  | { action_type: 'join'; username: string; player_index: number }
  | { action_type: 'leave' }
  | { action_type: 'ready'; is_ready: boolean }
  | { action_type: 'play'; cards: Card[]; combo_type: ComboType }
  | { action_type: 'pass' }
  | { action_type: 'start_game' };

export interface GameAction {
  id: string;
  room_id: string;
  player_id: string;
  action_type: 'join' | 'leave' | 'ready' | 'play' | 'pass' | 'start_game';
  payload: GameActionPayload;
  timestamp: string;
}

// Real-time presence state
export interface PlayerPresence {
  user_id: string;
  username: string;
  online_at: string;
  player_index?: number;
}

// Broadcast message types
export type BroadcastEvent = 
  | 'player_joined'
  | 'player_left'
  | 'player_ready'
  | 'game_started'
  | 'turn_changed'
  | 'cards_played'
  | 'player_passed'
  | 'game_ended'
  | 'match_ended'  // New: Match ended, broadcast scores
  | 'game_over'  // New: Game completely over (someone >= 101 points)
  | 'new_match_started'  // New: New match started after previous match ended
  | 'reconnected'
  | 'auto_pass_timer_started'  // New: Timer started for highest play
  | 'auto_pass_timer_cancelled'  // New: Timer cancelled (manual pass or new play)
  | 'auto_pass_executed';  // New: Auto-pass executed after timer expired

export type BroadcastData =
  | { user_id: string; username: string; player_index: number }  // player_joined
  | { user_id: string; player_index: number }  // player_left
  | { user_id: string; ready: boolean }  // player_ready
  | { game_state: GameState }  // game_started
  | { player_index: number; timer: number }  // turn_changed
  | { player_index: number; cards: Card[]; combo_type: ComboType }  // cards_played
  | { player_index: number }  // player_passed
  | { winner: number }  // game_ended - FIXED: Use 'winner' column
  | { user_id: string }  // reconnected
  | { timer_state: AutoPassTimerState; triggering_player_index: number }  // auto_pass_timer_started
  | { player_index: number; reason: 'manual_pass' | 'new_play' }  // auto_pass_timer_cancelled
  | { player_index: number };  // auto_pass_executed

export interface BroadcastPayload {
  event: BroadcastEvent;
  data: BroadcastData;
  timestamp: string;
}

// Hook return types
export interface UseRealtimeReturn {
  room: Room | null;
  players: Player[];
  gameState: GameState | null;
  playerHands: Map<string, PlayerHand>;
  isConnected: boolean;
  isHost: boolean;
  isDataReady: boolean; // BULLETPROOF: Indicates game state is fully loaded and ready
  currentPlayer: Player | null;
  
  // Room management
  createRoom: () => Promise<Room>;
  joinRoom: (code: string) => Promise<void>;
  connectToRoom: (code: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  
  // Game actions
  setReady: (ready: boolean) => Promise<void>;
  startGame: (botDifficulty?: 'easy' | 'medium' | 'hard') => Promise<void>;
  playCards: (cards: Card[], playerIndex?: number) => Promise<void>; // Optional playerIndex for bot coordinator
  pass: () => Promise<void>;
  
  // Connection management
  reconnect: () => Promise<void>;
  
  // Loading states
  loading: boolean;
  error: Error | null;
}

// Realtime channel events
export interface RealtimeChannelEvents {
  'room:updated': (payload: { room: Room }) => void;
  'player:joined': (payload: { player: Player }) => void;
  'player:left': (payload: { player: Player }) => void;
  'player:updated': (payload: { player: Player }) => void;
  'game:started': (payload: { game_state: GameState }) => void;
  'game:updated': (payload: { game_state: GameState }) => void;
  'turn:changed': (payload: { player_index: number; timer: number }) => void;
  'cards:played': (payload: { player_index: number; cards: Card[]; combo_type: ComboType }) => void;
  'player:passed': (payload: { player_index: number }) => void;
  'game:ended': (payload: { winner: number }) => void; // FIXED: Use 'winner' column
}
