-- Up Migration
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id),
  type       text NOT NULL CHECK (type ~ '^[A-Z][A-Z_]{2,59}$'),
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Relative application path only; rejects //host and /\host open redirects.
  link_path  text CHECK (link_path ~ '^/([^/\\]|$)'),
  priority   text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  dedupe_key text NOT NULL,
  read_at    timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notifications__user_dedupe UNIQUE (user_id, dedupe_key)
);
CREATE INDEX idx_notifications__user ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications__unread ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
  user_id           uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  email_enabled     boolean NOT NULL DEFAULT true,
  max_per_hour      integer NOT NULL DEFAULT 20 CHECK (max_per_hour BETWEEN 1 AND 100),
  max_distance_km   numeric(6, 2) CHECK (max_distance_km > 0 AND max_distance_km <= 100),
  quiet_hours_start time,
  quiet_hours_end   time,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_quiet_pair CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL))
);
CREATE TRIGGER trg_notification_preferences_updated_at BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE notification_logs (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id     uuid NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  channel             text NOT NULL CHECK (channel IN ('SOCKET', 'EMAIL', 'PUSH')),
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempt_count       integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at     timestamptz,
  last_error          text,
  provider_message_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_logs__channel UNIQUE (notification_id, channel)
);
CREATE INDEX idx_notification_logs__status ON notification_logs (status, next_attempt_at);
CREATE TRIGGER trg_notification_logs_updated_at BEFORE UPDATE ON notification_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS notification_logs;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS notifications;
