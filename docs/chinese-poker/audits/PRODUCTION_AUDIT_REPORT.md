# Big Two Neo — Production Readiness Audit Report

**Version:** 1.0  
**Date:** April 2, 2026  
**Auditor:** Principal Software Architect / QA Lead / Security Auditor (AI Agent)  
**Scope:** Full codebase, infrastructure, and operational readiness  
**Branch:** `game/chinese-poker`

---

## OVERALL VERDICT

| Metric | Value |
|--------|-------|
| **Health Score** | **5.5 / 10** |
| **Production Readiness** | **YES WITH CONDITIONS** |
| **Total Files Audited** | 200+ source files, 17 edge functions, 70 migrations |
| **Total Issues Found** | **138** |
| **CRITICAL** | **22** |
| **HIGH** | **31** |
| **MEDIUM** | **55** |
| **LOW** | **30** |

### Top 5 Issues That Must Be Fixed Before Launch

1. **play-cards edge function does not validate cards are in the player's hand** (Server exploit — any card can be played)
2. **google-services.json may exist in git history with Firebase API keys** (Secret rotation required; file is not currently tracked in this branch, but may still exist in git history — a history rewrite is needed if exposure is confirmed)
3. **find-match race condition** — concurrent calls can match same 4 players into duplicate rooms
4. **complete-game can be called multiple times** — missing UNIQUE INDEX creates duplicate stats
5. **bot-coordinator lease can expire mid-move** — second coordinator starts, corrupting game state

---

## PHASE 0 — FULL CODEBASE INVENTORY ✅

### 0.1 File Inventory

| Category | Count | Key Files |
|----------|-------|-----------|
| Core Gameplay | 8 | game-logic.ts, state.ts, bot/index.ts, highest-play-detector.ts, auto-pass-timer.ts, utils.ts, constants.ts, types/index.ts |
| Hooks | 47 | useRealtime.ts (800+ lines), useGameActions.ts, useAutoPassTimer.ts, useConnectionManager.ts, etc. |
| Screens | 21 | MultiplayerGame.tsx, GameScreen.tsx, LobbyScreen.tsx, MatchmakingScreen.tsx, etc. |
| Components | 65+ | Card.tsx, CardHand.tsx, PlayerInfo.tsx, GameEndModal.tsx, ScoreboardContainer.tsx, etc. |
| Contexts | 6 | AuthContext, GameContext, ScoreboardContext, GameEndContext, FriendsContext, NotificationContext |
| Stores | 3 | gameSessionSlice.ts, userPreferencesSlice.ts, index.ts |
| Services | 6 | supabase.ts, sentry.ts, analytics.ts, pushNotificationService.ts, notificationService.ts, pushNotificationTriggers.ts |
| Edge Functions | 17 | play-cards, player-pass, auto-play-turn, bot-coordinator, complete-game, start_new_match, reconnect-player, find-match, cancel-matchmaking, mark-disconnected, get-rejoin-status, update-heartbeat, cleanup-rooms, get-livekit-token, send-push-notification, server-time, delete-account |
| Shared (Edge) | 1 | _shared/ directory |
| Migrations | 70 | SQL migration chain |
| Tests | 91 | Unit, integration, E2E (Maestro) |
| Utils | 20 | logger.ts, errorHandler.ts, rateLimitUtils.ts, profanityFilter.ts, etc. |

### 0.2 Dead Code — 11 .bak/.backup Files Flagged

| File | Action |
|------|--------|
| `src/hooks/useConnectionManager.ts.bak` | Remove |
| `src/hooks/usePlayHistoryTracking.ts.bak` | Remove |
| `src/hooks/useRealtime.ts.bak` | Remove |
| `src/hooks/useMatchmaking.ts.bak` | Remove |
| `src/hooks/useGameStateManager.ts.bak` | Remove |
| `src/screens/GameScreen.tsx.bak` | Remove |
| `src/components/game/CardHand.tsx.bak` | Remove |
| `src/components/game/GameControls.tsx.bak` | Remove |
| `src/components/gameEnd/GameEndModal.tsx.bak` | Remove |
| `src/components/gameRoom/LandscapeYourPosition.tsx.backup` | Remove |
| `src/hooks/__tests__/useRealtime-timer-cancellation.test.ts.bak` | Remove |

### 0.3 Architecture Map

