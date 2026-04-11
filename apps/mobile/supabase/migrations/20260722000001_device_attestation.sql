-- P10-4: Device Attestation Table
-- Tracks Google Play Integrity / Apple App Attest verification results per device.
-- The verify-attestation Edge Function returns a verdict (passed/failed) to the client.
-- High-risk server operations may query this table to check prior attestation status.
-- Note: Android (Play Integrity) persistence to this table is implemented in Step 1.
-- iOS (App Attest) persistence is a future extension pending Step 2 implementation.

CREATE TABLE IF NOT EXISTS device_attestation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id       text NOT NULL,            -- client-generated stable device identifier
  platform        text NOT NULL CHECK (platform IN ('ios', 'android')),
  attestation_type text NOT NULL CHECK (attestation_type IN ('app_attest', 'play_integrity', 'device_check')),
  is_verified     boolean NOT NULL DEFAULT false,
  risk_verdict    text,                     -- 'MEETS_DEVICE_INTEGRITY', 'MEETS_BASIC_INTEGRITY', etc.
  verdict_raw     jsonb,                    -- full verdict payload for auditing
  verified_at     timestamptz,
  expires_at      timestamptz,              -- re-verify after this time
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one row per user+device combination
CREATE UNIQUE INDEX IF NOT EXISTS device_attestation_user_device_idx
  ON device_attestation (user_id, device_id);

-- Index for looking up by user_id quickly
CREATE INDEX IF NOT EXISTS device_attestation_user_id_idx
  ON device_attestation (user_id);

-- Index for expiration sweeps
CREATE INDEX IF NOT EXISTS device_attestation_expires_at_idx
  ON device_attestation (expires_at)
  WHERE expires_at IS NOT NULL;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_device_attestation_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS device_attestation_updated_at ON device_attestation;
CREATE TRIGGER device_attestation_updated_at
  BEFORE UPDATE ON device_attestation
  FOR EACH ROW EXECUTE FUNCTION update_device_attestation_updated_at();

-- RLS: users can only read their own attestation records; only service role can write
ALTER TABLE device_attestation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own attestation"
  ON device_attestation FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service-role writes are allowed via BYPASS RLS (no INSERT/UPDATE policy needed for client)
-- Edge Functions use service-role key to write attestation results

COMMENT ON TABLE device_attestation IS
  'P10-4: Tracks Google Play Integrity / Apple App Attest verification results. '
  'Written by the verify-attestation Edge Function. '
  'Android (Play Integrity) token validation and persistence are implemented (Step 1). '
  'iOS (App Attest) assertion verification and persistence are pending (Step 2).';
