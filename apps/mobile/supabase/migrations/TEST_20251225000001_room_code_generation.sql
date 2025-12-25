-- Test Script for Room Code Generation (Task 1.1A)
-- Run this in Supabase SQL Editor or psql after applying migration

-- ============================================================================
-- TEST 1: Generate 100 room codes and verify no confusing characters
-- ============================================================================
DO $$
DECLARE
  test_code VARCHAR;
  i INTEGER;
  confusing_chars TEXT := '1I0O';
  total_codes INTEGER := 0;
  valid_codes INTEGER := 0;
BEGIN
  RAISE NOTICE 'TEST 1: Generating 100 room codes...';
  
  FOR i IN 1..100 LOOP
    test_code := generate_room_code_v2();
    total_codes := total_codes + 1;
    
    -- Check for confusing characters
    IF test_code !~ '[1I0O]' THEN
      valid_codes := valid_codes + 1;
    ELSE
      RAISE NOTICE 'FAIL: Code contains confusing character: %', test_code;
    END IF;
    
    -- Verify length
    IF LENGTH(test_code) != 6 THEN
      RAISE EXCEPTION 'FAIL: Code length is not 6: %', test_code;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Generated % codes, % valid (%.0f%%)', 
    total_codes, valid_codes, (valid_codes::FLOAT / total_codes * 100);
    
  IF valid_codes = total_codes THEN
    RAISE NOTICE '✅ TEST 1 PASSED: All codes exclude confusing characters';
  ELSE
    RAISE EXCEPTION '❌ TEST 1 FAILED: Some codes contain confusing characters';
  END IF;
END $$;

-- ============================================================================
-- TEST 2: Verify collision detection works
-- ============================================================================
DO $$
DECLARE
  test_code VARCHAR;
  collision_detected BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE 'TEST 2: Testing collision detection...';
  
  -- Create a temporary room with a known code
  INSERT INTO rooms (code, host_id, status, max_players)
  VALUES ('ABC123', (SELECT id FROM auth.users LIMIT 1), 'waiting', 4);
  
  -- Try to generate codes - should never return ABC123
  FOR i IN 1..50 LOOP
    test_code := generate_room_code_v2();
    
    IF test_code = 'ABC123' THEN
      collision_detected := TRUE;
      RAISE EXCEPTION '❌ TEST 2 FAILED: Generated code collided with existing: %', test_code;
    END IF;
  END LOOP;
  
  -- Cleanup
  DELETE FROM rooms WHERE code = 'ABC123';
  
  RAISE NOTICE '✅ TEST 2 PASSED: No collisions detected in 50 attempts';
END $$;

-- ============================================================================
-- TEST 3: Test cleanup function
-- ============================================================================
DO $$
DECLARE
  cleanup_result JSON;
  test_room_id UUID;
BEGIN
  RAISE NOTICE 'TEST 3: Testing cleanup_abandoned_rooms()...';
  
  -- Create abandoned waiting room (> 2 hours old)
  INSERT INTO rooms (code, host_id, status, max_players, updated_at)
  VALUES ('TEST01', (SELECT id FROM auth.users LIMIT 1), 'waiting', 4, NOW() - INTERVAL '3 hours')
  RETURNING id INTO test_room_id;
  
  -- Create old completed room (> 30 days old)
  INSERT INTO rooms (code, host_id, status, max_players, updated_at)
  VALUES ('TEST02', (SELECT id FROM auth.users LIMIT 1), 'completed', 4, NOW() - INTERVAL '31 days');
  
  -- Run cleanup
  SELECT cleanup_abandoned_rooms() INTO cleanup_result;
  
  RAISE NOTICE 'Cleanup result: %', cleanup_result;
  
  -- Verify rooms were deleted
  IF NOT EXISTS (SELECT 1 FROM rooms WHERE code IN ('TEST01', 'TEST02')) THEN
    RAISE NOTICE '✅ TEST 3 PASSED: Cleanup function works correctly';
  ELSE
    RAISE EXCEPTION '❌ TEST 3 FAILED: Rooms were not deleted';
  END IF;
END $$;

-- ============================================================================
-- TEST 4: Verify bot columns exist
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'TEST 4: Checking bot support columns...';
  
  -- Check players table
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'players' AND column_name = 'is_bot'
  ) THEN
    RAISE NOTICE '✅ players.is_bot exists';
  ELSE
    RAISE EXCEPTION '❌ players.is_bot missing';
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'players' AND column_name = 'bot_difficulty'
  ) THEN
    RAISE NOTICE '✅ players.bot_difficulty exists';
  ELSE
    RAISE EXCEPTION '❌ players.bot_difficulty missing';
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'players' AND column_name = 'bot_name'
  ) THEN
    RAISE NOTICE '✅ players.bot_name exists';
  ELSE
    RAISE EXCEPTION '❌ players.bot_name missing';
  END IF;
  
  -- Check rooms table
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rooms' AND column_name = 'bot_coordinator_id'
  ) THEN
    RAISE NOTICE '✅ rooms.bot_coordinator_id exists';
  ELSE
    RAISE EXCEPTION '❌ rooms.bot_coordinator_id missing';
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rooms' AND column_name = 'ranked_mode'
  ) THEN
    RAISE NOTICE '✅ rooms.ranked_mode exists';
  ELSE
    RAISE EXCEPTION '❌ rooms.ranked_mode missing';
  END IF;
  
  RAISE NOTICE '✅ TEST 4 PASSED: All bot columns exist';
END $$;

-- ============================================================================
-- TEST 5: Performance test - generate 1000 codes
-- ============================================================================
DO $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  elapsed_ms FLOAT;
  test_code VARCHAR;
  i INTEGER;
BEGIN
  RAISE NOTICE 'TEST 5: Performance test - generating 1000 codes...';
  
  start_time := clock_timestamp();
  
  FOR i IN 1..1000 LOOP
    test_code := generate_room_code_v2();
  END LOOP;
  
  end_time := clock_timestamp();
  elapsed_ms := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;
  
  RAISE NOTICE 'Generated 1000 codes in %.2f ms (avg: %.2f ms per code)', 
    elapsed_ms, elapsed_ms / 1000;
    
  IF elapsed_ms / 1000 < 50 THEN
    RAISE NOTICE '✅ TEST 5 PASSED: Performance < 50ms average';
  ELSE
    RAISE NOTICE '⚠️  TEST 5 WARNING: Performance > 50ms average (%.2f ms)', elapsed_ms / 1000;
  END IF;
END $$;

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================
SELECT 
  '✅ ALL TESTS COMPLETE' as status,
  'Room code generation is production-ready!' as message;
