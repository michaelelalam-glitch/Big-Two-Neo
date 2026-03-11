# ELO & Points System — Implementation Plan

**Branch:** `task/621-leaderboard-fixes`  
**Date:** March 10, 2026 (updated: private games removed from ELO)

---

## Overview of Changes

| # | Area | Change |
|---|------|--------|
| 1 | Casual ELO | Score-based formula — **casual games only** |
| 2 | Ranked ELO | Chess ELO (K=32, pairwise) — **ranked games only** |
| 3 | Private games | **No rank-point change** — only `private_total_points` is tracked |
| 4 | No ELO floor | Remove floor — players can go below 0 |
| 5 | Total Points | Keep existing card-penalty calc; add Total Points card to Ranked UI tab |
| 6 | global_rank | Source from `leaderboard_ranked`, not `leaderboard_casual` |

---

## 1. Casual ELO Formula

### Design

ELO change is directly tied to the game-end threshold (100 pts). Each player's delta is:

```
elo_change = ROUND( (100 - game_score) × bot_multiplier )
```

Where `game_score` = that player's cumulative card-penalty score at game end (the value already tracked in `game_history.player_N_score`).

**Result:** winner (0 pts) gains the most; a player with 120 pts accumulated loses ELO. Naturally scales to how decisively you beat opponents.

### Bot multiplier

| Lobby composition | Multiplier |
|---|---|
| All human players | **1.0** |
| Any bot at difficulty `hard` | **0.9** |
| Any bot at difficulty `medium` | **0.7** |
| Any bot at difficulty `easy` | **0.5** |

The multiplier is determined by the **hardest** bot in the game (or 1.0 if no bots). Passed by the edge function as `p_bot_multiplier DECIMAL`.

### Worked example (from spec)

| Player | Score | Delta (×1.0) |
|---|---|---|
| A (1st) | 20 | **+80** |
| B (2nd) | 30 | **+70** |
| C (3rd) | 70 | **+30** |
| D (4th) | 120 | **−20** |

> Note: with constant 100, Player D's delta is exactly −20 (100 − 120 = −20). The fractional rounding is consistent at all multipliers.

### Applied to

- `casual` games only → `casual_rank_points`
- `rank_points` (legacy global column) stays in sync with `casual_rank_points` as today
- **Private games are excluded** — they do not affect `casual_rank_points`

---

## 2. Ranked ELO Formula (Chess K=32, Pairwise)

As specified in the in-game Rules screen ("ELO changes are calculated using the chess rating formula with K-factor=32. Winning against higher-rated opponents gives more points.").

### Formula

For a 4-player game, every unique pair of players *(i, j)* is treated as a head-to-head. The player who finished in a **lower position number** (i.e., finished first vs second) is the "winner" of that pair.

```
For each pair (i, j) where finish_position_i < finish_position_j:

  E_i = 1 / ( 1 + 10^( (R_j − R_i) / 400 ) )   -- expected score for i vs j
  E_j = 1 − E_i                                   -- expected score for j vs i

  Delta_i += K × (1 − E_i)    -- i "won" this matchup
  Delta_j += K × (0 − E_j)    -- j "lost" this matchup
```

With `K = 32`. Each player has **3 pairwise matchups** in a 4-player game, so total delta is the sum of all 3.

### Computation location

Because the chess formula requires **all 4 players' current `ranked_rank_points` simultaneously**, the calculation must happen in the **`complete-game` edge function**, not inside `update_player_stats_after_game` (which processes one player at a time).

**Implementation steps in the edge function:**
1. After player data is validated, fetch `ranked_rank_points` for all real players via a single `select` query.
2. Compute all 6 pairwise ELO deltas for the 4 players.
3. Pass each player's pre-computed `p_ranked_elo_change INTEGER` to `update_player_stats_after_game`.
4. The SQL function adds this value directly to `ranked_rank_points` (no re-calculation in SQL).

