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
import { checkRateLimit } from '../_shared/rateLimiter.ts';

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
  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[analytics-proxy] SUPABASE_URL or SUPABASE_ANON_KEY not configured');
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
    return errorResponse(429, 'Too many requests', corsHeaders, 'RATE_LIMITED', requestId);
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

    // Enforce GA4 100-char string param limit server-side
    for (const event of body.events) {
      if (event.params && typeof event.params === 'object') {
        for (const [key, value] of Object.entries(event.params)) {
          if (typeof value === 'string' && value.length > 100) {
            event.params[key] = (value as string).substring(0, 100);
          }
        }
      }
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
