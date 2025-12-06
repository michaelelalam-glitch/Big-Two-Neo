# Phase 1: Room Robustness Implementation Guide
**Big Two Mobile - Room Management System Improvements**  
**Date:** December 6, 2025  
**Project:** Big2 Mobile App (Supabase Project: bjxdmhybbpbmgdabqswi)  
**Estimated Implementation Time:** 45-60 minutes  
**Risk Level:** Medium (database schema changes)

---

## 🎯 Executive Summary

This guide implements 4 critical improvements to the room management system to support 10,000+ concurrent users:

1. **Username Uniqueness** - Prevent duplicate display names within rooms
2. **Room Analytics & Abandonment Tracking** - Log all room lifecycle events for debugging
3. **Atomic Room Joins** - Eliminate race conditions with transaction-safe joins
4. **Automatic Host Transfer** - Seamless host reassignment when host leaves

**Strategy:** Single comprehensive migration that can be rolled back atomically if issues arise.

---

## 📋 Prerequisites Checklist

Before beginning implementation, verify:

- [ ] Access to Supabase Dashboard for Big2 Mobile App project
- [ ] Database backup taken (automatic, but verify)
- [ ] Mobile app is NOT in production yet (or have maintenance window)
- [ ] Testing environment available (staging project or dev branch)
- [ ] No active users in database (or coordinate migration timing)

**⚠️ CRITICAL:** This migration modifies core tables. Test on staging first!

---

## 🏗️ Architecture Overview

### Migration Components

```
20251206000001_room_robustness_improvements.sql
├── Part 1: Room Analytics System (NEW TABLE)
│   ├── room_analytics table
│   ├── abandonment tracking function
│   └── cleanup trigger
│
├── Part 2: Username Uniqueness (CONSTRAINT)
│   ├── Duplicate cleanup query
│   ├── Unique index on username
│   └── Validation function
│
├── Part 3: Atomic Room Joins (RPC FUNCTION)
│   ├── join_room_atomic() function
│   ├── Row-level locking
│   └── Transaction-safe inserts
│
└── Part 4: Auto Host Transfer (TRIGGER)
    ├── reassign_next_host() function
    ├── Trigger on room_players DELETE
    └── Host priority logic
```

---

## 📊 Part 1: Room Analytics & Abandonment Tracking

### Purpose
Track all room lifecycle events to identify bugs, crashes, and abandonment patterns at scale.

### Design Decisions

**Decision 1.1: Track but Allow Clean Reuse**
- Clean public rooms CAN be reused (performance at 10k+ users)
- Dirty rooms (errors/crashes) CANNOT be reused
- Matchmaking query excludes dirty rooms

**Decision 1.2: Comprehensive Error Types**
```sql
error_type TEXT CHECK (error_type IN (
  'all_players_left_waiting',   -- Left before game started
  'all_players_left_playing',    -- Abandoned mid-game
  'host_left_no_transfer',       -- Host left, no one took over
  'game_crash',                  -- Backend error occurred
  'network_timeout',             -- All players timed out
  'forced_close',                -- Room manually closed
  'duplicate_name_conflict',     -- Username collision
  'race_condition_join',         -- Concurrent join failed
  NULL                           -- Clean closure (finished)
))
```

### Database Schema

```sql
-- Room analytics table for debugging and metrics
CREATE TABLE IF NOT EXISTS room_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID,  -- Can be NULL if room deleted
  room_code TEXT NOT NULL,
  status_reached TEXT NOT NULL,  -- 'waiting', 'playing', 'finished'
  error_type TEXT,  -- NULL if clean finish
  is_dirty BOOLEAN DEFAULT FALSE,  -- Exclude from reuse if true
  player_count_at_event INTEGER DEFAULT 0,
  human_player_count INTEGER DEFAULT 0,
  bot_player_count INTEGER DEFAULT 0,
  time_in_waiting_seconds INTEGER,
  time_in_playing_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB,  -- Store additional context
  
  CONSTRAINT valid_status CHECK (status_reached IN ('waiting', 'playing', 'finished'))
);

-- Indexes for analytics queries
CREATE INDEX idx_room_analytics_code ON room_analytics(room_code);
CREATE INDEX idx_room_analytics_error ON room_analytics(error_type) WHERE error_type IS NOT NULL;
CREATE INDEX idx_room_analytics_dirty ON room_analytics(is_dirty) WHERE is_dirty = true;
CREATE INDEX idx_room_analytics_event_time ON room_analytics(event_at DESC);
```

