# Big Two Neo — Production Readiness Audit Report v2

**Date:** July 5, 2025
**Auditor:** Principal Software Architect + QA Lead + Security Auditor (AI-assisted)
**Scope:** Full codebase, infrastructure, and operational readiness — 17 phases
**App:** React Native (Expo SDK 54) multiplayer card game with Supabase backend, LiveKit video chat, Sentry monitoring, GA4 analytics

---

## Executive Summary

### Health Score: 7.2 / 10

### Production Readiness: YES WITH CONDITIONS

Big Two Neo is an impressively well-engineered multiplayer card game with strong server-authoritative architecture, excellent game engine test coverage (94.5%), and sophisticated reconnection handling. However, **5 critical issues must be fixed before production launch.**

### Top 5 Issues That MUST Be Fixed Before Launch

| # | Issue | Phase | Severity | Effort |
|---|-------|-------|----------|--------|
| 1 | **game_state RLS leaks ALL player hands** — any room member can query all 4 players' cards | Phase 10 | 🔴 CRITICAL | Medium |
| 2 | **`waiting_count` column doesn't exist** — matchmaking queue UI broken | Phase 7 | 🔴 CRITICAL | Small |
| 3 | **Auth tokens in plaintext AsyncStorage** — should use SecureStore | Phase 8 | 🔴 CRITICAL | Small |
| 4 | **`.env.test` committed with real Supabase anon key** | Phase 15 | 🔴 CRITICAL | Trivial |
| 5 | **No minimum app version gate** — old clients break on schema changes | Phase 13 | 🔴 CRITICAL | Medium |

---

## Table of Contents

