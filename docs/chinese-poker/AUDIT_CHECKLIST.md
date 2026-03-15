# Big-Two-Neo — Audit Fix Checklist

Track progress on all audit findings. Check off items as they are resolved.

---

## 🔴 Critical — Fix First

- [x] **C1** — Fix unbounded array growth in `GameStateManager`
  - **File:** `apps/mobile/src/game/state.ts`
  - **Task:** #629
  - **Fix:** Added `matchNumber` field to `RoundHistoryEntry`; tagged every push to `gameRoundHistory` with the current match number; added prune logic in `startNewMatch()` to filter entries older than `currentMatch - 20` once the session exceeds 20 matches. Also prunes on `loadState()` so users upgrading from older builds don't hit OOM before their first new match. `played_cards` was already correctly cleared per match (no change required).
  - **Branch:** `task/629-fix-unbounded-array-growth`
  - **Why:** `gameRoundHistory` grew indefinitely across matches → OOM on 2GB RAM devices; pruning caps in-memory + AsyncStorage serialised state to the last 20 matches of entries.

- [x] **C2** — Fix `setInterval` timer leak on component unmount
  - **File:** `apps/mobile/src/game/state.ts`, `apps/mobile/src/hooks/useGameStateManager.ts`
  - **Task:** #630
  - **Fix:**
    - `state.ts`: removed `this.startTimerCountdown()` from the constructor; it is now called lazily at the end of `initializeGame()` and `loadState()` so the 100ms interval only runs while an active game session exists.
    - `useGameStateManager.ts` cleanup: added `gameManagerRef.current = null` after `destroy()` so any in-flight async continuation inside `initGame()` can detect unmount and abort.
    - `useGameStateManager.ts` `initGame()`: added three abort guards (`if (gameManagerRef.current !== manager)`) after each `await` (clearState, loadState, initializeGame) to prevent subscribing to or restarting the timer on a discarded manager.
  - **Branch:** `task/630-fix-timer-interval-leak`
  - **Why:** 100ms interval ran permanently from manager creation regardless of game state. If `destroy()` was skipped (e.g. component unmounted during async init before `gameManagerRef.current` was visible to the cleanup), the interval leaked forever, draining battery and executing stale callbacks.

- [x] **C3** — Fix broken push notification edge function
  - **File:** `apps/mobile/supabase/functions/send-push-notification/index.ts` (~line 67)
  - **Task:** #632
  - **Fix:** Removed the duplicate `const now = Math.floor(Date.now() / 1000)` declaration at ~line 67 inside `getAccessToken()`. The first `const now` (line 55, used for the cache-validity guard) is already in scope for the JWT `iat`/`exp` payload and `tokenExpiryTime` assignment — both reads used the same timestamp anyway. Added inline comment explaining the reuse to prevent future confusion.
  - **Branch:** `task/632-fix-push-notification-syntax-error`
  - **Why:** `SyntaxError: Identifier 'now' has already been declared` crashed the Deno runtime on every cold start — push notifications were never delivered for game invites or turn reminders.

- [x] **C4** — Remove `.bak` files from version control
  - **Task:** #631
  - **Branch:** `task/631-remove-bak-files`
  - **Verification:** `git ls-files -- '*.bak'` produces no output — no `.bak` files are tracked. The `*.bak` rule was present in `.gitignore` since commit `d92779a` (2026-03-08), so the workspace `.bak` files were never committed.
  - **Local `.bak` artifacts** (gitignored, never tracked; count may vary as developers create/remove workspace files):
    - `apps/mobile/src/screens/GameScreen.tsx.bak`
    - `apps/mobile/src/components/game/CardHand.tsx.bak`
    - `apps/mobile/src/components/game/GameControls.tsx.bak`
    - `apps/mobile/src/components/gameEnd/GameEndModal.tsx.bak`
    - `apps/mobile/src/hooks/useMatchmaking.ts.bak`
    - `apps/mobile/src/hooks/useRealtime.ts.bak`
    - `apps/mobile/src/hooks/useGameStateManager.ts.bak`
    - `apps/mobile/src/hooks/useConnectionManager.ts.bak`
    - `apps/mobile/src/hooks/usePlayHistoryTracking.ts.bak`
    - `apps/mobile/src/hooks/__tests__/useRealtime-timer-cancellation.test.ts.bak`
  - **Status:** `.gitignore` already contains `*.bak`. No further action required in version control.

