-- FoodBridge AI: generated schema snapshot (pg_dump --schema-only of a fully migrated database).
-- Reference only. Migrations in database/migrations/ are authoritative; regenerate after schema changes.

--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: forbid_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    purpose text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_tokens_purpose_check CHECK ((purpose = ANY (ARRAY['INVITE'::text, 'PASSWORD_RESET'::text])))
);


--
-- Name: admin_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_profiles (
    user_id uuid NOT NULL,
    admin_level text DEFAULT 'ADMIN'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_profiles_admin_level_check CHECK ((admin_level = ANY (ARRAY['SUPER_ADMIN'::text, 'ADMIN'::text])))
);


--
-- Name: ai_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ai_conversations_title_check CHECK ((length(title) <= 160))
);


--
-- Name: ai_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audience text NOT NULL,
    donor_id uuid,
    ngo_id uuid,
    insight_type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    supporting_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    sample_size integer NOT NULL,
    confidence text,
    limitations text[] DEFAULT '{}'::text[] NOT NULL,
    data_label text NOT NULL,
    generated_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT ai_insights_audience_check CHECK ((audience = ANY (ARRAY['DONOR'::text, 'NGO'::text, 'ADMIN'::text]))),
    CONSTRAINT ai_insights_confidence_check CHECK ((confidence = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text]))),
    CONSTRAINT ai_insights_data_label_check CHECK ((data_label = ANY (ARRAY['REAL'::text, 'SYNTHETIC'::text, 'MIXED'::text]))),
    CONSTRAINT ai_insights_generated_by_check CHECK ((generated_by = ANY (ARRAY['RULE'::text, 'LLM'::text]))),
    CONSTRAINT ai_insights_sample_size_check CHECK ((sample_size > 0))
);


--
-- Name: ai_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interactions (
    id bigint NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    content text,
    tool_call_id text,
    tool_name text,
    tool_arguments jsonb,
    tool_result_summary jsonb,
    pending_action jsonb,
    action_status text,
    provider text,
    model text,
    prompt_tokens integer,
    completion_tokens integer,
    latency_ms integer,
    status text DEFAULT 'OK'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_interactions_action_status_check CHECK ((action_status = ANY (ARRAY['PENDING'::text, 'CONFIRMED'::text, 'CANCELLED'::text, 'EXPIRED'::text, 'FAILED'::text]))),
    CONSTRAINT ai_interactions_role_check CHECK ((role = ANY (ARRAY['USER'::text, 'ASSISTANT'::text, 'TOOL'::text]))),
    CONSTRAINT ai_interactions_status_check CHECK ((status = ANY (ARRAY['OK'::text, 'ERROR'::text, 'UNAVAILABLE'::text])))
);


--
-- Name: ai_interactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ai_interactions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ai_interactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: assistance_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistance_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assistance_request_id uuid NOT NULL,
    donor_id uuid NOT NULL,
    created_by uuid NOT NULL,
    offered_quantity integer NOT NULL,
    accepted_quantity integer,
    confirmed_quantity integer,
    food_name text NOT NULL,
    category_id uuid NOT NULL,
    dietary_type text NOT NULL,
    pickup_available_from timestamp with time zone NOT NULL,
    pickup_deadline timestamp with time zone NOT NULL,
    location public.geography(Point,4326) NOT NULL,
    address text NOT NULL,
    notes text,
    status text DEFAULT 'PROPOSED'::text NOT NULL,
    donation_id uuid,
    responded_by uuid,
    responded_at timestamp with time zone,
    rejection_reason text,
    cancelled_by uuid,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistance_offers_accepted_range CHECK (((accepted_quantity IS NULL) OR ((accepted_quantity > 0) AND (accepted_quantity <= offered_quantity)))),
    CONSTRAINT assistance_offers_address_check CHECK (((length(address) >= 5) AND (length(address) <= 300))),
    CONSTRAINT assistance_offers_cancel_reason_check CHECK ((length(cancel_reason) <= 500)),
    CONSTRAINT assistance_offers_confirmed_range CHECK (((confirmed_quantity IS NULL) OR ((accepted_quantity IS NOT NULL) AND (confirmed_quantity > 0) AND (confirmed_quantity <= accepted_quantity)))),
    CONSTRAINT assistance_offers_dietary_type_check CHECK ((dietary_type = ANY (ARRAY['VEG'::text, 'NON_VEG'::text]))),
    CONSTRAINT assistance_offers_food_name_check CHECK (((length(food_name) >= 2) AND (length(food_name) <= 120))),
    CONSTRAINT assistance_offers_notes_check CHECK ((length(notes) <= 1000)),
    CONSTRAINT assistance_offers_offered_quantity_check CHECK ((offered_quantity > 0)),
    CONSTRAINT assistance_offers_rejection_reason_check CHECK ((length(rejection_reason) <= 500)),
    CONSTRAINT assistance_offers_status_check CHECK ((status = ANY (ARRAY['PROPOSED'::text, 'ACCEPTED'::text, 'REJECTED'::text, 'RESERVED'::text, 'PICKUP_ASSIGNED'::text, 'COMPLETED'::text, 'CANCELLED'::text, 'EXPIRED'::text]))),
    CONSTRAINT assistance_offers_window CHECK ((pickup_deadline > pickup_available_from))
);


--
-- Name: assistance_request_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistance_request_history (
    id bigint NOT NULL,
    assistance_request_id uuid NOT NULL,
    assistance_offer_id uuid,
    event_type text NOT NULL,
    from_status text,
    to_status text,
    quantity_delta integer,
    actor_user_id uuid,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assistance_request_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.assistance_request_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.assistance_request_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_type text NOT NULL,
    actor_user_id uuid,
    actor_role text,
    action text NOT NULL,
    entity_type text,
    entity_id uuid,
    changes jsonb,
    metadata jsonb,
    request_id text,
    ip inet,
    user_agent text,
    CONSTRAINT audit_logs_action_check CHECK ((action ~ '^[a-z_]+(\.[a-z_]+)+$'::text)),
    CONSTRAINT audit_logs_actor_type_check CHECK ((actor_type = ANY (ARRAY['USER'::text, 'SYSTEM'::text, 'SERVICE'::text])))
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: collection_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collection_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ngo_id uuid NOT NULL,
    plan_date date NOT NULL,
    representative_id uuid,
    vehicle_capacity integer NOT NULL,
    start_location public.geography(Point,4326) NOT NULL,
    start_address text,
    end_location public.geography(Point,4326) NOT NULL,
    end_address text,
    start_time timestamp with time zone NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    solver text DEFAULT 'ORTOOLS_VRPTW'::text NOT NULL,
    solver_status text,
    distance_source text,
    total_distance_m integer,
    total_duration_s integer,
    explanation text,
    infeasibility_reasons text[] DEFAULT '{}'::text[] NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT collection_plans_distance_source_check CHECK ((distance_source = ANY (ARRAY['STRAIGHT_LINE_ESTIMATE'::text, 'ROAD_GOOGLE_ROUTES'::text]))),
    CONSTRAINT collection_plans_solver_status_check CHECK ((solver_status = ANY (ARRAY['OPTIMAL'::text, 'FEASIBLE'::text, 'PARTIAL'::text, 'INFEASIBLE'::text, 'TIMEOUT'::text, 'UNAVAILABLE'::text]))),
    CONSTRAINT collection_plans_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'CONFIRMED'::text, 'IN_PROGRESS'::text, 'COMPLETED'::text, 'CANCELLED'::text]))),
    CONSTRAINT collection_plans_vehicle_capacity_check CHECK ((vehicle_capacity > 0))
);


--
-- Name: collection_stops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collection_stops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    sequence integer,
    stop_type text NOT NULL,
    allocation_id uuid,
    location public.geography(Point,4326) NOT NULL,
    address text,
    window_start timestamp with time zone,
    window_end timestamp with time zone,
    planned_arrival_at timestamp with time zone,
    quantity integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    drop_reason text,
    CONSTRAINT collection_stops_pickup_allocation CHECK (((stop_type <> 'PICKUP'::text) OR (allocation_id IS NOT NULL))),
    CONSTRAINT collection_stops_quantity_check CHECK ((quantity >= 0)),
    CONSTRAINT collection_stops_sequence_check CHECK ((sequence >= 0)),
    CONSTRAINT collection_stops_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'VISITED'::text, 'SKIPPED'::text, 'DROPPED'::text]))),
    CONSTRAINT collection_stops_stop_type_check CHECK ((stop_type = ANY (ARRAY['PICKUP'::text, 'DROP_OFF'::text])))
);


--
-- Name: delivery_confirmations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_confirmations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pickup_assignment_id uuid NOT NULL,
    delivered_quantity integer NOT NULL,
    confirmed_by uuid NOT NULL,
    confirmed_at timestamp with time zone DEFAULT now() NOT NULL,
    destination_location public.geography(Point,4326),
    beneficiaries_served integer,
    distribution_notes text,
    CONSTRAINT delivery_confirmations_beneficiaries_served_check CHECK ((beneficiaries_served >= 0)),
    CONSTRAINT delivery_confirmations_delivered_quantity_check CHECK ((delivered_quantity >= 0)),
    CONSTRAINT delivery_confirmations_distribution_notes_check CHECK ((length(distribution_notes) <= 1000))
);


--
-- Name: disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disputes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    allocation_id uuid NOT NULL,
    pickup_assignment_id uuid,
    handover_record_id uuid,
    raised_by uuid,
    type text NOT NULL,
    description text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    resolution text,
    resolved_quantity integer,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT disputes_description_check CHECK (((length(description) >= 3) AND (length(description) <= 2000))),
    CONSTRAINT disputes_resolution_check CHECK ((length(resolution) <= 2000)),
    CONSTRAINT disputes_resolved_quantity_check CHECK ((resolved_quantity >= 0)),
    CONSTRAINT disputes_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'UNDER_REVIEW'::text, 'RESOLVED'::text, 'REJECTED'::text]))),
    CONSTRAINT disputes_type_check CHECK ((type = ANY (ARRAY['QUANTITY_MISMATCH'::text, 'NO_SHOW'::text, 'UNAUTHORISED_PICKUP'::text, 'FOOD_CONDITION'::text, 'OTHER'::text])))
);


--
-- Name: donation_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donation_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donation_id uuid NOT NULL,
    ngo_id uuid NOT NULL,
    quantity integer NOT NULL,
    source text NOT NULL,
    donation_request_id uuid,
    assistance_offer_id uuid,
    status text DEFAULT 'RESERVED'::text NOT NULL,
    handed_over_quantity integer,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    cancelled_by_party text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT donation_allocations_cancel_reason_check CHECK ((length(cancel_reason) <= 500)),
    CONSTRAINT donation_allocations_cancelled_by_party_check CHECK ((cancelled_by_party = ANY (ARRAY['DONOR'::text, 'NGO'::text, 'ADMIN'::text, 'SYSTEM'::text]))),
    CONSTRAINT donation_allocations_handed_over_quantity_check CHECK ((handed_over_quantity >= 0)),
    CONSTRAINT donation_allocations_handover_range CHECK (((handed_over_quantity IS NULL) OR (handed_over_quantity <= quantity))),
    CONSTRAINT donation_allocations_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT donation_allocations_source_check CHECK ((source = ANY (ARRAY['DONATION_REQUEST'::text, 'ASSISTANCE_OFFER'::text]))),
    CONSTRAINT donation_allocations_source_ref CHECK (((num_nonnulls(donation_request_id, assistance_offer_id) = 1) AND ((source = 'DONATION_REQUEST'::text) = (donation_request_id IS NOT NULL)) AND ((source = 'ASSISTANCE_OFFER'::text) = (assistance_offer_id IS NOT NULL)))),
    CONSTRAINT donation_allocations_status_check CHECK ((status = ANY (ARRAY['RESERVED'::text, 'PICKUP_ASSIGNED'::text, 'PICKED_UP'::text, 'IN_TRANSIT'::text, 'COMPLETED'::text, 'CANCELLED'::text, 'EXPIRED'::text, 'DISPUTED'::text])))
);