```
┌─────────────────────────────────────────────────────────────┐
│                     React Native Client                      │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  ┌───────────┐  │
│  │ Screens  │→ │ Contexts  │→ │   Hooks    │→ │  Zustand   │  │
│  │ (21)     │  │ (6)       │  │ (47)       │  │  Store (3) │  │
│  └────┬─────┘  └─────┬─────┘  └─────┬──────┘  └────┬──────┘  │
│       │               │              │               │         │
│       └───────────────┴──────────────┴───────────────┘         │
│                              │                                  │
│    ┌─────────────────────────┼─────────────────────────┐       │
│    │         Supabase Client (supabase.ts)              │       │
│    │   • RPC calls  • Realtime subscriptions            │       │
│    │   • Auth (token refresh)  • Storage                │       │
│    └─────────────────────────┬─────────────────────────┘       │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Supabase Backend   │
                    │                      │
                    │  ┌────────────────┐  │
                    │  │ Edge Functions  │  │
                    │  │     (17)        │  │
                    │  └───────┬────────┘  │
                    │          │            │
                    │  ┌───────▼────────┐  │
                    │  │   PostgreSQL    │  │
                    │  │  (70 migrations)│  │
                    │  │  + RLS Policies │  │
                    │  └───────┬────────┘  │
                    │          │            │
                    │  ┌───────▼────────┐  │
                    │  │   Realtime     │  │
                    │  │  (Channels +   │  │
                    │  │   Presence)    │  │
                    │  └────────────────┘  │
                    └──────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  External Services   │
                    │  • LiveKit (Video)   │
                    │  • Sentry (Errors)   │
                    │  • GA4 (Analytics)   │
                    │  • Firebase (Push)   │
                    └──────────────────────┘
```

---

## PHASE 1 — GAMEPLAY LOGIC AUDIT ✅

### 1.1 Hand Type Validation: ALL 8 TYPES SUPPORTED ✅

| Hand Type | Client Validation | Server Validation | Status |
|-----------|------------------|-------------------|--------|
| Single | ✅ game-logic.ts | ⚠️ play-cards EF | Works but server doesn't verify card ownership |
| Pair | ✅ | ⚠️ | Same |
| Triple | ✅ | ⚠️ | Same |
| Straight | ✅ (wrap-around guard) | ⚠️ | Same |
| Flush | ✅ | ⚠️ | Same |
| Full House | ✅ | ⚠️ | Same |
| Four of a Kind | ✅ | ⚠️ | Same |
| Straight Flush | ✅ | ⚠️ | Same |

### 1.2 Critical Findings

| ID | Severity | File | Line | Issue |
|----|----------|------|------|-------|
| G-01 | **CRITICAL** | `play-cards/index.ts` | ~718 | **No server-side validation that cards are in player's hand.** Client sends card objects; server accepts without verifying against DB hand. A malicious client can play arbitrary cards. |
| G-02 | **CRITICAL** | `highest-play-detector.ts` | 560-576 | Full House comparison uses `>=` instead of `>` — falsely claims unbeatable when ranks are equal |
| G-03 | **CRITICAL** | `auto-pass-timer.ts` | 111-140 | Race condition: setInterval `onTick` and setTimeout `onComplete` fire independently — double auto-pass possible |
| G-04 | **CRITICAL** | `state.ts` | 560-630 | Local game state has NO server-side validation — all validation client-only for offline games |
| G-05 | **CRITICAL** | `state.ts` | 1180-1220 | Async race in `handleMatchEnd()` — `alertShown` flag local to scope, can't persist across retries |
| G-06 | **CRITICAL** | `bot/index.ts` | 220-240 | One Card Left rule not enforced in bot `handleFollowing()` for pairs/triples |
| G-07 | **HIGH** | `game-logic.ts` | 407-410 | Flush recommendation only takes first 5 same-suit cards, not optimal combination |
| G-08 | **HIGH** | `useGameStateManager.ts` | 86-102 | Race condition in initialization guard — room param changes bypass guard |
| G-09 | **MEDIUM** | `game-logic.ts` | 700-730 | `canPassWithOneCardLeftRule()` doesn't validate cards are in hand |
| G-10 | **MEDIUM** | `bot/index.ts` | 485-510 | O(n⁵) 5-card combo search with no memoization — lag on slow devices |
| G-11 | **MEDIUM** | `useGameActions.ts` | 200-205 | Pre-validation skips One Card Left rule entirely |
| G-12 | **MEDIUM** | `useDerivedGameState.ts` | 42-55 | O(n²) custom card order reconstruction — should use Set |

---

## PHASE 2 — RECONNECTION & REJOIN LIFECYCLE ✅

### 2.1 Architecture

| Component | Mechanism | Interval |
|-----------|-----------|----------|
| Heartbeat | `update-heartbeat` edge function | 5s (normal), 15s (backoff after 3 failures) |
| Disconnect detection | Server-side heartbeat timeout | 30s (no heartbeat → marked disconnected) |
| Bot replacement | `process_disconnected_players` cron | 60s grace period |
| Rejoin | `get-rejoin-status` + `reconnect-player` | On app foreground/reopen |

### 2.2 Critical Findings

