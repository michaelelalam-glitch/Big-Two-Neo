# apps/mobile/scripts

Utility scripts for maintaining the Big Two mobile app.

---

## Deployment

| Script | Purpose |
|--------|---------|
| `deploy-edge-functions.sh` | Deploy all Supabase edge functions to the configured project. Run after modifying any `supabase/functions/` code. |
| `rebuild-native.sh` | Clean and rebuild the native iOS/Android modules (Expo prebuild + pod install). |

## Database / Migrations

| Script | Purpose |
|--------|---------|
| `apply-migration.sh` | Apply a single SQL migration file to the local or remote Supabase database. Usage: `./scripts/apply-migration.sh <file.sql>` |
| `apply-migration.mjs` | Node.js version of the migration runner. Reads `EXPO_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env. Usage: `node scripts/apply-migration.mjs <file.sql>` |
| `check-schema.mjs` | Print a summary of the live database schema (tables, columns, row estimates). Useful for verifying migration results. |

## Diagnostics & Debugging

| Script | Purpose |
|--------|---------|
| `debug-game-state.mjs` | Fetch and pretty-print the full game state for a given `room_id`. Usage: `node scripts/debug-game-state.mjs <room_id>` |
| `diagnose-bot-cards.mjs` | Identify rooms where bot players have an incorrect or missing hand. Prints affected `room_id` values and player slots. |
| `test-start-game.mjs` | Manually trigger the `start-game` edge function for a waiting room. Useful for smoke-testing matchmaking without a second client. Usage: `node scripts/test-start-game.mjs <room_id>` |

## Maintenance

| Script | Purpose |
|--------|---------|
| `cleanup-stuck-rooms.mjs` | Find and delete rooms that have been in `waiting` status for more than 30 minutes (e.g. after a server crash). Prints affected rooms before deleting — review carefully. |

---

## Environment variables required by .mjs scripts

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Copy these from your Supabase project → Settings → API.
