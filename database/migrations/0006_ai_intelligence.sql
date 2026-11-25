-- Up Migration
CREATE TABLE restaurant_daily_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id      uuid NOT NULL REFERENCES donors (id),
  metric_date   date NOT NULL,
  meal_period   text NOT NULL CHECK (meal_period IN ('BREAKFAST', 'LUNCH', 'DINNER', 'ALL_DAY')),
  unit          text NOT NULL DEFAULT 'MEALS' CHECK (unit IN ('MEALS', 'PACKETS', 'BOXES')),
  prepared_qty  integer NOT NULL CHECK (prepared_qty >= 0),
  sold_qty      integer NOT NULL CHECK (sold_qty >= 0),
  surplus_qty   integer NOT NULL CHECK (surplus_qty >= 0),
  is_holiday    boolean NOT NULL DEFAULT false,
  special_event text CHECK (length(special_event) <= 120),
  data_source   text NOT NULL CHECK (data_source IN ('DONOR_ENTERED', 'IMPORTED', 'SYNTHETIC')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rdm_quantities CHECK (sold_qty <= prepared_qty AND surplus_qty <= prepared_qty),
  CONSTRAINT uq_rdm__day UNIQUE (donor_id, metric_date, meal_period)
);
CREATE INDEX idx_rdm__donor_date ON restaurant_daily_metrics (donor_id, metric_date);
CREATE TRIGGER trg_rdm_updated_at BEFORE UPDATE ON restaurant_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE model_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name          text NOT NULL,
  version             text NOT NULL,
  algorithm           text NOT NULL,
  trained_at          timestamptz,
  training_data_label text NOT NULL CHECK (training_data_label IN ('REAL', 'SYNTHETIC', 'MIXED')),
  training_rows       integer,
  metrics             jsonb NOT NULL DEFAULT '{}'::jsonb,
  features            jsonb,
  artifact_sha256     text,
  is_active           boolean NOT NULL DEFAULT false,
  notes               text,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_model_versions__name_version UNIQUE (model_name, version)
);
CREATE UNIQUE INDEX uq_model_versions__active ON model_versions (model_name) WHERE is_active;

CREATE TABLE surplus_predictions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id           uuid NOT NULL REFERENCES donors (id),
  target_date        date NOT NULL,
  meal_period        text NOT NULL CHECK (meal_period IN ('BREAKFAST', 'LUNCH', 'DINNER', 'ALL_DAY')),
  unit               text NOT NULL DEFAULT 'MEALS',
  status             text NOT NULL CHECK (status IN ('OK', 'INSUFFICIENT_HISTORY')),
  predicted_quantity integer CHECK (predicted_quantity >= 0),
  lower_bound        integer CHECK (lower_bound >= 0),
  upper_bound        integer CHECK (upper_bound >= 0),
  basis              text,
  model_version_id   uuid REFERENCES model_versions (id),
  input_summary      jsonb,
  data_label         text NOT NULL CHECK (data_label IN ('REAL', 'SYNTHETIC', 'MIXED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT surplus_predictions_ok_has_value CHECK (status <> 'OK' OR predicted_quantity IS NOT NULL)
);
CREATE INDEX idx_surplus_predictions__donor ON surplus_predictions (donor_id, target_date, created_at DESC);

CREATE TABLE match_recommendations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                uuid NOT NULL,
  subject_type          text NOT NULL CHECK (subject_type IN ('DONATION', 'ASSISTANCE_REQUEST')),
  donation_id           uuid REFERENCES donations (id),
  assistance_request_id uuid REFERENCES food_assistance_requests (id),
  candidate_ngo_id      uuid REFERENCES ngos (id),
  candidate_donor_id    uuid REFERENCES donors (id),
  eligible              boolean NOT NULL,
  ineligibility_reasons text[] NOT NULL DEFAULT '{}',
  score                 numeric(5, 2) CHECK (score BETWEEN 0 AND 100),
  rank                  integer CHECK (rank > 0),
  ranking_status        text NOT NULL CHECK (ranking_status IN ('RANKED', 'RANKING_UNAVAILABLE', 'NOT_RANKED')),
  criteria              jsonb,
  explanation           text,
  limitations           text[] NOT NULL DEFAULT '{}',
  distance_m            numeric(12, 2),
  travel_time_s         integer,
  distance_source       text CHECK (distance_source IN ('STRAIGHT_LINE_ESTIMATE', 'ROAD_GOOGLE_ROUTES')),
  algorithm_version     text NOT NULL,
  weights               jsonb,
  notified_at           timestamptz,
  notification_id       uuid REFERENCES notifications (id),
  viewed_at             timestamptz,
  response              text NOT NULL DEFAULT 'NONE' CHECK (response IN ('NONE', 'REQUESTED', 'OFFERED', 'DECLINED', 'UNAVAILABLE')),
  responded_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_recommendations_subject CHECK (
    (subject_type = 'DONATION' AND donation_id IS NOT NULL AND assistance_request_id IS NULL AND candidate_ngo_id IS NOT NULL AND candidate_donor_id IS NULL)
    OR (subject_type = 'ASSISTANCE_REQUEST' AND assistance_request_id IS NOT NULL AND donation_id IS NULL AND candidate_donor_id IS NOT NULL AND candidate_ngo_id IS NULL)),
  CONSTRAINT match_recommendations_score_when_eligible CHECK (eligible OR score IS NULL),
  CONSTRAINT uq_match_recommendations__candidate UNIQUE NULLS NOT DISTINCT (run_id, candidate_ngo_id, candidate_donor_id)
);
CREATE INDEX idx_match_recommendations__donation ON match_recommendations (donation_id, created_at DESC);
CREATE INDEX idx_match_recommendations__request ON match_recommendations (assistance_request_id, created_at DESC);
CREATE INDEX idx_match_recommendations__ngo ON match_recommendations (candidate_ngo_id, created_at DESC);
CREATE INDEX idx_match_recommendations__donor ON match_recommendations (candidate_donor_id, created_at DESC);