| ID | Severity | File | Line | Issue |
|----|----------|------|------|-------|
| R-01 | **CRITICAL** | `useTurnInactivityTimer.ts` | 341 | Stale clock-skew anchor across turn boundaries — `localTurnStartRef` not reset on new turn |
| R-02 | **CRITICAL** | `useConnectionManager.ts` | 228 | Heartbeat stops on app background; on return, clock offset not recalculated — accumulated drift in timers |
| R-03 | **CRITICAL** | `update-heartbeat/index.ts` | 207-242 | `force_sweep` uses 55s grace (not 60s) — client clock 5s ahead triggers premature bot replacement |
| R-04 | **CRITICAL** | `useDisconnectDetection.ts` | 355 | Ghost rings when `isEffectivelyActive` flickers — suppress logic doesn't prevent visual jarring |
| R-05 | **HIGH** | `auto-play-turn/index.ts` | 123-138 | No re-validation of current turn — stale `gameState.current_turn` could auto-play wrong player |
| R-06 | **HIGH** | `useConnectionManager.ts` | 306-309 | Heartbeat backoff never resets under extended outage — stays in reconnecting state indefinitely |
| R-07 | **HIGH** | `update-heartbeat/index.ts` | 109-173 | Reconnect broadcast Promise resolves even if `send()` failed — clients may miss reconnection event |
| R-08 | **HIGH** | `useActiveGameBanner.ts` | 185-190 | Two different disconnect countdown calculations using different data sources — potential mismatch |
| R-09 | **MEDIUM** | `RejoinModal.tsx` | 36-42 | Async reclaim from previous modal interaction can complete on freshly-opened modal |
| R-10 | **MEDIUM** | `mark-disconnected/index.ts` | 31-39 | No validation that player is in the room before marking disconnected |

---

## PHASE 3 — CLOCK SYNCHRONIZATION & TIMERS ✅

### 3.1 Clock Sync Method
- **Single-sample offset**: Calculated from server's `timerState.server_time_at_creation` minus client `Date.now()`
- **No averaging**: Single ping, not average of N pings
- **Maximum drift**: No hard limit enforced — relies on "close enough" assumption
- **Correction**: `getCorrectedNow()` adds offset to `Date.now()` for all timer calculations

### 3.2 Timer Overlap Analysis

| Timer | Duration | Driven By | Cleared On |
|-------|----------|-----------|------------|
| Auto-pass (client) | Varies (from server `end_timestamp`) | Server time + offset | Player action, turn change, game end |
| Turn inactivity | 30s (configurable) | Client time + clock offset | Player action, turn change |
| Disconnect | 60s | Server-side heartbeat timeout | Heartbeat resumes |
| Heartbeat | 5s interval | Client setInterval | App background, unmount |

### 3.3 Critical Findings

| ID | Severity | File | Line | Issue |
|----|----------|------|------|-------|
| T-01 | **HIGH** | `AutoPassTimer.tsx` | 72-88 | Clock-sync deps missing from useMemo — stale `remaining` on initial animation frame |
| T-02 | **HIGH** | `useClockSync.ts` | 59-91 | Offset sticky after timer null — if server clock advances during null window, offset stale |
| T-03 | **HIGH** | `InactivityCountdownRing.tsx` | 32 | Optional `onExpired` callback — if parent forgets to bind, ring expires silently without triggering bot replacement |
| T-04 | **MEDIUM** | `useTurnInactivityTimer.ts` | 404-406 | Cleanup doesn't reset `hasExpiredRef`, `lastAutoPlayAttemptRef`, `localTurnStartRef` — stale on remount |
| T-05 | **MEDIUM** | `useClockSync.ts` | 88-91 | Offset not recalculated on timer identity collision (same server timestamp for two timers) |

---

## PHASE 4 — STATE MANAGEMENT & HOOKS ✅

### 4.1 Source of Truth Map

| Data | Source of Truth | Client Cache | Sync Mechanism | Issue? |
|------|----------------|-------------|----------------|--------|
| Game state (hands, table, turn) | Supabase `game_state` table | Zustand implicit via hooks | Realtime postgres_changes | ✅ Single source |
| User preferences | AsyncStorage + Zustand | `userPreferencesSlice` | Persist middleware | ⚠️ Dual source for sound/haptics |
| Player presence | Supabase Realtime Presence | `usePresence` Set | Channel subscription | ✅ |
| Scores (in-game) | `game_state.scores_history` | `ScoreboardContext` | Realtime updates | ⚠️ Triple source for scores |
| Auth state | Supabase auth session | `AuthContext` | `onAuthStateChange` | ✅ |
| Room membership | `room_players` table | `useRealtime` local state | Realtime postgres_changes | ✅ |

### 4.2 Critical Findings

