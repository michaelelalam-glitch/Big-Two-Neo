# Big Two Neo — Production Readiness Audit Plan

**Version:** 1.0  
**Date:** April 2, 2026  
**Scope:** Full codebase, infrastructure, and operational readiness  
**App:** React Native (Expo SDK 54) multiplayer card game with Supabase backend, LiveKit video chat, Sentry monitoring, GA4 analytics

---

## ROLE & EXPECTATION

You are acting as a **Principal Software Architect, QA Lead, and Security Auditor** combined.

Your task is to conduct a **complete, exhaustive, app-specific audit** of this React Native card game — a real-time multiplayer Big Two card game with bot opponents, ranked matchmaking, LiveKit video/audio chat, and Supabase Realtime as the synchronization layer.

**This is not a high-level review.**

You must:

- Inspect every folder, file, and line of code
- Trace full gameplay flows end-to-end (deal → turns → rounds → match → scoring → stats)
- Identify all bugs, race conditions, desync risks, state inconsistencies, and security vulnerabilities
- Challenge all assumptions — if a timer says 30s, verify it's actually 30s everywhere
- Provide **file paths and line numbers** for every finding
- Cross-reference client logic against server-side edge functions for every critical action

**Do not skip anything. If uncertain, investigate deeper rather than assume correctness.**

---

## PHASE 0 — FULL CODEBASE INVENTORY (Prerequisite)

Before auditing anything, produce a complete inventory. **This phase gates all subsequent phases.**

### 0.1 File Inventory
List every file in the repository with:
- File path
- Purpose (one line)
- Category: `core-gameplay` | `ui` | `state` | `backend` | `config` | `test` | `script` | `docs` | `dead-code`

### 0.2 Dead Code & Orphan Detection
Flag ALL of the following for removal review:
- `.bak` / `.backup` files (known: `useConnectionManager.ts.bak`, `usePlayHistoryTracking.ts.bak`, `useRealtime.ts.bak`, `GameScreen.tsx.bak`, `CardHand.tsx.bak`, `GameControls.tsx.bak`, `useMatchmaking.ts.bak`, `GameEndModal.tsx.bak`, `LandscapeYourPosition.tsx.backup`)
- Unused imports and exports
- Functions/hooks that are defined but never called
- Supabase migrations that are placeholder-only
- Files that import from `.bak` files

### 0.3 Architecture Map
Generate:
1. **High-level architecture diagram** (textual): Client ↔ Supabase Realtime ↔ Edge Functions ↔ Database
2. **Data flow map**: UI interaction → Zustand/Context → Supabase RPC/Realtime → Edge Function → DB mutation → Realtime broadcast → all clients update
3. **Dependency graph**: Which hooks depend on which contexts, which contexts depend on which stores
4. **Edge function call map**: Which client files call which of the 17 edge-function entries (16 functions plus the `_shared/` library)

### 0.4 Known Edge Functions (all 18 must be audited)
| Edge Function | Critical Path? | Description |
|---|---|---|
| `play-cards` | **YES** | Core gameplay — validate and execute a card play |
| `player-pass` | **YES** | Core gameplay — pass turn |
| `auto-play-turn` | **YES** | Server-side autoplay when timer expires |
| `bot-coordinator` | **YES** | Manages bot decision-making and execution |
| `complete-game` | **YES** | End-of-game scoring, stats recording, rank updates |
| `start_new_match` | **YES** | Deal cards, initialize match state |
| `reconnect-player` | **YES** | Restore player to active game after disconnect |
| `find-match` | HIGH | Matchmaking queue logic |
| `cancel-matchmaking` | HIGH | Leave matchmaking queue |
| `mark-disconnected` | HIGH | Server marks player as disconnected |
| `get-rejoin-status` | HIGH | Check if player can rejoin a game |
| `update-heartbeat` | HIGH | Keep-alive signal from client |
| `cleanup-rooms` | MEDIUM | Garbage collect stale game rooms |
| `get-livekit-token` | MEDIUM | Generate LiveKit room token for video chat |
| `send-push-notification` | MEDIUM | Deliver push notifications |
| `server-time` | MEDIUM | Clock sync endpoint |
| `delete-account` | LOW | Account deletion (GDPR) |
| `_shared/` | N/A | Shared utilities across edge functions |

