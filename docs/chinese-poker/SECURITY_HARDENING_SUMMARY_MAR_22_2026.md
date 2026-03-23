# Security Hardening & Migration Summary — March 22, 2026

**PR #171** · Branch `game/chinese-poker` → `main`  
**Supabase project:** `dppybucldqufbqhwnkxu` (big2-mobile-backend)  
**Copilot review rounds completed:** 11 (zero new comments after Round 11)

---

## What Was Done

This PR resolved every Supabase security advisor warning/error/info, tightened TypeScript type safety throughout the codebase, and cleaned up multiple anti-patterns spotted across 11 rounds of automated Copilot code review.

---

## 1. Migration History

Four migrations were applied to the production database on March 22, 2026, in sequence.

### `20260322000000_security_hardening.sql`
**Purpose:** First-pass hardening targeting all Supabase advisor findings.

| # | Advisory | Fix |
|---|----------|-----|
| 1 | `function_search_path_mutable` (62 functions) | Dynamic `DO $$` block iterates `pg_proc` and runs `ALTER FUNCTION … SET search_path = public, pg_catalog` on every public function that was missing it. Skips functions that already have a custom `search_path`. |
| 2 | `rls_enabled_no_policy` on `room_analytics` | Enabled RLS on `public.room_analytics`. **No** client-facing SELECT policy — the `metadata` column contains raw `SQLERRM` error strings that must stay service_role-only. Existing authenticated SELECT policy dropped (idempotent). |
| 3 | `bot_coordinator_locks` exposure | Intentionally left with zero client policies. `service_role` bypasses RLS. A broad authenticated SELECT policy would expose coordinator lock state unnecessarily. |
| 4 | Permissive RLS policies on `public.players` | Replaced three `USING (true)` / `WITH CHECK (true)` policies (UPDATE, INSERT, DELETE) with `auth.uid()`-scoped equivalents. Wrapped in an `IF to_regclass('public.players') IS NOT NULL` guard for environments that use `room_players` instead. |
| 5 | Permissive RLS on `public.rooms` INSERT | Changed INSERT policy from unauthenticated to `TO authenticated`. |

---

### `20260322000001_fix_remaining_security_advisories.sql`
**Purpose:** Fix the remaining 8 security advisory entries not covered by the first migration.

| # | Advisory | Fix |
|---|----------|-----|
| 1 | `rls_enabled_no_policy` on `bot_coordinator_locks` | Added explicit deny-all policy `"no_direct_client_access"` (`USING (false) WITH CHECK (false)`) to clear the advisory. |
| 2–4 | `materialized_view_in_api` on `leaderboard_ranked`, `leaderboard_global`, `leaderboard_casual` | Revoked `SELECT` on all three views from `anon, authenticated`. All client reads now go through **SECURITY DEFINER RPC wrappers** (see Section 2 below). |
| 5 | `rls_policy_always_true` on `game_events` INSERT | Dropped `"System can insert game events"` policy (service_role bypasses RLS; only service_role writes game events). |
| 6 | `rls_policy_always_true` on `game_state` ALL | Dropped `"Service role can manage game state"` policy. |
| 7–8 | `rls_policy_always_true` on `match_history` / `match_participants` INSERT | Dropped `"System can insert match history"` and `"System can insert match participants"`. |

---

### `20260322000002_leaderboard_rpc_hardening.sql`
**Purpose:** Patch the initial RPC wrappers after code review feedback.

| Step | Change |
|------|--------|
| 1 | Dropped the wrongly-named `get_my_leaderboard_rank_ranked(uuid)` and `get_my_leaderboard_rank_casual(uuid)` functions. |
| 2 | Re-created the three paginated functions (`get_leaderboard_ranked`, `get_leaderboard_casual`, `get_leaderboard_global`) with hardened `p_limit`/`p_offset` clamping: `LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 0), 100)` and `OFFSET GREATEST(COALESCE(p_offset, 0), 0)`. This prevents negative or NULL input from producing unbounded reads. |
| 3 | Created honest per-user lookup functions: `get_leaderboard_rank_ranked_by_user_id(uuid)` and `get_leaderboard_rank_casual_by_user_id(uuid)`. |
| 4 | Set explicit EXECUTE permissions: `REVOKE EXECUTE … FROM PUBLIC` on every wrapper, then `GRANT EXECUTE … TO anon, authenticated` for paginated lists and `TO authenticated` for per-user lookups. |

