-- Up Migration
CREATE TABLE pickup_assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id         uuid NOT NULL REFERENCES donation_allocations (id),
  ngo_id                uuid NOT NULL REFERENCES ngos (id),
  representative_id     uuid NOT NULL REFERENCES ngo_representatives (id),
  assigned_by           uuid NOT NULL REFERENCES users (id),
  status                text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN (
                          'ASSIGNED', 'EN_ROUTE', 'VERIFIED', 'HANDED_OVER', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED', 'CANCELLED', 'FAILED')),
  scheduled_pickup_at   timestamptz,
  destination_location  geography(Point, 4326),
  destination_address   text CHECK (length(destination_address) <= 300),
  qr_verified_at        timestamptz,
  otp_verified_at       timestamptz,
  identity_confirmed_at timestamptz,
  handed_over_at        timestamptz,
  delivered_at          timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text CHECK (length(cancel_reason) <= 500),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pickup_assignments_verified_requires_checks CHECK (
    status NOT IN ('VERIFIED', 'HANDED_OVER', 'IN_TRANSIT', 'DELIVERED')
    OR (qr_verified_at IS NOT NULL AND otp_verified_at IS NOT NULL AND identity_confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_pickup_assignments__active ON pickup_assignments (allocation_id)
  WHERE status NOT IN ('CANCELLED', 'FAILED');
CREATE INDEX idx_pickup_assignments__representative ON pickup_assignments (representative_id, status);
CREATE INDEX idx_pickup_assignments__ngo ON pickup_assignments (ngo_id, created_at DESC);
CREATE TRIGGER trg_pickup_assignments_updated_at BEFORE UPDATE ON pickup_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE pickup_tokens (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_assignment_id uuid NOT NULL REFERENCES pickup_assignments (id),
  token_hash           text NOT NULL,
  expires_at           timestamptz NOT NULL,
  consumed_at          timestamptz,
  consumed_by          uuid REFERENCES users (id),
  revoked_at           timestamptz,
  created_by           uuid NOT NULL REFERENCES users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pickup_tokens__hash UNIQUE (token_hash)
);
CREATE UNIQUE INDEX uq_pickup_tokens__live ON pickup_tokens (pickup_assignment_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

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

CREATE TABLE pickup_verifications (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pickup_assignment_id uuid REFERENCES pickup_assignments (id),
  method               text NOT NULL CHECK (method IN ('QR', 'OTP', 'IDENTITY_CHECK')),
  result               text NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE')),
  failure_reason       text CHECK (failure_reason IN (
                         'TOKEN_NOT_FOUND', 'TOKEN_EXPIRED', 'TOKEN_CONSUMED', 'TOKEN_REVOKED', 'WRONG_DONOR',
                         'REPRESENTATIVE_INACTIVE', 'PICKUP_NOT_ACTIVE', 'OTP_INVALID', 'OTP_EXPIRED',
                         'OTP_ATTEMPTS_EXCEEDED', 'OTP_NOT_REQUESTED', 'QR_NOT_VERIFIED', 'RATE_LIMITED')),
  actor_user_id        uuid REFERENCES users (id),
  ip                   inet,
  user_agent           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pickup_verifications_reason CHECK ((result = 'FAILURE') = (failure_reason IS NOT NULL))
);
CREATE INDEX idx_pickup_verifications__assignment ON pickup_verifications (pickup_assignment_id, created_at);
CREATE INDEX idx_pickup_verifications__created ON pickup_verifications (created_at DESC);
CREATE TRIGGER trg_pickup_verifications_append_only BEFORE UPDATE OR DELETE ON pickup_verifications
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE handover_records (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_assignment_id     uuid NOT NULL REFERENCES pickup_assignments (id),
  allocation_id            uuid NOT NULL REFERENCES donation_allocations (id),
  donor_confirmed_quantity integer CHECK (donor_confirmed_quantity >= 0),
  donor_confirmed_by       uuid REFERENCES users (id),
  donor_confirmed_at       timestamptz,
  ngo_received_quantity    integer CHECK (ngo_received_quantity >= 0),
  ngo_confirmed_by         uuid REFERENCES users (id),
  ngo_confirmed_at         timestamptz,
  status                   text NOT NULL CHECK (status IN ('PENDING_DONOR', 'PENDING_NGO', 'CONFIRMED', 'DISPUTED')),
  notes                    text CHECK (length(notes) <= 1000),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_handover_records__assignment UNIQUE (pickup_assignment_id),
  -- Both IS NOT NULL tests are required: a NULL comparison would make the CHECK pass.
  CONSTRAINT handover_records_confirmed_match CHECK (
    status <> 'CONFIRMED'
    OR (donor_confirmed_quantity IS NOT NULL AND ngo_received_quantity IS NOT NULL
        AND donor_confirmed_quantity = ngo_received_quantity AND donor_confirmed_quantity > 0))
);
CREATE INDEX idx_handover_records__allocation ON handover_records (allocation_id);
CREATE TRIGGER trg_handover_records_updated_at BEFORE UPDATE ON handover_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE delivery_confirmations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_assignment_id uuid NOT NULL REFERENCES pickup_assignments (id),
  delivered_quantity   integer NOT NULL CHECK (delivered_quantity >= 0),
  confirmed_by         uuid NOT NULL REFERENCES users (id),
  confirmed_at         timestamptz NOT NULL DEFAULT now(),
  destination_location geography(Point, 4326),
  beneficiaries_served integer CHECK (beneficiaries_served >= 0),
  distribution_notes   text CHECK (length(distribution_notes) <= 1000),
  CONSTRAINT uq_delivery_confirmations__assignment UNIQUE (pickup_assignment_id)
);

CREATE TABLE disputes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id        uuid NOT NULL REFERENCES donation_allocations (id),
  pickup_assignment_id uuid REFERENCES pickup_assignments (id),
  handover_record_id   uuid REFERENCES handover_records (id),
  raised_by            uuid REFERENCES users (id),
  type                 text NOT NULL CHECK (type IN ('QUANTITY_MISMATCH', 'NO_SHOW', 'UNAUTHORISED_PICKUP', 'FOOD_CONDITION', 'OTHER')),
  description          text NOT NULL CHECK (length(description) BETWEEN 3 AND 2000),
  status               text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED')),
  resolution           text CHECK (length(resolution) <= 2000),
  resolved_quantity    integer CHECK (resolved_quantity >= 0),
  resolved_by          uuid REFERENCES users (id),
  resolved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_disputes__status ON disputes (status, created_at DESC);
CREATE UNIQUE INDEX uq_disputes__open_handover ON disputes (handover_record_id)
  WHERE status IN ('OPEN', 'UNDER_REVIEW') AND handover_record_id IS NOT NULL;
CREATE TRIGGER trg_disputes_updated_at BEFORE UPDATE ON disputes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS disputes;
DROP TABLE IF EXISTS delivery_confirmations;
DROP TABLE IF EXISTS handover_records;
DROP TABLE IF EXISTS pickup_verifications;
DROP TABLE IF EXISTS otp_verifications;
DROP TABLE IF EXISTS pickup_tokens;
DROP TABLE IF EXISTS pickup_assignments;