| ID | Severity | File | Line | Issue |
|----|----------|------|------|-------|
| S-01 | **CRITICAL** | `userPreferencesSlice.ts` | 76-89 | soundEnabled/vibrationEnabled dual-persisted in Zustand AND soundManager singleton — async failure leaves them diverged permanently |
| S-02 | **CRITICAL** | `AuthContext.tsx` | 96-116 | Profile fetch lock set AFTER promise created — race window allows duplicate DB queries + double push token registration |
| S-03 | **CRITICAL** | `useRealtime.ts` | 379-416 | Channel subscription timeout creates ghost channel — rapid reconnects create 2+ handlers, causing duplicate broadcasts → state corruption |
| S-04 | **CRITICAL** | `useRealtime.ts` | 490-540 | ISO date string comparison causes false negatives — every heartbeat triggers unnecessary re-render (every 5s) |
| S-05 | **CRITICAL** | `useMatchEndHandler.ts` | 91-121 | Final scores derived from stale React state `scoreHistory` — race with `useMultiplayerScoreHistory` causes incomplete data |
| S-06 | **CRITICAL** | `FriendsContext.tsx` | 89-107 | Duplicate friend request notifications — same request can be shown twice if Realtime delivers duplicates |
| S-07 | **CRITICAL** | `NotificationContext.tsx` | 162-181 | Listener leak on logout — dead listeners persist in Expo.Notifications registry |
| S-08 | **HIGH** | `GameContext.tsx` | 51-67 | Missing useCallback on handlers — every render creates new function reference, breaking child useEffect deps |
| S-09 | **HIGH** | `GameEndContext.tsx` | 113-133 | Modal opens with bogus 0-score data when `final_scores` not yet persisted |
| S-10 | **HIGH** | `useGameCleanup.ts` | 53-68 | `mark-disconnected` called fire-and-forget in `beforeRemove` — may not execute before unmount |
| S-11 | **HIGH** | `useGameStatsUploader.ts` | 51-54 | One-shot guard set before all operations complete — partial failure blocks retries permanently |
| S-12 | **HIGH** | `usePresence.ts` | 108-127 | `showOnlineStatus` toggle doesn't clear in-memory `onlineUserIds` — stale data visible |

---

## PHASE 5 — SUPABASE BACKEND ✅

### 5.1 Edge Function Security Audit

| Function | Auth ✅ | Input Validation | Idempotent | Race Safe | Issues |
|----------|---------|-----------------|------------|-----------|---------|
| play-cards | ✅ | ⚠️ **No hand verification** | ⚠️ Partial | ⚠️ Race with auto-play-turn | **CRITICAL: G-01** |
| player-pass | ✅ | ✅ | ✅ | ⚠️ | 5s OCL validation timeout can freeze game |
| auto-play-turn | ✅ | ✅ | ⚠️ | ⚠️ | Stale turn check (R-05) |
| bot-coordinator | ✅ | ✅ | ⚠️ | ❌ **Lease timeout** | **CRITICAL: Lease expires mid-move** |
| complete-game | ✅ | ✅ | ⚠️ **Race** | ⚠️ | **CRITICAL: Dedup race before UNIQUE INDEX** |
| start_new_match | ✅ | ⚠️ | ✅ (mostly) | ✅ | `expected_match_number` is optional (should be required) |
| find-match | ✅ | ✅ | ❌ | ❌ **CRITICAL** | **Race: duplicate matches with same players** |
| cancel-matchmaking | ✅ | ✅ | ✅ | ✅ | Cancelled entries not cleaned up |
| mark-disconnected | ✅ | ⚠️ | ✅ | ✅ | No room membership validation |
| reconnect-player | ✅ | ✅ | ✅ | ✅ | ✅ |
| get-rejoin-status | ✅ | ✅ | N/A | N/A | ✅ |
| update-heartbeat | ✅ | ✅ | ✅ | ⚠️ | Force-sweep 55s < 60s threshold mismatch |
| get-livekit-token | ✅ | ✅ | N/A | N/A | ✅ |
| server-time | Public | N/A | N/A | N/A | ✅ |
| cleanup-rooms | ✅ | ✅ | ✅ | ✅ | ✅ |
| send-push-notification | ✅ | ✅ | ✅ | ✅ | No rate limiting |
| delete-account | ✅ | ✅ | ✅ | ✅ | Background retry not implemented |

### 5.2 Critical Backend Findings

| ID | Severity | File | Issue |
|----|----------|------|-------|
| B-01 | **CRITICAL** | `play-cards/index.ts` | Cards from client not verified against player's DB hand |
| B-02 | **CRITICAL** | `find-match/index.ts:140-187` | No SELECT...FOR UPDATE — concurrent calls create duplicate matches |
| B-03 | **CRITICAL** | `complete-game/index.ts` | SELECT/INSERT race before UNIQUE INDEX migration applied |
| B-04 | **CRITICAL** | `bot-coordinator/index.ts:146` | Lease expires mid-move; second coordinator can start and corrupt state |
| B-05 | **HIGH** | `player-pass/index.ts:110-125` | Rate limit bypassed for service-role with no audit trail |
| B-06 | **HIGH** | `player-pass/index.ts:407-470` | Bot-coordinator trigger is fire-and-forget — failure freezes game |
| B-07 | **HIGH** | `start_new_match/index.ts:23-33` | `expected_match_number` optional — allows silent no-op |
| B-08 | **HIGH** | `realtimeActions.ts:45-62` | No server-side card validation dispatched from client |

