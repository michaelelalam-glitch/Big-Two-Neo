# Batch 5 — Game Fixes Task List

**Branch:** `fix/game-fixes-batch-5`  
**Base:** `game/chinese-poker`  
**Created:** 2026-03-24

---

## Task Order (most efficient top-to-bottom)

### 1. ⬜ Fix straight flush highest-card detection (only trigger when truly unbeatable)
**Files:** `apps/mobile/src/game/engine/highest-play-detector.ts`  
**Issue:** Non-royal straight flushes trigger auto-pass timer, but the check only verifies same-suit higher sequences and same-sequence higher suits — it misses cross-suit higher sequences (e.g., 4-5-6-7-8♠ beating 3-4-5-6-7♥). Must check ALL remaining possible straight flushes across ALL suits.

### 2. ⬜ Fix auto-pass when opponents have fewer cards than combo size
**Files:** `apps/mobile/src/game/engine/highest-play-detector.ts`, `apps/mobile/supabase/functions/play-cards/index.ts`  
**Issue:** When a 5-card combo is played and all opponents have < 5 cards, auto-pass should trigger (no one can respond). Same logic for triples (< 3 cards) and pairs (< 2 cards). Currently this isn't checked.

### 3. ⬜ Fix Play Again kick-out bug (casual public)
**Files:** `apps/mobile/src/screens/MultiplayerGame.tsx`, `apps/mobile/src/screens/LobbyScreen.tsx`  
**Issue:** After pressing Play Again in casual public, user navigates to new room lobby but sees "kicked out by host" alert. Root cause: user is still in old room's player list, and new room navigation may trigger kicked detection before join completes. Need to clean up old room membership before navigating. Also verify ranked mode is unaffected.

### 4. ⬜ Verify all PR 176-179 Copilot comments are addressed
**Files:** Various  
**Issue:** PRs 176-179 were merged while Copilot still had open comments. After thorough review: ALL comments have been addressed in the current codebase. This task documents that verification.

### 5. ⬜ Run CI/CD tests — all 4 must pass
**Files:** CI pipeline  
**Issue:** Ensure lint, type-check, unit tests, and e2e tests all pass before PR.

---

## Completion Log

| Task | Status | Commit | Notes |
|------|--------|--------|-------|
| 1    | ⬜     |        |       |
| 2    | ⬜     |        |       |
| 3    | ⬜     |        |       |
| 4    | ⬜     |        |       |
| 5    | ⬜     |        |       |
