import { createClient } from 'jsr:@supabase/supabase-js@2'
import { checkMinimumVersion } from '../_shared/versionCheck.ts';
// M12: CORS origin controlled by ALLOWED_ORIGIN env var
import { buildCorsHeaders } from '../_shared/cors.ts';

const corsHeaders = buildCorsHeaders();

// FCM v1 API configuration
const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID') || 'big2-969bc'; // Fallback for backward compatibility
const FCM_API_URL = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
const FCM_SCOPES = ['https://www.googleapis.com/auth/firebase.messaging']

interface PushMessage {
  to: string;
  userId?: string;
  sound: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
}

interface NotificationRequest {
  user_ids: string[];
  title: string;
  body: string;
  data?: {
    // Enumerate known types for IDE autocomplete while still accepting any string
    // via the `(string & {})` extension (keeps the union open without widening to plain string).
    // When type is absent, isThrottled / reserveThrottleSlot use a 'default' bucket
    // so typeless notifications are still rate-limited.
    type?: 'game_invite' | 'your_turn' | 'game_started' | 'friend_request' | 'friend_accepted' | 'game_ended' | (string & {});
    roomCode?: string;
    [key: string]: any;
  };
  badge?: number;
}

// Base64url encode utility (RFC 7519 compliant)
// Moved outside to avoid recreation on every getAccessToken call
const base64url = (input: string): string => {
  if (!input || typeof input !== 'string' || input.trim() === '') {
    throw new Error('base64url: input must be a non-empty string');
  }
  return btoa(input)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
};

// OAuth2 token cache (tokens valid for 1 hour)
let cachedAccessToken: string | null = null;
let tokenExpiryTime: number = 0;

