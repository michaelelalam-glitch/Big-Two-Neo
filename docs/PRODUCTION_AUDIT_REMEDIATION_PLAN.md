# Big Two Neo — Production Audit Remediation Plan v2

**Created:** April 7, 2026
**Based on:** Production Audit Report v2 (82 findings)
**Sprint 1 Status:** ✅ COMPLETE (PR #223 — C1, C4, C5, C6)
**Remaining:** 78 findings across 5 sprints

---

## Sprint 1 — COMPLETED ✅ (PR #223)

| Finding | Title | Status |
|---------|-------|--------|
| C1 | game_state RLS leaks ALL player hands | ✅ Done |
| C4 | Auth tokens in plaintext AsyncStorage | ✅ Done |
| C5 | waiting_count column doesn't exist | ✅ Done |
| C6 | .env.test committed with real Supabase anon key | ✅ Done |

⚠️ **Migration deployment required:** Run `npx supabase db push` from `apps/mobile` to apply the two new migrations to the database.

---

## Sprint 2 — Security & Reliability (8 Critical + 6 High)

### PR-2A: Minimum App Version Gate (C3)
**Severity:** 🔴 CRITICAL | **Effort:** Medium | **Domain:** backend + frontend

- Add `X-App-Version` header to Supabase client config (all edge function calls)
- Create a shared `checkMinimumVersion()` middleware for edge functions
- Store `minimum_app_version` in a `config` table (or environment variable)
- Add `ForceUpdateScreen` component shown when version check fails
- Add migration for `app_config` table with `minimum_version` row

**Files:** `src/services/supabase.ts`, new `supabase/functions/_shared/versionCheck.ts`, new `src/screens/ForceUpdateScreen.tsx`, new migration

---

### PR-2B: Play Cards & Pass Idempotency Fixes (C11, H3)
**Severity:** 🔴 CRITICAL + 🟠 HIGH | **Effort:** Small | **Domain:** backend

- C11: Add idempotency guard in `play-cards/index.ts` for the non-winner code path (currently only the winner path has one)
- H3: Add idempotency guard in `player-pass/index.ts` to prevent duplicate pass processing on retry

**Files:** `supabase/functions/play-cards/index.ts`, `supabase/functions/player-pass/index.ts`

---

### PR-2C: Bot-Coordinator Timing & Safety (C12, H6)
**Severity:** 🔴 CRITICAL + 🟠 HIGH | **Effort:** Small | **Domain:** backend

- C12: Increase lease timeout to exceed max move execution time (currently shorter)
- H6: Add wall-clock timeout for consecutive bot turns to prevent infinite bot loops

**Files:** `supabase/functions/bot-coordinator/index.ts`

---

### PR-2D: LiveKit Room Cleanup (H7)
**Severity:** 🟠 HIGH | **Effort:** Small | **Domain:** backend

- Add `rooms.delete(roomId)` call in the `complete-game` edge function when game ends
- Consider adding a periodic cleanup job for orphaned rooms

**Files:** `supabase/functions/complete-game/index.ts`, possibly `supabase/functions/get-livekit-token/index.ts`

---

### PR-2E: Matchmaking Race Condition Fixes (H8, H9, H10)
**Severity:** 🟠 HIGH | **Effort:** Medium | **Domain:** backend

- H8: Wrap concurrent matchmaking cancellation UPDATE+DELETE in a transaction
- H9: Add dual-state check — verify player is NOT in an active game before queueing
- H10: Fix incomplete rollback using wrong variable (`matchedUserIds`)

**Files:** `supabase/functions/cancel-matchmaking/index.ts`, `supabase/functions/find-match/index.ts`

---

### PR-2F: Delete Account Transaction Safety (H5)
**Severity:** 🟠 HIGH | **Effort:** Small | **Domain:** backend

- Wrap `delete-account` cleanup steps in a transaction so partial failures don't leave orphaned data

**Files:** `supabase/functions/delete-account/index.ts`

---

### PR-2G: start_new_match Service-Role Hardening (H4)
**Severity:** 🟠 HIGH | **Effort:** Small | **Domain:** backend

- Review `start_new_match` service-role bypass usage — add explicit RLS-equivalent checks or document why bypass is necessary

**Files:** `supabase/functions/start_new_match/index.ts`

---

### Sprint 2 Summary

| PR | Findings | Severity | Effort |
|----|----------|----------|--------|
| PR-2A | C3 | 🔴 | Medium |
| PR-2B | C11, H3 | 🔴🟠 | Small |
| PR-2C | C12, H6 | 🔴🟠 | Small |
| PR-2D | H7 | 🟠 | Small |
| PR-2E | H8, H9, H10 | 🟠 | Medium |
| PR-2F | H5 | 🟠 | Small |
| PR-2G | H4 | 🟠 | Small |
| **Total** | **10 findings** | | |

---

## Sprint 3 — State Management & Testing (4 Critical + 6 High)

### PR-3A: Eliminate GameContext Duplication (C2, M5)
**Severity:** 🔴 CRITICAL + 🟡 MEDIUM | **Effort:** Large | **Domain:** frontend

- Migrate all GameContext consumers (`layoutPlayers`, `matchNumber`, `isGameFinished`) to Zustand selectors
- Remove GameContext entirely
- Add `resetSession()` action to Zustand store for logout/game-end cleanup
- M5: This also fixes the "no reset function" issue

**Files:** `src/contexts/GameContext.tsx`, `src/stores/gameSessionSlice.ts`, all consumer components

---

### PR-3B: Critical Hook Tests — ClockSync & TurnInactivity (C7, C8)
**Severity:** 🔴 CRITICAL | **Effort:** Medium | **Domain:** testing

- C7: Write comprehensive tests for `useClockSync.ts` — server offset calculation, cache TTL, error handling
- C8: Write comprehensive tests for `useTurnInactivityTimer.ts` — interval firing, sequence tracking, auto-play trigger

**Files:** New `src/hooks/__tests__/useClockSync.test.ts`, new `src/hooks/__tests__/useTurnInactivityTimer.test.ts`

---

### PR-3C: Fix Jest Roots & Silent Test Skip (C10, H17)
**Severity:** 🔴 CRITICAL + 🟠 HIGH | **Effort:** Small | **Domain:** testing

- C10: Replace `describeWithCredentials` silent skip with explicit `test.skip` + visible warning when Supabase secrets are missing
- H17: Add `__tests__/` at project root to jest `roots` config so 2 currently-orphaned test files execute

**Files:** `jest.config.js`, integration test helpers

---

### PR-3D: Expand E2E CI Coverage (C9)
**Severity:** 🔴 CRITICAL | **Effort:** Medium | **Domain:** testing

- Create a CI test account with email/password auth (not OAuth)
- Tag offline game + room creation Maestro flows for CI execution
- Increase from 3 to 6+ flows running in CI (add gameplay-touching flows beyond sign-in)

**Files:** `e2e/flows/*.yaml`, `e2e/maestro-config.yaml`, CI workflow files

---

### PR-3E: Hook Test Coverage Expansion (H15, partial)
**Severity:** 🟠 HIGH | **Effort:** Large | **Domain:** testing

- Prioritize tests for highest-risk untested hooks (27 of 42 have zero tests):
  - `useMatchmaking.ts`
  - `useRoomLobby.ts`
  - `useConnectionManager.ts`
  - `useFriends.ts`
  - `useGameChat.ts`
  - `useGameEnd.ts`
- Target: reduce untested hooks from 27 to ≤15

**Files:** Multiple new test files in `src/hooks/__tests__/`

---

### PR-3F: Screen-Level Test Foundation (H16)
**Severity:** 🟠 HIGH | **Effort:** Medium | **Domain:** testing

- Add smoke tests for the 5 most critical screens:
  - `SignInScreen`
  - `HomeScreen`
  - `MultiplayerGame`
  - `LeaderboardScreen`
  - `SettingsScreen`
- Use shallow renders with mocked navigation/context

**Files:** New files in `src/screens/__tests__/`

---

### PR-3G: 2-Player & 3-Player Game Config Tests (H21)
**Severity:** 🟠 HIGH | **Effort:** Medium | **Domain:** testing

- Add game engine tests for 2-player and 3-player configurations
- Currently all tests assume 4 players

**Files:** New/expanded test files in `__tests__/`

---

### PR-3H: Network Resilience Tests (H22)
**Severity:** 🟠 HIGH | **Effort:** Medium | **Domain:** testing

- Add tests simulating AppState changes (background/foreground)
- Add transient network failure tests
- Add reconnect simulation tests

**Files:** New test files in `src/hooks/__tests__/`

---

### Sprint 3 Summary

| PR | Findings | Severity | Effort |
|----|----------|----------|--------|
| PR-3A | C2, M5 | 🔴🟡 | Large |
| PR-3B | C7, C8 | 🔴 | Medium |
| PR-3C | C10, H17 | 🔴🟠 | Small |
| PR-3D | C9 | 🔴 | Medium |
| PR-3E | H15 (partial) | 🟠 | Large |
| PR-3F | H16 | 🟠 | Medium |
| PR-3G | H21 | 🟠 | Medium |
| PR-3H | H22 | 🟠 | Medium |
| **Total** | **12 findings** | | |

---

## Sprint 4 — UX, Performance & Edge Cases (4 High + 14 Medium)

### PR-4A: Dual Timer Conflict Resolution (H1, M3)
**Severity:** 🟠 HIGH + 🟡 MEDIUM | **Effort:** Medium | **Domain:** frontend

- H1: Resolve 60s inactivity timer + 60s disconnect timer firing simultaneously — one should take priority
- M3: Fix `useTurnInactivityTimer` useEffect dependency issue (`tryAutoPlayTurn` in deps causes interval recreation)

**Files:** `src/hooks/useTurnInactivityTimer.ts`, `src/hooks/useConnectionManager.ts`

---

### PR-4B: Connection Status UI Improvements (H2)
**Severity:** 🟠 HIGH | **Effort:** Small | **Domain:** frontend

- Add "replaced_by_bot" state to `ConnectionStatusIndicator.tsx`
- Show appropriate UI when a player has been replaced by a bot

**Files:** `src/components/ConnectionStatusIndicator.tsx`

---

### PR-4C: Performance Optimizations (H12, H13, H14, M20)
**Severity:** 🟠 HIGH + 🟡 MEDIUM | **Effort:** Small | **Domain:** frontend

- H12: Guard `console.error` in `Card.tsx` with `__DEV__` check
- H13: Wrap `GameView.tsx` callbacks with `useCallback` to preserve `CardHand` memo
- H14: Wrap `LandscapeGameLayout` with `React.memo`
- M20: Fix `PlayerInfo` re-renders on unrelated timer updates (memoize or split context)

**Files:** `src/components/Card.tsx`, `src/components/GameView.tsx`, `src/components/LandscapeGameLayout.tsx`, `src/components/PlayerInfo.tsx`

---

### PR-4D: i18n Accessibility Labels (H11, M21, L6, L7)
**Severity:** 🟠 HIGH + 🟡 MEDIUM + 🟢 LOW | **Effort:** Medium | **Domain:** frontend

- H11: Localize 30+ accessibility labels across English, Arabic, German
- M21: Fix German text overflow risks in fixed-width containers (SignInScreen, LeaderboardScreen)
- L6: Fix legacy `{seconds}` single-brace syntax in translation key
- L7: Remove 2 unused translation keys

**Files:** `src/i18n/*.json`, `src/screens/SignInScreen.tsx`, `src/screens/LeaderboardScreen.tsx`

---

### PR-4E: Notification System Fixes (M22, M23, M24, L8)
**Severity:** 🟡 MEDIUM + 🟢 LOW | **Effort:** Medium | **Domain:** backend + frontend

- M22: Fix notification type mismatch `player_turn` vs `your_turn` so user preferences are respected
- M23: Enforce server-side notification preference filtering (currently sends all types)
- M24: Address cross-instance rate limiting gap (per-Deno-isolate → shared state)
- L8: Add push token refresh mechanism

**Files:** `supabase/functions/send-push-notification/index.ts`, notification preference schema

---

### PR-4F: Friend System Hardening (H20, M29)
**Severity:** 🟠 HIGH + 🟡 MEDIUM | **Effort:** Medium | **Domain:** backend

- H20: Add server-side rate limit trigger on friend request INSERT (`enforce_friend_request_rate_limit`)
- M29: Add `blocked_users` table and user-level block/mute feature

**Files:** New migration(s), `supabase/functions/` or DB triggers, `src/hooks/useFriends.ts`

---

### PR-4G: Reconnection & Matchmaking Robustness (M1, M2, M16)
**Severity:** 🟡 MEDIUM | **Effort:** Medium | **Domain:** backend + frontend

- M1: Address race between bot-coordinator and player reconnect
- M2: Add rate limiting on `reconnect-player` edge function
- M16: Add Realtime subscription failure fallback for matchmaking notifications

**Files:** `supabase/functions/bot-coordinator/index.ts`, `supabase/functions/reconnect-player/index.ts`, `src/hooks/useMatchmaking.ts`

---

### PR-4H: Clock Sync & Timer Robustness (M4, M8)
**Severity:** 🟡 MEDIUM | **Effort:** Small | **Domain:** frontend + backend

- M4: Reduce 30s clock sync cache TTL or add adaptive refresh for long sessions
- M8: Make broadcast timeout configurable (currently hardcoded 5s)

**Files:** `src/hooks/useClockSync.ts`, shared edge function config

---

### Sprint 4 Summary

| PR | Findings | Severity | Effort |
|----|----------|----------|--------|
| PR-4A | H1, M3 | 🟠🟡 | Medium |
| PR-4B | H2 | 🟠 | Small |
| PR-4C | H12, H13, H14, M20 | 🟠🟡 | Small |
| PR-4D | H11, M21, L6, L7 | 🟠🟡🟢 | Medium |
| PR-4E | M22, M23, M24, L8 | 🟡🟢 | Medium |
| PR-4F | H20, M29 | 🟠🟡 | Medium |
| PR-4G | M1, M2, M16 | 🟡 | Medium |
| PR-4H | M4, M8 | 🟡 | Small |
| **Total** | **22 findings** | | |

---

## Sprint 5 — Infrastructure, Polish & Tech Debt (16 Medium + 18 Low)

### PR-5A: Remove Unused Dependencies (H18, H19, L12)
**Severity:** 🟠 HIGH + 🟢 LOW | **Effort:** Small | **Domain:** build

- H18: Remove `expo-av` (migrated to `expo-audio`) — reduces native binary bloat
- H19: Remove `expo-barcode-scanner` — exists only for compat plugin stubs, investigate if plugins can also be removed
- L12: Investigate if `expo-status-bar` is unused (code uses RN StatusBar directly)

**Files:** `package.json`, `app.json` (plugins), compat plugin files

---

### PR-5B: Edge Function Hardening (M7, M9, M10, M12, L3, L4, L5)
**Severity:** 🟡 MEDIUM + 🟢 LOW | **Effort:** Medium | **Domain:** backend

- M7: Optimize rate limit DB query (caching or batch) — currently queries DB on every game action
- M9: Address analytics-proxy rate limiter being instance-local
- M10: Add card format validation (suit/rank) at edge function boundary in `play-cards`
- M12: Restrict CORS `Access-Control-Allow-Origin` from `*` to specific origins
- L3: Add auth check to server-time endpoint
- L4: Standardize error response format across all edge functions
- L5: Add request ID tracing for debugging

**Files:** Multiple edge function files in `supabase/functions/`

---

### PR-5C: LiveKit Client Improvements (M11, M13, M14)
**Severity:** 🟡 MEDIUM | **Effort:** Medium | **Domain:** frontend

- M11: Add LiveKit token refresh mechanism (currently 1hr TTL with no refresh)
- M13: Pause video stream on app backgrounding
- M14: Add disconnect notification when video drops

**Files:** LiveKit client code, `src/hooks/` related to video chat

---

### PR-5D: Matchmaking Queue Cleanup (M15)
**Severity:** 🟡 MEDIUM | **Effort:** Small | **Domain:** backend

- Add scheduled cleanup job (pg_cron) for stale `matched` queue entries that accumulate when no new matchmaking calls arrive

**Files:** New migration for pg_cron job

---

### PR-5E: Analytics & Monitoring Improvements (M17, M18, M19)
**Severity:** 🟡 MEDIUM | **Effort:** Small | **Domain:** frontend

- M17: Fix analytics `client_id` race condition (initClientId vs early trackEvent)
- M18: Adjust console capture rate limiting (50/sec threshold — evaluate if too aggressive)
- M19: Add game event breadcrumbs to Sentry (turns, plays, scores)

**Files:** `src/services/analytics.ts`, Sentry config

---

### PR-5F: Lobby & Preference Robustness (M6, M28, M30)
**Severity:** 🟡 MEDIUM | **Effort:** Small | **Domain:** frontend

- M6: Add retry logic for fire-and-forget errors in `useRealtime.fetchPlayers`
- M28: Fix `joinRoom` TOCTOU race — make count check atomic
- M30: Add `version: 1` + `migrate` function to Zustand persist config for preferences

**Files:** `src/hooks/useRealtime.ts`, `src/hooks/useRoomLobby.ts`, `src/stores/userPreferencesSlice.ts`

---

### PR-5G: Coverage Config & Reporting Accuracy (M27)
**Severity:** 🟡 MEDIUM | **Effort:** Small | **Domain:** testing

- Expand `collectCoverageFrom` to include screens and remaining components so the 84.6% headline reflects true coverage

**Files:** `jest.config.js`

---

### PR-5H: Android & Platform Edge Cases (M26, L15, L16)
**Severity:** 🟡 MEDIUM + 🟢 LOW | **Effort:** Small | **Domain:** frontend

- M26: Verify safe area handling with edge-to-edge Android enabled
- L15: Add Android `onTrimMemory` handling (currently iOS-only memory warning)
- L16: Add confirmation dialog before deep link navigation mid-game

**Files:** `src/hooks/useConnectionManager.ts`, `src/contexts/NotificationContext.tsx`

---

### PR-5I: Code Cleanup & Lint (L1, L2, L13, L14, L17, L18)
**Severity:** 🟢 LOW | **Effort:** Trivial | **Domain:** code quality

- L1: Remove 3 orphaned files (`CardAssetsDemo.tsx`, `logger-manual-test.ts`, mislocated `logger.test.ts`)
- L2: Remove or mark 6 placeholder SQL migrations
- L13: Remove redundant `.husky/` directory in mobile (root one is sufficient)
- L14: Pin Node/pnpm versions in `preview`/`production` EAS profiles
- L17: Document that `Math.random()` for room codes is acceptable (non-security-critical)
- L18: Upgrade `@typescript-eslint/no-explicit-any` from warn to error

**Files:** Various cleanup targets, `eas.json`, `.eslintrc.js`

---

### PR-5J: Bot Test Expansion & Visual Regression (L10, L11)
**Severity:** 🟢 LOW | **Effort:** Medium | **Domain:** testing

- L10: Add bot tests covering 5-card combo play decisions
- L11: Add visual regression tests for landscape layout

**Files:** `__tests__/bot.test.ts`, new visual test files

---

### PR-5K: Build Pipeline Improvements (L9)
**Severity:** 🟢 LOW | **Effort:** Small | **Domain:** devops

- L9: Measure and establish cold start baseline

**Files:** CI workflow files

---

### PR-5L: Bundle Size Optimization (M25)
**Severity:** 🟡 MEDIUM | **Effort:** Small | **Domain:** build

- Tree-shake date-fns imports (~80KB wasted) — switch from barrel imports to direct path imports

**Files:** All files importing from `date-fns`

---

### Sprint 5 Summary

| PR | Findings | Severity | Effort |
|----|----------|----------|--------|
| PR-5A | H18, H19, L12 | 🟠🟢 | Small |
| PR-5B | M7, M9, M10, M12, L3, L4, L5 | 🟡🟢 | Medium |
| PR-5C | M11, M13, M14 | 🟡 | Medium |
| PR-5D | M15 | 🟡 | Small |
| PR-5E | M17, M18, M19 | 🟡 | Small |
| PR-5F | M6, M28, M30 | 🟡 | Small |
| PR-5G | M27 | 🟡 | Small |
| PR-5H | M26, L15, L16 | 🟡🟢 | Small |
| PR-5I | L1, L2, L13, L14, L17, L18 | 🟢 | Trivial |
| PR-5J | L10, L11 | 🟢 | Medium |
| PR-5K | L9 | 🟢 | Small |
| PR-5L | M25 | 🟡 | Small |
| **Total** | **34 findings** | | |

---

## Full Tracking Matrix

| Sprint | PRs | Findings Addressed | Key Focus |
|--------|-----|-------------------|-----------|
| Sprint 1 ✅ | 1 (PR #223) | 4 (C1, C4, C5, C6) | Security & data integrity |
| Sprint 2 | 7 | 10 (C3, C11, C12, H3-H10) | Reliability & backend safety |
| Sprint 3 | 8 | 12 (C2, C7-C10, H15-H17, H21-H22, M5) | State management & testing |
| Sprint 4 | 8 | 22 (H1, H2, H11-H14, H20, M1-M4, M8, M16, M20-M24, M29, L6-L8) | UX, performance & edge cases |
| Sprint 5 | 12 | 34 (H18, H19, M6, M7, M9, M10, M12-M15, M17-M19, M25-M28, M30, L1-L18) | Infrastructure, polish & tech debt |
| **TOTAL** | **36 PRs** | **82 findings** | |

---

## Finding → PR Cross-Reference

| Finding | PR | Sprint |
|---------|-----|--------|
| C1 | PR #223 ✅ | 1 |
| C2 | PR-3A | 3 |
| C3 | PR-2A | 2 |
| C4 | PR #223 ✅ | 1 |
| C5 | PR #223 ✅ | 1 |
| C6 | PR #223 ✅ | 1 |
| C7 | PR-3B | 3 |
| C8 | PR-3B | 3 |
| C9 | PR-3D | 3 |
| C10 | PR-3C | 3 |
| C11 | PR-2B | 2 |
| C12 | PR-2C | 2 |
| H1 | PR-4A | 4 |
| H2 | PR-4B | 4 |
| H3 | PR-2B | 2 |
| H4 | PR-2G | 2 |
| H5 | PR-2F | 2 |
| H6 | PR-2C | 2 |
| H7 | PR-2D | 2 |
| H8 | PR-2E | 2 |
| H9 | PR-2E | 2 |
| H10 | PR-2E | 2 |
| H11 | PR-4D | 4 |
| H12 | PR-4C | 4 |
| H13 | PR-4C | 4 |
| H14 | PR-4C | 4 |
| H15 | PR-3E | 3 |
| H16 | PR-3F | 3 |
| H17 | PR-3C | 3 |
| H18 | PR-5A | 5 |
| H19 | PR-5A | 5 |
| H20 | PR-4F | 4 |
| H21 | PR-3G | 3 |
| H22 | PR-3H | 3 |
| M1 | PR-4G | 4 |
| M2 | PR-4G | 4 |
| M3 | PR-4A | 4 |
| M4 | PR-4H | 4 |
| M5 | PR-3A | 3 |
| M6 | PR-5F | 5 |
| M7 | PR-5B | 5 |
| M8 | PR-4H | 4 |
| M9 | PR-5B | 5 |
| M10 | PR-5B | 5 |
| M11 | PR-5C | 5 |
| M12 | PR-5B | 5 |
| M13 | PR-5C | 5 |
| M14 | PR-5C | 5 |
| M15 | PR-5D | 5 |
| M16 | PR-4G | 4 |
| M17 | PR-5E | 5 |
| M18 | PR-5E | 5 |
| M19 | PR-5E | 5 |
| M20 | PR-4C | 4 |
| M21 | PR-4D | 4 |
| M22 | PR-4E | 4 |
| M23 | PR-4E | 4 |
| M24 | PR-4E | 4 |
| M25 | PR-5L | 5 |
| M26 | PR-5H | 5 |
| M27 | PR-5G | 5 |
| M28 | PR-5F | 5 |
| M29 | PR-4F | 4 |
| M30 | PR-5F | 5 |
| L1 | PR-5I | 5 |
| L2 | PR-5I | 5 |
| L3 | PR-5B | 5 |
| L4 | PR-5B | 5 |
| L5 | PR-5B | 5 |
| L6 | PR-4D | 4 |
| L7 | PR-4D | 4 |
| L8 | PR-4E | 4 |
| L9 | PR-5K | 5 |
| L10 | PR-5J | 5 |
| L11 | PR-5J | 5 |
| L12 | PR-5A | 5 |
| L13 | PR-5I | 5 |
| L14 | PR-5I | 5 |
| L15 | PR-5H | 5 |
| L16 | PR-5H | 5 |
| L17 | PR-5I | 5 |
| L18 | PR-5I | 5 |

---

*All 82 findings accounted for. Sprint 1 complete. Sprints 2–5 ready for execution.*
