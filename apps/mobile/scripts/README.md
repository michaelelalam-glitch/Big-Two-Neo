# apps/mobile/scripts

Utility scripts for maintaining the Big Two mobile app.

---

## Deployment

| Script | Purpose |
|--------|---------|
| `deploy-edge-functions.sh` | Deploy all Supabase edge functions to the configured project. Run after modifying any `supabase/functions/` code. Override the project ref with `SUPABASE_PROJECT_REF` env var (default: `dppybucldqufbqhwnkxu`). |
| `rebuild-native.sh` | Clean and rebuild the native iOS/Android modules (Expo prebuild + pod install). |

## Database / Migrations

These scripts apply specific one-off migration files — they do **not** accept a generic `<file.sql>` argument.

| Script | Purpose |
|--------|---------|
| `apply-migration.sh` | Apply the matchmaking auto-start fix (`supabase/migrations/20251228000001_fix_matchmaking_auto_start.sql`) using `psql`. Requires `DATABASE_URL` env var (Connection URI from Supabase Dashboard → Settings → Database). |
| `apply-migration.mjs` | **Legacy — no longer functional.** Originally applied `supabase/migrations/20251223000001_add_client_game_completion.sql` via a Supabase `exec` RPC. That migration has been squashed into `00000000000000_baseline.sql` (task #640) and no `exec` RPC is defined in the current schema. To apply new migrations use `apply-migration.sh` (psql) or the Supabase CLI (`supabase db push`). |
| `check-schema.mjs` | Verify that the `game_state` table exists, list its columns, and print any RLS policies. Reads `EXPO_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from a local `.env` file. No arguments needed. |

## Diagnostics & Debugging

| Script | Purpose |
|--------|---------|
| `debug-game-state.mjs` | List the 5 most-recent `game_state` rows (hands keys, current turn, game phase) and test anon-key RLS access. Reads `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` from a local `.env` file. No arguments needed. |
| `diagnose-bot-cards.mjs` | Inspect the 3 most-recent `playing` rooms: checks whether a `game_state` row exists and prints hand sizes per player slot. Useful for diagnosing missing or corrupt bot hands. Reads `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` from a local `.env` file. No arguments needed. |
| `test-start-game.mjs` | Create a temporary room, call the `start_game_with_bots` RPC with 3 medium-difficulty bots, verify that `game_state` is created correctly, then delete the room. Reads credentials from a local `.env` file. **Update the hardcoded `email`/`password` in the script before running.** No arguments needed. |

## Maintenance

| Script | Purpose |
|--------|---------|
| `cleanup-stuck-rooms.mjs` | Find rooms in `playing` status that have no corresponding `game_state` row (e.g. after a server crash mid-game) and reset them to `waiting` so they can be rejoined. Reads `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` from a local `.env` file. No arguments needed. |

---

## Credentials

Scripts that require credentials use one of three approaches:

| Approach | Scripts |
|----------|---------|
| Shell environment variables (`EXPO_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) | `apply-migration.mjs` (**legacy**) |
| `DATABASE_URL` shell env var (PostgreSQL connection URI) | `apply-migration.sh` |
| Local `.env` file (same directory as the script) | `check-schema.mjs`, `debug-game-state.mjs`, `test-start-game.mjs`, `cleanup-stuck-rooms.mjs`, `diagnose-bot-cards.mjs` |

For scripts that read from `.env`, create `apps/mobile/scripts/.env`:
```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Copy values from Supabase Dashboard → Settings → API.