### Tracking Function

```sql
-- Function to log room lifecycle events
CREATE OR REPLACE FUNCTION log_room_event(
  p_room_id UUID,
  p_event_type TEXT,
  p_error_type TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_room RECORD;
  v_players RECORD;
  v_analytics_id UUID;
  v_time_in_waiting INTEGER;
  v_time_in_playing INTEGER;
BEGIN
  -- Get room details
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RAISE WARNING 'Room % not found for event logging', p_room_id;
    RETURN NULL;
  END IF;
  
  -- Count players
  SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE is_bot = false) as humans,
    COUNT(*) FILTER (WHERE is_bot = true) as bots
  INTO v_players
  FROM room_players
  WHERE room_id = p_room_id;
  
  -- Calculate time spent in each phase
  v_time_in_waiting := EXTRACT(EPOCH FROM (
    COALESCE(v_room.started_at, NOW()) - v_room.created_at
  ))::INTEGER;
  
  v_time_in_playing := CASE 
    WHEN v_room.started_at IS NOT NULL THEN
      EXTRACT(EPOCH FROM (NOW() - v_room.started_at))::INTEGER
    ELSE 0
  END;
  
  -- Determine if room is dirty
  v_is_dirty := (p_error_type IS NOT NULL);
  
  -- Insert analytics record
  INSERT INTO room_analytics (
    room_id,
    room_code,
    status_reached,
    error_type,
    is_dirty,
    player_count_at_event,
    human_player_count,
    bot_player_count,
    time_in_waiting_seconds,
    time_in_playing_seconds,
    created_at,
    event_at,
    metadata
  ) VALUES (
    p_room_id,
    v_room.code,
    v_room.status,
    p_error_type,
    v_is_dirty,
    v_players.total,
    v_players.humans,
    v_players.bots,
    v_time_in_waiting,
    v_time_in_playing,
    v_room.created_at,
    NOW(),
    p_metadata
  ) RETURNING id INTO v_analytics_id;
  
  RETURN v_analytics_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION log_room_event IS 
  'Logs room lifecycle events to room_analytics table for debugging and metrics';
```

### Automatic Tracking Triggers

```sql
-- Trigger: Log when all players leave a room
CREATE OR REPLACE FUNCTION check_room_abandonment()
RETURNS TRIGGER AS $$
DECLARE
  v_remaining_players INTEGER;
  v_room_status TEXT;
BEGIN
  -- Count remaining players in room
  SELECT COUNT(*) INTO v_remaining_players
  FROM room_players
  WHERE room_id = OLD.room_id;
  
  -- Get room status
  SELECT status INTO v_room_status
  FROM rooms
  WHERE id = OLD.room_id;
  
  -- If last player left and room not finished, log abandonment
  IF v_remaining_players = 0 AND v_room_status != 'finished' THEN
    PERFORM log_room_event(
      OLD.room_id,
      'room_abandoned',
      CASE v_room_status
        WHEN 'waiting' THEN 'all_players_left_waiting'
        WHEN 'playing' THEN 'all_players_left_playing'
        ELSE 'unknown_abandonment'
      END,
      jsonb_build_object(
        'last_player_username', OLD.username,
        'last_player_was_host', OLD.is_host
      )
    );
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER room_abandonment_check
AFTER DELETE ON room_players
FOR EACH ROW
EXECUTE FUNCTION check_room_abandonment();

COMMENT ON TRIGGER room_abandonment_check ON room_players IS
  'Logs analytics event when last player leaves an unfinished room';
```

