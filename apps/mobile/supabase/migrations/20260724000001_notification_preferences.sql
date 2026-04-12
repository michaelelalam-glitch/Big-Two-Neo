-- P12-H1: Add server-side notification preferences to profiles table.
-- Allows send-push-notification EF to respect user opt-out settings.
-- Default TRUE (opt-in) matches the client-side defaults in userPreferencesSlice.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notify_game_invites    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_your_turn       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_game_started    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_friend_requests BOOLEAN NOT NULL DEFAULT TRUE;

-- Allow users to read/update their own notification preferences.
-- The existing "Users can update own profile" RLS policy already covers UPDATEs
-- and "Public profiles are viewable by everyone" covers SELECTs, so no new
-- policies are needed.

COMMENT ON COLUMN profiles.notify_game_invites    IS 'User preference: receive push notifications for game invites';
COMMENT ON COLUMN profiles.notify_your_turn       IS 'User preference: receive push notifications when it is your turn';
COMMENT ON COLUMN profiles.notify_game_started    IS 'User preference: receive push notifications when a game starts';
COMMENT ON COLUMN profiles.notify_friend_requests IS 'User preference: receive push notifications for friend requests';
