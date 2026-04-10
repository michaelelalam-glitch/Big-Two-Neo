# Big Two Neo — Remediation Checklist

> Generated from Production Audit v3 (April 10, 2026)  
> **58 findings** — ordered by most logical fix sequence (security → integrity → reliability → quality → polish)  
> Checkbox each item as you complete it.

---

## Legend

| Icon | Severity |
|------|----------|
| 🔴 | CRITICAL — launch blocker |
| 🟠 | HIGH — fix before wide release |
| 🟡 | MEDIUM — fix for quality |
| 🔵 | LOW — polish |

---

## TIER 1 — Security: Fix Before Any Users Touch Production
> These are exploitable right now. Do these first, in order.

- [ ] **#1 🔴 P5-1** — `send-push-notification` has **no caller authentication check**. Any client JWT can call this EF and send FCM push notifications to any user's device.  
  **Fix:** Add JWT + room membership check at the top of the function before any FCM call.  
  `apps/mobile/supabase/functions/send-push-notification/index.ts` · L277

- [ ] **#2 🔴 P10-1** — OAuth tokens >2048 bytes fall back to **unencrypted AsyncStorage** (plaintext on device).  
  **Fix:** Force token truncation or switch to chunked SecureStore storage for long tokens.  
  `apps/mobile/src/services/supabase.ts` · L66–77

- [ ] **#3 🔴 P5-2** — `find-match` (highest-volume endpoint) has **no rate limiting** — enables queue flooding / connection pool DoS.  
  **Fix:** Add `rateLimiter` call at function entry (same pattern as play-cards: 10 req / 10s per user).  
  `apps/mobile/supabase/functions/find-match/index.ts` · Full scope  
  *(P7-1 is the same issue cross-referenced from Phase 7 — only one fix needed)*

- [ ] **#4 🟠 P5-4** — `get-rejoin-status` has **no room membership check** — any authenticated user can query rejoin status for any room_id (info disclosure).  
  **Fix:** Verify `auth.uid()` is in `room_players` for the given room before returning status.  
  `apps/mobile/supabase/functions/get-rejoin-status/index.ts` · L39–48

- [ ] **#5 🟠 P5-5** — CORS defaults to wildcard `*` if `ALLOWED_ORIGIN` env var is not set in production.  
  **Fix:** Make `ALLOWED_ORIGIN` required (throw on missing), or default to your production domain.  
  `apps/mobile/supabase/functions/_shared/cors.ts` · L12

- [ ] **#6 🟠 P5-6** — `delete-account` is missing rate limiting and Bearer format validation on a **destructive endpoint**.  
  **Fix:** Add `rateLimiter` (e.g., 3 req/hour) and validate `Authorization: Bearer <token>` header format.  
  `apps/mobile/supabase/functions/delete-account/index.ts` · L16–27

- [ ] **#7 🟠 P10-2** — `EXPO_PUBLIC_FIREBASE_API_SECRET` is **exposed to the client bundle** — allows anyone to forge GA4 analytics events.  
  **Fix:** Move the API secret to `analytics-proxy` EF only; remove `EXPO_PUBLIC_` prefix entirely.  
  `apps/mobile/src/services/analytics.ts` · L69

- [ ] **#8 🟠 P5-7** — `analytics-proxy` rate limiting uses an **in-memory Map per Edge Function isolate** — bypassed under auto-scaling (N isolates × 60 req/min).  
  **Fix:** Move rate limit tracking to the existing `rate_limit_tracking` DB table (already used by other EFs).  
  `apps/mobile/supabase/functions/analytics-proxy/index.ts` · L45–95

---

## TIER 2 — Critical State & Integrity: Fix Before Any Multiplayer Session
> These cause data corruption or broken game state for real players.

- [ ] **#9 🔴 P4-1** — `resetSession()` is defined in `gameSessionSlice.ts` but **is never called**. Stale players, scores, and state from the previous game carry over into the next game.  
  **Fix:** Call `resetSession()` at the start of every new game (on navigation to game screen or on `start_new_match` success).  
  `apps/mobile/src/store/gameSessionSlice.ts` · L130

- [ ] **#10 🔴 P4-2** — The "lost response" recovery path in `realtimeActions.ts` calls `start_new_match` with **fire-and-forget** (`void` / no await) — a failed call leaves the match in a permanently broken state.  
  **Fix:** Await the call, handle errors, surface failure to the user or retry with exponential backoff.  
  `apps/mobile/src/realtime/realtimeActions.ts` · L85–98

