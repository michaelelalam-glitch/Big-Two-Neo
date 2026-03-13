# 🧪 Manual Test Checklist - Big Two Neo
**Date:** December 26, 2025  
**Version:** Post-Critical-Fixes  
**Tester:** _______________

---

## 📋 Pre-Test Setup

### Device Preparation
- [ ] Device/Emulator: _________________ (iOS/Android)
- [ ] OS Version: _________________
- [ ] App Build: _________________ (debug/release)
- [ ] Supabase Connection: ✅ Connected / ❌ Failed
- [ ] Screen Recording Enabled: Yes / No
- [ ] Log Capture Enabled: Yes / No

### Test Accounts
- [ ] Account 1 (Tester): _________________ 
- [ ] Account 2 (Helper/Device 2): _________________
- [ ] Account 3 (Helper/Device 3): _________________
- [ ] Account 4 (Helper/Device 4): _________________

### Database Verification
- [ ] Run migration 20251226000003 (bot usernames)
- [ ] Verify migration applied: `SELECT * FROM schema_migrations;`
- [ ] Clear test data: `DELETE FROM room_players WHERE is_bot = true;`

---

## 🎯 TEST SCENARIOS

### **Scenario 1: Ranked Matchmaking - 4 Humans Only**
**Mode:** Ranked | **Players:** 4H+0B | **Priority:** CRITICAL

#### Setup
1. [ ] Launch app on 4 devices/accounts
2. [ ] Each user: Tap "Find Match" → Select "Ranked"
3. [ ] Note: Wait for skill-based matching (±200 ELO)

#### Expected Results
- [ ] All 4 users matched within 30 seconds
- [ ] Lobby screen shows 4 human players
- [ ] No "Start with Bots" button visible
- [ ] All players auto-ready
- [ ] Game auto-starts when 4th player joins

#### Verification Steps
**Lobby:**
- [ ] Room code displayed correctly
- [ ] All 4 usernames visible (no "null")
- [ ] Host crown (👑) visible on player 1
- [ ] No bot indicators (🤖)

