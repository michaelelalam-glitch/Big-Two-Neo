/**
 * Parse multiplayer hand data from Supabase game_state.
 *
 * Handles legacy formats:
 * - String cards like "D10" → { id: "D10", rank: "10", suit: "D" }
 * - Double-JSON-encoded strings: "\"D10\"" → unwrapped then parsed
 * - Already-parsed objects: { id, rank, suit } → passed through
 *
 * Extracted from GameScreen.tsx to improve readability and enable reuse.
 */

import { gameLogger } from './logger';

export interface ParsedCard {
  id: string;
  rank: string;
  suit: string;
}

/**
 * Parse a raw hands object from game_state into consistently typed card objects.
 *
 * @param hands - The raw `hands` field from game_state (may contain strings or objects).
 * @returns Parsed hands indexed by player index string, or `undefined` if input is falsy.
 * @throws If any card within a hand cannot be parsed (prevents playing with incomplete data).
 */
export function parseMultiplayerHands(
  hands: Record<string, (ParsedCard | string)[]> | undefined | null,
): Record<string, ParsedCard[]> | undefined {
  if (!hands) return undefined;

  const parsedHands: Record<string, ParsedCard[]> = {};

  for (const [playerIndex, handData] of Object.entries(hands)) {
    if (!Array.isArray(handData)) continue;

    // Map cards with index tracking for better error reporting
    const parseResults = handData.map((card: ParsedCard | string, index: number) => {
      // If card is already an object with id/rank/suit, return as-is
      if (typeof card === 'object' && card !== null && 'id' in card && 'rank' in card && 'suit' in card) {
        return { index, raw: card, parsed: card as ParsedCard };
      }

      // If card is a string, parse it into object format
      if (typeof card === 'string') {
        // Handle double-JSON-encoded strings: "\"D10\"" -> "D10"
        let cardStr = card;
        /**
         * Maximum iterations for JSON parsing loop to handle legacy nested string formats.
         * Rationale: Legacy data may have cards with 2-3 levels of JSON nesting.
         * Setting to 5 provides safety margin while preventing infinite loops.
         */
        const MAX_ITERATIONS = 5;
        let iterations = 0;
        try {
          while (
            typeof cardStr === 'string' &&
            (cardStr.startsWith('"') || cardStr.startsWith('{')) &&
            iterations < MAX_ITERATIONS
          ) {
            iterations++;
            const parsed = JSON.parse(cardStr);
            if (typeof parsed === 'string') {
              const previousCardStr = cardStr;
              cardStr = parsed;
              if (cardStr === previousCardStr) {
                gameLogger.warn('[parseMultiplayerHands] JSON.parse returned same value, breaking loop');
                break;
              }
            } else if (typeof parsed === 'object' && parsed !== null) {
              return { index, raw: card, parsed: parsed as ParsedCard };
            } else {
              break;
            }
          }
        } catch {
          // Not JSON, treat as plain string
          gameLogger.debug('[parseMultiplayerHands] JSON parse failed, treating as plain string:', { card });
        }

        // Now cardStr should be like "D10", "C5", "HK", etc.
        if (cardStr.length >= 2) {
          const validSuits = ['D', 'C', 'H', 'S'] as const;
          const suitChar = cardStr[0];
          if (!validSuits.includes(suitChar as (typeof validSuits)[number])) {
            gameLogger.error('[parseMultiplayerHands] 🚨 Invalid suit detected:', {
              rawCard: card,
              parsedString: cardStr,
              suitChar,
            });
            return { index, raw: card, parsed: null };
          }
          const suit = suitChar as (typeof validSuits)[number];
          const rank = cardStr.substring(1);
          return { index, raw: card, parsed: { id: cardStr, rank, suit } };
        }
      }

      gameLogger.error('[parseMultiplayerHands] 🚨 Could not parse card:', card);
      return { index, raw: card, parsed: null };
    });

    // Fail completely if any cards couldn't be parsed
    const failedParses = parseResults.filter(r => r.parsed === null);
    if (failedParses.length > 0) {
      const failedIndices = failedParses.map(f => f.index);
      const errorMsg = `Card parsing failed for ${failedParses.length}/${handData.length} cards in hand for player ${playerIndex}. Failed indices: ${failedIndices.join(', ')}. Cannot proceed with incomplete hand.`;
      gameLogger.error('[parseMultiplayerHands] 🚨 CRITICAL: ' + errorMsg, {
        playerIndex,
        totalCards: handData.length,
        failedCount: failedParses.length,
        failedCards: failedParses.map(f => f.raw),
      });
      throw new Error(errorMsg);
    }

    parsedHands[playerIndex] = parseResults.map(r => r.parsed!);
  }

  return parsedHands;
}