- [x] **C5** — Fix complete-game deduplication (4x stats + 4x history rows)
  - **Files:** `apps/mobile/supabase/functions/complete-game/index.ts`, `apps/mobile/supabase/migrations/20260313000001_dedup_game_history_and_fix_stats.sql`
  - **Branch:** `task/fix-dedup-stats-reconnect`
  - **Fix:** Added deduplication guard in the edge function — checks for existing `game_history` row by `room_id` before INSERT. Returns 200 with `duplicate: true` for subsequent callers. Also handles `23505` (unique constraint violation) as a belt-and-suspenders race-condition guard. SQL migration deletes existing duplicates and adds a `UNIQUE` partial index on `room_id WHERE room_id IS NOT NULL`. Added `stats_applied_at` marker column (migration 20260313000002) so duplicate callers can distinguish "still in progress" from "truly failed". Step 3b now uses `status = 'finished'` consistently across all paths; `LobbyScreen` Play Again check widened to accept both `'ended'` and `'finished'`.
  - **Why:** In a 4-human game, all 4 clients independently call `complete-game` when `game_phase → 'game_over'`. Without dedup: 4 `game_history` rows inserted, `update_player_stats_after_game` called 4× per player (quadrupling all stats, ELO, streaks, combos). First caller also deleted `room_players` in Step 3b, causing subsequent callers to fail voided-player computation.

- [x] **C6** — Fix room connect timeout on rejoin after force-close
  - **File:** `apps/mobile/src/screens/MultiplayerGame.tsx`
  - **Branch:** `task/fix-dedup-stats-reconnect`
  - **Fix:** Added retry logic (4 total attempts — attempt 0 + 3 retries — with exponential backoff: 1s, 2s, 4s) to the `multiplayerConnectToRoom` call in the mount `useEffect`. Added `suppressConnectErrorsRef` to suppress intermediate `onError` toasts while retries are in-flight; cleared immediately on success so post-connection errors remain visible. Cleanup resolves the pending delay Promise immediately so the async chain exits without hanging.
  - **Why:** "Room query timeout after 5 seconds" error on first attempt after force-close; user had to manually navigate back and rejoin.

- [x] **C7** — Fix broadcast channel name mismatch preventing rejoin game state refresh
  - **Files:** `apps/mobile/supabase/functions/reconnect-player/index.ts`, `apps/mobile/supabase/functions/update-heartbeat/index.ts`, `apps/mobile/src/screens/MultiplayerGame.tsx`
  - **Branch:** `task/fix-rejoin-broadcast-channel`
  - **Fix:** `reconnect-player` and `update-heartbeat` edge functions broadcast `player_reconnected` to `room:${roomRow.code}` (human-readable code like "LZEVGK"), but the client subscribes to `room:${roomId}` (UUID). The broadcast never reached the client, so `fetchGameState` was never called after reclaiming a seat from a bot → stale game view with wrong hand/turn. Fixed all edge function broadcasts to use `room:${room_id}` (UUID). Also added explicit `refreshGameState()` call in `handleReclaimSeat` as belt-and-suspenders fallback.
  - **Why:** After tapping "Reclaim My Seat", the game state didn't refresh — user saw errors or stale data and had to navigate back and rejoin manually for it to work.

---

## 🟠 High Priority

- [x] **H1** — Extract disconnect logic into a dedicated hook/reducer ✅
  - **File:** `apps/mobile/src/screens/MultiplayerGame.tsx` lines 580–842
  - **Task:** #633
  - **Fix:** Created `apps/mobile/src/hooks/useDisconnectDetection.ts` with `useReducer`-based `clientDisconnections` Map and explicit action types (`SEED`, `CORRECT`, `CLEAR`, `REPLACE`). Explicit states per remote seat: `connected → timeout_pending → disconnected → replaced_by_bot`. Full unit-test suite in `apps/mobile/src/hooks/__tests__/useDisconnectDetection.test.ts`.
  - **Why:** 263-line `useEffect` with 6+ nesting levels is untestable and error-prone