**Game Session:**
- [ ] Navigate to GameScreen automatically
- [ ] 13 cards dealt to each player
- [ ] Player with 3D starts first
- [ ] Turn order correct (counter-clockwise)
- [ ] Real-time updates work (see others' plays)

**Completion:**
- [ ] Game ends when one player has 0 cards
- [ ] Scoreboard shows correct rankings
- [ ] Stats updated in leaderboard
- [ ] Return to home successful

#### Issues Found
```
[Record any bugs, errors, or unexpected behavior]




```

**Status:** ✅ PASS / ❌ FAIL  
**Video:** _________________.mp4

---

### **Scenario 2: Casual Matchmaking - 4 Humans Only**
**Mode:** Casual | **Players:** 4H+0B | **Priority:** HIGH

#### Setup
1. [ ] Launch app on 4 devices/accounts
2. [ ] Each user: Tap "Find Match" → Select "Casual"
3. [ ] Wait for matchmaking

#### Expected Results
- [ ] All 4 users matched within 30 seconds
- [ ] Lobby screen shows 4 human players
- [ ] Host sees "Start Game" button (no bot fill needed)
- [ ] All players ready
- [ ] Host clicks "Start Game"

#### Verification Steps
**Lobby:**
- [ ] Room code displayed
- [ ] 4 human players visible
- [ ] "Start with 0 AI Bots" button visible (host only)
- [ ] No bot indicators

**Game Session:**
- [ ] GameScreen loads for all players
- [ ] 13 cards dealt correctly
- [ ] 3D holder starts
- [ ] Multiplayer sync works

**Completion:**
- [ ] Winner declared correctly
- [ ] Stats tracked (casual mode)
- [ ] Return to home works

#### Issues Found
```




```

**Status:** ✅ PASS / ❌ FAIL  
**Video:** _________________.mp4

---

### **Scenario 3: Casual Matchmaking - 3 Humans + 1 Bot**
**Mode:** Casual | **Players:** 3H+1B | **Priority:** CRITICAL

#### Setup
1. [ ] Launch app on 3 devices
2. [ ] Each user: Tap "Find Match" → "Casual"
3. [ ] Wait for partial match (3 players, < 4)
4. [ ] After 30s timeout, host should see bot fill option

#### Expected Results
- [ ] 3 humans enter lobby (waiting for 4th)
- [ ] After timeout, host sees "Start with 1 AI Bot" button
- [ ] Bot username visible: "Bot 4" (not null)
- [ ] Game starts with 3H+1B

#### Verification Steps
**Lobby:**
- [ ] 3 human players listed
- [ ] Empty slot OR "Waiting for player 4..."
- [ ] Host: "Start with 1 AI Bot" button appears
- [ ] Host clicks button
- [ ] Bot appears in slot 4: "Bot 4" 🤖
- [ ] Room status changes to 'playing'
- [ ] All 3 humans auto-navigate to game

**Game Session:**
- [ ] 4 players visible (3 humans + 1 bot)
- [ ] Bot username is "Bot 4" (NOT "null" or blank)
- [ ] 13 cards dealt to all 4
- [ ] Bot takes turns automatically
- [ ] Bot plays valid combos
- [ ] Bot passes when appropriate
- [ ] Humans can play normally

**Bot Behavior:**
- [ ] Bot responds within 2-3 seconds
- [ ] Bot combos are valid
- [ ] Bot doesn't crash game
- [ ] Bot finishes game (can win or lose)

**Completion:**
- [ ] Game ends normally
- [ ] Winner declared (human or bot)
- [ ] Stats updated for humans only
- [ ] Return to home works

#### Issues Found
```




```

**Status:** ✅ PASS / ❌ FAIL  
**Video:** _________________.mp4

---

### **Scenario 4: Casual Matchmaking - 2 Humans + 2 Bots**
**Mode:** Casual | **Players:** 2H+2B | **Priority:** CRITICAL

#### Setup
1. [ ] Launch app on 2 devices
2. [ ] Both users: Tap "Find Match" → "Casual"
3. [ ] Wait for 2-player match
4. [ ] Host clicks "Start with 2 AI Bots"

#### Expected Results
- [ ] 2 humans in lobby
- [ ] "Start with 2 AI Bots" button visible
- [ ] Bots created: "Bot 3", "Bot 4"
- [ ] Game starts with 2H+2B

#### Verification Steps
**Lobby:**
- [ ] 2 human players listed
- [ ] 2 empty slots
- [ ] Host: "Start with 2 AI Bots" button
- [ ] Click → 2 bots appear: "Bot 3" 🤖, "Bot 4" 🤖
- [ ] Both bots show usernames (not null)

**Game Session:**
- [ ] 4 players total (2H + 2B)
- [ ] Both bot usernames visible
- [ ] Cards dealt correctly
- [ ] Bots alternate with humans
- [ ] Both bots play competently
- [ ] Humans can win against bots

**Completion:**
- [ ] Game completes successfully
- [ ] Either human or bot can win
- [ ] Stats updated for humans
- [ ] No crashes or freezes

#### Issues Found
```




```

**Status:** ✅ PASS / ❌ FAIL  
**Video:** _________________.mp4

---

### **Scenario 5: Casual Matchmaking - 1 Human + 3 Bots (SOLO)**
**Mode:** Casual | **Players:** 1H+3B | **Priority:** CRITICAL (Bug Fix Verification)

#### Setup
1. [ ] Launch app on 1 device
2. [ ] Tap "Find Match" → "Casual"
3. [ ] Wait 30s+ (no other players)
4. [ ] Host (solo player) clicks "Start with 3 AI Bots"

#### Expected Results
- [ ] Solo player in lobby
- [ ] "Start with 3 AI Bots" button visible
- [ ] Bots created: "Bot 2", "Bot 3", "Bot 4"
- [ ] Game starts with 1H+3B

#### Verification Steps
**Lobby:**
- [ ] 1 human player (you)
- [ ] 3 empty slots
- [ ] "Start with 3 AI Bots" button appears
- [ ] Click button
- [ ] 3 bots appear with usernames
- [ ] All bots show 🤖 indicator

**CRITICAL: Verify No Duplicate Bots**
- [ ] Check logs: Only 1 game engine initialized
- [ ] GameScreen should use MULTIPLAYER engine (not local)
- [ ] Total players in game = 4 (not 7 or 8)
- [ ] No duplicate bot names ("Bot 1" twice, etc.)

**Game Session:**
- [ ] Exactly 4 players visible
- [ ] Bot usernames: "Bot 2", "Bot 3", "Bot 4" (or "Bot 1", "Bot 2", "Bot 3")
- [ ] 13 cards per player (52 total)
- [ ] Bots take turns correctly
- [ ] No double-bot-turns
- [ ] You can play against bots
- [ ] Game feels responsive

**Completion:**
- [ ] Game ends when you or a bot wins
- [ ] Scoreboard shows 1 human + 3 bots
- [ ] Stats updated for human only
- [ ] Return to home successful

#### Issues Found (Check for Dual-Engine Bug)
```
⚠️ If you see duplicate bots or 6-8 players, this is the critical bug!




```

**Status:** ✅ PASS / ❌ FAIL  
**Video:** _________________.mp4

---

### **Scenario 6: Private Room - 4 Humans Only**
**Mode:** Private | **Players:** 4H+0B | **Priority:** HIGH

#### Setup
1. [ ] Device 1: Home → "Create Room"
2. [ ] Note room code: _________________
3. [ ] Devices 2-4: Home → "Join Room" → Enter code
4. [ ] All 4 players in lobby

#### Expected Results
- [ ] Room created with 6-char code
- [ ] Code shareable (copy/share button)
- [ ] 3 other players join successfully
- [ ] Host starts game

#### Verification Steps
**Lobby:**
- [ ] Room code displayed prominently
- [ ] Copy button works
- [ ] 4 human players listed
- [ ] Host has crown 👑
- [ ] "Start Game" button (host only)
- [ ] No bot fill option (room full)

**Game Session:**
- [ ] All 4 navigate to GameScreen
- [ ] Multiplayer sync works
- [ ] Turn order correct
- [ ] Game completes successfully

#### Issues Found
```




```

**Status:** ✅ PASS / ❌ FAIL  
**Video:** _________________.mp4

---

### **Scenario 7: Private Room - 3 Humans + 1 Bot**
**Mode:** Private | **Players:** 3H+1B | **Priority:** CRITICAL

#### Setup
1. [ ] Create private room (host)
2. [ ] Share code to 2 friends (3 humans total)
3. [ ] Host: Click "Start with 1 AI Bot"

#### Expected Results
- [ ] 3 humans in lobby
- [ ] "Start with 1 AI Bot" button visible
- [ ] Bot added: "Bot 4"
- [ ] Game starts

#### Verification Steps
**Lobby:**
- [ ] Room code works for joining
- [ ] 3 humans visible
- [ ] 1 empty slot
- [ ] Host: "Start with 1 AI Bot" button
- [ ] Bot appears with username

**Game Session:**
- [ ] 3H + 1B (total 4)
- [ ] Bot username displayed
- [ ] Bot plays normally
- [ ] Game completes

#### Issues Found
```




```

**Status:** ✅ PASS / ❌ FAIL  
**Video:** _________________.mp4

---

### **Scenario 8: Private Room - 2 Humans + 2 Bots**
**Mode:** Private | **Players:** 2H+2B | **Priority:** CRITICAL

#### Setup
1. [ ] Create private room
2. [ ] Invite 1 friend (2 humans total)
3. [ ] Host: Click "Start with 2 AI Bots"

#### Expected Results
- [ ] 2 humans in lobby
- [ ] "Start with 2 AI Bots" button
- [ ] 2 bots added
- [ ] Game starts

#### Verification Steps
**Lobby:**
- [ ] 2 humans visible
- [ ] 2 empty slots
- [ ] Bot fill button appears
- [ ] 2 bots created with usernames

**Game Session:**
- [ ] 2H + 2B gameplay
- [ ] Both bots functional
- [ ] Game completes normally

#### Issues Found
```




```

**Status:** ✅ PASS / ❌ FAIL  
**Video:** _________________.mp4

---

### **Scenario 9: Private Room - 1 Human + 3 Bots (SOLO)**
**Mode:** Private | **Players:** 1H+3B | **Priority:** CRITICAL (Bug Fix Verification)

#### Setup
1. [ ] Create private room (solo)
2. [ ] Don't invite anyone
3. [ ] Host: Click "Start with 3 AI Bots"

#### Expected Results
- [ ] Solo player in lobby
- [ ] "Start with 3 AI Bots" button
- [ ] 3 bots added
- [ ] Game starts (same as Scenario 5)

#### Verification Steps
**Same as Scenario 5 - Check for:**
- [ ] No duplicate bots
- [ ] Exactly 4 players
- [ ] Bot usernames correct
- [ ] Multiplayer engine (not local)
- [ ] Game completes successfully

#### Issues Found
```




```

**Status:** ✅ PASS / ❌ FAIL  
**Video:** _________________.mp4

---

## 🔬 EDGE CASE TESTING

### Edge Case 1: Disconnect During Lobby (3H+1B)
**Setup:** 3 humans in lobby with 1 bot, one human disconnects

- [ ] Game continues with 2H+1B? OR
- [ ] Bot replaced with another bot? OR
- [ ] Game cancelled?

**Result:** _________________

---

### Edge Case 2: Bot Coordinator Leaves (2H+2B)
**Setup:** 2H+2B game in progress, bot coordinator (host) leaves

- [ ] Bots stop playing? OR
- [ ] New coordinator assigned? OR
- [ ] Game ends?

**Result:** _________________

---

### Edge Case 3: All Bots Pass (1H+3B)
**Setup:** Solo game, player plays unbeatable combo (straight flush)

- [ ] All 3 bots pass correctly?
- [ ] Player gets to lead again?
- [ ] Game logic correct?

**Result:** _________________

---

### Edge Case 4: Matchmaking Timeout (< 4 Players)
**Setup:** Start ranked matchmaking, wait 5+ minutes

- [ ] Timeout message shown?
- [ ] User returned to home?
- [ ] OR bot fill offered (casual only)?

**Result:** _________________

---

### Edge Case 5: Rapid Start Button Clicks
**Setup:** Host rapidly clicks "Start with Bots" multiple times

- [ ] Only 1 game starts (idempotency)?
- [ ] No duplicate bots created?
- [ ] No crashes?

**Result:** _________________

---

## 📊 SUMMARY

### Pass/Fail Matrix

| Scenario | Mode | Players | Status | Notes |
|----------|------|---------|--------|-------|
| 1 | Ranked | 4H+0B | ⬜ | |
| 2 | Casual | 4H+0B | ⬜ | |
| 3 | Casual | 3H+1B | ⬜ | |
| 4 | Casual | 2H+2B | ⬜ | |
| 5 | Casual | 1H+3B | ⬜ | ⚠️ Critical bug check |
| 6 | Private | 4H+0B | ⬜ | |
| 7 | Private | 3H+1B | ⬜ | |
| 8 | Private | 2H+2B | ⬜ | |
| 9 | Private | 1H+3B | ⬜ | ⚠️ Critical bug check |

**Legend:** ✅ Pass | ❌ Fail | ⚠️ Needs Review | ⬜ Not Tested

---

### Overall Assessment

**Total Scenarios:** 9  
**Passed:** _____ / 9  
**Failed:** _____ / 9  
**Success Rate:** _____ %

**Critical Bugs Found:**
```
1. 

2. 

3. 
```

**Deployment Recommendation:**
- [ ] ✅ **DEPLOY** - All scenarios pass
- [ ] ⚠️ **DEPLOY WITH CAVEATS** - Minor issues, non-blocking
- [ ] ❌ **DO NOT DEPLOY** - Critical bugs found

---

### Tester Sign-Off

**Name:** _________________  
**Date:** _________________  
**Signature:** _________________

**CEO Review:**
**Approved:** Yes / No  
**Comments:** _________________

---

## 📎 Appendix: Quick Command Reference

### Database Checks
```sql
-- Check bot usernames
SELECT id, room_id, username, player_index, is_bot 
FROM room_players 
WHERE is_bot = true 
ORDER BY room_id, player_index;

-- Check room flags
SELECT code, status, is_matchmaking, ranked_mode, fill_with_bots 
FROM rooms 
WHERE created_at > NOW() - INTERVAL '1 hour';

-- Count active games
SELECT status, COUNT(*) 
FROM rooms 
GROUP BY status;
```

### Log Monitoring
```bash
# Follow React Native logs
npx react-native log-android  # Android
npx react-native log-ios      # iOS

# Filter for game-related logs
grep -i "GameScreen\|LobbyScreen\|bot" metro.log
```

### Video Recording
- **iOS Simulator:** Cmd+R (record screen)
- **Android Emulator:** Screen Record button in toolbar
- **Physical Device:** Built-in screen recorder

---

**End of Checklist** ✅
