# Batch 3 - Manual Testing Checklist

**Branch:** `fix/app-improvements-batch-2`  
**Tester:** _______________  
**Date:** _______________

---

## 1. Mutual Friends List

- [ ] Navigate to another player's profile (StatsScreen)
- [ ] Tap "Mutual Friends" count
- [ ] **Verify:** Modal opens with correct friend names displayed (not empty)
- [ ] **Verify:** Tapping rapidly on "Mutual Friends" does NOT trigger multiple loads
- [ ] **Verify:** Modal works correctly in landscape orientation
- [ ] Close modal, reopen — verify it loads again correctly

## 2. Throwable Effects

- [ ] Start a game (offline or multiplayer)
- [ ] Throw an egg at another player
- [ ] **Verify:** Egg particles spread beyond the avatar circle (not clipped)
- [ ] **Verify:** Splat emoji is visibly larger (covers ~55% of avatar area)
- [ ] Throw smoke at another player
- [ ] **Verify:** Smoke particles are visibly larger and spread wider
- [ ] Trigger confetti effect
- [ ] **Verify:** Confetti particles spread wider and are larger
- [ ] Test throwables in landscape mode
- [ ] **Verify:** Effects render correctly on all player positions

## 3. Play Again Routing

### 3a. Private Room — Play Again
- [ ] Create a private room, play a full game to completion
- [ ] Tap "Play Again"
- [ ] **Verify:** Navigates to CreateRoom screen (NOT back to lobby)
- [ ] **Verify:** Can create a new room successfully from there

### 3b. Public Room — Play Again
- [ ] Play a public game to completion
- [ ] Tap "Play Again"
- [ ] **Verify:** Navigates to Lobby with public matchmaking mode

### 3c. Offline — Play Again
- [ ] Play an offline game to completion
- [ ] Tap "Play Again"
- [ ] **Verify:** Starts a new offline game directly

### 3d. Lobby — No Stale Code
- [ ] Join a room normally via lobby
- [ ] **Verify:** Room loads correctly (no playAgain param in URL)
- [ ] Get kicked from a room
- [ ] **Verify:** Shows kicked message and navigates to Home

## 4. ESLint / Code Quality (Automated)

- [x] ESLint: 0 warnings, 0 errors (verified)
- [x] TypeScript: Clean compilation (verified)
- [x] Jest: 80 suites, 1,359 tests pass (verified)
- [ ] CI pipeline passes all jobs

## 5. E2E Tests (Maestro)

- [ ] Run `05_join_room` flow — verify error assertion is NOT optional (should fail if error text missing)
- [ ] Run `06_offline_game` flow — verify it taps "Pass" button and takes screenshot
- [ ] Run `07_match_history` flow — verify it checks for "Rank" on Leaderboard and "Games Played" on Profile

## 6. Regression Checks

- [ ] Bot game plays normally (bot logic unchanged functionally — `_minOpponentCards` rename only)
- [ ] Room lobby join/leave works normally (`useRoomLobby` deps updated)
- [ ] Card selection and optimistic play works (`CardHand` dep fix)
- [ ] Game actions validate correctly in multiplayer (`useGameActions` dep fix)
- [ ] Throwable cooldowns work correctly between turns (`useThrowables` ref fix)

---

## Sign-off

| Area | Pass/Fail | Notes |
|------|-----------|-------|
| Mutual Friends | | |
| Throwables | | |
| Play Again | | |
| ESLint/CI | | |
| E2E Tests | | |
| Regressions | | |

**Overall:** ☐ PASS  ☐ FAIL

**Tester Signature:** _______________
