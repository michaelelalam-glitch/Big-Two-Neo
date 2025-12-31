# Edge Function Architecture - Visual Overview

## Complete System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT SIDE (React Native)                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  useConnectionManager.ts          useMatchmaking.ts                  │
│  ├─ update-heartbeat              ├─ find-match                      │
│  ├─ mark-disconnected             └─ cancel-matchmaking              │
│  └─ reconnect-player                                                 │
│                                                                       │
│  useRealtime.ts                   SettingsScreen.tsx                 │
│  ├─ play-cards                    └─ delete-account                  │
│  ├─ player-pass                                                      │
│  ├─ start_new_match               MultiplayerGameScreen.tsx          │
│  ├─ complete-game                 └─ (uses all above hooks)          │
│  └─ server-time                                                      │
│                                                                       │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ HTTPS Requests
                             │ (JWT Authentication)
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                    SUPABASE EDGE FUNCTIONS                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Connection Management                                               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ update-heartbeat    → Update last_seen_at timestamp          │   │
│  │ mark-disconnected   → Mark player as disconnected            │   │
│  │ reconnect-player    → Restore player from bot                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Matchmaking                                                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ find-match          → Find/create matches (4 players)        │   │
│  │ cancel-matchmaking  → Cancel matchmaking request             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Game Actions                                                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ play-cards          → Validate & execute card plays          │   │
│  │ player-pass         → Execute player pass                    │   │
│  │ start_new_match     → Start new match (shuffle, deal)        │   │
│  │ complete-game       → Complete game & update stats           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Utilities                                                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ server-time         → Get server timestamp                   │   │
│  │ delete-account      → Delete user account & data             │   │
│  │ send-push-notification → Send push notifications             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ PostgreSQL Queries
                             │ (Service Role Key)
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                    SUPABASE POSTGRES DATABASE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Core Tables                                                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ rooms              → Game rooms                              │   │
│  │ room_players       → Players in rooms                        │   │
│  │ game_state         → Current game state                      │   │
│  │ waiting_room       → Matchmaking queue                       │   │
│  │ user_profiles      → User profile data                       │   │
│  │ user_stats         → User statistics                         │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  RPC Functions (Supporting)                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ generate_room_code_v2           → Generate unique codes      │   │
│  │ start_game_with_bots            → Initialize game state      │   │
│  │ cleanup_stale_waiting_room_entries → Clean waiting room      │   │
│  │ card_string_to_object           → Helper function            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  RPC Functions (Test Only)                                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ execute_pass_move               → Test helper                │   │
│  │ execute_play_move               → Test helper                │   │
│  │ test_cleanup_user_data          → Test helper                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Request Flow Examples

### 1. Connection Heartbeat Flow
```
Client (useConnectionManager)
  │
  ├─► supabase.functions.invoke('update-heartbeat', { room_id, player_id })
  │
  └─► Edge Function: update-heartbeat
       │
       ├─► Validate JWT
       ├─► Verify player exists
       ├─► UPDATE room_players SET last_seen_at = NOW()
       │
       └─► Return { success: true }
```

### 2. Matchmaking Flow
```
Client (useMatchmaking)
  │
  ├─► supabase.functions.invoke('find-match', { username, skill_rating, region, match_type })
  │
  └─► Edge Function: find-match
       │
       ├─► Validate JWT
       ├─► INSERT INTO waiting_room
       ├─► SELECT waiting players (skill-based, same region)
       │
       ├─► IF 4+ players found:
       │    ├─► Call generate_room_code_v2()
       │    ├─► INSERT INTO rooms
       │    ├─► INSERT INTO room_players (x4)
       │    ├─► Call start_game_with_bots(0 bots)
       │    └─► Return { matched: true, room_id, room_code }
       │
       └─► ELSE:
            └─► Return { matched: false, waiting_count }
```

### 3. Card Play Flow
```
Client (useRealtime)
  │
  ├─► supabase.functions.invoke('play-cards', { room_code, player_id, cards })
  │
  └─► Edge Function: play-cards
       │
       ├─► Validate JWT
       ├─► Validate cards (combo detection)
       ├─► Validate play beats last_play
       ├─► UPDATE game_state (remove cards, advance turn)
       │
       ├─► IF player won (0 cards left):
       │    └─► UPDATE game_state SET game_phase = 'finished'
       │
       └─► Return { success: true, next_turn, cards_remaining }
```

## Migration Status

### ✅ Migrated to Edge Functions
- Connection Management (3 functions)
- Matchmaking (2 functions)
- Game Actions (4 functions)
- Utilities (3 functions)

### 📝 Kept as RPC (By Design)
- Supporting functions (called by Edge Functions)
- Test helpers (for integration tests)

### 🎯 Result
**100% of production client code now uses Edge Functions!**

## Benefits Achieved

1. **Type Safety** - Full TypeScript support
2. **Testability** - Easy to test with Deno
3. **Flexibility** - Can use any Deno/npm packages
4. **Observability** - Better logging and monitoring
5. **Security** - JWT validation on client-facing requests; service-role functions protected by UUID obscurity and channel-based access control (see SECURITY_CONSIDERATIONS_DEC_31_2025.md for full details)
6. **Performance** - Optimized for realtime operations
7. **Maintainability** - All logic in one place

> **Note:** Some Edge Functions (e.g., heartbeat, disconnect/reconnect, game engine helpers) use service-role keys for privileged operations and accept client-supplied identifiers. While this provides flexibility for MVP development, full JWT validation will be added before public release. See SECURITY_CONSIDERATIONS_DEC_31_2025.md for security tradeoffs and roadmap.

## Deployment Status

| Function | Created | Tested | Deployed |
|----------|---------|--------|----------|
| update-heartbeat | ✅ | ⏳ | ⏳ |
| mark-disconnected | ✅ | ⏳ | ⏳ |
| reconnect-player | ✅ | ⏳ | ⏳ |
| find-match | ✅ | ⏳ | ⏳ |
| cancel-matchmaking | ✅ | ⏳ | ⏳ |
| server-time | ✅ | ⏳ | ⏳ |
| delete-account | ✅ | ⏳ | ⏳ |

**Next Step:** Run `./deploy-edge-functions.sh` to deploy all functions!
