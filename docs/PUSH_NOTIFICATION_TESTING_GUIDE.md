# Push Notification Testing Guide - Android Device

## 📱 Installation Instructions

### Step 1: Install the App on Your Android Phone

**Option A: Scan QR Code (Easiest)**
1. Open the QR code scanner on your Android phone
2. Scan this QR code:
   ```
   ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
   █ ▄▄▄▄▄ █▄▀ ▀ ▀▄█▀ █▄██▀ ▀▄██▄█ ▄▄▄▄▄ █
   █ █   █ █   █▀ ██ ▀▀▄ █▀▀   ▀██ █   █ █
   █ █▄▄▄█ █▄█▀ ▄  ▄██▄   ███ ▄▄▄█ █▄▄▄█ █
   █▄▄▄▄▄▄▄█▄█ █ █▄▀ ▀▄█ █ █▄█▄█▄█▄▄▄▄▄▄▄█
   ```
3. Follow the link to download and install

**Option B: Direct Link**
1. Open this URL on your Android phone:
   `https://expo.dev/accounts/big2admin/projects/big2-mobile/builds/ba1588c2-4958-4055-a796-c8a6a0b5da94`
2. Tap "Download" and install the APK
3. If prompted, allow installation from unknown sources

### Step 2: Launch the App
1. Open "Big2 Mobile" from your app drawer
2. Sign in with your account
3. The app will automatically request notification permissions
4. **IMPORTANT:** Tap "Allow" when the permission dialog appears

---

## 🧪 Test Scenarios

### Test 1: Notification Permission & Token Registration
**Goal:** Verify that the app can request permissions and register a push token

**Steps:**
1. Launch the app for the first time
2. Sign in with your account
3. When the notification permission dialog appears, tap "Allow"
4. Check the app logs to verify token registration

**Expected Results:**
- ✅ Permission dialog appears
- ✅ Push token is successfully generated
- ✅ Token is saved to the `push_tokens` table in Supabase
- ✅ Log shows: "Expo Push Token: ExponentPushToken[...]"

**How to Verify:**
- Go to Supabase Dashboard → `push_tokens` table
- Your user_id should have a new row with:
  - `push_token`: ExponentPushToken[...]
  - `platform`: "android"
  - `updated_at`: current timestamp

---

### Test 2: Game Started Notification
**Goal:** Verify notification when a game begins

**Setup:**
1. Create a room with 4 players (you + 3 bots)
2. Start the game

**Expected Notification:**
- **Title:** 🎮 Game Starting!
- **Body:** "Your game in room [ROOM_CODE] is beginning. Good luck!"
- **Sound:** Default notification sound
- **Badge:** +1

**Actions to Test:**
1. ✅ App in foreground → Notification banner appears at top
2. ✅ App in background → Notification appears in notification tray
3. ✅ App closed → Notification appears in notification tray
4. ✅ Tap notification → App opens to Game screen

---

### Test 3: Your Turn Notification
**Goal:** Verify notification when it's your turn to play

**Setup:**
1. Start a game with at least 1 other player
2. Wait for another player to make a move
3. Your turn should trigger a notification

**Expected Notification:**
- **Title:** ⏰ Your Turn!
- **Body:** "It's your turn to play in room [ROOM_CODE]"
- **Channel:** Turn Notifications (High priority)
- **Sound:** Default sound
- **Vibration:** Short pattern
- **Badge:** +1

**Actions to Test:**
1. ✅ Notification arrives within 2-3 seconds of turn change
2. ✅ Tapping opens Game screen with correct room
3. ✅ Badge count increases

---

### Test 4: Game Ended Notification (Winner)
**Goal:** Verify notification when you win a game

**Setup:**
1. Play a game until you win

**Expected Notification:**
- **Title:** 🎉 Victory!
- **Body:** "Congratulations! You won in room [ROOM_CODE]!"
- **Data:** `is_winner: true`
- **Sound:** Default sound

**Actions to Test:**
1. ✅ Notification appears immediately after winning
2. ✅ Tapping opens Game screen showing victory state

---

### Test 5: Game Ended Notification (Other Players)
**Goal:** Verify notification when another player wins

**Setup:**
1. Play a game and let another player win

**Expected Notification:**
- **Title:** 🏁 Game Over
- **Body:** "[WINNER_NAME] won the game in room [ROOM_CODE]"
- **Data:** `is_winner: false`

**Actions to Test:**
1. ✅ Notification appears when game ends
2. ✅ Shows correct winner name

---

### Test 6: Room Invite Notification
**Goal:** Verify notification when invited to a room

