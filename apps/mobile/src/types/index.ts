// Type definitions for the Big2 Mobile App

export interface Player {
  id: string;
  name: string;
  avatar?: string;
  isBot?: boolean;
  isHost?: boolean;
  cardCount?: number;
}

export interface Room {
  id: string;
  code: string;
  hostId: string;
  players: Player[];
  status: 'waiting' | 'playing' | 'finished';
  createdAt: string;
}

export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
  id: string;
}

export interface GameState {
  roomId: string;
  currentTurn: string;
  lastPlay: Card[] | null;
  lastPlayType: string | null;
  players: Player[];
  winner?: string;
}

// Supabase query result types
export interface RoomPlayerWithRoom {
  room_id: string;
  user_id?: string; // Optional - not always selected in queries
  rooms: {
    code: string;
    status: string;
  };
}

// Export multiplayer types (excluding Card which is defined locally above)
export type {
  Room as MultiplayerRoom,
  Player as MultiplayerPlayer,
  GameState as MultiplayerGameState,
  AutoPassTimerState,
  LastPlay,
  ComboType,
  PlayerHand,
  GameAction,
  GameActionPayload,
  PlayerPresence,
  BroadcastPayload,
  BroadcastEvent,
  BroadcastData,
  UseRealtimeReturn,
  RealtimeChannelEvents,
} from './multiplayer';
// Also re-export Card from multiplayer as MultiplayerCard for explicit usage
export type { Card as MultiplayerCard } from './multiplayer';

// Export scoreboard types explicitly to avoid conflicts
export type { PlayHistoryHand, PlayHistoryMatch, ScoreHistory, HandCardProps } from './scoreboard';

// Export game end types (excluding types already exported above)
export type {
  FinalScore,
  GameEndModalProps,
  GameEndedEventData,
  FireworksProps,
  WinnerAnnouncementProps,
  FinalStandingsProps,
  ScoreHistoryTabProps,
  PlayHistoryTabProps,
  ActionButtonsProps,
  CardImageProps,
} from './gameEnd';