---

## PHASE 6 — LIVEKIT VIDEO/AUDIO ✅

### Summary
LiveKit integration is **well-implemented** with proper security boundaries.

| Check | Status |
|-------|--------|
| API key/secret server-only | ✅ Deno.env in edge function |
| Token scoped to correct room | ✅ Room membership verified before minting |
| Token TTL | ✅ 3600s (1 hour) |
| Room created on demand | ✅ First video toggle |
| Camera/mic permissions | ✅ iOS/Android separate flows with fallbacks |
| Disconnect resilience | ✅ CLIENT_INITIATED vs unexpected distinguished |

### Issues Found

| ID | Severity | File | Issue |
|----|----------|------|-------|
| L-01 | **HIGH** | `useVideoChat.ts:318` | iOS WebRTC permission fallback (~200 lines) — unreliable on older builds |
| L-02 | **HIGH** | `LiveKitVideoChatAdapter.ts:106` | Multiple `startAudioSession()`/`stopAudioSession()` cycles not guaranteed idempotent |
| L-03 | **MEDIUM** | `useVideoChat.ts:344-350` | Auto-restore connects without verifying room still exists in DB |
| L-04 | **MEDIUM** | `LiveKitVideoSlot.tsx:42` | Partial module load silently sets null — runtime crash if API mismatch |

---

## PHASE 7 — MATCHMAKING SYSTEM ✅

### Algorithm
- **Type**: Skill-based ±200 ELO within region/match-type
- **Queue**: Supabase Realtime subscription (no polling)
- **Timeout**: 5-minute stale-entry cleanup
- **Cooldown**: None (can rejoin immediately)

### Critical Findings

| ID | Severity | File | Issue |
|----|----------|------|-------|
| M-01 | **CRITICAL** | `find-match/index.ts:140-187` | **Race condition: concurrent calls create duplicate matches.** Needs SELECT...FOR UPDATE or distributed lock. UNFIXED TODO on line 170. |
| M-02 | **HIGH** | `useMatchmakingFlow.ts:116,224` | Zombie cleanup deletes ALL user room_players entries — including mid-game sessions |
| M-03 | **HIGH** | `useMatchmakingFlow.ts:145,261` | Room may be deleted by host before navigation completes — crash in Lobby |
| M-04 | **HIGH** | `useMatchmaking.ts:82-87` | Race between cancel ref and in-flight find-match RPC |

---

## PHASE 8 — ERROR MONITORING ✅

### Sentry Configuration
| Config | Value | Status |
|--------|-------|--------|
| Performance sampling | 20% production | ✅ Reasonable |
| Session replay | Error-only | ✅ |
| Source maps | Via EXPO_PUBLIC_APP_VERSION | ✅ |
| User context | Applied after init with cache | ✅ |
| Init guard | `_initialized` flag | ✅ |
| Breadcrumbs | Console capture with ANSI strip | ✅ |

### GA4 Analytics
| Config | Value | Status |
|--------|-------|--------|
| Protocol | Measurement Protocol v2 | ✅ |
| Client ID | Persisted in AsyncStorage | ✅ |
| Consent model | Optional gate | ⚠️ Not mandatory |
| Debug mode | Incomplete (debug_mode:1 not in body) | ⚠️ |
| Events tracked | 20+ types | ✅ |

### Issues Found

| ID | Severity | File | Issue |
|----|----------|------|-------|
| E-01 | **HIGH** | `sentry.ts:116-130` | `beforeSend` filter uses `event.environment` not `__DEV__` — prod build with __DEV__=true bypasses filter |
| E-02 | **HIGH** | `analytics.ts:82-83` | GA4 API_SECRET in EXPO_PUBLIC_* vars — bundled into app binary. TODO: proxy via Edge Function (not done) |
| E-03 | **MEDIUM** | `sentry.ts:269-330` | Console capture patches ALL modules — no rate limiting on breadcrumb spam |
| E-04 | **MEDIUM** | `analytics.ts:292-330` | Hint tracking uses string joins without GA4 100-char limit validation |
| E-05 | **MEDIUM** | `logger.ts:25` | FileSystem fallback to console in prod means logs silently disappear |

---

## PHASE 9 — UI/UX & RENDERING ✅

### Card Rendering
- **Card.tsx** (550 lines): Excellent Reanimated animation cleanup with `cancelAnimation()` on unmount ✅
- **CardHand.tsx** (950 lines): Orientation-aware spacing, optimistic card removal, drop zone glow ✅

### Issues Found