- [ ] **#11 🟠 P4-4** — Score history is **dual-persisted** to both AsyncStorage AND the DB `scores_history` table. On rejoin, a race condition can show stale local scores instead of server scores.  
  **Fix:** Make DB the single source of truth; remove AsyncStorage persistence for scores. Read from DB on rejoin.  
  `apps/mobile/src/hooks/useGameStateManager.ts` · L239 / `apps/mobile/src/contexts/ScoreboardContext.tsx` · L127

- [ ] **#12 🟠 P4-5** — Play history is **in-memory only** inside `ScoreboardContext` — lost whenever the app is closed or when a player rejoins.  
  **Fix:** Persist play history to DB `game_state.play_history` column (it already exists server-side) and rehydrate on rejoin.  
  `apps/mobile/src/contexts/ScoreboardContext.tsx` · L44

- [ ] **#13 🟠 P4-3** — `openGameEndModal()` **silently fails and never opens** if `winnerName` is falsy. The game end screen never shows.  
  **Fix:** Add a fallback winner name (e.g., "Player 1") or surface an error boundary rather than silently returning.  i think a good fix would be to block anyone from having that name in the first place
  `apps/mobile/src/contexts/GameEndContext.tsx` · L139–146

---

## TIER 3 — High Reliability: Fix Before Soft Launch
> Timer races, reconnect edge cases, and critical functional gaps.

- [ ] **#14 🟠 P3-4** — `InactivityCountdownRing.onExpired` fires on an **unmounted component** — causes memory leak and potential setState-after-unmount crash.  
  **Fix:** Add `isMounted` ref guard; clear the timeout in `useEffect` cleanup.  
  `apps/mobile/src/components/InactivityCountdownRing.tsx` · L269–274

- [ ] **#15 🟠 P3-1** — `AutoPassTimer` has an `isSynced` dependency that causes a **snapshot jump + ring mismatch** the moment NTP completes mid-countdown.  
  **Fix:** Capture the drift at timer start (snapshot it into a ref) and don't react to subsequent `isSynced` changes.  
  `apps/mobile/src/components/AutoPassTimer.tsx` · L109–124

- [ ] **#16 🟠 P3-2** — `useAutoPassTimer` recalculates `timeRemaining` using live NTP offset — an NTP sync completing mid-countdown **jumps the remaining time**.  
  **Fix:** Same fix as P3-1 — snapshot `clockDrift` at timer start into a local ref.  
  `apps/mobile/src/hooks/useAutoPassTimer.ts` · L194

- [ ] **#17 🟠 P3-3** — `useTurnInactivityTimer` throttle lock is set on first fire and **never cleared on reconnect** — players who reconnect mid-timer see a frozen/stuck timer.  
  **Fix:** Reset the throttle ref whenever the `playerId` or `roomId` changes (add to `useEffect` deps).  
  `apps/mobile/src/hooks/useTurnInactivityTimer.ts` · L294–303

- [ ] **#18 🟠 P2-1** — Auto-play-turn and bot-replacement can both fire at the exact 60-second boundary — a **race condition** where the bot plays the human's card before the human is actually replaced.  
  **Fix:** Add a `status='disconnected'` pre-check in `auto-play-turn` EF before executing any play.  
  `apps/mobile/src/hooks/useTurnInactivityTimer.ts` · L250

- [ ] **#19 🟠 P5-3** — `find-match` rollback UPDATEs are missing `.eq('status', 'processing')` — a concurrent invocation can **reset legitimately-matched players** already in `matched` status.  
  **Fix:** Add `.eq('status', 'processing')` to all rollback UPDATE calls in the error handler.  
  `apps/mobile/supabase/functions/find-match/index.ts` · L381–442

- [ ] **#20 🟠 P12-1** — `handleNotificationData()` is a **stub — tapping any push notification does nothing**. The game/lobby deep link is never navigated to.  
  **Fix:** Implement the handler: parse `notification.request.content.data`, route to game room or lobby based on `notification_type`.  
  `apps/mobile/src/services/notificationService.ts` · L243

---

## TIER 4 — High Quality: Fix During Beta
> Important quality issues that affect player experience under real conditions.

- [ ] **#21 🟠 P14-1** — No live Edge Function integration tests — `play-cards`, `player-pass`, and `complete-game` are all mocked in CI.  
  **Fix:** Add a test Supabase project; write integration tests that hit real EFs with test JWT tokens.  
  `apps/mobile/__tests__/` · Absent

