-- ============================================
-- MOBILE APP DATABASE MIGRATIONS
-- Apply this SQL in Supabase SQL Editor
-- https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql
-- ============================================

-- MIGRATION 1: Mobile Lobby Schema
-- ============================================

-- Add fill_with_bots column to rooms table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rooms' AND column_name = 'fill_with_bots'
  ) THEN
    ALTER TABLE rooms ADD COLUMN fill_with_bots BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Create profiles table for user data (if not exists)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(50) UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Public profiles are viewable by everyone') THEN
    CREATE POLICY "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can update own profile') THEN
    CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can insert own profile') THEN
    CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- Create room_players table for lobby management (if not exists)
CREATE TABLE IF NOT EXISTS room_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  player_index INTEGER NOT NULL CHECK (player_index >= 0 AND player_index < 4),
  is_host BOOLEAN DEFAULT FALSE,
  is_ready BOOLEAN DEFAULT FALSE,
  is_bot BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(room_id, player_index),
  UNIQUE(room_id, user_id)
);

-- Enable RLS on room_players
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;

-- RLS Policies for room_players
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'room_players' AND policyname = 'Players can view room_players in their room') THEN
    CREATE POLICY "Players can view room_players in their room" ON room_players
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM room_players rp
          WHERE rp.room_id = room_players.room_id
          AND rp.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'room_players' AND policyname = 'Authenticated users can join rooms') THEN
    CREATE POLICY "Authenticated users can join rooms" ON room_players
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'room_players' AND policyname = 'Players can update their own status') THEN
    CREATE POLICY "Players can update their own status" ON room_players
      FOR UPDATE USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'room_players' AND policyname = 'Players can leave rooms') THEN
    CREATE POLICY "Players can leave rooms" ON room_players
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- Enable RLS on rooms
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- RLS Policies for rooms
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rooms' AND policyname = 'Anyone can view rooms') THEN
    CREATE POLICY "Anyone can view rooms" ON rooms FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rooms' AND policyname = 'Authenticated users can create rooms') THEN
    CREATE POLICY "Authenticated users can create rooms" ON rooms
      FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rooms' AND policyname = 'Host can update room') THEN
    CREATE POLICY "Host can update room" ON rooms
      FOR UPDATE USING (
        host_player_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM room_players
          WHERE room_players.room_id = rooms.id
          AND room_players.user_id = auth.uid()
          AND room_players.is_host = TRUE
        )
      );
  END IF;
END $$;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_room_players_room_id ON room_players(room_id);
CREATE INDEX IF NOT EXISTS idx_room_players_user_id ON room_players(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- Function to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'Player_' || substring(NEW.id::text, 1, 8))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable realtime for mobile tables (if not already enabled)
DO $$ 
BEGIN
  -- Add rooms table to realtime (if not already added)
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Table already in publication, skip
  END;
  
  -- Add room_players table to realtime (if not already added)
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE room_players;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Table already in publication, skip
  END;
  
  -- Add profiles table to realtime (if not already added)
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Table already in publication, skip
  END;
END $$;


-- MIGRATION 2: Add Username to room_players
-- ============================================

-- Add username column to room_players for display purposes
ALTER TABLE room_players 
ADD COLUMN IF NOT EXISTS username VARCHAR(50);

-- Update existing records to pull username from profiles (if any exist)
UPDATE room_players rp
SET username = p.username
FROM profiles p
WHERE rp.user_id = p.id
AND rp.username IS NULL;

-- Create index for username lookups
CREATE INDEX IF NOT EXISTS idx_room_players_username ON room_players(username);

-- ============================================
-- MIGRATION 3: Fix Leaderboard Refresh Function
-- ============================================

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS refresh_leaderboard();

-- Recreate with CONCURRENTLY for better performance (unique index exists)
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Manually refresh the view now
REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global;

-- Grant execute permission to authenticated and anonymous users
GRANT EXECUTE ON FUNCTION refresh_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_leaderboard() TO anon;

-- ============================================
-- MIGRATIONS COMPLETE!
-- ============================================
