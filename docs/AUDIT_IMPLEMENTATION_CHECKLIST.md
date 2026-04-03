# Big Two Neo — Audit Remediation Implementation Checklist

**Created:** April 2, 2026  
**Source:** [PRODUCTION_AUDIT_REPORT.md](PRODUCTION_AUDIT_REPORT.md)  
**Total Unique Tasks:** 89 (138 audit IDs deduplicated across overlapping phases)  
**Estimated Phases:** 18 (Phase 0 – Phase 17)

---

## Dependency Graph

```
Phase 0  Dead Code & Repo Hygiene ─────────────────────────────────────────────┐
Phase 1  Secret Rotation & Security ───────────────────────────────────────────┤
Phase 2  Database & Migration Fixes ──────┐                                    │
Phase 3  Edge Function Server-Side ───────┤ (depends on Phase 2)               │
Phase 4  Core Game Logic ─────────────────┤ (depends on Phase 3 for context)   │
Phase 5  Timer & Clock Sync ──────────────┤ (depends on Phase 3)               │
Phase 6  Reconnection & Heartbeat ────────┤ (depends on Phases 3 + 5)          │
Phase 7  State Management & Contexts ─────┤                                    │
Phase 8  Matchmaking & Lobby ─────────────┤ (depends on Phases 2 + 7)          │
Phase 9  UI/UX Rendering ────────────────┤ (depends on Phase 7)               │
Phase 10 LiveKit Video/Audio ──────────────┤                                    │
Phase 11 Error Monitoring & Analytics ─────┤ (depends on Phase 3 for proxy EF)  │
Phase 12 i18n, Push, OTA Config ───────────┤                                    │
Phase 13 Rate Limiting & Abuse Prevention ─┤ (depends on Phases 3 + 7)          │
Phase 14 Navigation & App Lifecycle ───────┤                                    │
Phase 15 Performance Optimization ─────────┤ (depends on Phase 4)               │
Phase 16 Dependency Hygiene ───────────────┤                                    │
Phase 17 Integration & E2E Testing ────────┘ (depends on ALL above)             │
                                                                                │
                                            ← All phases flow to completion ────┘
```

**Parallelizable:** Phases 0+1 together. Phases 4+5+7 together (after Phase 3). Phases 9+10+11+12 together (after Phase 7). Phase 16 any time.

---

## Progress Tracker

| Phase | Name | Tasks | CRIT | HIGH | MED | LOW | Status |
|-------|------|-------|------|------|-----|-----|--------|
| 0 | Dead Code & Repo Hygiene | 3 | 0 | 0 | 1 | 0 | ⬜ |
| 1 | Secret Rotation & Security | 3 | 1 | 0 | 0 | 0 | ⬜ |
| 2 | Database & Migration Integrity | 3 | 2 | 0 | 1 | 0 | ⬜ |
| 3 | Edge Function Server-Side Fixes | 7 | 2 | 4 | 0 | 0 | ⬜ |
| 4 | Core Game Logic | 7 | 4 | 1 | 2 | 0 | ⬜ |
| 5 | Timer & Clock Sync | 7 | 2 | 3 | 2 | 0 | ⬜ |
| 6 | Reconnection & Heartbeat | 6 | 2 | 3 | 1 | 0 | ⬜ |
| 7 | State Management & Contexts | 13 | 7 | 5 | 0 | 1 | ⬜ |
| 8 | Matchmaking & Lobby | 4 | 0 | 4 | 0 | 0 | ⬜ |
| 9 | UI/UX Rendering | 6 | 0 | 2 | 4 | 0 | ⬜ |
| 10 | LiveKit Video/Audio | 4 | 0 | 2 | 2 | 0 | ⬜ |
| 11 | Error Monitoring & Analytics | 5 | 0 | 2 | 3 | 0 | ⬜ |
| 12 | i18n, Push, OTA Config | 6 | 2 | 1 | 2 | 1 | ⬜ |
| 13 | Rate Limiting & Abuse Prevention | 2 | 0 | 1 | 1 | 0 | ⬜ |
| 14 | Navigation & App Lifecycle | 3 | 0 | 1 | 1 | 1 | ⬜ |
| 15 | Performance Optimization | 2 | 0 | 0 | 2 | 0 | ⬜ |
| 16 | Dependency Hygiene | 3 | 0 | 2 | 1 | 0 | ⬜ |
| 17 | Integration & E2E Testing | 5 | 0 | 0 | 0 | 0 | ⬜ |
| | **TOTAL** | **89** | **22** | **31** | **23** | **3** | |

> **Note:** 138 audit IDs map to 89 unique implementation tasks after deduplication (e.g., G-01/B-01/SEC-01/B-08 = 1 task). All original audit IDs are cross-referenced below.

---

## Phase 0 — Dead Code & Repository Hygiene

**Why first:** Clean slate. Removes noise and confusion for all subsequent work. Zero risk.  
**Depends on:** Nothing  
**Effort:** Trivial

- [ ] **0.1** Remove all 11 `.bak`/`.backup` files
  - **Files:** `useConnectionManager.ts.bak`, `usePlayHistoryTracking.ts.bak`, `useRealtime.ts.bak`, `useMatchmaking.ts.bak`, `useGameStateManager.ts.bak`, `GameScreen.tsx.bak`, `CardHand.tsx.bak`, `GameControls.tsx.bak`, `GameEndModal.tsx.bak`, `LandscapeYourPosition.tsx.backup`, `useRealtime-timer-cancellation.test.ts.bak`
  - **Command:** `find apps/mobile/src -name "*.bak" -o -name "*.backup" | xargs rm`

- [ ] **0.2** Add `.gitignore` entries for platform config and backup files
  - **File:** `.gitignore`
  - **Add:** `*.bak`, `*.backup`, `google-services.json`, `GoogleService-Info.plist`

- [ ] **0.3** Create `.env.example` template for developer onboarding `[D-04]` `MEDIUM`
  - **File:** `apps/mobile/.env.example`
  - **Content:** All `EXPO_PUBLIC_*` vars with placeholder values and comments

---

## Phase 1 — Secret Rotation & Security Hardening

