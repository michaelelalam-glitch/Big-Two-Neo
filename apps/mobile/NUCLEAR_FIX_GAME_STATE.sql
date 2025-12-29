-- NUCLEAR FIX: Drop and recreate game_state with correct schema
-- WARNING: This will DELETE ALL ACTIVE GAMES
-- Run this ONLY if you understand the consequences

-- 1. Drop the corrupted table
DROP TABLE IF EXISTS game_state CASCADE;

-- 2. Recreate with CORRECT schema (from ba1013f working version)
CREATE TABLE game_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  
  -- Game flow
  current_turn INTEGER NOT NULL DEFAULT 0,
  last_play JSONB,
  pass_count INTEGER NOT NULL DEFAULT 0,
  game_phase TEXT NOT NULL DEFAULT 'playing',
  
  -- Player hands
  hands JSONB NOT NULL DEFAULT '{"0": [], "1": [], "2": [], "3": []}'::jsonb,
  
  -- Game history
  play_history JSONB DEFAULT '[]'::jsonb,
  played_cards JSONB DEFAULT '[]'::jsonb,
  
  -- Match tracking
  match_number INTEGER NOT NULL DEFAULT 1,
  round_number INTEGER DEFAULT 1,
  
  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Auto-pass timer
  auto_pass_timer JSONB,
  
  UNIQUE(room_id)
);

-- 3. Enable RLS
ALTER TABLE game_state ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
CREATE POLICY "Players can view game state for their room"
  ON game_state FOR SELECT
  USING (
    room_id IN (
      SELECT room_id 
      FROM room_players 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage game state"
  ON game_state FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. Create index for fast lookups
CREATE INDEX idx_game_state_room_id ON game_state(room_id);

-- 6. Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE game_state;

-- DONE - Test by creating a new game