### Matchmaking Query Update

**CRITICAL:** Update Quick Play matchmaking to exclude dirty rooms:

```sql
-- Example query for frontend (HomeScreen.tsx line 124-130)
SELECT id, code, status, created_at, is_public
FROM rooms
WHERE status = 'waiting'
  AND is_public = true
  AND id NOT IN (
    SELECT DISTINCT room_id 
    FROM room_analytics 
    WHERE is_dirty = true AND room_id IS NOT NULL
  )
ORDER BY created_at ASC;
```

**Frontend Implementation Note:**
The mobile app (HomeScreen.tsx) will need updating to use this query. This requires:
1. Modifying the Supabase query to exclude dirty rooms
2. Testing that abandoned rooms don't appear in matchmaking
3. Verifying clean rooms are still reusable

---

## 🔒 Part 2: Username Uniqueness Constraint

### Purpose
Prevent confusing duplicate display names within a single room's lobby.

### Design Decision

**Constraint Level:** Room-scoped (not global)
- User "SuperPlayer" can be in Room A
- Different user "SuperPlayer" can be in Room B
- But NOT both in Room A simultaneously

### Pre-Migration Cleanup

**CRITICAL STEP:** Must clean existing duplicates before adding constraint.

```sql
-- Step 1: Identify duplicate usernames in rooms
WITH duplicates AS (
  SELECT 
    room_id,
    LOWER(username) as lower_username,
    COUNT(*) as duplicate_count,
    array_agg(id ORDER BY joined_at) as player_ids
  FROM room_players
  GROUP BY room_id, LOWER(username)
  HAVING COUNT(*) > 1
)
SELECT 
  d.room_id,
  r.code as room_code,
  d.lower_username,
  d.duplicate_count
FROM duplicates d
JOIN rooms r ON r.id = d.room_id;

-- Step 2: Resolve duplicates by appending player_index
UPDATE room_players
SET username = username || '_' || player_index
WHERE id IN (
  SELECT UNNEST(player_ids[2:]) -- Keep first, rename rest
  FROM (
    SELECT 
      array_agg(id ORDER BY joined_at) as player_ids
    FROM room_players
    GROUP BY room_id, LOWER(username)
    HAVING COUNT(*) > 1
  ) sub
);

-- Step 3: Verify no duplicates remain
SELECT 
  room_id,
  LOWER(username) as username,
  COUNT(*)
FROM room_players
GROUP BY room_id, LOWER(username)
HAVING COUNT(*) > 1;
-- Should return 0 rows
```

### Constraint Implementation

```sql
-- Create unique index (case-insensitive)
CREATE UNIQUE INDEX idx_room_players_username_unique
ON room_players(room_id, LOWER(username));

COMMENT ON INDEX idx_room_players_username_unique IS
  'Prevents duplicate usernames within the same room (case-insensitive)';
```

### Validation Function

```sql
-- Optional: Function to check username availability before join
CREATE OR REPLACE FUNCTION is_username_available(
  p_room_id UUID,
  p_username TEXT,
  p_exclude_user_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = p_room_id
      AND LOWER(username) = LOWER(p_username)
      AND (p_exclude_user_id IS NULL OR user_id != p_exclude_user_id)
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION is_username_available IS
  'Check if username is available in a specific room before attempting join';
```

### Frontend Integration Points

**CreateRoomScreen.tsx (lines 110-121):**
```typescript
// Before inserting room_player, check username availability
const { data: usernameCheck } = await supabase
  .rpc('is_username_available', {
    p_room_id: roomData.id,
    p_username: username
  });

if (!usernameCheck) {
  // Append suffix or prompt user to choose different name
  username = `${username}_${Date.now() % 1000}`;
}
```

**JoinRoomScreen.tsx (lines 85-100):**
Similar check before joining room.

### Error Handling

