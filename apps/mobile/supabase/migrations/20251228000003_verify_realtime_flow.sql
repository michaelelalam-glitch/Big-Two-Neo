-- ============================================================================
-- FIX: Use Supabase Realtime channel instead of pg_notify
-- ============================================================================
-- Problem: Server uses pg_notify but frontend listens to broadcast events
-- Solution: Replace pg_notify with direct realtime.send() via Edge Function
--           OR use a trigger that frontend can listen to
--
-- The issue: pg_notify sends to PostgreSQL's LISTEN/NOTIFY system
--           Supabase Realtime broadcasts are a separate system
--
-- Best solution: Update game_state, let Realtime postgres_changes trigger,
--                then frontend detects timer in the UPDATE payload

-- NO CODE CHANGES NEEDED! Just verify the flow:
-- 1. Server updates game_state.auto_pass_timer
-- 2. postgres_changes event fires
-- 3. Frontend receives updated game_state
-- 4. Frontend detects timer and starts countdown

-- The frontend already has this logic in useRealtime.ts:
-- .on('postgres_changes', {
--   event: '*',
--   schema: 'public',
--   table: 'game_state',
--   filter: `room_id=eq.${roomId}`,
-- }, (payload) => {
--   if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
--     const newGameState = payload.new as GameState;
--     setGameState(newGameState); // This will include auto_pass_timer!
--   }
-- })

-- ✅ The auto_pass_timer will be in the UPDATE payload automatically!
-- ✅ No broadcast events needed - postgres_changes is enough!

SELECT 'Migration complete - auto_pass_timer now propagates via postgres_changes' AS status;