--
-- Name: donation_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donation_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donation_id uuid NOT NULL,
    ngo_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    requested_quantity integer NOT NULL,
    approved_quantity integer,
    message text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT donation_requests_approved_has_quantity CHECK (((status <> 'APPROVED'::text) OR (approved_quantity IS NOT NULL))),
    CONSTRAINT donation_requests_approved_range CHECK (((approved_quantity IS NULL) OR ((approved_quantity > 0) AND (approved_quantity <= requested_quantity)))),
    CONSTRAINT donation_requests_decision_reason_check CHECK ((length(decision_reason) <= 500)),
    CONSTRAINT donation_requests_message_check CHECK ((length(message) <= 1000)),
    CONSTRAINT donation_requests_requested_quantity_check CHECK ((requested_quantity > 0)),
    CONSTRAINT donation_requests_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'WITHDRAWN'::text, 'CANCELLED'::text, 'EXPIRED'::text])))
);


--
-- Name: donation_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donation_status_history (
    id bigint NOT NULL,
    donation_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    changed_by uuid,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: donation_status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.donation_status_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.donation_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: donations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donor_id uuid NOT NULL,
    origin text DEFAULT 'DIRECT_LISTING'::text NOT NULL,
    food_name text NOT NULL,
    category_id uuid NOT NULL,
    dietary_type text NOT NULL,
    quantity integer NOT NULL,
    unit text NOT NULL,
    reserved_quantity integer DEFAULT 0 NOT NULL,
    expired_quantity integer DEFAULT 0 NOT NULL,
    prepared_at timestamp with time zone NOT NULL,
    best_before timestamp with time zone,
    storage_type text NOT NULL,
    storage_notes text,
    pickup_available_from timestamp with time zone NOT NULL,
    pickup_deadline timestamp with time zone NOT NULL,
    location public.geography(Point,4326) NOT NULL,
    address text NOT NULL,
    description text,
    safety_confirmed boolean DEFAULT false NOT NULL,
    safety_confirmed_at timestamp with time zone,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    cancelled_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT donations_address_check CHECK (((length(address) >= 5) AND (length(address) <= 300))),
    CONSTRAINT donations_cancelled_reason_check CHECK ((length(cancelled_reason) <= 500)),
    CONSTRAINT donations_deadline_after_preparation CHECK ((pickup_deadline > prepared_at)),
    CONSTRAINT donations_description_check CHECK ((length(description) <= 2000)),
    CONSTRAINT donations_dietary_type_check CHECK ((dietary_type = ANY (ARRAY['VEG'::text, 'NON_VEG'::text]))),
    CONSTRAINT donations_expired_quantity_check CHECK ((expired_quantity >= 0)),
    CONSTRAINT donations_food_name_check CHECK (((length(food_name) >= 2) AND (length(food_name) <= 120))),
    CONSTRAINT donations_origin_check CHECK ((origin = ANY (ARRAY['DIRECT_LISTING'::text, 'ASSISTANCE_OFFER'::text]))),
    CONSTRAINT donations_pickup_window CHECK ((pickup_deadline > pickup_available_from)),
    CONSTRAINT donations_quantity_check CHECK (((quantity > 0) AND (quantity <= 100000))),
    CONSTRAINT donations_reserved_range CHECK (((reserved_quantity >= 0) AND (reserved_quantity <= quantity))),
    CONSTRAINT donations_safety_confirmed CHECK (((status = 'DRAFT'::text) OR (safety_confirmed AND (safety_confirmed_at IS NOT NULL)))),
    CONSTRAINT donations_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'AVAILABLE'::text, 'PARTIALLY_RESERVED'::text, 'RESERVED'::text, 'PICKUP_ASSIGNED'::text, 'PICKED_UP'::text, 'IN_TRANSIT'::text, 'COMPLETED'::text, 'EXPIRED'::text, 'CANCELLED'::text, 'DISPUTED'::text]))),
    CONSTRAINT donations_storage_notes_check CHECK ((length(storage_notes) <= 500)),
    CONSTRAINT donations_storage_type_check CHECK ((storage_type = ANY (ARRAY['ROOM_TEMPERATURE'::text, 'REFRIGERATED'::text, 'FROZEN'::text, 'HOT_HELD'::text]))),
    CONSTRAINT donations_unit_check CHECK ((unit = ANY (ARRAY['MEALS'::text, 'PACKETS'::text, 'BOXES'::text])))
);


--
-- Name: donor_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donor_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donor_id uuid NOT NULL,
    iso_day_of_week smallint NOT NULL,
    opens_at time without time zone NOT NULL,
    closes_at time without time zone NOT NULL,
    CONSTRAINT donor_availability_iso_day_of_week_check CHECK (((iso_day_of_week >= 1) AND (iso_day_of_week <= 7))),
    CONSTRAINT donor_availability_window CHECK ((closes_at > opens_at))
);


--
-- Name: donor_food_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donor_food_categories (
    donor_id uuid NOT NULL,
    category_id uuid NOT NULL
);


--
-- Name: donors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    business_name text NOT NULL,
    business_type text NOT NULL,
    license_number text,
    contact_email public.citext,
    contact_phone text,
    address_line text,
    city text,
    state text,
    postal_code text,
    country character(2) DEFAULT 'IN'::bpchar NOT NULL,
    location public.geography(Point,4326),
    timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
    verification_status text DEFAULT 'PENDING'::text NOT NULL,
    verification_notes text,
    verified_at timestamp with time zone,
    verified_by uuid,
    accepts_assistance_requests boolean DEFAULT true NOT NULL,
    paused_until timestamp with time zone,
    public_recognition_consent boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT donors_address_line_check CHECK ((length(address_line) <= 300)),
    CONSTRAINT donors_business_name_check CHECK (((length(business_name) >= 2) AND (length(business_name) <= 160))),
    CONSTRAINT donors_business_type_check CHECK ((business_type = ANY (ARRAY['RESTAURANT'::text, 'HOTEL'::text, 'CAFETERIA'::text, 'CATERER'::text, 'FOOD_BUSINESS'::text, 'OTHER'::text]))),
    CONSTRAINT donors_city_check CHECK ((length(city) <= 100)),
    CONSTRAINT donors_contact_phone_check CHECK ((contact_phone ~ '^\+[1-9][0-9]{7,14}$'::text)),
    CONSTRAINT donors_license_number_check CHECK ((length(license_number) <= 60)),
    CONSTRAINT donors_postal_code_check CHECK ((postal_code ~ '^[0-9A-Za-z -]{3,12}$'::text)),
    CONSTRAINT donors_state_check CHECK ((length(state) <= 100)),
    CONSTRAINT donors_verification_status_check CHECK ((verification_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'SUSPENDED'::text])))
);


--
-- Name: food_assistance_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_assistance_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ngo_id uuid NOT NULL,
    created_by uuid NOT NULL,
    category_id uuid NOT NULL,
    dietary_requirement text NOT NULL,
    quantity_required integer NOT NULL,
    unit text NOT NULL,
    quantity_committed integer DEFAULT 0 NOT NULL,
    quantity_received integer DEFAULT 0 NOT NULL,
    needed_from timestamp with time zone NOT NULL,
    needed_until timestamp with time zone NOT NULL,
    location public.geography(Point,4326) NOT NULL,
    address text NOT NULL,
    urgency text NOT NULL,
    beneficiaries_count integer NOT NULL,
    reason text,
    additional_requirements text,
    status text DEFAULT 'OPEN'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT fars_committed_range CHECK (((quantity_committed >= 0) AND (quantity_committed <= quantity_required))),
    CONSTRAINT fars_window CHECK ((needed_until > needed_from)),
    CONSTRAINT food_assistance_requests_additional_requirements_check CHECK ((length(additional_requirements) <= 1000)),
    CONSTRAINT food_assistance_requests_address_check CHECK (((length(address) >= 5) AND (length(address) <= 300))),
    CONSTRAINT food_assistance_requests_beneficiaries_count_check CHECK ((beneficiaries_count > 0)),
    CONSTRAINT food_assistance_requests_dietary_requirement_check CHECK ((dietary_requirement = ANY (ARRAY['VEG_ONLY'::text, 'ANY'::text]))),
    CONSTRAINT food_assistance_requests_quantity_received_check CHECK ((quantity_received >= 0)),
    CONSTRAINT food_assistance_requests_quantity_required_check CHECK (((quantity_required > 0) AND (quantity_required <= 100000))),
    CONSTRAINT food_assistance_requests_reason_check CHECK ((length(reason) <= 1000)),
    CONSTRAINT food_assistance_requests_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'PARTIALLY_FULFILLED'::text, 'FULFILLED'::text, 'CANCELLED'::text, 'EXPIRED'::text]))),
    CONSTRAINT food_assistance_requests_unit_check CHECK ((unit = ANY (ARRAY['MEALS'::text, 'PACKETS'::text, 'BOXES'::text]))),
    CONSTRAINT food_assistance_requests_urgency_check CHECK ((urgency = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'CRITICAL'::text])))
);


--
-- Name: food_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    max_hours_after_preparation integer,
    requires_refrigeration boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT food_categories_code_check CHECK ((code ~ '^[A-Z][A-Z_]{1,49}$'::text)),
    CONSTRAINT food_categories_max_hours_after_preparation_check CHECK ((max_hours_after_preparation > 0))
);


--
-- Name: handover_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.handover_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pickup_assignment_id uuid NOT NULL,
    allocation_id uuid NOT NULL,
    donor_confirmed_quantity integer,
    donor_confirmed_by uuid,
    donor_confirmed_at timestamp with time zone,
    ngo_received_quantity integer,
    ngo_confirmed_by uuid,
    ngo_confirmed_at timestamp with time zone,
    status text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT handover_records_confirmed_match CHECK (((status <> 'CONFIRMED'::text) OR ((donor_confirmed_quantity IS NOT NULL) AND (ngo_received_quantity IS NOT NULL) AND (donor_confirmed_quantity = ngo_received_quantity) AND (donor_confirmed_quantity > 0)))),
    CONSTRAINT handover_records_donor_confirmed_quantity_check CHECK ((donor_confirmed_quantity >= 0)),
    CONSTRAINT handover_records_ngo_received_quantity_check CHECK ((ngo_received_quantity >= 0)),
    CONSTRAINT handover_records_notes_check CHECK ((length(notes) <= 1000)),
    CONSTRAINT handover_records_status_check CHECK ((status = ANY (ARRAY['PENDING_DONOR'::text, 'PENDING_NGO'::text, 'CONFIRMED'::text, 'DISPUTED'::text])))
);


