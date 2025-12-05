-- Mobile App Lobby Schema
-- Tables for mobile app lobby/matchmaking system

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
CREATE POLICY "Public profiles are viewable by everyone" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

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
CREATE POLICY "Players can view room_players in their room" ON room_players
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM room_players rp
      WHERE rp.room_id = room_players.room_id
      AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can join rooms" ON room_players
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_host = FALSE);

-- Note: Users cannot change is_host status via UPDATE. Only is_ready can be changed.
-- Host status is immutable and determined by rooms.host_id
CREATE POLICY "Players can update their own status" ON room_players
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id AND 
    is_host = (SELECT is_host FROM room_players WHERE id = room_players.id)
  );

CREATE POLICY "Players can leave rooms" ON room_players
  FOR DELETE USING (auth.uid() = user_id);

-- Enable RLS on rooms
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- RLS Policies for rooms
CREATE POLICY "Anyone can view rooms" ON rooms
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create rooms" ON rooms
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- SECURITY: Only the room's host_id can update room settings, not based on room_players.is_host
CREATE POLICY "Host can update room" ON rooms
  FOR UPDATE USING (host_id = auth.uid());

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

-- Enable realtime for mobile tables
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE room_players;
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
