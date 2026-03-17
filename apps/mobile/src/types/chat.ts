/**
 * Chat types for in-game text chat (Task #648).
 */

export interface ChatMessage {
  /** Unique message ID (timestamp + sequence, generated client-side) */
  id: string;
  /** Supabase user ID of the sender */
  user_id: string;
  /** Display name of the sender */
  username: string;
  /** Message text (already profanity-filtered on send) */
  message: string;
  /** ISO-8601 timestamp */
  created_at: string;
}
