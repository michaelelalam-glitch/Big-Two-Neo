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
  joined_at: string;
}

export interface GameState {
  id: string;
  room_id: string;
  current_turn: number; // position of player whose turn it is
  turn_timer: number; // seconds remaining in turn
  last_play: LastPlay | null;
  pass_count: number; // consecutive passes
  game_phase: 'dealing' | 'playing' | 'finished';
  winner_position: number | null;
  
  // Auto-pass timer state (for highest play detection)
  auto_pass_timer: AutoPassTimerState | null;
  played_cards: Card[]; // All cards played this game (for highest play detection)
  
  created_at: string;
  updated_at: string;
}

/**
 * Auto-pass timer state
 * Triggered when the highest possible card/combo is played
 * Gives players 10 seconds to manually pass before auto-passing
 */
export interface AutoPassTimerState {
  active: boolean;
  started_at: string; // ISO timestamp when timer started
  duration_ms: number; // Total duration in milliseconds (default: 10000)
  remaining_ms: number; // Milliseconds remaining
  triggering_play: LastPlay; // The play that triggered the timer
}

export interface LastPlay {
  position: number;
  cards: Card[];
  combo_type: ComboType;
}

export interface Card {
  id: string; // Unique identifier, e.g., "3D", "AS" (rank + suit abbreviation)
  suit: 'D' | 'C' | 'H' | 'S'; // D=Diamonds, C=Clubs, H=Hearts, S=Spades
  rank: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
}

export type ComboType = 
  | 'single'
  | 'pair'
  | 'triple'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four_of_a_kind'
  | 'straight_flush';

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
  | 'reconnected';

export type BroadcastData =
  | { user_id: string; username: string; player_index: number }  // player_joined
  | { user_id: string; player_index: number }  // player_left
  | { user_id: string; ready: boolean }  // player_ready
  | { game_state: GameState }  // game_started
  | { player_index: number; timer: number }  // turn_changed
  | { player_index: number; cards: Card[]; combo_type: ComboType }  // cards_played
  | { player_index: number }  // player_passed
  | { winner_position: number }  // game_ended
  | { user_id: string };  // reconnected

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
  currentPlayer: Player | null;
  
  // Room management
  createRoom: () => Promise<Room>;
  joinRoom: (code: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  
  // Game actions
  setReady: (ready: boolean) => Promise<void>;
  startGame: () => Promise<void>;
  playCards: (cards: Card[]) => Promise<void>;
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
  'game:ended': (payload: { winner_position: number }) => void;
}
