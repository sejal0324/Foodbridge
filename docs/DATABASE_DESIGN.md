# FoodBridge AI: Database Design

> **Status:** Implemented. Migrations `0001`–`0012` in [`database/migrations/`](../database/migrations/)
> are authoritative; a generated schema snapshot is in [`database/schema/schema.sql`](../database/schema/schema.sql).
> §0 lists every change made during implementation relative to the Phase 0 design below.
> Diagrams: [ER_DIAGRAM.md](ER_DIAGRAM.md) · Architecture: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)

---

## 0. Changes made during implementation

| Area | Change | Reason |
|---|---|---|
| Units and quantities | Units are `MEALS`, `PACKETS` and `BOXES` only; all quantities are `integer` | Confirmed business rules: fees and points are per meal, packet or box |
| Rewards | `reward_rules(unit, basis PER_UNIT\|PER_ORDER, points, lifetime_threshold, effective_from/to, is_active)` with progressive lifetime brackets. Seed: MEALS 10 from 0, MEALS 15 after 500, PACKETS 10 per order, BOXES 10 per order. `reward_balances` adds `lifetime_meals` and `lifetime_orders`; `reward_transactions` adds `unit`, `quantity` and `calculation` | Confirmed reward rules (see REWARD_SYSTEM.md) |
| Fees | `service_fee_rules(unit, amount_per_unit)`, seeded at ₹5 for each unit. `ngo_billing` stores `unit_amount`, `base_amount`, `tax_name`, `tax_rate_percent`, `tax_amount` and `total_amount`, with CHECKs `base = unit × qty` and `total = base + tax`, plus a unique `handover_record_id`. Tax lives in `platform_settings['billing.tax']` (disabled by default) | ₹5 per unit, with tax kept separate and configurable |
| `account_tokens` ➕ | Single-use invitation and password-reset tokens (hashed) | Representative invitations and password reset (the 54th table) |
| `donations` | Added `expired_quantity` | Records unreserved quantity that expired at the deadline |
| `donation_allocations` | Added `cancelled_by_party` (`DONOR`, `NGO`, `ADMIN`, `SYSTEM`) | Reliability scoring must not blame an NGO for a donor's cancellation |
| `match_recommendations` | Added `ranking_status` (`RANKED`, `RANKING_UNAVAILABLE`, `NOT_RANKED`) | Honest labelling of the deterministic fallback |
| `surplus_predictions` | Added `status` (`OK`, `INSUFFICIENT_HISTORY`), `basis` and `input_summary` | A forecast is never guessed |
| `model_versions` | `first_seen_at` instead of `trained_at` being required | Versions are recorded from the AI service on first use |
| Pickup | `pickup_verifications` failure reasons extended (`PICKUP_NOT_ACTIVE`, `QR_NOT_VERIFIED`); `pickup_assignments` status adds `DISPUTED`; `disputes.handover_record_id` | Precise audit and dispute linkage |
| Pickup verification (migration `0012_remove_pickup_otp.sql`) | Drops `otp_verifications` (with its indexes and FKs), `pickup_assignments.otp_verified_at` and the `otp.policy` setting; `VERIFIED`, `HANDED_OVER`, `IN_TRANSIT` and `DELIVERED` now require `qr_verified_at` and `identity_confirmed_at`. The Down section restores the 0007/0011 definitions | The product owner removed the OTP step on 2026-11-04: verification is QR pass + photo-ID check + two-way confirmation |
| Tracking | `tracking_sessions.points_purged_at`; `tracking_events.pickup_assignment_id` (so a permission denial can be recorded before a session exists); event types `POSITION_UNAVAILABLE`, `STALE` | Retention bookkeeping; consent edge cases |
| Planning | `collection_plans.start_time`, `explanation`, `solver_status` (adds `PARTIAL`, `UNAVAILABLE`); `collection_stops.status` (adds `DROPPED`) and `drop_reason` | Infeasible stops are explained, never hidden |
| Invoices and payments | Sequences `invoice_number_seq` and `impact_certificate_number_seq`; unique invoice per NGO and period; `payments.reference_note`; MANUAL payments require `recorded_by` | Idempotent invoicing, audited offline payments |
| Notifications | `notification_preferences.push_enabled` removed (browser notifications are shown client-side only while the app is open) | Web Push is future work |
| Settings | Added `platform.demo_data` | Analytics label demo seed data |

## 1. Platform

| Item | Choice |
|---|---|
| Engine | PostgreSQL 18 (Docker image `postgis/postgis:18-3.6`) |
| Extensions | `postgis` (geography), `citext` (case-insensitive email) |
| Migrations | `node-pg-migrate`, files in `database/migrations/`, run from the backend |
| Time | Every timestamp is `timestamptz`, stored in UTC; the server and sessions run in UTC |

---

## 2. Conventions

| Topic | Rule |
|---|---|
| Primary keys | `id uuid DEFAULT gen_random_uuid()` for business entities. Append-only, high-volume logs use `id bigint GENERATED ALWAYS AS IDENTITY` |
| Foreign keys | Always declared. Default `ON DELETE RESTRICT`. `CASCADE` only for pure child detail rows (sessions, join tables, location points, plan stops, delivery logs) |
| Status columns | `text` plus a named `CHECK (status IN (…))`. Allowed *transitions* are enforced by backend state machines (§7), and every transition writes history/audit rows in the same transaction |
| Quantities | `integer`, `CHECK (> 0)`. Units are countable (meals, packets, boxes), so quantities are whole numbers |
| Money | `numeric(12,2)` plus `currency char(3) DEFAULT 'INR'` |
| Points | `integer` |
| Location | `geography(Point, 4326)` with a GiST index. The API exchanges `{ lat, lng }` |
| Timestamps | `created_at timestamptz NOT NULL DEFAULT now()`; `updated_at` maintained by the trigger `set_updated_at()` |
| Soft deletion | `deleted_at timestamptz` on users, donors, ngos, ngo_representatives, donations, food_assistance_requests, ai_conversations. Uniqueness uses partial indexes `WHERE deleted_at IS NULL` |
| Immutability | Ledgers and logs have a `BEFORE UPDATE OR DELETE` trigger, `forbid_mutation()`, that raises an error |
| Optimistic locking | `version integer NOT NULL DEFAULT 1` on user-editable aggregates (donations, assistance requests) |
| Secrets | Never stored raw. Passwords use Argon2id; refresh tokens and QR tokens are stored as SHA-256 hashes. No payment card data is ever stored |
| Naming | snake_case, plural table names, `<entity>_id` for foreign keys, `idx_<table>__<cols>`, `uq_<table>__<cols>` |

### 2.1 Shared value sets

