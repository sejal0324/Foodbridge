# FoodBridge AI: Matching, Allocation and Routing Algorithms

> **Status:** implemented in the AI service (`ai-service/`), Phase 5/10.
> Related: [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) ·
> [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) ·
> [DATABASE_DESIGN.md](DATABASE_DESIGN.md) (`match_recommendations`, `collection_plans`)

Matching is a **deterministic weighted ranking** (`algorithm_version = "weighted-v1"`).
It is not machine learning and must never be described as such. The same input
always produces the same scores, order and explanations.

---

## 1. Division of work

| Step | Where | Notes |
|---|---|---|
| Hard eligibility filters | **Backend** (SQL/PostGIS) | Ineligible candidates are stored in `match_recommendations` with `eligible = false` and `ineligibility_reasons`; they are never sent to the AI service |
| Scoring, ranking, explanations | **AI service** (`/ai/match-ngos`, `/ai/match-donors`) | Only eligible candidates are scored |
| Notifying / reserving | **Backend** | A ranking is a recommendation; nothing is reserved by the AI service |

### 1.1 Hard filters (applied by the backend before scoring)

A candidate is sent for scoring only if **all** of these hold:

1. The organisation is **approved and active** (verified NGO / donor, not suspended).
2. The **donor is active and not paused** (donor matching), or the NGO account is active (NGO matching).
3. The **food category is accepted** (`ngo_food_preferences` / `donor_food_categories`).
4. **Dietary compatibility**: a `VEG_ONLY` need is only matched with `VEG` food; `ANY` accepts both.
5. **Within radius**: distance ≤ the NGO's collection radius (NGO matching) or the donor's maximum radius (donor matching).
6. **Capacity**: the NGO has not reported zero remaining capacity (unknown capacity is allowed and scored neutrally).
7. **Deadline feasible**: the pickup can plausibly happen before the donation deadline / inside the needed window.
8. **No live duplicate**: the candidate is not already holding a live request/offer for the same donation or assistance request.
9. Units match (matching only pairs equal units).

The AI service trusts that these filters were applied. Where a field it
receives would only make sense for a filtered candidate (e.g. `open_need`
already compatible with category and diet), the formulas below rely on that.

---

## 2. Score

For each candidate, every criterion `c` yields a score `s_c ∈ [0, 100]`.

```
score = round( Σ_c  w_c × s_c / 100 , 2 )        (weights w_c ≥ 0, Σ w_c = 100)
contribution_c = round( w_c × s_c / 100 , 2 )
```

The total is computed from the unrounded criterion scores, then rounded once.
Requests whose weights are negative or do not sum to 100 (±1e-6) are rejected
with `422 VALIDATION_ERROR`.

**Ordering:** score descending, then `distance_m` ascending, then
`candidate_id` ascending. Ranks start at 1. The order does not depend on the
order candidates were sent in.

### 2.1 Weights

Initial, **configurable** weights (stored by the backend in
`platform_settings` and sent with every request). They are a reasonable
starting point chosen by the team; they have **not been scientifically
validated** and should be revisited once real outcome data exists.

| Criterion | Weight |
|---|---|
| `distance` | 20 |
| `food_requirement` | 20 |
| `quantity_capacity` | 15 |
| `food_preference` | 10 |
| `urgency` | 15 |
| `pickup_availability` | 10 |
| `reliability` | 5 |
| `beneficiary_demand` | 5 |
| **Total** | **100** |

If `weights` is omitted, these defaults are used. The response echoes the
weights actually used, and the backend stores them with each recommendation.

---

## 3. NGO matching (`POST /ai/match-ngos`): ranking NGOs for a donation

Inputs per candidate: `distance_m`, `distance_source`, `travel_time_s`,
`collection_radius_m`, `capacity_remaining`, `open_need`, `has_refrigeration`,
`reliability`, `beneficiaries_count`. Donation: `quantity_available`,
`storage_type`, `requires_refrigeration`, `minutes_until_deadline`.

| Criterion | Formula | Limitation added |
|---|---|---|
| `distance` | `100 × max(0, 1 − distance_m / collection_radius_m)` | "Distance is a straight-line estimate, not road distance." when `distance_source = STRAIGHT_LINE_ESTIMATE` |
| `food_requirement` | `100` if `open_need` present (backend only sends needs compatible with category and diet), else `60` | |
| `quantity_capacity` | `capacity_remaining` null → `50`; else `100 × min(1, capacity_remaining / quantity_available)` | "NGO capacity unknown: …" when null |
| `food_preference` (handling fit) | if `requires_refrigeration` or `storage_type ∈ {REFRIGERATED, FROZEN}`: `100` if `has_refrigeration` else `40`; otherwise `100` | "NGO has no refrigeration, but this food must be kept cold." |
| `urgency` | `open_need.urgency`: CRITICAL `100`, HIGH `75`, MEDIUM `50`, LOW `25`; no `open_need` → `10` | |
| `pickup_availability` | `travel_min = travel_time_s / 60` if given, else `distance_m / (20 km/h)` = `distance_m × 0.003`; `slack = minutes_until_deadline − travel_min`; score `100` if `slack ≥ 120`, `0` if `slack ≤ 15`, else `100 × (slack − 15) / 105` | "Travel time is estimated at 20 km/h urban average, not taken from road data." when estimated |
| `reliability` | `n = completed + failed`; `n < 3` → `70`; else `100 × completed / n` | "Limited history: …" when `n < 3` |
| `beneficiary_demand` | `100 × beneficiaries_count / max(beneficiaries_count over all candidates)`; `0` if all are zero | "Beneficiary count not reported: scored as 0." when null |

