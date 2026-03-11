# Task 622 — Audit & Fix: Inactivity Timer, Disconnect, Autoplay, Bot Replacement & Rejoin Banner

**Branch:** `task/622-timer-disconnect-autoplay-audit`  
**Date:** March 10, 2026  
**Status:** In Progress

---

## Audit Summary

Full system-by-system audit of all 5 interconnected timer/disconnect/autoplay systems.

---

## System 1: Inactivity Countdown (Turn Timer)

### Architecture
- `useTurnInactivityTimer.ts` — 500 ms polling, monitors `game_state.turn_started_at`
- `InactivityCountdownRing.tsx` — RAF animation, **yellow ring**, 60 s countdown
- Triggered in `MultiplayerGame.tsx`
- When expired: calls `auto-play-turn` edge function
- Clock skew detection: if server clock >2 s ahead, uses client-local start time via `localTurnStartRef`

### Issues Found
| Severity | Issue | Impact |
|----------|-------|--------|
| LOW | `getCorrectedNow: () => Date.now()` — not using clock-sync offset. The `useClockSync` hook is AutoPassTimer-specific, so sub-2 s clock offsets are not corrected for the turn timer. The `localTurnStartRef` handles >2 s skew only. | Minor timer drift; auto-play may fire slightly early/late |
| LOW | `TurnAutoPlayModal` not auto-dismissed when the turn changes (i.e., when the server processed the auto-play and moved to the next player's turn). Modal stays open until the player manually dismisses it. | Cosmetic — stale modal remains on screen |

### Verdict: ✅ Functionally correct. 2 minor fixes.

---

## System 2: Disconnected Countdown (In-Game)

### Architecture
- **In-game ring:** charcoal-grey `InactivityCountdownRing` with `type='connection'`
- `MultiplayerGame.tsx` — client-side staleness detection at 12 s (`STALE_THRESHOLD_MS`)
- `clientDisconnectStartRef` anchors the ring start time
- Turn carry-over: if disconnected during active turn, uses `turn_started_at` as anchor → ring continues seamlessly from yellow

### Issues Found
| Severity | Issue | Impact |
|----------|-------|--------|
| HIGH | **Ring anchor not synced to server timer.** When `connection_status === 'disconnected'` arrives via Realtime (bringing `disconnect_timer_started_at`), the code ignores `rp.disconnect_timer_started_at` and seeds the anchor from `new Date().toISOString()` (unless already set by staleness detection). Result: the ring may start showing a fresh 60 s countdown AFTER the server timer has already been running. | Ring can expire ~12–30 s before the server timer; `forceSweep` fires early |
| HIGH | **12 s staleness lag.** Client staleness detection fires 12 s after the last heartbeat. If the server marks `disconnect_timer_started_at` earlier (e.g., via heartbeat sweep at T+30 s), other clients' rings start 12 s late. The server timer has `60−elapsed` seconds left but the client ring shows 60 s. | Ring shows ~12 s more time than the server actually has remaining |

### Root Cause
`clientDisconnectStartRef.current[rp.player_index]` is set to the **client-local detection time** rather than the server's `disconnect_timer_started_at`. The existing code comment says:
> "never switch to the raw server disconnect_timer_started_at for the ring animation: that timestamp comes from the server clock and can be seconds in the future relative to the client clock"

This was a valid guard against clock-skew artifacts, but `InactivityCountdownRing` already normalises future timestamps to `now` (it has a `CRITICAL FIX` block for this). So the guard is now overly conservative.

### Fix
When `rp.connection_status === 'disconnected'` fires AND `rp.disconnect_timer_started_at` is available:
- Pick the **earlier** of (server anchor, existing client anchor) — "earlier" = ring is more depleted = more accurate
- `InactivityCountdownRing` already handles future-timestamp clock skew safely

### Verdict: ⚠️ 2 sync bugs. Requires fix.

---

## System 3: Autoplay

### Architecture
- `useTurnInactivityTimer` fires `auto-play-turn` edge function after 60 s turn timeout
- Edge function plays highest valid cards OR passes
- `onAutoPlay` callback shows `TurnAutoPlayModal` ("I'm Still Here?")
- If `replaced_by_bot === true` in response: skip modal, `useConnectionManager` surfaces RejoinModal

### Issues Found
| Severity | Issue | Impact |
|----------|-------|--------|
| LOW | `broadcastMessage` not wired into `useTurnInactivityTimer` in `MultiplayerGame.tsx`. The `turn_auto_played` broadcast is never sent. Other players rely entirely on the server's Realtime `game_state` update. | ~100–500 ms extra delay for other players to see the auto-played cards. Functionally correct. |
| LOW | `TurnAutoPlayModal` not auto-dismissed on turn change (same as System 1). | Cosmetic — stale modal |

### Verdict: ✅ Functionally correct. Autoplay triggers correctly.

---

## System 4: Bot Replacement

### Architecture
- Server: `process_disconnected_players()` via pg_cron + heartbeat piggyback (every 6th heartbeat)
- `useConnectionManager` sends heartbeat every 5 s
- `forceSweep()` fires when another player's disconnect ring hits 0
- Realtime: `connection_status === 'replaced_by_bot'` triggers `onBotReplaced`
- Local player: heartbeat detects replacement, `onBotReplaced` fires → `RejoinModal`

### Issues Found
| Severity | Issue | Impact |
|----------|-------|--------|
| LOW | `forceSweep` may fire up to ~12 s before the server timer expires (due to the ring anchor lag from System 2). The server's `process_disconnected_players()` respects its own 60 s timer and will not replace until it actually expires. `forceSweep` fired early is harmless — the sweep just no-ops until the timer passes. | No functional bug. Minor "sweep fires too early" inefficiency. |

### Verdict: ✅ Working correctly (with caveat: ring accuracy depends on System 2 fix).

---

## System 5: Rejoin & Reclaim Seat Banner (Home Page)

### Architecture
- `ActiveGameBanner` always rendered on Home screen
- `HomeScreen.checkCurrentRoom()` calls `get-rejoin-status` edge function on focus
- Anchors countdown to `statusData.disconnect_timer_started_at` (if returned) or falls back to `seconds_left` back-calculation
- `handleTimerExpired` polls up to 7 × 5 s = 35 s for `replaced_by_bot` row

### Issues Found
| Severity | Issue | Impact |
|----------|-------|--------|
| HIGH | **`get_rejoin_status` SQL function does not return `disconnect_timer_started_at`.** HomeScreen checks `statusData.disconnect_timer_started_at` — this field is never present in the response, so the code ALWAYS falls back to the `seconds_left` back-calculation. The home banner countdown is estimated, not precisely anchored to the server timestamp, causing a sync gap with the in-game ring. | Home banner countdown may be off by seconds vs the server timer |
| LOW | `recheckTimeoutRef` (1 s re-check after `'connected'` status) is started in `checkCurrentRoom` but never cleaned up on unmount. If the component unmounts while the timeout is pending, a stale callback fires and attempts to set state. React suppresses this with a warning. | Minor — React handles gracefully |

### Fix
Add `disconnect_timer_started_at` to the `get_rejoin_status` Postgres function return value for the `'disconnected'` and `'connected'` (with active timer) branches.

### Verdict: ⚠️ 1 sync bug, 1 minor cleanup. Requires SQL fix.

---

## Prioritised Fix List

| # | Priority | File | Fix |
|---|----------|------|-----|
| 1 | **HIGH** | `migrations/20260310000002_fix_get_rejoin_status_returns_timer_ts.sql` | Add `disconnect_timer_started_at` to `get_rejoin_status` return |
| 2 | **HIGH** | `src/screens/MultiplayerGame.tsx` | Sync disconnect ring anchor to server's `disconnect_timer_started_at` (pick earlier of server/client) |
| 3 | **LOW** | `src/screens/MultiplayerGame.tsx` | Auto-dismiss `TurnAutoPlayModal` when `isMyTurn` → false |
| 4 | **LOW** | `src/screens/HomeScreen.tsx` | Clear `recheckTimeoutRef` in unmount cleanup |

---

## Implementation Plan

### Fix 1 — SQL Migration (get_rejoin_status)
**File:** `apps/mobile/supabase/migrations/20260310000002_fix_get_rejoin_status_returns_timer_ts.sql`

Add `disconnect_timer_started_at` to the JSONB responses in both the `'disconnected'` branch and the `'connected'` (active timer) branch of `get_rejoin_status`.  
HomeScreen will then use the ISO timestamp to anchor the countdown precisely instead of back-computing from `seconds_left`.

### Fix 2 — Disconnect Ring Anchor Sync
**File:** `apps/mobile/src/screens/MultiplayerGame.tsx` (staleness interval, ~line 580)

In the `connection_status === 'disconnected'` branch of the staleness interval:
- If `rp.disconnect_timer_started_at` is available AND is earlier than the current client anchor, update `clientDisconnectStartRef.current` to the server timestamp.
- `InactivityCountdownRing` already normalises future timestamps to `now` (safe against server clock-ahead).

Also update the staleness-detection path to prefer `rp.disconnect_timer_started_at` if available (for the case where client detects before server Realtime fires).

### Fix 3 — TurnAutoPlayModal Auto-Dismiss
**File:** `apps/mobile/src/screens/MultiplayerGame.tsx`

Add a `useEffect` that watches `isMyTurn` from `useTurnInactivityTimer`. When it transitions from `true` → `false`, clear `showTurnAutoPlayModal`.

### Fix 4 — HomeScreen Timeout Cleanup
**File:** `apps/mobile/src/screens/HomeScreen.tsx`

Add a `useEffect` with cleanup that clears `recheckTimeoutRef.current` on unmount.

---

## Testing Plan (post-implementation)

1. **Inactivity timer**: Start a multiplayer game, leave your turn idle for 60 s. Verify yellow ring depletes and auto-play fires.
2. **Disconnect ring sync**: Have Player B disconnect (kill app). Verify Player A's grey ring starts within ~1 s of when the server set `disconnect_timer_started_at` (check Supabase logs).
3. **Home banner sync**: After Player B disconnects, navigate to Home screen. Verify banner countdown matches in-game ring on Player A's device (within ~2 s).
4. **Autoplay modal dismiss**: After auto-play fires and modal shows, wait for the next player's turn. Verify modal auto-dismisses.
5. **Bot replacement**: Let the 60 s disconnect timer fully expire. Verify bot appears within a few seconds.
6. **Rejoin banner**: After bot replacement, navigate to Home screen. Verify "Replace Bot & Rejoin" button appears.
