# ELO & Points System — Implementation Plan

**Branch:** `task/621-leaderboard-fixes`  
**Date:** March 9, 2026

---

## Overview of Changes

| # | Area | Change |
|---|------|--------|
| 1 | Casual ELO | Replace flat +25/+10/–5/–15 with score-based formula |
| 2 | Ranked ELO | Replace flat formula with chess ELO (K=32, pairwise) |
| 3 | No ELO floor | Remove floor — players can go below 0 |
| 4 | Total Points | Keep existing card-penalty calc; add Total Points card to Ranked UI tab |
| 5 | global_rank | Source from `leaderboard_ranked`, not `leaderboard_casual` |

---

## 1. Casual ELO Formula

### Design

ELO change is directly tied to the game-end threshold (100 pts). Each player's delta is:

```
elo_change = ROUND( (101 - game_score) × bot_multiplier )
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

> Note: the spec estimates −20 for Player D; the formula gives exactly −21 (101 − 120 = −21). The fractional rounding is consistent at all multipliers.

### Applied to

- `casual` games → `casual_rank_points`
- `private` games → `casual_rank_points` (and `ranked_rank_points`, see §3)
- `rank_points` (legacy global column) stays in sync with `casual_rank_points` as today

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

- `ranked` games → `ranked_rank_points`
- `private` games → `ranked_rank_points` (using the same pairwise chess formula, see §3)

---

## 3. No ELO Floor

Remove the implicit 1000-default guard. Both `casual_rank_points` and `ranked_rank_points` can drop below 0 (and below 1000). This is intentional — a player on a losing streak should see their rating reflect their performance.

**Migration change:** Remove any `GREATEST(0, ...)` or `GREATEST(1000, ...)` guards in the SQL function. `COALESCE(col, 1000)` for the initial-value case (new player) is kept — it only applies when the column is literally NULL (first game ever).

---

## 4. Total Points

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

## 5. global_rank → Ranked Leaderboard

`global_rank` currently reads from `leaderboard_casual` (which only includes players with `casual_games_played > 0`). Change it to read from `leaderboard_ranked`.

### leaderboard_ranked view expansion

Since private games will now affect `ranked_rank_points`, the ranked leaderboard view should include those players:

```sql
-- New WHERE clause (replaces "ranked_games_played > 0")
WHERE (ps.ranked_games_played + ps.private_games_played) > 0
ORDER BY ps.ranked_rank_points DESC, (ps.ranked_games_won + ps.private_games_won) DESC;
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

### Step 1 — New migration: `20260309000XXX_elo_overhaul.sql`

1. Add `p_bot_multiplier DECIMAL` and `p_ranked_elo_change INTEGER` parameters to `update_player_stats_after_game`.
2. Replace `v_rank_point_change` calculation with:
   - Casual: `ROUND((100 - p_score) * p_bot_multiplier)`
   - Ranked: use incoming `p_ranked_elo_change` directly
   - Private (casual column): `ROUND((100 - p_score) * p_bot_multiplier)`
   - Private (ranked column): use incoming `p_ranked_elo_change` directly
3. Apply casual delta to `casual_rank_points` for `casual` AND `private` games.
4. Apply ranked delta to `ranked_rank_points` for `ranked` AND `private` games.
5. Sync `rank_points = v_new_casual_rp` (unchanged).
6. Remove any ELO floor guards.
7. Update `leaderboard_ranked` materialized view WHERE clause to include private game players.
8. Grant + permissions block.

### Step 2 — Edge function: `complete-game/index.ts`

1. Compute `bot_multiplier` from `gameData.bot_difficulty`:
   ```ts
   const botMultiplier = gameData.bot_difficulty === 'easy' ? 0.5
     : gameData.bot_difficulty === 'medium' ? 0.7
     : gameData.bot_difficulty === 'hard'   ? 0.9
     : 1.0; // null = all humans
   ```
2. For `ranked` and `private` games only: before calling `update_player_stats_after_game`, fetch all real players' `ranked_rank_points` in a single query, compute pairwise chess ELO (K=32) deltas, map them to each player's `user_id`.
3. Pass `p_bot_multiplier` and `p_ranked_elo_change` (for ranked/private) for each player.
4. For casual games, `p_ranked_elo_change` = `0` (or unused — gate in SQL with `IF p_game_type IN ('ranked', 'private')`).

### Step 3 — StatsScreen.tsx

1. Add a `Total Points` stat card to the Ranked tab stats grid.
2. Change the Overview `Total Points` value to `casual_total_points + ranked_total_points + private_total_points`.
3. Fetch `global_rank` from `leaderboard_ranked` directly in `fetchData()` instead of relying on the stored `global_rank` column in `player_stats`.
4. Merge the fetched rank into the stats object before `setStats(...)`.

### Step 4 — redeploy edge function + apply migration

```bash
# Apply migration
supabase db push  # or apply SQL manually to prod

# Redeploy edge function
supabase functions deploy complete-game
```

### Step 5 — Test & verify

- [ ] New player starts at 1000/1000 ELO (casual/ranked)
- [ ] Casual game: all-human lobby — winner with 0pts gets +100, 120pt player gets −20
- [ ] Casual game: easy bots — winner gets +50 (100 × 0.5)
- [ ] Ranked game: chess formula fires; higher-rated opponent beaten = larger delta
- [ ] Private game: both `casual_rank_points` AND `ranked_rank_points` change
- [ ] A player who goes negative ELO is displayed correctly (no clamp)
- [ ] `global_rank` shows correct rank from `leaderboard_ranked`
- [ ] Players only in casual show `#N/A` for `global_rank` (they are not on the ranked leaderboard)
- [ ] Ranked tab shows Total Points card (`ranked_total_points`)
- [ ] Overview Total Points = sum of all three mode totals

---

## Files Touched

| File | Change type |
|------|-------------|
| `apps/mobile/supabase/migrations/20260309000XXX_elo_overhaul.sql` | **New migration** |
| `apps/mobile/supabase/functions/complete-game/index.ts` | Chess ELO computation + pass new params |
| `apps/mobile/src/screens/StatsScreen.tsx` | Add Total Points to Ranked tab; fix global_rank fetch; fix Overview total_points |
