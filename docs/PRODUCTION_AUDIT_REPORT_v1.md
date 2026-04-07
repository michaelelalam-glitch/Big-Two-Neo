# Big Two Neo — Production Readiness Audit Report

**Version:** 1.0  
**Date:** April 7, 2026  
**Auditor:** AI-assisted Principal Architect + QA Lead + Security Auditor  
**Scope:** Full codebase audit across all 16 phases  
**Branch:** `fix/production-audit-phases-11-16`

---

## EXECUTIVE SUMMARY

| Metric | Value |
|--------|-------|
| **Health Score** | **8.2 / 10** |
| **Production Readiness** | **YES WITH CONDITIONS** |
| **Critical Issues** | 1 |
| **High Issues** | 4 |
| **Medium Issues** | 7 |
| **Low Issues** | 6 |

The Big Two Neo codebase is **well-architected** with clean separation of concerns, comprehensive server-side validation, and robust reconnection handling. The one critical issue (game_state update race condition) and four high-severity issues should be addressed before production launch. No security vulnerabilities that allow cheating or data leakage were found.

---

## D2. SEVERITY CLASSIFICATION

### CRITICAL (1 issue)

| # | Issue | Phase | File | Lines | Impact |
|---|-------|-------|------|-------|--------|
| C1 | **No atomic concurrency guard on game_state updates** | 1 | `supabase/functions/play-cards/index.ts` | L1244-1249 | If `play-cards` and `auto-play-turn` fire within ~100ms of each other on the same turn, both could update `game_state` without conflict detection. The `.eq('room_id', room.id)` filter has no version/turn guard. |

**Root Cause:** The `game_state` UPDATE uses only `room_id` as the WHERE clause, with no optimistic concurrency control (no version number, no `WHERE current_turn = X AND turn_number = Y`).

**Blast Radius:** Could cause double-play, corrupted trick history, or turn skipping. Affects `play-cards`, `player-pass`, and `auto-play-turn` equally.

**Fix:**
```sql
-- Add to all game_state UPDATE queries:
UPDATE game_state 
SET ... 
WHERE room_id = $1 
  AND current_turn = $expected_turn 
  AND turn_number = $expected_turn_number;
-- If 0 rows affected → stale state, return 409 Conflict
```

**Estimated Complexity:** Medium (affects 3 edge functions)

---

### HIGH (4 issues)

| # | Issue | Phase | File | Lines | Impact |
|---|-------|-------|------|-------|--------|
| H1 | **GameContext ↔ gameSessionSlice state duplication** | 4 | `src/contexts/GameContext.tsx` | — | `selectedCardIds` exists as `Set<string>` in Context and `string[]` in Store. No automatic sync mechanism. Risk of divergence during gameplay. |
| H2 | **Hardcoded i18n strings** | 11 | Multiple (see below) | — | 10+ user-facing strings bypass translation system. Arabic/German users see English. |
| H3 | **Incomplete GDPR table cleanup in delete-account** | 10 | `supabase/functions/delete-account/index.ts` | L43-77 | May not delete from all user-related tables (friendships, game history, notifications). Needs schema cross-reference. |
| H4 | **find-match unconditional room_players DELETE** | 7 | `supabase/functions/find-match/index.ts` | L88-90 | Deletes ALL room_player rows for user, not just completed/abandoned games. Mitigated by active-game check at L52-72, but is a hidden dependency. |

**H2 — Hardcoded Strings Detail:**
- `ConnectionStatusIndicator.tsx` L60: `'Reconnecting...'`
- `ScoreboardErrorBoundary.tsx` L96-109: `'Scoreboard Error'`, `'Unable to display scoreboard data'`, `'Try Again'`
- `MatchmakingScreen.tsx` L62: `'You must be signed in to use matchmaking'`
- `SettingsScreen.tsx` L247, L297: Error messages
- `LobbyScreen.tsx` L875, L882: Max player / empty player errors
- `NotificationSettingsScreen.tsx` L83, L107: Notification error messages

---

### MEDIUM (7 issues)

| # | Issue | Phase | File | Impact |
|---|-------|-------|------|--------|
| M1 | ScoreboardContext missing AsyncStorage JSON validation on restore | 4 | `src/contexts/ScoreboardContext.tsx` L37-47 | Corrupted JSON could crash app on launch |
| M2 | Stale closure risk in useRealtime broadcast handlers | 4 | `src/hooks/useRealtime.ts` L231 | Handlers may read stale Context state |
| M3 | complete-game partial failure (stats_applied_at orphan) | 5 | `supabase/functions/complete-game/index.ts` L293 | If crash after INSERT but before stats RPC, game recorded but stats never applied. No automatic recovery. |
| M4 | Push token not cleaned on account deletion | 10 | `src/contexts/AuthContext.tsx` L126-150 | `removePushTokenFromDatabase()` never called during delete-account flow |
| M5 | Bot coordinator lease timeout too long (45s) | 1 | `supabase/functions/bot-coordinator/index.ts` L350-380 | If coordinator crashes holding lease, game frozen for 45s |
| M6 | Missing error boundaries for critical async paths | 8 | Various | No boundary around profile fetch retries, matchmaking callbacks, LiveKit connect |
| M7 | Test coverage only enforced on `src/game/` + `src/components/scoreboard/` | 14 | `jest.config.js` | Critical paths (hooks, contexts, services) have no coverage thresholds |

