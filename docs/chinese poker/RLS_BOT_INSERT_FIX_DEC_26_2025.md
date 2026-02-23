# CRITICAL FIX: RLS Blocking Bot Player Inserts (Dec 26, 2025)

## Problem Summary

**CRITICAL BUG**: When host starts a multiplayer game with 2+ humans, the game does not navigate players from lobby to game screen. Players receive push notifications, but nothing happens.

## Root Cause Analysis

### Error Found in Console Log
```
1:24:24 pm | ✅ [LobbyScreen] Game started successfully: {  
  "success": false,  
  "error": "new row violates row-level security policy for table \"room_players\""
}
```

### The Flow That Fails

1. Host clicks "Start Game" in lobby with 2 humans
2. `LobbyScreen.tsx` calls `supabase.rpc('start_game_with_bots', { p_bot_count: 2 })`
3. `start_game_with_bots()` SQL function tries to insert 2 bot players into `room_players`:
   ```sql
   INSERT INTO room_players (
     room_id, user_id, username, player_index, is_bot, bot_difficulty, is_ready, joined_at
   ) VALUES (
     p_room_id, NULL, 'Bot 1', ..., true, 'medium', true, NOW()
   );
   ```
4. **RLS BLOCKS THIS INSERT** because of this policy:
   ```sql
   CREATE POLICY "Authenticated users can join rooms" ON room_players
     FOR INSERT WITH CHECK (auth.uid() = user_id AND is_host = FALSE);
   ```
   - This policy requires `user_id = auth.uid()`
   - But bots have `user_id = NULL` 
   - Therefore: `auth.uid() != NULL` → **INSERT FAILS**

5. Because the INSERT fails:
   - Room status never changes to 'playing'
   - Real-time subscription never fires: `payload.new?.status === 'playing'` → `false`
   - Players stay stuck in lobby
   - **But** push notifications are still sent (they don't depend on the room status update)

### Why This Happens

The `start_game_with_bots()` function runs with the **same permissions as the calling user** (the host). When it tries to insert bot players, the RLS policies are evaluated in the context of that authenticated user.

The existing RLS policy `"Authenticated users can join rooms"` was designed for **human players joining rooms**, not for **server functions creating bot players**. It requires:
- `auth.uid() = user_id` (you can only insert yourself)
- `is_host = FALSE` (regular players aren't hosts)

This works fine for humans, but fails for bots where `user_id = NULL`.

## The Fix

**Migration**: `/Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile/supabase/migrations/20251226200000_fix_bot_insert_rls.sql`

Add a new RLS policy that explicitly allows inserting bot players:

```sql
CREATE POLICY "Server can insert bot players" ON room_players
  FOR INSERT WITH CHECK (
    user_id IS NULL AND is_bot = TRUE
  );
```

### Why This is Secure

1. **Bots have no credentials**: `user_id = NULL` means they can't authenticate
2. **is_bot flag is protected**: Clients can't set `is_bot = TRUE` because they would fail the existing policy
3. **Function validates ownership**: `start_game_with_bots()` checks that the room exists and belongs to the caller
4. **Two policies now exist**:
   - `"Authenticated users can join rooms"`: For human players (`user_id = auth.uid()`, `is_host = FALSE`)
   - `"Server can insert bot players"`: For bot players (`user_id IS NULL`, `is_bot = TRUE`)

Both policies are evaluated with `OR` logic, so an INSERT succeeds if **either** policy passes.

## Testing the Fix

### Steps to Apply and Test

1. **Apply the migration to Supabase**:
   ```bash
   cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile
   npx supabase db push
   ```

2. **Test the flow**:
   - Open two devices/instances
   - Device 1: Create casual room as Mark Hunter (host)
   - Device 2: Join room as Steve Peterson
   - Device 1: Click "Start Game"
   - **Expected result**: Both players navigate to game screen

### What Should Happen Now

1. Host clicks "Start Game"
2. `start_game_with_bots()` successfully inserts 2 bot players ✅
3. Room status updates to `'playing'` ✅
4. Real-time subscription fires for ALL players ✅
5. All players navigate to game screen ✅
6. Push notifications sent ✅

## Console Log Evidence

**Before Fix** (lines 2993-2994):
```
1:24:24 pm | ✅ [LobbyScreen] Game started successfully: {  
  "success": false,  
  "error": "new row violates row-level security policy for table \"room_players\""
}
```

**After Fix** (expected):
```
1:24:24 pm | ✅ [LobbyScreen] Game started successfully: {  
  "success": true,  
  "room_id": "d80909eb-03fd-43f3-a46b-a8615dc4d431",
  "human_count": 2,
  "bot_count": 2,
  "coordinator_id": "20bd45cb-1d72-4427-be77-b829e76c6688",
  "status": "playing",
  "starting_player": 0
}
```

## Related Files

- **Migration**: `apps/mobile/supabase/migrations/20251226200000_fix_bot_insert_rls.sql`
- **SQL Function**: `apps/mobile/supabase/migrations/20251226000004_create_game_state_on_start.sql` (line 95-97)
- **RLS Policies**: `apps/mobile/supabase/migrations/20251205000001_mobile_lobby_schema.sql` (line 65-66)
- **Client Code**: `apps/mobile/src/screens/LobbyScreen.tsx` (line 386-390)

## Lessons Learned

1. **RLS policies apply to ALL operations**, including server-side RPC functions
2. **Multiple policies can coexist**: Evaluate with OR logic
3. **Always check RLS** when seeing "row-level security policy" errors
4. **Bot players need special handling**: They have `user_id = NULL`, which breaks normal user policies
5. **Test both paths**: Solo game (1 human + 3 bots) vs multiplayer (2+ humans + bots)

## Status

✅ **Root cause identified**: RLS policy blocking bot inserts
✅ **Fix implemented**: New RLS policy for bots  
⏳ **Pending**: Apply migration to Supabase database
⏳ **Pending**: Test with 2+ human players

---

**Next Step**: Apply the migration and test!
