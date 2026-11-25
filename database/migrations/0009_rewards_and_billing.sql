-- Up Migration

-- ---------------------------------------------------------------------------
-- Rewards
-- ---------------------------------------------------------------------------
-- Rules are data, not code. For PER_UNIT rules, lifetime_threshold defines
-- progressive brackets: a rule with threshold T applies to every unit after
-- the donor's T-th lifetime unit (until the next bracket). PER_ORDER rules
-- award a flat amount per verified handover.
CREATE TABLE reward_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit               text NOT NULL CHECK (unit IN ('MEALS', 'PACKETS', 'BOXES')),
  basis              text NOT NULL CHECK (basis IN ('PER_UNIT', 'PER_ORDER')),
  points             integer NOT NULL CHECK (points > 0 AND points <= 10000),
  lifetime_threshold integer NOT NULL DEFAULT 0 CHECK (lifetime_threshold >= 0),
  description        text,
  effective_from     timestamptz NOT NULL DEFAULT now(),
  effective_to       timestamptz,
  is_active          boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reward_rules_threshold_per_unit CHECK (basis = 'PER_UNIT' OR lifetime_threshold = 0),
  CONSTRAINT reward_rules_effective_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX uq_reward_rules__active_bracket ON reward_rules (unit, lifetime_threshold) WHERE is_active;

INSERT INTO reward_rules (unit, basis, points, lifetime_threshold, description) VALUES
  ('MEALS',   'PER_UNIT',  10, 0,   '10 points per verified meal'),
  ('MEALS',   'PER_UNIT',  15, 500, '15 points per verified meal after 500 lifetime verified meals (1.5x)'),
  ('PACKETS', 'PER_ORDER', 10, 0,   '10 points per verified packet order'),
  ('BOXES',   'PER_ORDER', 10, 0,   '10 points per verified box order');

CREATE TABLE reward_tiers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL CHECK (name IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM')),
  min_lifetime_points integer NOT NULL CHECK (min_lifetime_points >= 0),
  benefits            text,
  sort_order          integer NOT NULL,
  CONSTRAINT uq_reward_tiers__name UNIQUE (name),
  CONSTRAINT uq_reward_tiers__min UNIQUE (min_lifetime_points)
);
INSERT INTO reward_tiers (name, min_lifetime_points, benefits, sort_order) VALUES
  ('BRONZE',   0,     'Recognition badge and impact certificates', 1),
  ('SILVER',   2000,  'Silver badge; eligible for featured donor profile (with consent)', 2),
  ('GOLD',     10000, 'Gold badge; monthly sustainability report', 3),
  ('PLATINUM', 30000, 'Platinum badge; public recognition (with consent)', 4);

CREATE TABLE reward_balances (
  donor_id         uuid PRIMARY KEY REFERENCES donors (id),
  balance          integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_points  integer NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
  lifetime_meals   integer NOT NULL DEFAULT 0 CHECK (lifetime_meals >= 0),
  lifetime_orders  integer NOT NULL DEFAULT 0 CHECK (lifetime_orders >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_reward_balances_updated_at BEFORE UPDATE ON reward_balances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Immutable ledger. Corrections are new REVERSAL/ADJUSTMENT rows.
CREATE TABLE reward_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id        uuid NOT NULL REFERENCES donors (id),
  type            text NOT NULL CHECK (type IN ('CREDIT', 'REVERSAL', 'ADJUSTMENT')),
  points          integer NOT NULL CHECK (points <> 0),
  balance_after   integer NOT NULL CHECK (balance_after >= 0),
  unit            text CHECK (unit IN ('MEALS', 'PACKETS', 'BOXES')),
  quantity        integer CHECK (quantity >= 0),
  reference_type  text NOT NULL CHECK (reference_type IN ('HANDOVER', 'ADMIN_ADJUSTMENT', 'DISPUTE_RESOLUTION')),
  reference_id    uuid NOT NULL,
  idempotency_key text NOT NULL,
  calculation     jsonb NOT NULL DEFAULT '{}'::jsonb,
  description     text,
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_reward_transactions__idempotency UNIQUE (idempotency_key),
  CONSTRAINT uq_reward_transactions__reference UNIQUE (reference_type, reference_id, type)
);
CREATE INDEX idx_reward_transactions__donor ON reward_transactions (donor_id, created_at DESC);
CREATE TRIGGER trg_reward_transactions_append_only BEFORE UPDATE OR DELETE ON reward_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE impact_certificates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id              uuid NOT NULL REFERENCES donors (id),
  certificate_number    text NOT NULL,
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  meals_redistributed   integer NOT NULL CHECK (meals_redistributed >= 0),
  orders_completed      integer NOT NULL CHECK (orders_completed >= 0),
  points_earned         integer NOT NULL CHECK (points_earned >= 0),
  snapshot              jsonb NOT NULL,
  issued_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_impact_certificates__number UNIQUE (certificate_number),
  CONSTRAINT uq_impact_certificates__period UNIQUE (donor_id, period_start, period_end),
  CONSTRAINT impact_certificates_period CHECK (period_end >= period_start)
);
CREATE SEQUENCE impact_certificate_number_seq;

