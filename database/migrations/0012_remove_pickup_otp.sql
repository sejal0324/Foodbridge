-- Up Migration
-- The product owner removed the OTP step from pickup verification (2026-11-04).
-- Verification is now: the donor verifies the representative's QR pass, then
-- ticks the photo-ID check (pickup becomes VERIFIED), then the two-way handover
-- confirmation. This drops the OTP table, the OTP-only column and the OTP
-- policy setting. pickup_verifications is left unchanged: its CHECKs still
-- accept method 'OTP' (and the OTP failure reasons) so historical log rows stay
-- valid; new rows are only QR or IDENTITY_CHECK.
DELETE FROM platform_settings WHERE key = 'otp.policy';

DROP TABLE otp_verifications;

ALTER TABLE pickup_assignments DROP CONSTRAINT pickup_assignments_verified_requires_checks;
ALTER TABLE pickup_assignments DROP COLUMN otp_verified_at;
ALTER TABLE pickup_assignments ADD CONSTRAINT pickup_assignments_verified_requires_checks CHECK (
  status NOT IN ('VERIFIED', 'HANDED_OVER', 'IN_TRANSIT', 'DELIVERED')
  OR (qr_verified_at IS NOT NULL AND identity_confirmed_at IS NOT NULL));

-- Down Migration
-- Recreates the OTP schema exactly as defined in 0007 and 0011. The column is
-- re-added at the end of the table (PostgreSQL cannot restore column order).
-- Pickups verified after the OTP step was removed have no OTP timestamp; they
-- get otp_verified_at = identity_confirmed_at so the original CHECK holds. The
-- updated_at trigger is suspended for that backfill so updated_at is preserved.
ALTER TABLE pickup_assignments DROP CONSTRAINT pickup_assignments_verified_requires_checks;
ALTER TABLE pickup_assignments ADD COLUMN otp_verified_at timestamptz;
ALTER TABLE pickup_assignments DISABLE TRIGGER trg_pickup_assignments_updated_at;
UPDATE pickup_assignments SET otp_verified_at = identity_confirmed_at WHERE identity_confirmed_at IS NOT NULL;
ALTER TABLE pickup_assignments ENABLE TRIGGER trg_pickup_assignments_updated_at;
ALTER TABLE pickup_assignments ADD CONSTRAINT pickup_assignments_verified_requires_checks CHECK (
  status NOT IN ('VERIFIED', 'HANDED_OVER', 'IN_TRANSIT', 'DELIVERED')
  OR (qr_verified_at IS NOT NULL AND otp_verified_at IS NOT NULL AND identity_confirmed_at IS NOT NULL));

CREATE TABLE otp_verifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_assignment_id uuid NOT NULL REFERENCES pickup_assignments (id),
  recipient_user_id    uuid NOT NULL REFERENCES users (id),
  channel              text NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'DEV_LOG')),
  otp_hash             text NOT NULL,
  expires_at           timestamptz NOT NULL,
  attempt_count        smallint NOT NULL DEFAULT 0,
  max_attempts         smallint NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  delivery_status      text NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED')),
  delivery_error       text,
  verified_at          timestamptz,
  invalidated_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_verifications_attempts CHECK (attempt_count >= 0 AND attempt_count <= max_attempts)
);
CREATE UNIQUE INDEX uq_otp_verifications__live ON otp_verifications (pickup_assignment_id)
  WHERE verified_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX idx_otp_verifications__assignment ON otp_verifications (pickup_assignment_id, created_at);

INSERT INTO platform_settings (key, value, description) VALUES
  ('otp.policy', '{"ttl_minutes":10,"max_attempts":5,"max_sends":3,"resend_cooldown_seconds":60}', 'Pickup OTP policy')
ON CONFLICT (key) DO NOTHING;
