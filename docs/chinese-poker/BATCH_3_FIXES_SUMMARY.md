# Batch 3 Fixes Summary

**Branch:** `fix/app-improvements-batch-3`  
**PR:** #178 → `game/chinese-poker`  
**Date:** March 23-24, 2026

---

## Changes Overview

### 1. Mutual Friends List Fix
**Files:** `StatsScreen.tsx`, `database.types.ts`

- **Problem:** Mutual friends list showed no names — `supabase.rpc('get_mutual_friends_list')` was cast with `as any` because the RPC type was missing from generated types, and the data was cast manually.
- **Fix:**
  - Added `get_mutual_friends_list` RPC type to `database.types.ts`
  - Removed `as any` cast from `supabase.rpc()` call (now type-safe)
  - Removed manual `(data as ...)` cast (TS infers correctly)
  - Replaced state-based double-tap guard with `useRef` (fixes stale closure)
  - Added `supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}` to modal

### 2. Throwable Effects Too Small
**Files:** `ThrowablePlayerEffect.tsx`, `GameLayout.tsx`, `GameView.tsx`, `LandscapeGameLayout.tsx`

- **Problem:** Throwable effects (egg, smoke, confetti) were too small and didn't cover the full avatar area.
- **Fix:**
  - Removed `overflow: 'hidden'` from throwable clip wrappers in all 3 layout files
  - Increased egg particle radius: 0.42 → 0.65, sizes: 7-13px → 10-16px
  - Increased smoke particle radius: 0.4 → 0.6, sizes: 9-17px → 12-21px
  - Increased confetti particle radius: 0.48 → 0.7, sizes: 4-10px → 6-13px
  - Increased splat emoji size: 0.38 → 0.55 of container
  - Removed unused `Text` import

### 3. Play Again Routing Fix
**Files:** `MultiplayerGame.tsx`, `LobbyScreen.tsx`, `AppNavigator.tsx`

- **Problem:** Private game "Play Again" navigated to Lobby with `playAgain: true`, which tried to reset an ended room — causing routing failures.
- **Fix:**
  - Private game Play Again now navigates to `CreateRoom` instead
  - Removed ALL `playAgain` dead code from LobbyScreen (~50 lines):
    - Route param destructuring
    - Room reset logic for ended rooms
    - `!playAgain` condition from kicked check
    - Auto-rejoin block
    - Subscription handler for status='waiting'
  - Removed `playAgain` from Lobby route type definition

### 4. ESLint Warnings (9 → 0)
**Files:** `CardHand.tsx`, `GameLayout.tsx`, `ThrowablePlayerEffect.tsx`, `bot/index.ts`, `useGameActions.ts`, `useRoomLobby.ts`, `useThrowables.ts`, `StatsScreen.tsx`

| Warning | File | Fix |
|---------|------|-----|
| Missing dep `scheduleOptimisticRollback` | CardHand.tsx | Added to useCallback deps |
| Unused catch variable `e` | GameLayout.tsx | Changed `catch (e)` to `catch` |
| Unused import `Text` | ThrowablePlayerEffect.tsx | Removed import |
| Unused var `minOpponentCards` | bot/index.ts | Renamed to `_minOpponentCards` |
| Missing dep `getMultiplayerValidationState` | useGameActions.ts | Added to useCallback deps |
| Missing deps + eslint-disable | useRoomLobby.ts | Added 4 deps, removed disable comment |
| Stale ref in cleanup | useThrowables.ts | Captured ref.current in local var |
| `as any` cast | StatsScreen.tsx | Added RPC type (see fix #1) |
| State-based guard stale closure | StatsScreen.tsx | Switched to useRef (see fix #1) |

### 5. E2E Test Audit Fixes
**Files:** `05_join_room.yaml`, `06_offline_game.yaml`, `07_match_history.yaml`

- **05_join_room.yaml:** Removed `optional: true` from error message assertion — was silently passing without verifying error handling
- **06_offline_game.yaml:** Fixed misleading "Full Round" header → "Game Launch", added Pass button interaction step
- **07_match_history.yaml:** Added content assertions for Leaderboard ("Rank") and Profile ("Games Played") to verify actual content loads

### 6. PR Comments Addressed
- **PR #178:** 7 threads — all addressed (as any, double-tap, accessibility, throwable sizing x2, stale closure, supportedOrientations)
- **PR #177:** 2 threads — both already fixed (useThrowables userId dep, usePresence join gating)
- **PR #176:** 17 threads — all on pre-existing chinese-poker code, not in our diff

---

## Verification

| Check | Result |
|-------|--------|
| ESLint | ✅ 0 warnings, 0 errors |
| TypeScript | ✅ Clean compilation |
| Jest Tests | ✅ 80 suites, 1,359 tests pass |
| CI Lint/Type/Test | ✅ Passed |
| CI Build Check | ✅ Passed |
| Copilot Review | ✅ 0 new comments (2 cycles) |

---

## Commits (5 individual, no force push)

1. `bf553bf` — fix: mutual friends list - add RPC type, ref-based guard, remove casts, supported orientations
2. `b3d406d` — fix: throwable effects too small - remove overflow clip, increase particle sizes
3. `a45b491` — fix: Play Again routing - navigate to CreateRoom, remove dead playAgain code
4. `886dfa5` — fix: resolve all 9 ESLint warnings - missing deps, unused vars, stale refs
5. `db08523` — fix: e2e test false positives - remove optional:true, add assertions

---

## Files Changed (17 files, +475/-281)

```
src/types/database.types.ts
src/screens/StatsScreen.tsx
src/screens/MultiplayerGame.tsx
src/screens/LobbyScreen.tsx
src/screens/GameView.tsx
src/components/game/ThrowablePlayerEffect.tsx
src/components/game/GameLayout.tsx
src/components/game/CardHand.tsx
src/components/gameRoom/LandscapeGameLayout.tsx
src/navigation/AppNavigator.tsx
src/hooks/useGameActions.ts
src/hooks/useRoomLobby.ts
src/hooks/useThrowables.ts
src/game/bot/index.ts
e2e/flows/05_join_room.yaml
e2e/flows/06_offline_game.yaml
e2e/flows/07_match_history.yaml
```
