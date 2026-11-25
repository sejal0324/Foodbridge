-- Up Migration
CREATE TABLE platform_settings (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]{2,79}$'),
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_platform_settings_updated_at BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE audit_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_type    text NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM', 'SERVICE')),
  actor_user_id uuid,
  actor_role    text,
  action        text NOT NULL CHECK (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type   text,
  entity_id     uuid,
  changes       jsonb,
  metadata      jsonb,
  request_id    text,
  ip            inet,
  user_agent    text
);
CREATE INDEX idx_audit_logs__entity ON audit_logs (entity_type, entity_id, occurred_at);
CREATE INDEX idx_audit_logs__actor ON audit_logs (actor_user_id, occurred_at);
CREATE INDEX idx_audit_logs__action ON audit_logs (action, occurred_at);
CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE idempotency_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           text NOT NULL,
  key             text NOT NULL CHECK (length(key) BETWEEN 8 AND 200),
  user_id         uuid,
  request_hash    text NOT NULL,
  status          text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  CONSTRAINT uq_idempotency_records__scope_key UNIQUE (scope, key)
);
CREATE INDEX idx_idempotency_records__expires ON idempotency_records (expires_at);

CREATE TABLE jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD')),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 50),
  run_at       timestamptz NOT NULL DEFAULT now(),
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  dedupe_key   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_attempts_range CHECK (attempts >= 0 AND attempts <= max_attempts),
  CONSTRAINT uq_jobs__dedupe_key UNIQUE (dedupe_key)
);
CREATE INDEX idx_jobs__runnable ON jobs (run_at) WHERE status = 'PENDING';
CREATE INDEX idx_jobs__status ON jobs (status, updated_at);
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS idempotency_records;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS platform_settings;
