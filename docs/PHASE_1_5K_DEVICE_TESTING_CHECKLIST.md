# Phase 1.5K Device Testing Checklist
## December 25, 2025

**Task:** Manual End-to-End Testing for Bot Coordinator System  
**Prerequisites:** Tasks 499, 500, 501 COMPLETE ✅  
**Required:** 2-3 physical devices + production database access  
**Estimated Time:** 2-3 hours

---

## 🎯 Test Environment Setup

### Requirements
- [ ] **Device 1:** iOS/Android (Tester 1)
- [ ] **Device 2:** iOS/Android (Tester 2)
- [ ] **Device 3:** iOS/Android (Tester 3) - Optional for 3+1 testing
- [ ] **Database:** Production (dppybucldqufbqhwnkxu)
- [ ] **App Build:** Latest dev branch build
- [ ] **Network:** All devices on stable WiFi

### Pre-Test Verification
```bash
# Verify database functions exist
supabase functions list

# Expected functions:
# - generate_room_code_v2
# - cleanup_abandoned_rooms
# - start_game_with_bots
# - replace_disconnected_with_bot
# - check_all_players_ready
```

---

## 🧪 Test Suite

### Test 1: 2 Humans + 2 Bots (Full Game)

#### Setup
- [x] Device 1: Create casual room (HOST)
- [x] Device 2: Join room via code
- [x] Total: 2 humans in lobby

#### Execution
1. [ ] **HOST clicks "Start with Bots"**
   - Expected: Game starts immediately (no ready required for casual)
   - Expected: 2 bots added (Bot_A, Bot_B)
   - Expected: Device 1 = coordinator

2. [ ] **Verify Initial State**
   - [ ] All 4 players visible (2 human, 2 bot)
   - [ ] Each player has 13 cards
   - [ ] 3 of Diamonds holder goes first
   - [ ] **Drag-and-drop works (Device 1 & 2)**

3. [ ] **Bot Turn Observation**
   - [ ] Bot moves automatically (no human input)
   - [ ] Both devices see same bot move simultaneously
   - [ ] Bot plays valid combos (Pair beats Pair, etc.)
   - [ ] Bot passes when appropriate
   - [ ] **Drag-and-drop STILL works after bot plays**

4. [ ] **Full Game Completion**
   - [ ] Game progresses to completion
   - [ ] Winner declared correctly
   - [ ] Stats updated in database
   - [ ] No crashes or freezes
   - [ ] **Drag-and-drop works until final card**

#### Acceptance Criteria
- ✅ Bot coordinator = Device 1 (first human)
- ✅ Bots make intelligent moves
- ✅ All clients synchronized (same game state)
- ✅ Game completes successfully
- ✅ Drag-and-drop NEVER breaks

---

### Test 2: 3 Humans + 1 Bot (Full Game)

#### Setup
- [ ] Device 1: Create casual room (HOST)
- [ ] Device 2: Join room
- [ ] Device 3: Join room
- [ ] Total: 3 humans in lobby

#### Execution
1. [ ] **HOST clicks "Start with Bots"**
   - Expected: 1 bot added
   - Expected: Device 1 = coordinator

2. [ ] **Play Full Game**
   - [ ] All 3 humans can play cards
   - [ ] Bot plays intelligently
   - [ ] Game completes successfully
   - [ ] **Drag-and-drop works on all 3 devices**

#### Acceptance Criteria
- ✅ Correct bot count (1 bot)
- ✅ All 3 humans can interact
- ✅ Bot behavior correct
- ✅ Drag-and-drop works on all devices

---

### Test 3: Ranked Mode Blocks Bots at Start

#### Setup
- [ ] Device 1: Create **RANKED** room
- [ ] Device 2: Join room
- [ ] Total: 2 humans in lobby

#### Execution
1. [ ] **HOST clicks "Start with Bots"** (button should be disabled or show error)
   - Expected: Error message shown
   - Expected: "Ranked games require 4 human players"
   - Expected: Room status = 'waiting' (unchanged)

#### Acceptance Criteria
- ✅ Error returned from RPC
- ✅ Room NOT started
- ✅ Clear error message to user

---

### Test 4: Ranked Bot Replacement (Disconnect Handling)

#### Setup
- [ ] Device 1: Create **RANKED** room
- [ ] Device 2: Join room
- [ ] Device 3: Join room
- [ ] Device 4: Join room (or use web browser)
- [ ] All 4 players ready
- [ ] Start ranked game