- [x] **H2** — Wrap `GameView` in `React.memo`
  - **File:** `apps/mobile/src/screens/GameView.tsx`, `apps/mobile/src/screens/MultiplayerGame.tsx`, `apps/mobile/src/screens/LocalAIGame.tsx`
  - **Task:** #635
  - **Branch:** `task/635-wrap-gameview-react-memo`
  - **Fix:**
    - `GameView.tsx`: Renamed inner function to `GameViewComponent`; added `export const GameView = React.memo(GameViewComponent)` at bottom with explanatory comment.
    - `MultiplayerGame.tsx`: Destructured `setIsPlayHistoryOpen` and `setIsScoreboardExpanded` from `scoreboardContext`; wrapped `togglePlayHistory` and `toggleScoreboardExpanded` in `useCallback` (deps `[setIsPlayHistoryOpen]` / `[setIsScoreboardExpanded]`) so their references are stable; replaced two inline arrow functions in the JSX with the stable callbacks.
    - `LocalAIGame.tsx`: Same `useCallback` pattern applied (both screens pass the same two props).
  - **Why:** Without memo, every heartbeat or realtime tick triggers a full 50-prop subtree re-render. The two inline arrow functions for scoreboard toggles recreated a new function reference on every parent render, defeating `React.memo`. With `useCallback` + stable React setState-setter deps, both callbacks are permanently stable references.

- [x] **H3** — Migrate `InactivityCountdownRing` to Reanimated UI thread
  - **File:** `apps/mobile/src/components/game/InactivityCountdownRing.tsx`
  - **Task:** #634
  - **Branch:** `task/634-inactivity-ring-reanimated`
  - **Fix:**
    - Removed `requestAnimationFrame` loop + `useState(progress)` + `setProgress` at ~15fps.
    - Replaced with `useSharedValue` (progress 0→1), `withTiming(0, { duration: remaining, easing: Easing.linear })` scheduled in a `useEffect` — animation runs entirely on the UI thread with zero JS-thread re-renders during the sweep.
    - `useAnimatedProps` worklet computes `strokeDasharray`, `strokeDashoffset`, and `stroke` color per frame without touching the JS thread.
    - `Animated.createAnimatedComponent(Circle)` connects animated props to the SVG arc.
    - `typeShared` (`useSharedValue<'turn'|'connection'>`) lets the worklet pick the correct color when `type` prop changes without re-creating the animation. The scheduling `useEffect` depends only on `startedAt`; a separate `useEffect` keeps `typeShared.value` in sync so the arc worklet reads the updated color on the next UI-thread frame with no per-frame JS-thread updates and no `withTiming` re-schedule (a `type` prop change does still trigger one React render, but the arc depletion countdown is uninterrupted).
    - `cancelAnimation(progress)` in effect cleanup prevents stale `runOnJS(onExpired)` calls after unmount or re-schedule.
    - Unit tests added: `InactivityCountdownRing.test.tsx` — 19 tests covering render, scheduling, arc geometry, color thresholds, onExpired, and clock-skew paths.
    - Reanimated mock in `setup.ts` extended with `useAnimatedProps`, `cancelAnimation`, and `Easing.linear`.
  - **Why:** RAF + setState fired JS-thread re-renders at ~15fps — every tick competed with game logic (heartbeat state, card animations). With Reanimated UI-thread, JS is only touched once on mount and once on expiry.