- [ ] **#22 🟠 P14-2** — No RLS policy tests in CI — a migration mistake could silently expose player data.  
  **Fix:** Add `supabase db test` or `pgTAP` tests covering each table's RLS policies (select, insert, update, delete).  
  CI pipeline · Absent

- [ ] **#23 🟠 P14-3** — No multiplayer concurrency/load tests — race conditions in CAS and matchmaking may only manifest under simultaneous load.  
  **Fix:** Add k6 or Artillery load tests targeting `play-cards`, `find-match`, and `start_new_match` with concurrent users.  
  Absent

---

## TIER 5 — Medium Backend Quality
> Edge function hardening and data model cleanup.

- [ ] **#24 🟡 P5-9** — `find-match` trusts **client-provided `skill_rating`** — a cheating user can manipulate their ELO bracket.  
  **Fix:** Ignore client `skill_rating`; query `player_stats.elo_rating` server-side using `auth.uid()`.  
  `apps/mobile/supabase/functions/find-match/index.ts` · L71

- [ ] **#25 🟡 P5-8** — `complete-game` uses SELECT-then-INSERT dedup with a 23505 fallback — a **narrow race window** exists between check and insert.  
  **Fix:** Replace with `INSERT ... ON CONFLICT DO NOTHING` for atomic dedup.  
  `apps/mobile/supabase/functions/complete-game/index.ts` · L380–430

- [ ] **#26 🟡 P5-13** — `find-match` has no runtime validation for `match_type` enum values or `skill_rating` bounds.  
  **Fix:** Validate `match_type` ∈ `['casual', 'ranked']` and `skill_rating` ∈ [0, 5000] at function entry.  
  `apps/mobile/supabase/functions/find-match/index.ts` · L71

- [ ] **#27 🟡 P5-10** — `reconnect-player` and `get-rejoin-status` accept `room_id` without UUID format validation (unlike `mark-disconnected` which has it).  
  **Fix:** Add the same UUID regex check: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.  
  `apps/mobile/supabase/functions/reconnect-player/index.ts` · L44 / `get-rejoin-status/index.ts` · L37

- [ ] **#28 🟡 P5-11** — `player-pass` accepts service-role auth via a JSON body field `_bot_auth` — weaker than header-only auth used by other EFs.  
  **Fix:** Move bot auth verification to the Authorization header; remove body-based auth path.  
  `apps/mobile/supabase/functions/player-pass/index.ts` · L189

- [ ] **#29 🟡 P5-14** — Rate limiter **allows ALL requests** if the `rate_limit_tracking` DB table is inaccessible (availability-first by design). This can be exploited during DB degradation.  
  **Fix:** Consider a fail-closed option (return 503) for high-risk endpoints like `play-cards` and `find-match`, keeping fail-open for lower-risk ones.  
  `apps/mobile/supabase/functions/_shared/rateLimiter.ts` · L50–65

- [ ] **#30 🟡 P5-12** — 6 placeholder migration files exist with no content or documentation.  
  **Fix:** Add `-- placeholder: reserved for <feature>` comments, or delete if no longer needed.  
  `apps/mobile/supabase/migrations/*_placeholder.sql`

- [ ] **#31 🟡 P6-1** — `get-livekit-token` issues tokens for **already-ended or abandoned rooms** because it doesn't check `room.status`.  
  **Fix:** Add `WHERE status = 'active'` to the room lookup query before issuing the token.  
  `apps/mobile/supabase/functions/get-livekit-token/index.ts` · L206–217

- [ ] **#32 🟡 P6-2** — `get-livekit-token` has no rate limiting — users can hammer it to generate unlimited tokens.  
  **Fix:** Add `rateLimiter` call: e.g., 5 tokens/minute per user.  
  `apps/mobile/supabase/functions/get-livekit-token/index.ts` · Full scope

---

## TIER 6 — Medium Client Reliability
> Client-side bugs and UX gaps that affect real users in edge cases.

- [ ] **#33 🟡 P4-6** — `matchNumber` and `isGameFinished` use manual setters in `gameSessionSlice` that can **drift from the DB state** if a Realtime update is missed.  
  **Fix:** Derive both values from the Realtime `game_state.game_phase` subscription rather than manual setters.  
  `apps/mobile/src/store/gameSessionSlice.ts` · L41, L126