---

### LOW (6 issues)

| # | Issue | Phase | File |
|---|-------|-------|------|
| L1 | CORS `Access-Control-Allow-Origin: *` on get-livekit-token | 6 | `supabase/functions/get-livekit-token/index.ts` L26-30 |
| L2 | Clock sync uses single NTP ping (no averaging) | 3 | `src/hooks/useClockSync.ts` L39-61 |
| L3 | cancel-matchmaking TODO for stale waiting_room cleanup | 7 | `supabase/functions/cancel-matchmaking/index.ts` L60-66 |
| L4 | 3 TODO comments in game/state.ts for multiplayer data | 0 | `src/game/state.ts` L1288, L1362 |
| L5 | i18n/index.ts is 2400+ lines (could split by domain) | 11 | `src/i18n/index.ts` |
| L6 | Throwable spoof risk (200+ distinct thrower IDs bypass dedup) | 16 | `src/hooks/useThrowables.ts` L290-311 |

---

## D3. ROOT CAUSE ANALYSIS (CRITICAL + HIGH)

### C1: No Atomic Concurrency Guard
- **Why:** Original edge functions were written before concurrent play scenarios were considered. Single-player testing doesn't surface this.
- **Pattern:** All 3 gameplay edge functions (play-cards, player-pass, auto-play-turn) share the same non-atomic update pattern.
- **Blast radius:** Any state mutation to `game_state` could be lost if two functions race.

### H1: Context/Store Duplication
- **Why:** GameContext was created before Zustand store was adopted. Both coexist without explicit sync.
- **Pattern:** Incremental architecture evolution without cleanup.
- **Blast radius:** Any consumer reading from the wrong source gets stale data.

### H3: Incomplete GDPR Cleanup
- **Why:** delete-account was written before friendships/notifications tables were added.
- **Pattern:** Feature additions don't update deletion cascade.

### H4: Unconditional room_players DELETE
- **Why:** Defensive cleanup to prevent orphaned matchmaking rows. The active-game check above it protects against the worst case, but the delete is overly broad.

---

## D4. FIX RECOMMENDATIONS

### Immediate (Before Launch)

**C1 — Atomic game_state updates:**
- Add `turn_number` column to `game_state` (auto-incrementing on each turn)
- Include `WHERE turn_number = $expected` in all UPDATE queries
- If 0 rows updated → return 409 Conflict, client retries from fresh state
- **Files:** `play-cards/index.ts`, `player-pass/index.ts`, `auto-play-turn/index.ts`
- **Complexity:** Medium
- **Dependencies:** New migration for `turn_number` column

### Week 1

**H1 — Resolve Context/Store duplication:**
- Option A: Remove `selectedCardIds` from GameContext, only use Store
- Option B: Remove from Store, only use Context
- Consolidate to single source of truth
- **Complexity:** Medium

**H2 — Fix hardcoded i18n strings:**
- Add translation keys for all 10+ identified strings
- Update AR and DE translations
- **Complexity:** Small

**H3 — Complete GDPR cleanup:**
- Audit schema for all tables with `user_id` foreign key
- Add deletion for `friendships`, `game_history`, `notifications`, push tokens
- **Complexity:** Small

**H4 — Scope room_players cleanup:**
```typescript
// Change from:
await supabaseClient.from('room_players').delete().eq('user_id', userId);
// To:
await supabaseClient.from('room_players').delete()
  .eq('user_id', userId)
  .in('rooms.status', ['completed', 'abandoned']);
```
- **Complexity:** Trivial

### Backlog

**M1-M7:** Address in order of severity during normal sprint work.

---

## D5. ARCHITECTURAL ASSESSMENT

### Strengths
1. **Server-side validation is comprehensive** — Hand membership, turn auth, player identity, OCL rule all verified server-side
2. **Reconnection system is robust** — 60s server-enforced bot replacement, atomic seat restoration, proper state recovery
3. **Clock sync eliminates timer desync** — NTP-style drift calculation with proper clamping
4. **Edge functions are idempotent** — complete-game and start_new_match both have multi-layer dedup guards
5. **Rate limiting is dual-layered** — Client + server rate limiting on notifications and throwables
6. **Matchmaking uses optimistic locking** — Only one invocation can claim all 4 seats; proper rollback on failure
7. **Card animation crash prevention** — Proper cleanup of reanimated values on unmount (prevents SIGSEGV)
8. **Error classification** — Expected race conditions logged as WARN, not ERROR (Sentry stays clean)

### Architecture Simplification Opportunities
1. **Consolidate GameContext + gameSessionSlice** into single state management layer
2. **Move shared validation logic** (card parsing, hand verification) into `_shared/` library
3. **Split i18n file** (2400+ lines) into per-domain modules