Worked example (the contract example, verified by a unit test): 3.2 km of a
10 km radius → 68; open need → 100; capacity 150 for 120 → 100; HOT_HELD → 100;
HIGH → 75; travel 9.6 min (estimated), slack 170.4 min → 100; 12 of 13 → 92.31;
only candidate → 100. Score = 13.6 + 20 + 15 + 10 + 11.25 + 10 + 4.615 + 5 = **89.47**.

---

## 4. Donor matching (`POST /ai/match-donors`): ranking donors for an NGO request

Inputs per candidate: `distance_m`, `distance_source`, `max_radius_m`,
`available_matching_quantity` (diet- and category-compatible food listed now),
`predicted_surplus`, `historical_avg_surplus`, `produces_category`,
`availability_overlap_minutes`, `needed_window_minutes`, `reliability`.
Request: `quantity_remaining`, `urgency`, `beneficiaries_count`.

| Criterion | Formula | Limitation added |
|---|---|---|
| `distance` | `100 × max(0, 1 − distance_m / max_radius_m)` | straight-line note as above |
| `food_requirement` | `100` if `available_matching_quantity > 0`; `70` if `produces_category`; else `40` | |
| `quantity_capacity` | `expected = max(available_matching_quantity, predicted_surplus or 0, historical_avg_surplus or 0)`; all zero/null → `0`; else `100 × min(1, expected / quantity_remaining)` | "No quantity evidence: …" when all are zero; "Quantity is a forecast/historical estimate — the donor must confirm actual food." when `expected` comes from the forecast or history rather than listed food |
| `food_preference` | `100` if `available_matching_quantity > 0` (backend counts only diet-compatible food), else `60` | "Dietary compatibility unconfirmed: …" |
| `urgency` | request urgency: CRITICAL `100`, HIGH `75`, MEDIUM `50`, LOW `25` | |
| `pickup_availability` | `availability_overlap_minutes` null → `50`; else `100 × min(1, overlap / needed_window_minutes)` | "Donor availability not configured: …" when null |
| `reliability` | as for NGOs | as for NGOs |
| `beneficiary_demand` | `100 × min(1, beneficiaries_count / 200)` | |

`urgency` and `beneficiary_demand` describe the request, so they are equal for
every donor: they shift every score equally and never change the order.

---

## 5. Explanations

Explanations are produced by a deterministic template, not by an LLM.

1. **Reasons.** Each criterion can supply a plain-language phrase. A phrase is
   eligible when the criterion's weight is > 0 and its score is ≥ 60. Eligible
   phrases are sorted by contribution (weight × score), ties by the fixed
   criterion order, and the top **3** are joined:
   `"<name> is recommended because it <a>, <b> and <c>."`
   Examples: "needs 100 vegetarian meals (urgency HIGH)", "can take the full
   quantity", "is 3.2 km away (straight-line estimate)", "can collect well
   before the deadline", "has completed 12 of 13 past collections".
   Phrases that would not distinguish candidates (no cold-chain requirement,
   request-level urgency) are never used as reasons. The NGO's urgency is
   named inside the need phrase.
2. **Drawback.** The weighted criterion with the lowest score below 50 adds
   `"Main drawback: it <phrase>."` (e.g. "has capacity for only 30 of the 120 meals").
3. **Estimates.** For donor matching, when the donor has no food listed now,
   the explanation ends with: "No food is confirmed yet: quantities shown are
   estimates, and the donor must confirm actual food before anything is
   reserved." Forecast- or history-based quantities are always phrased with
   "(an estimate, not confirmed food)".
4. If no criterion qualifies as a reason: "<name> has no single strong
   factor; its rank reflects the combined weighted score."

Each result also carries `limitations` (deduplicated, in the order raised).

---

## 6. Limitations of the ranking

- Weights are initial judgement calls, not fitted to outcomes.
- Straight-line distance underestimates real travel, especially across rivers,
  rail lines or one-way systems; the 20 km/h urban speed is a rough average.
- Reliability uses only completed vs failed counts, without recency weighting.
- `beneficiary_demand` for NGOs is relative to the other candidates in the
  same run, so the same NGO can score differently in different runs.
- Donor quantity can rest on a forecast trained on **synthetic** data (see
  [AI_MODEL_EVALUATION.md](AI_MODEL_EVALUATION.md)); it is always labelled as an estimate.

## 7. Fallback when the AI service is unavailable

