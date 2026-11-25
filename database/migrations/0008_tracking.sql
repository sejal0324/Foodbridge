-- Up Migration
CREATE TABLE tracking_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_assignment_id uuid NOT NULL REFERENCES pickup_assignments (id),
  stage                text NOT NULL CHECK (stage IN ('TO_PICKUP', 'TO_DESTINATION')),
  tracked_user_id      uuid NOT NULL REFERENCES users (id),
  status               text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED', 'EXPIRED')),
  consent_given_at     timestamptz NOT NULL,
  started_at           timestamptz NOT NULL DEFAULT now(),
  ended_at             timestamptz,
  end_reason           text CHECK (length(end_reason) <= 200),
  last_location        geography(Point, 4326),
  last_accuracy_m      numeric(8, 2),
  last_recorded_at     timestamptz,
  destination_location geography(Point, 4326),
  total_distance_m     numeric(12, 2) NOT NULL DEFAULT 0,
  points_purged_at     timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tracking_sessions_ended CHECK ((status = 'ACTIVE') = (ended_at IS NULL))
);
CREATE UNIQUE INDEX uq_tracking_sessions__active ON tracking_sessions (pickup_assignment_id, stage) WHERE status = 'ACTIVE';
CREATE INDEX idx_tracking_sessions__assignment ON tracking_sessions (pickup_assignment_id);
CREATE INDEX idx_tracking_sessions__ended ON tracking_sessions (ended_at) WHERE points_purged_at IS NULL;
CREATE TRIGGER trg_tracking_sessions_updated_at BEFORE UPDATE ON tracking_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE location_updates (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES tracking_sessions (id) ON DELETE CASCADE,
  location    geography(Point, 4326) NOT NULL,
  accuracy_m  numeric(8, 2) CHECK (accuracy_m >= 0),
  heading     numeric(6, 2) CHECK (heading >= 0 AND heading < 360),
  speed_mps   numeric(7, 2) CHECK (speed_mps >= 0),
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_location_updates__session ON location_updates (session_id, recorded_at);

CREATE TABLE tracking_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id    uuid REFERENCES tracking_sessions (id),
  pickup_assignment_id uuid REFERENCES pickup_assignments (id),
  event_type    text NOT NULL CHECK (event_type IN (
                  'STARTED', 'PERMISSION_DENIED', 'POSITION_UNAVAILABLE', 'DISCONNECTED', 'RECONNECTED', 'STALE',
                  'NEAR_DESTINATION', 'STOPPED', 'ADMIN_VIEWED')),
  actor_user_id uuid REFERENCES users (id),
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tracking_events_subject CHECK (num_nonnulls(session_id, pickup_assignment_id) >= 1)
);
CREATE INDEX idx_tracking_events__session ON tracking_events (session_id, created_at);

-- Down Migration
DROP TABLE IF EXISTS tracking_events;
DROP TABLE IF EXISTS location_updates;
DROP TABLE IF EXISTS tracking_sessions;