| Name | Values |
|---|---|
| `role` | `DONOR`, `NGO`, `ADMIN` |
| `account_status` | `INVITED`, `ACTIVE`, `SUSPENDED`, `DEACTIVATED` |
| `verification_status` | `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED` |
| `quantity_unit` | `MEALS`, `PACKETS`, `BOXES` (confirmed business decision, 2026-11-03) |
| `dietary_type` (food) | `VEG`, `NON_VEG` |
| `dietary_requirement` (NGO request) | `VEG_ONLY`, `ANY` |
| `storage_type` | `ROOM_TEMPERATURE`, `REFRIGERATED`, `FROZEN`, `HOT_HELD` |
| `urgency` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `meal_period` | `BREAKFAST`, `LUNCH`, `DINNER`, `ALL_DAY` |
| `data_label` | `REAL`, `SYNTHETIC`, `MIXED` |

---

## 3. Table inventory by phase

53 tables. The spec's tables are kept with the names it gives. Nine tables
were **added**, marked ➕ (justification in §5).

| Phase | Domain | Tables |
|---|---|---|
| 1 | Foundation | `platform_settings` ➕, `audit_logs`, `idempotency_records`, `jobs` ➕ |
| 2 | Identity and organisations | `users`, `user_sessions` ➕, `admin_profiles`, `food_categories`, `donors`, `donor_availability` ➕, `donor_food_categories` ➕, `ngos`, `ngo_food_preferences` ➕, `ngo_representatives`, `verification_documents` |
| 3 | Donations | `donations`, `donation_status_history`, `donation_requests`, `donation_allocations` |
| 3 | Assistance | `food_assistance_requests`, `assistance_offers`, `assistance_request_history` |
| 3 | Notifications | `notifications`, `notification_preferences`, `notification_logs` |
| 5 | AI | `restaurant_daily_metrics`, `model_versions`, `surplus_predictions`, `match_recommendations` |
| 6 | Assistant | `ai_conversations` ➕, `ai_interactions` |
| 7 | Pickup and handover | `pickup_assignments`, `pickup_tokens`, `pickup_verifications`, `handover_records`, `delivery_confirmations`, `disputes` ➕ |
| 8 | Tracking | `tracking_sessions`, `location_updates`, `tracking_events` |
| 9 | Rewards | `reward_rules`, `reward_tiers`, `reward_balances`, `reward_transactions`, `impact_certificates` ➕ |
| 9 | Billing | `service_fee_rules`, `ngo_billing`, `invoices`, `payments` |
| 10 | Collection planning | `collection_plans`, `collection_stops` |
| 11 | Insights | `ai_insights` |

---

## 4. Table definitions

Column notes: **PK** primary key, **FK** foreign key, **U** unique, **NN** not
null. `created_at` / `updated_at` are omitted where they follow the convention.

### 4.1 Foundation (Phase 1)

**`platform_settings`**: admin-configurable operational policy. Changes are audited.

| Column | Type | Notes |
|---|---|---|
| key | text | PK, e.g. `matching.weights`, `matching.max_radius_km`, `pickup.qr_ttl_minutes`, `tracking.stale_after_seconds`, `notifications.max_per_hour` |
| value | jsonb | NN, validated by a backend schema per key |
| description | text | |
| updated_by | uuid | FK users (added in Phase 2) |
| updated_at | timestamptz | |

**`audit_logs`**: append-only (`forbid_mutation`).

| Column | Type | Notes |
|---|---|---|
| id | bigint identity | PK |
| occurred_at | timestamptz | NN default now() |
| actor_type | text | `USER`, `SYSTEM`, `SERVICE` |
| actor_user_id | uuid | FK users, nullable for system actions |
| actor_role | text | snapshot of the role at the time |
| action | text | NN, dotted verb, e.g. `donation.status_changed`, `pickup.qr_verified`, `tracking.admin_viewed` |
| entity_type / entity_id | text / uuid | the subject of the action |
| changes | jsonb | redacted before/after values |
| metadata | jsonb | |
| request_id, ip, user_agent | text / inet / text | |

Indexes: `(entity_type, entity_id, occurred_at)`, `(actor_user_id, occurred_at)`, `(action, occurred_at)`.

**`idempotency_records`**

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| scope | text | NN, e.g. `POST /api/donations`, `razorpay.webhook` |
| key | text | NN, the client `Idempotency-Key` (namespaced by user) or the provider event id |
| user_id | uuid | FK users, nullable (webhooks have no user) |
| request_hash | text | NN, SHA-256 of the canonical request body. A different body with the same key returns `422` |
| status | text | `IN_PROGRESS`, `COMPLETED`, `FAILED` |
| response_status / response_body | int / jsonb | replayed on retry |
| expires_at | timestamptz | NN |

`UNIQUE (scope, key)`.

**`jobs`** ➕: Postgres-backed queue and outbox.