**Setup:**
1. Have another user invite you to their room
2. Or use the Supabase Edge Function directly to send test invite

**Expected Notification:**
- **Title:** 🎴 Room Invite
- **Body:** "[INVITER_NAME] invited you to join room [ROOM_CODE]"
- **Deep Link:** Opens JoinRoom screen with roomCode

**Actions to Test:**
1. ✅ Notification arrives
2. ✅ Tapping opens JoinRoom screen
3. ✅ Room code is pre-filled

---

### Test 7: Player Joined Notification
**Goal:** Verify notification when someone joins your room

**Setup:**
1. Create a room
2. Have another player join

**Expected Notification:**
- **Title:** 👋 Player Joined
- **Body:** "[PLAYER_NAME] joined room [ROOM_CODE]"

**Actions to Test:**
1. ✅ Notification appears when player joins
2. ✅ You (host) do NOT receive notification for your own join

---

### Test 8: Auto-Pass Timer Warning
**Goal:** Verify notification before auto-pass triggers

**Setup:**
1. Start a game
2. Wait for your turn
3. Do not play for ~25 seconds

**Expected Notification:**
- **Title:** ⚠️ Time Running Out!
- **Body:** "[X]s left to play in room [ROOM_CODE]"
- **Trigger:** 5 seconds before auto-pass

**Actions to Test:**
1. ✅ Notification appears 5 seconds before timeout
2. ✅ Tapping opens Game screen

---

### Test 9: All Players Ready Notification (Host Only)
**Goal:** Verify notification when all players mark themselves ready

**Setup:**
1. Create a room (you are host)
2. Have all players mark ready

**Expected Notification:**
- **Title:** ✅ Ready to Start
- **Body:** "All players are ready in room [ROOM_CODE]. You can start the game!"
- **Recipient:** Host only

**Actions to Test:**
1. ✅ Only host receives this notification
2. ✅ Other players do NOT receive it

---

## 🔍 Advanced Testing

### Test 10: Android Notification Channels
**Goal:** Verify that Android channels are properly configured

**Steps:**
1. Open Android Settings → Apps → Big2 Mobile → Notifications
2. Verify these channels exist:
   - **Default** (MAX importance)
   - **Game Updates** (HIGH importance, red light)
   - **Turn Notifications** (HIGH importance, teal light)
   - **Social** (HIGH importance, light teal)

**Actions to Test:**
1. ✅ All 4 channels are visible
2. ✅ Each has correct importance level
3. ✅ Disable "Turn Notifications" → no turn notifications appear
4. ✅ Re-enable channel → notifications work again

---

### Test 11: Badge Count Management
**Goal:** Verify badge count increments and clears correctly

**Steps:**
1. Close the app completely
2. Trigger 3 "Your Turn" notifications
3. Check app icon badge count (should show "3")
4. Open the app
5. Badge should clear to "0"

**Actions to Test:**
1. ✅ Badge increments with each notification
2. ✅ Badge clears when app is opened

---

### Test 12: Foreground vs Background Behavior
**Goal:** Verify different behaviors based on app state

**Test Matrix:**
| Scenario | Expected Behavior |
|----------|-------------------|
| **App in foreground** | Banner appears at top, sound plays |
| **App in background** | Notification in tray, sound plays |
| **App closed** | Notification in tray, sound plays, deep link works |

---

### Test 13: Multiple Notifications
**Goal:** Test notification stacking/grouping

**Steps:**
1. Close the app
2. Trigger 5+ notifications quickly
3. Check notification tray

**Expected Results:**
- ✅ Notifications stack/group properly
- ✅ Each notification is individually tappable
- ✅ No crashes or performance issues

---

### Test 14: Network Conditions
**Goal:** Verify notifications work in poor network conditions

**Steps:**
1. Enable "Airplane Mode" for 30 seconds
2. Trigger a notification from backend
3. Disable "Airplane Mode"
4. Wait for network reconnection

**Expected Results:**
- ✅ Notification eventually arrives (FCM retries)
- ✅ Deep link still works
- ✅ No duplicate notifications

---

## 🐛 Common Issues & Troubleshooting

### Issue 1: Notifications Not Appearing
**Possible Causes:**
- Permissions not granted
- Push token not registered in Supabase
- Battery optimization killing background process
- Do Not Disturb mode enabled

**Solutions:**
1. Check Settings → Apps → Big2 Mobile → Permissions → Notifications
2. Verify `push_tokens` table has your token
3. Disable battery optimization for Big2 Mobile
4. Check Do Not Disturb settings

---