When constraint violation occurs:
```typescript
catch (error) {
  if (error.code === '23505') { // Unique violation
    Alert.alert(
      'Username Taken',
      'This username is already in use in this room. Please try a different one.',
      [{ text: 'OK' }]
    );
  }
}
```

---

## ⚡ Part 3: Atomic Room Joins (Race Condition Prevention)

### Purpose
Eliminate race conditions when multiple users try joining the same room simultaneously.

### Problem Scenario

**Before Fix:**
```
Time    User A                    User B
t0      Query: room has 3 players
t1                                 Query: room has 3 players
t2      Check: OK, can join
t3                                 Check: OK, can join
t4      INSERT player_index=3
t5                                 INSERT player_index=3
t6      SUCCESS                    
t7                                 ERROR: Unique constraint violation
```

**After Fix:**
```
Time    User A                    User B
t0      LOCK room row
t1                                 Wait for lock...
t2      Count: 3 players
t3      Check: OK
t4      INSERT player_index=3
t5      COMMIT + unlock
t6      SUCCESS
t7                                 LOCK acquired
t8                                 Count: 4 players
t9                                 Check: FULL
t10                                ERROR: Room is full (clean error)
```

### Implementation

```sql
-- Atomic room join function with row-level locking
CREATE OR REPLACE FUNCTION join_room_atomic(
  p_room_code TEXT,
  p_user_id UUID,
  p_username TEXT
) RETURNS JSONB AS $$
DECLARE
  v_room_id UUID;
  v_player_count INTEGER;
  v_player_index INTEGER;
  v_is_host BOOLEAN;
  v_host_id UUID;
  v_room_status TEXT;
  v_result JSONB;
BEGIN
  -- Step 1: Lock and fetch room (blocks other joins)
  SELECT id, status, host_id INTO v_room_id, v_room_status, v_host_id
  FROM rooms
  WHERE code = UPPER(p_room_code)
  FOR UPDATE;  -- Row-level lock until transaction commits
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found: %', p_room_code;
  END IF;
  
  -- Step 2: Check room status
  IF v_room_status NOT IN ('waiting', 'playing') THEN
    RAISE EXCEPTION 'Room is not accepting players (status: %)', v_room_status;
  END IF;
  
  -- Step 3: Count current players (within locked transaction)
  SELECT COUNT(*) INTO v_player_count
  FROM room_players
  WHERE room_id = v_room_id;
  
  -- Step 4: Check capacity
  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;
  
  -- Step 5: Check if user already in this room
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id
  ) THEN
    -- User already in room, return existing data (idempotent)
    SELECT jsonb_build_object(
      'room_id', v_room_id,
      'room_code', p_room_code,
      'player_index', player_index,
      'is_host', is_host,
      'already_joined', true
    ) INTO v_result
    FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id;
    
    RETURN v_result;
  END IF;
  
  -- Step 6: Check if user is in a DIFFERENT room
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE user_id = p_user_id AND room_id != v_room_id
  ) THEN
    RAISE EXCEPTION 'User is already in another room';
  END IF;
  
  -- Step 7: Check username uniqueness
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND LOWER(username) = LOWER(p_username)
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken in this room', p_username;
  END IF;
  
  -- Step 8: Determine player_index and host status
  v_player_index := v_player_count;  -- 0, 1, 2, or 3
  v_is_host := (v_host_id IS NULL OR v_player_count = 0);  -- First player or abandoned room
  
  -- Step 9: Insert player
  INSERT INTO room_players (
    room_id,
    user_id,
    username,
    player_index,
    is_host,
    is_ready,
    is_bot
  ) VALUES (
    v_room_id,
    p_user_id,
    p_username,
    v_player_index,
    v_is_host,
    false,
    false
  );
  
  -- Step 10: Update room host if needed
  IF v_is_host THEN
    UPDATE rooms
    SET host_id = p_user_id
    WHERE id = v_room_id;
  END IF;
  
  -- Step 11: Build success response
  v_result := jsonb_build_object(
    'room_id', v_room_id,
    'room_code', p_room_code,
    'player_index', v_player_index,
    'is_host', v_is_host,
    'already_joined', false,
    'player_count', v_player_count + 1
  );
  
  -- Step 12: Log successful join (optional)
  INSERT INTO room_analytics (
    room_id,
    room_code,
    status_reached,
    error_type,
    is_dirty,
    player_count_at_event,
    metadata
  ) VALUES (
    v_room_id,
    p_room_code,
    v_room_status,
    NULL,  -- Clean join
    false,
    v_player_count + 1,
    jsonb_build_object(
      'event', 'player_joined',
      'username', p_username,
      'is_host', v_is_host
    )
  );
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    -- Log failed join attempt
    PERFORM log_room_event(
      v_room_id,
      'join_failed',
      'race_condition_join',
      jsonb_build_object(
        'username', p_username,
        'error', SQLERRM
      )
    );
    
    RAISE;  -- Re-raise the exception
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION join_room_atomic IS
  'Thread-safe room join with row-level locking to prevent race conditions';
```

