-- ============================================
-- FIX: Google OAuth Username Extraction
-- ============================================
-- Problem: Google OAuth stores user's name in 'full_name' field,
-- not 'username' field, causing fallback to Player_[ID]
--
-- Solution: Update handle_new_user to check multiple fields in priority order:
-- 1. username (for custom sign-ups)
-- 2. full_name (for Google OAuth)
-- 3. name (fallback for other providers)
-- 4. Player_[ID] (last resort)

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_username TEXT;
  v_attempt INTEGER := 0;
  v_max_attempts INTEGER := 10;
  v_success BOOLEAN := FALSE;
BEGIN
  -- Generate base username with priority order
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',    -- Custom sign-ups
    NEW.raw_user_meta_data->>'full_name',   -- Google OAuth (primary)
    NEW.raw_user_meta_data->>'name',        -- Other providers
    'Player_' || substring(NEW.id::text, 1, 8)  -- Fallback
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
          NEW.raw_user_meta_data->>'full_name',
          NEW.raw_user_meta_data->>'name',
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
  'Automatically creates a profile when a new user signs up. Extracts username from OAuth metadata with priority: username > full_name > name > fallback. Handles conflicts with random suffix.';

-- ============================================
-- FIX: Update Existing Users with Incorrect Usernames
-- ============================================
-- Update any existing users whose profiles have Player_[ID] format
-- but have a full_name in their OAuth metadata

DO $$
DECLARE
  v_user_record RECORD;
  v_new_username TEXT;
BEGIN
  FOR v_user_record IN 
    SELECT 
      u.id, 
      u.raw_user_meta_data,
      p.username as current_username
    FROM auth.users u
    INNER JOIN profiles p ON u.id = p.id
    WHERE p.username LIKE 'Player_%'
      AND (
        u.raw_user_meta_data->>'full_name' IS NOT NULL 
        OR u.raw_user_meta_data->>'name' IS NOT NULL
      )
  LOOP
    -- Extract the proper username
    v_new_username := COALESCE(
      v_user_record.raw_user_meta_data->>'username',
      v_user_record.raw_user_meta_data->>'full_name',
      v_user_record.raw_user_meta_data->>'name'
    );
    
    -- Update profile if we found a better username
    IF v_new_username IS NOT NULL AND v_new_username != v_user_record.current_username THEN
      BEGIN
        UPDATE profiles 
        SET username = v_new_username,
            updated_at = NOW()
        WHERE id = v_user_record.id;
        
        RAISE NOTICE 'Updated username for user %: % -> %', 
          v_user_record.id, v_user_record.current_username, v_new_username;
          
      EXCEPTION
        WHEN unique_violation THEN
          -- If username is taken, append a random suffix
          v_new_username := v_new_username || '_' || floor(random() * 1000)::text;
          
          UPDATE profiles 
          SET username = v_new_username,
              updated_at = NOW()
          WHERE id = v_user_record.id;
          
          RAISE NOTICE 'Updated username (with suffix) for user %: % -> %', 
            v_user_record.id, v_user_record.current_username, v_new_username;
      END;
    END IF;
  END LOOP;
END $$;

-- Refresh the leaderboard materialized view to reflect changes
REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global;