| Column | Type | Notes |
|---|---|---|
| id | bigint identity | PK |
| type | text | NN, e.g. `match-donation` |
| payload | jsonb | NN |
| status | text | `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `DEAD` |
| attempts / max_attempts | int | `CHECK (attempts <= max_attempts)` |
| run_at | timestamptz | NN, next eligible run time |
| locked_at / locked_by | timestamptz / text | worker lease |
| last_error | text | |
| dedupe_key | text | U (nullable), prevents enqueueing the same job twice |

Index: `(status, run_at)`.

### 4.2 Identity and organisations (Phase 2)

**`users`**

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| email | citext | NN, `uq_users__email WHERE deleted_at IS NULL` |
| password_hash | text | Argon2id. Nullable only while `account_status = 'INVITED'` |
| role | text | NN, `DONOR` / `NGO` / `ADMIN`. Never taken from client input |
| account_status | text | NN default `ACTIVE` |
| full_name | text | NN |
| phone | text | E.164 format CHECK |
| email_verified_at | timestamptz | |
| failed_login_attempts | int | NN default 0, `CHECK (>= 0)` |
| locked_until, last_login_at, password_changed_at | timestamptz | |
| deleted_at | timestamptz | soft delete |

**`user_sessions`** ➕: one row per refresh token; rotation chain.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK (`sid` claim in the access token) |
| user_id | uuid | FK users, CASCADE |
| family_id | uuid | NN, all rotations of one login. Reuse of a rotated token revokes the family |
| refresh_token_hash | text | NN U, SHA-256 |
| expires_at | timestamptz | NN |
| last_used_at, revoked_at | timestamptz | |
| revoked_reason | text | `LOGOUT`, `ROTATED`, `REUSE_DETECTED`, `ADMIN`, `PASSWORD_CHANGED` |
| replaced_by_session_id | uuid | FK user_sessions |
| ip, user_agent | inet, text | |

Index: `(user_id) WHERE revoked_at IS NULL`.

**`admin_profiles`**: created only by the provisioning CLI.

| Column | Type | Notes |
|---|---|---|
| user_id | uuid | PK, FK users (role must be ADMIN; checked by the backend) |
| admin_level | text | `SUPER_ADMIN`, `ADMIN` |
| created_by | uuid | FK users, nullable for the bootstrap admin |

**`food_categories`**: reference data seeded by migration. Admins can configure it.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| code | text | NN U, e.g. `COOKED_MEALS`, `BAKERY`, `FRUITS_VEGETABLES`, `DAIRY`, `PACKAGED_FOOD`, `BEVERAGES`, `RAW_INGREDIENTS` |
| name, description | text | |
| max_hours_after_preparation | int | nullable. Configurable handling guideline used **only to flag** listings, never to certify safety |
| requires_refrigeration | boolean | NN default false |
| is_active | boolean | NN default true |
| sort_order | int | |

**`donors`**: a food business. One owner user in v1.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| owner_user_id | uuid | NN U, FK users (role DONOR) |
| business_name | text | NN |
| business_type | text | `RESTAURANT`, `HOTEL`, `CAFETERIA`, `CATERER`, `FOOD_BUSINESS`, `OTHER` |
| license_number | text | e.g. FSSAI licence number |
| contact_email / contact_phone | citext / text | |
| address_line, city, state, postal_code | text | |
| country | char(2) | default `IN` |
| location | geography(Point,4326) | required before publishing donations |
| timezone | text | default `Asia/Kolkata` |
| verification_status | text | NN default `PENDING` |
| verification_notes, verified_at, verified_by | text, timestamptz, uuid FK users | |
| accepts_assistance_requests | boolean | NN default true |
| paused_until | timestamptz | "mark myself unavailable" |
| public_recognition_consent | boolean | NN default false (gates public leaderboards/featured profiles) |
| deleted_at | timestamptz | |

Indexes: GiST `(location)`, `(verification_status)`.

**`donor_availability`** ➕: weekly operating windows used by matching.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| donor_id | uuid | FK donors, CASCADE |
| iso_day_of_week | smallint | `CHECK (BETWEEN 1 AND 7)` |
| opens_at / closes_at | time | `CHECK (closes_at > opens_at)`. Overnight windows are stored as two rows |

`UNIQUE (donor_id, iso_day_of_week, opens_at)`.

**`donor_food_categories`** ➕: what the donor typically produces (used to match assistance requests).
PK `(donor_id, category_id)`. FKs CASCADE / RESTRICT.

**`ngos`**

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| owner_user_id | uuid | NN U, FK users (role NGO) |
| organization_name | text | NN |
| registration_number | text | e.g. NGO Darpan ID / trust or society registration |
| contact_email / contact_phone, address fields, country, timezone | | as for donors |
| location | geography(Point,4326) | required before requesting food |
| accepts_veg / accepts_non_veg | boolean | NN, `CHECK (accepts_veg OR accepts_non_veg)` |
| max_daily_capacity | numeric(10,2) | `CHECK (> 0)` |
| capacity_unit | text | quantity_unit |
| collection_radius_km | numeric(6,2) | NN, `CHECK (> 0 AND <= 100)` |
| beneficiaries_count | int | `CHECK (>= 0)` |
| beneficiary_description | text | |
| has_refrigeration | boolean | NN default false (a handling condition used in eligibility) |
| default_vehicle_capacity | numeric(10,2) | for collection planning |
| verification_status, verification_notes, verified_at, verified_by | | as for donors |
| deleted_at | timestamptz | |

Indexes: GiST `(location)`, `(verification_status)`.

**`ngo_food_preferences`** ➕: categories an NGO accepts (hard filter). PK `(ngo_id, category_id)`.

**`ngo_representatives`**: people authorised to collect food for an NGO. Each has their own login.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| ngo_id | uuid | NN, FK ngos |
| user_id | uuid | NN U, FK users (role NGO). A user represents at most one NGO |
| id_document_type | text | `AADHAAR`, `PAN`, `DRIVING_LICENCE`, `VOTER_ID`, `OTHER` |
| id_document_last4 | char(4) | **only** the last 4 characters, shown to the donor during the physical ID check |
| photo_storage_key | text | private object key, served only to the donor of an active pickup |
| status | text | `ACTIVE`, `INACTIVE`, `REVOKED` |
| added_by | uuid | FK users |
| deleted_at | timestamptz | |

An NGO owner who collects food personally adds themselves as a representative.

**`verification_documents`**

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| donor_id / ngo_id | uuid | FKs, `CHECK (num_nonnulls(donor_id, ngo_id) = 1)` |
| document_type | text | `BUSINESS_LICENCE`, `FSSAI_LICENCE`, `NGO_REGISTRATION`, `TAX_EXEMPTION`, `ID_PROOF`, `OTHER` |
| storage_key | text | NN, private storage path, never a public URL |
| original_filename | text | sanitised |
| mime_type | text | `CHECK IN ('application/pdf','image/jpeg','image/png')`, verified by file signature, not by extension |
| size_bytes | int | `CHECK (> 0 AND <= 10485760)` |
| sha256 | char(64) | NN |
| status | text | `PENDING`, `ACCEPTED`, `REJECTED` |
| review_notes, reviewed_by, reviewed_at | | |
| uploaded_by | uuid | FK users |

### 4.3 Donations (Phase 3)

**`donations`**: actual, donor-confirmed food. Never created from a prediction.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| donor_id | uuid | NN, FK donors |
| origin | text | NN, `DIRECT_LISTING` (shown in the marketplace) or `ASSISTANCE_OFFER` (created when an accepted offer is confirmed; not listed publicly) |
| food_name | text | NN, 2–120 characters |
| category_id | uuid | NN, FK food_categories |
| dietary_type | text | NN |
| quantity | numeric(10,2) | NN, `CHECK (> 0)` |
| unit | text | NN, quantity_unit |
| reserved_quantity | numeric(10,2) | NN default 0, `CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity)`. This is the **over-allocation backstop** |
| prepared_at | timestamptz | NN |
| best_before | timestamptz | optional (packaged food) |
| storage_type / storage_notes | text | |
| pickup_available_from | timestamptz | NN |
| pickup_deadline | timestamptz | NN, `CHECK (pickup_deadline > pickup_available_from AND pickup_deadline > prepared_at)` |
| location / address | geography / text | NN |
| description | text | |
| safety_confirmed | boolean | NN default false |
| safety_confirmed_at | timestamptz | `CHECK (status = 'DRAFT' OR (safety_confirmed AND safety_confirmed_at IS NOT NULL))` |
| status | text | see §7.1 |
| cancelled_reason | text | |
| version | int | optimistic locking |
| deleted_at | timestamptz | |

Indexes: GiST `(location) WHERE status IN ('AVAILABLE','PARTIALLY_RESERVED') AND deleted_at IS NULL`;
`(donor_id, created_at DESC)`; `(status, pickup_deadline)` for the expiry job.

**`donation_status_history`**: append-only.
`id bigint`, `donation_id` FK, `from_status`, `to_status` (NN), `changed_by` (FK users, nullable = system), `reason`, `metadata jsonb`, `created_at`.

**`donation_requests`**: an NGO asks for some or all of a listed donation.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| donation_id | uuid | NN, FK donations |
| ngo_id | uuid | NN, FK ngos |
| requested_by | uuid | NN, FK users |
| requested_quantity | numeric(10,2) | NN, `CHECK (> 0)` |
| approved_quantity | numeric(10,2) | `CHECK (approved_quantity > 0 AND approved_quantity <= requested_quantity)`. The donor may approve part of it |
| message | text | |
| status | text | `PENDING`, `APPROVED`, `REJECTED`, `WITHDRAWN`, `CANCELLED`, `EXPIRED` |
| decided_by, decided_at, decision_reason | | |

`uq_donation_requests__active`: `UNIQUE (donation_id, ngo_id) WHERE status IN ('PENDING','APPROVED')`, so an NGO can have only one live request per donation.

**`donation_allocations`**: the **unit of collection**. Both workflows converge here,
and pickups, verification, tracking, rewards and billing all hang off an allocation.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| donation_id | uuid | NN, FK donations |
| ngo_id | uuid | NN, FK ngos |
| quantity | numeric(10,2) | NN, `CHECK (> 0)`, in the donation's unit |
| source | text | NN, `DONATION_REQUEST` or `ASSISTANCE_OFFER` |
| donation_request_id | uuid | U, FK donation_requests |
| assistance_offer_id | uuid | U, FK assistance_offers |
| status | text | see §7.4 |
| handed_over_quantity | numeric(10,2) | the confirmed handover quantity (basis for points and fees) |
| completed_at, cancelled_at, cancel_reason | | |

Checks: `(source = 'DONATION_REQUEST') = (donation_request_id IS NOT NULL)`,
`(source = 'ASSISTANCE_OFFER') = (assistance_offer_id IS NOT NULL)`,
`num_nonnulls(donation_request_id, assistance_offer_id) = 1`.
The unique FKs make double approval of the same request or offer impossible.
Indexes: `(donation_id)`, `(ngo_id, status)`.

Invariant (backend-maintained, verified by tests and a periodic consistency check):
`donations.reserved_quantity = SUM(quantity) of its allocations in a non-cancelled, non-expired status`.

### 4.4 NGO assistance (Phase 3)

**`food_assistance_requests`**

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| ngo_id | uuid | NN, FK ngos |
| created_by | uuid | NN, FK users |
| category_id | uuid | NN, FK food_categories |
| dietary_requirement | text | NN, `VEG_ONLY` or `ANY` |
| quantity_required | numeric(10,2) | NN, `CHECK (> 0)` |
| unit | text | NN |
| quantity_committed | numeric(10,2) | NN default 0, `CHECK (quantity_committed >= 0 AND quantity_committed <= quantity_required)`. This is the **over-commitment backstop** |
| quantity_received | numeric(10,2) | NN default 0, `CHECK (>= 0)` |
| needed_from / needed_until | timestamptz | NN, `CHECK (needed_until > needed_from)` (the required date and time window) |
| location / address | geography / text | NN |
| urgency | text | NN |
| beneficiaries_count | int | NN, `CHECK (> 0)` |
| reason, additional_requirements | text | |
| status | text | see §7.2 |
| version | int | |
| cancelled_at, deleted_at | timestamptz | |

Indexes: GiST `(location) WHERE status IN ('OPEN','PARTIALLY_FULFILLED')`; `(ngo_id, created_at DESC)`; `(status, needed_until)`.

**`assistance_offers`**: a donor's response to a request. Each offer has its own lifecycle.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| assistance_request_id | uuid | NN, FK food_assistance_requests |
| donor_id | uuid | NN, FK donors |
| created_by | uuid | NN, FK users |
| offered_quantity | numeric(10,2) | NN, `CHECK (> 0)` |
| accepted_quantity | numeric(10,2) | `CHECK (> 0 AND <= offered_quantity)`. The NGO may accept less than offered if less is still needed |
| confirmed_quantity | numeric(10,2) | `CHECK (> 0 AND <= accepted_quantity)`. The donor's confirmation of **actual** food |
| food_name, category_id, dietary_type | | |
| pickup_available_from / pickup_deadline | timestamptz | |
| location / address | geography / text | defaults to the donor's location |
| notes | text | |
| status | text | see §7.3 |
| donation_id | uuid | U, FK donations, set when the offer becomes `RESERVED` |
| responded_by, responded_at, rejection_reason | | |

`uq_assistance_offers__active`: `UNIQUE (assistance_request_id, donor_id) WHERE status IN ('PROPOSED','ACCEPTED','RESERVED','PICKUP_ASSIGNED')`.
Donor responses of "decline" and "unavailable" are stored on `match_recommendations.response`, not as offers.

**`assistance_request_history`**: append-only.
`id bigint`, `assistance_request_id` FK, `assistance_offer_id` FK nullable, `event_type`
(`CREATED`, `UPDATED`, `OFFER_PROPOSED`, `OFFER_ACCEPTED`, `OFFER_REJECTED`, `OFFER_RESERVED`,
`OFFER_CANCELLED`, `STATUS_CHANGED`, …), `from_status`, `to_status`, `quantity_delta`,
`actor_user_id`, `metadata`, `created_at`.

### 4.5 Notifications (Phase 3)

**`notifications`**: the in-app record. This row *is* the in-app channel.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | NN, FK users |
| type | text | NN, e.g. `DONATION_MATCH`, `ASSISTANCE_MATCH`, `REQUEST_RECEIVED`, `REQUEST_APPROVED`, `PICKUP_ASSIGNED` |
| title / body | text | NN |
| data | jsonb | structured payload for cards |
| link_path | text | relative application path only: `CHECK (link_path ~ '^/([^/\\]|$)')`. Rejects `//host` and `/\host`, which browsers treat as links to other sites (open redirect) |
| priority | text | `LOW`, `NORMAL`, `HIGH` |
| dedupe_key | text | NN, e.g. `donation-match:{donationId}` |
| read_at, expires_at | timestamptz | |

