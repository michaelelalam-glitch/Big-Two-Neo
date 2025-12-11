/**
 * Big2 Mobile Game Engine
 * 
 * Exported and battle-tested game logic adapted for React Native.
 * Includes core game rules, bot AI, and state management.
 * 
 * @module game
 */

// Export types
export type { Card, ClassificationResult, LastPlay, ComboType, Rank, Suit } from './types';

// Export constants
export {
  RANKS,
  SUITS,
  SUIT_VALUE,
  RANK_VALUE,
  VALID_STRAIGHT_SEQUENCES,
  COMBO_STRENGTH,
  MAX_PLAYERS,
  CARDS_PER_PLAYER,
  TOTAL_CARDS,
} from './engine/constants';

// Export game engine
export {
  sortHand,
  classifyCards,
  classifyAndSortCards,
  canBeatPlay,
  findRecommendedPlay,
  isStraight,
} from './engine/game-logic';

// Export highest play detector (for auto-pass timer)
export { isHighestPossiblePlay } from './engine/highest-play-detector';

// Export bot AI
export {
  BotAI,
  createBotAI,
  getBotPlay,
  type BotDifficulty,
  type BotPlayOptions,
  type BotPlayResult,
} from './bot';

// Export state management
export {
  GameStateManager,
  createGameStateManager,
  type GameState,
  type Player,
  type GameConfig,
  type GameStateListener,
  type RoundHistoryEntry,
} from './state';