- [x] **H4** — Consolidate `GameView` props into `GameContext`
  - **Files:** `apps/mobile/src/contexts/GameContext.tsx` (NEW), `apps/mobile/src/screens/GameView.tsx`, `apps/mobile/src/screens/MultiplayerGame.tsx`, `apps/mobile/src/screens/LocalAIGame.tsx`
  - **Task:** #638
  - **Branch:** `task/638-gameview-game-context`
  - **Fix:**
    - Created `GameContext.tsx` — defines `GameContextType` (mirrors the old `GameViewProps`), exports simple named types `LayoutPlayer` / `LayoutPlayerWithTimer`, provides `GameContextProvider` and `useGameContext()` hook (throws if used outside a provider).
    - `GameView.tsx`: removed the `GameViewProps` interface and all 50+ prop parameters; `GameViewComponent` now calls `useGameContext()` at the top and destructures from there. `React.memo` wrapper retained — it now prevents any re-render that isn't driven by a context-value change.
    - `MultiplayerGame.tsx`: imports `GameContextProvider` + `GameContextType`; builds `gameContextValue` via `React.useMemo` with full dep array (keeps reference stable so `React.memo` on `GameView` still bails out when game-visible state is unchanged); wraps `<GameView />` in `<GameContextProvider value={gameContextValue}>`.
    - `LocalAIGame.tsx`: same pattern as `MultiplayerGame.tsx`; `<GameView />` is wrapped in `<GameContextProvider value={gameContextValue}>`.
    - TypeScript: 0 errors. Unit tests: 1110 passed (integration suites requiring live Supabase credentials remain skipped).
  - **Why:** 50 individual props made `GameView` API incomprehensible, forced calling code to list every prop explicitly (blocking refactors), and undermined `React.memo` effectiveness (any new callback risked recreating a reference). Context eliminates the prop explosion, centralises the game-view model, and makes individual child components able to subscribe to exactly the slice they need in future.

- [x] **H5** — Split `HomeScreen.tsx` into focused modules ✅ **(branch: `task/637-split-homescreen`)**
  - **File:** `apps/mobile/src/screens/HomeScreen.tsx` (1,643 LOC → **544 LOC**)
  - **Task:** #637
  - **Implemented:**
    - `apps/mobile/src/hooks/useActiveGameBanner.ts` — all banner state, `checkCurrentRoom` (with `useFocusEffect`), `handleTimerExpired`, `handleLeaveCurrentRoom`, `handleBannerResume/Leave`, `handleReplaceBotAndRejoin`, `checkGameExclusivity`, `voluntarilyLeftRooms` AsyncStorage logic
    - `apps/mobile/src/hooks/useMatchmakingFlow.ts` — all matchmaking RPC state (`isQuickPlaying`, `isRankedSearching`, modals), `handleQuickPlay`, `handleRankedMatch`, `handleCasualMatch`, `handleOfflinePractice`, `handleStartOfflineWithDifficulty`
    - `HomeScreen.tsx` reduced to **544 LOC** (imports + two hook calls + JSX coordinator + styles); eliminates all recursive `setTimeout` polling
  - **TypeScript:** 0 errors. Unit tests: 1110 passed (integration suites requiring live Supabase credentials remain skipped).
  - **Why:** Screen handles UI + matchmaking RPC + room cleanup + polling + AsyncStorage — impossible to test

---

## 🟡 Medium Priority

- [x] **M1** — Move root scripts to `scripts/` directory ✅ **(branch: `task/636-move-scripts-to-scripts-dir`)**
  - **Location:** `/apps/mobile/*.mjs`, `/apps/mobile/*.sh` (18 files)
  - **Task:** #636
  - **Implemented:**
    - **Moved to `scripts/`** (permanent utilities): `apply-migration.mjs`, `apply-migration.sh`, `check-schema.mjs`, `cleanup-stuck-rooms.mjs`, `debug-game-state.mjs`, `diagnose-bot-cards.mjs`, `test-start-game.mjs`, `deploy-edge-functions.sh`
    - **Deleted** (already-applied one-offs): `apply-fix-json-encoding.mjs`, `apply-fix-json-encoding.sh`, `apply-fix-navigation-bug.sh`, `apply-game-state-migration.mjs`, `apply-matchmaking-auto-start-fix.mjs`, `apply-rls-fix.mjs`, `apply-turn-timer-fix.sh`, `APPLY_AUTOPLAY_FIX.sh`, `APPLY_TIMER_FIXES_NOW.sh`, `TEST_AUTOPLAY_FIX.sh`
    - **Moved to `docs/chinese-poker/`**: `APPLY_CARD_FIX_MIGRATION.md`, `AUTHENTICATION_SETUP_GUIDE.md`, `AUTOPLAY_FIX_DOCUMENTATION.md`, `TIMER_FIXES_SUMMARY.md`, `TROUBLESHOOTING_AUTOPLAY.md`, `TURN_TIMER_FIX_SUMMARY.md`
    - **Created** `apps/mobile/scripts/README.md` documenting all scripts with usage
  - **Why:** 18 files at root polluted workspace and confused `ls` output