`UNIQUE (user_id, dedupe_key)` prevents duplicate notifications. Index `(user_id, created_at DESC)`.

**`notification_preferences`**: PK `user_id`; `email_enabled`, `push_enabled` (boolean);
`max_per_hour` (int, `CHECK (BETWEEN 1 AND 100)`); `max_distance_km` (numeric, nullable);
`quiet_hours_start` / `quiet_hours_end` (time). Category preferences come from
`ngo_food_preferences` / `donor_food_categories`, so they are not duplicated here.

**`notification_logs`**: one row per external delivery attempt channel.
`id bigint`, `notification_id` FK CASCADE, `channel` (`SOCKET`, `EMAIL`, `PUSH`),
`status` (`PENDING`, `SENT`, `FAILED`, `SKIPPED`), `attempt_count`, `next_attempt_at`,
`last_error`, `provider_message_id`. `UNIQUE (notification_id, channel)`.

### 4.6 AI intelligence (Phases 5, 6, 11)

**`restaurant_daily_metrics`**: training data and features for forecasting.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| donor_id | uuid | NN, FK donors |
| metric_date | date | NN |
| meal_period | text | NN |
| unit | text | NN default `MEALS` |
| prepared_qty / sold_qty / surplus_qty | numeric(10,2) | NN, `>= 0`; `CHECK (sold_qty <= prepared_qty AND surplus_qty <= prepared_qty)` |
| is_holiday | boolean | NN default false |
| special_event | text | |
| data_source | text | NN, `DONOR_ENTERED`, `IMPORTED`, `SYNTHETIC` (**synthetic rows are always labelled**) |

