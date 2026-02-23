# Push Notifications Security Considerations

**Date:** December 9, 2024  
**Status:** ⚠️ DEVELOPMENT ONLY - NOT PRODUCTION READY  
**Related:** Task #267 - Push Notifications Implementation

---

## 🚨 Critical Security Issues

### Current Implementation Status

The current push notification system has **CRITICAL SECURITY VULNERABILITIES** that must be addressed before production deployment.

### Issue #1: Unauthenticated Edge Function Access

**Problem:** The `send-push-notification` edge function:
- Accepts arbitrary `user_ids` from request body
- Uses only the public `SUPABASE_ANON_KEY` for authentication
- Runs with `SUPABASE_SERVICE_ROLE_KEY` privileges
- Has no server-side authorization checks

**Impact:** Any attacker who extracts the anon key from the mobile app can:
- Send spam notifications to any user
- Impersonate the game server
- Create phishing attacks
- Abuse the notification system

**Example Attack:**
```typescript
// Attacker extracts SUPABASE_ANON_KEY from decompiled mobile app
const STOLEN_ANON_KEY = 'eyJ...'

// Attacker sends spam to arbitrary users
await fetch('https://your-project.supabase.co/functions/v1/send-push-notification', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${STOLEN_ANON_KEY}`,
    'apikey': STOLEN_ANON_KEY,
  },
  body: JSON.stringify({
    user_ids: ['victim-user-1', 'victim-user-2', 'victim-user-3'],
    title: 'Phishing Attack',
    body: 'Click here to win!',
    data: { type: 'game_invite', roomCode: 'MALICIOUS' }
  })
})
```

### Issue #2: No User JWT Validation

**Problem:** The edge function doesn't validate the caller's identity via Supabase JWT.

**Impact:** Cannot verify which user is making the request, enabling unauthorized actions.

### Issue #3: Trusting Client-Supplied User IDs

**Problem:** The `user_ids` array is accepted directly from untrusted clients.

**Impact:** Bypasses all Row Level Security (RLS) policies on the `push_tokens` table.

---

## ✅ Production-Ready Solutions

### Solution 1: Server-Side Only (Recommended)

Move notification logic to your game backend server (Socket.IO server, Express API, etc.) where credentials are secure.

**Implementation:**
```typescript
// backend/services/notificationService.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Kept secret on server
)