-- ---------------------------------------------------------------------------
-- NGO billing (donors are never charged: there is no donor billing table)
-- ---------------------------------------------------------------------------
CREATE TABLE service_fee_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit            text NOT NULL CHECK (unit IN ('MEALS', 'PACKETS', 'BOXES')),
  amount_per_unit numeric(12, 2) NOT NULL CHECK (amount_per_unit >= 0),
  currency        char(3) NOT NULL DEFAULT 'INR',
  description     text,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_fee_rules_effective_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX uq_service_fee_rules__active_unit ON service_fee_rules (unit) WHERE is_active;
INSERT INTO service_fee_rules (unit, amount_per_unit, description) VALUES
  ('MEALS',   5.00, 'INR 5 per successfully redistributed meal'),
  ('PACKETS', 5.00, 'INR 5 per successfully redistributed packet'),
  ('BOXES',   5.00, 'INR 5 per successfully redistributed box');

CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_id         uuid NOT NULL REFERENCES ngos (id),
  invoice_number text NOT NULL,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  subtotal       numeric(12, 2) NOT NULL CHECK (subtotal >= 0),
  tax_total      numeric(12, 2) NOT NULL CHECK (tax_total >= 0),
  total          numeric(12, 2) NOT NULL,
  currency       char(3) NOT NULL DEFAULT 'INR',
  status         text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'VOID')),
  issued_at      timestamptz,
  due_at         timestamptz,
  paid_at        timestamptz,
  created_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_invoices__number UNIQUE (invoice_number),
  CONSTRAINT uq_invoices__ngo_period UNIQUE (ngo_id, period_start, period_end),
  CONSTRAINT invoices_total CHECK (total = subtotal + tax_total),
  CONSTRAINT invoices_period CHECK (period_end >= period_start)
);
CREATE SEQUENCE invoice_number_seq;
CREATE INDEX idx_invoices__ngo ON invoices (ngo_id, issued_at DESC);
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One fee line per completed collection, created only from a CONFIRMED handover.
CREATE TABLE ngo_billing (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_id             uuid NOT NULL REFERENCES ngos (id),
  allocation_id      uuid NOT NULL REFERENCES donation_allocations (id),
  handover_record_id uuid NOT NULL REFERENCES handover_records (id),
  fee_rule_id        uuid NOT NULL REFERENCES service_fee_rules (id),
  unit               text NOT NULL CHECK (unit IN ('MEALS', 'PACKETS', 'BOXES')),
  billable_quantity  integer NOT NULL CHECK (billable_quantity > 0),
  unit_amount        numeric(12, 2) NOT NULL CHECK (unit_amount >= 0),
  base_amount        numeric(12, 2) NOT NULL CHECK (base_amount >= 0),
  tax_name           text,
  tax_rate_percent   numeric(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate_percent >= 0 AND tax_rate_percent <= 100),
  tax_amount         numeric(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount       numeric(12, 2) NOT NULL,
  currency           char(3) NOT NULL DEFAULT 'INR',
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'INVOICED', 'PAID', 'WAIVED', 'VOID')),
  invoice_id         uuid REFERENCES invoices (id),
  idempotency_key    text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ngo_billing__allocation UNIQUE (allocation_id),
  CONSTRAINT uq_ngo_billing__handover UNIQUE (handover_record_id),
  CONSTRAINT uq_ngo_billing__idempotency UNIQUE (idempotency_key),
  CONSTRAINT ngo_billing_base CHECK (base_amount = unit_amount * billable_quantity),
  CONSTRAINT ngo_billing_total CHECK (total_amount = base_amount + tax_amount),
  CONSTRAINT ngo_billing_invoiced CHECK (status NOT IN ('INVOICED', 'PAID') OR invoice_id IS NOT NULL)
);
CREATE INDEX idx_ngo_billing__ngo ON ngo_billing (ngo_id, created_at DESC);
CREATE INDEX idx_ngo_billing__invoice ON ngo_billing (invoice_id);
CREATE TRIGGER trg_ngo_billing_updated_at BEFORE UPDATE ON ngo_billing FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_id              uuid NOT NULL REFERENCES ngos (id),
  invoice_id          uuid NOT NULL REFERENCES invoices (id),
  provider            text NOT NULL CHECK (provider IN ('RAZORPAY', 'MANUAL')),
  provider_order_id   text,
  provider_payment_id text,
  amount              numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency            char(3) NOT NULL DEFAULT 'INR',
  status              text NOT NULL CHECK (status IN ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED')),
  failure_reason      text,
  reference_note      text CHECK (length(reference_note) <= 300),
  recorded_by         uuid REFERENCES users (id),
  idempotency_key     text NOT NULL,
  succeeded_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payments__order UNIQUE (provider_order_id),
  CONSTRAINT uq_payments__payment UNIQUE (provider_payment_id),
  CONSTRAINT uq_payments__idempotency UNIQUE (idempotency_key),
  CONSTRAINT payments_manual_recorder CHECK (provider <> 'MANUAL' OR recorded_by IS NOT NULL)
);
CREATE INDEX idx_payments__invoice ON payments (invoice_id);
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS ngo_billing;
DROP SEQUENCE IF EXISTS invoice_number_seq;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS service_fee_rules;
DROP SEQUENCE IF EXISTS impact_certificate_number_seq;
DROP TABLE IF EXISTS impact_certificates;
DROP TABLE IF EXISTS reward_transactions;
DROP TABLE IF EXISTS reward_balances;
DROP TABLE IF EXISTS reward_tiers;
DROP TABLE IF EXISTS reward_rules;
