# Auto-Play Timer Troubleshooting Guide

## 🔧 What Was Fixed (v2)

### Changes Applied:
1. **Database Migration** - Added 70-second buffer to prevent bot replacement during active turns
2. **Edge Function** - Enhanced authorization to check both `user_id` and `human_user_id`
3. **Debug Logging** - Added detailed logs to track exact failure points

## 🎯 Quick Test

```bash
cd apps/mobile
./TEST_AUTOPLAY_FIX.sh
```

Then:
1. Start a game
2. Wait for 60 seconds on your turn without playing
3. Auto-play should execute successfully

## 🔍 Debugging Steps

### If auto-play fails, check these in order:

### 1. Check Client Console Logs

Look for these messages in your app console:

**✅ Good signs:**
```
[TurnTimer] EXPIRED — triggering auto-play
[TurnTimer] Calling auto-play-turn edge function
[TurnTimer] ✅ Auto-play successful: play/pass
```

**❌ Bad signs:**
```
[TurnTimer] ❌ Auto-play failed: <error message>
```

### 2. View Edge Function Logs

```bash
supabase functions logs auto-play-turn --project-ref dppybucldqufbqhwnkxu --follow
```

**Look for:**
- `[auto-play-turn] Auth check: user=<uuid>, player_user_id=<uuid>, human_user_id=<uuid>, isPlayersTurn=true`
- `[auto-play-turn] Using effective user ID: <uuid>`
- `⏰ [auto-play-turn] Auto-playing X cards for player Y`

**Common errors:**

#### Error: "Not your turn"
```
Auth check: isPlayersTurn=false
```
**Cause:** Authorization check failed  
**Fix:** Player's `user_id` or `human_user_id` doesn't match caller  
**Debug:** Check if player was replaced by bot too early

#### Error: "Unauthorized" (401)
```
success: false, error: 'Unauthorized'
```
**Cause:** Auth token invalid or expired  
**Fix:** Client needs to refresh session  
**Debug:** Check if user is still authenticated

#### Error: "Room not found" (404)
```
success: false, error: 'Room not found'
```
**Cause:** Room code doesn't exist  
**Fix:** Verify room_code being sent  
**Debug:** Check if room still exists in database

#### Error: "Timeout not reached"
```
action: 'timeout_not_reached'
seconds_elapsed: XX
```
**Cause:** Timer called before 60s  
**Fix:** Ensure turn_started_at is correct  
**Debug:** Check clock sync between client and server

### 3. Check Database State

```sql
-- Check current player state
SELECT 
  player_index,
  username,
  user_id,
  human_user_id,
  connection_status,
  last_heartbeat,
  disconnected_at
FROM room_players
WHERE room_id = '<your_room_id>';

-- Check game state
SELECT 
  current_turn,
  turn_started_at,
  NOW() - turn_started_at AS elapsed,
  game_phase
FROM game_state
WHERE room_id = '<your_room_id>';
```

**What to check:**
- Is `turn_started_at` set correctly?
- Is `current_turn` the right player?
- Has 60+ seconds elapsed?
- Is player's `user_id` NULL? (replaced by bot)
- Is `human_user_id` set? (shows original user before bot replacement)

### 4. Check Bot Replacement Timing

If player is being replaced by bot BEFORE auto-play:

```sql
-- Check when bot replacement happened
SELECT 
  player_index,
  disconnected_at,
  NOW() - disconnected_at AS time_since_disconnect,
  connection_status
FROM room_players
WHERE room_id = '<your_room_id>'
  AND connection_status = 'replaced_by_bot';
```

**Expected:**
- Bot replacement should NOT happen until 70+ seconds after disconnect if it's their turn
- `process_disconnected_players` should skip replacement during active turns

## 🎓 Understanding the Flow

### Normal Flow (Working):
```
Timer Expires (60s)
↓
Client calls auto-play-turn
↓
Edge function authorizes (user_id OR human_user_id = caller)
↓
BotAI determines best play
↓
play-cards or player-pass executed
↓
✅ Success returned to client
↓
[Later] Bot replacement happens at 70s+ (only if still disconnected)
```

### Broken Flow (Before Fix):
```
Timer Expires (60s)
↓
[Heartbeat sweep runs] → Player replaced by bot (user_id = NULL)
↓
Client calls auto-play-turn
↓
Edge function checks: currentPlayer.user_id !== user.id
↓
❌ Returns 403 Unauthorized
↓
❌ Auto-play fails
```

## 📊 Expected Behavior After Fix

### Scenario 1: Player Active, Timer Expires
- ✅ Auto-play executes at 60s
- ✅ Highest cards played or pass
- ✅ "I'm Still Here?" modal appears
- ✅ If player doesn't respond after 60s more (120s total), bot replacement happens

### Scenario 2: Player Disconnected, Timer Expires
- ✅ Player marked disconnected at 60s of inactivity
- ✅ Auto-play still executes if it's their turn
- ✅ Bot replacement delayed until 70s if turn is active
- ✅ After turn completes, bot takes over for next turn

### Scenario 3: Player Reconnects After Disconnect
- ✅ Can reclaim seat from bot
- ✅ Timer resets when they play
- ✅ No bot replacement if they're active

## 🐛 Still Having Issues?

### Collect Full Debug Info:

```bash
# 1. Get edge function logs
supabase functions logs auto-play-turn --project-ref dppybucldqufbqhwnkxu > autoplay-logs.txt

# 2. Get database state
supabase db execute --project-ref dppybucldqufbqhwnkxu --sql "
SELECT 
  rp.player_index,
  rp.username,
  rp.user_id,
  rp.human_user_id,
  rp.connection_status,
  rp.last_heartbeat,
  rp.disconnected_at,
  gs.current_turn,
  gs.turn_started_at,
  NOW() - gs.turn_started_at AS elapsed
FROM room_players rp
JOIN game_state gs ON gs.room_id = rp.room_id
WHERE rp.room_id = '<your_room_id>';
" > db-state.txt

# 3. Share both files for debugging
```

### Check Network Issues:

```bash
# Test edge function directly
curl -X POST https://dppybucldqufbqhwnkxu.supabase.co/functions/v1/auto-play-turn \
  -H "Authorization: Bearer <your_anon_key>" \
  -H "Content-Type: application/json" \
  -d '{"room_code":"<your_room_code>"}'
```

**Expected success:**
```json
{
  "success": true,
  "action": "play",
  "cards": [...],
  "seconds_elapsed": 60
}
```

**Or:**
```json
{
  "success": true,
  "action": "pass",
  "seconds_elapsed": 60
}
```

## 📞 Support

If auto-play still fails after these steps:

1. Run `./TEST_AUTOPLAY_FIX.sh` and share output
2. Share edge function logs (`autoplay-logs.txt`)
3. Share database state (`db-state.txt`)
4. Share client console logs (especially the error message)
5. Describe exactly when the error occurs (on what second, what player state)

---

**Last Updated:** March 8, 2026  
**Version:** 2.0 (Enhanced Debugging)
