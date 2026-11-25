-- Up Migration

-- ---------------------------------------------------------------------------
-- Users and sessions
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL CHECK (length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  password_hash         text,
  role                  text NOT NULL CHECK (role IN ('DONOR', 'NGO', 'ADMIN')),
  account_status        text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (account_status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  full_name             text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
  phone                 text CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email_verified_at     timestamptz,
  failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until          timestamptz,
  last_login_at         timestamptz,
  password_changed_at   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT users_password_required CHECK (account_status = 'INVITED' OR password_hash IS NOT NULL)
);
CREATE UNIQUE INDEX uq_users__email ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users__role_status ON users (role, account_status);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id              uuid NOT NULL,
  refresh_token_hash     text NOT NULL,
  expires_at             timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  last_used_at           timestamptz,
  revoked_at             timestamptz,
  revoked_reason         text CHECK (revoked_reason IN ('LOGOUT', 'ROTATED', 'REUSE_DETECTED', 'ADMIN', 'PASSWORD_CHANGED', 'ACCOUNT_SUSPENDED')),
  replaced_by_session_id uuid REFERENCES user_sessions (id),
  ip                     inet,
  user_agent             text,
  CONSTRAINT uq_user_sessions__refresh_token_hash UNIQUE (refresh_token_hash)
);
CREATE INDEX idx_user_sessions__active ON user_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_sessions__family ON user_sessions (family_id);

