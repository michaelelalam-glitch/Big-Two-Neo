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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GA4_API_SECRET = Deno.env.get('GA4_API_SECRET') ?? '';
const GA4_MEASUREMENT_ID = Deno.env.get('GA4_MEASUREMENT_ID') ?? '';
const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

import { createClient } from 'jsr:@supabase/supabase-js@2';

// Best-effort per-user rate limiter: max 60 requests per minute per authenticated user.
// Rate-limit key is the authenticated user.id from the verified JWT — cannot be spoofed
// by the client. (No IP header such as x-forwarded-for is used as the key; those are
// trivially spoofed and would allow bypassing or targeting the throttle.)
// NOTE: This is instance-local (each Edge Function isolate has its own Map).
// It does NOT enforce a global limit across concurrent isolates or cold starts.
// For strict enforcement, use a shared store (e.g., Redis/Supabase table).
// Entries are swept periodically to bound memory.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_MAP_CAP = 10_000;
let _sweepCounter = 0;

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else {
    entry.count += 1;
    if (entry.count > RATE_LIMIT_MAX) return true;
  }
  // Periodic sweep: every 100 requests OR when map exceeds cap
  _sweepCounter += 1;
  if (_sweepCounter >= 100 || rateLimitMap.size > RATE_LIMIT_MAP_CAP) {
    _sweepCounter = 0;
    for (const [k, v] of rateLimitMap) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
    // Hard FIFO eviction: if still over cap after purging expired entries
    if (rateLimitMap.size > RATE_LIMIT_MAP_CAP) {
      const excess = rateLimitMap.size - RATE_LIMIT_MAP_CAP;
      let removed = 0;
      for (const k of rateLimitMap.keys()) {
        if (removed >= excess) break;
        rateLimitMap.delete(k);
        removed += 1;
      }
    }
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Require valid Supabase JWT to prevent anonymous abuse
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[analytics-proxy] SUPABASE_URL or SUPABASE_ANON_KEY not configured');
    return new Response(
      JSON.stringify({ error: 'Server misconfigured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Per-user rate limiting (using authenticated user.id, not spoofable IP)
  if (isRateLimited(user.id)) {
    return new Response(
      JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (!GA4_API_SECRET || !GA4_MEASUREMENT_ID) {
    console.error('[analytics-proxy] GA4_API_SECRET or GA4_MEASUREMENT_ID not configured');
    return new Response(
      JSON.stringify({ error: 'Analytics not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    // Basic validation: must have client_id and events array
    if (!body.client_id || !Array.isArray(body.events) || body.events.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload: client_id and events[] required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Cap events per request to prevent abuse
    if (body.events.length > 25) {
      return new Response(
        JSON.stringify({ error: 'Too many events (max 25 per request)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    console.error('[analytics-proxy] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