### Issue 2: Deep Linking Not Working
**Possible Causes:**
- Incorrect `data` payload in notification
- Navigation not properly set up
- App killed by system before deep link processed

**Solutions:**
1. Check notification logs for `data` field
2. Verify `handleNotificationData()` function
3. Test with app in background (not fully closed)

---

### Issue 3: Sounds Not Playing
**Possible Causes:**
- Phone on silent mode
- Notification channel muted
- Sound file not found

**Solutions:**
1. Check phone volume settings
2. Settings → Apps → Notifications → Check channel sound
3. Verify `sound: 'default'` in notification payload

---

### Issue 4: Badge Not Updating
**Possible Causes:**
- Launcher doesn't support badges
- Badge permission not granted
- `setBadgeCountAsync()` not called

**Solutions:**
1. Use a launcher that supports badges (most modern launchers do)
2. Check notification permissions include badge
3. Verify `shouldSetBadge: true` in handler

---

## 📊 Testing Checklist

### Initial Setup
- [ ] App installed on physical Android device
- [ ] Notification permissions granted
- [ ] Push token registered in Supabase
- [ ] All Android channels created

### Core Functionality
- [ ] Game Started notifications work
- [ ] Your Turn notifications work
- [ ] Game Ended notifications work (winner & loser)
- [ ] Room Invite notifications work
- [ ] Player Joined notifications work
- [ ] Auto-Pass Timer warnings work
- [ ] All Players Ready works (host only)

### App States
- [ ] Notifications work when app is in foreground
- [ ] Notifications work when app is in background
- [ ] Notifications work when app is closed
- [ ] Deep linking works from all app states

### Android-Specific
- [ ] All notification channels visible in Settings
- [ ] Channel-specific sounds/vibrations work
- [ ] Badge count increments correctly
- [ ] Badge clears when app opens
- [ ] Notification grouping works for multiple notifications

### Edge Cases
- [ ] Works with poor network connection
- [ ] No duplicate notifications
- [ ] No crashes when receiving multiple notifications
- [ ] Permissions can be revoked and re-granted
- [ ] Works after phone restart

---

## 🎯 Success Criteria

✅ **All 8 notification types deliver successfully**
✅ **Deep linking navigates to correct screens**
✅ **Badges update correctly**
✅ **Android channels work properly**
✅ **No crashes or errors**

---

## 📝 Test Execution Log

Use this template to record your test results:

```
Date: ______________
Tester: ______________
Device: ______________
Android Version: ______________

| Test # | Test Name | Status | Notes |
|--------|-----------|--------|-------|
| 1 | Token Registration | ⬜ Pass / ⬜ Fail | |
| 2 | Game Started | ⬜ Pass / ⬜ Fail | |
| 3 | Your Turn | ⬜ Pass / ⬜ Fail | |
| 4 | Game Ended (Winner) | ⬜ Pass / ⬜ Fail | |
| 5 | Game Ended (Others) | ⬜ Pass / ⬜ Fail | |
| 6 | Room Invite | ⬜ Pass / ⬜ Fail | |
| 7 | Player Joined | ⬜ Pass / ⬜ Fail | |
| 8 | Auto-Pass Warning | ⬜ Pass / ⬜ Fail | |
| 9 | All Players Ready | ⬜ Pass / ⬜ Fail | |
| 10 | Android Channels | ⬜ Pass / ⬜ Fail | |
| 11 | Badge Count | ⬜ Pass / ⬜ Fail | |
| 12 | App States | ⬜ Pass / ⬜ Fail | |
| 13 | Multiple Notifications | ⬜ Pass / ⬜ Fail | |
| 14 | Network Conditions | ⬜ Pass / ⬜ Fail | |
```

---

## 🚀 Next Steps After Testing

Once testing is complete:

1. **Document Results:** Fill out the test execution log above
2. **Report Issues:** Create GitHub issues for any failures
3. **Update Code:** Fix any bugs discovered during testing
4. **Re-test:** Verify fixes work on device
5. **Production:** Proceed with Task #315 (Firebase/APNs credentials)

---

## 📞 Need Help?

If you encounter issues:
1. Check the troubleshooting section above
2. Review Supabase logs for Edge Function errors
3. Check device logs: `adb logcat | grep Expo`
4. Ask the team for assistance

---

**Build Information:**
- Build ID: `ba1588c2-4958-4055-a796-c8a6a0b5da94`
- Build Link: https://expo.dev/accounts/big2admin/projects/big2-mobile/builds/ba1588c2-4958-4055-a796-c8a6a0b5da94
- Profile: Development
- Platform: Android