CREATE TABLE ai_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id),
  title      text CHECK (length(title) <= 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_ai_conversations__user ON ai_conversations (user_id, updated_at DESC);
CREATE TRIGGER trg_ai_conversations_updated_at BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ai_interactions (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id     uuid NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users (id),
  role                text NOT NULL CHECK (role IN ('USER', 'ASSISTANT', 'TOOL')),
  content             text,
  tool_call_id        text,
  tool_name           text,
  tool_arguments      jsonb,
  tool_result_summary jsonb,
  pending_action      jsonb,
  action_status       text CHECK (action_status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'FAILED')),
  provider            text,
  model               text,
  prompt_tokens       integer,
  completion_tokens   integer,
  latency_ms          integer,
  status              text NOT NULL DEFAULT 'OK' CHECK (status IN ('OK', 'ERROR', 'UNAVAILABLE')),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_interactions__conversation ON ai_interactions (conversation_id, id);
CREATE INDEX idx_ai_interactions__created ON ai_interactions (created_at);

CREATE TABLE ai_insights (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience        text NOT NULL CHECK (audience IN ('DONOR', 'NGO', 'ADMIN')),
  donor_id        uuid REFERENCES donors (id),
  ngo_id          uuid REFERENCES ngos (id),
  insight_type    text NOT NULL,
  title           text NOT NULL,
  body            text NOT NULL,
  supporting_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_size     integer NOT NULL CHECK (sample_size > 0),
  confidence      text CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  limitations     text[] NOT NULL DEFAULT '{}',
  data_label      text NOT NULL CHECK (data_label IN ('REAL', 'SYNTHETIC', 'MIXED')),
  generated_by    text NOT NULL CHECK (generated_by IN ('RULE', 'LLM')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz
);
CREATE INDEX idx_ai_insights__audience ON ai_insights (audience, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS ai_insights;
DROP TABLE IF EXISTS ai_interactions;
DROP TABLE IF EXISTS ai_conversations;
DROP TABLE IF EXISTS match_recommendations;
DROP TABLE IF EXISTS surplus_predictions;
DROP TABLE IF EXISTS model_versions;
DROP TABLE IF EXISTS restaurant_daily_metrics;
