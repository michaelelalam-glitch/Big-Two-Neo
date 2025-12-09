-- Complete Minimal Schema for Card Tracking Testing
-- This creates all necessary tables from scratch for local testing

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create rooms table
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(6) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  host_id UUID,
  max_players INTEGER NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create room_players table with hand tracking
CREATE TABLE room_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL,
  position INTEGER NOT NULL,
  username TEXT,
  is_ready BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Card tracking columns (Phase 2 addition)
  hand JSONB DEFAULT '[]'::jsonb,
  hand_count INTEGER GENERATED ALWAYS AS (jsonb_array_length(hand)) STORED,
  
  UNIQUE(room_id, player_id),
  UNIQUE(room_id, position)
);

-- Create game_state table
CREATE TABLE game_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID UNIQUE NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  game_phase VARCHAR(20) NOT NULL DEFAULT 'waiting',
  current_turn UUID,
  last_play JSONB,
  pass_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_room_players_room_id ON room_players(room_id);
CREATE INDEX idx_room_players_player_id ON room_players(player_id);
CREATE INDEX idx_room_players_hand_count ON room_players(hand_count);
CREATE INDEX idx_game_state_room_id ON game_state(room_id);

-- Enable RLS
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies for room_players
CREATE POLICY "Players can view all hands for testing"
  ON room_players FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage all hands"
  ON room_players FOR ALL
  USING (true);

CREATE POLICY "Anyone can update for testing"
  ON room_players FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can insert for testing"
  ON room_players FOR INSERT
  WITH CHECK (true);

-- RLS Policies for rooms
CREATE POLICY "Anyone can view rooms"
  ON rooms FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create rooms"
  ON rooms FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Host can update room"
  ON rooms FOR UPDATE
  USING (host_id = auth.uid() OR host_id IS NULL);

-- RLS Policies for game_state
CREATE POLICY "Players can view game state"
  ON game_state FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage game state"
  ON game_state FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Anyone can update game state"
  ON game_state FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can insert game state"
  ON game_state FOR INSERT
  WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE room_players;
ALTER PUBLICATION supabase_realtime ADD TABLE game_state;

-- Insert test data
INSERT INTO rooms (id, code, status, max_players) VALUES
  ('11111111-1111-1111-1111-111111111111', 'TEST01', 'waiting', 4);

INSERT INTO room_players (room_id, player_id, position, username) VALUES
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 0, 'Player1'),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 1, 'Player2'),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 2, 'Player3'),
  ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 3, 'Player4');

INSERT INTO game_state (room_id, game_phase) VALUES
  ('11111111-1111-1111-1111-111111111111', 'waiting');