---

## PHASE 1 — GAMEPLAY LOGIC AUDIT (CRITICAL)

**This is the highest-priority phase. A bug here = broken game.**

### 1.1 Core Game Flow
Trace the complete lifecycle:
```
Room creation → Lobby → Ready check → Game start → Deal →
Turn 1 (play/pass) → ... → Round end → Score round →
Next round deal → ... → Match end → Final scoring →
Stats upload → Game end modal → Return to lobby or home
```

For **every transition**, verify:
- What triggers it (client action? server event? timer?)
- What state changes occur (Zustand, Context, DB)
- What happens if the trigger fires twice (idempotency)
- What happens if the trigger never fires (timeout/fallback)

### 1.2 Turn System
Audit files: `src/game/engine/game-logic.ts`, `src/hooks/useGameActions.ts`, `src/hooks/useDerivedGameState.ts`, `src/hooks/useGameStateManager.ts`

- Turn indicator correctness (yellow/grey rings on `PlayerInfo.tsx`)
- Turn order enforcement — can a player act out of turn?
- What happens if `play-cards` edge function succeeds but the Realtime broadcast is delayed?
- Verify `current_player_index` transitions correctly through all player counts (2, 3, 4)

### 1.3 Card Validation
Audit files: `src/game/engine/game-logic.ts`, `src/game/engine/utils.ts`, `src/game/engine/constants.ts`, edge function `play-cards`

- Is card validation done on **both** client AND server? (it must be)
- Can a player submit cards they don't hold? (hand spoofing)
- Are all Big Two hand types correctly detected? (singles, pairs, triples, straights, flushes, full houses, four-of-a-kind, straight flushes)
- Edge case: what if two players submit plays simultaneously?

### 1.4 Highest Play Detection & Auto-Pass
Audit files: `src/game/engine/highest-play-detector.ts`, `src/game/engine/auto-pass-timer.ts`, `src/hooks/useAutoPassTimer.ts`, edge function `auto-play-turn`

- Does auto-pass correctly identify when no valid play exists?
- Does it handle all hand types (not just singles)?
- What happens when auto-pass fires but the player already manually played? (race condition)
- Does the auto-pass timer reset correctly on reconnection?

### 1.5 Bot Logic
Audit files: `src/game/bot/index.ts`, `src/hooks/useBotTurnManager.ts`, `src/hooks/useServerBotCoordinator.ts`, edge function `bot-coordinator`

- Do bots follow all Big Two rules without exception?
- Can bot actions desync from the game state?
- When a bot replaces a disconnected player:
  - Does it inherit the correct hand?
  - Does it respect the current table state?
  - Can it act before the state is fully synced?
- Is there a race between client-side bot logic and server-side `bot-coordinator`?
- Who is the source of truth for bot decisions — client or server?

### 1.6 Scoring & Stats
Audit files: edge function `complete-game`, `src/hooks/useGameStatsUploader.ts`, `src/hooks/useMatchEndHandler.ts`, `src/hooks/useGameEndCallbacks.ts`

- Are scores calculated identically on client and server?
- What happens if `complete-game` edge function fails? Is there a retry? Is it idempotent?
- Can a game be scored twice? (duplicate stats)
- Are rank points calculated correctly? Can they go negative? (check `floor_rank_points_at_zero` migration)
- Does the rank progression history (`rank_points_history`) record correctly?

### 1.7 Match System (Multi-Round)
Audit files: `src/hooks/useMatchTransition.ts`, `src/hooks/useMatchEndHandler.ts`, `src/hooks/useMultiplayerScoreHistory.ts`, edge function `start_new_match`