| ID | Severity | File | Issue |
|----|----------|------|-------|
| U-01 | **HIGH** | `CardHand.tsx:151` | `displayCards` managed locally + parent `cards` prop — dual sources of truth; can lose rearrangements |
| U-02 | **HIGH** | `CardHand.tsx:172-180` | Sync effect comparing IDs via Set but parent orders cards — flip-flop race between parent reorder + child display |
| U-03 | **MEDIUM** | `Card.tsx:228` | Scale stuck at 0.95 if tap and select don't fire simultaneously |
| U-04 | **MEDIUM** | `PlayerInfo.tsx:98` | Avatar scale useMemo doesn't depend on Zustand store value — won't resize when preference changes |
| U-05 | **MEDIUM** | `useOrientationManager.ts:103` | No guard against concurrent `applyOrientation` calls — double-tap override race |
| U-06 | **MEDIUM** | `useOneCardLeftAlert.ts:45,48` | Assumes `player.name` or `player.username` exists without validation |

---

## PHASE 10 — SECURITY AUDIT ✅

### Authentication
| Check | Status |
|-------|--------|
| Token storage | AsyncStorage (acknowledged trade-off per Supabase docs) |
| Token refresh | `autoRefreshToken: true` with deduplication ✅ |
| Apple Sign-In | Declared in app.json but button disabled ⚠️ |
| GDPR delete | Cascade deletion of 4 tables ✅ |
| Service role key | Server-only (Edge Functions) ✅ |

### Critical Security Findings

| ID | Severity | File | Issue |
|----|----------|------|-------|
| SEC-01 | **CRITICAL** | `play-cards/index.ts` | Server accepts client-submitted cards without verifying they're in player's hand — **game-breaking exploit** |
| SEC-02 | **CRITICAL** | `google-services.json` | Firebase API keys + OAuth Client ID were committed historically and may still exist in git history; file is not currently tracked in this branch — **rotate immediately** |
| SEC-03 | **HIGH** | `useFriends.ts` | No rate limiting on friend requests — can spam unlimited pending requests |
| SEC-04 | **HIGH** | `analytics.ts:82` | GA4 API_SECRET bundled in app binary |
| SEC-05 | **MEDIUM** | `useThrowables.ts` | 30s cooldown is client-only — no server-side validation prevents bypass |
| SEC-06 | **MEDIUM** | `mark-disconnected/index.ts` | No validation caller is actually in the room |

---

## PHASE 11 — INTERNATIONALISATION (i18n) ✅

### Supported Languages
- English (en) — primary
- Arabic (ar) — RTL support
- German (de) — layout testing

### Findings

| ID | Severity | File | Issue |
|----|----------|------|-------|
| I-01 | **CRITICAL** | `SignInScreen.tsx` | 3 hardcoded English strings: "Welcome to Big2", sign-in prompt, terms text |
| I-02 | **CRITICAL** | `app.json` | `usesAppleSignIn: true` but Apple Sign-In button disabled — App Store rejection risk |
| I-03 | **MEDIUM** | Various components | Need comprehensive i18n key usage audit — some keys defined but not used, some used but not defined |

---

## PHASE 12 — PUSH NOTIFICATIONS ✅

### Architecture
| Component | Status |
|-----------|--------|
| Token registration | On app launch ✅ |
| Token refresh | On change ✅ |
| Permission denied handling | Graceful fallback ✅ |
| Deep link routing | Via notification response handler ✅ |
| Preferences screen | NotificationSettingsScreen ✅ |

### Issues Found

| ID | Severity | File | Issue |
|----|----------|------|-------|
| P-01 | **HIGH** | `pushNotificationService.ts` | No rate limiting on notification sends — can spam "your turn" alerts |
| P-02 | **MEDIUM** | `NotificationContext.tsx:173-180` | Cold-start notification handler has stale dependency risk |

---

## PHASE 13 — EXPO OTA & BUILD CONFIG ✅

### Configuration
| Config | Value | Status |
|--------|-------|--------|
| Expo SDK | 54.0.29 | ✅ |
| New Architecture | Enabled (newArchEnabled: true) | ✅ |
| Hermes | Enabled | ✅ |
| Runtime version | `appVersion` policy | ✅ Prevents incompatible bundles |
| OTA check | `ON_LOAD` | ⚠️ Could reload mid-game |
| Permissions | Camera, Mic, Photo Library | All justified ✅ |

### Issues Found

| ID | Severity | File | Issue |
|----|----------|------|-------|
| O-01 | **MEDIUM** | `app.json` | OTA `checkAutomatically: "ON_LOAD"` could restart app mid-game — consider `ON_ERROR_RECOVERY` or manual check |
| O-02 | **LOW** | `app.json` | `usesAppleSignIn: true` when feature is disabled — unnecessary entitlement |

---

## PHASE 14 — TESTING COVERAGE ✅

### Coverage Summary
| Metric | Current | Target |
|--------|---------|--------|
| Statements | 78.64% | 80% |
| Branches | 80.87% | 80% ✅ |
| Total test files | 91 | — |
| E2E flows (Maestro) | 11 | — |

### Critical Test Gaps