#### Execution
1. [ ] **Start Game**
   - Expected: No bots (4 humans)

2. [ ] **Disconnect Device 3** (turn off WiFi or close app)
   - Wait > 60 seconds

3. [ ] **Call replace_disconnected_with_bot RPC**
   ```sql
   SELECT * FROM replace_disconnected_with_bot(
     p_room_id := '<room_id>',
     p_player_index := 2,  -- Device 3's index
     p_disconnect_duration_seconds := 60
   );
   ```
   - Expected: Success response
   - Expected: Player 2 → Bot
   - Expected: Game continues

4. [ ] **Verify Bot Replacement**
   - [ ] Device 3's player is now a bot
   - [ ] Bot makes moves automatically
   - [ ] Remaining humans can still play
   - [ ] Game completes successfully

#### Acceptance Criteria
- ✅ Bot replaces disconnected player
- ✅ Game continues without interruption
- ✅ Bot plays intelligently
- ✅ Stats still tracked correctly

---

### Test 5: Drag-and-Drop in All Scenarios

#### Portrait Mode
- [ ] Device 1: Play game in portrait
- [ ] Drag cards from hand to play area
- [ ] Verify smooth drag feedback
- [ ] Verify cards snap to play area
- [ ] Verify selection clearing after play

#### Landscape Mode
- [ ] Device 1: Rotate to landscape
- [ ] Drag cards (wider screen)
- [ ] Verify layout adjusts correctly
- [ ] Verify drag still works

#### After Bot Plays
- [ ] Wait for bot to play
- [ ] Immediately drag human cards
- [ ] Verify no UI freezing
- [ ] Verify drag works smoothly

#### During Human Turn
- [ ] Select 2-3 cards
- [ ] Drag to play area
- [ ] Deselect
- [ ] Drag again
- [ ] Verify consistent behavior

#### Acceptance Criteria
- ✅ Drag works in portrait
- ✅ Drag works in landscape
- ✅ Drag works after bot plays
- ✅ Drag works during human turn
- ✅ No UI glitches or freezing

---

## 🐛 Known Issues to Watch For

### Issue 1: Bot Coordinator Race Condition
**Symptom:** Both Device 1 and Device 2 execute bot moves  
**Cause:** Bot coordinator not assigned correctly  
**Check:** Console logs show "Bot Coordinator: true" on only ONE device

### Issue 2: Drag-and-Drop Breaks After Bot Play
**Symptom:** Cannot select/drag cards after bot plays  
**Cause:** GameScreen state not updating correctly  
**Check:** Verify `useRealtime` subscription working

### Issue 3: Bots Play Invalid Combos
**Symptom:** Bot plays cards that don't beat last play  
**Cause:** BotAI logic error or combo classification wrong  
**Check:** Console logs show correct combo types

### Issue 4: Desynchronization
**Symptom:** Different game states on Device 1 vs Device 2  
**Cause:** Realtime subscription not firing  
**Check:** Verify room_id matches, check Supabase Realtime logs

---

## 📊 Test Results Template

### Test 1: 2H + 2B
- **Date:** ___________
- **Devices:** ___________
- **Result:** ✅ PASS / ❌ FAIL
- **Notes:** ___________

### Test 2: 3H + 1B
- **Date:** ___________
- **Devices:** ___________
- **Result:** ✅ PASS / ❌ FAIL
- **Notes:** ___________

### Test 3: Ranked Blocking
- **Date:** ___________
- **Result:** ✅ PASS / ❌ FAIL
- **Notes:** ___________

### Test 4: Ranked Replacement
- **Date:** ___________
- **Result:** ✅ PASS / ❌ FAIL
- **Notes:** ___________

### Test 5: Drag-and-Drop
- **Portrait:** ✅ PASS / ❌ FAIL
- **Landscape:** ✅ PASS / ❌ FAIL
- **After Bot:** ✅ PASS / ❌ FAIL
- **During Human:** ✅ PASS / ❌ FAIL

---

## ✅ Sign-Off

- [ ] All tests pass
- [ ] No critical bugs found
- [ ] Drag-and-drop verified working
- [ ] Ready to proceed to Phase 2

**Tester Name:** ___________  
**Date:** ___________  
**Signature:** ___________
