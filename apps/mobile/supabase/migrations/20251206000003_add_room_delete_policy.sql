-- Fix: Add DELETE policy for rooms table
-- Issue: Error 42501 when host tries to leave/delete room
-- Date: December 6, 2025

-- Add DELETE policy for rooms - only host can delete
CREATE POLICY "Host can delete room" ON rooms
  FOR DELETE USING (host_id = auth.uid());