export async function notifyRoomPlayers(roomCode: string, title: string, body: string) {
  // 1. Verify caller has permission (e.g., game server only)
  // 2. Derive user_ids from server-side database query
  const { data: room } = await supabase
    .from('rooms')
    .select('id')
    .eq('code', roomCode)
    .single()
  
  const { data: players } = await supabase
    .from('room_players')
    .select('user_id')
    .eq('room_id', room.id)
  
  const userIds = players.map(p => p.user_id)
  
  // 3. Fetch tokens (RLS not needed since we're using service role securely)
  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('push_token')
    .in('user_id', userIds)
  
  // 4. Send notifications via Expo
  await sendToExpo(tokens.map(t => t.push_token), title, body, { roomCode })
}
```

**Mobile App Changes:**
```typescript
// Remove pushNotificationService.ts client-side calls
// Mobile app NEVER calls edge function directly
// All notifications triggered by backend server events
```

### Solution 2: JWT Authentication + Server-Side Authorization

Modify the edge function to validate JWTs and derive targets from server context.

**Edge Function:**
```typescript
Deno.serve(async (req) => {
  try {
    // 1. Extract and validate JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }
    
    const jwt = authHeader.replace('Bearer ', '')
    
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    // 2. Verify JWT and get authenticated user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 })
    }
    
    // 3. Parse request (NO user_ids from client!)
    const { roomCode, notificationType } = await req.json()
    
    // 4. Server-side authorization: Derive target users from authenticated context
    const { data: room } = await supabaseAdmin
      .from('rooms')
      .select('id, created_by')
      .eq('code', roomCode)
      .single()
    
    // Check if caller is in the room
    const { data: membership } = await supabaseAdmin
      .from('room_players')
      .select('user_id')
      .eq('room_id', room.id)
      .eq('user_id', user.id)
      .single()
    
    if (!membership) {
      return new Response(JSON.stringify({ error: 'Forbidden: Not in room' }), { status: 403 })
    }
    
    // 5. Get OTHER players in the room (server-derived, not client-supplied)
    const { data: players } = await supabaseAdmin
      .from('room_players')
      .select('user_id')
      .eq('room_id', room.id)
      .neq('user_id', user.id) // Exclude caller
    
    const targetUserIds = players.map(p => p.user_id)
    
    // 6. Fetch tokens and send
    const { data: tokens } = await supabaseAdmin
      .from('push_tokens')
      .select('push_token, platform')
      .in('user_id', targetUserIds)
    
    // ... send notifications ...
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 })
  }
})
```

**Mobile App Changes:**
```typescript
// pushNotificationService.ts
async function sendPushNotifications(options: SendNotificationOptions) {
  // Get authenticated user's JWT
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  
  const response = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`, // User JWT, not anon key
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      roomCode: options.roomCode, // NO user_ids!
      notificationType: options.type
    })
  })
  // ...
}
```

### Solution 3: Separate Backend Service Key

Create a separate, non-public API key for the edge function and never expose it to mobile clients.

**Not Recommended:** Still requires secure server-side component. Use Solution 1 or 2 instead.

---

## 📋 Migration Checklist

Before deploying to production:

- [ ] **Choose security solution** (Solution 1 recommended)
- [ ] **Remove anon key from edge function calls** (if using Solution 2)
- [ ] **Implement JWT validation** (if using Solution 2)
- [ ] **Remove `user_ids` from request body** (all solutions)
- [ ] **Derive targets server-side** (all solutions)
- [ ] **Add authorization checks** (verify caller permissions)
- [ ] **Update mobile app** (remove direct edge function calls or switch to JWT)
- [ ] **Add rate limiting** (prevent spam)
- [ ] **Test security** (pen testing, code review)
- [ ] **Update documentation** (remove insecure examples)

---

## 🔒 Additional Security Best Practices

### 1. Rate Limiting

Implement rate limiting on notification endpoints:
```typescript
// Example using Upstash Redis
const rateLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute
  analytics: true,
})

const { success } = await rateLimit.limit(user.id)
if (!success) {
  return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 })
}
```

### 2. Notification Content Validation

Validate all notification content server-side:
```typescript
// Prevent XSS and injection attacks
function sanitizeNotificationContent(title: string, body: string) {
  const maxTitleLength = 100
  const maxBodyLength = 500
  
  return {
    title: title.slice(0, maxTitleLength).replace(/[<>]/g, ''),
    body: body.slice(0, maxBodyLength).replace(/[<>]/g, '')
  }
}
```

### 3. Push Token Expiry

Add token expiry to prevent stale tokens:
```sql
-- Add expiry column
ALTER TABLE push_tokens ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '90 days';

-- Index for cleanup
CREATE INDEX idx_push_tokens_expired ON push_tokens(expires_at) WHERE expires_at < NOW();

-- Cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM push_tokens WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
```

### 4. Audit Logging

Log all notification sends for security monitoring:
```typescript
await supabaseAdmin.from('notification_audit_log').insert({
  sender_user_id: user.id,
  recipient_user_ids: targetUserIds,
  notification_type: data.type,
  sent_at: new Date().toISOString(),
  ip_address: req.headers.get('x-forwarded-for'),
})
```

---

## 📚 References

- [Expo Push Notification Security](https://docs.expo.dev/push-notifications/sending-notifications/#security)
- [Supabase Edge Functions Auth](https://supabase.com/docs/guides/functions/auth)
- [OWASP Mobile Security](https://owasp.org/www-project-mobile-security/)

---

**Status:** ⚠️ This document outlines critical security issues. DO NOT deploy current implementation to production.

**Next Steps:** Implement Solution 1 (Server-Side Only) before production launch.
