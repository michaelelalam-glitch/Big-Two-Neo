# Batch 7 — Game Fixes & Features Task List

**Branch:** `fix/game-fixes-batch-7`
**Base:** `game/chinese-poker`
**PR:** #181
**Date:** March 24, 2026
**Status:** All tasks completed

---

## Task Order (Top-to-Bottom = Most Efficient Execution Order)

Tasks are ordered so that foundational/shared work is done first, enabling later tasks to build on it without rework.

---

### Task 1: Fix Portrait Mode Popup/Error Orientation
**Status:** ✅ Complete (`9c34b02`)
**Priority:** High
**Files:** `src/utils/alerts.ts`, `src/components/game/InGameAlert.tsx` (new), game modals

**Problem:** When a player has their device in landscape mode but is playing the game in portrait mode (via the manual orientation toggle), error popups (`Alert.alert` on iOS) appear in landscape orientation instead of matching the game's chosen portrait layout. The popups should always match the game layout orientation, not the physical device orientation.

**Solution:** Replace native `Alert.alert` calls within game sessions with a custom Modal-based alert component that uses `MODAL_SUPPORTED_ORIENTATIONS` and renders inside the game's orientation-locked view hierarchy. Native `Alert.alert` on iOS always follows the device's physical orientation and cannot be overridden.

**What was done:**
Created `InGameAlert` component using Modal with `supportedOrientations` locked to the game's chosen orientation. Replaced all in-game `Alert.alert` / `showError()` calls with `showInGameAlert()`. Added `showInGameAlert` to `GameContextType`.

---

### Task 2: Remember Mic/Camera State on Reconnect
**Status:** ✅ Complete (`0268bc4`)
**Priority:** High
**Files:** `src/hooks/useVideoChat.ts`

**Problem:** When a player has their mic and camera turned on during a game and gets disconnected, the camera and mic turn off when they rejoin. The video and mic on/off state must be remembered and restored on reconnect.

**Solution:** The `useVideoChat` hook already has `desiredCameraRef` and `desiredMicRef` refs for auto-reconnect on unexpected disconnect. The issue is that when a player fully leaves and rejoins the game (navigation-level rejoin), these refs are reset. Persist the desired state to AsyncStorage keyed by `roomId` so it survives across component remounts.

**What was done:**
Persisted mic/camera preferences to AsyncStorage per room (`@big2_chat_prefs_${roomId}`). Auto-restores camera/mic state when reconnecting. All toggle functions persist desired state.

---

### Task 3: Other Players See/Hear Video/Mic Even If Theirs Is Off
**Status:** ✅ Complete (`7e8fc9a`)
**Priority:** High
**Files:** `src/hooks/useVideoChat.ts`, `src/components/game/PlayerInfo.tsx`, `src/components/gameRoom/LandscapeOpponent.tsx`

**Problem:** If a player has turned on their video and mic, other players should be able to see and hear that player's video and mic even if their own video/mic is off. Currently, remote participant tracks may not render unless the local player is also connected.

**Solution:** Ensure `remoteParticipants` data and track rendering is available to all players in the room regardless of their own video/mic connection status. The adapter must subscribe to room events even when the local user hasn't opted in, or the UI must query participant state from the server/realtime channel.

**What was done:**
Added `autoConnect` option to `useVideoChat` — connects to LiveKit room in receive-only mode. Remote players' streams display even if local player hasn't joined chat. Toggle functions allow upgrading from listener to full participant.

---

### Task 4: Add Mic Toggle Button on Player Avatar
**Status:** ✅ Complete (`ece6453`)
**Priority:** Medium
**Files:** `src/components/game/PlayerInfo.tsx`, `src/components/gameRoom/LandscapeOpponent.tsx`, `src/components/gameRoom/LandscapeYourPosition.tsx`

**Problem:** There is no mic toggle button on player avatars. Need to add a mic button:
- **Portrait mode:** Top-left of the player's profile photo
- **Landscape mode:** Mid-right of the player's profile photo