--
-- Name: idempotency_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    key text NOT NULL,
    user_id uuid,
    request_hash text NOT NULL,
    status text NOT NULL,
    response_status integer,
    response_body jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT idempotency_records_key_check CHECK (((length(key) >= 8) AND (length(key) <= 200))),
    CONSTRAINT idempotency_records_status_check CHECK ((status = ANY (ARRAY['IN_PROGRESS'::text, 'COMPLETED'::text, 'FAILED'::text])))
);


--
-- Name: impact_certificate_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.impact_certificate_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: impact_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impact_certificates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donor_id uuid NOT NULL,
    certificate_number text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    meals_redistributed integer NOT NULL,
    orders_completed integer NOT NULL,
    points_earned integer NOT NULL,
    snapshot jsonb NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT impact_certificates_meals_redistributed_check CHECK ((meals_redistributed >= 0)),
    CONSTRAINT impact_certificates_orders_completed_check CHECK ((orders_completed >= 0)),
    CONSTRAINT impact_certificates_period CHECK ((period_end >= period_start)),
    CONSTRAINT impact_certificates_points_earned_check CHECK ((points_earned >= 0))
);


--
-- Name: invoice_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ngo_id uuid NOT NULL,
    invoice_number text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    tax_total numeric(12,2) NOT NULL,
    total numeric(12,2) NOT NULL,
    currency character(3) DEFAULT 'INR'::bpchar NOT NULL,
    status text DEFAULT 'ISSUED'::text NOT NULL,
    issued_at timestamp with time zone,
    due_at timestamp with time zone,
    paid_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoices_period CHECK ((period_end >= period_start)),
    CONSTRAINT invoices_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ISSUED'::text, 'PAID'::text, 'VOID'::text]))),
    CONSTRAINT invoices_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT invoices_tax_total_check CHECK ((tax_total >= (0)::numeric)),
    CONSTRAINT invoices_total CHECK ((total = (subtotal + tax_total)))
);


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id bigint NOT NULL,
    type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_error text,
    dedupe_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jobs_attempts_range CHECK (((attempts >= 0) AND (attempts <= max_attempts))),
    CONSTRAINT jobs_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 50))),
    CONSTRAINT jobs_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'RUNNING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'DEAD'::text])))
);


--
-- Name: jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.jobs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: location_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_updates (
    id bigint NOT NULL,
    session_id uuid NOT NULL,
    location public.geography(Point,4326) NOT NULL,
    accuracy_m numeric(8,2),
    heading numeric(6,2),
    speed_mps numeric(7,2),
    recorded_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT location_updates_accuracy_m_check CHECK ((accuracy_m >= (0)::numeric)),
    CONSTRAINT location_updates_heading_check CHECK (((heading >= (0)::numeric) AND (heading < (360)::numeric))),
    CONSTRAINT location_updates_speed_mps_check CHECK ((speed_mps >= (0)::numeric))
);


--
-- Name: location_updates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.location_updates ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.location_updates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: match_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    subject_type text NOT NULL,
    donation_id uuid,
    assistance_request_id uuid,
    candidate_ngo_id uuid,
    candidate_donor_id uuid,
    eligible boolean NOT NULL,
    ineligibility_reasons text[] DEFAULT '{}'::text[] NOT NULL,
    score numeric(5,2),
    rank integer,
    ranking_status text NOT NULL,
    criteria jsonb,
    explanation text,
    limitations text[] DEFAULT '{}'::text[] NOT NULL,
    distance_m numeric(12,2),
    travel_time_s integer,
    distance_source text,
    algorithm_version text NOT NULL,
    weights jsonb,
    notified_at timestamp with time zone,
    notification_id uuid,
    viewed_at timestamp with time zone,
    response text DEFAULT 'NONE'::text NOT NULL,
    responded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT match_recommendations_distance_source_check CHECK ((distance_source = ANY (ARRAY['STRAIGHT_LINE_ESTIMATE'::text, 'ROAD_GOOGLE_ROUTES'::text]))),
    CONSTRAINT match_recommendations_rank_check CHECK ((rank > 0)),
    CONSTRAINT match_recommendations_ranking_status_check CHECK ((ranking_status = ANY (ARRAY['RANKED'::text, 'RANKING_UNAVAILABLE'::text, 'NOT_RANKED'::text]))),
    CONSTRAINT match_recommendations_response_check CHECK ((response = ANY (ARRAY['NONE'::text, 'REQUESTED'::text, 'OFFERED'::text, 'DECLINED'::text, 'UNAVAILABLE'::text]))),
    CONSTRAINT match_recommendations_score_check CHECK (((score >= (0)::numeric) AND (score <= (100)::numeric))),
    CONSTRAINT match_recommendations_score_when_eligible CHECK ((eligible OR (score IS NULL))),
    CONSTRAINT match_recommendations_subject CHECK ((((subject_type = 'DONATION'::text) AND (donation_id IS NOT NULL) AND (assistance_request_id IS NULL) AND (candidate_ngo_id IS NOT NULL) AND (candidate_donor_id IS NULL)) OR ((subject_type = 'ASSISTANCE_REQUEST'::text) AND (assistance_request_id IS NOT NULL) AND (donation_id IS NULL) AND (candidate_donor_id IS NOT NULL) AND (candidate_ngo_id IS NULL)))),
    CONSTRAINT match_recommendations_subject_type_check CHECK ((subject_type = ANY (ARRAY['DONATION'::text, 'ASSISTANCE_REQUEST'::text])))
);


--
-- Name: model_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_name text NOT NULL,
    version text NOT NULL,
    algorithm text NOT NULL,
    trained_at timestamp with time zone,
    training_data_label text NOT NULL,
    training_rows integer,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    features jsonb,
    artifact_sha256 text,
    is_active boolean DEFAULT false NOT NULL,
    notes text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_versions_training_data_label_check CHECK ((training_data_label = ANY (ARRAY['REAL'::text, 'SYNTHETIC'::text, 'MIXED'::text])))
);


--
-- Name: ngo_billing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ngo_billing (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ngo_id uuid NOT NULL,
    allocation_id uuid NOT NULL,
    handover_record_id uuid NOT NULL,
    fee_rule_id uuid NOT NULL,
    unit text NOT NULL,
    billable_quantity integer NOT NULL,
    unit_amount numeric(12,2) NOT NULL,
    base_amount numeric(12,2) NOT NULL,
    tax_name text,
    tax_rate_percent numeric(5,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0 NOT NULL,
    total_amount numeric(12,2) NOT NULL,
    currency character(3) DEFAULT 'INR'::bpchar NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    invoice_id uuid,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ngo_billing_base CHECK ((base_amount = (unit_amount * (billable_quantity)::numeric))),
    CONSTRAINT ngo_billing_base_amount_check CHECK ((base_amount >= (0)::numeric)),
    CONSTRAINT ngo_billing_billable_quantity_check CHECK ((billable_quantity > 0)),
    CONSTRAINT ngo_billing_invoiced CHECK (((status <> ALL (ARRAY['INVOICED'::text, 'PAID'::text])) OR (invoice_id IS NOT NULL))),
    CONSTRAINT ngo_billing_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'INVOICED'::text, 'PAID'::text, 'WAIVED'::text, 'VOID'::text]))),
    CONSTRAINT ngo_billing_tax_amount_check CHECK ((tax_amount >= (0)::numeric)),
    CONSTRAINT ngo_billing_tax_rate_percent_check CHECK (((tax_rate_percent >= (0)::numeric) AND (tax_rate_percent <= (100)::numeric))),
    CONSTRAINT ngo_billing_total CHECK ((total_amount = (base_amount + tax_amount))),
    CONSTRAINT ngo_billing_unit_amount_check CHECK ((unit_amount >= (0)::numeric)),
    CONSTRAINT ngo_billing_unit_check CHECK ((unit = ANY (ARRAY['MEALS'::text, 'PACKETS'::text, 'BOXES'::text])))
);


--
-- Name: ngo_food_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ngo_food_preferences (
    ngo_id uuid NOT NULL,
    category_id uuid NOT NULL
);


--
-- Name: ngo_representatives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ngo_representatives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ngo_id uuid NOT NULL,
    user_id uuid NOT NULL,
    id_document_type text NOT NULL,
    id_document_last4 character(4) NOT NULL,
    photo_storage_key text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    added_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ngo_representatives_id_document_last4_check CHECK ((id_document_last4 ~ '^[0-9A-Za-z]{4}$'::text)),
    CONSTRAINT ngo_representatives_id_document_type_check CHECK ((id_document_type = ANY (ARRAY['AADHAAR'::text, 'PAN'::text, 'DRIVING_LICENCE'::text, 'VOTER_ID'::text, 'OTHER'::text]))),
    CONSTRAINT ngo_representatives_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text, 'REVOKED'::text])))
);


--
-- Name: ngos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ngos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    organization_name text NOT NULL,
    registration_number text,
    contact_email public.citext,
    contact_phone text,
    address_line text,
    city text,
    state text,
    postal_code text,
    country character(2) DEFAULT 'IN'::bpchar NOT NULL,
    location public.geography(Point,4326),
    timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
    accepts_veg boolean DEFAULT true NOT NULL,
    accepts_non_veg boolean DEFAULT false NOT NULL,
    max_daily_capacity integer DEFAULT 100 NOT NULL,
    collection_radius_km numeric(6,2) DEFAULT 10 NOT NULL,
    beneficiaries_count integer DEFAULT 0 NOT NULL,
    beneficiary_description text,
    has_refrigeration boolean DEFAULT false NOT NULL,
    default_vehicle_capacity integer,
    verification_status text DEFAULT 'PENDING'::text NOT NULL,
    verification_notes text,
    verified_at timestamp with time zone,
    verified_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ngos_accepts_some_diet CHECK ((accepts_veg OR accepts_non_veg)),
    CONSTRAINT ngos_address_line_check CHECK ((length(address_line) <= 300)),
    CONSTRAINT ngos_beneficiaries_count_check CHECK ((beneficiaries_count >= 0)),
    CONSTRAINT ngos_beneficiary_description_check CHECK ((length(beneficiary_description) <= 1000)),
    CONSTRAINT ngos_city_check CHECK ((length(city) <= 100)),
    CONSTRAINT ngos_collection_radius_km_check CHECK (((collection_radius_km > (0)::numeric) AND (collection_radius_km <= (100)::numeric))),
    CONSTRAINT ngos_contact_phone_check CHECK ((contact_phone ~ '^\+[1-9][0-9]{7,14}$'::text)),
    CONSTRAINT ngos_default_vehicle_capacity_check CHECK ((default_vehicle_capacity > 0)),
    CONSTRAINT ngos_max_daily_capacity_check CHECK (((max_daily_capacity > 0) AND (max_daily_capacity <= 100000))),
    CONSTRAINT ngos_organization_name_check CHECK (((length(organization_name) >= 2) AND (length(organization_name) <= 160))),
    CONSTRAINT ngos_postal_code_check CHECK ((postal_code ~ '^[0-9A-Za-z -]{3,12}$'::text)),
    CONSTRAINT ngos_registration_number_check CHECK ((length(registration_number) <= 60)),
    CONSTRAINT ngos_state_check CHECK ((length(state) <= 100)),
    CONSTRAINT ngos_verification_status_check CHECK ((verification_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'SUSPENDED'::text])))
);