`UNIQUE (donor_id, metric_date, meal_period)`.

**`model_versions`**: `id`, `model_name` (e.g. `surplus_forecaster`), `version`, `algorithm`,
`trained_at`, `training_data_label` (data_label), `training_rows`, `metrics jsonb`
(MAE/RMSE for the model **and** the baseline on a chronological test split), `features jsonb`,
`artifact_sha256`, `is_active`, `notes`. `UNIQUE (model_name, version)`;
`UNIQUE (model_name) WHERE is_active`.

**`surplus_predictions`**: `id`, `donor_id` FK, `target_date`, `meal_period`,
`predicted_quantity` (`>= 0`), `lower_bound`, `upper_bound`, `unit`, `model_version_id` FK,
`input_features jsonb`, `data_label`, `created_at`. Index `(donor_id, target_date)`.
A prediction never creates a donation.

**`match_recommendations`**: every evaluated candidate with its explanation.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| run_id | uuid | NN, groups one matching run |
| subject_type | text | `DONATION` or `ASSISTANCE_REQUEST` |
| donation_id / assistance_request_id | uuid | FKs; exactly one, consistent with subject_type |
| candidate_ngo_id / candidate_donor_id | uuid | FKs; exactly one |
| eligible | boolean | NN |
| ineligibility_reasons | text[] | e.g. `CATEGORY_NOT_ACCEPTED`, `OUTSIDE_RADIUS`, `CAPACITY_EXCEEDED` |
| score | numeric(5,2) | `CHECK (score BETWEEN 0 AND 100)`, null when ineligible |
| rank | int | |
| criteria | jsonb | per-criterion score (0–100), weight and contribution |
| explanation | text | human-readable reason |
| limitations | text[] | e.g. "distance is a straight-line estimate" |
| distance_m / travel_time_s | numeric / int | |
| distance_source | text | `STRAIGHT_LINE_ESTIMATE` or `ROAD_GOOGLE_ROUTES` |
| algorithm_version / weights | text / jsonb | snapshot, e.g. `weighted-v1` |
| notified_at, notification_id | | |
| response | text | `NONE`, `REQUESTED`, `OFFERED`, `DECLINED`, `UNAVAILABLE` |
| responded_at | timestamptz | |

`UNIQUE (run_id, candidate_ngo_id, candidate_donor_id)` (NULLS NOT DISTINCT).

**`ai_conversations`** ➕: `id`, `user_id` FK, `title`, timestamps, `deleted_at`.

**`ai_interactions`**: `id bigint`, `conversation_id` FK, `user_id` FK, `role`
(`USER`, `ASSISTANT`, `TOOL`), `content`, `tool_name`, `tool_arguments jsonb`,
`tool_result_summary jsonb` (minimised), `pending_action jsonb`, `action_status`
(`PENDING`, `CONFIRMED`, `CANCELLED`, `EXPIRED`), `provider`, `model`, `prompt_tokens`,
`completion_tokens`, `latency_ms`, `status` (`OK`, `ERROR`, `UNAVAILABLE`), `created_at`.
Retention: `AI_INTERACTION_RETENTION_DAYS`.

**`ai_insights`** (Phase 11): `id`, `audience` (`DONOR`, `NGO`, `ADMIN`), `donor_id` / `ngo_id`
(nullable scope), `insight_type`, `title`, `body`, `supporting_data jsonb`, `sample_size`
(NN), `data_label`, `period_start`, `period_end`, `generated_by` (`RULE`, `LLM`), `created_at`,
`expires_at`. Insights below a minimum sample size are not generated.

### 4.7 Pickup and handover (Phase 7)

**`pickup_assignments`**: one collection attempt for an allocation.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| allocation_id | uuid | NN, FK donation_allocations |
| ngo_id | uuid | NN, FK ngos |
| representative_id | uuid | NN, FK ngo_representatives (must belong to `ngo_id`; checked by the backend) |
| assigned_by | uuid | NN, FK users |
| status | text | `ASSIGNED`, `EN_ROUTE`, `VERIFIED`, `HANDED_OVER`, `IN_TRANSIT`, `DELIVERED`, `CANCELLED`, `FAILED` |
| scheduled_pickup_at | timestamptz | |
| destination_location / destination_address | geography / text | |
| qr_verified_at / identity_confirmed_at | timestamptz | `VERIFIED`, `HANDED_OVER`, `IN_TRANSIT` and `DELIVERED` require both |
| handed_over_at, delivered_at, cancelled_at, cancel_reason | | |

`uq_pickup_assignments__active`: `UNIQUE (allocation_id) WHERE status NOT IN ('CANCELLED','FAILED')`.
Reassignment cancels the old assignment and creates a new one.

**`pickup_tokens`**: QR passes. The QR carries only an opaque random token.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| pickup_assignment_id | uuid | NN, FK |
| token_hash | text | NN U, SHA-256 of a 256-bit random token |
| expires_at | timestamptz | NN (short-lived, `pickup.qr_ttl_minutes`) |
| consumed_at / consumed_by | timestamptz / uuid | single use |
| revoked_at | timestamptz | regenerating a pass revokes the previous one |
| created_by | uuid | FK users |

`UNIQUE (pickup_assignment_id) WHERE consumed_at IS NULL AND revoked_at IS NULL`: one live pass at a time.

