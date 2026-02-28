/**
 * Edge Function error handling utilities.
 *
 * Pure functions for mapping server error messages to user-friendly explanations
 * and extracting detailed error info from Supabase Edge Function responses.
 *
 * Extracted from useRealtime.ts to reduce file size and enable independent testing.
 */

import type { EdgeFunctionError } from './edgeFunctionRetry';
import { gameLogger } from './logger';

/**
 * Map server error messages to user-friendly explanations.
 * Provides context and guidance for why a play was rejected.
 */
export function getPlayErrorExplanation(serverError: string): string {
  const errorLower = serverError.toLowerCase();
  
  // Turn validation
  if (errorLower.includes('not your turn')) {
    return 'Not your turn. Wait for other players to complete their moves.';
  }
  
  // First play 3♦ requirement
  if (errorLower.includes('first play') && errorLower.includes('3')) {
    return 'First play must include the 3 of Diamonds (3♦).';
  }
  
  // Invalid combination
  // Use regex for more specific pattern matching to avoid false positives
  if (/\b(invalid card combination|invalid combo)\b/i.test(serverError)) {
    return 'Invalid card combination. Valid plays: Single, Pair, Triple, Straight, Flush, Full House, Four of a Kind, Straight Flush.';
  }
  
  // Cannot beat last play
  if (errorLower.includes('cannot beat')) {
    const match = serverError.match(/Cannot beat (\w+) with (\w+)/i);
    if (match) {
      return `Cannot beat ${match[1]} with ${match[2]}. Play a higher card combo or pass.`;
    }
    return 'Cannot beat the current play. Play higher cards or pass your turn.';
  }
  
  // One Card Left Rule
  if (errorLower.includes('one card left')) {
    return 'One Card Left Rule: When next player has 1 card, you must play your highest single card if playing a single.';
  }
  
  // Card not in hand
  if (errorLower.includes('card not in hand')) {
    return 'One or more selected cards are not in your hand. Please refresh and try again.';
  }
  
  // Game state errors
  if (errorLower.includes('game state not found')) {
    return 'Game state not found. The game may have ended or been disconnected.';
  }
  
  if (errorLower.includes('room not found')) {
    return 'Room not found. The game session may have expired.';
  }
  
  // Default: return original server error
  return serverError;
}

/**
 * Extract detailed error message from Supabase Edge Function response.
 * When an Edge Function returns a non-2xx status, the actual error details
 * are in error.context, not just error.message.
 */
export async function extractEdgeFunctionErrorAsync(
  error: EdgeFunctionError | null,
  result: { error?: string } | null,
  fallback: string,
): Promise<string> {
  // Priority 1: Check if result has error field (from Edge Function response body)
  // This works when the Edge Function returns a successful response with error details
  if (result?.error) {
    return result.error;
  }
  
  // Priority 2: Try to read the response body from error.context
  // When Edge Function returns 4xx/5xx, Supabase stores the Response object in error.context
  // Add timeout to body reading to prevent hanging in critical error paths
  // Reduced timeout from 2s to 1s for better user-facing responsiveness
  if (error?.context && typeof error.context.text === 'function' && !error.context.bodyUsed) {
    try {
      // Race against timeout to prevent hanging if body reading fails or hangs
      const bodyTextPromise = error.context.text();
      const timeoutPromise = new Promise<string>((_, reject) => 
        setTimeout(() => reject(new Error('Body read timeout')), 1000)
      );
      
      const bodyText = await Promise.race([bodyTextPromise, timeoutPromise]);
      const parsed = JSON.parse(bodyText);
      if (parsed?.error) {
        gameLogger.info('[extractEdgeFunctionError] ✅ Extracted error from response body:', parsed.error);
        return parsed.error;
      }
    } catch (e) {
      // Body may already be consumed, timed out, or contain invalid JSON - fall through to Priority 3
      gameLogger.warn('[extractEdgeFunctionError] Failed to read/parse response body:', e);
    }
  }
  
  // Priority 3: Check if error.context already has parsed fields (body already consumed above)
  if (error?.context) {
    // Try to get error from parsed body
    if (error.context.error) {
      return error.context.error;
    }
    
    // Try to parse JSON body string if present
    if (error.context.body) {
      try {
        const parsed = typeof error.context.body === 'string' 
          ? JSON.parse(error.context.body) 
          : error.context.body;
        if (parsed?.error) {
          return parsed.error;
        }
      } catch (e) {
        gameLogger.warn('[extractEdgeFunctionError] Failed to parse error.context.body:', e);
      }
    }
    
    // If we have status code but no error message, return generic status
    if (error.context.status) {
      const status = error.context.status;
      const statusText = error.context.statusText || '';
      return `HTTP ${status}${statusText ? ': ' + statusText : ''}`;
    }
  }
  
  // Priority 4: Use error.message (usually "Edge Function returned a non-2xx status code")
  if (error?.message && error.message !== 'Edge Function returned a non-2xx status code') {
    return error.message;
  }
  
  // Fallback
  return fallback;
}

/**
 * Type guard to validate auto-pass timer broadcast payload.
 */
export function isValidTimerStatePayload(
  payload: unknown
): payload is { timer_state: import('../types/multiplayer').AutoPassTimerState } {
  if (typeof payload !== 'object' || payload === null || !('timer_state' in payload)) {
    return false;
  }
  
  const timerState = (payload as { timer_state: unknown }).timer_state;
  
  if (typeof timerState !== 'object' || timerState === null) {
    return false;
  }
  
  const state = timerState as Record<string, unknown>;
  
  // Validate basic timer fields
  if (
    typeof state.active !== 'boolean' ||
    typeof state.started_at !== 'string' ||
    typeof state.duration_ms !== 'number' ||
    typeof state.remaining_ms !== 'number'
  ) {
    return false;
  }
  
  // Validate triggering_play structure
  const triggeringPlay = state.triggering_play;
  if (typeof triggeringPlay !== 'object' || triggeringPlay === null) {
    return false;
  }
  
  const play = triggeringPlay as Record<string, unknown>;
  return (
    typeof play.position === 'number' &&
    Array.isArray(play.cards) &&
    typeof play.combo_type === 'string'
  );
}
