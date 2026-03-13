# 🎯 AUTO-PASS TIMER FIXES — TESTING GUIDE
## March 8, 2026

---

## 📋 WHAT WAS FIXED

### ✅ **1. Console Spam (FIXED)**
**Problem:** Log statement running on every render  
**Cause:** `gameLogger.info()` at component top level in MultiplayerGame.tsx  
**Fix:** Moved log into `useEffect(() => {}, [])` so it only logs once on mount  
**Expected:** No more repeated "Game mode: MULTIPLAYER" spam in console

### ✅ **2. Constant Re-renders / Slow Render Warnings (FIXED)**
**Problem:** GameScreen re-rendering every 100ms, causing lag and console spam  
**Cause:** useTurnInactivityTimer updating state every 100ms even when values unchanged  
**Fix:** Added state comparison in setTimerState — only update if remainingMs changed by >50ms  
**Expected:** Far fewer slow render warnings, smoother gameplay

### ✅ **3. Charcoal Grey Ring Not Depleting (FIXED)**
**Problem:** Charcoal grey countdown ring appears but doesn't animate  
**Cause:** turnTimerStartedAt prop not passed to local player's PlayerInfo component  
**Fix:** Changed GameView to use `layoutPlayersWithScores[0]` instead of `layoutPlayers[0]`  
**Expected:** Charcoal grey ring depletes smoothly clockwise over 60 seconds

### ✅ **4. Auto-Play Not Executing (REQUIRES MIGRATION)**
**Problem:** Timer expires but nothing happens  
**Cause:** turn_started_at column potentially NULL in database  
**Fix:** Apply migrations 20260308000002 and 20260308000003 (see below)  
**Expected:** After 60s, auto-play-turn edge function plays highest cards OR passes

### ✅ **5. Modal Not Appearing (SHOULD NOW WORK)**
**Problem:** "I'm Still Here?" modal never shown  
**Cause:** Auto-play wasn't executing, so modal callback never fired  
**Fix:** Once auto-play works (after migration), modal should appear  
**Expected:** Modal appears immediately after auto-play executes

### ✅ **6. Dual Ring System (YELLOW ON DISCONNECT)**
**Problem:** Yellow ring doesn't replace yellow on disconnect  
**Cause:** Same as #3 — prop not passed correctly  
**Fix:** Same fix — now both ring types receive proper props  
**Expected:** Yellow ring replaces yellow if disconnect happens during turn

---

## 🚀 HOW TO TEST

### **STEP 1: Apply Database Migrations**

```bash
cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo
./apply-turn-timer-migrations.sh
```

**What this does:**
- Adds `turn_started_at` column to `game_state` table
- Creates trigger to auto-update `turn_started_at` on turn changes
- Fixes `start_game_with_bots` function to initialize turn_started_at
- Sets DEFAULT NOW() for the column

**If script fails:**
```bash
cd apps/mobile
supabase db push --file supabase/migrations/20260308000002_add_turn_inactivity_timer.sql
supabase db push --file supabase/migrations/20260308000003_fix_turn_started_at_on_game_creation.sql
```

---

### **STEP 2: Restart Everything**

1. **Stop Metro bundler** (Ctrl+C in terminal)
2. **Kill app** on device/simulator
3. **Restart Metro:**
   ```bash
   cd apps/mobile
   npm start -- --reset-cache
   ```
4. **Rebuild app** (for fresh code):
   ```bash
   # iOS
   npx react-native run-ios
   
   # Android
   npx react-native run-android
   ```

---

### **STEP 3: Test Console Output (Should Be Clean)**

**Before fixes:**
```
🎮 [MultiplayerGame] Game mode: MULTIPLAYER (server-side)
🔴 Slow render: GameScreen (update) — 99ms over budget
🎮 [MultiplayerGame] Game mode: MULTIPLAYER (server-side)
🔴 Slow render: GameScreen (update) — 105ms over budget
🎮 [MultiplayerGame] Game mode: MULTIPLAYER (server-side)
... (repeating hundreds of times per second)
```