- [x] **M2** — Squash Supabase migrations into a baseline
  - **Location:** `apps/mobile/supabase/migrations/` (131 files → 45 files: 1 baseline + 44 March 2026 incremental)
  - **Task:** #640
  - **Branch:** `task/640-squash-supabase-migrations`
  - **Fix:** Concatenated 80 pre-March-2026 timestamped migrations into a single `apps/mobile/supabase/migrations/00000000000000_baseline.sql` (~11,590 lines, ~372 KB). Kept 44 March 2026 incremental migrations (45 files total: 1 baseline + 44 incremental). Deleted 7 ad-hoc SQL files (`APPLY_FIX_NOW.sql`, `DELETE_STUCK_ROOMS.sql`, `EMERGENCY_FIX.sql`, `FIX_UPDATED_AT_COLUMN.sql`, `TEST_20251225000001_room_code_generation.sql`, `combined_migration.sql`, `fix-critical-bugs-dec26.sql`) that were not proper timestamped migrations. Each original migration is preserved as a commented `-- Source:` header inside the baseline for traceability. _(Exact line count is approximate; it grows slightly with each review-cycle schema-completeness fix — do not hard-code an exact count here.)_
    - **Schema-completeness additions** (not part of the squashed migrations — needed because these items were historically managed via the Supabase dashboard rather than migrations, or because the legacy `players` table is absent on fresh installs):
      - `CREATE TABLE IF NOT EXISTS rooms (...)` prepended with **all** columns known to be needed on a fresh DB: `id`, `code`, `host_id`, `status`, `max_players`, `fill_with_bots`, `is_public`, `is_matchmaking`, `bot_coordinator_id`, `ranked_mode`, `game_mode`, `bot_difficulty`, `started_at`, `ended_at`, `updated_at`, `created_at`. The columns `started_at`/`ended_at` are set inside baseline function bodies; `game_mode`/`bot_difficulty` are SELECTed from `rooms` in post-baseline migration 20260308000004 — all four were created via the dashboard and absent from every prior migration, causing `supabase db reset` to fail with column-not-found errors.
      - `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_matchmaking` guard added before its first use (column was also dashboard-only).
      - `ALTER TABLE rooms ADD CONSTRAINT rooms_code_unique UNIQUE (code)` wrapped in a `DO $$ IF NOT EXISTS (pg_constraint check) $$` block to make it idempotent — prevents "already exists" error on incremental-migration upgrade paths.
      - `update_rooms_updated_at()` trigger: fixed `NEW.updated_at = NOW()` → `NEW.updated_at := NOW()` (PL/pgSQL canonical assignment operator).
      - Added file-header note explaining that existing databases must mark the baseline as applied via `supabase migration repair --status applied 00000000000000` rather than running it directly (it contains non-idempotent operations safe only for fresh `db reset`).
      - All top-level DDL referencing the **legacy `players` table** (`ALTER TABLE players`, `CREATE INDEX ON players`, `CREATE POLICY ON players`, `COMMENT ON COLUMN players`, and related `ASSERT`/DO-block operations) wrapped in `DO $$ BEGIN IF to_regclass('public.players') IS NOT NULL THEN ... END IF; END $$;` guards. The `players` table was superseded by `room_players` and no longer exists on fresh installs; without these guards `supabase db reset` fails with "relation players does not exist".
      - Duplicate-room cleanup (STEP 1 of the room-code uniqueness block): fixed `r1.id < r2.id` UUID comparison → `r1.created_at < r2.created_at OR (same AND r1.id < r2.id)`. The original UUID comparison had no chronological meaning (UUID v4 values are random); using `created_at` with `id` as a tiebreaker correctly preserves the oldest room as documented.
    - **SQL content of the 80 squashed migrations is otherwise faithful**: the concatenated function bodies, RLS policies, indexes, and triggers are identical to the originals; the schema-completeness guards and corrections listed above are the only deviations.
  - **Why:** 131 migration files slowed CI, local DB reset, and made schema reasoning difficult. Reduced to 45 files (66% fewer).