**Why second:** Blocks ANY deployment. Active secret exposure. Must happen before any push/PR.  
**Depends on:** Phase 0 (`.gitignore` entries)  
**Effort:** Small (ops-heavy, not code-heavy)

- [x] **1.1** Rotate Firebase API keys + remove `google-services.json` from git history `[D-01, SEC-02]` `CRITICAL`
  - **File:** `apps/mobile/google-services.json`
  - **Script:** `apps/mobile/scripts/rotate-firebase-credentials.sh` (automates history rewrite + force-push; key rotation steps are manual prerequisites documented in script comments)
  - **Steps:**
    1. Rotate the Android API key: Google Cloud Console → APIs & Services → Credentials
    2. Run `bash apps/mobile/scripts/rotate-firebase-credentials.sh` (requires `pip3 install git-filter-repo`)
    3. Script rewrites local git history with `git filter-repo` to remove `google-services.json`
    4. Ensure all relevant remote branches and tags are also updated/force-pushed before treating the history purge as complete — collaborators may need to re-clone after rewritten history is published
    5. Revoke old API key in Google Cloud Console → APIs & Services → Credentials once new keys are verified working
  - **Verify:** `git log --all --full-history -- '**/google-services.json'` returns empty
  - **Status:** ✅ Done — old API key (`AIzaSyAG8...`) revoked; new key in place; history purged across all 1458 commits and all branches force-pushed

- [x] **1.2** Remove `usesAppleSignIn: true` from app.json (feature is disabled) `[I-02, O-02]` `CRITICAL`
  - **File:** `apps/mobile/app.json`
  - **Why:** App Store rejection risk — declares entitlement for unused feature
  - **Status:** ✅ Done — removed in Task #657 (Phase 1 Security Hardening)

