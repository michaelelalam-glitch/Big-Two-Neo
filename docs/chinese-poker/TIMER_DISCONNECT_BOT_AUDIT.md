# Timer, Disconnect & Bot Replacement — Full System Audit

> **Date:** 2025-03-12  
> **Branch:** `game/chinese-poker`  
> **Scope:** Inactivity timer, disconnection timer, bot replacement, UI rings, reconnection — all player compositions

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Timer Definitions & Durations](#2-timer-definitions--durations)
3. [State Machine](#3-state-machine)
4. [Timer Interactions](#4-timer-interactions)
5. [Bot Takeover Logic](#5-bot-takeover-logic)
6. [Reconnection Logic](#6-reconnection-logic)
7. [UI Indicators (Ring Behavior)](#7-ui-indicators-ring-behavior)
8. [Scenario Matrix by Player Composition](#8-scenario-matrix-by-player-composition)
9. [Edge Cases](#9-edge-cases)
10. [Identified Inconsistencies & Recommendations](#10-identified-inconsistencies--recommendations)

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT SIDE                                 │
│                                                                     │
│  useConnectionManager ──(5s heartbeat)──→ update-heartbeat EF       │
│  useTurnInactivityTimer ──(500ms poll)──→ auto-play-turn EF         │
│  useAutoPassTimer ──(100ms poll)──→ player-pass EF (self-pass)      │
│  InactivityCountdownRing ──(rAF visual)──→ yellow / charcoal ring   │
│  Client staleness detector ──(1s poll, 12s threshold)──→ grey ring  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                          SERVER SIDE                                 │
│                                                                     │
│  update-heartbeat ──(every ~30s)──→ process_disconnected_players()  │
│    Phase A: Mark stale heartbeats (30s silence → disconnected)      │
│    Phase B: Replace with bot (60s timer expired)                    │
│    Phase C: Close stuck rooms (5min safety net)                     │
│                                                                     │
│  bot-coordinator ──(loop, 300ms delay)──→ play-cards / player-pass  │
│  auto-play-turn ──(on 60s turn expiry)──→ play-cards / player-pass  │
│  mark-disconnected ──(explicit leave)──→ mark_player_disconnected() │
│  reconnect-player ──(rejoin/reclaim)──→ reconnect_player()          │
│  get-rejoin-status ──(app foreground)──→ get_rejoin_status()        │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useConnectionManager.ts` | 5s heartbeat, app state transitions, reconnect/reclaim |
| `src/hooks/useTurnInactivityTimer.ts` | 60s turn countdown, triggers `auto-play-turn` |
| `src/hooks/useAutoPassTimer.ts` | 10s auto-pass for highest plays |
| `src/components/game/InactivityCountdownRing.tsx` | Visual yellow/charcoal ring |
| `src/screens/MultiplayerGame.tsx` | Client staleness detector, enrichedLayoutPlayers, modals |
| `supabase/functions/bot-coordinator/index.ts` | Server bot turn loop |
| `supabase/functions/auto-play-turn/index.ts` | Turn timeout auto-play |
| `supabase/functions/player-pass/index.ts` | Pass + cascade logic |
| `supabase/functions/mark-disconnected/index.ts` | Explicit disconnect |
| `supabase/functions/reconnect-player/index.ts` | Rejoin/reclaim seat |
| `supabase/functions/update-heartbeat/index.ts` | Heartbeat + sweep trigger |
| `supabase/functions/get-rejoin-status/index.ts` | App foreground status check |

---

## 2. Timer Definitions & Durations

| Timer | Duration | Owner | Trigger | Expiry Action |
|-------|----------|-------|---------|---------------|
| **Heartbeat** | Every 5s | Client (`useConnectionManager`) | Interval | Keeps `last_seen_at` fresh |
| **Heartbeat Staleness (Phase A)** | 30s silence | Server (`process_disconnected_players`) | `last_seen_at < NOW() - 30s` | Marks player `disconnected`, sets `disconnect_timer_started_at` |
| **Turn Inactivity** | 60s | Client (`useTurnInactivityTimer`) polls; server (`auto-play-turn`) enforces | `turn_started_at` set on turn change | Auto-plays highest valid cards or passes |
| **Disconnect / Bot Replacement** | 60s | Server (`process_disconnected_players` Phase B) | `disconnect_timer_started_at` set | Bot replaces player |
| **Auto-Pass (Highest Play)** | 10s | Client (`useAutoPassTimer`) polls; server (`player-pass`) cascades | Highest possible play detected | All non-exempt players auto-pass; trick cleared |
| **"I'm Still Here?" Modal** | 30s | Client (`TurnAutoPlayModal`) | Shown after turn auto-play if player is connected | If no response → `mark-disconnected` → bot replacement |
| **Client Staleness Detector** | 12s threshold | Client (`MultiplayerGame.tsx`) | Peer's `last_seen_at` stale | Shows charcoal disconnect ring locally |
| **Stuck Room Cleanup (Phase C)** | 5 min | Server | No human players + room stale | Force-close room |
| **Bot Coordinator Lease** | 45s | Server | Lease acquired per-room | Prevents concurrent bot loops |
| **Bot Move Delay** | 300ms | Server (`bot-coordinator`) | Between consecutive bot turns | Realtime propagation |

---

## 3. State Machine

### Player Connection States

```
                    ┌──────────────────────────┐
                    │       CONNECTED           │
                    │  (heartbeat active,       │
                    │   last_seen_at fresh)     │
                    └─────┬───────────┬─────────┘
                          │           │
          heartbeat stops │           │ explicit leave
          (30s silence)   │           │ (mark-disconnected)
                          │           │
                          ▼           ▼
                    ┌──────────────────────────┐
                    │      DISCONNECTED         │
                    │  disconnect_timer_        │
                    │  started_at = anchor      │
                    │  (60s countdown running)  │
                    └─────┬───────────┬─────────┘
                          │           │
          resume heartbeat│           │ 60s timer expires
          OR reconnect    │           │ (Phase B sweep)
                          │           │
                          ▼           ▼
                    ┌─────────┐  ┌──────────────────┐
                    │CONNECTED│  │ REPLACED_BY_BOT   │
                    │(restored│  │ human_user_id set  │
                    │ no bot) │  │ is_bot = true      │
                    └─────────┘  └────────┬──────────┘
                                          │
                                          │ reconnect_player RPC
                                          │ (reclaim seat)
                                          ▼
                                   ┌─────────────┐
                                   │  CONNECTED   │
                                   │  (human      │
                                   │   restored)  │
                                   └─────────────┘
```

### Turn Lifecycle States

```
TURN STARTS (turn_started_at set)
  │
  ├─ Player is CONNECTED
  │    │
  │    ├─ Player plays/passes within 60s → TURN ADVANCES
  │    │
  │    └─ Player does NOT act for 60s
  │         │
  │         ├─ auto-play-turn fires → plays highest valid or passes
  │         │    │
  │         │    ├─ Player is CONNECTED → TurnAutoPlayModal shown
  │         │    │    ├─ "I'm Still Here" within 30s → player keeps seat
  │         │    │    └─ No response in 30s → mark-disconnected → bot replacement flow
  │         │    │
  │         │    └─ Player is DISCONNECTED → bot replaces immediately
  │         │
  │         └─ TURN ADVANCES (auto-played move)
  │
  ├─ Player DISCONNECTS during turn
  │    │
  │    ├─ Charcoal ring picks up where yellow ring was
  │    │   (anchor = turn_started_at, NOT fresh 60s)
  │    │
  │    ├─ If 60s from turn_started_at expires:
  │    │    ├─ auto-play-turn fires (from any remaining connected client)
  │    │    └─ Phase B replaces with bot (since disconnected)
  │    │
  │    └─ If player reconnects before 60s:
  │         ├─ reconnect_player clears disconnect state
  │         ├─ Yellow ring resumes from elapsed position
  │         └─ Player can still play their turn normally
  │
  └─ Player is a BOT
       └─ bot-coordinator handles turn (300ms delay, BotAI decision)
```

---

## 4. Timer Interactions

### 4.1 Turn Inactivity Timer vs Disconnect Timer

These two timers **share the same 60s window** when a player disconnects during their turn:

| Scenario | Timer Anchor | Who Fires | Result |
|----------|-------------|-----------|--------|
| Player's turn, stays connected, doesn't act | `turn_started_at` | `useTurnInactivityTimer` calls `auto-play-turn` at T+60s | Auto-play, player keeps seat, "I'm Still Here?" modal |
| Player's turn, disconnects at T+20s | `turn_started_at` (reused) | Both: `auto-play-turn` at T+60s AND Phase B at T+60s | Auto-play fires AND bot replaces (disconnected check) |
| Player disconnects NOT during their turn | `last_seen_at` or `NOW()` | Phase B at anchor+60s | Bot replaces after 60s |
| Player explicitly leaves during their turn | `turn_started_at` if within 60s, else `NOW()` | Phase B at anchor+60s | Bot replaces |

**Critical design:** When a player disconnects during their turn, `mark_player_disconnected` (or Phase A) sets `disconnect_timer_started_at = turn_started_at` (not a fresh 60s). This means the disconnect timer and the turn timer expire at the **same moment** — the player doesn't get 60s of inactivity + 60s of disconnect grace. It's a single 60s window from `turn_started_at`.

### 4.2 Disconnect Timer Overriding Inactivity Timer

The disconnect timer **replaces** the inactivity timer visually (charcoal ring replaces yellow ring) but does not extend the deadline:

```
T=0s   Turn starts. Yellow ring begins depleting.
T=20s  Player disconnects. Charcoal ring takes over at 33% depleted.
       The charcoal ring continues from 33% → 0% (not from 100%).
T=60s  Both timers expire simultaneously:
       - auto-play-turn fires (plays highest valid cards/passes)
       - Phase B replaces with bot (player is disconnected)
```

### 4.3 Auto-Pass Timer (10s) Interaction

The 10s auto-pass timer is **independent** of the turn inactivity timer:

- Triggers when the highest possible play is detected (unbeatable combo)
- All non-exempt players auto-pass when their turn arrives and the timer has expired
- Server cascade in `player-pass` atomically completes all remaining passes
- If a player disconnects while auto-pass is active, the auto-pass still runs normally — bot-coordinator handles it if the player's seat becomes a bot

### 4.4 "I'm Still Here?" Modal Timer (30s)

This is a **secondary grace period** only for connected-but-AFK players:

```
T=0s    Turn starts
T=60s   Player hasn't acted → auto-play-turn fires
        Player is CONNECTED → "I'm Still Here?" modal appears (30s countdown)
T=90s   Player hasn't responded → onTimeout fires:
        → mark-disconnected called
        → disconnect_timer_started_at = NOW() (fresh 60s)
        → Phase B will replace at T=150s total
```

**Total AFK-but-connected window: up to 150s** (60s inactivity + 30s modal + 60s disconnect)

---

## 5. Bot Takeover Logic

### 5.1 Conditions for Bot Replacement

A bot replaces a player when ALL of these are true:
1. `connection_status = 'disconnected'`
2. `disconnect_timer_started_at <= NOW() - 60s`
3. `is_bot = FALSE` (not already a bot)
4. Room is in `playing` state and not offline

**Triggered by:** `process_disconnected_players()` Phase B, called via:
- Periodic sweep (every ~30s via heartbeat piggyback)
- Forced sweep (`forceSweep()` from client when disconnect ring expires)

### 5.2 Bot Replacement Process

```sql
UPDATE room_players SET
  human_user_id = user_id,        -- preserve human's UUID for reclaim
  user_id = NULL,                  -- seat no longer owned by human  
  is_bot = TRUE,
  bot_difficulty = room.bot_difficulty,  -- ranked = 'hard'
  connection_status = 'replaced_by_bot',
  username = 'Bot ' || original_username,
  disconnected_at = NULL,
  disconnect_timer_started_at = NULL
```

### 5.3 Special Case — No Other Humans

If after replacement, no connected humans remain in the room:
- Room status → `finished`
- Game history inserted with:
  - Last human to leave: `outcome = 'voided'`
  - All other humans: `outcome = 'abandoned'`
- No bot replacement occurs (room closes instead)

### 5.4 What the Bot Does After Takeover

1. `bot-coordinator` is triggered (via `update-heartbeat` bot watchdog or explicit trigger after Phase B)
2. Bot uses `BotAI` with room's difficulty setting
3. Plays strategically (not punitive — that's only for `auto-play-turn`)
4. Loops through consecutive bot turns with 300ms delay
5. Re-fetches current-turn player from DB **every iteration** (critical for reconnect race)

---

## 6. Reconnection Logic

### 6.1 Reconnect Before Bot Replacement (still `disconnected`)

**Trigger:** Player foregrounds app → `get-rejoin-status` returns `{ status: 'disconnected', seconds_left }` → heartbeat resumes

**What happens:**
- Heartbeat update sets `connection_status = 'connected'`, `disconnected_at = NULL`
- **`disconnect_timer_started_at` is NOT cleared by heartbeat** — it persists
- Next Phase A sweep sees the player is now `connected` → skips them
- Phase B sees `connection_status != 'disconnected'` → skips them
- Client clears disconnect ring when heartbeat is fresh AND `disconnect_timer_started_at` is NULL
- **Potential issue:** `disconnect_timer_started_at` persists until `reconnect_player` RPC or active game action clears it. Heartbeat alone does not clear it. This means:
  - If the player disconnects again before it's naturally cleared, the old anchor might be reused via COALESCE

### 6.2 Reconnect After Bot Replacement (status = `replaced_by_bot`)

**Trigger:** Player foregrounds app → `get-rejoin-status` returns `{ status: 'replaced_by_bot', bot_username }` → `RejoinModal` shown

**"Reclaim My Seat" flow:**
1. Client calls `reconnect-player` edge function
2. `reconnect_player` RPC restores:
   ```sql
   user_id = human's UUID
   human_user_id = NULL
   is_bot = FALSE
   bot_difficulty = NULL
   connection_status = 'connected'
   username = original_username  (from replaced_username)
   disconnect_timer_started_at = NULL
   disconnected_at = NULL
   last_seen_at = NOW()
   ```
3. Broadcasts `player_reconnected` to room channel
4. `bot-coordinator` sees `is_bot = FALSE` on next iteration → stops bot loop
5. If it's this player's turn, they can immediately play
6. If it's not their turn, they wait normally

### 6.3 Reconnect While Bot Is Mid-Turn

- `bot-coordinator` re-fetches the current turn player from DB **every iteration**
- When `reconnect_player` sets `is_bot = false`, the next bot-coordinator iteration sees the change and **exits immediately**
- If bot already submitted a play for this turn (HTTP to `play-cards` in flight), that play completes — the human picks up from the next turn
- There is no rollback of a bot's in-flight move

### 6.4 Reconnect After Bot Already Completed the Turn

- The turn has advanced; the human's cards may have changed (bot played some)
- Human picks up from current game state — they see the cards the bot has left
- No undo of bot's plays is possible

---

## 7. UI Indicators (Ring Behavior)

### 7.1 Ring Types

| Ring | Color | Mode | Duration |
|------|-------|------|----------|
| **Yellow (Turn)** | `#FFD700` (→ `#FFC107` at <15s) | `type="turn"` | 60s from `turn_started_at` |
| **Charcoal (Disconnect)** | `#4A4A4A` (→ `#2E2E2E` at <15s) | `type="connection"` | 60s from `disconnect_timer_started_at` |

Both use the same `InactivityCountdownRing` component with `COUNTDOWN_DURATION_MS = 60,000`.

### 7.2 Ring Behavior by Situation

#### A. Player's Turn, Connected, Active
- **Yellow ring** depletes clockwise from 100% → 0% over 60s
- Other players see yellow ring on the active player's avatar
- Active player sees yellow ring on their own avatar

#### B. Player's Turn, Connected, Inactive (AFK)
- **Yellow ring** continues depleting
- At 0%: `auto-play-turn` fires, highest cards played automatically
- Ring disappears, turn advances
- AFK player sees **"I'm Still Here?" modal** with 30s countdown

#### C. Player's Turn, Disconnects Mid-Turn
- **Yellow ring → charcoal ring transition**
- Charcoal ring picks up at the exact depletion point (no jump)
- Anchor: `turn_started_at` (same as yellow ring)
- Other players see: charcoal ring continuing to deplete
- At 0%: bot replaces player (Phase B + auto-play-turn)

#### D. Player Disconnects (NOT Their Turn)
- **Charcoal ring** appears on their avatar
- Anchor: `disconnect_timer_started_at` (set by Phase A or `mark-disconnected`)
- Depletes over 60s
- At 0%: bot replaces player

#### E. Player Reconnects (Ring Was Showing)
- Charcoal ring **disappears** when:
  - Heartbeat is fresh (< 12s stale)
  - AND `disconnect_timer_started_at` is NULL
- Yellow ring **reappears** if it's still their turn (from elapsed position)

#### F. Bot Takes Over
- Ring disappears (bot plays immediately via bot-coordinator)
- Other players see the avatar change to "Bot {name}"
- Disconnected player sees `RejoinModal`

### 7.3 What Each Player Sees During Transitions

| Event | Disconnecting Player | Other Players |
|-------|---------------------|---------------|
| Player disconnects during turn | Screen may freeze/blank (app backgrounded) | Yellow → charcoal ring transition on that player's avatar |
| Player disconnects NOT during turn | Screen may freeze/blank | Charcoal ring appears on that player's avatar |
| Bot replaces player | `RejoinModal` on return ("Reclaim My Seat") | Avatar shows "Bot {name}", ring disappears |
| Player reconnects (before bot) | Game resumes, yellow ring if still their turn | Charcoal ring disappears, yellow ring if their turn |
| Player reconnects (after bot) | `RejoinModal` → "Reclaim My Seat" → game resumes | "Bot {name}" reverts to "{name}", possible mid-turn transition |
| Turn auto-play (connected AFK) | "I'm Still Here?" modal with 30s timer | Turn advances normally, auto-played cards visible |
| "I'm Still Here?" modal timeout | `mark-disconnected` fires → disconnected state | Charcoal ring appears (60s fresh countdown) |

### 7.4 Ring Transition: Yellow → Charcoal (Disconnect During Turn)

The `enrichedLayoutPlayers` mapping in `MultiplayerGame.tsx` handles this:

1. Client staleness detector (12s threshold) fires OR Realtime delivers `connection_status = 'disconnected'`
2. `clientDisconnectStartRef` is set to the **earlier** of:
   - `turn_started_at` (if it's their turn)
   - `disconnect_timer_started_at` (from server)
   - `last_seen_at`
3. `InactivityCountdownRing` receives `type="connection"` and `startedAt = anchor`
4. Since the anchor is `turn_started_at` (same as the yellow ring's anchor), the charcoal ring appears at the **exact same depletion point** — no visual jump

**Special case for local player (idx=0):** The `#624 fix` suppresses the disconnect ring when it's the local player's turn:
- `disconnectTimerStartedAt = null` → no charcoal ring
- `isDisconnected = false` → no disconnect spinner
- This prevents the scenario where Realtime delivers a stale `disconnect_timer_started_at` before `reconnect_player` clears it

---

## 8. Scenario Matrix by Player Composition

### Legend

- **H** = Human player
- **B** = Bot player
- **[T]** = Currently has the turn
- **DC** = Disconnected
- **RC** = Reconnected
- **BR** = Bot-replaced

---

### 8.1 — 1 Human vs 3 Bots (H1, B2, B3, B4)

This is the simplest case. Only one human can disconnect.

| Scenario | What Happens |
|----------|-------------|
| **H1[T] plays normally** | Yellow ring on H1. H1 plays → bots play in sequence (300ms each) → back to H1. |
| **H1[T] goes AFK (connected)** | Yellow ring depletes over 60s → `auto-play-turn` fires → highest valid play. "I'm Still Here?" modal (30s). If confirmed → game continues. If timeout → `mark-disconnected` → 60s disconnect timer → Phase B: **no other humans → room closes** (H1 voided). |
| **H1[T] disconnects** | Yellow → charcoal ring (other players = bots, no one sees it). 60s from `turn_started_at`: `auto-play-turn` fires + Phase B: **no other humans → room closes** (H1 voided). |
| **H1 disconnects (not turn)** | Charcoal ring (bots don't see UI). 60s: Phase B: **no other humans → room closes** (H1 voided). |
| **H1 reconnects before 60s** | Game resumes normally. Bots continue playing their turns. |
| **H1 reconnects after room closed** | `get-rejoin-status` returns `room_closed`. Player navigated to Home. |

**Key insight:** In 1H vs 3B, the human is never replaced by a bot — the room always closes when the only human disconnects for 60s, because Phase B checks "are there other connected humans?" first.

---

### 8.2 — 2 Humans vs 2 Bots (H1, H2, B3, B4)

| Scenario | What Happens |
|----------|-------------|
| **H1[T] plays normally** | Yellow ring on H1. Normal turn flow. |
| **H1[T] goes AFK** | Yellow ring → 60s → auto-play → "I'm Still Here?" (30s). If timeout → disconnect → 60s → bot replaces H1. H2, B3, B4 continue. "Bot H1" plays for H1. |
| **H1[T] disconnects at T+20s** | Charcoal ring picks up at 33% depleted. At T+60s: bot replaces H1. H2 sees "Bot H1" on avatar. Bot-coordinator takes H1's turns. |
| **H1 reconnects at T+50s (before bot)** | H1 resumes. It's still H1's turn. Yellow ring at 83% depleted. H1 can play. |
| **H1 reconnects at T+70s (after bot)** | `RejoinModal` → "Reclaim My Seat" → `reconnect_player` restores seat. If bot already played this turn, H1 waits for next turn. Bot-coordinator stops on next iteration. |
| **Both H1 and H2 disconnect** | Both get 60s timers. If both expire: **no humans left → room closes** (first to leave = voided, second = abandoned OR both voided if simultaneous). |
| **H1 disconnects, then H2 disconnects** | H1 gets 60s timer. If H1's timer expires while H2 still connected: H1 → bot. If H2 then disconnects: only "Bot H1" + B3 + B4 are non-human → Phase B for H2: **no other connected humans → room closes** (H2 voided, H1 abandoned). |
| **H1[T] disconnects, H2 reconnects H1's timer expires** | H1 replaced by bot. H2 still playing. Bot H1 + H2 + B3 + B4 continue. |
| **H1 disconnects & reconnects 3 times during turn** | Each disconnect: charcoal ring appears. Each reconnect: charcoal clears, yellow resumes. The timer anchor (`turn_started_at`) doesn't reset — total 60s from turn start. If the cumulative time from turn start reaches 60s, auto-play fires regardless of current connection state. |

---

### 8.3 — 3 Humans vs 1 Bot (H1, H2, H3, B4)

| Scenario | What Happens |
|----------|-------------|
| **Normal play** | Humans take turns with yellow rings. B4 plays via bot-coordinator. |
| **H1[T] disconnects** | Charcoal ring on H1 (H2, H3 see it). 60s → bot replaces H1. Game continues: Bot H1, H2, H3, B4. |
| **H1[T] disconnects, H1 reconnects, H1 disconnects again** | First DC: charcoal ring from `turn_started_at` anchor. RC: ring clears. Second DC: new `disconnect_timer_started_at` anchor. If it's still H1's turn, anchor = `turn_started_at` (COALESCE preserves earlier anchor). If turn advanced, anchor = `NOW()` (fresh 60s). |
| **H1 and H2 both disconnect** | Both get independent 60s timers. Both can be bot-replaced independently. H3 continues playing with Bot H1, Bot H2, B4. |
| **All 3 humans disconnect** | First two get replaced by bots (if the third is still connected when their timer expires). If all three timers expire with no connected humans → room closes. **Race condition:** Phase B processes them one at a time. If H1 and H2 are replaced first (H3's timer hasn't expired yet), H3 still gets a full 60s. If H3's expires and no humans connected → room closes. |
| **H2 reconnects after H1 was bot-replaced** | H2 sees "Bot H1" on H1's avatar. Game continues normally. |
| **H1 reconnects and reclaims while B4 is currently playing** | No conflict — B4 is an original bot, H1 reclaims their own seat. Bot-coordinator handles B4's turn independently. |

---

### 8.4 — 4 Humans (H1, H2, H3, H4)

Most complex — all players can disconnect.

| Scenario | What Happens |
|----------|-------------|
| **Normal play** | All humans. Yellow ring on active player. No bot-coordinator involvement. |
| **H1[T] goes AFK** | Yellow ring → 60s → auto-play (punitive: highest cards). "I'm Still Here?" modal. If confirmed → continues. If timeout → disconnect → 60s → bot replaces → Bot H1, H2, H3, H4. |
| **H1[T] disconnects** | Yellow → charcoal. 60s from `turn_started_at` → bot replaces H1. Bot H1 takes over. H2, H3, H4 see "Bot H1". |
| **H1 disconnects (not turn)** | Charcoal ring. 60s → bot replaces. |
| **H1[T] disconnects at T+25s, reconnects at T+40s** | Charcoal ring from T+0 to T+40 (58% → 33%). At T+40: reconnect clears charcoal, yellow resumes at 33% remaining. H1 plays normally. |
| **H1[T] disconnects, reconnects, disconnects again** | See Section 9 Edge Cases. Anchor doesn't reset within same turn. |
| **H1 and H3 disconnect simultaneously** | Independent timers. Both can be bot-replaced. H2 and H4 continue with Bot H1, Bot H3. |
| **H1, H2, H3 disconnect; H4 alone** | H1, H2, H3 all on 60s timers. As each expires, replaced by bot. H4 plays with Bot H1, Bot H2, Bot H3. |
| **All 4 disconnect** | As each expires, Phase B checks for remaining humans. When the last human's timer expires → **room closes** (no replacement, game voided/abandoned). |
| **H2 reconnects after being bot-replaced, reclaims seat** | `RejoinModal` → reclaim → `reconnect_player` → `is_bot=false`. H2 is human again. If it was Bot H2's turn and bot was mid-play, bot finishes current move, then coordinator stops. |
| **H1[T] disconnects → bot replaces → bot plays 3 more turns → H1 reconnects** | H1 reclaims seat. H1's hand has fewer cards (bot played some). H1 sees current game state. No undo. |

---

## 9. Edge Cases

### 9.1 Multiple Disconnect/Reconnect During Same Turn

```
T=0s    H1's turn starts. Yellow ring begins.
T=15s   H1 disconnects. Charcoal ring at 75%.
T=25s   H1 reconnects. Yellow ring at 58%.
T=35s   H1 disconnects again. Charcoal ring at 42%.
T=45s   H1 reconnects. Yellow ring at 25%.
T=55s   H1 still hasn't played. Yellow ring at 8%.
T=60s   auto-play-turn fires. H1 is connected → "I'm Still Here?" modal.
```

**Timer anchor behavior:** `disconnect_timer_started_at` is set to `turn_started_at` on first disconnect (COALESCE preserves earliest). On reconnect, `reconnect_player` clears `disconnect_timer_started_at = NULL`. On second disconnect, `mark_player_disconnected` uses COALESCE — but since it was cleared, it sets a **new** anchor. However, if the turn hasn't changed, the SQL uses `turn_started_at` as anchor again (it's within the last 60s), so effectively the same deadline.

**Net result:** The 60s deadline is always measured from `turn_started_at` regardless of disconnect/reconnect cycles during the same turn.

### 9.2 Player Reconnects While Bot Is Executing Their Turn

```
T=0s    H1 disconnects.
T=60s   Bot replaces H1. Bot-coordinator starts.
T=61s   Bot-coordinator fetches game state. It's Bot H1's turn.
T=61.3s Bot submits play-cards HTTP request.
T=61.5s H1 reconnects → reconnect_player sets is_bot=false.
T=61.8s play-cards completes (bot's play was already submitted).
T=62.1s Bot-coordinator loop iteration: re-fetches player → is_bot=false → STOPS.
```

**Result:** The bot's in-flight move completes. H1 picks up from the next state. No rollback.

### 9.3 Player Reconnects After Bot Completed Their Turn

- H1 was replaced at T+60s
- Bot played H1's turn at T+61s, advanced to next player
- H1 reconnects at T+120s
- H1 sees `RejoinModal`, reclaims seat
- H1's hand is now smaller (bot played cards)
- H1 waits for their next turn normally

### 9.4 Auto-Play Fires for Connected Player, Then They Disconnect During Modal

```
T=60s   auto-play-turn fires. H1 connected → "I'm Still Here?" modal.
T=70s   H1's app crashes / loses connection.
T=90s   Modal's 30s timer hasn't expired yet (from H1's perspective, app is dead).
        Server: heartbeat stops. After 30s silence → Phase A marks disconnected.
T=100s  Phase A: disconnect_timer_started_at = NOW() (fresh 60s, 
        NOT turn_started_at since turn already advanced).
T=160s  Phase B: bot replaces H1.
```

### 9.5 Two Players Disconnect at Different Times, Both Reconnect

```
T=0s    H1 disconnects. Timer anchor = NOW().
T=30s   H2 disconnects. Timer anchor = NOW().
T=45s   H1 reconnects (within 60s). H1 restored.
T=50s   H2 reconnects (within 60s). H2 restored.
         Both charcoal rings clear. Game continues normally.
```

### 9.6 Disconnect During Auto-Pass Timer (10s)

- Auto-pass timer (10s) is independent of disconnect state
- If a player disconnects while auto-pass is active:
  - Their auto-pass still fires when their turn arrives (server cascade handles it atomically)
  - Separately, the disconnect 60s timer runs
  - The auto-pass timer is much shorter (10s) so it completes well before bot replacement
  - Bot-coordinator also checks auto-pass timer: if expired and bot is not exempt, forces a pass

### 9.7 Room With All Bots After Replacements

If all humans disconnect and get replaced in sequence:
- Phase B checks each time: "are there other connected humans?"
- The **last** human's 60s timer expiring triggers room closure (not bot replacement)
- Previous humans who were already replaced → their game is already voided/abandoned
- Phase C (5min safety net) catches any room that somehow still has all bots and no humans

### 9.8 `forceSweep` Client-Side Trigger

When another player's charcoal ring expires on a client's screen:
- That client calls `forceSweep()` (heartbeat with `force_sweep: true`)
- Server validates: checks if any player has `disconnect_timer_started_at <= NOW() - 55s`
- If valid: runs `process_disconnected_players()` immediately
- Triggers bot-coordinator for affected rooms
- 5s belt-and-suspenders retry: client calls `forceSweep()` again after 5s if the ring already expired
- Phase B uses `<=` (not `<`) so exact-60s boundary is handled correctly

---

## 10. Identified Inconsistencies & Recommendations

### 10.1 `disconnect_timer_started_at` Persistence After Reconnect via Heartbeat

**Issue:** When a player reconnects by simply resuming heartbeat (not via explicit `reconnect-player` RPC), the heartbeat sets `connection_status = 'connected'` and clears `disconnected_at`, but **does NOT clear `disconnect_timer_started_at`**. Only `reconnect_player` RPC and active game actions clear it.

**Impact:** The persistent timer anchor means:
- Client must check both heartbeat freshness AND `disconnect_timer_started_at = NULL` before hiding the charcoal ring
- If the player disconnects again quickly, COALESCE may pick up the stale anchor
- The client-side staleness detector correctly handles this (only clears `clientDisconnectStartRef` when both conditions met)

**Risk level:** Low. The current code handles this correctly in practice, but the split responsibility (heartbeat clears some fields, RPC clears others) adds complexity.

**Recommendation:** Consider clearing `disconnect_timer_started_at` in the heartbeat UPDATE when `connection_status` transitions from `disconnected` to `connected`. This would simplify the client-side logic and eliminate the dual-condition check.

### 10.2 Heartbeat Staleness Detection Threshold (30s) vs Client Staleness (12s)

**Current state:**
- Client shows charcoal ring after 12s of peer heartbeat silence
- Server marks player `disconnected` after 30s of heartbeat silence

**Impact:** There's an 18s window where the client shows a charcoal disconnect ring but the server hasn't marked the player as disconnected yet. During this window:
- The ring is "cosmetic only" — no server-side timer is running
- If the player resumes heartbeat, the ring disappears without any server state change
- This is intentional (early visual feedback to other players)

**Risk level:** None. This is by design and works correctly.

### 10.3 AFK Player Total Grace Period (up to 150s)

**Current flow for a connected-but-AFK player:**
1. 60s turn inactivity → auto-play
2. 30s "I'm Still Here?" modal → mark-disconnected
3. 60s disconnect timer → bot replacement

**Total: 150 seconds** before bot takes over an AFK-but-connected player.

**Consideration:** This is a deliberate design choice — punishing connected players less aggressively than disconnected ones. The auto-play at 60s is already punitive (plays highest cards), so the 150s total is acceptable.

### 10.4 Bot-Coordinator Re-fetch Race Window

**Current behavior:** Bot-coordinator re-fetches the current-turn player from DB on every iteration. When `reconnect_player` runs, the next iteration sees `is_bot = false` and stops.

**Race window:** Between the bot's HTTP request to `play-cards` and the response, `reconnect_player` may run. The bot's play completes, and the human picks up from the next state.

**Risk level:** Low. The bot's move is valid and completes atomically. The human simply picks up from the resulting state. No data corruption possible.

**Recommendation:** Document this as expected behavior so players understand they may see a bot's last move complete after reclaiming their seat.

### 10.5 Phase A Anchor Selection: `LEAST(turn_started_at, last_seen_at)`

**Current behavior:** When Phase A marks a player as disconnected during their turn, it uses `LEAST(turn_started_at, last_seen_at)` as the disconnect timer anchor.

**Why `LEAST`:** If `last_seen_at` is earlier than `turn_started_at` (heartbeat was already stale when the turn started), the earlier anchor is more accurate. If `turn_started_at` is earlier (normal case: turn started, then heartbeat stopped), using `turn_started_at` ensures the charcoal ring picks up where the yellow ring was.

**Risk level:** None. This is correct behavior.

### 10.6 Explicit Leave (`mark-disconnected`) vs Heartbeat Silence

| Method | Timer Anchor | Speed |
|--------|-------------|-------|
| Explicit leave (navigate away) | `turn_started_at` if during turn, else `NOW()` | Immediate |
| App background (heartbeat stops) | Phase A after 30s: `LEAST(turn_started_at, last_seen_at)` | 30s delay |
| WebSocket drop (presence leave) | Client backdates `last_seen_at` to 60s ago → staleness detector fires in 1s | ~1s visual, 30s server |

**Recommendation:** The WebSocket drop → backdate behavior is clever but fragile. If the presence leave event is missed (Realtime is unreliable), the fallback is the 30s heartbeat silence detection. This dual-path is acceptable.

---

## Summary: Complete State Diagram

```
                         ┌─────────────────────────────────┐
                         │          CONNECTED               │
                         │  Heartbeat: every 5s             │
                         │  Yellow ring: if it's their turn │
                         └──────┬──────────┬───────────────┘
                                │          │
          ┌─────────────────────┘          └──────────────────────┐
          │                                                       │
          ▼                                                       ▼
  ┌───────────────────┐                               ┌──────────────────────┐
  │  AFK (connected)  │                               │  DISCONNECTED        │
  │  Turn timer: 60s  │                               │  DC timer: 60s       │
  │  Yellow ring      │                               │  Charcoal ring       │
  └───────┬───────────┘                               └──────┬───────────────┘
          │                                                   │
          ▼ (60s)                                             │
  ┌───────────────────┐                              ┌────────┤
  │  AUTO-PLAYED      │                              │        │
  │  "I'm Still Here?"│                              │        ▼ (60s, no other
  │  Modal: 30s       │                              │         humans left)
  └────┬──────┬───────┘                              │  ┌──────────────┐
       │      │                                      │  │  ROOM CLOSED │
       │      ▼ (30s timeout)                        │  │  (voided/    │
       │  ┌───────────────────┐                      │  │   abandoned) │
       │  │  mark-disconnected│                      │  └──────────────┘
       │  │  DC timer: 60s    │                      │
       │  │  Charcoal ring    │──────────┐           │
       │  └───────────────────┘          │           │
       │                                 │           │
       ▼ ("I'm Still Here")             ▼ (60s)     ▼ (60s, other 
  ┌──────────────┐              ┌──────────────────┐  humans exist)
  │  CONNECTED   │              │ REPLACED_BY_BOT  │◄─────────┘
  │  (resumed)   │              │ human_user_id set│
  └──────────────┘              │ Bot plays turns  │
                                └────────┬─────────┘
                                         │
                                         │ reconnect_player
                                         ▼
                                ┌──────────────────┐
                                │  CONNECTED       │
                                │  (seat reclaimed)│
                                │  Bot stops       │
                                └──────────────────┘
```

---

## Quick Reference: Timer Summary Table

| Event | Timer | Duration | Visual | Expiry |
|-------|-------|----------|--------|--------|
| Turn starts | Turn inactivity | 60s | Yellow ring | Auto-play highest valid |
| Highest play detected | Auto-pass | 10s | AutoPassTimer UI | All non-exempt pass |
| Player disconnects (during turn) | Disconnect | 60s from `turn_started_at` | Charcoal ring (picks up from yellow) | Bot replaces |
| Player disconnects (not turn) | Disconnect | 60s from anchor | Charcoal ring (fresh) | Bot replaces |
| Auto-play modal shown | Modal | 30s | "I'm Still Here?" modal | `mark-disconnected` |
| All humans gone | Room cleanup | Immediate | — | Room closes |
| Stuck room (no humans, stale) | Phase C | 5 min | — | Force-close |