- How does round-to-round transition work?
- What happens if one player disconnects between rounds?
- Is match score accumulated correctly across rounds?
- Can players join mid-match?

---

## PHASE 2 — RECONNECTION & REJOIN LIFECYCLE (CRITICAL)

**This system touches almost every part of the app. It deserves its own phase.**

### 2.1 Disconnect Detection
Audit files: `src/hooks/useDisconnectDetection.ts`, `src/hooks/useConnectionManager.ts`, `src/hooks/useTurnInactivityTimer.ts`, edge functions `mark-disconnected`, `update-heartbeat`

- How is disconnect detected? (heartbeat timeout? Realtime channel disconnect? both?)
- What is the heartbeat interval? Is it consistent between client and server expectations?
- Compare: inactivity timer vs disconnect timer — do they conflict or duplicate logic?
- What happens with rapid disconnect/reconnect cycles? (flaky network)
- Can a player exploit disconnect timing to avoid losing?

### 2.2 Bot Takeover
- When exactly does a bot replace a disconnected player?
- What is the grace period? Is it configurable?
- Does the bot take over mid-turn or only at the start of the player's next turn?
- What if the player reconnects during the bot's decision-making?

### 2.3 Rejoin Flow
Audit files: `src/components/game/RejoinModal.tsx`, edge functions `get-rejoin-status`, `reconnect-player`

- Full flow: App reopens → check rejoin status → show modal → reconnect → restore state
- Is the game state fully restored? (hand, scores, turn, table cards, timer)
- What if the game ended while the player was disconnected?
- What if the player's slot was taken by a bot — does the bot yield correctly?
- What if the player tries to rejoin a room that no longer exists?

### 2.4 Connection Status UI
Audit files: `src/components/ConnectionStatusIndicator.tsx`, `src/hooks/useActiveGameBanner.ts`

- Does the UI accurately reflect connection state for all players?
- Is there a visual indicator for "reconnecting" vs "disconnected" vs "bot-replaced"?

---

## PHASE 3 — CLOCK SYNCHRONIZATION & TIMERS (CRITICAL)

### 3.1 Clock Sync
Audit files: `src/hooks/useClockSync.ts`, edge function `server-time`

- How is clock offset calculated? (single ping? average of N pings?)
- What is the maximum acceptable drift?
- What happens if a player's device clock is 30+ seconds off?
- Are all client-side timers adjusted by the clock offset?

### 3.2 Turn Timer
Audit files: `src/hooks/useAutoPassTimer.ts`, `src/game/engine/auto-pass-timer.ts`, `src/components/game/AutoPassTimer.tsx`

- Is the turn timer driven by server time or client time?
- Do all clients show the same remaining time (±1s)?
- What happens if the timer fires on the client but the server hasn't processed it yet?
- What if the server timer fires but the client's action already arrived?

### 3.3 Inactivity & Disconnect Timers
Audit files: `src/hooks/useTurnInactivityTimer.ts`, related migration `fix_reconnect_clear_timer_and_security`

- Are there multiple overlapping timers? (client-side inactivity, server-side heartbeat, auto-pass timer)
- Do they all agree on the timeout duration?
- Are timers correctly cleared/reset on:
  - Player action
  - Reconnection
  - Round transition
  - Game end

---

## PHASE 4 — STATE MANAGEMENT & HOOKS

### 4.1 Source of Truth Map
Produce a table:

| Data | Source of Truth | Client Cache | Sync Mechanism |
|---|---|---|---|
| Game state (hands, table, turn) | Supabase `game_state` | Zustand `gameSessionSlice` | Realtime subscription |
| User preferences | ? | `userPreferencesSlice` | AsyncStorage? |
| Player presence | ? | ? | Supabase Presence? |
| Scores | ? | ? | ? |

Fill in every piece of game state. **Identify any state that exists in two places without a clear sync mechanism.**

### 4.2 Zustand Store
Audit files: `src/store/gameSessionSlice.ts`, `src/store/userPreferencesSlice.ts`, `src/store/index.ts`

