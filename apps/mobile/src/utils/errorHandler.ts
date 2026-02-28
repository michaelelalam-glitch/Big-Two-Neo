/**
 * Unified Error Handler
 *
 * Task #576: Centralized error handling utility that standardizes
 * all try-catch patterns across the app.
 *
 * Features:
 * - Extracts a human-readable message from any thrown value
 * - Logs to the appropriate namespaced logger
 * - Optionally surfaces a user-facing alert (via {@link showError})
 * - Returns the extracted message so callers can react further
 *
 * Usage:
 * ```ts
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   handleError(error, { context: 'RiskyOperation', logger: gameLogger });
 * }
 * ```
 *
 * With silent mode (log only, no user alert):
 * ```ts
 * handleError(error, { context: 'BackgroundSync', logger: networkLogger, silent: true });
 * ```
 */

import { showError } from './alerts';
import { gameLogger } from './logger';

/** Any object that exposes an `error(message, ...args)` method (matches react-native-logs extensions). */
interface Logger {
  error: (message: string, ...args: unknown[]) => void;
}

/** Options for {@link handleError}. */
export interface HandleErrorOptions {
  /**
   * A short label describing where the error occurred.
   * Appears in the log entry and (optionally) in the user-facing alert title.
   * @example 'PlayCards', 'JoinRoom', 'SaveStats'
   */
  context?: string;

  /**
   * The namespaced logger to write to (defaults to `gameLogger`).
   * @example gameLogger, networkLogger, authLogger
   */
  logger?: Logger;

  /**
   * When `true`, the error is only logged — no user-facing alert is shown.
   * Useful for background operations where an alert would be disruptive.
   * @default false
   */
  silent?: boolean;

  /**
   * A custom user-facing message to show instead of the raw error text.
   * Useful for translating technical errors into friendly language.
   */
  userMessage?: string;
}

/**
 * Extract a human-readable message from any thrown value.
 *
 * Handles:
 * - `Error` instances (uses `.message`)
 * - Objects with a `.message` string property (e.g. Supabase error payloads)
 * - Objects with a `.error` string property
 * - Primitives (`string`, `number`, etc.) via `String()`
 *
 * @param error - The caught value
 * @returns A non-empty string message
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (error !== null && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message.length > 0) return obj.message;
    if (typeof obj.error === 'string' && obj.error.length > 0) return obj.error;
  }

  const str = String(error);
  return str === 'undefined' || str === 'null' ? 'An unknown error occurred' : str;
}

/**
 * Unified error handler for the entire app.
 *
 * Logs the error with context, then (unless `silent`) surfaces
 * a user-facing alert via {@link showError}.
 *
 * @param error - The caught value (any type).
 * @param options - Optional configuration; see {@link HandleErrorOptions}.
 * @returns The extracted error message string.
 *
 * @example
 * ```ts
 * // Basic usage — logs & shows alert
 * handleError(error, { context: 'PlayCards' });
 *
 * // Silent — logs only
 * handleError(error, { context: 'BackgroundSync', silent: true });
 *
 * // With custom user message
 * handleError(error, {
 *   context: 'JoinRoom',
 *   userMessage: 'Could not join the room. Please try again.',
 * });
 * ```
 */
export function handleError(
  error: unknown,
  options: HandleErrorOptions = {},
): string {
  const {
    context = 'Unknown',
    logger = gameLogger,
    silent = false,
    userMessage,
  } = options;

  const message = extractErrorMessage(error);

  // Log — include context prefix for easy grep-ability
  logger.error(`[${context}] ${message}`);

  // Surface to user unless silent
  if (!silent) {
    showError(userMessage ?? message);
  }

  return message;
}
