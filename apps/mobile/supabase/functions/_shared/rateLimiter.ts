// deno-lint-ignore-file no-explicit-any
/**
 * Edge Function rate-limiter (shared)
 *
 * Uses the `rate_limit_tracking` table (created in migration
 * 20260308000001_add_rate_limit_tracking.sql) to enforce per-user
 * sliding-window rate limits inside Supabase Edge Functions.
 *
 * Usage:
 *   import { checkRateLimit } from '../_shared/rateLimiter.ts';
 *
 *   const rl = await checkRateLimit(supabaseClient, userId, 'play_cards', 10, 10);
 *   if (!rl.allowed) {
 *     return new Response(
 *       JSON.stringify({ success: false, error: 'Rate limit exceeded', retryAfterMs: rl.retryAfterMs }),
 *       { status: 429, headers: corsHeaders }
 *     );
 *   }
 *
 * Tasks: #281 (room creation) | #556 (Edge Function abuse prevention)
 */

export interface RateLimitResult {
  /** true → request is within limits; false → caller should return 429 (or 503 if blockedByError) */
  allowed: boolean;
  /** Current attempt count in the active window */
  attempts: number;
  /** Milliseconds until the current window resets (useful for Retry-After header) */
  retryAfterMs: number;
  /**
   * true when the request was blocked due to a DB/infra error (not a genuine rate-limit hit).
   * Only set when failClosed=true AND an error occurred. Callers should return 503 (not 429).
   */
  blockedByError?: boolean;
}

/**
 * Check and increment a per-user sliding-window rate limit.
 *
 * @param client         Supabase service-role client (has write access to rate_limit_tracking)
 * @param userId         UUID of the acting user
 * @param action         Arbitrary label, e.g. "play_cards" | "player_pass"
 * @param maxPerWindow   Maximum allowed calls within the window
 * @param windowSeconds  Window size in seconds (e.g. 10 for "10 requests per 10 s")
 * @param failClosed     When true, DB errors return allowed=false (503) instead of allowing
 *                       the request. Use for high-risk endpoints (play-cards, find-match).
 *                       Defaults to false (fail-open = best-effort, never blocks gameplay).
 *
 * The function performs an atomic UPSERT via the `upsert_rate_limit_counter`
 * Postgres function, so concurrent requests from the same user are counted correctly
 * even under Edge Function concurrency.
 *
 * If the DB call itself fails (e.g. during a Supabase outage):
 *   - failClosed=false → ALLOWS the request (best-effort; never blocks legitimate gameplay)
 *   - failClosed=true  → BLOCKS the request with 503 (use on high-risk abuse vectors)
 */
export async function checkRateLimit(
  client: any,           // SupabaseClient — typed as `any` to avoid importing the heavy type in every caller
  userId: string,
  action: string,
  maxPerWindow: number,
  windowSeconds: number,
  failClosed = false,
): Promise<RateLimitResult> {
  // M7: Check against DB for every request — no in-memory bypass.
  // (The former allow-cache was removed because it allowed unbounded requests
  // within its 1s TTL window without incrementing the DB counter.)
  try {
    const { data, error } = await client.rpc('upsert_rate_limit_counter', {
      p_user_id:     userId,
      p_action_type: action,
      p_window_secs: windowSeconds,
    });

    if (error) {
      // Non-fatal by default: allow request but log for observability.
      // failClosed=true callers (high-risk endpoints) receive allowed=false so
      // abuse during DB degradation is blocked rather than silently permitted.
      console.error(`[rateLimiter] DB error for ${action}/${userId.substring(0, 8)}:`, error.message);
      return { allowed: !failClosed, blockedByError: failClosed, attempts: 0, retryAfterMs: 0 };
    }

    const attempts: number = data as number;
    const allowed = attempts <= maxPerWindow;
    // Compute remaining time in the current window using the same bucket formula
    // as the DB: floor(epochSeconds / windowSeconds) * windowSeconds.
    // This avoids over-reporting the wait time when the window is nearly expired.
    const nowMs = Date.now();
    const windowStartMs = Math.floor(nowMs / 1000 / windowSeconds) * windowSeconds * 1000;
    const windowEndMs = windowStartMs + windowSeconds * 1000;
    const retryAfterMs = allowed ? 0 : Math.max(0, windowEndMs - nowMs);

    if (!allowed) {
      console.warn(
        `[rateLimiter] 🚫 Rate limit hit: action="${action}" user=${userId.substring(0, 8)} ` +
        `attempts=${attempts}/${maxPerWindow} window=${windowSeconds}s`,
      );
    }

    // Log suspicious activity: requests > 3× the limit in a single window.
    if (attempts > maxPerWindow * 3) {
      console.error(
        `[rateLimiter] 🚨 SUSPICIOUS: action="${action}" user=${userId.substring(0, 8)} ` +
        `attempts=${attempts} (${Math.round(attempts / maxPerWindow)}× limit). Possible abuse.`,
      );
    }

    return { allowed, attempts, retryAfterMs };
  } catch (err) {
    console.error(`[rateLimiter] Unexpected error for ${action}:`, err);
    return { allowed: !failClosed, blockedByError: failClosed, attempts: 0, retryAfterMs: 0 };
  }
}

/**
 * Build a 503 Response for when rate limiting itself fails (DB outage, infra error).
 * Only used when failClosed=true and blockedByError=true.
 */
export function serviceUnavailableResponse(
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Service temporarily unavailable. Please try again shortly.',
    }),
    {
      status: 503,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': '30',
      },
    },
  );
}

/**
 * Build a 429 Response with Retry-After header.
 * Convenience wrapper for uniform 429 responses across Edge Functions.
 */
export function rateLimitResponse(
  retryAfterMs: number,
  corsHeaders: Record<string, string>,
): Response {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Rate limit exceeded. Please slow down.',
      retryAfterMs,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSec),
      },
    },
  );
}