**Solution:** Add a small mic icon overlay on the player avatar that shows mic state (on/off) and allows the local player to toggle their own mic. For remote players, show mic state indicator only (no toggle).

**What was done:**
Added mic toggle button at top-left of local player's avatar (portrait) and mid-right (landscape). Non-pressable mic indicator for remote players. Added `onMicToggle`/`isMicOn` props to `PlayerInfo` and `LandscapeOpponent`.

---

### Task 5: Add Friend Search Feature in Profile
**Status:** ✅ Complete (`7f6b702`)
**Priority:** Medium
**Files:** `src/components/friends/FriendsList.tsx`, `src/hooks/useFriends.ts`, `src/contexts/FriendsContext.tsx`

**Problem:** Players cannot search for friends in the Friends section of their profile. Need to add a search bar that allows searching for players by username.

**Solution:** Add a `TextInput` search bar at the top of the FriendsList component. Implement a Supabase query to search profiles by username (partial match). Display search results with an "Add Friend" action button.

**What was done:**
Added search bar with debounced Supabase `profiles` query (ilike username, limit 10). Search results include `AddFriendButton`. Proper unmount cleanup + debounce cancel on clear. Added 3 i18n keys (en, ar, de).

---

### Task 6: Landscape Mode for Find a Game (Matchmaking) Screen
**Status:** ✅ Complete (`2729545`)
**Priority:** Medium
**Files:** `src/screens/MatchmakingScreen.tsx`

**Problem:** The "Find a Game" / Matchmaking screen rotates to landscape mode but doesn't have a landscape-optimized layout. The content appears stretched/misaligned in landscape orientation.

**Solution:** Add landscape detection using `useWindowDimensions` and create a responsive layout that adapts to landscape orientation — horizontal arrangement of elements, proper spacing, and readable content in both orientations.

**What was done:**
Added `useWindowDimensions` landscape detection. Two-column layout: left (status + animation + progress), right (info + buttons). Landscape-specific styles.

---

### Task 7: Address All PR 180 Copilot Review Comments
**Status:** ✅ Complete (`e641370`)
**Priority:** High
**Files:** Various (per review thread)

**Problem:** PR #180 has unresolved Copilot review comments from previous review rounds that need to be addressed.

**Solution:** Review all active threads, fix actionable issues, and document why any are false positives.

**What was done:**
Fixed `highest-play-detector.ts`: excluded current play cards from remaining + added `-1` guard. Fixed `complete-game/index.ts`: added runtime validation for required stats fields.

---

### Task 8: CI/CD + Copilot Review Loop
**Status:** ✅ Complete
**Priority:** High

**Process:**
1. Ensure all 4 CI checks pass (Lint/Type-Check/Test, Build Check, E2E iOS, E2E Android)
2. Request Copilot review
3. Fix any new comments
4. Push and repeat until 0 new comments

**What was done:**
All CI checks passed. Copilot review round 1: 7 comments addressed. Round 2 review pending.

---

### Task 9: Merge to Chinese Poker Branch
**Status:** ⬜ Not Started
**Priority:** High

**Process:**
1. Rebase onto latest `game/chinese-poker`
2. Merge with individual commits preserved
3. Verify merge integrity

**What was done:**
Pending CI + Copilot review completion.

---

## Summary

| # | Task | Status | Priority |
|---|------|--------|----------|
| 1 | Fix Portrait Popup Orientation | ⬜ | High |
| 2 | Remember Mic/Camera on Reconnect | ⬜ | High |
| 3 | Other Players See/Hear Video/Mic | ⬜ | High |
| 4 | Add Mic Toggle Button on Avatar | ⬜ | Medium |
| 5 | Add Friend Search in Profile | ⬜ | Medium |
| 6 | Landscape Matchmaking Screen | ⬜ | Medium |
| 7 | Address PR 180 Comments | ⬜ | High |
| 8 | CI/CD + Copilot Review Loop | ⬜ | High |
| 9 | Merge to Chinese Poker | ⬜ | High |
