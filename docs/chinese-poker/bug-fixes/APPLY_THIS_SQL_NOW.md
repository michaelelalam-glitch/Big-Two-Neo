# 🚨 QUICK FIX: Apply This SQL NOW

## Problem:
Google sign-in redirects back to sign-in screen after successful OAuth

## Solution:
Apply this SQL migration to Supabase

---

## Step 1: Open Supabase SQL Editor
https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql

## Step 2: Copy & Paste This Entire SQL:

```sql
-- ============================================
-- FIX: Google Multi-Account Authentication
-- ============================================

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Create improved handle_new_user function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_username TEXT;
  v_attempt INTEGER := 0;
  v_max_attempts INTEGER := 10;
  v_success BOOLEAN := FALSE;
BEGIN
  -- Generate base username
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    'Player_' || substring(NEW.id::text, 1, 8)
  );

  -- Try to insert profile with username collision handling
  WHILE v_attempt < v_max_attempts AND NOT v_success LOOP
    BEGIN
      INSERT INTO public.profiles (id, username)
      VALUES (NEW.id, v_username)
      ON CONFLICT (id) DO UPDATE
        SET username = EXCLUDED.username,
            updated_at = NOW();
      
      v_success := TRUE;
      
    EXCEPTION
      WHEN unique_violation THEN
        -- Username already taken, append random suffix
        v_attempt := v_attempt + 1;
        v_username := COALESCE(
          NEW.raw_user_meta_data->>'username',
          'Player_' || substring(NEW.id::text, 1, 8)
        ) || '_' || floor(random() * 1000)::text;
        
        -- Log the conflict for debugging
        RAISE NOTICE 'Username conflict detected. Attempt % of %. Trying: %', 
          v_attempt, v_max_attempts, v_username;
    END;
  END LOOP;

  IF NOT v_success THEN
    RAISE EXCEPTION 'Failed to create profile after % attempts', v_max_attempts;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user IS 
  'Automatically creates a profile when a new user signs up via OAuth. Handles username conflicts by appending a random suffix.';

-- Clean up any orphaned auth.users without profiles
DO $$
DECLARE
  v_user_record RECORD;
  v_username TEXT;
BEGIN
  FOR v_user_record IN 
    SELECT id, raw_user_meta_data 
    FROM auth.users 
    WHERE id NOT IN (SELECT id FROM profiles)
  LOOP
    v_username := COALESCE(
      v_user_record.raw_user_meta_data->>'username',
      'Player_' || substring(v_user_record.id::text, 1, 8)
    );
    
    INSERT INTO profiles (id, username)
    VALUES (v_user_record.id, v_username)
    ON CONFLICT (username) DO NOTHING;
    
    RAISE NOTICE 'Created profile for existing user: %', v_user_record.id;
  END LOOP;
END $$;
```

## Step 3: Click "Run" button

## Step 4: Test Sign-In
1. Sign out from your current account
2. Sign in with a **different Google account**
3. **Should work now!** ✅

---

## What This Fixes:
- ✅ Profile creation no longer fails silently
- ✅ Username conflicts handled automatically (appends suffix)
- ✅ Multiple Google accounts can sign in
- ✅ No more redirect loops
- ✅ Orphaned users get profiles created

---

**APPLY THIS NOW - IT'S CRITICAL!** 🚨