// Get OAuth2 access token from service account using Google's library approach
async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && tokenExpiryTime > now + 300) {
    return cachedAccessToken;
  }
  const serviceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')
  if (!serviceAccountJson) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON environment variable not set')
  }
  
  const serviceAccount = JSON.parse(serviceAccountJson)
  
  // Use Google's JWT signing approach with proper base64url encoding
  // `now` is already declared above for the cache-validity check — reuse it
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  }
  
  const payload = {
    iss: serviceAccount.client_email,
    scope: FCM_SCOPES.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  
  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(payload))
  const unsignedToken = `${encodedHeader}.${encodedPayload}`
  
  // Import the private key
  const pemHeader = '-----BEGIN PRIVATE KEY-----'
  const pemFooter = '-----END PRIVATE KEY-----'
  const pemContents = serviceAccount.private_key
    .replace(pemHeader, '')
    .replace(pemFooter, '')
    .replace(/\s/g, '')
  
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))
  
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  )
  
  // Sign the token
  const encoder = new TextEncoder()
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    encoder.encode(unsignedToken)
  )
  
  // Base64url encode the signature
  const signatureArray = new Uint8Array(signature)
  const signatureBase64 = btoa(String.fromCharCode(...signatureArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  
  const jwt = `${unsignedToken}.${signatureBase64}`
  
  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  
  const tokenData = await tokenResponse.json()
  if (!tokenResponse.ok) {
    console.error('❌ OAuth2 token error:', tokenData)
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`)
  }
  
  // Cache token for future requests (expires in 1 hour)
  cachedAccessToken = tokenData.access_token;
  tokenExpiryTime = now + 3600; // 1 hour from now
  
  console.log('✅ Got OAuth2 access token successfully')
  return cachedAccessToken;
}

// ── Per-user per-event-type rate limiting ──────────────────────────────────
// In-memory throttle: max 1 notification *batch* per user per event type per
// 30 s.  A "batch" may deliver to multiple device tokens for the same user
// (one push per registered device), but the 30 s window prevents repeated
// bursts to the same user+event combination.
// Stays warm across invocations while the Deno isolate is alive; a cold start
// resets the map which is an acceptable loss (over-notify once at most).
// NOTE: This limit is per-Deno-isolate only — concurrent isolates/regions each
// maintain their own map (true cross-instance enforcement would require a shared
// store such as a DB table with atomic upsert; that is out of scope for this PR).
const RATE_LIMIT_WINDOW_MS = 30_000;
const RATE_LIMIT_PRUNE_INTERVAL_MS = 30_000;
const _lastSent = new Map<string, number>();
let _lastPruneAt = 0;

/** Known event types used as distinct rate-limit buckets. Keep in sync with accepted `data.type` values. Anything else is mapped to 'default' to bound Map key growth. */
const KNOWN_EVENT_TYPES = new Set([
  'game_invite', 'friend_request', 'friend_accepted', 'game_started', 'game_ended', 'your_turn', 'player_turn', 'default',
]);

/** M22: Map legacy/alternate event type aliases to their canonical form for rate-limit bucketing.
 *  'player_turn' sent by older server versions must be treated as 'your_turn' so they share
 *  the same 30s bucket instead of each opening a new independent window. */
const EVENT_TYPE_ALIASES: Record<string, string> = {
  player_turn: 'your_turn',
};
const MAX_EVENT_TYPE_LEN = 32;

/** Normalise an event type: apply aliases first, then map unknown/oversized values to 'default'. */
function normalizeEventType(raw: string | undefined): string {
  if (!raw) return 'default';
  const trimmed = raw.slice(0, MAX_EVENT_TYPE_LEN);
  // M22: Apply alias mapping before checking known types
  const aliased = EVENT_TYPE_ALIASES[trimmed] ?? trimmed;
  return KNOWN_EVENT_TYPES.has(aliased) ? aliased : 'default';
}

function getRateLimitKey(userId: string, eventType: string): string {
  return `${userId}:${eventType}`;
}

function pruneRateLimitEntries(now: number): void {
  // Reset window start if clock moved backwards (e.g. NTP correction) so
  // pruning is not skipped indefinitely.
  if (now < _lastPruneAt) {
    _lastPruneAt = now;
    return;
  }
  if (now - _lastPruneAt < RATE_LIMIT_PRUNE_INTERVAL_MS) return;

  _lastPruneAt = now;
  for (const [k, ts] of _lastSent) {
    if (now - ts > RATE_LIMIT_WINDOW_MS * 2) _lastSent.delete(k);
  }
}

/** Returns true if the notification should be throttled (dropped). Read-only — does not record.
 *  Typeless notifications are throttled under a 'default' bucket so they can't bypass rate limiting. */
function isThrottled(userId: string, eventType: string | undefined): boolean {
  const resolvedType = normalizeEventType(eventType);
  const now = Date.now();
  const last = _lastSent.get(getRateLimitKey(userId, resolvedType));
  pruneRateLimitEntries(now);
  // Guard against clock skew: if last > now the timestamp was recorded with a
  // future clock.  Treat as expired so the user isn't locked out indefinitely.
  if (last !== undefined && last > now) {
    _lastSent.delete(getRateLimitKey(userId, resolvedType));
    return false;
  }
  return last !== undefined && now - last < RATE_LIMIT_WINDOW_MS;
}

/** Eagerly reserves a throttle slot so concurrent requests for the same user+event
 *  are suppressed while the send is in flight. Called BEFORE the actual FCM send.
 *  If all sends for this user later fail, the reservation is released via clearThrottleRecord.
 *  Typeless notifications are throttled under a 'default' bucket. */
function reserveThrottleSlot(userId: string, eventType: string | undefined): void {
  const resolvedType = normalizeEventType(eventType);
  const now = Date.now();
  _lastSent.set(getRateLimitKey(userId, resolvedType), now);
  pruneRateLimitEntries(now);
}

/** Removes the throttle reservation for a user+event, called when a send fails
 *  so the user isn't falsely throttled despite receiving nothing. */
function clearThrottleRecord(userId: string, eventType: string | undefined): void {
  const resolvedType = normalizeEventType(eventType);
  _lastSent.delete(getRateLimitKey(userId, resolvedType));
}

// Validate FCM token format (alphanumeric, colons, hyphens, underscores, reasonable length)
// Note: FCM tokens can vary in length/format across API updates, so we use lenient validation
function isValidFCMToken(token: string): boolean {
  // Lenient pattern: 50+ chars, alphanumeric with common separators
  // Logs warning for tokens outside typical 140-170 char range but doesn't reject
  const lenientPattern = /^[a-zA-Z0-9:._-]{50,}$/;
  const isValid = lenientPattern.test(token);
  
  // Log if token length is unusual (for monitoring/debugging)
  if (isValid && (token.length < 140 || token.length > 170)) {
    console.warn(`⚠️ FCM token length ${token.length} outside typical 140-170 range (still valid)`);
  }
  
  return isValid;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // P5-1 Fix: Reject unauthenticated callers.  Two explicitly trusted paths:
  //   1. Service-role key   — other Edge Functions / server-side processes.
  //   2. Internal-bot key   — background bot via x-bot-auth header.
  // Mobile-app callers (user JWT) are accepted only after verifying that the
  // caller AND all target user_ids are members of the same room (data.roomCode).
  // This prevents any authenticated user from sending arbitrary notifications
  // to users outside their room.
  // Auth check runs BEFORE the version check so unauthorized callers receive 403
  // rather than 426 (which would leak minimum_version information).
  const authHeader = req.headers.get('Authorization') ?? '';
  const apiKeyHeader = req.headers.get('apikey') ?? '';
  const botAuthHeader = req.headers.get('x-bot-auth') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalBotKey = Deno.env.get('INTERNAL_BOT_AUTH_KEY') ?? '';

  // Fail-fast: SUPABASE_SERVICE_ROLE_KEY is required — both for auth comparison below
  // and for the Supabase admin client created later. A missing key means misconfiguration,
  // not an unauthorized caller; return 500 so operators can distinguish the two cases.
  if (!serviceKey) {
    console.error('[send-push-notification] SUPABASE_SERVICE_ROLE_KEY is not configured');
    return new Response(
      JSON.stringify({ error: 'Server misconfigured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Service-role callers: pass SUPABASE_SERVICE_ROLE_KEY via Authorization: Bearer <key>
  // or via the apikey header (standard Supabase client behaviour).
  // Internal bot callers: pass INTERNAL_BOT_AUTH_KEY via the x-bot-auth header.
  // These are two distinct auth paths; x-bot-auth does NOT accept the service-role key.
  const isAuthorizedInternalCaller =
    (serviceKey !== '' && authHeader === `Bearer ${serviceKey}`) ||
    (serviceKey !== '' && apiKeyHeader === serviceKey) ||
    (internalBotKey !== '' && botAuthHeader === internalBotKey);

  if (!isAuthorizedInternalCaller) {
    // User-JWT path: verify the token, then enforce room-membership constraints
    // so the caller can only notify users who belong to the same room.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    // Missing env vars are a server misconfiguration — surface as 500 so operators
    // can distinguish config errors from auth failures.
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[send-push-notification] SUPABASE_URL or SUPABASE_ANON_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'Server misconfigured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: authorization required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user: callerUser }, error: authError } = await userClient.auth.getUser();
    if (authError || !callerUser) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: invalid or expired authorization' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Peek at the body (clone preserves the stream for the main handler).
    let peekBody: { data?: { roomCode?: string }; user_ids?: string[] } | null = null;
    try {
      peekBody = await req.clone().json();
    } catch {
      // Malformed body — fall through; main handler will return 400.
    }

    // User-JWT callers must supply a roomCode so targets can be constrained.
    const roomCode = peekBody?.data?.roomCode as string | undefined;
    if (!roomCode) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: user callers must supply data.roomCode' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use the service-role key for DB authorization checks (bypasses RLS).
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve room by code.
    const { data: room } = await adminClient
      .from('rooms')
      .select('id')
      .eq('code', roomCode)
      .maybeSingle();

    if (!room) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: invalid room code' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Caller must be a member of that room.
    const { data: callerMembership } = await adminClient
      .from('room_players')
      .select('id')
      .eq('room_id', room.id)
      .eq('user_id', callerUser.id)
      .maybeSingle();

    if (!callerMembership) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: caller is not a member of the specified room' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // All target user_ids must also be members of the same room.
    const targetIds: string[] = peekBody?.user_ids ?? [];
    if (targetIds.length > 0) {
      const { data: memberRows } = await adminClient
        .from('room_players')
        .select('user_id')
        .eq('room_id', room.id)
        .in('user_id', targetIds);
      const memberSet = new Set((memberRows ?? []).map((r: { user_id: string }) => r.user_id));
      const nonMembers = targetIds.filter((id: string) => !memberSet.has(id));
      if (nonMembers.length > 0) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: some target users are not members of the room' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
  }

    // C3: Enforce minimum app version (after auth — only authorized callers reach here).
    // Kept as defense-in-depth for any versioned internal callers.
    const versionError = checkMinimumVersion(req, corsHeaders);
    if (versionError) return versionError;

  try {
    // Create Supabase client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Parse request body
    const notificationRequest: NotificationRequest = await req.json()
    const { user_ids, title, body, data, badge } = notificationRequest

    if (!user_ids || user_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'user_ids is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate required fields for game-related notifications
    if (data?.type && ['game_invite', 'your_turn', 'game_started'].includes(data.type)) {
      if (!data.roomCode) {
        return new Response(
          JSON.stringify({ error: 'roomCode is required for game notification types' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Rate-limit: drop users who were already notified for this event type within 30 s
    const eventType = data?.type;
    const throttledIds: string[] = [];
    const allowedIds = user_ids.filter((uid: string) => {
      if (isThrottled(uid, eventType)) {
        throttledIds.push(uid);
        return false;
      }
      // Reserve immediately to prevent concurrent requests from passing the
      // throttle check before the send completes.
      reserveThrottleSlot(uid, eventType);
      return true;
    });

    if (allowedIds.length === 0) {
      console.log(`⏳ All ${user_ids.length} user(s) throttled for event type "${eventType ?? 'default'}"`)
      return new Response(
        JSON.stringify({ error: 'rate_limited', message: 'Rate limited', throttled: throttledIds.length, sent: 0 }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (throttledIds.length > 0) {
      console.log(`⏳ Throttled ${throttledIds.length} user(s) for event type "${eventType ?? 'default'}"`)
    }

    // Get push tokens for the specified users
    const { data: tokens, error: tokensError } = await supabaseAdmin
      .from('push_tokens')
      .select('push_token, platform, user_id')
      .in('user_id', allowedIds)

    if (tokensError) {
      console.error('Error fetching push tokens:', tokensError)
      // Release eager reservations — nothing was sent
      for (const uid of allowedIds) clearThrottleRecord(uid, eventType);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch push tokens', details: tokensError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!tokens || tokens.length === 0) {
      console.log('No push tokens found for specified users')
      // Release eager reservations — nothing was sent
      for (const uid of allowedIds) clearThrottleRecord(uid, eventType);
      return new Response(
        JSON.stringify({ message: 'No push tokens found', sent: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`📤 Sending notifications to ${tokens.length} device(s)`)

    // Prepare messages
    const messages: PushMessage[] = tokens.map((token) => {
      const message: PushMessage = {
        to: token.push_token,
        userId: token.user_id,
        sound: 'default',
        title,
        body,
        data: data || {},
        priority: 'high',
      }

      // Add badge if specified
      if (badge !== undefined) {
        message.badge = badge
      }

      // Add Android channel based on notification type
      if (token.platform === 'android' && data?.type) {
        switch (data.type) {
          case 'game_invite':
          case 'game_started':
            message.channelId = 'game-updates'
            break
          case 'your_turn':
            message.channelId = 'turn-notifications'
            break
          case 'friend_request':
            message.channelId = 'social'
            break
          default:
            message.channelId = 'default'
        }
      }

      return message
    })

    // Get OAuth2 token for FCM v1 API
    let accessToken: string;
    try {
      accessToken = await getAccessToken();
    } catch (tokenErr) {
      console.error('❌ Failed to obtain FCM access token:', tokenErr);
      // Release eager reservations — nothing was sent
      for (const uid of allowedIds) clearThrottleRecord(uid, eventType);
      return new Response(
        JSON.stringify({ error: 'Failed to obtain FCM access token' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Send notifications via FCM v1 API
    /** Redact a device token for safe logging (first 4 … last 4 chars). */
    const redactToken = (t: string | null | undefined): string => {
      if (!t) return '<empty>';
      if (t.length <= 10) return '***';
      return `${t.slice(0, 4)}…${t.slice(-4)}`;
    };

    // Track per-user success: only keep throttle reservation for users with ≥1 successful send
    const userHadSuccess = new Set<string>();
    const results = []
    for (const message of messages) {
      try {
        // Extract token: handle both wrapped (ExponentPushToken[...]) and native FCM tokens
        let token = message.to;
        if (token.startsWith('ExponentPushToken[') && token.endsWith(']')) {
          token = token.slice(18, -1); // Remove wrapper
        }
        
        // Validate token: must be non-empty, well-formed, and match FCM token format
        if (!token || typeof token !== 'string' || token.trim() === '') {
          console.error(`❌ Invalid push token (empty/null) for message:`, redactToken(message.to));
          results.push({ status: 'error', message: 'Invalid push token (empty)' });
          continue;
        }
        
        if (!isValidFCMToken(token)) {
          console.error(`❌ Invalid FCM token format for message:`, redactToken(message.to), '(length:', token.length, ')');
          results.push({ status: 'error', message: 'Invalid FCM token format' });
          continue;
        }
        
        const fcmMessage = {
          message: {
            token: token,
            notification: {
              title: message.title,
              body: message.body,
            },
            data: message.data || {},
            android: {
              priority: 'high',
              notification: {
                channel_id: message.channelId || 'default',
                sound: message.sound || 'default',
              }
            }
          }
        }
        
        const response = await fetch(FCM_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fcmMessage),
        })
        
        const result = await response.json()
        
        if (!response.ok) {
          console.error(`❌ FCM error for ${redactToken(message.to)}:`, result)
          results.push({ status: 'error', message: result })
        } else {
          console.log(`✅ Sent to ${redactToken(message.to)}`)
          results.push({ status: 'ok', id: result.name })
          if (message.userId) userHadSuccess.add(message.userId);
        }
      } catch (error) {
        console.error(`❌ Error sending to ${redactToken(message.to)}:`, error)
        results.push({ status: 'error', message: error.message })
      }
    }

    console.log('✅ Notifications sent via FCM v1 API:', results)

    // Release throttle reservations for users where ALL sends failed
    // (so they aren't falsely suppressed). Users with ≥1 success keep their reservation.
    for (const uid of allowedIds) {
      if (!userHadSuccess.has(uid)) {
        clearThrottleRecord(uid, eventType);
      }
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        sent: messages.length,
        results: results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in send-push-notification function:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
