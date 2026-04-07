# Manual Test Guide — App Improvements Batch 2

## Pre-requisites
- Apply migration `20260716000000_mutual_friends_rpc.sql` to Supabase before testing Task 8
- Ensure the `profilePhotoSize` setting is accessible in Settings > Display

---

## Task 1: Fix Double Pass Popup
**What:** Prevent double error popup when tapping Pass while leading.

1. Join a multiplayer game (casual or private, 4 players with bots)
2. Wait for your turn when **you are leading** (no previous play on the table)
3. Tap the **Pass** button
4. **Expected:** A single error message appears: "Cannot pass when leading"
5. **Verify:** No duplicate popups or stacked alerts

---

## Task 2: Auto-Sort on Every Deal
**What:** Cards auto-sort after every new deal, not just the first.

1. Start an offline game (any difficulty)
2. Observe your hand is auto-sorted after the first deal
3. Play through the game until it ends and a new game starts (or the cards are re-dealt)
4. **Expected:** Your new hand is auto-sorted again
5. **Verify:** Works even if you manually reordered cards in the previous round

---

## Task 3: Fix Hint Helper for Leading
**What:** Hint button recommends valid plays when you're leading (not just first play of game).

1. Start a game (online or offline)
2. Play through the first trick (someone plays, others follow or pass)
3. When you win a trick and it's your turn to lead, tap the **Hint** button
4. **Expected:** A recommended play is highlighted (could be a single, pair, triple, straight, or full house)
5. **Verify:** The hint does NOT require 3 of diamonds (that's only for the very first play of the game)

---

## Task 4: Bot Leads with Strongest Combo
**What:** Bots now prefer playing multi-card combos when leading.

1. Start an offline game on **Hard** difficulty
2. Observe bot behavior when they are leading (no previous play on table)
3. **Expected:** Hard bots frequently play 5-card combos (straights, flushes, full houses) instead of just singles
4. **Secondary check:** Medium bots also play 5-card combos more often than before

---

## Task 5: Disable Swipe-Back Navigation
**What:** Swipe-back gesture is disabled in game screens.

1. Go to Matchmaking → Lobby → Game
2. Try swiping from the left edge of the screen to go back
3. **Expected:** Nothing happens — the swipe gesture is blocked on all three screens
4. **Verify:** The back button (if visible) still works

---

## Task 6: Room Closed Popup on Home Screen
**What:** When a room is closed, the player sees a popup with an option to join a casual lobby.

1. Join a multiplayer room as a non-host player
2. Have the host close/delete the room
3. **Expected:** You are navigated to the Home screen with an Alert that says:
   - Title: "Room Closed"
   - Message: "The room you were in has been closed by the host."
   - Buttons: "OK" (dismiss) and "Join Casual Lobby" (starts casual matchmaking)
4. Tap "Join Casual Lobby"
5. **Expected:** Casual matchmaking begins

---

## Task 7: Invite Friends Sort Order
**What:** Invite friends list sorts by online > favorites > alphabetical.

1. Go to a lobby where you can invite friends
2. Ensure you have at least one friend online and one offline, and at least one favorite
3. Open the invite friends modal
4. **Expected:** Friends are sorted:
   1. Online friends first (green dot / online indicator)
   2. Favorite friends next (among same online status)
   3. Alphabetical by username (among same online + favorite status)

---

## Task 8: Fix Mutual Friends Count
**What:** Mutual friends count now works correctly on other players' profiles.

**Pre-requisite:** Apply migration `20260716000000_mutual_friends_rpc.sql` to Supabase.

1. Log in as User A
2. Add User B and User C as friends (both accept)
3. Log in as User B, add User C as a friend (User C accepts)
4. Log in as User A, navigate to User B's profile/stats page
5. **Expected:** Mutual friends count shows **1** (User C)
6. Navigate to User C's profile/stats page
7. **Expected:** Mutual friends count shows **1** (User B)

---

## Task 9: Profile Photo Size in Game Room
**What:** In-game avatar respects the profile photo size preference.

1. Go to Settings > Display > Profile Photo Size
2. Set to **Small**
3. Start a game (online or offline)
4. **Expected:** Player avatars are noticeably smaller (~60px)
5. Go back to settings, set to **Large**
6. Return to the game
7. **Expected:** Player avatars are noticeably larger (~88px)
8. Set to **Medium** (default)
9. **Expected:** Avatars are the standard size (~70px)

---

## Task 10: Reanimated Crash Investigation
**What:** Documentation-only task. No direct user-facing changes.

1. See [REANIMATED_CRASH_ANALYSIS.md](apps/mobile/docs/REANIMATED_CRASH_ANALYSIS.md) for the analysis
2. **Smoke test:** Join a game with turn timer active, then leave abruptly mid-countdown
3. **Expected:** No crash (the `cancelAnimation` cleanup was already in place)

---

## Task 11: Reset Leaderboard and Stats
**What:** Migration resets all player stats and leaderboard.

**Pre-requisite:** This migration (`20260715000000_reset_all_player_stats.sql`) was created in batch 1. Ensure it has been applied.

1. After applying the migration, check the leaderboard
2. **Expected:** All players show 0 games played, 1000 rank points
3. Check any player's stats page
4. **Expected:** All stats are zeroed out

---

## CI/CD Checks Summary
| Check | Status |
|-------|--------|
| Lint, Type-Check, and Test | ✅ Pass |
| Build Check | ✅ Pass |
| Copilot Agent Review | ✅ Pass (0 comments) |
| E2E Tests (iOS Maestro) | Pending |
| E2E Tests (Android Maestro) | Pending |
