# FoodBridge AI: AI Service Architecture

> **Status:** implemented and tested (`ai-service/`, Python 3.12, FastAPI).
> Related: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) ·
> [AI_MODEL_EVALUATION.md](AI_MODEL_EVALUATION.md) ·
> [MATCHING_ALGORITHM.md](MATCHING_ALGORITHM.md)

---

## 1. Purpose and boundaries

The AI service is a **stateless computation service** called only by the
Node.js backend. It:

- forecasts restaurant surplus (scikit-learn, trained on **SYNTHETIC** data);
- scores and explains NGO/donor match candidates (deterministic weighted ranking);
- recommends integer food allocations (OR-Tools CP-SAT);
- plans single-vehicle pickup routes with time windows (OR-Tools routing);
- runs **one** LLM inference step for the assistant (OpenAI or Gemini);
- computes sample-size-guarded insights from aggregates.

It does **not**:

- access the database, hold user credentials or authenticate end users;
- apply eligibility rules, reserve quantities, create donations, or execute
  tools (the backend does all of that, as the authenticated user);
- call Google Maps (the backend sends distance/duration matrices).

The backend is the authority for every decision. Every response is a
recommendation that the backend validates and a human confirms
(SYSTEM_ARCHITECTURE.md §1, §3, D3–D6).

## 2. Code layout

```
ai-service/
  app/
    main.py                 app factory (create_app), lazy module-level `app` for uvicorn
    core/                   config (pydantic-settings), security (bearer token), errors (envelope),
                            logging (JSON), middleware (request id, body limit, access log, 500),
                            request_context
    api/                    routers: health, prediction, matching, allocation, optimization,
                            assistant, analytics; deps
    schemas/                Pydantic request/response models (extra fields forbidden)
    services/
      features.py           feature engineering shared by training and inference
      model_artifact.py     artifact save/load with sha256 + feature-list verification
      prediction_service.py
      matching_common.py, matching_service.py
      allocation_service.py, route_service.py
      llm_service.py, llm_providers/ (base, openai_provider, gemini_provider)
      insights_service.py
    models/artifacts/       surplus_forecaster.joblib + surplus_forecaster.meta.json (shipped)
    utils/text.py           deterministic text helpers
  training/                 generate_dataset.py, data.py, evaluation.py, train.py, reports/
  datasets/                 synthetic_restaurant_metrics.csv + README.md (SYNTHETIC)
  tests/                    pytest suite (194 tests)
```

Dockerfile: `deployment/docker/ai-service.Dockerfile` (build context `ai-service/`).

## 3. Configuration

Validated at startup with pydantic-settings. Sources, lowest to highest
priority: `../.env` (repository root), `ai-service/.env`, process environment.
Empty values (e.g. `GEMINI_MODEL=`) fall back to the defaults. Invalid config
stops the process with a message that names the variables but never their values.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `INTERNAL_SERVICE_TOKEN` | yes | | ≥ 32 characters; identical in backend and AI service |
| `LLM_PROVIDER` | no | `none` | `none`, `gemini` or `openai` (case-insensitive) |
| `GEMINI_API_KEY` | for gemini | | sent only in the `x-goog-api-key` header |
| `GEMINI_MODEL` | no | `gemini-2.5-flash` | |
| `OPENAI_API_KEY` | for openai | | sent only in the `Authorization` header |
| `OPENAI_MODEL` | no | `gpt-4.1-mini` | |
| `LOG_LEVEL` | no | `INFO` | `debug`/`info`/… accepted |
| `AI_SERVICE_PORT` | no | `8001` | informational; the run command sets the port |

The assistant is "configured" only when the selected provider has a key;
otherwise `/ai/assistant` returns `503 LLM_UNAVAILABLE` and everything else works.

## 4. Authentication

