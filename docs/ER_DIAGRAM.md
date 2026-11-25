# FoodBridge AI: Entity-Relationship Diagrams

> **Status:** Implemented (53 tables, migrations 0001–0012). Column-level detail, constraints and rationale are in
> [DATABASE_DESIGN.md](DATABASE_DESIGN.md). These diagrams show keys and the main
> attributes only.
>
> To keep the diagrams readable, audit columns (`created_by`, `decided_by`,
> `verified_by`, …) that reference `users` are omitted. Every such column is a
> real foreign key in the schema.

Legend: `||--o{` one-to-many · `||--o|` one-to-zero-or-one · `}o--o{` many-to-many (via a join table).

---

## 1. Core flow overview

How the two discovery workflows converge on a single collection pipeline.

```mermaid
erDiagram
    donors ||--o{ donations : "lists"
    ngos ||--o{ donation_requests : "requests"
    donations ||--o{ donation_requests : "receives"
    ngos ||--o{ food_assistance_requests : "creates"
    food_assistance_requests ||--o{ assistance_offers : "receives"
    donors ||--o{ assistance_offers : "offers"
    assistance_offers |o--o| donations : "confirmed as"

    donations ||--o{ donation_allocations : "reserved via"
    donation_requests ||--o| donation_allocations : "approved as"
    assistance_offers ||--o| donation_allocations : "reserved as"
    ngos ||--o{ donation_allocations : "receives"

    donation_allocations ||--o{ pickup_assignments : "collected by"
    pickup_assignments ||--o| handover_records : "two-way confirmed"
    pickup_assignments ||--o| delivery_confirmations : "delivered"
    pickup_assignments ||--o{ tracking_sessions : "tracked by"

    handover_records ||--o| reward_transactions : "credits donor"
    donation_allocations ||--o| ngo_billing : "bills NGO"
```

---

## 2. Identity and organisations (Phase 2)

```mermaid
erDiagram
    users ||--o{ user_sessions : "has"
    users ||--o| admin_profiles : "is admin"
    users ||--o| donors : "owns"
    users ||--o| ngos : "owns"
    users ||--o| ngo_representatives : "acts as"
    ngos ||--o{ ngo_representatives : "authorises"
    donors ||--o{ donor_availability : "open during"
    donors ||--o{ donor_food_categories : "produces"
    food_categories ||--o{ donor_food_categories : ""
    ngos ||--o{ ngo_food_preferences : "accepts"
    food_categories ||--o{ ngo_food_preferences : ""
    donors ||--o{ verification_documents : "submits"
    ngos ||--o{ verification_documents : "submits"

    users {
        uuid id PK
        citext email UK "unique among non-deleted"
        text password_hash "Argon2id"
        text role "DONOR | NGO | ADMIN"
        text account_status
        text full_name
        timestamptz deleted_at
    }
    user_sessions {
        uuid id PK "sid claim"
        uuid user_id FK
        uuid family_id "rotation family"
        text refresh_token_hash UK "SHA-256"
        timestamptz expires_at
        timestamptz revoked_at
    }
    admin_profiles {
        uuid user_id PK, FK
        text admin_level
    }
    donors {
        uuid id PK
        uuid owner_user_id FK, UK
        text business_name
        text business_type
        geography location "Point 4326"
        text verification_status
        timestamptz paused_until
        boolean public_recognition_consent
    }
    donor_availability {
        uuid id PK
        uuid donor_id FK
        smallint iso_day_of_week
        time opens_at
        time closes_at
    }
    donor_food_categories {
        uuid donor_id PK, FK
        uuid category_id PK, FK
    }
    ngos {
        uuid id PK
        uuid owner_user_id FK, UK
        text organization_name
        geography location "Point 4326"
        boolean accepts_veg
        boolean accepts_non_veg
        int max_daily_capacity
        numeric collection_radius_km
        int beneficiaries_count
        text verification_status
    }
    ngo_food_preferences {
        uuid ngo_id PK, FK
        uuid category_id PK, FK
    }
    ngo_representatives {
        uuid id PK
        uuid ngo_id FK
        uuid user_id FK, UK
        text id_document_type
        char id_document_last4 "last 4 only"
        text status
    }
    food_categories {
        uuid id PK
        text code UK
        int max_hours_after_preparation "flag only"
        boolean requires_refrigeration
    }
    verification_documents {
        uuid id PK
        uuid donor_id FK "exactly one of donor/ngo"
        uuid ngo_id FK
        text document_type
        text storage_key "private"
        text mime_type
        char sha256
        text status
    }
```

---

## 3. Donations and NGO assistance (Phase 3)