- [ ] **#34 🟡 P4-7** — `GameContext` duplicates `layoutPlayers`, `layoutPlayersWithScores`, `playerTotalScores`, and `currentPlayerName` — all already in Zustand store.  
  **Fix:** Remove duplicated state from `GameContext`; consume from Zustand selectors directly in components that need it.  
  `apps/mobile/src/contexts/GameContext.tsx` · L142–145

- [ ] **#35 🟡 P1-1** — Separate `isPlayingRef` / `isPassingRef` guards don't share a mutex — a rapid tap could fire both `playCards` and `passCards` concurrently.  
  **Fix:** Merge into a single `isSubmittingRef` that gates both actions.  
  `apps/mobile/src/hooks/useGameActions.ts` · L193–310

- [ ] **#36 🟡 P1-3** — Stats upload in `useGameStatsUploader` has **no retry logic** — a transient network error silently drops the player's game stats.  
  **Fix:** Wrap the upload call in `edgeFunctionRetry` (already used elsewhere in the codebase).  
  `apps/mobile/src/hooks/useGameStatsUploader.ts` · ~L160

- [ ] **#37 🟡 P2-2** — Connection status transitions have no debounce/hysteresis — a briefly flaky network causes rapid `connected → reconnecting → connected` flicker in the UI indicator.  
  **Fix:** Add a 2-second debounce before transitioning away from `connected`.  
  `apps/mobile/src/hooks/useConnectionManager.ts` · L118–130

- [ ] **#38 🟡 P2-3** — Disconnect timer start time is tracked by 4 different sources (client heartbeat, server sweep, pg_cron, mark-disconnected) — inconsistent anchors cause different countdown lengths per player.  
  **Fix:** Treat `disconnect_timer_started_at` from DB as the single authority; ignore client-side anchor.  
  `apps/mobile/src/hooks/useDisconnectDetection.ts` · L295–330

- [ ] **#39 🟡 P2-4** — HomeScreen active game banner **countdown jumps** when app re-focuses (re-reads `disconnect_timer_started_at` from DB on mount).  
  **Fix:** Capture the remaining time at mount and count down from that; don't re-subtract elapsed time on re-mount.  
  `apps/mobile/src/hooks/useActiveGameBanner.ts` · L197

- [ ] **#40 🟡 P2-5** — `RejoinModal` silently abandons an in-flight `reconnect-player` RPC call if the component unmounts mid-request — leaves the player stranded in a half-reconnected state.  
  **Fix:** Use `AbortController` to cancel the RPC on unmount, or set an `isMounted` ref to gate the `setState` call.  
  `apps/mobile/src/components/RejoinModal.tsx` · L40

- [ ] **#41 🟡 P2-7** — Design-level: a user could deliberately disconnect at the right moment to force a bot to play a bad hand (exploit via timing).  
  **Fix:** Consider adding a brief "surrender penalty" (score penalty + stats mark) when a player disconnects >2× per session.  
  Design-level discussion

- [ ] **#42 🟡 P3-5** — `InactivityCountdownRing` does not clamp a positive clock offset — if the client clock is ahead of the server, the ring **starts already partially depleted**.  
  **Fix:** `const elapsed = Math.max(0, getCorrectedNow() - serverTurnStart)` before computing ring fill.  
  `apps/mobile/src/components/InactivityCountdownRing.tsx` · L80–88

- [ ] **#43 🟡 P7-2** — No explicit timeout UI — the matchmaking screen doesn't tell the user the queue expires in 5 minutes. Users don't know when to retry manually.  
  **Fix:** Show a countdown to queue expiration (use `joined_at + 5min` from the waiting_room record).  
  `apps/mobile/src/screens/MatchmakingScreen.tsx` · L119–127

---

## TIER 7 — Medium Observability & Performance
> Monitoring gaps and render performance issues.

- [ ] **#44 🟡 P8-1** — GA4 `fetch` network failures are silently swallowed with no retry or queue mechanism — analytics data is lost on flaky networks.  
  **Fix:** Add a simple retry queue in `analytics.ts` (persist failed events to AsyncStorage, flush on next successful call).  
  `apps/mobile/src/services/analytics.ts` · L426–433

- [ ] **#45 🟡 P8-2** — Sentry performance profiling is set to 10% — too low to catch production performance regressions reliably.  
  **Fix:** Increase to 25–30% for early production phase; reduce after you have baseline data.  
  `apps/mobile/src/services/sentry.ts` · L105

