# Task #570 SQL Issues Post-Mortem
## Database and Security Vulnerabilities in PR #65

**Date:** December 29, 2025  
**PR #65:** feat(task-570): Extract GameScreen into modular components  
**Files:** NUCLEAR_FIX_GAME_STATE.sql, play-cards Edge Function, EMERGENCY_ROLLBACK_PLAN  
**Copilot Comments:** 3 critical security/database issues

---

## Executive Summary

PR #65 (Task #570 - frontend refactoring) inappropriately included **destructive database operations** and **security vulnerabilities**:

1. **NUCLEAR_FIX_GAME_STATE.sql** - Drops entire `game_state` table with CASCADE (deletes all active games)
2. **RLS Policy** - Grants unrestricted access to ALL roles (bypasses Supabase security)
3. **Edge Function Deployment** - Instructions use `--no-verify-jwt` (allows unauthenticated privileged operations)

**These issues should NEVER have been in a frontend PR.** Database changes require separate review, separate deployment strategy, and careful coordination with data migration plans.

---

## Issue #1: NUCLEAR_FIX_GAME_STATE.sql - Destructive Operations

### Copilot Comment
**File:** `apps/mobile/NUCLEAR_FIX_GAME_STATE.sql`  
**Comment:** "This SQL file contains `DROP TABLE IF EXISTS game_state CASCADE;` which will delete ALL active games and any dependent data. This is extremely destructive and shouldn't be in a frontend PR. Considerations:

1. **Why is a database migration in a frontend refactoring PR?** This belongs in a separate database migration PR with proper review.
2. **Where is the data backup/migration plan?** The comment says 'WARNING: This will DELETE ALL ACTIVE GAMES' but provides no recovery strategy.
3. **Is this meant for production or development only?** If dev-only, it shouldn't be committed to the repository.
4. **The CASCADE will delete related records** - have you audited what else will be affected?

Recommendation: Remove this file from this PR. Create a dedicated database migration PR with:
- Pre-migration data export
- Migration script with rollback plan  
- Post-migration verification tests
- Separate deployment strategy"

---

### The SQL File Contents

```sql
-- NUCLEAR FIX: Drop and recreate game_state with correct schema
-- WARNING: This will DELETE ALL ACTIVE GAMES
-- Run this ONLY if you understand the consequences

-- 1. Drop the corrupted table
DROP TABLE IF EXISTS game_state CASCADE;

-- 2. Recreate with CORRECT schema (from ba1013f working version)
CREATE TABLE game_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  
  -- Game flow
  current_turn INTEGER NOT NULL DEFAULT 0,
  last_play JSONB,
  pass_count INTEGER NOT NULL DEFAULT 0,
  game_phase TEXT NOT NULL DEFAULT 'playing',
  
  -- Player hands
  hands JSONB NOT NULL DEFAULT '{"0": [], "1": [], "2": [], "3": []}'::jsonb,
  
  -- Game history
  play_history JSONB DEFAULT '[]'::jsonb,
  played_cards JSONB DEFAULT '[]'::jsonb,
  
  -- Match tracking
  match_number INTEGER NOT NULL DEFAULT 1,
  round_number INTEGER DEFAULT 1,
  
  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Auto-pass timer
  auto_pass_timer JSONB,
  
  UNIQUE(room_id)
);

-- 3. Enable RLS
ALTER TABLE game_state ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
CREATE POLICY "Players can view game state for their room"
  ON game_state FOR SELECT
  USING (
    room_id IN (
      SELECT room_id 
      FROM room_players 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage game state"
  ON game_state FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. Create index for fast lookups
CREATE INDEX idx_game_state_room_id ON game_state(room_id);

-- 6. Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE game_state;

-- DONE - Test by creating a new game
```

---

### Why This is Dangerous

#### 1. Data Loss
- **Immediate Impact:** All active games deleted when script runs
- **Cascade Effect:** Any tables with foreign keys to `game_state` also lose data
- **No Backup:** Script has no export/backup step before DROP
- **No Rollback:** Once executed, data is gone forever (unless you have Supabase Point-in-Time Recovery enabled)

#### 2. Production Risk
- **Committed to main branch** means it could accidentally run in production
- **No environment guards** - script doesn't check if it's running in dev/staging/prod
- **No confirmation prompts** - silent destruction