The backend calls the AI service with a 5 s timeout and one retry. If that
fails, the backend **sorts the eligible candidates by distance ascending** and
labels the result **"ranking unavailable"** (`ai.status = "unavailable"`).
There is deliberately no second scorer in Node: the fallback is a plain,
clearly labelled distance order (decision D4 in SYSTEM_ARCHITECTURE.md).

---

## 8. Allocation optimiser (`POST /ai/allocate-food`)

Recommends integer quantities from supplies (e.g. donations) to demands (e.g.
NGO requests) over the allowed edges. The backend validates and executes; a
person confirms.

**Variables** for each provided edge `e = (s, d)`:
`x_e ∈ ℤ, 0 ≤ x_e ≤ cap_e` with `cap_e = min(edge.max_quantity, supply_s, demand_d)`,
and a binary `y_e` (edge used).

**Constraints**

```
x_e ≤ cap_e · y_e
x_e ≥ min_quantity_d · y_e          (x_e = 0 or x_e ≥ min_quantity_d)
Σ_d x_(s,d) ≤ supply_s               for every supply s
Σ_s x_(s,d) ≤ demand_d               for every demand d
```

Edges with `cap_e < min_quantity_d` can never carry food and are removed up
front (with a reason). Only listed edges may carry quantity.

**Lexicographic objective**, solved with OR-Tools CP-SAT in three stages. Each
stage fixes the previous optimum as a constraint and warm-starts from the
previous solution:

1. maximise total allocated `Σ x_e`;
2. maximise score-weighted quantity `Σ round(100 · score_e) · x_e`;
3. minimise the number of used edges `Σ y_e` (fewer pickups).

The solver runs single-threaded with a fixed seed, so results are reproducible.
`time_limit_s` (≤ 10) is shared by the stages.

**Status:** `OPTIMAL` (every stage proven optimal), `FEASIBLE` (time limit
reached after a solution was found), `TIMEOUT` (no solution within the limit),
`NO_FEASIBLE_ALLOCATION` (nothing can be allocated). Reasons are concrete, e.g.
"No edges were provided…", "Edge s1 -> d2 can carry at most 8, below demand d2's
minimum of 10…", "Total supply 100 is less than total demand 130…".

`unallocated_supply` lists every supply (0 when fully used); `unmet_demand`
lists only demands with a remaining quantity > 0.

## 9. Route optimiser (`POST /ai/optimize-route`)

Single-vehicle pickup routing with time windows and capacity (VRPTW) using
OR-Tools routing. Times are seconds from plan start; matrices come from the
backend (Google Routes or straight-line estimates).

- **Time dimension:** `transit(i, j) = service_time_i + duration_ij`. Waiting
  is allowed. Each stop's service must start within `[window_start_s, window_end_s]`
  (missing bounds = open). Start/end windows constrain departure/return.
- **Capacity dimension:** load increases by each pickup's `demand`;
  load ≤ `vehicle_capacity`.
- **Optional stops:** every pickup is a disjunction with penalty
  `(Σ_i max_j duration_ij + 1) × (1 + demand)`, which exceeds any route's total
  travel cost, so the solver serves as much quantity as possible and returns a
  partial plan when not everything fits.
- **Objective:** minimise travel duration plus drop penalties.
- **Search:** greedy-descent local search from 8 first-solution strategies
  (path-cheapest-arc, parallel/local cheapest insertion, savings, global/local
  cheapest arc, first-unbound, Christofides); the best objective wins, ties keep
  the earlier strategy. This is deterministic and, on randomised 40-stop test
  instances, outperformed 3 s of guided local search.
- **Schedule:** the earliest feasible schedule for the chosen order is
  computed, then departure is delayed as far as possible without arriving at
  the end later (removes pointless waiting). `arrival_s` is the planned
  service start; the vehicle may arrive earlier and wait.
- **Status:** `PARTIAL` (some pickups dropped), `INFEASIBLE` (no pickup can be
  served, or not even start→end is feasible), `TIMEOUT` (no route within the
  limit), `OPTIMAL` (all pickups served and, for ≤ 7 stops, an exhaustive check
  confirms no visiting order has lower travel time), otherwise `FEASIBLE`
  (heuristic; optimality not proven).
- **Dropped-stop reasons**, checked in order: "demand 150 exceeds vehicle
  capacity 120"; "time window ends before earliest possible arrival (1500s >
  1200s)" (direct trip from the start); visiting the stop would miss the end
  window; "total demand 160 exceeds vehicle capacity 120 (80 already collected
  on the route + 80 at this stop)"; otherwise "no position in the route reaches
  it within its time window … without making another stop miss its window".
- `distance_source` is echoed. For `STRAIGHT_LINE_ESTIMATE`, the explanation
  and reasons state that travel times and distances are estimates, not road data.

The backend's `collection_plans.solver_status` has no `PARTIAL` value; the
backend should store `FEASIBLE` together with the dropped-stop reasons in
`infeasibility_reasons` (or extend the enum).