- [ ] **#46 🟡 P8-3** — Some direct `console.error` calls (e.g., `userPreferencesSlice.ts:123`) bypass the structured logger — they won't appear in Sentry breadcrumbs.  
  **Fix:** Replace direct `console.error` calls with the appropriate namespaced logger.  
  Various files

- [ ] **#47 🟡 P9-1** — Timer auto-pass countdown state lives inside `GameContext.value` — every 100ms tick triggers a re-render of **all context consumers**, not just the timer component.  
  **Fix:** Move auto-pass tick state to a separate dedicated context or component-local state + callback prop.  
  `apps/mobile/src/contexts/GameContext.tsx` · Various

- [ ] **#48 🟡 P9-2** — `Card.tsx` and `InactivityCountdownRing.tsx` use inline object creation for dynamic styles — objects recreated on **every render**, defeating `React.memo`.  
  **Fix:** Move dynamic styles into `useMemo` depending on the variable inputs (color, selected state, etc.).  
  `apps/mobile/src/components/Card.tsx` · L316 / `InactivityCountdownRing.tsx`

- [ ] **#49 🟡 P9-3** — No skeleton screens or shimmer animations for initial data loads — users see a blank screen during the first load.  
  **Fix:** Add `<Skeleton />` placeholders for the game board, lobby, and scoreboard loading states.  
  Design gap

- [ ] **#50 🟡 P9-4** — Accessibility gaps: limited `testID` attributes, no explicit `accessible={true}` on most interactive elements, no documented VoiceOver/TalkBack testing passes.  
  **Fix:** Audit interactive components; add `accessible`, `accessibilityLabel`, and `accessibilityRole` props. Run VoiceOver on device.  
  Various

---

## TIER 8 — Medium Security Hardening
> These don't have current exploits but are expected by app store reviewers and security auditors.

- [ ] **#51 🟡 P10-3** — No certificate pinning on Supabase/FCM endpoints — vulnerable to MitM on untrusted networks (coffee shops, hotel Wi-Fi).  
  **Fix:** Implement certificate pinning using `@react-native-community/netinfo` + SSL pinning library, or use Network Security Config (Android) + NSExceptionDomains (iOS).  
  Absent

- [ ] **#52 🟡 P10-4** — No app attestation (Google Play Integrity API / Apple App Attest) — modified/rooted clients can call Edge Functions unchecked.  
  **Fix:** Integrate Play Integrity on Android and DeviceCheck/App Attest on iOS; pass attestation token to backend for verification.  
  Absent

- [ ] **#53 🟡 P11-1** — Android notification channel names (`'Game Updates'`, `'Turn Notifications'`, `'Social'`) are **hardcoded in English** — not localized for Arabic or German users.  
  **Fix:** Move channel names to i18n strings; pass translated values when calling `Notifications.setNotificationChannelAsync()`.  
  `apps/mobile/src/services/notificationService.ts` · L99, L108, L115

- [ ] **#54 🟡 P12-2** — Push notification `send-push-notification` EF rate limiting is in-memory per isolate — doesn't survive app restart and scales with isolates.  
  **Fix:** Move rate limit tracking to `rate_limit_tracking` DB table (same fix direction as P8 / analytics-proxy).  
  `apps/mobile/supabase/functions/send-push-notification/index.ts` · Instance-local

- [ ] **#55 🟡 P13-1** — OTA update policy is `ON_ERROR_RECOVERY` — users only receive bug fixes **after a crash + relaunch**. A silent bug fix never reaches them.  
  **Fix:** Switch to `EAGER` or add a foreground check on `AppState` `active` event with `Updates.checkForUpdateAsync()`.  
  `apps/mobile/app.json` · updates config

- [ ] **#56 🟡 P13-2** — No proactive update polling — an app running for 24+ hours in the foreground will never check for OTA updates.  
  **Fix:** Add a periodic poll (e.g., every 60 min on `AppState` active) using `Updates.fetchUpdateAsync()`.  
  `apps/mobile/app.json` · updates config

- [ ] **#57 🟡 P14-4** — LiveKit integration is **fully mocked** (`StubVideoChatAdapter`) in all tests — no test exercises a real video call flow.  
  **Fix:** Add an integration test using a LiveKit test room token against your dev LiveKit instance. Even a connect/disconnect test validates the adapter contract.  
  `apps/mobile/__tests__/useVideoChat.test.ts`

---

## TIER 9 — Low Priority Polish
> Nice-to-haves. Address after launch.