--
-- Name: notification_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_logs (
    id bigint NOT NULL,
    notification_id uuid NOT NULL,
    channel text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    last_error text,
    provider_message_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_logs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT notification_logs_channel_check CHECK ((channel = ANY (ARRAY['SOCKET'::text, 'EMAIL'::text, 'PUSH'::text]))),
    CONSTRAINT notification_logs_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'FAILED'::text, 'SKIPPED'::text])))
);


--
-- Name: notification_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.notification_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notification_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    email_enabled boolean DEFAULT true NOT NULL,
    max_per_hour integer DEFAULT 20 NOT NULL,
    max_distance_km numeric(6,2),
    quiet_hours_start time without time zone,
    quiet_hours_end time without time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_preferences_max_distance_km_check CHECK (((max_distance_km > (0)::numeric) AND (max_distance_km <= (100)::numeric))),
    CONSTRAINT notification_preferences_max_per_hour_check CHECK (((max_per_hour >= 1) AND (max_per_hour <= 100))),
    CONSTRAINT notification_preferences_quiet_pair CHECK (((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL)))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    link_path text,
    priority text DEFAULT 'NORMAL'::text NOT NULL,
    dedupe_key text NOT NULL,
    read_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_body_check CHECK (((length(body) >= 1) AND (length(body) <= 2000))),
    CONSTRAINT notifications_link_path_check CHECK ((link_path ~ '^/([^/\\]|$)'::text)),
    CONSTRAINT notifications_priority_check CHECK ((priority = ANY (ARRAY['LOW'::text, 'NORMAL'::text, 'HIGH'::text]))),
    CONSTRAINT notifications_title_check CHECK (((length(title) >= 1) AND (length(title) <= 160))),
    CONSTRAINT notifications_type_check CHECK ((type ~ '^[A-Z][A-Z_]{2,59}$'::text))
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ngo_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    provider text NOT NULL,
    provider_order_id text,
    provider_payment_id text,
    amount numeric(12,2) NOT NULL,
    currency character(3) DEFAULT 'INR'::bpchar NOT NULL,
    status text NOT NULL,
    failure_reason text,
    reference_note text,
    recorded_by uuid,
    idempotency_key text NOT NULL,
    succeeded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT payments_manual_recorder CHECK (((provider <> 'MANUAL'::text) OR (recorded_by IS NOT NULL))),
    CONSTRAINT payments_provider_check CHECK ((provider = ANY (ARRAY['RAZORPAY'::text, 'MANUAL'::text]))),
    CONSTRAINT payments_reference_note_check CHECK ((length(reference_note) <= 300)),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['CREATED'::text, 'PENDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'REFUNDED'::text])))
);


--
-- Name: pgmigrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pgmigrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    run_on timestamp without time zone NOT NULL
);


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pgmigrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pgmigrations_id_seq OWNED BY public.pgmigrations.id;


--
-- Name: pickup_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pickup_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    allocation_id uuid NOT NULL,
    ngo_id uuid NOT NULL,
    representative_id uuid NOT NULL,
    assigned_by uuid NOT NULL,
    status text DEFAULT 'ASSIGNED'::text NOT NULL,
    scheduled_pickup_at timestamp with time zone,
    destination_location public.geography(Point,4326),
    destination_address text,
    qr_verified_at timestamp with time zone,
    identity_confirmed_at timestamp with time zone,
    handed_over_at timestamp with time zone,
    delivered_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pickup_assignments_cancel_reason_check CHECK ((length(cancel_reason) <= 500)),
    CONSTRAINT pickup_assignments_destination_address_check CHECK ((length(destination_address) <= 300)),
    CONSTRAINT pickup_assignments_status_check CHECK ((status = ANY (ARRAY['ASSIGNED'::text, 'EN_ROUTE'::text, 'VERIFIED'::text, 'HANDED_OVER'::text, 'IN_TRANSIT'::text, 'DELIVERED'::text, 'DISPUTED'::text, 'CANCELLED'::text, 'FAILED'::text]))),
    CONSTRAINT pickup_assignments_verified_requires_checks CHECK (((status <> ALL (ARRAY['VERIFIED'::text, 'HANDED_OVER'::text, 'IN_TRANSIT'::text, 'DELIVERED'::text])) OR ((qr_verified_at IS NOT NULL) AND (identity_confirmed_at IS NOT NULL))))
);


--
-- Name: pickup_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pickup_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pickup_assignment_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    consumed_by uuid,
    revoked_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pickup_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pickup_verifications (
    id bigint NOT NULL,
    pickup_assignment_id uuid,
    method text NOT NULL,
    result text NOT NULL,
    failure_reason text,
    actor_user_id uuid,
    ip inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pickup_verifications_failure_reason_check CHECK ((failure_reason = ANY (ARRAY['TOKEN_NOT_FOUND'::text, 'TOKEN_EXPIRED'::text, 'TOKEN_CONSUMED'::text, 'TOKEN_REVOKED'::text, 'WRONG_DONOR'::text, 'REPRESENTATIVE_INACTIVE'::text, 'PICKUP_NOT_ACTIVE'::text, 'OTP_INVALID'::text, 'OTP_EXPIRED'::text, 'OTP_ATTEMPTS_EXCEEDED'::text, 'OTP_NOT_REQUESTED'::text, 'QR_NOT_VERIFIED'::text, 'RATE_LIMITED'::text]))),
    CONSTRAINT pickup_verifications_method_check CHECK ((method = ANY (ARRAY['QR'::text, 'OTP'::text, 'IDENTITY_CHECK'::text]))),
    CONSTRAINT pickup_verifications_reason CHECK (((result = 'FAILURE'::text) = (failure_reason IS NOT NULL))),
    CONSTRAINT pickup_verifications_result_check CHECK ((result = ANY (ARRAY['SUCCESS'::text, 'FAILURE'::text])))
);


--
-- Name: pickup_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pickup_verifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pickup_verifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_settings_key_check CHECK ((key ~ '^[a-z][a-z0-9_.]{2,79}$'::text))
);


--
-- Name: restaurant_daily_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_daily_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donor_id uuid NOT NULL,
    metric_date date NOT NULL,
    meal_period text NOT NULL,
    unit text DEFAULT 'MEALS'::text NOT NULL,
    prepared_qty integer NOT NULL,
    sold_qty integer NOT NULL,
    surplus_qty integer NOT NULL,
    is_holiday boolean DEFAULT false NOT NULL,
    special_event text,
    data_source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rdm_quantities CHECK (((sold_qty <= prepared_qty) AND (surplus_qty <= prepared_qty))),
    CONSTRAINT restaurant_daily_metrics_data_source_check CHECK ((data_source = ANY (ARRAY['DONOR_ENTERED'::text, 'IMPORTED'::text, 'SYNTHETIC'::text]))),
    CONSTRAINT restaurant_daily_metrics_meal_period_check CHECK ((meal_period = ANY (ARRAY['BREAKFAST'::text, 'LUNCH'::text, 'DINNER'::text, 'ALL_DAY'::text]))),
    CONSTRAINT restaurant_daily_metrics_prepared_qty_check CHECK ((prepared_qty >= 0)),
    CONSTRAINT restaurant_daily_metrics_sold_qty_check CHECK ((sold_qty >= 0)),
    CONSTRAINT restaurant_daily_metrics_special_event_check CHECK ((length(special_event) <= 120)),
    CONSTRAINT restaurant_daily_metrics_surplus_qty_check CHECK ((surplus_qty >= 0)),
    CONSTRAINT restaurant_daily_metrics_unit_check CHECK ((unit = ANY (ARRAY['MEALS'::text, 'PACKETS'::text, 'BOXES'::text])))
);


--
-- Name: reward_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_balances (
    donor_id uuid NOT NULL,
    balance integer DEFAULT 0 NOT NULL,
    lifetime_points integer DEFAULT 0 NOT NULL,
    lifetime_meals integer DEFAULT 0 NOT NULL,
    lifetime_orders integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reward_balances_balance_check CHECK ((balance >= 0)),
    CONSTRAINT reward_balances_lifetime_meals_check CHECK ((lifetime_meals >= 0)),
    CONSTRAINT reward_balances_lifetime_orders_check CHECK ((lifetime_orders >= 0)),
    CONSTRAINT reward_balances_lifetime_points_check CHECK ((lifetime_points >= 0))
);


--
-- Name: reward_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    unit text NOT NULL,
    basis text NOT NULL,
    points integer NOT NULL,
    lifetime_threshold integer DEFAULT 0 NOT NULL,
    description text,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_to timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reward_rules_basis_check CHECK ((basis = ANY (ARRAY['PER_UNIT'::text, 'PER_ORDER'::text]))),
    CONSTRAINT reward_rules_effective_range CHECK (((effective_to IS NULL) OR (effective_to > effective_from))),
    CONSTRAINT reward_rules_lifetime_threshold_check CHECK ((lifetime_threshold >= 0)),
    CONSTRAINT reward_rules_points_check CHECK (((points > 0) AND (points <= 10000))),
    CONSTRAINT reward_rules_threshold_per_unit CHECK (((basis = 'PER_UNIT'::text) OR (lifetime_threshold = 0))),
    CONSTRAINT reward_rules_unit_check CHECK ((unit = ANY (ARRAY['MEALS'::text, 'PACKETS'::text, 'BOXES'::text])))
);


--
-- Name: reward_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    min_lifetime_points integer NOT NULL,
    benefits text,
    sort_order integer NOT NULL,
    CONSTRAINT reward_tiers_min_lifetime_points_check CHECK ((min_lifetime_points >= 0)),
    CONSTRAINT reward_tiers_name_check CHECK ((name = ANY (ARRAY['BRONZE'::text, 'SILVER'::text, 'GOLD'::text, 'PLATINUM'::text])))
);


--
-- Name: reward_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donor_id uuid NOT NULL,
    type text NOT NULL,
    points integer NOT NULL,
    balance_after integer NOT NULL,
    unit text,
    quantity integer,
    reference_type text NOT NULL,
    reference_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    calculation jsonb DEFAULT '{}'::jsonb NOT NULL,
    description text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reward_transactions_balance_after_check CHECK ((balance_after >= 0)),
    CONSTRAINT reward_transactions_points_check CHECK ((points <> 0)),
    CONSTRAINT reward_transactions_quantity_check CHECK ((quantity >= 0)),
    CONSTRAINT reward_transactions_reference_type_check CHECK ((reference_type = ANY (ARRAY['HANDOVER'::text, 'ADMIN_ADJUSTMENT'::text, 'DISPUTE_RESOLUTION'::text]))),
    CONSTRAINT reward_transactions_type_check CHECK ((type = ANY (ARRAY['CREDIT'::text, 'REVERSAL'::text, 'ADJUSTMENT'::text]))),
    CONSTRAINT reward_transactions_unit_check CHECK ((unit = ANY (ARRAY['MEALS'::text, 'PACKETS'::text, 'BOXES'::text])))
);