---

### `20260322000003_round2_corrections.sql`
**Purpose:** Clean up a stale policy left over from an early iteration of `20260322000000`.

| Change |
|--------|
| `DROP POLICY IF EXISTS "Authenticated users can read room analytics" ON public.room_analytics` — this policy was created during an earlier iteration of the first migration and re-exposes data that must stay service_role-only. |

---

## 2. Leaderboard RPC Wrappers

Direct `SELECT` on the three leaderboard materialized views is now fully revoked from `anon` and `authenticated`. All client queries go through SECURITY DEFINER wrappers with locked `search_path`.

| Function | Granted To | Description |
|----------|-----------|-------------|
| `get_leaderboard_ranked(p_limit, p_offset)` | `anon, authenticated` | Paginated ranked leaderboard. `p_limit` clamped 0–100; `p_offset` ≥ 0. |
| `get_leaderboard_casual(p_limit, p_offset)` | `anon, authenticated` | Paginated casual leaderboard. Same bounds. |
| `get_leaderboard_global(p_limit, p_offset)` | `anon, authenticated` | Paginated global leaderboard. Same bounds. |
| `get_leaderboard_rank_ranked_by_user_id(p_user_id)` | `authenticated` | Single-user rank lookup for ranked mode. |
| `get_leaderboard_rank_casual_by_user_id(p_user_id)` | `authenticated` | Single-user rank lookup for casual mode. |

All five functions are:
- `LANGUAGE sql STABLE SECURITY DEFINER`
- `SET search_path = public, pg_catalog`
- EXECUTE revoked from `PUBLIC`, then explicitly granted to intended roles

---

## 3. TypeScript / App-Layer Fixes

These fixes were made in response to 11 rounds of Copilot code review on PR #171.

### `useRealtime.ts`
- **Unsafe cast removed.** Replaced single `data as unknown as GameState` with an explicit per-field mapper. A `type GameStateRow = Database['public']['Tables']['game_state']['Row']` alias is used, and every `Json`-typed DB column is individually cast to its app-layer type (e.g., `(row.hands ?? {}) as unknown as GameState['hands']`).
- **Null `room_id` guard.** If the DB row has `room_id = null`, the mapper logs an error and calls `setGameState(null)` instead of fabricating `room_id: ''` (which would create an invalid `GameState` object).

### `useRoomLobby.ts`
- **`effectiveMaxPlayers`.** `joinRoom` now derives the slot limit as `const effectiveMaxPlayers = existingRoom.max_players ?? 4` (defaulting to 4 when the column is null).
- **Loop uses `effectiveMaxPlayers`.** The player-index scan loop changed from `while (… && player_index < 4)` to `while (… && player_index < effectiveMaxPlayers)`, with an explicit `throw new Error('Room is full')` guard when no slot is available.
- **Full check.** The capacity guard before insert (`count >= max_players`) also uses `effectiveMaxPlayers`.

### `useGameStatsUploader.ts`
- **Non-bot null `user_id` invariant.** When building the player roster for stats upload, a non-bot player with a null `user_id` now logs an error and falls back to `unknown_${idx}` rather than silently passing `null` downstream.
- **Winner null abort.** If the winning player is a non-bot but has a null `user_id`, the stats upload is aborted entirely (returns early) rather than uploading an invalid winner record.

### `pushNotificationTriggers.ts`
- **Error response logging.** Replaced a bug that was logging a raw `Response` object (which printed `[object Response]`) with `ctx.text()` to capture the actual response body text for error diagnosis.

### `StatsScreen.tsx`
- **Tightened `isHistEntry` type guard.** The type predicate for `rank_points_history` entries now checks the *value types* of each property (`typeof … === 'string'`, `typeof … === 'number'`, `typeof … === 'boolean'`), not just key presence. This prevents malformed JSON from being trusted as a valid history entry.
- **Removed `as any` casts.** RPC result types use proper PostgREST builder typing instead of force-casting with `as any`.

### `LobbyScreen.tsx`
- **`handleToggleReady` auth guard.** Added explicit `if (!user?.id) { roomLogger.error(…); return; }` before the `room_players` UPDATE. The `.eq('user_id', user.id)` filter no longer uses `?? ''` fallback.
- **`handleStartWithBots` auth guard.** Same pattern applied — explicit null check before the `room_players` SELECT used to look up the host's player record.