Every endpoint except `GET /ai/health` requires
`Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`. The token is compared with
`hmac.compare_digest`. Missing, malformed or wrong → `401 UNAUTHORIZED` with
`WWW-Authenticate: Bearer`. Interactive docs (`/docs`) are disabled; the
OpenAPI schema is served at `GET /ai/openapi.json` **behind the same token**.

## 5. Cross-cutting behaviour

- **Error envelope** for every error (validation, 401, 404, 405, 413, 500, 502, 503):
  ```json
  {"error": {"code": "VALIDATION_ERROR", "message": "Request validation failed.",
             "details": [{"loc": ["body", "candidates"], "message": "Field required", "type": "missing"}],
             "request_id": "req-123"}}
  ```
  `details` is optional. Validation details never echo submitted values.
- **Codes:** `VALIDATION_ERROR` 422, `UNAUTHORIZED` 401, `NOT_FOUND` 404,
  `METHOD_NOT_ALLOWED` 405, `PAYLOAD_TOO_LARGE` 413, `MODEL_UNAVAILABLE` 503,
  `LLM_UNAVAILABLE` 503, `LLM_PROVIDER_ERROR` 502, `INTERNAL_ERROR` 500.
- **Request id:** a well-formed `X-Request-Id` (`[A-Za-z0-9._:-]{1,128}`) is
  echoed; otherwise a UUID is generated. It is returned in the `X-Request-Id`
  header and in every error body, and included in every log line.
- **Body limit:** bodies over 1 MiB (1,048,576 bytes) are rejected with `413`
  before parsing, whether or not `Content-Length` is sent.
- **Validation:** Pydantic models with bounds (list lengths, non-negative
  integers, enums). Unknown fields are rejected (`extra = forbid`) so contract
  drift fails loudly. JSON is snake_case.
- **Logging:** one JSON line per request (`method`, `path`, `status`,
  `duration_ms`, `request_id`) plus startup and LLM-call metadata (provider,
  model, provider HTTP status, latency). Bodies, prompts, messages, tokens and
  API keys are never logged; sensitive key names are redacted defensively.
- **Determinism:** all computation is deterministic for the same input
  (seeded training, single-threaded CP-SAT with a fixed seed, deterministic
  multi-start routing). LLM responses are, of course, not.
