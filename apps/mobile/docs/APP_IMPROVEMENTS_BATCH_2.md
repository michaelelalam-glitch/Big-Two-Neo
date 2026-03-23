# App Improvements — Batch 2

**Branch:** `fix/app-improvements-batch-2`  
**Base:** `game/chinese-poker`  
**Date:** July 2025

---

## Task List

| # | Status | Task | Files Changed |
|---|--------|------|---------------|
| 1 | ⬜ | Fix double pass popup when leading | `useGameActions.ts` |
| 2 | ⬜ | Auto-sort dealt cards on every new deal | `MultiplayerGame.tsx`, `LocalAIGame.tsx` |
| 3 | ⬜ | Fix hint helper — recommend plays when leading (not 1st round) | `MultiplayerGame.tsx`, `game-logic.ts` |
| 4 | ⬜ | AutoPlay strongest combo when bot is leading | `bot/index.ts` |
| 5 | ⬜ | Disable swipe-back navigation in game lobbies | `AppNavigator.tsx` |
| 6 | ⬜ | Room closed popup on homescreen with casual lobby option | `MultiplayerGame.tsx`, `HomeScreen.tsx`, `i18n/index.ts` |
| 7 | ⬜ | Invite friends sort: online → favorites → offline | `LobbyScreen.tsx` |
| 8 | ⬜ | Fix mutual friends count (RLS blocks cross-user query) | Migration SQL, `StatsScreen.tsx` |
| 9 | ⬜ | Fix profile photo size not applying in game room | `PlayerInfo.tsx`, `constants/index.ts` |
| 10 | ⬜ | Investigate Reanimated ShadowTreeCloner crash | `docs/REANIMATED_CRASH_ANALYSIS.md` |
| 11 | ⬜ | Reset all leaderboard and player stats | Migration SQL |

---

## Task Details

### Task 1: Fix Double Pass Popup When Leading
**Problem:** Player gets 2 error popups when trying to pass while leading.  
**Root Cause:** `multiplayerPass()` in `useRealtime.ts` both calls `onError(error)` (→ MultiplayerGame.tsx showError) AND re-throws the error (→ useGameActions catch → showError). Two popups.  
**Fix:** Add client-side pass validation in `useGameActions.ts` — check `getMultiplayerValidationState().lastPlay === null` before calling server. If leading, show one error and return early.

### Task 2: Auto-Sort Dealt Cards on Every New Deal
**Problem:** Cards are only auto-sorted on the very first deal. Subsequent deals (match 2+) keep the old custom order.  
**Root Cause:** `hasAutoSortedRef` is reset when hand goes to 0, but `customCardOrder` still has entries from previous match, so `customCardOrder.length === 0` check fails.  
**Fix:** Detect new deal by tracking previous hand card IDs. When hand cards completely change (new set of 13), clear customCardOrder and re-sort.

### Task 3: Fix Hint Helper for Leading
**Problem:** Hint button recommends nothing/pass when leading a trick (not first round of first match).  
**Root Cause:** `isFirstPlay: multiplayerLastPlay === null` in MultiplayerGame.tsx makes the hint think it's the first play of the game (needs 3D) every time the player is leading. Should use `game_phase === 'first_play'`.  
**Fix:** Change `isFirstPlay` to check `multiplayerGameState?.game_phase === 'first_play'` in both MultiplayerGame.tsx. Also enhance `findRecommendedPlay` leading branch to include full house detection.

### Task 4: AutoPlay Strongest Combo When Bot is Leading
**Problem:** Bot leads with lowest single even on hard difficulty when it should play strongest combo.  
**Root Cause:** The `handleLeading` method in hard mode tries triples/pairs but doesn't consider full houses or four-of-a-kind combos. On medium, 85% of the time it leads with lowest single.  
**Fix:** Enhance hard-mode leading to prefer full houses and four-of-a-kind + kicker when leading. Add full house detection to the leading strategy.

### Task 5: Disable Swipe-Back Navigation in Game Lobbies
**Problem:** Players accidentally swipe back out of game lobbies on iOS.  
**Fix:** Add `gestureEnabled: false` to Lobby, Game, and Matchmaking screens in AppNavigator.tsx.

### Task 6: Room Closed Popup on Homescreen
**Problem:** When room closes while player is away, they're silently redirected to Home. Should show informative popup with option to join casual lobby.  
**Fix:** Pass navigation params `{ roomClosed: true }` when navigating to Home. On HomeScreen, check params and show Alert with "Join Casual Lobby" option.

### Task 7: Invite Friends Sort — Online → Favorites → Offline
**Problem:** Invite friends list in lobby has no ordering by status.  
**Fix:** Sort `invitableFriends` by: online status first, then favorites, then alphabetical. Use `onlineUserIds` from presence context.

### Task 8: Fix Mutual Friends Count (RLS Issue)
**Problem:** Mutual friends always shows 0 because RLS policy on `friendships` table only allows users to see their own rows. Querying another user's friendships returns empty.  
**Fix:** Create a SECURITY DEFINER RPC function `get_mutual_friends_count(p_user_id uuid)` that counts mutual friends server-side. Update StatsScreen to use the RPC instead of direct query.

### Task 9: Fix Profile Photo Size Not Applying in Game Room
**Problem:** The `profilePhotoSize` preference exists in settings but doesn't affect the `PlayerInfo` component in-game. Avatar is always `LAYOUT.avatarSize` (70px).  
**Fix:** Read `profilePhotoSize` from `useUserPreferencesStore` in `PlayerInfo`. Apply size multiplier: small=0.85, medium=1.0 (default), large=1.25. Scale avatar container, border radius, and icon size accordingly.

### Task 10: Investigate Reanimated Crash
**Problem:** EXC_BAD_ACCESS (SIGSEGV) crash in `folly::dynamic::type()` called from `reanimated::cloneShadowTreeWithNewPropsRecursive` with 15 levels of recursion.  
**Analysis:** Known Reanimated issue with deep shadow tree cloning. Document findings and mitigation strategies.

### Task 11: Reset All Leaderboard and Player Stats
**Problem:** Need to reset all stats as if accounts were freshly created.  
**Fix:** The migration already exists at `20260715000000_reset_all_player_stats.sql`. Verify completeness and ensure game_history is also cleared.

---

## Progress Log

_Updates will be added as tasks are completed._
