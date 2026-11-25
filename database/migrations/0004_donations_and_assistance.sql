-- Up Migration

-- ---------------------------------------------------------------------------
-- Donations (actual, donor-confirmed food; never created from a prediction)
-- ---------------------------------------------------------------------------
CREATE TABLE donations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id              uuid NOT NULL REFERENCES donors (id),
  origin                text NOT NULL DEFAULT 'DIRECT_LISTING' CHECK (origin IN ('DIRECT_LISTING', 'ASSISTANCE_OFFER')),
  food_name             text NOT NULL CHECK (length(food_name) BETWEEN 2 AND 120),
  category_id           uuid NOT NULL REFERENCES food_categories (id),
  dietary_type          text NOT NULL CHECK (dietary_type IN ('VEG', 'NON_VEG')),
  quantity              integer NOT NULL CHECK (quantity > 0 AND quantity <= 100000),
  unit                  text NOT NULL CHECK (unit IN ('MEALS', 'PACKETS', 'BOXES')),
  reserved_quantity     integer NOT NULL DEFAULT 0,
  expired_quantity      integer NOT NULL DEFAULT 0 CHECK (expired_quantity >= 0),
  prepared_at           timestamptz NOT NULL,
  best_before           timestamptz,
  storage_type          text NOT NULL CHECK (storage_type IN ('ROOM_TEMPERATURE', 'REFRIGERATED', 'FROZEN', 'HOT_HELD')),
  storage_notes         text CHECK (length(storage_notes) <= 500),
  pickup_available_from timestamptz NOT NULL,
  pickup_deadline       timestamptz NOT NULL,
  location              geography(Point, 4326) NOT NULL,
  address               text NOT NULL CHECK (length(address) BETWEEN 5 AND 300),
  description           text CHECK (length(description) <= 2000),
  safety_confirmed      boolean NOT NULL DEFAULT false,
  safety_confirmed_at   timestamptz,
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                          'DRAFT', 'AVAILABLE', 'PARTIALLY_RESERVED', 'RESERVED', 'PICKUP_ASSIGNED', 'PICKED_UP',
                          'IN_TRANSIT', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'DISPUTED')),
  cancelled_reason      text CHECK (length(cancelled_reason) <= 500),
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  -- Over-allocation backstop: whatever the application does, reserved can never exceed quantity.
  CONSTRAINT donations_reserved_range CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity),
  CONSTRAINT donations_pickup_window CHECK (pickup_deadline > pickup_available_from),
  CONSTRAINT donations_deadline_after_preparation CHECK (pickup_deadline > prepared_at),
  CONSTRAINT donations_safety_confirmed CHECK (status = 'DRAFT' OR (safety_confirmed AND safety_confirmed_at IS NOT NULL))
);
CREATE INDEX idx_donations__open_location ON donations USING gist (location)
  WHERE status IN ('AVAILABLE', 'PARTIALLY_RESERVED') AND deleted_at IS NULL;
CREATE INDEX idx_donations__donor ON donations (donor_id, created_at DESC);
CREATE INDEX idx_donations__status_deadline ON donations (status, pickup_deadline);
CREATE TRIGGER trg_donations_updated_at BEFORE UPDATE ON donations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE donation_status_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  donation_id uuid NOT NULL REFERENCES donations (id),
  from_status text,
  to_status   text NOT NULL,
  changed_by  uuid REFERENCES users (id),
  reason      text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_donation_status_history__donation ON donation_status_history (donation_id, created_at);
CREATE TRIGGER trg_donation_status_history_append_only BEFORE UPDATE OR DELETE ON donation_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE donation_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id        uuid NOT NULL REFERENCES donations (id),
  ngo_id             uuid NOT NULL REFERENCES ngos (id),
  requested_by       uuid NOT NULL REFERENCES users (id),
  requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
  approved_quantity  integer,
  message            text CHECK (length(message) <= 1000),
  status             text NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED', 'EXPIRED')),
  decided_by         uuid REFERENCES users (id),
  decided_at         timestamptz,
  decision_reason    text CHECK (length(decision_reason) <= 500),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT donation_requests_approved_range
    CHECK (approved_quantity IS NULL OR (approved_quantity > 0 AND approved_quantity <= requested_quantity)),
  CONSTRAINT donation_requests_approved_has_quantity CHECK (status <> 'APPROVED' OR approved_quantity IS NOT NULL)
);
-- One live request per NGO per donation.
CREATE UNIQUE INDEX uq_donation_requests__active ON donation_requests (donation_id, ngo_id)
  WHERE status IN ('PENDING', 'APPROVED');
