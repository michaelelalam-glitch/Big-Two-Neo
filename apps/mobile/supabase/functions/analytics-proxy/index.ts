// deno-lint-ignore-file no-explicit-any
/**
 * analytics-proxy — Server-side proxy for GA4 Measurement Protocol.
 *
 * Moves the GA4 API_SECRET off the client binary and into Supabase secrets.
 * The client sends events to this Edge Function instead of directly to GA4.
 *
 * Supabase secret required:
 *   supabase secrets set GA4_API_SECRET=your_api_secret_here
 *   supabase secrets set GA4_MEASUREMENT_ID=G-XXXXXXXXXX
 */

// M12: CORS origin controlled by ALLOWED_ORIGIN env var (see _shared/cors.ts)
import { buildCorsHeaders } from '../_shared/cors.ts';
// L5: Request ID tracing + L4: standardized error responses
import { errorResponse, getRequestId } from '../_shared/responses.ts';
// P5-7 Fix: DB-backed rate limiter shared across all isolates (replaces in-memory Map).
import { checkRateLimit, rateLimitResponse } from '../_shared/rateLimiter.ts';

const GA4_API_SECRET = Deno.env.get('GA4_API_SECRET') ?? '';
const GA4_MEASUREMENT_ID = Deno.env.get('GA4_MEASUREMENT_ID') ?? '';
const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkMinimumVersion } from '../_shared/versionCheck.ts';