--
-- Name: service_fee_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_fee_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    unit text NOT NULL,
    amount_per_unit numeric(12,2) NOT NULL,
    currency character(3) DEFAULT 'INR'::bpchar NOT NULL,
    description text,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_to timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_fee_rules_amount_per_unit_check CHECK ((amount_per_unit >= (0)::numeric)),
    CONSTRAINT service_fee_rules_effective_range CHECK (((effective_to IS NULL) OR (effective_to > effective_from))),
    CONSTRAINT service_fee_rules_unit_check CHECK ((unit = ANY (ARRAY['MEALS'::text, 'PACKETS'::text, 'BOXES'::text])))
);


--
-- Name: surplus_predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.surplus_predictions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donor_id uuid NOT NULL,
    target_date date NOT NULL,
    meal_period text NOT NULL,
    unit text DEFAULT 'MEALS'::text NOT NULL,
    status text NOT NULL,
    predicted_quantity integer,
    lower_bound integer,
    upper_bound integer,
    basis text,
    model_version_id uuid,
    input_summary jsonb,
    data_label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT surplus_predictions_data_label_check CHECK ((data_label = ANY (ARRAY['REAL'::text, 'SYNTHETIC'::text, 'MIXED'::text]))),
    CONSTRAINT surplus_predictions_lower_bound_check CHECK ((lower_bound >= 0)),
    CONSTRAINT surplus_predictions_meal_period_check CHECK ((meal_period = ANY (ARRAY['BREAKFAST'::text, 'LUNCH'::text, 'DINNER'::text, 'ALL_DAY'::text]))),
    CONSTRAINT surplus_predictions_ok_has_value CHECK (((status <> 'OK'::text) OR (predicted_quantity IS NOT NULL))),
    CONSTRAINT surplus_predictions_predicted_quantity_check CHECK ((predicted_quantity >= 0)),
    CONSTRAINT surplus_predictions_status_check CHECK ((status = ANY (ARRAY['OK'::text, 'INSUFFICIENT_HISTORY'::text]))),
    CONSTRAINT surplus_predictions_upper_bound_check CHECK ((upper_bound >= 0))
);


--
-- Name: tracking_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracking_events (
    id bigint NOT NULL,
    session_id uuid,
    pickup_assignment_id uuid,
    event_type text NOT NULL,
    actor_user_id uuid,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tracking_events_event_type_check CHECK ((event_type = ANY (ARRAY['STARTED'::text, 'PERMISSION_DENIED'::text, 'POSITION_UNAVAILABLE'::text, 'DISCONNECTED'::text, 'RECONNECTED'::text, 'STALE'::text, 'NEAR_DESTINATION'::text, 'STOPPED'::text, 'ADMIN_VIEWED'::text]))),
    CONSTRAINT tracking_events_subject CHECK ((num_nonnulls(session_id, pickup_assignment_id) >= 1))
);


--
-- Name: tracking_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tracking_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.tracking_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tracking_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracking_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pickup_assignment_id uuid NOT NULL,
    stage text NOT NULL,
    tracked_user_id uuid NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    consent_given_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    end_reason text,
    last_location public.geography(Point,4326),
    last_accuracy_m numeric(8,2),
    last_recorded_at timestamp with time zone,
    destination_location public.geography(Point,4326),
    total_distance_m numeric(12,2) DEFAULT 0 NOT NULL,
    points_purged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tracking_sessions_end_reason_check CHECK ((length(end_reason) <= 200)),
    CONSTRAINT tracking_sessions_ended CHECK (((status = 'ACTIVE'::text) = (ended_at IS NULL))),
    CONSTRAINT tracking_sessions_stage_check CHECK ((stage = ANY (ARRAY['TO_PICKUP'::text, 'TO_DESTINATION'::text]))),
    CONSTRAINT tracking_sessions_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'ENDED'::text, 'EXPIRED'::text])))
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    family_id uuid NOT NULL,
    refresh_token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_reason text,
    replaced_by_session_id uuid,
    ip inet,
    user_agent text,
    CONSTRAINT user_sessions_revoked_reason_check CHECK ((revoked_reason = ANY (ARRAY['LOGOUT'::text, 'ROTATED'::text, 'REUSE_DETECTED'::text, 'ADMIN'::text, 'PASSWORD_CHANGED'::text, 'ACCOUNT_SUSPENDED'::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    password_hash text,
    role text NOT NULL,
    account_status text DEFAULT 'ACTIVE'::text NOT NULL,
    full_name text NOT NULL,
    phone text,
    email_verified_at timestamp with time zone,
    failed_login_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    password_changed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT users_account_status_check CHECK ((account_status = ANY (ARRAY['INVITED'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'DEACTIVATED'::text]))),
    CONSTRAINT users_email_check CHECK (((length((email)::text) <= 254) AND (email OPERATOR(public.~) '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::public.citext))),
    CONSTRAINT users_failed_login_attempts_check CHECK ((failed_login_attempts >= 0)),
    CONSTRAINT users_full_name_check CHECK (((length(full_name) >= 2) AND (length(full_name) <= 120))),
    CONSTRAINT users_password_required CHECK (((account_status = 'INVITED'::text) OR (password_hash IS NOT NULL))),
    CONSTRAINT users_phone_check CHECK ((phone ~ '^\+[1-9][0-9]{7,14}$'::text)),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['DONOR'::text, 'NGO'::text, 'ADMIN'::text])))
);


--
-- Name: verification_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donor_id uuid,
    ngo_id uuid,
    document_type text NOT NULL,
    storage_key text NOT NULL,
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes integer NOT NULL,
    sha256 character(64) NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    review_notes text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT verification_documents_document_type_check CHECK ((document_type = ANY (ARRAY['BUSINESS_LICENCE'::text, 'FSSAI_LICENCE'::text, 'NGO_REGISTRATION'::text, 'TAX_EXEMPTION'::text, 'ID_PROOF'::text, 'OTHER'::text]))),
    CONSTRAINT verification_documents_mime_type_check CHECK ((mime_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text]))),
    CONSTRAINT verification_documents_one_owner CHECK ((num_nonnulls(donor_id, ngo_id) = 1)),
    CONSTRAINT verification_documents_original_filename_check CHECK ((length(original_filename) <= 255)),
    CONSTRAINT verification_documents_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 10485760))),
    CONSTRAINT verification_documents_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'REJECTED'::text])))
);


--
-- Name: pgmigrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations ALTER COLUMN id SET DEFAULT nextval('public.pgmigrations_id_seq'::regclass);


--
-- Name: account_tokens account_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_tokens
    ADD CONSTRAINT account_tokens_pkey PRIMARY KEY (id);


--
-- Name: admin_profiles admin_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_profiles
    ADD CONSTRAINT admin_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: ai_conversations ai_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_pkey PRIMARY KEY (id);


--
-- Name: ai_insights ai_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_insights
    ADD CONSTRAINT ai_insights_pkey PRIMARY KEY (id);


--
-- Name: ai_interactions ai_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interactions
    ADD CONSTRAINT ai_interactions_pkey PRIMARY KEY (id);


--
-- Name: assistance_offers assistance_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_offers
    ADD CONSTRAINT assistance_offers_pkey PRIMARY KEY (id);


--
-- Name: assistance_request_history assistance_request_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_request_history
    ADD CONSTRAINT assistance_request_history_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: collection_plans collection_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_plans
    ADD CONSTRAINT collection_plans_pkey PRIMARY KEY (id);


--
-- Name: collection_stops collection_stops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_stops
    ADD CONSTRAINT collection_stops_pkey PRIMARY KEY (id);


--
-- Name: delivery_confirmations delivery_confirmations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_confirmations
    ADD CONSTRAINT delivery_confirmations_pkey PRIMARY KEY (id);


--
-- Name: disputes disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);


--
-- Name: donation_allocations donation_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_allocations
    ADD CONSTRAINT donation_allocations_pkey PRIMARY KEY (id);


--
-- Name: donation_requests donation_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_requests
    ADD CONSTRAINT donation_requests_pkey PRIMARY KEY (id);


--
-- Name: donation_status_history donation_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_status_history
    ADD CONSTRAINT donation_status_history_pkey PRIMARY KEY (id);


--
-- Name: donations donations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_pkey PRIMARY KEY (id);


--
-- Name: donor_availability donor_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_availability
    ADD CONSTRAINT donor_availability_pkey PRIMARY KEY (id);


--
-- Name: donor_food_categories donor_food_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_food_categories
    ADD CONSTRAINT donor_food_categories_pkey PRIMARY KEY (donor_id, category_id);


--
-- Name: donors donors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donors
    ADD CONSTRAINT donors_pkey PRIMARY KEY (id);


--
-- Name: food_assistance_requests food_assistance_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_assistance_requests
    ADD CONSTRAINT food_assistance_requests_pkey PRIMARY KEY (id);


--
-- Name: food_categories food_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_categories
    ADD CONSTRAINT food_categories_pkey PRIMARY KEY (id);


--
-- Name: handover_records handover_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_records
    ADD CONSTRAINT handover_records_pkey PRIMARY KEY (id);


--
-- Name: idempotency_records idempotency_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT idempotency_records_pkey PRIMARY KEY (id);


--
-- Name: impact_certificates impact_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impact_certificates
    ADD CONSTRAINT impact_certificates_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: location_updates location_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_updates
    ADD CONSTRAINT location_updates_pkey PRIMARY KEY (id);


--
-- Name: match_recommendations match_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_recommendations
    ADD CONSTRAINT match_recommendations_pkey PRIMARY KEY (id);


--
-- Name: model_versions model_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_versions
    ADD CONSTRAINT model_versions_pkey PRIMARY KEY (id);


--
-- Name: ngo_billing ngo_billing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_billing
    ADD CONSTRAINT ngo_billing_pkey PRIMARY KEY (id);


--
-- Name: ngo_food_preferences ngo_food_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_food_preferences
    ADD CONSTRAINT ngo_food_preferences_pkey PRIMARY KEY (ngo_id, category_id);


--
-- Name: ngo_representatives ngo_representatives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_representatives
    ADD CONSTRAINT ngo_representatives_pkey PRIMARY KEY (id);


--
-- Name: ngos ngos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngos
    ADD CONSTRAINT ngos_pkey PRIMARY KEY (id);


--
-- Name: notification_logs notification_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: pgmigrations pgmigrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations
    ADD CONSTRAINT pgmigrations_pkey PRIMARY KEY (id);


--
-- Name: pickup_assignments pickup_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_assignments
    ADD CONSTRAINT pickup_assignments_pkey PRIMARY KEY (id);


--
-- Name: pickup_tokens pickup_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_tokens
    ADD CONSTRAINT pickup_tokens_pkey PRIMARY KEY (id);


--
-- Name: pickup_verifications pickup_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_verifications
    ADD CONSTRAINT pickup_verifications_pkey PRIMARY KEY (id);


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (key);


--
-- Name: restaurant_daily_metrics restaurant_daily_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_daily_metrics
    ADD CONSTRAINT restaurant_daily_metrics_pkey PRIMARY KEY (id);


--
-- Name: reward_balances reward_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_balances
    ADD CONSTRAINT reward_balances_pkey PRIMARY KEY (donor_id);


--
-- Name: reward_rules reward_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_rules
    ADD CONSTRAINT reward_rules_pkey PRIMARY KEY (id);


--
-- Name: reward_tiers reward_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_tiers
    ADD CONSTRAINT reward_tiers_pkey PRIMARY KEY (id);