### Frontend Integration

**Replace existing join logic in:**

1. **HomeScreen.tsx (Quick Play) - Line 160+:**
```typescript
// OLD CODE (lines 160-210):
const { error: joinError } = await supabase
  .from('room_players')
  .insert({ ... });

// NEW CODE:
const { data, error } = await supabase
  .rpc('join_room_atomic', {
    p_room_code: roomWithSpace.code,
    p_user_id: user.id,
    p_username: user.user_metadata?.username || `Player_${user.id.substring(0, 8)}`
  });

if (error) {
  // Clean error messages from SQL exceptions
  if (error.message.includes('Room is full')) {
    Alert.alert('Room Full', 'This room is now full. Finding another...');
    // Retry matchmaking
  } else if (error.message.includes('already in another room')) {
    Alert.alert('Error', 'You are already in another room.');
  } else if (error.message.includes('Username') && error.message.includes('taken')) {
    // Append suffix and retry
    const newUsername = `${username}_${Date.now() % 1000}`;
    // Call again with newUsername
  }
  throw error;
}

// data contains: room_id, room_code, player_index, is_host, already_joined
console.log('✅ Joined room:', data);
navigation.replace('Lobby', { roomCode: data.room_code });
```

2. **JoinRoomScreen.tsx (Code Entry) - Line 85+:**
```typescript
// Replace INSERT query with RPC call
const { data, error } = await supabase
  .rpc('join_room_atomic', {
    p_room_code: roomCode.toUpperCase(),
    p_user_id: user.id,
    p_username: user.user_metadata?.username || `Player_${user.id.substring(0, 8)}`
  });
```

### Performance Impact

**Row Locking Duration:**
- Lock held for ~10-50ms (single transaction)
- Other joins wait in queue (serialized)
- At 10k users: ~100 rooms/sec creation rate = acceptable contention

**Trade-offs:**
- ✅ Eliminates race conditions completely
- ✅ Clean error messages
- ⚠️ Slight performance cost (negligible at scale)
- ⚠️ Requires frontend code changes

---

## 👑 Part 4: Automatic Host Transfer

### Purpose
Seamlessly reassign host when the current host leaves a waiting room, preventing rooms from becoming "stuck" without a host.

### Design Decisions

**Host Priority Logic:**
1. First human player (by player_index)
2. If no humans, first bot
3. If no players remain, room should be flagged as abandoned

### Implementation

