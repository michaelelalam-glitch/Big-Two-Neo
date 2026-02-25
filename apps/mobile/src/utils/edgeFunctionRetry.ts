/**
 * Edge Function invocation wrapper with automatic retry for transient network errors.
 *
 * Supabase's `functions.invoke()` throws a `FunctionsFetchError` when the underlying
 * `fetch()` call fails (network timeout, DNS resolution failure, connection refused, etc.).
 * These are transient and almost always succeed on retry.
 *
 * This utility wraps the invoke call with exponential backoff retry logic.
 */

import { supabase } from '../services/supabase';
import { networkLogger } from './logger';

/** Maximum number of retry attempts after the initial call fails */
const MAX_RETRIES = 2;

/** Base delay in ms for exponential backoff (500ms, 1000ms) */
const BASE_DELAY_MS = 500;

/**
 * Check if an error is a transient FunctionsFetchError that should be retried.
 * FunctionsFetchError occurs when the HTTP request itself fails (not an HTTP error response).
 */
function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: string; message?: string };
  return (
    err.name === 'FunctionsFetchError' ||
    err.message?.includes('Failed to send a request to the Edge Function') === true
  );
}

/**
 * Invoke a Supabase Edge Function with automatic retry on transient network errors.
 *
 * @param functionName - The name of the edge function to invoke
 * @param options - The invoke options (body, headers, etc.)
 * @returns The result from supabase.functions.invoke()
 */
export async function invokeWithRetry<T = unknown>(
  functionName: string,
  options: { body: Record<string, unknown> },
): Promise<{ data: T | null; error: any }> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke(functionName, options);

      // If the invoke itself succeeded (even with an HTTP error), return immediately.
      // HTTP-level errors (4xx/5xx) are NOT retryable — they indicate a logic/validation error.
      if (!error || !isRetryableError(error)) {
        return { data: data as T, error };
      }

      // It's a retryable FunctionsFetchError
      lastError = error;

      if (attempt < MAX_RETRIES) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt); // 500ms, 1000ms
        networkLogger.warn(
          `[EdgeFn] ⚠️ ${functionName} attempt ${attempt + 1} failed (FunctionsFetchError), ` +
          `retrying in ${delayMs}ms... (${MAX_RETRIES - attempt} retries left)`,
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (err) {
      // Unexpected exception from invoke() itself (very rare)
      lastError = err;

      if (!isRetryableError(err) || attempt >= MAX_RETRIES) {
        networkLogger.error(`[EdgeFn] ❌ ${functionName} failed with non-retryable error:`, err);
        return { data: null, error: err };
      }

      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
      networkLogger.warn(
        `[EdgeFn] ⚠️ ${functionName} attempt ${attempt + 1} threw (retryable), ` +
        `retrying in ${delayMs}ms...`,
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // All retries exhausted
  networkLogger.error(
    `[EdgeFn] ❌ ${functionName} failed after ${MAX_RETRIES + 1} attempts. Last error:`,
    lastError,
  );
  return { data: null, error: lastError };
}