- Are store updates atomic or can partial updates cause inconsistent reads?
- Is the store cleared correctly on game end / room exit?
- Is there stale state leaking between games?

### 4.3 React Contexts
Audit files: all 6 context files in `src/contexts/`

- `GameContext.tsx` vs `gameSessionSlice.ts` — is there duplicated state?
- `ScoreboardContext.tsx` — does it stay in sync with the game state?
- `GameEndContext.tsx` — is it reset before a new match?
- `FriendsContext.tsx` — does it refetch appropriately?
- `NotificationContext.tsx` — memory leak risk from listeners?
- `AuthContext.tsx` — token refresh behavior (see Phase 10)

### 4.4 Custom Hooks (All 47)
For every hook in `src/hooks/`:
- Check dependency arrays for completeness and correctness
- Check for stale closures
- Check `useEffect` cleanup functions — do they cancel timers, unsubscribe channels?
- Check for missing `useCallback`/`useMemo` causing unnecessary re-renders
- **Specific high-risk hooks:**
  - `useRealtime.ts` — does it handle subscription errors? Reconnection?
  - `useGameStateManager.ts` — is it the single orchestrator, or do other hooks also mutate game state?
  - `usePresence.ts` — what happens when presence payloads are out of order?

---

## PHASE 5 — SUPABASE BACKEND

### 5.1 Edge Functions (All 18)
For each edge function:
- **Input validation:** Are all parameters validated? Types checked?
- **Authorization:** Does it verify `auth.uid()` matches the acting player?
- **Idempotency:** Can it be safely called twice with the same input?
- **Error handling:** Does it return meaningful errors? Does it handle DB failures gracefully?
- **Race conditions:** What if two edge functions modify the same row simultaneously? (e.g., `play-cards` and `auto-play-turn` for the same turn)
- **Performance:** Are there N+1 queries? Missing indexes?

### 5.2 Database Schema & RLS
Audit all RLS policies across all 70+ migrations:
- Are RLS policies **consistent**? (Does a later migration accidentally weaken an earlier one?)
- Can a player read another player's hand?
- Can a player modify game state they shouldn't?
- Are `service_role` escalations justified and safe?
- Does every table have RLS enabled?

