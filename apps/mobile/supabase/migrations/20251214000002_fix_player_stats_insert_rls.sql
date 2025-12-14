-- ============================================
-- FIX: Player Stats RLS Blocking OAuth Signup
-- ============================================
-- This migration fixes the RLS policy on player_stats that was blocking
-- the auto_create_player_stats() trigger during OAuth signup.
--
-- ROOT CAUSE:
-- The "Users can insert own stats" policy checks auth.uid() = user_id,
-- but during OAuth signup, the trigger runs in a context where auth.uid()
-- is not properly set, causing the insert to fail.
--
-- SOLUTION:
-- Add a service_role INSERT policy to allow the SECURITY DEFINER trigger
-- to bypass the user auth check.

-- Add service_role INSERT policy for player_stats
-- This allows the auto_create_player_stats() trigger to work during OAuth signup
CREATE POLICY "Service role can insert player stats" ON player_stats
  FOR INSERT TO service_role WITH CHECK (true);

-- Verification: Check all policies on player_stats
-- Expected policies:
-- 1. Player stats viewable by everyone (SELECT)
-- 2. Users can insert own stats (INSERT with auth.uid() check)
-- 3. Service role can insert player stats (INSERT for triggers) ← NEW
-- 4. Service role can update player stats (UPDATE)

COMMENT ON POLICY "Service role can insert player stats" ON player_stats IS
  'Allows SECURITY DEFINER triggers (e.g., auto_create_player_stats) to insert player_stats during OAuth signup without being blocked by auth.uid() checks.';

-- ============================================
-- AUDIT TRAIL
-- ============================================
-- Issue: "Database error saving new user" during Google OAuth
-- Error: Missing tokens in OAuth callback
-- Cause: RLS policy blocking player_stats insert in trigger
-- Fix: Add service_role INSERT policy
-- Date: December 14, 2025