#### 3. Wrong PR Context
- **Frontend PR** should contain ZERO database changes
- **No coordination** with backend team or DBA review
- **Mixed concerns** violates separation of responsibilities

---

### What Should Have Happened

#### Step 1: Separate Database Migration PR
```sql
-- 20251229_001_migrate_game_state.sql
-- SAFE migration: Create new table, migrate data, swap tables

-- 1. Create new table with correct schema
CREATE TABLE game_state_new (
  -- ... new schema ...
);

-- 2. Migrate existing data
INSERT INTO game_state_new (id, room_id, current_turn, ...)
SELECT id, room_id, current_turn, ...
FROM game_state;

-- 3. Verify data integrity
DO $$
DECLARE
  old_count INT;
  new_count INT;
BEGIN
  SELECT COUNT(*) INTO old_count FROM game_state;
  SELECT COUNT(*) INTO new_count FROM game_state_new;
  
  IF old_count != new_count THEN
    RAISE EXCEPTION 'Migration failed: row count mismatch (old: %, new: %)', old_count, new_count;
  END IF;
END $$;

-- 4. Swap tables (in transaction)
BEGIN;
  ALTER TABLE game_state RENAME TO game_state_old;
  ALTER TABLE game_state_new RENAME TO game_state;
  
  -- Keep old table for 7 days as backup
  -- DROP TABLE game_state_old; -- Run this manually after verification
COMMIT;
```

#### Step 2: Deployment Plan
1. **Schedule maintenance window** (off-peak hours)
2. **Enable Supabase Point-in-Time Recovery** (if not already enabled)
3. **Export full database backup** before migration
4. **Test migration on staging** environment first
5. **Run migration on production** with DBA monitoring
6. **Verify all services still work** after migration
7. **Keep old table for 7 days** before dropping (safety net)

#### Step 3: Rollback Plan
```sql
-- If migration fails, restore from backup
BEGIN;
  DROP TABLE game_state;
  ALTER TABLE game_state_old RENAME TO game_state;
COMMIT;

-- Or restore from Supabase backup
-- (use Supabase Dashboard → Database → Backups)
```

---

## Issue #2: RLS Policy Grants Unrestricted Access

### Copilot Comment
**File:** `apps/mobile/NUCLEAR_FIX_GAME_STATE.sql:54-57`  
**Comment:** "This RLS policy grants full access to all roles with `USING (true) WITH CHECK (true)`. This bypasses Row Level Security entirely. Considerations:

1. **Security vulnerability** - any authenticated user can modify ANY game state, not just their own
2. **Should be restricted to service_role** - regular users shouldn't have direct write access
3. **The comment says 'Service role'** but the policy applies to ALL roles
4. **Why does this need to exist?** If Edge Functions use service_role, they already bypass RLS

Recommendation: Change to:
```sql
CREATE POLICY \"Service role can manage game state\"
  ON game_state FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

Or remove this policy entirely if Edge Functions already use service_role."

---

### The Vulnerability

```sql
-- CURRENT (INSECURE):
CREATE POLICY "Service role can manage game state"
  ON game_state FOR ALL
  USING (true)      -- ❌ Any role can read ANY row
  WITH CHECK (true); -- ❌ Any role can write ANY row

-- What this allows:
-- 1. User A can modify User B's game state
-- 2. User A can see all active games in database
-- 3. Malicious user can corrupt/delete arbitrary games
```

---

### Attack Scenarios

#### Scenario 1: Cheat by Modifying Opponent's Hand
```javascript
// Malicious user's client-side code
const { data, error } = await supabase
  .from('game_state')
  .update({ 
    hands: {
      0: myGoodHand,    // Keep my hand
      1: [/* empty */], // Delete opponent's hand!
      2: [/* empty */],
      3: [/* empty */]
    }
  })
  .eq('room_id', currentRoomId);

// With insecure RLS policy, this SUCCEEDS! 😱
```

#### Scenario 2: View All Active Games (Reconnaissance)
```javascript
// Attacker can see ALL games in database
const { data, error } = await supabase
  .from('game_state')
  .select('*');

// With insecure RLS policy, returns ALL rows! 😱
// Attacker can see: who's playing, their cards, game state, etc.
```

#### Scenario 3: Denial of Service (Delete All Games)
```javascript
// Malicious user's script
const { data, error } = await supabase
  .from('game_state')
  .delete()
  .neq('id', '00000000-0000-0000-0000-000000000000'); // Match all