```sql
-- Function to reassign host when current host leaves
CREATE OR REPLACE FUNCTION reassign_next_host(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_new_host RECORD;
  v_room_status TEXT;
BEGIN
  -- Get room status
  SELECT status INTO v_room_status FROM rooms WHERE id = p_room_id;
  
  -- Only reassign in waiting rooms (not during active games)
  IF v_room_status != 'waiting' THEN
    RETURN false;
  END IF;
  
  -- Find next host: prefer humans over bots, lowest player_index wins
  SELECT user_id, player_index, username INTO v_new_host
  FROM room_players
  WHERE room_id = p_room_id
  ORDER BY 
    is_bot ASC,        -- Humans first (false < true)
    player_index ASC   -- Lowest index breaks ties
  LIMIT 1;
  
  IF NOT FOUND THEN
    -- No players left, mark room as abandoned
    UPDATE rooms
    SET host_id = NULL
    WHERE id = p_room_id;
    
    RETURN false;
  END IF;
  
  -- Assign new host
  UPDATE room_players
  SET is_host = true
  WHERE room_id = p_room_id AND user_id = v_new_host.user_id;
  
  UPDATE rooms
  SET host_id = v_new_host.user_id
  WHERE id = p_room_id;
  
  -- Log host transfer event
  PERFORM log_room_event(
    p_room_id,
    'host_transferred',
    NULL,  -- Not an error
    jsonb_build_object(
      'new_host_username', v_new_host.username,
      'new_host_player_index', v_new_host.player_index
    )
  );
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reassign_next_host IS
  'Assigns a new host when current host leaves a waiting room';
```

### Trigger Implementation

```sql
-- Trigger when host leaves room
CREATE OR REPLACE FUNCTION check_host_departure()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act if departing player was the host
  IF OLD.is_host = true THEN
    PERFORM reassign_next_host(OLD.room_id);
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reassign_host_on_leave
AFTER DELETE ON room_players
FOR EACH ROW
EXECUTE FUNCTION check_host_departure();

COMMENT ON TRIGGER reassign_host_on_leave ON room_players IS
  'Automatically reassigns host when current host leaves a waiting room';
```

### Edge Cases Handled

**Case 1: Last player leaves**
- `reassign_next_host()` finds no players
- Sets `rooms.host_id = NULL`
- Room becomes "abandoned" but not deleted
- Quick Play can claim it later

**Case 2: Host leaves during active game**
- Function checks `status != 'waiting'`
- Returns false (no reassignment during gameplay)
- Game continues with original host for scoring purposes