**`pickup_verifications`**: append-only log of every QR pass and identity-check attempt.
`id bigint`, `pickup_assignment_id` (nullable when the token is unknown), `method` (`QR`,
`IDENTITY_CHECK`), `result` (`SUCCESS`, `FAILURE`), `failure_reason` (`TOKEN_NOT_FOUND`,
`TOKEN_EXPIRED`, `TOKEN_CONSUMED`, `TOKEN_REVOKED`, `WRONG_DONOR`, `REPRESENTATIVE_INACTIVE`,
`PICKUP_NOT_ACTIVE`, `QR_NOT_VERIFIED`, `RATE_LIMITED`), `actor_user_id`, `ip`,
`user_agent`, `created_at`. Raw tokens are never logged. The CHECKs still accept the historical `OTP` method and OTP
failure reasons so rows written before migration 0012 stay valid; new rows are only `QR` or `IDENTITY_CHECK`.

**`handover_records`**: two-way confirmation.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| pickup_assignment_id | uuid | NN U, FK |
| allocation_id | uuid | NN, FK |
| donor_confirmed_quantity / donor_confirmed_by / donor_confirmed_at | | |
| ngo_received_quantity / ngo_confirmed_by / ngo_confirmed_at | | |
| status | text | `PENDING_DONOR`, `PENDING_NGO`, `CONFIRMED`, `DISPUTED` |
| notes | text | |

`CHECK (status <> 'CONFIRMED' OR (donor_confirmed_quantity IS NOT NULL AND ngo_received_quantity IS NOT NULL AND donor_confirmed_quantity = ngo_received_quantity))`.
(Both `IS NOT NULL` tests are required: a comparison with NULL yields NULL, and a CHECK that evaluates to NULL **passes**.)
A mismatch sets `DISPUTED` and opens a dispute. A disputed handover is never marked completed.

**`delivery_confirmations`**: `id`, `pickup_assignment_id` (NN U), `delivered_quantity` (`>= 0`),
`confirmed_by`, `confirmed_at`, `destination_location`, `beneficiaries_served`, `distribution_notes`.

**`disputes`** ➕: `id`, `allocation_id` FK, `pickup_assignment_id` FK (nullable), `raised_by`
(nullable = system), `type` (`QUANTITY_MISMATCH`, `NO_SHOW`, `UNAUTHORISED_PICKUP`, `FOOD_CONDITION`,
`OTHER`), `description`, `status` (`OPEN`, `UNDER_REVIEW`, `RESOLVED`, `REJECTED`), `resolution`,
`resolved_quantity`, `resolved_by`, `resolved_at`.

### 4.8 Tracking (Phase 8)

**`tracking_sessions`**

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| pickup_assignment_id | uuid | NN, FK |
| stage | text | `TO_PICKUP` (representative travelling to donor) or `TO_DESTINATION` (food in transit) |
| tracked_user_id | uuid | NN, FK users (the representative) |
| status | text | `ACTIVE`, `ENDED`, `EXPIRED` |
| consent_given_at | timestamptz | NN (explicit consent in the UI) |
| started_at / ended_at / end_reason | | |
| last_location / last_accuracy_m / last_recorded_at | | the last known position, shown with its timestamp |
| destination_location | geography | |
| total_distance_m | numeric | summary kept after raw points are purged |

`UNIQUE (pickup_assignment_id, stage) WHERE status = 'ACTIVE'`.

**`location_updates`**: `id bigint`, `session_id` FK CASCADE, `location` (NN), `accuracy_m`
(`>= 0`), `heading`, `speed_mps`, `recorded_at` (device time), `received_at` (server time).
Index `(session_id, recorded_at)`. Raw points are deleted after `LOCATION_RETENTION_DAYS`.

**`tracking_events`**: `id bigint`, `session_id` FK, `event_type` (`STARTED`, `PERMISSION_DENIED`,
`DISCONNECTED`, `RECONNECTED`, `STALE`, `NEAR_DESTINATION`, `STOPPED`, `ADMIN_VIEWED`),
`actor_user_id`, `metadata`, `created_at`.

### 4.9 Rewards (Phase 9)

**`reward_rules`**: `id`, `unit`, `min_quantity` (`> 0`), `points` (`> 0`), `effective_from`,
`effective_to`, `is_active`, `created_by`. Initial brackets (MEALS): 10→10, 25→30, 50→65,
100→140. The scaling rule outside the brackets is an open question (see SYSTEM_ARCHITECTURE §15).

**`reward_tiers`**: `id`, `name` U (`BRONZE`, `SILVER`, `GOLD`, `PLATINUM`), `min_lifetime_points` U, `benefits`, `sort_order`.

**`reward_balances`**: PK `donor_id`; `balance` (`>= 0`), `lifetime_points` (`>= 0`), `updated_at`.
A cache updated in the **same transaction** as each ledger insert.

**`reward_transactions`**: immutable ledger (`forbid_mutation`).

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| donor_id | uuid | NN, FK donors |
| type | text | `CREDIT`, `REVERSAL`, `ADJUSTMENT` |
| points | int | NN, `CHECK (points <> 0)` (signed) |
| balance_after | int | NN, `CHECK (>= 0)` |
| reference_type / reference_id | text / uuid | e.g. `HANDOVER` / handover_records.id |
| idempotency_key | text | NN U, e.g. `handover:{id}:credit` |
| rule_id | uuid | FK reward_rules |
| quantity | numeric(10,2) | the confirmed quantity used |
| description | text | |
| created_by | uuid | nullable = system |

`UNIQUE (reference_type, reference_id, type)`. Corrections are new `REVERSAL` / `ADJUSTMENT` rows, never edits.

**`impact_certificates`** ➕: `id`, `donor_id`, `certificate_number` U, `period_start`, `period_end`,
`meals_redistributed`, `completed_collections`, `snapshot jsonb`, `issued_at`. Lets an issued
certificate be verified later.

### 4.10 Billing (Phase 9)

**`service_fee_rules`**: `id`, `model` (`PER_COLLECTION`, `PER_UNIT`, `MONTHLY_SUBSCRIPTION`),
`amount` (`>= 0`), `currency`, `unit` (for `PER_UNIT`), `tax_rate numeric(5,4)`, `effective_from`,
`effective_to`, `is_active`, `created_by`. v1 has one active platform-wide rule
(`UNIQUE (is_active) WHERE is_active`).