Deno.serve(async (req) => {
  // M12: CORS origin controlled by ALLOWED_ORIGIN env var
  const corsHeaders = buildCorsHeaders();

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // L5: Propagate request ID for tracing
  const requestId = getRequestId(req);

  // C3: Enforce minimum app version
  const versionError = checkMinimumVersion(req, { ...corsHeaders, 'X-Request-ID': requestId });
  if (versionError) return versionError;

  if (req.method !== 'POST') {
    return errorResponse(405, 'Method not allowed', corsHeaders, 'METHOD_NOT_ALLOWED', requestId);
  }

  // ── Fast-path: reject requests missing Authorization header ─────────────────
  // Check header presence before buffering the body so unauthenticated POSTs are
  // rejected immediately without burning I/O reading the payload.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse(401, 'Unauthorized', corsHeaders, 'UNAUTHORIZED', requestId);
  }

  // ── Early request size guard ──────────────────────────────────────────────
  // Buffer the entire body (bounded to 64 KB) before JWT validation so both
  // Content-Length-declared AND chunked oversized requests are rejected without
  // paying for auth.getUser() or rate-limit DB round-trips. rawBodyText is
  // reused for JSON.parse after auth succeeds.
  const AP_MAX_BODY_BYTES = 65_536; // 64 KB
  const clHeader = req.headers.get('content-length');
  if (clHeader !== null) {
    const cl = Number(clHeader);
    if (!Number.isFinite(cl) || cl < 0 || cl > AP_MAX_BODY_BYTES) {
      return errorResponse(413, 'Request body too large', corsHeaders, 'PAYLOAD_TOO_LARGE', requestId);
    }
  }
  let rawBodyText = '';
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let bodyReadFailed = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > AP_MAX_BODY_BYTES) {
          await reader.cancel().catch(() => undefined);
          return errorResponse(413, 'Request body too large', corsHeaders, 'PAYLOAD_TOO_LARGE', requestId);
        }
        chunks.push(value);
      }
    } catch { bodyReadFailed = true; } finally { reader.releaseLock(); }
    if (bodyReadFailed) {
      return errorResponse(400, 'Failed to read request body', corsHeaders, 'BAD_REQUEST', requestId);
    }
    if (chunks.length > 0) {
      const bodyBytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) { bodyBytes.set(chunk, offset); offset += chunk.byteLength; }
      rawBodyText = new TextDecoder().decode(bodyBytes);
    }
  }

  const token = authHeader.slice(7);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[analytics-proxy] SUPABASE_URL or SUPABASE_ANON_KEY not configured');
    return errorResponse(500, 'Server misconfigured', corsHeaders, 'INTERNAL_ERROR', requestId);
  }
  if (!supabaseServiceKey) {
    console.error('[analytics-proxy] SUPABASE_SERVICE_ROLE_KEY not configured — rate limiting cannot be enforced');
    return errorResponse(500, 'Server misconfigured', corsHeaders, 'INTERNAL_ERROR', requestId);
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse(401, 'Invalid or expired token', corsHeaders, 'UNAUTHORIZED', requestId);
  }

  // P5-7 Fix: DB-backed per-user rate limiting — enforced globally across all isolates.
  // 60 events/min per user matches the previous in-memory limit but is now shared-state.
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const rl = await checkRateLimit(supabaseAdmin, user.id, 'analytics_proxy', 60, 60);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfterMs, { ...corsHeaders, 'X-Request-ID': requestId });
  }

  if (!GA4_API_SECRET || !GA4_MEASUREMENT_ID) {
    console.error('[analytics-proxy] GA4_API_SECRET or GA4_MEASUREMENT_ID not configured');
    return errorResponse(500, 'Analytics not configured', corsHeaders, 'INTERNAL_ERROR', requestId);
  }

  // rawBodyText was buffered before auth (above) for DoS protection.
  let body: any;
  try {
    body = rawBodyText ? JSON.parse(rawBodyText) : null;
    if (!body) return errorResponse(400, 'Invalid JSON body', corsHeaders, 'BAD_REQUEST', requestId);
  } catch {
    return errorResponse(400, 'Invalid JSON body', corsHeaders, 'BAD_REQUEST', requestId);
  }

  try {
    // Basic validation: client_id must be a non-empty string, events must be a non-empty array
    if (typeof body.client_id !== 'string' || body.client_id.length === 0 || !Array.isArray(body.events) || body.events.length === 0) {
      return errorResponse(400, 'Invalid payload: client_id (non-empty string) and events[] required', corsHeaders, 'BAD_REQUEST', requestId);
    }

    // Cap events per request to prevent abuse
    if (body.events.length > 25) {
      return errorResponse(400, 'Too many events (max 25 per request)', corsHeaders, 'BAD_REQUEST', requestId);
    }

    // Overwrite user_id with authenticated user to prevent spoofing
    body.user_id = user.id;

    // Validate events: keep only non-array object entries with a non-empty string
    // name, then normalise params in one place so malformed client payloads are
    // coerced to {} instead of being silently dropped.
    const validEvents = (body.events as any[])
      .filter((event: any) => {
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
          return false;
        }
        return typeof event.name === 'string' && event.name.length > 0;
      })
      .map((event: any) => ({
        ...event,
        params:
          event.params !== null &&
          typeof event.params === 'object' &&
          !Array.isArray(event.params)
            ? event.params
            : {},
      }));
    if (validEvents.length === 0) {
      return errorResponse(400, 'No valid events: each event must be an object with a non-empty string name', corsHeaders, 'BAD_REQUEST', requestId);
    }

    // ── BigQuery-first: persist FULL (untruncated) event data ──────────────────
    // Write to analytics_raw_events BEFORE the 100-char GA4 truncation so that
    // every parameter value is stored verbatim. This table is the authoritative
    // BigQuery source for detailed analytics queries (e.g. full standings JSON,
    // combo breakdowns, match score arrays).
    // Normalise user_properties once (shared across all events in this request).
    // Coerce to a plain object so structuredClone and the GA4 forward always
    // receive the expected shape, even if a malformed client passes a string or array.
    const safeUserProperties: Record<string, unknown> =
      body.user_properties !== null &&
      typeof body.user_properties === 'object' &&
      !Array.isArray(body.user_properties)
        ? (body.user_properties as Record<string, unknown>)
        : {};
    // Assign the normalised value back so the GA4 forward path uses the safe shape.
    body.user_properties = safeUserProperties;

    const isDebug = body.debug_mode === 1;
    const rawRows = validEvents.map((event: any) => {
      // Coerce event.params to a plain object for the same reasons.
      const safeParams: Record<string, unknown> =
        event.params !== null &&
        typeof event.params === 'object' &&
        !Array.isArray(event.params)
          ? (event.params as Record<string, unknown>)
          : {};
      // Assign the normalised value back so the GA4 truncation loop below sees it.
      event.params = safeParams;
      return {
      event_name:       event.name,
      user_id:          user.id,
      client_id:        body.client_id,
      session_id:       typeof safeParams.session_id === 'number'
                          ? safeParams.session_id
                          : null,
      platform:         typeof safeParams.platform === 'string'
                          ? safeParams.platform
                          : null,
      app_version:      typeof safeParams.app_version === 'string'
                          ? safeParams.app_version
                          : null,
      // Deep-copy params so the subsequent GA4 truncation doesn't affect the stored value.
      // structuredClone is preferred over JSON.parse(JSON.stringify(...)): it is faster,
      // avoids unnecessary serialization round-trips, and is equally safe here because
      // event.params / body.user_properties arrive from JSON.parse so they are
      // guaranteed to contain only JSON-safe values (no functions, symbols, or bigints).
      event_params:     structuredClone(safeParams),
      user_properties:  structuredClone(safeUserProperties),
      debug_mode:       isDebug,
      // received_at is intentionally omitted: the column DEFAULT now() provides an
      // authoritative Postgres ingest timestamp without clock-skew from Edge isolates.
    };
    });

    // Register the insert with EdgeRuntime.waitUntil so the Supabase Edge runtime
    // keeps the Promise alive even after the HTTP response is returned. Without
    // this, the isolate may be terminated before the write completes (fire-and-
    // forget promises are not guaranteed to finish in Deno Deploy / Supabase EF).
    const insertPromise = supabaseAdmin
      .from('analytics_raw_events')
      .insert(rawRows)
      .then(({ error: dbErr }: { error: any }) => {
        if (dbErr) {
          console.warn('[analytics-proxy] analytics_raw_events write failed:', dbErr.message);
        }
      })
      .catch((insertErr: unknown) => {
        console.warn('[analytics-proxy] analytics_raw_events insert threw:', insertErr);
      });
    (globalThis as any).EdgeRuntime?.waitUntil(insertPromise);

    // ── GA4: enforce 100-char string param limit ────────────────────────────────
    // Applied only to the GA4 copy — the BigQuery store above already captured
    // the full untruncated values.
    for (const event of validEvents) {
      if (event.params && typeof event.params === 'object') {
        for (const [key, value] of Object.entries(event.params)) {
          if (typeof value === 'string' && value.length > 100) {
            event.params[key] = (value as string).substring(0, 100);
          }
        }
      }
    }

    // ── GA4: add timestamp_micros for accurate BigQuery event timing ────────────
    // Without timestamp_micros GA4 uses server-receipt time (can lag up to 72h
    // for daily exports). Setting it here gives BigQuery row timestamps accurate
    // to the millisecond at the proxy receive time.
    const nowMicros = Date.now() * 1000;
    for (const event of validEvents) {
      event.timestamp_micros = nowMicros;
    }
    // Only forward validated events to GA4
    body.events = validEvents;

    const url = `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(GA4_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(GA4_API_SECRET)}`;

    const ga4Response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!ga4Response.ok) {
      // Log the response body for debugging (invalid payloads, quota errors, etc.).
      const ga4Body = await ga4Response.text().catch(() => '<unreadable>');
      console.error('[analytics-proxy] GA4 error:', ga4Response.status, ga4Body.slice(0, 500));
    }

    return new Response(
      JSON.stringify({ status: ga4Response.status }),
      {
        status: ga4Response.ok ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Request-ID': requestId },
      },
    );
  } catch (error: any) {
    console.error(`[analytics-proxy] reqId=${requestId} Error:`, error);
    return errorResponse(500, error.message || 'Unknown error', corsHeaders, 'INTERNAL_ERROR', requestId);
  }
});
