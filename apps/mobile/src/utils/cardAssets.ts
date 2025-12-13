/**
 * Card Asset Mapping Utility
 * Maps game card format (r, s) to image sources
 * 
 * Returns require() paths for React Native Image component
 */

import { ImageSourcePropType } from 'react-native';

export interface CardAssetMapping {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: 'ace' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'jack' | 'queen' | 'king';
  fileName: string;
  source: ImageSourcePropType; // Image source
}

/**
 * Maps game suit codes to asset suit names
 * H = Hearts, D = Diamonds, C = Clubs, S = Spades
 */
const SUIT_MAP: Record<string, 'hearts' | 'diamonds' | 'clubs' | 'spades'> = {
  'H': 'hearts',
  'D': 'diamonds',
  'C': 'clubs',
  'S': 'spades',
};

/**
 * Maps game rank codes to asset rank names
 * A = Ace, 2-10 = Numbers, J = Jack, Q = Queen, K = King
 */
const RANK_MAP: Record<string, 'ace' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'jack' | 'queen' | 'king'> = {
  'A': 'ace',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  'J': 'jack',
  'Q': 'queen',
  'K': 'king',
};

/**
 * Image source paths for React Native Image component
 * CRITICAL: Direct require() at module level to ensure stable, pre-frozen references
 * React Native's deepFreeze will freeze these ONCE when module loads, not on every render
 */
const CARD_IMAGE_SOURCES: Record<string, ImageSourcePropType> = {
  // Hearts
  'hearts_ace': require('../../assets/cards/hearts_ace.svg'),
  'hearts_2': require('../../assets/cards/hearts_2.svg'),
  'hearts_3': require('../../assets/cards/hearts_3.svg'),
  'hearts_4': require('../../assets/cards/hearts_4.svg'),
  'hearts_5': require('../../assets/cards/hearts_5.svg'),
  'hearts_6': require('../../assets/cards/hearts_6.svg'),
  'hearts_7': require('../../assets/cards/hearts_7.svg'),
  'hearts_8': require('../../assets/cards/hearts_8.svg'),
  'hearts_9': require('../../assets/cards/hearts_9.svg'),
  'hearts_10': require('../../assets/cards/hearts_10.svg'),
  'hearts_jack': require('../../assets/cards/hearts_jack.svg'),
  'hearts_queen': require('../../assets/cards/hearts_queen.svg'),
  'hearts_king': require('../../assets/cards/hearts_king.svg'),
  
  // Diamonds
  'diamonds_ace': require('../../assets/cards/diamonds_ace.svg'),
  'diamonds_2': require('../../assets/cards/diamonds_2.svg'),
  'diamonds_3': require('../../assets/cards/diamonds_3.svg'),
  'diamonds_4': require('../../assets/cards/diamonds_4.svg'),
  'diamonds_5': require('../../assets/cards/diamonds_5.svg'),
  'diamonds_6': require('../../assets/cards/diamonds_6.svg'),
  'diamonds_7': require('../../assets/cards/diamonds_7.svg'),
  'diamonds_8': require('../../assets/cards/diamonds_8.svg'),
  'diamonds_9': require('../../assets/cards/diamonds_9.svg'),
  'diamonds_10': require('../../assets/cards/diamonds_10.svg'),
  'diamonds_jack': require('../../assets/cards/diamonds_jack.svg'),
  'diamonds_queen': require('../../assets/cards/diamonds_queen.svg'),
  'diamonds_king': require('../../assets/cards/diamonds_king.svg'),
  
  // Clubs
  'clubs_ace': require('../../assets/cards/clubs_ace.svg'),
  'clubs_2': require('../../assets/cards/clubs_2.svg'),
  'clubs_3': require('../../assets/cards/clubs_3.svg'),
  'clubs_4': require('../../assets/cards/clubs_4.svg'),
  'clubs_5': require('../../assets/cards/clubs_5.svg'),
  'clubs_6': require('../../assets/cards/clubs_6.svg'),
  'clubs_7': require('../../assets/cards/clubs_7.svg'),
  'clubs_8': require('../../assets/cards/clubs_8.svg'),
  'clubs_9': require('../../assets/cards/clubs_9.svg'),
  'clubs_10': require('../../assets/cards/clubs_10.svg'),
  'clubs_jack': require('../../assets/cards/clubs_jack.svg'),
  'clubs_queen': require('../../assets/cards/clubs_queen.svg'),
  'clubs_king': require('../../assets/cards/clubs_king.svg'),
  
  // Spades
  'spades_ace': require('../../assets/cards/spades_ace.svg'),
  'spades_2': require('../../assets/cards/spades_2.svg'),
  'spades_3': require('../../assets/cards/spades_3.svg'),
  'spades_4': require('../../assets/cards/spades_4.svg'),
  'spades_5': require('../../assets/cards/spades_5.svg'),
  'spades_6': require('../../assets/cards/spades_6.svg'),
  'spades_7': require('../../assets/cards/spades_7.svg'),
  'spades_8': require('../../assets/cards/spades_8.svg'),
  'spades_9': require('../../assets/cards/spades_9.svg'),
  'spades_10': require('../../assets/cards/spades_10.svg'),
  'spades_jack': require('../../assets/cards/spades_jack.svg'),
  'spades_queen': require('../../assets/cards/spades_queen.svg'),
  'spades_king': require('../../assets/cards/spades_king.svg'),
};

/**
 * Get image source for a card based on game format
 * @param rank - Card rank (A, 2-10, J, Q, K)
 * @param suit - Card suit (H, D, C, S)
 * @returns Image source for React Native Image component or null
 */
export function getCardAsset(rank: string, suit: string): ImageSourcePropType | null {
  const assetSuit = SUIT_MAP[suit.toUpperCase()];
  const assetRank = RANK_MAP[rank.toUpperCase()];
  
  if (!assetSuit || !assetRank) {
    console.warn(`Invalid card: ${rank} of ${suit}`);
    return null;
  }
  
  const key = `${assetSuit}_${assetRank}`;
  // Return pre-loaded module-level asset (already frozen at module initialization)
  return CARD_IMAGE_SOURCES[key] || null;
}

/**
 * Get card asset mapping details
 * @param rank - Card rank (A, 2-10, J, Q, K)
 * @param suit - Card suit (H, D, C, S)
 * @returns Card asset mapping object
 */
export function getCardMapping(rank: string, suit: string): CardAssetMapping | null {
  const assetSuit = SUIT_MAP[suit.toUpperCase()];
  const assetRank = RANK_MAP[rank.toUpperCase()];
  
  if (!assetSuit || !assetRank) {
    return null;
  }
  
  const fileName = `${assetSuit}_${assetRank}.svg`;
  const key = `${assetSuit}_${assetRank}`;
  const source = CARD_IMAGE_SOURCES[key];
  
  return source ? {
    suit: assetSuit,
    rank: assetRank,
    fileName,
    source, // Return pre-loaded source directly
  } : null;
}

/**
 * Preload all card assets (optional - for performance)
 * Call this during app initialization
 */
export function preloadCardAssets(): void {
  // Assets are already loaded via require() - this is a no-op
  // Kept for API compatibility if needed in the future
  console.log('Card assets preloaded (52 cards)');
}
