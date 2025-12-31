# Security Considerations - Edge Functions & RLS Policies

**Date:** December 31, 2025  
**Status:** Documentation of security tradeoffs and future improvements

---

## 🔐 Current Security Model

### Edge Function Architecture

**Service Role vs JWT Authentication:**

Our Edge Functions currently use two patterns:

1. **Service Role Pattern** (Connection & Game Logic):
   - `update-heartbeat`, `mark-disconnected`, `reconnect-player`
   - `play-cards`, `player-pass`, `start-new-match`
   - Uses `SUPABASE_SERVICE_ROLE_KEY` for privileged operations
   - Bypasses RLS for game state management

2. **JWT Pattern** (Account Management):
   - `delete-account`, `find-match`
   - Validates JWT and derives `user_id` from token
   - Respects RLS policies

### Known Security Tradeoffs

#### 1. Service Role Functions Accept Client IDs

**Current State:**
- Functions like `update-heartbeat`, `mark-disconnected`, `reconnect-player` accept `player_id` from request body
- No JWT validation to verify the authenticated user owns that `player_id`
- Relies on client-side validation and room knowledge

**Risk:**
- A malicious user who discovers another player's `player_id` could theoretically manipulate their connection status
- Requires knowledge of internal UUIDs which are not easily guessable

**Mitigation (Current):**
- `player_id` is a UUID v4 (2^122 possible values)
- Room IDs are also UUIDs requiring insider knowledge
- Rate limiting at API gateway level
- Monitoring via LangSmith tracing

**Planned Fix (Priority: Medium):**
```typescript
// Extract user_id from JWT
const authHeader = req.headers.get('Authorization');
const token = authHeader?.replace('Bearer ', '');
const { data: { user }, error } = await supabaseClient.auth.getUser(token);

// Verify player ownership
const { data: player } = await supabaseClient
  .from('room_players')
  .select('*')
  .eq('id', player_id)
  .eq('user_id', user.id)  // ✅ Verify ownership
  .single();
```

#### 2. Permissive RLS Policies for Realtime

**Current State:**
- `game_state`, `room_players`, `rooms` have permissive SELECT policies (`USING (true)` for authenticated users)
- Changed from restrictive subquery checks to fix Realtime subscription timeouts

**Previous Policy (Caused Timeout):**
```sql
-- TOO SLOW: Subquery took >10 seconds, caused Realtime timeout
CREATE POLICY "Users can view their game states"
ON game_state FOR SELECT TO authenticated
USING (
  room_id IN (
    SELECT room_players.room_id 
    FROM room_players 
    WHERE room_players.user_id = auth.uid()
  )
);
```

**Current Policy:**
```sql
-- FAST: No subquery, allows Realtime subscription
CREATE POLICY "Authenticated users can view all game states"
ON game_state FOR SELECT TO authenticated
USING (true);
```

**Risk:**
- Any authenticated user can query any game state via PostgREST
- Could read other players' hands or room information

**Mitigation (Current):**
- Clients don't use direct PostgREST queries - only Realtime subscriptions
- Realtime channels require explicit room_id (`room:${roomId}`)
- Game state hands are obfuscated in client rendering
- Edge Functions validate all game actions

**Planned Fix (Priority: High):**
```sql
-- Optimized policy using indexed columns (fast enough for Realtime)
CREATE POLICY "Users can view their game states (optimized)"
ON game_state FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM room_players 
    WHERE room_players.room_id = game_state.room_id 
    AND room_players.user_id = auth.uid()
    AND room_players.connection_status != 'disconnected'
  )
);

-- Ensure indexes exist for fast lookup
CREATE INDEX IF NOT EXISTS idx_room_players_room_user 
ON room_players(room_id, user_id) WHERE connection_status != 'disconnected';
```

#### 3. Error Messages Leak Stack Traces

**Current State (Fixed):**
- `player-pass` previously returned full stack traces in error responses
- Updated to return only generic error messages
- Stack traces logged server-side only

**Before:**
```typescript
return new Response(JSON.stringify({
  success: false,
  error: error?.message,
  details: error?.stack  // ❌ Leak implementation details
}));
```

**After:**
```typescript
return new Response(JSON.stringify({
  success: false,
  error: 'Internal server error'  // ✅ Generic message only
}));
```

---

## 🎯 Security Roadmap

### Phase 1: JWT Validation (Priority: High)
**Timeline:** January 2026

1. Add JWT validation to all service role functions
2. Verify `player_id` ownership against `auth.uid()`
3. Update client error handling for 401/403 responses

**Files to Update:**
- `update-heartbeat/index.ts`
- `mark-disconnected/index.ts`
- `reconnect-player/index.ts`
- `player-pass/index.ts`

### Phase 2: Optimized RLS Policies (Priority: High)
**Timeline:** January 2026