CREATE INDEX idx_donation_requests__ngo ON donation_requests (ngo_id, created_at DESC);
CREATE TRIGGER trg_donation_requests_updated_at BEFORE UPDATE ON donation_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- NGO assistance requests and donor offers
-- ---------------------------------------------------------------------------
CREATE TABLE food_assistance_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_id                  uuid NOT NULL REFERENCES ngos (id),
  created_by              uuid NOT NULL REFERENCES users (id),
  category_id             uuid NOT NULL REFERENCES food_categories (id),
  dietary_requirement     text NOT NULL CHECK (dietary_requirement IN ('VEG_ONLY', 'ANY')),
  quantity_required       integer NOT NULL CHECK (quantity_required > 0 AND quantity_required <= 100000),
  unit                    text NOT NULL CHECK (unit IN ('MEALS', 'PACKETS', 'BOXES')),
  quantity_committed      integer NOT NULL DEFAULT 0,
  quantity_received       integer NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  needed_from             timestamptz NOT NULL,
  needed_until            timestamptz NOT NULL,
  location                geography(Point, 4326) NOT NULL,
  address                 text NOT NULL CHECK (length(address) BETWEEN 5 AND 300),
  urgency                 text NOT NULL CHECK (urgency IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  beneficiaries_count     integer NOT NULL CHECK (beneficiaries_count > 0),
  reason                  text CHECK (length(reason) <= 1000),
  additional_requirements text CHECK (length(additional_requirements) <= 1000),
  status                  text NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN ('OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'EXPIRED')),
  version                 integer NOT NULL DEFAULT 1,
  cancelled_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  -- Over-commitment backstop.
  CONSTRAINT fars_committed_range CHECK (quantity_committed >= 0 AND quantity_committed <= quantity_required),
  CONSTRAINT fars_window CHECK (needed_until > needed_from)
);
CREATE INDEX idx_fars__open_location ON food_assistance_requests USING gist (location)
  WHERE status IN ('OPEN', 'PARTIALLY_FULFILLED') AND deleted_at IS NULL;
CREATE INDEX idx_fars__ngo ON food_assistance_requests (ngo_id, created_at DESC);
CREATE INDEX idx_fars__status_until ON food_assistance_requests (status, needed_until);
CREATE TRIGGER trg_fars_updated_at BEFORE UPDATE ON food_assistance_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE assistance_offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistance_request_id uuid NOT NULL REFERENCES food_assistance_requests (id),
  donor_id              uuid NOT NULL REFERENCES donors (id),
  created_by            uuid NOT NULL REFERENCES users (id),
  offered_quantity      integer NOT NULL CHECK (offered_quantity > 0),
  accepted_quantity     integer,
  confirmed_quantity    integer,
  food_name             text NOT NULL CHECK (length(food_name) BETWEEN 2 AND 120),
  category_id           uuid NOT NULL REFERENCES food_categories (id),
  dietary_type          text NOT NULL CHECK (dietary_type IN ('VEG', 'NON_VEG')),
  pickup_available_from timestamptz NOT NULL,
  pickup_deadline       timestamptz NOT NULL,
  location              geography(Point, 4326) NOT NULL,
  address               text NOT NULL CHECK (length(address) BETWEEN 5 AND 300),
  notes                 text CHECK (length(notes) <= 1000),
  status                text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN (
                          'PROPOSED', 'ACCEPTED', 'REJECTED', 'RESERVED', 'PICKUP_ASSIGNED', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
  donation_id           uuid REFERENCES donations (id),
  responded_by          uuid REFERENCES users (id),
  responded_at          timestamptz,
  rejection_reason      text CHECK (length(rejection_reason) <= 500),
  cancelled_by          uuid REFERENCES users (id),
  cancel_reason         text CHECK (length(cancel_reason) <= 500),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistance_offers_accepted_range
    CHECK (accepted_quantity IS NULL OR (accepted_quantity > 0 AND accepted_quantity <= offered_quantity)),
  CONSTRAINT assistance_offers_confirmed_range
    CHECK (confirmed_quantity IS NULL OR (accepted_quantity IS NOT NULL AND confirmed_quantity > 0 AND confirmed_quantity <= accepted_quantity)),
  CONSTRAINT assistance_offers_window CHECK (pickup_deadline > pickup_available_from),
  CONSTRAINT uq_assistance_offers__donation UNIQUE (donation_id)
);
-- One live offer per donor per request.
CREATE UNIQUE INDEX uq_assistance_offers__active ON assistance_offers (assistance_request_id, donor_id)
  WHERE status IN ('PROPOSED', 'ACCEPTED', 'RESERVED', 'PICKUP_ASSIGNED');
CREATE INDEX idx_assistance_offers__donor ON assistance_offers (donor_id, created_at DESC);
CREATE TRIGGER trg_assistance_offers_updated_at BEFORE UPDATE ON assistance_offers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE assistance_request_history (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assistance_request_id uuid NOT NULL REFERENCES food_assistance_requests (id),
  assistance_offer_id   uuid REFERENCES assistance_offers (id),
  event_type            text NOT NULL,
  from_status           text,
  to_status             text,
  quantity_delta        integer,
  actor_user_id         uuid REFERENCES users (id),
  metadata              jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_assistance_request_history__request ON assistance_request_history (assistance_request_id, created_at);
CREATE TRIGGER trg_assistance_request_history_append_only BEFORE UPDATE OR DELETE ON assistance_request_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Allocations: the unit of collection for both workflows
-- ---------------------------------------------------------------------------
CREATE TABLE donation_allocations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id          uuid NOT NULL REFERENCES donations (id),
  ngo_id               uuid NOT NULL REFERENCES ngos (id),
  quantity             integer NOT NULL CHECK (quantity > 0),
  source               text NOT NULL CHECK (source IN ('DONATION_REQUEST', 'ASSISTANCE_OFFER')),
  donation_request_id  uuid REFERENCES donation_requests (id),
  assistance_offer_id  uuid REFERENCES assistance_offers (id),
  status               text NOT NULL DEFAULT 'RESERVED' CHECK (status IN (
                         'RESERVED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED')),
  handed_over_quantity integer CHECK (handed_over_quantity >= 0),
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text CHECK (length(cancel_reason) <= 500),
  -- Who ended the allocation; used for reliability scoring (a donor cancellation is not the NGO's failure).
  cancelled_by_party   text CHECK (cancelled_by_party IN ('DONOR', 'NGO', 'ADMIN', 'SYSTEM')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT donation_allocations_source_ref CHECK (
    num_nonnulls(donation_request_id, assistance_offer_id) = 1
    AND (source = 'DONATION_REQUEST') = (donation_request_id IS NOT NULL)
    AND (source = 'ASSISTANCE_OFFER') = (assistance_offer_id IS NOT NULL)),
  CONSTRAINT donation_allocations_handover_range CHECK (handed_over_quantity IS NULL OR handed_over_quantity <= quantity),
  -- Unique source references make double approval / double reservation impossible.
  CONSTRAINT uq_donation_allocations__request UNIQUE (donation_request_id),
  CONSTRAINT uq_donation_allocations__offer UNIQUE (assistance_offer_id)
);
CREATE INDEX idx_donation_allocations__donation ON donation_allocations (donation_id);
CREATE INDEX idx_donation_allocations__ngo ON donation_allocations (ngo_id, status);
CREATE TRIGGER trg_donation_allocations_updated_at BEFORE UPDATE ON donation_allocations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS donation_allocations;
DROP TABLE IF EXISTS assistance_request_history;
DROP TABLE IF EXISTS assistance_offers;
DROP TABLE IF EXISTS food_assistance_requests;
DROP TABLE IF EXISTS donation_requests;
DROP TABLE IF EXISTS donation_status_history;
DROP TABLE IF EXISTS donations;