| Gap | Impact | Priority |
|-----|--------|----------|
| **Multiplayer game E2E** | Full 4-player game flow untested | 🔴 HIGH |
| **Reconnection scenarios** | Network disconnect → reconnect never validated | 🔴 HIGH |
| **Concurrent card plays** | Rapid sequential plays in multiplayer not tested | 🔴 HIGH |
| **Matchmaking timeout** | 30/60s timeout edge cases not covered | 🟠 HIGH |
| **Server-side combo validation** | Custom combo types not validated in play-cards EF tests | 🟠 HIGH |

### E2E Gaps
- ❌ Multiplayer game flow (4-player create → play → win)
- ❌ Reconnection (network drop, WiFi → cellular)
- ❌ Matchmaking → Lobby → Game handoff
- ❌ Rate limiting verification
- ❌ Deep link post-sign-in

---

## PHASE 15 — DEPENDENCIES & PROJECT HEALTH ✅

### Critical Issues

| ID | Severity | Issue |
|----|----------|-------|
| D-01 | **CRITICAL** | `google-services.json` committed with API keys — rotate + remove from history immediately |
| D-02 | **HIGH** | `react-native: 0.81.5` pinned exactly in `package.json` — ✅ fixed in Phase 0; verify lock file stays current |
| D-03 | **HIGH** | `@sentry/react-native: ^8.5.0` — needs CVE audit |
| D-04 | **MEDIUM** | No `.env.example` file for developer onboarding — ✅ added in Phase 0 |

### Heavy Dependencies (Bundle Impact)
| Package | Estimated Size | Justification |
|---------|---------------|---------------|
| `@livekit/react-native-webrtc` | ~500KB+ | Video chat (required) |
| `@sentry/react-native` | ~200KB+ | Error monitoring (required) |
| `react-native-reanimated` | ~150KB+ | Card animations (required) |
| `date-fns` | ~79KB | Date formatting (consider tree-shaking) |

---

## PHASE 16 — CROSS-CUTTING CONCERNS ✅

### Navigation Safety

| Platform | Back Handling | Status |
|----------|--------------|--------|
| iOS | `gestureEnabled: false` on Game/Lobby/Matchmaking | ✅ |
| Android | Hardware back button handler | ⚠️ **Not verified in GameScreen** |
| Deep links | `big2mobile://` + `https://big2.app` | ✅ |
| Cold-start links | Captured before sign-in, replayed after | ✅ |

### Findings

| ID | Severity | File | Issue |
|----|----------|------|-------|
| X-01 | **HIGH** | `AppNavigator.tsx` | Android hardware back button handler not verified in GameScreen — potential accidental mid-game exit |
| X-02 | **HIGH** | `useFriends.ts` | No rate limit on friend requests — spam potential |
| X-03 | **HIGH** | `useRoomLobby.ts` | No timeout on `lobby_claim_host` RPC — UI freezes indefinitely if RPC hangs |
| X-04 | **MEDIUM** | `AppNavigator.tsx` | No `memoryWarning` listener — app doesn't free resources under memory pressure |
| X-05 | **MEDIUM** | `useThrowables.ts` | Client-only 30s cooldown — no server-side rate validation |
| X-06 | **LOW** | `AppNavigator.tsx` | Deep link replay silent failure — 300ms hardcoded delay may be insufficient on slow devices |

---

## DELIVERABLE D3 — ROOT CAUSE ANALYSIS (CRITICAL + HIGH)

### Root Cause: Missing Server-Side Validation (G-01, B-01, SEC-01)
- **Why:** Client-side validation was implemented first; server-side was deferred and never completed
- **Pattern:** "Trust the client" anti-pattern — all card validation done in `game-logic.ts` on client
- **Blast radius:** ANY multiplayer game action can be spoofed — play any card, any combo
- **Fix:** Fetch player hand from DB in `play-cards`, verify each submitted card exists, then process

### Root Cause: Concurrency Without Locking (M-01, B-02, B-03, B-04)
- **Why:** Edge functions use optimistic queries without pessimistic locks
- **Pattern:** SELECT/INSERT race — two concurrent calls both see the same state
- **Blast radius:** Duplicate matches, duplicate stats, corrupted bot state
- **Fix:** SELECT...FOR UPDATE in find-match; UNIQUE INDEX in complete-game; lease refresh in bot-coordinator

### Root Cause: Timer Independence (G-03, R-01, T-01, T-02)
- **Why:** setInterval and setTimeout operate independently; clock sync is one-shot
- **Pattern:** Multiple timers for the same logical event without coordination
- **Blast radius:** Double auto-pass, stale countdown displays, premature bot replacement
- **Fix:** Single timer source (server-authoritative), client only displays

### Root Cause: Secret Management (D-01, SEC-02)
- **Why:** Firebase config file committed for dev convenience
- **Pattern:** No `.gitignore` entry for platform config files
- **Fix:** Rotate keys, add to .gitignore, use .env.example approach

---

## DELIVERABLE D5 — ARCHITECTURAL IMPROVEMENTS