**After fixes:**
```
🎮 [MultiplayerGame] Game mode: MULTIPLAYER (server-side)  ← ONCE on mount
[MultiplayerGame] Turn timer active: { isMyTurn: true, remainingMs: 58234, ... }
[InactivityRing] Starting turn countdown animation
[InactivityRing] Timer started: type=turn, startedAt=2026-03-08T12:34:56.789Z
... (occasional logs, not spam)
```

**✅ PASS CRITERIA:** No log spam, <10 slow render warnings per minute

---

### **STEP 4: Test Charcoal Grey Ring (Turn Countdown)**

1. **Start NEW multiplayer game** (must be after migration + restart)
2. **Wait for your turn** (charcoal grey ring should appear around your avatar)
3. **Observe ring:** Should deplete **clockwise** from 12 o'clock
4. **Check console:** Should see:
   ```
   [InactivityRing] Starting turn countdown animation
   [InactivityRing] Timer started: type=turn, startedAt=...
   [MultiplayerGame] Turn timer active: { remainingMs: 60000, ... }
   ```
5. **Watch for 5-10 seconds:** Ring should animate smoothly (not jump)
6. **Play/pass manually:** Ring should disappear immediately

**✅ PASS CRITERIA:**
- ✅ Charcoal grey ring appears when it's your turn
- ✅ Ring depletes smoothly clockwise
- ✅ Ring disappears after playing/passing

---

### **STEP 5: Test Auto-Play (60s Timeout)**

