# Host Assignment Fix - December 30, 2025

## Problem Summary

**User Report:**
> "i dont want a quick fix i want a proper fix! the first human to enter the room should be the host and bet the host badge in the game lobby"

**Root Cause:**
In casual games (Quick Play), the `get_or_create_room` RPC was NOT setting `rooms.host_id` when creating new rooms. This caused:
1. First human joining showed `is_host = null` (no host badge in lobby)
2. Bot coordinator logic failed (`isMultiplayerHost = false` → bots wouldn't play)
3. Host-only features (room cleanup, start button) didn't work

## Architecture

### Casual Game Flow (Quick Play)
```
User clicks "Quick Play"
  ↓
HomeScreen.tsx searches for existing casual rooms
  ↓ (if none found)
get_or_create_room(user_id, username, ...) 
  ↓ Creates new room
  INSERT INTO rooms (code, host_id, ...) VALUES (v_code, p_user_id, ...)  ← MISSING!
  ↓
join_room_atomic(room_code, user_id, username)
  ↓ Reads rooms.host_id
  v_is_host := (v_host_id = p_user_id);  ← FAILS if host_id = NULL
  ↓
  INSERT INTO room_players (..., is_host) VALUES (..., v_is_host)
  ↓ Result: is_host = null for human
```

### Ranked Game Flow (Matchmaking)
```
find_match RPC creates 4-player rooms
  ↓
Sets is_host = (player_index == 0) for first human
  ↓ Works correctly (different code path)
```

## Solution Applied

### Migration: 20251226000006_fix_get_or_create_room_host_id.sql

**Part 1: Fix Function**
```sql
CREATE OR REPLACE FUNCTION get_or_create_room(...) RETURNS JSONB AS $$
BEGIN
  -- IMPORTANT: set host_id at creation time
  INSERT INTO rooms (code, host_id, status, max_players, ...)
  VALUES (v_room_code, p_user_id, 'waiting', 4, ...)  -- ✅ Sets host_id = creator
  RETURNING id INTO v_room_id;
  
  -- Add the creator to the room
  PERFORM join_room_atomic(v_room_code, p_user_id, p_username);  -- ✅ Will correctly set is_host
  ...
END;
$$ LANGUAGE plpgsql;
```

**Part 2: Backfill Existing Rooms**
```sql
-- Choose the first non-bot human in the room (lowest player_index)
WITH host_candidates AS (
  SELECT r.id AS room_id,
    (SELECT rp.user_id FROM room_players rp
     WHERE rp.room_id = r.id AND rp.is_bot = false AND rp.user_id IS NOT NULL
     ORDER BY rp.player_index ASC LIMIT 1) AS host_user_id
  FROM rooms r WHERE r.host_id IS NULL
)
UPDATE rooms r
SET host_id = hc.host_user_id
FROM host_candidates hc
WHERE r.id = hc.room_id AND hc.host_user_id IS NOT NULL;
```

**Part 3: Normalize is_host Flags**
```sql
-- Set is_host = true for humans matching rooms.host_id
UPDATE room_players rp
SET is_host = (rp.user_id = r.host_id)
FROM rooms r
WHERE rp.room_id = r.id AND r.host_id IS NOT NULL AND rp.is_bot = false;

-- Ensure bots never appear as host
UPDATE room_players SET is_host = false WHERE is_bot = true;
```

### Client Fix: Reverted Quick Fix

**Before (Quick Fix - USER REJECTED):**
```typescript
// useRealtime.ts lines 307-311
const hasBots = roomPlayers.some(p => p.is_bot);
const isOnlyHuman = currentPlayer && !currentPlayer.is_bot && hasBots;
const isHost = currentPlayer?.is_host === true || (isOnlyHuman && !currentPlayer?.is_host);
```

**After (Proper Fix):**
```typescript
// useRealtime.ts line 308
const isHost = currentPlayer?.is_host === true;  // ✅ Simple, relies on database being correct
```

## Verification

### Database State After Migration

**Room CTVS7A (Casual Game with Human):**
```
host_id: 19a3489b-dd6f-424d-8d64-e9475d0708a1 (Lorraine Alan)
├─ player_index 0: Lorraine Alan, is_host=true  ✅
├─ player_index 1: Bot 2, is_host=false  ✅
├─ player_index 2: Bot 3, is_host=false  ✅
└─ player_index 3: Bot 4, is_host=false  ✅
```

**Room PGDTR7 (User Disconnected):**
```
host_id: 4ce1c03a-1b49-4e94-9572-60fe13759e14 (Steve Peterson - disconnected)
├─ player_index 1: Bot 2, is_host=false  ✅
├─ player_index 2: Bot 3, is_host=false  ✅
└─ player_index 3: Bot 4, is_host=false  ✅
```
Steve's player record was removed when he disconnected, but `rooms.host_id` preserved.

## Expected Behavior (After Reload)

1. ✅ **Casual Room Creation:** User clicks Quick Play → Creates new room with `host_id = user_id`
2. ✅ **Host Badge:** User sees "HOST" badge in lobby
3. ✅ **Bot Coordinator:** `isMultiplayerHost = true` → Bots execute turns correctly
4. ✅ **Host Permissions:** Room cleanup, start button, etc. work correctly
5. ✅ **Subsequent Joins:** Other humans joining get `is_host = false` correctly

## Testing Checklist

### Test Scenario 1: Fresh Casual Game
1. User A clicks "Quick Play"
2. Adds 3 bots
3. **Verify:** User A shows "HOST" badge in lobby
4. Start game
5. **Verify:** Bots play their turns (coordinator working)
6. **Verify:** User A can play/pass when valid

### Test Scenario 2: Second Human Joins
1. User A creates casual room (Quick Play)
2. User B searches and joins the room
3. **Verify:** User A shows "HOST" badge
4. **Verify:** User B does NOT show "HOST" badge
5. **Verify:** Both can see room status correctly

### Test Scenario 3: Host Disconnect
1. User A creates casual room with 3 bots
2. Start game
3. User A disconnects mid-game
4. **Expected:** Bots continue playing (room.host_id preserved even if player_index 0 empty)

## Files Changed

1. **Migration Applied:**
   - `apps/mobile/supabase/migrations/20251226000006_fix_get_or_create_room_host_id.sql`

2. **Client Reverted:**
   - `apps/mobile/src/hooks/useRealtime.ts` (line 308)

## Production Readiness

✅ **Database-level fix** (user's requirement)  
✅ **Backward compatible** (existing games continue working)  
✅ **Backfill applied** (existing rooms fixed)  
✅ **Quick fix reverted** (clean codebase)  
❌ **User needs to reload app** to see host badge (fresh room creation will work)

## Related Issues

### Issue: Bot Play 404 Errors
**Separate from host assignment!** Edge Function logs show:
```
POST /play-cards → 404 (room not found)
Timestamps: 11:06:37, 11:05:17, 10:00:31 PST
```

This is NOT a validation error - rooms are being cleaned up or don't exist in database. The play-cards Edge Function can't find the game state. Need to investigate:
1. Game state cleanup triggers
2. Room expiration logic
3. Why game_state missing for active rooms

---

**Status:** ✅ Host assignment FIXED (proper database-level solution)  
**Next:** User needs to test fresh game with reload, investigate bot play 404 errors
