-- Migration: Add bot_difficulty column to game_history table.
-- Date: 2026-03-03
-- Purpose: Store the difficulty level of bot players (easy/medium/hard) for a game
-- so the Stats screen's Recent Games list can display e.g. "Bot 1 (E)" next to
-- easy-difficulty bots. All bots in a single game share the same difficulty, so
-- a single game-level column is sufficient.

ALTER TABLE game_history
ADD COLUMN IF NOT EXISTS bot_difficulty TEXT
  CHECK (bot_difficulty IN ('easy', 'medium', 'hard'));

COMMENT ON COLUMN game_history.bot_difficulty IS
  'Difficulty of bot players present in this game (easy/medium/hard). NULL for human-only games. '
  'All bots in a given game share the same difficulty, so a single column covers all bot slots.';
