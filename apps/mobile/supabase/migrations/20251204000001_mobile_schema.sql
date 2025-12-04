-- Mobile App Schema for Big2 Multiplayer
-- Date: December 4, 2025
-- Purpose: Set up database schema for mobile app with profiles support

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PROFILES TABLE
-- ============================================================================

-- Create profiles table that references auth.users
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policies for profiles
CREATE POLICY "Public profiles are viewable by everyone"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Index for profiles
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- ============================================================================
-- ROOMS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  host_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting',
  max_players INTEGER NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_status CHECK (status IN ('waiting', 'playing', 'finished')),
  CONSTRAINT valid_code CHECK (LENGTH(code) = 6),
  CONSTRAINT valid_max_players CHECK (max_players BETWEEN 2 AND 4)
);

-- Enable RLS on rooms
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- Policies for rooms
CREATE POLICY "Rooms are viewable by host and participants"
  ON rooms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM players
      WHERE players.room_id = rooms.id
        AND players.user_id = auth.uid()
    )
    OR rooms.host_id = auth.uid()
  );

CREATE POLICY "Authenticated users can create rooms"
  ON rooms FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Host can update their room"
  ON rooms FOR UPDATE
  USING (auth.uid() = host_id);

CREATE POLICY "Host can delete their room"
  ON rooms FOR DELETE
  USING (auth.uid() = host_id);

-- Indexes for rooms
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_host ON rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_rooms_created ON rooms(created_at DESC);

-- ============================================================================
-- PLAYERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  position INTEGER NOT NULL,
  is_host BOOLEAN DEFAULT false,
  is_ready BOOLEAN DEFAULT false,
  connected BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_room_position UNIQUE(room_id, position),
  CONSTRAINT unique_room_user UNIQUE(room_id, user_id),
  CONSTRAINT valid_position CHECK (position BETWEEN 0 AND 3)
);

-- Enable RLS on players
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

-- Policies for players
CREATE POLICY "Players are viewable by everyone"
  ON players FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can join rooms"
  ON players FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own player record"
  ON players FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can leave rooms"
  ON players FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for players
CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
CREATE INDEX IF NOT EXISTS idx_players_user ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_players_position ON players(room_id, position);

-- ============================================================================
-- GAME STATE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS game_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID UNIQUE NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  current_turn INTEGER NOT NULL DEFAULT 0,
  turn_timer INTEGER NOT NULL DEFAULT 30,
  last_play JSONB,
  pass_count INTEGER DEFAULT 0,
  game_phase TEXT NOT NULL DEFAULT 'dealing',
  winner_position INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_turn CHECK (current_turn BETWEEN 0 AND 3),
  CONSTRAINT valid_passes CHECK (pass_count BETWEEN 0 AND 3),
  CONSTRAINT valid_phase CHECK (game_phase IN ('dealing', 'playing', 'finished')),
  CONSTRAINT valid_winner CHECK (winner_position IS NULL OR (winner_position BETWEEN 0 AND 3))
);

-- Enable RLS on game_state
ALTER TABLE game_state ENABLE ROW LEVEL SECURITY;

-- Policies for game_state
CREATE POLICY "Game state is viewable by everyone"
  ON game_state FOR SELECT
  USING (true);

CREATE POLICY "Host can create game state"
  ON game_state FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rooms 
      WHERE rooms.id = room_id 
      AND rooms.host_id = auth.uid()
    )
  );

-- Direct updates are restricted to prevent tampering
-- Game state mutations should be performed via SECURITY DEFINER functions
-- that enforce game rules and validate transitions
CREATE POLICY "Restrict direct game state updates"
  ON game_state FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- Indexes for game_state
CREATE INDEX IF NOT EXISTS idx_game_state_room ON game_state(room_id);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_rooms_updated_at ON rooms;
CREATE TRIGGER update_rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_players_updated_at ON players;
CREATE TRIGGER update_players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_game_state_updated_at ON game_state;
CREATE TRIGGER update_game_state_updated_at
  BEFORE UPDATE ON game_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================================
-- ENABLE REALTIME
-- ============================================================================

-- Enable realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE players;
ALTER PUBLICATION supabase_realtime ADD TABLE game_state;

COMMENT ON TABLE profiles IS 'User profiles linked to auth.users';
COMMENT ON TABLE rooms IS 'Game rooms where players gather';
COMMENT ON TABLE players IS 'Players in each game room';
COMMENT ON TABLE game_state IS 'Current state of active games';