// With insecure RLS policy, this DELETES ALL GAMES! 😱
```

---

### Proper RLS Policies

#### Option 1: Restrict to Service Role Only
```sql
-- Service role (Edge Functions) can do anything
CREATE POLICY "service_role_all_access"
  ON game_state FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Regular users can only read their own game
CREATE POLICY "users_read_own_game"
  ON game_state FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id 
      FROM room_players 
      WHERE user_id = auth.uid()
    )
  );

-- Regular users have NO write access
-- (all mutations go through Edge Functions)
```

#### Option 2: Allow User Writes But Restrict to Own Game
```sql
-- Users can only modify their own game
CREATE POLICY "users_modify_own_game"
  ON game_state FOR UPDATE
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id 
      FROM room_players 
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    room_id IN (
      SELECT room_id 
      FROM room_players 
      WHERE user_id = auth.uid()
    )
  );
```

**Recommendation:** Use Option 1 (service_role only) since game logic is in Edge Functions anyway.

---

## Issue #3: Edge Function Deployment Without JWT Verification

### Copilot Comment
**File:** `EMERGENCY_ROLLBACK_PLAN_DEC29.md:88`  
**Comment:** "The deployment command uses `--no-verify-jwt` flag which disables authentication checks. This allows unauthenticated requests to call privileged Edge Functions. Considerations:

1. **Security risk** - anyone can call these functions without being logged in
2. **Why is this needed?** If for testing, it shouldn't be in deployment docs
3. **What functions does this affect?** play-cards, bot-turn, start-game all handle sensitive operations
4. **Production deployment should ALWAYS verify JWT** unless function is intentionally public (like webhooks)

Recommendation: Remove `--no-verify-jwt` flag:
```bash
npx supabase functions deploy play-cards
npx supabase functions deploy bot-turn  
npx supabase functions deploy start-game
```

If you're getting auth errors, fix the auth configuration, don't disable security."

---

### The Insecure Deployment

```bash
# From EMERGENCY_ROLLBACK_PLAN_DEC29.md:

# 4. Deploy Edge Functions
npx supabase functions deploy --no-verify-jwt play-cards  # ❌ INSECURE!
npx supabase functions deploy bot-turn
npx supabase functions deploy start-game
```

---

### Why `--no-verify-jwt` is Dangerous

#### What JWT Verification Does
- Verifies user is authenticated (has valid session)
- Extracts `user_id` from JWT token
- Populates `auth.uid()` for RLS policies
- Ensures requests come from your app, not random attackers

#### What `--no-verify-jwt` Disables
- ❌ Anyone can call the function (no auth required)
- ❌ `auth.uid()` returns `null` (breaks RLS)
- ❌ Can't identify which user made the request
- ❌ Opens door for abuse/spam/cheating

---

### Attack Scenarios

#### Scenario 1: Spam Bot Moves
```bash
# Attacker's script (no auth needed!)
for i in {1..1000}; do
  curl https://your-project.supabase.co/functions/v1/bot-turn \
    -d '{"room_id": "random-uuid"}' &
done

# Result: 1000 bot moves triggered simultaneously
# Server crashes from load, games corrupted
```

#### Scenario 2: Impersonate Users
```bash
# Attacker calls play-cards as if they were another user
curl https://your-project.supabase.co/functions/v1/play-cards \
  -d '{
    "room_code": "ABC123",
    "user_id": "victim-user-uuid",  # Pretend to be someone else
    "cards": [{"id": "2S"}]         # Play their cards
  }'

# With no JWT verification, function accepts this!
```

#### Scenario 3: DDoS Edge Functions
- No rate limiting without auth
- Attacker can spam requests indefinitely
- Supabase bills YOU for the compute time
- Legitimate users can't connect (quota exhausted)

---

### When to Use `--no-verify-jwt` (Rarely!)

#### Valid Use Cases:
1. **Public webhooks** (e.g., Stripe payment notifications)
2. **Anonymous API endpoints** (e.g., public leaderboard)
3. **Server-to-server** calls (but use API keys instead)

#### For Game Functions: ❌ NEVER
- `play-cards` - user-specific action
- `bot-turn` - game state modification  
- `start-game` - room creation/join

**All of these require authentication.**

---

### Proper Deployment

```bash
# SECURE deployment (default behavior)
npx supabase functions deploy play-cards
npx supabase functions deploy bot-turn
npx supabase functions deploy start-game