- [x] **1.3** Update `google-services.json.example` with redacted placeholder keys
  - **File:** `apps/mobile/google-services.json.example`
  - **Status:** ✅ Done — all values use `YOUR_*` placeholders (done in Phase 0 / PR #205)

---

## Phase 2 — Database & Migration Integrity

**Why third:** Foundation layer. All edge function race condition fixes (Phase 3) depend on these DB-level guards being in place first.  
**Depends on:** Nothing (can run parallel with Phase 0+1)  
**Effort:** Small

- [ ] **2.1** Apply UNIQUE INDEX on `game_history(room_id)` to prevent duplicate game completions `[B-03]` `CRITICAL`
  - **File:** New migration `apps/mobile/supabase/migrations/YYYYMMDD_unique_game_history_room.sql`
  - **SQL:** `CREATE UNIQUE INDEX IF NOT EXISTS idx_game_history_unique_room_id ON game_history(room_id) WHERE room_id IS NOT NULL;`
  - **Why:** `complete-game` edge function has SELECT/INSERT race — two clients can insert duplicate records

- [ ] **2.2** Align force_sweep grace period to match disconnect threshold `[R-03]` `CRITICAL`
  - **File:** `apps/mobile/supabase/functions/update-heartbeat/index.ts` lines 207-242
  - **Fix:** Change `FORCE_SWEEP_GRACE_MS` from `55000` to `60000` (or ≥60s)
  - **Why:** Client clock 5s ahead causes premature bot replacement before 60s grace period expires

- [ ] **2.3** Add room membership validation to `mark-disconnected` `[R-10, SEC-06]` `MEDIUM`
  - **File:** `apps/mobile/supabase/functions/mark-disconnected/index.ts` lines 31-39
  - **Fix:** Before marking player disconnected, verify `room_players` row exists for `(room_id, user_id)`
  - **Why:** Currently any authenticated user can mark any other user as disconnected in any room

---

## Phase 3 — Edge Function Server-Side Fixes

**Why here:** Core server integrity. All client-side game logic, timer, reconnection, and matchmaking fixes assume the server is correct. Fixing the server first prevents cascading client workarounds.  
**Depends on:** Phase 2 (migrations must be applied)  
**Effort:** Medium-Large (most complex phase)

- [ ] **3.1** Add server-side hand verification to `play-cards` `[G-01, B-01, SEC-01, B-08]` `CRITICAL`
  - **File:** `apps/mobile/supabase/functions/play-cards/index.ts` ~line 718
  - **Fix:**
    1. Fetch player's current hand from `game_state` JSON (index by `current_turn`)
    2. Verify every card in client's `cards` array exists in the DB hand
    3. Return `400` with error if any card doesn't match
    4. Remove verified cards from hand before updating state
  - **Test:** Unit test with forged card payload → expect rejection

- [ ] **3.2** Add `SELECT...FOR UPDATE` to `find-match` to prevent duplicate matches `[B-02, M-01]` `CRITICAL`
  - **File:** `apps/mobile/supabase/functions/find-match/index.ts` lines 140-187
  - **Fix:** Wrap waiting room query in transaction with `FOR UPDATE SKIP LOCKED`
  - **Existing TODO on line 170** acknowledges this race
  - **Test:** Concurrent RPC calls with same-region players → expect exactly 1 match created

- [ ] **3.3** Add lease refresh to bot-coordinator loop `[B-04]` `CRITICAL → HIGH`
  - **File:** `apps/mobile/supabase/functions/bot-coordinator/index.ts` ~line 146
  - **Fix:** Inside the bot move loop, refresh the coordinator lease every 5s via DB update
  - **Why:** Current lease expires mid-move; second coordinator starts → corrupted game state

- [ ] **3.4** Add turn re-validation to `auto-play-turn` `[R-05]` `HIGH`
  - **File:** `apps/mobile/supabase/functions/auto-play-turn/index.ts` lines 123-138
  - **Fix:** Re-fetch `game_state.current_turn` inside the function, compare with expected player
  - **Why:** Stale `current_turn` from initial fetch could auto-play the wrong player

- [ ] **3.5** Make `expected_match_number` required in `start_new_match` `[B-07]` `HIGH`
  - **File:** `apps/mobile/supabase/functions/start_new_match/index.ts` lines 23-33
  - **Fix:** Return `400` if `expected_match_number` is undefined/null
  - **Why:** Optional param allows silent no-op when match number doesn't align

- [ ] **3.6** Fix `player-pass` service-role rate limit bypass `[B-05]` `HIGH`
  - **File:** `apps/mobile/supabase/functions/player-pass/index.ts` lines 110-125
  - **Fix:** Add audit logging for service-role calls; enforce rate limit regardless of caller role
  - **Why:** Service-role requests bypass rate limiting with no audit trail

- [ ] **3.7** Fix `player-pass` bot-coordinator trigger to await response `[B-06]` `HIGH`
  - **File:** `apps/mobile/supabase/functions/player-pass/index.ts` lines 407-470
  - **Fix:** `await` the bot-coordinator trigger call; if it fails, retry once or return error
  - **Why:** Fire-and-forget failure silently freezes the game — no bot plays after pass

---

## Phase 4 — Core Game Logic Fixes

**Why here:** With server-side validation in place (Phase 3), client game logic fixes can be made with confidence that the server will catch cheats. These are correctness fixes to the card engine.  
**Depends on:** Phase 3 (server validation context)  
**Effort:** Small-Medium

- [ ] **4.1** Fix Full House comparison `>=` → `>` in highest-play-detector `[G-02]` `CRITICAL`
  - **File:** `apps/mobile/src/game/highest-play-detector.ts` lines 560-576
  - **Fix:** Change `>=` to `>` in Full House rank comparison
  - **Why:** Falsely claims hand is unbeatable when opponent has equal rank

- [ ] **4.2** Enforce One Card Left rule in bot `handleFollowing()` for pairs/triples `[G-06]` `CRITICAL`
  - **File:** `apps/mobile/src/game/bot/index.ts` lines 220-240
  - **Fix:** Before bot plays pair/triple when only 1 card remains for opponents, check OCL rule
  - **Why:** Bot ignores OCL rule, playing illegal moves in pairs/triples scenarios

- [ ] **4.3** Fix `handleMatchEnd()` alertShown race condition `[G-05]` `CRITICAL`
  - **File:** `apps/mobile/src/game/state.ts` lines 1180-1220
  - **Fix:** Persist `alertShown` flag in module-level ref or state instead of function-scoped variable
  - **Why:** Flag is local to function scope — can't prevent duplicate alerts across retries

- [ ] **4.4** Add client-side validation to local game state (offline mode) `[G-04]` `CRITICAL`
  - **File:** `apps/mobile/src/game/state.ts` lines 560-630
  - **Fix:** Apply same validation rules as multiplayer — verify played cards exist in hand
  - **Why:** Offline games have zero validation, allowing corrupted state

- [ ] **4.5** Optimize flush recommendation to pick best 5-card combination `[G-07]` `HIGH`
  - **File:** `apps/mobile/src/game/game-logic.ts` lines 407-410
  - **Fix:** Sort same-suit cards by rank descending, take top 5 instead of first 5
  - **Why:** Current implementation takes arbitrary first 5 same-suit cards, not optimal

- [ ] **4.6** Fix `canPassWithOneCardLeftRule()` hand validation `[G-09]` `MEDIUM`
  - **File:** `apps/mobile/src/game/game-logic.ts` lines 700-730
  - **Fix:** Validate that referenced cards are in the player's current hand
  - **Why:** Function checks OCL without verifying card ownership

- [ ] **4.7** Fix `useGameActions` pre-validation to include OCL rule `[G-11]` `MEDIUM`
  - **File:** `apps/mobile/src/hooks/useGameActions.ts` lines 200-205
  - **Fix:** Add One Card Left rule check to the pre-validation pipeline
  - **Why:** Pre-validation skips OCL entirely, allowing illegal plays to reach the server

---

## Phase 5 — Timer & Clock Synchronization

**Why here:** Timer correctness affects reconnection flow (Phase 6), auto-pass, and turn management. Must be correct before fixing reconnection.  
**Depends on:** Phase 3 (server-side auto-play-turn fix)  
**Effort:** Medium

- [ ] **5.1** Decouple `setInterval` and `setTimeout` in auto-pass-timer `[G-03]` `CRITICAL`
  - **File:** `apps/mobile/src/game/auto-pass-timer.ts` lines 111-140
  - **Fix:** Use single timer source — either interval checks remaining time, OR timeout fires once. Not both.
  - **Pattern:** `setInterval` calculates remaining from server timestamp; when ≤ 0, fires completion. Remove independent `setTimeout`.
  - **Why:** Both fire independently causing double auto-pass

- [ ] **5.2** Reset `localTurnStartRef` on every new turn `[R-01]` `CRITICAL`
  - **File:** `apps/mobile/src/hooks/useTurnInactivityTimer.ts` line 341
  - **Fix:** In the turn-change effect, add `localTurnStartRef.current = getCorrectedNow()`
  - **Why:** Stale clock-skew anchor from previous turn carries over, corrupting inactivity calculation

- [ ] **5.3** Add clock-sync deps to `useMemo` in AutoPassTimer `[T-01]` `HIGH`
  - **File:** `apps/mobile/src/components/game/AutoPassTimer.tsx` lines 72-88
  - **Fix:** Add `clockOffset` to dependency array of the `useMemo` computing `remaining`
  - **Why:** Stale `remaining` value on initial animation frame

- [ ] **5.4** Fix offset sticky after timer null window `[T-02]` `HIGH`
  - **File:** `apps/mobile/src/hooks/useClockSync.ts` lines 59-91
  - **Fix:** When timer transitions from null → non-null, recalculate offset from new server timestamp
  - **Why:** If server clock advances during null window, offset becomes stale

- [ ] **5.5** Make `onExpired` callback required in InactivityCountdownRing `[T-03]` `HIGH`
  - **File:** `apps/mobile/src/components/game/InactivityCountdownRing.tsx` line 32
  - **Fix:** Change `onExpired?:` to `onExpired:` in props interface (or add `console.warn` when unbound)
  - **Why:** If parent forgets to bind, ring expires silently — no bot replacement triggered

- [ ] **5.6** Reset all refs in `useTurnInactivityTimer` cleanup `[T-04]` `MEDIUM`
  - **File:** `apps/mobile/src/hooks/useTurnInactivityTimer.ts` lines 404-406
  - **Fix:** In cleanup function, reset `hasExpiredRef.current`, `lastAutoPlayAttemptRef.current`, `localTurnStartRef.current`
  - **Why:** Stale refs on remount cause incorrect timer behavior

- [ ] **5.7** Recalculate offset on timer identity collision `[T-05]` `MEDIUM`
  - **File:** `apps/mobile/src/hooks/useClockSync.ts` lines 88-91
  - **Fix:** Compare full timer identity (not just server timestamp) before skipping recalculation
  - **Why:** Two different timers with same server timestamp share stale offset

---

## Phase 6 — Reconnection & Heartbeat

**Why here:** Depends on timers being correct (Phase 5) and server-side edge functions being reliable (Phase 3). Reconnection is the most user-visible stability concern.  
**Depends on:** Phases 3 + 5  
**Effort:** Medium

- [ ] **6.1** Recalculate clock offset when app returns from background `[R-02]` `CRITICAL`
  - **File:** `apps/mobile/src/hooks/useConnectionManager.ts` ~line 228
  - **Fix:** On `AppState` change to `active`, call `server-time` and recalculate clock offset before resuming heartbeat
  - **Why:** Heartbeat stops in background; on return, accumulated drift corrupts all timer calculations

- [ ] **6.2** Fix ghost disconnect rings on `isEffectivelyActive` flicker `[R-04]` `CRITICAL`
  - **File:** `apps/mobile/src/hooks/useDisconnectDetection.ts` line 355
  - **Fix:** Add debounce (200-500ms) before showing disconnect ring — don't render on transient flicker
  - **Why:** Rapid true→false→true transitions cause visual jarring disconnect indicators

- [ ] **6.3** Auto-reset heartbeat backoff after successful reconnection `[R-06]` `HIGH`
  - **File:** `apps/mobile/src/hooks/useConnectionManager.ts` lines 306-309
  - **Fix:** After a successful heartbeat response, reset backoff counter to 0 and interval to 5s
  - **Why:** Backoff never resets — client stays in reconnecting state indefinitely after recovery

- [ ] **6.4** Propagate reconnect broadcast `send()` failures `[R-07]` `HIGH`
  - **File:** `apps/mobile/supabase/functions/update-heartbeat/index.ts` lines 109-173
  - **Fix:** Check `send()` return value; if failed, retry once or log warning. Don't resolve Promise as success.
  - **Why:** Clients may miss reconnection events because broadcast failure is silently swallowed

- [ ] **6.5** Unify disconnect countdown data source `[R-08]` `HIGH`
  - **File:** `apps/mobile/src/hooks/useActiveGameBanner.ts` lines 185-190
  - **Fix:** Use single data source for countdown calculation (prefer server `last_heartbeat_at` + clock offset)
  - **Why:** Two different calculations using different data → potential countdown mismatch

- [ ] **6.6** Guard `RejoinModal` against stale async reclaim `[R-09]` `MEDIUM`
  - **File:** `apps/mobile/src/components/game/RejoinModal.tsx` lines 36-42
  - **Fix:** Track modal session ID; discard async completions from previous session
  - **Why:** Previous modal's async reclaim can complete on freshly-opened modal with wrong data

---

## Phase 7 — State Management & Context Fixes

**Why here:** Every hook, component, and screen depends on state being correct. Fixing race conditions and leaks here prevents cascading bugs in UI (Phase 9), matchmaking (Phase 8), and features.  
**Depends on:** Phase 3 (server fixes inform which client patterns to keep)  
**Effort:** Large (most tasks, wide surface area)

- [ ] **7.1** Fix AuthContext profile fetch lock — set lock BEFORE promise `[S-02]` `CRITICAL`
  - **File:** `apps/mobile/src/contexts/AuthContext.tsx` lines 96-116
  - **Fix:** Set `isFetchingProfile.current = true` before `const promise = fetchProfile()`, not after
  - **Why:** Race window allows duplicate DB queries + double push token registration

- [ ] **7.2** Fix Realtime channel subscription ghost channels on rapid reconnect `[S-03]` `CRITICAL`
  - **File:** `apps/mobile/src/hooks/useRealtime.ts` lines 379-416
  - **Fix:** Before creating new channel, explicitly `removeChannel()` any existing subscription. Track channel ref and guard against timeout-created duplicates.
  - **Why:** Rapid reconnects create 2+ handlers → duplicate broadcasts → state corruption

- [ ] **7.3** Fix ISO date string comparison causing unnecessary re-renders `[S-04]` `CRITICAL`
  - **File:** `apps/mobile/src/hooks/useRealtime.ts` lines 490-540
  - **Fix:** Parse ISO strings to epoch timestamps for comparison, or use `Date.getTime()` equality
  - **Why:** Every 5s heartbeat triggers full re-render cycle due to string comparison false negatives

- [ ] **7.4** Fix match end score derivation from stale state `[S-05]` `CRITICAL`
  - **File:** `apps/mobile/src/hooks/useMatchEndHandler.ts` lines 91-121
  - **Fix:** Read final scores from the Realtime update payload directly, not from `scoreHistory` state
  - **Why:** React state lags behind Realtime — incomplete score data used for game end

- [ ] **7.5** Eliminate dual sound/vibration persistence `[S-01]` `CRITICAL`
  - **File:** `apps/mobile/src/store/userPreferencesSlice.ts` lines 76-89
  - **Fix:** Remove `soundManager` singleton as source of truth. Single Zustand slice → derive all audio/haptic state from it. `soundManager` reads from store on each call.
  - **Why:** Async failure permanently diverges Zustand state and singleton state

- [ ] **7.6** Deduplicate friend request notifications `[S-06]` `CRITICAL`
  - **File:** `apps/mobile/src/contexts/FriendsContext.tsx` lines 89-107
  - **Fix:** Track seen request IDs in a `Set`; skip if already shown
  - **Why:** Supabase Realtime can deliver duplicates → double notification popup

- [ ] **7.7** Fix NotificationContext listener leak on logout `[S-07]` `CRITICAL`
  - **File:** `apps/mobile/src/contexts/NotificationContext.tsx` lines 162-181
  - **Fix:** Store subscription reference; in logout/cleanup, call `.remove()` on all listeners
  - **Why:** Dead listeners accumulate in Expo.Notifications registry across login/logout cycles

- [ ] **7.8** Add `useCallback` to GameContext handlers `[S-08]` `HIGH`
  - **File:** `apps/mobile/src/contexts/GameContext.tsx` lines 51-67
  - **Fix:** Wrap handler functions in `useCallback` with appropriate deps
  - **Why:** New function reference every render breaks child `useEffect` dependency arrays

- [ ] **7.9** Guard GameEndContext against bogus 0-score data `[S-09]` `HIGH`
  - **File:** `apps/mobile/src/contexts/GameEndContext.tsx` lines 113-133
  - **Fix:** Don't open modal until `final_scores` is non-null and has valid entries
  - **Why:** Modal opens with all-zeros before scores persist to DB

- [ ] **7.10** Make `mark-disconnected` in `useGameCleanup` awaited `[S-10]` `HIGH`
  - **File:** `apps/mobile/src/hooks/useGameCleanup.ts` lines 53-68
  - **Fix:** `await` the RPC call in `beforeRemove`; use navigation's `preventDefault()` + `dispatch` pattern to block removal until complete
  - **Why:** Fire-and-forget may not execute before screen unmount — player not marked disconnected

- [ ] **7.11** Fix `useGameStatsUploader` one-shot guard race `[S-11]` `HIGH`
  - **File:** `apps/mobile/src/hooks/useGameStatsUploader.ts` lines 51-54
  - **Fix:** Set guard flag AFTER all async operations complete (in `finally`), not before. On partial failure, allow retry.
  - **Why:** Guard set before DB+analytics calls finish — partial failure blocks all retries permanently

- [ ] **7.12** Clear `onlineUserIds` when `showOnlineStatus` disabled `[S-12]` `HIGH`
  - **File:** `apps/mobile/src/hooks/usePresence.ts` lines 108-127
  - **Fix:** When `showOnlineStatus` toggles to `false`, set `onlineUserIds` to empty Set
  - **Why:** Stale online presence data visible after user disables the feature

- [ ] **7.13** Fix `useGameStateManager` initialization guard bypass `[G-08]` `HIGH`
  - **File:** `apps/mobile/src/hooks/useGameStateManager.ts` lines 86-102
  - **Fix:** Reset init guard when room ID changes; track the room ID the guard was set for
  - **Why:** Navigation to a different room reuses stale init guard from previous room

---

## Phase 8 — Matchmaking & Lobby

**Why here:** Depends on DB concurrency fixes (Phase 2 — find-match) and state management fixes (Phase 7 — cleanup patterns).  
**Depends on:** Phases 2 + 7  
**Effort:** Medium

- [ ] **8.1** Scope zombie cleanup to matchmaking entries only `[M-02]` `HIGH`
  - **File:** `apps/mobile/src/hooks/useMatchmakingFlow.ts` lines 116, 224
  - **Fix:** Filter `DELETE FROM room_players` by `room.status = 'matchmaking'`, not all user entries
  - **Why:** Current cleanup deletes ALL room_players rows for the user — including mid-game sessions

- [ ] **8.2** Guard lobby navigation against room deletion `[M-03]` `HIGH`
  - **File:** `apps/mobile/src/hooks/useMatchmakingFlow.ts` lines 145, 261
  - **Fix:** After room creation, verify room still exists before `navigate('Lobby')`; handle 404 gracefully
  - **Why:** Host can delete room between creation and navigation → crash in Lobby screen

- [ ] **8.3** Fix cancel ref / in-flight `find-match` RPC race `[M-04]` `HIGH`
  - **File:** `apps/mobile/src/hooks/useMatchmaking.ts` lines 82-87
  - **Fix:** Use AbortController or cancellation token; check `.cancelled` before processing RPC response
  - **Why:** Cancel ref set while RPC in-flight — response arrives after cancel, creating orphaned match

- [ ] **8.4** Add timeout to `lobby_claim_host` RPC `[X-03]` `HIGH`
  - **File:** `apps/mobile/src/hooks/useRoomLobby.ts`
  - **Fix:** Wrap RPC call with `Promise.race([rpc, timeout(10000)])` — show error after 10s
  - **Why:** Hanging RPC freezes UI indefinitely with no recovery path

---

## Phase 9 — UI/UX Rendering

**Why here:** State management must be solid first (Phase 7) — card rendering and UI components read from hooks/contexts.  
**Depends on:** Phase 7  
**Effort:** Small-Medium

- [ ] **9.1** Fix CardHand dual sources of truth `[U-01]` `HIGH`
  - **File:** `apps/mobile/src/components/game/CardHand.tsx` line 151
  - **Fix:** Remove local `displayCards` state. Derive display order from parent `cards` prop + local sort preference. Single source.
  - **Why:** Local state + parent prop diverge → lost card rearrangements

- [ ] **9.2** Fix CardHand sync effect flip-flop race `[U-02]` `HIGH`
  - **File:** `apps/mobile/src/components/game/CardHand.tsx` lines 172-180
  - **Fix:** Use `usePrevious()` to detect actual card set changes (add/remove), not reorder
  - **Why:** Parent reorder + child display fight — visual flip-flop

- [ ] **9.3** Fix Card scale stuck at 0.95 `[U-03]` `MEDIUM`
  - **File:** `apps/mobile/src/components/game/Card.tsx` line 228
  - **Fix:** Ensure `withTiming(1)` runs in all exit paths (tap up, cancel, select)
  - **Why:** If tap and select gestures don't fire simultaneously, scale gets stuck mid-animation

- [ ] **9.4** Fix PlayerInfo avatar scale `useMemo` dependency `[U-04]` `MEDIUM`
  - **File:** `apps/mobile/src/components/game/PlayerInfo.tsx` line 98
  - **Fix:** Add Zustand store value to `useMemo` dependency array
  - **Why:** Avatar won't resize when user changes preference — stale memoized value

- [ ] **9.5** Guard concurrent `applyOrientation` calls `[U-05]` `MEDIUM`
  - **File:** `apps/mobile/src/hooks/useOrientationManager.ts` line 103
  - **Fix:** Add `isApplying` lock ref — skip if already in progress
  - **Why:** Double-tap can trigger overlapping orientation changes → race condition

- [ ] **9.6** Add player name fallback in OCL alert `[U-06]` `MEDIUM`
  - **File:** `apps/mobile/src/hooks/useOneCardLeftAlert.ts` lines 45, 48
  - **Fix:** `player.name || player.username || 'Player'`
  - **Why:** Undefined player name causes crash in alert display

---

## Phase 10 — LiveKit Video/Audio

**Why here:** Relatively independent module. Benefits from state management fixes (Phase 7) but can proceed in parallel.  
**Depends on:** Phase 7 (useRealtime fixes)  
**Effort:** Medium

- [ ] **10.1** Improve iOS WebRTC permission fallback reliability `[L-01]` `HIGH`
  - **File:** `apps/mobile/src/hooks/useVideoChat.ts` line 318
  - **Fix:** Simplify the ~200-line iOS fallback path; use Expo camera permission API where possible; add retry with exponential backoff
  - **Why:** Fallback unreliable on older iOS builds — permission requests silently fail

- [ ] **10.2** Make audio session start/stop idempotent `[L-02]` `HIGH`
  - **File:** `apps/mobile/src/adapters/LiveKitVideoChatAdapter.ts` line 106
  - **Fix:** Track audio session state; no-op on duplicate `start()` or `stop()` calls
  - **Why:** Multiple start/stop cycles can leave audio session in undefined state

- [ ] **10.3** Verify room existence before auto-restore `[L-03]` `MEDIUM`
  - **File:** `apps/mobile/src/hooks/useVideoChat.ts` lines 344-350
  - **Fix:** Check `room_players` DB row exists before connecting to LiveKit room
  - **Why:** Auto-restore reconnects to a LiveKit room that may no longer exist in DB

- [ ] **10.4** Handle partial module load in LiveKitVideoSlot `[L-04]` `MEDIUM`
  - **File:** `apps/mobile/src/components/video/LiveKitVideoSlot.tsx` line 42
  - **Fix:** Check for null module and show fallback UI instead of silently crashing
  - **Why:** Partial module load sets component to null → runtime crash if API mismatch

---

## Phase 11 — Error Monitoring & Analytics

**Why here:** Monitoring code should be fixed after all primary code changes. Ensures monitoring accurately captures real errors, not noise from pre-fix bugs.  
**Depends on:** Phase 3 (for GA4 proxy edge function)  
**Effort:** Medium

- [ ] **11.1** Fix Sentry `beforeSend` environment filter `[E-01]` `HIGH`
  - **File:** `apps/mobile/src/services/sentry.ts` lines 116-130
  - **Fix:** Use `__DEV__` global or `Constants.expoConfig.extra.environment` instead of `event.environment`
  - **Why:** Production build with `__DEV__ = true` bypasses Sentry filter — events lost

- [ ] **11.2** Migrate GA4 API_SECRET to Edge Function proxy `[E-02, SEC-04]` `HIGH`
  - **File:** `apps/mobile/src/services/analytics.ts` line 82-83 + new edge function
  - **Fix:**
    1. Create `analytics-proxy` edge function that holds `API_SECRET` server-side
    2. Client sends events to proxy; proxy forwards to GA4 Measurement Protocol
    3. Remove `EXPO_PUBLIC_GA4_API_SECRET` from client
  - **Why:** API secret bundled in app binary — extractable by decompiling

- [ ] **11.3** Add rate limiting on Sentry breadcrumb capture `[E-03]` `MEDIUM`
  - **File:** `apps/mobile/src/services/sentry.ts` lines 269-330
  - **Fix:** Track breadcrumb count per second; drop after threshold (e.g., 50/s)
  - **Why:** Console capture patches ALL modules with no rate cap → excessive breadcrumb volume

- [ ] **11.4** Enforce GA4 100-char parameter limit on hint tracking `[E-04]` `MEDIUM`
  - **File:** `apps/mobile/src/services/analytics.ts` lines 292-330
  - **Fix:** `.substring(0, 100)` on all string parameter values before sending
  - **Why:** GA4 silently drops events with string params > 100 chars

- [ ] **11.5** Fix logger FileSystem fallback in production `[E-05]` `MEDIUM`
  - **File:** `apps/mobile/src/utils/logger.ts` line 25
  - **Fix:** In production, either persist logs to FileSystem (not console) or route to Sentry breadcrumbs
  - **Why:** Console fallback in prod means logs silently vanish — no debug trail

---

## Phase 12 — i18n, Push Notifications & OTA Config

**Why here:** Polish layer. Core must be stable first. These are user-facing quality issues that don't affect game integrity.  
**Depends on:** Phase 7 (context fixes for NotificationContext)  
**Effort:** Small

- [ ] **12.1** Replace hardcoded English strings in SignInScreen with i18n keys `[I-01]` `CRITICAL`
  - **File:** `apps/mobile/src/screens/SignInScreen.tsx`
  - **Fix:** Replace 3 hardcoded strings with `t('signIn.welcome')`, `t('signIn.prompt')`, `t('signIn.terms')` and add keys to all locale files
  - **Why:** Non-English users see English-only sign-in screen — breaks i18n contract

- [ ] **12.2** Comprehensive i18n key usage audit `[I-03]` `MEDIUM`
  - **Files:** All locale JSON files + all components
  - **Fix:** Run `i18next-parser` or manual grep to find: (a) keys defined but unused, (b) keys used but undefined
  - **Why:** Orphaned and missing keys cause runtime fallback to key names

- [ ] **12.3** Add rate limiting on push notification sends `[P-01]` `HIGH`
  - **File:** `apps/mobile/supabase/functions/send-push-notification/index.ts` or `apps/mobile/src/services/pushNotificationService.ts`
  - **Fix:** Max 1 notification per user per event type per 30s (DB timestamp check or in-memory throttle)
  - **Why:** Can spam "your turn" alerts — especially when timer auto-passes repeatedly

- [ ] **12.4** Fix cold-start notification handler stale dependency `[P-02]` `MEDIUM`
  - **File:** `apps/mobile/src/contexts/NotificationContext.tsx` lines 173-180
  - **Fix:** Use `useRef` to hold latest handler; update ref on dependency change
  - **Why:** Cold-start notification processed with stale closure — may route to wrong screen

- [ ] **12.5** Change OTA `checkAutomatically` to avoid mid-game restarts `[O-01]` `MEDIUM`
  - **File:** `apps/mobile/app.json`
  - **Fix:** Change `"checkAutomatically": "ON_LOAD"` to `"ON_ERROR_RECOVERY"` or implement manual check in non-game screens
  - **Why:** `ON_LOAD` can trigger app restart during active multiplayer game

- [ ] **12.6** Remove `usesAppleSignIn` entitlement (if not done in Phase 1) `[I-02, O-02]` `LOW`
  - **File:** `apps/mobile/app.json`
  - **Covered by:** Task 1.2 — verify it was completed

---

## Phase 13 — Rate Limiting & Abuse Prevention

**Why here:** Server + client cross-cutting concern. Depends on edge function patterns established in Phase 3 and state patterns in Phase 7.  
**Depends on:** Phases 3 + 7  
**Effort:** Medium

- [ ] **13.1** Add friend request rate limiting `[SEC-03, X-02]` `HIGH`
  - **Files:** `apps/mobile/src/hooks/useFriends.ts` + DB RLS policy or edge function
  - **Fix:**
    1. Client-side: Throttle send button (1 request per 5s)
    2. Server-side: RLS policy or edge function check: max 10 pending friend requests per user per hour
  - **Why:** Unlimited friend request spam — harassment vector

- [ ] **13.2** Add server-side throwable rate limiting `[SEC-05, X-05]` `MEDIUM`
  - **Files:** `apps/mobile/src/hooks/useThrowables.ts` + broadcast handler in edge function
  - **Fix:** Validate throwable timestamp server-side before broadcasting; enforce 30s cooldown per user per room
  - **Why:** Client-only 30s cooldown bypassed by modified client → throwable spam

---

## Phase 14 — Navigation & App Lifecycle

**Why here:** Post-state-management-fix. Safe to modify navigation after all context/hook fixes are in place.  
**Depends on:** Phase 7  
**Effort:** Small

- [ ] **14.1** Verify/add Android hardware back button handler in GameScreen `[X-01]` `HIGH`
  - **File:** `apps/mobile/src/screens/GameScreen.tsx` or `apps/mobile/src/navigation/AppNavigator.tsx`
  - **Fix:** Add `BackHandler.addEventListener('hardwareBackPress')` that returns `true` (suppresses) during active game. Show confirmation dialog on back press.
  - **Why:** Accidental back press mid-game exits without confirmation — player marked disconnected

- [ ] **14.2** Add `memoryWarning` listener to free resources `[X-04]` `MEDIUM`
  - **File:** `apps/mobile/src/navigation/AppNavigator.tsx`
  - **Fix:** Listen to `AppState` memory warning event; clear non-essential caches (image cache, sound preloads)
  - **Why:** App doesn't free resources under memory pressure — risk of OS kill

- [ ] **14.3** Increase deep link replay delay for slow devices `[X-06]` `LOW`
  - **File:** `apps/mobile/src/navigation/AppNavigator.tsx`
  - **Fix:** Replace 300ms hardcoded delay with retry-until-ready pattern (check if navigator is mounted before replaying)
  - **Why:** 300ms insufficient on slow devices → deep link silently dropped

---

## Phase 15 — Performance Optimization

**Why here:** Performance after correctness. These optimizations are safe to do once game logic is verified correct (Phase 4).  
**Depends on:** Phase 4  
**Effort:** Medium

- [ ] **15.1** Optimize bot O(n⁵) 5-card combo search `[G-10]` `MEDIUM`
  - **File:** `apps/mobile/src/game/bot/index.ts` lines 485-510
  - **Fix:** Add memoization for repeated hand evaluations. Consider pruning impossible combos before nested loops. Cache evaluation results per turn.
  - **Why:** 1287 combinations per turn on 13-card hand — noticeable lag on slow devices

- [ ] **15.2** Optimize `useDerivedGameState` O(n²) card ordering `[G-12]` `MEDIUM`
  - **File:** `apps/mobile/src/hooks/useDerivedGameState.ts` lines 42-55
  - **Fix:** Use a `Map<cardId, index>` for O(1) lookup instead of nested `.find()`/`.indexOf()`
  - **Why:** O(n²) reconstruction on every update — wasteful for 13 cards max

---

## Phase 16 — Dependency Hygiene

**Why here:** Maintenance work that doesn't affect runtime. Can be done any time but best after all code changes to avoid churn.  
**Depends on:** Nothing (can be done in parallel)  
**Effort:** Small

- [ ] **16.1** Pin `react-native` version exactly `[D-02]` `HIGH`
  - **File:** `apps/mobile/package.json`
  - **Fix:** Change `"react-native": "0.81.5"` to exact pin (remove any `^` or `~`)
  - **Why:** Semver micro-upgrades can introduce breaking changes in React Native

- [ ] **16.2** Audit `@sentry/react-native` for CVEs `[D-03]` `HIGH`
  - **Fix:** Run `pnpm audit` or check `snyk test` for `@sentry/react-native@^8.5.0`
  - **Action:** If CVEs found, upgrade to patched version. If clean, document last audit date.

- [ ] **16.3** Finalize `.env.example` with all required variables `[D-04]` `MEDIUM`
  - **File:** `apps/mobile/.env.example`
  - **Verify:** Cross-reference all `process.env.EXPO_PUBLIC_*` references in codebase with `.env.example` entries

---

## Phase 17 — Integration & E2E Testing

**Why LAST:** Tests validate all implementation fixes. Writing tests before fixing bugs creates fragile tests that need rewriting. All 16 phases of fixes should be done first.  
**Depends on:** ALL previous phases  
**Effort:** Large

- [ ] **17.1** Add multiplayer E2E test — full 4-player game flow
  - **File:** New Maestro flow `apps/mobile/e2e/flows/multiplayer-full-game.yaml`
  - **Coverage:** Room create → 4 join → play → win → scores → rematch
  - **Validates:** Phases 3, 4, 5, 7, 8

- [ ] **17.2** Add reconnection scenario E2E tests
  - **File:** New test `apps/mobile/__tests__/integration/reconnection.test.ts`
  - **Coverage:** Network drop → heartbeat timeout → bot replacement → rejoin → reclaim
  - **Validates:** Phases 5, 6, 7

- [ ] **17.3** Add concurrent card play stress tests
  - **File:** New test `apps/mobile/__tests__/integration/concurrent-plays.test.ts`
  - **Coverage:** 4 clients submit simultaneous plays → only current-turn player succeeds
  - **Validates:** Phases 3, 4

- [ ] **17.4** Add matchmaking timeout edge case tests
  - **File:** New test `apps/mobile/__tests__/integration/matchmaking-edge-cases.test.ts`
  - **Coverage:** 30s/60s timeouts, cancel during in-flight RPC, zombie cleanup during active game
  - **Validates:** Phases 2, 3, 8

- [ ] **17.5** Add server-side combo validation tests for play-cards
  - **File:** New test `apps/mobile/supabase/functions/play-cards/__tests__/validation.test.ts`
  - **Coverage:** Valid hand → accepted; forged cards → rejected; empty hand → rejected; duplicate cards → rejected
  - **Validates:** Phase 3

---

## Audit ID Cross-Reference

Every audit ID mapped to its implementation task:

| Audit ID | Task | Phase |
|----------|------|-------|
| G-01 | 3.1 | 3 |
| G-02 | 4.1 | 4 |
| G-03 | 5.1 | 5 |
| G-04 | 4.4 | 4 |
| G-05 | 4.3 | 4 |
| G-06 | 4.2 | 4 |
| G-07 | 4.5 | 4 |
| G-08 | 7.13 | 7 |
| G-09 | 4.6 | 4 |
| G-10 | 15.1 | 15 |
| G-11 | 4.7 | 4 |
| G-12 | 15.2 | 15 |
| R-01 | 5.2 | 5 |
| R-02 | 6.1 | 6 |
| R-03 | 2.2 | 2 |
| R-04 | 6.2 | 6 |
| R-05 | 3.4 | 3 |
| R-06 | 6.3 | 6 |
| R-07 | 6.4 | 6 |
| R-08 | 6.5 | 6 |
| R-09 | 6.6 | 6 |
| R-10 | 2.3 | 2 |
| T-01 | 5.3 | 5 |
| T-02 | 5.4 | 5 |
| T-03 | 5.5 | 5 |
| T-04 | 5.6 | 5 |
| T-05 | 5.7 | 5 |
| S-01 | 7.5 | 7 |
| S-02 | 7.1 | 7 |
| S-03 | 7.2 | 7 |
| S-04 | 7.3 | 7 |
| S-05 | 7.4 | 7 |
| S-06 | 7.6 | 7 |
| S-07 | 7.7 | 7 |
| S-08 | 7.8 | 7 |
| S-09 | 7.9 | 7 |
| S-10 | 7.10 | 7 |
| S-11 | 7.11 | 7 |
| S-12 | 7.12 | 7 |
| B-01 | 3.1 | 3 |
| B-02 | 3.2 | 3 |
| B-03 | 2.1 | 2 |
| B-04 | 3.3 | 3 |
| B-05 | 3.6 | 3 |
| B-06 | 3.7 | 3 |
| B-07 | 3.5 | 3 |
| B-08 | 3.1 | 3 |
| L-01 | 10.1 | 10 |
| L-02 | 10.2 | 10 |
| L-03 | 10.3 | 10 |
| L-04 | 10.4 | 10 |
| M-01 | 3.2 | 3 |
| M-02 | 8.1 | 8 |
| M-03 | 8.2 | 8 |
| M-04 | 8.3 | 8 |
| E-01 | 11.1 | 11 |
| E-02 | 11.2 | 11 |
| E-03 | 11.3 | 11 |
| E-04 | 11.4 | 11 |
| E-05 | 11.5 | 11 |
| U-01 | 9.1 | 9 |
| U-02 | 9.2 | 9 |
| U-03 | 9.3 | 9 |
| U-04 | 9.4 | 9 |
| U-05 | 9.5 | 9 |
| U-06 | 9.6 | 9 |
| SEC-01 | 3.1 | 3 |
| SEC-02 | 1.1 | 1 |
| SEC-03 | 13.1 | 13 |
| SEC-04 | 11.2 | 11 |
| SEC-05 | 13.2 | 13 |
| SEC-06 | 2.3 | 2 |
| I-01 | 12.1 | 12 |
| I-02 | 1.2 | 1 |
| I-03 | 12.2 | 12 |
| P-01 | 12.3 | 12 |
| P-02 | 12.4 | 12 |
| O-01 | 12.5 | 12 |
| O-02 | 1.2 | 1 |
| D-01 | 1.1 | 1 |
| D-02 | 16.1 | 16 |
| D-03 | 16.2 | 16 |
| D-04 | 0.3 | 0 |
| X-01 | 14.1 | 14 |
| X-02 | 13.1 | 13 |
| X-03 | 8.4 | 8 |
| X-04 | 14.2 | 14 |
| X-05 | 13.2 | 13 |
| X-06 | 14.3 | 14 |
| Dead code (11 files) | 0.1 | 0 |

---

## Completion Checklist

- [ ] Phase 0 complete (3/3)
- [ ] Phase 1 complete (3/3)
- [ ] Phase 2 complete (3/3)
- [ ] Phase 3 complete (7/7)
- [ ] Phase 4 complete (7/7)
- [ ] Phase 5 complete (7/7)
- [ ] Phase 6 complete (6/6)
- [ ] Phase 7 complete (13/13)
- [ ] Phase 8 complete (4/4)
- [ ] Phase 9 complete (6/6)
- [ ] Phase 10 complete (4/4)
- [ ] Phase 11 complete (5/5)
- [ ] Phase 12 complete (6/6)
- [ ] Phase 13 complete (2/2)
- [ ] Phase 14 complete (3/3)
- [ ] Phase 15 complete (2/2)
- [ ] Phase 16 complete (3/3)
- [ ] Phase 17 complete (5/5)
- [ ] **ALL 89 TASKS COMPLETE — PRODUCTION READY**