-- Single-use account tokens (representative invitations, password resets).
CREATE TABLE account_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('INVITE', 'PASSWORD_RESET')),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_account_tokens__token_hash UNIQUE (token_hash)
);
CREATE UNIQUE INDEX uq_account_tokens__live ON account_tokens (user_id, purpose)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE admin_profiles (
  user_id     uuid PRIMARY KEY REFERENCES users (id),
  admin_level text NOT NULL DEFAULT 'ADMIN' CHECK (admin_level IN ('SUPER_ADMIN', 'ADMIN')),
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Foreign keys from Phase 1 tables to users.
ALTER TABLE platform_settings
  ADD CONSTRAINT fk_platform_settings__updated_by FOREIGN KEY (updated_by) REFERENCES users (id);
ALTER TABLE audit_logs
  ADD CONSTRAINT fk_audit_logs__actor_user FOREIGN KEY (actor_user_id) REFERENCES users (id);
ALTER TABLE idempotency_records
  ADD CONSTRAINT fk_idempotency_records__user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
CREATE TABLE food_categories (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        text NOT NULL CHECK (code ~ '^[A-Z][A-Z_]{1,49}$'),
  name                        text NOT NULL,
  description                 text,
  max_hours_after_preparation integer CHECK (max_hours_after_preparation > 0),
  requires_refrigeration      boolean NOT NULL DEFAULT false,
  is_active                   boolean NOT NULL DEFAULT true,
  sort_order                  integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_food_categories__code UNIQUE (code)
);
CREATE TRIGGER trg_food_categories_updated_at BEFORE UPDATE ON food_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- max_hours_after_preparation values are configurable *review flags*, not
-- food-safety certification. Humans remain responsible for safety decisions.
INSERT INTO food_categories (code, name, description, max_hours_after_preparation, requires_refrigeration, sort_order) VALUES
  ('COOKED_MEALS',      'Cooked meals',         'Freshly cooked meals and dishes',           6,    false, 10),
  ('BAKERY',            'Bakery items',         'Bread, buns and baked goods',               24,   false, 20),
  ('FRUITS_VEGETABLES', 'Fruits & vegetables',  'Fresh produce',                             48,   false, 30),
  ('DAIRY',             'Dairy products',       'Milk, curd, paneer and similar',            12,   true,  40),
  ('PACKAGED_FOOD',     'Packaged food',        'Sealed packaged food within its best-before date', NULL, false, 50),
  ('BEVERAGES',         'Beverages',            'Sealed beverages',                          NULL, false, 60),
  ('RAW_INGREDIENTS',   'Raw ingredients',      'Grains, pulses and other uncooked staples', NULL, false, 70);

-- ---------------------------------------------------------------------------
-- Donors
-- ---------------------------------------------------------------------------
CREATE TABLE donors (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id               uuid NOT NULL REFERENCES users (id),
  business_name               text NOT NULL CHECK (length(business_name) BETWEEN 2 AND 160),
  business_type               text NOT NULL
                              CHECK (business_type IN ('RESTAURANT', 'HOTEL', 'CAFETERIA', 'CATERER', 'FOOD_BUSINESS', 'OTHER')),
  license_number              text CHECK (length(license_number) <= 60),
  contact_email               citext,
  contact_phone               text CHECK (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  address_line                text CHECK (length(address_line) <= 300),
  city                        text CHECK (length(city) <= 100),
  state                       text CHECK (length(state) <= 100),
  postal_code                 text CHECK (postal_code ~ '^[0-9A-Za-z -]{3,12}$'),
  country                     char(2) NOT NULL DEFAULT 'IN',
  location                    geography(Point, 4326),
  timezone                    text NOT NULL DEFAULT 'Asia/Kolkata',
  verification_status         text NOT NULL DEFAULT 'PENDING'
                              CHECK (verification_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  verification_notes          text,
  verified_at                 timestamptz,
  verified_by                 uuid REFERENCES users (id),
  accepts_assistance_requests boolean NOT NULL DEFAULT true,
  paused_until                timestamptz,
  public_recognition_consent  boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_at                  timestamptz,
  CONSTRAINT uq_donors__owner_user UNIQUE (owner_user_id)
);
CREATE INDEX idx_donors__location ON donors USING gist (location);
CREATE INDEX idx_donors__verification ON donors (verification_status);
CREATE TRIGGER trg_donors_updated_at BEFORE UPDATE ON donors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE donor_availability (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id        uuid NOT NULL REFERENCES donors (id) ON DELETE CASCADE,
  iso_day_of_week smallint NOT NULL CHECK (iso_day_of_week BETWEEN 1 AND 7),
  opens_at        time NOT NULL,
  closes_at       time NOT NULL,
  CONSTRAINT donor_availability_window CHECK (closes_at > opens_at),
  CONSTRAINT uq_donor_availability__slot UNIQUE (donor_id, iso_day_of_week, opens_at)
);

CREATE TABLE donor_food_categories (
  donor_id    uuid NOT NULL REFERENCES donors (id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES food_categories (id),
  PRIMARY KEY (donor_id, category_id)
);

-- ---------------------------------------------------------------------------
-- NGOs
-- ---------------------------------------------------------------------------
CREATE TABLE ngos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id            uuid NOT NULL REFERENCES users (id),
  organization_name        text NOT NULL CHECK (length(organization_name) BETWEEN 2 AND 160),
  registration_number      text CHECK (length(registration_number) <= 60),
  contact_email            citext,
  contact_phone            text CHECK (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  address_line             text CHECK (length(address_line) <= 300),
  city                     text CHECK (length(city) <= 100),
  state                    text CHECK (length(state) <= 100),
  postal_code              text CHECK (postal_code ~ '^[0-9A-Za-z -]{3,12}$'),
  country                  char(2) NOT NULL DEFAULT 'IN',
  location                 geography(Point, 4326),
  timezone                 text NOT NULL DEFAULT 'Asia/Kolkata',
  accepts_veg              boolean NOT NULL DEFAULT true,
  accepts_non_veg          boolean NOT NULL DEFAULT false,
  max_daily_capacity       integer NOT NULL DEFAULT 100 CHECK (max_daily_capacity > 0 AND max_daily_capacity <= 100000),
  collection_radius_km     numeric(6, 2) NOT NULL DEFAULT 10 CHECK (collection_radius_km > 0 AND collection_radius_km <= 100),
  beneficiaries_count      integer NOT NULL DEFAULT 0 CHECK (beneficiaries_count >= 0),
  beneficiary_description  text CHECK (length(beneficiary_description) <= 1000),
  has_refrigeration        boolean NOT NULL DEFAULT false,
  default_vehicle_capacity integer CHECK (default_vehicle_capacity > 0),
  verification_status      text NOT NULL DEFAULT 'PENDING'
                           CHECK (verification_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  verification_notes       text,
  verified_at              timestamptz,
  verified_by              uuid REFERENCES users (id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz,
  CONSTRAINT uq_ngos__owner_user UNIQUE (owner_user_id),
  CONSTRAINT ngos_accepts_some_diet CHECK (accepts_veg OR accepts_non_veg)
);
CREATE INDEX idx_ngos__location ON ngos USING gist (location);
CREATE INDEX idx_ngos__verification ON ngos (verification_status);
CREATE TRIGGER trg_ngos_updated_at BEFORE UPDATE ON ngos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ngo_food_preferences (
  ngo_id      uuid NOT NULL REFERENCES ngos (id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES food_categories (id),
  PRIMARY KEY (ngo_id, category_id)
);

CREATE TABLE ngo_representatives (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_id            uuid NOT NULL REFERENCES ngos (id),
  user_id           uuid NOT NULL REFERENCES users (id),
  id_document_type  text NOT NULL CHECK (id_document_type IN ('AADHAAR', 'PAN', 'DRIVING_LICENCE', 'VOTER_ID', 'OTHER')),
  id_document_last4 char(4) NOT NULL CHECK (id_document_last4 ~ '^[0-9A-Za-z]{4}$'),
  photo_storage_key text,
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'REVOKED')),
  added_by          uuid NOT NULL REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT uq_ngo_representatives__user UNIQUE (user_id)
);
CREATE INDEX idx_ngo_representatives__ngo ON ngo_representatives (ngo_id, status);
CREATE TRIGGER trg_ngo_representatives_updated_at BEFORE UPDATE ON ngo_representatives
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE verification_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id          uuid REFERENCES donors (id),
  ngo_id            uuid REFERENCES ngos (id),
  document_type     text NOT NULL CHECK (document_type IN ('BUSINESS_LICENCE', 'FSSAI_LICENCE', 'NGO_REGISTRATION', 'TAX_EXEMPTION', 'ID_PROOF', 'OTHER')),
  storage_key       text NOT NULL,
  original_filename text NOT NULL CHECK (length(original_filename) <= 255),
  mime_type         text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes        integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256            char(64) NOT NULL,
  status            text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  review_notes      text,
  reviewed_by       uuid REFERENCES users (id),
  reviewed_at       timestamptz,
  uploaded_by       uuid NOT NULL REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_documents_one_owner CHECK (num_nonnulls(donor_id, ngo_id) = 1)
);
CREATE INDEX idx_verification_documents__donor ON verification_documents (donor_id);
CREATE INDEX idx_verification_documents__ngo ON verification_documents (ngo_id);

-- Down Migration
DROP TABLE IF EXISTS verification_documents;
DROP TABLE IF EXISTS ngo_representatives;
DROP TABLE IF EXISTS ngo_food_preferences;
DROP TABLE IF EXISTS ngos;
DROP TABLE IF EXISTS donor_food_categories;
DROP TABLE IF EXISTS donor_availability;
DROP TABLE IF EXISTS donors;
DROP TABLE IF EXISTS food_categories;
ALTER TABLE idempotency_records DROP CONSTRAINT IF EXISTS fk_idempotency_records__user;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS fk_audit_logs__actor_user;
ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS fk_platform_settings__updated_by;
DROP TABLE IF EXISTS admin_profiles;
DROP TABLE IF EXISTS account_tokens;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS users;