**`ngo_billing`**: one fee line per completed collection.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| ngo_id | uuid | NN, FK ngos |
| allocation_id | uuid | NN **U**, FK. At most one fee per collection |
| handover_record_id | uuid | NN, FK. Created only from a `CONFIRMED` handover, so cancelled or incomplete collections are never billed |
| fee_rule_id | uuid | NN, FK |
| billable_quantity / unit | | the confirmed quantity |
| amount / tax_amount / total_amount | numeric(12,2) | `CHECK (total_amount = amount + tax_amount)` |
| currency | char(3) | |
| status | text | `PENDING`, `INVOICED`, `PAID`, `WAIVED`, `VOID` |
| invoice_id | uuid | FK invoices |
| idempotency_key | text | NN U |

Donors have no billing table, by design: donors are never charged.

**`invoices`**: `id`, `ngo_id`, `invoice_number` U (from a sequence, e.g. `FB-2026-000123`),
`period_start`, `period_end`, `subtotal`, `tax_total`, `total` (`CHECK (total = subtotal + tax_total)`),
`currency`, `status` (`DRAFT`, `ISSUED`, `PAID`, `VOID`), `issued_at`, `due_at`, `paid_at`, `created_by`.

**`payments`**: `id`, `ngo_id`, `invoice_id`, `provider` (`RAZORPAY`, `MANUAL`), `provider_order_id` U,
`provider_payment_id` U, `amount`, `currency`, `status` (`CREATED`, `PENDING`, `SUCCEEDED`, `FAILED`,
`REFUNDED`), `failure_reason`, `recorded_by` (manual entries), `idempotency_key` U, `succeeded_at`.
`SUCCEEDED` is set only from a signature-verified webhook or an audited manual admin entry.
Webhook events are de-duplicated through `idempotency_records`.

### 4.11 Collection planning (Phase 10)

**`collection_plans`**: `id`, `ngo_id`, `plan_date`, `representative_id`, `vehicle_capacity`,
`capacity_unit`, `start_location/address`, `end_location/address`, `status` (`DRAFT`, `CONFIRMED`,
`IN_PROGRESS`, `COMPLETED`, `CANCELLED`), `solver` (`ORTOOLS_VRPTW`), `solver_status` (`OPTIMAL`,
`FEASIBLE`, `INFEASIBLE`, `TIMEOUT`), `distance_source`, `total_distance_m`, `total_duration_s`,
`infeasibility_reasons text[]`, `created_by`.

**`collection_stops`**: `id`, `plan_id` FK CASCADE, `sequence`, `stop_type` (`PICKUP`, `DROP_OFF`),
`allocation_id` / `pickup_assignment_id` (FKs), `location`, `address`, `window_start`, `window_end`,
`planned_arrival_at`, `quantity`, `status` (`PENDING`, `VISITED`, `SKIPPED`). `UNIQUE (plan_id, sequence)`.

---

## 5. Why the added tables exist

| Table | Reason |
|---|---|
| `platform_settings` | Spec §4.3 asks for admin-configurable policies and matching weights, with an audit trail |
| `jobs` | Reliable asynchronous matching, notification retries and expiry, without Redis (spec §6.4, §15) |
| `user_sessions` | Refresh-token rotation, logout and revocation (spec §9) |
| `donor_availability` | "Donor availability" is a matching input (spec §5.2, §12) |
| `donor_food_categories`, `ngo_food_preferences` | Category compatibility filters need normalised, FK-checked data |
| `disputes` | Admins "investigate disputes", and quantity mismatches must be flagged (spec §4.3, §16) |
| `ai_conversations` | Groups assistant history per conversation |
| `impact_certificates` | Issued certificates should be reproducible and verifiable |

---

## 6. Concurrency and quantity accounting

All writes that touch shared quantities run in a transaction at `READ COMMITTED`,
using **conditional updates**, with CHECK constraints as the final backstop.

### 6.1 Reserving donation quantity (request approval)

```sql
BEGIN;
SELECT status FROM donation_requests WHERE id = $request FOR UPDATE;   -- must still be PENDING

UPDATE donations
   SET reserved_quantity = reserved_quantity + $qty,
       status  = CASE WHEN reserved_quantity + $qty = quantity THEN 'RESERVED' ELSE 'PARTIALLY_RESERVED' END,
       version = version + 1
 WHERE id = $donation
   AND status IN ('AVAILABLE', 'PARTIALLY_RESERVED')
   AND deleted_at IS NULL
   AND pickup_deadline > now()
   AND quantity - reserved_quantity >= $qty
RETURNING id, reserved_quantity, status;
-- 0 rows → ROLLBACK, respond 409 INSUFFICIENT_QUANTITY (nothing changed)

INSERT INTO donation_allocations (...) VALUES (...);   -- unique donation_request_id blocks double approval
UPDATE donation_requests SET status = 'APPROVED', approved_quantity = $qty, ... WHERE id = $request;
INSERT INTO donation_status_history ...; INSERT INTO audit_logs ...; INSERT INTO jobs ...;
COMMIT;
```

The `UPDATE` takes a row lock, so concurrent reservations on one donation are
serialised. Under `READ COMMITTED`, a waiting transaction re-evaluates its
`WHERE` clause against the newly committed row. When two NGOs race for the last
10 meals, exactly one update matches, and the other gets 0 rows and a `409`.

### 6.2 Accepting an assistance offer

```sql
BEGIN;
SELECT quantity_required, quantity_committed, status
  FROM food_assistance_requests WHERE id = $req FOR UPDATE;          -- serialises all acceptances
SELECT status, offered_quantity FROM assistance_offers WHERE id = $offer FOR UPDATE;  -- must be PROPOSED
-- accept = LEAST(offered_quantity, quantity_required - quantity_committed); if 0 → 409 ALREADY_FULFILLED
UPDATE food_assistance_requests SET quantity_committed = quantity_committed + $accept, status = ... WHERE id = $req;
UPDATE assistance_offers SET status = 'ACCEPTED', accepted_quantity = $accept, ... WHERE id = $offer;
INSERT INTO assistance_request_history ...;
COMMIT;
```

When the donor confirms the actual food, the offer becomes `RESERVED`. One
transaction creates an `ASSISTANCE_OFFER` donation (`reserved_quantity = quantity`)
and its allocation. If the confirmed quantity is lower than accepted, the difference
is released from `quantity_committed` and the request status is recalculated.

### 6.3 Other guarantees

| Risk | Guard |
|---|---|
| Double approval / acceptance | Status precondition under row lock + unique `donation_request_id` / `assistance_offer_id` on allocations |
| Duplicate live requests or offers | Partial unique indexes (§4.3, §4.4) |
| Lost updates on edits | `version` check: `UPDATE … WHERE id = $1 AND version = $2`; 0 rows → `409 STALE_VERSION` |
| Duplicate submissions | `Idempotency-Key` header → `idempotency_records` |
| QR reuse | `UPDATE pickup_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING …` |
| Double reward credit or double fee | Unique `idempotency_key`, `(reference_type, reference_id, type)`, unique `ngo_billing.allocation_id` |
| Deadlocks | Fixed lock order: `food_assistance_requests → assistance_offers → donations → donation_requests → donation_allocations → pickup_assignments` |

