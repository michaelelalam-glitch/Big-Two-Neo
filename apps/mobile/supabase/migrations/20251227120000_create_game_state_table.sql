-- ==========================================================================
-- CREATE GAME_STATE TABLE
-- ==========================================================================
-- CRITICAL FIX: game_state table was never created but is used by all game logic!
-- This table stores the real-time game state for multiplayer games

CREATE TABLE IF NOT EXISTS game_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
  
  -- Turn management
  current_turn INTEGER NOT NULL CHECK (current_turn >= 0 AND current_turn < 4),
  current_player INTEGER NOT NULL CHECK (current_player >= 0 AND current_player < 4),
  
  -- Player hands (by player_index 0-3)
  hands JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Game state
  played_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  scores JSONB NOT NULL DEFAULT '[0, 0, 0, 0]'::jsonb,
  round INTEGER NOT NULL DEFAULT 1,
  passes INTEGER NOT NULL DEFAULT 0,
  passes_in_row INTEGER NOT NULL DEFAULT 0,
  
  -- Last play tracking
  last_play JSONB,
  last_player INTEGER,
  
  -- History
  play_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Match tracking
  round_number INTEGER NOT NULL DEFAULT 1,
  dealer_index INTEGER NOT NULL DEFAULT 0,
  
  -- Metadata
  game_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  auto_pass_active BOOLEAN DEFAULT FALSE,
  game_phase VARCHAR(20) NOT NULL DEFAULT 'playing' CHECK (game_phase IN ('first_play', 'playing', 'finished')),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_game_state_room_id ON game_state(room_id);
CREATE INDEX IF NOT EXISTS idx_game_state_current_turn ON game_state(current_turn);
CREATE INDEX IF NOT EXISTS idx_game_state_game_phase ON game_state(game_phase);

-- Enable RLS
ALTER TABLE game_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Anyone in the room can view game state
CREATE POLICY "Players can view game state in their room" ON game_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM room_players
      WHERE room_players.room_id = game_state.room_id
      AND room_players.user_id = auth.uid()
    )
  );

-- RLS Policy: Only coordinator can insert/update (via RPC functions run as SECURITY DEFINER)
-- No direct insert/update policies needed - all changes via RPC functions

-- Enable realtime subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE game_state;

-- Comments
COMMENT ON TABLE game_state IS 'Real-time game state for multiplayer Big Two games. Synced via Supabase Realtime.';
COMMENT ON COLUMN game_state.hands IS 'Player hands as JSONB object with keys "0", "1", "2", "3" mapping to arrays of card objects';
COMMENT ON COLUMN game_state.current_turn IS 'Player index (0-3) whose turn it is';
COMMENT ON COLUMN game_state.game_phase IS 'Game phase: first_play (must play 3D), playing (normal), finished';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'game_state table created successfully';
END $$;
