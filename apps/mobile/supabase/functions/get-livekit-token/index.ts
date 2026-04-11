/**
 * get-livekit-token — Supabase Edge Function (Task #649 / #651)
 *
 * Generates a signed LiveKit JWT for the authenticated caller.
 * The client supplies `roomId` (Supabase room UUID) and an optional
 * `displayName`. The function validates the caller's Supabase JWT,
 * then mints a LiveKit JWT granting publish + subscribe access to
 * that room.
 *
 * Required environment variables (set in Supabase project settings):
 *   LIVEKIT_API_KEY    — LiveKit project API key
 *   LIVEKIT_API_SECRET — LiveKit project API secret
 *   LIVEKIT_URL        — LiveKit server WebSocket URL
 *                        e.g. wss://your-project.livekit.cloud
 *   SUPABASE_URL       — injected automatically by Supabase
 *   SUPABASE_ANON_KEY  — injected automatically by Supabase
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkMinimumVersion } from '../_shared/versionCheck.ts';
// M12: CORS origin controlled by ALLOWED_ORIGIN env var
import { buildCorsHeaders } from '../_shared/cors.ts';
// #32 — Rate limiting (P6-2)
import { checkRateLimit, rateLimitResponse } from '../_shared/rateLimiter.ts';

const LIVEKIT_API_KEY    = Deno.env.get('LIVEKIT_API_KEY')    ?? '';
const LIVEKIT_API_SECRET = Deno.env.get('LIVEKIT_API_SECRET') ?? '';
const LIVEKIT_URL        = Deno.env.get('LIVEKIT_URL')        ?? '';

const CORS_HEADERS = buildCorsHeaders();

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/** Base64url-encode a Uint8Array (RFC 4648 §5, no padding). */
function toBase64Url(buf: Uint8Array): string {
  const binary = Array.from(buf).map(b => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build and HS256-sign a LiveKit JWT.
 *
 * The `video` grant is the minimal set required for joining a room as a
 * publisher and subscriber.  `canPublishData` enables data-channel messages
 * (used for mute-state sync in future iterations).
 */
async function buildLiveKitToken(
  room: string,
  participantIdentity: string,
  participantName: string,
  ttlSeconds = 3600,
): Promise<string> {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new Error('LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured');
  }

  const iat = Math.floor(Date.now() / 1000);
  const header  = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss:  LIVEKIT_API_KEY,
    sub:  participantIdentity,
    name: participantName,
    iat,
    nbf:  iat,
    exp:  iat + ttlSeconds,
    jti:  crypto.randomUUID(),
    video: {
      room,
      roomJoin:       true,
      canPublish:     true,
      canSubscribe:   true,
      canPublishData: true,
    },
  };

  const enc        = new TextEncoder();
  const headerB64  = toBase64Url(enc.encode(JSON.stringify(header)));
  const payloadB64 = toBase64Url(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(LIVEKIT_API_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig    = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(signingInput));
  const sigB64 = toBase64Url(new Uint8Array(sig));

  return `${signingInput}.${sigB64}`;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

    // C3: Enforce minimum app version
    const versionError = checkMinimumVersion(req, CORS_HEADERS);
    if (versionError) return versionError;

  // ── Config validation (fail fast) ──────────────────────────────────────────
  // Read Supabase vars first (they are auto-injected but could be missing in CI
  // or local dev if not configured). LiveKit vars must be set manually.
  const supabaseUrl     = Deno.env.get('SUPABASE_URL')      ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const missingVars: string[] = [];
  if (!LIVEKIT_API_KEY)    missingVars.push('LIVEKIT_API_KEY');
  if (!LIVEKIT_API_SECRET) missingVars.push('LIVEKIT_API_SECRET');
  if (!LIVEKIT_URL)        missingVars.push('LIVEKIT_URL');
  if (!supabaseUrl)        missingVars.push('SUPABASE_URL');
  if (!supabaseAnonKey)    missingVars.push('SUPABASE_ANON_KEY');
  if (missingVars.length > 0) {
    return new Response(
      JSON.stringify({ error: `Server misconfiguration: missing ${missingVars.join(', ')}` }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  // ── Auth: validate Supabase JWT ─────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Missing Authorization header' }),
      { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  // #32 — Rate limit: 5 tokens per minute per user (P6-2)
  const supabaseServiceClient = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const rl = await checkRateLimit(supabaseServiceClient, user.id, 'get_livekit_token', 5, 60);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfterMs, CORS_HEADERS);
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: { roomId?: unknown; displayName?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  const { roomId, displayName } = body;
  if (!roomId || typeof roomId !== 'string' || roomId.trim() === '') {
    return new Response(
      JSON.stringify({ error: 'roomId is required and must be a non-empty string' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  // Validate roomId is a UUID before passing it to the DB query.
  // room_players.room_id is a UUID column — a non-UUID string would cause a
  // Postgres type error that would be incorrectly surfaced as 403 below.
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(roomId.trim())) {
    return new Response(
      JSON.stringify({ error: 'roomId must be a valid UUID' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  // Participant identity = stable Supabase user UUID.
  // Display name falls back to the first 8 chars of user.id (non-PII).
  // Deliberately avoid using user.email or its prefix — the email is PII
  // and would be exposed to other LiveKit participants via the token name claim.
  const safeDisplayName =
    typeof displayName === 'string' && displayName.trim()
      ? displayName.trim().slice(0, 64)
      : user.id.slice(0, 8);

  // ── Authorization: verify caller is a member of the requested room ──────────
  // Any authenticated user can reach this point; we must ensure they are
  // actually a participant in `roomId` before issuing a token. Without this
  // check any authenticated user could join any room they know the UUID of.
  // #31 — Also verify the room is still active (P6-1): do not issue tokens for
  // ended or abandoned rooms.
  const { data: membership, error: membershipError } = await supabase
    .from('room_players')
    .select('id, rooms!inner(id, status)')
    .eq('room_id', roomId.trim())
    .eq('user_id', user.id)
    .eq('rooms.status', 'active')
    .maybeSingle();

  if (membershipError) {
    // A DB error (e.g. table missing, RLS policy) is a server-side failure, not
    // a client authorisation error — return 500 so production logs surface it.
    return new Response(
      JSON.stringify({ error: 'Failed to verify room membership' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }
  if (!membership) {
    return new Response(
      JSON.stringify({ error: 'Forbidden: you are not a member of an active room with this ID' }),
      { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  // ── Mint LiveKit token ──────────────────────────────────────────────────
  try {
    const token = await buildLiveKitToken(roomId.trim(), user.id, safeDisplayName);
    return new Response(
      JSON.stringify({ token, livekitUrl: LIVEKIT_URL }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token generation failed';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }
});
