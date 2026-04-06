-- Migration: add_current_player_default (2026-07-19)
--
-- ⚠️  Despite the filename (preserved to avoid breaking supabase_migrations tracking),
-- this migration backfills MULTIPLE game_state columns that may be absent on older
-- Supabase projects:
--   current_player, scores, round, passes, passes_in_row, last_play, last_player,
--   play_history, round_number, dealer_index, game_started_at
--
-- Ensures all game_state columns that may be absent on older Supabase projects
-- (where the table predates the consolidated baseline) exist with the same
-- constraints the baseline defines. The baseline uses CREATE TABLE IF NOT EXISTS,
-- so columns added after initial project setup are missing on environments that
-- predate those additions.
--
-- Strategy (avoids long ACCESS EXCLUSIVE locks):
--   1. ADD COLUMN IF NOT EXISTS with no NOT NULL (never blocks for long)
--   2. UPDATE to backfill existing rows
--   3. ALTER COLUMN SET NOT NULL (safe because no NULLs remain)
--   4. ALTER COLUMN SET DEFAULT for future inserts
--   5. For CHECK constraints: use NOT VALID (skip existing rows) + VALIDATE
--      CONSTRAINT (uses SHARE UPDATE EXCLUSIVE, less disruptive)

-- current_player: NOT NULL, CHECK (0–3), DEFAULT 0
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS current_player INTEGER;
UPDATE public.game_state SET current_player = 0 WHERE current_player IS NULL;
ALTER TABLE public.game_state ALTER COLUMN current_player SET NOT NULL;
ALTER TABLE public.game_state ALTER COLUMN current_player SET DEFAULT 0;
-- Add 0-3 range CHECK (matching baseline) only if not already present.
-- NOT VALID skips existing rows; VALIDATE uses a less-disruptive SHARE UPDATE lock.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.game_state'::regclass
      AND conname = 'game_state_current_player_range'
  ) THEN
    ALTER TABLE public.game_state
      ADD CONSTRAINT game_state_current_player_range
      CHECK (current_player >= 0 AND current_player < 4) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.game_state VALIDATE CONSTRAINT game_state_current_player_range;

-- scores: JSONB NOT NULL DEFAULT '[0,0,0,0]'
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS scores JSONB;
UPDATE public.game_state SET scores = '[0, 0, 0, 0]'::jsonb WHERE scores IS NULL;
ALTER TABLE public.game_state ALTER COLUMN scores SET NOT NULL;
ALTER TABLE public.game_state ALTER COLUMN scores SET DEFAULT '[0, 0, 0, 0]'::jsonb;

-- round: INTEGER NOT NULL DEFAULT 1
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS round INTEGER;
UPDATE public.game_state SET round = 1 WHERE round IS NULL;
ALTER TABLE public.game_state ALTER COLUMN round SET NOT NULL;
ALTER TABLE public.game_state ALTER COLUMN round SET DEFAULT 1;

-- passes: INTEGER NOT NULL DEFAULT 0
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS passes INTEGER;
UPDATE public.game_state SET passes = 0 WHERE passes IS NULL;
ALTER TABLE public.game_state ALTER COLUMN passes SET NOT NULL;
ALTER TABLE public.game_state ALTER COLUMN passes SET DEFAULT 0;

-- passes_in_row: INTEGER NOT NULL DEFAULT 0
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS passes_in_row INTEGER;
UPDATE public.game_state SET passes_in_row = 0 WHERE passes_in_row IS NULL;
ALTER TABLE public.game_state ALTER COLUMN passes_in_row SET NOT NULL;
ALTER TABLE public.game_state ALTER COLUMN passes_in_row SET DEFAULT 0;

-- last_play / last_player: nullable (no further constraints)
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS last_play JSONB;
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS last_player INTEGER;

-- play_history: JSONB NOT NULL DEFAULT '[]'
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS play_history JSONB;
UPDATE public.game_state SET play_history = '[]'::jsonb WHERE play_history IS NULL;
ALTER TABLE public.game_state ALTER COLUMN play_history SET NOT NULL;
ALTER TABLE public.game_state ALTER COLUMN play_history SET DEFAULT '[]'::jsonb;

-- round_number: INTEGER NOT NULL DEFAULT 1
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS round_number INTEGER;
UPDATE public.game_state SET round_number = 1 WHERE round_number IS NULL;
ALTER TABLE public.game_state ALTER COLUMN round_number SET NOT NULL;
ALTER TABLE public.game_state ALTER COLUMN round_number SET DEFAULT 1;

-- dealer_index: INTEGER NOT NULL DEFAULT 0
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS dealer_index INTEGER;
UPDATE public.game_state SET dealer_index = 0 WHERE dealer_index IS NULL;
ALTER TABLE public.game_state ALTER COLUMN dealer_index SET NOT NULL;
ALTER TABLE public.game_state ALTER COLUMN dealer_index SET DEFAULT 0;

-- game_started_at: TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- Added nullable first to avoid volatile-default table rewrite lock.
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS game_started_at TIMESTAMPTZ;
-- Backfill from rooms.started_at (actual game-start time) with fallback to
-- rooms.created_at (room-open time), to preserve real game timing rather than
-- stamping all historical rows with the migration execution time.
UPDATE public.game_state gs
SET game_started_at = COALESCE(r.started_at, r.created_at, NOW())
FROM public.rooms r
WHERE r.id = gs.room_id
  AND gs.game_started_at IS NULL;
-- Safety net: stamp any orphan game_state rows (no matching room) with NOW().
UPDATE public.game_state SET game_started_at = NOW() WHERE game_started_at IS NULL;
ALTER TABLE public.game_state ALTER COLUMN game_started_at SET NOT NULL;
ALTER TABLE public.game_state ALTER COLUMN game_started_at SET DEFAULT NOW();

-- Signal PostgREST to reload its schema cache immediately.
NOTIFY pgrst, 'reload schema';
