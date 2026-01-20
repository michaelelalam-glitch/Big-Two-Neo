/**
 * Shared utility for parsing cards from raw database format
 * Used by both player-pass and play-cards Edge Functions
 * 
 * @copilot-review-fix Extracted from duplicate implementations in player-pass/index.ts and play-cards/index.ts
 */

export interface ParsedCard {
  id: string;
  suit: string;
  rank: string;
}

/**
 * Parse cards from raw database format to structured card objects
 * 
 * Handles two formats:
 * 1. String format: "5D" → {id: "5D", suit: "D", rank: "5"}
 * 2. Object format: {id?: string, suit: string, rank: string}
 * 
 * @param rawCards Array of cards in either string or object format
 * @returns Array of parsed card objects with id, suit, and rank
 */
export function parseCards(rawCards: unknown[]): ParsedCard[] {
  if (!Array.isArray(rawCards)) return [];
  
  return rawCards.map(c => {
    if (typeof c === 'string') {
      // Format: "5D" → {id: "5D", suit: "D", rank: "5"}
      // @copilot-review-fix: Supports both "10" and "T" for ten (e.g., "10D" or "TD")
      // Ranks: 2-9, 10, T (alias for ten), J, Q, K, A | Suits: D, C, H, S
      // Regex order: [2-9TJQKA] matches single-char ranks; |10 handles two-char "10"
      const match = c.match(/^([2-9TJQKA]|10)([DCHS])$/);
      if (match) {
        const [, rank, suit] = match;
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
