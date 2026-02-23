# 🧪 Testing Guide: Google Multi-Account Authentication Fix

**Date:** December 14, 2025  
**Purpose:** Verify the fix for Google authentication multi-account issue

---

## 📋 Prerequisites

- ✅ Expo development server running (`npm start` in `apps/mobile`)
- ✅ Expo Go app installed on your device OR iOS Simulator running
- ✅ **2+ different Google accounts** for testing

---

## 🧪 Test Scenarios

### Test 1: Sign Out & Clean Data ✅

**Objective:** Verify that signing out properly removes all room data

**Steps:**
1. Open the app
2. If already signed in, go to Profile screen
3. Tap **"Sign Out"**
4. Check console logs:
   ```
   🧹 [AuthContext] Cleaning up user data before sign-out
   ✅ [AuthContext] Successfully cleaned up all room data
   ✅ [AuthContext] Sign-out successful
   ```

**Expected Result:**
- ✅ User is signed out
- ✅ All `room_players` entries deleted
- ✅ No errors in console

---

### Test 2: Sign In with Account A ✅

**Objective:** Verify first account can sign in and join rooms normally

**Steps:**
1. Tap **"Sign in with Google"**
2. Choose **Google Account A** (e.g., youremail1@gmail.com)
3. Complete OAuth flow
4. Check console logs:
   ```
   🧹 [AuthContext] Cleaning up stale room memberships for user: abc123...
   ✅ [AuthContext] No stale rooms to clean up (or cleaned up X rooms)
   ```
5. Tap **"Quick Play"** or **"Create Room"**
6. Verify you can join/create room successfully

**Expected Result:**
- ✅ Sign-in successful
- ✅ Stale data cleaned up on login
- ✅ Can join/create rooms without errors
- ✅ Username auto-generated: `Player_abc12345` (or similar)

---

### Test 3: Force-Close App (Simulate Crash) ⚠️

**Objective:** Create stale data by force-closing without proper sign-out

**Steps:**
1. While in a room (lobby screen), **force-close the app**:
   - **iOS:** Swipe up from bottom, swipe app away
   - **Android:** Recent apps → Swipe app away
2. DO NOT tap "Sign Out" or "Leave Room"
3. **Important:** This leaves a `room_players` entry in the database

**Expected Result:**
- ✅ App closes (room_players entry remains in database - this is expected)

---

### Test 4: Re-Open App with Same Account ✅

**Objective:** Verify stale data cleanup on re-login

**Steps:**
1. Re-open the app
2. Sign in with **same Google Account A**
3. Check console logs:
   ```
   🧹 [AuthContext] Cleaning up stale room memberships for user: abc123...
   ⚠️ [AuthContext] Found 1 stale room(s): ABC123
   ✅ [AuthContext] Successfully cleaned up 1 stale room memberships
   ```
4. Try to join/create a room

**Expected Result:**
- ✅ Stale room membership cleaned up automatically
- ✅ Can join/create new rooms without errors
- ✅ No "username already taken" errors

---

### Test 5: Sign Out & Switch to Account B 🔥 CRITICAL TEST

**Objective:** Verify multi-account support (the main issue)

**Steps:**
1. Sign out from Account A properly:
   - Go to Profile screen
   - Tap **"Sign Out"**
   - Verify logs show cleanup:
     ```
     🧹 [AuthContext] Cleaning up user data before sign-out
     ✅ [AuthContext] Successfully cleaned up all room data
     ```

2. Sign in with **different Google Account B** (e.g., youremail2@gmail.com)
3. Complete OAuth flow
4. Check console logs for cleanup:
   ```
   🧹 [AuthContext] Cleaning up stale room memberships for user: xyz789...
   ✅ [AuthContext] No stale rooms found
   ```

5. Try to join/create a room

**Expected Result:**
- ✅ Sign-in with Account B successful
- ✅ NO "username already taken" errors
- ✅ NO game stops or crashes
- ✅ Can join/create rooms normally
- ✅ Username auto-generated: `Player_xyz67890` (different from Account A)

**🚨 THIS IS THE KEY TEST - Previously this would fail!**

---

### Test 6: Rapid Account Switching ⚡

**Objective:** Stress-test cleanup logic with multiple account switches

**Steps:**
1. Sign out from Account B
2. Sign in with Account A
3. Quick Play → Join a room
4. Sign out (proper)
5. Sign in with Account B
6. Quick Play → Join a room
7. Sign out (proper)
8. Sign in with Account A again
9. Quick Play → Join a room

**Expected Result:**
- ✅ All sign-ins successful
- ✅ No username conflicts at any step
- ✅ Each account can independently join rooms
- ✅ Console shows cleanup happening each time

---

## 📊 Success Criteria

### ✅ All Tests Pass If:
1. Multiple Google accounts can sign in without errors
2. Stale room data is cleaned up automatically on login
3. No "username already taken" errors
4. No app crashes or freezes
5. Console logs show proper cleanup messages
6. Users can switch accounts seamlessly

### ❌ Tests Fail If:
- Sign-in with second account stops/crashes the game
- "Username conflict" or "Username already taken" errors appear
- App freezes after sign-in
- Cannot join/create rooms with different accounts

---

## 🐛 Troubleshooting

### Issue: Still getting "username already taken" error

**Possible Cause:** Database still has stale entries from before the fix

**Solution:**
```sql
-- Run this in Supabase SQL Editor to manually clean up
DELETE FROM room_players WHERE room_id IN (
  SELECT id FROM rooms WHERE status IN ('waiting', 'finished')
);
```

### Issue: Console shows cleanup errors

**Example Error:**
```
❌ [AuthContext] Error cleaning up room data on sign-out: <error message>
```

**Solution:**
- Check Supabase connection (internet connection)
- Check RLS policies on `room_players` table
- Check if user has permission to delete their own entries

### Issue: App crashes on sign-in

**Solution:**
- Check console for specific error messages
- Verify Supabase credentials in `.env`
- Ensure `room_players` table exists in database

---

## 📝 Test Report Template

After running all tests, fill out this report:

```
GOOGLE MULTI-ACCOUNT AUTH FIX - TEST REPORT
Date: [DATE]
Tester: [YOUR NAME]
Device: [iPhone 15 / Android Pixel 7 / iOS Simulator]

Test 1: Sign Out & Clean Data       [ PASS / FAIL ]
Test 2: Sign In with Account A      [ PASS / FAIL ]
Test 3: Force-Close App              [ PASS / FAIL ]
Test 4: Re-Open with Same Account   [ PASS / FAIL ]
Test 5: Switch to Account B         [ PASS / FAIL ] 🔥 CRITICAL
Test 6: Rapid Account Switching     [ PASS / FAIL ]

ISSUES FOUND:
- [List any issues encountered]

CONSOLE LOGS:
- [Paste relevant error logs if any]

OVERALL RESULT: [ ✅ SUCCESS / ❌ NEEDS FIX ]
```

---

## 🎯 Next Steps

### If All Tests Pass ✅
1. Mark task as complete
2. Create PR with changes
3. Update documentation
4. Close the GitHub issue

### If Tests Fail ❌
1. Capture console logs
2. Note specific failure scenarios
3. Report back to Project Manager
4. Investigate database state

---

**Implementation Agent:** BU1.2-Efficient  
**Date:** December 14, 2025  
**Status:** 🧪 **READY FOR TESTING**