```mermaid
erDiagram
    donors ||--o{ donations : "lists"
    food_categories ||--o{ donations : "categorises"
    donations ||--o{ donation_status_history : "history"
    donations ||--o{ donation_requests : "receives"
    ngos ||--o{ donation_requests : "makes"
    donations ||--o{ donation_allocations : "reserved via"
    ngos ||--o{ donation_allocations : "receives"
    donation_requests ||--o| donation_allocations : "approved as"
    ngos ||--o{ food_assistance_requests : "creates"
    food_assistance_requests ||--o{ assistance_offers : "receives"
    donors ||--o{ assistance_offers : "makes"
    assistance_offers |o--o| donations : "confirmed as"
    assistance_offers ||--o| donation_allocations : "reserved as"
    food_assistance_requests ||--o{ assistance_request_history : "history"

    donations {
        uuid id PK
        uuid donor_id FK
        text origin "DIRECT_LISTING | ASSISTANCE_OFFER"
        text food_name
        uuid category_id FK
        text dietary_type "VEG | NON_VEG"
        int quantity "> 0"
        int reserved_quantity "0..quantity"
        text unit
        timestamptz prepared_at
        timestamptz pickup_deadline
        geography location
        boolean safety_confirmed
        text status
        int version
    }
    donation_status_history {
        bigint id PK
        uuid donation_id FK
        text from_status
        text to_status
        timestamptz created_at "append-only"
    }
    donation_requests {
        uuid id PK
        uuid donation_id FK
        uuid ngo_id FK
        int requested_quantity
        int approved_quantity
        text status "one live per NGO+donation"
    }
    donation_allocations {
        uuid id PK
        uuid donation_id FK
        uuid ngo_id FK
        int quantity
        text source
        uuid donation_request_id FK, UK
        uuid assistance_offer_id FK, UK
        int handed_over_quantity
        text status
    }
    food_assistance_requests {
        uuid id PK
        uuid ngo_id FK
        uuid category_id FK
        text dietary_requirement "VEG_ONLY | ANY"
        int quantity_required
        int quantity_committed "0..required"
        int quantity_received
        timestamptz needed_from
        timestamptz needed_until
        text urgency
        int beneficiaries_count
        text status
    }
    assistance_offers {
        uuid id PK
        uuid assistance_request_id FK
        uuid donor_id FK
        int offered_quantity
        int accepted_quantity
        int confirmed_quantity "actual food"
        uuid donation_id FK, UK
        text status "one live per donor+request"
    }
    assistance_request_history {
        bigint id PK
        uuid assistance_request_id FK
        uuid assistance_offer_id FK
        text event_type
        numeric quantity_delta
    }
```

---

## 4. Pickup, handover and tracking (Phases 7–8)

```mermaid
erDiagram
    donation_allocations ||--o{ pickup_assignments : "collected by"
    ngo_representatives ||--o{ pickup_assignments : "assigned"
    pickup_assignments ||--o{ pickup_tokens : "QR passes"
    pickup_assignments ||--o{ pickup_verifications : "attempt log"
    pickup_assignments ||--o| handover_records : "handover"
    pickup_assignments ||--o| delivery_confirmations : "delivery"
    donation_allocations ||--o{ disputes : "disputed in"
    pickup_assignments ||--o{ tracking_sessions : "tracked"
    tracking_sessions ||--o{ location_updates : "points"
    tracking_sessions ||--o{ tracking_events : "events"

    pickup_assignments {
        uuid id PK
        uuid allocation_id FK "one active per allocation"
        uuid representative_id FK
        text status
        timestamptz qr_verified_at
        timestamptz identity_confirmed_at
    }
    pickup_tokens {
        uuid id PK
        uuid pickup_assignment_id FK
        text token_hash UK "SHA-256, opaque token"
        timestamptz expires_at
        timestamptz consumed_at "single use"
        timestamptz revoked_at
    }
    pickup_verifications {
        bigint id PK
        uuid pickup_assignment_id FK
        text method "QR | IDENTITY_CHECK (older rows: OTP)"
        text result
        text failure_reason
    }
    handover_records {
        uuid id PK
        uuid pickup_assignment_id FK, UK
        int donor_confirmed_quantity
        int ngo_received_quantity
        text status "CONFIRMED only if equal"
    }
    delivery_confirmations {
        uuid id PK
        uuid pickup_assignment_id FK, UK
        int delivered_quantity
        int beneficiaries_served
    }
    disputes {
        uuid id PK
        uuid allocation_id FK
        text type
        text status
        int resolved_quantity
    }
    tracking_sessions {
        uuid id PK
        uuid pickup_assignment_id FK
        text stage "TO_PICKUP | TO_DESTINATION"
        text status
        timestamptz consent_given_at
        geography last_location
        timestamptz last_recorded_at
    }
    location_updates {
        bigint id PK
        uuid session_id FK
        geography location
        numeric accuracy_m
        timestamptz recorded_at "purged after retention"
    }
    tracking_events {
        bigint id PK
        uuid session_id FK
        text event_type
    }
```

---

## 5. Rewards and billing (Phase 9)

