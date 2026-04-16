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

  // Require valid Supabase JWT to prevent anonymous abuse
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse(401, 'Unauthorized', corsHeaders, 'UNAUTHORIZED', requestId);
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'Invalid JSON body', corsHeaders, 'BAD_REQUEST', requestId);
  }

  try {
    // Basic validation: must have client_id and events array
    if (!body.client_id || !Array.isArray(body.events) || body.events.length === 0) {
      return errorResponse(400, 'Invalid payload: client_id and events[] required', corsHeaders, 'BAD_REQUEST', requestId);
    }

    // Cap events per request to prevent abuse
    if (body.events.length > 25) {
      return errorResponse(400, 'Too many events (max 25 per request)', corsHeaders, 'BAD_REQUEST', requestId);
    }

    // Overwrite user_id with authenticated user to prevent spoofing
    body.user_id = user.id;

    // ── BigQuery-first: persist FULL (untruncated) event data ──────────────────
    // Write to analytics_raw_events BEFORE the 100-char GA4 truncation so that
    // every parameter value is stored verbatim. This table is the authoritative
    // BigQuery source for detailed analytics queries (e.g. full standings JSON,
    // combo breakdowns, match score arrays).
    const receivedAt = new Date().toISOString();
    const isDebug = body.debug_mode === 1;
    const rawRows = (body.events as any[]).map((event: any) => ({
      event_name:       event.name ?? 'unknown',
      user_id:          user.id,
      client_id:        body.client_id,
      session_id:       typeof event.params?.session_id === 'number'
                          ? event.params.session_id
                          : null,
      platform:         typeof event.params?.platform === 'string'
                          ? event.params.platform
                          : null,
      app_version:      typeof event.params?.app_version === 'string'
                          ? event.params.app_version
                          : null,
      // Deep-copy params so the subsequent GA4 truncation doesn't affect the stored value
      event_params:     JSON.parse(JSON.stringify(event.params ?? {})),
      user_properties:  body.user_properties
                          ? JSON.parse(JSON.stringify(body.user_properties))
                          : {},
      debug_mode:       isDebug,
      received_at:      receivedAt,
    }));

    // Fire-and-forget: do not await so GA4 forwarding is never delayed.
    // Errors are logged but do not fail the response to the client.
    supabaseAdmin
      .from('analytics_raw_events')
      .insert(rawRows)
      .then(({ error: dbErr }: { error: any }) => {
        if (dbErr) {
          console.warn('[analytics-proxy] analytics_raw_events write failed:', dbErr.message);
        }
      });

    // ── GA4: enforce 100-char string param limit ────────────────────────────────
    // Applied only to the GA4 copy — the BigQuery store above already captured
    // the full untruncated values.
    for (const event of body.events) {
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
    for (const event of body.events) {
      event.timestamp_micros = nowMicros;
    }

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