---

## 4. Security Advisor Status After Migrations

| Advisory Type | Severity | Count Before | Count After |
|---------------|----------|-------------|------------|
| `function_search_path_mutable` | WARN | 62 | **0** |
| `materialized_view_in_api` | WARN | 3 | **0** |
| `rls_policy_always_true` | WARN | 4 | **0** |
| `rls_enabled_no_policy` | INFO | 1 (`bot_coordinator_locks`) | **0** |
| `room_analytics` exposed to clients | — | yes | **no** |

---

## 5. Manual Test Checklist

Run all tests below against the **staging or production Supabase project** (`dppybucldqufbqhwnkxu`) using the app on a real device or simulator.

---

### A. Supabase Dashboard Verification (no device needed)

- [ ] **A1** — Go to Supabase Dashboard → **Security Advisor**. Confirm zero warnings/errors/infos remain. The three leaderboard materialized-view entries, the four `rls_policy_always_true` entries, the `bot_coordinator_locks` entry, and all `function_search_path_mutable` entries should be gone.
- [ ] **A2** — In the Supabase SQL editor, run:
  ```sql
  SELECT proname, proconfig FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND (p.proconfig IS NULL OR NOT array_to_string(p.proconfig, ',') LIKE '%search_path=%');
  ```
  **Expected:** 0 rows (every public function has `search_path` locked).
- [ ] **A3** — Verify `room_analytics` has RLS enabled and no client-facing SELECT policy:
  ```sql
  SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'room_analytics';
  SELECT policyname, roles FROM pg_policies WHERE tablename = 'room_analytics';
  ```
  **Expected:** `rowsecurity = true`; no policy with `roles` containing `authenticated`.
- [ ] **A4** — Verify leaderboard views are no longer accessible to API roles:
  ```sql
  SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
  WHERE table_name IN ('leaderboard_ranked','leaderboard_casual','leaderboard_global')
    AND grantee IN ('anon','authenticated');
  ```
  **Expected:** 0 rows.
- [ ] **A5** — Verify EXECUTE permissions on RPC wrappers:
  ```sql
  SELECT routine_name, grantee FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name LIKE 'get_leaderboard%'
  ORDER BY routine_name, grantee;
  ```
  **Expected:** Paginated functions granted to `anon` and `authenticated`. Per-user functions granted to `authenticated` only. `PUBLIC` should not appear.
- [ ] **A6** — Confirm `bot_coordinator_locks` has the deny-all policy:
  ```sql
  SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'bot_coordinator_locks';
  ```
  **Expected:** one row — `no_direct_client_access` with `qual = false`.

---

### B. Leaderboard Screen

- [ ] **B1** — Open the app, navigate to **Leaderboard**. Confirm the ranked leaderboard loads and shows players in rank order. No blank screen or error.
- [ ] **B2** — Switch between **Ranked**, **Casual**, and **Global** tabs (if present). Each tab should load its respective data without error.
- [ ] **B3** — Scroll down on a populated leaderboard. Pagination should work (data loads in batches ≤ 100).
- [ ] **B4** — Open Leaderboard while **not signed in** (use anon session or sign out). The list should still load (anon access is granted to paginated functions). Per-user rank lookup should not be attempted.
- [ ] **B5** — Confirm your own rank appears highlighted or is shown separately when signed in.
- [ ] **B6** — (SQL test) Call the RPC with an extreme limit to confirm clamping:
  ```sql
  SELECT count(*) FROM get_leaderboard_ranked(99999, -5);
  ```
  **Expected:** row count ≤ 100; no error; offset effectively treated as 0.
- [ ] **B7** — (SQL test) Call with NULL limit:
  ```sql
  SELECT count(*) FROM get_leaderboard_ranked(NULL, NULL);
  ```
  **Expected:** returns up to 20 rows (default) without error.

---

### C. Stats Screen

- [ ] **C1** — Open **Stats** for your account. Confirm games played, wins, losses, win rate, avg finish position all display correctly.
- [ ] **C2** — Scroll to the **Rank Points History** section. Confirm historical entries render correctly (timestamps, points, win/loss badge).
- [ ] **C3** — Play one complete game, then re-open Stats. Confirm numbers updated (games_played +1, correct win/loss recorded).
- [ ] **C4** — Verify no TypeScript `as any` regressions cause console warnings or incorrect types at runtime (check Metro bundler output / React Native debugger for unexpected type errors).

