# Database Table Usage Guide

**Date:** December 5, 2025  
**Status:** ✅ Schema Synchronized

---

## Overview

The Big Two mobile app uses **two separate player tables** for different purposes. This guide clarifies which table to use and when.

---

## Table Comparison

| Feature | `room_players` | `players` |
|---------|---------------|-----------|
| **Purpose** | Lobby/matchmaking management | Active game state |
| **Used By** | Mobile app (React Native) | Edge Functions (game logic) |
| **Contains** | Lobby state (is_ready, is_host) | Game state (cards, score, tricks_won) |
| **Lifecycle** | Created when joining room | Created when game starts |
| **Managed By** | Client app via Supabase client | Server-side Edge Functions |
| **Real-time Subscriptions** | Yes (mobile app) | Yes (Edge Functions) |

---

## Detailed Table Descriptions

### `room_players` Table
**Use this table for all mobile app queries!**

**Purpose:** Manage players in room lobby before game starts

**Columns:**
- `id` (uuid): Primary key
- `room_id` (uuid): Foreign key to rooms table
- `user_id` (uuid): Foreign key to auth.users
- `player_index` (int): Position in room (0-3)
- `is_host` (boolean): Room creator flag
- `is_ready` (boolean): Ready to start game
- `is_bot` (boolean): AI player flag
- `joined_at` (timestamptz): Join timestamp

**When to Use:**
- ✅ Lobby screens
- ✅ Room joining/creation
- ✅ Player ready status
- ✅ Host detection
- ✅ Player list display

**Example Query:**
```typescript
const { data: players } = await supabase
  .from('room_players')
  .select('*')
  .eq('room_id', roomId)
  .order('player_index');
```

---

### `players` Table
**DO NOT query this table from mobile app!**

**Purpose:** Manage active game state (cards, scores, etc.)

**Columns:**
- `id` (uuid): Primary key
- `room_id` (uuid): Foreign key to rooms table
- `user_id` (uuid): Foreign key to profiles
- `player_index` (int): Position at table (0-3)
- `cards` (jsonb): Current hand (array of card objects)
- `score` (int): Game score
- `tricks_won` (int): Tricks won this game
- `auto_pass` (boolean): Auto-pass setting (bots)
- `status` (text): online/offline/disconnected
- `is_bot` (boolean): AI player flag
- ... (many more game-specific columns)

**When to Use:**
- ❌ NEVER from mobile app
- ✅ Only from Edge Functions
- ✅ Server-side game logic
- ✅ Card dealing/playing
- ✅ Score calculations

---

## Migration History

### 20251205000001_mobile_lobby_schema.sql
Created `room_players` table with lobby-specific columns

### 20251205000002_add_table_clarifying_comments.sql
Added schema comments to clarify table purposes:
- `players`: "DO NOT use this table in mobile app - use room_players instead"
- `room_players`: "This is the correct table for mobile app queries"

---

## Code References

### Correct Usage ✅

**useRealtime.ts:**
```typescript
// Fetch lobby players
const { data, error } = await supabase
  .from('room_players')  // ✅ Correct!
  .select('*')
  .eq('room_id', roomId);
```

**LobbyScreen.tsx:**
```typescript
// Subscribe to lobby changes
supabase
  .channel(`lobby:${roomCode}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'room_players',  // ✅ Correct!
    filter: `room_id=eq.${roomId}`,
  })
```

### Incorrect Usage ❌

```typescript
// DO NOT DO THIS IN MOBILE APP!
const { data } = await supabase
  .from('players')  // ❌ Wrong table!
  .select('*');
```

---

## RLS Policies

### `room_players` Policies
```sql
-- Anyone can view players in their room
CREATE POLICY "Players can view room_players in their room" 
  ON room_players FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM room_players rp
      WHERE rp.room_id = room_players.room_id
      AND rp.user_id = auth.uid()
    )
  );
```

### `players` Policies
- Managed by Edge Functions with service role key
- Not accessible via client-side queries

---

## Testing & Verification

### Verify Correct Table Usage
```bash
# Search for incorrect 'players' table references
cd apps/mobile
grep -r "\.from('players')" src/

# Should return NO results! ✅
```

### Check TypeScript Compilation
```bash
cd apps/mobile
npm run type-check
# Should pass with no errors ✅
```

### Verify Schema Comments
```sql
-- Run in Supabase SQL Editor
SELECT 
    tablename,
    obj_description((schemaname||'.'||tablename)::regclass, 'pg_class') as table_comment
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename IN ('players', 'room_players');
```

---

## Common Pitfalls

### ❌ Mistake 1: Using `players` table in mobile app
**Problem:** Mobile app directly queries `players` table  
**Solution:** Always use `room_players` for lobby management

### ❌ Mistake 2: Mixing table references
**Problem:** Using `room_players` in some places, `players` in others  
**Solution:** Consistent use of `room_players` throughout mobile app

### ❌ Mistake 3: Assuming tables are the same
**Problem:** Treating `players` and `room_players` as interchangeable  
**Solution:** Understand they serve different purposes in different contexts

---

## Key Takeaways

1. **Mobile App:** ONLY use `room_players` table
2. **Edge Functions:** ONLY use `players` table
3. **Both tables have similar columns but different purposes**
4. **Never query `players` from client-side code**
5. **Schema comments provide guidance at database level**

---

## Related Documentation

- `/docs/TASK_260_IMPLEMENTATION_SUMMARY.md` - Authentication implementation
- `/big2-multiplayer/supabase/migrations/20251205000001_mobile_lobby_schema.sql` - Schema definition
- `/apps/mobile/src/hooks/useRealtime.ts` - Realtime hook implementation
- `/apps/mobile/src/types/multiplayer.ts` - TypeScript type definitions

---

**Last Updated:** December 5, 2025  
**Verified:** All mobile app queries use `room_players` ✅  
**Schema Comments:** Added ✅  
**TypeScript Compilation:** Passing ✅