### 5.3 Migration Chain Integrity
Audit all 70+ migrations in `supabase/migrations/`:
- Are all migrations **idempotent**? (We've had issues — check all `CREATE` statements for `IF NOT EXISTS`)
- Are there placeholder migrations? Why? Can they be removed?
- Do any migrations have `search_path` vulnerabilities? (Copilot flagged this before)
- Are migrations applied in the correct order? Any timestamp collisions?
- **Critical check:** Run a diff between the migration chain and the actual production schema — are they in sync?

### 5.4 Realtime Subscriptions
Audit files: `src/hooks/useRealtime.ts`, `src/hooks/realtimeActions.ts`

- What channels are subscribed to? (game state, presence, broadcast?)
- What happens if a subscription drops silently?
- Are there reconnection handlers?
- Is there a theoretical event ordering issue? (event A arrives before event B but B happened first)
- Is there a maximum payload size that could be exceeded?

### 5.5 Cron Jobs
Audit migration: `cron_process_disconnected_players`

- What does this cron do? How often does it run?
- Can it conflict with a player who is actively reconnecting?
- Is it idempotent?

---

## PHASE 6 — LIVEKIT VIDEO/AUDIO CHAT

### 6.1 Token Security
Audit files: edge function `get-livekit-token`, `src/hooks/useVideoChat.ts`, `src/hooks/LiveKitVideoChatAdapter.ts`

- Is the LiveKit API key/secret only on the server? (never exposed to client)
- Is the token scoped to the correct room?
- What is the token TTL? What happens when it expires mid-game?
- Can a user generate a token for a room they're not in?

### 6.2 Room Lifecycle
- When is a LiveKit room created? (On game start? On first video toggle?)
- When is it destroyed? (On game end? On last participant leave?)
- What happens if the LiveKit room outlives the game?

### 6.3 Performance Impact
- Does video chat degrade gameplay performance? (FPS, memory)
- What happens on low-bandwidth connections?
- Are video streams paused when the app is backgrounded?

### 6.4 UI
Audit files: `src/components/game/LiveKitVideoSlot.tsx`, `src/components/game/VideoTile.tsx`

- Does the video layout work across all device sizes?
- What happens when a video participant disconnects/reconnects?
- Are camera/mic permissions handled gracefully (denied, restricted)?

---

## PHASE 7 — MATCHMAKING SYSTEM

### 7.1 Queue Logic
Audit files: `src/hooks/useMatchmaking.ts`, `src/hooks/useMatchmakingFlow.ts`, `src/screens/MatchmakingScreen.tsx`, edge functions `find-match`, `cancel-matchmaking`

- How does the matchmaking algorithm work? (FIFO? Rank-based? Region-based?)
- What is the timeout? What happens when it expires?
- Can a player be in the matchmaking queue and in a game simultaneously?
- What happens if both players cancel at the exact same time?
- Can stale entries persist in the queue? (check `cleanup-rooms`)

### 7.2 Room Creation from Match
- After a match is found, how is the room created?
- What if one player's client receives the match but the other doesn't?
- Is there a confirmation step?

---

## PHASE 8 — ERROR MONITORING & OBSERVABILITY

### 8.1 Sentry Integration
Audit files: `src/services/sentry.ts`, `src/components/GlobalErrorBoundary.tsx`, `src/components/game/GameErrorBoundary.tsx`

- Is Sentry initialized correctly for both iOS and Android?
- Are source maps uploaded for production builds?
- Is user context attached to errors (user ID, game ID)?
- Are breadcrumbs useful? (or just noise)
- Is there a Sentry performance/tracing integration?
- Are there errors that are **intentionally silenced** that shouldn't be?
- Are there errors that **should be silenced** but aren't? (e.g., expected race conditions)

### 8.2 Error Boundaries
- Does `GlobalErrorBoundary` catch all unhandled errors?
- Does `GameErrorBoundary` allow game recovery or force exit?
- What happens to an in-progress game when an error boundary triggers?

### 8.3 Google Analytics (GA4)
Audit files: `src/services/analytics.ts`

- Are all critical events tracked? (game start, game end, matchmaking, disconnect, reconnect, purchase?)
- Are event parameters within GA4 limits? (event name: 40 chars, param key: 40 chars, param value: 100 chars)
- Is `debug_mode` correctly configured for development vs production?
- Are there duplicate events firing?
- Are there missing events that should exist?

### 8.4 Logging
Audit: `react-native-logs` usage throughout the app

- Are logs structured and useful?
- Is sensitive data (tokens, user IDs) ever logged in production?
- Is there a way to enable verbose logging for production debugging?

---

## PHASE 9 — UI/UX & RENDERING PERFORMANCE

### 9.1 Re-Render Analysis
- Identify components that re-render on every game state change but shouldn't
- Check for missing `React.memo`, `useMemo`, `useCallback` on hot paths
- Are there `useEffect` hooks that trigger cascading re-renders?
- **Specific concern:** Does the game screen re-render the entire card hand on every turn change?

### 9.2 Card Layout & Gestures
Audit files: `src/components/game/Card.tsx`, `src/components/game/CardHand.tsx`, `src/hooks/useCardSelection.ts`

- Does the card fan render correctly for 0-13 cards?
- Does card selection work on all screen sizes (iPhone SE → iPad Pro)?
- Are gestures responsive under heavy load? (mid-animation interactions)
- Is `react-native-reanimated` used correctly? (JS thread vs UI thread)

### 9.3 Orientation & Layout
Audit files: `src/hooks/useOrientationManager.ts`, `src/hooks/useAdaptiveLandscapeLayout.ts`, `src/hooks/useMultiplayerLayout.ts`, all `Landscape*.tsx` components

- Does the game work in both portrait and landscape?
- Is transition between orientations smooth and correct?
- Are all modals (scoreboard, game end, settings) orientation-aware?

### 9.4 Visual State Accuracy
- Do turn indicators (yellow/grey rings) always match the actual current player?
- Are card highlights (selected, playable, unplayable) always correct?
- Are disabled buttons actually disabled? (e.g., Play button when it's not your turn)
- Does the "one card left" alert fire correctly? (`useOneCardLeftAlert.ts`)

### 9.5 Scoreboard
Audit files: `src/components/scoreboard/`, `src/contexts/ScoreboardContext.tsx`

- Does the scoreboard expand/collapse correctly in both orientations?
- Are scores always in sync with the game state?
- Does `PlayHistoryModal` show accurate play history?

---

## PHASE 10 — SECURITY AUDIT

### 10.1 Authentication
Audit files: `src/contexts/AuthContext.tsx`, `src/screens/SignInScreen.tsx`, `src/services/supabase.ts`

- Is the Supabase auth token stored securely? (not in plaintext AsyncStorage)
- What happens when the auth token expires during an active game?
- Is the token refresh mechanism reliable?
- Apple Sign-In: is the flow correct per Apple's requirements?
- Is `delete-account` edge function GDPR-compliant? Does it cascade-delete all user data?

### 10.2 API Security
- Can any edge function be called without authentication?
- Are there functions that use `service_role` key? Is it exposed to the client?
- Can a player call `play-cards` for another player?
- Can a player call `complete-game` prematurely?
- Are all edge function inputs sanitized against injection?

### 10.3 Client-Side Trust
- Is any gameplay logic ONLY enforced on the client? (It shouldn't be)
- Can a modified client send arbitrary game state?
- Are card hands validated server-side on every play?

### 10.4 Data Exposure
- Can a player read other players' hands via Supabase queries?
- Are Realtime channel broadcasts leaking sensitive data?
- Are there any API responses that include more data than the client needs?

### 10.5 Push Notification Security
Audit files: `src/services/pushNotificationService.ts`, `src/services/pushNotificationTriggers.ts`, edge function `send-push-notification`

- Can push notifications be spoofed?
- Is the push token stored/transmitted securely?
- Is there rate limiting on notification sends?

---

## PHASE 11 — INTERNATIONALISATION (i18n)

Audit files: `src/i18n/index.ts`, all files using translation keys

### 11.1 Completeness
- List every hardcoded user-facing string that should use i18n but doesn't
- List every translation key that is defined but never used
- List every translation key that is used but not defined (will show key instead of translation)

### 11.2 Layout
- Do longer translations (e.g., German, French) break any layouts?
- Are there fixed-width containers that will clip translated text?
- Is RTL considered? (Arabic, Hebrew — even if not supported now, is the architecture ready?)

---

## PHASE 12 — PUSH NOTIFICATIONS

Audit files: `src/services/notificationService.ts`, `src/services/pushNotificationService.ts`, `src/services/pushNotificationTriggers.ts`, `src/contexts/NotificationContext.tsx`, `src/screens/NotificationSettingsScreen.tsx`, `src/screens/NotificationsScreen.tsx`, edge function `send-push-notification`

- Is the push token registered on app launch and refreshed when it changes?
- What happens if the user denies notification permission?
- Do notifications contain accurate information?
- Do notification taps deep-link to the correct screen?
- Is there a notification queue or can rapid events flood the user?
- Are notification preferences (settings screen) respected server-side?

---

## PHASE 13 — EXPO OTA UPDATES & BUILD CONFIG

### 13.1 OTA Update Safety
Audit: `app.json` updates config, `eas.json`

- `checkAutomatically: "ON_LOAD"` — what if a player is mid-game and the app reloads with a new bundle?
- Is there a **minimum version gate**? (If the Supabase schema changes, old clients must be rejected)
- Is `runtimeVersion` policy (`appVersion`) correct? Does it prevent incompatible bundles from loading?

### 13.2 Build Configuration
Audit: `app.json`, `eas.json`, `babel.config.js`, `metro.config.js`

- Is New Architecture correctly configured? (`newArchEnabled: true`)
- Is Hermes enabled and working?
- Are native permissions minimal and correct? (camera, mic, photo library — all justified)
- Is `edge-to-edge` Android mode causing layout issues?

### 13.3 Bundle Size
Audit: `scripts/check-bundle-size.js`

- What is the current bundle size?
- Are heavy dependencies tree-shaken? (LiveKit, Sentry, Reanimated, date-fns)
- Is there a bundle size budget and CI gate?
- Cold start time on low-end devices?

---

## PHASE 14 — TESTING COVERAGE & E2E

### 14.1 Unit/Integration Test Inventory
Audit: `__tests__/` folders throughout the codebase, `jest.config.js`

- List every test file and what it covers
- Identify critical paths with **zero test coverage**
- Are integration tests (`test:integration`) actually testing Supabase interactions?
- Are game logic tests comprehensive? (all hand types, edge cases)

### 14.2 E2E Test Inventory (Maestro)
Audit: `e2e/flows/` (11 Maestro YAML files)

| Flow | What It Tests | Sufficient? |
|---|---|---|
| `01_app_launch.yaml` | App launches | |
| `02_game_selection.yaml` | Game mode selection | |
| `03_home_navigation.yaml` | Home screen nav | |
| `04_create_room.yaml` | Room creation | |
| `05_join_room.yaml` | Join room flow | |
| `06_offline_game.yaml` | Single player game | |
| `07_match_history.yaml` | Match history | |
| `08_settings_how_to_play.yaml` | Settings/tutorial | |
| `09_livekit_voice_video.yaml` | Video chat | |
| `10_sign_in_content_check.yaml` | Auth flow | |
| `11_app_relaunch_state.yaml` | State persistence | |

- Are these E2E tests running in CI?
- What critical paths are **not** covered? (e.g., full multiplayer game, reconnection, matchmaking)

### 14.3 Missing Test Scenarios (Must Be Simulated or Theoretically Audited)
- Player disconnects mid-turn (their turn, not their turn)
- Player disconnects during matchmaking
- Player reconnects after bot has played 3 rounds
- Two players submit cards at the exact same time
- Player backgrounds the app for 5 minutes then returns
- Network drops for 10 seconds then recovers
- Player force-kills the app and reopens
- Game with 2, 3, and 4 players (each count has different behavior)
- 100 concurrent games on the same Supabase instance (theoretical)

---

## PHASE 15 — DEPENDENCIES & PROJECT HEALTH

### 15.1 Dependency Audit
- Run `npx depcheck` — list truly unused dependencies
- Run `pnpm audit` — list known vulnerabilities
- Flag critically outdated packages (especially `expo`, `react-native`, `@sentry/react-native`)
- Are version pinning strategies consistent? (some use `^`, some use `~`)

### 15.2 Configuration Health
- Is `.env.example` complete and accurate?
- Are there any secrets committed to the repo? (check `google-services.json`, any `.env` files)
- Is `husky` + `lint-staged` working? (pre-commit hooks)
- Are ESLint and TypeScript configs reasonable?

### 15.3 Throwables / Social System
Audit files: `src/hooks/useThrowables.ts`, `ThrowButton.tsx`, `ThrowablePicker.tsx`, `ThrowablePlayerEffect.tsx`, `ThrowableReceiverModal.tsx`

- Can throwables be spammed? (rate limiting)
- Do they impact game performance or state?
- Are they purely cosmetic or do they have side effects?

---

## PHASE 16 — CROSS-CUTTING CONCERNS

These issues span multiple phases and must be checked as a whole:

### 16.1 App Lifecycle
- What happens when the app is backgrounded mid-game?
- What happens when the app is force-killed?
- What happens on low memory warnings?
- Is game state persisted locally so it can survive process death?

### 16.2 Navigation Safety
Audit: `src/navigation/AppNavigator.tsx`

- Can a user accidentally navigate away from an active game? (hardware back button, swipe gesture)
- Is there a confirmation dialog when leaving a game?
- Are there memory leaks from screen stacks not being cleaned up?
- Does the `big2mobile://` deep link scheme work correctly?

### 16.3 Lobby System
Audit files: `src/hooks/useRoomLobby.ts`, `src/screens/LobbyScreen.tsx`, `src/screens/CreateRoomScreen.tsx`, `src/screens/JoinRoomScreen.tsx`

- Host leave/kick functionality (check `lobby_host_leave_and_kick_rpcs` migration)
- Ban tracking (check `lobby_kick_ban_tracking` migration)
- Ready check enforcement (check `enforce_ready_check_before_start` migration)
- Can a non-host start the game?
- What happens if the host disconnects in the lobby?

### 16.4 Friends System
Audit files: `src/hooks/useFriends.ts`, `src/contexts/FriendsContext.tsx`, `src/components/friends/`

- How are friends stored?
- Can friend requests be abused?
- Is the friend list kept in sync?

---

## DELIVERABLES

### D1. Full Audit Report
Every issue found, no matter how small, with:
- **File path and line number**
- **Category** (gameplay, state, backend, security, performance, UI, i18n, config)
- **Description** of the issue
- **Reproduction steps** (if applicable)

### D2. Severity Classification
| Severity | Definition | Example |
|---|---|---|
| **CRITICAL** | Breaks game, causes desync, data loss, or security breach | Player can see opponent's cards via Realtime |
| **HIGH** | Major UX degradation, logic error, or reliability risk | Timer fires twice causing double-pass |
| **MEDIUM** | Noticeable issue but doesn't break gameplay | Scoreboard flickers on orientation change |
| **LOW** | Cosmetic, code quality, or minor inconsistency | Dead `.bak` file in repository |

### D3. Root Cause Analysis
For every CRITICAL and HIGH issue:
- **Why** it exists (design flaw, implementation bug, missing validation)
- **What system/pattern** caused it (e.g., "no server-side validation for X")
- **Blast radius** — what else could be affected by the same root cause

### D4. Fix Recommendations
For every issue:
- **Exact code changes** required (with file paths and pseudocode)
- **Estimated complexity** (trivial / small / medium / large / architectural)
- **Dependencies** — does this fix require other fixes first?

### D5. Architectural Improvements
- Refactoring recommendations (with justification — don't refactor for fun)
- Simplification opportunities (removing unnecessary abstractions)
- System redesign suggestions (only if warranted)

### D6. Hidden Risks ("Works Now, Breaks at Scale")
Things that function correctly in testing but will fail under production load:
- Database queries without indexes
- Realtime channel limits
- Edge function cold starts
- Concurrent game limits
- Memory leaks that compound over long sessions

### D7. Overall Verdict
- **Health Score:** /10
- **Production Readiness:** YES / YES WITH CONDITIONS / NO
- **Top 5 Issues That Must Be Fixed Before Launch**
- **Estimated Remediation Effort** for critical+high issues

### D8. Prioritised Remediation Plan
A step-by-step execution plan for fixing all critical and high issues:
- Ordered by dependency (fix foundations first)
- Grouped into logical PRs
- Each step: what to change, where, and how to verify

---

## MANDATORY RULES

1. ❌ Do NOT assume anything is correct — verify it
2. ❌ Do NOT skip files — every file must be accounted for in Phase 0
3. ❌ Do NOT give generic advice — every finding must reference specific files and lines
4. ❌ Do NOT suggest fixes without understanding the root cause
5. ✅ When uncertain, investigate deeper rather than glossing over
6. ✅ Cross-reference client code against server code for every gameplay action
7. ✅ Prioritise **depth over speed** — a shallow audit is worthless
8. ✅ Call out contradictions between code and comments/docs
9. ✅ Flag any code that "works by accident" (correct output, wrong logic)
10. ✅ Treat every edge function as an attack surface