--
-- Name: reward_transactions reward_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_transactions
    ADD CONSTRAINT reward_transactions_pkey PRIMARY KEY (id);


--
-- Name: service_fee_rules service_fee_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_fee_rules
    ADD CONSTRAINT service_fee_rules_pkey PRIMARY KEY (id);


--
-- Name: surplus_predictions surplus_predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.surplus_predictions
    ADD CONSTRAINT surplus_predictions_pkey PRIMARY KEY (id);


--
-- Name: tracking_events tracking_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_events
    ADD CONSTRAINT tracking_events_pkey PRIMARY KEY (id);


--
-- Name: tracking_sessions tracking_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_sessions
    ADD CONSTRAINT tracking_sessions_pkey PRIMARY KEY (id);


--
-- Name: account_tokens uq_account_tokens__token_hash; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_tokens
    ADD CONSTRAINT uq_account_tokens__token_hash UNIQUE (token_hash);


--
-- Name: assistance_offers uq_assistance_offers__donation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_offers
    ADD CONSTRAINT uq_assistance_offers__donation UNIQUE (donation_id);


--
-- Name: collection_stops uq_collection_stops__sequence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_stops
    ADD CONSTRAINT uq_collection_stops__sequence UNIQUE (plan_id, sequence);


--
-- Name: delivery_confirmations uq_delivery_confirmations__assignment; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_confirmations
    ADD CONSTRAINT uq_delivery_confirmations__assignment UNIQUE (pickup_assignment_id);


--
-- Name: donation_allocations uq_donation_allocations__offer; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_allocations
    ADD CONSTRAINT uq_donation_allocations__offer UNIQUE (assistance_offer_id);


--
-- Name: donation_allocations uq_donation_allocations__request; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_allocations
    ADD CONSTRAINT uq_donation_allocations__request UNIQUE (donation_request_id);


--
-- Name: donor_availability uq_donor_availability__slot; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_availability
    ADD CONSTRAINT uq_donor_availability__slot UNIQUE (donor_id, iso_day_of_week, opens_at);


--
-- Name: donors uq_donors__owner_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donors
    ADD CONSTRAINT uq_donors__owner_user UNIQUE (owner_user_id);


--
-- Name: food_categories uq_food_categories__code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_categories
    ADD CONSTRAINT uq_food_categories__code UNIQUE (code);


--
-- Name: handover_records uq_handover_records__assignment; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_records
    ADD CONSTRAINT uq_handover_records__assignment UNIQUE (pickup_assignment_id);


--
-- Name: idempotency_records uq_idempotency_records__scope_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT uq_idempotency_records__scope_key UNIQUE (scope, key);


--
-- Name: impact_certificates uq_impact_certificates__number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impact_certificates
    ADD CONSTRAINT uq_impact_certificates__number UNIQUE (certificate_number);


--
-- Name: impact_certificates uq_impact_certificates__period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impact_certificates
    ADD CONSTRAINT uq_impact_certificates__period UNIQUE (donor_id, period_start, period_end);


--
-- Name: invoices uq_invoices__ngo_period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT uq_invoices__ngo_period UNIQUE (ngo_id, period_start, period_end);


--
-- Name: invoices uq_invoices__number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT uq_invoices__number UNIQUE (invoice_number);


--
-- Name: jobs uq_jobs__dedupe_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT uq_jobs__dedupe_key UNIQUE (dedupe_key);


--
-- Name: match_recommendations uq_match_recommendations__candidate; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_recommendations
    ADD CONSTRAINT uq_match_recommendations__candidate UNIQUE NULLS NOT DISTINCT (run_id, candidate_ngo_id, candidate_donor_id);


--
-- Name: model_versions uq_model_versions__name_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_versions
    ADD CONSTRAINT uq_model_versions__name_version UNIQUE (model_name, version);


--
-- Name: ngo_billing uq_ngo_billing__allocation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_billing
    ADD CONSTRAINT uq_ngo_billing__allocation UNIQUE (allocation_id);


--
-- Name: ngo_billing uq_ngo_billing__handover; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_billing
    ADD CONSTRAINT uq_ngo_billing__handover UNIQUE (handover_record_id);


--
-- Name: ngo_billing uq_ngo_billing__idempotency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_billing
    ADD CONSTRAINT uq_ngo_billing__idempotency UNIQUE (idempotency_key);


--
-- Name: ngo_representatives uq_ngo_representatives__user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_representatives
    ADD CONSTRAINT uq_ngo_representatives__user UNIQUE (user_id);


--
-- Name: ngos uq_ngos__owner_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngos
    ADD CONSTRAINT uq_ngos__owner_user UNIQUE (owner_user_id);


--
-- Name: notification_logs uq_notification_logs__channel; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT uq_notification_logs__channel UNIQUE (notification_id, channel);


--
-- Name: notifications uq_notifications__user_dedupe; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT uq_notifications__user_dedupe UNIQUE (user_id, dedupe_key);


--
-- Name: payments uq_payments__idempotency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT uq_payments__idempotency UNIQUE (idempotency_key);


--
-- Name: payments uq_payments__order; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT uq_payments__order UNIQUE (provider_order_id);


--
-- Name: payments uq_payments__payment; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT uq_payments__payment UNIQUE (provider_payment_id);


--
-- Name: pickup_tokens uq_pickup_tokens__hash; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_tokens
    ADD CONSTRAINT uq_pickup_tokens__hash UNIQUE (token_hash);


--
-- Name: restaurant_daily_metrics uq_rdm__day; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_daily_metrics
    ADD CONSTRAINT uq_rdm__day UNIQUE (donor_id, metric_date, meal_period);


--
-- Name: reward_tiers uq_reward_tiers__min; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_tiers
    ADD CONSTRAINT uq_reward_tiers__min UNIQUE (min_lifetime_points);


--
-- Name: reward_tiers uq_reward_tiers__name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_tiers
    ADD CONSTRAINT uq_reward_tiers__name UNIQUE (name);


--
-- Name: reward_transactions uq_reward_transactions__idempotency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_transactions
    ADD CONSTRAINT uq_reward_transactions__idempotency UNIQUE (idempotency_key);


--
-- Name: reward_transactions uq_reward_transactions__reference; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_transactions
    ADD CONSTRAINT uq_reward_transactions__reference UNIQUE (reference_type, reference_id, type);


--
-- Name: user_sessions uq_user_sessions__refresh_token_hash; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT uq_user_sessions__refresh_token_hash UNIQUE (refresh_token_hash);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verification_documents verification_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_documents
    ADD CONSTRAINT verification_documents_pkey PRIMARY KEY (id);


--
-- Name: idx_ai_conversations__user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_conversations__user ON public.ai_conversations USING btree (user_id, updated_at DESC);


--
-- Name: idx_ai_insights__audience; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_insights__audience ON public.ai_insights USING btree (audience, created_at DESC);


--
-- Name: idx_ai_interactions__conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interactions__conversation ON public.ai_interactions USING btree (conversation_id, id);


--
-- Name: idx_ai_interactions__created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interactions__created ON public.ai_interactions USING btree (created_at);


--
-- Name: idx_assistance_offers__donor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assistance_offers__donor ON public.assistance_offers USING btree (donor_id, created_at DESC);


--
-- Name: idx_assistance_request_history__request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assistance_request_history__request ON public.assistance_request_history USING btree (assistance_request_id, created_at);


--
-- Name: idx_audit_logs__action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs__action ON public.audit_logs USING btree (action, occurred_at);


--
-- Name: idx_audit_logs__actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs__actor ON public.audit_logs USING btree (actor_user_id, occurred_at);


--
-- Name: idx_audit_logs__entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs__entity ON public.audit_logs USING btree (entity_type, entity_id, occurred_at);


--
-- Name: idx_collection_plans__ngo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collection_plans__ngo ON public.collection_plans USING btree (ngo_id, plan_date DESC);


--
-- Name: idx_collection_stops__plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collection_stops__plan ON public.collection_stops USING btree (plan_id);


--
-- Name: idx_disputes__status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputes__status ON public.disputes USING btree (status, created_at DESC);


--
-- Name: idx_donation_allocations__donation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donation_allocations__donation ON public.donation_allocations USING btree (donation_id);


--
-- Name: idx_donation_allocations__ngo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donation_allocations__ngo ON public.donation_allocations USING btree (ngo_id, status);


--
-- Name: idx_donation_requests__ngo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donation_requests__ngo ON public.donation_requests USING btree (ngo_id, created_at DESC);


--
-- Name: idx_donation_status_history__donation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donation_status_history__donation ON public.donation_status_history USING btree (donation_id, created_at);


--
-- Name: idx_donations__donor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donations__donor ON public.donations USING btree (donor_id, created_at DESC);


--
-- Name: idx_donations__open_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donations__open_location ON public.donations USING gist (location) WHERE ((status = ANY (ARRAY['AVAILABLE'::text, 'PARTIALLY_RESERVED'::text])) AND (deleted_at IS NULL));


--
-- Name: idx_donations__status_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donations__status_deadline ON public.donations USING btree (status, pickup_deadline);


--
-- Name: idx_donors__location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donors__location ON public.donors USING gist (location);


--
-- Name: idx_donors__verification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donors__verification ON public.donors USING btree (verification_status);


--
-- Name: idx_fars__ngo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fars__ngo ON public.food_assistance_requests USING btree (ngo_id, created_at DESC);


--
-- Name: idx_fars__open_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fars__open_location ON public.food_assistance_requests USING gist (location) WHERE ((status = ANY (ARRAY['OPEN'::text, 'PARTIALLY_FULFILLED'::text])) AND (deleted_at IS NULL));


--
-- Name: idx_fars__status_until; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fars__status_until ON public.food_assistance_requests USING btree (status, needed_until);


--
-- Name: idx_handover_records__allocation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_handover_records__allocation ON public.handover_records USING btree (allocation_id);


--
-- Name: idx_idempotency_records__expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idempotency_records__expires ON public.idempotency_records USING btree (expires_at);


--
-- Name: idx_invoices__ngo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices__ngo ON public.invoices USING btree (ngo_id, issued_at DESC);


--
-- Name: idx_jobs__runnable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs__runnable ON public.jobs USING btree (run_at) WHERE (status = 'PENDING'::text);


--
-- Name: idx_jobs__status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs__status ON public.jobs USING btree (status, updated_at);


--
-- Name: idx_location_updates__session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_updates__session ON public.location_updates USING btree (session_id, recorded_at);


--
-- Name: idx_match_recommendations__donation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_recommendations__donation ON public.match_recommendations USING btree (donation_id, created_at DESC);


--
-- Name: idx_match_recommendations__donor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_recommendations__donor ON public.match_recommendations USING btree (candidate_donor_id, created_at DESC);


--
-- Name: idx_match_recommendations__ngo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_recommendations__ngo ON public.match_recommendations USING btree (candidate_ngo_id, created_at DESC);


--
-- Name: idx_match_recommendations__request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_recommendations__request ON public.match_recommendations USING btree (assistance_request_id, created_at DESC);


--
-- Name: idx_ngo_billing__invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ngo_billing__invoice ON public.ngo_billing USING btree (invoice_id);


--
-- Name: idx_ngo_billing__ngo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ngo_billing__ngo ON public.ngo_billing USING btree (ngo_id, created_at DESC);


