-- Up Migration
CREATE TABLE collection_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_id                uuid NOT NULL REFERENCES ngos (id),
  plan_date             date NOT NULL,
  representative_id     uuid REFERENCES ngo_representatives (id),
  vehicle_capacity      integer NOT NULL CHECK (vehicle_capacity > 0),
  start_location        geography(Point, 4326) NOT NULL,
  start_address         text,
  end_location          geography(Point, 4326) NOT NULL,
  end_address           text,
  start_time            timestamptz NOT NULL,
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  solver                text NOT NULL DEFAULT 'ORTOOLS_VRPTW',
  solver_status         text CHECK (solver_status IN ('OPTIMAL', 'FEASIBLE', 'PARTIAL', 'INFEASIBLE', 'TIMEOUT', 'UNAVAILABLE')),
  distance_source       text CHECK (distance_source IN ('STRAIGHT_LINE_ESTIMATE', 'ROAD_GOOGLE_ROUTES')),
  total_distance_m      integer,
  total_duration_s      integer,
  explanation           text,
  infeasibility_reasons text[] NOT NULL DEFAULT '{}',
  created_by            uuid NOT NULL REFERENCES users (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_collection_plans__ngo ON collection_plans (ngo_id, plan_date DESC);
CREATE TRIGGER trg_collection_plans_updated_at BEFORE UPDATE ON collection_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE collection_stops (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id            uuid NOT NULL REFERENCES collection_plans (id) ON DELETE CASCADE,
  sequence           integer CHECK (sequence >= 0),
  stop_type          text NOT NULL CHECK (stop_type IN ('PICKUP', 'DROP_OFF')),
  allocation_id      uuid REFERENCES donation_allocations (id),
  location           geography(Point, 4326) NOT NULL,
  address            text,
  window_start       timestamptz,
  window_end         timestamptz,
  planned_arrival_at timestamptz,
  quantity           integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VISITED', 'SKIPPED', 'DROPPED')),
  drop_reason        text,
  CONSTRAINT uq_collection_stops__sequence UNIQUE (plan_id, sequence),
  CONSTRAINT collection_stops_pickup_allocation CHECK (stop_type <> 'PICKUP' OR allocation_id IS NOT NULL)
);
CREATE INDEX idx_collection_stops__plan ON collection_stops (plan_id);

-- Down Migration
DROP TABLE IF EXISTS collection_stops;
DROP TABLE IF EXISTS collection_plans;
