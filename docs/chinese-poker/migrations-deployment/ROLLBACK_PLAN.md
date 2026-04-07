# EMERGENCY ROLLBACK PLAN

## Current Status: EVERYTHING BROKEN

### User Reports:
1. ❌ 1 human + 3 bots: NOT WORKING
2. ❌ 2 humans: CAN'T SEE EACH OTHER
3. ❌ Both click casual: DOESN'T WORK
4. ❌ Everything worse than before

### My Fuck-Ups:
1. Changed `join_room_atomic` - added position-finding logic
2. Changed `get_or_create_room` - rewrote transaction handling
3. Changed `start_game_with_bots` - added game_state creation
4. Changed `HomeScreen.tsx` - added delays and verification
5. Changed `CreateRoomScreen.tsx` - replaced INSERT with RPC
6. Changed `LobbyScreen.tsx` - changed solo game routing
7. Changed `LandscapeGameLayout.tsx` - removed hardcoded bot names

### ROLLBACK STRATEGY:

#### Option A: Git Revert (SAFEST)
```bash
cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile
git status
git diff
git stash
# Test if original code works
```

#### Option B: Selective Rollback (TARGETED)
Revert ONLY the changes that broke things:
1. Revert HomeScreen.tsx cleanup changes
2. Revert CreateRoomScreen.tsx RPC changes
3. Keep database fixes (they might be needed)

#### Option C: Database Restore (NUCLEAR)
Restore database to previous state from Supabase dashboard backups

### WHAT I NEED FROM USER:
1. **What ORIGINALLY WORKED before I started?**
2. **What was the FIRST problem you reported?**
3. **Are you testing with 1 device or 2 devices?**
4. **Can you send me the ORIGINAL console log from BEFORE my fixes?**

### NEXT STEPS:
1. STOP making changes
2. GET clarification from user
3. ROLLBACK to working state
4. TEST original code
5. Fix ONE problem at a time WITH TESTING