Concurrency behaviour is verified by integration tests that fire parallel
requests at a real PostgreSQL database (spec scenario D).

---

## 7. State machines

Backend modules are the source of truth. The tables below are the design
contract; transition rules are finalised with tests in the phase that implements them.

### 7.1 Donation

| From | To | Trigger |
|---|---|---|
| `DRAFT` | `AVAILABLE` | Donor publishes (requires safety confirmation and location) |
| `DRAFT`, `AVAILABLE`, `PARTIALLY_RESERVED` | `CANCELLED` | Donor cancels (existing reservations must first be cancelled, with notification) |
| `AVAILABLE` | `PARTIALLY_RESERVED` / `RESERVED` | Reservation (§6.1) |
| `PARTIALLY_RESERVED` | `RESERVED` | Remaining quantity reserved |
| `PARTIALLY_RESERVED`, `RESERVED` | `AVAILABLE` / `PARTIALLY_RESERVED` | An allocation is cancelled before pickup and quantity is released |
| `AVAILABLE` | `EXPIRED` | `pickup_deadline` passes with nothing reserved |
| `RESERVED` | `PICKUP_ASSIGNED` → `PICKED_UP` → `IN_TRANSIT` → `COMPLETED` | Roll-up: the donation advances when **all** its active allocations reach that stage |
| any active | `DISPUTED` | A handover dispute is open on one of its allocations |

Partially reserved donations whose deadline passes: unreserved quantity is
released, and the donation continues with its reserved part.

### 7.2 Assistance request

| From | To | Trigger |
|---|---|---|
| `OPEN` | `PARTIALLY_FULFILLED` | `0 < quantity_committed < quantity_required` |
| `OPEN`, `PARTIALLY_FULFILLED` | `FULFILLED` | `quantity_committed = quantity_required` |
| `PARTIALLY_FULFILLED`, `FULFILLED` | `OPEN` / `PARTIALLY_FULFILLED` | A committed offer is cancelled before `needed_until` |
| `OPEN`, `PARTIALLY_FULFILLED` | `CANCELLED` | NGO cancels (pending offers are rejected, committed ones cancelled with notification) |
| `OPEN`, `PARTIALLY_FULFILLED` | `EXPIRED` | `needed_until` passes |

Status reflects **committed** quantity. Delivered quantity is tracked separately in `quantity_received`.

### 7.3 Assistance offer

`PROPOSED → ACCEPTED → RESERVED → PICKUP_ASSIGNED → COMPLETED`.
`PROPOSED → REJECTED`; `PROPOSED | ACCEPTED | RESERVED | PICKUP_ASSIGNED → CANCELLED`;
`PROPOSED | ACCEPTED → EXPIRED`.
`ACCEPTED` commits quantity against the request. `RESERVED` means the donor has
confirmed real food (prediction ≠ donation). An offer of food that is already
prepared moves through `ACCEPTED` and `RESERVED` in one transaction, and both
transitions are recorded.

### 7.4 Allocation

`RESERVED → PICKUP_ASSIGNED → PICKED_UP → IN_TRANSIT → COMPLETED`.
`RESERVED | PICKUP_ASSIGNED → CANCELLED | EXPIRED` (quantity released).
`PICKED_UP → DISPUTED → PICKED_UP | CANCELLED` (admin resolution).
`PICKED_UP` means the handover is **two-way confirmed**. That is when reward points and
the NGO fee are recorded, idempotently. `COMPLETED` means delivery is confirmed by the NGO.

---

## 8. Geographic queries

- Columns use `geography(Point, 4326)`. `ST_DWithin` / `ST_Distance` give
  geodesic straight-line metres, always labelled as **straight-line estimates**.
  Road distance and ETA come only from Google Routes, labelled `ROAD_GOOGLE_ROUTES`.
- Candidate search uses a GiST-indexed prefilter with a fixed maximum radius
  (`matching.max_radius_km`), then applies each NGO's own `collection_radius_km`.
  This is needed because a per-row radius expression cannot use the index.

```sql
SELECT n.id, ST_Distance(n.location, d.location) AS distance_m
  FROM donations d
  JOIN ngos n ON ST_DWithin(n.location, d.location, $max_radius_m)
 WHERE d.id = $donation
   AND n.verification_status = 'APPROVED' AND n.deleted_at IS NULL
   AND ST_Distance(n.location, d.location) <= n.collection_radius_km * 1000
   AND ((d.dietary_type = 'VEG' AND n.accepts_veg) OR (d.dietary_type = 'NON_VEG' AND n.accepts_non_veg))
   AND EXISTS (SELECT 1 FROM ngo_food_preferences p WHERE p.ngo_id = n.id AND p.category_id = d.category_id);
```

---

## 9. Data retention

| Data | Retention | Mechanism |
|---|---|---|
| `location_updates` (raw GPS points) | `LOCATION_RETENTION_DAYS` (default 30) after the session ends | Daily job deletes points; the session keeps a summary. `last_location` is cleared after the same period |
| `pickup_tokens` | 1 year (hash plus timestamps, for audit) | Daily job |
| `user_sessions` | 30 days after expiry or revocation | Daily job |
| `ai_interactions` | `AI_INTERACTION_RETENTION_DAYS` (default 90) | Daily job |
| `idempotency_records` | Until `expires_at` (24 h for API keys, 30 days for webhooks) | Daily job |
| `jobs` in `SUCCEEDED` | 14 days | Daily job |
| `notification_logs` | 90 days | Daily job |
| `audit_logs`, ledgers, history tables | Indefinitely in v1 (an archival policy is required before production) | n/a |

---

## 10. Migrations and seed data

- **Tool:** `node-pg-migrate`, run from the backend (`npm run db:migrate`) against `DATABASE_URL`.
  The test suite migrates `TEST_DATABASE_URL` before running.
- **One concern per migration**, created in the phase that needs it (§3).
- **Forward-only in shared environments.** Down migrations exist for local development only.
  Removals are new forward migrations (for example `0012_remove_pickup_otp.sql`); applied migrations are never edited.
- **Reference data** that production needs (food categories, reward tiers, initial reward rules,
  initial fee rule, default settings) is inserted by migrations.
- **Demo data** (`database/seeds/`) is synthetic, labelled `SYNTHETIC` wherever the schema has a
  label, and refused by the seed script when `NODE_ENV=production`.
- **Production roles:** a migration role owns the schema; the application role has only
  `SELECT/INSERT/UPDATE/DELETE` (and no `UPDATE/DELETE` on immutable tables).
