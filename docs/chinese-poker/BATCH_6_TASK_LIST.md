# Batch 6 — Game Fixes Task List

> Branch: `fix/game-fixes-batch-5` → PR #180 → `game/chinese-poker`
> Created: March 24, 2026

Tasks are ordered for maximum efficiency (smallest/most independent first, cascading dependencies last).

---

## Task 1: Remove Chat Profanity Filter
**Status:** ⬜ Not Started
**Priority:** High | **Complexity:** Low
**Files:** `src/utils/profanityFilter.ts`, `src/hooks/useGameChat.ts`

**Problem:** Chat is blocking swear words and cuss words. The user wants no limit on chat content.
**Fix:** Remove the `filterMessage()` calls from both the send and receive paths in `useGameChat.ts`. Messages should pass through unfiltered.
**Completed:** —

---

## Task 2: Error Popup Orientation Fix
**Status:** ⬜ Not Started
**Priority:** High | **Complexity:** Low
**Files:** `src/components/gameEnd/GameEndModal.tsx`, `src/constants/index.ts`

**Problem:** Error/modal popups in-game don't match the game layout orientation — they follow device orientation instead of the player's chosen game orientation.
**Fix:** Replace `supportedOrientations={['portrait', 'landscape']}` with `supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}` in `GameEndModal.tsx`. Audit all other `<Modal>` components for the same issue.
**Completed:** —

---

## Task 3: Landscape Table Glow on Drag-Drop
**Status:** ⬜ Not Started
**Priority:** Medium | **Complexity:** Medium
**Files:** `src/components/gameRoom/LandscapeOvalTable.tsx`, `src/components/gameRoom/LandscapeGameLayout.tsx`, `src/components/gameRoom/LandscapeYourPosition.tsx`

**Problem:** Landscape mode table does not glow like portrait mode when someone drags and drops a card on the table.
**Fix:** Add `dropZoneState` prop to `LandscapeOvalTable`, implement animated border glow logic (matching portrait's `GameLayout.tsx` lines 90-145). Wire drag state from `LandscapeYourPosition` → parent → table.
**Completed:** —

---

## Task 4: Video/Audio in Landscape Mode + Reconnection Persistence
**Status:** ⬜ Not Started
**Priority:** High | **Complexity:** High
**Files:** `src/screens/GameView.tsx`, `src/components/gameRoom/LandscapeGameLayout.tsx`, `src/components/gameRoom/LandscapeOpponent.tsx`, `src/hooks/useVideoChat.ts`, `src/hooks/useConnectionManager.ts`

**Problem:** (a) Video and audio not working in landscape mode — components aren't wired. (b) When a player disconnects and reconnects, their camera and mic turn off instead of staying on.
**Fix:**
- (a) Pass `enrichedRemotePlayers` video slots, `localVideoSlot`, camera/mic props to `LandscapeGameLayout` and `LandscapeOpponent` (same as portrait).
- (b) Add video chat auto-reconnect in app foreground handler — if session was previously active, re-call `toggleVideoChat()` / `toggleCamera()` / `toggleMic()`.
**Completed:** —

---

## Task 5: Stats Not Saving (Partial Failure)
**Status:** ⬜ Not Started
**Priority:** Critical | **Complexity:** Medium
**Files:** `supabase/functions/complete-game/index.ts`, `supabase/migrations/20260309000004_leaderboard_fixes.sql`

**Problem:** Stats (combos, performance, game completion) not saving — error: "Partial failure updating stats". Most likely cause: `update_player_stats_after_game` RPC signature mismatch (11 params called vs 8 deployed).
**Fix:**
1. Verify migration `20260309000004` is applied to production (check `pronargs` for the RPC).
2. If not applied, apply it. If applied, add enhanced error logging to identify exact failure.
3. Add null-guard for `player.user_id` before calling the RPC (skip bots without user IDs).
**Completed:** —

---

## Task 6: Play Again — All Players Join Same Room
**Status:** ⬜ Not Started
**Priority:** Critical | **Complexity:** High
**Files:** `src/screens/MultiplayerGame.tsx`, `src/components/gameEnd/GameEndModal.tsx`, `supabase/migrations/` (new migration)

**Problem:** When players press "Play Again", each one creates their own room instead of joining the first player's room.
**Fix:** Broadcast the new room code via Supabase Realtime on the old room's channel when the first player creates a room. Other players listen for this broadcast before creating their own room. Implement with a `play_again_room` broadcast event on the existing game channel.
**Completed:** —

---

## Task 7: Address All PR 180 Copilot Comments
**Status:** ⬜ Not Started
**Priority:** High | **Complexity:** Low
**Files:** Various (per comment)

**Problem:** Copilot left review comments on PR #180 that haven't been fully addressed (4 non-outdated threads remaining from previous rounds).
**Fix:** Review and address all remaining non-outdated comments.
**Completed:** —

---

## Task 8: CI/CD Verification + Copilot Review Loop
**Status:** ⬜ Not Started
**Priority:** High | **Complexity:** Low
**Files:** N/A

**Problem:** All 4 CI/CD checks must pass. Copilot review must generate 0 new comments.
**Fix:** Run full test suite, fix any failures. Loop: push → Copilot review → fix comments → repeat until 0.
**Completed:** —

---

## Task 9: Rebase & Merge to chinese-poker
**Status:** ⬜ Not Started
**Priority:** Final | **Complexity:** Low
**Files:** N/A

**Problem:** PR must be merged with all individual commits preserved.
**Fix:** Rebase onto latest `game/chinese-poker`, resolve any conflicts, merge PR #180.
**Completed:** —

---

## Summary
| # | Task | Status | Complexity |
|---|------|--------|------------|
| 1 | Remove Chat Profanity Filter | ⬜ | Low |
| 2 | Error Popup Orientation Fix | ⬜ | Low |
| 3 | Landscape Table Glow | ⬜ | Medium |
| 4 | Video/Audio Landscape + Reconnect | ⬜ | High |
| 5 | Stats Not Saving | ⬜ | Medium |
| 6 | Play Again Room Joining | ⬜ | High |
| 7 | PR 180 Comments | ⬜ | Low |
| 8 | CI/CD + Copilot Review | ⬜ | Low |
| 9 | Rebase & Merge | ⬜ | Low |
