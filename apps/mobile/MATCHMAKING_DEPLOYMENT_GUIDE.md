# Matchmaking System Deployment Guide

## 🚀 Apply Matchmaking Migration to Production

The matchmaking system requires a new database table and functions. Due to migration history conflicts, we'll apply this directly via Supabase SQL Editor.

### Steps:

1. **Go to Supabase Dashboard**: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu
2. **Click SQL Editor** (left sidebar)
3. **Click "New Query"**
4. **Copy the entire contents** of `apps/mobile/supabase/migrations/20251222000001_add_matchmaking_system.sql`
5. **Paste into the SQL Editor**
6. **Click "Run"** (or press Cmd+Enter)
7. **Verify success** - You should see "Success. No rows returned"

### What This Creates:

- ✅ `waiting_room` table for matchmaking queue
- ✅ `find_match()` function - Skill-based matchmaking (±200 ELO)
- ✅ `cancel_matchmaking()` function - Leave queue
- ✅ `cleanup_stale_waiting_room_entries()` - Auto-cleanup (5 min timeout)
- ✅ RLS policies for security
- ✅ Indexes for fast queries

### Verification:

After running, verify in SQL Editor:

```sql
-- Check table exists
SELECT COUNT(*) FROM waiting_room;

-- Check function exists
SELECT proname FROM pg_proc WHERE proname = 'find_match';
```

### Alternative: Use Supabase CLI (if migration sync is fixed)

```bash
cd apps/mobile
npx supabase migration repair --status applied 20251222000001
npx supabase db push
```

---

## 📱 Testing Locally

Once deployed, test the matchmaking flow:

1. **Start the app**: `cd apps/mobile && npm start`
2. **Tap "Find Match (NEW!)"** on home screen
3. **Open 4 devices/tabs** to simulate multiplayer
4. **Watch the player count** increase in real-time
5. **Auto-join lobby** when 4 players matched

---

## 🎮 What's New?

**Before**: Quick Play joined random public rooms (race conditions, no skill matching)

**After**: 
- Skill-based matchmaking (±200 ELO)
- Region-based filtering
- Real-time player count updates
- Auto-room creation when 4 players ready
- 5-minute timeout for stale entries

---

**Ready to deploy!** 🚀
