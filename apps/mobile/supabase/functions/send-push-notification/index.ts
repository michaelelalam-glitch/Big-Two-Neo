import { createClient } from 'jsr:@supabase/supabase-js@2'
import { checkMinimumVersion } from '../_shared/versionCheck.ts';
// M12: CORS origin controlled by ALLOWED_ORIGIN env var
import { buildCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimiter.ts';

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

// ── Per-user per-event-type rate limiting (P12-2) ─────────────────────────
// DB-backed throttle: max 1 notification per user per event type per 30 s.
// Uses checkRateLimit (atomic DB upsert via upsert_rate_limit_counter) so
// enforcement is correct across concurrent isolates and survives cold starts.

/** Known event types used as distinct rate-limit buckets. Keep in sync with accepted `data.type` values. Anything else is mapped to 'default' to bound action key growth. */
const KNOWN_EVENT_TYPES = new Set([
  'game_invite', 'friend_request', 'friend_accepted', 'game_started', 'game_ended', 'your_turn', 'player_turn', 'default',
]);

/** M22: Map alternate event type names to their canonical form for both
 *  rate-limit bucketing AND server-side preference checks.
 *  - player_turn  → your_turn      (legacy client compatibility)
 *  - room_invite   → game_invite    (client sends room_invite, pref column uses game_invite)
 *  - friend_accepted → friend_request (both share notify_friend_requests preference) */
const EVENT_TYPE_ALIASES: Record<string, string> = {
  player_turn: 'your_turn',
  room_invite: 'game_invite',
  friend_accepted: 'friend_request',
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
    let peekBody: { data?: { roomCode?: unknown }; user_ids?: unknown } | null = null;
    try {
      peekBody = await req.clone().json();
    } catch {
      // Malformed JSON body — return 400 immediately; do not mask as auth failure.
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // User-JWT callers must supply a roomCode so targets can be constrained.
    const roomCode = peekBody?.data?.roomCode;
    if (typeof roomCode !== 'string' || !roomCode) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: user callers must supply data.roomCode' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use the service-role key for DB authorization checks (bypasses RLS).
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve room by code — distinguish DB errors (500) from not-found (403).
    const { data: room, error: roomError } = await adminClient
      .from('rooms')
      .select('id')
      .eq('code', roomCode)
      .maybeSingle();

    if (roomError) {
      console.error('[send-push-notification] Room lookup failed:', roomError);
      return new Response(
        JSON.stringify({ error: 'Failed to verify room' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!room) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: invalid room code' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Caller must be a member of that room — distinguish DB errors (500) from non-member (403).
    const { data: callerMembership, error: callerMembershipError } = await adminClient
      .from('room_players')
      .select('id')
      .eq('room_id', room.id)
      .eq('user_id', callerUser.id)
      .maybeSingle();

    if (callerMembershipError) {
      console.error('[send-push-notification] Caller membership check failed:', callerMembershipError);
      return new Response(
        JSON.stringify({ error: 'Failed to verify room membership' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!callerMembership) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: caller is not a member of the specified room' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate and check membership for all target user_ids.
    // Any malformed user_ids (non-array or array with non-string elements) must be
    // rejected here so the membership gate cannot be bypassed and the main handler
    // cannot crash on unexpected types.
    const rawIds = peekBody?.user_ids;
    if (rawIds !== undefined && rawIds !== null) {
      if (!Array.isArray(rawIds) || !rawIds.every((id): id is string => typeof id === 'string')) {
        return new Response(
          JSON.stringify({ error: 'user_ids must be an array of strings' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const targetIds = rawIds as string[];
      if (targetIds.length > 0) {
        const { data: memberRows, error: memberCheckError } = await adminClient
          .from('room_players')
          .select('user_id')
          .eq('room_id', room.id)
          .in('user_id', targetIds);
        if (memberCheckError) {
          console.error('[send-push-notification] Target membership check failed:', memberCheckError);
          return new Response(
            JSON.stringify({ error: 'Failed to verify target membership' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
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

    // Runtime array-of-strings guard for the internal-caller path — the TypeScript
    // type is string[], but req.json() is untyped at runtime and a malformed payload
    // (e.g. string or object) would cause incorrect .length behaviour or a query error.
    // The external-caller (user-JWT) path already validates this via peekBody at line ~341;
    // internal callers (service-role / bot) bypass that path and need their own check.
    if (!Array.isArray(user_ids) || !user_ids.every((id): id is string => typeof id === 'string')) {
      return new Response(
        JSON.stringify({ error: 'user_ids must be an array of strings' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Bound fan-out: each user incurs one DB round-trip for rate-limit checking (N+1).
    // Cap at 50 recipients — a Big 2 game has 4 players and server-side fan-out is small.
    // A batch-based rate-limit RPC would be the long-term fix for larger fan-out scenarios.
    const MAX_RECIPIENT_IDS = 50;
    if (user_ids.length > MAX_RECIPIENT_IDS) {
      return new Response(
        JSON.stringify({ error: `user_ids must not exceed ${MAX_RECIPIENT_IDS} recipients` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    // Rate-limit (P12-2): DB-backed throttle — max 1 notification per user per event type per 30 s.
    // checkRateLimit uses an atomic DB upsert, so it works correctly across concurrent isolates
    // and cold starts (unlike the former in-memory Map).
    // Token check runs first so we only consume quota for users who actually have a push token,
    // preventing transient token-fetch failures from burning the 30 s retry window.
    const eventType = data?.type;
    const normalizedEventType = normalizeEventType(eventType);

    // Step 1: Fetch tokens for all candidate users BEFORE rate limiting
    const { data: allTokens, error: allTokensError } = await supabaseAdmin
      .from('push_tokens')
      .select('push_token, platform, user_id')
      .in('user_id', user_ids)

    if (allTokensError) {
      console.error('[send-push-notification] Error fetching push tokens:', allTokensError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch push tokens' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Only rate-limit users who have at least one registered token
    const usersWithTokens = [...new Set((allTokens ?? []).map((t: { user_id: string }) => t.user_id))]

    if (usersWithTokens.length === 0) {
      console.log('No push tokens found for specified users')
      return new Response(
        JSON.stringify({ message: 'No push tokens found', sent: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Step 2: Apply rate limiting only to users with tokens (quota consumed only when delivery is possible).
    // Trade-off: the rate-limit counter is committed to the DB atomically before the FCM send
    // attempt. If the FCM send fails (e.g. transient FCM error), the 30-second quota for that
    // user/event bucket is still consumed even though no notification was delivered. This is
    // the conservative / pessimistic approach: it prevents a flood of retries during FCM
    // degradation at the cost of potentially delaying one notification per affected user.
    // A reservation+rollback mechanism would be needed to only commit on successful delivery.
    const throttledIds: string[] = [];
    const rlChecks = await Promise.all(
      usersWithTokens.map(async (uid: string) => {
        const rl = await checkRateLimit(supabaseAdmin, uid, `push_${normalizedEventType}`, 1, 30, false);
        return { uid, allowed: rl.allowed };
      })
    );
    const allowedIds = rlChecks
      .filter(({ uid, allowed }) => { if (!allowed) throttledIds.push(uid); return allowed; })
      .map(({ uid }) => uid);

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

    // ── P12-H1: Server-side notification preference check ───────────────────
    // Query profiles for notification opt-out settings. Users who disabled a
    // notification type on the client sync their preference to the DB column.
    // Default TRUE (opt-in) so existing users without a preference row are not blocked.
    // Keep this mapping in sync with any user-facing notification toggles and
    // their corresponding `profiles` columns so background/killed-state pushes
    // respect the same opt-out settings as the client.
    // NOTE: Alternate names like player_turn, room_invite, and friend_accepted
    //       are normalised via EVENT_TYPE_ALIASES before reaching this map.
    const PREFERENCE_COLUMN_MAP: Record<string, string> = {
      game_invite: 'notify_game_invites',
      your_turn: 'notify_your_turn',
      game_started: 'notify_game_started',
      friend_request: 'notify_friend_requests',
    };
    const prefColumn = PREFERENCE_COLUMN_MAP[normalizedEventType];
    let preferenceFilteredIds = allowedIds;
    if (!prefColumn && normalizedEventType && normalizedEventType !== 'default') {
      console.warn(
        `[send-push-notification] No preference column mapping for event type "${normalizedEventType}". ` +
        'If this notification has a user-facing toggle, add its profiles column to PREFERENCE_COLUMN_MAP.'
      );
    }
    if (prefColumn && allowedIds.length > 0) {
      const { data: prefRows, error: prefError } = await supabaseAdmin
        .from('profiles')
        .select(`id, ${prefColumn}`)
        .in('id', allowedIds);
      if (prefError) {
        // Fail closed for preference-controlled notifications to avoid sending
        // when opt-out status cannot be verified.
        preferenceFilteredIds = [];
        console.warn(
          `[send-push-notification] Preference check failed; skipping "${normalizedEventType}" notifications for ${allowedIds.length} user(s): ${prefError.message}`
        );
      } else if (prefRows) {
        const optedOutIds = new Set(
          prefRows
            .filter((r: any) => r[prefColumn] === false)
            .map((r: any) => r.id)
        );
        if (optedOutIds.size > 0) {
          preferenceFilteredIds = allowedIds.filter((uid: string) => !optedOutIds.has(uid));
          console.log(`🔕 Filtered ${optedOutIds.size} user(s) who opted out of "${normalizedEventType}" notifications`);
        }
      }
    }

    // Step 3: Filter to preference-allowed + rate-allowed users' tokens
    const preferenceFilteredIdSet = new Set(preferenceFilteredIds)
    const tokens = (allTokens ?? []).filter((t: { user_id: string }) => preferenceFilteredIdSet.has(t.user_id))

    if (tokens.length === 0) {
      console.log('No push tokens found for allowed users')
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
        }
      } catch (error) {
        console.error(`❌ Error sending to ${redactToken(message.to)}:`, error)
        results.push({ status: 'error', message: error.message })
      }
    }

    console.log('✅ Notifications sent via FCM v1 API:', results)

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