- [x] **M3** — Eliminate matchmaking race condition
  - **File:** `apps/mobile/src/hooks/useMatchmaking.ts`
  - **Task:** #641
  - **Branch:** `task/641-fix-matchmaking-race-condition`
  - **Fix:**
    - Removed `setInterval` polling entirely — `subscribeToWaitingRoom` (Realtime) is now the **single** source of truth for match detection. Eliminates the race where both the 2s polling interval and the Postgres-change event could call `setMatchFound` / `clearInterval` / `removeChannel` concurrently.
    - Removed `checkForMatch` function (was the polling callback).
    - Removed `pollIntervalRef` (no interval to track).
    - Added `isStartingRef` — prevents a second concurrent call to `startMatchmaking` (e.g. user double-tapping "Find Match") from registering a duplicate Realtime subscription while the first `find-match` Edge Function call is still in-flight.
    - Added `isCancelledRef` — set to `true` at the **top** of `cancelMatchmaking()` before any async work, so any Realtime event arriving after cancel (possible due to Supabase channel buffering) is silently ignored. A second guard inside the async room-code fetch also checks this flag, covering the race where the Realtime event arrives before cancel but the room-code DB fetch completes after cancel.
    - `subscribeToWaitingRoom` now calls `supabase.removeChannel` when a match is detected, so the channel is torn down immediately rather than waiting for the next cancel/unmount.
    - Unmount cleanup: now sets `isCancelledRef.current = true` in addition to removing the channel (prevents in-flight room-fetch callbacks from setting state after the component is gone).
    - **Tests:** 18 new unit tests in `apps/mobile/src/hooks/__tests__/useMatchmaking.test.ts` covering: no-poll invariant, immediate match, Realtime-driven match detection, `isCancelledRef` guards (both Realtime callback and async room-fetch paths), `isStartingRef` debounce, `cancelMatchmaking` teardown, unmount cleanup, `resetMatch`, auth failure, and invalid-response error paths.
    - Updated `apps/mobile/src/__tests__/__mocks__/supabase.ts`: added `auth.getUser` and `functions.invoke` to the shared mock so this and future tests can mock them without duplicating the stub.
  - **Why:** Polling + Realtime fired simultaneously, duplicating game-start actions and causing double state transitions.

- [x] **M4** — Replace O(N) `.find()` lookups with O(1) Map in `useMultiplayerLayout`
  - **File:** `apps/mobile/src/hooks/useMultiplayerLayout.ts`
  - **Task:** #639
  - **Branch:** `task/639-optimize-multiplayer-layout-map`
  - **Fix:** Added `playerByIndexMap` useMemo (`new Map(multiplayerPlayers.map(p => [p.player_index, p]))`) immediately after the hook argument destructure, depending only on `[multiplayerPlayers]`. Replaced all 13 `multiplayerPlayers.find(pl => pl.player_index === idx)` calls with `playerByIndexMap.get(idx)`:
    - `multiplayerLastPlayedBy` (1 call) → `playerByIndexMap.get(playerIdx)` — dep array tightened from `[multiplayerLastPlay, multiplayerPlayers]` to `[multiplayerLastPlay, playerByIndexMap]`
    - `multiplayerLayoutPlayers` — `getName`, `isDisconnected`, `getDisconnectTimerStartedAt` each call the Map for 4 seats (12 total) — dep array tightened from `[multiplayerPlayers, …]` to `[playerByIndexMap, …]`
    - `multiplayerSeatIndex` lookups are by `user_id`/`human_user_id` (not `player_index`) — unchanged (separate concern, already correct).
  - **Why:** 13 linear O(N) `.find()` calls per memo re-evaluation (12 in `multiplayerLayoutPlayers` + 1 in `multiplayerLastPlayedBy`). With N=4 players each scan is short, but the map eliminates the repeated array iteration entirely and scales cleanly if player count increases.

