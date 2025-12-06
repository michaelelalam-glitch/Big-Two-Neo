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
  rooms: {
    code: string;
    status: string;
  };
}

// Export multiplayer types
export * from './multiplayer';
