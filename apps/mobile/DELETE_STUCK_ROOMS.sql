-- EMERGENCY: Delete ALL stuck rooms to fix matchmaking
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql/new

-- Step 1: See what rooms exist
SELECT id, code, status, created_at, (NOW() - created_at) as age
FROM rooms 
WHERE status IN ('waiting', 'starting', 'playing', 'active')
ORDER BY created_at DESC;

-- Step 2: DELETE ALL non-completed rooms (NUCLEAR OPTION)
DELETE FROM rooms 
WHERE status IN ('waiting', 'starting', 'playing', 'active');

-- Step 3: Verify cleanup
SELECT COUNT(*) as remaining_rooms 
FROM rooms 
WHERE status IN ('waiting', 'starting', 'playing', 'active');

-- This should return 0 rows