### Applied to

- `ranked` games only → `ranked_rank_points`
- **Private games are excluded** — they do not affect `ranked_rank_points`

---

## 3. Private Games — Total Points Only

Private games track the same card-penalty score (`private_total_points`) but **do not change any rank points**.

| Column | Private game effect |
|--------|---------------------|
| `casual_rank_points` | ❌ No change |
| `ranked_rank_points` | ❌ No change |
| `rank_points` (legacy) | ❌ No change |
| `private_total_points` | ✅ Incremented as normal |
| `rank_points_history` | ❌ No entry added (no ELO change to graph) |

This means private lobbies are a consequence-free practice environment: stats (win rate, combos, scores) are tracked, but your public leaderboard ratings are unaffected.

---

## 4. No ELO Floor

Remove the implicit 1000-default guard. Both `casual_rank_points` and `ranked_rank_points` can drop below 0 (and below 1000). This is intentional — a player on a losing streak should see their rating reflect their performance.

**Migration change:** Remove any `GREATEST(0, ...)` or `GREATEST(1000, ...)` guards in the SQL function. `COALESCE(col, 1000)` for the initial-value case (new player) is kept — it only applies when the column is literally NULL (first game ever).

---

## 5. Total Points

### No change to the calculation

Total Points = cumulative sum of a player's card-penalty score across all **completed, non-voided** games. This is tracked per mode:
- `casual_total_points`
- `ranked_total_points`
- `private_total_points`
- `total_points` (global sum — used by Overview tab)

