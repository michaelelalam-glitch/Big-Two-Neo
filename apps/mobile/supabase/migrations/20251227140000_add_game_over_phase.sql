-- Migration: Add 'game_over' phase to game_state table
-- Date: December 27, 2025
-- Purpose: Support final game over state when someone reaches >= 101 points

-- Drop existing CHECK constraint
ALTER TABLE game_state DROP CONSTRAINT IF EXISTS game_state_game_phase_check;

-- Add new CHECK constraint with 'game_over' phase
ALTER TABLE game_state 
  ADD CONSTRAINT game_state_game_phase_check 
  CHECK (game_phase IN ('first_play', 'playing', 'finished', 'game_over'));

-- Update comment
COMMENT ON COLUMN game_state.game_phase IS 'Game phase: first_play (must play 3D), playing (normal), finished (match ended), game_over (someone >= 101 points)';
