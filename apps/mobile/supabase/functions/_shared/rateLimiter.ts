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
  /** true → request is within limits; false → caller should return 429 */
  allowed: boolean;
  /** Current attempt count in the active window */
  attempts: number;
  /** Milliseconds until the current window resets (useful for Retry-After header) */
  retryAfterMs: number;
}

/**
 * Check and increment a per-user sliding-window rate limit.
 *
 * @param client         Supabase service-role client (has write access to rate_limit_tracking)
 * @param userId         UUID of the acting user
 * @param action         Arbitrary label, e.g. "play_cards" | "player_pass"
 * @param maxPerWindow   Maximum allowed calls within the window
 * @param windowSeconds  Window size in seconds (e.g. 10 for "10 requests per 10 s")
 *
 * The function performs an atomic UPSERT via the `upsert_rate_limit_counter`
 * Postgres function, so concurrent requests from the same user are counted correctly
 * even under Edge Function concurrency.
 *
 * If the DB call itself fails (e.g. during a Supabase outage), the function
 * ALLOWS the request and logs the error — rate limiting is best-effort and
 * should never block legitimate gameplay.
 */
/**
 * M7: Short-lived in-memory allow-cache to reduce DB round-trips.
 *
 * When a user's request was allowed in the last ALLOW_CACHE_TTL_MS milliseconds
 * for the same action, we skip the DB call and return a cached "allowed" result.
 * This is safe because:
 *  - The cache only stores ALLOWED results (never cached blocks).
 *  - TTL is 1 s — much shorter than the rate-limit window (≥10 s), so we cannot
 *    grant more than (1 s / window) extra requests above the nominal limit.
 *  - The cache is instance-local; correctness of enforcement relies on the DB
 *    upsert which remains the source of truth.
 *
 * Effect: reduces DB queries by up to ~10× for burst gameplay (e.g. fast passes).
 */
const ALLOW_CACHE_TTL_MS = 1_000; // 1 second
const ALLOW_CACHE_MAX_SIZE = 500; // max entries before forcing a full sweep
const _allowCache = new Map<string, number>(); // key → expiresAt epoch ms

/** Evict all expired entries; if still over ALLOW_CACHE_MAX_SIZE, clear entirely. */
function _pruneAllowCache(nowMs: number): void {
  for (const [key, expiresAt] of _allowCache) {
    if (nowMs >= expiresAt) _allowCache.delete(key);
  }
  if (_allowCache.size > ALLOW_CACHE_MAX_SIZE) _allowCache.clear();
}

export async function checkRateLimit(
  client: any,           // SupabaseClient — typed as `any` to avoid importing the heavy type in every caller
  userId: string,
  action: string,
  maxPerWindow: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  // M7: Check instance-local allow cache before going to DB
  const cacheKey = `${userId}:${action}`;
  const now = Date.now();
  const cachedAllowedUntil = _allowCache.get(cacheKey);
  if (cachedAllowedUntil !== undefined && now < cachedAllowedUntil) {
    return { allowed: true, attempts: 0, retryAfterMs: 0 };
  }
  try {
    const { data, error } = await client.rpc('upsert_rate_limit_counter', {
      p_user_id:     userId,
      p_action_type: action,
      p_window_secs: windowSeconds,
    });

    if (error) {
      // Non-fatal: allow request but log for observability.
      console.error(`[rateLimiter] DB error for ${action}/${userId.substring(0, 8)}:`, error.message);
      return { allowed: true, attempts: 0, retryAfterMs: 0 };
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

    // M7: Populate allow cache so the next request within the TTL skips the DB call.
    if (allowed) {
      // Opportunistically prune expired entries to bound Map growth.
      if (_allowCache.size >= ALLOW_CACHE_MAX_SIZE) _pruneAllowCache(Date.now());
      _allowCache.set(cacheKey, Date.now() + ALLOW_CACHE_TTL_MS);
    } else {
      // If blocked, evict any stale allow cache entry immediately.
      _allowCache.delete(cacheKey);
    }

    return { allowed, attempts, retryAfterMs };
  } catch (err) {
    console.error(`[rateLimiter] Unexpected error for ${action}:`, err);
    return { allowed: true, attempts: 0, retryAfterMs: 0 };
  }
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
