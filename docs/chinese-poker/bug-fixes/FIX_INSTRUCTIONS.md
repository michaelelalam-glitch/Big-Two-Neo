# 🔧 Fix for "column room_players.username does not exist" Error

## Issue Summary
You're seeing the error **"column room_players.username does not exist"** because the database migrations haven't been applied to your Supabase project yet.

Additionally, room codes were generating as 4 characters instead of the required 6 characters.

---

## ✅ Fixes Applied (Commit: 835bc7e)

### 1. Room Code Length Fixed
- **HomeScreen.tsx**: Changed from 4 to 6 characters
- **CreateRoomScreen.tsx**: Changed from 4 to 6 characters  
- **JoinRoomScreen.tsx**: Updated validation to require 6 characters
- **Character set**: Now excludes confusing characters (O, I, 0, 1)

### 2. Migration Script Created
Created `apps/mobile/APPLY_MIGRATIONS.sql` with all required database changes.

---

## 📋 ACTION REQUIRED: Apply Database Migrations

You need to apply the SQL migrations to your Supabase database. Follow these steps:

### Step 1: Open Supabase SQL Editor
1. Go to: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql
2. Log in to your Supabase account

### Step 2: Copy the Migration SQL
Open the file `apps/mobile/APPLY_MIGRATIONS.sql` in your code editor and copy ALL the SQL content.

### Step 3: Execute the SQL
1. In the Supabase SQL Editor, paste the entire SQL content
2. Click **"Run"** button (bottom right)
3. Wait for success message: "Success. No rows returned"

### Step 4: Verify Tables Created
After running the migrations, verify these tables exist:
- ✅ `profiles` - User profile data
- ✅ `room_players` - Lobby player data (with `username` column)
- ✅ `rooms` - Room data (with `fill_with_bots` column)

You can check by going to: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/editor

---

## 🧪 Test After Applying Migrations

Once migrations are applied, test these flows:

1. **Quick Play**
   - Tap "Quick Play" button
   - Should create a room with a 6-character code (e.g., "QKM6D7")
   - Should see yourself in the lobby

2. **Create Room**
   - Tap "Create Room" button
   - Should create a room with a 6-character code
   - Should see yourself as host in the lobby

3. **Join Room**
   - Get a room code from another player (6 characters)
   - Tap "Join Room" button
   - Enter the 6-character code
   - Should join the lobby successfully

---

## 🔍 What Changed in Code

### Room Code Generation (Before → After)
```typescript
// BEFORE (4 characters)
for (let i = 0; i < 4; i++) {
  code += chars.charAt(Math.floor(Math.random() * chars.length));
}

// AFTER (6 characters, clearer character set)
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude O, I, 0, 1
for (let i = 0; i < 6; i++) {
  code += chars.charAt(Math.floor(Math.random() * chars.length));
}
```

### Room Code Validation (Before → After)
```typescript
// BEFORE
if (roomCode.length !== 4) {
  Alert.alert('Invalid Code', 'Room code must be 4 characters');
}

// AFTER
if (roomCode.length !== 6) {
  Alert.alert('Invalid Code', 'Room code must be 6 characters');
}
```

---

## 📊 Migration Details

The SQL script does the following:

1. **Creates `profiles` table** - Stores user data (username, avatar)
2. **Creates `room_players` table** - Stores lobby player data with `username` column
3. **Adds `fill_with_bots` column** to existing `rooms` table
4. **Sets up RLS policies** - Row Level Security for data access control
5. **Creates indexes** - For better query performance
6. **Enables Realtime** - For live updates in the app
7. **Adds trigger** - Auto-creates profile on user signup

---

## ⚠️ Important Notes

- The migration script is **idempotent** (safe to run multiple times)
- All `CREATE TABLE IF NOT EXISTS` statements prevent duplicate table errors
- All policies check for existence before creation
- Existing data is preserved and updated where necessary

---

## 🆘 Troubleshooting

### If you still see the error after applying migrations:

1. **Verify username column exists:**
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'room_players';
   ```
   Should show `username` with type `character varying`

2. **Check if RLS policies are blocking:**
   - Go to: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/auth/policies
   - Verify `room_players` has policies enabled

3. **Restart your app:**
   - Close the Expo development server
   - Clear cache: `cd apps/mobile && npx expo start -c`

---

## 📝 Summary

✅ **Fixed:** Room codes now generate as 6 characters  
✅ **Fixed:** Validation requires 6 characters  
✅ **Created:** Migration script with all database changes  
⏳ **TODO:** Apply migrations in Supabase dashboard (required to fix the error)

---

Once you apply the migrations, the "column does not exist" error will be resolved and you'll be able to create/join rooms successfully! 🚀