# Verify JWT is required:
curl https://your-project.supabase.co/functions/v1/play-cards \
  -d '{"room_code": "TEST"}'

# Expected response:
# { "error": "Missing Authorization header" }
# ✅ Good! Function is protected.
```

---

## Root Cause Analysis

### Why Were SQL Files in Frontend PR?

**Timeline:**
1. Task #570: "Split GameScreen into modular components"
2. During development: Hit runtime bugs (missing cards, card reordering)
3. Debug session: Discovered database schema issues
4. **Mistake:** Fixed DB issues IN THE SAME PR as frontend refactoring
5. **Consequence:** Mixed concerns, bypassed DB review process

**Should Have Been:**
- **PR #64:** Database schema fixes (separate review, separate deployment)
- **PR #65:** Frontend refactoring (depends on #64, frontend-only changes)

---

### Why Security Vulnerabilities?

**Root Cause:** Rapid iteration prioritized "make it work" over "make it secure"

**Development Timeline:**
1. "Game not working, need to fix fast"
2. "Database has wrong schema, need NUCLEAR_FIX"
3. "RLS policies blocking Edge Functions, just allow everything"
4. "JWT errors, use --no-verify-jwt to bypass"
5. "It works now! Ship it!"

**What Was Skipped:**
- Security review
- Threat modeling
- Proper RLS policy design
- Auth flow verification

---

## Lessons Learned

### 1. Database Changes = Separate PR, Always
**Rule:** If PR touches database schema, it's a database PR, not a frontend PR  
**Exception:** None. Enforce this with PR templates and automated checks.

### 2. Never Use `--no-verify-jwt` in Production
**Rule:** All non-public Edge Functions MUST verify JWT  
**Test:** Try calling function without auth - should fail with 401

### 3. RLS Policies: Principle of Least Privilege
**Rule:** Grant minimum necessary access, nothing more  
**Test:** Try to access/modify data you shouldn't be able to - should fail with RLS error

### 4. Security Review for ALL Database/Auth Changes
**Process:**
1. Database PR opened
2. Automated security scan (check for `USING (true)`, `--no-verify-jwt`, etc.)
3. Manual security review by designated reviewer
4. Test on staging with attack scenarios
5. Only then deploy to production

---

## Action Items

### Immediate (Before Merging Any PR)
- [ ] Remove NUCLEAR_FIX_GAME_STATE.sql from PR #65
- [ ] Fix RLS policy to restrict to service_role
- [ ] Remove --no-verify-jwt from all deployment docs
- [ ] Audit all existing RLS policies for similar issues

### Short-Term (This Week)
- [ ] Create separate DB migration PR for game_state schema fix
- [ ] Document proper Edge Function deployment process
- [ ] Add security checklist to PR template
- [ ] Enable Supabase database backups (Point-in-Time Recovery)

### Long-Term (This Month)
- [ ] Implement automated security scanning in CI/CD
- [ ] Create threat model for multiplayer game architecture
- [ ] Conduct security audit of all Edge Functions
- [ ] Add rate limiting to Edge Functions
- [ ] Document security best practices for team

---

## Conclusion

**The SQL issues in PR #65 represent fundamental security and process failures:**

1. **Database changes don't belong in frontend PRs** - violated separation of concerns
2. **`USING (true)` RLS policies are security vulnerabilities** - anyone can access/modify any data
3. **`--no-verify-jwt` deployment disables authentication** - opens door to abuse and cheating

**These aren't minor oversights - they're production-blocking security issues.**

**Next Steps:**
1. ✅ Rollback PR #65 completely
2. ✅ Document these issues (this file)
3. ✅ Create proper database migration PR (separate from frontend work)
4. ✅ Fix security vulnerabilities before any code ships
5. ✅ Implement process improvements to prevent recurrence

**Status:** ⏳ Awaiting rollback and proper fix implementation

---

**References:**
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [Edge Function Auth Guide](https://supabase.com/docs/guides/functions/auth)
- [Database Migration Best Practices](https://supabase.com/docs/guides/database/migrations)
