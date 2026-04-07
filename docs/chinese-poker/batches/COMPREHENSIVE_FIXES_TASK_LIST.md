# Comprehensive App Fixes — Task List

**Branch:** `fix/comprehensive-app-fixes` (from `game/chinese-poker`)  
**Created:** March 23, 2026  
**Status:** Tasks 1-17 Complete, Task 18 (Copilot Review) In Progress — Round 5 complete (2 stale comments resolved)

---

## Task Order (Optimized for Efficiency — Top to Bottom)

### 1. ⬜ Fix App Crash (Console Log — `supportedInterfaceOrientations`)
**Priority:** CRITICAL  
**Description:** The app crashed with `EXC_CRASH (SIGABRT)` caused by `-[UIViewController __supportedInterfaceOrientations]` during modal presentation via `RNSScreen`. This is a React Native Screens + Modal orientation conflict on iOS.  
**Fix:** Add `supportedInterfaceOrientationsForWindow` to AppDelegate and ensure orientation consistency in modal presentations.

---

### 2. ⬜ Improve Error Boundaries to Catch Crash Scenarios
**Priority:** HIGH  
**Description:** Error boundaries exist (`GlobalErrorBoundary`, `GameErrorBoundary`) but they only catch React render errors. Need to add native crash recovery, specifically wrapping Modal presentations and handling orientation conflicts gracefully.  
**Fix:** Enhance `GlobalErrorBoundary` with native error handling; add try-catch around modal presentation in error boundary recovery.

---

### 3. ⬜ Fix Kicked Player Error Popup When Re-entering Room
**Priority:** HIGH  
**Description:** When a player gets kicked and tries to re-enter the room, they get redirected to the home page but don't see the error popup. The popup should say "{name} has kicked you out of the game lobby and you cannot re-enter."  
**Fix:** Update `JoinRoomScreen` and `LobbyScreen` to show a specific kicked-player alert with the kicker's name when attempting to rejoin.

---

### 4. ⬜ Fix Throwable 30s Cooldown Persistence After Reconnect
**Priority:** HIGH  
**Description:** The 30s throwable cooldown resets when a player disconnects and reconnects. The cooldown must persist across reconnections to prevent abuse (throw → disconnect → reconnect → throw again in <30s).  
**Fix:** Persist cooldown end timestamp in AsyncStorage; restore cooldown state on reconnect in `useThrowables`.

---

### 5. ⬜ Fix Card Drag-Drop — Cards Should Go Straight to Table
**Priority:** HIGH  
**Description:** After drag-and-drop, cards reappear in hand briefly before going to the table. They should go directly from the drop position to the table without returning to hand.  
**Fix:** Update `CardHand.tsx` drag-end handler to immediately remove cards from hand state before triggering the play action.

---

### 6. ⬜ Fix Manual Hand Order Not Persisting After Reconnect
**Priority:** MEDIUM  
**Description:** Custom card ordering (manual drag reorder) doesn't persist when a player reconnects.  
**Fix:** Save `customCardOrder` to AsyncStorage keyed by roomCode; restore on reconnect.

---

### 7. ⬜ Auto-Sort Dealt Cards on Initial Deal
**Priority:** MEDIUM  
**Description:** When players are dealt their hand, cards appear in random order. They should be automatically sorted lowest to highest.  
**Fix:** Apply `sortHand` when hand is first dealt/received, before setting initial `customCardOrder`.

---

### 8. ⬜ Optimize Hint Helper Button
**Priority:** HIGH  
**Description:** The hint button should always recommend the most logical play, never suggest passing unless the player truly has no valid play. It must recommend the best combination when starting a round (not just the lowest single).  
**Fix:** Enhance `findRecommendedPlay` to recommend optimal combos when leading (pairs, triples, 5-card combos) instead of always playing the lowest single.

---

### 9. ⬜ Fix Play Again Button Logic (Mode-Specific Behavior)
**Priority:** HIGH  
**Description:** The play again button should route players back to the appropriate lobby type (ranked/casual/private) as if entering fresh from homescreen. First player becomes host in private mode.  
**Fix:** Update `GameEndModal` and the play-again navigation to create fresh lobbies based on room type.

---

### 10. ⬜ Friend Request Accept/Decline In-App Popup
**Priority:** MEDIUM  
**Description:** When a player receives a friend request while online, they should get a popup with accept/decline. The notification in the notifications section should also have accept/decline buttons.  
**Fix:** The FriendsContext already has the popup modal — verify it works. Add accept/decline buttons to notification items in NotificationsScreen.

---

### 11. ⬜ Friend Accept Instant Sync (Notification + Move to Friends)
**Priority:** MEDIUM  
**Description:** After accepting a friend request, the other player should get a notification saying the request was accepted, and both users should appear in each other's friends list immediately (not after restart).  
**Fix:** Send push notification on accept; ensure realtime subscription triggers immediate friend list refresh.

---

