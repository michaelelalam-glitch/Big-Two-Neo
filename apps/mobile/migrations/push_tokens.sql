-- Migration: Add push_tokens table for storing device push notification tokens
-- Purpose: Enable push notifications for game events, invites, and turn notifications

-- Create push_tokens table
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  push_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_user_token UNIQUE (user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_platform ON push_tokens(platform);

-- Enable RLS
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only read their own push tokens
CREATE POLICY "Users can view own push tokens"
  ON push_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own push tokens
CREATE POLICY "Users can insert own push tokens"
  ON push_tokens
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own push tokens
CREATE POLICY "Users can update own push tokens"
  ON push_tokens
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own push tokens
CREATE POLICY "Users can delete own push tokens"
  ON push_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_push_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER push_tokens_updated_at
  BEFORE UPDATE ON push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_push_tokens_updated_at();

-- Comment on table and columns
COMMENT ON TABLE push_tokens IS 'Stores Expo push notification tokens for each user';
COMMENT ON COLUMN push_tokens.id IS 'Primary key';
COMMENT ON COLUMN push_tokens.user_id IS 'Foreign key to auth.users';
COMMENT ON COLUMN push_tokens.push_token IS 'Expo push token (format: ExponentPushToken[xxx])';
COMMENT ON COLUMN push_tokens.platform IS 'Device platform: ios, android, or web';
COMMENT ON COLUMN push_tokens.created_at IS 'When the token was first registered';
COMMENT ON COLUMN push_tokens.updated_at IS 'When the token was last updated';