---

### D. Lobby — Toggle Ready

- [ ] **D1** — Join a room and tap **Ready**. Confirm your ready status flips and other players see the update in real time.
- [ ] **D2** — Tap **Ready** repeatedly in quick succession. Confirm no duplicate DB calls (the `isTogglingReady` guard).
- [ ] **D3** — Sign out mid-session and attempt to navigate back to a lobby route. Confirm the app does **not** fire a `room_players UPDATE` with an empty user ID — it should redirect to auth or show an error gracefully.

---

### E. Lobby — Start with Bots (`handleStartWithBots`)

- [ ] **E1** — As the room host with ≥ 1 human + 3 bots, tap **Start with Bots**. The game should start normally.
- [ ] **E2** — Create a 2-player room (host + 1 human). Tap **Start with Bots** to fill with bots and start. Confirm bots are added for vacant slots only.
- [ ] **E3** — Sign out mid-lobby and attempt start-with-bots. Confirm the app does **not** fire a DB query with empty user ID — it should fail gracefully with an error log.

---

### F. Join Room — Player Index & Capacity

- [ ] **F1** — Fill a 4-player room to capacity. Try to join as a 5th player. Confirm you see a "Room is full" error.
- [ ] **F2** — Create a **2-player** room (if max_players is configurable). Join as player 2. Confirm player index is 1 (not 3 or garbage).
- [ ] **F3** — Fill the 2-player room to capacity. Try to join as a 3rd player. Confirm "Room is full" error triggers correctly.
- [ ] **F4** — Have player 1 leave a 4-player room where player 0 and 2 are seated. Player 3 joins. Confirm they are assigned index 1 (the first available slot).

---

### G. Game Stats Upload (bots & real players)

- [ ] **G1** — Complete a 4-human game. Verify stats are recorded for all four players in Supabase (`player_stats` table or equivalent).
- [ ] **G2** — Complete a 3-human + 1-bot game. Verify stats are recorded for the 3 human players and the bot's entry uses the bot sentinel ID (not null or empty string).
- [ ] **G3** — Confirm no stats upload errors appear in console for normal games (no "non-bot null user_id" log lines).
- [ ] **G4** — If you can simulate a corrupted game state (winner with null user_id and is_bot=false), confirm the upload is **aborted** and an error is logged rather than uploading a broken winner record.

---

### H. Real-Time Game State (`useRealtime`)

- [ ] **H1** — Start a multiplayer game. Play several turns. Confirm game state updates (current turn indicator, card plays, pass counts) sync correctly across all devices/simulators.
- [ ] **H2** — Disconnect one device's network mid-game, then reconnect. Confirm game state resumes correctly after reconnect.
- [ ] **H3** — Check console logs. Confirm you **do not** see `[fetchGameState] game_state row has null room_id, skipping` during normal gameplay (this would indicate a corrupted DB row).

---

### I. Push Notifications

- [ ] **I1** — Have another player invite you to a room. Confirm you receive a push notification.
- [ ] **I2** — If a push notification send fails (e.g., invalid token), check the server/edge function logs. Confirm the error log contains the **response body text** (not `[object Response]`).

---

### J. CI / TypeScript

- [ ] **J1** — Run `cd apps/mobile && npx tsc --noEmit` locally. **Expected:** 0 errors.
- [ ] **J2** — Check the GitHub Actions CI run on PR #171. All TypeScript, lint, and test jobs should be green.

---

## 6. Commit History (this PR)

| Commit | Description |
|--------|-------------|
| Multiple pre-session | Rounds 1–6 Copilot review fixes |
| `1e53489` | Round 6: full `database.types.ts` (1895 lines), fixed 49 TypeScript errors |
| `a901f0b` | Round 7: migration REVOKE scope, comment wording, duplicate REVOKE cleanup, doc clarification, null `max_players` fix, null `user_id` invariant in stats uploader |
| `42bb171` | Round 8: per-field `GameState` mapper (removes unsafe cast), push notification error logging fix, migration REVOKE final state |
| `1919f59` | Round 9: null `room_id` guard in `useRealtime`, `effectiveMaxPlayers` in join loop, tighter `isHistEntry` type guard, auth guard in `handleToggleReady` |
| `9ffaeb6` | Round 10: auth guard in `handleStartWithBots` |

**Round 11 review: zero new comments.** PR is ready to merge.