- [x] **M5** — Add missing ESLint peer dependencies
  - **File:** `apps/mobile/package.json`
  - **Task:** #642
  - **Branch:** `task/642-644-fix-deps`
  - **Fix:** Added 5 missing explicit `devDependencies` that `.eslintrc.js` requires but were only transitively available (causing ESLint to silently fall back to wrong plugin versions):
    - `@typescript-eslint/parser@^8.50.0`
    - `@typescript-eslint/eslint-plugin@^8.50.0`
    - `eslint-plugin-react@^7.37.5`
    - `eslint-plugin-react-hooks@^5.2.0`
    - `@jest/globals@~29.7.0` (used directly in 2 test files: `five-card-combo-classification.test.ts`, `LandscapeIntegration.test.ts`)
  - **Why:** Missing peer deps cause ESLint to fail silently or use wrong plugin versions; `@jest/globals` was imported but absent from `devDependencies`

- [x] **M6** — Remove unused `expo-linear-gradient`
  - **File:** `apps/mobile/package.json`
  - **Task:** #644
  - **Branch:** `task/642-644-fix-deps`
  - **Fix:** Ran `pnpm remove expo-linear-gradient`. No production source file imports it — `GameEndModal.tsx` had only a comment referencing it; `LandscapeOvalTable` never imported it. Removed stale `jest.mock('expo-linear-gradient', ...)` from two test files (`LandscapeOvalTable.test.tsx`, `GameEndModal.test.tsx`) that were mocking a package no longer in the dependency graph. 26/26 affected tests still pass.
  - **Why:** Confirmed unused by source-code grep; adds native build weight (React Native module link) for no benefit

---

## 🟢 Low Priority

- [ ] **L1** — Add Error Boundaries around game screens
  - **Files:** `apps/mobile/src/navigation/AppNavigator.tsx`, `apps/mobile/src/screens/MultiplayerGame.tsx`
  - **Task:** #643
  - **Fix:** Create `apps/mobile/src/components/ErrorBoundary.tsx`. Wrap game screen stack in `AppNavigator` with `<GameErrorBoundary onRetry={reset}>`. Log errors to Sentry/LogRocket in `componentDidCatch`.
  - **Why:** Any unhandled JS exception shows a blank white screen with no recovery path

- [ ] **L2** — Add VoiceOver / accessibility support
  - **Files:** `apps/mobile/src/components/game/Card.tsx`, `apps/mobile/src/components/game/GameControls.tsx`
  - **Task:** #645
  - **Fix:**
    - Add `accessibilityLabel`, `accessibilityRole="button"`, `accessibilityState={{ selected: isSelected }}` to `Card`
    - Add `AccessibilityInfo.announceForAccessibility("Your turn")` in `GameControls` when local player turn begins
    - Add `accessibilityHint` to play/pass buttons
  - **Why:** App is completely unusable with VoiceOver enabled

- [ ] **L3** — Configure deep linking for room codes
  - **File:** `apps/mobile/src/navigation/AppNavigator.tsx`, `app.json`
  - **Task:** #646
  - **Fix:** Add `scheme: "bigtwo"` to `app.json`. Configure `linking` prop on `NavigationContainer` with route `bigtwo://room/:roomCode`. Handle incoming URL in `useMatchmaking`.
  - **Why:** Players cannot share room links; hurts onboarding and social virality

- [ ] **L4** — Expand Zustand store to reduce prop drilling
  - **File:** `apps/mobile/src/store/index.ts`
  - **Task:** #647
  - **Fix:** Migrate auth state, current room metadata, active game state, and UI preferences into Zustand slices. Remove equivalent React context providers where possible.
  - **Why:** Store exists but is mostly empty — context and prop drilling persist throughout the app

- [ ] **L5** — Increase card touch targets to iOS HIG 44px minimum
  - **Files:** `apps/mobile/src/components/game/Card.tsx`, `apps/mobile/src/utils/cardOverlap.ts`
  - **Task:** #650
  - **Fix (quick):** Add `hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}` to the card gesture handler
  - **Fix (better):** Reduce overlap percentage in `cardOverlap.ts` for portrait orientation
  - **Fix (best UX):** Fan arc layout that fans cards upward on long-press
  - **Why:** At 70%+ overlap, visible card width is ~22px — below the 44px HIG minimum

---