**Case 3: Only bots remain**
- Bot becomes host (can't start game, but maintains room state)
- When human joins, they become host (via Quick Play logic)

### Testing Scenarios

```sql
-- Test 1: Host leaves waiting room with 3 other players
BEGIN;
  DELETE FROM room_players WHERE room_id = 'test-room' AND is_host = true;
  -- Verify: Another player now has is_host=true
  SELECT username, is_host FROM room_players WHERE room_id = 'test-room';
ROLLBACK;

-- Test 2: Last player (who is host) leaves
BEGIN;
  DELETE FROM room_players WHERE room_id = 'test-room';
  -- Verify: rooms.host_id IS NULL
  SELECT host_id FROM rooms WHERE id = 'test-room';
ROLLBACK;
```

---

## 🚀 Migration Deployment Procedure

### Step 1: Pre-Deployment Checklist

```bash
# 1. Backup database (Supabase auto-backups, but verify)
# Dashboard → Project Settings → Backups

# 2. Check current room state
SELECT COUNT(*) as total_rooms, 
       COUNT(*) FILTER (WHERE status='waiting') as waiting,
       COUNT(*) FILTER (WHERE status='playing') as playing
FROM rooms;

# 3. Check for duplicate usernames (will be cleaned)
SELECT room_id, LOWER(username), COUNT(*)
FROM room_players
GROUP BY room_id, LOWER(username)
HAVING COUNT(*) > 1;

# 4. Notify users (if production)
# Schedule maintenance window if active users present
```

### Step 2: Create Migration File

**File:** `20251206000001_room_robustness_improvements.sql`

**Location:** `/big2-multiplayer/supabase/migrations/`

**Contents:** Combine all 4 parts above in order:
1. Room analytics table + functions
2. Username cleanup + unique index
3. Atomic join function
4. Host transfer trigger

### Step 3: Apply Migration

**Using Supabase CLI:**
```bash
cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/big2-multiplayer

# Test locally first (if local Supabase setup)
supabase db reset

# Apply to remote
supabase db push
```

**Using MCP Tool:**
```typescript
mcp_supabase_apply_migration({
  project_id: 'bjxdmhybbpbmgdabqswi',
  name: 'room_robustness_improvements',
  query: <full SQL from file>
})
```

### Step 4: Post-Migration Validation

```sql
-- 1. Verify tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'room_analytics';

-- 2. Verify functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN (
  'join_room_atomic',
  'reassign_next_host',
  'log_room_event'
);

-- 3. Verify triggers exist
SELECT trigger_name FROM information_schema.triggers
WHERE event_object_table = 'room_players';

-- 4. Verify unique index
SELECT indexname FROM pg_indexes
WHERE tablename = 'room_players'
AND indexname = 'idx_room_players_username_unique';

-- 5. Test atomic join
SELECT join_room_atomic('TEST01', 'some-user-uuid', 'TestPlayer');
```

### Step 5: Frontend Integration

**Files to Update:**
1. `apps/mobile/src/screens/HomeScreen.tsx` (lines 100-260)
2. `apps/mobile/src/screens/JoinRoomScreen.tsx` (lines 20-120)
3. `apps/mobile/src/screens/CreateRoomScreen.tsx` (lines 30-140)

**Changes Required:**
- Replace direct `INSERT` queries with `join_room_atomic()` RPC calls
- Add error handling for new exception types
- Handle username conflict gracefully (append suffix)
- Update matchmaking query to exclude dirty rooms

### Step 6: Testing Protocol

**Test Case 1: Username Uniqueness**
```
1. Create room with username "Player1"
2. Try joining same room as different user with "Player1"
3. Expected: Error or auto-rename to "Player1_X"
```

**Test Case 2: Race Condition**
```
1. Create room with 3 players
2. Have 2 devices attempt joining simultaneously
3. Expected: One succeeds, one gets "Room is full" error
```

**Test Case 3: Host Transfer**
```
1. Create room, verify user is host
2. Have another user join
3. Original host leaves
4. Expected: New user is now host
```

**Test Case 4: Room Analytics**
```
1. Create room, all players leave before starting
2. Query room_analytics table
3. Expected: Record with error_type='all_players_left_waiting', is_dirty=true
```

---

## 📊 Monitoring & Rollback

### Analytics Queries

**Most common abandonment reasons:**
```sql
SELECT 
  error_type,
  COUNT(*) as occurrences,
  ROUND(AVG(time_in_waiting_seconds)) as avg_wait_time,
  ROUND(AVG(player_count_at_event)) as avg_players
FROM room_analytics
WHERE is_dirty = true
GROUP BY error_type
ORDER BY occurrences DESC;
```

**Room lifecycle metrics:**
```sql
SELECT 
  DATE_TRUNC('hour', event_at) as hour,
  COUNT(*) FILTER (WHERE status_reached='finished') as completed_games,
  COUNT(*) FILTER (WHERE is_dirty=true) as abandoned_rooms,
  ROUND(AVG(time_in_playing_seconds)) as avg_game_duration
FROM room_analytics
WHERE event_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

### Rollback Procedure

If issues arise, rollback steps:

```sql
-- 1. Drop new triggers
DROP TRIGGER IF EXISTS reassign_host_on_leave ON room_players;
DROP TRIGGER IF EXISTS room_abandonment_check ON room_players;

-- 2. Drop new functions
DROP FUNCTION IF EXISTS join_room_atomic(TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS reassign_next_host(UUID);
DROP FUNCTION IF EXISTS log_room_event(UUID, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS check_host_departure();
DROP FUNCTION IF EXISTS check_room_abandonment();

-- 3. Drop unique index (allows duplicates again)
DROP INDEX IF EXISTS idx_room_players_username_unique;

-- 4. Keep analytics table (don't lose data)
-- ALTER TABLE room_analytics RENAME TO room_analytics_backup;

-- 5. Revert frontend code to direct INSERT queries
```

---

## 🎯 Success Criteria

Migration is successful when:

- [ ] All 4 triggers/functions deployed without errors
- [ ] `room_analytics` table populating with events
- [ ] Username duplicates prevented (constraint enforced)
- [ ] Race conditions eliminated (verified with concurrent join tests)
- [ ] Host transfers automatically when host leaves waiting room
- [ ] Mobile app can join rooms via `join_room_atomic()`
- [ ] Matchmaking excludes dirty rooms from reuse
- [ ] No performance degradation (< 100ms join latency)

---

## 🚨 Known Risks & Mitigations

### Risk 1: Existing Duplicate Usernames
**Likelihood:** Medium  
**Impact:** High (migration will fail)  
**Mitigation:** Pre-migration cleanup query runs first

### Risk 2: Performance Degradation
**Likelihood:** Low  
**Impact:** Medium  
**Mitigation:** Row locks released quickly; indexes on all join columns

### Risk 3: Frontend Integration Complexity
**Likelihood:** High  
**Impact:** Medium  
**Mitigation:** This guide provides exact code snippets; test thoroughly

### Risk 4: Breaking Existing Rooms
**Likelihood:** Low  
**Impact:** High  
**Mitigation:** Migration only affects NEW joins; existing rooms unaffected

---

## 📚 Additional Resources

### Supabase Documentation
- [Database Functions](https://supabase.com/docs/guides/database/functions)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Triggers](https://supabase.com/docs/guides/database/postgres/triggers)

### PostgreSQL Documentation
- [SELECT FOR UPDATE](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
- [Unique Indexes](https://www.postgresql.org/docs/current/indexes-unique.html)
- [PL/pgSQL Functions](https://www.postgresql.org/docs/current/plpgsql.html)

### Testing Tools
- Supabase Dashboard SQL Editor
- Local Supabase instance (`supabase start`)
- Mobile app staging environment

---

## 📝 Final Notes for Implementation

**Recommended Order:**
1. Review this guide thoroughly
2. Test migration on local/staging project first
3. Schedule maintenance window (if production)
4. Apply migration to production
5. Update frontend code (can be done incrementally)
6. Monitor analytics dashboard for 24 hours
7. Optimize based on real-world usage patterns

**Estimated Total Time:**
- Migration creation: 15 minutes (copy/paste from guide)
- Testing on staging: 15 minutes
- Production deployment: 5 minutes
- Frontend updates: 30-45 minutes
- Post-deployment monitoring: Ongoing

**Support Channels:**
- Supabase Discord for database questions
- GitHub Issues for app-specific bugs
- Room analytics dashboard for debugging

---

## ✅ Implementation Checklist

Copy this to track progress:

```
[ ] Phase 1.1: Room Analytics
    [ ] Create room_analytics table
    [ ] Deploy log_room_event() function
    [ ] Deploy abandonment tracking triggers
    [ ] Test analytics logging

[ ] Phase 1.2: Username Uniqueness
    [ ] Run duplicate cleanup query
    [ ] Create unique index
    [ ] Test constraint enforcement
    [ ] Update frontend error handling

[ ] Phase 1.3: Atomic Joins
    [ ] Deploy join_room_atomic() function
    [ ] Update HomeScreen.tsx Quick Play
    [ ] Update JoinRoomScreen.tsx
    [ ] Test race conditions (2+ concurrent joins)

[ ] Phase 1.4: Auto Host Transfer
    [ ] Deploy reassign_next_host() function
    [ ] Deploy host departure trigger
    [ ] Test host leaving waiting room
    [ ] Test last player leaving room

[ ] Post-Deployment
    [ ] Run validation queries
    [ ] Monitor error rates
    [ ] Check analytics dashboard
    [ ] Verify matchmaking performance
    [ ] Document any issues
```

---

**End of Phase 1 Implementation Guide**

Good luck with the implementation! This guide should provide everything needed to successfully deploy these improvements. 🚀