1. **Start NEW multiplayer game**
2. **Wait for your turn** (charcoal grey ring appears)
3. **Don't touch anything** — let timer run to 0
4. **Wait full 60 seconds**
5. **Expected behavior:**
   - After 60s: Auto-play executes (plays highest cards OR passes)
   - Console shows:
     ```
     ⏰ [TurnTimer] EXPIRED — triggering auto-play
     ⏰ [TurnTimer] Calling auto-play-turn edge function
     ⏰ [TurnTimer] ✅ Auto-play successful: play/pass
     [MultiplayerGame] Turn auto-played: play/pass, [...]
     ```
   - Modal appears: "We played for you! Are you still here?"
   - Game continues (next player's turn)

**✅ PASS CRITERIA:**
- ✅ After 60s, cards are auto-played OR auto-passed
- ✅ Modal appears immediately after auto-play
- ✅ Game doesn't freeze/hang

---

### **STEP 6: Test "I'm Still Here?" Modal**

1. **Trigger auto-play** (wait 60s on your turn)
2. **Modal should show:**
   - Title: "We played for you!"
   - Message: "Are you still here?"
   - Cards played (if any): e.g., "3♦"
   - OR: "You passed"
   - Button: "I'm Still Here" (30s countdown)
3. **Click "I'm Still Here"** → Modal dismisses, game continues
4. **OR wait 30s without clicking** → mark-disconnected triggers (bot replacement flow)

**✅ PASS CRITERIA:**
- ✅ Modal appears after auto-play
- ✅ Shows correct action (play/pass)
- ✅ Shows played cards (if any)
- ✅ Button works → dismisses modal
- ✅ 30s timeout works → triggers disconnect flow

---

### **STEP 7: Test Dual Ring System (Yellow on Disconnect)**

**Setup:** Need another device/simulator or another player

1. **Start multiplayer game with 2+ players**
2. **Player A (you):** Wait for your turn (charcoal grey ring appears)
3. **Player B:** Observe Player A's avatar (charcoal grey ring visible from their perspective)
4. **Player A:** Simulate disconnect:
   - **iOS:** Airplane mode
   - **Android:** Disable WiFi
   - **OR:** Force close app
5. **Player B should see:**
   - Charcoal grey ring **immediately replaced** by **yellow ring**
   - Yellow ring continues countdown from where yellow left off
   - After 60s total (turn + disconnect), bot replaces Player A
6. **Player A reconnects:** Should see RejoinModal ("Reclaim My Seat")

**✅ PASS CRITERIA:**
- ✅ Charcoal grey ring shows during player's turn
- ✅ Yellow ring replaces yellow on disconnect
- ✅ Countdown continues seamlessly (no restart)
- ✅ After 60s total, bot replacement triggers
- ✅ Reconnect shows rejoin modal

---

## 🐛 TROUBLESHOOTING

### **Issue: Ring not appearing at all**

**Check:**
1. Is `turn_started_at` in database?
   ```sql
   SELECT turn_started_at FROM game_state WHERE room_id = '<your_room_id>';
   ```
   Should return a timestamp, NOT NULL

2. Console shows turnTimerStartedAt?
   ```
   [MultiplayerGame] Turn timer active: { turnStartedAt: '2026-03-08T...' }
   ```
   If NULL → migration didn't apply or game started before migration

**Fix:** 
- Apply migrations (Step 1)
- Start a **NEW game** (old games have NULL turn_started_at)

---

### **Issue: Ring appears but doesn't deplete**

**Check:**
1. Console shows InactivityRing logs?
   ```
   [InactivityRing] Starting turn countdown animation
   ```
   If NO → component not rendering

2. requestAnimationFrame working?
   - Check for React errors in console
   - Try restarting app with `--reset-cache`

**Fix:** Restart app, clear cache

---

### **Issue: Auto-play never executes**

**Check:**
1. Is turn_started_at valid timestamp? (SQL query above)
2. Console shows timer expiry?
   ```
   ⏰ [TurnTimer] EXPIRED — triggering auto-play
   ```
   If NO → timer interval not running or skipping execution

3. Edge function exists?
   ```bash
   cd apps/mobile/supabase/functions
   ls -la | grep auto-play-turn
   ```

**Fix:**
- Verify migrations applied
- Check edge function is deployed
- Restart server

---

### **Issue: Modal never appears**

**Check:**
1. Auto-play executed successfully?
   ```
   ⏰ [TurnTimer] ✅ Auto-play successful
   [MultiplayerGame] Turn auto-played
   ```
2. `onAutoPlay` callback fired?
3. `setShowTurnAutoPlayModal(true)` called?

**Fix:** Auto-play must succeed first (see above)

---

## 📊 SUCCESS CHECKLIST

- [ ] Console spam GONE (no repeated "Game mode" logs)
- [ ] Slow render warnings <10 per minute
- [ ] Charcoal grey ring appears on your turn
- [ ] Charcoal grey ring depletes smoothly over 60s
- [ ] After 60s, auto-play executes (cards played OR pass)
- [ ] Modal appears: "We played for you! Are you still here?"
- [ ] "I'm Still Here" button dismisses modal
- [ ] 30s modal timeout triggers disconnect flow
- [ ] Yellow ring replaces yellow on disconnect
- [ ] Yellow ring continues from same position

---

## 🎉 ALL TESTS PASSING?

Congrats! The auto-pass timer system is now fully functional:
- ✅ 60s turn countdown (charcoal grey ring)
- ✅ Auto-play-turn on timeout
- ✅ "I'm Still Here?" popup
- ✅ Dual-ring system (charcoal grey → yellow on disconnect)
- ✅ Bot replacement after 60s inactivity
- ✅ No console spam
- ✅ Smooth performance

---

## 📝 NEXT STEPS

If all tests pass, clean up debug logs:
1. Remove `gameLogger.debug()` calls in MultiplayerGame.tsx
2. Remove `networkLogger` logs in InactivityCountdownRing.tsx
3. Commit changes with message:
   ```
   fix(turn-timer): resolve ring depletion, auto-play, and console spam
   
   - Fixed console spam by moving log to useEffect
   - Optimized timer state updates to prevent re-render spam
   - Fixed turnTimerStartedAt prop not passed to local player
   - Added migrations for turn_started_at column
   - Added debug logging for troubleshooting
   
   All turn timer tests now passing ✅
   ```

---

**Date:** March 8, 2026  
**PR:** [#109](https://github.com/michaelelalam-glitch/Big-Two-Neo/pull/109)