--
-- Name: idx_ngo_representatives__ngo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ngo_representatives__ngo ON public.ngo_representatives USING btree (ngo_id, status);


--
-- Name: idx_ngos__location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ngos__location ON public.ngos USING gist (location);


--
-- Name: idx_ngos__verification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ngos__verification ON public.ngos USING btree (verification_status);


--
-- Name: idx_notification_logs__status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_logs__status ON public.notification_logs USING btree (status, next_attempt_at);


--
-- Name: idx_notifications__unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications__unread ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);


--
-- Name: idx_notifications__user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications__user ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_payments__invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments__invoice ON public.payments USING btree (invoice_id);


--
-- Name: idx_pickup_assignments__ngo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pickup_assignments__ngo ON public.pickup_assignments USING btree (ngo_id, created_at DESC);


--
-- Name: idx_pickup_assignments__representative; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pickup_assignments__representative ON public.pickup_assignments USING btree (representative_id, status);


--
-- Name: idx_pickup_verifications__assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pickup_verifications__assignment ON public.pickup_verifications USING btree (pickup_assignment_id, created_at);


--
-- Name: idx_pickup_verifications__created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pickup_verifications__created ON public.pickup_verifications USING btree (created_at DESC);


--
-- Name: idx_rdm__donor_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rdm__donor_date ON public.restaurant_daily_metrics USING btree (donor_id, metric_date);


--
-- Name: idx_reward_transactions__donor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reward_transactions__donor ON public.reward_transactions USING btree (donor_id, created_at DESC);


--
-- Name: idx_surplus_predictions__donor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_surplus_predictions__donor ON public.surplus_predictions USING btree (donor_id, target_date, created_at DESC);


--
-- Name: idx_tracking_events__session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracking_events__session ON public.tracking_events USING btree (session_id, created_at);


--
-- Name: idx_tracking_sessions__assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracking_sessions__assignment ON public.tracking_sessions USING btree (pickup_assignment_id);


--
-- Name: idx_tracking_sessions__ended; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracking_sessions__ended ON public.tracking_sessions USING btree (ended_at) WHERE (points_purged_at IS NULL);


--
-- Name: idx_user_sessions__active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions__active ON public.user_sessions USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_user_sessions__family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions__family ON public.user_sessions USING btree (family_id);


--
-- Name: idx_users__role_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users__role_status ON public.users USING btree (role, account_status);


--
-- Name: idx_verification_documents__donor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_documents__donor ON public.verification_documents USING btree (donor_id);


--
-- Name: idx_verification_documents__ngo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_documents__ngo ON public.verification_documents USING btree (ngo_id);


--
-- Name: uq_account_tokens__live; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_account_tokens__live ON public.account_tokens USING btree (user_id, purpose) WHERE ((used_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: uq_assistance_offers__active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_assistance_offers__active ON public.assistance_offers USING btree (assistance_request_id, donor_id) WHERE (status = ANY (ARRAY['PROPOSED'::text, 'ACCEPTED'::text, 'RESERVED'::text, 'PICKUP_ASSIGNED'::text]));


--
-- Name: uq_disputes__open_handover; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_disputes__open_handover ON public.disputes USING btree (handover_record_id) WHERE ((status = ANY (ARRAY['OPEN'::text, 'UNDER_REVIEW'::text])) AND (handover_record_id IS NOT NULL));


--
-- Name: uq_donation_requests__active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_donation_requests__active ON public.donation_requests USING btree (donation_id, ngo_id) WHERE (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text]));


--
-- Name: uq_model_versions__active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_model_versions__active ON public.model_versions USING btree (model_name) WHERE is_active;


--
-- Name: uq_pickup_assignments__active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pickup_assignments__active ON public.pickup_assignments USING btree (allocation_id) WHERE (status <> ALL (ARRAY['CANCELLED'::text, 'FAILED'::text]));


--
-- Name: uq_pickup_tokens__live; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pickup_tokens__live ON public.pickup_tokens USING btree (pickup_assignment_id) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: uq_reward_rules__active_bracket; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_reward_rules__active_bracket ON public.reward_rules USING btree (unit, lifetime_threshold) WHERE is_active;


--
-- Name: uq_service_fee_rules__active_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_service_fee_rules__active_unit ON public.service_fee_rules USING btree (unit) WHERE is_active;


--
-- Name: uq_tracking_sessions__active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tracking_sessions__active ON public.tracking_sessions USING btree (pickup_assignment_id, stage) WHERE (status = 'ACTIVE'::text);


--
-- Name: uq_users__email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_users__email ON public.users USING btree (email) WHERE (deleted_at IS NULL);


--
-- Name: ai_conversations trg_ai_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_conversations_updated_at BEFORE UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: assistance_offers trg_assistance_offers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assistance_offers_updated_at BEFORE UPDATE ON public.assistance_offers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: assistance_request_history trg_assistance_request_history_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assistance_request_history_append_only BEFORE DELETE OR UPDATE ON public.assistance_request_history FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: audit_logs trg_audit_logs_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_logs_append_only BEFORE DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: collection_plans trg_collection_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_collection_plans_updated_at BEFORE UPDATE ON public.collection_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: disputes trg_disputes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_disputes_updated_at BEFORE UPDATE ON public.disputes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: donation_allocations trg_donation_allocations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_donation_allocations_updated_at BEFORE UPDATE ON public.donation_allocations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: donation_requests trg_donation_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_donation_requests_updated_at BEFORE UPDATE ON public.donation_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: donation_status_history trg_donation_status_history_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_donation_status_history_append_only BEFORE DELETE OR UPDATE ON public.donation_status_history FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: donations trg_donations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_donations_updated_at BEFORE UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: donors trg_donors_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_donors_updated_at BEFORE UPDATE ON public.donors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: food_assistance_requests trg_fars_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fars_updated_at BEFORE UPDATE ON public.food_assistance_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: food_categories trg_food_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_food_categories_updated_at BEFORE UPDATE ON public.food_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: handover_records trg_handover_records_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_handover_records_updated_at BEFORE UPDATE ON public.handover_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: invoices trg_invoices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: jobs trg_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ngo_billing trg_ngo_billing_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ngo_billing_updated_at BEFORE UPDATE ON public.ngo_billing FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ngo_representatives trg_ngo_representatives_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ngo_representatives_updated_at BEFORE UPDATE ON public.ngo_representatives FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ngos trg_ngos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ngos_updated_at BEFORE UPDATE ON public.ngos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: notification_logs trg_notification_logs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notification_logs_updated_at BEFORE UPDATE ON public.notification_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: notification_preferences trg_notification_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notification_preferences_updated_at BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payments trg_payments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pickup_assignments trg_pickup_assignments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pickup_assignments_updated_at BEFORE UPDATE ON public.pickup_assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pickup_verifications trg_pickup_verifications_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pickup_verifications_append_only BEFORE DELETE OR UPDATE ON public.pickup_verifications FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: platform_settings trg_platform_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_platform_settings_updated_at BEFORE UPDATE ON public.platform_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: restaurant_daily_metrics trg_rdm_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rdm_updated_at BEFORE UPDATE ON public.restaurant_daily_metrics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: reward_balances trg_reward_balances_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reward_balances_updated_at BEFORE UPDATE ON public.reward_balances FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: reward_transactions trg_reward_transactions_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reward_transactions_append_only BEFORE DELETE OR UPDATE ON public.reward_transactions FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: tracking_sessions trg_tracking_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tracking_sessions_updated_at BEFORE UPDATE ON public.tracking_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: account_tokens account_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_tokens
    ADD CONSTRAINT account_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: account_tokens account_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_tokens
    ADD CONSTRAINT account_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: admin_profiles admin_profiles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_profiles
    ADD CONSTRAINT admin_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: admin_profiles admin_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_profiles
    ADD CONSTRAINT admin_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ai_conversations ai_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ai_insights ai_insights_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_insights
    ADD CONSTRAINT ai_insights_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donors(id);


--
-- Name: ai_insights ai_insights_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_insights
    ADD CONSTRAINT ai_insights_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id);


--
-- Name: ai_interactions ai_interactions_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interactions
    ADD CONSTRAINT ai_interactions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.ai_conversations(id) ON DELETE CASCADE;


--
-- Name: ai_interactions ai_interactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interactions
    ADD CONSTRAINT ai_interactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: assistance_offers assistance_offers_assistance_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_offers
    ADD CONSTRAINT assistance_offers_assistance_request_id_fkey FOREIGN KEY (assistance_request_id) REFERENCES public.food_assistance_requests(id);


--
-- Name: assistance_offers assistance_offers_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_offers
    ADD CONSTRAINT assistance_offers_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id);


--
-- Name: assistance_offers assistance_offers_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_offers
    ADD CONSTRAINT assistance_offers_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.food_categories(id);


--
-- Name: assistance_offers assistance_offers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_offers
    ADD CONSTRAINT assistance_offers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: assistance_offers assistance_offers_donation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_offers
    ADD CONSTRAINT assistance_offers_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donations(id);


--
-- Name: assistance_offers assistance_offers_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_offers
    ADD CONSTRAINT assistance_offers_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donors(id);


--
-- Name: assistance_offers assistance_offers_responded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_offers
    ADD CONSTRAINT assistance_offers_responded_by_fkey FOREIGN KEY (responded_by) REFERENCES public.users(id);


--
-- Name: assistance_request_history assistance_request_history_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_request_history
    ADD CONSTRAINT assistance_request_history_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: assistance_request_history assistance_request_history_assistance_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_request_history
    ADD CONSTRAINT assistance_request_history_assistance_offer_id_fkey FOREIGN KEY (assistance_offer_id) REFERENCES public.assistance_offers(id);


--
-- Name: assistance_request_history assistance_request_history_assistance_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistance_request_history
    ADD CONSTRAINT assistance_request_history_assistance_request_id_fkey FOREIGN KEY (assistance_request_id) REFERENCES public.food_assistance_requests(id);


--
-- Name: collection_plans collection_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_plans
    ADD CONSTRAINT collection_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: collection_plans collection_plans_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_plans
    ADD CONSTRAINT collection_plans_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id);


--
-- Name: collection_plans collection_plans_representative_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_plans
    ADD CONSTRAINT collection_plans_representative_id_fkey FOREIGN KEY (representative_id) REFERENCES public.ngo_representatives(id);


--
-- Name: collection_stops collection_stops_allocation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_stops
    ADD CONSTRAINT collection_stops_allocation_id_fkey FOREIGN KEY (allocation_id) REFERENCES public.donation_allocations(id);


--
-- Name: collection_stops collection_stops_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_stops
    ADD CONSTRAINT collection_stops_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.collection_plans(id) ON DELETE CASCADE;


--
-- Name: delivery_confirmations delivery_confirmations_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_confirmations
    ADD CONSTRAINT delivery_confirmations_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id);


--
-- Name: delivery_confirmations delivery_confirmations_pickup_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_confirmations
    ADD CONSTRAINT delivery_confirmations_pickup_assignment_id_fkey FOREIGN KEY (pickup_assignment_id) REFERENCES public.pickup_assignments(id);


--
-- Name: disputes disputes_allocation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_allocation_id_fkey FOREIGN KEY (allocation_id) REFERENCES public.donation_allocations(id);


