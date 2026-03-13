-- ============================================================================
-- TASK CLEANUP SQL - Execute Immediately
-- Generated: 2025-12-31
-- Purpose: Clean up tasks 495-584 based on audit findings
-- ============================================================================

-- ============================================================================
-- ACTION 1: Mark PR #66 tasks as COMPLETED
-- Reason: PR #66 has been merged to dev branch (commit cd823a0)
-- ============================================================================

UPDATE tasks 
SET 
    status = 'completed', 
    updated_at = NOW(),
    success_rate = 1.0
WHERE id IN (584, 583, 570);

-- Verification query:
SELECT id, title, status, priority, domain FROM tasks WHERE id IN (584, 583, 570);

-- Expected result:
-- 584 | Fix stats not saving to Supabase database | completed | critical | backend
-- 583 | Sync scoreboard player order with table seating layout | completed | high | frontend
-- 570 | [WEEK 2] Split GameScreen component (1357 lines → 200) | completed | high | frontend


-- ============================================================================
-- ACTION 2: Resolve DUPLICATE TASK 533
-- Decision: Mark as COMPLETED (duplicate of Task 502 which is already completed)
-- ============================================================================

-- Option A: Mark as completed (recommended if testing was actually done)
UPDATE tasks 
SET 
    status = 'completed', 
    updated_at = NOW(),
    success_rate = 1.0
WHERE id = 533;

-- Option B: Delete duplicate (if you're sure it's a duplicate)
-- DELETE FROM tasks WHERE id = 533;

-- Verification query:
SELECT id, title, status, priority, domain FROM tasks WHERE id IN (502, 533);

-- Expected result after Option A:
-- 502 | Phase 1.5K: End-to-end device testing (2+2, 3+1 games) | completed | critical | testing
-- 533 | Phase 1.5K: End-to-end device testing | completed | critical | testing


-- ============================================================================
-- OPTIONAL: Archive old completed tasks (older than 30 days)
-- This keeps dashboard clean without losing data
-- ============================================================================

-- Add 'archived' flag if column exists, or use a tag
-- UPDATE tasks 
-- SET archived = true 
-- WHERE status = 'completed' 
--   AND updated_at < NOW() - INTERVAL '30 days'
--   AND id BETWEEN 475 AND 500;


-- ============================================================================
-- VERIFICATION: Check overall task health after cleanup
-- ============================================================================

SELECT 
    status,
    COUNT(*) as task_count,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM tasks WHERE id BETWEEN 495 AND 584), 2) as percentage
FROM tasks 
WHERE id BETWEEN 495 AND 584
GROUP BY status
ORDER BY 
    CASE status
        WHEN 'in_progress' THEN 1
        WHEN 'in_review' THEN 2
        WHEN 'todo' THEN 3
        WHEN 'completed' THEN 4
        ELSE 5
    END;

-- Expected result after cleanup:
-- in_progress | 0 | 0%
-- in_review | 0 | 0%
-- todo | 29 | 32%
-- completed | 61 | 68%


-- ============================================================================
-- FINAL CHECK: Identify next priority tasks
-- ============================================================================

SELECT 
    id,
    title,
    priority,
    domain,
    status
FROM tasks 
WHERE 
    id BETWEEN 495 AND 584
    AND status = 'todo'
    AND priority IN ('critical', 'high')
ORDER BY 
    CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        ELSE 3
    END,
    id ASC
LIMIT 10;

-- This shows the top 10 high-priority tasks to tackle next