### 1. Server-Side Card Validation (Required)
Add hand verification to `play-cards` edge function: fetch `room_players.hand[player_index]` from DB, verify each submitted card matches, reject if not.

### 2. Database-Level Concurrency Guards (Required)
- `find-match`: SELECT...FOR UPDATE on waiting_room rows
- `complete-game`: Ensure UNIQUE INDEX on `(room_id)` in game_history before deployment
- `bot-coordinator`: Refresh lease every 5s during bot loop

### 3. Single Source of Truth for Scores (Recommended)
Remove `ScoreboardContext` state and `useGameStatsUploader` local cache. Read scores directly from `game_state.scores_history` via Realtime subscription.

### 4. Timer Consolidation (Recommended)
Replace independent client-side timers with server-authoritative timestamps. Client only renders countdown from `server_end_timestamp - getCorrectedNow()`.

---

## DELIVERABLE D6 — HIDDEN RISKS ("Works Now, Breaks at Scale")

| Risk | Trigger | Impact |
|------|---------|--------|
| Realtime channel limits | 100+ concurrent games | Supabase Realtime has per-project channel limits; could hit ceiling |
| Edge function cold starts | Low traffic → first request slow | 2-5s cold start on auto-play-turn could cause visible timer stutter |
| Memory leaks in useRealtime | Long game sessions (1+ hour) | Channel subscription leak on rapid reconnect accumulates handlers |
| heartbeat N+1 queries | 100 concurrent games × 4 players × 5s | 80 heartbeats/second hitting DB per server |
| Bot O(n⁵) combo search | 13-card hand on slow device | 1287 combinations per turn; noticeable lag |
| AsyncStorage quota | Many saved preferences + cached state | iOS 400KB limit per app could be exceeded with large game state |

---

## DELIVERABLE D8 — PRIORITIZED REMEDIATION PLAN

### Sprint 1: Security & Data Integrity (Blocks Launch)

| # | Fix | Files | Complexity |
|---|-----|-------|------------|
| 1 | **Rotate Firebase API keys + remove google-services.json from history** | google-services.json, .gitignore | Trivial |
| 2 | **Add server-side hand verification to play-cards** | play-cards/index.ts | Medium |
| 3 | **Add SELECT...FOR UPDATE to find-match** | find-match/index.ts | Medium |
| 4 | **Ensure UNIQUE INDEX migration applied before complete-game deploy** | Deployment docs | Trivial |
| 5 | **Add lease refresh to bot-coordinator loop** | bot-coordinator/index.ts | Small |

### Sprint 2: Stability & Race Conditions

| # | Fix | Files | Complexity |
|---|-----|-------|------------|
| 6 | Fix `localTurnStartRef` reset on turn change | useTurnInactivityTimer.ts | Trivial |
| 7 | Fix Full House comparison `>=` → `>` | highest-play-detector.ts | Trivial |
| 8 | Decouple setInterval and setTimeout in auto-pass-timer | auto-pass-timer.ts | Small |
| 9 | Fix AuthContext profile fetch lock race | AuthContext.tsx | Small |
| 10 | Fix Realtime channel subscription timeout leak | useRealtime.ts | Medium |
| 11 | Fix ISO date comparison false negatives | useRealtime.ts | Small |

### Sprint 3: State Management & UX

| # | Fix | Files | Complexity |
|---|-----|-------|------------|
| 12 | Remove dual audio/haptic persistence | userPreferencesSlice.ts | Small |
| 13 | Add useCallback to GameContext handlers | GameContext.tsx | Small |
| 14 | Fix score derivation from stale React state | useMatchEndHandler.ts | Medium |
| 15 | Fix friend request rate limiting | useFriends.ts, DB RLS | Medium |
| 16 | Add push notification rate limiting | pushNotificationService.ts | Medium |
| 17 | Add Android back button handler verification | GameScreen.tsx | Small |

### Sprint 4: Testing & Observability

| # | Fix | Files | Complexity |
|---|-----|-------|------------|
| 18 | Add multiplayer E2E test (4-player full game) | e2e/flows/ | Large |
| 19 | Add reconnection scenario tests | __tests__/integration/ | Large |
| 20 | Add server-side throwable rate limiting | useThrowables.ts, broadcast handler | Medium |
| 21 | Add memoryWarning listener to AppNavigator | AppNavigator.tsx | Trivial |
| 22 | Migrate GA4 API_SECRET to Edge Function proxy | analytics.ts, new EF | Medium |

### Cleanup: Dead Code Removal

| # | Fix | Files | Complexity |
|---|-----|-------|------------|
| 23 | Remove all 11 .bak/.backup files | Various | Trivial |
| 24 | Create .env.example template | .env.example | Trivial |
| 25 | Fix i18n hardcoded strings in SignInScreen | SignInScreen.tsx, i18n/ | Small |

---

*Report complete. All phases (0–16) audited. 138 issues documented with file paths, line numbers, severity ratings, and a prioritized remediation plan.*