Lower is better (it's a penalty accumulator). This stays exactly the same.

### UI change — add Total Points to the Ranked tab

Currently the Ranked stats grid shows:
```
[ Rank Points (ELO) ]  [ Global Rank ]
```

Change it to show:
```
[ Rank Points (ELO) ]  [ Global Rank ]
[ Total Points      ]
```

`ranked_total_points` is already populated in DB — just needs to be rendered.

### UI change — Overview total_points

Overview `Total Points` should display the **sum** of all three mode totals:
```tsx
const overviewTotalPoints = (stats.casual_total_points || 0)
  + (stats.ranked_total_points || 0)
  + (stats.private_total_points || 0);
```

This replaces the current `stats.total_points` (global column) in the Overview performance section, so both sources stay consistent.

---

## 6. global_rank → Ranked Leaderboard

`global_rank` currently reads from `leaderboard_casual` (which only includes players with `casual_games_played > 0`). Change it to read from `leaderboard_ranked`.

### leaderboard_ranked view — no expansion needed

Since private games do **not** affect `ranked_rank_points`, the `leaderboard_ranked` view WHERE clause stays as `ranked_games_played > 0`. Only players who have played actual ranked games appear on the ranked leaderboard.

```sql
-- WHERE clause stays unchanged
WHERE ps.ranked_games_played > 0
ORDER BY ps.ranked_rank_points DESC, ps.ranked_games_won DESC;
```

### How global_rank gets populated

`global_rank` in `player_stats` is a **stored column** — it is currently not auto-updated unless `refresh_leaderboard()` is called after each game. After the refresh, a separate step syncs `global_rank` back to `player_stats` from the materialized view.

**Check:** Does the current code do this sync? If `global_rank` is only the column in `player_stats` and the leaderboard view is a separate query, the `#N/A` in the UI may simply mean the old `leaderboard_global` materialized view (from `20251208000001`) has gone stale. Need to verify this during implementation.

**Recommended approach:** Fetch `global_rank` at read time by querying `leaderboard_ranked` directly in `fetchData()` rather than relying on the stored column:

```ts
const { data: rankRow } = await supabase
  .from('leaderboard_ranked')
  .select('rank')
  .eq('user_id', userId)
  .maybeSingle();

const globalRank = rankRow?.rank ?? null;
```

Then merge this into the stats object before setting state.

---

## Implementation Steps

### Step 1 — Migration: `20260309000004_leaderboard_fixes.sql` ✅ DONE

1. ✅ Added `p_bot_multiplier DECIMAL` and `p_ranked_elo_change INTEGER` parameters.
2. ✅ `v_rank_point_change`: `ROUND((100 - p_score) * p_bot_multiplier)` — casual only.
3. ✅ `v_new_casual_rp`: applies delta for `p_game_type = 'casual'` only.
4. ✅ `v_new_ranked_rp`: applies `p_ranked_elo_change` for `p_game_type = 'ranked'` only.
5. ✅ Private game UPDATE block: no `casual_rank_points` / `ranked_rank_points` changes.
6. ✅ `rank_points_history`: entry only written if `NOT p_voided AND p_game_type <> 'private'`.
7. ✅ ELO floor guards removed.
8. ✅ Permissions block present.

### Step 2 — Edge function: `complete-game/index.ts` ✅ DONE

1. ✅ `botMultiplier` computed server-authoritatively from `room_players`.
2. ✅ Chess K=32 pairwise ELO computed for **`ranked` games only** (private excluded).
3. ✅ `p_bot_multiplier` and `p_ranked_elo_change` passed per player.
4. ✅ Private games pass `p_ranked_elo_change = 0` (map is empty → `?? 0` fallback).

### Step 3 — StatsScreen.tsx ⚠️ PARTIALLY DONE

1. ❌ **TODO:** Add a `Total Points` stat card to the Ranked tab stats grid (currently only shows Rank Points + Global Rank).
2. ❌ **TODO:** Change the Overview `Total Points` value from `stats.total_points` (legacy global) to:
   ```tsx
   const overviewTotalPoints = (stats.casual_total_points || 0)
     + (stats.ranked_total_points || 0)
     + (stats.private_total_points || 0);
   ```
3. ❌ **TODO:** Fetch `global_rank` from `leaderboard_ranked` directly in `fetchData()` instead of relying on the stored `global_rank` column:
   ```ts
   const { data: rankRow } = await supabase
     .from('leaderboard_ranked')
     .select('rank')
     .eq('user_id', userId)
     .maybeSingle();
   const globalRank = rankRow?.rank ?? null;
   ```
   Then merge into the stats object before `setStats(...)`.

### Step 4 — redeploy edge function + apply migration ⚠️ TODO

```bash
# Apply migration to prod
supabase db push  # or apply SQL manually to prod

# Redeploy edge function
supabase functions deploy complete-game
```

### Step 5 — Test & verify

- [ ] New player starts at 1000/1000 ELO (casual/ranked)
- [ ] Casual game: all-human lobby — winner with 0pts gets +100, 120pt player gets −20
- [ ] Casual game: easy bots — winner gets +50 (100 × 0.5)
- [ ] Ranked game: chess formula fires; higher-rated opponent beaten = larger delta
- [ ] **Private game: `casual_rank_points` and `ranked_rank_points` are UNCHANGED; only `private_total_points` increments**
- [ ] Private game: no entry added to `rank_points_history` graph
- [ ] A player who goes negative ELO is displayed correctly (no clamp)
- [ ] `global_rank` shows correct rank from `leaderboard_ranked`
- [ ] Players only in casual/private show `#N/A` for `global_rank` (not on ranked leaderboard)
- [ ] Ranked tab shows Total Points card (`ranked_total_points`)
- [ ] Overview Total Points = sum of all three mode totals (not legacy `total_points` column)

---

## Files Touched

| File | Change type |
|------|-------------|
| `apps/mobile/supabase/migrations/20260309000XXX_elo_overhaul.sql` | **New migration** |
| `apps/mobile/supabase/functions/complete-game/index.ts` | Chess ELO computation + pass new params |
| `apps/mobile/src/screens/StatsScreen.tsx` | Add Total Points to Ranked tab; fix global_rank fetch; fix Overview total_points |