--
-- Name: disputes disputes_handover_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_handover_record_id_fkey FOREIGN KEY (handover_record_id) REFERENCES public.handover_records(id);


--
-- Name: disputes disputes_pickup_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_pickup_assignment_id_fkey FOREIGN KEY (pickup_assignment_id) REFERENCES public.pickup_assignments(id);


--
-- Name: disputes disputes_raised_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES public.users(id);


--
-- Name: disputes disputes_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: donation_allocations donation_allocations_assistance_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_allocations
    ADD CONSTRAINT donation_allocations_assistance_offer_id_fkey FOREIGN KEY (assistance_offer_id) REFERENCES public.assistance_offers(id);


--
-- Name: donation_allocations donation_allocations_donation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_allocations
    ADD CONSTRAINT donation_allocations_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donations(id);


--
-- Name: donation_allocations donation_allocations_donation_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_allocations
    ADD CONSTRAINT donation_allocations_donation_request_id_fkey FOREIGN KEY (donation_request_id) REFERENCES public.donation_requests(id);


--
-- Name: donation_allocations donation_allocations_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_allocations
    ADD CONSTRAINT donation_allocations_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id);


--
-- Name: donation_requests donation_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_requests
    ADD CONSTRAINT donation_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: donation_requests donation_requests_donation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_requests
    ADD CONSTRAINT donation_requests_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donations(id);


--
-- Name: donation_requests donation_requests_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_requests
    ADD CONSTRAINT donation_requests_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id);


--
-- Name: donation_requests donation_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_requests
    ADD CONSTRAINT donation_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: donation_status_history donation_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_status_history
    ADD CONSTRAINT donation_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: donation_status_history donation_status_history_donation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_status_history
    ADD CONSTRAINT donation_status_history_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donations(id);


--
-- Name: donations donations_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.food_categories(id);


--
-- Name: donations donations_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donors(id);


--
-- Name: donor_availability donor_availability_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_availability
    ADD CONSTRAINT donor_availability_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donors(id) ON DELETE CASCADE;


--
-- Name: donor_food_categories donor_food_categories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_food_categories
    ADD CONSTRAINT donor_food_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.food_categories(id);


--
-- Name: donor_food_categories donor_food_categories_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_food_categories
    ADD CONSTRAINT donor_food_categories_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donors(id) ON DELETE CASCADE;


--
-- Name: donors donors_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donors
    ADD CONSTRAINT donors_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);


--
-- Name: donors donors_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donors
    ADD CONSTRAINT donors_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- Name: audit_logs fk_audit_logs__actor_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT fk_audit_logs__actor_user FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: idempotency_records fk_idempotency_records__user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT fk_idempotency_records__user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: platform_settings fk_platform_settings__updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT fk_platform_settings__updated_by FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: food_assistance_requests food_assistance_requests_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_assistance_requests
    ADD CONSTRAINT food_assistance_requests_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.food_categories(id);


--
-- Name: food_assistance_requests food_assistance_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_assistance_requests
    ADD CONSTRAINT food_assistance_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: food_assistance_requests food_assistance_requests_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_assistance_requests
    ADD CONSTRAINT food_assistance_requests_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id);


--
-- Name: handover_records handover_records_allocation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_records
    ADD CONSTRAINT handover_records_allocation_id_fkey FOREIGN KEY (allocation_id) REFERENCES public.donation_allocations(id);


--
-- Name: handover_records handover_records_donor_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_records
    ADD CONSTRAINT handover_records_donor_confirmed_by_fkey FOREIGN KEY (donor_confirmed_by) REFERENCES public.users(id);


--
-- Name: handover_records handover_records_ngo_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_records
    ADD CONSTRAINT handover_records_ngo_confirmed_by_fkey FOREIGN KEY (ngo_confirmed_by) REFERENCES public.users(id);


--
-- Name: handover_records handover_records_pickup_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handover_records
    ADD CONSTRAINT handover_records_pickup_assignment_id_fkey FOREIGN KEY (pickup_assignment_id) REFERENCES public.pickup_assignments(id);


--
-- Name: impact_certificates impact_certificates_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impact_certificates
    ADD CONSTRAINT impact_certificates_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donors(id);


--
-- Name: invoices invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: invoices invoices_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id);


--
-- Name: location_updates location_updates_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_updates
    ADD CONSTRAINT location_updates_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.tracking_sessions(id) ON DELETE CASCADE;


--
-- Name: match_recommendations match_recommendations_assistance_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_recommendations
    ADD CONSTRAINT match_recommendations_assistance_request_id_fkey FOREIGN KEY (assistance_request_id) REFERENCES public.food_assistance_requests(id);


--
-- Name: match_recommendations match_recommendations_candidate_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_recommendations
    ADD CONSTRAINT match_recommendations_candidate_donor_id_fkey FOREIGN KEY (candidate_donor_id) REFERENCES public.donors(id);


--
-- Name: match_recommendations match_recommendations_candidate_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_recommendations
    ADD CONSTRAINT match_recommendations_candidate_ngo_id_fkey FOREIGN KEY (candidate_ngo_id) REFERENCES public.ngos(id);


--
-- Name: match_recommendations match_recommendations_donation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_recommendations
    ADD CONSTRAINT match_recommendations_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donations(id);


--
-- Name: match_recommendations match_recommendations_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_recommendations
    ADD CONSTRAINT match_recommendations_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id);


--
-- Name: ngo_billing ngo_billing_allocation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_billing
    ADD CONSTRAINT ngo_billing_allocation_id_fkey FOREIGN KEY (allocation_id) REFERENCES public.donation_allocations(id);


--
-- Name: ngo_billing ngo_billing_fee_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_billing
    ADD CONSTRAINT ngo_billing_fee_rule_id_fkey FOREIGN KEY (fee_rule_id) REFERENCES public.service_fee_rules(id);


--
-- Name: ngo_billing ngo_billing_handover_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_billing
    ADD CONSTRAINT ngo_billing_handover_record_id_fkey FOREIGN KEY (handover_record_id) REFERENCES public.handover_records(id);


--
-- Name: ngo_billing ngo_billing_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_billing
    ADD CONSTRAINT ngo_billing_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: ngo_billing ngo_billing_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_billing
    ADD CONSTRAINT ngo_billing_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id);


--
-- Name: ngo_food_preferences ngo_food_preferences_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_food_preferences
    ADD CONSTRAINT ngo_food_preferences_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.food_categories(id);


--
-- Name: ngo_food_preferences ngo_food_preferences_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_food_preferences
    ADD CONSTRAINT ngo_food_preferences_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id) ON DELETE CASCADE;


--
-- Name: ngo_representatives ngo_representatives_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_representatives
    ADD CONSTRAINT ngo_representatives_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id);


--
-- Name: ngo_representatives ngo_representatives_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_representatives
    ADD CONSTRAINT ngo_representatives_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id);


--
-- Name: ngo_representatives ngo_representatives_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngo_representatives
    ADD CONSTRAINT ngo_representatives_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ngos ngos_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngos
    ADD CONSTRAINT ngos_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);


--
-- Name: ngos ngos_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ngos
    ADD CONSTRAINT ngos_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- Name: notification_logs notification_logs_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: payments payments_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id);


--
-- Name: payments payments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: pickup_assignments pickup_assignments_allocation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_assignments
    ADD CONSTRAINT pickup_assignments_allocation_id_fkey FOREIGN KEY (allocation_id) REFERENCES public.donation_allocations(id);


--
-- Name: pickup_assignments pickup_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_assignments
    ADD CONSTRAINT pickup_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: pickup_assignments pickup_assignments_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_assignments
    ADD CONSTRAINT pickup_assignments_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id);


--
-- Name: pickup_assignments pickup_assignments_representative_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_assignments
    ADD CONSTRAINT pickup_assignments_representative_id_fkey FOREIGN KEY (representative_id) REFERENCES public.ngo_representatives(id);


--
-- Name: pickup_tokens pickup_tokens_consumed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_tokens
    ADD CONSTRAINT pickup_tokens_consumed_by_fkey FOREIGN KEY (consumed_by) REFERENCES public.users(id);


--
-- Name: pickup_tokens pickup_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_tokens
    ADD CONSTRAINT pickup_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pickup_tokens pickup_tokens_pickup_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_tokens
    ADD CONSTRAINT pickup_tokens_pickup_assignment_id_fkey FOREIGN KEY (pickup_assignment_id) REFERENCES public.pickup_assignments(id);


--
-- Name: pickup_verifications pickup_verifications_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_verifications
    ADD CONSTRAINT pickup_verifications_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: pickup_verifications pickup_verifications_pickup_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_verifications
    ADD CONSTRAINT pickup_verifications_pickup_assignment_id_fkey FOREIGN KEY (pickup_assignment_id) REFERENCES public.pickup_assignments(id);


--
-- Name: restaurant_daily_metrics restaurant_daily_metrics_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_daily_metrics
    ADD CONSTRAINT restaurant_daily_metrics_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donors(id);


--
-- Name: reward_balances reward_balances_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_balances
    ADD CONSTRAINT reward_balances_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donors(id);


--
-- Name: reward_rules reward_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_rules
    ADD CONSTRAINT reward_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: reward_transactions reward_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_transactions
    ADD CONSTRAINT reward_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: reward_transactions reward_transactions_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_transactions
    ADD CONSTRAINT reward_transactions_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donors(id);


--
-- Name: service_fee_rules service_fee_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_fee_rules
    ADD CONSTRAINT service_fee_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: surplus_predictions surplus_predictions_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.surplus_predictions
    ADD CONSTRAINT surplus_predictions_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donors(id);


--
-- Name: surplus_predictions surplus_predictions_model_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.surplus_predictions
    ADD CONSTRAINT surplus_predictions_model_version_id_fkey FOREIGN KEY (model_version_id) REFERENCES public.model_versions(id);


--
-- Name: tracking_events tracking_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_events
    ADD CONSTRAINT tracking_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: tracking_events tracking_events_pickup_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_events
    ADD CONSTRAINT tracking_events_pickup_assignment_id_fkey FOREIGN KEY (pickup_assignment_id) REFERENCES public.pickup_assignments(id);


--
-- Name: tracking_events tracking_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_events
    ADD CONSTRAINT tracking_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.tracking_sessions(id);


--
-- Name: tracking_sessions tracking_sessions_pickup_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_sessions
    ADD CONSTRAINT tracking_sessions_pickup_assignment_id_fkey FOREIGN KEY (pickup_assignment_id) REFERENCES public.pickup_assignments(id);


--
-- Name: tracking_sessions tracking_sessions_tracked_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_sessions
    ADD CONSTRAINT tracking_sessions_tracked_user_id_fkey FOREIGN KEY (tracked_user_id) REFERENCES public.users(id);


--
-- Name: user_sessions user_sessions_replaced_by_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_replaced_by_session_id_fkey FOREIGN KEY (replaced_by_session_id) REFERENCES public.user_sessions(id);


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: verification_documents verification_documents_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_documents
    ADD CONSTRAINT verification_documents_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donors(id);


--
-- Name: verification_documents verification_documents_ngo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_documents
    ADD CONSTRAINT verification_documents_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES public.ngos(id);


--
-- Name: verification_documents verification_documents_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_documents
    ADD CONSTRAINT verification_documents_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: verification_documents verification_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_documents
    ADD CONSTRAINT verification_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--