## 📦 Feature Backlog (implement after C1–H3 are resolved)

- [ ] **F1** — In-game text chat
  - **Task:** #648
  - **Approach:** Supabase Realtime broadcast on the room channel. Collapsible chat drawer from bottom of game screen. Rate limit: 1 msg/2s per player server-side.
  - **Prerequisite:** C1, C2, H2 complete (memory + render stability)

- [ ] **F2** — In-game voice chat
  - **Task:** #649
  - **Approach:** Evaluate Agora SDK, LiveKit, or Daily.co. Push-to-talk toggle in `GameControls`. Mute indicator per player in `PlayerInfo`. Requires microphone permission flow.
  - **Prerequisite:** F1 complete

- [ ] **F3** — In-game video + audio chat *(in-progress — Task #651)*
  - **Task:** #651
  - **Approach:** Opt-in floating video tiles anchored near each `PlayerInfo`. Use same SDK as F2 (LiveKit recommended — supports audio + video). Camera permission required.
  - **Prerequisite:** F2 complete
  - **PR:** [#134](https://github.com/michaelelalam-glitch/Big-Two-Neo/pull/134)
  - **Implementation (Task #651 — Phase 1: SDK-decoupled scaffold):**
    - `apps/mobile/src/hooks/useVideoChat.ts` — `VideoChatAdapter` interface + `StubVideoChatAdapter` (no-op); manages opt-in state, camera + mic permissions, and remote participant map; real LiveKit/Daily.co adapter is a follow-up when `@livekit/react-native` + `react-native-webrtc` are installed
    - `apps/mobile/src/components/game/VideoTile.tsx` — 64×64 PiP tile; renders placeholder icon (no SDK) or `videoStreamSlot` (real SDK); Pressable for local player (tap to toggle), View for remote (read-only)
    - `apps/mobile/src/contexts/GameContext.tsx` — Added 7 new video+audio chat fields: `videoChatEnabled`, `isLocalCameraOn`, `isLocalMicOn`, `remoteCameraStates`, `remoteMicStates`, `toggleVideoChat`, `toggleMic`
    - `apps/mobile/src/screens/MultiplayerGame.tsx` — `useVideoChat` wired; `remoteCameraStates` built from `remoteParticipants`
    - `apps/mobile/src/screens/LocalAIGame.tsx` — no-op stub values provided for all 7 new GameContext video+audio chat fields
    - `apps/mobile/src/components/game/PlayerInfo.tsx` — `VideoTile` rendered as absolute overlay (top-left, zIndex 12) inside `avatarContainer`
    - `app.json` — iOS: `NSCameraUsageDescription` + `NSMicrophoneUsageDescription` added to `infoPlist`; Android: `android.permission.CAMERA` added to `permissions` (`RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` already existed and were unchanged by this PR). Both camera and microphone permissions are intentionally included in Phase 1 because the scaffold wires `useVideoChat` which manages both video and audio streams.
    - **Tests:** 40 new unit tests (VideoTile: 17, useVideoChat: 23); all passing

---

## Strategic Recommendation: Fix Order vs. Feature Order

**Recommended sequence:**

```
C1 → C2 → C3 → C4    (1–2 days)   — stability must-haves
H1 → H2 → H3          (3–5 days)   — render/memory performance
                        ↓
                   Begin text chat (F1) design + implementation
                        ↓
H4 → H5 → M1–M4   (parallel, 1–2 weeks) — refactoring
                        ↓
                   Voice chat (F2) → Video chat (F3)
                        ↓
L1–L5              (ongoing polish)
```

**Why this order:**
- **C1 (OOM)** and **C2 (timer leak)** worsen with more concurrent features running. Fix first.
- **C3 (push notifications broken)** means players won't receive game invites — critical for social features.
- **H2 (React.memo)** — adding chat panels to an already re-render-heavy screen will cause severe jank without this.
- **H3 (InactivityCountdownRing RAF)** — adding video tiles to an app already doing RAF+setState every tick will drop frames.
- **Safe to start in parallel now:** Text chat design spec; WebRTC provider evaluation (Agora vs LiveKit vs Daily.co); microphone permission flow design.

---

*Last updated: March 2026 — Full codebase audit*