1. [Codebase Overview](#1-codebase-overview)
2. [All Findings by Severity](#2-all-findings-by-severity)
3. [Phase-by-Phase Summary](#3-phase-by-phase-summary)
4. [Root Cause Analysis (Critical + High)](#4-root-cause-analysis)
5. [Hidden Risks ("Works Now, Breaks at Scale")](#5-hidden-risks)
6. [Prioritized Remediation Plan](#6-prioritized-remediation-plan)
7. [Corrections Applied to Subagent Findings](#7-corrections-applied)

---

## 1. Codebase Overview

| Metric | Value |
|--------|-------|
| Total Files | ~580+ |
| Components | 90+ |
| Hooks | 50+ (42 unique, 27 untested) |
| Edge Functions | 18 |
| SQL Migrations | 80+ |
| Contexts | 6 (GameContext, ScoreboardContext, GameEndContext, FriendsContext, NotificationContext, AuthContext) |
| State Stores | 3 Zustand slices (gameSession, userPreferences, app) |
| Translation Keys | 600+ across 3 languages (English, Arabic, German) |
| Test Files | ~90 files, ~1,200+ test cases |
| E2E Flows | 12 Maestro YAML files (3 run in CI) |
| Dead Code | 3 orphaned files, 6 placeholder migrations, 2 unused dependencies |

### Architecture

- **Frontend:** React Native 0.81.5, Expo SDK 54, Hermes, New Architecture
- **Backend:** Supabase (PostgreSQL, Realtime, Edge Functions in Deno)
- **Video:** LiveKit via `@livekit/react-native`
- **Monitoring:** Sentry 8.7.0 (20% tracing, 10% profiles), GA4 via server-side proxy
- **State:** Zustand + 6 React Contexts + AsyncStorage
- **Navigation:** React Navigation 7 (Stack)
- **CI:** GitHub Actions (Jest, ESLint, TSC, Codecov, Maestro, bundle size)

---

## 2. All Findings by Severity

### 🔴 CRITICAL (12 findings)

| # | Finding | Phase | File(s) | Root Cause |
|---|---------|-------|---------|------------|
| C1 | **game_state RLS allows room members to read ALL player hands** — `select('*')` exposes opponent cards | 10 | `20260301000000_lock_down_game_state_rls.sql`, `useRealtime.ts:198` | RLS policy grants full SELECT to room members |
| C2 | **GameContext duplicates Zustand state** — `layoutPlayers`, `matchNumber`, `isGameFinished` exist in both | 4 | `GameContext.tsx`, `gameSessionSlice.ts` | Incremental development without refactoring |
| C3 | **No minimum app version gate** — old clients never forced to update on breaking schema changes | 13 | `app.json`, edge functions | Missing version enforcement layer |
| C4 | **Auth tokens in plaintext AsyncStorage** — should use SecureStore/Keychain | 8 | Supabase client config | Supabase JS default storage adapter |
| C5 | **`waiting_count` column doesn't exist** — Realtime queue count updates broken | 7 | `find-match/index.ts`, room schema | Missing DB migration |
| C6 | **`.env.test` with real Supabase anon key committed to git** | 15 | `.env.test` | `.gitignore` only covers `.env` and `.env*.local` |
| C7 | **Clock sync (`useClockSync.ts`) has zero tests** — timer correctness depends on this | 14 | `useClockSync.ts` | Not included in test plan |
| C8 | **Turn inactivity timer (`useTurnInactivityTimer.ts`) has zero tests** | 14 | `useTurnInactivityTimer.ts` | Not included in test plan |
| C9 | **Only 3/12 E2E flows run in CI — all test sign-in screen only** — zero gameplay E2E in CI | 14 | `e2e/flows/*.yaml` | CI auth bypass not implemented |
| C10 | **Integration tests silently skip without Supabase secrets** — false-green CI | 14 | `jest.config.js`, integration test files | `describeWithCredentials` skips silently |
| C11 | **Non-winner idempotency gap in play-cards** — if non-winner retries, may create inconsistencies | 5 | `play-cards/index.ts` | Only winner path has idempotency guard |
| C12 | **Bot-coordinator lease timeout shorter than move execution** | 5 | `bot-coordinator/index.ts` | Timing mismatch between lease and execution |

### 🟠 HIGH (22 findings)

| # | Finding | Phase | File(s) |
|---|---------|-------|---------|
| H1 | Dual timer conflict — 60s inactivity + 60s disconnect fire simultaneously | 2 | `useTurnInactivityTimer.ts`, `useConnectionManager.ts` |
| H2 | UI missing "replaced_by_bot" state in ConnectionStatusIndicator | 2 | `ConnectionStatusIndicator.tsx` |
| H3 | `player-pass` missing idempotency guard | 5 | `player-pass/index.ts` |
| H4 | `start_new_match` uses service-role bypass (no RLS) | 5 | `start_new_match/index.ts` |
| H5 | `delete-account` partial cleanup — no transaction wrapper | 5 | `delete-account/index.ts` |
| H6 | Bot-coordinator no wall-clock timeout for consecutive bot turns | 5 | `bot-coordinator/index.ts` |
| H7 | LiveKit rooms never cleaned up (no `rooms.delete()` call) | 6 | `get-livekit-token/index.ts` |
| H8 | Concurrent matchmaking cancelation race — UPDATE+DELETE not transactional | 7 | `cancel-matchmaking/index.ts` |
| H9 | Dual-state risk — player can be in queue AND active game simultaneously | 7 | `find-match/index.ts` |
| H10 | Incomplete matchmaking rollback uses wrong variable | 7 | `find-match/index.ts` |
| H11 | 30+ accessibility labels not localized (screen readers always English) | 11 | Various component files |
| H12 | Debug `console.error` in Card.tsx not guarded by `__DEV__` | 9 | `Card.tsx` |
| H13 | GameView callbacks not wrapped with `useCallback` — breaks CardHand memo | 9 | `GameView.tsx` |
| H14 | LandscapeGameLayout not wrapped with React.memo | 9 | `LandscapeGameLayout.tsx` |
| H15 | 27 of 42 hooks (64%) have no test file | 14 | Multiple hook files |
| H16 | Zero screen-level tests across 20 screens | 14 | `src/screens/*.tsx` |
| H17 | `__tests__/` at project root outside jest `roots` — 2 test files never execute | 14 | `jest.config.js`, `__tests__/` |
| H18 | `expo-av` is unused (migrated to `expo-audio`) — native binary bloat | 15 | `package.json` |
| H19 | `expo-barcode-scanner` unused — exists only for compat plugin stubs | 15 | `package.json` |
| H20 | No server-side rate limit on friend requests — client-only 5s throttle bypassable | 16 | `useFriends.ts` |
| H21 | No tests for 2-player or 3-player game configurations | 14 | All game tests assume 4 players |
| H22 | No network resilience tests — no AppState, transient failure, or reconnect simulation | 14 | Test suite |

### 🟡 MEDIUM (30 findings)

| # | Finding | Phase | File(s) |
|---|---------|-------|---------|
| M1 | Race between bot-coordinator + player reconnect | 2 | `bot-coordinator/index.ts`, `reconnect-player` |
| M2 | No rate limiting on `reconnect-player` | 2 | `reconnect-player/index.ts` |
| M3 | `useTurnInactivityTimer` useEffect includes `tryAutoPlayTurn` in deps — interval may recreate | 3 | `useTurnInactivityTimer.ts` |
| M4 | 30s clock sync cache can become stale in long sessions | 3 | `useClockSync.ts` |
| M5 | GameContext has NO reset function — stale state on reuse | 4 | `GameContext.tsx` |
| M6 | `useRealtime` fire-and-forget errors on fetchPlayers not retried | 4 | `useRealtime.ts` |
| M7 | Rate limit DB query on every game action | 5 | Edge function rate limiter |
| M8 | Broadcast timeout hardcoded 5s | 5 | Edge functions |
| M9 | Analytics-proxy rate limiter instance-local | 5 | `analytics-proxy/index.ts` |
| M10 | No validation of card format (suit/rank) at edge function boundary | 5 | `play-cards/index.ts` |
| M11 | LiveKit token TTL 1hr hardcoded — no refresh mechanism | 6 | `get-livekit-token/index.ts` |
| M12 | CORS `Access-Control-Allow-Origin: *` too permissive | 6 | `get-livekit-token/index.ts` |
| M13 | No background video pause on app backgrounding | 6 | LiveKit client code |
| M14 | No disconnect notification to user when video drops | 6 | LiveKit client code |
| M15 | Stale matched queue entries accumulate (no scheduled cleanup) | 7 | `find-match/index.ts` |
| M16 | No Realtime subscription failure fallback for match notifications | 7 | `useMatchmaking.ts` |
| M17 | Analytics `client_id` race condition (initClientId vs early trackEvent) | 8 | `analytics.ts` |
| M18 | Console capture rate limiting (50/sec) could miss errors | 8 | Sentry config |
| M19 | Missing game event breadcrumbs (turns, plays, scores) | 8 | Sentry config |
| M20 | PlayerInfo re-renders on unrelated timer updates | 9 | `PlayerInfo.tsx` |
| M21 | German text overflow risks in fixed-width containers | 11 | `SignInScreen.tsx`, `LeaderboardScreen.tsx` |
| M22 | Notification type mismatch `player_turn` vs `your_turn` — preferences ignored | 12 | `send-push-notification/index.ts`, preferences schema |
| M23 | Server doesn't enforce notification preferences — sends all types | 12 | `send-push-notification/index.ts` |
| M24 | Cross-instance rate limiting gap (per-Deno-isolate) | 12 | `send-push-notification/index.ts` |
| M25 | date-fns not tree-shaken (~80KB waste) | 13 | Import statements |
| M26 | Edge-to-edge Android enabled — needs safe area verification | 13 | `app.json` |
| M27 | Coverage `collectCoverageFrom` excludes most UI components — 84.6% headline misleading | 14 | `jest.config.js` |
| M28 | `joinRoom` TOCTOU race — count check not atomic | 16 | `useRoomLobby.ts` |
| M29 | No user-level block/mute feature | 16 | `useFriends.ts` (missing) |
| M30 | No schema versioning on persisted preferences | 16 | `userPreferencesSlice.ts` |

### 🟢 LOW (18 findings)

| # | Finding | Phase | File(s) |
|---|---------|-------|---------|
| L1 | 3 orphaned files (`CardAssetsDemo.tsx`, `logger-manual-test.ts`, `logger.test.ts` mislocated) | 0 | Various |
| L2 | 6 placeholder SQL migrations | 0 | `migrations/` |
| L3 | Server-time endpoint has no auth | 5 | `server-time/index.ts` |
| L4 | Inconsistent error response format across edge functions | 5 | Various edge functions |
| L5 | No request ID tracing | 5 | Edge functions |
| L6 | Legacy `{seconds}` single-brace syntax in one translation key | 11 | Translation files |
| L7 | 2 unused translation keys | 11 | Translation files |
| L8 | No push token refresh mechanism | 12 | Notification service |
| L9 | No cold start baseline measured | 13 | Build pipeline |
| L10 | Bot tests don't cover 5-card combo play decisions | 14 | `bot.test.ts` |
| L11 | No visual regression tests for landscape layout | 14 | Test suite |
| L12 | `expo-status-bar` may be unused (code uses RN StatusBar) | 15 | `package.json` |
| L13 | Dual `.husky/` directories (root + mobile) — mobile is redundant | 15 | `.husky/` dirs |
| L14 | `preview`/`production` EAS profiles don't pin Node/pnpm versions | 15 | `eas.json` |
| L15 | No Android `onTrimMemory` handling — iOS-only memory warning | 16 | `useConnectionManager.ts` |
| L16 | Deep link mid-game navigates without confirmation | 16 | `NotificationContext.tsx` |
| L17 | `Math.random()` used for room codes (non-security-critical) | 16 | `useRoomLobby.ts` |
| L18 | `@typescript-eslint/no-explicit-any` is warn not error | 15 | `.eslintrc.js` |

---

## 3. Phase-by-Phase Summary

### Phase 0 — Codebase Inventory ✅
~580+ files inventoried. 3 orphaned files, 6 placeholder migrations, complete edge function call map for all 18 functions.

### Phase 1 — Gameplay Logic ✅
Card validation on both client AND server. CAS via `total_training_actions`. All 10 straight sequences verified identical. One Card Left Rule dual-enforced. Bot logic has race conditions between auto-pass and bot-coordinator. **Correction applied:** Subagent falsely reported "no server-side turn verification" — verified at play-cards:1015 and player-pass:500.

### Phase 2 — Reconnection & Rejoin ✅
3-layer disconnect detection (Realtime presence, heartbeat 30s stale, pg_cron 60s). `reconnect_player` RPC is atomic SQL transaction. Dual timer conflict (60s inactivity + 60s disconnect). Missing "replaced_by_bot" UI state.

### Phase 3 — Clock Sync & Timers ✅
Single NTP-style ping, 30s cache TTL. All timers use `getCorrectedNow()`. Sequence ID tracking prevents stale timer fires. `useTurnInactivityTimer` has useEffect dependency issue.

### Phase 4 — State Management & Hooks ✅
**CRITICAL:** GameContext duplicates Zustand state. All 6 contexts audited (5 clean, 1 problematic). useAutoPassTimer and useConnectionManager show architectural excellence with ref-based patterns.

### Phase 5 — Supabase Backend ✅
Valid findings: non-winner idempotency gap, bot-coordinator lease timeout, delete-account no transaction, player-pass missing idempotency. **3 subagent claims corrected as false** (play-cards CAS exists, Realtime cleanup exists, LiveKit membership check exists).

### Phase 6 — LiveKit Video/Audio ✅
Secrets server-only, room membership verified. Issues: 1hr token with no refresh, rooms never cleaned up, no background stream pause, CORS too permissive.

### Phase 7 — Matchmaking System ✅
FIFO + skill-based (±200 ELO). **CRITICAL:** `waiting_count` column missing. Concurrent cancelation race, dual-state risk, incomplete rollback variable mismatch.

### Phase 8 — Error Monitoring ✅
Sentry well-configured. GA4 comprehensive. 4-layer error boundaries. **CRITICAL:** Auth tokens in plaintext AsyncStorage. No purchase/IAP tracking. Missing game event breadcrumbs.

### Phase 9 — UI/UX & Rendering ✅
React.memo strategically applied. Debug `console.error` in Card.tsx in production. GameView callbacks break CardHand memo. LandscapeGameLayout not memoized. PlayerInfo re-renders on timer updates.

### Phase 10 — Security Audit ✅
**CRITICAL: game_state RLS leaks ALL player hands.** Verified: RLS policy allows full SELECT for room members + client does `select('*')`. All 18 edge functions authenticated. Service-role key server-only. Card ownership validated server-side.

### Phase 11 — i18n ✅
3 languages, RTL properly configured for Arabic. 30+ accessibility labels not localized. German text overflow risks. 2 unused keys, 1 legacy brace syntax.

### Phase 12 — Push Notifications ✅
Dual-layer rate limiting. RLS-protected token storage. Excellent deep linking. Type mismatch `player_turn` vs `your_turn`. Server ignores notification preferences. Rate limiting per-isolate, not cross-instance.

### Phase 13 — Expo OTA & Build ✅
Hermes + New Architecture correct. OTA conservative (`ON_ERROR_RECOVERY`). **CRITICAL:** No minimum app version gate. Bundle size script not in CI. date-fns ~80KB not tree-shaken.

### Phase 14 — Testing Coverage ✅
~1,200+ test cases. Game engine: 94.5% statement coverage (excellent). **27/42 hooks (64%) untested.** Zero screen-level tests. Only 3/12 E2E flows in CI (all sign-in). `useClockSync` and `useTurnInactivityTimer` have zero tests. 2 test files at project root never execute due to jest `roots` config.

### Phase 15 — Dependencies & Health ✅
31 production deps, 17 dev deps. `expo-av` and `expo-barcode-scanner` unused. `.env.test` committed. ESLint/TS/Babel/Husky all excellent. Throwables purely cosmetic with documented risk acceptance. Only 5 TODOs, 0 FIXMEs.

### Phase 16 — Cross-Cutting Concerns ✅
App lifecycle well-handled (server-authoritative, no local persistence by design). Navigation safety robust (back button guards, swipe disabled in game). Lobby system solid (host transfer, kick/ban, ready check, room cleanup). Friends missing server-side rate limit and user-level blocking.

---

## 4. Root Cause Analysis (Critical + High)

### C1 — game_state RLS Leaks All Hands
- **Why:** The `game_state_rls_select` policy at `20260301000000_lock_down_game_state_rls.sql` line 25 grants full SELECT access to any room member. The client queries `from('game_state').select('*')` at `useRealtime.ts:198`.
- **Root pattern:** Server stores all hands in one row per game_state; RLS can't filter columns.
- **Blast radius:** Any player can see all opponents' cards. **GAME-BREAKING cheating vector.**
- **Fix:** Either (a) create a `game_state_public` view that strips other players' hands, or (b) move hand delivery to an authenticated edge function that filters per-player, or (c) store hands in separate rows per player with per-player RLS.

### C2 — GameContext Duplicates Zustand
- **Why:** Incremental development — GameContext was created first, Zustand added later. No migration was completed.
- **Blast radius:** State drift between GameContext and Zustand can cause UI inconsistencies. GameContext has no reset function.
- **Fix:** Migrate all GameContext consumers to Zustand selectors. Remove GameContext entirely.

### C3 — No Minimum App Version Gate
- **Why:** OTA updates use `appVersion` as runtimeVersion, but there's no check at the edge function level to reject outdated clients.
- **Blast radius:** If a Supabase schema migration is deployed, old clients may crash or corrupt data.
- **Fix:** Add `X-App-Version` header to all edge function calls, check against a `minimum_version` config.

### C4 — Auth Tokens in Plaintext
- **Why:** Supabase JS uses AsyncStorage by default for session persistence.
- **Blast radius:** If device is compromised, auth tokens are readable. Not exploitable remotely but fails iOS App Store security review.
- **Fix:** Configure Supabase client with `expo-secure-store` adapter.

### C5 — Missing `waiting_count` Column
- **Why:** The `find-match` edge function references `waiting_count` for Realtime updates, but the column was never added to the DB schema.
- **Blast radius:** Matchmaking queue UI shows stale player counts. UX degradation.
- **Fix:** Add migration: `ALTER TABLE matchmaking_queue ADD COLUMN waiting_count integer DEFAULT 0;` with proper update logic.

### H7 — LiveKit Rooms Never Cleaned Up
- **Why:** The `get-livekit-token` function creates rooms/tokens but no function calls `livekit.rooms.delete()` when a game ends.
- **Blast radius:** Orphaned LiveKit rooms accumulate, consuming LiveKit server resources. At scale, this hits plan limits.
- **Fix:** Add `rooms.delete(roomId)` call in the `complete-game` edge function.

### H20 — No Server-Side Friend Request Rate Limit
- **Why:** Only a 5s client-side throttle in `useFriends.ts`. No DB trigger or edge function enforcement.
- **Blast radius:** Malicious client can spam friend requests, creating harassment and notification spam.
- **Fix:** Add `enforce_friend_request_rate_limit` trigger on `friendships` INSERT.

---

## 5. Hidden Risks ("Works Now, Breaks at Scale")

| # | Risk | Current State | At Scale |
|---|------|--------------|----------|
| 1 | **Rate limit DB query on every game action** | Fast at low volume | Every card play/pass adds a DB round-trip for rate checking. At 100 concurrent games (~400 actions/min), adds significant load. |
| 2 | **LiveKit room accumulation** | Rooms persist silently | After thousands of games, orphaned LiveKit rooms consume plan resources. No cleanup mechanism. |
| 3 | **Per-Deno-isolate rate limiting** | Works with 1 instance | Supabase edge functions scale to multiple isolates. Rate limits (push notifications, analytics proxy) are per-instance, not global. |
| 4 | **Realtime channel limits** | Fine for few games | Supabase free tier: 200 concurrent Realtime connections. Each game room = 4 player connections + presence. 50 games = 200 connections. |
| 5 | **Clock sync single probe** | Adequate for WiFi | Single NTP-style ping with 30s cache. On unstable networks, one bad RTT measurement skews all timers for 30s. |
| 6 | **pg_cron 60s sweep for disconnections** | Reliable | At high player count, the sweep query (`SELECT * FROM room_players WHERE heartbeat_at < NOW() - '60s'`) scans all active players. Needs index on `heartbeat_at`. |
| 7 | **Stale matchmaking entries** | Cleaned on next `find-match` call | If no new matchmaking calls arrive, stale `matched` entries persist indefinitely. Need scheduled cleanup. |
| 8 | **GameContext memory** | Fine for single game | GameContext has no reset. Playing multiple games without app restart accumulates stale references. |
| 9 | **Browser-based translation loading** | Fast for 3 languages | All 600+ keys loaded synchronously on app start. Adding more languages or keys increases cold start. |
| 10 | **Coverage blind spot** | 84.6% reported | Coverage only tracks `src/game/**`, `src/hooks/**`, `src/contexts/**`, `src/services/**`, `src/components/scoreboard/**`. The remaining 20 screens, 30+ components are uncovered. |

---

## 6. Prioritized Remediation Plan

### Sprint 1 — Security & Data Integrity (MUST before launch)

| PR | Tasks | Effort | Dependencies |
|----|-------|--------|-------------|
| **PR-1: Fix game_state hand exposure** | Create `game_state_player_view` function/view that returns only the requesting player's hand + public game state. Update `useRealtime.ts` to call this instead of `select('*')`. | Medium | None |
| **PR-2: Secure auth token storage** | Install `expo-secure-store`, configure Supabase client with SecureStore adapter for session persistence. | Small | None |
| **PR-3: Remove .env.test from git** | Add `.env.test` to `.gitignore`, `git rm --cached .env.test`, rotate Supabase anon key for test project. | Trivial | None |
| **PR-4: Fix waiting_count column** | Add migration for `waiting_count` column, update `find-match` to maintain it. | Small | None |

### Sprint 2 — Reliability & Robustness

| PR | Tasks | Effort | Dependencies |
|----|-------|--------|-------------|
| **PR-5: Minimum app version gate** | Add `X-App-Version` header to API calls, add version check middleware to edge functions, add forced update screen. | Medium | None |
| **PR-6: Fix non-winner idempotency** | Add idempotency guard in `play-cards` for non-winner code path. Fix `player-pass` idempotency. | Small | None |
| **PR-7: Bot-coordinator timing fixes** | Adjust lease timeout to exceed max move execution time. Add wall-clock timeout for consecutive bot turns. | Small | None |
| **PR-8: LiveKit room cleanup** | Add `rooms.delete()` call in `complete-game` edge function. Consider periodic cleanup job. | Small | None |
| **PR-9: Matchmaking race fixes** | Wrap cancel in transaction, fix rollback variable (`matchedUserIds`), add dual-state check. | Medium | None |

### Sprint 3 — State & Testing

| PR | Tasks | Effort | Dependencies |
|----|-------|--------|-------------|
| **PR-10: Eliminate GameContext duplication** | Migrate all GameContext consumers to Zustand selectors. Remove GameContext. Add `resetSession()` on logout/game-end. | Large | None |
| **PR-11: Fix jest roots + add critical tests** | Add `__tests__` to jest roots. Add `useClockSync` and `useTurnInactivityTimer` tests. | Medium | None |
| **PR-12: Expand E2E CI coverage** | Create CI test account with email/password auth, tag offline game + room creation flows as `ci`. | Medium | None |
| **PR-13: Remove unused deps** | Remove `expo-av`, investigate removing `expo-barcode-scanner` + 3 compat plugins. | Small | None |

### Sprint 4 — UX & Polish

| PR | Tasks | Effort | Dependencies |
|----|-------|--------|-------------|
| **PR-14: Performance fixes** | Wrap GameView callbacks in `useCallback`, memoize LandscapeGameLayout, guard Card.tsx `console.error` with `__DEV__`. | Small | None |
| **PR-15: i18n accessibility** | Localize 30+ accessibility labels across 3 languages. | Medium | None |
| **PR-16: Notification fixes** | Fix type mismatch `player_turn`→`your_turn`, enforce server-side preference filtering. | Small | None |
| **PR-17: Friend system hardening** | Add server-side friend request rate limit trigger. Consider `blocked_users` table. | Medium | None |
| **PR-18: Preference schema versioning** | Add `version: 1` + `migrate` to Zustand persist config. | Trivial | None |

### Estimated Total Remediation: 18 PRs across 4 sprints

---

## 7. Corrections Applied to Subagent Findings

During this audit, multiple subagent findings were **verified as FALSE** through direct code inspection. These corrections are critical — they would have led to incorrect remediation work.

| Phase | False Claim | Correction | Evidence |
|-------|------------|------------|----------|
| 1 | "No server-side turn verification" | **WRONG** — Both `play-cards` (line 1015) and `player-pass` (line 500) check `current_turn !== player.player_index` | Direct code read |
| 5 (C1) | "play-cards missing optimistic locking" | **WRONG** — CAS via `total_training_actions` verified at line 1457. `.eq('total_training_actions', totalTrainingActions)` returns `concurrentModificationResponse` on 0 rows | Direct code read |
| 5 (H7) | "Realtime memory leak in useRealtime" | **WRONG** — Cleanup verified at lines 991-1010 (nulls channelRef, calls removeChannel, sweeps ghost channels) | Direct code read |
| 5 (H4) | "get-livekit-token missing room membership check" | **WRONG** — Membership check verified at lines 177-193 | Direct code read |

**Lesson:** Always verify subagent CRITICAL claims with direct code inspection before including in final report.

---

## Appendix A — What's Working Well

The audit identified many areas of engineering excellence:

1. **Game engine test coverage (94.5%)** — All 8 hand types, 10 straight sequences, tiebreaks, beat validation, one-card-left rule all thoroughly tested
2. **Server-authoritative architecture** — All game logic validated server-side; client is display-only
3. **Reconnection handling** — 3-layer disconnect detection, atomic rejoin RPC, bot replacement lifecycle
4. **Auto-pass timer architecture** — Single 100ms polling per room, ref sync pattern, sequence tracking, race-condition-aware
5. **useConnectionManager** — Excellent ref-based callback pattern with heartbeat backoff
6. **ESLint/TypeScript/Babel/Husky** — All A-grade configuration
7. **Lobby system** — Host transfer, kick/ban, ready check, room cleanup, ghost eviction
8. **Error boundaries** — 4-layer safety net (Global, Game, GameEnd, Scoreboard)
9. **Navigation safety** — Back button guards, swipe disabled in game, confirmation dialogs
10. **Throwables system** — Clean cosmetic overlay with documented risk acceptance and proper rate limiting

---

## Appendix B — Metrics Summary

| Category | Finding Count |
|----------|--------------|
| 🔴 CRITICAL | 12 |
| 🟠 HIGH | 22 |
| 🟡 MEDIUM | 30 |
| 🟢 LOW | 18 |
| **Total** | **82** |

| Category | Breakdown |
|----------|-----------|
| Security | C1, C4, C6, H20, M2, M12 |
| Gameplay Logic | C11, C12, H1, H3, H4, H6, M1, M3, M10 |
| State Management | C2, M5, M6, M30 |
| Testing | C7, C8, C9, C10, H15, H16, H17, H21, H22, M27 |
| Infrastructure | C3, C5, H7, H8, H9, H10, M7, M8, M9, M15, M16, M24, M25, M26 |
| UX/Performance | H2, H11, H12, H13, H14, M4, M11, M13, M14, M17, M18, M19, M20, M21, M22, M23, M28, M29 |
| Code Quality | H18, H19, L1-L18 |

---

*End of Audit Report v2*
