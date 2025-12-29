// Shared types for game components
import type { Card } from '../../game/types';
import type { FinalScore } from '../../types/gameEnd';
import type { ScoreHistory, PlayHistoryMatch } from '../../types/scoreboard';

export interface GameMode {
  isLocalAIGame: boolean;
  isMultiplayerGame: boolean;
}

export interface GameCallbacks {
  onPlayCards: (cards: Card[]) => Promise<void>;
  onPass: () => Promise<void>;
  onLeaveGame: () => void;
  onToggleSettings: () => void;
}

export interface LocalGameState {
  gameState: any;
  gameManagerRef: React.RefObject<any>;
  isInitializing: boolean;
  localPlayerHand: Card[];
}

export interface MultiplayerGameState {
  gameState: any;
  playerHands: Map<string, Card[]>;
  isConnected: boolean;
  isHost: boolean;
  isDataReady: boolean;
  players: any[];
  multiplayerSeatIndex: number;
  multiplayerPlayerHand: Card[];
  playCards: (cards: any[]) => Promise<void>;
  pass: () => Promise<void>;
}

export interface GameEndCallbacks {
  openGameEndModal: (
    winnerName: string,
    winnerPosition: number,
    finalScores: FinalScore[],
    playerNames: string[],
    scoreHistory: ScoreHistory[],
    playHistory: PlayHistoryMatch[]
  ) => void;
}