1. Add database indexes for fast RLS checks
2. Restore room-scoped SELECT policies
3. Test Realtime subscription performance (<10s timeout)

**Tables to Update:**
- `game_state`
- `room_players`
- `rooms`

### Phase 3: Rate Limiting (Priority: Medium)
**Timeline:** February 2026

1. Implement per-user rate limits on connection functions
2. Add CAPTCHA for account deletion
3. Monitor abuse patterns via LangSmith

### Phase 4: Audit Logging (Priority: Medium)
**Timeline:** February 2026

1. Log all privileged operations (disconnect, reconnect, pass)
2. Create admin dashboard for suspicious activity
3. Implement automated alerts for abuse patterns

---

## 📊 Risk Assessment

| Risk | Likelihood | Impact | Priority | Status |
|------|-----------|--------|----------|--------|
| Unauthorized player disconnect | Low | Medium | High | Planned (Phase 1) |
| Game state data leakage | Medium | Low | High | Planned (Phase 2) |
| Stack trace information disclosure | Low | Low | High | ✅ Fixed |
| UUID enumeration attack | Very Low | Low | Low | Monitored |
| Denial of service | Low | High | Medium | Planned (Phase 3) |

**Likelihood:**
- Low: Requires insider knowledge (UUIDs, room codes)
- Medium: Public API with authentication required
- High: Easily exploitable by any user

**Impact:**
- Low: Minor inconvenience, no data compromise
- Medium: Game disruption, unfair advantage
- High: Account takeover, data breach

---

## 🛡️ Defense in Depth

Our security model relies on multiple layers:

1. **UUID Obscurity** - Player/room IDs are 128-bit UUIDs (not guessable)
2. **Authentication** - All endpoints require valid Supabase JWT
3. **Channel-Based Access** - Realtime requires explicit room_id knowledge
4. **Edge Function Validation** - Game rules enforced server-side
5. **Client Obfuscation** - Opponent hands not rendered in UI
6. **Rate Limiting** - API gateway throttles suspicious activity
7. **Monitoring** - LangSmith traces all function invocations

**Why UUID Obscurity Works:**
- UUIDs have 2^122 possible values (5.3 undecillion)
- Brute force attack would take billions of years
- Requires insider knowledge (seeing room codes, player lists)
- Combined with authentication, provides reasonable security

---

## 🔍 Monitoring & Detection

### Current Monitoring:
- ✅ LangSmith tracing for all Edge Function calls
- ✅ Supabase logs for authentication failures
- ✅ Client error reporting via console logs

### Planned Monitoring (Phase 4):
- Automated alerts for suspicious patterns:
  - Multiple failed player_id lookups from same user
  - Rapid-fire connection status changes
  - Unusual pass patterns
- Admin dashboard showing:
  - Top 10 most active users (by function calls)
  - Failed authentication attempts by IP
  - Anomalous game state queries

---

## 📝 Recommendations for Developers

### When Adding New Edge Functions:

1. **Always validate JWT:**
   ```typescript
   const authHeader = req.headers.get('Authorization');
   if (!authHeader) {
     return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
   }
   
   const token = authHeader.replace('Bearer ', '');
   const { data: { user }, error } = await supabaseClient.auth.getUser(token);
   if (error || !user) {
     return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
   }
   ```

2. **Verify resource ownership:**
   ```typescript
   const { data: player } = await supabaseClient
     .from('room_players')
     .select('*')
     .eq('id', player_id)
     .eq('user_id', user.id)  // ✅ Ownership check
     .single();
   ```

3. **Never return sensitive errors:**
   ```typescript
   // ❌ DON'T:
   return new Response(JSON.stringify({ error: error.stack }));
   
   // ✅ DO:
   console.error('Internal error:', error);  // Log server-side
   return new Response(JSON.stringify({ error: 'Internal server error' }));
   ```

4. **Use transactions for multi-step operations:**
   ```typescript
   // Wrap in transaction to prevent partial updates
   const { error } = await supabaseClient.rpc('atomic_game_action', {
     room_id, player_id, action_data
   });
   ```

---

## 🎓 Security Philosophy

**Pragmatic Security:**
- We prioritize **game experience** over paranoid security
- UUIDs provide sufficient obscurity for MVP/testing phase
- Proper JWT validation will be added before public release
- Multiple defense layers protect against realistic threats

**Known Limitations:**
- This is an MVP - not a banking app
- Trust model assumes most players are honest
- Insider threats (users sharing UUIDs) are out of scope
- Focus is on preventing **automated abuse**, not determined attackers

**Future State:**
- Full JWT validation on all endpoints
- Proper RLS policies with optimized indexes
- Rate limiting and abuse detection
- Audit logging for forensics

---

**Last Updated:** December 31, 2025  
**Next Review:** January 15, 2026  
**Owner:** Backend Team