- CPU-bound endpoints are synchronous handlers (run in FastAPI's thread pool),
  so the event loop stays free; the assistant endpoint is async (httpx).

## 6. Endpoints

All examples below are real responses captured from the service (the
assistant examples come from tests with mocked provider HTTP; no real LLM was
called). Long lists are shortened with `…`.

### 6.1 `GET /ai/health` (no auth)

Liveness. Always `200` while the process runs.

```json
{"status": "ok", "service": "foodbridge-ai", "version": "1.0.0",
 "models": {"surplus_forecaster": {
    "version": "sf-20261103-c261c11a", "algorithm": "LinearRegression",
    "trained_at": "2026-11-03T10:23:36Z", "training_data_label": "SYNTHETIC",
    "metrics": {"split": "test (chronological)", "mae": 19.406, "rmse": 30.1086,
                "baseline_mae": 20.8749, "baseline_rmse": 33.2403, "interval_coverage": 0.7452}}},
 "llm": {"provider": "none", "configured": false}}
```

If the artifact is missing, fails its sha256 check or its feature list differs
from the code, `surplus_forecaster` is `null` and predictions return
`503 MODEL_UNAVAILABLE`.

### 6.2 `POST /ai/predict-surplus`

History ≤ 1500 rows (unique per date + meal period; `sold_qty` and
`surplus_qty` ≤ `prepared_qty`), targets 1–31 (unique). Quantities are integers.

```json
{"donor_id": "9b2f6c1e-1d2a-4c5b-8e7f-0a1b2c3d4e5f", "unit": "MEALS",
 "history": [{"date": "2026-09-05", "meal_period": "LUNCH", "prepared_qty": 200, "sold_qty": 180,
              "surplus_qty": 20, "is_holiday": false, "special_event": null}, "… 60 LUNCH + 10 DINNER rows …"],
 "targets": [{"date": "2026-11-04", "meal_period": "LUNCH", "is_holiday": false,
              "special_event": null, "planned_prepared_qty": null},
             {"date": "2026-11-04", "meal_period": "DINNER", "is_holiday": false,
              "special_event": null, "planned_prepared_qty": null}]}
```

```json
{"model": {"name": "surplus_forecaster", "version": "sf-20261103-c261c11a",
           "algorithm": "LinearRegression", "training_data_label": "SYNTHETIC"},
 "predictions": [
   {"date": "2026-11-04", "meal_period": "LUNCH", "status": "ok",
    "predicted_qty": 25, "lower_qty": 0, "upper_qty": 62, "basis": "model"},
   {"date": "2026-11-04", "meal_period": "DINNER", "status": "insufficient_history",
    "predicted_qty": null, "lower_qty": null, "upper_qty": null, "basis": null}],
 "limitations": [
   "The forecasting model was trained on SYNTHETIC data, not real restaurant records; its accuracy on real donor history is unknown until it is retrained and evaluated on real data.",
   "A forecast is an estimate of possible surplus, not a donation: no food exists, is reserved or is promised until the donor creates a donation.",
   "lower_qty/upper_qty span the 10th-90th percentile of validation errors (an approximate range, not a guarantee).",
   "1 target(s) have fewer than 14 history rows for their meal period before the target date; no forecast is given for them."],
 "min_history_days": 14}
```

Rules: a target needs ≥ 14 history rows for its meal period **before the
target date** (later rows are ignored), otherwise `insufficient_history` with
nulls, never a guess. Forecasts are non-negative integers with
`lower_qty ≤ predicted_qty ≤ upper_qty`, capped at `planned_prepared_qty`
when given. `basis` is `baseline` only if the shipped artifact is the
historical-average baseline. Extra limitations appear for stale history
(> 31 days before the target), special events, and non-MEALS units.

### 6.3 `POST /ai/match-ngos` and `POST /ai/match-donors`

Deterministic weighted ranking (`weighted-v1`); formulas in
[MATCHING_ALGORITHM.md](MATCHING_ALGORITHM.md). ≤ 500 candidates, unique ids;
weights non-negative and summing to 100 (defaults used if omitted).

Request (match-ngos), the contract example:

```json
{"donation": {"id": "…", "category_code": "COOKED_MEALS", "dietary_type": "VEG", "quantity_available": 120,
              "unit": "MEALS", "storage_type": "HOT_HELD", "requires_refrigeration": false,
              "minutes_until_deadline": 180},
 "candidates": [{"ngo_id": "…", "name": "Helping Hands", "distance_m": 3200,
                 "distance_source": "STRAIGHT_LINE_ESTIMATE", "travel_time_s": null,
                 "collection_radius_m": 10000, "capacity_remaining": 150,
                 "open_need": {"quantity_remaining": 100, "urgency": "HIGH", "dietary_requirement": "VEG_ONLY"},
                 "has_refrigeration": false, "accepts_veg": true, "accepts_non_veg": false,
                 "reliability": {"completed": 12, "failed": 1}, "beneficiaries_count": 180}],
 "weights": {"distance": 20, "food_requirement": 20, "quantity_capacity": 15, "food_preference": 10,
             "urgency": 15, "pickup_availability": 10, "reliability": 5, "beneficiary_demand": 5}}
```

Response:

```json
{"algorithm_version": "weighted-v1",
 "weights": {"distance": 20.0, "food_requirement": 20.0, "quantity_capacity": 15.0, "food_preference": 10.0,
             "urgency": 15.0, "pickup_availability": 10.0, "reliability": 5.0, "beneficiary_demand": 5.0},
 "results": [{"candidate_id": "…", "rank": 1, "score": 89.47,
   "criteria": {
     "distance": {"score": 68.0, "weight": 20.0, "contribution": 13.6,
                  "detail": "3.2 km (straight-line estimate) of 10 km radius"},
     "food_requirement": {"score": 100.0, "weight": 20.0, "contribution": 20.0,
                          "detail": "Open request for 100 vegetarian meals (urgency HIGH)"},
     "quantity_capacity": {"score": 100.0, "weight": 15.0, "contribution": 15.0,
                           "detail": "Capacity 150 for 120 meals offered"},
     "food_preference": {"score": 100.0, "weight": 10.0, "contribution": 10.0,
                         "detail": "No cold-chain requirement (HOT_HELD)"},
     "urgency": {"score": 75.0, "weight": 15.0, "contribution": 11.25, "detail": "Open request urgency HIGH"},
     "pickup_availability": {"score": 100.0, "weight": 10.0, "contribution": 10.0,
       "detail": "~9.6 min travel (estimated at 20 km/h urban average); 170.4 min to spare before the deadline"},
     "reliability": {"score": 92.31, "weight": 5.0, "contribution": 4.62, "detail": "12 completed, 1 failed"},
     "beneficiary_demand": {"score": 100.0, "weight": 5.0, "contribution": 5.0,
                            "detail": "180 beneficiaries (largest among candidates: 180)"}},
   "explanation": "Helping Hands is recommended because it needs 100 vegetarian meals (urgency HIGH), can take the full quantity and is 3.2 km away (straight-line estimate).",
   "limitations": ["Distance is a straight-line estimate, not road distance.",
                   "Travel time is estimated at 20 km/h urban average, not taken from road data."]}]}
```

`/ai/match-donors` takes `{"request": {...}, "candidates": [...], "weights": {...}}`
(fields as in the contract) and returns the same shape with
`candidate_id = donor_id`. For the contract example donor (no food listed,
forecast 35 for 150 needed) the result is score 65.3 and:

```text
explanation: "Spice Garden is recommended because it regularly produces this food category, is available
  for the whole needed window and has completed 4 of 4 past donations. Main drawback: it is expected to cover
  only about 35 of the 150 meals needed (an estimate, not confirmed food). No food is confirmed yet: quantities
  shown are estimates, and the donor must confirm actual food before anything is reserved."
limitations: ["Quantity is a forecast/historical estimate — the donor must confirm actual food.",
              "Distance is a straight-line estimate, not road distance.",
              "Dietary compatibility unconfirmed: the donor has no listed food matching the requirement yet."]
```

### 6.4 `POST /ai/allocate-food`

≤ 500 supplies, ≤ 500 demands, ≤ 5000 edges; ids unique; edges must reference
known ids and be unique per pair; `time_limit_s` in (0, 10]. CP-SAT,
lexicographic: total quantity → score-weighted quantity → fewer pickups.

```json
{"supplies": [{"id": "s1", "quantity": 100}],
 "demands": [{"id": "d1", "quantity": 20, "min_quantity": 1}, {"id": "d2", "quantity": 50, "min_quantity": 10},
             {"id": "d3", "quantity": 60, "min_quantity": 1}],
 "edges": [{"supply_id": "s1", "demand_id": "d1", "score": 80.5, "max_quantity": null},
           {"supply_id": "s1", "demand_id": "d2", "score": 70}, {"supply_id": "s1", "demand_id": "d3", "score": 60}],
 "time_limit_s": 5}
```

```json
{"status": "OPTIMAL",
 "allocations": [{"supply_id": "s1", "demand_id": "d1", "quantity": 20},
                 {"supply_id": "s1", "demand_id": "d2", "quantity": 50},
                 {"supply_id": "s1", "demand_id": "d3", "quantity": 30}],
 "total_allocated": 100,
 "unallocated_supply": [{"id": "s1", "quantity": 0}],
 "unmet_demand": [{"id": "d3", "quantity": 30}],
 "explanation": "Recommend allocating 100 of 100 available units over 3 supply-demand pair(s), fully meeting 2 of 3 demands. Priorities: most total quantity, then higher match scores, then fewer pickups. This plan is optimal for all three priorities. This is a recommendation; the backend validates it and a person confirms before anything is reserved.",
 "reasons": ["Total supply 100 is less than total demand 130, so at least 30 cannot be met.",
             "Demand d3: 30 unmet because its connected supplies (s1) are fully allocated."]}
```

`unallocated_supply` lists **every** supply (0 when fully used);
`unmet_demand` lists **only** demands with remaining quantity > 0. When nothing
can be allocated the status is `NO_FEASIBLE_ALLOCATION` and the reasons say
why (no edges, edge caps below minimums, unconnected nodes, …).

### 6.5 `POST /ai/optimize-route`

≤ 60 locations, exactly one `START` (at `start_index`), one `END` (at
`end_index`, or `start_index == end_index` for a round trip), the rest
`PICKUP`; N×N non-negative integer matrices. Times are seconds from plan start.

Captured example: capacity 120, pickups p1 (80), p2 (80), p3 (20, window 0–600 s).

```json
{"status": "PARTIAL",
 "route": [{"location_id": "start", "sequence": 0, "arrival_s": 0, "departure_s": 0, "load_after": 0},
           {"location_id": "p2", "sequence": 1, "arrival_s": 1000, "departure_s": 1600, "load_after": 80},
           {"location_id": "end", "sequence": 2, "arrival_s": 2200, "departure_s": 2200, "load_after": 80}],
 "dropped": [{"location_id": "p1", "reason": "total demand 160 exceeds vehicle capacity 120 (80 already collected on the route + 80 at this stop)"},
             {"location_id": "p3", "reason": "time window ends before earliest possible arrival (1500s > 600s)"}],
 "total_distance_m": 8800, "total_duration_s": 2200, "distance_source": "STRAIGHT_LINE_ESTIMATE",
 "explanation": "Visit 1 of 3 pickup stops in the order shown, collecting 80 of 180 units over 8.8 km in about 37 min (vehicle capacity 120). 2 stop(s) could not be included; see 'dropped' for reasons. Travel times and distances are straight-line estimates, not road data; real travel may take longer. This is a recommended plan; the NGO confirms it before it is used.",
 "reasons": ["Travel times and distances are straight-line estimates, not road data; real travel may take longer.",
             "Dropped p1: total demand 160 exceeds vehicle capacity 120 (80 already collected on the route + 80 at this stop).",
             "Dropped p3: time window ends before earliest possible arrival (1500s > 600s).",
             "arrival_s is the planned service start; the vehicle may arrive earlier and wait for a window to open."]}
```

The contract's one-pickup example returns `OPTIMAL` with arrivals 0 / 900 /
2300, `total_distance_m` 9000 and `total_duration_s` 2300.

### 6.6 `POST /ai/assistant`

One LLM call; never executes tools. ≤ 100 messages (content ≤ 32,000
characters), ≤ 64 tools with unique names, `temperature` 0–2. Tool messages
must reference a `tool_call_id` from an earlier assistant message.

```json
{"messages": [{"role": "system", "content": "You are the FoodBridge assistant."},
              {"role": "user", "content": "Show my donations"},
              {"role": "assistant", "content": null,
               "tool_calls": [{"id": "call_1", "name": "search_donations", "arguments": {"status": "AVAILABLE"}}]},
              {"role": "tool", "tool_call_id": "call_1", "name": "search_donations",
               "content": "{\"items\": [{\"id\": \"d1\", \"quantity\": 40}]}"}],
 "tools": [{"name": "search_donations", "description": "Search the user's donations.",
            "parameters": {"type": "object", "properties": {"status": {"type": "string"}},
                           "additionalProperties": false}}],
 "temperature": 0.2}
```

Responses (from the mocked-provider tests):

```json
{"type": "message", "content": "You have 1 donation.", "provider": "openai", "model": "gpt-4.1-mini",
 "usage": {"prompt_tokens": 42, "completion_tokens": 7}}
```
```json
{"type": "tool_calls", "calls": [{"id": "call_abc", "name": "search_donations", "arguments": {"status": "AVAILABLE"}}],
 "provider": "openai", "model": "gpt-4.1-mini", "usage": {"prompt_tokens": 42, "completion_tokens": 7}}
```

Provider adapters (`LLMProvider` interface):

| | OpenAI | Gemini |
|---|---|---|
| Endpoint | `POST https://api.openai.com/v1/chat/completions` | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` |
| Key | `Authorization: Bearer` header | `x-goog-api-key` header (never in the URL) |
| System prompt | `system` message | `systemInstruction` |
| Tools | `tools[].function` (+ `tool_choice: auto`) | `tools[].functionDeclarations[]` with `parametersJsonSchema` (full JSON Schema) |
| Tool calls | `message.tool_calls[].function.arguments` (JSON string, parsed; invalid JSON → provider error) | `functionCall` parts; ids generated deterministically (`call_<sha256>`) when absent |
| Tool results | `role: tool` + `tool_call_id` | `functionResponse` parts, consecutive results grouped in one turn; non-object results wrapped as `{"result": …}` |
| Usage | `prompt_tokens`, `completion_tokens` | `promptTokenCount`, `candidatesTokenCount + thoughtsTokenCount` |

HTTP: httpx, 30 s timeout, one retry on 500/502/503/504 and connection errors,
**no retry on 4xx or timeouts**. Failure mapping:

| Situation | Response |
|---|---|
| `LLM_PROVIDER=none`, or no key for the selected provider | `503 LLM_UNAVAILABLE` |
| Timeout | `502 LLM_PROVIDER_ERROR`, `details.code = "TIMEOUT"` |
| Provider HTTP ≥ 400 | `502`, `details.code = "HTTP_ERROR"`, `details.provider_status` (provider body discarded) |
| Network failure (after one retry) | `502`, `"NETWORK_ERROR"` |
| Invalid JSON, missing fields, non-object tool arguments | `502`, `"MALFORMED_RESPONSE"` |
| Safety block | `502`, `"BLOCKED"` |
| Empty answer | `502`, `"EMPTY_RESPONSE"` |
| Model asks for a tool not in `tools` | `502`, `"UNKNOWN_TOOL"`, `details.tool_names` |

### 6.7 `POST /ai/insights`

All series optional (≤ 5000 points each; weekday ISO 1–7; months `YYYY-MM`,
unique). An insight is produced only if its sample size ≥ `min_sample_size`;
otherwise it is listed in `skipped` with the reason.

| Type | Sample size | Computation |
|---|---|---|
| `WEEKEND_VS_WEEKDAY` | Σ donation `count` | per-day averages: weekday total / 5 vs weekend total / 2 |
| `UNMET_DEMAND` | Σ `open_requests` | category + diet with most open requests, and its share |
| `DISTANCE_DELAY` | number of collections | Spearman rank correlation (numpy, average ranks for ties); approximate Fisher-z significance; states "correlation, not causation" |
| `TREND` | Σ optional per-month `count` for the two months compared (falls back to units, with a limitation) | last month vs previous month, plus the 3-month average before it |

Captured example (`data_label: SYNTHETIC`, `min_sample_size: 20`):

```json
{"insights": [{"type": "WEEKEND_VS_WEEKDAY", "title": "Weekend donations are 35% higher than weekdays",
   "body": "On average 540 units were donated per weekend day versus 400 per weekday, across 70 donations (20 at weekends, 50 on weekdays).",
   "sample_size": 70, "confidence": "MEDIUM",
   "supporting_data": {"weekday_avg_quantity_per_day": 400.0, "weekend_avg_quantity_per_day": 540.0,
                       "weekday_donations": 50, "weekend_donations": 20, "difference_pct": 35.0,
                       "quantity_by_iso_weekday": {"1": 400.0, "…": "…", "7": 480.0}},
   "limitations": ["Per-day averages assume each weekday occurs equally often in the period (weekday total / 5, weekend total / 2).",
                   "Describes a difference; it does not explain why it exists.",
                   "Based on synthetic/demo data (data_label=SYNTHETIC); not evidence about real-world operations."]}],
 "skipped": [{"type": "UNMET_DEMAND", "reason": "insufficient sample (n=5 < 20)"},
             {"type": "DISTANCE_DELAY", "reason": "no data provided"},
             {"type": "TREND", "reason": "no data provided"}]}
```

Confidence: `HIGH` if n ≥ 5 × min, `MEDIUM` if n ≥ 2 × min, else `LOW`
(distance-delay additionally requires approximate significance; weekend
comparison is `LOW` if either group has < 5 donations; trend needs ≥ 3 months
for `MEDIUM`, ≥ 6 for `HIGH`).

## 7. Failure behaviour

| Failure | Behaviour |
|---|---|
| Missing/invalid configuration | Process exits at startup with variable names only |
| Model artifact missing, tampered, or feature mismatch | Service starts; health shows `surplus_forecaster: null`; prediction `503 MODEL_UNAVAILABLE` |
| LLM unconfigured | `503 LLM_UNAVAILABLE`; all other endpoints unaffected |
| LLM provider failure | `502 LLM_PROVIDER_ERROR` with a safe `details.code` |
| Solver time limit | Allocation `FEASIBLE`/`TIMEOUT`; routing `FEASIBLE`/`TIMEOUT` |
| Unexpected exception | `500 INTERNAL_ERROR` envelope with request id; stack trace only in logs |
| AI service down (seen from backend) | Backend retries once, then falls back (distance order labelled "ranking unavailable", "forecast unavailable", …) |

## 8. Running, training, testing

From `ai-service/`:

```bash
# install (uv-managed Python 3.12 venv)
~/.local/bin/uv pip install --python .venv/bin/python -r requirements.txt -r requirements-dev.txt

# run (reads ../.env then .env)
.venv/bin/uvicorn app.main:app --port 8001

# regenerate the SYNTHETIC dataset (byte-identical) and retrain
.venv/bin/python -m training.generate_dataset
.venv/bin/python -m training.train            # writes app/models/artifacts/* and training/reports/

# quality gates
.venv/bin/ruff check .
.venv/bin/python -m pytest -q
```

Docker (the image ships the trained artifact; it never retrains):

```bash
cd ai-service
docker build -f ../deployment/docker/ai-service.Dockerfile -t foodbridge-ai:dev .
docker run --rm -p 8001:8001 -e INTERNAL_SERVICE_TOKEN=... foodbridge-ai:dev
```

The image is `python:3.12-slim`, runs as non-root user `foodbridge`
(uid 10001), installs only `requirements.txt`, contains only `app/`
(`.dockerignore` is an allow-list), and has a `HEALTHCHECK` on `/ai/health`.

## 9. Notes for the backend integration

- Send `X-Request-Id` so logs correlate across services.
- Keep solver `time_limit_s` below the backend's AI timeout
  (`AI_SERVICE_TIMEOUT_MS`, default 5000 ms), e.g. 3 s.
- `/ai/optimize-route` can return `PARTIAL`; `collection_plans.solver_status`
  has no such value, so store `FEASIBLE` plus the dropped-stop reasons in
  `infeasibility_reasons`, or extend the enum.
- Gemini "thought signatures" are not round-tripped (the tool-call contract
  has no field for them). This is fine for `gemini-2.5-*`. Gemini 3 models
  require them for multi-step function calling and would need a contract extension.
- Persist `model.version`, `training_data_label` and `limitations` with each
  stored prediction (`surplus_predictions.data_label`), and the
  `algorithm_version` + `weights` with each match recommendation.