---

## D6. HIDDEN RISKS ("Works Now, Breaks at Scale")

| Risk | Trigger | Impact |
|------|---------|--------|
| Rate limiter fails open | Database overload | All rate limits disabled; notification/throwable spam |
| Bot coordinator lease blocks game | Edge function crash during bot turn | 45s game freeze |
| Single NTP ping | High-latency mobile connection | Clock offset >1s, timer displays inaccurate |
| Realtime channel payload size | Game with many plays + full history | Exceeded Supabase Realtime payload limit |
| game_state row contention | 4-player game with fast turns | Multiple concurrent UPDATE attempts (C1) |

---

## D7. OVERALL VERDICT

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Security** | 9/10 | All gameplay validated server-side. Auth properly handled. Only CORS is minor. |
| **Reliability** | 7/10 | Reconnection excellent. Concurrency guard missing (C1). |
| **Performance** | 8.5/10 | Card rendering optimized. Proper memo/reanimated usage. |
| **Code Quality** | 8.5/10 | Clean architecture, minimal dead code, good TypeScript coverage |
| **Testing** | 7/10 | 95 test files + 12 E2E, but coverage thresholds only on game/scoreboard |
| **i18n** | 6/10 | 3 languages supported but 10+ hardcoded strings |
| **GDPR** | 7/10 | Delete-account exists but may miss newer tables |
| **Overall** | **8.2/10** | |

### Production Readiness: **YES WITH CONDITIONS**

### Top 5 Issues That Must Be Fixed Before Launch:
1. **C1**: Add atomic concurrency guard to game_state updates
2. **H1**: Resolve GameContext/Store state duplication
3. **H3**: Verify and complete GDPR table cleanup
4. **H2**: Fix hardcoded i18n strings for AR/DE
5. **H4**: Scope room_players cleanup in find-match

---

## D8. PRIORITISED REMEDIATION PLAN

### PR 1: Atomic Game State Updates (C1)
1. Add migration: `ALTER TABLE game_state ADD COLUMN turn_number INTEGER DEFAULT 0`
2. Update `play-cards/index.ts`: Include `turn_number` in WHERE clause, increment on success
3. Update `player-pass/index.ts`: Same pattern
4. Update `auto-play-turn/index.ts`: Same pattern
5. Add test: Concurrent play simulation
6. **Verify:** Two simultaneous plays → one succeeds, one gets 409

### PR 2: State Management Cleanup (H1)
1. Audit all consumers of GameContext.selectedCardIds vs Store.selectedCardIds
2. Remove duplication — pick one source of truth
3. Update all consumers
4. **Verify:** Card selection works across all game modes

### PR 3: GDPR Compliance (H3, M4)
1. Query production schema for all tables with `user_id` column
2. Add deletion for missing tables in `delete-account/index.ts`
3. Add push token cleanup call
4. **Verify:** Account deletion cascades to all user data

### PR 4: i18n Hardcoded Strings (H2)
1. Add translation keys for all 10+ identified strings
2. Add AR + DE translations
3. **Verify:** Switch language and check all affected screens

### PR 5: Matchmaking Safety (H4)
1. Scope `room_players` DELETE in find-match to completed/abandoned rooms only
2. **Verify:** Player in active game is never cleaned up by matchmaking

---

## PHASE-BY-PHASE SUMMARY

| Phase | Status | Critical Findings |
|-------|--------|-------------------|
| **0 — Inventory** | ✅ Complete | Clean architecture, no dead code, no orphans |
| **1 — Gameplay** | ⚠️ 1 Critical | Concurrency race on game_state updates (C1) |
| **2 — Reconnection** | ✅ Excellent | Robust 60s bot replacement, proper state restoration |
| **3 — Timers** | ✅ Good | NTP sync works, expected races handled gracefully |
| **4 — State** | ⚠️ 1 High | Context/Store duplication (H1) |
| **5 — Supabase** | ✅ Good | Idempotent edge functions, RLS present |
| **6 — LiveKit** | ✅ Secure | API keys server-only, room membership verified |
| **7 — Matchmaking** | ⚠️ 1 High | Unconditional room_players delete (H4) |
| **8 — Monitoring** | ✅ Good | Sentry + GA4 properly configured, error boundaries present |
| **9 — UI/Perf** | ✅ Excellent | Reanimated crash fix, proper memoization |
| **10 — Security** | ⚠️ 1 High | GDPR incomplete (H3) |
| **11 — i18n** | ⚠️ 1 High | 10+ hardcoded strings (H2) |
| **12 — Push** | ✅ Good | Dual-layer rate limiting, proper cleanup |
| **13 — Build** | ✅ Safe | ON_ERROR_RECOVERY prevents mid-game updates |
| **14 — Testing** | ⚠️ Gaps | Coverage thresholds only on game/scoreboard |
| **15 — Dependencies** | ✅ Healthy | No vulnerabilities, proper semver |
| **16 — Cross-cutting** | ✅ Good | Host disconnect handled, navigation safe |

---

*End of audit report.*
