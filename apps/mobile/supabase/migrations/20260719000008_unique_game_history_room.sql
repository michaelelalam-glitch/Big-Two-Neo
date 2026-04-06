-- Prevent duplicate game completions from concurrent complete-game edge function calls.
-- The SELECT/INSERT race in complete-game can cause two clients to insert duplicate
-- game_history records for the same room_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_history_unique_room_id
  ON game_history(room_id)
  WHERE room_id IS NOT NULL;