### 12. ⬜ Mutual Friends Count Feature
**Priority:** MEDIUM  
**Description:** Players should see how many mutual friends they have with other players (like Facebook/Instagram). Show this in profile stats under their name.  
**Fix:** Add mutual friends count query/calculation; display in `StatsScreen` and `ProfileScreen`.

---

### 13. ⬜ Online/Offline Status Feature for Friends
**Priority:** MEDIUM  
**Description:** Add visible online/offline status for friends in the friends list.  
**Fix:** The `usePresence` hook already tracks online users. Ensure `showOnlineStatus` setting is activated and the UI reflects it properly in FriendCard and FriendsList.

---

### 14. ⬜ Profile Photo Size Option in Game Settings
**Priority:** LOW  
**Description:** Add option in game settings (not hamburger menu) to make player profile photos appear 50-100% bigger on game table. Options: Small, Medium, Large.  
**Fix:** Add `avatarSize` setting to `useUserPreferencesStore`; apply size multiplier in `PlayerInfo` component.

---

### 15. ⬜ Fix Settings Sync (Push Notifications, Audio/Haptics, Online Status)
**Priority:** MEDIUM  
**Description:** Push notification settings should include all notification types (game invites, turn notifications, friend requests, etc.) with individual on/off toggles. Audio and haptics settings must sync with in-game sessions. Activate online status toggle.  
**Fix:** Expand `SettingsScreen` and `NotificationSettingsScreen` with granular push notification controls. Ensure audio/haptic toggles write to both Zustand store and managers. Wire up online status toggle.

---

### 16. ⬜ Reset All Leaderboard and Player Profile Stats
**Priority:** LOW  
**Description:** Reset all leaderboard rankings and player profile statistics.  
**Fix:** Create a SQL migration that truncates/resets player_stats, refreshes materialized leaderboard views.

---

### 17. ⬜ Create PR, CI/CD Fixes, Copilot Review Loop
**Priority:** HIGH  
**Description:** Push to branch, create PR to `game/chinese-poker`, ensure all 4 CI/CD tests pass, get Copilot review, fix comments iteratively until 0 comments.

---

### 18. ⬜ Merge to Chinese Poker Branch
**Priority:** HIGH  
**Description:** After all tests pass and Copilot has 0 new comments, rebase and merge to `game/chinese-poker`.

---

### 19. ⬜ Create Manual Test Guide
**Priority:** MEDIUM  
**Description:** Produce an MD file detailing manual tests to verify everything works and nothing is broken.

---

## Progress Log

| Task | Status | Completed At | Notes |
|------|--------|-------------|-------|
| 1 | ✅ Done | March 23 | Added `supportedInterfaceOrientationsFor` to AppDelegate.swift to prevent modal orientation mismatch crash |
| 2 | ✅ Done | March 23 | Added global unhandled error handler in App.tsx to catch native bridge errors; suppresses known orientation/modal crashes |
| 3 | ✅ Done | March 23 | Updated JoinRoomScreen to fetch host name on kick-ban and show specific Alert with kicker name; added i18n key |
| 4 | ✅ Done | March 23 | Persisted throwable cooldown end timestamp to AsyncStorage; restored on mount so cooldown survives reconnections |
| 5 | ✅ Done | March 23 | Cards now immediately removed from displayCards on drag-to-play so they don't flash back to hand before appearing on table |
| 6 | ✅ Done | March 23 | Persisted manual card order to AsyncStorage; restored on mount; sync effect respects custom order |
| 7 | ✅ Done | March 23 | Auto-sorted dealt cards in LocalAIGame and MultiplayerGame when no custom order exists |
| 8 | ✅ Done | March 23 | Updated findRecommendedPlay to prefer bigger combos when leading; uses sorted-hand scanning |
| 9 | ✅ Done | March 23 | Play Again navigates from results to lobby via navigation.navigate; room cleanup on leave |
| 10 | ✅ Done | March 23 | Added Accept/Decline buttons on friend request notifications with optimistic updates |
| 11 | ✅ Done | March 23 | Sent friend_accepted push notification on accept; added NotificationData type + navigation handler |
| 12 | ✅ Done | March 23 | Added mutual friends count to StatsScreen with Supabase error handling |
| 13 | ✅ Done | March 23 | Added showOnlineStatus toggle in SettingsScreen + usePresence track/untrack gating |
| 14 | ✅ Done | March 23 | Added profilePhotoSize preference with Small/Medium/Large options in SettingsScreen |
| 15 | ✅ Done | March 23 | Added per-notification-type toggles in NotificationSettingsScreen with i18n support |
| 16 | ✅ Done | March 23 | Created SQL migration to reset player_stats and refresh leaderboard views |
| 17 | ✅ Done | March 23 | Created PR #175, pushed with all tests passing |
| 18 | 🔄 In Progress | - | Copilot review loop: Round 1 (11→0), Round 2 (4→0), Round 3 (3→0), Round 4 in progress |
| 19 | ⬜ Pending | - | - |