```mermaid
erDiagram
    donors ||--o| reward_balances : "balance"
    donors ||--o{ reward_transactions : "ledger"
    reward_rules ||--o{ reward_transactions : "applied"
    handover_records ||--o| reward_transactions : "source"
    donors ||--o{ impact_certificates : "issued"
    ngos ||--o{ ngo_billing : "charged"
    donation_allocations ||--o| ngo_billing : "one fee per collection"
    handover_records ||--o| ngo_billing : "source"
    service_fee_rules ||--o{ ngo_billing : "priced by"
    invoices ||--o{ ngo_billing : "groups"
    ngos ||--o{ invoices : "billed"
    invoices ||--o{ payments : "paid by"

    reward_balances {
        uuid donor_id PK, FK
        int balance
        int lifetime_points
    }
    reward_transactions {
        uuid id PK
        uuid donor_id FK
        text type "CREDIT | REVERSAL | ADJUSTMENT"
        int points
        int balance_after
        text reference_type
        uuid reference_id
        text idempotency_key UK
    }
    reward_rules {
        uuid id PK
        text unit "MEALS | PACKETS | BOXES"
        text basis "PER_UNIT | PER_ORDER"
        int points
        int lifetime_threshold "bracket start"
    }
    reward_tiers {
        uuid id PK
        text name UK
        int min_lifetime_points UK
    }
    impact_certificates {
        uuid id PK
        uuid donor_id FK
        text certificate_number UK
    }
    service_fee_rules {
        uuid id PK
        text model
        numeric amount
        numeric tax_rate
        boolean is_active
    }
    ngo_billing {
        uuid id PK
        uuid ngo_id FK
        uuid allocation_id FK, UK
        uuid handover_record_id FK
        numeric total_amount
        text status
        uuid invoice_id FK
    }
    invoices {
        uuid id PK
        uuid ngo_id FK
        text invoice_number UK
        numeric total
        text status
    }
    payments {
        uuid id PK
        uuid invoice_id FK
        text provider "RAZORPAY | MANUAL"
        text provider_payment_id UK
        text status
    }
```

---

## 6. AI, matching and assistant (Phases 5, 6, 11)

```mermaid
erDiagram
    donors ||--o{ restaurant_daily_metrics : "records"
    donors ||--o{ surplus_predictions : "forecast for"
    model_versions ||--o{ surplus_predictions : "produced"
    donations ||--o{ match_recommendations : "subject"
    food_assistance_requests ||--o{ match_recommendations : "subject"
    ngos ||--o{ match_recommendations : "candidate"
    donors ||--o{ match_recommendations : "candidate"
    users ||--o{ ai_conversations : "owns"
    ai_conversations ||--o{ ai_interactions : "messages"

    restaurant_daily_metrics {
        uuid id PK
        uuid donor_id FK
        date metric_date
        text meal_period
        int prepared_qty
        int sold_qty
        int surplus_qty
        text data_source "SYNTHETIC is labelled"
    }
    model_versions {
        uuid id PK
        text model_name
        text version
        text training_data_label
        jsonb metrics "model vs baseline"
        boolean is_active
    }
    surplus_predictions {
        uuid id PK
        uuid donor_id FK
        date target_date
        int predicted_quantity
        uuid model_version_id FK
    }
    match_recommendations {
        uuid id PK
        uuid run_id
        text subject_type
        uuid donation_id FK
        uuid assistance_request_id FK
        uuid candidate_ngo_id FK
        uuid candidate_donor_id FK
        boolean eligible
        numeric score "0-100"
        jsonb criteria
        text explanation
        text distance_source
        text response
    }
    ai_conversations {
        uuid id PK
        uuid user_id FK
    }
    ai_interactions {
        bigint id PK
        uuid conversation_id FK
        text role
        text tool_name
        text action_status "state changes need confirmation"
    }
    ai_insights {
        uuid id PK
        text audience
        int sample_size
        text data_label
    }
```

---

## 7. Notifications, collection planning and platform (Phases 1, 3, 10)

```mermaid
erDiagram
    users ||--o{ notifications : "receives"
    users ||--o| notification_preferences : "configures"
    notifications ||--o{ notification_logs : "delivery attempts"
    ngos ||--o{ collection_plans : "plans"
    collection_plans ||--o{ collection_stops : "stops"
    donation_allocations ||--o{ collection_stops : "visited at"
    users ||--o{ audit_logs : "acts"

    notifications {
        uuid id PK
        uuid user_id FK
        text type
        text dedupe_key "unique per user"
        text link_path "relative only"
        timestamptz read_at
    }
    notification_preferences {
        uuid user_id PK, FK
        boolean email_enabled
        int max_per_hour
        numeric max_distance_km
    }
    notification_logs {
        bigint id PK
        uuid notification_id FK
        text channel
        text status
        int attempt_count
    }
    collection_plans {
        uuid id PK
        uuid ngo_id FK
        date plan_date
        int vehicle_capacity
        text solver_status
        text distance_source
    }
    collection_stops {
        uuid id PK
        uuid plan_id FK
        int sequence
        uuid allocation_id FK
        timestamptz window_start
        timestamptz window_end
    }
    audit_logs {
        bigint id PK
        uuid actor_user_id FK
        text action
        text entity_type
        uuid entity_id
        jsonb changes "redacted"
    }
    platform_settings {
        text key PK
        jsonb value
    }
    idempotency_records {
        uuid id PK
        text scope
        text key "unique with scope"
        text request_hash
    }
    jobs {
        bigint id PK
        text type
        text status
        timestamptz run_at
        text dedupe_key UK
    }
```
