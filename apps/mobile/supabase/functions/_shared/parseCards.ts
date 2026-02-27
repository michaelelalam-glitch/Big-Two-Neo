/**
 * Shared utility for parsing cards from raw database format
 * Used by both player-pass and play-cards Edge Functions
 * 
 * Extracted from duplicate implementations in player-pass/index.ts and play-cards/index.ts
 */

export interface ParsedCard {
  id: string;
  suit: string;
  rank: string;
}

/**
 * Parse cards from raw database format to structured card objects
 * 
 * Handles THREE formats (backwards compatible):
 * 1. Rank-Suit format: "5D" → {id: "5D", suit: "D", rank: "5"}  (client format)
 * 2. Suit-Rank format: "D5" → {id: "D5", suit: "D", rank: "5"}  (SQL deck format)
 * 3. Object format: {id?: string, suit: string, rank: string}
 * 
 * @param rawCards Array of cards in either string or object format
 * @returns Array of parsed card objects with id, suit, and rank
 */
export function parseCards(rawCards: unknown[]): ParsedCard[] {
  if (!Array.isArray(rawCards)) return [];
  
  return rawCards.map(c => {
    if (typeof c === 'string') {
      // Try FORMAT 1: Rank-Suit (e.g., "5D", "10D", "JD")
      // Ranks: 2-9, 10, T (alias for ten), J, Q, K, A | Suits: D, C, H, S
      const rankSuitMatch = c.match(/^([2-9TJQKA]|10)([DCHS])$/);
      if (rankSuitMatch) {
        const [, rank, suit] = rankSuitMatch;
        return { id: c, suit, rank };
      }
      
      // Try FORMAT 2: Suit-Rank (e.g., "D5", "D10", "DJ") - SQL deck format
      // Suit first (D, C, H, S), then rank
      const suitRankMatch = c.match(/^([DCHS])([2-9TJQKA]|10)$/);
      if (suitRankMatch) {
        const [, suit, rank] = suitRankMatch;
        return { id: c, suit, rank };
      }
    } else if (typeof c === 'object' && c !== null) {
      const card = c as { id?: string; suit?: string; rank?: string };
      if (card.suit && card.rank) {
        return {
          id: card.id || `${card.rank}${card.suit}`,
          suit: card.suit,
          rank: card.rank,
        };
      }
    }
    return null;
  }).filter((c): c is ParsedCard => c !== null);
}