- [ ] **#58 🔵 P1-2** — `setState` inside `useMemo` in `useDerivedGameState.ts` — React anti-pattern, can cause double renders.  
  `apps/mobile/src/hooks/useDerivedGameState.ts` · L45–67

- [ ] **#59 🔵 P1-4** — `TURN_ORDER` hardcoded for 4 players in `state.ts` — needs update if 2/3-player support is added.  
  `apps/mobile/src/game/state.ts` · L478

- [ ] **#60 🔵 P2-6** — Offline rooms (after game ends) still send heartbeats — wasted network traffic.  
  `apps/mobile/src/hooks/useConnectionManager.ts` · L1–40

- [ ] **#61 🔵 P3-6** — Auto-pass Realtime broadcast error is silently swallowed — no log, no Sentry event.  
  `apps/mobile/src/hooks/useAutoPassTimer.ts` · L138

- [ ] **#62 🔵 P4-8** — Selected card IDs are not persisted across rejoin — player loses card selection on reconnect.  
  `apps/mobile/src/contexts/GameContext.tsx` · L119

- [ ] **#63 🔵 P5-15** — ~10 older baseline SECURITY DEFINER functions lack explicit `SET search_path` (pre-dating the blanket hardening migration).  
  `apps/mobile/migrations/00000000000000_baseline.sql` · Various

- [ ] **#64 🔵 P5-16** — N+1 query patterns in `auto-play-turn` (3 sequential queries) and `complete-game` (5+ queries) — inefficient under load.  
  `apps/mobile/supabase/functions/auto-play-turn/index.ts` · L140–180

- [ ] **#65 🔵 P6-3** — LiveKit auto-reconnect on network drop is not implemented — user must manually toggle video chat after losing connection.  
  `apps/mobile/src/hooks/useVideoChat.ts` · Design choice

- [ ] **#66 🔵 P8-4** — Sentry source maps not verified in audit — production stack traces may be unreadable (minified).  
  Build config

- [ ] **#67 🔵 P8-5** — Production log files have no compression or archival — they grow unboundedly on device.  
  `apps/mobile/src/utils/logger.ts` · L110

- [ ] **#68 🔵 P9-5** — Only `GameView` is wrapped in `<Profiler>` — heavy components like `Card`, `CardHand`, and `PlayerInfo` are unmonitored.  
  `apps/mobile/src/screens/GameView.tsx` · L810

- [ ] **#69 🔵 P9-6** — `ChatDrawer` uses `FlatList` instead of `FlashList` — performance degrades for large chat histories.  
  `apps/mobile/src/components/ChatDrawer.tsx` · L77

- [ ] **#70 🔵 P11-2** — No documented RTL layout testing pass for Arabic.  
  QA process gap

- [ ] **#71 🔵 P15-1** — No automated dependency updates (Renovate / Dependabot).  
  `apps/mobile/package.json`

- [ ] **#72 🔵 P15-2** — `depcheck` is not integrated into the CI pipeline — unused dependencies accumulate silently.  
  `apps/mobile/package.json` · scripts

---

## Summary Table

| Tier | Count | Status |
|------|-------|--------|
| 1 — Security (pre-production) | 8 | ☐ |
| 2 — Critical state & integrity | 5 | ☐ |
| 3 — High reliability | 6 | ☐ |
| 4 — High quality (beta) | 3 | ☐ |
| 5 — Medium backend quality | 9 | ☐ |
| 6 — Medium client reliability | 11 | ☐ |
| 7 — Medium observability & performance | 7 | ☐ |
| 8 — Medium security hardening | 7 | ☐ |
| 9 — Low priority polish | 15 | ☐ |
| **TOTAL** | **71** | |

> Note: The audit report's summary table shows 58 findings (5C+14H+27M+12L). The full enumeration above is 71 because Phase 4's 3 HIGH findings (P4-3/4/5) and some LOW items were omitted from the summary count, and P7-1 is a cross-reference of P5-2 (counted once here). The 71-item list above is the definitive ground truth.

---

## Production Readiness Threshold

To reach a **launch-ready** state, complete Tiers 1–4 (22 items):
- All 8 Tier 1 security fixes
- All 5 Tier 2 critical state fixes  
- All 6 Tier 3 high reliability fixes
- All 3 Tier 4 high quality (integration tests)

Completing Tiers 1–4 brings the estimated health score from **72/100 → ~88/100**.
