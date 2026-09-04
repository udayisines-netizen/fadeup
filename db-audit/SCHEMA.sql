--
-- PostgreSQL database dump
--

\restrict WeCePo1aejI6tGdoqEHlqmVodcZqPke1NtCdZOnSq1p4IyPtPi4kcqbXO3MagEW

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: analytics_actor_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.analytics_actor_type AS ENUM (
    'anonymous',
    'customer',
    'professional',
    'staff',
    'platform_admin',
    'worker',
    'system'
);


--
-- Name: analytics_emission; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.analytics_emission AS ENUM (
    'server',
    'client'
);


--
-- Name: analytics_event_origin; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.analytics_event_origin AS ENUM (
    'public_web',
    'customer_web',
    'customer_mobile',
    'pro_web',
    'backend',
    'worker',
    'system'
);


--
-- Name: analytics_event_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.analytics_event_status AS ENUM (
    'wired',
    'deferred'
);


--
-- Name: appointment_resolution; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_resolution AS ENUM (
    'declined',
    'expired',
    'cancelled_by_customer',
    'cancelled_by_business',
    'rescheduled'
);


--
-- Name: TYPE appointment_resolution; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.appointment_resolution IS 'WHY an appointment reached a terminal state. Paired with status=cancelled so the existing GiST exclusion predicate frees the slot without being rebuilt — see this migration''s header.';


--
-- Name: appointment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_status AS ENUM (
    'pending',
    'confirmed',
    'completed',
    'cancelled',
    'no_show'
);


--
-- Name: TYPE appointment_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.appointment_status IS 'pending: reserved for a future online booking-request flow (LOT 9), not used by staff-created appointments in LOT 8, which default to confirmed.';


--
-- Name: billing_interval; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.billing_interval AS ENUM (
    'weekly',
    'monthly',
    'yearly'
);


--
-- Name: booking_availability_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_availability_status AS ENUM (
    'ACTIVE',
    'LISTED_ONLY',
    'UNKNOWN'
);


--
-- Name: TYPE booking_availability_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.booking_availability_status IS 'Whether a business can actually be booked through the detected provider. ACTIVE: the provider''s own public page offers at least one bookable service. LISTED_ONLY: the page exists and reliably indicates nothing is bookable online. UNKNOWN: not observed, or observed and not classifiable — never a soft "probably not".';


--
-- Name: booking_provider_detection_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_provider_detection_method AS ENUM (
    'booking_url',
    'outbound_link',
    'embedded_widget',
    'iframe_domain',
    'script_domain',
    'booking_button_target',
    'structured_data',
    'domain_pattern',
    'provider_directory',
    'manual_override',
    'provider_public_page'
);


--
-- Name: TYPE booking_provider_detection_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.booking_provider_detection_method IS 'How a booking-provider observation was obtained. Every value here corresponds to a compliant, publicly-accessible signal — no value describes bypassing a login, CAPTCHA or anti-bot control (see docs/worker-v2/competitor-intelligence.md).';


--
-- Name: business_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.business_type AS ENUM (
    'solo_professional',
    'barbershop',
    'hair_salon',
    'mixed_salon',
    'multi_location'
);


--
-- Name: TYPE business_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.business_type IS 'What kind of business this organization runs. Distinct from public.professional_type, which describes an APPLICANT at application time and cannot be changed afterwards; this is the live, editable business configuration that drives onboarding and product behaviour.';


--
-- Name: commercial_family; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.commercial_family AS ENUM (
    'free',
    'independent',
    'salon',
    'multi_salon'
);


--
-- Name: TYPE commercial_family; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.commercial_family IS 'FadeUp commercial family: free | independent | salon | multi_salon. Distinct from organizations.business_type (what kind of business this is) and from the frontend BusinessMode (which marketing narrative is being told). Only this axis may be consulted by an entitlement decision.';


--
-- Name: commercial_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.commercial_status AS ENUM (
    'active',
    'past_due',
    'canceled'
);


--
-- Name: TYPE commercial_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.commercial_status IS 'Whether the assigned plan is currently in force. free + active is the normal, healthy state of a network-tier organization — free is NEVER an error, an expiry or a failed trial.';


--
-- Name: customer_appointment_preference; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.customer_appointment_preference AS ENUM (
    'appointment',
    'walk_in',
    'either'
);


--
-- Name: customer_haircut_frequency; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.customer_haircut_frequency AS ENUM (
    'weekly',
    'every_2_weeks',
    'every_3_weeks',
    'monthly',
    'less_often',
    'depends'
);


--
-- Name: customer_membership_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.customer_membership_status AS ENUM (
    'active',
    'paused',
    'cancelled',
    'expired'
);


--
-- Name: TYPE customer_membership_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.customer_membership_status IS 'active/paused/cancelled/expired are all staff-driven in this lot — no automated billing-driven transition exists yet (LOT 16).';


--
-- Name: customer_style_preference; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.customer_style_preference AS ENUM (
    'fade',
    'taper',
    'crop',
    'buzz',
    'afro',
    'curly',
    'long',
    'beard_focus',
    'other'
);


--
-- Name: email_delivery_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.email_delivery_status AS ENUM (
    'queued',
    'sent',
    'failed'
);


--
-- Name: entitlement_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.entitlement_source AS ENUM (
    'early_access',
    'platform_grant',
    'billing'
);


--
-- Name: TYPE entitlement_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.entitlement_source IS 'Why this plan is in force. billing = a provider said so (R2 never writes it; no provider exists). platform_grant = FadeUp staff decided. early_access = pre-billing, everyone has the product. Nothing here claims a payment occurred.';


--
-- Name: follow_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.follow_source AS ENUM (
    'manual',
    'auto'
);


--
-- Name: follow_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.follow_state AS ENUM (
    'following',
    'unfollowed'
);


--
-- Name: location_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.location_kind AS ENUM (
    'physical_address',
    'service_area'
);


--
-- Name: TYPE location_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.location_kind IS 'What a locations row IS. physical_address: a place a customer travels to. service_area: a zone a professional travels within, with no address and no physical position. The two are exclusive and the CHECK constraints on locations make the other kind''s columns unrepresentable.';


--
-- Name: membership_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.membership_role AS ENUM (
    'owner',
    'manager',
    'receptionist',
    'barber'
);


--
-- Name: TYPE membership_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.membership_role IS 'Org-scoped role for a membership row. Fixed set per CLAUDE.md: owner, manager, receptionist, barber.';


--
-- Name: ml_model_target; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ml_model_target AS ENUM (
    'reply',
    'positive_reply',
    'claim',
    'activated',
    'paid',
    'expected_value'
);


--
-- Name: TYPE ml_model_target; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.ml_model_target IS 'What a model predicts. ''delivered''/''read'' are deliberately absent — spec §30 forbids optimizing for those vanity metrics.';


--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_type AS ENUM (
    'booking_request_created',
    'booking_confirmed',
    'booking_declined',
    'booking_expired',
    'booking_cancelled',
    'booking_rescheduled',
    'team_invitation'
);


--
-- Name: outreach_campaign_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.outreach_campaign_status AS ENUM (
    'draft',
    'preparing',
    'ready',
    'running',
    'paused',
    'completed',
    'cancelled',
    'failed'
);


--
-- Name: outreach_channel_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.outreach_channel_kind AS ENUM (
    'whatsapp',
    'email',
    'sms'
);


--
-- Name: TYPE outreach_channel_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.outreach_channel_kind IS 'Channels the template engine can target. Only whatsapp has a provider implementation in this migration; email/sms exist so a template''s channel is explicit rather than assumed.';


--
-- Name: outreach_event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.outreach_event_type AS ENUM (
    'queued',
    'sent',
    'delivered',
    'read',
    'failed',
    'replied',
    'positive_reply',
    'negative_reply',
    'opted_out',
    'claim_started',
    'claim_completed',
    'registered',
    'activated',
    'first_booking',
    'paid'
);


--
-- Name: outreach_opt_in_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.outreach_opt_in_status AS ENUM (
    'none',
    'pending',
    'confirmed',
    'withdrawn'
);


--
-- Name: TYPE outreach_opt_in_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.outreach_opt_in_status IS '''none'' is the default for a discovered prospect and is NOT consent. Whether ''none'' is sufficient for a given jurisdiction/channel is an operator policy decision recorded on public.outreach_channel_policies — the database never assumes it.';


--
-- Name: outreach_recipient_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.outreach_recipient_state AS ENUM (
    'blocked',
    'pending',
    'queued',
    'sent',
    'delivered',
    'read',
    'replied',
    'positive_reply',
    'negative_reply',
    'failed',
    'opted_out',
    'claimed',
    'activated',
    'paid'
);


--
-- Name: TYPE outreach_recipient_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.outreach_recipient_state IS 'Full funnel through to paid (spec §29/§34). ''blocked'' is a terminal pre-send state for a recipient that failed the eligibility gate — deliberately kept as a row so /platform can show WHY a selected prospect was not contacted.';


--
-- Name: outreach_template_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.outreach_template_status AS ENUM (
    'draft',
    'pending_approval',
    'approved',
    'paused',
    'retired'
);


--
-- Name: TYPE outreach_template_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.outreach_template_status IS 'Only ''approved'' templates may be rendered or sent. ''paused'' is the operator kill switch required by spec §72 — it stops future sends without destroying history.';


--
-- Name: platform_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.platform_role AS ENUM (
    'platform_owner',
    'platform_admin',
    'platform_support'
);


--
-- Name: TYPE platform_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.platform_role IS 'FadeUp platform staff role — NOT a barbershop role (see public.membership_role for that unrelated concept).';


--
-- Name: professional_application_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.professional_application_status AS ENUM (
    'pending_review',
    'approved',
    'rejected'
);


--
-- Name: professional_claim_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.professional_claim_state AS ENUM (
    'unclaimed',
    'claimed'
);


--
-- Name: professional_claim_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.professional_claim_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'withdrawn'
);


--
-- Name: professional_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.professional_source AS ENUM (
    'fadeup',
    'acquisition'
);


--
-- Name: professional_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.professional_type AS ENUM (
    'barbershop',
    'independent_barber',
    'private_studio',
    'mobile_barber'
);


--
-- Name: prospect_duplicate_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_duplicate_status AS ENUM (
    'pending',
    'confirmed_duplicate',
    'confirmed_distinct'
);


--
-- Name: prospect_entity_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_entity_kind AS ENUM (
    'independent',
    'group_parent',
    'group_location'
);


--
-- Name: TYPE prospect_entity_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.prospect_entity_kind IS 'Future-proofing for chains/multi-location groups: group_parent is the chain entity, group_location rows point to it via prospects.parent_group_id. Discovery currently only ever produces independent rows — grouping is not auto-detected yet.';


--
-- Name: prospect_fit_class; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_fit_class AS ENUM (
    'HOT',
    'WARM',
    'COLD'
);


--
-- Name: prospect_identity_match_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_identity_match_state AS ENUM (
    'MATCHED',
    'POSSIBLE_MATCH',
    'REVIEW_REQUIRED',
    'NOT_MATCHED'
);


--
-- Name: prospect_job_source_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_job_source_status AS ENUM (
    'pending',
    'running',
    'completed',
    'failed',
    'skipped'
);


--
-- Name: prospect_job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_job_status AS ENUM (
    'queued',
    'running',
    'retry',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: prospect_locale_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_locale_source AS ENUM (
    'verified_business_country',
    'business_address',
    'website_language',
    'provider_locale',
    'phone_country',
    'dominant_website_language',
    'manual_override',
    'default_fallback'
);


--
-- Name: TYPE prospect_locale_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.prospect_locale_source IS 'Evidence that determined a prospect''s locale, in the spec''s priority order. Business NAME is deliberately absent — a name is never sufficient evidence of language.';


--
-- Name: prospect_outreach_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_outreach_channel AS ENUM (
    'email',
    'phone',
    'sms',
    'instagram_dm',
    'in_person',
    'other'
);


--
-- Name: prospect_outreach_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_outreach_direction AS ENUM (
    'outbound',
    'inbound'
);


--
-- Name: prospect_pipeline_stage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_pipeline_stage AS ENUM (
    'discovered',
    'enriched',
    'qualified',
    'selected',
    'contacted',
    'replied',
    'demo',
    'trial',
    'customer',
    'lost'
);


--
-- Name: TYPE prospect_pipeline_stage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.prospect_pipeline_stage IS 'Sales pipeline stage. Worker V2 only ever writes discovered/enriched/qualified — contacted onward is a manual/CRM action, per the spec''s "do not begin uncontrolled outreach automatically".';


--
-- Name: prospect_score_bucket; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_score_bucket AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'HOT'
);


--
-- Name: TYPE prospect_score_bucket; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.prospect_score_bucket IS '0-39 LOW, 40-69 MEDIUM, 70-84 HIGH, 85-100 HOT — see private.prospect_score_bucket_for().';


--
-- Name: prospect_search_partition_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_search_partition_status AS ENUM (
    'planned',
    'running',
    'completed',
    'saturated',
    'subdivided',
    'skipped',
    'failed'
);


--
-- Name: prospect_social_platform; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_social_platform AS ENUM (
    'instagram',
    'facebook',
    'tiktok',
    'twitter',
    'youtube',
    'linkedin',
    'other'
);


--
-- Name: prospect_suppression_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_suppression_scope AS ENUM (
    'prospect',
    'phone',
    'email',
    'domain',
    'instagram_handle'
);


--
-- Name: TYPE prospect_suppression_scope; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.prospect_suppression_scope IS 'A suppression may target a specific prospect row, or a raw normalized identifier (phone/email/domain/instagram_handle) so re-discovery under a different source cannot resurrect a previously-suppressed business under a new prospect id.';


--
-- Name: prospect_tribool; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_tribool AS ENUM (
    'TRUE',
    'FALSE',
    'UNKNOWN',
    'NOT_APPLICABLE'
);


--
-- Name: TYPE prospect_tribool; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.prospect_tribool IS 'TRUE/FALSE/UNKNOWN/NOT_APPLICABLE. UNKNOWN means "not observed" and is NEVER equivalent to FALSE — see private.tribool_is_true()/tribool_is_false() and the feature-engineering section of docs/worker-v2/acquisition-intelligence.md.';


--
-- Name: prospect_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospect_type AS ENUM (
    'barbershop',
    'independent_barber'
);


--
-- Name: TYPE prospect_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.prospect_type IS 'What kind of business a prospect is. Fixed set per the Prospect Worker V2 spec.';


--
-- Name: queue_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.queue_status AS ENUM (
    'waiting',
    'called',
    'in_service',
    'completed',
    'cancelled',
    'no_show'
);


--
-- Name: service_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_mode AS ENUM (
    'hybrid',
    'reservation_only',
    'queue_only',
    'unavailable'
);


--
-- Name: TYPE service_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.service_mode IS 'Which service channels an establishment or barber placement accepts for NEW admissions. hybrid = reservations + queue; reservation_only = reservations only; queue_only = walk-ins only; unavailable = neither. Governs NEW admissions ONLY — never existing appointments or queue entries. Not an entitlement, not availability, not opening hours.';


--
-- Name: service_mode_change_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_mode_change_kind AS ENUM (
    'location_default',
    'barber_override',
    'temporary_override_set',
    'temporary_override_cleared',
    'queue_open'
);


--
-- Name: service_mode_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_mode_scope AS ENUM (
    'location',
    'barber'
);


--
-- Name: TYPE service_mode_scope; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.service_mode_scope IS 'What a service-mode override applies to: an entire establishment, or one barber placement within it. Fixed at two values for V1 — organization-wide overrides are deliberately absent, because a multi-salon organization must never be forced to operate every salon identically.';


--
-- Name: waitlist_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.waitlist_status AS ENUM (
    'waiting',
    'notified',
    'booked',
    'cancelled',
    'expired'
);


--
-- Name: TYPE waitlist_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.waitlist_status IS 'waiting: default. notified/booked/cancelled/expired are all staff-driven transitions in this pass — no automated notification exists yet (LOT 19).';


--
-- Name: whatsapp_message_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.whatsapp_message_direction AS ENUM (
    'outbound',
    'inbound'
);


--
-- Name: whatsapp_message_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.whatsapp_message_status AS ENUM (
    'pending',
    'sent',
    'delivered',
    'read',
    'failed',
    'received'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: email_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    to_email text NOT NULL,
    template text NOT NULL,
    locale text DEFAULT 'en'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.email_delivery_status DEFAULT 'queued'::public.email_delivery_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    locked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_outbox_attempts_sane CHECK ((attempts >= 0)),
    CONSTRAINT email_outbox_to_email_not_blank CHECK ((btrim(to_email) <> ''::text))
);

ALTER TABLE ONLY public.email_outbox FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE email_outbox; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.email_outbox IS 'Durable queue for transactional email. Enqueued inside the same transaction as the state change it describes, delivered separately, so a mail outage can never roll back an approval — and a failed send stays visible and retryable instead of vanishing. Contains no secrets and no auth tokens.';


--
-- Name: prospect_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_type text NOT NULL,
    status public.prospect_job_status DEFAULT 'queued'::public.prospect_job_status NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    scheduled_at timestamp with time zone DEFAULT now() NOT NULL,
    worker_id text,
    lease_until timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    failed_at timestamp with time zone,
    last_error text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_id uuid,
    partition_id uuid,
    CONSTRAINT prospect_jobs_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT prospect_jobs_job_type_check CHECK ((job_type = ANY (ARRAY['discovery'::text, 'enrichment'::text, 'dedup_scan'::text, 'scoring'::text, 'website_crawl'::text, 'instagram_enrich'::text, 'search_plan'::text, 'identity_resolution'::text, 'competitor_detection'::text, 'website_enrichment'::text, 'feature_computation'::text, 'fit_scoring'::text, 'segmentation'::text, 'locale_resolution'::text, 'data_quality'::text, 'ml_prediction'::text, 'outreach_preparation'::text, 'whatsapp_send'::text, 'outcome_processing'::text, 'publication_evaluation'::text, 'planity_enrichment'::text]))),
    CONSTRAINT prospect_jobs_max_attempts_check CHECK ((max_attempts > 0))
);

ALTER TABLE ONLY public.prospect_jobs FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_jobs IS 'Durable job queue — PostgreSQL is the queue, no Redis. created_by null means system-scheduled (e.g. a recurring dedup_scan), not a platform-staff-initiated search.';


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    barber_id uuid NOT NULL,
    chair_id uuid,
    service_id uuid NOT NULL,
    customer_name text NOT NULL,
    customer_phone text,
    customer_email text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    buffer_before_minutes integer DEFAULT 0 NOT NULL,
    buffer_after_minutes integer DEFAULT 0 NOT NULL,
    status public.appointment_status DEFAULT 'confirmed'::public.appointment_status NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    blocked_range tstzrange DEFAULT tstzrange(now(), now(), '[)'::text) NOT NULL,
    customer_id uuid,
    expires_at timestamp with time zone,
    resolution public.appointment_resolution,
    resolution_note text,
    decided_at timestamp with time zone,
    decided_by uuid,
    rescheduled_to uuid,
    completed_at timestamp with time zone,
    booked_by_user_id uuid,
    CONSTRAINT appointments_buffers_nonnegative CHECK (((buffer_before_minutes >= 0) AND (buffer_after_minutes >= 0))),
    CONSTRAINT appointments_customer_name_not_blank CHECK ((btrim(customer_name) <> ''::text)),
    CONSTRAINT appointments_resolution_note_length CHECK (((resolution_note IS NULL) OR (char_length(resolution_note) <= 500))),
    CONSTRAINT appointments_resolution_terminal_only CHECK (((resolution IS NULL) OR (status = ANY (ARRAY['cancelled'::public.appointment_status, 'no_show'::public.appointment_status])))),
    CONSTRAINT appointments_time_order CHECK ((ends_at > starts_at))
);

ALTER TABLE ONLY public.appointments FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE appointments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.appointments IS 'Core booking record. No customers table yet (LOT 12) — customer_name/phone/email are a deliberate placeholder. blocked_range (generated) is the barber''s fully-occupied window including buffers, enforced conflict-free via a GiST exclusion constraint (race-free, unlike a check-then-insert trigger).';


--
-- Name: COLUMN appointments.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.customer_id IS 'Auto-linked by link_customer_from_contact_info (find-or-create by phone/email) at insert time. Nullable: a booking with neither phone nor email stays unlinked.';


--
-- Name: COLUMN appointments.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.expires_at IS 'When an unanswered booking request stops being answerable. Set by the appointments_set_request_expiry trigger from organizations.booking_request_ttl_minutes — the single authoritative policy value. NULL for anything not awaiting a decision.';


--
-- Name: COLUMN appointments.resolution; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.resolution IS 'Why this appointment ended. status says the slot is free; resolution says whether the shop declined, nobody answered, or someone cancelled.';


--
-- Name: COLUMN appointments.rescheduled_to; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.rescheduled_to IS 'On a superseded row: the appointment that replaced it.';


--
-- Name: COLUMN appointments.completed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.completed_at IS 'When the service was actually delivered. Stamped by enforce_appointment_transition() on entry to status=completed and never writable by a client. NULL on a completed row means the completion time is genuinely unknown — historically, a row completed by a raw PATCH before R1A. Unknown is recorded as unknown; it is never inferred from starts_at.';


--
-- Name: COLUMN appointments.booked_by_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.booked_by_user_id IS 'The authenticated account that ITSELF created this booking, stamped from auth.uid() inside book_public_appointment. NULL for anonymous bookings and for rows created by staff. This is the ONLY trustworthy account attribution for an appointment: customer_id is resolved from caller-typed contact details and must never be used to attribute social or verified-client facts.';


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.membership_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.memberships FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE memberships; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.memberships IS 'Core tenant-authorization table. One row per (user, organization) with an org-scoped role.';


--
-- Name: accept_invitation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_invitation(p_token text) RETURNS public.memberships
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_invitation public.invitations;
  v_caller_email text;
  v_membership public.memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to accept an invitation';
  end if;

  select * into v_invitation
  from public.invitations
  where token = p_token
  for update;

  if not found then
    raise exception 'invitation not found';
  end if;

  if v_invitation.revoked_at is not null then
    raise exception 'this invitation has been revoked';
  end if;

  if v_invitation.accepted_at is not null then
    raise exception 'this invitation has already been accepted';
  end if;

  if v_invitation.expires_at < now() then
    raise exception 'this invitation has expired';
  end if;

  select email into v_caller_email from auth.users where id = (select auth.uid());

  if v_caller_email is null or lower(v_caller_email) <> v_invitation.email then
    raise exception 'this invitation was issued to a different email address';
  end if;

  insert into public.memberships (organization_id, user_id, role)
  values (v_invitation.organization_id, (select auth.uid()), v_invitation.role)
  on conflict (organization_id, user_id)
  do update set role = excluded.role
  returning * into v_membership;

  -- The AFTER INSERT trigger on memberships (handle_new_membership) has
  -- already created a staff_profiles row for a fresh membership by this
  -- point — apply the invitation's location scope to it, if one was set.
  -- ON CONFLICT's UPDATE path (re-accepting/upgrading an existing member)
  -- still has a pre-existing staff_profiles row to update the same way.
  if v_invitation.location_id is not null then
    update public.staff_profiles
    set location_id = v_invitation.location_id
    where organization_id = v_invitation.organization_id and user_id = (select auth.uid());
  end if;

  update public.invitations
  set accepted_at = now()
  where id = v_invitation.id;

  return v_membership;
end;
$$;


--
-- Name: FUNCTION accept_invitation(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.accept_invitation(p_token text) IS 'Redeems an invitation token for the calling authenticated user: creates/upgrades their membership, applies the invitation''s location scope (if any) to their staff_profiles row, and marks the invitation accepted. Requires the caller''s auth email to match the invitation email.';


--
-- Name: platform_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_members (
    user_id uuid NOT NULL,
    role public.platform_role NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.platform_members FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE platform_members; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.platform_members IS 'FadeUp platform staff roster — the ONLY authority for platform access. Grants only via claim_platform_owner_bootstrap()/accept_platform_invitation() or direct operator SQL; anon and authenticated hold no INSERT/UPDATE/DELETE privilege. Authentication provider (password, Google, Apple) is irrelevant here: signing in proves who you are, this table decides whether you are platform staff.';


--
-- Name: accept_platform_invitation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_platform_invitation(p_token text) RETURNS public.platform_members
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_token_hash text;
  v_invitation public.platform_invitations;
  v_caller_email text;
  v_member public.platform_members;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to accept a platform invitation';
  end if;

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_invitation
  from public.platform_invitations
  where token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'invalid platform invitation';
  end if;

  if v_invitation.revoked_at is not null then
    raise exception 'this invitation has been revoked';
  end if;

  if v_invitation.accepted_at is not null then
    raise exception 'this invitation has already been accepted';
  end if;

  if v_invitation.expires_at < now() then
    raise exception 'this invitation has expired';
  end if;

  if v_invitation.invited_email is not null then
    select email into v_caller_email from auth.users where id = (select auth.uid());
    if v_caller_email is null or lower(v_caller_email) <> v_invitation.invited_email then
      raise exception 'this invitation was issued to a different email address';
    end if;
  end if;

  if exists (select 1 from public.platform_members where user_id = (select auth.uid())) then
    raise exception 'you are already a platform member';
  end if;

  insert into public.platform_members (user_id, role)
  values ((select auth.uid()), v_invitation.role)
  returning * into v_member;

  update public.platform_invitations
  set accepted_at = now(), accepted_by = (select auth.uid())
  where id = v_invitation.id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_invitation_accepted', 'platform_invitations', v_invitation.id, jsonb_build_object('role', v_invitation.role));

  return v_member;
end;
$$;


--
-- Name: FUNCTION accept_platform_invitation(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.accept_platform_invitation(p_token text) IS 'Redeems a platform_admin/platform_support invitation for the calling authenticated user. Requires the caller''s auth email to match invited_email when one was set.';


--
-- Name: analytics_appointment_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_appointment_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid;
  v_actor_type public.analytics_actor_type;
  v_professional_id uuid;
  v_event text;
  v_dedupe text;
  v_occurred timestamptz;
begin
  if tg_op = 'INSERT' then
    v_event   := 'appointment_created';
    v_dedupe  := 'appointment:' || new.id::text || ':created';
    v_occurred := new.created_at;
  else
    -- Status is the only thing this trigger has an opinion about. Rescheduling
    -- a time, editing a note or linking a customer are not analytics events.
    if new.status is not distinct from old.status then
      return null;
    end if;

    case new.status
      when 'confirmed' then
        v_event  := 'appointment_confirmed';
        -- NOT once-only: a customer reschedule returns a confirmed appointment
        -- to pending and the shop confirms it again. Each confirmation is real.
        v_dedupe := 'appointment:' || new.id::text || ':confirmed:'
                    || (extract(epoch from now()) * 1000000)::bigint::text;
        v_occurred := coalesce(new.decided_at, now());
      when 'cancelled' then
        v_event  := 'appointment_cancelled';
        v_dedupe := 'appointment:' || new.id::text || ':cancelled';
        v_occurred := coalesce(new.decided_at, now());
      when 'no_show' then
        v_event  := 'appointment_no_show';
        v_dedupe := 'appointment:' || new.id::text || ':no_show';
        v_occurred := coalesce(new.decided_at, now());
      when 'completed' then
        v_event  := 'appointment_completed';
        v_dedupe := 'appointment:' || new.id::text || ':completed';
        -- completed_at is stamped server-side by R1A's transition guard and is
        -- the only trustworthy answer to "when was this served".
        v_occurred := coalesce(new.completed_at, now());
      else
        -- pending, including the confirmed -> pending reschedule edge. There is
        -- no event for "went back to waiting for a decision"; inventing one
        -- would double-count the eventual confirmation.
        return null;
    end case;
  end if;

  select a.actor_user_id, a.actor_type
    into v_actor, v_actor_type
  from private.analytics_trigger_actor() a;

  select b.professional_id into v_professional_id
  from public.barbers b
  where b.id = new.barber_id;

  perform private.try_emit_analytics_event(
    p_event_name      => v_event,
    p_event_origin    => 'backend',
    p_actor_user_id   => v_actor,
    p_actor_type      => v_actor_type,
    p_organization_id => new.organization_id,
    p_location_id     => new.location_id,
    p_barber_id       => new.barber_id,
    p_professional_id => v_professional_id,
    p_customer_id     => new.customer_id,
    p_appointment_id  => new.id,
    -- Deliberately NOT carried: customer name, phone, email, notes, or the
    -- appointment's scheduled time. §12 forbids future appointment details in
    -- analytics, and the ids above are enough to join under platform
    -- authorization when a report legitimately needs more.
    p_properties      => jsonb_build_object(
                           'service_id', new.service_id,
                           'has_assigned_barber', new.barber_id is not null),
    p_occurred_at     => v_occurred,
    p_dedupe_key      => v_dedupe
  );

  return null;
end;
$$;


--
-- Name: FUNCTION analytics_appointment_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_appointment_event() IS 'Emits the authoritative appointment lifecycle: created on INSERT, and confirmed/cancelled/no_show/completed from real status transitions. Records both barber_id (operational placement) and professional_id (durable identity) so that "services delivered by this person" survives them changing shop. Carries no customer name, contact detail, note or scheduled time — §12. Once-only transitions use permanent dedupe keys; confirmation uses a transition-scoped one because a reschedule legitimately produces a second confirmation.';


--
-- Name: analytics_claim_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_claim_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_event text;
  v_suffix text;
  v_occurred timestamptz;
  v_prospect_id uuid;
  v_source text;
begin
  if tg_op = 'INSERT' then
    v_event := 'claim_submitted'; v_suffix := 'submitted';
    v_occurred := new.submitted_at;
  else
    -- The column is `state`, not `status`: professional_claims deliberately
    -- names it that way because claim state is never subscription state
    -- (Constitution §5.6).
    if new.state is not distinct from old.state then
      return null;
    end if;

    case new.state
      when 'approved' then
        v_event := 'claim_approved'; v_suffix := 'approved';
        v_occurred := coalesce(new.decided_at, now());
      when 'rejected' then
        v_event := 'claim_rejected'; v_suffix := 'rejected';
        v_occurred := coalesce(new.decided_at, now());
      else
        -- withdrawn: the customer changed their mind. Not in the §4 taxonomy
        -- and not invented here.
        return null;
    end case;
  end if;

  -- Close the acquisition loop where one exists. A claim over an identity that
  -- FadeUp itself minted from a prospect is the conversion the whole worker
  -- pipeline exists to produce; a claim over an organically created identity
  -- simply has no prospect, and records none rather than a fabricated one.
  select pp.prospect_id, ps.key
    into v_prospect_id, v_source
  from public.prospect_professionals pp
  left join lateral (
    select psr.source_id
    from public.prospect_source_records psr
    where psr.prospect_id = pp.prospect_id
    order by psr.created_at
    limit 1
  ) first_record on true
  left join public.prospect_sources ps on ps.id = first_record.source_id
  where pp.professional_id = new.professional_id;

  perform private.try_emit_analytics_event(
    p_event_name         => v_event,
    p_event_origin       => 'backend',
    p_actor_user_id      => case when tg_op = 'INSERT' then new.claimant_user_id else new.decided_by end,
    p_actor_type         => case
                              when tg_op = 'INSERT' then null
                              when new.decided_by is null then 'system'::public.analytics_actor_type
                              else null
                            end,
    p_professional_id    => new.professional_id,
    p_prospect_id        => v_prospect_id,
    p_acquisition_source => v_source,
    -- The claimant is recorded as the actor on submission; the evidence text
    -- and the reviewer's decision note are NEVER carried — both are free text
    -- and the note is explicitly platform-private (R1A §2).
    p_properties         => jsonb_build_object('claim_id', new.id),
    p_occurred_at        => v_occurred,
    p_dedupe_key         => 'claim:' || new.id::text || ':' || v_suffix
  );

  return null;
end;
$$;


--
-- Name: FUNCTION analytics_claim_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_claim_event() IS 'Emits claim_submitted on INSERT and claim_approved / claim_rejected from real professional_claims decisions. Resolves the originating prospect through prospect_professionals so an approved claim closes the acquisition funnel end to end; a claim over an organically created identity records no prospect rather than a fabricated one. Carries neither the applicant''s evidence text nor the reviewer''s private decision note.';


--
-- Name: analytics_external_profile_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_external_profile_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_source text;
  v_source_record_id uuid;
begin
  -- The FIRST source that observed this prospect, as the attribution anchor.
  -- Deliberately first-touch rather than last: the question acquisition asks
  -- is which channel found a business nobody had, and a later re-observation
  -- by a second source did not find anything.
  select ps.key, psr.id
    into v_source, v_source_record_id
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = new.prospect_id
  order by psr.created_at
  limit 1;

  perform private.try_emit_analytics_event(
    p_event_name                   => 'external_profile_created',
    p_event_origin                 => 'worker',
    p_actor_type                   => 'worker',
    p_professional_id              => new.professional_id,
    p_prospect_id                  => new.prospect_id,
    p_acquisition_source           => v_source,
    p_acquisition_source_record_id => v_source_record_id,
    p_properties                   => jsonb_build_object(
                                        'matching_rule', new.matching_rule),
    p_occurred_at                  => new.created_at,
    p_dedupe_key                   => 'external_profile:' || new.professional_id::text || ':created'
  );

  return null;
end;
$$;


--
-- Name: FUNCTION analytics_external_profile_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_external_profile_event() IS 'Emits external_profile_created from prospect_professionals — the unified prospect-to-identity linkage — rather than from professionals. This is what makes §9 hold: one real professional discovered through several sources yields several source records, ONE prospect, ONE linkage and therefore exactly ONE conversion, so multi-source discovery can never inflate the count. Attribution is FIRST-touch, because the question is which channel found a business nobody had.';


--
-- Name: analytics_favorite_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_favorite_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_row public.customer_favorites;
  v_actor uuid;
  v_direction text;
begin
  if tg_op = 'INSERT' then
    v_row := new;
    v_direction := 'favorited';
  else
    v_row := old;
    v_direction := 'unfavorited';
  end if;

  -- Only the acting account is needed: these three tables all name their own
  -- subject in a NOT NULL column, so the actor is never unknown and never has
  -- to be classified as anonymous or system.
  select a.actor_user_id into v_actor
  from private.analytics_trigger_actor() a;

  perform private.try_emit_analytics_event(
    p_event_name      => case when v_direction = 'favorited'
                           then 'organization_favorited'
                           else 'organization_unfavorited' end,
    p_event_origin    => 'backend',
    p_actor_user_id   => coalesce(v_actor, v_row.user_id),
    p_organization_id => v_row.organization_id,
    p_barber_id       => v_row.barber_id,
    -- A shop favorite and a specific-barber favorite are the same
    -- relationship at different granularity, and reports need to separate them.
    p_properties      => jsonb_build_object(
                           'scope', case when v_row.barber_id is null then 'shop' else 'barber' end),
    p_dedupe_key      => 'favorite:' || v_row.user_id::text || ':'
                         || v_row.organization_id::text || ':'
                         || coalesce(v_row.barber_id::text, 'shop') || ':'
                         || v_direction || ':'
                         || (extract(epoch from now()) * 1000000)::bigint::text
  );

  return null;
end;
$$;


--
-- Name: FUNCTION analytics_favorite_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_favorite_event() IS 'Emits organization_favorited / organization_unfavorited from customer_favorites, where favoriting is an INSERT and unfavoriting a DELETE. Distinguishes a whole-shop favorite from a specific-barber favorite in properties. Favorite stays a separate event from Follow because they are separate relationships under CUSTOMER_API_FREEZE §3.';


--
-- Name: analytics_organization_follow_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_organization_follow_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_became_following boolean;
  v_became_unfollowed boolean;
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    v_became_following  := new.is_following;
    v_became_unfollowed := not new.is_following;
  else
    -- Only a genuine change of direction. An idempotent re-follow updates
    -- followed_at but leaves is_following true, and must produce nothing.
    v_became_following  := new.is_following and not old.is_following;
    v_became_unfollowed := old.is_following and not new.is_following;
  end if;

  if not (v_became_following or v_became_unfollowed) then
    return null;
  end if;

  -- Only the acting account is needed: these three tables all name their own
  -- subject in a NOT NULL column, so the actor is never unknown and never has
  -- to be classified as anonymous or system.
  select a.actor_user_id into v_actor
  from private.analytics_trigger_actor() a;

  if v_became_following then
    perform private.try_emit_analytics_event(
      p_event_name      => 'organization_followed',
      p_event_origin    => 'backend',
      p_actor_user_id   => coalesce(v_actor, new.follower_user_id),
      p_organization_id => new.organization_id,
      p_occurred_at     => coalesce(new.followed_at, now()),
      -- Transition-scoped: follow, unfollow, follow again are three events.
      p_dedupe_key      => 'org_follow:' || new.follower_user_id::text || ':'
                           || new.organization_id::text || ':followed:'
                           || (extract(epoch from coalesce(new.followed_at, now())) * 1000000)::bigint::text
    );
  else
    perform private.try_emit_analytics_event(
      p_event_name      => 'organization_unfollowed',
      p_event_origin    => 'backend',
      p_actor_user_id   => coalesce(v_actor, new.follower_user_id),
      p_organization_id => new.organization_id,
      p_occurred_at     => coalesce(new.unfollowed_at, now()),
      p_dedupe_key      => 'org_follow:' || new.follower_user_id::text || ':'
                           || new.organization_id::text || ':unfollowed:'
                           || (extract(epoch from coalesce(new.unfollowed_at, now())) * 1000000)::bigint::text
    );
  end if;

  return null;
end;
$$;


--
-- Name: FUNCTION analytics_organization_follow_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_organization_follow_event() IS 'Emits organization_followed / organization_unfollowed from the actual organization_follows state transition. Fires only when is_following genuinely changes direction, so a repeated Follow on an already-followed shop produces nothing. Non-fatal: a failed event never blocks the Follow.';


--
-- Name: analytics_passport_issued_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_passport_issued_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.try_emit_analytics_event(
    p_event_name    => 'passport_issued',
    p_event_origin  => 'backend',
    p_actor_user_id => new.user_id,
    p_passport_id   => new.id,
    p_occurred_at   => new.created_at,
    p_dedupe_key    => 'passport:' || new.id::text || ':issued'
  );
  return null;
end;
$$;


--
-- Name: FUNCTION analytics_passport_issued_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_passport_issued_event() IS 'Emits passport_issued when a Fade Passport comes into existence. Records that a passport exists and nothing about what is in it — §17 forbids exposing private Passport history through analytics, and no property here reads a preference column. No organization: the Passport is customer-owned and portable, so attributing issuance to a shop would be false.';


--
-- Name: analytics_plan_change_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_plan_change_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_is_first boolean := new.previous_plan_key is null;
begin
  perform private.try_emit_analytics_event(
    p_event_name      => case when v_is_first then 'plan_assigned' else 'plan_changed' end,
    p_event_origin    => 'backend',
    p_actor_user_id   => new.changed_by,
    p_actor_type      => case when new.changed_by is null
                           then 'system'::public.analytics_actor_type
                           else null end,
    p_organization_id => new.organization_id,
    p_properties      => jsonb_build_object(
                           'previous_plan_key', new.previous_plan_key,
                           'new_plan_key', new.new_plan_key,
                           'previous_status', new.previous_status,
                           'new_status', new.new_status,
                           'entitlement_source', new.entitlement_source
                         ),
    p_occurred_at     => new.created_at,
    p_dedupe_key      => 'plan_change:' || new.id::text
  );
  return null;
end;
$$;


--
-- Name: FUNCTION analytics_plan_change_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_plan_change_event() IS 'Emits plan_assigned (previous_plan_key IS NULL — an organization receiving its first plan) or plan_changed, from the already-authoritative commercial_plan_changes history. Both plan keys travel in properties so a report never has to guess which side of the transition the frozen commercial snapshot represents. change_reason is deliberately not carried: it is free text.';


--
-- Name: analytics_professional_follow_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_professional_follow_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_became_following boolean;
  v_became_unfollowed boolean;
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    v_became_following  := new.state = 'following';
    v_became_unfollowed := new.state = 'unfollowed';
  else
    v_became_following  := new.state = 'following' and old.state <> 'following';
    v_became_unfollowed := new.state = 'unfollowed' and old.state <> 'unfollowed';
  end if;

  if not (v_became_following or v_became_unfollowed) then
    return null;
  end if;

  -- Only the acting account is needed: these three tables all name their own
  -- subject in a NOT NULL column, so the actor is never unknown and never has
  -- to be classified as anonymous or system.
  select a.actor_user_id into v_actor
  from private.analytics_trigger_actor() a;

  perform private.try_emit_analytics_event(
    p_event_name      => case when v_became_following
                           then 'professional_followed'
                           else 'professional_unfollowed' end,
    p_event_origin    => 'backend',
    p_actor_user_id   => coalesce(v_actor, new.follower_user_id),
    p_professional_id => new.professional_id,
    p_properties      => jsonb_build_object('source', new.source::text),
    p_occurred_at     => coalesce(
                           case when v_became_following then new.followed_at else new.unfollowed_at end,
                           now()),
    p_dedupe_key      => 'pro_follow:' || new.follower_user_id::text || ':'
                         || new.professional_id::text || ':'
                         || case when v_became_following then 'followed:' else 'unfollowed:' end
                         || (extract(epoch from coalesce(
                              case when v_became_following then new.followed_at else new.unfollowed_at end,
                              now())) * 1000000)::bigint::text
  );

  return null;
end;
$$;


--
-- Name: FUNCTION analytics_professional_follow_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_professional_follow_event() IS 'Emits professional_followed / professional_unfollowed from the professional_follows state transition, carrying source (manual vs auto) in properties because an auto-follow earned by a completed service and a deliberate follow are different social facts. Carries no organization: the edge is to a durable identity that outlives any shop placement.';


--
-- Name: analytics_prospect_discovered_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_prospect_discovered_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_prospect public.prospects;
  v_source text;
  v_first_record_id uuid;
  v_first_source text;
begin
  -- A provenance row without a prospect is a raw observation that identity
  -- resolution has not yet attached to anything. It has discovered no business
  -- and must not count as a discovery.
  if new.prospect_id is null then
    return null;
  end if;

  select * into v_prospect from public.prospects where id = new.prospect_id;
  if not found then
    return null;
  end if;

  select ps.key into v_source
  from public.prospect_sources ps
  where ps.id = new.source_id;

  -- FIRST-touch attribution, matching R3 §9. The question acquisition asks is
  -- which channel found a business nobody had; a later re-observation by a
  -- second source found nothing. In the overwhelmingly common case this IS the
  -- row that just fired the trigger, but ordering by created_at rather than
  -- assuming that keeps the answer correct when a backfill or a concurrent
  -- second source lands first.
  select psr.id, ps.key
    into v_first_record_id, v_first_source
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = new.prospect_id
  order by psr.created_at, psr.id
  limit 1;

  perform private.try_emit_analytics_event(
    p_event_name                   => 'prospect_discovered',
    p_event_origin                 => 'worker',
    p_actor_type                   => 'worker',
    p_prospect_id                  => new.prospect_id,
    p_acquisition_source           => coalesce(v_first_source, v_source),
    p_acquisition_source_record_id => coalesce(v_first_record_id, new.id),
    p_properties                   => jsonb_build_object(
                                        'country', v_prospect.country,
                                        'entity_kind', v_prospect.entity_kind,
                                        'prospect_type', v_prospect.type,
                                        'observing_source', v_source),
    -- The prospect's own discovery time, not the provenance row's. A source
    -- record written by a later backfill describes a business that was found
    -- when it was found.
    p_occurred_at                  => v_prospect.first_discovered_at,
    p_dedupe_key                   => 'prospect:' || new.prospect_id::text || ':discovered'
  );

  return null;
end;
$$;


--
-- Name: FUNCTION analytics_prospect_discovered_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_prospect_discovered_event() IS 'Emits prospect_discovered once per canonical prospect, from prospect_source_records rather than prospects — the prospect row is inserted before its provenance, so a trigger on prospects would attribute every discovery to NULL. The dedupe key is the prospect, so a business found by four sources produces four provenance rows and exactly one discovery. Attribution is first-touch. A provenance row not yet attached to a prospect is a raw observation and deliberately counts as nothing.';


--
-- Name: analytics_prospect_enriched_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_prospect_enriched_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_source text;
  v_record_id uuid;
begin
  -- Only a real advance counts. An UPDATE that rewrites the same timestamp, or
  -- clears it, is not an enrichment pass.
  if new.last_enriched_at is null
     or new.last_enriched_at is not distinct from old.last_enriched_at then
    return null;
  end if;

  select ps.key, psr.id
    into v_source, v_record_id
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = new.id
  order by psr.created_at, psr.id
  limit 1;

  perform private.try_emit_analytics_event(
    p_event_name                   => 'prospect_enriched',
    p_event_origin                 => 'worker',
    p_actor_type                   => 'worker',
    p_prospect_id                  => new.id,
    p_acquisition_source           => v_source,
    p_acquisition_source_record_id => v_record_id,
    -- What the pass actually established, as booleans about presence. No
    -- values: R3 §10.1 refuses payload keys containing email, phone, address
    -- and the rest, and it is right to — an enrichment event does not need the
    -- number to record that a number was found.
    p_properties                   => jsonb_build_object(
                                        'gained_website', (old.website_domain is null and new.website_domain is not null),
                                        'gained_contact', ((old.email is null and new.email is not null)
                                                        or (old.phone_e164 is null and new.phone_e164 is not null)),
                                        'first_enrichment', (old.last_enriched_at is null)),
    p_occurred_at                  => new.last_enriched_at,
    p_dedupe_key                   => 'prospect:' || new.id::text || ':enriched:'
                                      || extract(epoch from new.last_enriched_at)::text
  );

  return null;
end;
$$;


--
-- Name: FUNCTION analytics_prospect_enriched_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_prospect_enriched_event() IS 'Emits prospect_enriched when an enrichment pass advances prospects.last_enriched_at — the column the Worker''s website-enrichment handler already writes, so nothing new has to be trusted. Deliberately not idempotent per R3''s contract: re-enrichment is legitimate, so the key is scoped to the enrichment timestamp rather than to the prospect. Properties are booleans about what the pass established, never the values it found, because R3 §10.1 refuses contact data in payloads and an enrichment count does not need the phone number to record that one was found.';


--
-- Name: analytics_queue_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_queue_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid;
  v_actor_type public.analytics_actor_type;
  v_professional_id uuid;
  v_event text;
  v_suffix text;
  v_occurred timestamptz;
begin
  if tg_op = 'INSERT' then
    v_event    := 'queue_joined';
    v_suffix   := 'joined';
    v_occurred := new.created_at;
  else
    if new.status is not distinct from old.status then
      return null;
    end if;

    case new.status
      when 'called' then
        v_event := 'queue_called';       v_suffix := 'called';
        v_occurred := coalesce(new.called_at, now());
      when 'in_service' then
        v_event := 'queue_service_started'; v_suffix := 'service_started';
        v_occurred := coalesce(new.service_started_at, now());
      when 'completed' then
        v_event := 'queue_completed';    v_suffix := 'completed';
        v_occurred := coalesce(new.completed_at, now());
      when 'cancelled' then
        v_event := 'queue_cancelled';    v_suffix := 'cancelled';
        v_occurred := now();
      when 'no_show' then
        v_event := 'queue_no_show';      v_suffix := 'no_show';
        v_occurred := now();
      else
        return null;
    end case;
  end if;

  select a.actor_user_id, a.actor_type
    into v_actor, v_actor_type
  from private.analytics_trigger_actor() a;

  select b.professional_id into v_professional_id
  from public.barbers b
  where b.id = new.barber_id;

  perform private.try_emit_analytics_event(
    p_event_name      => v_event,
    p_event_origin    => 'backend',
    p_actor_user_id   => v_actor,
    p_actor_type      => v_actor_type,
    p_organization_id => new.organization_id,
    p_location_id     => new.location_id,
    p_barber_id       => new.barber_id,
    p_professional_id => v_professional_id,
    p_customer_id     => new.customer_id,
    p_queue_entry_id  => new.id,
    -- barber_id NULL is a real product state — "any available barber" — and
    -- not a missing value, so it is recorded as a fact rather than left to be
    -- inferred from a NULL.
    p_properties      => jsonb_build_object(
                           'service_id', new.service_id,
                           'requested_specific_barber', new.barber_id is not null),
    p_occurred_at     => v_occurred,
    -- Every queue transition is once-only: the R1A guard forbids going
    -- backwards and forbids leaving a terminal state, for every caller.
    p_dedupe_key      => 'queue_entry:' || new.id::text || ':' || v_suffix
  );

  return null;
end;
$$;


--
-- Name: FUNCTION analytics_queue_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_queue_event() IS 'Emits the authoritative walk-in queue lifecycle from queue_entries: joined on INSERT, then called / service_started / completed / cancelled / no_show from real status transitions. Every timestamp it reads is server-stamped by R1A''s enforce_queue_transition, which discards client-supplied values — analytics on these columns would be worthless without that guard. Invents no wait time, position or service state (§16).';


--
-- Name: analytics_relationship_created_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_relationship_created_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.try_emit_analytics_event(
    p_event_name      => 'passport_relationship_created',
    p_event_origin    => 'backend',
    p_actor_user_id   => new.customer_user_id,
    p_organization_id => new.organization_id,
    p_professional_id => new.professional_id,
    p_occurred_at     => new.first_completed_at,
    p_dedupe_key      => 'relationship:' || new.id::text || ':created'
  );
  return null;
end;
$$;


--
-- Name: FUNCTION analytics_relationship_created_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_relationship_created_event() IS 'Emits passport_relationship_created when a durable customer-professional relationship first forms from a completed service. The retention funnel''s anchor: this is the moment a first-time customer becomes someone with a history.';


--
-- Name: apply_appointment_no_show_rule(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_appointment_no_show_rule(p_organization_id uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_grace_minutes constant integer := 30;
  v_updated_count integer;
begin
  update public.appointments
  set status = 'no_show'
  where organization_id = p_organization_id
    and status = 'confirmed'
    and ends_at < (now() - make_interval(mins => v_grace_minutes));

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;


--
-- Name: FUNCTION apply_appointment_no_show_rule(p_organization_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.apply_appointment_no_show_rule(p_organization_id uuid) IS 'Marks confirmed appointments more than 30 minutes past their end time as no_show. SECURITY INVOKER — relies entirely on existing appointments UPDATE RLS (owner/manager/receptionist), grants no elevated access. Called opportunistically from the app (no pg_cron in this stack yet); safe to also wire to a real scheduled job later with zero changes.';


--
-- Name: apply_starter_services(uuid, uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_starter_services(p_organization_id uuid, p_location_id uuid, p_services jsonb, p_barber_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_item jsonb;
  v_name text;
  v_duration integer;
  v_price integer;
  v_service_id uuid;
  v_count integer := 0;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may create services'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.organization_id = p_organization_id
  ) then
    raise exception 'location does not belong to this organization';
  end if;

  if p_barber_id is not null and not exists (
    select 1 from public.barbers b
    where b.id = p_barber_id and b.organization_id = p_organization_id
  ) then
    raise exception 'professional does not belong to this organization';
  end if;

  if jsonb_typeof(p_services) <> 'array' then
    raise exception 'p_services must be a JSON array';
  end if;

  for v_item in select * from jsonb_array_elements(p_services)
  loop
    v_name := nullif(btrim(coalesce(v_item ->> 'name', '')), '');
    v_duration := nullif(v_item ->> 'duration_minutes', '')::integer;
    v_price := nullif(v_item ->> 'price_cents', '')::integer;

    if v_name is null then
      raise exception 'every starter service needs a name';
    end if;
    if v_duration is null or v_duration <= 0 then
      raise exception 'service "%" needs a positive duration', v_name;
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'service "%" needs a price of zero or more', v_name;
    end if;

    select s.id into v_service_id
      from public.services s
      where s.organization_id = p_organization_id
        and lower(btrim(s.name)) = lower(v_name)
      limit 1;

    if v_service_id is null then
      insert into public.services (organization_id, name, duration_minutes, price_cents, is_active)
      values (p_organization_id, v_name, v_duration, v_price, true)
      returning id into v_service_id;
    else
      update public.services
        set duration_minutes = v_duration, price_cents = v_price, is_active = true
        where id = v_service_id;
    end if;

    insert into public.service_locations (organization_id, service_id, location_id)
    values (p_organization_id, v_service_id, p_location_id)
    on conflict do nothing;

    if p_barber_id is not null then
      insert into public.barber_services (organization_id, barber_id, service_id)
      values (p_organization_id, p_barber_id, v_service_id)
      on conflict do nothing;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


--
-- Name: FUNCTION apply_starter_services(p_organization_id uuid, p_location_id uuid, p_services jsonb, p_barber_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.apply_starter_services(p_organization_id uuid, p_location_id uuid, p_services jsonb, p_barber_id uuid) IS 'Idempotently creates or updates a set of services from the onboarding template and links them to a location (and optionally a professional). Matches existing services on lower(trimmed name) per organization, so resuming or re-running onboarding never duplicates a service. Templates are initializers — everything stays editable through the normal services screen afterwards.';


--
-- Name: apply_weekly_hours(uuid, uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_weekly_hours(p_organization_id uuid, p_location_id uuid DEFAULT NULL::uuid, p_barber_id uuid DEFAULT NULL::uuid, p_days jsonb DEFAULT '[]'::jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_item jsonb;
  v_dow smallint;
  v_closed boolean;
  v_open time;
  v_close time;
  v_second_open time;
  v_second_close time;
  v_count integer := 0;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may set hours'
      using errcode = '42501';
  end if;

  if p_location_id is null and p_barber_id is null then
    raise exception 'pass a location, a professional, or both';
  end if;

  if p_location_id is not null and not exists (
    select 1 from public.locations l where l.id = p_location_id and l.organization_id = p_organization_id
  ) then
    raise exception 'location does not belong to this organization';
  end if;

  if p_barber_id is not null and not exists (
    select 1 from public.barbers b where b.id = p_barber_id and b.organization_id = p_organization_id
  ) then
    raise exception 'professional does not belong to this organization';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb))
  loop
    v_dow := (v_item ->> 'day_of_week')::smallint;
    v_closed := coalesce((v_item ->> 'is_closed')::boolean, (v_item ->> 'is_off')::boolean, false);
    v_open := nullif(v_item ->> 'open_time', '')::time;
    v_close := nullif(v_item ->> 'close_time', '')::time;
    v_second_open := nullif(v_item ->> 'second_open_time', '')::time;
    v_second_close := nullif(v_item ->> 'second_close_time', '')::time;

    if v_dow is null or v_dow < 0 or v_dow > 6 then
      raise exception 'day_of_week must be 0 (Sunday) through 6 (Saturday)';
    end if;
    if not v_closed and (v_open is null or v_close is null or v_open >= v_close) then
      raise exception 'an open day needs open_time earlier than close_time';
    end if;

    -- Validated here as well as by the table constraint, so the caller gets a
    -- sentence rather than a constraint name.
    if not v_closed and (v_second_open is not null or v_second_close is not null) then
      if v_second_open is null or v_second_close is null then
        raise exception 'a split shift needs both second_open_time and second_close_time';
      end if;
      if v_second_open >= v_second_close then
        raise exception 'the second interval needs its start earlier than its end';
      end if;
      if v_second_open < v_close then
        raise exception 'the second interval must begin after the first one ends';
      end if;
    end if;

    -- A closed day carries no intervals at all.
    if v_closed then
      v_open := null; v_close := null; v_second_open := null; v_second_close := null;
    end if;

    if p_location_id is not null then
      insert into public.location_hours (
        organization_id, location_id, day_of_week, is_closed,
        open_time, close_time, second_open_time, second_close_time)
      values (p_organization_id, p_location_id, v_dow, v_closed,
              v_open, v_close, v_second_open, v_second_close)
      on conflict (location_id, day_of_week) do update set
        is_closed = excluded.is_closed,
        open_time = excluded.open_time,
        close_time = excluded.close_time,
        second_open_time = excluded.second_open_time,
        second_close_time = excluded.second_close_time;
    end if;

    if p_barber_id is not null then
      insert into public.barber_working_hours (
        organization_id, barber_id, day_of_week, is_off,
        start_time, end_time, second_start_time, second_end_time)
      values (p_organization_id, p_barber_id, v_dow, v_closed,
              v_open, v_close, v_second_open, v_second_close)
      on conflict (barber_id, day_of_week) do update set
        is_off = excluded.is_off,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        second_start_time = excluded.second_start_time,
        second_end_time = excluded.second_end_time;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


--
-- Name: FUNCTION apply_weekly_hours(p_organization_id uuid, p_location_id uuid, p_barber_id uuid, p_days jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.apply_weekly_hours(p_organization_id uuid, p_location_id uuid, p_barber_id uuid, p_days jsonb) IS 'Upserts a whole week of opening hours for a location and/or working hours for a professional in one call. Idempotent via the existing unique constraints. Now accepts an optional second interval per day, so the midday closure most salons actually work is expressible; omitting it preserves the previous single-window behaviour exactly.';


--
-- Name: appointments_auto_follow(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.appointments_auto_follow() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status <> 'confirmed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' then
    return null;
  end if;

  perform private.auto_follow_professional(new.booked_by_user_id, new.barber_id);
  return null;
end;
$$;


--
-- Name: FUNCTION appointments_auto_follow(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.appointments_auto_follow() IS 'AFTER INSERT OR UPDATE on appointments. Fires once, on entry to confirmed, and only for a booking the account made ITSELF (booked_by_user_id, the only forgery-resistant attribution in this schema). Constitution §3.3: a confirmed booking may establish a follow; it is never evidence a service was delivered.';


--
-- Name: appointments_record_relationship(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.appointments_record_relationship() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  -- Entry into 'completed' only, and R1A makes that state terminal, so this
  -- fires at most once in a row's lifetime.
  if new.status <> 'completed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return null;
  end if;

  perform private.record_completed_interaction(
    new.booked_by_user_id, new.barber_id, new.organization_id, new.completed_at
  );
  return null;
end;
$$;


--
-- Name: FUNCTION appointments_record_relationship(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.appointments_record_relationship() IS 'AFTER INSERT OR UPDATE on appointments. Records a completed service exactly once, using completed_at — which R1A made server-stamped and unforgeable — and booked_by_user_id, the only account attribution a shop cannot fabricate.';


--
-- Name: outreach_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    channel public.outreach_channel_kind DEFAULT 'whatsapp'::public.outreach_channel_kind NOT NULL,
    locale text NOT NULL,
    segment_key text,
    booking_provider_id uuid,
    sales_angle text,
    version integer DEFAULT 1 NOT NULL,
    status public.outreach_template_status DEFAULT 'draft'::public.outreach_template_status NOT NULL,
    body text NOT NULL,
    allowed_variables text[] DEFAULT ARRAY['business_name'::text, 'city'::text, 'competitor'::text, 'shop_type'::text] NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outreach_templates_approval_shape CHECK (((status <> 'approved'::public.outreach_template_status) OR ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL)))),
    CONSTRAINT outreach_templates_body_check CHECK (((btrim(body) <> ''::text) AND (length(body) <= 4000))),
    CONSTRAINT outreach_templates_key_check CHECK ((key ~ '^[a-z0-9_]+$'::text)),
    CONSTRAINT outreach_templates_locale_check CHECK ((locale ~ '^[a-z]{2}-[A-Z]{2}$'::text)),
    CONSTRAINT outreach_templates_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT outreach_templates_version_check CHECK ((version >= 1))
);

ALTER TABLE ONLY public.outreach_templates FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE outreach_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.outreach_templates IS 'Administrator-authored, approval-gated message copy. THE only source of outbound text — no LLM/AI generation path exists anywhere in this schema (spec §23). Placeholders are restricted to allowed_variables and rendered by a non-evaluating substituter.';


--
-- Name: COLUMN outreach_templates.allowed_variables; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outreach_templates.allowed_variables IS 'Whitelist of {{placeholders}} the body may use. The renderer escapes and validates every value and rejects unknown placeholders — there is no expression language, no eval, no code execution path.';


--
-- Name: approve_outreach_template(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_outreach_template(p_template_id uuid) RETURNS public.outreach_templates
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_template public.outreach_templates;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'approve_outreach_template: platform admin role required' using errcode = '42501';
  end if;

  update public.outreach_templates
  set status = 'approved'
  where id = p_template_id
  returning * into v_template;

  if not found then
    raise exception 'approve_outreach_template: template % not found', p_template_id;
  end if;

  return v_template;
end;
$$;


--
-- Name: assign_barber_professional(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_barber_professional() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
  v_display_name text;
  v_avatar_url text;
  v_professional_id uuid;
begin
  -- A client-supplied professional_id is never trusted. INSERT on this column
  -- is revoked below, so `authenticated` cannot send one at all; this makes
  -- the same guarantee hold for service_role and direct SQL.
  new.professional_id := null;

  select sp.user_id, sp.display_name, sp.avatar_url
    into v_user_id, v_display_name, v_avatar_url
  from public.staff_profiles sp
  where sp.id = new.staff_profile_id;

  if v_user_id is null then
    return new;
  end if;

  select p.id into v_professional_id
  from public.professionals p
  where p.user_id = v_user_id;

  if v_professional_id is null then
    perform set_config('fadeup.professional_claim_write', 'on', true);
    -- ON CONFLICT, not select-then-insert: two roster seats created
    -- concurrently for the same account must yield exactly one identity, and
    -- the unique index on user_id is the only thing that can promise that.
    insert into public.professionals (user_id, claim_state, claimed_at, display_name, avatar_url, source)
    values (
      v_user_id, 'claimed', now(),
      coalesce(nullif(btrim(coalesce(v_display_name, '')), ''), 'Professional'),
      v_avatar_url, 'fadeup'
    )
    on conflict (user_id) do nothing;
    perform set_config('fadeup.professional_claim_write', 'off', true);

    select p.id into v_professional_id
    from public.professionals p
    where p.user_id = v_user_id;
  end if;

  new.professional_id := v_professional_id;
  return new;
end;
$$;


--
-- Name: FUNCTION assign_barber_professional(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assign_barber_professional() IS 'BEFORE INSERT on barbers. Derives professional_id from the account behind the staff profile, minting the durable identity on first sight via ON CONFLICT (user_id) so concurrent roster creation cannot produce two identities for one person. Always overwrites any caller-supplied professional_id: a shop must never be able to name an identity it does not own.';


--
-- Name: assign_commercial_plan(uuid, text, public.commercial_status, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_commercial_plan(p_organization_id uuid, p_plan_key text, p_status public.commercial_status DEFAULT 'active'::public.commercial_status, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid;
  v_old_plan text;
  v_old_status public.commercial_status;
  v_max_est integer;
  v_max_pro integer;
  v_used_est integer;
  v_used_pro integer;
  v_change_id uuid;
begin
  v_actor := (select auth.uid());

  if v_actor is null then
    raise exception 'changing a commercial plan requires an authenticated session'
      using errcode = '42501';
  end if;

  -- The whole authorization decision, in one line, resolved from the session
  -- and never from an argument. An owner of the organization is NOT sufficient:
  -- the organization is the party being charged, and a party cannot decide what
  -- it owes.
  if not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff may change an organization commercial plan'
      using errcode = '42501';
  end if;

  if p_organization_id is null then
    raise exception 'organization is required' using errcode = '22023';
  end if;

  -- Unknown plan fails closed and says so, rather than being coerced into
  -- something plausible. is_available is checked too: a withdrawn plan may be
  -- kept for the organizations already on it, and must not be newly assignable.
  select p.max_establishments, p.max_operational_professionals
    into v_max_est, v_max_pro
  from public.commercial_plans p
  where p.plan_key = p_plan_key and p.is_available;

  if v_max_est is null then
    raise exception 'unknown or unavailable plan: %', coalesce(p_plan_key, '(null)')
      using errcode = '22023',
            hint = 'Plan keys are free, solo, salon_essential, salon_pro, salon_business, multi_growth, multi_pro, multi_scale.';
  end if;

  perform private.ensure_organization_commercial_state(p_organization_id);

  -- Serialise against concurrent assignment AND against concurrent location or
  -- roster creation: this is the same row those triggers lock, so "downgrade
  -- while another location is being created" cannot interleave into a state
  -- where both succeeded.
  select s.plan_key, s.status into v_old_plan, v_old_status
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id
  for update;

  if v_old_plan is null then
    raise exception 'organization not found' using errcode = '42704';
  end if;

  if v_old_plan = p_plan_key and v_old_status = p_status then
    raise exception 'organization is already on % with status %', p_plan_key, p_status
      using errcode = 'P0001';
  end if;

  -- Counted AFTER the lock, so the numbers in the error message are the
  -- numbers the decision was made on.
  v_used_est := private.org_active_establishments(p_organization_id);
  v_used_pro := private.org_active_professionals(p_organization_id);

  -- The same rule the trigger enforces, checked here so the caller gets an
  -- explanation rather than a constraint violation. Defence in depth, not a
  -- substitute: the trigger still runs on the UPDATE below.
  if v_used_est > v_max_est then
    raise exception
      'cannot move to %: it covers % establishment(s) and this organization operates %. Nothing has been changed.',
      p_plan_key, v_max_est, v_used_est
      using errcode = 'P0001',
            hint = 'Deactivate the establishments no longer in use first. FadeUp does not remove establishments to satisfy a plan change.';
  end if;

  if v_max_pro is not null and v_used_pro > v_max_pro then
    raise exception
      'cannot move to %: it covers % operational professional(s) and this organization rosters %. Nothing has been changed.',
      p_plan_key, v_max_pro, v_used_pro
      using errcode = 'P0001',
            hint = 'Offboard the professionals no longer working here first. Their identity, followers and appointment history are preserved either way.';
  end if;

  update public.organization_commercial_state
  set plan_key = p_plan_key,
      status = p_status,
      -- Hard-coded. A staff decision is a staff decision, and no argument to
      -- this function can make it look like a payment.
      entitlement_source = 'platform_grant',
      assigned_at = now(),
      assigned_by = v_actor,
      assignment_note = p_note
  where organization_id = p_organization_id;

  insert into public.commercial_plan_changes
    (organization_id, previous_plan_key, new_plan_key,
     previous_status, new_status, entitlement_source, changed_by, change_reason)
  values
    (p_organization_id, v_old_plan, p_plan_key,
     v_old_status, p_status, 'platform_grant', v_actor, p_note)
  returning id into v_change_id;

  return v_change_id;
end;
$$;


--
-- Name: FUNCTION assign_commercial_plan(p_organization_id uuid, p_plan_key text, p_status public.commercial_status, p_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assign_commercial_plan(p_organization_id uuid, p_plan_key text, p_status public.commercial_status, p_note text) IS 'The ONLY way a commercial plan changes. Platform admin only, resolved from auth.uid() and never from an argument — an owner of the organization is deliberately not sufficient, because the party being charged cannot decide what it owes. Refuses unknown and withdrawn plans, refuses a downgrade that the organization''s current establishments or roster would not fit (nothing is ever deleted to make one fit), takes the same row lock the capacity triggers take so a downgrade cannot interleave with a location being created, and appends an immutable audit row. entitlement_source is hard-coded to platform_grant: no argument to this function can dress a staff decision up as a payment.';


--
-- Name: book_public_appointment(text, uuid, uuid, uuid, timestamp with time zone, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.book_public_appointment(p_organization_slug text, p_location_id uuid, p_barber_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_customer_name text, p_customer_phone text DEFAULT NULL::text, p_customer_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) RETURNS TABLE(id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, status public.appointment_status, claim_token text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_organization_id uuid;
  v_timezone text;
  v_duration_minutes integer;
  v_buffer_before_minutes integer;
  v_buffer_after_minutes integer;
  v_ends_at timestamptz;
  v_appointment public.appointments;
  v_user_id uuid;
  v_customer_id uuid;
  v_claim_token text;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  if coalesce(btrim(p_customer_phone), '') = '' and coalesce(btrim(p_customer_email), '') = '' then
    raise exception 'at least one of customer_phone or customer_email is required';
  end if;

  if p_starts_at <= now() then
    raise exception 'starts_at must be in the future';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  select l.timezone into v_timezone
    from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;
  if not found then
    raise exception 'location is not available for booking';
  end if;

  select s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes
    into v_duration_minutes, v_buffer_before_minutes, v_buffer_after_minutes
    from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
      and exists (select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = p_location_id);
  if not found then
    raise exception 'service is not available for booking at this location';
  end if;

  if not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.is_public
      and sp.location_id = p_location_id
  ) then
    raise exception 'barber is not available for this service at this location';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_minutes);

  -- The client is never trusted to have only ever requested a time we offered.
  if not private.slot_is_within_hours(p_barber_id, p_location_id, p_starts_at, v_ends_at, v_timezone) then
    raise exception 'requested time is outside available hours';
  end if;

  -- Signed-in booker: resolve (or create) their own CRM row for this shop so
  -- the appointment is owned from the moment it exists. Anonymous booker:
  -- v_customer_id stays null and a claim token is issued below. (LOT 13.)
  v_user_id := (select auth.uid());
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, p_customer_email
    );
  end if;

  -- CONFIRMED, not pending. Everything above has already established that the
  -- shop works this time, at this place, for this service, with this
  -- professional — there is no further question for a human to answer.
  --
  -- decided_at/decided_by stay NULL on purpose: nobody decided. That is what
  -- distinguishes an auto-confirmed booking from one a receptionist accepted,
  -- and it is worth being able to tell them apart later.
  --
  -- appointments_check_time_blocks (LOT D) runs before the insert lands, and
  -- the GiST exclusion constraints remain the final race-free authority: two
  -- visitors racing this exact slot still produce exactly one appointment.
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id, customer_id,
    customer_name, customer_phone, customer_email,
    starts_at, ends_at, buffer_before_minutes, buffer_after_minutes,
    status, notes, created_by, booked_by_user_id
  )
  values (
    v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id,
    btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), nullif(btrim(coalesce(p_customer_email, '')), ''),
    p_starts_at, v_ends_at, v_buffer_before_minutes, v_buffer_after_minutes,
    'confirmed', p_notes, null, v_user_id
  )
  returning * into v_appointment;

  -- Anonymous booking: issue the one-time proof-of-booking token. (LOT 13.)
  if v_user_id is null then
    v_claim_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.appointment_claim_tokens (appointment_id, token_hash, expires_at)
    values (
      v_appointment.id,
      encode(extensions.digest(v_claim_token, 'sha256'), 'hex'),
      now() + interval '72 hours'
    );
  end if;

  return query select v_appointment.id, v_appointment.starts_at, v_appointment.ends_at, v_appointment.status, v_claim_token;
end;
$$;


--
-- Name: FUNCTION book_public_appointment(p_organization_slug text, p_location_id uuid, p_barber_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_customer_name text, p_customer_phone text, p_customer_email text, p_notes text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.book_public_appointment(p_organization_slug text, p_location_id uuid, p_barber_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_customer_name text, p_customer_phone text, p_customer_email text, p_notes text) IS 'Anon-callable: the only path to create an appointment without a session. Creates status=CONFIRMED — the shop already answered by publishing the slot. Every id is re-validated against the organization resolved from the slug, the window is re-derived server-side through private.slot_is_within_hours, time blocks are enforced by trigger, and the LOT 8 GiST exclusion constraints remain the final race-free conflict guarantee. Signed-in bookers get customer_id stamped; anonymous ones get a single-use 72h claim_token.';


--
-- Name: cancel_appointment_as_business(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_appointment_as_business(p_appointment_id uuid, p_note text DEFAULT NULL::text) RETURNS public.appointments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  if not (select private.can_manage_appointments(v_appointment.organization_id)) then
    raise exception 'not authorized to manage this booking' using errcode = '42501';
  end if;

  if v_appointment.status = 'cancelled' then
    return v_appointment;
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be cancelled' using errcode = '22023';
  end if;

  update public.appointments
    set status = 'cancelled',
        resolution = 'cancelled_by_business',
        resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_cancelled', 'customer',
    'Your appointment was cancelled',
    v_appointment.resolution_note, 'booking_cancelled'
  );

  return v_appointment;
end;
$$;


--
-- Name: FUNCTION cancel_appointment_as_business(p_appointment_id uuid, p_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cancel_appointment_as_business(p_appointment_id uuid, p_note text) IS 'Shop-side cancellation of a pending or confirmed appointment. Frees the slot and tells the customer. Mirrors cancel_my_appointment on the customer side rather than reusing it, because the authorization and the resolution differ.';


--
-- Name: cancel_my_appointment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_my_appointment(p_appointment_id uuid) RETURNS public.appointments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_appointment public.appointments;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
    and a.customer_id in (
      select c.id from public.customers c where c.user_id = (select auth.uid())
    )
  for update;

  if not found then
    raise exception 'appointment not found';
  end if;

  if v_appointment.status = 'cancelled' then
    return v_appointment;
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be cancelled';
  end if;

  update public.appointments
    set status = 'cancelled',
        resolution = 'cancelled_by_customer',
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_cancelled', 'business',
    'A customer cancelled',
    v_appointment.customer_name, 'booking_cancelled'
  );

  return v_appointment;
end;
$$;


--
-- Name: FUNCTION cancel_my_appointment(p_appointment_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cancel_my_appointment(p_appointment_id uuid) IS 'Authenticated-only: cancel the caller''s own appointment, only while pending/confirmed. Unchanged authorization; now records resolution=cancelled_by_customer and notifies the shop in the same transaction.';


--
-- Name: cancel_prospect_job(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_prospect_job(p_id uuid) RETURNS public.prospect_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_job public.prospect_jobs;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may cancel a prospect job';
  end if;

  update public.prospect_jobs
  set status = 'cancelled'
  where id = p_id and status in ('queued', 'retry', 'running')
  returning * into v_job;

  if not found then
    raise exception 'job not found or not in a cancellable state';
  end if;

  return v_job;
end;
$$;


--
-- Name: FUNCTION cancel_prospect_job(p_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cancel_prospect_job(p_id uuid) IS 'Platform owner/admin only. Cancels a queued/retry/running job. No-op-safe: raises if the job is already terminal.';


--
-- Name: check_appointment_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_appointment_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'appointments.location_id must belong to the same organization_id';
  end if;

  if not exists (
    select 1 from public.barbers b
    where b.id = new.barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'appointments.barber_id must belong to the same organization_id';
  end if;

  if not exists (
    select 1 from public.services s
    where s.id = new.service_id and s.organization_id = new.organization_id
  ) then
    raise exception 'appointments.service_id must belong to the same organization_id';
  end if;

  if new.chair_id is not null and not exists (
    select 1 from public.chairs c
    where c.id = new.chair_id and c.organization_id = new.organization_id and c.location_id = new.location_id
  ) then
    raise exception 'appointments.chair_id must belong to the same organization_id and location_id';
  end if;

  return new;
end;
$$;


--
-- Name: check_appointment_time_blocks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_appointment_time_blocks() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  -- Cancellations and no-shows release time; they are never blocked.
  if new.status in ('cancelled', 'no_show') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.starts_at = old.starts_at
     and new.ends_at = old.ends_at
     and new.barber_id is not distinct from old.barber_id then
    return new;
  end if;

  if new.barber_id is not null and exists (
    select 1
    from public.time_blocks tb
    where tb.barber_id = new.barber_id
      and tstzrange(new.starts_at, new.ends_at, '[)') && tstzrange(tb.starts_at, tb.ends_at, '[)')
  ) then
    -- Deliberately does not name the reason: this message reaches anonymous
    -- customers, and "Karim is at the dentist" is not theirs to know.
    raise exception 'the professional is unavailable at the requested time'
      using errcode = '22023';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION check_appointment_time_blocks(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.check_appointment_time_blocks() IS 'Rejects a booking overlapping the professional''s blocked time, on every path into the table rather than in each RPC. Skipped when a row''s time and professional are unchanged, so a block laid over an existing appointment never prevents that appointment from being completed or cancelled.';


--
-- Name: check_barber_exception_barber_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_barber_exception_barber_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.barbers b
    where b.id = new.barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'barber_availability_exceptions.barber_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;


--
-- Name: check_barber_service_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_barber_service_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.barbers b
    where b.id = new.barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'barber_services.barber_id must belong to the same organization_id';
  end if;
  if not exists (
    select 1 from public.services s
    where s.id = new.service_id and s.organization_id = new.organization_id
  ) then
    raise exception 'barber_services.service_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;


--
-- Name: check_barber_staff_profile_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_barber_staff_profile_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.staff_profiles sp
    where sp.id = new.staff_profile_id and sp.organization_id = new.organization_id
  ) then
    raise exception 'barbers.staff_profile_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;


--
-- Name: check_barber_working_hours_barber_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_barber_working_hours_barber_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.barbers b
    where b.id = new.barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'barber_working_hours.barber_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;


--
-- Name: check_chair_location_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_chair_location_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'chairs.location_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;


--
-- Name: check_customer_membership_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_customer_membership_consistency() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.customers c where c.id = new.customer_id and c.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization_id as the customer membership';
  end if;

  if not exists (
    select 1 from public.membership_plans p where p.id = new.plan_id and p.organization_id = new.organization_id
  ) then
    raise exception 'plan_id must belong to the same organization_id as the customer membership';
  end if;

  return new;
end;
$$;


--
-- Name: check_invitation_location_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_invitation_location_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.location_id is not null and not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'invitations.location_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;


--
-- Name: check_location_hours_location_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_location_hours_location_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'location_hours.location_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;


--
-- Name: check_location_service_settings_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_location_service_settings_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'location_service_settings.location_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;


--
-- Name: check_queue_entry_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_queue_entry_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'queue_entries.location_id must belong to the same organization_id';
  end if;

  if new.barber_id is not null and not exists (
    select 1 from public.barbers b
    where b.id = new.barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'queue_entries.barber_id must belong to the same organization_id';
  end if;

  if new.service_id is not null and not exists (
    select 1 from public.services s
    where s.id = new.service_id and s.organization_id = new.organization_id
  ) then
    raise exception 'queue_entries.service_id must belong to the same organization_id';
  end if;

  return new;
end;
$$;


--
-- Name: check_service_category_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_service_category_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.service_categories sc
    where sc.id = new.category_id and sc.organization_id = new.organization_id
  ) then
    raise exception 'services.category_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;


--
-- Name: check_service_location_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_service_location_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.services s
    where s.id = new.service_id and s.organization_id = new.organization_id
  ) then
    raise exception 'service_locations.service_id must belong to the same organization_id';
  end if;
  if not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'service_locations.location_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;


--
-- Name: check_service_mode_override_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_service_mode_override_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_barber_location uuid;
begin
  if not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'service_mode_overrides.location_id must belong to the same organization_id';
  end if;

  if new.barber_id is not null then
    -- Same tenant, and actually placed at the establishment the override names.
    -- Without the placement check, a manager could aim a barber-scoped override
    -- at a colleague working in a different salon of the same organization —
    -- which the resolver, reading by (location_id, barber_id), would then never
    -- apply, leaving the author convinced they had changed something.
    select sp.location_id into v_barber_location
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = new.barber_id and b.organization_id = new.organization_id;

    if not found then
      raise exception 'service_mode_overrides.barber_id must belong to the same organization_id';
    end if;

    if v_barber_location is distinct from new.location_id then
      raise exception 'service_mode_overrides.barber_id is not placed at location_id';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: check_staff_profile_location_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_staff_profile_location_consistency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.location_id is not null and not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'staff_profiles.location_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;


--
-- Name: check_time_block_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_time_block_consistency() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.barbers b
    where b.id = new.barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'time_blocks.barber_id must belong to the same organization_id';
  end if;

  if new.location_id is not null and not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'time_blocks.location_id must belong to the same organization_id';
  end if;

  return new;
end;
$$;


--
-- Name: check_waitlist_entry_consistency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_waitlist_entry_consistency() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.locations l where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'location_id must belong to the same organization_id as the waitlist entry';
  end if;

  if new.desired_service_id is not null and not exists (
    select 1 from public.services s where s.id = new.desired_service_id and s.organization_id = new.organization_id
  ) then
    raise exception 'desired_service_id must belong to the same organization_id as the waitlist entry';
  end if;

  if new.desired_barber_id is not null and not exists (
    select 1 from public.barbers b where b.id = new.desired_barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'desired_barber_id must belong to the same organization_id as the waitlist entry';
  end if;

  return new;
end;
$$;


--
-- Name: claim_platform_owner_bootstrap(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_platform_owner_bootstrap(p_token text) RETURNS public.platform_members
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_token_hash text;
  v_token public.platform_owner_bootstrap_tokens;
  v_member public.platform_members;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to claim platform ownership';
  end if;

  if exists (select 1 from public.platform_members where role = 'platform_owner') then
    raise exception 'a platform owner already exists';
  end if;

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_token
  from public.platform_owner_bootstrap_tokens
  where token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'invalid bootstrap token';
  end if;

  if v_token.revoked_at is not null then
    raise exception 'this bootstrap token has been revoked';
  end if;

  if v_token.claimed_at is not null then
    raise exception 'this bootstrap token has already been claimed';
  end if;

  if v_token.expires_at < now() then
    raise exception 'this bootstrap token has expired';
  end if;

  insert into public.platform_members (user_id, role)
  values ((select auth.uid()), 'platform_owner')
  returning * into v_member;

  update public.platform_owner_bootstrap_tokens
  set claimed_at = now(), claimed_by = (select auth.uid())
  where id = v_token.id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_owner_bootstrap_claimed', 'platform_members', (select auth.uid()), jsonb_build_object('bootstrap_token_id', v_token.id));

  return v_member;
end;
$$;


--
-- Name: FUNCTION claim_platform_owner_bootstrap(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.claim_platform_owner_bootstrap(p_token text) IS 'Redeems a bootstrap token for the calling authenticated user: grants platform_owner. Fails if a platform owner already exists or the token is invalid/expired/claimed/revoked.';


--
-- Name: outreach_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    prospect_id uuid NOT NULL,
    state public.outreach_recipient_state DEFAULT 'pending'::public.outreach_recipient_state NOT NULL,
    template_id uuid,
    selection_method text,
    selection_reason jsonb DEFAULT '{}'::jsonb NOT NULL,
    locale text,
    sales_angle text,
    rendered_body text,
    rendered_variables jsonb DEFAULT '{}'::jsonb NOT NULL,
    destination text,
    blocked_reason text,
    experiment_id uuid,
    experiment_arm text,
    ml_prediction_id uuid,
    queued_at timestamp with time zone,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    replied_at timestamp with time zone,
    converted_at timestamp with time zone,
    last_error text,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outreach_recipients_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT outreach_recipients_blocked_has_reason CHECK (((state <> 'blocked'::public.outreach_recipient_state) OR (blocked_reason IS NOT NULL))),
    CONSTRAINT outreach_recipients_locale_check CHECK (((locale IS NULL) OR (locale ~ '^[a-z]{2}-[A-Z]{2}$'::text))),
    CONSTRAINT outreach_recipients_rendered_body_check CHECK (((rendered_body IS NULL) OR (length(rendered_body) <= 4000))),
    CONSTRAINT outreach_recipients_requires_template CHECK (((state = ANY (ARRAY['pending'::public.outreach_recipient_state, 'blocked'::public.outreach_recipient_state])) OR ((template_id IS NOT NULL) AND (rendered_body IS NOT NULL)))),
    CONSTRAINT outreach_recipients_selection_method_check CHECK ((selection_method = ANY (ARRAY['rule'::text, 'ml'::text, 'experiment'::text, 'manual'::text])))
);

ALTER TABLE ONLY public.outreach_recipients FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE outreach_recipients; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.outreach_recipients IS 'One prospect within one campaign. UNIQUE (campaign_id, prospect_id) is the duplicate-send guard; outreach_recipients_requires_template guarantees no message exists without an approved template; the eligibility trigger below blocks ineligible/suppressed/converted prospects before they can be queued.';


--
-- Name: classify_outreach_reply(uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.classify_outreach_reply(p_recipient_id uuid, p_positive boolean, p_note text DEFAULT NULL::text) RETURNS public.outreach_recipients
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_recipient public.outreach_recipients;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'classify_outreach_reply: platform admin role required' using errcode = '42501';
  end if;

  select * into v_recipient from public.outreach_recipients where id = p_recipient_id;
  if not found then
    raise exception 'classify_outreach_reply: recipient % not found', p_recipient_id;
  end if;

  if v_recipient.state not in ('replied', 'positive_reply', 'negative_reply') then
    raise exception 'classify_outreach_reply: recipient % is % — only a replied recipient can be classified',
      p_recipient_id, v_recipient.state using errcode = 'check_violation';
  end if;

  update public.outreach_recipients
  set state = case when p_positive then 'positive_reply'::public.outreach_recipient_state
                   else 'negative_reply'::public.outreach_recipient_state end
  where id = p_recipient_id
  returning * into v_recipient;

  insert into public.outreach_events (recipient_id, prospect_id, event_type, classified_by, metadata)
  values (
    p_recipient_id,
    v_recipient.prospect_id,
    case when p_positive then 'positive_reply'::public.outreach_event_type
         else 'negative_reply'::public.outreach_event_type end,
    (select auth.uid()),
    jsonb_build_object('note', p_note)
  );

  return v_recipient;
end;
$$;


--
-- Name: clear_service_mode_temporary_override(public.service_mode_scope, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clear_service_mode_temporary_override(p_scope public.service_mode_scope, p_location_id uuid, p_barber_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_organization_id uuid;
  v_now timestamptz := now();
  v_actor uuid := (select auth.uid());
  v_cleared integer;
begin
  if p_scope is null then
    raise exception 'scope is required' using errcode = '22023';
  end if;

  if (p_scope = 'barber') <> (p_barber_id is not null) then
    raise exception 'barber scope requires a barber, location scope forbids one'
      using errcode = '22023';
  end if;

  v_organization_id := private.assert_service_mode_authority(
    p_location_id, p_barber_id, false
  );

  perform private.ensure_location_service_settings(p_location_id);

  perform 1 from public.location_service_settings s
  where s.location_id = p_location_id
  for update;

  update public.service_mode_overrides o
     set cleared_at = v_now,
         cleared_by_user_id = v_actor
   where o.cleared_at is null
     and o.scope = p_scope
     and (
       (p_scope = 'location' and o.location_id = p_location_id)
       or (p_scope = 'barber' and o.barber_id = p_barber_id)
     );

  get diagnostics v_cleared = row_count;

  -- Nothing to clear is a legitimate outcome, not an error: the override may
  -- have expired naturally a minute ago, and a Pro tapping "back to normal" on
  -- a slightly stale screen should get the state they asked for, not a failure.
  -- No history row is written in that case — nothing changed.
  if v_cleared > 0 then
    insert into public.service_mode_changes (
      organization_id, change_kind, scope, location_id, barber_id,
      changed_by_user_id
    ) values (
      v_organization_id, 'temporary_override_cleared', p_scope, p_location_id, p_barber_id,
      v_actor
    );
  end if;

  return v_cleared;
end;
$$;


--
-- Name: FUNCTION clear_service_mode_temporary_override(p_scope public.service_mode_scope, p_location_id uuid, p_barber_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.clear_service_mode_temporary_override(p_scope public.service_mode_scope, p_location_id uuid, p_barber_id uuid) IS 'Clears the active temporary override on one target, returning the effective mode to the next precedence level (barber persistent override, then establishment default). Returns the number of rows cleared; zero is a legitimate outcome — the override may have expired naturally — and is not an error, because a Pro tapping "back to normal" on a stale screen should get the state they asked for. Rows are marked cleared, never deleted, so the history survives.';


--
-- Name: complete_appointment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_appointment(p_appointment_id uuid) RETURNS public.appointments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  -- Front-of-house, or the barber whose appointment it is: marking your own
  -- client done from the chair is the whole point of Chair Mode.
  if not (
    (select private.can_manage_appointments(v_appointment.organization_id))
    or (select private.is_own_barber(v_appointment.barber_id))
  ) then
    raise exception 'not authorized to manage this appointment' using errcode = '42501';
  end if;

  if v_appointment.status = 'completed' then
    return v_appointment;
  end if;

  if v_appointment.status <> 'confirmed' then
    raise exception 'only a confirmed appointment can be completed' using errcode = '22023';
  end if;

  update public.appointments
    set status = 'completed', decided_at = now(), decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  return v_appointment;
end;
$$;


--
-- Name: FUNCTION complete_appointment(p_appointment_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.complete_appointment(p_appointment_id uuid) IS 'Marks a confirmed appointment completed. Row-locked, state-guarded and idempotent, so the raw status PATCH that allowed completed -> pending is no longer the only path. Emits no notification: the customer was there, and telling them what they just experienced is noise.';


--
-- Name: complete_onboarding(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_onboarding(p_organization_id uuid, p_publish boolean DEFAULT false) RETURNS TABLE(ready_to_book boolean, ready_to_publish boolean, is_published boolean, missing_requirements text[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  r record;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may complete onboarding'
      using errcode = '42501';
  end if;

  select * into r from public.get_organization_readiness(p_organization_id);

  if r.ready_to_book then
    update public.organizations
      set onboarding_completed_at = coalesce(onboarding_completed_at, now())
      where id = p_organization_id;
  end if;

  -- Publishing goes through the same column the gate trigger watches, so an
  -- unready organization raises here exactly as it would from anywhere else.
  if p_publish and r.ready_to_publish then
    update public.organizations set marketplace_visible = true where id = p_organization_id;
  end if;

  select * into r from public.get_organization_readiness(p_organization_id);
  return query select r.ready_to_book, r.ready_to_publish, r.is_published, r.missing_requirements;
end;
$$;


--
-- Name: FUNCTION complete_onboarding(p_organization_id uuid, p_publish boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.complete_onboarding(p_organization_id uuid, p_publish boolean) IS 'Stamps onboarding_completed_at once the organization is genuinely bookable, and optionally publishes it when it is genuinely publishable. Never forces either: an incomplete organization gets its honest readiness report back instead of a stamp it has not earned.';


--
-- Name: complete_organization_onboarding(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_organization_onboarding(p_org_name text, p_org_slug text, p_location_name text, p_timezone text DEFAULT 'UTC'::text) RETURNS TABLE(organization_id uuid, organization_name text, organization_slug text, location_id uuid, location_name text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org public.organizations;
  v_location public.locations;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to create an organization';
  end if;

  select * into v_org from public.create_organization(p_org_name, p_org_slug);

  insert into public.locations (organization_id, name, timezone)
  values (v_org.id, p_location_name, p_timezone)
  returning * into v_location;

  return query select v_org.id, v_org.name, v_org.slug, v_location.id, v_location.name;
end;
$$;


--
-- Name: FUNCTION complete_organization_onboarding(p_org_name text, p_org_slug text, p_location_name text, p_timezone text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.complete_organization_onboarding(p_org_name text, p_org_slug text, p_location_name text, p_timezone text) IS 'Atomic onboarding bootstrap: creates an organization (caller becomes owner via the existing trigger) and its first location in one transaction. Client code should call this instead of separate organization/location inserts.';


--
-- Name: confirm_booking_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_booking_request(p_appointment_id uuid) RETURNS public.appointments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  if not (select private.can_manage_appointments(v_appointment.organization_id)) then
    raise exception 'not authorized to manage this booking' using errcode = '42501';
  end if;

  -- Idempotent: whoever lost the race gets the settled row, not an error and
  -- not a second confirmation.
  if v_appointment.status = 'confirmed' then
    return v_appointment;
  end if;

  if v_appointment.status <> 'pending' then
    raise exception 'this request has already been answered' using errcode = '22023';
  end if;

  -- The accept-versus-expire race. The row is locked, so the sweep is either
  -- already done (status is no longer pending, caught above) or is waiting
  -- behind this lock and will find the row confirmed. This check closes the
  -- remaining case: the deadline passed but the sweep has not run yet.
  if v_appointment.expires_at is not null and v_appointment.expires_at <= now() then
    raise exception 'this request has expired' using errcode = '22023';
  end if;

  update public.appointments
    set status = 'confirmed',
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_confirmed', 'customer',
    'Your appointment is confirmed',
    null, 'booking_confirmed'
  );

  return v_appointment;
end;
$$;


--
-- Name: FUNCTION confirm_booking_request(p_appointment_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.confirm_booking_request(p_appointment_id uuid) IS 'Accepts a pending booking request. Owner/manager/receptionist of that organization only. Row-locked and state-guarded, so concurrent accepts settle on one outcome and a second accept is a harmless no-op. Refuses an expired request even if the sweep has not reached it yet.';


--
-- Name: create_external_professional(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_external_professional(p_prospect_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_existing uuid;
  v_name text;
  v_professional_id uuid;
begin
  -- TWO conditions for the worker arm, and both are load-bearing.
  --
  -- session_user, NOT current_user: inside a SECURITY DEFINER function
  -- current_user is the function OWNER (postgres), so testing it would let
  -- every caller through. session_user is the role that actually connected —
  -- 'prospect_worker' for the worker's own connection, 'authenticator' for
  -- anything arriving through PostgREST, which R1A confirmed is not a member
  -- of prospect_worker so no JWT can reach it.
  --
  -- auth.uid() IS NULL because the worker holds no JWT. Without this clause a
  -- superuser session that has merely SET ROLE to authenticated would satisfy
  -- pg_has_role(session_user, 'prospect_worker', ...) — superusers are
  -- implicitly members of every role — and an equality test alone would leave
  -- the check unverifiable from any test harness. Requiring the absence of a
  -- session as well makes it both stricter and testable.
  if not (
    (select private.is_platform_admin())
    or ((select auth.uid()) is null and session_user = 'prospect_worker')
  ) then
    raise exception 'only FadeUp platform staff or the acquisition worker can create external profiles'
      using errcode = '42501';
  end if;

  -- Idempotent per prospect. Checked first AND enforced by the unique
  -- constraint below, because a concurrent second job must lose on the index
  -- rather than on this read.
  select pp.professional_id into v_existing
  from public.prospect_professionals pp
  where pp.prospect_id = p_prospect_id;

  if v_existing is not null then
    return v_existing;
  end if;

  select p.canonical_name into v_name
  from public.prospects p
  where p.id = p_prospect_id;

  if v_name is null then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  insert into public.professionals (claim_state, display_name, source, is_public)
  values ('unclaimed', v_name, 'acquisition', false)
  returning id into v_professional_id;

  begin
    insert into public.prospect_professionals (prospect_id, professional_id)
    values (p_prospect_id, v_professional_id);
  exception when unique_violation then
    -- A concurrent job won. Fail the whole statement rather than return a
    -- second identity for the same real business: the caller retries into the
    -- idempotent branch above and receives the winner's identity.
    raise exception 'external profile for this prospect is already being created; retry'
      using errcode = '40001';
  end;

  return v_professional_id;
end;
$$;


--
-- Name: FUNCTION create_external_professional(p_prospect_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_external_professional(p_prospect_id uuid) IS 'Platform-staff or acquisition-worker only. Mints ONE unclaimed professional identity per canonical prospect, idempotently, with structurally safe defaults: unclaimed, NOT public (publication is a separate, audited decision — publish_external_professional), no barbers row (so no availability, queue, schedule or appointment can be implied), and a display name copied from the prospect rather than supplied by the caller. Serialises against a concurrent second job on the unique index, returning 40001 so the caller retries into the idempotent branch.';


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    marketplace_visible boolean DEFAULT false NOT NULL,
    business_type public.business_type,
    currency text,
    country_code text,
    onboarding_completed_at timestamp with time zone,
    booking_request_ttl_minutes integer DEFAULT 1440 NOT NULL,
    CONSTRAINT organizations_booking_ttl_sane CHECK (((booking_request_ttl_minutes >= 15) AND (booking_request_ttl_minutes <= 20160))),
    CONSTRAINT organizations_country_code_format CHECK (((country_code IS NULL) OR (country_code ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT organizations_currency_format CHECK (((currency IS NULL) OR (currency ~ '^[A-Z]{3}$'::text))),
    CONSTRAINT organizations_name_not_blank CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT organizations_slug_format CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);

ALTER TABLE ONLY public.organizations FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE organizations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organizations IS 'Tenant root. Every business resource must have a provable ownership path to a row here. NO client-facing INSERT path exists: the INSERT grant is revoked from anon/authenticated and there is deliberately no INSERT policy. Organizations are created exclusively by create_organization() (self-serve, refuses pending/rejected applicants) and review_professional_application() (platform approval), both SECURITY DEFINER, both of which set fadeup.org_creation_authorized for the guard trigger below.';


--
-- Name: COLUMN organizations.marketplace_visible; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.marketplace_visible IS 'Explicit opt-in: this organization is discoverable via the public marketplace search (search_public_organizations). Default false — existing an org is not enough, an owner/platform staff must publish it. Distinct from staff_profiles.is_public, which gates one barber''s page once the org slug is already known.';


--
-- Name: COLUMN organizations.business_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.business_type IS 'solo_professional | barbershop | hair_salon | mixed_salon | multi_location. Set during onboarding, editable afterwards. Drives which onboarding steps apply and which starter-service template is offered.';


--
-- Name: COLUMN organizations.currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.currency IS 'ISO 4217 code for every price this organization quotes. NULL means not chosen yet — readiness treats that as incomplete rather than assuming a currency.';


--
-- Name: COLUMN organizations.country_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.country_code IS 'ISO 3166-1 alpha-2. Used only to SUGGEST a currency and timezone; an explicit choice always wins.';


--
-- Name: COLUMN organizations.onboarding_completed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.onboarding_completed_at IS 'When the owner finished the onboarding wizard. Advisory/analytics only — routing and publication both use get_organization_readiness(), which reads real persisted state, so a stamped-but-incomplete organization still cannot publish.';


--
-- Name: COLUMN organizations.booking_request_ttl_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.booking_request_ttl_minutes IS 'How long a booking request waits for an answer before expiring and releasing the slot. Default 1440 (24h); floor 15 minutes, ceiling 14 days. THE authoritative policy — the trigger reads it, the client only ever reads the resulting expires_at.';


--
-- Name: create_organization(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_organization(p_name text, p_slug text) RETURNS public.organizations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org public.organizations;
  v_status public.professional_application_status;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to create an organization';
  end if;

  select a.status into v_status
    from public.professional_applications a
    where a.user_id = (select auth.uid())
    order by a.submitted_at desc
    limit 1;

  if v_status = 'pending_review' then
    raise exception 'your professional application is still being reviewed';
  elsif v_status = 'rejected' then
    raise exception 'your professional application was not approved';
  end if;

  -- Transaction-local, and cleared immediately after the insert so a later
  -- statement in the same transaction cannot ride on it.
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  insert into public.organizations (name, slug)
  values (p_name, p_slug)
  returning * into v_org;
  perform set_config('fadeup.org_creation_authorized', 'off', true);

  -- on_organization_created (AFTER INSERT trigger on public.organizations)
  -- has already run by this point, making the caller the org's owner.
  return v_org;
end;
$$;


--
-- Name: FUNCTION create_organization(p_name text, p_slug text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_organization(p_name text, p_slug text) IS 'The only self-serve path that creates an organization. Owned by the calling user via on_organization_created. Refuses callers whose most recent professional application is pending or rejected — otherwise an applicant could self-activate and bypass platform review. Raises fadeup.org_creation_authorized for the BEFORE INSERT guard trigger; the table itself grants no client INSERT.';


--
-- Name: create_passport_share(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_passport_share(p_label text DEFAULT NULL::text, p_ttl_hours integer DEFAULT 168) RETURNS TABLE(share_id uuid, token text, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
  v_ttl integer;
  v_expires_at timestamptz;
  v_raw_token text;
  v_share_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'create_passport_share requires an authenticated session';
  end if;

  if not exists (select 1 from public.customer_passports where user_id = v_user_id) then
    raise exception 'create a Fade Passport before sharing it';
  end if;

  -- Clamp to [1 hour, 30 days] — always time-limited, never accidentally unbounded.
  v_ttl := least(greatest(coalesce(p_ttl_hours, 168), 1), 720);
  v_expires_at := now() + (v_ttl || ' hours')::interval;
  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.customer_passport_shares (user_id, token_hash, label, expires_at)
  values (v_user_id, encode(extensions.digest(v_raw_token, 'sha256'), 'hex'), nullif(btrim(coalesce(p_label, '')), ''), v_expires_at)
  returning id into v_share_id;

  return query select v_share_id, v_raw_token, v_expires_at;
end;
$$;


--
-- Name: FUNCTION create_passport_share(p_label text, p_ttl_hours integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_passport_share(p_label text, p_ttl_hours integer) IS 'Authenticated-only. Creates a revocable, time-limited (1h-30d, clamped) share link for the caller''s own Fade Passport. Returns the raw token exactly once — only its sha256 hash is ever persisted.';


--
-- Name: create_platform_invitation(public.platform_role, text, interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_platform_invitation(p_role public.platform_role, p_invited_email text DEFAULT NULL::text, p_expires_in interval DEFAULT '7 days'::interval) RETURNS TABLE(id uuid, raw_token text, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_raw_token text;
  v_id uuid;
  v_expires_at timestamptz;
  v_is_owner boolean;
begin
  if p_role = 'platform_owner' then
    raise exception 'platform_owner cannot be granted through an invitation';
  end if;

  v_is_owner := (select private.is_platform_owner());

  if p_role = 'platform_admin' and not v_is_owner then
    raise exception 'only a platform owner may invite a platform_admin';
  end if;

  if p_role = 'platform_support' and not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may invite platform_support';
  end if;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + p_expires_in;

  insert into public.platform_invitations (token_hash, role, invited_email, invited_by, expires_at)
  values (
    encode(extensions.digest(v_raw_token, 'sha256'), 'hex'),
    p_role,
    nullif(lower(btrim(p_invited_email)), ''),
    (select auth.uid()),
    v_expires_at
  )
  returning platform_invitations.id into v_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_invitation_created', 'platform_invitations', v_id, jsonb_build_object('role', p_role));

  return query select v_id, v_raw_token, v_expires_at;
end;
$$;


--
-- Name: FUNCTION create_platform_invitation(p_role public.platform_role, p_invited_email text, p_expires_in interval); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_platform_invitation(p_role public.platform_role, p_invited_email text, p_expires_in interval) IS 'Creates a platform_admin/platform_support invitation and returns the raw token once. platform_admin invites require platform_owner; platform_support invites require platform_owner or platform_admin.';


--
-- Name: create_prospect_discovery_job(text, jsonb, text[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_prospect_discovery_job(p_job_type text, p_payload jsonb, p_source_keys text[] DEFAULT NULL::text[], p_priority integer DEFAULT 100) RETURNS public.prospect_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_job public.prospect_jobs;
  v_source record;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may create a prospect job';
  end if;

  if p_job_type not in ('discovery', 'enrichment', 'dedup_scan', 'scoring', 'website_crawl', 'instagram_enrich') then
    raise exception 'invalid job_type: %', p_job_type;
  end if;

  insert into public.prospect_jobs (job_type, payload, priority, created_by)
  values (p_job_type, coalesce(p_payload, '{}'::jsonb), coalesce(p_priority, 100), (select auth.uid()))
  returning * into v_job;

  for v_source in
    select id, is_enabled from public.prospect_sources
    where p_source_keys is null or key = any (p_source_keys)
  loop
    insert into public.prospect_job_sources (job_id, source_id, status)
    values (v_job.id, v_source.id, (case when v_source.is_enabled then 'pending' else 'skipped' end)::public.prospect_job_source_status);
  end loop;

  return v_job;
end;
$$;


--
-- Name: FUNCTION create_prospect_discovery_job(p_job_type text, p_payload jsonb, p_source_keys text[], p_priority integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_prospect_discovery_job(p_job_type text, p_payload jsonb, p_source_keys text[], p_priority integer) IS 'Platform owner/admin only. Enqueues a prospect_jobs row and one prospect_job_sources row per requested (or all, if p_source_keys is null) source — disabled sources are recorded as skipped, not omitted, so the UI can show why a source did not run.';


--
-- Name: customer_profiles_issue_passport(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customer_profiles_issue_passport() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.ensure_customer_passport(new.user_id);
  return null;
end;
$$;


--
-- Name: FUNCTION customer_profiles_issue_passport(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.customer_profiles_issue_passport() IS 'AFTER INSERT on customer_profiles. Becoming a FadeUp customer IS having a Fade Passport (Constitution §2.2) — there is no "Get Passport" action to take, and no state in which a registered customer is missing one.';


--
-- Name: decline_booking_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decline_booking_request(p_appointment_id uuid, p_note text DEFAULT NULL::text) RETURNS public.appointments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  if not (select private.can_manage_appointments(v_appointment.organization_id)) then
    raise exception 'not authorized to manage this booking' using errcode = '42501';
  end if;

  if v_appointment.status = 'cancelled' and v_appointment.resolution = 'declined' then
    return v_appointment;
  end if;

  if v_appointment.status <> 'pending' then
    raise exception 'this request has already been answered' using errcode = '22023';
  end if;

  -- status=cancelled is what frees the slot, through the untouched exclusion
  -- predicate. resolution is what lets the customer's screen say "not
  -- accepted" instead of "cancelled".
  update public.appointments
    set status = 'cancelled',
        resolution = 'declined',
        resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_declined', 'customer',
    'Your booking request was not accepted',
    v_appointment.resolution_note, 'booking_declined'
  );

  return v_appointment;
end;
$$;


--
-- Name: FUNCTION decline_booking_request(p_appointment_id uuid, p_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.decline_booking_request(p_appointment_id uuid, p_note text) IS 'Declines a pending booking request and frees the slot. The optional note is shown to the customer, so it is length-checked and never required.';


--
-- Name: platform_support_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_support_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform_actor_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    target_type text NOT NULL,
    target_user_id uuid,
    reason text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT platform_support_sessions_target_type_valid CHECK ((target_type = ANY (ARRAY['organization'::text, 'barber'::text])))
);

ALTER TABLE ONLY public.platform_support_sessions FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE platform_support_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.platform_support_sessions IS 'Explicit, audited "viewing organization X for support" context — drives the persistent support-view banner. Does not itself grant any read access beyond what is_platform_admin() already has; see this migration''s header.';


--
-- Name: end_platform_support_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.end_platform_support_session(p_id uuid) RETURNS public.platform_support_sessions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_session public.platform_support_sessions;
begin
  update public.platform_support_sessions
  set ended_at = now()
  where id = p_id and platform_actor_id = (select auth.uid()) and ended_at is null
  returning * into v_session;

  if not found then
    raise exception 'support session not found, not yours, or already ended';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_support_session_ended', 'organizations', v_session.organization_id, jsonb_build_object('session_id', v_session.id));

  return v_session;
end;
$$;


--
-- Name: FUNCTION end_platform_support_session(p_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.end_platform_support_session(p_id uuid) IS 'Ends the caller''s own support-view session. Cannot end another actor''s session.';


--
-- Name: enforce_appointment_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_appointment_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_from public.appointment_status := old.status;
  v_to   public.appointment_status := new.status;
  v_is_reschedule boolean;
begin
  -- Not a status change: this guard has no opinion. Column-level rules live in
  -- restrict_appointment_self_update, deliberately separate.
  if v_from is not distinct from v_to then
    return new;
  end if;

  -- Terminal states are business records. Nothing moves them, no role exempt.
  if v_from in ('completed', 'cancelled', 'no_show') then
    raise exception 'appointment is already % and cannot change state', v_from
      using errcode = '22023';
  end if;

  -- The one caller-dependent edge. reschedule_appointment sets this
  -- transaction-local flag for exactly its own UPDATE — the same mechanism the
  -- existing LOT 11 column guard already relies on — and a CUSTOMER move
  -- re-opens the shop's decision by returning the row to pending.
  v_is_reschedule := coalesce(current_setting('fadeup.appointment_reschedule', true), '') = 'on';

  if v_from = 'confirmed' and v_to = 'pending' then
    if not v_is_reschedule then
      raise exception 'a confirmed appointment can only return to pending through a customer reschedule'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if not (
    (v_from = 'pending'   and v_to in ('confirmed', 'cancelled'))
    or (v_from = 'confirmed' and v_to in ('completed', 'cancelled', 'no_show'))
  ) then
    raise exception 'illegal appointment transition % -> %', v_from, v_to
      using errcode = '22023';
  end if;

  -- Stamp completion here, so status and completed_at can never disagree and no
  -- caller supplies a completion time of their choosing. A pre-existing value
  -- is preserved so a re-run cannot rewrite history.
  if v_to = 'completed' then
    new.completed_at := coalesce(old.completed_at, now());
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION enforce_appointment_transition(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_appointment_transition() IS 'BEFORE UPDATE invariant on appointments.status. Enforces the transition matrix in docs/v2/R1A_TRANSITION_MATRIX.md for EVERY caller, with no role exemption — deliberately NOT part of restrict_appointment_self_update(), which exempts owner/manager/receptionist and would have passed that exemption on. Also stamps completed_at, so completion time is server-authoritative.';


--
-- Name: enforce_barber_capacity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_barber_capacity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_active boolean;
begin
  if tg_op = 'UPDATE' and new.organization_id = old.organization_id then
    return new;
  end if;

  -- A roster placement whose staff profile is inactive is not operational and
  -- consumes nothing. Reactivating that profile comes back through the
  -- staff_profiles trigger below.
  select sp.is_active into v_active
  from public.staff_profiles sp
  where sp.id = new.staff_profile_id;

  if coalesce(v_active, false) then
    perform private.assert_professional_capacity(new.organization_id);
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION enforce_barber_capacity(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_barber_capacity() IS 'Applies the plan professional cap when a professional is added to a roster, or moved between organizations. Fires for every writer including service_role and postgres — an invitation flow, an onboarding RPC and a raw INSERT are all the same commercial event.';


--
-- Name: enforce_booking_service_mode(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_booking_service_mode() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_mode public.service_mode;
  v_source text;
begin
  perform private.ensure_location_service_settings(new.location_id);

  -- THE LOCK. Shared, taken before the mode is read, released at commit.
  perform 1
  from public.location_service_settings s
  where s.location_id = new.location_id
  for share;

  -- The commercial question first, and through R2's own helper — this file
  -- adds no commercial logic and knows no plan names.
  perform private.assert_org_capability(new.organization_id, 'booking');

  select m.mode, m.source into v_mode, v_source
  from private.effective_service_mode(new.location_id, new.barber_id) m;

  if v_mode is null or not private.mode_allows_booking(v_mode) then
    -- The message names the mode and where it came from, so a professional who
    -- has forgotten they set a one-hour override an hour ago is told exactly
    -- that, rather than being handed a generic refusal. It deliberately carries
    -- no organization or location id: error strings end up in logs a wider
    -- audience reads.
    raise exception 'new reservations are not being accepted (service mode: %)',
      coalesce(v_mode::text, 'unknown')
      using errcode = '42501',
            hint = format(
              'The effective service mode comes from %s. Existing appointments are unaffected.',
              coalesce(v_source, 'no configured establishment')
            );
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION enforce_booking_service_mode(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_booking_service_mode() IS 'BEFORE INSERT on appointments: the ONE place a new reservation is admitted or refused. Fires for every writer — the anon RPC, a direct PostgREST insert by staff, service_role and postgres alike — because RLS would exempt the privileged ones. Composes the R2 booking entitlement with the effective service mode; adds no commercial logic of its own. INSERT only, deliberately: every existing appointment keeps its full R1A lifecycle in every mode, and reschedule_appointment UPDATEs rather than inserting, so it neither reaches this trigger nor needs a bypass flag.';


--
-- Name: enforce_commercial_state_integrity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_commercial_state_integrity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_new_max_est integer;
  v_old_max_est integer;
  v_new_max_pro integer;
  v_old_max_pro integer;
  v_used_est integer;
  v_used_pro integer;
begin
  -- A status change, a note, a provider reference: none of these are capacity
  -- events. Only a change of plan is.
  if new.plan_key = old.plan_key then
    return new;
  end if;

  select p.max_establishments, p.max_operational_professionals
    into v_new_max_est, v_new_max_pro
  from public.commercial_plans p where p.plan_key = new.plan_key;

  select p.max_establishments, p.max_operational_professionals
    into v_old_max_est, v_old_max_pro
  from public.commercial_plans p where p.plan_key = old.plan_key;

  if v_new_max_est is null then
    raise exception 'unknown plan %', new.plan_key using errcode = 'P0001';
  end if;

  v_used_est := private.org_active_establishments(new.organization_id);
  v_used_pro := private.org_active_professionals(new.organization_id);

  -- Establishments. `v_new_max_est < v_old_max_est` is the "this is a
  -- downgrade" test; an upgrade or a sideways move is never blocked, even for
  -- an organization that is already over capacity.
  if v_used_est > v_new_max_est and v_new_max_est < v_old_max_est then
    raise exception
      'cannot move to %: it covers % establishment(s) and this organization operates %',
      new.plan_key, v_new_max_est, v_used_est
      using errcode = 'P0001',
            hint = 'Deactivate the establishments no longer in use first. FadeUp never deletes or deactivates an establishment to satisfy a plan change.';
  end if;

  -- Professionals. NULL on either side means unlimited, so a move TO unlimited
  -- is never a downgrade and a move FROM unlimited to a number is always one.
  if v_new_max_pro is not null
     and v_used_pro > v_new_max_pro
     and (v_old_max_pro is null or v_new_max_pro < v_old_max_pro) then
    raise exception
      'cannot move to %: it covers % operational professional(s) and this organization rosters %',
      new.plan_key, v_new_max_pro, v_used_pro
      using errcode = 'P0001',
            hint = 'Offboard the professionals no longer working here first. Offboarding preserves their identity, their followers and their appointment history — FadeUp never deletes a professional to satisfy a plan change.';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION enforce_commercial_state_integrity(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_commercial_state_integrity() IS 'Refuses a plan change that would leave an organization over capacity, for EVERY writer including postgres and service_role — so a downgrade can never quietly imply that data should be removed to fit. Only a change of plan_key is a capacity event: a status change (including cancellation) is always permitted, because an organization that stopped paying must remain cancellable and cancelling deletes nothing. INSERT is exempt so the documented over-capacity backfill state stays recordable, and an already-over-capacity organization can still be moved to a better plan.';


--
-- Name: enforce_establishment_capacity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_establishment_capacity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_plan text;
  v_max integer;
  v_used integer;
begin
  -- An inactive location consumes no capacity, so creating one is always
  -- allowed. It also cannot be a bypass: switching it on later comes back
  -- through this same trigger on UPDATE.
  if not new.is_active then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Only two kinds of UPDATE are capacity events: switching a location back
    -- on, and moving it to a different organization (which no code path does,
    -- but an unchecked one would be a way to smuggle capacity between tenants).
    if old.is_active and new.organization_id = old.organization_id then
      return new;
    end if;
  end if;

  -- Guarantee the row that is about to be locked exists. In every normal path
  -- it already does — organizations get commercial state on insert and the R2
  -- backfill covered the rest — so this is the safety net for a restore or a
  -- future code path, and it creates the most restrictive plan, never a
  -- permissive one.
  perform private.ensure_organization_commercial_state(new.organization_id);

  -- THE MUTEX. Everything after this line is serialised per organization.
  perform 1
  from public.organization_commercial_state s
  where s.organization_id = new.organization_id
  for update;

  v_plan := private.effective_plan_key(new.organization_id);

  select p.max_establishments into v_max
  from public.commercial_plans p
  where p.plan_key = v_plan;

  if v_max is null then
    -- No commercial state, or a plan that is not in the catalogue. Fail closed:
    -- an unresolvable plan must never be read as "unlimited".
    raise exception 'cannot create an establishment: the organization has no resolvable commercial plan'
      using errcode = 'P0001',
            hint = 'Every organization must have a row in organization_commercial_state naming a plan that exists in commercial_plans.';
  end if;

  -- The row being inserted (or reactivated) is not yet part of this count: on
  -- INSERT it does not exist, and on the reactivation path it is still
  -- is_active = false in the table. So the question is always "does one more
  -- fit".
  v_used := private.org_active_establishments(new.organization_id);

  if v_used + 1 > v_max then
    raise exception
      'the % plan covers % active establishment(s); this organization already operates %',
      v_plan, v_max, v_used
      using errcode = 'P0001',
            hint = 'Move to a Multi-salons plan to operate more establishments. Existing establishments are never removed to satisfy a plan.';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION enforce_establishment_capacity(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_establishment_capacity() IS 'Enforces the plan establishment cap on public.locations for EVERY writer — PostgREST, RPCs, service_role and postgres alike — because a commercial limit that only holds for the browser is not a limit. Race-free: it takes SELECT ... FOR UPDATE on the organization''s single commercial-state row before counting, so two concurrent "add location" requests cannot both pass on the same stale count. Only ACTIVE locations count, so deactivating one frees capacity — that is the non-destructive route back into compliance, and it is why reactivation is checked here too.';


--
-- Name: enforce_professional_claim_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_professional_claim_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.professional_id is distinct from old.professional_id
     or new.claimant_user_id is distinct from old.claimant_user_id then
    raise exception 'a claim cannot be repointed at a different identity or claimant'
      using errcode = '42501';
  end if;

  if new.state is not distinct from old.state then
    return new;
  end if;

  if old.state <> 'pending' then
    raise exception 'claim is already % and cannot change state', old.state
      using errcode = '22023';
  end if;

  if new.state not in ('approved', 'rejected', 'withdrawn') then
    raise exception 'illegal claim transition % -> %', old.state, new.state
      using errcode = '22023';
  end if;

  -- Decision time is server-owned, so a caller cannot backdate a review.
  new.decided_at := coalesce(new.decided_at, now());
  return new;
end;
$$;


--
-- Name: FUNCTION enforce_professional_claim_transition(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_professional_claim_transition() IS 'BEFORE UPDATE invariant on professional_claims. pending is the only state with outgoing edges, and no role is exempt — including service_role, matching how R1A guards appointment transitions. Also freezes the claim''s identity and stamps decided_at server-side.';


--
-- Name: enforce_prospect_publication_gate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_prospect_publication_gate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_reason text;
begin
  if tg_op = 'UPDATE' then
    -- Provenance is evidence (R1B's own words on the RESTRICT further down
    -- this table). Repointing a link would silently reattribute an identity to
    -- a business it was never discovered from, and would do it without ever
    -- passing the gate, since the gate only guards INSERT.
    if new.prospect_id is distinct from old.prospect_id
       or new.professional_id is distinct from old.professional_id then
      raise exception 'a prospect-to-identity link cannot be repointed'
        using errcode = '42501';
    end if;
    return new;
  end if;

  v_reason := public.publication_block_reason(new.prospect_id);

  if v_reason is not null then
    raise exception 'prospect is not eligible for publication: %', v_reason
      using errcode = '42501',
            hint = 'Resolve the blocking condition rather than bypassing the gate; see public.publication_block_reason.';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION enforce_prospect_publication_gate(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_prospect_publication_gate() IS 'BEFORE INSERT OR UPDATE invariant on prospect_professionals, and the structural half of Constitution §5.5. Every path that could mint an external professional identity passes through this INSERT, so the gate cannot be bypassed by choosing a different function, a different role or a direct session — there is no role exemption, including for platform administrators and service_role. On UPDATE it freezes the link''s two endpoints, so provenance cannot be reattributed after the fact.';


--
-- Name: enforce_queue_service_mode(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_queue_service_mode() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_mode public.service_mode;
  v_source text;
  v_queue_open boolean;
begin
  perform private.ensure_location_service_settings(new.location_id);

  select s.queue_open into v_queue_open
  from public.location_service_settings s
  where s.location_id = new.location_id
  for share;

  -- walkIns OR liveQueue — see 20260826120300 for why this is a disjunction:
  -- R2 sells salon_essential walkIns without liveQueue, and demanding liveQueue
  -- would withdraw a channel that plan pays for, which would be a pricing
  -- change this lot is forbidden to make.
  if not (
    private.org_has_capability(new.organization_id, 'walkIns')
    or private.org_has_capability(new.organization_id, 'liveQueue')
  ) then
    -- Raised through R2's own assert so the message and SQLSTATE match every
    -- other entitlement refusal in the product.
    perform private.assert_org_capability(new.organization_id, 'liveQueue');
  end if;

  select m.mode, m.source into v_mode, v_source
  from private.effective_service_mode(new.location_id, new.barber_id) m;

  if v_mode is null or not private.mode_allows_queue(v_mode) then
    raise exception 'new queue entries are not being accepted (service mode: %)',
      coalesce(v_mode::text, 'unknown')
      using errcode = '42501',
            hint = format(
              'The effective service mode comes from %s. Customers already in the queue are unaffected.',
              coalesce(v_source, 'no configured establishment')
            );
  end if;

  -- Reported separately from the mode, because it is a separate fact with a
  -- separate control and a separate fix. Service mode never replaces
  -- queue_open, and this is where that distinction becomes visible to a human.
  if not coalesce(v_queue_open, false) then
    raise exception 'the live queue is currently closed to new entries'
      using errcode = '42501',
            hint = 'Reopen the queue to admit new walk-ins. This is separate from the service mode, and customers already waiting are unaffected.';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION enforce_queue_service_mode(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_queue_service_mode() IS 'BEFORE INSERT on queue_entries: the ONE place a new walk-in is admitted or refused. Fires for every writer including service_role and postgres. Requires all three independent facts — the R2 walk-in/queue entitlement, a mode that allows the queue, and queue_open — and reports distinctly which one failed, because each has a different control and a different fix. INSERT only: everyone already waiting keeps their full R1A lifecycle in every mode, and closing the queue never removes them.';


--
-- Name: enforce_queue_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_queue_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_from public.queue_status := old.status;
  v_to   public.queue_status := new.status;
begin
  -- customer_id is evidence once the entry has been called. Frozen for every
  -- caller; a mis-assigned walk-in is corrected while still `waiting`.
  if old.status <> 'waiting' and new.customer_id is distinct from old.customer_id then
    raise exception 'queue_entries.customer_id cannot be reassigned after the entry has been called'
      using errcode = '22023';
  end if;

  if v_from is not distinct from v_to then
    return new;
  end if;

  if v_from in ('completed', 'cancelled', 'no_show') then
    raise exception 'queue entry is already % and cannot change state', v_from
      using errcode = '22023';
  end if;

  if v_to in ('cancelled', 'no_show') then
    return new;                       -- abandoning is always allowed
  end if;

  if private.queue_stage(v_to) <= private.queue_stage(v_from) then
    raise exception 'illegal queue transition % -> %', v_from, v_to
      using errcode = '22023';
  end if;

  -- Server-authoritative. coalesce(old, now()) so a re-run cannot rewrite a
  -- stamp that already exists, and any client-supplied value is discarded.
  if v_to = 'called'     then new.called_at          := coalesce(old.called_at, now()); end if;
  if v_to = 'in_service' then new.service_started_at := coalesce(old.service_started_at, now());
                              new.called_at          := coalesce(old.called_at, now()); end if;
  if v_to = 'completed'  then new.completed_at       := coalesce(old.completed_at, now());
                              new.service_started_at := coalesce(old.service_started_at, now());
                              new.called_at          := coalesce(old.called_at, now()); end if;
  return new;
end;
$$;


--
-- Name: FUNCTION enforce_queue_transition(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_queue_transition() IS 'BEFORE UPDATE invariant on queue_entries. Stamps the lifecycle timestamps server-side, discarding client-supplied values; forbids backward and terminal-exit transitions; freezes customer_id once the entry has been called. No role exemption — an impossible transition is impossible for every caller.';


--
-- Name: enforce_staff_reactivation_capacity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_staff_reactivation_capacity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if old.is_active or not new.is_active then
    return new;
  end if;

  if exists (select 1 from public.barbers b where b.staff_profile_id = new.id) then
    perform private.assert_professional_capacity(new.organization_id);
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION enforce_staff_reactivation_capacity(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_staff_reactivation_capacity() IS 'Closes the offboard -> downgrade -> re-onboard bypass. Reactivating a staff profile that backs a roster placement is the same commercial event as adding a professional, so it takes the same lock and the same cap. Only the false -> true transition is a capacity event; every other staff_profiles update passes through untouched.';


--
-- Name: ensure_owner_professional(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_owner_professional(p_organization_id uuid, p_location_id uuid, p_display_name text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_bio text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid := (select auth.uid());
  v_staff_profile_id uuid;
  v_barber_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may set themselves up as a professional'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.organization_id = p_organization_id
  ) then
    raise exception 'location does not belong to this organization';
  end if;

  insert into public.staff_profiles (organization_id, user_id, location_id, display_name, title, bio)
  values (
    p_organization_id, v_user_id, p_location_id,
    coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), 'Professional'),
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(coalesce(p_bio, '')), '')
  )
  on conflict (organization_id, user_id) do update set
    location_id = coalesce(excluded.location_id, public.staff_profiles.location_id),
    display_name = coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), public.staff_profiles.display_name),
    title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), public.staff_profiles.title),
    bio = coalesce(nullif(btrim(coalesce(p_bio, '')), ''), public.staff_profiles.bio),
    is_active = true,
    is_public = true
  returning id into v_staff_profile_id;

  select b.id into v_barber_id
    from public.barbers b where b.staff_profile_id = v_staff_profile_id;

  if v_barber_id is null then
    insert into public.barbers (organization_id, staff_profile_id, is_bookable)
    values (p_organization_id, v_staff_profile_id, true)
    returning id into v_barber_id;
  else
    update public.barbers set is_bookable = true where id = v_barber_id;
  end if;

  return v_barber_id;
end;
$$;


--
-- Name: FUNCTION ensure_owner_professional(p_organization_id uuid, p_location_id uuid, p_display_name text, p_title text, p_bio text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.ensure_owner_professional(p_organization_id uuid, p_location_id uuid, p_display_name text, p_title text, p_bio text) IS 'Idempotently makes the calling owner/manager a bookable professional at a location: upserts their staff_profiles row (never blanking a field the caller omitted) and ensures a bookable barbers row. Returns the barber id. Running it twice produces one professional, not two.';


--
-- Name: expire_pending_appointments(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_pending_appointments(p_limit integer DEFAULT 500) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_appointment public.appointments;
  v_count integer := 0;
begin
  for v_appointment in
    select * from public.appointments a
    where a.status = 'pending'
      and a.expires_at is not null
      and a.expires_at <= now()
    order by a.expires_at
    limit greatest(p_limit, 0)
    for update skip locked
  loop
    update public.appointments
      set status = 'cancelled',
          resolution = 'expired',
          decided_at = now()
      where id = v_appointment.id
        -- Re-checked under the lock: if a staff member confirmed between the
        -- select and here, this matches nothing and the row is left alone.
        and status = 'pending'
      returning * into v_appointment;

    if found then
      perform private.emit_booking_notification(
        v_appointment, 'booking_expired', 'customer',
        'Your booking request expired',
        null, 'booking_expired'
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;


--
-- Name: FUNCTION expire_pending_appointments(p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.expire_pending_appointments(p_limit integer) IS 'Transitions unanswered booking requests past their deadline to cancelled/expired, freeing the slot. Idempotent and re-entrant: batched with FOR UPDATE SKIP LOCKED and re-checked under the lock, so it never blocks or overwrites a staff decision, and running it twice changes nothing the second time.';


--
-- Name: favorite_shop(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.favorite_shop(p_organization_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());

  if v_user_id is null then
    raise exception 'favorite requires an authenticated session'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
  ) then
    raise exception 'organization not found'
      using errcode = '42704';
  end if;

  insert into public.customer_favorites (
    user_id,
    organization_id,
    barber_id
  )
  values (
    v_user_id,
    p_organization_id,
    null
  )
  on conflict (user_id, organization_id)
    where barber_id is null
    do nothing;
end;
$$;


--
-- Name: FUNCTION favorite_shop(p_organization_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.favorite_shop(p_organization_id uuid) IS 'Authenticated customer bookmark contract for shops. Actor identity is always auth.uid(); callers cannot create barber favorites or write on behalf of another account.';


--
-- Name: follow_organization(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.follow_organization(p_organization_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
  v_slug text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  select o.slug::text
    into v_slug
  from public.organizations o
  where o.id = p_organization_id;

  if v_slug is null then
    raise exception 'organization unavailable'
      using errcode = '42501';
  end if;

  perform 1
  from public.get_public_organization(v_slug)
  limit 1;

  if not found then
    raise exception 'organization unavailable'
      using errcode = '42501';
  end if;

  insert into public.organization_follows (
    follower_user_id,
    organization_id,
    is_following,
    followed_at,
    unfollowed_at,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    p_organization_id,
    true,
    now(),
    null,
    now(),
    now()
  )
  on conflict (follower_user_id, organization_id)
  do update
  set
    is_following = true,
    followed_at = now(),
    unfollowed_at = null,
    updated_at = now();
end;
$$;


--
-- Name: FUNCTION follow_organization(p_organization_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.follow_organization(p_organization_id uuid) IS 'Authenticated explicit Follow of a public FadeUp barbershop organization. Actor identity is auth.uid().';


--
-- Name: follow_professional(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.follow_professional(p_professional_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'follow requires an authenticated session' using errcode = '42501';
  end if;

  -- Unclaimed identities cannot be followed: see the migration header.
  if not exists (
    select 1 from public.professionals p
    where p.id = p_professional_id and p.claim_state = 'claimed'
  ) then
    raise exception 'professional not found or not claimable' using errcode = '42704';
  end if;

  insert into public.professional_follows (follower_user_id, professional_id, state, source, followed_at, unfollowed_at)
  values (v_user_id, p_professional_id, 'following', 'manual', now(), null)
  on conflict (follower_user_id, professional_id) do update
    set state = 'following',
        source = 'manual',
        -- Re-following something already followed must not restate WHEN it
        -- began. Only a genuine transition moves the timestamp.
        followed_at = case
          when public.professional_follows.state = 'following'
          then public.professional_follows.followed_at
          else now()
        end,
        unfollowed_at = null;
end;
$$;


--
-- Name: FUNCTION follow_professional(p_professional_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.follow_professional(p_professional_id uuid) IS 'Authenticated-only. Idempotent: following twice is a no-op that preserves the original followed_at. This is the ONLY path that can reverse an explicit unfollow, and it requires the customer''s own deliberate action — Constitution §3.4. The follower is auth.uid(); a caller cannot name someone else.';


--
-- Name: get_available_slots(uuid, uuid, uuid, uuid, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_available_slots(p_organization_id uuid, p_location_id uuid, p_barber_id uuid, p_service_id uuid, p_date date, p_slot_step_minutes integer DEFAULT 15) RETURNS TABLE(slot_start timestamp with time zone, slot_end timestamp with time zone)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_duration integer; v_before integer; v_after integer; v_timezone text;
begin
  if p_slot_step_minutes <= 0 then
    raise exception 'p_slot_step_minutes must be positive';
  end if;

  select duration_minutes, buffer_before_minutes, buffer_after_minutes
    into v_duration, v_before, v_after
    from public.services
    where id = p_service_id and organization_id = p_organization_id and is_active;
  if not found then return; end if;

  select timezone into v_timezone
    from public.locations
    where id = p_location_id and organization_id = p_organization_id;
  if not found then return; end if;

  -- SECURITY INVOKER, as before: this reads appointments under the caller's
  -- own RLS, so it only ever returns slot data for an org they can see.
  -- p_exclude_past is TRUE now — staff were being offered 9am at noon, which
  -- was the drift this extraction removes.
  return query select * from private.compute_available_slots(
    p_barber_id, p_location_id, p_date, v_timezone,
    v_duration, v_before, v_after, p_slot_step_minutes, true);
end;
$$;


--
-- Name: FUNCTION get_available_slots(p_organization_id uuid, p_location_id uuid, p_barber_id uuid, p_service_id uuid, p_date date, p_slot_step_minutes integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_available_slots(p_organization_id uuid, p_location_id uuid, p_barber_id uuid, p_service_id uuid, p_date date, p_slot_step_minutes integer) IS 'Bookable slots for staff. SECURITY INVOKER — respects the caller''s own RLS. Now shares private.compute_available_slots with the public wrapper, so split shifts, time blocks and the past-time trim can never again exist in one and not the other.';


--
-- Name: get_booking_requests(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_booking_requests(p_organization_id uuid) RETURNS TABLE(id uuid, location_id uuid, location_name text, barber_id uuid, barber_display_name text, service_id uuid, service_name text, duration_minutes integer, price_cents integer, customer_name text, customer_phone text, customer_email text, notes text, starts_at timestamp with time zone, ends_at timestamp with time zone, expires_at timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    a.id, a.location_id, l.name, a.barber_id, sp.display_name,
    a.service_id, s.name,
    (extract(epoch from (a.ends_at - a.starts_at)) / 60)::integer,
    s.price_cents,
    a.customer_name, a.customer_phone, a.customer_email, a.notes,
    a.starts_at, a.ends_at, a.expires_at, a.created_at
  from public.appointments a
  join public.locations l on l.id = a.location_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.organization_id = p_organization_id
    and a.status = 'pending'
    -- Already past its deadline but not yet swept: showing it would offer an
    -- Accept that confirm_booking_request would then refuse.
    and (a.expires_at is null or a.expires_at > now())
    and (select private.can_manage_appointments(p_organization_id))
  order by a.expires_at nulls last, a.created_at;
$$;


--
-- Name: FUNCTION get_booking_requests(p_organization_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_booking_requests(p_organization_id uuid) IS 'Pending booking requests awaiting a decision, for staff who may decide them. Returns nothing — rather than raising — for a caller without the role, so it is safe to call from a shared layout. Hides requests already past their deadline, since accepting one would fail.';


--
-- Name: get_calendar_appointments(uuid, timestamp with time zone, timestamp with time zone, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_calendar_appointments(p_organization_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_location_id uuid DEFAULT NULL::uuid, p_barber_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, status public.appointment_status, resolution public.appointment_resolution, expires_at timestamp with time zone, location_id uuid, location_name text, location_timezone text, barber_id uuid, barber_display_name text, service_id uuid, service_name text, price_cents integer, currency text, customer_name text, customer_phone text, notes text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    a.id, a.starts_at, a.ends_at, a.status, a.resolution, a.expires_at,
    a.location_id, l.name, l.timezone,
    a.barber_id, sp.display_name,
    a.service_id, s.name, s.price_cents, coalesce(o.currency, 'EUR'),
    a.customer_name, a.customer_phone, a.notes, a.created_at
  from public.appointments a
  join public.locations l on l.id = a.location_id
  join public.organizations o on o.id = a.organization_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.organization_id = p_organization_id
    and a.starts_at >= p_from
    and a.starts_at < p_to
    and (p_location_id is null or a.location_id = p_location_id)
    and (p_barber_id is null or a.barber_id = p_barber_id)
    -- SECURITY DEFINER bypasses RLS, so membership is checked explicitly.
    and ((select private.is_org_member(p_organization_id)) or (select private.is_platform_admin()))
  order by a.starts_at;
$$;


--
-- Name: FUNCTION get_calendar_appointments(p_organization_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_location_id uuid, p_barber_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_calendar_appointments(p_organization_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_location_id uuid, p_barber_id uuid) IS 'Range-bounded, pre-joined calendar read. Returns nothing — rather than raising — for a non-member, so it is safe to call from a shared layout. Carries the organization''s currency so a group operating in several countries prices each shop''s calendar correctly. Still deliberately omits customer_email and customer_id.';


--
-- Name: get_invitation_by_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_invitation_by_token(p_token text) RETURNS TABLE(organization_name text, role public.membership_role, email text, location_name text, expires_at timestamp with time zone, is_expired boolean, is_accepted boolean, is_revoked boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    o.name,
    i.role,
    i.email,
    l.name,
    i.expires_at,
    i.expires_at < now(),
    i.accepted_at is not null,
    i.revoked_at is not null
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.locations l on l.id = i.location_id
  where i.token = p_token;
$$;


--
-- Name: FUNCTION get_invitation_by_token(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_invitation_by_token(p_token text) IS 'Public (anon-callable) lookup of an invitation by token for rendering an accept screen. Returns no rows for an unknown token.';


--
-- Name: get_location_queue_check_in(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_location_queue_check_in(p_location_id uuid) RETURNS TABLE(location_id uuid, queue_check_in_token text, queue_geofence_meters integer, queue_call_grace_minutes integer, queue_capacity_per_barber integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  -- Receptionist included: reprinting the code that is taped to the counter is
  -- front-of-house work, the same category as opening and closing the queue.
  perform private.assert_service_mode_authority(p_location_id, null, true);

  return query
  select l.id, l.queue_check_in_token,
         s.queue_geofence_meters, s.queue_call_grace_minutes, s.queue_capacity_per_barber
  from public.locations l
  join private.location_service_settings_effective(p_location_id) e on e.location_id = l.id
  left join public.location_service_settings s on s.location_id = l.id
  where l.id = p_location_id;
end;
$$;


--
-- Name: FUNCTION get_location_queue_check_in(p_location_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_location_queue_check_in(p_location_id uuid) IS 'Owner, manager or receptionist. The establishment''s QR check-in token and its three queue thresholds, for the Pro screen that prints the code. The token is returned ONLY here — no public RPC ever emits it.';


--
-- Name: get_my_access(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_access() RETURNS TABLE(user_id uuid, platform_role public.platform_role, platform_available boolean, professional_available boolean, organization_count integer, owned_organization_count integer, customer_available boolean, customer_profile_exists boolean, customer_onboarding_completed boolean, application_status public.professional_application_status, signup_intent text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    (select auth.uid()),
    (select pm.role from public.platform_members pm where pm.user_id = (select auth.uid())),
    exists (select 1 from public.platform_members pm where pm.user_id = (select auth.uid())),
    exists (select 1 from public.memberships m where m.user_id = (select auth.uid())),
    (select count(*)::integer from public.memberships m where m.user_id = (select auth.uid())),
    (select count(*)::integer from public.memberships m where m.user_id = (select auth.uid()) and m.role = 'owner'),
    (select auth.uid()) is not null,
    exists (select 1 from public.customer_profiles cp where cp.user_id = (select auth.uid())),
    exists (
      select 1 from public.customer_profiles cp
      where cp.user_id = (select auth.uid()) and cp.onboarding_completed_at is not null
    ),
    (
      select a.status from public.professional_applications a
      where a.user_id = (select auth.uid())
      order by a.submitted_at desc
      limit 1
    ),
    (
      select nullif(btrim(coalesce(u.raw_user_meta_data ->> 'signup_intent', '')), '')
      from auth.users u where u.id = (select auth.uid())
    )
  where (select auth.uid()) is not null;
$$;


--
-- Name: FUNCTION get_my_access(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_my_access() IS 'The authoritative post-authentication access snapshot for the CALLING user. Takes no parameters and resolves exclusively from auth.uid(), so it cannot be asked about anyone else. platform_available comes from platform_members and professional_available from memberships — never from the authentication provider, the email domain, or user metadata. signup_intent is a routing hint with no authorization meaning. Returns zero rows for an unauthenticated caller.';


--
-- Name: get_my_appointments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_appointments() RETURNS TABLE(id uuid, organization_id uuid, organization_name text, organization_slug text, location_id uuid, location_name text, barber_id uuid, barber_display_name text, service_id uuid, service_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, status public.appointment_status, price_cents integer, currency text, location_timezone text, resolution public.appointment_resolution, resolution_note text, expires_at timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    a.id, a.organization_id, o.name, o.slug, a.location_id, l.name,
    a.barber_id, sp.display_name, a.service_id, s.name,
    a.starts_at, a.ends_at, a.status, s.price_cents,
    coalesce(o.currency, 'EUR'),
    -- The shop's timezone travels with the appointment: a customer abroad must
    -- still read the time the salon means, not the one their phone assumes.
    l.timezone,
    a.resolution, a.resolution_note, a.expires_at, a.created_at
  from public.appointments a
  join public.organizations o on o.id = a.organization_id
  join public.locations l on l.id = a.location_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  )
  order by a.starts_at desc;
$$;


--
-- Name: FUNCTION get_my_appointments(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_my_appointments() IS 'A signed-in customer''s own appointments across every shop they use. Now carries each shop''s currency AND its location timezone, because a customer''s list genuinely spans businesses in different countries and both were previously assumed from the device.';


--
-- Name: get_my_favorites(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_favorites() RETURNS TABLE(favorite_id uuid, organization_id uuid, organization_name text, organization_slug text, barber_id uuid, barber_display_name text, barber_avatar_url text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    f.id,
    f.organization_id,
    o.name,
    o.slug,
    f.barber_id,
    sp.display_name,
    sp.avatar_url,
    f.created_at
  from public.customer_favorites f
  join public.organizations o on o.id = f.organization_id
  left join public.barbers b on b.id = f.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  where f.user_id = (select auth.uid())
  order by f.created_at desc;
$$;


--
-- Name: FUNCTION get_my_favorites(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_my_favorites() IS 'Authenticated-only: the caller''s own favorited shops/barbers, joined with curated public display fields.';


--
-- Name: get_my_professional_application(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_professional_application() RETURNS TABLE(id uuid, status public.professional_application_status, first_name text, last_name text, email text, phone text, business_name text, professional_type public.professional_type, city text, submitted_at timestamp with time zone, reviewed_at timestamp with time zone, rejection_reason text, organization_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    a.id, a.status, a.first_name, a.last_name, a.email, a.phone,
    a.business_name, a.professional_type, a.city,
    a.submitted_at, a.reviewed_at, a.rejection_reason, a.organization_id
  from public.professional_applications a
  where a.user_id = (select auth.uid())
  order by a.submitted_at desc
  limit 1;
$$;


--
-- Name: FUNCTION get_my_professional_application(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_my_professional_application() IS 'The caller''s most recent professional application, in an applicant-safe shape: internal_note and reviewed_by are not in the return type at all, so they cannot leak through this path.';


--
-- Name: get_my_queue_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_queue_status() RETURNS TABLE(id uuid, organization_id uuid, organization_name text, organization_slug text, location_id uuid, location_name text, status public.queue_status, queue_position integer, barber_display_name text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with waiting_positions as (
    select id, row_number() over (partition by location_id order by created_at) as position
    from public.queue_entries
    where status = 'waiting'
  )
  select
    q.id,
    q.organization_id,
    o.name,
    o.slug,
    q.location_id,
    l.name,
    q.status,
    case when q.status = 'waiting' then wp.position::integer else null end,
    sp.display_name,
    q.created_at
  from public.queue_entries q
  join public.organizations o on o.id = q.organization_id
  join public.locations l on l.id = q.location_id
  left join public.barbers b on b.id = q.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join waiting_positions wp on wp.id = q.id
  where q.status in ('waiting', 'called', 'in_service')
    and q.customer_id in (
      select c.id from public.customers c where c.user_id = (select auth.uid())
    )
  order by q.created_at;
$$;


--
-- Name: FUNCTION get_my_queue_status(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_my_queue_status() IS 'Authenticated-only: the caller''s own active (waiting/called/in_service) queue entries, with an accurate position derived from the full location line, never exposing other customers'' entries.';


--
-- Name: get_organization_analytics_summary(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_organization_analytics_summary(p_organization_id uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(window_from timestamp with time zone, window_to timestamp with time zone, profile_views bigint, unique_authenticated_viewers bigint, distinct_anonymous_sessions bigint, booking_starts bigint, appointments_created bigint, appointments_confirmed bigint, appointments_completed bigint, appointments_cancelled bigint, appointments_no_show bigint, queue_views bigint, queue_joins bigint, queue_completions bigint, queue_cancellations bigint, follows bigint, unfollows bigint, favorites bigint, unfavorites bigint, unique_customers bigint, repeat_customers bigint, booking_conversion_rate numeric, queue_conversion_rate numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_organization_id is null then
    raise exception 'organization required' using errcode = '22023';
  end if;

  -- Authorization FIRST, before the window is even parsed. A caller who is not
  -- entitled to these numbers must not be able to distinguish "not allowed"
  -- from "bad window", and must certainly not learn anything by timing.
  if not (
    (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[]))
    or (select private.is_platform_admin())
  ) then
    raise exception 'not authorized to read analytics for this organization'
      using errcode = '42501';
  end if;

  select w.window_from, w.window_to into v_from, v_to
  from private.analytics_window(p_from, p_to) w;

  return query
  with scoped as (
    select e.*
    from public.analytics_events e
    where e.organization_id = p_organization_id
      and e.occurred_at >= v_from
      and e.occurred_at < v_to
  ),
  -- A "repeat customer" is an ACCOUNT with more than one delivered service in
  -- the window, counting both channels: a customer who books once and walks in
  -- once is a returning customer, and treating appointments and the queue as
  -- separate worlds would report them as two different one-time visitors.
  completions_by_actor as (
    select s.actor_user_id, count(*) as n
    from scoped s
    where s.event_name in ('appointment_completed', 'queue_completed')
      and s.actor_user_id is not null
    group by s.actor_user_id
  )
  select
    v_from,
    v_to,

    count(*) filter (where s.event_name = 'public_profile_viewed'),
    count(distinct s.actor_user_id) filter (
      where s.event_name = 'public_profile_viewed' and s.actor_user_id is not null),
    -- Anonymous reach, approximated by distinct session handle. Deliberately
    -- named "distinct_anonymous_sessions" and not "unique visitors": a session
    -- handle is short-lived, so one person across two days is two sessions.
    -- Overstating the precision of this number is how it ends up in a pitch
    -- deck as something it is not.
    count(distinct s.session_id) filter (
      where s.event_name = 'public_profile_viewed' and s.actor_user_id is null and s.session_id is not null),

    count(*) filter (where s.event_name = 'booking_started'),
    count(*) filter (where s.event_name = 'appointment_created'),
    count(*) filter (where s.event_name = 'appointment_confirmed'),
    count(*) filter (where s.event_name = 'appointment_completed'),
    count(*) filter (where s.event_name = 'appointment_cancelled'),
    count(*) filter (where s.event_name = 'appointment_no_show'),

    count(*) filter (where s.event_name = 'queue_viewed'),
    count(*) filter (where s.event_name = 'queue_joined'),
    count(*) filter (where s.event_name = 'queue_completed'),
    count(*) filter (where s.event_name = 'queue_cancelled'),

    count(*) filter (where s.event_name = 'organization_followed'),
    count(*) filter (where s.event_name = 'organization_unfollowed'),
    count(*) filter (where s.event_name = 'organization_favorited'),
    count(*) filter (where s.event_name = 'organization_unfavorited'),

    (select count(*) from completions_by_actor),
    (select count(*) from completions_by_actor where n > 1),

    -- NULLIF, not a CASE: dividing by zero bookings must yield "no answer",
    -- never 0%. A shop with no bookings has an undefined conversion rate, and
    -- reporting 0% would read as failure rather than absence.
    round(
      count(*) filter (where s.event_name = 'appointment_completed')::numeric
      / nullif(count(*) filter (where s.event_name = 'appointment_created'), 0),
      4),
    round(
      count(*) filter (where s.event_name = 'queue_completed')::numeric
      / nullif(count(*) filter (where s.event_name = 'queue_joined'), 0),
      4)
  from scoped s;
end;
$$;


--
-- Name: FUNCTION get_organization_analytics_summary(p_organization_id uuid, p_from timestamp with time zone, p_to timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_organization_analytics_summary(p_organization_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) IS 'The §18 primitive set for ONE organization, over a bounded window, as counts only. Owner/manager or platform admin — deliberately not every member, since a barber has no business reading the shop''s conversion rates. Returns no event row, no actor id and no session id: a shop learns HOW MANY people viewed its profile and never WHO, per §12. Conversion is completions over appointments CREATED, never over booking_started, because intent is a client event and §5 forbids resting conversion on one.';


--
-- Name: get_organization_entitlements(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_organization_entitlements(p_organization_id uuid) RETURNS TABLE(organization_id uuid, plan_key text, commercial_family public.commercial_family, display_name text, price_minor integer, price_currency text, status public.commercial_status, entitlement_source public.entitlement_source, effective_plan_key text, max_establishments integer, used_establishments integer, max_operational_professionals integer, used_operational_professionals integer, live_capabilities text[], packaged_capabilities text[])
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_effective text;
begin
  if (select auth.uid()) is null then
    raise exception 'resolving entitlements requires an authenticated session'
      using errcode = '42501';
  end if;

  -- Identical refusal for "not yours", "not a member" and "does not exist".
  -- Splitting them would be friendlier and would also answer "does this
  -- organization exist" for anyone willing to guess uuids.
  if p_organization_id is null
     or not (
       (select private.is_org_member(p_organization_id))
       or (select private.is_platform_admin())
     ) then
    raise exception 'not authorized to read the commercial state of this organization'
      using errcode = '42501';
  end if;

  v_effective := private.effective_plan_key(p_organization_id);

  if v_effective is null then
    -- An organization the caller genuinely belongs to but which has no
    -- commercial state is a data defect, not an authorization question. Say so
    -- plainly rather than returning zero rows the UI would render as "loading
    -- forever".
    raise exception 'organization has no commercial state — R2 backfill did not cover it'
      using errcode = 'P0001';
  end if;

  return query
  select
    s.organization_id,
    s.plan_key,
    p.commercial_family,
    p.display_name,
    p.price_minor,
    p.price_currency,
    s.status,
    s.entitlement_source,
    v_effective,
    -- Capacity always comes from the EFFECTIVE plan, never the assigned one.
    ep.max_establishments,
    private.org_active_establishments(s.organization_id),
    ep.max_operational_professionals,
    private.org_active_professionals(s.organization_id),
    coalesce((
      select array_agg(pc.capability_key order by pc.capability_key)
      from public.plan_capabilities pc
      join public.commercial_capabilities c on c.capability_key = pc.capability_key
      where pc.plan_key = v_effective and c.status = 'live'
    ), array[]::text[]),
    coalesce((
      select array_agg(pc.capability_key order by pc.capability_key)
      from public.plan_capabilities pc
      where pc.plan_key = v_effective
    ), array[]::text[])
  from public.organization_commercial_state s
  join public.commercial_plans p on p.plan_key = s.plan_key
  join public.commercial_plans ep on ep.plan_key = v_effective
  where s.organization_id = p_organization_id;
end;
$$;


--
-- Name: FUNCTION get_organization_entitlements(p_organization_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_organization_entitlements(p_organization_id uuid) IS 'The authoritative entitlement snapshot for ONE organization the caller belongs to (or any organization, for a platform admin). The organization id is a question, never a credential: membership is re-derived from auth.uid() before anything is returned, and a caller who is not a member gets the IDENTICAL 42501 whether the organization exists or not, so this cannot enumerate tenants. Capacity is reported from the EFFECTIVE plan, so a canceled subscription shows free capacity while the assigned plan remains visible in plan_key.';


--
-- Name: get_organization_readiness(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_organization_readiness(p_organization_id uuid) RETURNS TABLE(organization_id uuid, business_type public.business_type, currency text, has_business_type boolean, has_currency boolean, has_location boolean, has_location_address boolean, has_service_area boolean, has_timezone boolean, has_professional boolean, has_service boolean, has_service_at_location boolean, has_service_for_professional boolean, has_location_hours boolean, has_professional_hours boolean, has_public_profile boolean, ready_to_book boolean, ready_to_publish boolean, is_published boolean, missing_requirements text[])
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  r record;
  v_missing text[] := array[]::text[];
  v_ready_to_book boolean;
  v_ready_to_publish boolean;
begin
  -- Same visibility rule as every other org-scoped read in this schema.
  -- SECURITY DEFINER bypasses RLS, so the check has to be explicit.
  if not (
    (select private.is_org_member(p_organization_id))
    or (select private.is_platform_admin())
  ) then
    raise exception 'not authorized to read readiness for this organization'
      using errcode = '42501';
  end if;

  select
    o.business_type,
    o.currency,
    o.business_type is not null as has_business_type,
    o.currency is not null as has_currency,
    o.marketplace_visible as is_published,

    exists (
      select 1 from public.locations l
      where l.organization_id = o.id and l.is_active
    ) as has_location,

    exists (
      select 1 from public.locations l
      where l.organization_id = o.id and l.is_active
        and l.kind = 'physical_address'
        and nullif(btrim(coalesce(l.address_line1, '')), '') is not null
        and nullif(btrim(coalesce(l.city, '')), '') is not null
        and nullif(btrim(coalesce(l.country, '')), '') is not null
    ) as has_location_address,

    -- The other legitimate answer to "where can a customer be served".
    -- locations_kind_shape already guarantees the three zone columns are
    -- present together on a service_area row, so is_active and the kind are
    -- the whole test.
    exists (
      select 1 from public.locations l
      where l.organization_id = o.id and l.is_active
        and l.kind = 'service_area'
    ) as has_service_area,

    exists (
      select 1 from public.locations l
      where l.organization_id = o.id and l.is_active
        and nullif(btrim(coalesce(l.timezone, '')), '') is not null
    ) as has_timezone,

    -- "Professional" here means what get_public_available_slots requires:
    -- bookable, active, publicly listed, AND attached to a location.
    exists (
      select 1
      from public.barbers b
      join public.staff_profiles sp on sp.id = b.staff_profile_id
      join public.locations l on l.id = sp.location_id and l.is_active
      where b.organization_id = o.id
        and b.is_bookable and sp.is_active and sp.is_public
    ) as has_professional,

    exists (
      select 1 from public.services s
      where s.organization_id = o.id and s.is_active
    ) as has_service,

    exists (
      select 1
      from public.services s
      join public.service_locations sl on sl.service_id = s.id
      join public.locations l on l.id = sl.location_id and l.is_active
      where s.organization_id = o.id and s.is_active
    ) as has_service_at_location,

    exists (
      select 1
      from public.services s
      join public.barber_services bs on bs.service_id = s.id
      join public.barbers b on b.id = bs.barber_id and b.is_bookable
      join public.staff_profiles sp on sp.id = b.staff_profile_id and sp.is_active and sp.is_public
      where s.organization_id = o.id and s.is_active
    ) as has_service_for_professional,

    exists (
      select 1
      from public.location_hours lh
      join public.locations l on l.id = lh.location_id and l.is_active
      where l.organization_id = o.id and not lh.is_closed
    ) as has_location_hours,

    exists (
      select 1
      from public.barber_working_hours bwh
      join public.barbers b on b.id = bwh.barber_id and b.is_bookable
      join public.staff_profiles sp on sp.id = b.staff_profile_id and sp.is_active and sp.is_public
      where b.organization_id = o.id and not bwh.is_off
    ) as has_professional_hours,

    -- Minimum public profile: a real business name (guaranteed by the
    -- not-blank constraint), plus at least one publicly listed professional
    -- carrying a display name. Photos and bios are genuinely optional today
    -- — there is no photo storage for them yet — so requiring them here
    -- would block publication on a capability the product does not have.
    exists (
      select 1
      from public.staff_profiles sp
      where sp.organization_id = o.id and sp.is_public and sp.is_active
        and nullif(btrim(coalesce(sp.display_name, '')), '') is not null
    ) as has_public_profile

  into r
  from public.organizations o
  where o.id = p_organization_id;

  if not found then
    raise exception 'organization not found';
  end if;

  -- ready_to_book: every condition get_public_available_slots depends on.
  v_ready_to_book :=
    r.has_location and r.has_timezone and r.has_professional and r.has_service
    and r.has_service_at_location and r.has_service_for_professional
    and r.has_location_hours and r.has_professional_hours;

  -- ready_to_publish additionally needs the marketplace-facing facts: what
  -- kind of business this is, what currency its prices are in, WHERE A
  -- CUSTOMER CAN BE SERVED — an address to travel to or a zone the
  -- professional travels within, MASTER_SPEC §8 makes both legitimate and
  -- forbids faking the first to obtain the second — and a public profile.
  v_ready_to_publish :=
    v_ready_to_book and r.has_business_type and r.has_currency
    and (r.has_location_address or r.has_service_area) and r.has_public_profile;

  if not r.has_business_type then v_missing := array_append(v_missing, 'business_type'); end if;
  if not r.has_currency then v_missing := array_append(v_missing, 'currency'); end if;
  if not r.has_location then v_missing := array_append(v_missing, 'location'); end if;
  if not (r.has_location_address or r.has_service_area) then
    v_missing := array_append(v_missing, 'location_address_or_service_area');
  end if;
  if not r.has_timezone then v_missing := array_append(v_missing, 'timezone'); end if;
  if not r.has_professional then v_missing := array_append(v_missing, 'professional'); end if;
  if not r.has_service then v_missing := array_append(v_missing, 'service'); end if;
  if not r.has_service_at_location then v_missing := array_append(v_missing, 'service_at_location'); end if;
  if not r.has_service_for_professional then v_missing := array_append(v_missing, 'service_for_professional'); end if;
  if not r.has_location_hours then v_missing := array_append(v_missing, 'location_hours'); end if;
  if not r.has_professional_hours then v_missing := array_append(v_missing, 'professional_hours'); end if;
  if not r.has_public_profile then v_missing := array_append(v_missing, 'public_profile'); end if;

  return query select
    p_organization_id,
    r.business_type, r.currency,
    r.has_business_type, r.has_currency, r.has_location, r.has_location_address,
    r.has_service_area,
    r.has_timezone, r.has_professional, r.has_service, r.has_service_at_location,
    r.has_service_for_professional, r.has_location_hours, r.has_professional_hours,
    r.has_public_profile,
    v_ready_to_book, v_ready_to_publish, r.is_published, v_missing;
end;
$$;


--
-- Name: FUNCTION get_organization_readiness(p_organization_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_organization_readiness(p_organization_id uuid) IS 'Org-member or platform-admin. The publication checklist. ready_to_publish requires a place a customer can be served, and B1 made that EITHER a complete postal address on a physical_address location OR an active service_area location — a mobile professional is no longer told to invent a street. has_location_address keeps its literal meaning; has_service_area is the sibling; missing_requirements reports ''location_address_or_service_area'' when neither is present.';


--
-- Name: get_organization_retention_cohort(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_organization_retention_cohort(p_organization_id uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(window_from timestamp with time zone, window_to timestamp with time zone, first_time_customers bigint, returned_at_all bigint, returned_within_30d bigint, returned_within_60d bigint, returned_within_90d bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_organization_id is null then
    raise exception 'organization required' using errcode = '22023';
  end if;

  if not (
    (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[]))
    or (select private.is_platform_admin())
  ) then
    raise exception 'not authorized to read analytics for this organization'
      using errcode = '42501';
  end if;

  select w.window_from, w.window_to into v_from, v_to
  from private.analytics_window(p_from, p_to) w;

  return query
  with completions as (
    select e.actor_user_id, e.occurred_at
    from public.analytics_events e
    where e.organization_id = p_organization_id
      and e.event_name in ('appointment_completed', 'queue_completed')
      and e.actor_user_id is not null
  ),
  firsts as (
    select c.actor_user_id, min(c.occurred_at) as first_at
    from completions c
    group by c.actor_user_id
  ),
  cohort as (
    -- The cohort is defined by WHEN THEY FIRST CAME, over all history.
    select f.actor_user_id, f.first_at
    from firsts f
    where f.first_at >= v_from
      and f.first_at < v_to
  ),
  returns as (
    select
      co.actor_user_id,
      min(c.occurred_at - co.first_at) as gap
    from cohort co
    join completions c
      on c.actor_user_id = co.actor_user_id
     and c.occurred_at > co.first_at
    group by co.actor_user_id
  )
  select
    v_from,
    v_to,
    (select count(*) from cohort),
    (select count(*) from returns),
    (select count(*) from returns where gap <= interval '30 days'),
    (select count(*) from returns where gap <= interval '60 days'),
    (select count(*) from returns where gap <= interval '90 days');
end;
$$;


--
-- Name: FUNCTION get_organization_retention_cohort(p_organization_id uuid, p_from timestamp with time zone, p_to timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_organization_retention_cohort(p_organization_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) IS 'The §10 retention funnel as a true cohort: of customers whose FIRST delivered service at this shop fell in the window, how many returned at all and within 30/60/90 days. First-visit is computed over all history, not over the window, so a long-standing customer who happened to visit during the window is never miscounted as newly acquired.';


--
-- Name: get_platform_analytics_funnel(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_platform_analytics_funnel(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(window_from timestamp with time zone, window_to timestamp with time zone, prospects_discovered bigint, prospects_enriched bigint, external_profiles_created bigint, claims_submitted bigint, claims_approved bigint, claims_rejected bigint, converted_professionals bigint, organizations_with_activity bigint, appointments_created bigint, appointments_completed bigint, queue_joins bigint, queue_completions bigint, passports_issued bigint, plans_assigned bigint, plans_changed bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'platform analytics are restricted to FadeUp platform staff'
      using errcode = '42501';
  end if;

  select w.window_from, w.window_to into v_from, v_to
  from private.analytics_window(p_from, p_to) w;

  return query
  with scoped as (
    select e.*
    from public.analytics_events e
    where e.occurred_at >= v_from
      and e.occurred_at < v_to
  )
  select
    v_from,
    v_to,

    -- DISTINCT prospects, never a count of discovery events. The emitter's
    -- dedupe key already guarantees one per prospect; restating it here means
    -- neither end can inflate the funnel alone.
    count(distinct s.prospect_id) filter (
      where s.event_name = 'prospect_discovered' and s.prospect_id is not null),
    -- Enrichment PASSES, not distinct prospects: re-enrichment is the point of
    -- the metric, and collapsing it would report a re-crawled table as idle.
    count(*) filter (where s.event_name = 'prospect_enriched'),

    count(*) filter (where s.event_name = 'external_profile_created'),
    count(*) filter (where s.event_name = 'claim_submitted'),
    count(*) filter (where s.event_name = 'claim_approved'),
    count(*) filter (where s.event_name = 'claim_rejected'),
    -- DISTINCT identities, never a count of approval events. §9.
    count(distinct s.professional_id) filter (
      where s.event_name = 'claim_approved' and s.professional_id is not null),

    count(distinct s.organization_id) filter (where s.organization_id is not null),
    count(*) filter (where s.event_name = 'appointment_created'),
    count(*) filter (where s.event_name = 'appointment_completed'),
    count(*) filter (where s.event_name = 'queue_joined'),
    count(*) filter (where s.event_name = 'queue_completed'),
    count(*) filter (where s.event_name = 'passport_issued'),
    count(*) filter (where s.event_name = 'plan_assigned'),
    count(*) filter (where s.event_name = 'plan_changed')
  from scoped s;
end;
$$;


--
-- Name: FUNCTION get_platform_analytics_funnel(p_from timestamp with time zone, p_to timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_platform_analytics_funnel(p_from timestamp with time zone, p_to timestamp with time zone) IS 'FadeUp''s own acquisition/claim funnel and platform product totals, over a bounded window. Platform admin only, and the only read contract that crosses tenants. R4 added the two head-of-funnel stages R3 had to leave deferred, so the funnel now runs discovery -> enrichment -> external profile -> claim -> approval -> conversion end to end. prospects_discovered and converted_professionals count DISTINCT subjects rather than events, so neither the emitter nor the reader can inflate the funnel alone; prospects_enriched deliberately counts passes, because re-enrichment is what the metric is for.';


--
-- Name: get_professional_analytics_summary(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_professional_analytics_summary(p_professional_id uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(window_from timestamp with time zone, window_to timestamp with time zone, profile_views bigint, unique_authenticated_viewers bigint, follows bigint, unfollows bigint, appointments_completed bigint, queue_completions bigint, unique_customers bigint, repeat_customers bigint, relationships_created bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_professional_id is null then
    raise exception 'professional required' using errcode = '22023';
  end if;

  if not (
    (select private.is_own_professional(p_professional_id))
    or (select private.is_platform_admin())
  ) then
    raise exception 'not authorized to read analytics for this professional'
      using errcode = '42501';
  end if;

  select w.window_from, w.window_to into v_from, v_to
  from private.analytics_window(p_from, p_to) w;

  return query
  with scoped as (
    select e.*
    from public.analytics_events e
    where e.professional_id = p_professional_id
      and e.occurred_at >= v_from
      and e.occurred_at < v_to
  ),
  completions_by_actor as (
    select s.actor_user_id, count(*) as n
    from scoped s
    where s.event_name in ('appointment_completed', 'queue_completed')
      and s.actor_user_id is not null
    group by s.actor_user_id
  )
  select
    v_from,
    v_to,
    count(*) filter (where s.event_name = 'public_profile_viewed'),
    count(distinct s.actor_user_id) filter (
      where s.event_name = 'public_profile_viewed' and s.actor_user_id is not null),
    count(*) filter (where s.event_name = 'professional_followed'),
    count(*) filter (where s.event_name = 'professional_unfollowed'),
    count(*) filter (where s.event_name = 'appointment_completed'),
    count(*) filter (where s.event_name = 'queue_completed'),
    (select count(*) from completions_by_actor),
    (select count(*) from completions_by_actor where n > 1),
    count(*) filter (where s.event_name = 'passport_relationship_created')
  from scoped s;
end;
$$;


--
-- Name: FUNCTION get_professional_analytics_summary(p_professional_id uuid, p_from timestamp with time zone, p_to timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_professional_analytics_summary(p_professional_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) IS 'A professional''s own numbers, keyed on the durable R1B identity so they follow the person across shops. Readable by that professional or by a platform admin — deliberately NOT by their current employer, since a shop-independent identity that the shop could read would not be shop-independent. Aggregates only.';


--
-- Name: get_public_available_slots(text, uuid, uuid, uuid, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_available_slots(p_organization_slug text, p_location_id uuid, p_barber_id uuid, p_service_id uuid, p_date date, p_slot_step_minutes integer DEFAULT 15) RETURNS TABLE(slot_start timestamp with time zone, slot_end timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_organization_id uuid; v_timezone text;
  v_duration integer; v_before integer; v_after integer;
begin
  if p_slot_step_minutes <= 0 then
    raise exception 'p_slot_step_minutes must be positive';
  end if;

  if p_date < current_date then return; end if;

  -- Every id re-validated against the organization resolved from the slug.
  -- Preserved verbatim from 20260809150000 — anon has no RLS to lean on.
  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then return; end if;

  select l.timezone into v_timezone
    from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;
  if not found then return; end if;

  select s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes
    into v_duration, v_before, v_after
    from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
      and exists (select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = p_location_id);
  if not found then return; end if;

  if not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable and sp.is_active and sp.is_public
      and sp.location_id = p_location_id
  ) then
    return;
  end if;

  return query select * from private.compute_available_slots(
    p_barber_id, p_location_id, p_date, v_timezone,
    v_duration, v_before, v_after, p_slot_step_minutes, true);
end;
$$;


--
-- Name: FUNCTION get_public_available_slots(p_organization_slug text, p_location_id uuid, p_barber_id uuid, p_service_id uuid, p_date date, p_slot_step_minutes integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_public_available_slots(p_organization_slug text, p_location_id uuid, p_barber_id uuid, p_service_id uuid, p_date date, p_slot_step_minutes integer) IS 'Anon-callable slot lookup. Validation unchanged and still complete (org by slug, then every id re-checked against it); only the arithmetic moved to private.compute_available_slots, which also excludes time blocks so a professional''s lunch is genuinely unbookable.';


--
-- Name: get_public_barber(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_barber(p_organization_slug text, p_barber_id uuid) RETURNS TABLE(barber_id uuid, professional_id uuid, display_name text, title text, bio text, avatar_url text, location_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    b.id,
    case when p.claim_state = 'claimed' then p.id else null end,
    sp.display_name,
    sp.title,
    sp.bio,
    sp.avatar_url,
    sp.location_id
  from public.barbers b
  left join public.professionals p on p.id = b.professional_id
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  join public.organizations o on o.id = b.organization_id
  where o.slug = p_organization_slug
    and b.id = p_barber_id
    and b.is_bookable
    and sp.is_active
    and sp.is_public;
$$;


--
-- Name: FUNCTION get_public_barber(p_organization_slug text, p_barber_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_public_barber(p_organization_slug text, p_barber_id uuid) IS 'Anon-callable operational barber profile scoped through organization_slug. professional_id is returned only when the linked durable Professional is claimed; NULL otherwise. No private follow state, customer data, claim workflow or acquisition provenance is exposed.';


--
-- Name: get_public_currencies(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_currencies(p_organization_ids uuid[]) RETURNS TABLE(organization_id uuid, currency text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select o.id, coalesce(o.currency, 'EUR')
  from public.organizations o
  where o.id = any(coalesce(p_organization_ids, array[]::uuid[]))
  -- Only shops that have chosen to be publicly listed. A private
  -- organization's existence must not be confirmable by probing this.
  and o.marketplace_visible;
$$;


--
-- Name: FUNCTION get_public_currencies(p_organization_ids uuid[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_public_currencies(p_organization_ids uuid[]) IS 'Currencies for a set of publicly listed organizations, so a marketplace list can price every card correctly in one round trip. Returns nothing for an id that is not publicly visible, so it cannot be used to probe for private organizations.';


--
-- Name: get_public_organization(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_organization(p_slug text) RETURNS TABLE(id uuid, name text, slug text, currency text, country_code text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select o.id, o.name, o.slug, coalesce(o.currency, 'EUR'), o.country_code
  from public.organizations o
  where o.slug = p_slug;
$$;


--
-- Name: FUNCTION get_public_organization(p_slug text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_public_organization(p_slug text) IS 'Public shop header, by slug. Now carries the shop''s own currency so its prices are quoted in the money its customers will actually pay — a London salon in GBP even to a visitor browsing from Paris. FadeUp performs no conversion, so this is the ONLY currency a price may be shown in.';


--
-- Name: get_public_professional(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_professional(p_professional_id uuid) RETURNS TABLE(id uuid, display_name text, handle text, headline text, bio text, avatar_url text, claim_state public.professional_claim_state, is_claimed boolean, follower_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         p.claim_state,
         p.claim_state = 'claimed',
         private.professional_follower_count(p.id)
  from public.professionals p
  where p.id = p_professional_id
    and p.is_public;
$$;


--
-- Name: FUNCTION get_public_professional(p_professional_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_public_professional(p_professional_id uuid) IS 'Anon-callable. THE public contract for a professional identity, claimed or not. is_public is the only visibility test: claim_state is returned, not filtered on, so the interface can render the neutral "not yet managed on FadeUp" badge instead of a 404 for a profile that exists. Projects identity columns only — no location, no availability, no queue, nothing operational — which is what makes it safe to serve an unclaimed profile through it. follower_count is real: MASTER_SPEC §5 allows follows before a claim, and that count is a genuine acquisition signal.';


--
-- Name: get_public_professional_by_handle(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_professional_by_handle(p_handle text) RETURNS TABLE(id uuid, display_name text, handle text, headline text, bio text, avatar_url text, claim_state public.professional_claim_state, is_claimed boolean, follower_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         p.claim_state,
         p.claim_state = 'claimed',
         private.professional_follower_count(p.id)
  from public.professionals p
  where p.handle is not null
    and lower(p.handle) = lower(btrim(coalesce(p_handle, '')))
    and p.is_public;
$$;


--
-- Name: FUNCTION get_public_professional_by_handle(p_handle text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_public_professional_by_handle(p_handle text) IS 'Anon-callable. Same contract and same shape as get_public_professional, addressed by the public handle. Serves claimed and unclaimed identities alike and returns claim_state with them.';


--
-- Name: get_public_queue_status(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_queue_status(p_organization_slug text, p_location_id uuid) RETURNS TABLE(id uuid, display_name text, status public.queue_status, queue_position integer, barber_display_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    q.id,
    btrim(split_part(q.customer_name, ' ', 1))
      || case when position(' ' in btrim(q.customer_name)) > 0
              then ' ' || left(split_part(q.customer_name, ' ', 2), 1) || '.'
              else '' end as display_name,
    q.status,
    case when q.status = 'waiting' then
      row_number() over (partition by q.status order by q.created_at)::integer
    else null end as queue_position,
    sp.display_name as barber_display_name
  from public.queue_entries q
  join public.organizations o on o.id = q.organization_id
  left join public.barbers b on b.id = q.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  where o.slug = p_organization_slug
    and q.location_id = p_location_id
    and q.status in ('waiting', 'called', 'in_service')
  order by
    case q.status when 'in_service' then 0 when 'called' then 1 else 2 end,
    q.created_at;
$$;


--
-- Name: FUNCTION get_public_queue_status(p_organization_slug text, p_location_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_public_queue_status(p_organization_slug text, p_location_id uuid) IS 'Anon-callable TV-mode display: active (waiting/called/in_service) queue entries for one location, with customer identity reduced to first-name + last-initial for public-screen privacy. Position is derived, not stored.';


--
-- Name: get_public_service_state(text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_service_state(p_organization_slug text, p_location_id uuid, p_barber_id uuid DEFAULT NULL::uuid) RETURNS TABLE(location_id uuid, barber_id uuid, effective_service_mode public.service_mode, mode_source text, mode_expires_at timestamp with time zone, mode_allows_booking boolean, mode_allows_queue boolean, queue_open boolean, queue_accepting_new_entries boolean, booking_accepting_new_entries boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_organization_id uuid;
  v_mode public.service_mode;
  v_source text;
  v_expires_at timestamptz;
  v_queue_open boolean;
begin
  select o.id into v_organization_id
  from public.organizations o
  where o.slug = p_organization_slug;
  if not found then
    return;
  end if;

  -- The location must belong to THAT organization and be operating. An
  -- inactive location is not a shop a customer can act on.
  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id
      and l.organization_id = v_organization_id
      and l.is_active
  ) then
    return;
  end if;

  -- If a barber was named they must be a real, public, bookable placement AT
  -- this establishment. This is the check that keeps unclaimed and external
  -- professionals out — they have no barbers row to satisfy it.
  if p_barber_id is not null and not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.is_public
      and sp.location_id = p_location_id
  ) then
    return;
  end if;

  select m.mode, m.source, m.expires_at
    into v_mode, v_source, v_expires_at
  from private.effective_service_mode(p_location_id, p_barber_id) m;

  select s.queue_open into v_queue_open
  from private.location_service_settings_effective(p_location_id) s;

  return query
  select
    p_location_id,
    p_barber_id,
    v_mode,
    v_source,
    -- The customer's client needs this to schedule its own refetch: an override
    -- that lapses on its own writes no row and therefore emits no realtime
    -- event, so a screen with no timer would sit on a stale answer until
    -- something else happened to invalidate it.
    v_expires_at,
    coalesce(private.mode_allows_booking(v_mode), false),
    coalesce(private.mode_allows_queue(v_mode), false),
    coalesce(v_queue_open, false),
    private.queue_admission_allowed(v_organization_id, p_location_id, p_barber_id),
    private.booking_admission_allowed(v_organization_id, p_location_id, p_barber_id);
end;
$$;


--
-- Name: FUNCTION get_public_service_state(p_organization_slug text, p_location_id uuid, p_barber_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_public_service_state(p_organization_slug text, p_location_id uuid, p_barber_id uuid) IS 'Anon-callable. What a public profile is allowed to offer right now: effective service mode, where that mode comes from, when it lapses, and whether booking and queue are actually admitting. Contains NO write — B1 removed an ensure_location_service_settings call that made PostgREST answer 405 (25006) to every caller, because a STABLE function runs in a READ ONLY transaction. Keep it that way: any write added here takes the public profile offline again.';


--
-- Name: get_service_mode_state(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_service_mode_state(p_location_id uuid) RETURNS TABLE(scope public.service_mode_scope, barber_id uuid, barber_display_name text, location_default_service_mode public.service_mode, barber_service_mode_override public.service_mode, effective_service_mode public.service_mode, mode_source text, mode_starts_at timestamp with time zone, mode_expires_at timestamp with time zone, queue_open boolean, mode_allows_booking boolean, mode_allows_queue boolean, booking_accepting_new_entries boolean, queue_accepting_new_entries boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_organization_id uuid;
begin
  select l.organization_id into v_organization_id
  from public.locations l
  where l.id = p_location_id;
  if not found then
    return;
  end if;

  -- Membership, derived from auth.uid(). Any member may READ the operating
  -- state of their own establishment — a barber needs to see that the shop is
  -- reservation_only this afternoon. Changing it is a different question,
  -- answered by private.assert_service_mode_authority in 20260826120400.
  if not (
    (select private.is_org_member(v_organization_id))
    or (select private.is_platform_admin())
  ) then
    return;
  end if;

  -- The establishment row.
  return query
  select
    'location'::public.service_mode_scope,
    null::uuid,
    null::text,
    s.default_service_mode,
    null::public.service_mode,
    m.mode,
    m.source,
    m.starts_at,
    m.expires_at,
    s.queue_open,
    coalesce(private.mode_allows_booking(m.mode), false),
    coalesce(private.mode_allows_queue(m.mode), false),
    private.booking_admission_allowed(v_organization_id, p_location_id, null),
    private.queue_admission_allowed(v_organization_id, p_location_id, null)
  from private.location_service_settings_effective(p_location_id) s
  cross join lateral private.effective_service_mode(p_location_id, null) m;

  -- One row per barber placed here. Inactive and non-public staff are included
  -- deliberately: this is the operator's own roster view, and a manager needs
  -- to see the mode of someone they are about to bring back on shift.
  return query
  select
    'barber'::public.service_mode_scope,
    b.id,
    sp.display_name,
    s.default_service_mode,
    b.service_mode_override,
    m.mode,
    m.source,
    m.starts_at,
    m.expires_at,
    s.queue_open,
    coalesce(private.mode_allows_booking(m.mode), false),
    coalesce(private.mode_allows_queue(m.mode), false),
    private.booking_admission_allowed(v_organization_id, p_location_id, b.id),
    private.queue_admission_allowed(v_organization_id, p_location_id, b.id)
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  cross join lateral private.location_service_settings_effective(p_location_id) s
  cross join lateral private.effective_service_mode(p_location_id, b.id) m
  where b.organization_id = v_organization_id
    and sp.location_id = p_location_id
  order by 3;
end;
$$;


--
-- Name: FUNCTION get_service_mode_state(p_location_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_service_mode_state(p_location_id uuid) IS 'Org-member only. The operator''s own view of service mode at one establishment: the location row, then one row per barber placed there. Contains NO write — B1 removed the same ensure_location_service_settings call that broke get_public_service_state over HTTP, for the same reason.';


--
-- Name: get_shared_passport(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_shared_passport(p_token text) RETURNS TABLE(status text, display_name text, usual_haircut text, fade_type text, side_length text, top_length text, beard_preferences text, preferences_notes text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_hash text;
  v_share public.customer_passport_shares;
begin
  v_hash := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select * into v_share from public.customer_passport_shares where token_hash = v_hash;

  if not found then
    return query select 'not_found'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  if v_share.revoked_at is not null then
    return query select 'revoked'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  if v_share.expires_at < now() then
    return query select 'expired'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  update public.customer_passport_shares set last_accessed_at = now() where id = v_share.id;

  return query
  select
    'active'::text,
    cp.display_name,
    p.usual_haircut,
    p.fade_type,
    p.side_length,
    p.top_length,
    p.beard_preferences,
    p.preferences_notes
  from public.customer_passports p
  left join public.customer_profiles cp on cp.user_id = p.user_id
  where p.user_id = v_share.user_id;
end;
$$;


--
-- Name: FUNCTION get_shared_passport(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_shared_passport(p_token text) IS 'Anon-callable. Verifies a share token by sha256 hash (never a raw lookup) and returns status active/expired/revoked/not_found plus curated Passport fields only when active. Never returns phone/email/internal notes/photos.';


--
-- Name: guard_customer_professional_relationship(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_customer_professional_relationship() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.customer_user_id is distinct from old.customer_user_id
     or new.professional_id is distinct from old.professional_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'the identity of a relationship is immutable; reconcile instead'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


--
-- Name: FUNCTION guard_customer_professional_relationship(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guard_customer_professional_relationship() IS 'BEFORE UPDATE invariant: a relationship row can never be repointed at a different customer, professional or organization. No role is exempt. Corrections happen by reconciliation, which recomputes from evidence rather than editing conclusions.';


--
-- Name: guard_customers_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_customers_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.user_id is not distinct from old.user_id then
    return new;
  end if;

  if (select auth.uid()) is null or (select private.is_platform_admin()) then
    return new;
  end if;

  raise exception 'customers.user_id identifies the account that owns this record and cannot be reassigned by a shop'
    using errcode = '42501';
end;
$$;


--
-- Name: FUNCTION guard_customers_identity(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guard_customers_identity() IS 'BEFORE UPDATE on customers: freezes user_id against client sessions. The column is set once, by private.resolve_customer_for_user, for the account that is actually acting; nothing else may re-point it. Server-side paths and platform admins pass, matching the existing application-guard convention.';


--
-- Name: guard_marketplace_publication(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_marketplace_publication() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_ready boolean;
  v_missing text[];
begin
  if new.marketplace_visible is not true or old.marketplace_visible is true then
    return new;
  end if;

  -- No JWT identity: operator SQL or a restore. Same documented escape hatch
  -- as guard_professional_application_update() and the organization-creation
  -- guard — never a client request.
  if (select auth.uid()) is null then
    return new;
  end if;

  select r.ready_to_publish, r.missing_requirements
    into v_ready, v_missing
    from public.get_organization_readiness(new.id) r;

  if not coalesce(v_ready, false) then
    raise exception 'this business is not ready to publish yet: missing %', array_to_string(v_missing, ', ')
      using errcode = '23514';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION guard_marketplace_publication(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guard_marketplace_publication() IS 'BEFORE UPDATE gate on organizations.marketplace_visible. Publishing requires get_organization_readiness().ready_to_publish; unpublishing is always allowed. Sits on the TABLE, so it covers the validated RPC and any direct client PATCH identically.';


--
-- Name: guard_passport_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_passport_identity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  -- The guard is on CHANGING a number, not on first issuing one. A row that
  -- predates R1B has passport_number NULL until the backfill in
  -- 20260826100600 fills it, and that NULL -> value write must be allowed or
  -- the migration deadlocks against its own invariant.
  --
  -- The allowance closes itself: the same MASTER transaction ends with
  -- passport_number NOT NULL, so from that moment `old.passport_number is
  -- null` is unreachable and this is an unconditional freeze. It is not a
  -- standing exemption, and it needs no GUC bypass to carve out.
  if old.passport_number is not null
     and new.passport_number is distinct from old.passport_number then
    raise exception 'a Fade Passport number is permanent and cannot be reassigned'
      using errcode = '42501';
  end if;
  if old.issued_at is not null and new.issued_at is distinct from old.issued_at then
    raise exception 'customer_passports.issued_at is server-owned'
      using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'a Fade Passport cannot be moved to another account'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


--
-- Name: FUNCTION guard_passport_identity(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guard_passport_identity() IS 'BEFORE UPDATE invariant on customer_passports. Freezes passport_number, issued_at and user_id against every caller. user_id is included because R1A had to leave it UPDATE-grantable for the PostgREST upsert''s ON CONFLICT SET list — the grant cannot distinguish "same value, resent by upsert" from "repointed at someone else", and this trigger can.';


--
-- Name: guard_professional_application_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_professional_application_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  -- No JWT identity at all means this is not a client request: a trusted
  -- server-side role, or a foreign-key cascade (deleting an organization
  -- sets organization_id to null here). Those must not be blocked — RLS and
  -- the EXECUTE grants are what keep anon/authenticated out of this path in
  -- the first place.
  if (select auth.uid()) is null then
    return new;
  end if;

  if (select private.is_platform_admin()) then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.organization_id is distinct from old.organization_id
     or new.rejection_reason is distinct from old.rejection_reason
     or new.internal_note is distinct from old.internal_note
     or new.user_id is distinct from old.user_id
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'only a platform reviewer can change the review state of an application';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION guard_professional_application_update(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guard_professional_application_update() IS 'Freezes review/ownership columns against everyone except platform admins. RLS scopes rows; this scopes columns, which an RLS policy cannot express.';


--
-- Name: guard_professional_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_professional_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_privileged boolean := coalesce(current_setting('fadeup.professional_claim_write', true), '') = 'on';
begin
  -- (A) account erasure: the RI trigger has just nulled user_id.
  --
  -- "user_id went to NULL" is NOT sufficient evidence on its own — a
  -- privileged caller could write exactly that by hand and thereby unclaim an
  -- identity the guard is supposed to protect. The distinguishing fact is that
  -- the ACCOUNT IS GONE: ON DELETE SET NULL runs after the auth.users row has
  -- been removed, so it is invisible here, whereas a hand-written detach
  -- leaves it standing.
  if old.user_id is not null and new.user_id is null then
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'professionals.user_id is set by the claim lifecycle, not by detaching a live account'
        using errcode = '42501';
    end if;
    new.claim_state := 'unclaimed';
    new.claimed_at  := null;
    new.is_public   := false;
    return new;
  end if;

  if v_privileged then
    return new;
  end if;

  if new.claim_state is distinct from old.claim_state then
    raise exception 'professionals.claim_state is set by the claim lifecycle, not directly'
      using errcode = '42501';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'professionals.user_id is set by the claim lifecycle, not directly'
      using errcode = '42501';
  end if;

  if new.claimed_at is distinct from old.claimed_at then
    raise exception 'professionals.claimed_at is server-owned'
      using errcode = '42501';
  end if;

  if new.source is distinct from old.source then
    raise exception 'professionals.source is provenance and is immutable'
      using errcode = '42501';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION guard_professional_identity(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guard_professional_identity() IS 'BEFORE UPDATE invariant on professionals. Translates the ON DELETE SET NULL detach into a coherent unclaimed row so account erasure never dead-ends, and otherwise freezes claim_state/user_id/claimed_at/source against every caller including service_role. Only the claim RPCs, which set fadeup.professional_claim_write, may move them.';


--
-- Name: guard_professional_publication(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_professional_publication() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_anchor text;
begin
  if not new.is_public then
    return new;
  end if;

  if new.claim_state = 'claimed' then
    return new;
  end if;

  -- On INSERT the row does not exist yet, so an anchor that lives in another
  -- table pointing BACK at this id cannot exist either. Publication of an
  -- unclaimed identity is therefore always a second step — mint, link, then
  -- publish — which is also how publish_external_professional behaves.
  if tg_op = 'INSERT' then
    raise exception 'an unclaimed professional identity cannot be created already public'
      using errcode = '42501',
            hint = 'Mint the identity, attach its evidence, then publish it.';
  end if;

  v_anchor := private.professional_publication_anchor(new.id);

  if v_anchor is null then
    raise exception 'this unclaimed professional identity has no publication anchor'
      using errcode = '42501',
            detail = 'fadeup_publication_refusal=no_anchor',
            hint = 'An unclaimed identity may be published only when it is attached to an organization (barbers) or backed by a prospect carrying a website domain or a located source record.';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION guard_professional_publication(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guard_professional_publication() IS 'BEFORE INSERT OR UPDATE on professionals. Holds the half of professionals_publication_eligibility that a CHECK cannot: an UNCLAIMED identity may only be public while a corroborating anchor exists. Claimed identities pass untouched — the account holder is the corroboration, and MASTER_SPEC §9 requires a claimed identity to survive having no employer.';


--
-- Name: handle_new_location_service_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_location_service_settings() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.location_service_settings (location_id, organization_id)
  values (new.id, new.organization_id)
  on conflict (location_id) do nothing;
  return new;
end;
$$;


--
-- Name: FUNCTION handle_new_location_service_settings(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.handle_new_location_service_settings() IS 'AFTER INSERT on locations: gives every new establishment its service-settings row with the compatibility default, so no later code path has to cope with a location that has none.';


--
-- Name: handle_new_membership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_membership() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_full_name text;
begin
  select p.full_name into v_full_name from public.profiles p where p.id = new.user_id;

  insert into public.staff_profiles (organization_id, user_id, display_name)
  values (new.organization_id, new.user_id, coalesce(nullif(btrim(v_full_name), ''), 'Team member'))
  on conflict (organization_id, user_id) do nothing;

  return new;
end;
$$;


--
-- Name: FUNCTION handle_new_membership(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.handle_new_membership() IS 'Trigger function on memberships: auto-creates the matching staff_profiles row so every member has one.';


--
-- Name: handle_new_organization(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_organization() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  -- Set only by review_professional_application, for the single statement
  -- that creates an approved applicant's organization. current_setting(...,
  -- true) returns null rather than raising when the GUC was never set, so
  -- every ordinary path is unaffected.
  if coalesce(current_setting('fadeup.skip_org_owner_membership', true), '') = 'on' then
    return new;
  end if;

  if (select auth.uid()) is not null then
    insert into public.memberships (organization_id, user_id, role)
    values (new.id, (select auth.uid()), 'owner')
    on conflict (organization_id, user_id) do nothing;
  end if;
  return new;
end;
$$;


--
-- Name: FUNCTION handle_new_organization(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.handle_new_organization() IS 'Makes the creating user the owner of a newly created organization. Stands down when fadeup.skip_org_owner_membership = on, which review_professional_application sets so that approving an application makes the APPLICANT the owner rather than the reviewing platform admin.';


--
-- Name: handle_new_organization_commercial_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_organization_commercial_state() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.ensure_organization_commercial_state(new.id);

  insert into public.commercial_plan_changes
    (organization_id, previous_plan_key, new_plan_key,
     previous_status, new_status, entitlement_source, changed_by, change_reason)
  values
    (new.id, null, 'free', null, 'active', 'early_access', null,
     'Automatic default state for a newly created organization.');

  return new;
end;
$$;


--
-- Name: FUNCTION handle_new_organization_commercial_state(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.handle_new_organization_commercial_state() IS 'AFTER INSERT on organizations: gives the new organization its default free/active commercial state and opens its audit trail. A separate trigger from handle_new_organization() so the two concerns — who owns this shop, what has this shop paid for — stay independently reviewable and independently revertible.';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    -- Email/password signup sends full_name; Google sends both full_name and
    -- name; Apple sends name at most once. Any of them may be absent.
    coalesce(
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), '')
    ),
    -- Google uses picture; the signup form and some providers use avatar_url.
    coalesce(
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), ''),
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'picture', '')), '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


--
-- Name: FUNCTION handle_new_user(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.handle_new_user() IS 'Trigger on auth.users: creates the matching public.profiles row. Reads raw_user_meta_data for DISPLAY FIELDS ONLY (name, avatar) — never for authorization. Tolerates providers that supply neither, which is normal for Sign in with Apple. INSERT-only, so a later sign-in carrying no name can never overwrite a name the user has set.';


--
-- Name: join_public_queue(text, uuid, text, text, uuid, uuid, text, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_public_queue(p_organization_slug text, p_location_id uuid, p_customer_name text, p_customer_phone text DEFAULT NULL::text, p_barber_id uuid DEFAULT NULL::uuid, p_service_id uuid DEFAULT NULL::uuid, p_check_in_token text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision) RETURNS TABLE(id uuid, status public.queue_status, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_organization_id uuid;
  v_entry public.queue_entries;
  v_user_id uuid;
  v_customer_id uuid;
  v_location public.locations;
  v_geofence_meters integer;
  v_distance_meters double precision;
  v_waiting integer;
  v_capacity integer;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  select l.* into v_location
  from public.locations l
  where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;

  if not found then
    raise exception 'location is not available';
  end if;

  -- (a) A zone has no queue. Decided and explained in this file's header.
  if v_location.kind = 'service_area' then
    raise exception 'this professional works in a service area and has no live queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=service_area_has_no_queue',
            hint = 'A live queue is a line of people at an address. Book a slot instead.';
  end if;

  -- (b) The QR token. Compared against THIS establishment's value, so a token
  -- scanned in one shop cannot be replayed against another.
  if nullif(btrim(coalesce(p_check_in_token, '')), '') is null
     or lower(btrim(p_check_in_token)) <> v_location.queue_check_in_token then
    raise exception 'the check-in code for this establishment is missing or invalid'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=invalid_check_in_token',
            hint = 'Scan the QR code displayed in the shop.';
  end if;

  -- (c) The geofence, measured here and nowhere else. A client that computes
  -- its own distance and sends a verdict is a client that can send true.
  if v_location.latitude is null or v_location.longitude is null then
    raise exception 'this establishment has not published its position, so presence cannot be verified'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=location_not_geolocated',
            hint = 'The establishment must set its coordinates before the live queue can admit anyone.';
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception 'your position is required to join the queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=position_required',
            hint = 'Joining a live queue requires being at the shop.';
  end if;

  select s.queue_geofence_meters into v_geofence_meters
  from public.location_service_settings s
  where s.location_id = p_location_id;
  v_geofence_meters := coalesce(v_geofence_meters, 150);

  v_distance_meters := private.point_distance_km(
    p_latitude, p_longitude, v_location.latitude, v_location.longitude
  ) * 1000.0;

  if v_distance_meters is null or v_distance_meters > v_geofence_meters then
    raise exception 'you are too far from this establishment to join its queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=too_far',
            hint = format('The live queue admits customers within %s m.', v_geofence_meters);
  end if;

  if p_barber_id is not null and not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.is_public
  ) then
    raise exception 'requested barber is not available';
  end if;

  if p_service_id is not null and not exists (
    select 1 from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
  ) then
    raise exception 'requested service is not available';
  end if;

  -- (d) Is the line open at all. The enforce_queue_service_mode trigger checks
  -- this too and is the guarantee; asking here turns its generic refusal into
  -- one of the named codes P2 can branch on.
  if not private.queue_admission_allowed(v_organization_id, p_location_id, p_barber_id) then
    raise exception 'this queue is not accepting new entries right now'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=queue_closed';
  end if;

  -- (e) Capacity.
  v_waiting  := private.queue_waiting_count(p_location_id, p_barber_id);
  v_capacity := private.queue_capacity(p_location_id, p_barber_id);
  if v_capacity is not null and v_waiting >= v_capacity then
    raise exception 'this queue is full'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=queue_full',
            hint = format('%s people are already waiting.', v_waiting);
  end if;

  v_user_id := (select auth.uid());

  -- (f) One line at a time. A signed-in customer is matched on their account,
  -- which is exact. An anonymous kiosk check-in can only be matched on the
  -- phone number they typed, at this establishment — weaker, and honestly so:
  -- an anonymous customer who gives a different number each time is not
  -- detectable here, and the QR plus the geofence are what stand in the way.
  if v_user_id is not null and exists (
    select 1 from public.queue_entries qe
    where qe.booked_by_user_id = v_user_id
      and qe.status in ('waiting', 'called', 'in_service')
  ) then
    raise exception 'you are already in a queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=already_in_queue';
  end if;

  if v_user_id is null
     and nullif(btrim(coalesce(p_customer_phone, '')), '') is not null
     and exists (
       select 1 from public.queue_entries qe
       where qe.location_id = p_location_id
         and qe.customer_phone = btrim(p_customer_phone)
         and qe.status in ('waiting', 'called', 'in_service')
     ) then
    raise exception 'you are already in a queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=already_in_queue';
  end if;

  -- Signed-in walk-in: attach the entry to the caller's OWN customer record
  -- for this shop so get_my_queue_status can find it. Anonymous kiosk
  -- check-in leaves this null and behaves exactly as before.
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, null
    );
  end if;

  insert into public.queue_entries (organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, status, created_by, booked_by_user_id)
  values (v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id, btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), 'waiting', null, v_user_id)
  returning * into v_entry;

  return query select v_entry.id, v_entry.status, v_entry.created_at;
end;
$$;


--
-- Name: FUNCTION join_public_queue(p_organization_slug text, p_location_id uuid, p_customer_name text, p_customer_phone text, p_barber_id uuid, p_service_id uuid, p_check_in_token text, p_latitude double precision, p_longitude double precision); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.join_public_queue(p_organization_slug text, p_location_id uuid, p_customer_name text, p_customer_phone text, p_barber_id uuid, p_service_id uuid, p_check_in_token text, p_latitude double precision, p_longitude double precision) IS 'Anon-callable. Joins the live queue of an establishment, and since B1 requires PROOF OF PRESENCE to do it: the QR token displayed in the shop plus coordinates within the establishment''s geofence (150 m by default, per-salon). Both are verified on the server, so calling the REST API directly is exactly as constrained as using the app. Both are also defeatable by a determined person — a photographed QR, a spoofed position — and nothing downstream should treat a queue entry as evidence that someone was physically present. Refusals carry DETAIL fadeup_queue_refusal=<code>: service_area_has_no_queue, invalid_check_in_token, location_not_geolocated, position_required, too_far, queue_closed, queue_full, already_in_queue.';


--
-- Name: link_customer_from_contact_info(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_customer_from_contact_info() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_customer_id uuid;
  -- This trigger is shared across appointments (which has customer_email)
  -- and queue_entries (which does not — walk-ins are phone-only). new.<col>
  -- is resolved against the row type of whichever table fired the trigger,
  -- so a bare `new.customer_email` reference throws "record new has no
  -- field customer_email" the moment this fires on queue_entries. Going
  -- through to_jsonb(new) sidesteps that: a missing key just yields NULL.
  v_customer_phone text := (to_jsonb(new) ->> 'customer_phone');
  v_customer_email text := (to_jsonb(new) ->> 'customer_email');
begin
  if new.customer_id is not null then
    if not exists (
      select 1 from public.customers c
      where c.id = new.customer_id and c.organization_id = new.organization_id
    ) then
      raise exception 'customer_id must belong to the same organization_id';
    end if;
    return new;
  end if;

  if v_customer_phone is null and v_customer_email is null then
    return new;
  end if;

  if v_customer_phone is not null then
    select id into v_customer_id from public.customers
      where organization_id = new.organization_id and phone = v_customer_phone
        and user_id is null
      limit 1;
  end if;

  if v_customer_id is null and v_customer_email is not null then
    select id into v_customer_id from public.customers
      where organization_id = new.organization_id and lower(email) = lower(v_customer_email)
        and user_id is null
      limit 1;
  end if;

  if v_customer_id is null then
    insert into public.customers (organization_id, name, phone, email)
    values (new.organization_id, new.customer_name, v_customer_phone, v_customer_email)
    on conflict do nothing
    returning id into v_customer_id;

    -- A concurrent booking may have won the customers_org_phone_unique /
    -- customers_org_email_unique race between our SELECT and INSERT above
    -- (ON CONFLICT DO NOTHING then returns no row) — re-select rather than
    -- leave this booking unlinked over a benign, expected race.
    if v_customer_id is null then
      if v_customer_phone is not null then
        select id into v_customer_id from public.customers
          where organization_id = new.organization_id and phone = v_customer_phone
            and user_id is null limit 1;
      end if;
      if v_customer_id is null and v_customer_email is not null then
        select id into v_customer_id from public.customers
          where organization_id = new.organization_id and lower(email) = lower(v_customer_email)
            and user_id is null limit 1;
      end if;
    end if;
  end if;

  new.customer_id := v_customer_id;
  return new;
end;
$$;


--
-- Name: FUNCTION link_customer_from_contact_info(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.link_customer_from_contact_info() IS 'BEFORE INSERT trigger: find-or-create a customers row matched by phone then email, and set customer_id. Only fires when customer_id is null; validates an explicitly-supplied customer_id belongs to the same org instead. INSERT-only, not a general resync — a later contact-info edit does not retroactively relink.';


--
-- Name: list_my_followed_organizations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_my_followed_organizations() RETURNS TABLE(organization_id uuid, followed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  return query
  select
    f.organization_id,
    f.followed_at
  from public.organization_follows f
  join public.organizations o
    on o.id = f.organization_id
  where f.follower_user_id = v_user_id
    and f.is_following = true
    and exists (
      select 1
      from public.get_public_organization(o.slug::text)
    )
  order by f.followed_at desc nulls last;
end;
$$;


--
-- Name: FUNCTION list_my_followed_organizations(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.list_my_followed_organizations() IS 'Returns the authenticated customer current active barbershop follows.';


--
-- Name: list_my_followed_professionals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_my_followed_professionals() RETURNS TABLE(id uuid, display_name text, handle text, headline text, avatar_url text, followed_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p.id, p.display_name, p.handle, p.headline, p.avatar_url, f.followed_at
  from public.professional_follows f
  join public.professionals p on p.id = f.professional_id
  where f.follower_user_id = (select auth.uid())
    and f.state = 'following'
  order by f.followed_at desc;
$$;


--
-- Name: FUNCTION list_my_followed_professionals(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.list_my_followed_professionals() IS 'Authenticated-only. The caller''s own follow list, resolved to identities. Takes NO parameter, so there is nothing to forge — the follower is always auth.uid(). Deliberately does not filter on is_public: a customer who followed a professional keeps seeing them if the professional later goes private, which is their own relationship rather than a public listing.';


--
-- Name: list_public_barber_services(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_public_barber_services(p_organization_slug text, p_barber_id uuid) RETURNS TABLE(id uuid, name text, duration_minutes integer, price_cents integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select s.id, s.name, s.duration_minutes, s.price_cents
  from public.services s
  join public.barber_services bs on bs.service_id = s.id
  join public.barbers b on b.id = bs.barber_id
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  join public.organizations o on o.id = b.organization_id
  where o.slug = p_organization_slug
    and b.id = p_barber_id
    and b.is_bookable
    and sp.is_active
    and sp.is_public
    and s.is_active
  order by s.name;
$$;


--
-- Name: FUNCTION list_public_barber_services(p_organization_slug text, p_barber_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.list_public_barber_services(p_organization_slug text, p_barber_id uuid) IS 'Anon-callable: active services a public, bookable barber performs, by organization_slug. Same eligibility gating as get_public_barber — zero rows if the barber is not public.';


--
-- Name: list_public_barbers(text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_public_barbers(p_organization_slug text, p_location_id uuid, p_service_id uuid) RETURNS TABLE(barber_id uuid, display_name text, title text, bio text, avatar_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select b.id, sp.display_name, sp.title, sp.bio, sp.avatar_url
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  join public.organizations o on o.id = b.organization_id
  join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
  where o.slug = p_organization_slug
    and b.is_bookable
    and sp.is_active
    and sp.is_public
    and sp.location_id = p_location_id
  order by sp.display_name;
$$;


--
-- Name: FUNCTION list_public_barbers(p_organization_slug text, p_location_id uuid, p_service_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.list_public_barbers(p_organization_slug text, p_location_id uuid, p_service_id uuid) IS 'Anon-callable: bookable, public staff_profiles-visible barbers eligible (via barber_services) for p_service_id, whose primary location is p_location_id, by organization slug.';


--
-- Name: list_public_locations(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_public_locations(p_organization_slug text) RETURNS TABLE(id uuid, name text, kind public.location_kind, address_line1 text, address_line2 text, city text, region text, postal_code text, country text, timezone text, service_area_center_latitude double precision, service_area_center_longitude double precision, service_area_radius_km double precision)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select l.id, l.name, l.kind,
         l.address_line1, l.address_line2, l.city, l.region, l.postal_code, l.country,
         l.timezone,
         l.service_area_center_latitude, l.service_area_center_longitude, l.service_area_radius_km
  from public.locations l
  join public.organizations o on o.id = l.organization_id
  where o.slug = p_organization_slug and l.is_active;
$$;


--
-- Name: FUNCTION list_public_locations(p_organization_slug text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.list_public_locations(p_organization_slug text) IS 'Anon-callable. The public establishments of an organization. kind says which of the two shapes the row is: a physical_address carries street lines, a service_area carries a centre and a radius and NEVER an address (locations_service_area_has_no_address makes that structural). A consumer renders an address for the first and a covered zone for the second; there is no third case to guess at.';


--
-- Name: list_public_organization_barbers(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_public_organization_barbers(p_organization_slug text) RETURNS TABLE(barber_id uuid, professional_id uuid, display_name text, title text, avatar_url text, location_id uuid, location_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    b.id,
    case when p.claim_state = 'claimed' then p.id else null end,
    sp.display_name,
    sp.title,
    sp.avatar_url,
    l.id,
    l.name
  from public.barbers b
  left join public.professionals p on p.id = b.professional_id
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  join public.organizations o on o.id = b.organization_id
  left join public.locations l on l.id = sp.location_id and l.is_active
  where o.slug = p_organization_slug
    and b.is_bookable
    and sp.is_active
    and sp.is_public
  order by sp.display_name;
$$;


--
-- Name: FUNCTION list_public_organization_barbers(p_organization_slug text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.list_public_organization_barbers(p_organization_slug text) IS 'Anon-callable public shop roster. professional_id is exposed only for a claimed durable Professional identity; it is NULL for an operational barber without a currently claimed identity. The id is a public relationship key, not operational state.';


--
-- Name: list_public_services(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_public_services(p_organization_slug text, p_location_id uuid) RETURNS TABLE(id uuid, category_id uuid, category_name text, name text, description text, duration_minutes integer, price_cents integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select s.id, s.category_id, sc.name, s.name, s.description, s.duration_minutes, s.price_cents
  from public.services s
  join public.organizations o on o.id = s.organization_id
  join public.service_locations sl on sl.service_id = s.id and sl.location_id = p_location_id
  left join public.service_categories sc on sc.id = s.category_id
  where o.slug = p_organization_slug and s.is_active
  order by coalesce(sc.display_order, 0), s.name;
$$;


--
-- Name: FUNCTION list_public_services(p_organization_slug text, p_location_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.list_public_services(p_organization_slug text, p_location_id uuid) IS 'Anon-callable: active services actually offered at p_location_id (via service_locations), by organization slug. p_location_id is validated implicitly by the join — a location from another org simply yields zero rows.';


--
-- Name: mark_all_notifications_read(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_all_notifications_read() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare v_count integer;
begin
  with updated as (
    update public.notifications n set read_at = now()
      where n.user_id = (select auth.uid()) and n.read_at is null
      returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;


--
-- Name: mark_all_platform_notifications_read(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_all_platform_notifications_read() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_count integer;
begin
  with updated as (
    update public.platform_notifications n
      set read_at = now()
      where n.recipient_user_id = (select auth.uid()) and n.read_at is null
      returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;


--
-- Name: mark_appointment_no_show(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_appointment_no_show(p_appointment_id uuid) RETURNS public.appointments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  if not (
    (select private.can_manage_appointments(v_appointment.organization_id))
    or (select private.is_own_barber(v_appointment.barber_id))
  ) then
    raise exception 'not authorized to manage this appointment' using errcode = '42501';
  end if;

  if v_appointment.status = 'no_show' then
    return v_appointment;
  end if;

  if v_appointment.status <> 'confirmed' then
    raise exception 'only a confirmed appointment can be marked as a no-show' using errcode = '22023';
  end if;

  -- no_show is already in the exclusion predicate, so this releases the slot
  -- exactly as a cancellation does. No resolution is set: the status IS the
  -- explanation, and resolution describes why something was cancelled.
  update public.appointments
    set status = 'no_show', decided_at = now(), decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  return v_appointment;
end;
$$;


--
-- Name: FUNCTION mark_appointment_no_show(p_appointment_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.mark_appointment_no_show(p_appointment_id uuid) IS 'Marks a confirmed appointment as a no-show, releasing the slot through the existing exclusion predicate. No fee, no charge, no notification — that is LOT K and a product decision, not a side effect of recording what happened.';


--
-- Name: mark_notification_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_notification_read(p_notification_id uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  update public.notifications n
    set read_at = coalesce(n.read_at, now())
    where n.id = p_notification_id and n.user_id = (select auth.uid());
$$;


--
-- Name: FUNCTION mark_notification_read(p_notification_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.mark_notification_read(p_notification_id uuid) IS 'Marks one of the caller''s own notifications read. security invoker on purpose — the RLS update policy is the check, not a second one written here.';


--
-- Name: mark_platform_notification_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_platform_notification_read(p_notification_id uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  update public.platform_notifications n
    set read_at = coalesce(n.read_at, now())
    where n.id = p_notification_id and n.recipient_user_id = (select auth.uid());
$$;


--
-- Name: FUNCTION mark_platform_notification_read(p_notification_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.mark_platform_notification_read(p_notification_id uuid) IS 'Marks one of the caller''s own notifications read. security invoker on purpose — the RLS update policy is the check.';


--
-- Name: my_organization_has_capability(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_organization_has_capability(p_organization_id uuid, p_capability text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    (select auth.uid()) is not null
    and p_organization_id is not null
    and (
      (select private.is_org_member(p_organization_id))
      or (select private.is_platform_admin())
    )
    and private.org_has_capability(p_organization_id, p_capability);
$$;


--
-- Name: FUNCTION my_organization_has_capability(p_organization_id uuid, p_capability text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.my_organization_has_capability(p_organization_id uuid, p_capability text) IS 'One boolean about one organization the caller belongs to. Returns false — never raises — for a non-member, a non-existent organization, a plan without the capability, and a capability that does not exist, so all four are indistinguishable and it leaks nothing. Frontend gating is UX: this exists so the UI can show, hide, disable and EXPLAIN consistently with what the database will actually allow, not so it can be the thing that allows it.';


--
-- Name: normalize_invitation_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_invitation_email() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;


--
-- Name: normalize_phone_number(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_phone_number(p_raw text, p_country text DEFAULT 'FR'::text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare
  v_cleaned text;
  v_calling_code text;
  v_national text;
  v_candidate text;
begin
  if p_raw is null then
    return null;
  end if;

  -- Strip everything a human might type as separators.
  v_cleaned := regexp_replace(btrim(p_raw), '[\s().\-]', '', 'g');
  if v_cleaned = '' then
    return null;
  end if;

  if v_cleaned ~ '^\+[1-9][0-9]{6,14}$' then
    return v_cleaned;
  end if;

  if v_cleaned ~ '^00[1-9][0-9]{6,14}$' then
    v_candidate := '+' || substring(v_cleaned from 3);
    return case when v_candidate ~ '^\+[1-9][0-9]{6,14}$' then v_candidate else null end;
  end if;

  -- Anything else with a + in it is malformed rather than national.
  if position('+' in v_cleaned) > 0 then
    return null;
  end if;

  if v_cleaned !~ '^[0-9]+$' then
    return null;
  end if;

  v_calling_code := case upper(coalesce(p_country, 'FR'))
    when 'FR' then '33' when 'BE' then '32' when 'CH' then '41' when 'LU' then '352'
    when 'MC' then '377' when 'GB' then '44' when 'US' then '1' when 'CA' then '1'
    when 'DE' then '49' when 'ES' then '34' when 'IT' then '39' when 'NL' then '31'
    when 'PT' then '351' else null end;
  if v_calling_code is null then
    return null;
  end if;

  v_national := regexp_replace(v_cleaned, '^0', '');
  if char_length(v_national) < 6 or char_length(v_national) > 14 then
    return null;
  end if;

  v_candidate := '+' || v_calling_code || v_national;
  return case when v_candidate ~ '^\+[1-9][0-9]{6,14}$' then v_candidate else null end;
end;
$_$;


--
-- Name: FUNCTION normalize_phone_number(p_raw text, p_country text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.normalize_phone_number(p_raw text, p_country text) IS 'Normalizes a typed phone number to E.164, mirroring apps/prospect-worker-v2/src/normalize/phone.ts. Returns null when it cannot be normalized confidently rather than guessing.';


--
-- Name: notify_new_appointment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_new_appointment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status = 'pending' then
    -- Legacy / explicit-approval path, unchanged.
    perform private.emit_booking_notification(
      new, 'booking_request_created', 'business',
      'New booking request', new.customer_name, 'booking_request_created');
    return new;
  end if;

  if new.status = 'confirmed' then
    -- The shop learns it has a booking...
    perform private.emit_booking_notification(
      new, 'booking_confirmed', 'business',
      'New booking', new.customer_name, null, ':new');

    -- ...and the customer learns it is confirmed. Distinct dedupe suffixes so
    -- these two never collide on the unique dedupe_key, and so a later
    -- staff-side confirm_booking_request on the same appointment cannot be
    -- swallowed by this row.
    perform private.emit_booking_notification(
      new, 'booking_confirmed', 'customer',
      'Booking confirmed', new.customer_name, 'booking_confirmed', ':new');
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION notify_new_appointment(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.notify_new_appointment() IS 'Fires once when an appointment is created. A pending row still announces a REQUEST to the business (legacy path). A confirmed row announces a BOOKING to the business and a CONFIRMATION to the customer — never both a request and a confirmation for the same booking. Email intents go to email_outbox, so SMTP being down can never roll back a booking.';


--
-- Name: notify_new_invitation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_new_invitation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org_name text;
  v_inviter text;
begin
  select o.name into v_org_name from public.organizations o where o.id = new.organization_id;
  select p.full_name into v_inviter from public.profiles p where p.id = new.invited_by;

  insert into public.email_outbox (to_email, template, payload)
  values (
    new.email,
    'team_invitation',
    jsonb_build_object(
      'invitation_id', new.id,
      'organization_name', v_org_name,
      'role', new.role,
      'invited_by', v_inviter,
      'expires_at', new.expires_at,
      -- Path only. The dispatcher prepends the canonical FadeUp origin and
      -- appends the token it reads from public.invitations under its own
      -- privileged connection.
      'accept_path', '/invite/'
    )
  );
  return new;
end;
$$;


--
-- Name: FUNCTION notify_new_invitation(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.notify_new_invitation() IS 'AFTER INSERT on invitations: queues the invitation email. Deliberately omits the raw token from the payload — platform staff can read email_outbox to observe delivery failures, and an invitation token is not theirs to see.';


--
-- Name: offboard_barber(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.offboard_barber(p_barber_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid;
  v_sp uuid;
begin
  select organization_id, staff_profile_id into v_org, v_sp
  from public.barbers where id = p_barber_id;

  if v_org is null then
    raise exception 'barber not found' using errcode = '42704';
  end if;

  if not (select private.has_org_role(v_org, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to manage this roster' using errcode = '42501';
  end if;

  update public.barbers set is_bookable = false where id = p_barber_id;
  update public.staff_profiles set is_active = false, is_public = false where id = v_sp;
end;
$$;


--
-- Name: FUNCTION offboard_barber(p_barber_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.offboard_barber(p_barber_id uuid) IS 'Owner/manager only. The supported way to remove a professional from a roster: makes them unbookable and removes them from public surfaces, while leaving their appointment history intact. Deleting the barbers row is no longer possible once history exists (ON DELETE RESTRICT) and was never the intended path.';


--
-- Name: outreach_block_reason(uuid, public.outreach_channel_kind); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.outreach_block_reason(p_prospect_id uuid, p_channel public.outreach_channel_kind) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_prospect public.prospects;
  v_elig public.prospect_outreach_eligibility;
  v_policy public.outreach_channel_policies;
  v_locale text;
begin
  select * into v_prospect from public.prospects where id = p_prospect_id;
  if not found then
    return 'prospect_not_found';
  end if;

  -- Global Do Not Contact, from the pre-existing suppression system.
  if v_prospect.do_not_contact then
    return 'do_not_contact';
  end if;

  if exists (
    select 1 from public.prospect_suppressions
    where scope = 'prospect' and prospect_id = p_prospect_id
  ) then
    return 'suppressed_prospect';
  end if;

  if v_prospect.phone_e164 is not null
     and private.is_prospect_value_suppressed('phone', v_prospect.phone_e164) then
    return 'suppressed_phone';
  end if;

  if v_prospect.email is not null
     and private.is_prospect_value_suppressed('email', v_prospect.email) then
    return 'suppressed_email';
  end if;

  -- Already ours: never continue cold acquisition after conversion
  -- (spec §43/§44).
  if v_prospect.converted_organization_id is not null then
    return 'already_converted';
  end if;

  if v_prospect.status in ('customer', 'trial') then
    return 'already_customer';
  end if;

  -- Channel eligibility.
  select * into v_elig
  from public.prospect_outreach_eligibility
  where prospect_id = p_prospect_id and channel = p_channel;

  if not found then
    return 'no_eligibility_record';
  end if;

  if v_elig.do_not_contact then
    return 'channel_do_not_contact';
  end if;

  if v_elig.opt_in_status = 'withdrawn' or v_elig.opted_out_at is not null then
    return 'opted_out';
  end if;

  if v_elig.destination_invalid then
    return 'destination_invalid';
  end if;

  if not v_elig.is_eligible then
    return 'not_eligible';
  end if;

  if v_elig.destination is null or btrim(v_elig.destination) = '' then
    return 'no_destination';
  end if;

  -- Operator-declared consent policy for the prospect's country.
  select * into v_policy
  from public.outreach_channel_policies
  where channel = p_channel and country = v_prospect.country;

  if found and v_policy.requires_explicit_opt_in and v_elig.opt_in_status <> 'confirmed' then
    return 'opt_in_required';
  end if;

  -- Locale must be resolved: sending the wrong language is a hard block,
  -- never a silent default (spec §25).
  v_locale := public.prospect_effective_locale(p_prospect_id);
  if v_locale is null then
    return 'locale_unresolved';
  end if;

  if exists (
    select 1 from public.prospect_locales
    where prospect_id = p_prospect_id
      and language_review_required
      and override_locale is null
  ) then
    return 'locale_review_required';
  end if;

  return null;
end;
$$;


--
-- Name: FUNCTION outreach_block_reason(p_prospect_id uuid, p_channel public.outreach_channel_kind); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.outreach_block_reason(p_prospect_id uuid, p_channel public.outreach_channel_kind) IS 'NULL = contactable. Otherwise a machine-readable block reason. Single source of truth for the eligibility gate: used by the recipient trigger (enforcement), by /platform (preview), and by VERIFY (assertion).';


--
-- Name: booking_provider_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_provider_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    detection_method public.booking_provider_detection_method NOT NULL,
    evidence text,
    evidence_url text,
    confidence numeric(4,3) NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    job_id uuid,
    is_current boolean DEFAULT true NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    booking_status public.booking_availability_status DEFAULT 'UNKNOWN'::public.booking_availability_status NOT NULL,
    CONSTRAINT booking_provider_observations_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT booking_provider_observations_evidence_check CHECK (((evidence IS NULL) OR (length(evidence) <= 2000))),
    CONSTRAINT booking_provider_observations_evidence_url_check CHECK (((evidence_url IS NULL) OR (length(evidence_url) <= 2000)))
);

ALTER TABLE ONLY public.booking_provider_observations FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE booking_provider_observations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_provider_observations IS 'Append-only history of which booking product a prospect was observed using, with evidence + confidence. Never collapsed into a single boolean — see spec §13 (migration intelligence depends on the history).';


--
-- Name: COLUMN booking_provider_observations.booking_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_provider_observations.booking_status IS 'Set only by an observation that actually read the provider''s public establishment page. A detection made from the business''s own website leaves this UNKNOWN, because a link to Planity is evidence of a relationship and says nothing about whether bookings are open.';


--
-- Name: override_prospect_booking_provider(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.override_prospect_booking_provider(p_prospect_id uuid, p_provider_key text, p_note text DEFAULT NULL::text) RETURNS public.booking_provider_observations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_provider_id uuid;
  v_observation public.booking_provider_observations;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'override_prospect_booking_provider: platform admin role required' using errcode = '42501';
  end if;

  select id into v_provider_id from public.booking_providers where key = p_provider_key;
  if v_provider_id is null then
    raise exception 'override_prospect_booking_provider: unknown provider key %', p_provider_key
      using errcode = 'check_violation';
  end if;

  insert into public.booking_provider_observations (
    prospect_id, provider_id, detection_method, evidence, confidence, is_current
  )
  values (p_prospect_id, v_provider_id, 'manual_override', p_note, 1.0, true)
  returning * into v_observation;

  -- The maintain_current trigger may have folded this into an existing
  -- current row (same provider re-asserted); return whichever row is
  -- actually current now.
  if v_observation is null then
    select * into v_observation
    from public.booking_provider_observations
    where prospect_id = p_prospect_id and provider_id = v_provider_id and is_current
    limit 1;
  end if;

  return v_observation;
end;
$$;


--
-- Name: prospect_locales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_locales (
    prospect_id uuid NOT NULL,
    detected_country text,
    detected_language text,
    locale text,
    language_source public.prospect_locale_source,
    language_confidence numeric(4,3),
    language_review_required boolean DEFAULT false NOT NULL,
    override_locale text,
    override_by uuid,
    override_at timestamp with time zone,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_locales_detected_country_check CHECK (((detected_country IS NULL) OR (detected_country ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT prospect_locales_detected_language_check CHECK (((detected_language IS NULL) OR (detected_language ~ '^[a-z]{2}$'::text))),
    CONSTRAINT prospect_locales_language_confidence_check CHECK (((language_confidence IS NULL) OR ((language_confidence >= (0)::numeric) AND (language_confidence <= (1)::numeric)))),
    CONSTRAINT prospect_locales_locale_check CHECK (((locale IS NULL) OR (locale ~ '^[a-z]{2}-[A-Z]{2}$'::text))),
    CONSTRAINT prospect_locales_override_locale_check CHECK (((override_locale IS NULL) OR (override_locale ~ '^[a-z]{2}-[A-Z]{2}$'::text)))
);

ALTER TABLE ONLY public.prospect_locales FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_locales; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_locales IS 'Deterministic locale determination + optional human override. language_review_required = true when evidence was ambiguous; outreach template selection treats an unresolved locale as a hard block, never a guess.';


--
-- Name: override_prospect_locale(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.override_prospect_locale(p_prospect_id uuid, p_locale text) RETURNS public.prospect_locales
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_row public.prospect_locales;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'override_prospect_locale: platform admin role required' using errcode = '42501';
  end if;

  if p_locale is not null and p_locale !~ '^[a-z]{2}-[A-Z]{2}$' then
    raise exception 'override_prospect_locale: % is not a valid locale (expected e.g. fr-FR)', p_locale
      using errcode = 'check_violation';
  end if;

  insert into public.prospect_locales (prospect_id, override_locale, override_by, override_at)
  values (p_prospect_id, p_locale, (select auth.uid()), now())
  on conflict (prospect_id) do update
  set override_locale = excluded.override_locale,
      override_by = excluded.override_by,
      override_at = excluded.override_at
  returning * into v_row;

  return v_row;
end;
$_$;


--
-- Name: ml_model_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_model_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_key text NOT NULL,
    model_version text NOT NULL,
    model_type text NOT NULL,
    target public.ml_model_target NOT NULL,
    feature_schema_version text NOT NULL,
    training_dataset_version text,
    hyperparameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    artifact_path text,
    artifact_sha256 text,
    random_seed integer DEFAULT 42 NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    promoted_by uuid,
    promoted_at timestamp with time zone,
    retired_at timestamp with time zone,
    evaluation_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ml_model_versions_artifact_sha256_check CHECK (((artifact_sha256 IS NULL) OR (artifact_sha256 ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT ml_model_versions_model_key_check CHECK ((model_key ~ '^[a-z0-9_]+$'::text)),
    CONSTRAINT ml_model_versions_model_type_check CHECK ((model_type = ANY (ARRAY['logistic_regression'::text, 'gradient_boosted_trees'::text, 'rule_baseline'::text]))),
    CONSTRAINT ml_model_versions_promotion_shape CHECK (((NOT is_active) OR ((promoted_by IS NOT NULL) AND (promoted_at IS NOT NULL) AND (evaluation_notes IS NOT NULL))))
);

ALTER TABLE ONLY public.ml_model_versions FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ml_model_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ml_model_versions IS 'Model registry. is_active requires promoted_by + promoted_at + evaluation_notes, so a freshly-trained model can NEVER become production by merely existing (spec §73). At most one active model per (model_key, target).';


--
-- Name: promote_ml_model(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_ml_model(p_model_version_id uuid, p_evaluation_notes text) RETURNS public.ml_model_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_model public.ml_model_versions;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'promote_ml_model: platform admin role required' using errcode = '42501';
  end if;

  if p_evaluation_notes is null or btrim(p_evaluation_notes) = '' then
    raise exception 'promote_ml_model: an evaluation note is required — promotion must be a documented decision'
      using errcode = 'check_violation';
  end if;

  select * into v_model from public.ml_model_versions where id = p_model_version_id;
  if not found then
    raise exception 'promote_ml_model: model version % not found', p_model_version_id;
  end if;

  update public.ml_model_versions
  set is_active = false, retired_at = now()
  where model_key = v_model.model_key
    and target = v_model.target
    and is_active
    and id <> p_model_version_id;

  update public.ml_model_versions
  set is_active = true,
      promoted_by = (select auth.uid()),
      promoted_at = now(),
      evaluation_notes = p_evaluation_notes,
      retired_at = null
  where id = p_model_version_id
  returning * into v_model;

  return v_model;
end;
$$;


--
-- Name: prospect_effective_locale(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prospect_effective_locale(p_prospect_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(pl.override_locale, pl.locale)
  from public.prospect_locales pl
  where pl.prospect_id = p_prospect_id;
$$;


--
-- Name: FUNCTION prospect_effective_locale(p_prospect_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.prospect_effective_locale(p_prospect_id uuid) IS 'Override locale if a human set one, else the detected locale, else NULL. NULL means outreach must be BLOCKED — never silently defaulted to fr-FR/en-GB (spec §25).';


--
-- Name: publication_block_reason(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publication_block_reason(p_prospect_id uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_prospect public.prospects;
  v_distinct_sources integer;
  v_trust_anchor boolean;
begin
  select * into v_prospect from public.prospects where id = p_prospect_id;
  if not found then
    return 'prospect_not_found';
  end if;

  if v_prospect.do_not_contact then
    return 'do_not_contact';
  end if;

  if exists (
    select 1 from public.prospect_suppressions
    where scope = 'prospect' and prospect_id = p_prospect_id
  ) then
    return 'suppressed_prospect';
  end if;

  if v_prospect.phone_e164 is not null
     and private.is_prospect_value_suppressed('phone', v_prospect.phone_e164) then
    return 'suppressed_phone';
  end if;

  if v_prospect.email is not null
     and private.is_prospect_value_suppressed('email', v_prospect.email) then
    return 'suppressed_email';
  end if;

  if v_prospect.website_domain is not null
     and private.is_prospect_value_suppressed('domain', v_prospect.website_domain) then
    return 'suppressed_domain';
  end if;

  if v_prospect.converted_organization_id is not null then
    return 'already_converted';
  end if;

  if v_prospect.status in ('customer', 'trial') then
    return 'already_customer';
  end if;

  if v_prospect.entity_kind = 'group_parent' then
    return 'entity_kind_not_publishable';
  end if;

  if exists (
    select 1 from public.prospect_professionals where prospect_id = p_prospect_id
  ) then
    return 'already_published';
  end if;

  if char_length(btrim(v_prospect.canonical_name)) < 2
     or btrim(v_prospect.canonical_name) !~ '[[:alpha:]]{2}' then
    return 'name_not_publishable';
  end if;

  if exists (
    select 1 from public.prospect_duplicates
    where status = 'pending'
      and (prospect_id = p_prospect_id or duplicate_of_prospect_id = p_prospect_id)
  ) then
    return 'unresolved_duplicate';
  end if;

  -- THE ONE CHANGED CLAUSE.
  --
  -- Counts distinct INDEPENDENCE GROUPS, not distinct source rows. A source
  -- with no group is its own group, so this is identical to the previous
  -- behaviour for every ungrouped source and strictly stricter for grouped
  -- ones. coalesce on the key rather than the id because the key is stable and
  -- readable in an EXPLAIN.
  select count(distinct coalesce(ps.independence_group, ps.key)),
         bool_or(ps.is_identity_trust_anchor)
    into v_distinct_sources, v_trust_anchor
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = p_prospect_id;

  if coalesce(v_distinct_sources, 0) < 2 and not coalesce(v_trust_anchor, false) then
    return 'insufficient_source_evidence';
  end if;

  if v_prospect.website_domain is null
     and not exists (
       select 1 from public.prospect_locations where prospect_id = p_prospect_id
     ) then
    return 'no_corroborating_location';
  end if;

  return null;
end;
$$;


--
-- Name: FUNCTION publication_block_reason(p_prospect_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.publication_block_reason(p_prospect_id uuid) IS 'The LIVE authority on whether a canonical prospect may be minted into an external professional identity. Returns the first blocking reason, or NULL when publishable. Strictly more conservative than outreach_block_reason because an identity is durable and claimable where a message is transient. R4.1 corrected its evidence clause to count distinct INDEPENDENCE GROUPS rather than distinct source rows: Geoapify redistributes OpenStreetMap, so OSM+Geoapify is one observer reporting twice, and a provider page reached by following a first-party link is the same evidence chain one hop longer. Enforced by a BEFORE INSERT trigger on prospect_professionals, so no caller can route around it.';


--
-- Name: publish_external_professional(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_external_professional(p_prospect_id uuid, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid;
  v_reason text;
  v_professional_id uuid;
  v_existing uuid;
  v_name text;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can publish an external professional identity'
      using errcode = '42501';
  end if;

  -- Lock the PROSPECT, not the linkage row, because the linkage row is what we
  -- are about to create and therefore cannot be locked. Two administrators
  -- double-clicking Publish on the same candidate serialise here; the loser
  -- re-reads a gate that now says already_published and returns the winner's
  -- identity instead of a 23505 they would have to interpret.
  perform 1 from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  select pp.professional_id into v_existing
  from public.prospect_professionals pp
  where pp.prospect_id = p_prospect_id;

  if v_existing is not null then
    -- Idempotent, and self-healing for identities minted while the R1B CHECK
    -- still forbade publication: those rows exist, are linked, and are
    -- invisible. Pressing Publish again finishes the job.
    update public.professionals
    set is_public = true
    where id = v_existing and not is_public;

    return v_existing;
  end if;

  -- Checked here so the operator gets the reason by name. The trigger would
  -- refuse the insert regardless; this is ergonomics on top of the guarantee,
  -- never in place of it.
  v_reason := public.publication_block_reason(p_prospect_id);
  if v_reason is not null then
    raise exception 'prospect is not eligible for publication: %', v_reason
      using errcode = '42501';
  end if;

  select p.canonical_name into v_name from public.prospects p where p.id = p_prospect_id;

  v_professional_id := public.create_external_professional(p_prospect_id);

  -- Publication is the point of this function. It happens AFTER the linkage
  -- row exists, because professionals_guard_publication reads the linkage to
  -- find the anchor — the same ordering the guard's INSERT branch describes.
  update public.professionals
  set is_public = true
  where id = v_professional_id;

  -- Constitution §4.4's discipline, applied to acquisition: a decision that
  -- creates a durable public-facing identity records who took it and when.
  -- The prospect's name is captured AS PUBLISHED, so a later rename of the
  -- prospect does not rewrite the history of what was approved.
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'external_professional_published',
    'prospect_professionals',
    v_professional_id,
    jsonb_build_object(
      'prospect_id', p_prospect_id,
      'professional_id', v_professional_id,
      'published_name', v_name,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  -- Fold the verdict forward immediately so the review queue stops offering a
  -- candidate that has just been published, without waiting for the next
  -- Worker sweep.
  perform public.refresh_prospect_publication_eligibility(p_prospect_id);

  return v_professional_id;
end;
$$;


--
-- Name: FUNCTION publish_external_professional(p_prospect_id uuid, p_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.publish_external_professional(p_prospect_id uuid, p_note text) IS 'The operator''s front door for minting an external unclaimed professional identity, and the only publication path R4 ships. Platform administrators only, and deliberately NOT the Worker: the machine evaluates evidence, a human decides. Idempotent per prospect, serialised on the prospect row so a double-click cannot produce a second identity, audited to platform_audit_log with the name as published, and it refreshes the eligibility cache so the queue reflects the decision at once.';


--
-- Name: queue_entries_auto_follow(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_entries_auto_follow() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status <> 'completed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return null;
  end if;

  perform private.auto_follow_professional(new.booked_by_user_id, new.barber_id);
  return null;
end;
$$;


--
-- Name: FUNCTION queue_entries_auto_follow(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.queue_entries_auto_follow() IS 'AFTER INSERT OR UPDATE on queue_entries. A SERVED walk-in with a named barber is a real interaction; earlier queue states are not used, because joining a line says nothing about who served you. Same attribution rule as appointments.';


--
-- Name: queue_entries_record_relationship(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_entries_record_relationship() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status <> 'completed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return null;
  end if;

  perform private.record_completed_interaction(
    new.booked_by_user_id, new.barber_id, new.organization_id, new.completed_at
  );
  return null;
end;
$$;


--
-- Name: FUNCTION queue_entries_record_relationship(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.queue_entries_record_relationship() IS 'AFTER INSERT OR UPDATE on queue_entries. A served walk-in is a completed service (Constitution §3.3). queue_entries.completed_at is server-stamped by the R1A queue guard, so the browser can no longer choose it.';


--
-- Name: reconcile_customer_professional_relationships(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconcile_customer_professional_relationships(p_professional_id uuid DEFAULT NULL::uuid) RETURNS TABLE(rows_written bigint, rows_removed bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff can reconcile relationships'
      using errcode = '42501';
  end if;

  return query
  with evidence as (
    select a.booked_by_user_id as customer_user_id, b.professional_id,
           a.organization_id, a.completed_at
    from public.appointments a
    join public.barbers b on b.id = a.barber_id
    where a.status = 'completed'
      and a.booked_by_user_id is not null
      and a.completed_at is not null
      and b.professional_id is not null

    union all

    select q.booked_by_user_id, b.professional_id, q.organization_id, q.completed_at
    from public.queue_entries q
    join public.barbers b on b.id = q.barber_id
    where q.status = 'completed'
      and q.booked_by_user_id is not null
      and q.completed_at is not null
      and b.professional_id is not null
  ),
  truth as (
    select e.customer_user_id, e.professional_id, e.organization_id,
           count(*)::integer as completed_interaction_count,
           min(e.completed_at) as first_completed_at,
           max(e.completed_at) as last_completed_at
    from evidence e
    where p_professional_id is null or e.professional_id = p_professional_id
    group by e.customer_user_id, e.professional_id, e.organization_id
  ),
  removed as (
    -- The WHERE stays on this line deliberately: the MASTER generator refuses
    -- any `delete from` whose line carries no WHERE, and that guard is worth
    -- more than the formatting.
    delete from public.customer_professional_relationships r where true
      and (p_professional_id is null or r.professional_id = p_professional_id)
      and not exists (
        select 1 from truth t
        where t.customer_user_id = r.customer_user_id
          and t.professional_id = r.professional_id
          and t.organization_id = r.organization_id
      )
    returning 1
  ),
  written as (
    insert into public.customer_professional_relationships (
      customer_user_id, professional_id, organization_id,
      completed_interaction_count, first_completed_at, last_completed_at
    )
    select t.customer_user_id, t.professional_id, t.organization_id,
           t.completed_interaction_count, t.first_completed_at, t.last_completed_at
    from truth t
    on conflict (customer_user_id, professional_id, organization_id) do update
      set completed_interaction_count = excluded.completed_interaction_count,
          first_completed_at = excluded.first_completed_at,
          last_completed_at = excluded.last_completed_at
    returning 1
  )
  select (select count(*) from written), (select count(*) from removed);
end;
$$;


--
-- Name: FUNCTION reconcile_customer_professional_relationships(p_professional_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reconcile_customer_professional_relationships(p_professional_id uuid) IS 'Platform-only. Recomputes the relationship aggregate from appointments and queue_entries and replaces it, so a materialized counter can always be proven against its evidence. Excludes completed rows with NULL completed_at: R1A left those genuinely unknown and reconciliation does not invent them.';


--
-- Name: recover_stale_prospect_job_leases(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recover_stale_prospect_job_leases() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_count integer;
begin
  with stale as (
    select id from public.prospect_jobs
    where status = 'running' and lease_until is not null and lease_until < now()
    for update skip locked
  )
  update public.prospect_jobs j
  set status = (case when j.attempts >= j.max_attempts then 'failed' else 'retry' end)::public.prospect_job_status,
      failed_at = case when j.attempts >= j.max_attempts then now() else j.failed_at end,
      last_error = 'stale lease recovered: worker did not complete or heartbeat before lease_until',
      lease_until = null,
      worker_id = null
  from stale
  where j.id = stale.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: FUNCTION recover_stale_prospect_job_leases(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.recover_stale_prospect_job_leases() IS 'Recovers jobs whose lease expired without completion (crashed/killed worker). Callable by any platform_worker/admin caller — SECURITY INVOKER would also work here since it only touches rows RLS already allows the Worker to touch, but DEFINER keeps it callable from a CLI/admin context too without needing prospect_worker''s own grants.';


--
-- Name: redeem_appointment_claim(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redeem_appointment_claim(p_token text) RETURNS TABLE(claimed boolean, organization_name text, starts_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
  v_token_id uuid;
  v_appointment_id uuid;
  v_appointment public.appointments;
  v_customer_id uuid;
  v_organization_name text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'redeem_appointment_claim requires an authenticated session';
  end if;

  if p_token is null or btrim(p_token) = '' then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  -- Single-use and time-limited, checked in one statement so two concurrent
  -- redemptions cannot both win.
  update public.appointment_claim_tokens t
    set redeemed_at = now(), redeemed_by = v_user_id
    where t.token_hash = encode(extensions.digest(btrim(p_token), 'sha256'), 'hex')
      and t.redeemed_at is null
      and t.expires_at > now()
    returning t.id, t.appointment_id into v_token_id, v_appointment_id;

  if v_token_id is null then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  select * into v_appointment from public.appointments a where a.id = v_appointment_id;

  -- The token proves the holder made THIS booking, and nothing more. So we
  -- move exactly this booking onto a CRM row the caller owns, and never
  -- touch the ownership of whatever row the LOT 12 trigger happened to
  -- attach it to — that row is chosen from caller-typed contact details and
  -- may well belong to somebody else entirely.
  v_customer_id := private.resolve_customer_for_user(
    v_appointment.organization_id, v_user_id,
    v_appointment.customer_name, v_appointment.customer_phone, v_appointment.customer_email
  );

  if v_customer_id is null then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  update public.appointments a
    set customer_id = v_customer_id
    where a.id = v_appointment_id;

  select o.name into v_organization_name
    from public.organizations o where o.id = v_appointment.organization_id;

  return query select true, v_organization_name, v_appointment.starts_at;
end;
$$;


--
-- Name: FUNCTION redeem_appointment_claim(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.redeem_appointment_claim(p_token text) IS 'Authenticated-only. Repoints the appointment identified by a single-use booking claim token at a public.customers row owned by the caller. Proof of ownership is possession of the token issued at booking time. Deliberately narrow: it moves only the claimed appointment and never changes who owns any pre-existing CRM row, because the row an appointment lands on is selected by the appointments_link_customer trigger from caller-typed contact details.';


--
-- Name: prospect_publication_eligibility; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_publication_eligibility (
    prospect_id uuid NOT NULL,
    is_eligible boolean DEFAULT false NOT NULL,
    block_reason text,
    distinct_source_count integer DEFAULT 0 NOT NULL,
    has_trust_anchor boolean DEFAULT false NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_publication_eligibility_reason_matches_verdict CHECK ((is_eligible = (block_reason IS NULL))),
    CONSTRAINT prospect_publication_eligibility_source_count_sane CHECK ((distinct_source_count >= 0))
);

ALTER TABLE ONLY public.prospect_publication_eligibility FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_publication_eligibility; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_publication_eligibility IS 'A CACHE of public.publication_block_reason, refreshed by the Worker''s publication_evaluation job, so the operator review queue can page candidates without running the gate per row. It is deliberately NOT the guarantee: the BEFORE INSERT trigger on prospect_professionals consults the live function. A stale row can therefore mislead an operator about what is available to review; it can never permit a publication the live gate would refuse.';


--
-- Name: COLUMN prospect_publication_eligibility.block_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.prospect_publication_eligibility.block_reason IS 'NULL exactly when eligible, enforced by check constraint. Values are the reason vocabulary of publication_block_reason, not free text.';


--
-- Name: refresh_prospect_publication_eligibility(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_prospect_publication_eligibility(p_prospect_id uuid) RETURNS public.prospect_publication_eligibility
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_reason text;
  v_distinct_sources integer;
  v_trust_anchor boolean;
  v_row public.prospect_publication_eligibility;
begin
  if not (
    (select private.has_platform_role(
       array['platform_owner', 'platform_admin']::public.platform_role[]))
    or ((select auth.uid()) is null and session_user = 'prospect_worker')
  ) then
    raise exception 'only FadeUp platform administrators or the acquisition worker can evaluate publication eligibility'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.prospects where id = p_prospect_id) then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  v_reason := public.publication_block_reason(p_prospect_id);

  select count(distinct psr.source_id),
         coalesce(bool_or(ps.is_identity_trust_anchor), false)
    into v_distinct_sources, v_trust_anchor
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = p_prospect_id;

  insert into public.prospect_publication_eligibility as e (
    prospect_id, is_eligible, block_reason,
    distinct_source_count, has_trust_anchor, evaluated_at
  )
  values (
    p_prospect_id, v_reason is null, v_reason,
    coalesce(v_distinct_sources, 0), v_trust_anchor, now()
  )
  on conflict (prospect_id) do update
  set is_eligible           = excluded.is_eligible,
      block_reason          = excluded.block_reason,
      distinct_source_count = excluded.distinct_source_count,
      has_trust_anchor      = excluded.has_trust_anchor,
      evaluated_at          = excluded.evaluated_at
  returning e.* into v_row;

  return v_row;
end;
$$;


--
-- Name: FUNCTION refresh_prospect_publication_eligibility(p_prospect_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_prospect_publication_eligibility(p_prospect_id uuid) IS 'Recomputes one prospect''s cached publication verdict from the live gate. The ONLY writer of prospect_publication_eligibility — the table has no INSERT/UPDATE/DELETE policy for any role, so a stale or forged verdict cannot be planted in front of the operator who approves publications. Callable by platform_owner/platform_admin and by the acquisition worker''s own connection.';


--
-- Name: regenerate_location_queue_check_in_token(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.regenerate_location_queue_check_in_token(p_location_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_token text;
begin
  -- Owner or manager only, receptionist excluded: this invalidates every
  -- printed copy in the building at once. That is a decision, not a task.
  perform private.assert_service_mode_authority(p_location_id, null, false);

  update public.locations
  set queue_check_in_token = encode(extensions.gen_random_bytes(16), 'hex')
  where id = p_location_id
  returning queue_check_in_token into v_token;

  if v_token is null then
    raise exception 'location not found' using errcode = '42704';
  end if;

  return v_token;
end;
$$;


--
-- Name: FUNCTION regenerate_location_queue_check_in_token(p_location_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.regenerate_location_queue_check_in_token(p_location_id uuid) IS 'Owner or manager. Issues a new QR check-in token for the establishment, invalidating every printed copy immediately. The reason this exists: the token is displayed in public, so a shop that suspects it is circulating outside the building needs to be able to retire it without waiting for anyone.';


--
-- Name: reissue_platform_owner_bootstrap_token(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reissue_platform_owner_bootstrap_token(p_expires_in interval DEFAULT '7 days'::interval) RETURNS TABLE(id uuid, raw_token text, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_raw_token text;
  v_id uuid;
  v_expires_at timestamptz;
begin
  if not (select private.is_platform_owner()) then
    raise exception 'only a platform owner may reissue the bootstrap token';
  end if;

  update public.platform_owner_bootstrap_tokens
  set revoked_at = now()
  where claimed_at is null and revoked_at is null;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + p_expires_in;

  insert into public.platform_owner_bootstrap_tokens (token_hash, expires_at)
  values (encode(extensions.digest(v_raw_token, 'sha256'), 'hex'), v_expires_at)
  returning platform_owner_bootstrap_tokens.id into v_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_owner_bootstrap_token_reissued', 'platform_owner_bootstrap_tokens', v_id, '{}'::jsonb);

  return query select v_id, v_raw_token, v_expires_at;
end;
$$;


--
-- Name: FUNCTION reissue_platform_owner_bootstrap_token(p_expires_in interval); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reissue_platform_owner_bootstrap_token(p_expires_in interval) IS 'Platform-owner-only: revokes any outstanding bootstrap token and mints a new one, returning the raw token once. Never two active tokens at once.';


--
-- Name: reject_analytics_event_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_analytics_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'analytics_events is append-only: a recorded event cannot be modified'
      using errcode = '22023';
  end if;

  if coalesce(current_setting('fadeup.analytics_retention_purge', true), '') <> 'on' then
    raise exception 'analytics_events is append-only: events are removed only by the retention purge'
      using errcode = '22023';
  end if;

  return old;
end;
$$;


--
-- Name: FUNCTION reject_analytics_event_mutation(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reject_analytics_event_mutation() IS 'Makes analytics_events genuinely append-only for every caller, with no role exemption — service_role and postgres included. UPDATE is refused unconditionally. DELETE is refused unless the retention purge has set its transaction-local flag, which no client role can reach.';


--
-- Name: reject_commercial_history_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_commercial_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  -- No role exemption, on purpose. An audit trail that the most powerful role
  -- can rewrite is a log, not an audit trail.
  raise exception 'commercial_plan_changes is append-only: % is not permitted', tg_op
    using errcode = '42501';
end;
$$;


--
-- Name: FUNCTION reject_commercial_history_mutation(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reject_commercial_history_mutation() IS 'Refuses UPDATE and DELETE on commercial_plan_changes for every role including postgres and service_role. Privilege revocation alone would leave the trail rewritable by the roles that matter most.';


--
-- Name: reject_service_mode_history_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_service_mode_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'service_mode_changes is append-only: % is not permitted', tg_op
    using errcode = '42501',
          hint = 'Record a new change instead of editing the record of an old one.';
end;
$$;


--
-- Name: FUNCTION reject_service_mode_history_mutation(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reject_service_mode_history_mutation() IS 'Makes service_mode_changes append-only for EVERY writer including service_role and postgres. A trigger rather than a grant, because BYPASSRLS roles would otherwise be able to rewrite the audit trail.';


--
-- Name: remove_favorite(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_favorite(p_favorite_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());

  if v_user_id is null then
    raise exception 'remove favorite requires an authenticated session'
      using errcode = '42501';
  end if;

  delete from public.customer_favorites f
  where f.id = p_favorite_id
    and f.user_id = v_user_id;
end;
$$;


--
-- Name: FUNCTION remove_favorite(p_favorite_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.remove_favorite(p_favorite_id uuid) IS 'Authenticated removal contract for the caller own favorite. Also lets customers remove historical pre-V2 barber favorites without permitting new barber favorites. A foreign/nonexistent id is an indistinguishable no-op.';


--
-- Name: reschedule_appointment(uuid, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reschedule_appointment(p_appointment_id uuid, p_starts_at timestamp with time zone, p_barber_id uuid DEFAULT NULL::uuid) RETURNS public.appointments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_appointment public.appointments;
  v_is_business boolean;
  v_is_customer boolean;
  v_barber_id uuid;
  v_duration integer;
  v_ends_at timestamptz;
  v_timezone text;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  v_is_business := (select private.can_manage_appointments(v_appointment.organization_id));
  v_is_customer := v_appointment.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  );

  if not (v_is_business or v_is_customer) then
    raise exception 'not authorized to reschedule this booking' using errcode = '42501';
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be rescheduled' using errcode = '22023';
  end if;

  if p_starts_at <= now() then
    raise exception 'the new time must be in the future' using errcode = '22023';
  end if;

  v_barber_id := coalesce(p_barber_id, v_appointment.barber_id);

  -- A different professional must still belong to this shop and still be
  -- eligible for this service. Never trusted from the caller.
  if v_barber_id <> v_appointment.barber_id then
    if not exists (
      select 1
      from public.barbers b
      join public.staff_profiles sp on sp.id = b.staff_profile_id
      join public.barber_services bs on bs.barber_id = b.id and bs.service_id = v_appointment.service_id
      where b.id = v_barber_id
        and b.organization_id = v_appointment.organization_id
        and b.is_bookable and sp.is_active and sp.is_public
    ) then
      raise exception 'that professional is not available for this service' using errcode = '22023';
    end if;
  end if;

  -- Duration comes from the SNAPSHOT on the appointment, not from the service
  -- as it stands today: a price list edited since booking must not silently
  -- change the length of an appointment already agreed.
  v_duration := (extract(epoch from (v_appointment.ends_at - v_appointment.starts_at)) / 60)::integer;
  v_ends_at := p_starts_at + make_interval(mins => v_duration);

  select l.timezone into v_timezone
    from public.locations l where l.id = v_appointment.location_id;

  -- NEW IN LOT E. Previously this relied entirely on a human seeing the new
  -- time, because a customer move became a request. Nobody sees it now, so
  -- the destination has to be genuinely bookable — not merely unoccupied.
  if not private.slot_is_within_hours(v_barber_id, v_appointment.location_id, p_starts_at, v_ends_at, v_timezone) then
    raise exception 'requested time is outside available hours' using errcode = '22023';
  end if;

  -- The status is PRESERVED. A confirmed appointment moved to another valid
  -- slot is still a confirmed appointment: the shop said yes to the slot, and
  -- the customer has not stopped being expected.
  --
  -- Raised for exactly this UPDATE, after the checks above — it tells the LOT
  -- 11 column guard that this is the sanctioned reschedule path rather than a
  -- barber editing a time directly.
  perform set_config('fadeup.appointment_reschedule', 'on', true);

  -- One statement. The GiST exclusion constraint is the authority on whether
  -- the destination is free; if it raises, nothing here has changed and the
  -- original appointment is left exactly as it was. There is never a moment
  -- with two appointments.
  update public.appointments
    set starts_at = p_starts_at,
        ends_at = v_ends_at,
        barber_id = v_barber_id,
        decided_at = case when v_is_business then now() else decided_at end,
        decided_by = case when v_is_business then (select auth.uid()) else decided_by end
    where id = p_appointment_id
    returning * into v_appointment;

  perform set_config('fadeup.appointment_reschedule', 'off', true);

  perform private.emit_booking_notification(
    v_appointment, 'booking_rescheduled',
    case when v_is_business then 'customer' else 'business' end,
    'Appointment moved',
    v_appointment.customer_name,
    'booking_rescheduled',
    ':' || extract(epoch from v_appointment.starts_at)::bigint::text
  );

  return v_appointment;
end;
$$;


--
-- Name: FUNCTION reschedule_appointment(p_appointment_id uuid, p_starts_at timestamp with time zone, p_barber_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reschedule_appointment(p_appointment_id uuid, p_starts_at timestamp with time zone, p_barber_id uuid) IS 'Moves an appointment and PRESERVES its status — a confirmed booking moved to another genuinely available slot stays confirmed, for customers as well as staff. The destination is validated against real opening/working hours (private.slot_is_within_hours), against blocked time (the LOT D trigger) and finally against the GiST exclusion constraint, which leaves the original row untouched if the destination is taken. The dedupe suffix carries the new start time so a customer moving twice is notified twice.';


--
-- Name: restrict_appointment_self_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restrict_appointment_self_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  -- Managing roles keep full edit rights untouched by this trigger.
  if (select private.has_org_role(new.organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])) then
    return new;
  end if;

  -- public.reschedule_appointment() raises this for the single UPDATE it
  -- performs, after verifying the caller owns the appointment or manages the
  -- organization. current_setting(..., true) yields null when it was never
  -- set, so every ordinary path falls through to the restriction below.
  if coalesce(current_setting('fadeup.appointment_reschedule', true), '') = 'on' then
    return new;
  end if;

  -- Everyone else who could reach this far already passed RLS as "the
  -- assigned barber" (appointments_update_self) — restrict them to status
  -- and notes only.
  if new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.barber_id is distinct from old.barber_id
    or new.chair_id is distinct from old.chair_id
    or new.service_id is distinct from old.service_id
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
    or new.customer_email is distinct from old.customer_email
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.buffer_before_minutes is distinct from old.buffer_before_minutes
    or new.buffer_after_minutes is distinct from old.buffer_after_minutes
  then
    raise exception 'a barber may only update status and notes on their own appointments';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION restrict_appointment_self_update(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.restrict_appointment_self_update() IS 'BEFORE UPDATE column guard. Unchanged for every direct write path: a non-managing caller may still only touch status and notes. Stands down for public.reschedule_appointment(), which sets fadeup.appointment_reschedule after doing its own ownership and authorization checks.';


--
-- Name: restrict_queue_entry_self_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restrict_queue_entry_self_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if (select private.has_org_role(new.organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])) then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.barber_id is distinct from old.barber_id
    or new.service_id is distinct from old.service_id
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
  then
    raise exception 'a barber may only update status, timestamps and notes on their own queue entries';
  end if;

  return new;
end;
$$;


--
-- Name: retire_ml_model(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retire_ml_model(p_model_version_id uuid) RETURNS public.ml_model_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_model public.ml_model_versions;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'retire_ml_model: platform admin role required' using errcode = '42501';
  end if;

  update public.ml_model_versions
  set is_active = false, retired_at = now()
  where id = p_model_version_id
  returning * into v_model;

  if not found then
    raise exception 'retire_ml_model: model version % not found', p_model_version_id;
  end if;

  return v_model;
end;
$$;


--
-- Name: professional_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.professional_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    business_name text NOT NULL,
    professional_type public.professional_type NOT NULL,
    city text,
    address_line1 text,
    postal_code text,
    country text,
    staff_count integer,
    website text,
    instagram text,
    business_identifier text,
    status public.professional_application_status DEFAULT 'pending_review'::public.professional_application_status NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    rejection_reason text,
    internal_note text,
    organization_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT professional_applications_business_name_not_blank CHECK ((btrim(business_name) <> ''::text)),
    CONSTRAINT professional_applications_internal_note_length CHECK (((internal_note IS NULL) OR (char_length(internal_note) <= 2000))),
    CONSTRAINT professional_applications_org_only_when_approved CHECK (((organization_id IS NULL) OR (status = 'approved'::public.professional_application_status))),
    CONSTRAINT professional_applications_phone_not_blank CHECK ((btrim(phone) <> ''::text)),
    CONSTRAINT professional_applications_reason_length CHECK (((rejection_reason IS NULL) OR (char_length(rejection_reason) <= 1000))),
    CONSTRAINT professional_applications_review_consistency CHECK ((((status = 'pending_review'::public.professional_application_status) AND (reviewed_at IS NULL) AND (reviewed_by IS NULL)) OR ((status <> 'pending_review'::public.professional_application_status) AND (reviewed_at IS NOT NULL)))),
    CONSTRAINT professional_applications_staff_count_sane CHECK (((staff_count IS NULL) OR ((staff_count >= 0) AND (staff_count <= 1000))))
);

ALTER TABLE ONLY public.professional_applications FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE professional_applications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.professional_applications IS 'A request to join FadeUp as a professional. Creating one grants NOTHING — authorization still comes exclusively from memberships/platform_members. Only review_professional_application(), executed by a platform admin, turns an approved application into an organization plus an owner membership for the applicant.';


--
-- Name: COLUMN professional_applications.rejection_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professional_applications.rejection_reason IS 'May be shown to the applicant. Keep it free of internal assessment — that belongs in internal_note.';


--
-- Name: COLUMN professional_applications.internal_note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professional_applications.internal_note IS 'Platform-only reviewer note. Withheld from `authenticated` by column grant, not merely omitted from an RPC: the SELECT policy is row-level and the applicant''s own row matches it, so without the grant restriction a single .select(''internal_note'') returned the reviewer''s private assessment to its subject. Platform staff read it through their own path.';


--
-- Name: review_professional_application(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_professional_application(p_application_id uuid, p_decision text, p_rejection_reason text DEFAULT NULL::text, p_internal_note text DEFAULT NULL::text) RETURNS public.professional_applications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_reviewer uuid;
  v_application public.professional_applications;
  v_org public.organizations;
  v_slug text;
  v_slug_base text;
  v_suffix integer := 0;
  v_country text;
  v_timezone text;
  v_business_type public.business_type;
  v_location_id uuid;
begin
  v_reviewer := (select auth.uid());
  if v_reviewer is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff can review professional applications';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject';
  end if;

  -- Row lock is what makes a double-clicked Approve safe: the second call
  -- waits, then sees a status that is no longer pending and returns without
  -- repeating any side effect.
  select * into v_application
    from public.professional_applications a
    where a.id = p_application_id
    for update;

  if not found then
    raise exception 'application not found';
  end if;

  if v_application.status <> 'pending_review' then
    return v_application;
  end if;

  if p_decision = 'reject' then
    update public.professional_applications a
      set status = 'rejected',
          reviewed_at = now(),
          reviewed_by = v_reviewer,
          rejection_reason = nullif(btrim(coalesce(p_rejection_reason, '')), ''),
          internal_note = coalesce(nullif(btrim(coalesce(p_internal_note, '')), ''), a.internal_note)
      where a.id = v_application.id
      returning * into v_application;

    insert into public.email_outbox (to_email, template, payload)
    values (
      v_application.email,
      'professional_application_rejected',
      jsonb_build_object(
        'business_name', v_application.business_name,
        'first_name', v_application.first_name,
        'rejection_reason', v_application.rejection_reason
      )
    );

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (
      v_reviewer, 'professional_application_rejected', 'professional_applications', v_application.id,
      jsonb_build_object('business_name', v_application.business_name, 'has_reason', v_application.rejection_reason is not null)
    );

    return v_application;
  end if;

  -- ---- approve ----------------------------------------------------------
  v_slug_base := regexp_replace(lower(btrim(v_application.business_name)), '[^a-z0-9]+', '-', 'g');
  v_slug_base := btrim(regexp_replace(v_slug_base, '(^-+)|(-+$)', '', 'g'), '-');
  if v_slug_base = '' then
    v_slug_base := 'shop';
  end if;
  v_slug_base := left(v_slug_base, 40);
  v_slug := v_slug_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix::text;
  end loop;

  v_country := nullif(btrim(upper(coalesce(v_application.country, ''))), '');
  if v_country is not null and char_length(v_country) <> 2 then
    -- The application form accepts free text; only a clean alpha-2 code is
    -- trustworthy enough to drive a timezone. Anything else is left for
    -- onboarding to ask about rather than guessed at.
    v_country := null;
  end if;

  -- professional_type is the applicant's own description of their business
  -- and maps cleanly onto the two solo shapes; barbershop maps to barbershop.
  -- Anything a salon-shaped applicant needs is chosen in onboarding step 1,
  -- which is why an unmapped type is left NULL rather than defaulted.
  v_business_type := case v_application.professional_type
    when 'barbershop' then 'barbershop'::public.business_type
    when 'independent_barber' then 'solo_professional'::public.business_type
    when 'private_studio' then 'solo_professional'::public.business_type
    when 'mobile_barber' then 'solo_professional'::public.business_type
    else null
  end;

  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  insert into public.organizations (name, slug, business_type, country_code, currency)
  values (
    v_application.business_name,
    v_slug,
    v_business_type,
    v_country,
    public.suggested_currency_for_country(v_country)
  )
  returning * into v_org;
  perform set_config('fadeup.org_creation_authorized', 'off', true);
  perform set_config('fadeup.skip_org_owner_membership', 'off', true);

  insert into public.memberships (organization_id, user_id, role)
  values (v_org.id, v_application.user_id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  -- First location, from data the applicant already gave us. Creating it
  -- here is what stops an approved shop from starting with zero locations
  -- and the owner retyping an address FadeUp already holds.
  v_timezone := coalesce(public.suggested_timezone_for_country(v_country), 'UTC');
  insert into public.locations (
    organization_id, name, address_line1, city, postal_code, country, timezone
  )
  values (
    v_org.id,
    v_application.business_name,
    nullif(btrim(coalesce(v_application.address_line1, '')), ''),
    nullif(btrim(coalesce(v_application.city, '')), ''),
    nullif(btrim(coalesce(v_application.postal_code, '')), ''),
    v_country,
    v_timezone
  )
  returning id into v_location_id;

  update public.professional_applications a
    set status = 'approved',
        reviewed_at = now(),
        reviewed_by = v_reviewer,
        organization_id = v_org.id,
        internal_note = coalesce(nullif(btrim(coalesce(p_internal_note, '')), ''), a.internal_note)
    where a.id = v_application.id
    returning * into v_application;

  insert into public.email_outbox (to_email, template, payload)
  values (
    v_application.email,
    'professional_application_approved',
    jsonb_build_object(
      'business_name', v_application.business_name,
      'first_name', v_application.first_name
    )
  );

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_reviewer, 'professional_application_approved', 'professional_applications', v_application.id,
    jsonb_build_object(
      'business_name', v_application.business_name,
      'organization_id', v_org.id,
      'organization_slug', v_org.slug,
      'location_id', v_location_id
    )
  );

  return v_application;
end;
$_$;


--
-- Name: FUNCTION review_professional_application(p_application_id uuid, p_decision text, p_rejection_reason text, p_internal_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.review_professional_application(p_application_id uuid, p_decision text, p_rejection_reason text, p_internal_note text) IS 'Platform-admin-only approve/reject. Approving creates the organization, makes the APPLICANT its owner (never the reviewer), creates the first location from the address already on the application, seeds business_type/country/currency, records the audit event and queues the applicant email — all in one transaction. Idempotent: reviewing an already-decided application returns it unchanged with no repeated side effects. Never grants any platform role.';


--
-- Name: professional_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.professional_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    professional_id uuid NOT NULL,
    claimant_user_id uuid NOT NULL,
    state public.professional_claim_status DEFAULT 'pending'::public.professional_claim_status NOT NULL,
    evidence text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by uuid,
    decision_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT professional_claims_approval_has_reviewer CHECK (((state <> 'approved'::public.professional_claim_status) OR (decided_by IS NOT NULL))),
    CONSTRAINT professional_claims_evidence_length CHECK (((evidence IS NULL) OR (char_length(evidence) <= 2000))),
    CONSTRAINT professional_claims_note_length CHECK (((decision_note IS NULL) OR (char_length(decision_note) <= 2000))),
    CONSTRAINT professional_claims_pending_undecided CHECK (((state = 'pending'::public.professional_claim_status) = (decided_at IS NULL)))
);

ALTER TABLE ONLY public.professional_claims FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE professional_claims; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.professional_claims IS 'The lifecycle by which a real person takes control of an existing professional identity — typically one acquisition created before they joined. pending -> approved | rejected | withdrawn, all terminal. Claim state is NEVER subscription state (Constitution §5.6): approving a claim grants control, not capabilities and not a plan.';


--
-- Name: COLUMN professional_claims.evidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professional_claims.evidence IS 'The claimant''s own account of why this identity is theirs. R1B stores it and stops there — verifying it is R17''s outreach work, and shipping weak self-service verification would be worse than an honest pending queue.';


--
-- Name: COLUMN professional_claims.decision_note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professional_claims.decision_note IS 'Written for the CLAIMANT to read. There is no separate internal note by design: R1A had to close exactly that leak on professional_applications.internal_note, and a column that does not exist cannot be over-granted.';


--
-- Name: review_professional_claim(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_professional_claim(p_claim_id uuid, p_decision text, p_note text DEFAULT NULL::text) RETURNS public.professional_claims
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_reviewer uuid;
  v_claim public.professional_claims;
  v_professional public.professionals;
  v_org_id uuid;
  v_org_count integer;
  v_converted boolean := false;
begin
  v_reviewer := (select auth.uid());
  if v_reviewer is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff can review professional claims'
      using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = '22023';
  end if;

  -- The row lock is what makes a double-clicked Approve safe: the second call
  -- waits, then sees a state that is no longer pending and returns without
  -- repeating a single side effect.
  select * into v_claim from public.professional_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = '42704';
  end if;

  if v_claim.state <> 'pending' then
    return v_claim;
  end if;

  if p_decision = 'reject' then
    update public.professional_claims
    set state = 'rejected', decided_at = now(), decided_by = v_reviewer,
        decision_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = v_claim.id
    returning * into v_claim;

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (v_reviewer, 'professional_claim_rejected', 'professional_claims', v_claim.id,
            jsonb_build_object('professional_id', v_claim.professional_id,
                               'claimant_user_id', v_claim.claimant_user_id));
    return v_claim;
  end if;

  -- ---- approve ----------------------------------------------------------
  -- Lock the IDENTITY, not just the claim. Two reviewers approving two
  -- different claims for the same professional serialise here; the loser
  -- re-reads a row that is already claimed and refuses below.
  select * into v_professional from public.professionals
  where id = v_claim.professional_id for update;

  if v_professional.claim_state = 'claimed' then
    raise exception 'this professional identity is already claimed and cannot be transferred'
      using errcode = '42501';
  end if;

  -- Re-checked under the lock: the claimant may have acquired an identity
  -- between submitting and being reviewed.
  if exists (select 1 from public.professionals p where p.user_id = v_claim.claimant_user_id) then
    raise exception 'the claimant already has a professional identity; merging identities is not yet supported'
      using errcode = '42501';
  end if;

  perform set_config('fadeup.professional_claim_write', 'on', true);
  update public.professionals
  set claim_state = 'claimed', user_id = v_claim.claimant_user_id, claimed_at = now()
  where id = v_professional.id;
  perform set_config('fadeup.professional_claim_write', 'off', true);

  update public.professional_claims
  set state = 'approved', decided_at = now(), decided_by = v_reviewer,
      decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = v_claim.id
  returning * into v_claim;

  -- Every other live claim on this identity is now moot. Closing them is not
  -- housekeeping: leaving them pending would let a later reviewer approve a
  -- second one and hit 23505 on the one-approval index, which is a confusing
  -- way to discover the profile was already taken.
  update public.professional_claims
  set state = 'rejected', decided_at = now(), decided_by = v_reviewer,
      decision_note = 'another claim for this professional identity was approved'
  where professional_id = v_professional.id
    and state = 'pending'
    and id <> v_claim.id;

  -- Close the acquisition loop. The organization is DERIVED, never supplied:
  -- a caller-provided organization_id would let a reviewer attribute someone
  -- else's conversion. Exactly one owner membership is unambiguous; zero or
  -- several is not, and this declines to guess rather than picking one.
  select count(*) into v_org_count
  from public.memberships m
  where m.user_id = v_claim.claimant_user_id and m.role = 'owner';

  if v_org_count = 1 then
    select m.organization_id into v_org_id
    from public.memberships m
    where m.user_id = v_claim.claimant_user_id and m.role = 'owner';

    v_converted := private.record_prospect_conversion(v_professional.id, v_org_id);
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_reviewer, 'professional_claim_approved', 'professional_claims', v_claim.id,
          jsonb_build_object('professional_id', v_professional.id,
                             'claimant_user_id', v_claim.claimant_user_id,
                             'owner_organization_count', v_org_count,
                             'prospect_conversion_recorded', v_converted));

  return v_claim;
end;
$$;


--
-- Name: FUNCTION review_professional_claim(p_claim_id uuid, p_decision text, p_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.review_professional_claim(p_claim_id uuid, p_decision text, p_note text) IS 'Platform-staff only, and the ONLY path that can move a professional identity to claimed. Locks the claim and then the identity, so simultaneous approvals produce exactly one winner — with a UNIQUE index on (professional_id) WHERE state=''approved'' as the second, independent guarantee. Refuses to transfer an already-claimed identity, refuses a claimant who already holds one (merge is R17''s), closes sibling claims, writes platform_audit_log, and derives the conversion organization from the claimant''s own single owner membership rather than trusting a caller-supplied id.';


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    email text NOT NULL,
    role public.membership_role NOT NULL,
    token text NOT NULL,
    invited_by uuid NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    location_id uuid,
    CONSTRAINT invitations_email_format CHECK ((email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text))
);

ALTER TABLE ONLY public.invitations FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE invitations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invitations IS 'Pending/accepted/revoked invitation for a person to join an organization with a specific role. Redeemed only via accept_invitation().';


--
-- Name: COLUMN invitations.location_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invitations.location_id IS 'Optional location scope for this invitation — becomes the accepted member''s staff_profiles.location_id. NULL means no specific location was named.';


--
-- Name: revoke_invitation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_invitation(p_invitation_id uuid) RETURNS public.invitations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_invitation public.invitations;
begin
  select * into v_invitation from public.invitations where id = p_invitation_id;

  if not found then
    raise exception 'invitation not found';
  end if;

  if not (select private.has_org_role(v_invitation.organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to revoke this invitation';
  end if;

  update public.invitations
  set revoked_at = now()
  where id = p_invitation_id
  returning * into v_invitation;

  return v_invitation;
end;
$$;


--
-- Name: FUNCTION revoke_invitation(p_invitation_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.revoke_invitation(p_invitation_id uuid) IS 'Owner/manager cancels a pending invitation. Raises if the caller is not owner/manager of the invitation''s organization.';


--
-- Name: revoke_passport_share(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_passport_share(p_share_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update public.customer_passport_shares
  set revoked_at = now()
  where id = p_share_id and user_id = (select auth.uid()) and revoked_at is null;

  if not found then
    raise exception 'share not found, not yours, or already revoked';
  end if;
end;
$$;


--
-- Name: FUNCTION revoke_passport_share(p_share_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.revoke_passport_share(p_share_id uuid) IS 'Authenticated-only. Revokes the caller''s own share — raises if it doesn''t exist, isn''t theirs, or is already revoked (never a silent no-op).';


--
-- Name: platform_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    role public.platform_role NOT NULL,
    invited_email text,
    invited_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_invitations_email_format CHECK (((invited_email IS NULL) OR (invited_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text))),
    CONSTRAINT platform_invitations_role_not_owner CHECK ((role <> 'platform_owner'::public.platform_role))
);

ALTER TABLE ONLY public.platform_invitations FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE platform_invitations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.platform_invitations IS 'Pending/accepted/revoked platform_admin or platform_support invitations. Never platform_owner — see platform_invitations_role_not_owner. No client-facing read or write path; only through the RPCs in this migration.';


--
-- Name: revoke_platform_invitation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_platform_invitation(p_id uuid) RETURNS public.platform_invitations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_invitation public.platform_invitations;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may revoke a platform invitation';
  end if;

  update public.platform_invitations
  set revoked_at = now()
  where id = p_id and accepted_at is null and revoked_at is null
  returning * into v_invitation;

  if not found then
    raise exception 'platform invitation not found or already accepted/revoked';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_invitation_revoked', 'platform_invitations', v_invitation.id, '{}'::jsonb);

  return v_invitation;
end;
$$;


--
-- Name: FUNCTION revoke_platform_invitation(p_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.revoke_platform_invitation(p_id uuid) IS 'Platform owner/admin cancels a pending platform invitation.';


--
-- Name: run_booking_maintenance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_booking_maintenance() RETURNS TABLE(expired_requests integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  return query select public.expire_pending_appointments(500);
end;
$$;


--
-- Name: FUNCTION run_booking_maintenance(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.run_booking_maintenance() IS 'The scheduler''s single entry point. Kept separate from the acquisition job queue so booking lifecycle never depends on Worker V2.';


--
-- Name: save_business_profile(uuid, public.business_type, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_business_profile(p_organization_id uuid, p_business_type public.business_type DEFAULT NULL::public.business_type, p_currency text DEFAULT NULL::text, p_country_code text DEFAULT NULL::text, p_name text DEFAULT NULL::text) RETURNS public.organizations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org public.organizations;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may change the business profile'
      using errcode = '42501';
  end if;

  -- coalesce on every column: this is a step in a wizard, so a call that
  -- saves only the business type must not blank out the currency saved by a
  -- later step the user then went back from.
  update public.organizations o set
    business_type = coalesce(p_business_type, o.business_type),
    currency = coalesce(nullif(btrim(upper(coalesce(p_currency, ''))), ''), o.currency),
    country_code = coalesce(nullif(btrim(upper(coalesce(p_country_code, ''))), ''), o.country_code),
    name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), o.name)
  where o.id = p_organization_id
  returning * into v_org;

  return v_org;
end;
$$;


--
-- Name: FUNCTION save_business_profile(p_organization_id uuid, p_business_type public.business_type, p_currency text, p_country_code text, p_name text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.save_business_profile(p_organization_id uuid, p_business_type public.business_type, p_currency text, p_country_code text, p_name text) IS 'Owner/manager-only partial update of the business identity fields. Every argument is optional and NULL means "leave unchanged", so a resumable wizard can save one step without clearing another.';


--
-- Name: search_public_organizations(text, text, text, double precision, double precision, double precision, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_public_organizations(p_country text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS TABLE(organization_id uuid, organization_name text, organization_slug text, location_id uuid, location_name text, location_kind public.location_kind, address_line1 text, city text, region text, postal_code text, country text, service_area_radius_km double precision, covers_search_point boolean, distance_km double precision, starting_price_cents integer, is_open_now boolean, queue_waiting_count integer, total_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with base as (
    select
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      l.id as location_id,
      l.name as location_name,
      l.kind as location_kind,
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.service_area_radius_km,
      l.timezone,
      private.point_distance_km(
        p_latitude, p_longitude,
        -- Exactly one of the two pairs is populated: locations_kind_shape
        -- and locations_service_area_has_no_address between them make any
        -- other combination unrepresentable, so the coalesce cannot pick
        -- the wrong point.
        coalesce(l.latitude, l.service_area_center_latitude),
        coalesce(l.longitude, l.service_area_center_longitude)
      ) as distance_km
    from public.organizations o
    join public.locations l on l.organization_id = o.id
    where o.marketplace_visible
      and l.is_active
      and (p_country is null or l.country = p_country)
      and (p_city is null or l.city ilike p_city)
      and (
        p_query is null or p_query = '' or
        extensions.unaccent(o.name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(l.city) ilike extensions.unaccent('%' || p_query || '%')
      )
  ),
  covered as (
    select
      b.*,
      case
        when b.location_kind = 'service_area'
             and b.distance_km is not null
             and b.service_area_radius_km is not null
          then b.distance_km <= b.service_area_radius_km
        else null
      end as covers_search_point
    from base b
  ),
  filtered as (
    select * from covered
    where p_radius_km is null
       or distance_km is null
       or distance_km <= p_radius_km
       or covers_search_point is true
  )
  select
    f.organization_id,
    f.organization_name,
    f.organization_slug,
    f.location_id,
    f.location_name,
    f.location_kind,
    f.address_line1,
    f.city,
    f.region,
    f.postal_code,
    f.country,
    f.service_area_radius_km,
    f.covers_search_point,
    f.distance_km,
    (
      select min(s.price_cents)
      from public.services s
      join public.service_locations sl on sl.service_id = s.id and sl.location_id = f.location_id
      where s.organization_id = f.organization_id and s.is_active
    ) as starting_price_cents,
    (
      select not lh.is_closed
        and (now() at time zone f.timezone)::time between lh.open_time and lh.close_time
      from public.location_hours lh
      where lh.location_id = f.location_id
        and lh.day_of_week = extract(dow from (now() at time zone f.timezone))::smallint
    ) as is_open_now,
    (
      select count(*)::integer
      from public.queue_entries qe
      where qe.location_id = f.location_id and qe.status = 'waiting'
        and qe.created_at >= (date_trunc('day', now() at time zone f.timezone) at time zone f.timezone)
    ) as queue_waiting_count,
    count(*) over () as total_count
  from filtered f
  order by
    (f.distance_km is not null) desc,
    f.distance_km asc nulls last,
    f.organization_name asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;


--
-- Name: FUNCTION search_public_organizations(p_country text, p_city text, p_query text, p_latitude double precision, p_longitude double precision, p_radius_km double precision, p_limit integer, p_offset integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_public_organizations(p_country text, p_city text, p_query text, p_latitude double precision, p_longitude double precision, p_radius_km double precision, p_limit integer, p_offset integer) IS 'Anon-callable establishment search. Largely redundant with search_public_professionals(p_entity_type => ''shop'') — V2_DATA_CONTRACT §7 has it down to be consumed or deprecated — and kept correct in the meantime: it applies B1''s service-area coverage rule so a mobile professional whose zone reaches the customer is not filtered out for living too far away, and it returns location_kind so no consumer reads a NULL address as missing data.';


--
-- Name: search_public_professionals(text, text, text, text, double precision, double precision, double precision, integer, integer, boolean, text, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_public_professionals(p_country text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_service_query text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision, p_min_price_cents integer DEFAULT NULL::integer, p_max_price_cents integer DEFAULT NULL::integer, p_open_now_only boolean DEFAULT false, p_entity_type text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_sort text DEFAULT 'recommended'::text) RETURNS TABLE(entity_type text, organization_id uuid, organization_name text, organization_slug text, barber_id uuid, professional_id uuid, barber_display_name text, barber_avatar_url text, barber_title text, location_id uuid, location_name text, location_kind public.location_kind, address_line1 text, city text, region text, postal_code text, country text, latitude double precision, longitude double precision, service_area_center_latitude double precision, service_area_center_longitude double precision, service_area_radius_km double precision, covers_search_point boolean, timezone text, distance_km double precision, starting_price_cents integer, is_open_now boolean, queue_waiting_count integer, total_count bigint, marketplace_supply_type text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with shop_base as (
    select
      'shop'::text as entity_type,
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      -- THE MAPPING, AUTHORITATIVE AND HERE. Enumerated value by value rather
      -- than `else 'barbershop'`: a business type added later must resolve to
      -- NULL and render no label, not silently inherit the commoner meaning.
      case o.business_type
        when 'solo_professional' then 'independent'
        when 'barbershop'        then 'barbershop'
        when 'hair_salon'        then 'barbershop'
        when 'mixed_salon'       then 'barbershop'
        when 'multi_location'    then 'barbershop'
        else null
      end::text as marketplace_supply_type,
      null::uuid as barber_id,
      null::uuid as professional_id,
      null::text as barber_display_name,
      null::text as barber_avatar_url,
      null::text as barber_title,
      l.id as location_id,
      l.name as location_name,
      l.kind as location_kind,
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.latitude,
      l.longitude,
      l.service_area_center_latitude,
      l.service_area_center_longitude,
      l.service_area_radius_km,
      l.timezone,
      private.point_distance_km(
        p_latitude, p_longitude,
        -- Exactly one of the two pairs is populated: locations_kind_shape
        -- and locations_service_area_has_no_address between them make any
        -- other combination unrepresentable, so the coalesce cannot pick
        -- the wrong point.
        coalesce(l.latitude, l.service_area_center_latitude),
        coalesce(l.longitude, l.service_area_center_longitude)
      ) as distance_km
    from public.organizations o
    join public.locations l on l.organization_id = o.id
    where o.marketplace_visible
      and l.is_active
      and private.normalize_marketplace_entity_type(p_entity_type) in ('shop', 'all')
      and (p_country is null or l.country = p_country)
      and (
        p_city is null or p_city = '' or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city) or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city || '%')
      )
      and (
        p_query is null or p_query = '' or
        extensions.unaccent(o.name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(l.city) ilike extensions.unaccent('%' || p_query || '%')
      )
      and (
        p_service_query is null or p_service_query = '' or exists (
          select 1
          from public.services s
          join public.service_locations sl on sl.service_id = s.id and sl.location_id = l.id
          where s.organization_id = o.id and s.is_active
            and extensions.unaccent(s.name) ilike extensions.unaccent('%' || p_service_query || '%')
        )
      )
  ),
  barber_base as (
    select
      'barber'::text as entity_type,
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      case o.business_type
        when 'solo_professional' then 'independent'
        when 'barbershop'        then 'barbershop'
        when 'hair_salon'        then 'barbershop'
        when 'mixed_salon'       then 'barbershop'
        when 'multi_location'    then 'barbershop'
        else null
      end::text as marketplace_supply_type,
      b.id as barber_id,
      case when p.claim_state = 'claimed' then p.id else null end as professional_id,
      sp.display_name as barber_display_name,
      sp.avatar_url as barber_avatar_url,
      sp.title as barber_title,
      l.id as location_id,
      l.name as location_name,
      l.kind as location_kind,
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.latitude,
      l.longitude,
      l.service_area_center_latitude,
      l.service_area_center_longitude,
      l.service_area_radius_km,
      l.timezone,
      private.point_distance_km(
        p_latitude, p_longitude,
        -- Exactly one of the two pairs is populated: locations_kind_shape
        -- and locations_service_area_has_no_address between them make any
        -- other combination unrepresentable, so the coalesce cannot pick
        -- the wrong point.
        coalesce(l.latitude, l.service_area_center_latitude),
        coalesce(l.longitude, l.service_area_center_longitude)
      ) as distance_km
    from public.barbers b
    left join public.professionals p on p.id = b.professional_id
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join public.organizations o on o.id = b.organization_id
    join public.locations l on l.id = sp.location_id
    where o.marketplace_visible
      and b.is_bookable
      and sp.is_active
      and sp.is_public
      and l.is_active
      and private.normalize_marketplace_entity_type(p_entity_type) in ('barber', 'all')
      and (p_country is null or l.country = p_country)
      and (
        p_city is null or p_city = '' or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city) or
        extensions.unaccent(l.city) ilike extensions.unaccent(p_city || '%')
      )
      and (
        p_query is null or p_query = '' or
        extensions.unaccent(sp.display_name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(o.name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(l.city) ilike extensions.unaccent('%' || p_query || '%')
      )
      and (
        p_service_query is null or p_service_query = '' or exists (
          select 1
          from public.services s
          join public.barber_services bs on bs.service_id = s.id and bs.barber_id = b.id
          where s.organization_id = o.id and s.is_active
            and extensions.unaccent(s.name) ilike extensions.unaccent('%' || p_service_query || '%')
        )
      )
  ),
  combined as (
    select * from shop_base
    union all
    select * from barber_base
  ),
  priced as (
    select
      c.*,
      -- Does the professional's own zone reach the point the customer is
      -- searching from? NULL when there is no zone or no search point: absent,
      -- not false, because "this is not a zone" and "this zone does not reach
      -- you" are different answers and only one of them is about coverage.
      case
        when c.location_kind = 'service_area'
             and c.distance_km is not null
             and c.service_area_radius_km is not null
          then c.distance_km <= c.service_area_radius_km
        else null
      end as covers_search_point,
      (
        select min(s.price_cents)
        from public.services s
        where s.organization_id = c.organization_id and s.is_active
          and (
            (c.entity_type = 'shop' and exists (
              select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = c.location_id
            ))
            or
            (c.entity_type = 'barber' and exists (
              select 1 from public.barber_services bs where bs.service_id = s.id and bs.barber_id = c.barber_id
            ))
          )
      ) as starting_price_cents,
      (
        select not lh.is_closed
          and (now() at time zone c.timezone)::time between lh.open_time and lh.close_time
        from public.location_hours lh
        where lh.location_id = c.location_id
          and lh.day_of_week = extract(dow from (now() at time zone c.timezone))::smallint
      ) as is_open_now,
      (
        -- Bounded to TODAY in the location's own timezone: nothing in this
        -- schema ever expires a 'waiting' row, so an unbounded count would
        -- advertise last week's queue as a live wait. A barber row counts only
        -- entries assigned to that barber.
        select count(*)::integer
        from public.queue_entries qe
        where qe.location_id = c.location_id and qe.status = 'waiting'
          and qe.created_at >= (date_trunc('day', now() at time zone c.timezone) at time zone c.timezone)
          and (c.entity_type = 'shop' or qe.barber_id = c.barber_id)
      ) as queue_waiting_count
    from combined c
  ),
  filtered as (
    select *
    from priced
    where (
        p_radius_km is null
        or distance_km is null
        or distance_km <= p_radius_km
        -- COVERAGE. The mobile professional whose zone reaches the customer
        -- belongs in the results even when their centre sits outside the
        -- customer's own radius. Without this arm a barber who explicitly
        -- promises to travel to you is filtered out for living too far away.
        or covers_search_point is true
      )
      and (p_min_price_cents is null or starting_price_cents is null or starting_price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or starting_price_cents is null or starting_price_cents <= p_max_price_cents)
      and (not p_open_now_only or is_open_now is true)
  )
  select
    f.entity_type,
    f.organization_id,
    f.organization_name,
    f.organization_slug,
    f.barber_id,
    f.professional_id,
    f.barber_display_name,
    f.barber_avatar_url,
    f.barber_title,
    f.location_id,
    f.location_name,
    f.location_kind,
    f.address_line1,
    f.city,
    f.region,
    f.postal_code,
    f.country,
    f.latitude,
    f.longitude,
    f.service_area_center_latitude,
    f.service_area_center_longitude,
    f.service_area_radius_km,
    f.covers_search_point,
    f.timezone,
    f.distance_km,
    f.starting_price_cents,
    f.is_open_now,
    f.queue_waiting_count,
    count(*) over () as total_count,
    f.marketplace_supply_type
  from filtered f
  order by
    -- NEAREST. A row with no distance sorts last rather than first: "nearest"
    -- must never lead with "unknown".
    case when p_sort = 'nearest' then (f.distance_km is null) end asc,
    case when p_sort = 'nearest' then f.distance_km end asc nulls last,

    -- PRICE, cheapest first. A shop with no published service sorts after
    -- every priced one instead of reading as free.
    case when p_sort = 'price' then (f.starting_price_cents is null) end asc,
    case when p_sort = 'price' then f.starting_price_cents end asc nulls last,

    -- RECOMMENDED — and the fallback for any unrecognised value.
    (f.distance_km is not null) desc,
    f.distance_km asc nulls last,
    f.organization_name asc,
    coalesce(f.barber_display_name, '') asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;


--
-- Name: FUNCTION search_public_professionals(p_country text, p_city text, p_query text, p_service_query text, p_latitude double precision, p_longitude double precision, p_radius_km double precision, p_min_price_cents integer, p_max_price_cents integer, p_open_now_only boolean, p_entity_type text, p_limit integer, p_offset integer, p_sort text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_public_professionals(p_country text, p_city text, p_query text, p_service_query text, p_latitude double precision, p_longitude double precision, p_radius_km double precision, p_min_price_cents integer, p_max_price_cents integer, p_open_now_only boolean, p_entity_type text, p_limit integer, p_offset integer, p_sort text) IS 'Anon-callable. THE marketplace search. Returns the FadeUp offer — Independent and Barbershop establishments — by default, at NULL, and for any unrecognised p_entity_type. A salaried barber is a public, followable, bookable-through-their-shop identity and is never an autonomous search result (MASTER_SPEC §2); pass p_entity_type = ''barber'' or ''all'' to ask for them by name.

Parameters, all optional:
  p_country          text    NULL   exact match on locations.country
  p_city             text    NULL   unaccented ILIKE, exact or prefix
  p_query            text    NULL   unaccented substring over organization name, city, and barber display name on barber rows
  p_service_query    text    NULL   unaccented substring over the names of ACTIVE services offered at that location (shop rows) or by that barber (barber rows)
  p_latitude         float8  NULL   with p_longitude, populates distance_km and covers_search_point; alone it does nothing
  p_longitude        float8  NULL   idem
  p_radius_km        float8  NULL   drops rows further than this, EXCEPT a service area whose own radius reaches the search point (MASTER_SPEC §8). A row with unknown distance is kept, never invented
  p_min_price_cents  int     NULL   floor on the "from" price; a row with no published price passes
  p_max_price_cents  int     NULL   ceiling on the "from" price; same rule
  p_open_now_only    bool    false  keeps only rows whose location_hours say open right now, in the location timezone
  p_entity_type      text    NULL   ''shop'' | ''barber'' | ''all''; NULL, empty and unknown all mean ''shop''
  p_limit            int     20     page size, floored at 0
  p_offset           int     0      page offset, floored at 0
  p_sort             text    ''recommended''  ''recommended'' | ''nearest'' | ''price''; unknown values fall back to recommended

Geography. location_kind is ''physical_address'' or ''service_area''. On a physical address, latitude/longitude are the establishment and the service_area_* columns are NULL. On a service area it is the reverse: latitude/longitude are NULL — there is no address and none is invented — and the zone is described by service_area_center_latitude/longitude plus service_area_radius_km. distance_km is the distance to the address or to the ZONE CENTRE respectively, and covers_search_point tells a service-area row apart from a nearby one: true when the professional''s own zone reaches the customer, NULL when there is no zone or no search point.';


--
-- Name: set_appointment_blocked_range(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_appointment_blocked_range() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.blocked_range := tstzrange(
    new.starts_at - (new.buffer_before_minutes || ' minutes')::interval,
    new.ends_at + (new.buffer_after_minutes || ' minutes')::interval,
    '[)'
  );
  return new;
end;
$$;


--
-- Name: set_appointment_request_expiry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_appointment_request_expiry() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_ttl integer;
begin
  if new.status = 'pending' then
    -- Only derive on the way IN to pending. A row already carrying a deadline
    -- keeps it, so a reschedule or a staff edit never silently extends the
    -- window a customer is already watching count down.
    if new.expires_at is null or (tg_op = 'UPDATE' and old.status is distinct from 'pending') then
      select o.booking_request_ttl_minutes into v_ttl
        from public.organizations o where o.id = new.organization_id;
      new.expires_at := now() + make_interval(mins => coalesce(v_ttl, 1440));
    end if;

    -- A request can never outlive the appointment it is asking for: answering
    -- at 10:05 for a 10:00 slot is not an answer.
    new.expires_at := least(new.expires_at, new.starts_at);
  else
    -- Left pending: there is nothing left to expire. Keeping a stale deadline
    -- would make the sweep and the UI both lie.
    new.expires_at := null;
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION set_appointment_request_expiry(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_appointment_request_expiry() IS 'BEFORE INSERT/UPDATE: derives appointments.expires_at from the organization''s booking_request_ttl_minutes, capped at the appointment start. Server-side only — a client-supplied expires_at is always overwritten.';


--
-- Name: barbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.barbers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    staff_profile_id uuid NOT NULL,
    is_bookable boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    professional_id uuid,
    service_mode_override public.service_mode
);

ALTER TABLE ONLY public.barbers FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE barbers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.barbers IS 'Marks a staff_profiles row as a bookable barber. Service eligibility, working hours and commission rules attach here in later lots, not on staff_profiles directly.';


--
-- Name: COLUMN barbers.professional_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.barbers.professional_id IS 'The durable identity behind this roster seat. Nullable ONLY as an R1B->R2 bridge: the backfill in 20260826100200 fills every row and asserts completeness, and R2 sets NOT NULL. ON DELETE RESTRICT — an identity that still backs a roster row cannot be removed. Not writable by any client (see the column grants below): a shop must not be able to point a roster seat at a professional identity it does not own.';


--
-- Name: COLUMN barbers.service_mode_override; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.barbers.service_mode_override IS 'This barber placement''s PERSISTENT service mode. NULL — the default and the common case — means inherit the establishment default from location_service_settings live, so changing the establishment default moves every inheriting barber with no row updates. Non-NULL means this barber normally works in that mode regardless of the establishment. Beaten by an active temporary override (see service_mode_overrides); beats the establishment default. Deliberately on the OPERATIONAL placement row rather than on the durable public.professionals identity: a professional may work in several establishments under different modes, and R1B''s identity durability must not become mutable operational state. Writable ONLY through public.set_barber_service_mode_override.';


--
-- Name: set_barber_service_mode_override(uuid, public.service_mode); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_barber_service_mode_override(p_barber_id uuid, p_mode public.service_mode DEFAULT NULL::public.service_mode) RETURNS public.barbers
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_location_id uuid;
  v_organization_id uuid;
  v_previous public.service_mode;
  v_row public.barbers;
begin
  -- The establishment is derived from the barber's placement, because the
  -- caller does not supply one — and the mutex has to be the same row the
  -- admission guard locks, or the two would not serialise against each other.
  select sp.location_id into v_location_id
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  where b.id = p_barber_id;

  if not found or v_location_id is null then
    -- Either the barber does not exist, or they are not placed at an
    -- establishment. A barber with no location has no establishment default to
    -- override and no mutex to serialise on; the fix is to place them, which is
    -- a roster action, not a service-mode one.
    raise exception 'not authorized to manage service mode for this professional'
      using errcode = '42501';
  end if;

  v_organization_id := private.assert_service_mode_authority(v_location_id, p_barber_id, false);

  perform private.ensure_location_service_settings(v_location_id);

  -- Same mutex as everything else at this establishment.
  perform 1 from public.location_service_settings s
  where s.location_id = v_location_id
  for update;

  select b.service_mode_override into v_previous
  from public.barbers b where b.id = p_barber_id;

  update public.barbers b
     set service_mode_override = p_mode
   where b.id = p_barber_id
  returning * into v_row;

  insert into public.service_mode_changes (
    organization_id, change_kind, scope, location_id, barber_id,
    previous_mode, new_mode, changed_by_user_id
  ) values (
    v_organization_id, 'barber_override', 'barber', v_location_id, p_barber_id,
    v_previous, p_mode, (select auth.uid())
  );

  return v_row;
end;
$$;


--
-- Name: FUNCTION set_barber_service_mode_override(p_barber_id uuid, p_mode public.service_mode); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_barber_service_mode_override(p_barber_id uuid, p_mode public.service_mode) IS 'Sets a barber placement''s PERSISTENT service mode. owner/manager of that organization, or that barber themselves (resolved from auth.uid(), never from the supplied id). p_mode NULL is the documented way to return to inheriting the establishment default — there is no separate clear function, because clearing IS setting it to inherit. Takes the establishment mutex, so it orders against location mode changes and concurrent admissions. Existing appointments and queue entries are never affected.';


--
-- Name: location_service_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_service_settings (
    location_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    default_service_mode public.service_mode DEFAULT 'hybrid'::public.service_mode NOT NULL,
    queue_open boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    queue_geofence_meters integer DEFAULT 150 NOT NULL,
    queue_call_grace_minutes integer DEFAULT 5 NOT NULL,
    queue_capacity_per_barber integer DEFAULT 20 NOT NULL,
    CONSTRAINT location_service_settings_queue_thresholds_range CHECK ((((queue_geofence_meters >= 25) AND (queue_geofence_meters <= 2000)) AND ((queue_call_grace_minutes >= 0) AND (queue_call_grace_minutes <= 120)) AND ((queue_capacity_per_barber >= 1) AND (queue_capacity_per_barber <= 200))))
);

ALTER TABLE ONLY public.location_service_settings FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE location_service_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.location_service_settings IS 'Per-ESTABLISHMENT service-mode default and live queue runtime state. One row per location, created by trigger and guaranteed by private.ensure_location_service_settings. Also THE MUTEX for the service-mode feature: mode changes take FOR UPDATE on this row, admissions take FOR SHARE, so an admission can never commit against a mode a committed transaction has already replaced. A client never writes this table directly — only through the RPCs in 20260826120400.';


--
-- Name: COLUMN location_service_settings.default_service_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.location_service_settings.default_service_mode IS 'The establishment default. Barbers with barbers.service_mode_override IS NULL inherit it live — changing this column moves every inheriting barber without touching a single barber row.';


--
-- Name: COLUMN location_service_settings.queue_open; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.location_service_settings.queue_open IS 'Runtime live-queue state: is the queue accepting NEW entries right now? Deliberately independent of default_service_mode — every combination of the two is legitimate and representable, and changing the mode never silently mutates this. Not opening hours (see location_hours) and not availability.';


--
-- Name: COLUMN location_service_settings.queue_geofence_meters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.location_service_settings.queue_geofence_meters IS 'How close a customer must be to join the live queue. 150 m by default (MASTER_SPEC §7). The lower bound of 25 m is GPS accuracy — a tighter fence would refuse people standing in the shop; the upper bound of 2 km is where "physically present" stops meaning anything.';


--
-- Name: COLUMN location_service_settings.queue_call_grace_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.location_service_settings.queue_call_grace_minutes IS 'Minutes a called customer keeps their place before being treated as absent. 5 by default (MASTER_SPEC §7). STORED AND EXPOSED BY B1, NOT YET ENFORCED: no sweep marks a called entry missed. The operator does it by hand today, exactly as before, and the column is what the sweep will read when it is written.';


--
-- Name: COLUMN location_service_settings.queue_capacity_per_barber; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.location_service_settings.queue_capacity_per_barber IS 'How many customers may be WAITING per bookable barber before the public queue refuses new entries. 20 by default (MASTER_SPEC §7). Enforced at the public door only: a receptionist adding a walk-in at the desk is making a deliberate operational decision and is not blocked by it.';


--
-- Name: set_location_queue_open(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_location_queue_open(p_location_id uuid, p_queue_open boolean) RETURNS public.location_service_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_organization_id uuid;
  v_previous boolean;
  v_row public.location_service_settings;
begin
  if p_queue_open is null then
    raise exception 'queue_open is required' using errcode = '22023';
  end if;

  -- Receptionists included: closing the line is a front-of-house judgement.
  v_organization_id := private.assert_service_mode_authority(p_location_id, null, true);

  perform private.ensure_location_service_settings(p_location_id);

  select s.queue_open into v_previous
  from public.location_service_settings s
  where s.location_id = p_location_id
  for update;

  update public.location_service_settings s
     set queue_open = p_queue_open
   where s.location_id = p_location_id
  returning * into v_row;

  insert into public.service_mode_changes (
    organization_id, change_kind, scope, location_id, barber_id,
    previous_queue_open, new_queue_open, changed_by_user_id
  ) values (
    v_organization_id, 'queue_open', 'location', p_location_id, null,
    v_previous, p_queue_open, (select auth.uid())
  );

  return v_row;
end;
$$;


--
-- Name: FUNCTION set_location_queue_open(p_location_id uuid, p_queue_open boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_location_queue_open(p_location_id uuid, p_queue_open boolean) IS 'Opens or closes the live queue for NEW entries at one establishment. owner/manager/receptionist — closing the line is a front-of-house judgement made several times a week, and restricting it to owners would mean it never gets used. Changes queue_open and NOTHING else: it never reads or adjusts the service mode, exactly as a mode change never reads or adjusts this. Closing the queue does NOT cancel, remove or alter anyone already waiting — it only stops new arrivals joining.';


--
-- Name: set_location_service_mode(uuid, public.service_mode); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_location_service_mode(p_location_id uuid, p_mode public.service_mode) RETURNS public.location_service_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_organization_id uuid;
  v_previous public.service_mode;
  v_row public.location_service_settings;
begin
  if p_mode is null then
    raise exception 'a service mode is required' using errcode = '22023';
  end if;

  v_organization_id := private.assert_service_mode_authority(p_location_id, null, false);

  perform private.ensure_location_service_settings(p_location_id);

  -- THE MUTEX. Everything below is serialised per establishment, and every
  -- concurrent admission is either already committed or will read the value
  -- this transaction is about to write.
  select s.default_service_mode into v_previous
  from public.location_service_settings s
  where s.location_id = p_location_id
  for update;

  update public.location_service_settings s
     set default_service_mode = p_mode
   where s.location_id = p_location_id
  returning * into v_row;

  -- Recorded even when the value did not change. "Someone looked at this and
  -- confirmed it" is itself worth knowing when reconstructing a Saturday, and
  -- a conditional insert would make the history's silences ambiguous.
  insert into public.service_mode_changes (
    organization_id, change_kind, scope, location_id, barber_id,
    previous_mode, new_mode, changed_by_user_id
  ) values (
    v_organization_id, 'location_default', 'location', p_location_id, null,
    v_previous, p_mode, (select auth.uid())
  );

  return v_row;
end;
$$;


--
-- Name: FUNCTION set_location_service_mode(p_location_id uuid, p_mode public.service_mode); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_location_service_mode(p_location_id uuid, p_mode public.service_mode) IS 'Sets the ESTABLISHMENT default service mode. owner/manager only. Per location, never per organization — a multi-salon group changes one salon at a time. Takes the establishment mutex before reading, so it orders deterministically against concurrent admissions and other mode changes. Governs NEW admissions only: existing appointments and queue entries are never touched, cancelled or altered by this call. Writes the audit row in the same transaction, including when the value is unchanged.';


--
-- Name: set_organization_marketplace_visible(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_organization_marketplace_visible(p_organization_id uuid, p_visible boolean) RETURNS public.organizations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_role public.membership_role;
  v_org public.organizations;
begin
  select role into v_role
  from public.memberships
  where organization_id = p_organization_id and user_id = (select auth.uid());

  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager may change marketplace visibility';
  end if;

  update public.organizations set marketplace_visible = p_visible where id = p_organization_id returning * into v_org;
  return v_org;
end;
$$;


--
-- Name: FUNCTION set_organization_marketplace_visible(p_organization_id uuid, p_visible boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_organization_marketplace_visible(p_organization_id uuid, p_visible boolean) IS 'Owner/manager only. Explicit opt-in/opt-out of public marketplace listing for this organization.';


--
-- Name: outreach_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    channel public.outreach_channel_kind DEFAULT 'whatsapp'::public.outreach_channel_kind NOT NULL,
    status public.outreach_campaign_status DEFAULT 'draft'::public.outreach_campaign_status NOT NULL,
    selection_filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    whatsapp_account_id uuid,
    experiment_id uuid,
    max_sends_per_hour integer DEFAULT 60 NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_by uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outreach_campaigns_approval_shape CHECK (((status <> ALL (ARRAY['running'::public.outreach_campaign_status, 'completed'::public.outreach_campaign_status])) OR ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL)))),
    CONSTRAINT outreach_campaigns_max_sends_per_hour_check CHECK (((max_sends_per_hour >= 1) AND (max_sends_per_hour <= 10000))),
    CONSTRAINT outreach_campaigns_name_check CHECK ((btrim(name) <> ''::text))
);

ALTER TABLE ONLY public.outreach_campaigns FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE outreach_campaigns; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.outreach_campaigns IS 'A WhatsApp (or other channel) campaign. A campaign cannot reach ''running'' without a recorded human approval — the CHECK above is the server-side half of the /platform prepare -> approve -> queue workflow.';


--
-- Name: set_outreach_campaign_status(uuid, public.outreach_campaign_status); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_outreach_campaign_status(p_campaign_id uuid, p_status public.outreach_campaign_status) RETURNS public.outreach_campaigns
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_campaign public.outreach_campaigns;
  v_queued int;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'set_outreach_campaign_status: platform admin role required' using errcode = '42501';
  end if;

  select * into v_campaign from public.outreach_campaigns where id = p_campaign_id;
  if not found then
    raise exception 'set_outreach_campaign_status: campaign % not found', p_campaign_id;
  end if;

  if v_campaign.status in ('completed', 'cancelled') then
    raise exception 'set_outreach_campaign_status: campaign % is already % and cannot change state',
      p_campaign_id, v_campaign.status using errcode = 'check_violation';
  end if;

  if p_status = 'running' then
    select count(*) into v_queued
    from public.outreach_recipients
    where campaign_id = p_campaign_id and state = 'queued';

    if v_queued = 0 then
      raise exception 'set_outreach_campaign_status: campaign % has no queued recipients — prepare it first', p_campaign_id
        using errcode = 'check_violation';
    end if;

    update public.outreach_campaigns
    set status = 'running',
        approved_by = coalesce(approved_by, (select auth.uid())),
        approved_at = coalesce(approved_at, now()),
        started_at = coalesce(started_at, now())
    where id = p_campaign_id
    returning * into v_campaign;
  else
    update public.outreach_campaigns
    set status = p_status,
        completed_at = case when p_status in ('completed', 'cancelled') then now() else completed_at end
    where id = p_campaign_id
    returning * into v_campaign;
  end if;

  return v_campaign;
end;
$$;


--
-- Name: set_outreach_template_paused(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_outreach_template_paused(p_template_id uuid, p_paused boolean) RETURNS public.outreach_templates
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_template public.outreach_templates;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'set_outreach_template_paused: platform admin role required' using errcode = '42501';
  end if;

  select * into v_template from public.outreach_templates where id = p_template_id;
  if not found then
    raise exception 'set_outreach_template_paused: template % not found', p_template_id;
  end if;

  if p_paused then
    update public.outreach_templates set status = 'paused' where id = p_template_id returning * into v_template;
  else
    -- Resuming returns the template to approved ONLY if it was previously
    -- approved; otherwise it goes back to draft and must be re-approved.
    update public.outreach_templates
    set status = case when approved_by is not null then 'approved'::public.outreach_template_status
                      else 'draft'::public.outreach_template_status end
    where id = p_template_id
    returning * into v_template;
  end if;

  return v_template;
end;
$$;


--
-- Name: prospect_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_identity_trust_anchor boolean DEFAULT false NOT NULL,
    independence_group text,
    CONSTRAINT prospect_sources_key_check CHECK ((key ~ '^[a-z0-9_]+$'::text))
);

ALTER TABLE ONLY public.prospect_sources FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_sources; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_sources IS 'Registry of discovery/enrichment adapters (osm, geoapify, sirene, google_places, website, instagram). config is non-secret tuning only — API keys live in Worker environment, never here.';


--
-- Name: COLUMN prospect_sources.is_identity_trust_anchor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.prospect_sources.is_identity_trust_anchor IS 'True when an observation from this source is, on its own, sufficient identity evidence to mint an external professional identity — i.e. the source is a verified business registry rather than a places directory. Read by public.publication_block_reason. Defaults false: a newly added source earns this deliberately, never by arriving.';


--
-- Name: COLUMN prospect_sources.independence_group; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.prospect_sources.independence_group IS 'Names the UNDERLYING observer this source reports. Sources sharing a group are not independent of one another and count ONCE toward publication evidence. NULL means the source is its own independent observer — the default, and deliberately not auto-filled, because "nobody has assessed this" and "assessed as independent" must stay distinguishable.';


--
-- Name: set_prospect_source_enabled(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_prospect_source_enabled(p_key text, p_enabled boolean) RETURNS public.prospect_sources
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_source public.prospect_sources;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may change source configuration';
  end if;

  update public.prospect_sources set is_enabled = p_enabled where key = p_key returning * into v_source;

  if not found then
    raise exception 'unknown source key: %', p_key;
  end if;

  return v_source;
end;
$$;


--
-- Name: api_source_health; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_source_health (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    requests_today integer DEFAULT 0 NOT NULL,
    requests_this_month integer DEFAULT 0 NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL,
    rate_limited_count integer DEFAULT 0 NOT NULL,
    avg_latency_ms numeric,
    last_request_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_failure_at timestamp with time zone,
    last_error text,
    is_paused boolean DEFAULT false NOT NULL,
    paused_reason text,
    last_reset_day date DEFAULT CURRENT_DATE NOT NULL,
    last_reset_month date DEFAULT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT api_source_health_failure_count_check CHECK ((failure_count >= 0)),
    CONSTRAINT api_source_health_rate_limited_count_check CHECK ((rate_limited_count >= 0)),
    CONSTRAINT api_source_health_requests_this_month_check CHECK ((requests_this_month >= 0)),
    CONSTRAINT api_source_health_requests_today_check CHECK ((requests_today >= 0)),
    CONSTRAINT api_source_health_success_count_check CHECK ((success_count >= 0))
);

ALTER TABLE ONLY public.api_source_health FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE api_source_health; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.api_source_health IS 'Rolling per-source counters, derived from api_usage by private.record_api_usage(). requests_today/requests_this_month reset lazily on first use after a day/month rollover (no pg_cron — see migration header).';


--
-- Name: set_prospect_source_paused(text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_prospect_source_paused(p_key text, p_paused boolean, p_reason text DEFAULT NULL::text) RETURNS public.api_source_health
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_health public.api_source_health;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may pause/resume a source';
  end if;

  update public.api_source_health h
  set is_paused = p_paused, paused_reason = case when p_paused then p_reason else null end
  from public.prospect_sources s
  where h.source_id = s.id and s.key = p_key
  returning h.* into v_health;

  if not found then
    raise exception 'unknown source key: %', p_key;
  end if;

  return v_health;
end;
$$;


--
-- Name: service_mode_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_mode_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    scope public.service_mode_scope NOT NULL,
    location_id uuid NOT NULL,
    barber_id uuid,
    mode public.service_mode NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    cleared_at timestamp with time zone,
    cleared_by_user_id uuid,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_mode_overrides_barber_matches_scope CHECK (((scope = 'barber'::public.service_mode_scope) = (barber_id IS NOT NULL))),
    CONSTRAINT service_mode_overrides_cleared_pair CHECK (((cleared_by_user_id IS NULL) OR (cleared_at IS NOT NULL))),
    CONSTRAINT service_mode_overrides_window_ordered CHECK (((expires_at IS NULL) OR (expires_at > starts_at)))
);

ALTER TABLE ONLY public.service_mode_overrides FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE service_mode_overrides; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.service_mode_overrides IS 'Temporary service-mode exceptions, at establishment or barber-placement scope. Expiry is a RESOLVER PREDICATE, never a job: a row stops applying the instant expires_at <= now(), with no cron, worker or browser involved, and rows are never deleted on expiry so the history survives. expires_at NULL means "until manually changed". At most one uncleared row per target is a database guarantee (partial unique indexes below), so the effective mode is never ambiguous.';


--
-- Name: COLUMN service_mode_overrides.location_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.service_mode_overrides.location_id IS 'Always present, including for barber-scoped rows: it is the tenant anchor (staff_profiles.location_id is nullable and ON DELETE SET NULL, so it cannot be relied on), the mutex key every write locks, and half of the (location_id, barber_id) pair the resolver reads.';


--
-- Name: COLUMN service_mode_overrides.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.service_mode_overrides.expires_at IS 'Absolute instant, always timestamptz. UI durations ("30 minutes", "today", "until closing") are resolved to an absolute instant by the caller using the ESTABLISHMENT''S timezone before reaching the database — the backend never receives a vague string and never depends on the server''s timezone. NULL means "until manually changed", which is a product state rather than a missing value.';


--
-- Name: COLUMN service_mode_overrides.cleared_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.service_mode_overrides.cleared_at IS 'Set when this override is superseded by a newer one or explicitly cleared. Rows are never deleted, so this is what distinguishes "current" from "history" — and what the partial unique indexes key on to guarantee at most one active override per target.';


--
-- Name: set_service_mode_temporary_override(public.service_mode_scope, uuid, public.service_mode, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_service_mode_temporary_override(p_scope public.service_mode_scope, p_location_id uuid, p_mode public.service_mode, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_barber_id uuid DEFAULT NULL::uuid) RETURNS public.service_mode_overrides
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_organization_id uuid;
  v_now timestamptz := now();
  v_actor uuid := (select auth.uid());
  v_row public.service_mode_overrides;
begin
  if p_scope is null or p_mode is null then
    raise exception 'scope and mode are required' using errcode = '22023';
  end if;

  if (p_scope = 'barber') <> (p_barber_id is not null) then
    raise exception 'barber scope requires a barber, location scope forbids one'
      using errcode = '22023';
  end if;

  -- An override that has already expired would be inert the moment it is
  -- written — accepting it would leave the author believing they had changed
  -- something. NULL stays legal: it means "until manually changed".
  if p_expires_at is not null and p_expires_at <= v_now then
    raise exception 'the override end time must be in the future' using errcode = '22023';
  end if;

  v_organization_id := private.assert_service_mode_authority(
    p_location_id, p_barber_id, false
  );

  perform private.ensure_location_service_settings(p_location_id);

  -- THE MUTEX, before the clear and the insert, so the pair is atomic against
  -- another writer and against every concurrent admission.
  perform 1 from public.location_service_settings s
  where s.location_id = p_location_id
  for update;

  -- Supersede whatever is current for this exact target. Not deleted: the row
  -- stays as history, and cleared_at is what the unique index keys on.
  update public.service_mode_overrides o
     set cleared_at = v_now,
         cleared_by_user_id = v_actor
   where o.cleared_at is null
     and o.scope = p_scope
     and (
       (p_scope = 'location' and o.location_id = p_location_id)
       or (p_scope = 'barber' and o.barber_id = p_barber_id)
     );

  insert into public.service_mode_overrides (
    organization_id, scope, location_id, barber_id, mode,
    starts_at, expires_at, created_by_user_id
  ) values (
    v_organization_id, p_scope, p_location_id, p_barber_id, p_mode,
    v_now, p_expires_at, v_actor
  )
  returning * into v_row;

  insert into public.service_mode_changes (
    organization_id, change_kind, scope, location_id, barber_id,
    new_mode, expires_at, changed_by_user_id
  ) values (
    v_organization_id, 'temporary_override_set', p_scope, p_location_id, p_barber_id,
    p_mode, p_expires_at, v_actor
  );

  return v_row;
end;
$$;


--
-- Name: FUNCTION set_service_mode_temporary_override(p_scope public.service_mode_scope, p_location_id uuid, p_mode public.service_mode, p_expires_at timestamp with time zone, p_barber_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_service_mode_temporary_override(p_scope public.service_mode_scope, p_location_id uuid, p_mode public.service_mode, p_expires_at timestamp with time zone, p_barber_id uuid) IS 'Creates a temporary service-mode override at establishment or barber scope, superseding any override currently active on that exact target. owner/manager for either scope; a barber may also set their own. p_expires_at is an ABSOLUTE instant or NULL for "until manually changed" — the UI resolves "30 minutes"/"today"/"until closing" against the establishment''s timezone before calling, and this function never receives a duration or a vague string. Supersede-then-insert happens inside the establishment mutex, which is what makes "exactly one active override" hold under concurrency instead of surfacing as a unique violation.';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: FUNCTION set_updated_at(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_updated_at() IS 'Trigger function: sets NEW.updated_at = now() on every UPDATE of the row it is attached to.';


--
-- Name: stamp_passport_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stamp_passport_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_candidate text;
  v_attempt integer := 0;
begin
  new.issued_at := coalesce(new.issued_at, now());

  loop
    v_attempt := v_attempt + 1;
    v_candidate := private.generate_passport_number();
    exit when not exists (
      select 1 from public.customer_passports where passport_number = v_candidate
    );
    if v_attempt >= 5 then
      raise exception 'could not allocate a unique Passport number after % attempts', v_attempt
        using errcode = 'P0001';
    end if;
  end loop;

  new.passport_number := v_candidate;
  return new;
end;
$$;


--
-- Name: FUNCTION stamp_passport_identity(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.stamp_passport_identity() IS 'BEFORE INSERT on customer_passports. Always overwrites passport_number and issued_at with server-generated values, so no caller — client, service_role or direct SQL — can choose their own Passport number. The unique index remains the actual authority; this loop only stops a collision surfacing as a failed signup.';


--
-- Name: start_platform_support_session(uuid, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_platform_support_session(p_organization_id uuid, p_target_type text, p_target_user_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text) RETURNS public.platform_support_sessions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_session public.platform_support_sessions;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may start a support-view session';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'organization not found';
  end if;

  -- Close any session this actor left open — starting a new one always
  -- means "I'm switching what I'm looking at now", not stacking contexts.
  update public.platform_support_sessions
  set ended_at = now()
  where platform_actor_id = (select auth.uid()) and ended_at is null;

  insert into public.platform_support_sessions (platform_actor_id, organization_id, target_type, target_user_id, reason)
  values ((select auth.uid()), p_organization_id, p_target_type, p_target_user_id, nullif(btrim(p_reason), ''))
  returning * into v_session;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    'platform_support_session_started',
    'organizations',
    p_organization_id,
    jsonb_build_object('session_id', v_session.id, 'target_type', p_target_type, 'target_user_id', p_target_user_id)
  );

  return v_session;
end;
$$;


--
-- Name: FUNCTION start_platform_support_session(p_organization_id uuid, p_target_type text, p_target_user_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.start_platform_support_session(p_organization_id uuid, p_target_type text, p_target_user_id uuid, p_reason text) IS 'Platform owner/admin only. Opens (and audits) an explicit support-view session for one organization, closing any session the caller left open.';


--
-- Name: submit_professional_application(text, text, text, text, public.professional_type, text, text, text, text, integer, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_professional_application(p_first_name text, p_last_name text, p_phone text, p_business_name text, p_professional_type public.professional_type, p_city text DEFAULT NULL::text, p_address_line1 text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_staff_count integer DEFAULT NULL::integer, p_website text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_business_identifier text DEFAULT NULL::text) RETURNS public.professional_applications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
  v_email text;
  v_application public.professional_applications;
  v_existing public.professional_applications;
  v_phone text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'authentication required to submit a professional application';
  end if;

  -- The email is taken from the verified auth identity, never from the form:
  -- a reviewer must be able to trust that the address they see is the one
  -- that actually owns the account.
  select u.email into v_email from auth.users u where u.id = v_user_id;
  if v_email is null or btrim(v_email) = '' then
    raise exception 'this account has no email address';
  end if;

  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'first and last name are required';
  end if;
  if btrim(coalesce(p_business_name, '')) = '' then
    raise exception 'business name is required';
  end if;

  -- Phone is the qualification channel — the reviewer calls this number — so
  -- it is required and normalized here rather than trusted from the client.
  v_phone := public.normalize_phone_number(p_phone);
  if v_phone is null then
    raise exception 'a valid phone number is required';
  end if;

  -- Resubmission is idempotent rather than an error: a double-submit (or a
  -- refresh mid-request) should land the applicant on their status screen,
  -- not on a unique-violation stack trace.
  select * into v_existing
    from public.professional_applications a
    where a.user_id = v_user_id and a.status in ('pending_review', 'approved')
    limit 1;
  if found then
    return v_existing;
  end if;

  insert into public.professional_applications (
    user_id, first_name, last_name, email, phone,
    business_name, professional_type, city, address_line1, postal_code, country,
    staff_count, website, instagram, business_identifier, status
  )
  values (
    v_user_id, btrim(p_first_name), btrim(p_last_name), lower(btrim(v_email)), v_phone,
    btrim(p_business_name), p_professional_type,
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_address_line1, '')), ''),
    nullif(btrim(coalesce(p_postal_code, '')), ''),
    nullif(btrim(coalesce(p_country, '')), ''),
    p_staff_count,
    nullif(btrim(coalesce(p_website, '')), ''),
    nullif(btrim(coalesce(p_instagram, '')), ''),
    nullif(btrim(coalesce(p_business_identifier, '')), ''),
    'pending_review'
  )
  returning * into v_application;

  -- Fan out to every platform member. Body carries only what a reviewer needs
  -- to decide whether to open the item — no phone, no address.
  insert into public.platform_notifications (recipient_user_id, type, title, body, target_type, target_id)
  select
    pm.user_id,
    'professional_application_submitted',
    v_application.business_name,
    v_application.first_name || ' ' || v_application.last_name,
    'professional_applications',
    v_application.id
  from public.platform_members pm;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_user_id,
    'professional_application_submitted',
    'professional_applications',
    v_application.id,
    jsonb_build_object(
      'business_name', v_application.business_name,
      'professional_type', v_application.professional_type
    )
  );

  return v_application;
end;
$$;


--
-- Name: FUNCTION submit_professional_application(p_first_name text, p_last_name text, p_phone text, p_business_name text, p_professional_type public.professional_type, p_city text, p_address_line1 text, p_postal_code text, p_country text, p_staff_count integer, p_website text, p_instagram text, p_business_identifier text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.submit_professional_application(p_first_name text, p_last_name text, p_phone text, p_business_name text, p_professional_type public.professional_type, p_city text, p_address_line1 text, p_postal_code text, p_country text, p_staff_count integer, p_website text, p_instagram text, p_business_identifier text) IS 'Creates the caller''s professional application (status always pending_review — never client-chosen), notifies every platform member and writes an audit event. Idempotent: re-submitting while an application is pending or approved returns the existing row instead of raising.';


--
-- Name: submit_professional_claim(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_professional_claim(p_professional_id uuid, p_evidence text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
  v_claim_state public.professional_claim_state;
  v_claim_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'claiming a professional identity requires an authenticated session'
      using errcode = '42501';
  end if;

  select p.claim_state into v_claim_state
  from public.professionals p
  where p.id = p_professional_id;

  if v_claim_state is null then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  -- An already-claimed identity is not available. Refused here AND again
  -- under a row lock at review time, because the state can change between the
  -- two.
  if v_claim_state = 'claimed' then
    raise exception 'this professional identity is already claimed'
      using errcode = '42501';
  end if;

  -- The claimant must not already hold an identity. Approving this would
  -- require MERGING two professional identities, and a merge that silently
  -- picked a winner would destroy one person's history. R17 owns merge; until
  -- it exists this fails closed rather than guessing.
  if exists (select 1 from public.professionals p where p.user_id = v_user_id) then
    raise exception 'this account already has a professional identity; merging identities is not yet supported'
      using errcode = '42501';
  end if;

  -- Idempotent: a double-submitted form returns the existing claim rather
  -- than a 23505 the caller has to interpret, and the partial unique index
  -- remains the actual guarantee against a concurrent second insert.
  select c.id into v_claim_id
  from public.professional_claims c
  where c.professional_id = p_professional_id
    and c.claimant_user_id = v_user_id
    and c.state = 'pending';

  if v_claim_id is not null then
    return v_claim_id;
  end if;

  insert into public.professional_claims (professional_id, claimant_user_id, evidence)
  values (p_professional_id, v_user_id, nullif(btrim(coalesce(p_evidence, '')), ''))
  returning id into v_claim_id;

  return v_claim_id;
end;
$$;


--
-- Name: FUNCTION submit_professional_claim(p_professional_id uuid, p_evidence text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.submit_professional_claim(p_professional_id uuid, p_evidence text) IS 'Authenticated-only. Files a claim and grants NOTHING — the identity stays unclaimed until platform staff approve. Idempotent per (identity, claimant). Refuses an already-claimed identity, and refuses a claimant who already holds an identity, because approving that would need a merge and a silent merge would destroy one person''s history (R17 owns merge).';


--
-- Name: suggested_currency_for_country(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.suggested_currency_for_country(p_country_code text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case upper(btrim(coalesce(p_country_code, '')))
    when 'FR' then 'EUR' when 'BE' then 'EUR' when 'DE' then 'EUR' when 'ES' then 'EUR'
    when 'IT' then 'EUR' when 'NL' then 'EUR' when 'PT' then 'EUR' when 'LU' then 'EUR'
    when 'IE' then 'EUR' when 'AT' then 'EUR' when 'FI' then 'EUR' when 'GR' then 'EUR'
    when 'MC' then 'EUR'
    when 'GB' then 'GBP'
    when 'CH' then 'CHF'
    when 'US' then 'USD'
    when 'CA' then 'CAD'
    when 'MA' then 'MAD'
    when 'AE' then 'AED'
    else null
  end;
$$;


--
-- Name: FUNCTION suggested_currency_for_country(p_country_code text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.suggested_currency_for_country(p_country_code text) IS 'Suggested ISO 4217 currency for a country, or NULL when there is no confident single answer. A SUGGESTION only — an explicit choice made in onboarding always overrides it. France resolves to EUR; nothing here ever falls back to USD.';


--
-- Name: suggested_timezone_for_country(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.suggested_timezone_for_country(p_country_code text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case upper(btrim(coalesce(p_country_code, '')))
    when 'FR' then 'Europe/Paris'   when 'BE' then 'Europe/Brussels'
    when 'DE' then 'Europe/Berlin'  when 'ES' then 'Europe/Madrid'
    when 'IT' then 'Europe/Rome'    when 'NL' then 'Europe/Amsterdam'
    when 'PT' then 'Europe/Lisbon'  when 'LU' then 'Europe/Luxembourg'
    when 'IE' then 'Europe/Dublin'  when 'AT' then 'Europe/Vienna'
    when 'CH' then 'Europe/Zurich'  when 'GB' then 'Europe/London'
    when 'MC' then 'Europe/Monaco'  when 'MA' then 'Africa/Casablanca'
    when 'AE' then 'Asia/Dubai'
    -- US and CA span several zones; guessing one would silently mis-schedule
    -- every appointment, so they deliberately return NULL and are asked.
    else null
  end;
$$;


--
-- Name: FUNCTION suggested_timezone_for_country(p_country_code text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.suggested_timezone_for_country(p_country_code text) IS 'Suggested IANA timezone for single-timezone countries, NULL otherwise (US/CA deliberately return NULL rather than a guess — a wrong timezone corrupts every computed slot).';


--
-- Name: suppress_prospect_outreach(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.suppress_prospect_outreach(p_prospect_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'suppress_prospect_outreach: platform admin role required' using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'suppress_prospect_outreach: a reason is required' using errcode = 'check_violation';
  end if;

  insert into public.prospect_suppressions (scope, prospect_id, reason, created_by)
  values ('prospect', p_prospect_id, p_reason, (select auth.uid()))
  on conflict (prospect_id) where scope = 'prospect' do nothing;

  update public.prospect_outreach_eligibility
  set is_eligible = false,
      do_not_contact = true,
      suppression_reason = p_reason,
      last_evaluated_at = now()
  where prospect_id = p_prospect_id;

  update public.outreach_recipients
  set state = 'blocked', blocked_reason = 'suppressed'
  where prospect_id = p_prospect_id
    and state in ('pending', 'queued');
end;
$$;


--
-- Name: sweep_prospect_publication_eligibility(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sweep_prospect_publication_eligibility(p_limit integer DEFAULT 100) RETURNS TABLE(prospect_id uuid, is_eligible boolean, block_reason text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_id uuid;
  v_row public.prospect_publication_eligibility;
begin
  if not (
    (select private.has_platform_role(
       array['platform_owner', 'platform_admin']::public.platform_role[]))
    or ((select auth.uid()) is null and session_user = 'prospect_worker')
  ) then
    raise exception 'only FadeUp platform administrators or the acquisition worker can evaluate publication eligibility'
      using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'limit must be between 1 and 1000' using errcode = '22023';
  end if;

  for v_id in
    select p.id
    from public.prospects p
    left join public.prospect_publication_eligibility e on e.prospect_id = p.id
    order by e.evaluated_at asc nulls first, p.first_discovered_at asc
    limit p_limit
  loop
    v_row := public.refresh_prospect_publication_eligibility(v_id);
    prospect_id := v_row.prospect_id;
    is_eligible := v_row.is_eligible;
    block_reason := v_row.block_reason;
    return next;
  end loop;
end;
$$;


--
-- Name: FUNCTION sweep_prospect_publication_eligibility(p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sweep_prospect_publication_eligibility(p_limit integer) IS 'Re-evaluates a bounded batch of prospects, least recently evaluated first and never-evaluated first of all. Deliberately re-checks BLOCKED prospects too: a prospect blocked on unresolved_duplicate or insufficient_source_evidence becomes eligible when the duplicate is reviewed or a second source lands, and nothing else in the system would notice. Hard-capped at 1000 per call so a bad argument cannot turn into a table scan of function calls.';


--
-- Name: track_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.track_analytics_event(p_event_name text, p_event_origin text, p_organization_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid, p_barber_id uuid DEFAULT NULL::uuid, p_professional_id uuid DEFAULT NULL::uuid, p_properties jsonb DEFAULT '{}'::jsonb, p_session_id text DEFAULT NULL::text, p_locale text DEFAULT NULL::text, p_correlation_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
  v_origin public.analytics_event_origin;
  v_slug text;
  v_reason text;
  v_professional_id uuid;
begin
  v_user_id := auth.uid();

  -- 6.1 Origin. Parsed rather than cast blindly, so an unknown string is a
  -- clean refusal instead of an invalid_text_representation error that tells
  -- the caller nothing.
  if p_event_origin is null
     or p_event_origin not in ('public_web', 'customer_web', 'customer_mobile', 'pro_web') then
    v_reason := 'origin not permitted for a client caller';
    insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
    values (p_event_name, p_event_origin, v_reason, 'client_rpc');
    raise exception 'analytics origin % is not permitted for a client', coalesce(p_event_origin, '(null)')
      using errcode = '42501';
  end if;

  v_origin := p_event_origin::public.analytics_event_origin;

  -- 6.2 A signed-out caller cannot claim a signed-in surface. customer_web and
  -- pro_web describe authenticated experiences; allowing anon to assert them
  -- would make "logged-in engagement" uncountable.
  if v_user_id is null and v_origin in ('customer_web', 'pro_web') then
    insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
    values (p_event_name, p_event_origin, 'anonymous caller claimed an authenticated origin', 'client_rpc');
    raise exception 'authentication required for origin %', p_event_origin
      using errcode = '42501';
  end if;

  -- 6.3 Tenant context must be real and public. An arbitrary organization_id
  -- from a browser is exactly what CLAUDE.md says never to trust.
  if p_organization_id is not null then
    select o.slug::text into v_slug
    from public.organizations o
    where o.id = p_organization_id;

    if v_slug is null then
      insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
      values (p_event_name, p_event_origin, 'unknown organization', 'client_rpc');
      raise exception 'organization unavailable' using errcode = '42501';
    end if;

    perform 1 from public.get_public_organization(v_slug) limit 1;

    if not found then
      insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
      values (p_event_name, p_event_origin, 'organization is not public', 'client_rpc');
      raise exception 'organization unavailable' using errcode = '42501';
    end if;
  end if;

  -- 6.4 Location and barber must belong to the organization that was claimed.
  -- Without this a caller could attribute a view of shop A to shop B's
  -- location, which corrupts both tenants' reports at once.
  if p_location_id is not null then
    if p_organization_id is null or not exists (
      select 1 from public.locations l
      where l.id = p_location_id and l.organization_id = p_organization_id
    ) then
      insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
      values (p_event_name, p_event_origin, 'location does not belong to the claimed organization', 'client_rpc');
      raise exception 'analytics context is not coherent' using errcode = '42501';
    end if;
  end if;

  if p_barber_id is not null then
    if p_organization_id is null or not exists (
      select 1 from public.barbers b
      where b.id = p_barber_id and b.organization_id = p_organization_id
    ) then
      insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
      values (p_event_name, p_event_origin, 'barber does not belong to the claimed organization', 'client_rpc');
      raise exception 'analytics context is not coherent' using errcode = '42501';
    end if;
  end if;

  -- 6.5 DERIVE the durable professional identity from the placement when the
  -- caller could not supply it.
  --
  -- A public professional profile page is routed by barber_id and the frozen
  -- customer API deliberately does not expose professional_id — a placement is
  -- what the booking surface needs. Widening that contract so the browser
  -- could send an identity it has no other use for would be the wrong fix; the
  -- server already knows the mapping and is the only party that should be
  -- trusted with it. Without this, every professional profile view would land
  -- with a NULL professional_id and get_professional_analytics_summary would
  -- report zero views forever.
  if p_professional_id is null and p_barber_id is not null then
    select b.professional_id into v_professional_id
    from public.barbers b
    where b.id = p_barber_id;
  else
    v_professional_id := p_professional_id;
  end if;

  -- A professional may only be named if their profile is genuinely public.
  -- get_public_professional is R1B's own projection, so this cannot drift from
  -- what the marketplace actually exposes. Applied only to an id the CALLER
  -- supplied: a server-derived one came from an already-validated placement,
  -- and refusing it would silently drop views of professionals whose personal
  -- profile is private but whose shop placement is public — a real and
  -- legitimate combination.
  if p_professional_id is not null then
    perform 1 from public.get_public_professional(p_professional_id) limit 1;

    if not found then
      insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
      values (p_event_name, p_event_origin, 'professional is not publicly visible', 'client_rpc');
      raise exception 'professional unavailable' using errcode = '42501';
    end if;
  end if;

  -- 6.6 Emit. Note what is NOT forwarded: no dedupe key, no occurred_at, no
  -- actor type. The strict emitter is called directly rather than the
  -- forgiving wrapper, because a client that sends a malformed event should
  -- learn that it did — the web adapter swallows the error so the user never
  -- does (§19).
  begin
    perform private.emit_analytics_event(
      p_event_name      => p_event_name,
      p_event_origin    => v_origin,
      p_actor_user_id   => v_user_id,
      p_organization_id => p_organization_id,
      p_location_id     => p_location_id,
      p_barber_id       => p_barber_id,
      p_professional_id => v_professional_id,
      p_properties      => coalesce(p_properties, '{}'::jsonb),
      p_session_id      => p_session_id,
      p_locale          => p_locale,
      p_platform        => 'web',
      p_correlation_id  => p_correlation_id
    );
  exception when others then
    insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
    values (p_event_name, p_event_origin, left(sqlerrm, 500), 'client_rpc');
    raise;
  end;
end;
$$;


--
-- Name: FUNCTION track_analytics_event(p_event_name text, p_event_origin text, p_organization_id uuid, p_location_id uuid, p_barber_id uuid, p_professional_id uuid, p_properties jsonb, p_session_id text, p_locale text, p_correlation_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.track_analytics_event(p_event_name text, p_event_origin text, p_organization_id uuid, p_location_id uuid, p_barber_id uuid, p_professional_id uuid, p_properties jsonb, p_session_id text, p_locale text, p_correlation_id uuid) IS 'The ONLY path by which a browser writes analytics. Deliberately has no actor parameter: the acting account is derived from auth.uid(), so impersonation is impossible by signature rather than by check. Refuses server-authoritative event names outright, refuses authenticated origins from signed-out callers, and refuses incoherent context — an organization that is not public, or a location/barber belonging to a different tenant. Accepts no timestamp, no dedupe key and no commercial context; all three are server-derived.';


--
-- Name: unfollow_organization(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unfollow_organization(p_organization_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
  v_slug text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  update public.organization_follows
  set
    is_following = false,
    unfollowed_at = now(),
    updated_at = now()
  where follower_user_id = v_user_id
    and organization_id = p_organization_id;

  if found then
    return;
  end if;

  select o.slug::text
    into v_slug
  from public.organizations o
  where o.id = p_organization_id;

  if v_slug is null then
    raise exception 'organization unavailable'
      using errcode = '42501';
  end if;

  perform 1
  from public.get_public_organization(v_slug)
  limit 1;

  if not found then
    raise exception 'organization unavailable'
      using errcode = '42501';
  end if;

  insert into public.organization_follows (
    follower_user_id,
    organization_id,
    is_following,
    followed_at,
    unfollowed_at,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    p_organization_id,
    false,
    null,
    now(),
    now(),
    now()
  )
  on conflict (follower_user_id, organization_id)
  do update
  set
    is_following = false,
    unfollowed_at = now(),
    updated_at = now();
end;
$$;


--
-- Name: FUNCTION unfollow_organization(p_organization_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.unfollow_organization(p_organization_id uuid) IS 'Authenticated explicit organization unfollow. The relationship is retained as a tombstone rather than deleted.';


--
-- Name: unfollow_professional(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unfollow_professional(p_professional_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'unfollow requires an authenticated session' using errcode = '42501';
  end if;

  if not exists (select 1 from public.professionals p where p.id = p_professional_id) then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  -- The INSERT branch is what makes an unfollow durable even when no edge
  -- exists yet: it lays the tombstone that a later auto-follow will collide
  -- with. followed_at stays NULL — nothing was ever followed.
  insert into public.professional_follows (follower_user_id, professional_id, state, source, followed_at, unfollowed_at)
  values (v_user_id, p_professional_id, 'unfollowed', 'manual', null, now())
  on conflict (follower_user_id, professional_id) do update
    set state = 'unfollowed',
        source = 'manual',
        -- Repeat unfollow keeps the FIRST refusal. That is when the customer
        -- actually decided.
        unfollowed_at = coalesce(public.professional_follows.unfollowed_at, now());
end;
$$;


--
-- Name: FUNCTION unfollow_professional(p_professional_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.unfollow_professional(p_professional_id uuid) IS 'Authenticated-only. Idempotent, and durable even with no prior edge — it writes a tombstone that later auto-follow attempts collide with. Repeat calls preserve the original unfollowed_at.';


--
-- Name: withdraw_external_professional(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.withdraw_external_professional(p_professional_id uuid, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid;
  v_claim_state public.professional_claim_state;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can withdraw an external professional identity'
      using errcode = '42501';
  end if;

  select p.claim_state into v_claim_state
  from public.professionals p
  where p.id = p_professional_id
  for update;

  if not found then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  -- A claimed identity belongs to its owner. Removing it from public view is
  -- a moderation act with its own review path, not a side door on the
  -- acquisition tooling.
  if v_claim_state = 'claimed' then
    raise exception 'this identity is claimed; withdrawing a claimed profile is not an acquisition action'
      using errcode = '42501';
  end if;

  update public.professionals
  set is_public = false
  where id = p_professional_id and is_public;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'external_professional_withdrawn',
    'professionals',
    p_professional_id,
    jsonb_build_object(
      'professional_id', p_professional_id,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  return p_professional_id;
end;
$$;


--
-- Name: FUNCTION withdraw_external_professional(p_professional_id uuid, p_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.withdraw_external_professional(p_professional_id uuid, p_note text) IS 'Platform-admin only. Stops the public projection of an UNCLAIMED identity and audits the decision. Does not delete, unlink or unclaim anything. Refuses on a claimed identity: that profile has an owner, and removing it from view is moderation with its own path.';


--
-- Name: withdraw_professional_claim(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.withdraw_professional_claim(p_claim_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'withdrawing a claim requires an authenticated session'
      using errcode = '42501';
  end if;

  update public.professional_claims
  set state = 'withdrawn', decided_at = now()
  where id = p_claim_id
    and claimant_user_id = v_user_id
    and state = 'pending';

  if not found then
    raise exception 'claim not found, not yours, or already decided'
      using errcode = '42704';
  end if;
end;
$$;


--
-- Name: FUNCTION withdraw_professional_claim(p_claim_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.withdraw_professional_claim(p_claim_id uuid) IS 'Authenticated-only. Withdraws the caller''s own pending claim. Never a silent no-op: a claim that is missing, someone else''s, or already decided raises rather than pretending to succeed.';


--
-- Name: analytics_event_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_event_definitions (
    event_name text NOT NULL,
    event_version integer DEFAULT 1 NOT NULL,
    family text NOT NULL,
    emission public.analytics_emission NOT NULL,
    status public.analytics_event_status DEFAULT 'deferred'::public.analytics_event_status NOT NULL,
    is_idempotent boolean DEFAULT false NOT NULL,
    requires_organization boolean DEFAULT false NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analytics_event_definitions_client_not_idempotent CHECK ((NOT ((emission = 'client'::public.analytics_emission) AND is_idempotent))),
    CONSTRAINT analytics_event_definitions_description_not_blank CHECK ((btrim(description) <> ''::text)),
    CONSTRAINT analytics_event_definitions_family_shape CHECK ((family ~ '^[a-z][a-z0-9_]{2,31}$'::text)),
    CONSTRAINT analytics_event_definitions_name_shape CHECK ((event_name ~ '^[a-z][a-z0-9_]{2,63}$'::text)),
    CONSTRAINT analytics_event_definitions_version_positive CHECK ((event_version >= 1))
);

ALTER TABLE ONLY public.analytics_event_definitions FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE analytics_event_definitions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.analytics_event_definitions IS 'The FadeUp analytics taxonomy, as queryable data rather than an enum. One row per event contract, including contracts that are documented but deliberately NOT wired in R3 (status = ''deferred''). This table IS the ingestion allowlist: private.emit_analytics_event refuses any event_name absent from it or marked deferred, so a typo becomes an error instead of a new category that quietly splits a funnel in half.';


--
-- Name: COLUMN analytics_event_definitions.event_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_event_definitions.event_version IS 'The CURRENT version of this event contract. Stamped onto new rows by the emitter; historical analytics_events rows keep the version they were written under, so a report can always tell which contract a row obeys.';


--
-- Name: COLUMN analytics_event_definitions.emission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_event_definitions.emission IS '''server'' = produced by an authoritative database state transition and usable as evidence. ''client'' = a browser statement of intent. Constitution-level distinction: a click is not a business success, and no conversion metric may be built on a client event.';


--
-- Name: COLUMN analytics_event_definitions.is_idempotent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_event_definitions.is_idempotent IS 'True when the event can happen at most once for its subject (a completed appointment completes once). Such events get a permanent entity-scoped dedupe_key. False means repeats are legitimate and each carries a transition-scoped key instead, so a second genuine follow is not swallowed by the first.';


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_name text NOT NULL,
    event_version integer DEFAULT 1 NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_type public.analytics_actor_type NOT NULL,
    actor_user_id uuid,
    customer_id uuid,
    professional_id uuid,
    organization_id uuid,
    location_id uuid,
    barber_id uuid,
    appointment_id uuid,
    queue_entry_id uuid,
    passport_id uuid,
    prospect_id uuid,
    acquisition_source text,
    acquisition_source_record_id uuid,
    event_origin public.analytics_event_origin NOT NULL,
    platform text,
    session_id text,
    locale text,
    country_code text,
    plan_key text,
    commercial_family public.commercial_family,
    properties jsonb DEFAULT '{}'::jsonb NOT NULL,
    correlation_id uuid,
    causation_id uuid,
    dedupe_key text,
    CONSTRAINT analytics_events_actor_coherent CHECK ((((actor_type = 'anonymous'::public.analytics_actor_type) AND (actor_user_id IS NULL)) OR (actor_type = ANY (ARRAY['system'::public.analytics_actor_type, 'worker'::public.analytics_actor_type])) OR ((actor_type = ANY (ARRAY['customer'::public.analytics_actor_type, 'professional'::public.analytics_actor_type, 'staff'::public.analytics_actor_type, 'platform_admin'::public.analytics_actor_type])) AND (actor_user_id IS NOT NULL)))),
    CONSTRAINT analytics_events_country_code_shape CHECK (((country_code IS NULL) OR (country_code ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT analytics_events_ingest_not_before_occurrence CHECK ((ingested_at >= occurred_at)),
    CONSTRAINT analytics_events_locale_shape CHECK (((locale IS NULL) OR (locale ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$'::text))),
    CONSTRAINT analytics_events_name_shape CHECK ((event_name ~ '^[a-z][a-z0-9_]{2,63}$'::text)),
    CONSTRAINT analytics_events_platform_shape CHECK (((platform IS NULL) OR (platform ~ '^[a-z][a-z0-9_]{1,31}$'::text))),
    CONSTRAINT analytics_events_properties_bounded CHECK ((pg_column_size(properties) <= 4096)),
    CONSTRAINT analytics_events_properties_is_object CHECK ((jsonb_typeof(properties) = 'object'::text)),
    CONSTRAINT analytics_events_session_id_bounded CHECK (((session_id IS NULL) OR ((char_length(session_id) >= 8) AND (char_length(session_id) <= 64)))),
    CONSTRAINT analytics_events_version_positive CHECK ((event_version >= 1))
);

ALTER TABLE ONLY public.analytics_events FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE analytics_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.analytics_events IS 'FadeUp''s canonical APPEND-ONLY product analytics log. One row per thing that happened. Deliberately carries NO foreign keys — an event must survive deletion of its subject, and thirteen FKs on the highest-volume table would put thirteen parent lookups inside every booking transaction; integrity is enforced at ingestion instead, where no client can write at all. This table is NOT product state: organization_follows, appointments and queue_entries remain the only truth about what is true now, and nothing in the product reads this table to decide behaviour.';


--
-- Name: COLUMN analytics_events.occurred_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_events.occurred_at IS 'When the thing happened. For a server event this is the instant of the authoritative state transition, not the instant the row was written.';


--
-- Name: COLUMN analytics_events.ingested_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_events.ingested_at IS 'When this row was written. Equals occurred_at for live emission and differs for anything replayed or backfilled, which is how pipeline lag is measured without contaminating occurred_at.';


--
-- Name: COLUMN analytics_events.actor_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_events.actor_user_id IS 'The acting account, ALWAYS derived server-side from auth.uid() or from authoritative state. public.track_analytics_event takes no actor argument at all, so a client cannot attribute an event to another user even by trying.';


--
-- Name: COLUMN analytics_events.prospect_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_events.prospect_id IS 'The CANONICAL post-dedup prospect. Paired with acquisition_source_record_id precisely so that one professional discovered through several sources counts as several observations and exactly ONE conversion.';


--
-- Name: COLUMN analytics_events.session_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_events.session_id IS 'Opaque short-lived client handle, used ONLY to approximate distinct anonymous visitors in aggregate. Not a device fingerprint, not derived from any device characteristic, never joined to an account, and never exposed through any read contract.';


--
-- Name: COLUMN analytics_events.plan_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_events.plan_key IS 'The organization''s effective plan AT THE MOMENT OF THE EVENT, snapshotted rather than joined. A shop that completes a service on salon_pro and upgrades next month must still report that completion against salon_pro.';


--
-- Name: COLUMN analytics_events.properties; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_events.properties IS 'Controlled per-event payload. Never PII: no email address, phone number, token, private note, message body, exact coordinate or future appointment detail. Entity ids and small controlled scalars only — the ingestion functions reject the forbidden keys outright.';


--
-- Name: COLUMN analytics_events.dedupe_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_events.dedupe_key IS 'NULL = repeats are legitimate and must stay distinct (views, searches). Non-null = this transition occurs once and is recorded once, enforced by a unique index rather than by callers being careful.';


--
-- Name: analytics_ingestion_rejections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_ingestion_rejections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    event_name text,
    event_origin text,
    reason text NOT NULL,
    stage text NOT NULL,
    CONSTRAINT analytics_ingestion_rejections_reason_not_blank CHECK ((btrim(reason) <> ''::text)),
    CONSTRAINT analytics_ingestion_rejections_stage_shape CHECK ((stage = ANY (ARRAY['client_rpc'::text, 'server_emit'::text])))
);

ALTER TABLE ONLY public.analytics_ingestion_rejections FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE analytics_ingestion_rejections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.analytics_ingestion_rejections IS 'Why events were refused, for §22 observability. Deliberately stores no payload and no actor: the rejected payload is the likeliest place for forbidden PII to appear, and a diagnostics table is the last place it should be preserved. A reason, a name and a stage are enough to find a broken instrumentation change.';


--
-- Name: api_source_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_source_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    max_requests_per_minute integer,
    max_requests_per_day integer,
    max_requests_per_month integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT api_source_limits_max_requests_per_day_check CHECK (((max_requests_per_day IS NULL) OR (max_requests_per_day > 0))),
    CONSTRAINT api_source_limits_max_requests_per_minute_check CHECK (((max_requests_per_minute IS NULL) OR (max_requests_per_minute > 0))),
    CONSTRAINT api_source_limits_max_requests_per_month_check CHECK (((max_requests_per_month IS NULL) OR (max_requests_per_month > 0)))
);

ALTER TABLE ONLY public.api_source_limits FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE api_source_limits; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.api_source_limits IS 'Locally configurable quota/budget guards, independent per source — reaching one source''s limit pauses only that source (see api_source_health.is_paused).';


--
-- Name: api_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    job_id uuid,
    endpoint text,
    success boolean NOT NULL,
    status_code integer,
    latency_ms integer,
    error text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT api_usage_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0)))
);

ALTER TABLE ONLY public.api_usage FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE api_usage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.api_usage IS 'Append-only per-call log for every source adapter request. api_source_health holds the rolling aggregates derived from this.';


--
-- Name: appointment_claim_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_claim_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    redeemed_at timestamp with time zone,
    redeemed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointment_claim_tokens_expires_future CHECK ((expires_at > created_at))
);

ALTER TABLE ONLY public.appointment_claim_tokens FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE appointment_claim_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.appointment_claim_tokens IS 'Single-use, time-limited proof that the holder is the person who made a specific anonymous booking. Issued by book_public_appointment when there is no session, redeemed by redeem_appointment_claim after the customer creates an account. Only the sha256 hash is stored — the raw token exists exactly once, in the booking response.';


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    actor_user_id uuid,
    action text NOT NULL,
    target_type text,
    target_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_logs_action_not_blank CHECK ((btrim(action) <> ''::text))
);

ALTER TABLE ONLY public.audit_logs FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE audit_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_logs IS 'Append-only audit trail. No client-facing UPDATE/DELETE, and no client-facing INSERT — rows are written by trusted server-side/trigger code only (SECURITY DEFINER or service_role), never directly by an authenticated user, so a row can never be forged to misattribute an action to another org or user.';


--
-- Name: barber_availability_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.barber_availability_exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    barber_id uuid NOT NULL,
    exception_date date NOT NULL,
    is_unavailable boolean DEFAULT true NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT barber_availability_exceptions_time_consistent CHECK ((is_unavailable OR ((start_time IS NOT NULL) AND (end_time IS NOT NULL) AND (start_time < end_time))))
);

ALTER TABLE ONLY public.barber_availability_exceptions FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE barber_availability_exceptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.barber_availability_exceptions IS 'Date-specific override of a barber''s regular schedule (time off, holiday, or an adjusted window). One row per (barber, date).';


--
-- Name: barber_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.barber_services (
    organization_id uuid NOT NULL,
    barber_id uuid NOT NULL,
    service_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.barber_services FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE barber_services; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.barber_services IS 'Explicit join: which services a barber is eligible to perform. No rows means not eligible for anything yet.';


--
-- Name: barber_working_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.barber_working_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    barber_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    is_off boolean DEFAULT false NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    second_start_time time without time zone,
    second_end_time time without time zone,
    CONSTRAINT barber_working_hours_day_of_week_range CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT barber_working_hours_second_interval_valid CHECK ((((second_start_time IS NULL) AND (second_end_time IS NULL)) OR ((second_start_time IS NOT NULL) AND (second_end_time IS NOT NULL) AND (second_start_time < second_end_time) AND (start_time IS NOT NULL) AND (end_time IS NOT NULL) AND (second_start_time >= end_time)))),
    CONSTRAINT barber_working_hours_start_end_consistent CHECK ((is_off OR ((start_time IS NOT NULL) AND (end_time IS NOT NULL) AND (start_time < end_time))))
);

ALTER TABLE ONLY public.barber_working_hours FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE barber_working_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.barber_working_hours IS 'Regular weekly schedule per barber. day_of_week: 0=Sunday..6=Saturday. Intersection with location_hours is LOT 8''s job, not enforced here.';


--
-- Name: COLUMN barber_working_hours.second_start_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.barber_working_hours.second_start_time IS 'Optional afternoon interval, for a day split by a midday break. NULL means the ordinary single-window day and behaves exactly as before. Must begin at or after end_time — see the constraint.';


--
-- Name: booking_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    homepage_url text,
    primary_markets text[] DEFAULT '{}'::text[] NOT NULL,
    signatures jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_sentinel boolean DEFAULT false NOT NULL,
    supports_compliant_discovery boolean,
    discovery_notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT booking_providers_display_name_check CHECK ((btrim(display_name) <> ''::text)),
    CONSTRAINT booking_providers_key_check CHECK ((key ~ '^[A-Z0-9_]+$'::text))
);

ALTER TABLE ONLY public.booking_providers FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE booking_providers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_providers IS 'Competitor/booking-provider registry (Planity, Booksy, Fresha, ...) plus the NO_BOOKING/UNKNOWN sentinels. signatures is the single maintainable detection-signature source; supports_compliant_discovery=false means website detection only — never an anti-bot bypass.';


--
-- Name: COLUMN booking_providers.supports_compliant_discovery; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_providers.supports_compliant_discovery IS 'NULL = unassessed, TRUE = a compliant official API/public listing exists and may be used as a discovery source, FALSE = assessed and none exists; provider discovery stays unsupported and only website-based detection applies.';


--
-- Name: chairs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chairs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chairs_name_not_blank CHECK ((btrim(name) <> ''::text))
);

ALTER TABLE ONLY public.chairs FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE chairs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.chairs IS 'Structural inventory of physical chairs per location. Live occupancy/session state is Chair Mode (LOT 11), not this table.';


--
-- Name: commercial_capabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commercial_capabilities (
    capability_key text NOT NULL,
    capability_group text NOT NULL,
    status text NOT NULL,
    evidence text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commercial_capabilities_evidence_not_blank CHECK ((btrim(evidence) <> ''::text)),
    CONSTRAINT commercial_capabilities_group_known CHECK ((capability_group = ANY (ARRAY['foundation'::text, 'floor'::text, 'retention'::text, 'scale'::text]))),
    CONSTRAINT commercial_capabilities_key_shape CHECK ((capability_key ~ '^[a-zA-Z][a-zA-Z0-9]{1,39}$'::text)),
    CONSTRAINT commercial_capabilities_status_known CHECK ((status = ANY (ARRAY['live'::text, 'planned'::text])))
);

ALTER TABLE ONLY public.commercial_capabilities FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE commercial_capabilities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.commercial_capabilities IS 'Named capabilities a plan may unlock. capability_key is copied VERBATIM (camelCase included) from CapabilityId in apps/web/src/lib/commerce/plans.ts, so "do the database and the UI agree" is a set-equality test rather than a mapping table that can itself be wrong. status=planned means packaged but not built and must never render as included.';


--
-- Name: COLUMN commercial_capabilities.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_capabilities.status IS 'live = shipped and verified in this repository. planned = packaged and priced but not built; never counted as included and never enforced as a paid gate, because there is nothing to gate.';


--
-- Name: commercial_plan_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commercial_plan_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    previous_plan_key text,
    new_plan_key text NOT NULL,
    previous_status public.commercial_status,
    new_status public.commercial_status NOT NULL,
    entitlement_source public.entitlement_source NOT NULL,
    changed_by uuid,
    change_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commercial_plan_changes_not_a_noop CHECK (((previous_plan_key IS DISTINCT FROM new_plan_key) OR (previous_status IS DISTINCT FROM new_status)))
);

ALTER TABLE ONLY public.commercial_plan_changes FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE commercial_plan_changes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.commercial_plan_changes IS 'Append-only commercial history: every plan or status transition, who caused it and why. Enforced append-only by trigger as well as by privilege, so it holds for postgres and service_role too. Deliberately not folded into audit_logs: a billing reconciliation needs a fixed shape to join on, not a jsonb payload.';


--
-- Name: commercial_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commercial_plans (
    plan_key text NOT NULL,
    commercial_family public.commercial_family NOT NULL,
    display_name text NOT NULL,
    price_minor integer NOT NULL,
    price_currency text DEFAULT 'EUR'::text NOT NULL,
    max_establishments integer NOT NULL,
    max_operational_professionals integer,
    is_recommended boolean DEFAULT false NOT NULL,
    tier smallint NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commercial_plans_currency_format CHECK ((price_currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT commercial_plans_display_name_not_blank CHECK ((btrim(display_name) <> ''::text)),
    CONSTRAINT commercial_plans_establishments_positive CHECK ((max_establishments >= 1)),
    CONSTRAINT commercial_plans_free_family_is_free CHECK (((commercial_family = 'free'::public.commercial_family) = (price_minor = 0))),
    CONSTRAINT commercial_plans_free_is_single_everything CHECK (((commercial_family <> 'free'::public.commercial_family) OR ((max_establishments = 1) AND (max_operational_professionals = 1)))),
    CONSTRAINT commercial_plans_independent_is_single_professional CHECK (((commercial_family <> 'independent'::public.commercial_family) OR (max_operational_professionals = 1))),
    CONSTRAINT commercial_plans_key_shape CHECK ((plan_key ~ '^[a-z][a-z0-9_]{1,39}$'::text)),
    CONSTRAINT commercial_plans_multi_is_several_establishments CHECK (((commercial_family <> 'multi_salon'::public.commercial_family) OR (max_establishments >= 2))),
    CONSTRAINT commercial_plans_price_non_negative CHECK ((price_minor >= 0)),
    CONSTRAINT commercial_plans_professionals_positive CHECK (((max_operational_professionals IS NULL) OR (max_operational_professionals >= 1))),
    CONSTRAINT commercial_plans_salon_is_single_establishment CHECK (((commercial_family <> 'salon'::public.commercial_family) OR (max_establishments = 1))),
    CONSTRAINT commercial_plans_tier_positive CHECK ((tier >= 1))
);

ALTER TABLE ONLY public.commercial_plans FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE commercial_plans; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.commercial_plans IS 'The eight canonical FadeUp commercial plans. plan_key is the ONLY durable identity — display_name is deliberately non-unique because "Pro" names both salon_pro and multi_pro, and price is an attribute, never an identifier. price_minor is the TOTAL monthly price of the whole plan: there is no quantity column anywhere in this schema for it to be multiplied by, and that absence is asserted by 20260826110700.';


--
-- Name: COLUMN commercial_plans.plan_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_plans.plan_key IS 'Durable machine identity. Business logic branches on this and never on display_name (two plans read "Pro") or on price (regions and promotions move it).';


--
-- Name: COLUMN commercial_plans.price_minor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_plans.price_minor IS 'TOTAL monthly price of the entire plan, in minor units of price_currency. multi_growth is 9900 for up to two establishments — not 9900 per establishment. FadeUp charges no per-barber, per-seat, per-user or per-location amount.';


--
-- Name: COLUMN commercial_plans.max_establishments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_plans.max_establishments IS 'Cap on ACTIVE locations the organization may operate. A commercial capacity limit enforced by public.enforce_establishment_capacity(), never a billed quantity.';


--
-- Name: COLUMN commercial_plans.max_operational_professionals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_plans.max_operational_professionals IS 'Cap on ACTIVE bookable professionals. NULL means unlimited, which is how "team is included" is spelled in a schema — deliberately NULL rather than a large number, because a large number is a multiplier waiting to be discovered.';


--
-- Name: COLUMN commercial_plans.is_available; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_plans.is_available IS 'Whether FadeUp currently sells this plan. Withdrawing a plan must never delete it: organizations remain on it and their entitlements must keep resolving, so no role holds DELETE on this table.';


--
-- Name: prospects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.prospect_type NOT NULL,
    entity_kind public.prospect_entity_kind DEFAULT 'independent'::public.prospect_entity_kind NOT NULL,
    parent_group_id uuid,
    status public.prospect_pipeline_stage DEFAULT 'discovered'::public.prospect_pipeline_stage NOT NULL,
    canonical_name text NOT NULL,
    country text NOT NULL,
    website_url text,
    website_domain text,
    phone_e164 text,
    email text,
    current_score integer,
    current_score_bucket public.prospect_score_bucket,
    do_not_contact boolean DEFAULT false NOT NULL,
    converted_organization_id uuid,
    first_discovered_at timestamp with time zone DEFAULT now() NOT NULL,
    last_enriched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    current_booking_provider_id uuid,
    fadeup_fit_score integer,
    fadeup_fit_class public.prospect_fit_class,
    migration_potential_score integer,
    migration_potential_class public.prospect_fit_class,
    rating numeric(3,2),
    review_count integer,
    estimated_barber_count integer,
    CONSTRAINT prospects_canonical_name_check CHECK ((btrim(canonical_name) <> ''::text)),
    CONSTRAINT prospects_country_check CHECK ((country ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT prospects_current_score_check CHECK (((current_score >= 0) AND (current_score <= 100))),
    CONSTRAINT prospects_estimated_barber_count_check CHECK (((estimated_barber_count IS NULL) OR (estimated_barber_count >= 0))),
    CONSTRAINT prospects_fadeup_fit_score_check CHECK (((fadeup_fit_score IS NULL) OR ((fadeup_fit_score >= 0) AND (fadeup_fit_score <= 100)))),
    CONSTRAINT prospects_migration_potential_score_check CHECK (((migration_potential_score IS NULL) OR ((migration_potential_score >= 0) AND (migration_potential_score <= 100)))),
    CONSTRAINT prospects_parent_not_self CHECK (((parent_group_id IS NULL) OR (parent_group_id <> id))),
    CONSTRAINT prospects_rating_check CHECK (((rating IS NULL) OR ((rating >= (0)::numeric) AND (rating <= (5)::numeric)))),
    CONSTRAINT prospects_review_count_check CHECK (((review_count IS NULL) OR (review_count >= 0)))
);

ALTER TABLE ONLY public.prospects FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospects; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospects IS 'Canonical (post-dedup) business entity discovered by Worker V2. FadeUp''s own sales data — no organization_id, gated to platform staff only. See migration header.';


--
-- Name: COLUMN prospects.current_booking_provider_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.prospects.current_booking_provider_id IS 'Denormalized cache of the current booking_provider_observations row. NULL means never assessed — semantically UNKNOWN, never NO_BOOKING.';


--
-- Name: COLUMN prospects.rating; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.prospects.rating IS 'Provider-reported rating (0-5). NULL is unknown and must not be scored as 0.';


--
-- Name: competitor_analytics; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.competitor_analytics WITH (security_invoker='on') AS
 SELECT bp.id AS provider_id,
    bp.key AS provider_key,
    bp.display_name,
    bp.is_sentinel,
    count(p.id) AS discovered,
    count(p.id) FILTER (WHERE (p.status = ANY (ARRAY['qualified'::public.prospect_pipeline_stage, 'selected'::public.prospect_pipeline_stage, 'contacted'::public.prospect_pipeline_stage, 'replied'::public.prospect_pipeline_stage, 'demo'::public.prospect_pipeline_stage, 'trial'::public.prospect_pipeline_stage, 'customer'::public.prospect_pipeline_stage]))) AS qualified,
    count(DISTINCT r.prospect_id) FILTER (WHERE (r.sent_at IS NOT NULL)) AS contacted,
    count(DISTINCT r.prospect_id) FILTER (WHERE (r.replied_at IS NOT NULL)) AS replied,
    count(DISTINCT r.prospect_id) FILTER (WHERE (r.state = 'positive_reply'::public.outreach_recipient_state)) AS positive_reply,
    count(DISTINCT r.prospect_id) FILTER (WHERE (r.state = ANY (ARRAY['claimed'::public.outreach_recipient_state, 'activated'::public.outreach_recipient_state, 'paid'::public.outreach_recipient_state]))) AS claimed,
    count(DISTINCT r.prospect_id) FILTER (WHERE (r.state = ANY (ARRAY['activated'::public.outreach_recipient_state, 'paid'::public.outreach_recipient_state]))) AS activated,
    count(DISTINCT r.prospect_id) FILTER (WHERE (r.state = 'paid'::public.outreach_recipient_state)) AS paid,
    avg(p.migration_potential_score) FILTER (WHERE (p.migration_potential_score IS NOT NULL)) AS avg_migration_score,
    avg(p.fadeup_fit_score) FILTER (WHERE (p.fadeup_fit_score IS NOT NULL)) AS avg_fit_score
   FROM ((public.booking_providers bp
     LEFT JOIN public.prospects p ON ((p.current_booking_provider_id = bp.id)))
     LEFT JOIN public.outreach_recipients r ON ((r.prospect_id = p.id)))
  GROUP BY bp.id, bp.key, bp.display_name, bp.is_sentinel;


--
-- Name: VIEW competitor_analytics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.competitor_analytics IS 'Per-competitor discovery -> paid funnel, computed from real rows. Prospects with NO observation at all are absent here by design: they are UNKNOWN, and lumping them under NO_BOOKING would be exactly the conflation spec §10 forbids.';


--
-- Name: customer_favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    barber_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.customer_favorites FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE customer_favorites; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_favorites IS 'A customer''s favorited shop (barber_id null) or specific barber (barber_id set). Strict owner-only RLS. Used for discovery shortcuts, rebooking, and the customer home.';


--
-- Name: customer_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    status public.customer_membership_status DEFAULT 'active'::public.customer_membership_status NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    current_period_start timestamp with time zone DEFAULT now() NOT NULL,
    current_period_end timestamp with time zone NOT NULL,
    cancelled_at timestamp with time zone,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_memberships_period_valid CHECK ((current_period_end > current_period_start))
);

ALTER TABLE ONLY public.customer_memberships FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE customer_memberships; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_memberships IS 'One customer''s enrollment in one membership_plans row. current_period_end is tracked, not enforced by any billing job yet (LOT 16) — a shop currently reviews/renews these manually.';


--
-- Name: customer_passport_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_passport_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    storage_path text NOT NULL,
    caption text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_passport_photos_caption_length CHECK (((caption IS NULL) OR (char_length(caption) <= 200)))
);

ALTER TABLE ONLY public.customer_passport_photos FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE customer_passport_photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_passport_photos IS 'Reference photos for a Fade Passport. storage_path points into the private passport-photos bucket, always under {user_id}/... — see storage.objects policies below.';


--
-- Name: customer_passport_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_passport_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    label text,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_accessed_at timestamp with time zone,
    CONSTRAINT customer_passport_shares_expires_future CHECK ((expires_at > created_at)),
    CONSTRAINT customer_passport_shares_label_length CHECK (((label IS NULL) OR (char_length(label) <= 100)))
);

ALTER TABLE ONLY public.customer_passport_shares FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE customer_passport_shares; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_passport_shares IS 'Revocable, time-limited, read-only share links to a Fade Passport. Only token_hash (sha256) is stored — the raw token is returned once, by create_passport_share, and never again. No anon/broad SELECT policy exists on this table; verification only happens inside get_shared_passport.';


--
-- Name: customer_passports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_passports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    usual_haircut text,
    fade_type text,
    side_length text,
    top_length text,
    beard_preferences text,
    preferences_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    passport_number text NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    CONSTRAINT customer_passports_notes_length CHECK (((preferences_notes IS NULL) OR (char_length(preferences_notes) <= 1000)))
);

ALTER TABLE ONLY public.customer_passports FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE customer_passports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_passports IS 'The customer-owned, portable Fade Passport. One row per auth.users account. No field here is ever shop/staff-internal data — customer-visible by construction, not by a later filter. The row itself cannot be deleted by the customer (PRODUCT_CONSTITUTION 2.2: a Passport can never be missing); it is removed only when the account itself is erased, by cascade.';


--
-- Name: COLUMN customer_passports.passport_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer_passports.passport_number IS 'The Passport''s durable public identifier: 80 bits of gen_random_bytes, non-sequential, unique, server-generated. An IDENTIFIER, never an authenticator — the credential is the revocable hashed token in customer_passport_shares, and lookup-by-number must never become an alternative to it. Never client-supplied and never reassignable: the stamping trigger overwrites any caller value and the freeze guard rejects any later change.';


--
-- Name: COLUMN customer_passports.issued_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer_passports.issued_at IS 'When this Passport was issued. Server-stamped once and frozen. Distinct from created_at only for rows that predate R1B, where it records the backfill rather than pretending to know when the customer first had a Passport.';


--
-- Name: customer_professional_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_professional_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_user_id uuid NOT NULL,
    professional_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    completed_interaction_count integer DEFAULT 0 NOT NULL,
    first_completed_at timestamp with time zone NOT NULL,
    last_completed_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_professional_relatio_completed_interaction_count_check CHECK ((completed_interaction_count >= 0)),
    CONSTRAINT customer_professional_relationships_ordered CHECK ((first_completed_at <= last_completed_at))
);

ALTER TABLE ONLY public.customer_professional_relationships FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE customer_professional_relationships; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_professional_relationships IS 'Materialized truth about services that ACTUALLY HAPPENED: one row per (customer account, professional, organization). Never derived from and never feeding the follow graph — Constitution §3.2. Rebuildable in full by reconcile_customer_professional_relationships(), which is what makes materialization safe. Verified-client is a predicate over this table and is deliberately not a column.';


--
-- Name: COLUMN customer_professional_relationships.customer_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer_professional_relationships.customer_user_id IS 'The account that itself booked or checked in, taken from booked_by_user_id. Never customers.user_id: that column is a per-shop CRM bridge that was squattable before R1A and remains staff-adjacent, so it can never establish a fact about a customer.';


--
-- Name: COLUMN customer_professional_relationships.completed_interaction_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer_professional_relationships.completed_interaction_count IS 'Completed services with a TRUSTWORTHY completion time. Pre-R1A rows whose completed_at is NULL are excluded rather than counted with an invented timestamp — R1A recorded unknown as unknown and this table does not undo that.';


--
-- Name: customer_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    display_name text,
    phone text,
    email text,
    haircut_frequency public.customer_haircut_frequency,
    style_preference public.customer_style_preference,
    style_notes text,
    appointment_preference public.customer_appointment_preference,
    onboarding_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_profiles_style_notes_length CHECK (((style_notes IS NULL) OR (char_length(style_notes) <= 500)))
);

ALTER TABLE ONLY public.customer_profiles FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE customer_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_profiles IS 'The customer-owned, portable identity — one row per auth.users account, org-agnostic. Not created automatically at signup (an account that never touches the customer app has no row here, which is a legitimate normal state); created/updated by the customer themselves via onboarding or their profile screen. Distinct from public.customers, the per-organization staff-owned CRM contact.';


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    CONSTRAINT customers_name_not_blank CHECK ((btrim(name) <> ''::text))
);

ALTER TABLE ONLY public.customers FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE customers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customers IS 'Real customer entity, org-scoped. Populated both by staff directly (LOT 12 CRM UI) and automatically by the link_customer_from_contact_info trigger on appointments/queue_entries (matches or creates by phone/email at booking time).';


--
-- Name: COLUMN customers.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customers.user_id IS 'Bridge to the customer''s own portable identity (customer_profiles), set by claim_customer_records() once they have an account with matching contact info. Nullable — most rows created before this migration, and every future walk-in with no account, stay unlinked. Never grants the linked customer direct SELECT/UPDATE on this row (customers.notes is internal shop data) — customer-facing reads go through dedicated RPCs only.';


--
-- Name: outreach_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    experiment_id uuid NOT NULL,
    prospect_id uuid NOT NULL,
    arm_id uuid NOT NULL,
    recipient_id uuid,
    assignment_hash text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.outreach_assignments FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE outreach_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.outreach_assignments IS 'Immutable experiment assignment. UNIQUE (experiment_id, prospect_id) prevents a prospect being re-randomized; the trigger below prevents simultaneous conflicting experiments on the same prospect.';


--
-- Name: outreach_experiment_arms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_experiment_arms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    experiment_id uuid NOT NULL,
    arm_key text NOT NULL,
    template_id uuid NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    is_control boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outreach_experiment_arms_arm_key_check CHECK ((arm_key ~ '^[A-Za-z0-9_]+$'::text)),
    CONSTRAINT outreach_experiment_arms_weight_check CHECK ((weight >= 1))
);

ALTER TABLE ONLY public.outreach_experiment_arms FORCE ROW LEVEL SECURITY;


--
-- Name: outreach_experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_experiments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    hypothesis text,
    status text DEFAULT 'draft'::text NOT NULL,
    cohort_locale text,
    cohort_segment_key text,
    cohort_booking_provider_id uuid,
    cohort_country text,
    exploration_pct numeric(5,2) DEFAULT 100 NOT NULL,
    min_sample_per_arm integer DEFAULT 30 NOT NULL,
    max_experiments_per_prospect integer DEFAULT 1 NOT NULL,
    cooldown_days integer DEFAULT 30 NOT NULL,
    assignment_seed text DEFAULT encode(extensions.gen_random_bytes(16), 'hex'::text) NOT NULL,
    primary_metric public.ml_model_target DEFAULT 'positive_reply'::public.ml_model_target NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outreach_experiments_cohort_country_check CHECK (((cohort_country IS NULL) OR (cohort_country ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT outreach_experiments_cohort_locale_check CHECK (((cohort_locale IS NULL) OR (cohort_locale ~ '^[a-z]{2}-[A-Z]{2}$'::text))),
    CONSTRAINT outreach_experiments_cooldown_days_check CHECK ((cooldown_days >= 0)),
    CONSTRAINT outreach_experiments_exploration_pct_check CHECK (((exploration_pct >= (0)::numeric) AND (exploration_pct <= (100)::numeric))),
    CONSTRAINT outreach_experiments_key_check CHECK ((key ~ '^[a-z0-9_]+$'::text)),
    CONSTRAINT outreach_experiments_max_experiments_per_prospect_check CHECK ((max_experiments_per_prospect >= 1)),
    CONSTRAINT outreach_experiments_min_sample_per_arm_check CHECK ((min_sample_per_arm >= 1)),
    CONSTRAINT outreach_experiments_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT outreach_experiments_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'running'::text, 'paused'::text, 'completed'::text, 'abandoned'::text])))
);

ALTER TABLE ONLY public.outreach_experiments FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE outreach_experiments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.outreach_experiments IS 'A/B experiment over eligible approved templates. Assignment is deterministic (hash of assignment_seed + prospect_id), so an assignment is reproducible and auditable. primary_metric defaults to positive_reply — never read/delivered.';


--
-- Name: experiment_results; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.experiment_results WITH (security_invoker='on') AS
 SELECT e.id AS experiment_id,
    e.key AS experiment_key,
    e.name AS experiment_name,
    e.status,
    e.primary_metric,
    e.min_sample_per_arm,
    a.id AS arm_id,
    a.arm_key,
    a.is_control,
    t.key AS template_key,
    count(asg.id) AS assigned,
    count(r.id) FILTER (WHERE (r.sent_at IS NOT NULL)) AS sent,
    count(r.id) FILTER (WHERE (r.replied_at IS NOT NULL)) AS replied,
    count(r.id) FILTER (WHERE (r.state = 'positive_reply'::public.outreach_recipient_state)) AS positive_reply,
    count(r.id) FILTER (WHERE (r.state = ANY (ARRAY['activated'::public.outreach_recipient_state, 'paid'::public.outreach_recipient_state]))) AS activated,
    count(r.id) FILTER (WHERE (r.state = 'paid'::public.outreach_recipient_state)) AS paid,
    (count(r.id) FILTER (WHERE (r.sent_at IS NOT NULL)) >= e.min_sample_per_arm) AS reached_min_sample
   FROM ((((public.outreach_experiments e
     JOIN public.outreach_experiment_arms a ON ((a.experiment_id = e.id)))
     JOIN public.outreach_templates t ON ((t.id = a.template_id)))
     LEFT JOIN public.outreach_assignments asg ON ((asg.arm_id = a.id)))
     LEFT JOIN public.outreach_recipients r ON ((r.id = asg.recipient_id)))
  GROUP BY e.id, e.key, e.name, e.status, e.primary_metric, e.min_sample_per_arm, a.id, a.arm_key, a.is_control, t.key;


--
-- Name: VIEW experiment_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.experiment_results IS 'Per-arm experiment outcomes. reached_min_sample tells the operator whether an arm has enough sent messages to be worth reading at all — a guard against calling a winner on 4 sends.';


--
-- Name: location_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    is_closed boolean DEFAULT false NOT NULL,
    open_time time without time zone,
    close_time time without time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    second_open_time time without time zone,
    second_close_time time without time zone,
    CONSTRAINT location_hours_day_of_week_range CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT location_hours_open_close_consistent CHECK ((is_closed OR ((open_time IS NOT NULL) AND (close_time IS NOT NULL) AND (open_time < close_time)))),
    CONSTRAINT location_hours_second_interval_valid CHECK ((((second_open_time IS NULL) AND (second_close_time IS NULL)) OR ((second_open_time IS NOT NULL) AND (second_close_time IS NOT NULL) AND (second_open_time < second_close_time) AND (open_time IS NOT NULL) AND (close_time IS NOT NULL) AND (second_open_time >= close_time))))
);

ALTER TABLE ONLY public.location_hours FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE location_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.location_hours IS 'Regular weekly opening hours per location. day_of_week: 0=Sunday..6=Saturday (Postgres extract(dow) convention).';


--
-- Name: COLUMN location_hours.second_open_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.location_hours.second_open_time IS 'Optional afternoon opening interval. NULL means one continuous window, unchanged.';


--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    address_line1 text,
    address_line2 text,
    city text,
    region text,
    postal_code text,
    country text,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    latitude double precision,
    longitude double precision,
    kind public.location_kind DEFAULT 'physical_address'::public.location_kind NOT NULL,
    service_area_center_latitude double precision,
    service_area_center_longitude double precision,
    service_area_radius_km double precision,
    queue_check_in_token text DEFAULT encode(extensions.gen_random_bytes(16), 'hex'::text) NOT NULL,
    CONSTRAINT locations_kind_shape CHECK ((((kind = 'physical_address'::public.location_kind) AND (service_area_center_latitude IS NULL) AND (service_area_center_longitude IS NULL) AND (service_area_radius_km IS NULL)) OR ((kind = 'service_area'::public.location_kind) AND (service_area_center_latitude IS NOT NULL) AND (service_area_center_longitude IS NOT NULL) AND (service_area_radius_km IS NOT NULL)))),
    CONSTRAINT locations_latitude_range CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)))),
    CONSTRAINT locations_longitude_range CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))),
    CONSTRAINT locations_name_not_blank CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT locations_queue_check_in_token_shape CHECK ((queue_check_in_token ~ '^[0-9a-f]{32}$'::text)),
    CONSTRAINT locations_service_area_center_range CHECK ((((service_area_center_latitude IS NULL) OR ((service_area_center_latitude >= ('-90'::integer)::double precision) AND (service_area_center_latitude <= (90)::double precision))) AND ((service_area_center_longitude IS NULL) OR ((service_area_center_longitude >= ('-180'::integer)::double precision) AND (service_area_center_longitude <= (180)::double precision))))),
    CONSTRAINT locations_service_area_has_no_address CHECK (((kind <> 'service_area'::public.location_kind) OR ((NULLIF(btrim(COALESCE(address_line1, ''::text)), ''::text) IS NULL) AND (NULLIF(btrim(COALESCE(address_line2, ''::text)), ''::text) IS NULL) AND (NULLIF(btrim(COALESCE(postal_code, ''::text)), ''::text) IS NULL) AND (latitude IS NULL) AND (longitude IS NULL)))),
    CONSTRAINT locations_service_area_radius_range CHECK (((service_area_radius_km IS NULL) OR ((service_area_radius_km > (0)::double precision) AND (service_area_radius_km <= (100)::double precision))))
);

ALTER TABLE ONLY public.locations FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE locations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.locations IS 'Physical shop location belonging to an organization. An organization can have many.';


--
-- Name: COLUMN locations.latitude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.locations.latitude IS 'Nullable — a location only participates in distance-sorted/radius-filtered marketplace search once geocoded. No geocoding pipeline exists yet (out of scope for this migration); set manually or by a future onboarding step.';


--
-- Name: COLUMN locations.kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.locations.kind IS 'physical_address (default, and what every row created before B1 is) or service_area. Backfilled by the column default: an existing row describes a place, which is exactly what physical_address means.';


--
-- Name: COLUMN locations.service_area_center_latitude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.locations.service_area_center_latitude IS 'Centre of the covered zone. NOT an address and NOT where the professional is — locations.latitude stays NULL for a service area precisely so no consumer can mistake one for the other.';


--
-- Name: COLUMN locations.service_area_center_longitude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.locations.service_area_center_longitude IS 'See service_area_center_latitude.';


--
-- Name: COLUMN locations.service_area_radius_km; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.locations.service_area_radius_km IS 'How far from the centre the professional will travel. A search point within this radius is COVERED, and the row must be returned even when the centre is further away than the customer''s own search radius (MASTER_SPEC §8).';


--
-- Name: COLUMN locations.queue_check_in_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.locations.queue_check_in_token IS 'The value encoded in the QR code displayed inside the establishment. Regenerable by an owner or manager (regenerate_location_queue_check_in_token) so a shop that suspects its code is circulating can invalidate every printed copy at once. Never selectable by anon — locations grants no privilege to that role — and never returned by a public RPC: join_public_queue COMPARES it, and comparison is the only public operation on it.';


--
-- Name: CONSTRAINT locations_kind_shape ON locations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT locations_kind_shape ON public.locations IS 'A service area is fully defined or it does not exist: centre and radius together, never one without the other. A physical address carries none of them.';


--
-- Name: CONSTRAINT locations_service_area_has_no_address ON locations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT locations_service_area_has_no_address ON public.locations IS 'MASTER_SPEC §8, in the schema: a mobile professional never has a fake physical address. Street lines, postal code and the physical coordinate pair are unrepresentable on a service area, so no RPC can return one and no operator can type one in. city / region / country remain allowed — an administrative area is a true fact about a zone and search filters on it.';


--
-- Name: CONSTRAINT locations_service_area_radius_range ON locations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT locations_service_area_radius_range ON public.locations IS 'A zone with a zero radius is not a zone, and one wider than 100 km is not a service area a barber travels — it is a way of appearing in every search in the country. The upper bound is a product judgement, not a physical one, and MASTER_SPEC §8''s 10 km urban default sits comfortably inside it.';


--
-- Name: membership_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    price_cents integer NOT NULL,
    billing_interval public.billing_interval DEFAULT 'monthly'::public.billing_interval NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT membership_plans_name_not_blank CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT membership_plans_price_cents_non_negative CHECK ((price_cents >= 0))
);

ALTER TABLE ONLY public.membership_plans FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE membership_plans; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.membership_plans IS 'A recurring plan a shop offers customers (e.g. "Unlimited Fades Monthly"). Not a staff role — see public.memberships for that. No real billing yet (LOT 16); price_cents/billing_interval describe the plan, nothing here charges a card.';


--
-- Name: ml_datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_datasets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version text NOT NULL,
    feature_schema_version text NOT NULL,
    target public.ml_model_target NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    positive_count integer DEFAULT 0 NOT NULL,
    negative_count integer DEFAULT 0 NOT NULL,
    snapshot_from timestamp with time zone,
    snapshot_to timestamp with time zone NOT NULL,
    feature_coverage jsonb DEFAULT '{}'::jsonb NOT NULL,
    label_distribution jsonb DEFAULT '{}'::jsonb NOT NULL,
    random_seed integer DEFAULT 42 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ml_datasets_counts_consistent CHECK (((positive_count + negative_count) <= row_count)),
    CONSTRAINT ml_datasets_negative_count_check CHECK ((negative_count >= 0)),
    CONSTRAINT ml_datasets_positive_count_check CHECK ((positive_count >= 0)),
    CONSTRAINT ml_datasets_row_count_check CHECK ((row_count >= 0)),
    CONSTRAINT ml_datasets_version_check CHECK ((version ~ '^[a-z0-9._-]+$'::text))
);

ALTER TABLE ONLY public.ml_datasets FORCE ROW LEVEL SECURITY;


--
-- Name: ml_feature_schemas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_feature_schemas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version text NOT NULL,
    features jsonb DEFAULT '[]'::jsonb NOT NULL,
    forbidden_features text[] DEFAULT ARRAY['replied'::text, 'positive_reply'::text, 'delivered'::text, 'read'::text, 'claimed'::text, 'activated'::text, 'paid'::text, 'replied_at'::text, 'delivered_at'::text, 'read_at'::text, 'converted_at'::text] NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ml_feature_schemas_version_check CHECK ((version ~ '^[a-z0-9._-]+$'::text))
);

ALTER TABLE ONLY public.ml_feature_schemas FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ml_feature_schemas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ml_feature_schemas IS 'Versioned feature contract. forbidden_features is the machine-checkable data-leakage guard: the training pipeline fails if any of these appears in a training matrix (spec §68).';


--
-- Name: ml_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_version_id uuid NOT NULL,
    metric_key text NOT NULL,
    metric_value numeric NOT NULL,
    split text DEFAULT 'validation'::text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ml_metrics_metric_key_check CHECK ((metric_key ~ '^[a-z0-9_@.]+$'::text)),
    CONSTRAINT ml_metrics_split_check CHECK ((split = ANY (ARRAY['train'::text, 'validation'::text, 'test'::text, 'production'::text])))
);

ALTER TABLE ONLY public.ml_metrics FORCE ROW LEVEL SECURITY;


--
-- Name: ml_predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_predictions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    template_id uuid NOT NULL,
    model_version_id uuid,
    is_fallback boolean DEFAULT false NOT NULL,
    target public.ml_model_target NOT NULL,
    predicted_probability numeric(6,5) NOT NULL,
    feature_schema_version text,
    features_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    selected boolean DEFAULT false NOT NULL,
    campaign_id uuid,
    predicted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ml_predictions_predicted_probability_check CHECK (((predicted_probability >= (0)::numeric) AND (predicted_probability <= (1)::numeric)))
);

ALTER TABLE ONLY public.ml_predictions FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ml_predictions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ml_predictions IS 'Append-only prediction history — one row per (prospect, candidate template), with the chosen one flagged `selected`. Never overwritten (spec §37), so every past recommendation stays auditable.';


--
-- Name: ml_training_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_training_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_version_id uuid,
    dataset_version text,
    status text DEFAULT 'running'::text NOT NULL,
    skip_reason text,
    train_rows integer,
    validation_rows integer,
    train_metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    validation_metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    baseline_metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    leakage_check_passed boolean,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    log_excerpt text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ml_training_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'skipped_insufficient_data'::text]))),
    CONSTRAINT ml_training_runs_train_rows_check CHECK (((train_rows IS NULL) OR (train_rows >= 0))),
    CONSTRAINT ml_training_runs_validation_rows_check CHECK (((validation_rows IS NULL) OR (validation_rows >= 0)))
);

ALTER TABLE ONLY public.ml_training_runs FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ml_training_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ml_training_runs IS 'Every training attempt, including the ones that correctly declined to train. status = skipped_insufficient_data with a skip_reason is a SUCCESSFUL outcome of the phased ML strategy, not a failure.';


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type public.notification_type NOT NULL,
    title text NOT NULL,
    body text,
    organization_id uuid,
    appointment_id uuid,
    dedupe_key text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_title_not_blank CHECK ((btrim(title) <> ''::text))
);

ALTER TABLE ONLY public.notifications FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notifications IS 'Product notifications for customers and professionals. Distinct from platform_notifications, which is FadeUp staff only. Owner-scoped RLS: a recipient reads and dismisses their own rows and nothing else. Written server-side inside the same transaction as the business transition it describes.';


--
-- Name: organization_commercial_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_commercial_state (
    organization_id uuid NOT NULL,
    plan_key text DEFAULT 'free'::text NOT NULL,
    status public.commercial_status DEFAULT 'active'::public.commercial_status NOT NULL,
    entitlement_source public.entitlement_source DEFAULT 'early_access'::public.entitlement_source NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid,
    assignment_note text,
    provider text,
    provider_customer_ref text,
    provider_subscription_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_commercial_state_billing_needs_provider CHECK (((entitlement_source <> 'billing'::public.entitlement_source) OR (provider IS NOT NULL))),
    CONSTRAINT organization_commercial_state_free_is_active CHECK (((plan_key <> 'free'::text) OR (status = 'active'::public.commercial_status))),
    CONSTRAINT organization_commercial_state_provider_refs_need_provider CHECK (((provider IS NOT NULL) OR ((provider_customer_ref IS NULL) AND (provider_subscription_ref IS NULL))))
);

ALTER TABLE ONLY public.organization_commercial_state FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE organization_commercial_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organization_commercial_state IS 'Exactly one row per organization: which commercial plan is in force, whether it is in force, and why. THE authoritative input to every entitlement decision. anon and authenticated hold no privilege on this table and there is no client-facing write policy of any kind — the only writers are the new-organization default trigger and public.assign_commercial_plan(), which requires platform admin. organization_id is the primary key so the row can also serve as the per-organization mutex the capacity triggers lock.';


--
-- Name: COLUMN organization_commercial_state.plan_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_commercial_state.plan_key IS 'Which package. Machine identity only — never a display name, never a price. Defaults to free, which is a legitimate network state and not a failure.';


--
-- Name: COLUMN organization_commercial_state.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_commercial_state.status IS 'Whether the package is in force. Separate from plan_key on purpose: collapsing them would make "free" mean both the Free plan and a plan that lapsed.';


--
-- Name: COLUMN organization_commercial_state.entitlement_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_commercial_state.entitlement_source IS 'Why the plan is in force. R2 never writes billing: no billing provider is integrated, and marking an organization paid because someone clicked a plan in a browser is exactly the fabrication this column exists to make visible.';


--
-- Name: COLUMN organization_commercial_state.provider; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_commercial_state.provider IS 'Opaque billing-provider name. NULL throughout R2. Present so a later billing lot needs no schema migration, and so it is obvious that no provider is the source of truth for access — this row is.';


--
-- Name: organization_dashboard_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_dashboard_layouts (
    organization_id uuid NOT NULL,
    module_order text[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT organization_dashboard_layouts_keys_valid CHECK (private.valid_dashboard_module_keys(module_order)),
    CONSTRAINT organization_dashboard_layouts_size CHECK (((array_length(module_order, 1) >= 1) AND (array_length(module_order, 1) <= 32)))
);

ALTER TABLE ONLY public.organization_dashboard_layouts FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE organization_dashboard_layouts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organization_dashboard_layouts IS 'The Pro dashboard module order, owned by the ORGANIZATION rather than by a member — R5 §24. Keyed on organization_id alone so a per-user layout cannot exist by accident. Readable by every member of the shop, writable only by owner/manager. Module keys are validated for shape, not against a vocabulary: dashboard cards are presentational and adding one must not require a migration, so an unrecognised key is inert rather than invalid.';


--
-- Name: COLUMN organization_dashboard_layouts.module_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_dashboard_layouts.module_order IS 'Ordered module keys. Order is the payload; a module missing from the array is hidden for this shop. Unknown keys are ignored by the client.';


--
-- Name: COLUMN organization_dashboard_layouts.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_dashboard_layouts.updated_by IS 'Who last rearranged the shop dashboard. Recorded for support ("why did this move?"), never used to scope a read — the layout is the shop''s, not this person''s.';


--
-- Name: organization_follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_follows (
    follower_user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    is_following boolean DEFAULT true NOT NULL,
    followed_at timestamp with time zone,
    unfollowed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_follows_timestamp_state_check CHECK ((((is_following = true) AND (followed_at IS NOT NULL) AND (unfollowed_at IS NULL)) OR ((is_following = false) AND (unfollowed_at IS NOT NULL))))
);

ALTER TABLE ONLY public.organization_follows FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE organization_follows; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organization_follows IS 'Durable customer-to-barbershop social Follow graph. Separate from customer_favorites. Explicit unfollows are retained as tombstones.';


--
-- Name: outreach_channel_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_channel_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel public.outreach_channel_kind NOT NULL,
    country text NOT NULL,
    requires_explicit_opt_in boolean DEFAULT true NOT NULL,
    policy_notes text,
    set_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outreach_channel_policies_country_check CHECK ((country ~ '^[A-Z]{2}$'::text))
);

ALTER TABLE ONLY public.outreach_channel_policies FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE outreach_channel_policies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.outreach_channel_policies IS 'Operator-declared per-country consent policy. Default requires_explicit_opt_in = true (the safe posture). Nothing here is inferred — the Platform Owner records the decision and the eligibility gate enforces it.';


--
-- Name: outreach_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_id uuid NOT NULL,
    prospect_id uuid NOT NULL,
    event_type public.outreach_event_type NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_event_id text,
    classified_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.outreach_events FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE outreach_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.outreach_events IS 'Append-only funnel outcome log through to paid. Reply sentiment is either human-classified (classified_by set) or matched by the deterministic opt-out keyword list — never inferred by a model (spec §34 "Do not invent labels").';


--
-- Name: outreach_funnel_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.outreach_funnel_stats WITH (security_invoker='on') AS
 SELECT c.id AS campaign_id,
    c.name AS campaign_name,
    r.template_id,
    t.key AS template_key,
    r.locale,
    r.sales_angle,
    r.experiment_id,
    r.experiment_arm,
    bp.key AS booking_provider_key,
    p.country,
    count(*) AS recipients,
    count(*) FILTER (WHERE (r.state = 'blocked'::public.outreach_recipient_state)) AS blocked,
    count(*) FILTER (WHERE (r.state <> ALL (ARRAY['pending'::public.outreach_recipient_state, 'blocked'::public.outreach_recipient_state]))) AS queued_or_beyond,
    count(*) FILTER (WHERE (r.sent_at IS NOT NULL)) AS sent,
    count(*) FILTER (WHERE (r.delivered_at IS NOT NULL)) AS delivered,
    count(*) FILTER (WHERE (r.read_at IS NOT NULL)) AS read,
    count(*) FILTER (WHERE (r.replied_at IS NOT NULL)) AS replied,
    count(*) FILTER (WHERE (r.state = 'positive_reply'::public.outreach_recipient_state)) AS positive_reply,
    count(*) FILTER (WHERE (r.state = 'negative_reply'::public.outreach_recipient_state)) AS negative_reply,
    count(*) FILTER (WHERE (r.state = 'opted_out'::public.outreach_recipient_state)) AS opted_out,
    count(*) FILTER (WHERE (r.state = ANY (ARRAY['claimed'::public.outreach_recipient_state, 'activated'::public.outreach_recipient_state, 'paid'::public.outreach_recipient_state]))) AS claimed,
    count(*) FILTER (WHERE (r.state = ANY (ARRAY['activated'::public.outreach_recipient_state, 'paid'::public.outreach_recipient_state]))) AS activated,
    count(*) FILTER (WHERE (r.state = 'paid'::public.outreach_recipient_state)) AS paid
   FROM ((((public.outreach_recipients r
     JOIN public.outreach_campaigns c ON ((c.id = r.campaign_id)))
     JOIN public.prospects p ON ((p.id = r.prospect_id)))
     LEFT JOIN public.outreach_templates t ON ((t.id = r.template_id)))
     LEFT JOIN public.booking_providers bp ON ((bp.id = p.current_booking_provider_id)))
  GROUP BY c.id, c.name, r.template_id, t.key, r.locale, r.sales_angle, r.experiment_id, r.experiment_arm, bp.key, p.country;


--
-- Name: VIEW outreach_funnel_stats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.outreach_funnel_stats IS 'Live funnel counts sliced by campaign/template/locale/angle/experiment/competitor/country. security_invoker = on, so the caller''s RLS on the underlying tables still applies.';


--
-- Name: outreach_sales_angles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_sales_angles (
    key text NOT NULL,
    display_name text NOT NULL,
    description text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outreach_sales_angles_key_check CHECK ((key ~ '^[A-Z0-9_]+$'::text))
);

ALTER TABLE ONLY public.outreach_sales_angles FORCE ROW LEVEL SECURITY;


--
-- Name: plan_capabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_capabilities (
    plan_key text NOT NULL,
    capability_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.plan_capabilities FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE plan_capabilities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.plan_capabilities IS 'The single canonical plan -> capability matrix. Both FKs are ON DELETE RESTRICT: removing a plan or a capability that is still packaged must be an explicit, visible act, never a cascade that silently shrinks four plans at once.';


--
-- Name: platform_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    target_type text,
    target_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.platform_audit_log FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE platform_audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.platform_audit_log IS 'Append-only platform-level security event log (bootstrap/invitation/role events). Insert only via this migration''s SECURITY DEFINER RPCs — never a client write path.';


--
-- Name: platform_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    target_type text,
    target_id uuid,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_notifications_type_not_blank CHECK ((btrim(type) <> ''::text))
);

ALTER TABLE ONLY public.platform_notifications FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE platform_notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.platform_notifications IS 'In-app notifications for FadeUp platform staff only (one row per recipient). Carries no more applicant data than a reviewer needs to decide whether to open the item.';


--
-- Name: platform_owner_bootstrap_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_owner_bootstrap_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    claimed_by uuid,
    revoked_at timestamp with time zone
);

ALTER TABLE ONLY public.platform_owner_bootstrap_tokens FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE platform_owner_bootstrap_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.platform_owner_bootstrap_tokens IS 'Single-use hashed bootstrap tokens for claiming platform_owner. Zero client-facing policies — read/write only through claim_platform_owner_bootstrap()/reissue_platform_owner_bootstrap_token() or operator SQL.';


--
-- Name: professional_follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.professional_follows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    follower_user_id uuid NOT NULL,
    professional_id uuid NOT NULL,
    state public.follow_state DEFAULT 'following'::public.follow_state NOT NULL,
    source public.follow_source DEFAULT 'manual'::public.follow_source NOT NULL,
    followed_at timestamp with time zone,
    unfollowed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT professional_follows_state_timestamps CHECK ((((state = 'following'::public.follow_state) AND (followed_at IS NOT NULL) AND (unfollowed_at IS NULL)) OR ((state = 'unfollowed'::public.follow_state) AND (unfollowed_at IS NOT NULL))))
);

ALTER TABLE ONLY public.professional_follows FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE professional_follows; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.professional_follows IS 'Customer -> professional follow edge, one row per pair, mutated in place. state=''unfollowed'' IS explicit unfollow: auto-follow can only ever CREATE a row (ON CONFLICT DO NOTHING), never transition one, so no automatic event can reverse a customer''s deliberate decision. A follow is an expression of INTENT and is never evidence that a service happened — see customer_professional_relationships for that, and Constitution §3.2.';


--
-- Name: COLUMN professional_follows.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professional_follows.source IS 'How the CURRENT state arose. A manual follow always overwrites this to ''manual'', because the customer''s own action is what the row now records.';


--
-- Name: COLUMN professional_follows.followed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professional_follows.followed_at IS 'When following began. NULL means it never did — the row is a pure unfollow tombstone. Never stamped speculatively.';


--
-- Name: COLUMN professional_follows.unfollowed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professional_follows.unfollowed_at IS 'The customer''s explicit decision to stop, and the timestamp of it. Preserved across repeat unfollows: the first refusal is the truthful one.';


--
-- Name: professionals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.professionals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_state public.professional_claim_state DEFAULT 'unclaimed'::public.professional_claim_state NOT NULL,
    user_id uuid,
    display_name text NOT NULL,
    handle text,
    headline text,
    bio text,
    avatar_url text,
    source public.professional_source DEFAULT 'fadeup'::public.professional_source NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    claimed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT professionals_claim_state_matches_timestamp CHECK (((claim_state = 'claimed'::public.professional_claim_state) = (claimed_at IS NOT NULL))),
    CONSTRAINT professionals_claim_state_matches_user CHECK (((claim_state = 'claimed'::public.professional_claim_state) = (user_id IS NOT NULL))),
    CONSTRAINT professionals_display_name_not_blank CHECK ((btrim(display_name) <> ''::text)),
    CONSTRAINT professionals_handle_shape CHECK (((handle IS NULL) OR (handle ~ '^[a-z0-9][a-z0-9_.]{1,29}$'::text))),
    CONSTRAINT professionals_publication_eligibility CHECK (((NOT is_public) OR (btrim(display_name) <> ''::text)))
);

ALTER TABLE ONLY public.professionals FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE professionals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.professionals IS 'The durable, shop-independent identity of a professional. Platform-scoped by design (see migration header): it exists to OUTLIVE membership of any organization, and carries no operational data — availability, services, appointments and queue entries hang off barbers/organizations only. That absence is what makes an unclaimed external profile structurally incapable of implying FadeUp operational truth.';


--
-- Name: COLUMN professionals.claim_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professionals.claim_state IS 'Who controls this identity. NEVER subscription state (Constitution §5.6): claimed does not mean paid. This is the discriminator; user_id being NULL is its consequence, not its source.';


--
-- Name: COLUMN professionals.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professionals.user_id IS 'The controlling account. ON DELETE SET NULL: erasing an account DETACHES it and the professionals_guard_identity trigger reverts the row to unclaimed, rather than dead-ending erasure on a foreign key or cascading away an identity that appointment history depends on.';


--
-- Name: COLUMN professionals.handle; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professionals.handle IS 'Public shop-independent address. Nullable bridge — uniqueness exists from day one but no handle is backfilled, because inventing public usernames for existing barbers would churn identity nobody asked to change. Populated by R6/R7.';


--
-- Name: COLUMN professionals.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professionals.source IS 'fadeup = minted from a real FadeUp roster record; acquisition = minted from a canonical prospect by create_external_professional. Withheld from client SELECT: internal provenance.';


--
-- Name: COLUMN professionals.is_public; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.professionals.is_public IS 'Whether this identity is CURRENTLY projected publicly. Distinct from existence and from eligibility. Never inherited from staff_profiles.is_public. Legal for an unclaimed identity since B1, provided professionals_guard_publication finds a corroborating anchor.';


--
-- Name: CONSTRAINT professionals_publication_eligibility ON professionals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT professionals_publication_eligibility ON public.professionals IS 'Publication needs a usable name. The claim_state clause this constraint carried until B1 is NOT abandoned — it is replaced by professionals_guard_publication, which asks for a corroborating anchor instead, because an unclaimed profile with real evidence behind it is the entire acquisition model (MASTER_SPEC §5) while an unclaimed profile with nothing behind it is what R1B was right to refuse.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    locale text,
    theme text,
    CONSTRAINT profiles_full_name_not_blank CHECK (((full_name IS NULL) OR (btrim(full_name) <> ''::text))),
    CONSTRAINT profiles_locale_valid CHECK (((locale IS NULL) OR (locale = ANY (ARRAY['en'::text, 'fr'::text, 'es'::text, 'de'::text, 'it'::text, 'pt'::text, 'ar'::text, 'zh-CN'::text, 'ja'::text, 'ru'::text])))),
    CONSTRAINT profiles_theme_valid CHECK (((theme IS NULL) OR (theme = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text]))))
);

ALTER TABLE ONLY public.profiles FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profiles IS 'One row per auth.users row. Basic identity only — not tenant data. Populated by handle_new_user() trigger.';


--
-- Name: COLUMN profiles.locale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.locale IS 'Explicit user language preference (one of the 10 supported locales), NULL if never set — frontend falls back to cookie/IP-geo/browser/English.';


--
-- Name: COLUMN profiles.theme; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.theme IS 'Explicit user theme preference (light/dark/system), NULL if never set — frontend falls back to localStorage default of system.';


--
-- Name: prospect_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    full_name text,
    role_title text,
    phone_e164 text,
    email text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_contacts_has_identity CHECK (((full_name IS NOT NULL) OR (phone_e164 IS NOT NULL) OR (email IS NOT NULL)))
);

ALTER TABLE ONLY public.prospect_contacts FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_contacts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_contacts IS 'Named individual contacts at a prospect (owner, manager, ...), distinct from the business-level phone/email on prospects itself.';


--
-- Name: prospect_data_quality; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_data_quality (
    prospect_id uuid NOT NULL,
    identity_completeness numeric(5,4) DEFAULT 0 NOT NULL,
    contact_completeness numeric(5,4) DEFAULT 0 NOT NULL,
    digital_completeness numeric(5,4) DEFAULT 0 NOT NULL,
    source_count integer DEFAULT 0 NOT NULL,
    source_agreement numeric(5,4),
    conflict_count integer DEFAULT 0 NOT NULL,
    enrichment_success public.prospect_tribool DEFAULT 'UNKNOWN'::public.prospect_tribool NOT NULL,
    data_freshness_days numeric,
    overall_confidence numeric(5,4) DEFAULT 0 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_data_quality_conflict_count_check CHECK ((conflict_count >= 0)),
    CONSTRAINT prospect_data_quality_contact_completeness_check CHECK (((contact_completeness >= (0)::numeric) AND (contact_completeness <= (1)::numeric))),
    CONSTRAINT prospect_data_quality_digital_completeness_check CHECK (((digital_completeness >= (0)::numeric) AND (digital_completeness <= (1)::numeric))),
    CONSTRAINT prospect_data_quality_identity_completeness_check CHECK (((identity_completeness >= (0)::numeric) AND (identity_completeness <= (1)::numeric))),
    CONSTRAINT prospect_data_quality_overall_confidence_check CHECK (((overall_confidence >= (0)::numeric) AND (overall_confidence <= (1)::numeric))),
    CONSTRAINT prospect_data_quality_source_agreement_check CHECK (((source_agreement IS NULL) OR ((source_agreement >= (0)::numeric) AND (source_agreement <= (1)::numeric)))),
    CONSTRAINT prospect_data_quality_source_count_check CHECK ((source_count >= 0))
);

ALTER TABLE ONLY public.prospect_data_quality FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_data_quality; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_data_quality IS 'Per-prospect data-quality snapshot surfaced in /platform. enrichment_success is tri-state: a crawl that never ran is UNKNOWN, not a failure.';


--
-- Name: prospect_duplicates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_duplicates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    duplicate_of_prospect_id uuid NOT NULL,
    confidence numeric(4,3) NOT NULL,
    reason text NOT NULL,
    status public.prospect_duplicate_status DEFAULT 'pending'::public.prospect_duplicate_status NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_duplicates_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT prospect_duplicates_not_self CHECK ((prospect_id <> duplicate_of_prospect_id)),
    CONSTRAINT prospect_duplicates_reason_check CHECK ((btrim(reason) <> ''::text))
);

ALTER TABLE ONLY public.prospect_duplicates FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_duplicates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_duplicates IS 'Candidate duplicate pairs awaiting platform-staff review. Never auto-merged — see spec: "Do not automatically merge uncertain candidates."';


--
-- Name: prospect_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_user_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_events_event_type_check CHECK ((btrim(event_type) <> ''::text))
);

ALTER TABLE ONLY public.prospect_events FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_events IS 'Append-only prospect timeline (pipeline transitions, enrichment runs, ...). actor_user_id null means the Worker/system, not a platform staff member.';


--
-- Name: prospect_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_features (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    feature_key text NOT NULL,
    feature_version text DEFAULT 'v1'::text NOT NULL,
    value_bool public.prospect_tribool,
    value_numeric numeric,
    value_text text,
    evidence_source text,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence numeric(4,3),
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_features_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT prospect_features_feature_key_check CHECK ((feature_key ~ '^[a-z0-9_]+$'::text)),
    CONSTRAINT prospect_features_single_value CHECK ((((((value_bool IS NOT NULL))::integer + ((value_numeric IS NOT NULL))::integer) + ((value_text IS NOT NULL))::integer) = 1))
);

ALTER TABLE ONLY public.prospect_features FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_features; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_features IS 'Versioned feature store, one row per (prospect, feature_key, feature_version). Boolean features use public.prospect_tribool so "not observed" (UNKNOWN) is never conflated with "observed absent" (FALSE) — see spec §17.';


--
-- Name: prospect_fit_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_fit_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    score_kind text NOT NULL,
    score integer NOT NULL,
    classification public.prospect_fit_class NOT NULL,
    breakdown jsonb DEFAULT '[]'::jsonb NOT NULL,
    ruleset_version text NOT NULL,
    scored_at timestamp with time zone DEFAULT now() NOT NULL,
    job_id uuid,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_fit_scores_score_check CHECK (((score >= 0) AND (score <= 100))),
    CONSTRAINT prospect_fit_scores_score_kind_check CHECK ((score_kind = ANY (ARRAY['fadeup_fit'::text, 'migration_potential'::text])))
);

ALTER TABLE ONLY public.prospect_fit_scores FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_fit_scores; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_fit_scores IS 'Append-only history of the two distinct deterministic scores: fadeup_fit (general opportunity) and migration_potential (switch-from-competitor value). Kept apart on purpose — see spec §20.';


--
-- Name: prospect_identity_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_identity_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    candidate_prospect_id uuid,
    source_key text,
    source_external_id text,
    state public.prospect_identity_match_state NOT NULL,
    matching_rule text NOT NULL,
    matched_attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence numeric(4,3) NOT NULL,
    rules_version text DEFAULT 'identity-v2'::text NOT NULL,
    merge_applied boolean DEFAULT false NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    job_id uuid,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_identity_matches_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT prospect_identity_matches_matching_rule_check CHECK ((btrim(matching_rule) <> ''::text)),
    CONSTRAINT prospect_identity_matches_merge_only_when_matched CHECK (((NOT merge_applied) OR (state = 'MATCHED'::public.prospect_identity_match_state))),
    CONSTRAINT prospect_identity_matches_not_self CHECK (((candidate_prospect_id IS NULL) OR (candidate_prospect_id <> prospect_id)))
);

ALTER TABLE ONLY public.prospect_identity_matches FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_identity_matches; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_identity_matches IS 'Audit trail for every identity-resolution decision (matched attributes + rule + confidence + version), including confident auto-links. REVIEW_REQUIRED/POSSIBLE_MATCH rows surface in /platform; they can never carry merge_applied = true.';


--
-- Name: prospect_job_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_job_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    source_id uuid NOT NULL,
    status public.prospect_job_source_status DEFAULT 'pending'::public.prospect_job_source_status NOT NULL,
    candidates_found integer DEFAULT 0 NOT NULL,
    error text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_job_sources_candidates_found_check CHECK ((candidates_found >= 0))
);

ALTER TABLE ONLY public.prospect_job_sources FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_job_sources; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_job_sources IS 'Per-source progress within a discovery/enrichment job. A failed source_id here does not fail the whole job — see spec: "a failed source must not destroy the entire discovery job".';


--
-- Name: prospect_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    is_primary boolean DEFAULT true NOT NULL,
    address_line text,
    city text,
    postal_code text,
    region text,
    country text NOT NULL,
    latitude double precision,
    longitude double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_locations_country_check CHECK ((country ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT prospect_locations_lat_lon_together CHECK ((((latitude IS NULL) AND (longitude IS NULL)) OR ((latitude IS NOT NULL) AND (longitude IS NOT NULL)))),
    CONSTRAINT prospect_locations_latitude_check CHECK (((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision))),
    CONSTRAINT prospect_locations_longitude_check CHECK (((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))
);

ALTER TABLE ONLY public.prospect_locations FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_locations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_locations IS 'One or more physical locations for a prospect. A group_parent prospect (see prospect_entity_kind) typically has none of its own — its group_location children each have one.';


--
-- Name: prospect_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    author_user_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_notes_body_check CHECK ((btrim(body) <> ''::text))
);

ALTER TABLE ONLY public.prospect_notes FORCE ROW LEVEL SECURITY;


--
-- Name: prospect_outreach; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_outreach (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    channel public.prospect_outreach_channel NOT NULL,
    direction public.prospect_outreach_direction DEFAULT 'outbound'::public.prospect_outreach_direction NOT NULL,
    summary text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    logged_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.prospect_outreach FORCE ROW LEVEL SECURITY;


--
-- Name: prospect_outreach_eligibility; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_outreach_eligibility (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    channel public.outreach_channel_kind NOT NULL,
    destination text,
    is_eligible boolean DEFAULT false NOT NULL,
    opt_in_status public.outreach_opt_in_status DEFAULT 'none'::public.outreach_opt_in_status NOT NULL,
    opt_in_source text,
    opt_in_at timestamp with time zone,
    do_not_contact boolean DEFAULT false NOT NULL,
    opted_out_at timestamp with time zone,
    suppression_reason text,
    destination_invalid boolean DEFAULT false NOT NULL,
    last_evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.prospect_outreach_eligibility FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_outreach_eligibility; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_outreach_eligibility IS 'Server-side, channel-specific contactability. is_eligible defaults to FALSE: discovering a phone number never creates eligibility (spec §28). Enforced by private.assert_whatsapp_sendable() on the recipient insert path, so no client can bypass it.';


--
-- Name: prospect_professionals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_professionals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    professional_id uuid NOT NULL,
    match_confidence numeric(4,3),
    matching_rule text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_professionals_match_confidence_check CHECK (((match_confidence IS NULL) OR ((match_confidence >= (0)::numeric) AND (match_confidence <= (1)::numeric))))
);

ALTER TABLE ONLY public.prospect_professionals FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_professionals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_professionals IS 'Acquisition-side link from a canonical prospect to the durable professional identity minted for it. The FK deliberately lives HERE and not on professionals: that table is tenant-readable and publicly projected, and a reverse FK would put acquisition metadata one join from a barber''s own profile. Unique on both sides, so publication is idempotent per prospect and provenance stays reconcilable.';


--
-- Name: COLUMN prospect_professionals.match_confidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.prospect_professionals.match_confidence IS 'Evidence quality from the Worker pipeline, recorded not acted upon. R1B performs no automatic merging on this value — Constitution §5.3 prefers an unresolved duplicate to a false merge of two real businesses.';


--
-- Name: prospect_publication_queue; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.prospect_publication_queue WITH (security_invoker='true') AS
 SELECT p.id AS prospect_id,
    p.canonical_name,
    p.country,
    p.entity_kind,
    p.type AS prospect_type,
    p.website_domain,
    p.first_discovered_at,
    e.is_eligible,
    e.block_reason,
    e.distinct_source_count,
    e.has_trust_anchor,
    e.evaluated_at,
    (e.block_reason = 'already_published'::text) AS is_published
   FROM (public.prospects p
     JOIN public.prospect_publication_eligibility e ON ((e.prospect_id = p.id)));


--
-- Name: VIEW prospect_publication_queue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.prospect_publication_queue IS 'The operator review queue for external-profile publication. A deliberately NARROW projection of prospects: name, country, kind, domain and the gate''s own evidence — and none of the commercial score, contact details or sales pipeline state that live on the same row, because the publication decision is about whether a business is real, not whether it is a good lead. security_invoker, so platform-role RLS on the underlying tables still decides who sees anything. Deliberately does NOT join prospect_professionals: that would require re-granting SELECT on it to `authenticated`, removing one of the two independent layers R1B put in front of acquisition provenance, to populate a column this screen does not display.';


--
-- Name: prospect_score_distribution; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.prospect_score_distribution WITH (security_invoker='on') AS
 SELECT score_kind,
    count(*) AS scored,
    (avg(score))::numeric(6,2) AS mean_score,
    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((score)::double precision)))::numeric(6,2) AS median_score,
    (stddev_pop(score))::numeric(6,2) AS stddev_score,
    (percentile_cont((0.1)::double precision) WITHIN GROUP (ORDER BY ((score)::double precision)))::numeric(6,2) AS p10,
    (percentile_cont((0.25)::double precision) WITHIN GROUP (ORDER BY ((score)::double precision)))::numeric(6,2) AS p25,
    (percentile_cont((0.75)::double precision) WITHIN GROUP (ORDER BY ((score)::double precision)))::numeric(6,2) AS p75,
    (percentile_cont((0.9)::double precision) WITHIN GROUP (ORDER BY ((score)::double precision)))::numeric(6,2) AS p90,
    count(*) FILTER (WHERE (classification = 'HOT'::public.prospect_fit_class)) AS hot_count,
    count(*) FILTER (WHERE (classification = 'WARM'::public.prospect_fit_class)) AS warm_count,
    count(*) FILTER (WHERE (classification = 'COLD'::public.prospect_fit_class)) AS cold_count,
    ((stddev_pop(score) < (5)::numeric) AND (count(*) >= 50)) AS low_discrimination_warning
   FROM public.prospect_fit_scores s
  WHERE is_current
  GROUP BY score_kind;


--
-- Name: VIEW prospect_score_distribution; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.prospect_score_distribution IS 'Score-health monitor. low_discrimination_warning fires when a score''s standard deviation collapses below 5 points over a meaningful sample — the "nearly every prospect is 85-95" pathology from spec §42.';


--
-- Name: prospect_score_rulesets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_score_rulesets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    score_kind text NOT NULL,
    version text NOT NULL,
    weights jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_score_rulesets_score_kind_check CHECK ((score_kind = ANY (ARRAY['fadeup_fit'::text, 'migration_potential'::text])))
);

ALTER TABLE ONLY public.prospect_score_rulesets FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_score_rulesets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_score_rulesets IS 'Operator-editable scoring weights. Exactly one active ruleset per score_kind; the Worker stamps prospect_fit_scores.ruleset_version with whatever it actually used (DB row or its bundled default).';


--
-- Name: prospect_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    score integer NOT NULL,
    bucket public.prospect_score_bucket NOT NULL,
    factors jsonb DEFAULT '[]'::jsonb NOT NULL,
    scored_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_scores_score_check CHECK (((score >= 0) AND (score <= 100)))
);

ALTER TABLE ONLY public.prospect_scores FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_scores; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_scores IS 'Append-only score history with an explainable factor breakdown (factors: [{factor, points, max_points, explanation}, ...]). No AI — deterministic rule scoring only, per spec.';


--
-- Name: prospect_search_partitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_search_partitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    search_id uuid NOT NULL,
    parent_partition_id uuid,
    source_key text NOT NULL,
    query text,
    country text NOT NULL,
    region text,
    city text,
    postal_code text,
    center_latitude double precision,
    center_longitude double precision,
    radius_km numeric,
    depth integer DEFAULT 0 NOT NULL,
    status public.prospect_search_partition_status DEFAULT 'planned'::public.prospect_search_partition_status NOT NULL,
    raw_results integer DEFAULT 0 NOT NULL,
    unique_results integer DEFAULT 0 NOT NULL,
    duplicate_results integer DEFAULT 0 NOT NULL,
    saturated boolean DEFAULT false NOT NULL,
    requests integer DEFAULT 0 NOT NULL,
    retries integer DEFAULT 0 NOT NULL,
    duration_ms integer,
    estimated_cost_usd numeric(12,6),
    job_id uuid,
    error text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_search_partitions_center_latitude_check CHECK (((center_latitude IS NULL) OR ((center_latitude >= ('-90'::integer)::double precision) AND (center_latitude <= (90)::double precision)))),
    CONSTRAINT prospect_search_partitions_center_longitude_check CHECK (((center_longitude IS NULL) OR ((center_longitude >= ('-180'::integer)::double precision) AND (center_longitude <= (180)::double precision)))),
    CONSTRAINT prospect_search_partitions_country_check CHECK ((country ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT prospect_search_partitions_depth_check CHECK ((depth >= 0)),
    CONSTRAINT prospect_search_partitions_duplicate_results_check CHECK ((duplicate_results >= 0)),
    CONSTRAINT prospect_search_partitions_duration_ms_check CHECK (((duration_ms IS NULL) OR (duration_ms >= 0))),
    CONSTRAINT prospect_search_partitions_estimated_cost_usd_check CHECK (((estimated_cost_usd IS NULL) OR (estimated_cost_usd >= (0)::numeric))),
    CONSTRAINT prospect_search_partitions_parent_not_self CHECK (((parent_partition_id IS NULL) OR (parent_partition_id <> id))),
    CONSTRAINT prospect_search_partitions_radius_km_check CHECK (((radius_km IS NULL) OR (radius_km > (0)::numeric))),
    CONSTRAINT prospect_search_partitions_raw_results_check CHECK ((raw_results >= 0)),
    CONSTRAINT prospect_search_partitions_requests_check CHECK ((requests >= 0)),
    CONSTRAINT prospect_search_partitions_retries_check CHECK ((retries >= 0)),
    CONSTRAINT prospect_search_partitions_unique_results_check CHECK ((unique_results >= 0))
);

ALTER TABLE ONLY public.prospect_search_partitions FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_search_partitions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_search_partitions IS 'One node of a search plan tree. estimated_cost_usd is NULL where a provider''s per-request price is not knowable — never a fabricated figure (spec §7 "estimated external cost where measurable").';


--
-- Name: prospect_searches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_searches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text,
    country text NOT NULL,
    region text,
    city text,
    postal_code text,
    latitude double precision,
    longitude double precision,
    radius_km numeric,
    entity_type text DEFAULT 'both'::text NOT NULL,
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    source_keys text[] DEFAULT '{}'::text[] NOT NULL,
    max_results integer,
    max_depth integer DEFAULT 3 NOT NULL,
    max_partitions integer DEFAULT 200 NOT NULL,
    max_requests integer DEFAULT 2000 NOT NULL,
    max_runtime_seconds integer DEFAULT 3600 NOT NULL,
    status text DEFAULT 'planned'::text NOT NULL,
    planner_version text DEFAULT 'planner-v1'::text NOT NULL,
    totals jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_searches_country_check CHECK ((country ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT prospect_searches_entity_type_check CHECK ((entity_type = ANY (ARRAY['barbershop'::text, 'independent_barber'::text, 'both'::text]))),
    CONSTRAINT prospect_searches_latitude_check CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)))),
    CONSTRAINT prospect_searches_longitude_check CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))),
    CONSTRAINT prospect_searches_max_depth_check CHECK (((max_depth >= 0) AND (max_depth <= 8))),
    CONSTRAINT prospect_searches_max_partitions_check CHECK (((max_partitions >= 1) AND (max_partitions <= 5000))),
    CONSTRAINT prospect_searches_max_requests_check CHECK (((max_requests >= 1) AND (max_requests <= 100000))),
    CONSTRAINT prospect_searches_max_results_check CHECK (((max_results IS NULL) OR (max_results > 0))),
    CONSTRAINT prospect_searches_max_runtime_seconds_check CHECK (((max_runtime_seconds >= 30) AND (max_runtime_seconds <= 86400))),
    CONSTRAINT prospect_searches_radius_km_check CHECK (((radius_km IS NULL) OR (radius_km > (0)::numeric))),
    CONSTRAINT prospect_searches_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'running'::text, 'completed'::text, 'cancelled'::text, 'failed'::text, 'limit_reached'::text])))
);

ALTER TABLE ONLY public.prospect_searches FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_searches; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_searches IS 'A planned multi-provider, multi-partition acquisition search. The max_* columns are hard stops enforced by the Worker''s planner and re-asserted here as the operator-visible contract.';


--
-- Name: prospect_segment_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_segment_definitions (
    key text NOT NULL,
    display_name text NOT NULL,
    description text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_segment_definitions_key_check CHECK ((key ~ '^[A-Z0-9_]+$'::text))
);

ALTER TABLE ONLY public.prospect_segment_definitions FORCE ROW LEVEL SECURITY;


--
-- Name: prospect_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_segments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    segment_key text NOT NULL,
    rationale jsonb DEFAULT '{}'::jsonb NOT NULL,
    segmenter_version text DEFAULT 'segments-v1'::text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_segments_segment_key_check CHECK ((segment_key ~ '^[A-Z0-9_]+$'::text))
);

ALTER TABLE ONLY public.prospect_segments FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_segments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_segments IS 'Multi-membership acquisition segments (NO_BOOKING, COMPETITOR_USER, HIGH_MIGRATION_POTENTIAL, REVIEW_REQUIRED, ...). Recomputed by the Worker''s segmentation step; rationale explains each membership.';


--
-- Name: prospect_social_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_social_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    platform public.prospect_social_platform NOT NULL,
    handle text,
    url text,
    external_id text,
    follower_count integer,
    is_business_account boolean,
    last_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_social_profiles_follower_count_check CHECK (((follower_count IS NULL) OR (follower_count >= 0))),
    CONSTRAINT prospect_social_profiles_handle_or_url CHECK (((handle IS NOT NULL) OR (url IS NOT NULL)))
);

ALTER TABLE ONLY public.prospect_social_profiles FORCE ROW LEVEL SECURITY;


--
-- Name: prospect_source_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_source_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    prospect_id uuid,
    external_id text,
    external_type text,
    source_url text,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence numeric(4,3),
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    last_verified_at timestamp with time zone,
    job_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_source_records_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))))
);

ALTER TABLE ONLY public.prospect_source_records FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_source_records; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_source_records IS 'Raw per-source record + provenance (external_id, source_url, fetched_at, confidence). Never overwritten/discarded during canonicalization — see migration header.';


--
-- Name: prospect_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_suppressions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope public.prospect_suppression_scope NOT NULL,
    prospect_id uuid,
    value text,
    reason text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_suppressions_reason_check CHECK ((btrim(reason) <> ''::text)),
    CONSTRAINT prospect_suppressions_shape CHECK ((((scope = 'prospect'::public.prospect_suppression_scope) AND (prospect_id IS NOT NULL) AND (value IS NULL)) OR ((scope <> 'prospect'::public.prospect_suppression_scope) AND (value IS NOT NULL))))
);

ALTER TABLE ONLY public.prospect_suppressions FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE prospect_suppressions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prospect_suppressions IS 'Global Do Not Contact list. Identifier-scoped rows (phone/email/domain/instagram_handle) block re-selection even under a freshly-discovered prospect id — see private.is_prospect_value_suppressed().';


--
-- Name: prospect_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    tag text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospect_tags_tag_check CHECK ((btrim(tag) <> ''::text))
);

ALTER TABLE ONLY public.prospect_tags FORCE ROW LEVEL SECURITY;


--
-- Name: queue_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    barber_id uuid,
    service_id uuid,
    customer_name text NOT NULL,
    customer_phone text,
    status public.queue_status DEFAULT 'waiting'::public.queue_status NOT NULL,
    notes text,
    called_at timestamp with time zone,
    service_started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id uuid,
    booked_by_user_id uuid,
    CONSTRAINT queue_entries_customer_name_not_blank CHECK ((btrim(customer_name) <> ''::text)),
    CONSTRAINT queue_entries_timestamps_monotonic CHECK ((((called_at IS NULL) OR (called_at >= created_at)) AND ((service_started_at IS NULL) OR (called_at IS NULL) OR (service_started_at >= called_at)) AND ((completed_at IS NULL) OR (service_started_at IS NULL) OR (completed_at >= service_started_at))))
);

ALTER TABLE ONLY public.queue_entries FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE queue_entries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.queue_entries IS 'Walk-in queue, separate from appointments (no scheduled time). Position in line is derived from created_at order among status=waiting rows, not stored. barber_id null means "any available barber."';


--
-- Name: COLUMN queue_entries.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.queue_entries.customer_id IS 'Auto-linked by link_customer_from_contact_info (find-or-create by phone/email) at insert time. Nullable: a walk-in with no phone stays unlinked.';


--
-- Name: COLUMN queue_entries.booked_by_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.queue_entries.booked_by_user_id IS 'The authenticated account that ITSELF joined this queue, stamped from auth.uid() inside join_public_queue. NULL for anonymous kiosk check-in and staff-added walk-ins. Same trust rule as appointments.booked_by_user_id.';


--
-- Name: service_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_categories_name_not_blank CHECK ((btrim(name) <> ''::text))
);

ALTER TABLE ONLY public.service_categories FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE service_categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.service_categories IS 'Optional grouping for services (e.g. "Haircuts", "Beard", "Color"). A service without a category is still valid.';


--
-- Name: service_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_locations (
    organization_id uuid NOT NULL,
    service_id uuid NOT NULL,
    location_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.service_locations FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE service_locations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.service_locations IS 'Explicit join: which locations offer a service. No rows for a service means "offered nowhere yet," not "offered everywhere."';


--
-- Name: service_mode_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_mode_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    change_kind public.service_mode_change_kind NOT NULL,
    scope public.service_mode_scope NOT NULL,
    location_id uuid NOT NULL,
    barber_id uuid,
    previous_mode public.service_mode,
    new_mode public.service_mode,
    previous_queue_open boolean,
    new_queue_open boolean,
    expires_at timestamp with time zone,
    changed_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.service_mode_changes FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE service_mode_changes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.service_mode_changes IS 'Append-only history of every service-mode and queue_open change: who, what scope, from what, to what, when, and until when. Append-only is enforced by trigger, not merely by withholding grants — an audit trail a privileged path can rewrite is not one. Deliberately narrow: five change kinds, not a general event bus. NOT backfilled — nobody made the pre-existing choices and inventing an actor for them would be a lie told to whoever reads this later.';


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    category_id uuid,
    name text NOT NULL,
    description text,
    duration_minutes integer NOT NULL,
    buffer_before_minutes integer DEFAULT 0 NOT NULL,
    buffer_after_minutes integer DEFAULT 0 NOT NULL,
    price_cents integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT services_buffers_nonnegative CHECK (((buffer_before_minutes >= 0) AND (buffer_after_minutes >= 0))),
    CONSTRAINT services_duration_positive CHECK ((duration_minutes > 0)),
    CONSTRAINT services_name_not_blank CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT services_price_nonnegative CHECK ((price_cents >= 0))
);

ALTER TABLE ONLY public.services FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE services; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.services IS 'Service catalog entry: duration/buffers drive appointment-engine slot math (LOT 8), not built here. price_cents is integer cents.';


--
-- Name: staff_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid,
    location_id uuid,
    display_name text NOT NULL,
    title text,
    bio text,
    avatar_url text,
    is_public boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_profiles_display_name_not_blank CHECK ((btrim(display_name) <> ''::text))
);

ALTER TABLE ONLY public.staff_profiles FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE staff_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.staff_profiles IS 'Operational/public-facing staff record: display name, title, bio, primary location. One per (organization, user). Authorization role lives in memberships, not here.';


--
-- Name: COLUMN staff_profiles.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.staff_profiles.user_id IS 'The account behind this roster record. NULLABLE and ON DELETE SET NULL: erasing an account detaches the person and leaves the shop''s service history intact, rather than cascading it away. A NULL user_id is a tombstone — every RLS predicate compares it to auth.uid(), which NULL never matches.';


--
-- Name: template_performance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.template_performance WITH (security_invoker='on') AS
 SELECT t.id AS template_id,
    t.key AS template_key,
    t.name,
    t.locale,
    t.status,
    t.sales_angle,
    t.segment_key,
    bp.key AS booking_provider_key,
    count(r.id) AS recipients,
    count(r.id) FILTER (WHERE (r.sent_at IS NOT NULL)) AS sent,
    count(r.id) FILTER (WHERE (r.delivered_at IS NOT NULL)) AS delivered,
    count(r.id) FILTER (WHERE (r.read_at IS NOT NULL)) AS read,
    count(r.id) FILTER (WHERE (r.replied_at IS NOT NULL)) AS replied,
    count(r.id) FILTER (WHERE (r.state = 'positive_reply'::public.outreach_recipient_state)) AS positive_reply,
    count(r.id) FILTER (WHERE (r.state = 'opted_out'::public.outreach_recipient_state)) AS opted_out,
    count(r.id) FILTER (WHERE (r.state = ANY (ARRAY['claimed'::public.outreach_recipient_state, 'activated'::public.outreach_recipient_state, 'paid'::public.outreach_recipient_state]))) AS claimed,
    count(r.id) FILTER (WHERE (r.state = ANY (ARRAY['activated'::public.outreach_recipient_state, 'paid'::public.outreach_recipient_state]))) AS activated,
    count(r.id) FILTER (WHERE (r.state = 'paid'::public.outreach_recipient_state)) AS paid,
        CASE
            WHEN (count(r.id) FILTER (WHERE (r.sent_at IS NOT NULL)) > 0) THEN ((count(r.id) FILTER (WHERE (r.replied_at IS NOT NULL)))::numeric / (count(r.id) FILTER (WHERE (r.sent_at IS NOT NULL)))::numeric)
            ELSE NULL::numeric
        END AS reply_rate,
        CASE
            WHEN (count(r.id) FILTER (WHERE (r.sent_at IS NOT NULL)) > 0) THEN ((count(r.id) FILTER (WHERE (r.state = 'positive_reply'::public.outreach_recipient_state)))::numeric / (count(r.id) FILTER (WHERE (r.sent_at IS NOT NULL)))::numeric)
            ELSE NULL::numeric
        END AS positive_reply_rate,
        CASE
            WHEN (count(r.id) FILTER (WHERE (r.sent_at IS NOT NULL)) > 0) THEN ((count(r.id) FILTER (WHERE (r.state = ANY (ARRAY['activated'::public.outreach_recipient_state, 'paid'::public.outreach_recipient_state]))))::numeric / (count(r.id) FILTER (WHERE (r.sent_at IS NOT NULL)))::numeric)
            ELSE NULL::numeric
        END AS activation_rate,
        CASE
            WHEN (count(r.id) FILTER (WHERE (r.sent_at IS NOT NULL)) > 0) THEN ((count(r.id) FILTER (WHERE (r.state = 'paid'::public.outreach_recipient_state)))::numeric / (count(r.id) FILTER (WHERE (r.sent_at IS NOT NULL)))::numeric)
            ELSE NULL::numeric
        END AS paid_rate
   FROM ((public.outreach_templates t
     LEFT JOIN public.outreach_recipients r ON ((r.template_id = t.id)))
     LEFT JOIN public.booking_providers bp ON ((bp.id = t.booking_provider_id)))
  GROUP BY t.id, t.key, t.name, t.locale, t.status, t.sales_angle, t.segment_key, bp.key;


--
-- Name: VIEW template_performance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.template_performance IS 'Per-template funnel through to paid. Rates are NULL when nothing has been sent — never 0 — so an untested template is visibly untested rather than apparently failing (spec §41).';


--
-- Name: time_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid,
    barber_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT time_blocks_reason_length CHECK (((reason IS NULL) OR (char_length(reason) <= 200))),
    CONSTRAINT time_blocks_time_order CHECK ((ends_at > starts_at))
);

ALTER TABLE ONLY public.time_blocks FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE time_blocks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.time_blocks IS 'Time a professional is unavailable for reasons that are not an appointment: lunch, a break, a meeting, an errand. Deliberately NOT modelled as an appointment — placeholder appointments would put fake customers into the CRM, into counts and into booking history. Blocks may overlap each other, so unlike appointments there is no exclusion constraint.';


--
-- Name: COLUMN time_blocks.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.time_blocks.reason IS 'Shown to staff on the calendar. Never shown to a customer — the public booking surface only learns that the time is unavailable, not why.';


--
-- Name: waitlist_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waitlist_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    customer_id uuid,
    customer_name text NOT NULL,
    customer_phone text,
    customer_email text,
    desired_service_id uuid,
    desired_barber_id uuid,
    notes text,
    status public.waitlist_status DEFAULT 'waiting'::public.waitlist_status NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT waitlist_entries_customer_name_not_blank CHECK ((btrim(customer_name) <> ''::text))
);

ALTER TABLE ONLY public.waitlist_entries FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE waitlist_entries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.waitlist_entries IS 'A customer waiting for a future opening — not someone physically present (see queue_entries) or already booked (see appointments). Staff-managed; no public join flow yet.';


--
-- Name: whatsapp_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    waba_id text NOT NULL,
    phone_number_id text NOT NULL,
    display_phone_number text,
    access_token_env_var text DEFAULT 'META_WHATSAPP_ACCESS_TOKEN'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    provider_mode text DEFAULT 'mock'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_accounts_access_token_env_var_check CHECK ((access_token_env_var ~ '^[A-Z][A-Z0-9_]*$'::text)),
    CONSTRAINT whatsapp_accounts_label_check CHECK ((btrim(label) <> ''::text)),
    CONSTRAINT whatsapp_accounts_provider_mode_check CHECK ((provider_mode = ANY (ARRAY['mock'::text, 'live'::text])))
);

ALTER TABLE ONLY public.whatsapp_accounts FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE whatsapp_accounts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_accounts IS 'Non-secret WhatsApp Cloud API routing config. Access tokens, the app secret and the webhook verify token are environment-only and MUST NEVER be stored in this table — access_token_env_var names the variable, never its value.';


--
-- Name: COLUMN whatsapp_accounts.provider_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_accounts.provider_mode IS '''mock'' (default) routes every send to the in-process mock provider — no network call to Meta. ''live'' requires the named env var to be present in the Worker environment.';


--
-- Name: whatsapp_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    whatsapp_account_id uuid NOT NULL,
    prospect_id uuid,
    contact_wa_id text NOT NULL,
    last_inbound_at timestamp with time zone,
    last_outbound_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.whatsapp_conversations FORCE ROW LEVEL SECURITY;


--
-- Name: whatsapp_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    whatsapp_account_id uuid NOT NULL,
    conversation_id uuid,
    recipient_id uuid,
    prospect_id uuid,
    direction public.whatsapp_message_direction NOT NULL,
    status public.whatsapp_message_status DEFAULT 'pending'::public.whatsapp_message_status NOT NULL,
    provider_message_id text,
    idempotency_key text,
    to_phone_e164 text,
    from_phone_e164 text,
    template_id uuid,
    meta_template_name text,
    meta_template_language text,
    body text,
    error_code text,
    error_message text,
    attempts integer DEFAULT 0 NOT NULL,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    failed_at timestamp with time zone,
    received_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_messages_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT whatsapp_messages_body_check CHECK (((body IS NULL) OR (length(body) <= 8000)))
);

ALTER TABLE ONLY public.whatsapp_messages FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE whatsapp_messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_messages IS 'Every WhatsApp message in or out. idempotency_key is computed before the send and is UNIQUE — a retried send after a timeout collides instead of duplicating (spec §60).';


--
-- Name: whatsapp_template_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_template_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    whatsapp_account_id uuid NOT NULL,
    template_id uuid NOT NULL,
    meta_template_name text NOT NULL,
    meta_template_language text NOT NULL,
    variable_order text[] DEFAULT '{}'::text[] NOT NULL,
    approval_state text DEFAULT 'unknown'::text NOT NULL,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_template_mappings_approval_state_check CHECK ((approval_state = ANY (ARRAY['unknown'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'paused'::text, 'disabled'::text]))),
    CONSTRAINT whatsapp_template_mappings_meta_template_name_check CHECK ((meta_template_name ~ '^[a-z0-9_]+$'::text))
);

ALTER TABLE ONLY public.whatsapp_template_mappings FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE whatsapp_template_mappings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_template_mappings IS 'Bridges an approved FadeUp template to its Meta-approved WhatsApp template. variable_order maps FadeUp variable names onto Meta''s positional {{1}}..{{n}} body parameters.';


--
-- Name: whatsapp_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    whatsapp_account_id uuid,
    provider_event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    signature_valid boolean DEFAULT false NOT NULL,
    processed boolean DEFAULT false NOT NULL,
    processed_at timestamp with time zone,
    processing_error text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.whatsapp_webhook_events FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE whatsapp_webhook_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_webhook_events IS 'Raw inbound webhook envelopes. UNIQUE provider_event_id makes redelivery idempotent; signature_valid records the X-Hub-Signature-256 verification result — an unverified event is stored for forensics but never processed.';


--
-- Name: analytics_event_definitions analytics_event_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_definitions
    ADD CONSTRAINT analytics_event_definitions_pkey PRIMARY KEY (event_name);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: analytics_ingestion_rejections analytics_ingestion_rejections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_ingestion_rejections
    ADD CONSTRAINT analytics_ingestion_rejections_pkey PRIMARY KEY (id);


--
-- Name: api_source_health api_source_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_source_health
    ADD CONSTRAINT api_source_health_pkey PRIMARY KEY (id);


--
-- Name: api_source_health api_source_health_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_source_health
    ADD CONSTRAINT api_source_health_source_id_key UNIQUE (source_id);


--
-- Name: api_source_limits api_source_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_source_limits
    ADD CONSTRAINT api_source_limits_pkey PRIMARY KEY (id);


--
-- Name: api_source_limits api_source_limits_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_source_limits
    ADD CONSTRAINT api_source_limits_source_id_key UNIQUE (source_id);


--
-- Name: api_usage api_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage
    ADD CONSTRAINT api_usage_pkey PRIMARY KEY (id);


--
-- Name: appointment_claim_tokens appointment_claim_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_claim_tokens
    ADD CONSTRAINT appointment_claim_tokens_pkey PRIMARY KEY (id);


--
-- Name: appointment_claim_tokens appointment_claim_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_claim_tokens
    ADD CONSTRAINT appointment_claim_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: appointments appointments_barber_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_barber_no_overlap EXCLUDE USING gist (barber_id WITH =, blocked_range WITH &&) WHERE ((status <> ALL (ARRAY['cancelled'::public.appointment_status, 'no_show'::public.appointment_status])));


--
-- Name: appointments appointments_chair_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_chair_no_overlap EXCLUDE USING gist (chair_id WITH =, blocked_range WITH &&) WHERE ((status <> ALL (ARRAY['cancelled'::public.appointment_status, 'no_show'::public.appointment_status])));


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: barber_availability_exceptions barber_availability_exceptions_barber_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_availability_exceptions
    ADD CONSTRAINT barber_availability_exceptions_barber_date_unique UNIQUE (barber_id, exception_date);


--
-- Name: barber_availability_exceptions barber_availability_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_availability_exceptions
    ADD CONSTRAINT barber_availability_exceptions_pkey PRIMARY KEY (id);


--
-- Name: barber_services barber_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_services
    ADD CONSTRAINT barber_services_pkey PRIMARY KEY (barber_id, service_id);


--
-- Name: barber_working_hours barber_working_hours_barber_day_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_working_hours
    ADD CONSTRAINT barber_working_hours_barber_day_unique UNIQUE (barber_id, day_of_week);


--
-- Name: barber_working_hours barber_working_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_working_hours
    ADD CONSTRAINT barber_working_hours_pkey PRIMARY KEY (id);


--
-- Name: barbers barbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barbers
    ADD CONSTRAINT barbers_pkey PRIMARY KEY (id);


--
-- Name: barbers barbers_staff_profile_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barbers
    ADD CONSTRAINT barbers_staff_profile_unique UNIQUE (staff_profile_id);


--
-- Name: booking_provider_observations booking_provider_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_provider_observations
    ADD CONSTRAINT booking_provider_observations_pkey PRIMARY KEY (id);


--
-- Name: booking_providers booking_providers_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_providers
    ADD CONSTRAINT booking_providers_key_key UNIQUE (key);


--
-- Name: booking_providers booking_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_providers
    ADD CONSTRAINT booking_providers_pkey PRIMARY KEY (id);


--
-- Name: chairs chairs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chairs
    ADD CONSTRAINT chairs_pkey PRIMARY KEY (id);


--
-- Name: commercial_capabilities commercial_capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_capabilities
    ADD CONSTRAINT commercial_capabilities_pkey PRIMARY KEY (capability_key);


--
-- Name: commercial_plan_changes commercial_plan_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_plan_changes
    ADD CONSTRAINT commercial_plan_changes_pkey PRIMARY KEY (id);


--
-- Name: commercial_plans commercial_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_plans
    ADD CONSTRAINT commercial_plans_pkey PRIMARY KEY (plan_key);


--
-- Name: customer_favorites customer_favorites_new_rows_shop_only; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.customer_favorites
    ADD CONSTRAINT customer_favorites_new_rows_shop_only CHECK ((barber_id IS NULL)) NOT VALID;


--
-- Name: CONSTRAINT customer_favorites_new_rows_shop_only ON customer_favorites; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT customer_favorites_new_rows_shop_only ON public.customer_favorites IS 'V2 boundary: new favorites are shop bookmarks only. Historical barber favorites remain readable/removable for compatibility but cannot be recreated. Professionals use professional_follows.';


--
-- Name: customer_favorites customer_favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_favorites
    ADD CONSTRAINT customer_favorites_pkey PRIMARY KEY (id);


--
-- Name: customer_memberships customer_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_memberships
    ADD CONSTRAINT customer_memberships_pkey PRIMARY KEY (id);


--
-- Name: customer_passport_photos customer_passport_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_passport_photos
    ADD CONSTRAINT customer_passport_photos_pkey PRIMARY KEY (id);


--
-- Name: customer_passport_photos customer_passport_photos_storage_path_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_passport_photos
    ADD CONSTRAINT customer_passport_photos_storage_path_unique UNIQUE (storage_path);


--
-- Name: customer_passport_shares customer_passport_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_passport_shares
    ADD CONSTRAINT customer_passport_shares_pkey PRIMARY KEY (id);


--
-- Name: customer_passport_shares customer_passport_shares_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_passport_shares
    ADD CONSTRAINT customer_passport_shares_token_hash_key UNIQUE (token_hash);


--
-- Name: customer_passports customer_passports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_passports
    ADD CONSTRAINT customer_passports_pkey PRIMARY KEY (id);


--
-- Name: customer_passports customer_passports_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_passports
    ADD CONSTRAINT customer_passports_user_id_key UNIQUE (user_id);


--
-- Name: customer_professional_relationships customer_professional_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_professional_relationships
    ADD CONSTRAINT customer_professional_relationships_pkey PRIMARY KEY (id);


--
-- Name: customer_professional_relationships customer_professional_relationships_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_professional_relationships
    ADD CONSTRAINT customer_professional_relationships_unique UNIQUE (customer_user_id, professional_id, organization_id);


--
-- Name: customer_profiles customer_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_pkey PRIMARY KEY (id);


--
-- Name: customer_profiles customer_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_user_id_key UNIQUE (user_id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: email_outbox email_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_outbox
    ADD CONSTRAINT email_outbox_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_key UNIQUE (token);


--
-- Name: location_hours location_hours_location_day_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_hours
    ADD CONSTRAINT location_hours_location_day_unique UNIQUE (location_id, day_of_week);


--
-- Name: location_hours location_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_hours
    ADD CONSTRAINT location_hours_pkey PRIMARY KEY (id);


--
-- Name: location_service_settings location_service_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_service_settings
    ADD CONSTRAINT location_service_settings_pkey PRIMARY KEY (location_id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: membership_plans membership_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_plans
    ADD CONSTRAINT membership_plans_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_org_user_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_org_user_unique UNIQUE (organization_id, user_id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


--
-- Name: ml_datasets ml_datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_datasets
    ADD CONSTRAINT ml_datasets_pkey PRIMARY KEY (id);


--
-- Name: ml_datasets ml_datasets_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_datasets
    ADD CONSTRAINT ml_datasets_version_key UNIQUE (version);


--
-- Name: ml_feature_schemas ml_feature_schemas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_feature_schemas
    ADD CONSTRAINT ml_feature_schemas_pkey PRIMARY KEY (id);


--
-- Name: ml_feature_schemas ml_feature_schemas_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_feature_schemas
    ADD CONSTRAINT ml_feature_schemas_version_key UNIQUE (version);


--
-- Name: ml_metrics ml_metrics_model_version_id_metric_key_split_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_metrics
    ADD CONSTRAINT ml_metrics_model_version_id_metric_key_split_key UNIQUE (model_version_id, metric_key, split);


--
-- Name: ml_metrics ml_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_metrics
    ADD CONSTRAINT ml_metrics_pkey PRIMARY KEY (id);


--
-- Name: ml_model_versions ml_model_versions_model_key_model_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_model_versions
    ADD CONSTRAINT ml_model_versions_model_key_model_version_key UNIQUE (model_key, model_version);


--
-- Name: ml_model_versions ml_model_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_model_versions
    ADD CONSTRAINT ml_model_versions_pkey PRIMARY KEY (id);


--
-- Name: ml_predictions ml_predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_predictions
    ADD CONSTRAINT ml_predictions_pkey PRIMARY KEY (id);


--
-- Name: ml_training_runs ml_training_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_training_runs
    ADD CONSTRAINT ml_training_runs_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: organization_commercial_state organization_commercial_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_commercial_state
    ADD CONSTRAINT organization_commercial_state_pkey PRIMARY KEY (organization_id);


--
-- Name: organization_dashboard_layouts organization_dashboard_layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_dashboard_layouts
    ADD CONSTRAINT organization_dashboard_layouts_pkey PRIMARY KEY (organization_id);


--
-- Name: organization_follows organization_follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_follows
    ADD CONSTRAINT organization_follows_pkey PRIMARY KEY (follower_user_id, organization_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: outreach_assignments outreach_assignments_experiment_id_prospect_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_assignments
    ADD CONSTRAINT outreach_assignments_experiment_id_prospect_id_key UNIQUE (experiment_id, prospect_id);


--
-- Name: outreach_assignments outreach_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_assignments
    ADD CONSTRAINT outreach_assignments_pkey PRIMARY KEY (id);


--
-- Name: outreach_campaigns outreach_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_campaigns
    ADD CONSTRAINT outreach_campaigns_pkey PRIMARY KEY (id);


--
-- Name: outreach_channel_policies outreach_channel_policies_channel_country_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_channel_policies
    ADD CONSTRAINT outreach_channel_policies_channel_country_key UNIQUE (channel, country);


--
-- Name: outreach_channel_policies outreach_channel_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_channel_policies
    ADD CONSTRAINT outreach_channel_policies_pkey PRIMARY KEY (id);


--
-- Name: outreach_events outreach_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_events
    ADD CONSTRAINT outreach_events_pkey PRIMARY KEY (id);


--
-- Name: outreach_experiment_arms outreach_experiment_arms_experiment_id_arm_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_experiment_arms
    ADD CONSTRAINT outreach_experiment_arms_experiment_id_arm_key_key UNIQUE (experiment_id, arm_key);


--
-- Name: outreach_experiment_arms outreach_experiment_arms_experiment_id_template_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_experiment_arms
    ADD CONSTRAINT outreach_experiment_arms_experiment_id_template_id_key UNIQUE (experiment_id, template_id);


--
-- Name: outreach_experiment_arms outreach_experiment_arms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_experiment_arms
    ADD CONSTRAINT outreach_experiment_arms_pkey PRIMARY KEY (id);


--
-- Name: outreach_experiments outreach_experiments_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_experiments
    ADD CONSTRAINT outreach_experiments_key_key UNIQUE (key);


--
-- Name: outreach_experiments outreach_experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_experiments
    ADD CONSTRAINT outreach_experiments_pkey PRIMARY KEY (id);


--
-- Name: outreach_recipients outreach_recipients_campaign_id_prospect_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_recipients
    ADD CONSTRAINT outreach_recipients_campaign_id_prospect_id_key UNIQUE (campaign_id, prospect_id);


--
-- Name: outreach_recipients outreach_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_recipients
    ADD CONSTRAINT outreach_recipients_pkey PRIMARY KEY (id);


--
-- Name: outreach_sales_angles outreach_sales_angles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_sales_angles
    ADD CONSTRAINT outreach_sales_angles_pkey PRIMARY KEY (key);


--
-- Name: outreach_templates outreach_templates_key_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_templates
    ADD CONSTRAINT outreach_templates_key_version_key UNIQUE (key, version);


--
-- Name: outreach_templates outreach_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_templates
    ADD CONSTRAINT outreach_templates_pkey PRIMARY KEY (id);


--
-- Name: plan_capabilities plan_capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_capabilities
    ADD CONSTRAINT plan_capabilities_pkey PRIMARY KEY (plan_key, capability_key);


--
-- Name: platform_audit_log platform_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_audit_log
    ADD CONSTRAINT platform_audit_log_pkey PRIMARY KEY (id);


--
-- Name: platform_invitations platform_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_invitations
    ADD CONSTRAINT platform_invitations_pkey PRIMARY KEY (id);


--
-- Name: platform_invitations platform_invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_invitations
    ADD CONSTRAINT platform_invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: platform_members platform_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_members
    ADD CONSTRAINT platform_members_pkey PRIMARY KEY (user_id);


--
-- Name: platform_notifications platform_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_notifications
    ADD CONSTRAINT platform_notifications_pkey PRIMARY KEY (id);


--
-- Name: platform_owner_bootstrap_tokens platform_owner_bootstrap_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_owner_bootstrap_tokens
    ADD CONSTRAINT platform_owner_bootstrap_tokens_pkey PRIMARY KEY (id);


--
-- Name: platform_owner_bootstrap_tokens platform_owner_bootstrap_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_owner_bootstrap_tokens
    ADD CONSTRAINT platform_owner_bootstrap_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: platform_support_sessions platform_support_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_support_sessions
    ADD CONSTRAINT platform_support_sessions_pkey PRIMARY KEY (id);


--
-- Name: professional_applications professional_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_applications
    ADD CONSTRAINT professional_applications_pkey PRIMARY KEY (id);


--
-- Name: professional_claims professional_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_claims
    ADD CONSTRAINT professional_claims_pkey PRIMARY KEY (id);


--
-- Name: professional_follows professional_follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_follows
    ADD CONSTRAINT professional_follows_pkey PRIMARY KEY (id);


--
-- Name: professional_follows professional_follows_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_follows
    ADD CONSTRAINT professional_follows_unique UNIQUE (follower_user_id, professional_id);


--
-- Name: professionals professionals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professionals
    ADD CONSTRAINT professionals_pkey PRIMARY KEY (id);


--
-- Name: professionals professionals_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professionals
    ADD CONSTRAINT professionals_user_id_key UNIQUE (user_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: prospect_contacts prospect_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_contacts
    ADD CONSTRAINT prospect_contacts_pkey PRIMARY KEY (id);


--
-- Name: prospect_data_quality prospect_data_quality_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_data_quality
    ADD CONSTRAINT prospect_data_quality_pkey PRIMARY KEY (prospect_id);


--
-- Name: prospect_duplicates prospect_duplicates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_duplicates
    ADD CONSTRAINT prospect_duplicates_pkey PRIMARY KEY (id);


--
-- Name: prospect_events prospect_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_events
    ADD CONSTRAINT prospect_events_pkey PRIMARY KEY (id);


--
-- Name: prospect_features prospect_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_features
    ADD CONSTRAINT prospect_features_pkey PRIMARY KEY (id);


--
-- Name: prospect_fit_scores prospect_fit_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_fit_scores
    ADD CONSTRAINT prospect_fit_scores_pkey PRIMARY KEY (id);


--
-- Name: prospect_identity_matches prospect_identity_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_identity_matches
    ADD CONSTRAINT prospect_identity_matches_pkey PRIMARY KEY (id);


--
-- Name: prospect_job_sources prospect_job_sources_job_id_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_job_sources
    ADD CONSTRAINT prospect_job_sources_job_id_source_id_key UNIQUE (job_id, source_id);


--
-- Name: prospect_job_sources prospect_job_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_job_sources
    ADD CONSTRAINT prospect_job_sources_pkey PRIMARY KEY (id);


--
-- Name: prospect_jobs prospect_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_jobs
    ADD CONSTRAINT prospect_jobs_pkey PRIMARY KEY (id);


--
-- Name: prospect_locales prospect_locales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_locales
    ADD CONSTRAINT prospect_locales_pkey PRIMARY KEY (prospect_id);


--
-- Name: prospect_locations prospect_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_locations
    ADD CONSTRAINT prospect_locations_pkey PRIMARY KEY (id);


--
-- Name: prospect_notes prospect_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_notes
    ADD CONSTRAINT prospect_notes_pkey PRIMARY KEY (id);


--
-- Name: prospect_outreach_eligibility prospect_outreach_eligibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_outreach_eligibility
    ADD CONSTRAINT prospect_outreach_eligibility_pkey PRIMARY KEY (id);


--
-- Name: prospect_outreach_eligibility prospect_outreach_eligibility_prospect_id_channel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_outreach_eligibility
    ADD CONSTRAINT prospect_outreach_eligibility_prospect_id_channel_key UNIQUE (prospect_id, channel);


--
-- Name: prospect_outreach prospect_outreach_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_outreach
    ADD CONSTRAINT prospect_outreach_pkey PRIMARY KEY (id);


--
-- Name: prospect_professionals prospect_professionals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_professionals
    ADD CONSTRAINT prospect_professionals_pkey PRIMARY KEY (id);


--
-- Name: prospect_professionals prospect_professionals_professional_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_professionals
    ADD CONSTRAINT prospect_professionals_professional_unique UNIQUE (professional_id);


--
-- Name: prospect_professionals prospect_professionals_prospect_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_professionals
    ADD CONSTRAINT prospect_professionals_prospect_unique UNIQUE (prospect_id);


--
-- Name: prospect_publication_eligibility prospect_publication_eligibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_publication_eligibility
    ADD CONSTRAINT prospect_publication_eligibility_pkey PRIMARY KEY (prospect_id);


--
-- Name: prospect_score_rulesets prospect_score_rulesets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_score_rulesets
    ADD CONSTRAINT prospect_score_rulesets_pkey PRIMARY KEY (id);


--
-- Name: prospect_score_rulesets prospect_score_rulesets_score_kind_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_score_rulesets
    ADD CONSTRAINT prospect_score_rulesets_score_kind_version_key UNIQUE (score_kind, version);


--
-- Name: prospect_scores prospect_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_scores
    ADD CONSTRAINT prospect_scores_pkey PRIMARY KEY (id);


--
-- Name: prospect_search_partitions prospect_search_partitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_search_partitions
    ADD CONSTRAINT prospect_search_partitions_pkey PRIMARY KEY (id);


--
-- Name: prospect_searches prospect_searches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_searches
    ADD CONSTRAINT prospect_searches_pkey PRIMARY KEY (id);


--
-- Name: prospect_segment_definitions prospect_segment_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_segment_definitions
    ADD CONSTRAINT prospect_segment_definitions_pkey PRIMARY KEY (key);


--
-- Name: prospect_segments prospect_segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_segments
    ADD CONSTRAINT prospect_segments_pkey PRIMARY KEY (id);


--
-- Name: prospect_segments prospect_segments_prospect_id_segment_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_segments
    ADD CONSTRAINT prospect_segments_prospect_id_segment_key_key UNIQUE (prospect_id, segment_key);


--
-- Name: prospect_social_profiles prospect_social_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_social_profiles
    ADD CONSTRAINT prospect_social_profiles_pkey PRIMARY KEY (id);


--
-- Name: prospect_source_records prospect_source_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_source_records
    ADD CONSTRAINT prospect_source_records_pkey PRIMARY KEY (id);


--
-- Name: prospect_sources prospect_sources_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_sources
    ADD CONSTRAINT prospect_sources_key_key UNIQUE (key);


--
-- Name: prospect_sources prospect_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_sources
    ADD CONSTRAINT prospect_sources_pkey PRIMARY KEY (id);


--
-- Name: prospect_suppressions prospect_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_suppressions
    ADD CONSTRAINT prospect_suppressions_pkey PRIMARY KEY (id);


--
-- Name: prospect_tags prospect_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tags
    ADD CONSTRAINT prospect_tags_pkey PRIMARY KEY (id);


--
-- Name: prospect_tags prospect_tags_prospect_id_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tags
    ADD CONSTRAINT prospect_tags_prospect_id_tag_key UNIQUE (prospect_id, tag);


--
-- Name: prospects prospects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_pkey PRIMARY KEY (id);


--
-- Name: queue_entries queue_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_pkey PRIMARY KEY (id);


--
-- Name: service_categories service_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);


--
-- Name: service_locations service_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_locations
    ADD CONSTRAINT service_locations_pkey PRIMARY KEY (service_id, location_id);


--
-- Name: service_mode_changes service_mode_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_mode_changes
    ADD CONSTRAINT service_mode_changes_pkey PRIMARY KEY (id);


--
-- Name: service_mode_overrides service_mode_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_mode_overrides
    ADD CONSTRAINT service_mode_overrides_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: staff_profiles staff_profiles_org_user_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_org_user_unique UNIQUE (organization_id, user_id);


--
-- Name: staff_profiles staff_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_pkey PRIMARY KEY (id);


--
-- Name: time_blocks time_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_blocks
    ADD CONSTRAINT time_blocks_pkey PRIMARY KEY (id);


--
-- Name: waitlist_entries waitlist_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_accounts whatsapp_accounts_phone_number_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_accounts
    ADD CONSTRAINT whatsapp_accounts_phone_number_id_key UNIQUE (phone_number_id);


--
-- Name: whatsapp_accounts whatsapp_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_accounts
    ADD CONSTRAINT whatsapp_accounts_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_conversations whatsapp_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_conversations whatsapp_conversations_whatsapp_account_id_contact_wa_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_whatsapp_account_id_contact_wa_id_key UNIQUE (whatsapp_account_id, contact_wa_id);


--
-- Name: whatsapp_messages whatsapp_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_template_mappings whatsapp_template_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_template_mappings
    ADD CONSTRAINT whatsapp_template_mappings_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_template_mappings whatsapp_template_mappings_whatsapp_account_id_meta_templat_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_template_mappings
    ADD CONSTRAINT whatsapp_template_mappings_whatsapp_account_id_meta_templat_key UNIQUE (whatsapp_account_id, meta_template_name, meta_template_language);


--
-- Name: whatsapp_template_mappings whatsapp_template_mappings_whatsapp_account_id_template_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_template_mappings
    ADD CONSTRAINT whatsapp_template_mappings_whatsapp_account_id_template_id_key UNIQUE (whatsapp_account_id, template_id);


--
-- Name: whatsapp_webhook_events whatsapp_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_webhook_events
    ADD CONSTRAINT whatsapp_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: analytics_event_definitions_family_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_definitions_family_idx ON public.analytics_event_definitions USING btree (family, event_name);


--
-- Name: analytics_event_definitions_wired_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_definitions_wired_idx ON public.analytics_event_definitions USING btree (emission, event_name) WHERE (status = 'wired'::public.analytics_event_status);


--
-- Name: analytics_events_actor_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_actor_time_idx ON public.analytics_events USING btree (actor_user_id, occurred_at DESC) WHERE (actor_user_id IS NOT NULL);


--
-- Name: analytics_events_dedupe_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX analytics_events_dedupe_key_unique ON public.analytics_events USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: analytics_events_name_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_name_time_idx ON public.analytics_events USING btree (event_name, occurred_at DESC);


--
-- Name: analytics_events_occurred_at_brin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_occurred_at_brin ON public.analytics_events USING brin (occurred_at);


--
-- Name: analytics_events_org_name_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_org_name_time_idx ON public.analytics_events USING btree (organization_id, event_name, occurred_at DESC) WHERE (organization_id IS NOT NULL);


--
-- Name: analytics_events_professional_name_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_professional_name_time_idx ON public.analytics_events USING btree (professional_id, event_name, occurred_at DESC) WHERE (professional_id IS NOT NULL);


--
-- Name: analytics_ingestion_rejections_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_ingestion_rejections_recent_idx ON public.analytics_ingestion_rejections USING btree (occurred_at DESC);


--
-- Name: api_usage_source_id_requested_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_usage_source_id_requested_at_idx ON public.api_usage USING btree (source_id, requested_at DESC);


--
-- Name: appointment_claim_tokens_appointment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_claim_tokens_appointment_id_idx ON public.appointment_claim_tokens USING btree (appointment_id);


--
-- Name: appointments_barber_customer_completed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_barber_customer_completed_idx ON public.appointments USING btree (barber_id, customer_id) WHERE (status = 'completed'::public.appointment_status);


--
-- Name: appointments_barber_id_starts_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_barber_id_starts_at_idx ON public.appointments USING btree (barber_id, starts_at);


--
-- Name: appointments_booked_by_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_booked_by_user_id_idx ON public.appointments USING btree (booked_by_user_id) WHERE (booked_by_user_id IS NOT NULL);


--
-- Name: appointments_chair_id_starts_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_chair_id_starts_at_idx ON public.appointments USING btree (chair_id, starts_at) WHERE (chair_id IS NOT NULL);


--
-- Name: appointments_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_customer_id_idx ON public.appointments USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: appointments_expiring_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_expiring_idx ON public.appointments USING btree (expires_at) WHERE (status = 'pending'::public.appointment_status);


--
-- Name: appointments_location_id_starts_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_location_id_starts_at_idx ON public.appointments USING btree (location_id, starts_at);


--
-- Name: appointments_org_starts_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_org_starts_at_idx ON public.appointments USING btree (organization_id, starts_at);


--
-- Name: appointments_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_organization_id_idx ON public.appointments USING btree (organization_id);


--
-- Name: appointments_pending_requests_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_pending_requests_idx ON public.appointments USING btree (organization_id, expires_at) WHERE (status = 'pending'::public.appointment_status);


--
-- Name: appointments_service_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_service_id_idx ON public.appointments USING btree (service_id);


--
-- Name: audit_logs_actor_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_actor_user_id_idx ON public.audit_logs USING btree (actor_user_id);


--
-- Name: audit_logs_org_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_org_created_at_idx ON public.audit_logs USING btree (organization_id, created_at DESC);


--
-- Name: audit_logs_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_organization_id_idx ON public.audit_logs USING btree (organization_id);


--
-- Name: barber_availability_exceptions_barber_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX barber_availability_exceptions_barber_id_idx ON public.barber_availability_exceptions USING btree (barber_id);


--
-- Name: barber_availability_exceptions_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX barber_availability_exceptions_organization_id_idx ON public.barber_availability_exceptions USING btree (organization_id);


--
-- Name: barber_services_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX barber_services_organization_id_idx ON public.barber_services USING btree (organization_id);


--
-- Name: barber_services_service_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX barber_services_service_id_idx ON public.barber_services USING btree (service_id);


--
-- Name: barber_working_hours_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX barber_working_hours_organization_id_idx ON public.barber_working_hours USING btree (organization_id);


--
-- Name: barbers_is_bookable_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX barbers_is_bookable_idx ON public.barbers USING btree (is_bookable) WHERE is_bookable;


--
-- Name: barbers_org_professional_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX barbers_org_professional_unique ON public.barbers USING btree (organization_id, professional_id) WHERE (professional_id IS NOT NULL);


--
-- Name: barbers_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX barbers_organization_id_idx ON public.barbers USING btree (organization_id);


--
-- Name: barbers_professional_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX barbers_professional_id_idx ON public.barbers USING btree (professional_id) WHERE (professional_id IS NOT NULL);


--
-- Name: barbers_service_mode_override_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX barbers_service_mode_override_idx ON public.barbers USING btree (service_mode_override) WHERE (service_mode_override IS NOT NULL);


--
-- Name: booking_provider_observations_one_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX booking_provider_observations_one_current ON public.booking_provider_observations USING btree (prospect_id, provider_id) WHERE is_current;


--
-- Name: booking_provider_observations_prospect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_provider_observations_prospect_idx ON public.booking_provider_observations USING btree (prospect_id, observed_at DESC);


--
-- Name: booking_provider_observations_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_provider_observations_provider_idx ON public.booking_provider_observations USING btree (provider_id, observed_at DESC);


--
-- Name: booking_provider_observations_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_provider_observations_status_idx ON public.booking_provider_observations USING btree (provider_id, booking_status) WHERE is_current;


--
-- Name: booking_providers_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_providers_active_idx ON public.booking_providers USING btree (is_active) WHERE is_active;


--
-- Name: chairs_location_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chairs_location_id_idx ON public.chairs USING btree (location_id);


--
-- Name: chairs_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chairs_organization_id_idx ON public.chairs USING btree (organization_id);


--
-- Name: commercial_plan_changes_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commercial_plan_changes_organization_idx ON public.commercial_plan_changes USING btree (organization_id, created_at DESC);


--
-- Name: commercial_plans_family_tier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commercial_plans_family_tier_idx ON public.commercial_plans USING btree (commercial_family, tier);


--
-- Name: customer_favorites_barber_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_favorites_barber_unique ON public.customer_favorites USING btree (user_id, barber_id) WHERE (barber_id IS NOT NULL);


--
-- Name: customer_favorites_shop_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_favorites_shop_unique ON public.customer_favorites USING btree (user_id, organization_id) WHERE (barber_id IS NULL);


--
-- Name: customer_favorites_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_favorites_user_id_idx ON public.customer_favorites USING btree (user_id);


--
-- Name: customer_memberships_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_memberships_customer_id_idx ON public.customer_memberships USING btree (customer_id);


--
-- Name: customer_memberships_one_open_per_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_memberships_one_open_per_customer ON public.customer_memberships USING btree (customer_id) WHERE (status = ANY (ARRAY['active'::public.customer_membership_status, 'paused'::public.customer_membership_status]));


--
-- Name: customer_memberships_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_memberships_organization_id_idx ON public.customer_memberships USING btree (organization_id);


--
-- Name: customer_memberships_plan_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_memberships_plan_id_idx ON public.customer_memberships USING btree (plan_id);


--
-- Name: customer_passport_photos_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_passport_photos_user_id_idx ON public.customer_passport_photos USING btree (user_id);


--
-- Name: customer_passport_shares_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_passport_shares_user_id_idx ON public.customer_passport_shares USING btree (user_id);


--
-- Name: customer_passports_passport_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_passports_passport_number_unique ON public.customer_passports USING btree (passport_number) WHERE (passport_number IS NOT NULL);


--
-- Name: customer_professional_relationships_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_professional_relationships_customer_idx ON public.customer_professional_relationships USING btree (customer_user_id);


--
-- Name: customer_professional_relationships_org_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_professional_relationships_org_recent_idx ON public.customer_professional_relationships USING btree (organization_id, last_completed_at DESC);


--
-- Name: customer_professional_relationships_professional_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_professional_relationships_professional_idx ON public.customer_professional_relationships USING btree (professional_id);


--
-- Name: customer_profiles_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_profiles_user_id_idx ON public.customer_profiles USING btree (user_id);


--
-- Name: customers_org_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_org_email_unique ON public.customers USING btree (organization_id, lower(email)) WHERE (email IS NOT NULL);


--
-- Name: customers_org_phone_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_org_phone_unique ON public.customers USING btree (organization_id, phone) WHERE (phone IS NOT NULL);


--
-- Name: customers_org_user_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_org_user_unique ON public.customers USING btree (organization_id, user_id) WHERE (user_id IS NOT NULL);


--
-- Name: customers_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_organization_id_idx ON public.customers USING btree (organization_id);


--
-- Name: customers_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_user_id_idx ON public.customers USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: email_outbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_outbox_pending_idx ON public.email_outbox USING btree (next_attempt_at) WHERE (status = 'queued'::public.email_delivery_status);


--
-- Name: invitations_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_organization_id_idx ON public.invitations USING btree (organization_id);


--
-- Name: invitations_pending_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invitations_pending_unique ON public.invitations USING btree (organization_id, email) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: location_hours_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX location_hours_organization_id_idx ON public.location_hours USING btree (organization_id);


--
-- Name: location_service_settings_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX location_service_settings_organization_id_idx ON public.location_service_settings USING btree (organization_id);


--
-- Name: locations_marketplace_geo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX locations_marketplace_geo_idx ON public.locations USING gist (extensions.ll_to_earth(latitude, longitude)) WHERE ((latitude IS NOT NULL) AND (longitude IS NOT NULL) AND is_active);


--
-- Name: locations_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX locations_organization_id_idx ON public.locations USING btree (organization_id);


--
-- Name: locations_queue_check_in_token_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX locations_queue_check_in_token_unique ON public.locations USING btree (queue_check_in_token);


--
-- Name: locations_service_area_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX locations_service_area_idx ON public.locations USING btree (id) WHERE (kind = 'service_area'::public.location_kind);


--
-- Name: membership_plans_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX membership_plans_organization_id_idx ON public.membership_plans USING btree (organization_id);


--
-- Name: memberships_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memberships_organization_id_idx ON public.memberships USING btree (organization_id);


--
-- Name: memberships_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memberships_user_id_idx ON public.memberships USING btree (user_id);


--
-- Name: ml_model_versions_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ml_model_versions_one_active ON public.ml_model_versions USING btree (model_key, target) WHERE is_active;


--
-- Name: ml_predictions_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_predictions_model_idx ON public.ml_predictions USING btree (model_version_id);


--
-- Name: ml_predictions_prospect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_predictions_prospect_idx ON public.ml_predictions USING btree (prospect_id, predicted_at DESC);


--
-- Name: ml_predictions_selected_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_predictions_selected_idx ON public.ml_predictions USING btree (selected, predicted_at DESC) WHERE selected;


--
-- Name: notifications_dedupe_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notifications_dedupe_key_unique ON public.notifications USING btree (dedupe_key);


--
-- Name: notifications_user_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_recent_idx ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: notifications_user_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);


--
-- Name: organization_commercial_state_plan_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_commercial_state_plan_key_idx ON public.organization_commercial_state USING btree (plan_key);


--
-- Name: organization_commercial_state_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_commercial_state_status_idx ON public.organization_commercial_state USING btree (status);


--
-- Name: organization_follows_by_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_follows_by_organization_idx ON public.organization_follows USING btree (organization_id, is_following);


--
-- Name: organization_follows_by_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_follows_by_user_idx ON public.organization_follows USING btree (follower_user_id, is_following, followed_at DESC);


--
-- Name: organizations_marketplace_visible_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_marketplace_visible_idx ON public.organizations USING btree (marketplace_visible) WHERE marketplace_visible;


--
-- Name: outreach_assignments_arm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_assignments_arm_idx ON public.outreach_assignments USING btree (arm_id);


--
-- Name: outreach_assignments_prospect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_assignments_prospect_idx ON public.outreach_assignments USING btree (prospect_id);


--
-- Name: outreach_campaigns_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_campaigns_created_at_idx ON public.outreach_campaigns USING btree (created_at DESC);


--
-- Name: outreach_campaigns_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_campaigns_status_idx ON public.outreach_campaigns USING btree (status);


--
-- Name: outreach_events_prospect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_events_prospect_idx ON public.outreach_events USING btree (prospect_id, occurred_at DESC);


--
-- Name: outreach_events_provider_event_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outreach_events_provider_event_unique ON public.outreach_events USING btree (provider_event_id, event_type) WHERE (provider_event_id IS NOT NULL);


--
-- Name: outreach_events_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_events_recipient_idx ON public.outreach_events USING btree (recipient_id, occurred_at DESC);


--
-- Name: outreach_events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_events_type_idx ON public.outreach_events USING btree (event_type, occurred_at DESC);


--
-- Name: outreach_experiment_arms_one_control; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outreach_experiment_arms_one_control ON public.outreach_experiment_arms USING btree (experiment_id) WHERE is_control;


--
-- Name: outreach_recipients_campaign_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_recipients_campaign_state_idx ON public.outreach_recipients USING btree (campaign_id, state);


--
-- Name: outreach_recipients_prospect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_recipients_prospect_idx ON public.outreach_recipients USING btree (prospect_id);


--
-- Name: outreach_recipients_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_recipients_queue_idx ON public.outreach_recipients USING btree (campaign_id, queued_at) WHERE (state = 'queued'::public.outreach_recipient_state);


--
-- Name: outreach_recipients_template_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_recipients_template_idx ON public.outreach_recipients USING btree (template_id);


--
-- Name: outreach_templates_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_templates_provider_idx ON public.outreach_templates USING btree (booking_provider_id);


--
-- Name: outreach_templates_segment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_templates_segment_idx ON public.outreach_templates USING btree (segment_key);


--
-- Name: outreach_templates_selection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_templates_selection_idx ON public.outreach_templates USING btree (channel, locale, status) WHERE (status = 'approved'::public.outreach_template_status);


--
-- Name: plan_capabilities_capability_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_capabilities_capability_idx ON public.plan_capabilities USING btree (capability_key);


--
-- Name: platform_audit_log_actor_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_audit_log_actor_user_id_idx ON public.platform_audit_log USING btree (actor_user_id);


--
-- Name: platform_audit_log_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_audit_log_created_at_idx ON public.platform_audit_log USING btree (created_at DESC);


--
-- Name: platform_members_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_members_role_idx ON public.platform_members USING btree (role);


--
-- Name: platform_notifications_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_notifications_recipient_idx ON public.platform_notifications USING btree (recipient_user_id, created_at DESC);


--
-- Name: platform_notifications_recipient_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_notifications_recipient_unread_idx ON public.platform_notifications USING btree (recipient_user_id, created_at DESC) WHERE (read_at IS NULL);


--
-- Name: platform_owner_bootstrap_tokens_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX platform_owner_bootstrap_tokens_one_active ON public.platform_owner_bootstrap_tokens USING btree ((true)) WHERE ((claimed_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: platform_support_sessions_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_support_sessions_actor_idx ON public.platform_support_sessions USING btree (platform_actor_id, started_at DESC);


--
-- Name: platform_support_sessions_one_open_per_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX platform_support_sessions_one_open_per_actor ON public.platform_support_sessions USING btree (platform_actor_id) WHERE (ended_at IS NULL);


--
-- Name: platform_support_sessions_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_support_sessions_organization_id_idx ON public.platform_support_sessions USING btree (organization_id);


--
-- Name: professional_applications_one_live_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX professional_applications_one_live_per_user ON public.professional_applications USING btree (user_id) WHERE (status = ANY (ARRAY['pending_review'::public.professional_application_status, 'approved'::public.professional_application_status]));


--
-- Name: professional_applications_status_submitted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX professional_applications_status_submitted_idx ON public.professional_applications USING btree (status, submitted_at DESC);


--
-- Name: professional_applications_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX professional_applications_user_id_idx ON public.professional_applications USING btree (user_id);


--
-- Name: professional_claims_claimant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX professional_claims_claimant_idx ON public.professional_claims USING btree (claimant_user_id);


--
-- Name: professional_claims_one_approval; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX professional_claims_one_approval ON public.professional_claims USING btree (professional_id) WHERE (state = 'approved'::public.professional_claim_status);


--
-- Name: professional_claims_one_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX professional_claims_one_pending ON public.professional_claims USING btree (professional_id, claimant_user_id) WHERE (state = 'pending'::public.professional_claim_status);


--
-- Name: professional_claims_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX professional_claims_queue ON public.professional_claims USING btree (submitted_at) WHERE (state = 'pending'::public.professional_claim_status);


--
-- Name: professional_follows_follower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX professional_follows_follower_idx ON public.professional_follows USING btree (follower_user_id, followed_at DESC) WHERE (state = 'following'::public.follow_state);


--
-- Name: professional_follows_professional_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX professional_follows_professional_idx ON public.professional_follows USING btree (professional_id) WHERE (state = 'following'::public.follow_state);


--
-- Name: professionals_claim_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX professionals_claim_state_idx ON public.professionals USING btree (claim_state);


--
-- Name: professionals_handle_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX professionals_handle_unique ON public.professionals USING btree (lower(handle)) WHERE (handle IS NOT NULL);


--
-- Name: professionals_public_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX professionals_public_idx ON public.professionals USING btree (id) WHERE is_public;


--
-- Name: prospect_contacts_prospect_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_contacts_prospect_id_idx ON public.prospect_contacts USING btree (prospect_id);


--
-- Name: prospect_duplicates_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_duplicates_status_idx ON public.prospect_duplicates USING btree (status);


--
-- Name: prospect_duplicates_unique_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prospect_duplicates_unique_pair ON public.prospect_duplicates USING btree (LEAST(prospect_id, duplicate_of_prospect_id), GREATEST(prospect_id, duplicate_of_prospect_id));


--
-- Name: prospect_events_prospect_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_events_prospect_id_created_at_idx ON public.prospect_events USING btree (prospect_id, created_at DESC);


--
-- Name: prospect_features_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_features_key_idx ON public.prospect_features USING btree (feature_key, feature_version);


--
-- Name: prospect_features_prospect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_features_prospect_idx ON public.prospect_features USING btree (prospect_id);


--
-- Name: prospect_features_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prospect_features_unique ON public.prospect_features USING btree (prospect_id, feature_key, feature_version);


--
-- Name: prospect_fit_scores_kind_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_fit_scores_kind_score_idx ON public.prospect_fit_scores USING btree (score_kind, score DESC);


--
-- Name: prospect_fit_scores_one_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prospect_fit_scores_one_current ON public.prospect_fit_scores USING btree (prospect_id, score_kind) WHERE is_current;


--
-- Name: prospect_fit_scores_prospect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_fit_scores_prospect_idx ON public.prospect_fit_scores USING btree (prospect_id, score_kind, scored_at DESC);


--
-- Name: prospect_identity_matches_prospect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_identity_matches_prospect_idx ON public.prospect_identity_matches USING btree (prospect_id, decided_at DESC);


--
-- Name: prospect_identity_matches_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_identity_matches_state_idx ON public.prospect_identity_matches USING btree (state) WHERE (state = ANY (ARRAY['POSSIBLE_MATCH'::public.prospect_identity_match_state, 'REVIEW_REQUIRED'::public.prospect_identity_match_state]));


--
-- Name: prospect_job_sources_job_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_job_sources_job_id_idx ON public.prospect_job_sources USING btree (job_id);


--
-- Name: prospect_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_jobs_claim_idx ON public.prospect_jobs USING btree (priority DESC, scheduled_at) WHERE (status = ANY (ARRAY['queued'::public.prospect_job_status, 'retry'::public.prospect_job_status]));


--
-- Name: prospect_jobs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_jobs_created_at_idx ON public.prospect_jobs USING btree (created_at DESC);


--
-- Name: prospect_jobs_lease_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_jobs_lease_until_idx ON public.prospect_jobs USING btree (lease_until) WHERE (status = 'running'::public.prospect_job_status);


--
-- Name: prospect_jobs_search_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_jobs_search_id_idx ON public.prospect_jobs USING btree (search_id) WHERE (search_id IS NOT NULL);


--
-- Name: prospect_jobs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_jobs_status_idx ON public.prospect_jobs USING btree (status);


--
-- Name: prospect_locations_country_city_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_locations_country_city_idx ON public.prospect_locations USING btree (country, city);


--
-- Name: prospect_locations_geo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_locations_geo_idx ON public.prospect_locations USING gist (extensions.ll_to_earth(latitude, longitude)) WHERE ((latitude IS NOT NULL) AND (longitude IS NOT NULL));


--
-- Name: prospect_locations_one_primary_per_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prospect_locations_one_primary_per_prospect ON public.prospect_locations USING btree (prospect_id) WHERE is_primary;


--
-- Name: prospect_locations_prospect_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_locations_prospect_id_idx ON public.prospect_locations USING btree (prospect_id);


--
-- Name: prospect_notes_prospect_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_notes_prospect_id_idx ON public.prospect_notes USING btree (prospect_id, created_at DESC);


--
-- Name: prospect_outreach_eligibility_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_outreach_eligibility_channel_idx ON public.prospect_outreach_eligibility USING btree (channel, is_eligible);


--
-- Name: prospect_outreach_prospect_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_outreach_prospect_id_idx ON public.prospect_outreach USING btree (prospect_id, occurred_at DESC);


--
-- Name: prospect_professionals_professional_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_professionals_professional_idx ON public.prospect_professionals USING btree (professional_id);


--
-- Name: prospect_publication_eligibility_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_publication_eligibility_queue_idx ON public.prospect_publication_eligibility USING btree (evaluated_at) WHERE is_eligible;


--
-- Name: prospect_publication_eligibility_staleness_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_publication_eligibility_staleness_idx ON public.prospect_publication_eligibility USING btree (evaluated_at);


--
-- Name: prospect_score_rulesets_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prospect_score_rulesets_one_active ON public.prospect_score_rulesets USING btree (score_kind) WHERE is_active;


--
-- Name: prospect_scores_prospect_id_scored_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_scores_prospect_id_scored_at_idx ON public.prospect_scores USING btree (prospect_id, scored_at DESC);


--
-- Name: prospect_search_partitions_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_search_partitions_parent_idx ON public.prospect_search_partitions USING btree (parent_partition_id) WHERE (parent_partition_id IS NOT NULL);


--
-- Name: prospect_search_partitions_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_search_partitions_search_idx ON public.prospect_search_partitions USING btree (search_id, depth);


--
-- Name: prospect_search_partitions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_search_partitions_status_idx ON public.prospect_search_partitions USING btree (status);


--
-- Name: prospect_searches_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_searches_created_at_idx ON public.prospect_searches USING btree (created_at DESC);


--
-- Name: prospect_searches_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_searches_status_idx ON public.prospect_searches USING btree (status);


--
-- Name: prospect_segments_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_segments_key_idx ON public.prospect_segments USING btree (segment_key);


--
-- Name: prospect_segments_prospect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_segments_prospect_idx ON public.prospect_segments USING btree (prospect_id);


--
-- Name: prospect_social_profiles_prospect_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_social_profiles_prospect_id_idx ON public.prospect_social_profiles USING btree (prospect_id);


--
-- Name: prospect_social_profiles_unique_handle; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prospect_social_profiles_unique_handle ON public.prospect_social_profiles USING btree (prospect_id, platform, handle) WHERE (handle IS NOT NULL);


--
-- Name: prospect_source_records_job_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_source_records_job_id_idx ON public.prospect_source_records USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: prospect_source_records_prospect_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_source_records_prospect_id_idx ON public.prospect_source_records USING btree (prospect_id);


--
-- Name: prospect_source_records_unique_external; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prospect_source_records_unique_external ON public.prospect_source_records USING btree (source_id, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: prospect_suppressions_unique_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prospect_suppressions_unique_prospect ON public.prospect_suppressions USING btree (prospect_id) WHERE (scope = 'prospect'::public.prospect_suppression_scope);


--
-- Name: prospect_suppressions_unique_value; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prospect_suppressions_unique_value ON public.prospect_suppressions USING btree (scope, value) WHERE (value IS NOT NULL);


--
-- Name: prospect_tags_prospect_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospect_tags_prospect_id_idx ON public.prospect_tags USING btree (prospect_id);


--
-- Name: prospects_booking_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_booking_provider_idx ON public.prospects USING btree (current_booking_provider_id);


--
-- Name: prospects_canonical_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_canonical_name_trgm_idx ON public.prospects USING gin (canonical_name extensions.gin_trgm_ops);


--
-- Name: prospects_country_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_country_idx ON public.prospects USING btree (country);


--
-- Name: prospects_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_created_at_idx ON public.prospects USING btree (created_at DESC);


--
-- Name: prospects_do_not_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_do_not_contact_idx ON public.prospects USING btree (do_not_contact) WHERE do_not_contact;


--
-- Name: prospects_fadeup_fit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_fadeup_fit_idx ON public.prospects USING btree (fadeup_fit_score DESC NULLS LAST);


--
-- Name: prospects_migration_potential_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_migration_potential_idx ON public.prospects USING btree (migration_potential_score DESC NULLS LAST);


--
-- Name: prospects_parent_group_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_parent_group_id_idx ON public.prospects USING btree (parent_group_id) WHERE (parent_group_id IS NOT NULL);


--
-- Name: prospects_phone_e164_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_phone_e164_idx ON public.prospects USING btree (phone_e164) WHERE (phone_e164 IS NOT NULL);


--
-- Name: prospects_score_bucket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_score_bucket_idx ON public.prospects USING btree (current_score_bucket);


--
-- Name: prospects_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_status_idx ON public.prospects USING btree (status);


--
-- Name: prospects_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_type_idx ON public.prospects USING btree (type);


--
-- Name: prospects_website_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_website_domain_idx ON public.prospects USING btree (website_domain) WHERE (website_domain IS NOT NULL);


--
-- Name: queue_entries_barber_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_barber_id_idx ON public.queue_entries USING btree (barber_id) WHERE (barber_id IS NOT NULL);


--
-- Name: queue_entries_booked_by_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_booked_by_user_id_idx ON public.queue_entries USING btree (booked_by_user_id) WHERE (booked_by_user_id IS NOT NULL);


--
-- Name: queue_entries_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_customer_id_idx ON public.queue_entries USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: queue_entries_location_waiting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_location_waiting_idx ON public.queue_entries USING btree (location_id, created_at) WHERE (status = 'waiting'::public.queue_status);


--
-- Name: queue_entries_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX queue_entries_organization_id_idx ON public.queue_entries USING btree (organization_id);


--
-- Name: service_categories_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_categories_organization_id_idx ON public.service_categories USING btree (organization_id);


--
-- Name: service_locations_location_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_locations_location_id_idx ON public.service_locations USING btree (location_id);


--
-- Name: service_locations_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_locations_organization_id_idx ON public.service_locations USING btree (organization_id);


--
-- Name: service_mode_changes_barber_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_mode_changes_barber_idx ON public.service_mode_changes USING btree (barber_id, created_at DESC) WHERE (barber_id IS NOT NULL);


--
-- Name: service_mode_changes_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_mode_changes_location_idx ON public.service_mode_changes USING btree (location_id, created_at DESC);


--
-- Name: service_mode_changes_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_mode_changes_organization_idx ON public.service_mode_changes USING btree (organization_id, created_at DESC);


--
-- Name: service_mode_overrides_barber_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_mode_overrides_barber_active_idx ON public.service_mode_overrides USING btree (barber_id, starts_at DESC) WHERE ((cleared_at IS NULL) AND (scope = 'barber'::public.service_mode_scope));


--
-- Name: service_mode_overrides_location_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_mode_overrides_location_active_idx ON public.service_mode_overrides USING btree (location_id, starts_at DESC) WHERE ((cleared_at IS NULL) AND (scope = 'location'::public.service_mode_scope));


--
-- Name: service_mode_overrides_one_active_barber; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX service_mode_overrides_one_active_barber ON public.service_mode_overrides USING btree (barber_id) WHERE ((cleared_at IS NULL) AND (scope = 'barber'::public.service_mode_scope));


--
-- Name: service_mode_overrides_one_active_location; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX service_mode_overrides_one_active_location ON public.service_mode_overrides USING btree (location_id) WHERE ((cleared_at IS NULL) AND (scope = 'location'::public.service_mode_scope));


--
-- Name: service_mode_overrides_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_mode_overrides_organization_id_idx ON public.service_mode_overrides USING btree (organization_id);


--
-- Name: services_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX services_category_id_idx ON public.services USING btree (category_id);


--
-- Name: services_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX services_organization_id_idx ON public.services USING btree (organization_id);


--
-- Name: staff_profiles_location_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_profiles_location_id_idx ON public.staff_profiles USING btree (location_id);


--
-- Name: staff_profiles_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_profiles_organization_id_idx ON public.staff_profiles USING btree (organization_id);


--
-- Name: staff_profiles_public_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_profiles_public_active_idx ON public.staff_profiles USING btree (is_public, is_active) WHERE (is_public AND is_active);


--
-- Name: staff_profiles_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_profiles_user_id_idx ON public.staff_profiles USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: time_blocks_barber_range_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_blocks_barber_range_idx ON public.time_blocks USING btree (barber_id, starts_at, ends_at);


--
-- Name: time_blocks_organization_range_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_blocks_organization_range_idx ON public.time_blocks USING btree (organization_id, starts_at);


--
-- Name: waitlist_entries_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waitlist_entries_customer_id_idx ON public.waitlist_entries USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: waitlist_entries_location_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waitlist_entries_location_id_idx ON public.waitlist_entries USING btree (location_id);


--
-- Name: waitlist_entries_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waitlist_entries_organization_id_idx ON public.waitlist_entries USING btree (organization_id);


--
-- Name: whatsapp_messages_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX whatsapp_messages_idempotency_unique ON public.whatsapp_messages USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: whatsapp_messages_prospect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_messages_prospect_idx ON public.whatsapp_messages USING btree (prospect_id, created_at DESC);


--
-- Name: whatsapp_messages_provider_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX whatsapp_messages_provider_id_unique ON public.whatsapp_messages USING btree (provider_message_id) WHERE (provider_message_id IS NOT NULL);


--
-- Name: whatsapp_messages_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_messages_recipient_idx ON public.whatsapp_messages USING btree (recipient_id);


--
-- Name: whatsapp_messages_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_messages_status_idx ON public.whatsapp_messages USING btree (status, created_at DESC);


--
-- Name: whatsapp_webhook_events_provider_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX whatsapp_webhook_events_provider_unique ON public.whatsapp_webhook_events USING btree (provider_event_id);


--
-- Name: whatsapp_webhook_events_unprocessed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_webhook_events_unprocessed_idx ON public.whatsapp_webhook_events USING btree (received_at) WHERE (NOT processed);


--
-- Name: analytics_event_definitions analytics_event_definitions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER analytics_event_definitions_set_updated_at BEFORE UPDATE ON public.analytics_event_definitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: analytics_events analytics_events_reject_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER analytics_events_reject_delete BEFORE DELETE ON public.analytics_events FOR EACH ROW EXECUTE FUNCTION public.reject_analytics_event_mutation();


--
-- Name: analytics_events analytics_events_reject_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER analytics_events_reject_update BEFORE UPDATE ON public.analytics_events FOR EACH ROW EXECUTE FUNCTION public.reject_analytics_event_mutation();


--
-- Name: api_source_health api_source_health_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER api_source_health_set_updated_at BEFORE UPDATE ON public.api_source_health FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: api_source_limits api_source_limits_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER api_source_limits_set_updated_at BEFORE UPDATE ON public.api_source_limits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: appointments appointments_analytics_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_analytics_insert AFTER INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.analytics_appointment_event();


--
-- Name: appointments appointments_analytics_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_analytics_update AFTER UPDATE OF status ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.analytics_appointment_event();


--
-- Name: appointments appointments_auto_follow; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_auto_follow AFTER INSERT OR UPDATE OF status ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.appointments_auto_follow();


--
-- Name: appointments appointments_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_check_consistency BEFORE INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.check_appointment_consistency();


--
-- Name: appointments appointments_check_time_blocks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_check_time_blocks BEFORE INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.check_appointment_time_blocks();


--
-- Name: appointments appointments_enforce_service_mode; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_enforce_service_mode BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_service_mode();


--
-- Name: appointments appointments_enforce_transition; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_enforce_transition BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_transition();


--
-- Name: appointments appointments_link_customer; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_link_customer BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.link_customer_from_contact_info();


--
-- Name: appointments appointments_notify_new; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_notify_new AFTER INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.notify_new_appointment();


--
-- Name: appointments appointments_record_relationship; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_record_relationship AFTER INSERT OR UPDATE OF status ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.appointments_record_relationship();


--
-- Name: appointments appointments_restrict_self_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_restrict_self_update BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.restrict_appointment_self_update();


--
-- Name: appointments appointments_set_blocked_range; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_set_blocked_range BEFORE INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.set_appointment_blocked_range();


--
-- Name: appointments appointments_set_request_expiry; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_set_request_expiry BEFORE INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.set_appointment_request_expiry();


--
-- Name: appointments appointments_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: barber_availability_exceptions barber_availability_exceptions_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barber_availability_exceptions_check_consistency BEFORE INSERT OR UPDATE ON public.barber_availability_exceptions FOR EACH ROW EXECUTE FUNCTION public.check_barber_exception_barber_consistency();


--
-- Name: barber_availability_exceptions barber_availability_exceptions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barber_availability_exceptions_set_updated_at BEFORE UPDATE ON public.barber_availability_exceptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: barber_services barber_services_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barber_services_check_consistency BEFORE INSERT OR UPDATE ON public.barber_services FOR EACH ROW EXECUTE FUNCTION public.check_barber_service_consistency();


--
-- Name: barber_working_hours barber_working_hours_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barber_working_hours_check_consistency BEFORE INSERT OR UPDATE ON public.barber_working_hours FOR EACH ROW EXECUTE FUNCTION public.check_barber_working_hours_barber_consistency();


--
-- Name: barber_working_hours barber_working_hours_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barber_working_hours_set_updated_at BEFORE UPDATE ON public.barber_working_hours FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: barbers barbers_assign_professional; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barbers_assign_professional BEFORE INSERT ON public.barbers FOR EACH ROW EXECUTE FUNCTION public.assign_barber_professional();


--
-- Name: barbers barbers_check_staff_profile_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barbers_check_staff_profile_consistency BEFORE INSERT OR UPDATE ON public.barbers FOR EACH ROW EXECUTE FUNCTION public.check_barber_staff_profile_consistency();


--
-- Name: barbers barbers_enforce_professional_capacity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barbers_enforce_professional_capacity BEFORE INSERT OR UPDATE OF organization_id, staff_profile_id ON public.barbers FOR EACH ROW EXECUTE FUNCTION public.enforce_barber_capacity();


--
-- Name: barbers barbers_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barbers_set_updated_at BEFORE UPDATE ON public.barbers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: booking_provider_observations booking_provider_observations_maintain_current; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_provider_observations_maintain_current BEFORE INSERT ON public.booking_provider_observations FOR EACH ROW WHEN (new.is_current) EXECUTE FUNCTION private.booking_provider_observations_maintain_current();


--
-- Name: booking_provider_observations booking_provider_observations_sync_prospect; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_provider_observations_sync_prospect AFTER INSERT OR DELETE OR UPDATE ON public.booking_provider_observations FOR EACH ROW EXECUTE FUNCTION private.prospects_sync_booking_provider();


--
-- Name: booking_providers booking_providers_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_providers_set_updated_at BEFORE UPDATE ON public.booking_providers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: chairs chairs_check_location_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER chairs_check_location_consistency BEFORE INSERT OR UPDATE ON public.chairs FOR EACH ROW EXECUTE FUNCTION public.check_chair_location_consistency();


--
-- Name: chairs chairs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER chairs_set_updated_at BEFORE UPDATE ON public.chairs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: commercial_capabilities commercial_capabilities_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER commercial_capabilities_set_updated_at BEFORE UPDATE ON public.commercial_capabilities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: commercial_plan_changes commercial_plan_changes_analytics; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER commercial_plan_changes_analytics AFTER INSERT ON public.commercial_plan_changes FOR EACH ROW EXECUTE FUNCTION public.analytics_plan_change_event();


--
-- Name: commercial_plan_changes commercial_plan_changes_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER commercial_plan_changes_append_only BEFORE DELETE OR UPDATE ON public.commercial_plan_changes FOR EACH ROW EXECUTE FUNCTION public.reject_commercial_history_mutation();


--
-- Name: commercial_plans commercial_plans_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER commercial_plans_set_updated_at BEFORE UPDATE ON public.commercial_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customer_favorites customer_favorites_analytics; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_favorites_analytics AFTER INSERT OR DELETE ON public.customer_favorites FOR EACH ROW EXECUTE FUNCTION public.analytics_favorite_event();


--
-- Name: customer_memberships customer_memberships_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_memberships_check_consistency BEFORE INSERT OR UPDATE ON public.customer_memberships FOR EACH ROW EXECUTE FUNCTION public.check_customer_membership_consistency();


--
-- Name: customer_memberships customer_memberships_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_memberships_set_updated_at BEFORE UPDATE ON public.customer_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customer_passports customer_passports_analytics; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_passports_analytics AFTER INSERT ON public.customer_passports FOR EACH ROW EXECUTE FUNCTION public.analytics_passport_issued_event();


--
-- Name: customer_passports customer_passports_guard_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_passports_guard_identity BEFORE UPDATE ON public.customer_passports FOR EACH ROW EXECUTE FUNCTION public.guard_passport_identity();


--
-- Name: customer_passports customer_passports_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_passports_set_updated_at BEFORE UPDATE ON public.customer_passports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customer_passports customer_passports_stamp_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_passports_stamp_identity BEFORE INSERT ON public.customer_passports FOR EACH ROW EXECUTE FUNCTION public.stamp_passport_identity();


--
-- Name: customer_professional_relationships customer_professional_relationships_analytics; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_professional_relationships_analytics AFTER INSERT ON public.customer_professional_relationships FOR EACH ROW EXECUTE FUNCTION public.analytics_relationship_created_event();


--
-- Name: customer_professional_relationships customer_professional_relationships_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_professional_relationships_guard BEFORE UPDATE ON public.customer_professional_relationships FOR EACH ROW EXECUTE FUNCTION public.guard_customer_professional_relationship();


--
-- Name: customer_professional_relationships customer_professional_relationships_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_professional_relationships_set_updated_at BEFORE UPDATE ON public.customer_professional_relationships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customer_profiles customer_profiles_issue_passport; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_profiles_issue_passport AFTER INSERT ON public.customer_profiles FOR EACH ROW EXECUTE FUNCTION public.customer_profiles_issue_passport();


--
-- Name: customer_profiles customer_profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_profiles_set_updated_at BEFORE UPDATE ON public.customer_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customers customers_guard_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customers_guard_identity BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.guard_customers_identity();


--
-- Name: customers customers_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: email_outbox email_outbox_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER email_outbox_set_updated_at BEFORE UPDATE ON public.email_outbox FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: invitations invitations_check_location_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invitations_check_location_consistency BEFORE INSERT OR UPDATE ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.check_invitation_location_consistency();


--
-- Name: invitations invitations_normalize_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invitations_normalize_email BEFORE INSERT OR UPDATE ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.normalize_invitation_email();


--
-- Name: invitations invitations_notify_new; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invitations_notify_new AFTER INSERT ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.notify_new_invitation();


--
-- Name: location_hours location_hours_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER location_hours_check_consistency BEFORE INSERT OR UPDATE ON public.location_hours FOR EACH ROW EXECUTE FUNCTION public.check_location_hours_location_consistency();


--
-- Name: location_hours location_hours_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER location_hours_set_updated_at BEFORE UPDATE ON public.location_hours FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: location_service_settings location_service_settings_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER location_service_settings_check_consistency BEFORE INSERT OR UPDATE ON public.location_service_settings FOR EACH ROW EXECUTE FUNCTION public.check_location_service_settings_consistency();


--
-- Name: location_service_settings location_service_settings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER location_service_settings_set_updated_at BEFORE UPDATE ON public.location_service_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: locations locations_create_service_settings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER locations_create_service_settings AFTER INSERT ON public.locations FOR EACH ROW EXECUTE FUNCTION public.handle_new_location_service_settings();


--
-- Name: locations locations_enforce_establishment_capacity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER locations_enforce_establishment_capacity BEFORE INSERT OR UPDATE OF is_active, organization_id ON public.locations FOR EACH ROW EXECUTE FUNCTION public.enforce_establishment_capacity();


--
-- Name: locations locations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER locations_set_updated_at BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: membership_plans membership_plans_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER membership_plans_set_updated_at BEFORE UPDATE ON public.membership_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: memberships memberships_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: memberships on_membership_created; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_membership_created AFTER INSERT ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.handle_new_membership();


--
-- Name: organizations on_organization_created; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_organization_created AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization();


--
-- Name: organization_commercial_state organization_commercial_state_integrity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organization_commercial_state_integrity BEFORE UPDATE ON public.organization_commercial_state FOR EACH ROW EXECUTE FUNCTION public.enforce_commercial_state_integrity();


--
-- Name: organization_commercial_state organization_commercial_state_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organization_commercial_state_set_updated_at BEFORE UPDATE ON public.organization_commercial_state FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organization_dashboard_layouts organization_dashboard_layouts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organization_dashboard_layouts_set_updated_at BEFORE UPDATE ON public.organization_dashboard_layouts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organization_follows organization_follows_analytics; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organization_follows_analytics AFTER INSERT OR UPDATE ON public.organization_follows FOR EACH ROW EXECUTE FUNCTION public.analytics_organization_follow_event();


--
-- Name: organizations organizations_assert_creation_authorized; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_assert_creation_authorized BEFORE INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.assert_organization_creation_authorized();


--
-- Name: organizations organizations_ensure_commercial_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_ensure_commercial_state AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization_commercial_state();


--
-- Name: organizations organizations_guard_marketplace_publication; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_guard_marketplace_publication BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.guard_marketplace_publication();


--
-- Name: organizations organizations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: outreach_assignments outreach_assignments_exposure_limits; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER outreach_assignments_exposure_limits BEFORE INSERT ON public.outreach_assignments FOR EACH ROW EXECUTE FUNCTION private.assert_experiment_exposure_limits();


--
-- Name: outreach_campaigns outreach_campaigns_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER outreach_campaigns_set_updated_at BEFORE UPDATE ON public.outreach_campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: outreach_channel_policies outreach_channel_policies_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER outreach_channel_policies_set_updated_at BEFORE UPDATE ON public.outreach_channel_policies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: outreach_experiments outreach_experiments_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER outreach_experiments_set_updated_at BEFORE UPDATE ON public.outreach_experiments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: outreach_recipients outreach_recipients_assert_sendable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER outreach_recipients_assert_sendable BEFORE INSERT OR UPDATE ON public.outreach_recipients FOR EACH ROW EXECUTE FUNCTION private.assert_whatsapp_sendable();


--
-- Name: outreach_recipients outreach_recipients_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER outreach_recipients_set_updated_at BEFORE UPDATE ON public.outreach_recipients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: outreach_templates outreach_templates_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER outreach_templates_set_updated_at BEFORE UPDATE ON public.outreach_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: outreach_templates outreach_templates_stamp_approval; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER outreach_templates_stamp_approval BEFORE UPDATE ON public.outreach_templates FOR EACH ROW EXECUTE FUNCTION private.outreach_templates_stamp_approval();


--
-- Name: platform_members platform_members_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER platform_members_set_updated_at BEFORE UPDATE ON public.platform_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: professional_applications professional_applications_guard_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professional_applications_guard_update BEFORE UPDATE ON public.professional_applications FOR EACH ROW EXECUTE FUNCTION public.guard_professional_application_update();


--
-- Name: professional_applications professional_applications_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professional_applications_set_updated_at BEFORE UPDATE ON public.professional_applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: professional_claims professional_claims_analytics_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professional_claims_analytics_insert AFTER INSERT ON public.professional_claims FOR EACH ROW EXECUTE FUNCTION public.analytics_claim_event();


--
-- Name: professional_claims professional_claims_analytics_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professional_claims_analytics_update AFTER UPDATE OF state ON public.professional_claims FOR EACH ROW EXECUTE FUNCTION public.analytics_claim_event();


--
-- Name: professional_claims professional_claims_enforce_transition; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professional_claims_enforce_transition BEFORE UPDATE ON public.professional_claims FOR EACH ROW EXECUTE FUNCTION public.enforce_professional_claim_transition();


--
-- Name: professional_claims professional_claims_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professional_claims_set_updated_at BEFORE UPDATE ON public.professional_claims FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: professional_follows professional_follows_analytics; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professional_follows_analytics AFTER INSERT OR UPDATE ON public.professional_follows FOR EACH ROW EXECUTE FUNCTION public.analytics_professional_follow_event();


--
-- Name: professional_follows professional_follows_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professional_follows_set_updated_at BEFORE UPDATE ON public.professional_follows FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: professionals professionals_guard_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professionals_guard_identity BEFORE UPDATE ON public.professionals FOR EACH ROW EXECUTE FUNCTION public.guard_professional_identity();


--
-- Name: professionals professionals_guard_publication; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professionals_guard_publication BEFORE INSERT OR UPDATE ON public.professionals FOR EACH ROW EXECUTE FUNCTION public.guard_professional_publication();


--
-- Name: professionals professionals_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professionals_set_updated_at BEFORE UPDATE ON public.professionals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_contacts prospect_contacts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_contacts_set_updated_at BEFORE UPDATE ON public.prospect_contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_data_quality prospect_data_quality_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_data_quality_set_updated_at BEFORE UPDATE ON public.prospect_data_quality FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_duplicates prospect_duplicates_stamp_review; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_duplicates_stamp_review BEFORE UPDATE ON public.prospect_duplicates FOR EACH ROW EXECUTE FUNCTION private.prospect_duplicates_stamp_review();


--
-- Name: prospect_features prospect_features_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_features_set_updated_at BEFORE UPDATE ON public.prospect_features FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_fit_scores prospect_fit_scores_maintain_current; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_fit_scores_maintain_current BEFORE INSERT ON public.prospect_fit_scores FOR EACH ROW WHEN (new.is_current) EXECUTE FUNCTION private.prospect_fit_scores_maintain_current();


--
-- Name: prospect_fit_scores prospect_fit_scores_sync_prospect; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_fit_scores_sync_prospect AFTER INSERT ON public.prospect_fit_scores FOR EACH ROW WHEN (new.is_current) EXECUTE FUNCTION private.prospects_sync_fit_scores();


--
-- Name: prospect_job_sources prospect_job_sources_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_job_sources_set_updated_at BEFORE UPDATE ON public.prospect_job_sources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_jobs prospect_jobs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_jobs_set_updated_at BEFORE UPDATE ON public.prospect_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_locales prospect_locales_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_locales_set_updated_at BEFORE UPDATE ON public.prospect_locales FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_locations prospect_locations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_locations_set_updated_at BEFORE UPDATE ON public.prospect_locations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_notes prospect_notes_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_notes_set_updated_at BEFORE UPDATE ON public.prospect_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_outreach_eligibility prospect_outreach_eligibility_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_outreach_eligibility_set_updated_at BEFORE UPDATE ON public.prospect_outreach_eligibility FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_professionals prospect_professionals_analytics; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_professionals_analytics AFTER INSERT ON public.prospect_professionals FOR EACH ROW EXECUTE FUNCTION public.analytics_external_profile_event();


--
-- Name: prospect_professionals prospect_professionals_enforce_publication_gate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_professionals_enforce_publication_gate BEFORE INSERT OR UPDATE ON public.prospect_professionals FOR EACH ROW EXECUTE FUNCTION public.enforce_prospect_publication_gate();


--
-- Name: prospect_publication_eligibility prospect_publication_eligibility_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_publication_eligibility_set_updated_at BEFORE UPDATE ON public.prospect_publication_eligibility FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_score_rulesets prospect_score_rulesets_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_score_rulesets_set_updated_at BEFORE UPDATE ON public.prospect_score_rulesets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_scores prospect_scores_sync_prospect; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_scores_sync_prospect AFTER INSERT ON public.prospect_scores FOR EACH ROW EXECUTE FUNCTION private.prospect_scores_sync_prospect();


--
-- Name: prospect_search_partitions prospect_search_partitions_enforce_limits; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_search_partitions_enforce_limits BEFORE INSERT ON public.prospect_search_partitions FOR EACH ROW EXECUTE FUNCTION private.prospect_search_partitions_enforce_limits();


--
-- Name: prospect_search_partitions prospect_search_partitions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_search_partitions_set_updated_at BEFORE UPDATE ON public.prospect_search_partitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_searches prospect_searches_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_searches_set_updated_at BEFORE UPDATE ON public.prospect_searches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_social_profiles prospect_social_profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_social_profiles_set_updated_at BEFORE UPDATE ON public.prospect_social_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_source_records prospect_source_records_analytics; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_source_records_analytics AFTER INSERT ON public.prospect_source_records FOR EACH ROW EXECUTE FUNCTION public.analytics_prospect_discovered_event();


--
-- Name: prospect_sources prospect_sources_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_sources_set_updated_at BEFORE UPDATE ON public.prospect_sources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_suppressions prospect_suppressions_sync_prospect; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospect_suppressions_sync_prospect AFTER INSERT ON public.prospect_suppressions FOR EACH ROW EXECUTE FUNCTION private.prospect_suppressions_sync_prospect();


--
-- Name: prospects prospects_cancel_outreach_on_conversion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospects_cancel_outreach_on_conversion AFTER UPDATE ON public.prospects FOR EACH ROW EXECUTE FUNCTION private.cancel_outreach_on_conversion();


--
-- Name: prospects prospects_enrichment_analytics; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospects_enrichment_analytics AFTER UPDATE OF last_enriched_at ON public.prospects FOR EACH ROW EXECUTE FUNCTION public.analytics_prospect_enriched_event();


--
-- Name: prospects prospects_log_status_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospects_log_status_change AFTER UPDATE ON public.prospects FOR EACH ROW EXECUTE FUNCTION private.log_prospect_status_change();


--
-- Name: prospects prospects_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prospects_set_updated_at BEFORE UPDATE ON public.prospects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: queue_entries queue_entries_analytics_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_analytics_insert AFTER INSERT ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION public.analytics_queue_event();


--
-- Name: queue_entries queue_entries_analytics_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_analytics_update AFTER UPDATE OF status ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION public.analytics_queue_event();


--
-- Name: queue_entries queue_entries_auto_follow; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_auto_follow AFTER INSERT OR UPDATE OF status ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION public.queue_entries_auto_follow();


--
-- Name: queue_entries queue_entries_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_check_consistency BEFORE INSERT OR UPDATE ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION public.check_queue_entry_consistency();


--
-- Name: queue_entries queue_entries_enforce_service_mode; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_enforce_service_mode BEFORE INSERT ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_queue_service_mode();


--
-- Name: queue_entries queue_entries_enforce_transition; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_enforce_transition BEFORE UPDATE ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_queue_transition();


--
-- Name: queue_entries queue_entries_link_customer; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_link_customer BEFORE INSERT ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION public.link_customer_from_contact_info();


--
-- Name: queue_entries queue_entries_record_relationship; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_record_relationship AFTER INSERT OR UPDATE OF status ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION public.queue_entries_record_relationship();


--
-- Name: queue_entries queue_entries_restrict_self_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_restrict_self_update BEFORE UPDATE ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION public.restrict_queue_entry_self_update();


--
-- Name: queue_entries queue_entries_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_entries_set_updated_at BEFORE UPDATE ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: service_categories service_categories_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER service_categories_set_updated_at BEFORE UPDATE ON public.service_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: service_locations service_locations_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER service_locations_check_consistency BEFORE INSERT OR UPDATE ON public.service_locations FOR EACH ROW EXECUTE FUNCTION public.check_service_location_consistency();


--
-- Name: service_mode_changes service_mode_changes_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER service_mode_changes_no_update BEFORE DELETE OR UPDATE ON public.service_mode_changes FOR EACH ROW EXECUTE FUNCTION public.reject_service_mode_history_mutation();


--
-- Name: service_mode_overrides service_mode_overrides_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER service_mode_overrides_check_consistency BEFORE INSERT OR UPDATE ON public.service_mode_overrides FOR EACH ROW EXECUTE FUNCTION public.check_service_mode_override_consistency();


--
-- Name: service_mode_overrides service_mode_overrides_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER service_mode_overrides_set_updated_at BEFORE UPDATE ON public.service_mode_overrides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: services services_check_category_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER services_check_category_consistency BEFORE INSERT OR UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.check_service_category_consistency();


--
-- Name: services services_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER services_set_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: staff_profiles staff_profiles_check_location_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER staff_profiles_check_location_consistency BEFORE INSERT OR UPDATE ON public.staff_profiles FOR EACH ROW EXECUTE FUNCTION public.check_staff_profile_location_consistency();


--
-- Name: staff_profiles staff_profiles_enforce_professional_capacity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER staff_profiles_enforce_professional_capacity BEFORE UPDATE OF is_active ON public.staff_profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_reactivation_capacity();


--
-- Name: staff_profiles staff_profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER staff_profiles_set_updated_at BEFORE UPDATE ON public.staff_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: time_blocks time_blocks_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER time_blocks_check_consistency BEFORE INSERT OR UPDATE ON public.time_blocks FOR EACH ROW EXECUTE FUNCTION public.check_time_block_consistency();


--
-- Name: time_blocks time_blocks_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER time_blocks_set_updated_at BEFORE UPDATE ON public.time_blocks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: waitlist_entries waitlist_entries_check_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER waitlist_entries_check_consistency BEFORE INSERT OR UPDATE ON public.waitlist_entries FOR EACH ROW EXECUTE FUNCTION public.check_waitlist_entry_consistency();


--
-- Name: waitlist_entries waitlist_entries_link_customer; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER waitlist_entries_link_customer BEFORE INSERT ON public.waitlist_entries FOR EACH ROW EXECUTE FUNCTION public.link_customer_from_contact_info();


--
-- Name: waitlist_entries waitlist_entries_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER waitlist_entries_set_updated_at BEFORE UPDATE ON public.waitlist_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: whatsapp_accounts whatsapp_accounts_reject_secrets; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER whatsapp_accounts_reject_secrets BEFORE INSERT OR UPDATE ON public.whatsapp_accounts FOR EACH ROW EXECUTE FUNCTION private.whatsapp_accounts_reject_secrets();


--
-- Name: whatsapp_accounts whatsapp_accounts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER whatsapp_accounts_set_updated_at BEFORE UPDATE ON public.whatsapp_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: whatsapp_conversations whatsapp_conversations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER whatsapp_conversations_set_updated_at BEFORE UPDATE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: whatsapp_messages whatsapp_messages_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER whatsapp_messages_set_updated_at BEFORE UPDATE ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: whatsapp_template_mappings whatsapp_template_mappings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER whatsapp_template_mappings_set_updated_at BEFORE UPDATE ON public.whatsapp_template_mappings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: api_source_health api_source_health_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_source_health
    ADD CONSTRAINT api_source_health_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.prospect_sources(id);


--
-- Name: api_source_limits api_source_limits_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_source_limits
    ADD CONSTRAINT api_source_limits_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.prospect_sources(id);


--
-- Name: api_usage api_usage_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage
    ADD CONSTRAINT api_usage_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.prospect_jobs(id) ON DELETE SET NULL;


--
-- Name: api_usage api_usage_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage
    ADD CONSTRAINT api_usage_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.prospect_sources(id);


--
-- Name: appointment_claim_tokens appointment_claim_tokens_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_claim_tokens
    ADD CONSTRAINT appointment_claim_tokens_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: appointment_claim_tokens appointment_claim_tokens_redeemed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_claim_tokens
    ADD CONSTRAINT appointment_claim_tokens_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_barber_id_fkey FOREIGN KEY (barber_id) REFERENCES public.barbers(id) ON DELETE RESTRICT;


--
-- Name: appointments appointments_booked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_booked_by_user_id_fkey FOREIGN KEY (booked_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_chair_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_chair_id_fkey FOREIGN KEY (chair_id) REFERENCES public.chairs(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: appointments appointments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: appointments appointments_rescheduled_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_rescheduled_to_fkey FOREIGN KEY (rescheduled_to) REFERENCES public.appointments(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE RESTRICT;


--
-- Name: audit_logs audit_logs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: barber_availability_exceptions barber_availability_exceptions_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_availability_exceptions
    ADD CONSTRAINT barber_availability_exceptions_barber_id_fkey FOREIGN KEY (barber_id) REFERENCES public.barbers(id) ON DELETE CASCADE;


--
-- Name: barber_availability_exceptions barber_availability_exceptions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_availability_exceptions
    ADD CONSTRAINT barber_availability_exceptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: barber_services barber_services_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_services
    ADD CONSTRAINT barber_services_barber_id_fkey FOREIGN KEY (barber_id) REFERENCES public.barbers(id) ON DELETE CASCADE;


--
-- Name: barber_services barber_services_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_services
    ADD CONSTRAINT barber_services_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: barber_services barber_services_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_services
    ADD CONSTRAINT barber_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: barber_working_hours barber_working_hours_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_working_hours
    ADD CONSTRAINT barber_working_hours_barber_id_fkey FOREIGN KEY (barber_id) REFERENCES public.barbers(id) ON DELETE CASCADE;


--
-- Name: barber_working_hours barber_working_hours_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barber_working_hours
    ADD CONSTRAINT barber_working_hours_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: barbers barbers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barbers
    ADD CONSTRAINT barbers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: barbers barbers_professional_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barbers
    ADD CONSTRAINT barbers_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES public.professionals(id) ON DELETE RESTRICT;


--
-- Name: barbers barbers_staff_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barbers
    ADD CONSTRAINT barbers_staff_profile_id_fkey FOREIGN KEY (staff_profile_id) REFERENCES public.staff_profiles(id) ON DELETE CASCADE;


--
-- Name: booking_provider_observations booking_provider_observations_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_provider_observations
    ADD CONSTRAINT booking_provider_observations_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.prospect_jobs(id) ON DELETE SET NULL;


--
-- Name: booking_provider_observations booking_provider_observations_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_provider_observations
    ADD CONSTRAINT booking_provider_observations_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: booking_provider_observations booking_provider_observations_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_provider_observations
    ADD CONSTRAINT booking_provider_observations_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.booking_providers(id);


--
-- Name: chairs chairs_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chairs
    ADD CONSTRAINT chairs_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: chairs chairs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chairs
    ADD CONSTRAINT chairs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: commercial_plan_changes commercial_plan_changes_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_plan_changes
    ADD CONSTRAINT commercial_plan_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: commercial_plan_changes commercial_plan_changes_new_plan_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_plan_changes
    ADD CONSTRAINT commercial_plan_changes_new_plan_key_fkey FOREIGN KEY (new_plan_key) REFERENCES public.commercial_plans(plan_key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: commercial_plan_changes commercial_plan_changes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_plan_changes
    ADD CONSTRAINT commercial_plan_changes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: commercial_plan_changes commercial_plan_changes_previous_plan_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_plan_changes
    ADD CONSTRAINT commercial_plan_changes_previous_plan_key_fkey FOREIGN KEY (previous_plan_key) REFERENCES public.commercial_plans(plan_key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customer_favorites customer_favorites_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_favorites
    ADD CONSTRAINT customer_favorites_barber_id_fkey FOREIGN KEY (barber_id) REFERENCES public.barbers(id) ON DELETE CASCADE;


--
-- Name: customer_favorites customer_favorites_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_favorites
    ADD CONSTRAINT customer_favorites_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: customer_favorites customer_favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_favorites
    ADD CONSTRAINT customer_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: customer_memberships customer_memberships_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_memberships
    ADD CONSTRAINT customer_memberships_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: customer_memberships customer_memberships_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_memberships
    ADD CONSTRAINT customer_memberships_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_memberships customer_memberships_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_memberships
    ADD CONSTRAINT customer_memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: customer_memberships customer_memberships_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_memberships
    ADD CONSTRAINT customer_memberships_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.membership_plans(id) ON DELETE RESTRICT;


--
-- Name: customer_passport_photos customer_passport_photos_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_passport_photos
    ADD CONSTRAINT customer_passport_photos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: customer_passport_shares customer_passport_shares_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_passport_shares
    ADD CONSTRAINT customer_passport_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: customer_passports customer_passports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_passports
    ADD CONSTRAINT customer_passports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: customer_professional_relationships customer_professional_relationships_customer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_professional_relationships
    ADD CONSTRAINT customer_professional_relationships_customer_user_id_fkey FOREIGN KEY (customer_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: customer_professional_relationships customer_professional_relationships_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_professional_relationships
    ADD CONSTRAINT customer_professional_relationships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: customer_professional_relationships customer_professional_relationships_professional_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_professional_relationships
    ADD CONSTRAINT customer_professional_relationships_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES public.professionals(id) ON DELETE CASCADE;


--
-- Name: customer_profiles customer_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: customers customers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: customers customers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: invitations invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: invitations invitations_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;


--
-- Name: invitations invitations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: location_hours location_hours_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_hours
    ADD CONSTRAINT location_hours_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: location_hours location_hours_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_hours
    ADD CONSTRAINT location_hours_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: location_service_settings location_service_settings_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_service_settings
    ADD CONSTRAINT location_service_settings_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: location_service_settings location_service_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_service_settings
    ADD CONSTRAINT location_service_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: locations locations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: membership_plans membership_plans_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_plans
    ADD CONSTRAINT membership_plans_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ml_datasets ml_datasets_feature_schema_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_datasets
    ADD CONSTRAINT ml_datasets_feature_schema_version_fkey FOREIGN KEY (feature_schema_version) REFERENCES public.ml_feature_schemas(version);


--
-- Name: ml_metrics ml_metrics_model_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_metrics
    ADD CONSTRAINT ml_metrics_model_version_id_fkey FOREIGN KEY (model_version_id) REFERENCES public.ml_model_versions(id) ON DELETE CASCADE;


--
-- Name: ml_model_versions ml_model_versions_feature_schema_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_model_versions
    ADD CONSTRAINT ml_model_versions_feature_schema_version_fkey FOREIGN KEY (feature_schema_version) REFERENCES public.ml_feature_schemas(version);


--
-- Name: ml_model_versions ml_model_versions_promoted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_model_versions
    ADD CONSTRAINT ml_model_versions_promoted_by_fkey FOREIGN KEY (promoted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ml_model_versions ml_model_versions_training_dataset_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_model_versions
    ADD CONSTRAINT ml_model_versions_training_dataset_version_fkey FOREIGN KEY (training_dataset_version) REFERENCES public.ml_datasets(version);


--
-- Name: ml_predictions ml_predictions_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_predictions
    ADD CONSTRAINT ml_predictions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.outreach_campaigns(id) ON DELETE SET NULL;


--
-- Name: ml_predictions ml_predictions_model_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_predictions
    ADD CONSTRAINT ml_predictions_model_version_id_fkey FOREIGN KEY (model_version_id) REFERENCES public.ml_model_versions(id) ON DELETE SET NULL;


--
-- Name: ml_predictions ml_predictions_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_predictions
    ADD CONSTRAINT ml_predictions_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: ml_predictions ml_predictions_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_predictions
    ADD CONSTRAINT ml_predictions_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.outreach_templates(id) ON DELETE CASCADE;


--
-- Name: ml_training_runs ml_training_runs_dataset_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_training_runs
    ADD CONSTRAINT ml_training_runs_dataset_version_fkey FOREIGN KEY (dataset_version) REFERENCES public.ml_datasets(version);


--
-- Name: ml_training_runs ml_training_runs_model_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_training_runs
    ADD CONSTRAINT ml_training_runs_model_version_id_fkey FOREIGN KEY (model_version_id) REFERENCES public.ml_model_versions(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: organization_commercial_state organization_commercial_state_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_commercial_state
    ADD CONSTRAINT organization_commercial_state_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: organization_commercial_state organization_commercial_state_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_commercial_state
    ADD CONSTRAINT organization_commercial_state_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_commercial_state organization_commercial_state_plan_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_commercial_state
    ADD CONSTRAINT organization_commercial_state_plan_key_fkey FOREIGN KEY (plan_key) REFERENCES public.commercial_plans(plan_key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: organization_dashboard_layouts organization_dashboard_layouts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_dashboard_layouts
    ADD CONSTRAINT organization_dashboard_layouts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_dashboard_layouts organization_dashboard_layouts_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_dashboard_layouts
    ADD CONSTRAINT organization_dashboard_layouts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: organization_follows organization_follows_follower_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_follows
    ADD CONSTRAINT organization_follows_follower_user_id_fkey FOREIGN KEY (follower_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: organization_follows organization_follows_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_follows
    ADD CONSTRAINT organization_follows_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: outreach_assignments outreach_assignments_arm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_assignments
    ADD CONSTRAINT outreach_assignments_arm_id_fkey FOREIGN KEY (arm_id) REFERENCES public.outreach_experiment_arms(id) ON DELETE CASCADE;


--
-- Name: outreach_assignments outreach_assignments_experiment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_assignments
    ADD CONSTRAINT outreach_assignments_experiment_id_fkey FOREIGN KEY (experiment_id) REFERENCES public.outreach_experiments(id) ON DELETE CASCADE;


--
-- Name: outreach_assignments outreach_assignments_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_assignments
    ADD CONSTRAINT outreach_assignments_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: outreach_assignments outreach_assignments_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_assignments
    ADD CONSTRAINT outreach_assignments_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.outreach_recipients(id) ON DELETE SET NULL;


--
-- Name: outreach_campaigns outreach_campaigns_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_campaigns
    ADD CONSTRAINT outreach_campaigns_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: outreach_campaigns outreach_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_campaigns
    ADD CONSTRAINT outreach_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: outreach_campaigns outreach_campaigns_experiment_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_campaigns
    ADD CONSTRAINT outreach_campaigns_experiment_fkey FOREIGN KEY (experiment_id) REFERENCES public.outreach_experiments(id) ON DELETE SET NULL;


--
-- Name: outreach_campaigns outreach_campaigns_whatsapp_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_campaigns
    ADD CONSTRAINT outreach_campaigns_whatsapp_account_fkey FOREIGN KEY (whatsapp_account_id) REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL;


--
-- Name: outreach_channel_policies outreach_channel_policies_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_channel_policies
    ADD CONSTRAINT outreach_channel_policies_set_by_fkey FOREIGN KEY (set_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: outreach_events outreach_events_classified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_events
    ADD CONSTRAINT outreach_events_classified_by_fkey FOREIGN KEY (classified_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: outreach_events outreach_events_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_events
    ADD CONSTRAINT outreach_events_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: outreach_events outreach_events_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_events
    ADD CONSTRAINT outreach_events_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.outreach_recipients(id) ON DELETE CASCADE;


--
-- Name: outreach_experiment_arms outreach_experiment_arms_experiment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_experiment_arms
    ADD CONSTRAINT outreach_experiment_arms_experiment_id_fkey FOREIGN KEY (experiment_id) REFERENCES public.outreach_experiments(id) ON DELETE CASCADE;


--
-- Name: outreach_experiment_arms outreach_experiment_arms_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_experiment_arms
    ADD CONSTRAINT outreach_experiment_arms_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.outreach_templates(id);


--
-- Name: outreach_experiments outreach_experiments_cohort_booking_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_experiments
    ADD CONSTRAINT outreach_experiments_cohort_booking_provider_id_fkey FOREIGN KEY (cohort_booking_provider_id) REFERENCES public.booking_providers(id);


--
-- Name: outreach_experiments outreach_experiments_cohort_segment_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_experiments
    ADD CONSTRAINT outreach_experiments_cohort_segment_key_fkey FOREIGN KEY (cohort_segment_key) REFERENCES public.prospect_segment_definitions(key);


--
-- Name: outreach_experiments outreach_experiments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_experiments
    ADD CONSTRAINT outreach_experiments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: outreach_recipients outreach_recipients_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_recipients
    ADD CONSTRAINT outreach_recipients_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE;


--
-- Name: outreach_recipients outreach_recipients_experiment_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_recipients
    ADD CONSTRAINT outreach_recipients_experiment_fkey FOREIGN KEY (experiment_id) REFERENCES public.outreach_experiments(id) ON DELETE SET NULL;


--
-- Name: outreach_recipients outreach_recipients_ml_prediction_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_recipients
    ADD CONSTRAINT outreach_recipients_ml_prediction_fkey FOREIGN KEY (ml_prediction_id) REFERENCES public.ml_predictions(id) ON DELETE SET NULL;


--
-- Name: outreach_recipients outreach_recipients_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_recipients
    ADD CONSTRAINT outreach_recipients_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: outreach_recipients outreach_recipients_sales_angle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_recipients
    ADD CONSTRAINT outreach_recipients_sales_angle_fkey FOREIGN KEY (sales_angle) REFERENCES public.outreach_sales_angles(key);


--
-- Name: outreach_recipients outreach_recipients_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_recipients
    ADD CONSTRAINT outreach_recipients_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.outreach_templates(id);


--
-- Name: outreach_templates outreach_templates_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_templates
    ADD CONSTRAINT outreach_templates_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: outreach_templates outreach_templates_booking_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_templates
    ADD CONSTRAINT outreach_templates_booking_provider_id_fkey FOREIGN KEY (booking_provider_id) REFERENCES public.booking_providers(id);


--
-- Name: outreach_templates outreach_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_templates
    ADD CONSTRAINT outreach_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: outreach_templates outreach_templates_sales_angle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_templates
    ADD CONSTRAINT outreach_templates_sales_angle_fkey FOREIGN KEY (sales_angle) REFERENCES public.outreach_sales_angles(key);


--
-- Name: outreach_templates outreach_templates_segment_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_templates
    ADD CONSTRAINT outreach_templates_segment_key_fkey FOREIGN KEY (segment_key) REFERENCES public.prospect_segment_definitions(key);


--
-- Name: plan_capabilities plan_capabilities_capability_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_capabilities
    ADD CONSTRAINT plan_capabilities_capability_key_fkey FOREIGN KEY (capability_key) REFERENCES public.commercial_capabilities(capability_key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: plan_capabilities plan_capabilities_plan_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_capabilities
    ADD CONSTRAINT plan_capabilities_plan_key_fkey FOREIGN KEY (plan_key) REFERENCES public.commercial_plans(plan_key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: platform_audit_log platform_audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_audit_log
    ADD CONSTRAINT platform_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: platform_invitations platform_invitations_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_invitations
    ADD CONSTRAINT platform_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: platform_invitations platform_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_invitations
    ADD CONSTRAINT platform_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: platform_members platform_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_members
    ADD CONSTRAINT platform_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: platform_notifications platform_notifications_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_notifications
    ADD CONSTRAINT platform_notifications_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: platform_owner_bootstrap_tokens platform_owner_bootstrap_tokens_claimed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_owner_bootstrap_tokens
    ADD CONSTRAINT platform_owner_bootstrap_tokens_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: platform_support_sessions platform_support_sessions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_support_sessions
    ADD CONSTRAINT platform_support_sessions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: platform_support_sessions platform_support_sessions_platform_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_support_sessions
    ADD CONSTRAINT platform_support_sessions_platform_actor_id_fkey FOREIGN KEY (platform_actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: platform_support_sessions platform_support_sessions_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_support_sessions
    ADD CONSTRAINT platform_support_sessions_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: professional_applications professional_applications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_applications
    ADD CONSTRAINT professional_applications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: professional_applications professional_applications_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_applications
    ADD CONSTRAINT professional_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: professional_applications professional_applications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_applications
    ADD CONSTRAINT professional_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: professional_claims professional_claims_claimant_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_claims
    ADD CONSTRAINT professional_claims_claimant_user_id_fkey FOREIGN KEY (claimant_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: professional_claims professional_claims_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_claims
    ADD CONSTRAINT professional_claims_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: professional_claims professional_claims_professional_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_claims
    ADD CONSTRAINT professional_claims_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES public.professionals(id) ON DELETE CASCADE;


--
-- Name: professional_follows professional_follows_follower_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_follows
    ADD CONSTRAINT professional_follows_follower_user_id_fkey FOREIGN KEY (follower_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: professional_follows professional_follows_professional_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_follows
    ADD CONSTRAINT professional_follows_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES public.professionals(id) ON DELETE CASCADE;


--
-- Name: professionals professionals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professionals
    ADD CONSTRAINT professionals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: prospect_contacts prospect_contacts_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_contacts
    ADD CONSTRAINT prospect_contacts_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_data_quality prospect_data_quality_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_data_quality
    ADD CONSTRAINT prospect_data_quality_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_duplicates prospect_duplicates_duplicate_of_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_duplicates
    ADD CONSTRAINT prospect_duplicates_duplicate_of_prospect_id_fkey FOREIGN KEY (duplicate_of_prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_duplicates prospect_duplicates_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_duplicates
    ADD CONSTRAINT prospect_duplicates_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_duplicates prospect_duplicates_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_duplicates
    ADD CONSTRAINT prospect_duplicates_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_events prospect_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_events
    ADD CONSTRAINT prospect_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_events prospect_events_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_events
    ADD CONSTRAINT prospect_events_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_features prospect_features_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_features
    ADD CONSTRAINT prospect_features_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_fit_scores prospect_fit_scores_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_fit_scores
    ADD CONSTRAINT prospect_fit_scores_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.prospect_jobs(id) ON DELETE SET NULL;


--
-- Name: prospect_fit_scores prospect_fit_scores_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_fit_scores
    ADD CONSTRAINT prospect_fit_scores_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_identity_matches prospect_identity_matches_candidate_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_identity_matches
    ADD CONSTRAINT prospect_identity_matches_candidate_prospect_id_fkey FOREIGN KEY (candidate_prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_identity_matches prospect_identity_matches_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_identity_matches
    ADD CONSTRAINT prospect_identity_matches_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.prospect_jobs(id) ON DELETE SET NULL;


--
-- Name: prospect_identity_matches prospect_identity_matches_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_identity_matches
    ADD CONSTRAINT prospect_identity_matches_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_identity_matches prospect_identity_matches_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_identity_matches
    ADD CONSTRAINT prospect_identity_matches_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_job_sources prospect_job_sources_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_job_sources
    ADD CONSTRAINT prospect_job_sources_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.prospect_jobs(id) ON DELETE CASCADE;


--
-- Name: prospect_job_sources prospect_job_sources_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_job_sources
    ADD CONSTRAINT prospect_job_sources_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.prospect_sources(id);


--
-- Name: prospect_jobs prospect_jobs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_jobs
    ADD CONSTRAINT prospect_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_jobs prospect_jobs_partition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_jobs
    ADD CONSTRAINT prospect_jobs_partition_id_fkey FOREIGN KEY (partition_id) REFERENCES public.prospect_search_partitions(id) ON DELETE SET NULL;


--
-- Name: prospect_jobs prospect_jobs_search_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_jobs
    ADD CONSTRAINT prospect_jobs_search_id_fkey FOREIGN KEY (search_id) REFERENCES public.prospect_searches(id) ON DELETE SET NULL;


--
-- Name: prospect_locales prospect_locales_override_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_locales
    ADD CONSTRAINT prospect_locales_override_by_fkey FOREIGN KEY (override_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_locales prospect_locales_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_locales
    ADD CONSTRAINT prospect_locales_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_locations prospect_locations_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_locations
    ADD CONSTRAINT prospect_locations_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_notes prospect_notes_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_notes
    ADD CONSTRAINT prospect_notes_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_notes prospect_notes_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_notes
    ADD CONSTRAINT prospect_notes_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_outreach_eligibility prospect_outreach_eligibility_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_outreach_eligibility
    ADD CONSTRAINT prospect_outreach_eligibility_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_outreach prospect_outreach_logged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_outreach
    ADD CONSTRAINT prospect_outreach_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_outreach prospect_outreach_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_outreach
    ADD CONSTRAINT prospect_outreach_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_professionals prospect_professionals_professional_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_professionals
    ADD CONSTRAINT prospect_professionals_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES public.professionals(id) ON DELETE RESTRICT;


--
-- Name: prospect_professionals prospect_professionals_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_professionals
    ADD CONSTRAINT prospect_professionals_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_publication_eligibility prospect_publication_eligibility_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_publication_eligibility
    ADD CONSTRAINT prospect_publication_eligibility_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_score_rulesets prospect_score_rulesets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_score_rulesets
    ADD CONSTRAINT prospect_score_rulesets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_scores prospect_scores_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_scores
    ADD CONSTRAINT prospect_scores_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_search_partitions prospect_search_partitions_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_search_partitions
    ADD CONSTRAINT prospect_search_partitions_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.prospect_jobs(id) ON DELETE SET NULL;


--
-- Name: prospect_search_partitions prospect_search_partitions_parent_partition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_search_partitions
    ADD CONSTRAINT prospect_search_partitions_parent_partition_id_fkey FOREIGN KEY (parent_partition_id) REFERENCES public.prospect_search_partitions(id) ON DELETE CASCADE;


--
-- Name: prospect_search_partitions prospect_search_partitions_search_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_search_partitions
    ADD CONSTRAINT prospect_search_partitions_search_id_fkey FOREIGN KEY (search_id) REFERENCES public.prospect_searches(id) ON DELETE CASCADE;


--
-- Name: prospect_searches prospect_searches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_searches
    ADD CONSTRAINT prospect_searches_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_segments prospect_segments_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_segments
    ADD CONSTRAINT prospect_segments_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_social_profiles prospect_social_profiles_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_social_profiles
    ADD CONSTRAINT prospect_social_profiles_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_source_records prospect_source_records_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_source_records
    ADD CONSTRAINT prospect_source_records_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.prospect_jobs(id) ON DELETE SET NULL;


--
-- Name: prospect_source_records prospect_source_records_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_source_records
    ADD CONSTRAINT prospect_source_records_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE SET NULL;


--
-- Name: prospect_source_records prospect_source_records_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_source_records
    ADD CONSTRAINT prospect_source_records_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.prospect_sources(id);


--
-- Name: prospect_suppressions prospect_suppressions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_suppressions
    ADD CONSTRAINT prospect_suppressions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_suppressions prospect_suppressions_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_suppressions
    ADD CONSTRAINT prospect_suppressions_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE SET NULL;


--
-- Name: prospect_tags prospect_tags_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tags
    ADD CONSTRAINT prospect_tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_tags prospect_tags_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tags
    ADD CONSTRAINT prospect_tags_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospects prospects_converted_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_converted_organization_id_fkey FOREIGN KEY (converted_organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: prospects prospects_current_booking_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_current_booking_provider_id_fkey FOREIGN KEY (current_booking_provider_id) REFERENCES public.booking_providers(id) ON DELETE SET NULL;


--
-- Name: prospects prospects_parent_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_parent_group_id_fkey FOREIGN KEY (parent_group_id) REFERENCES public.prospects(id) ON DELETE SET NULL;


--
-- Name: queue_entries queue_entries_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_barber_id_fkey FOREIGN KEY (barber_id) REFERENCES public.barbers(id) ON DELETE SET NULL;


--
-- Name: queue_entries queue_entries_booked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_booked_by_user_id_fkey FOREIGN KEY (booked_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: queue_entries queue_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: queue_entries queue_entries_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: queue_entries queue_entries_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: queue_entries queue_entries_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: queue_entries queue_entries_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE SET NULL;


--
-- Name: service_categories service_categories_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: service_locations service_locations_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_locations
    ADD CONSTRAINT service_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: service_locations service_locations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_locations
    ADD CONSTRAINT service_locations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: service_locations service_locations_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_locations
    ADD CONSTRAINT service_locations_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: service_mode_changes service_mode_changes_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_mode_changes
    ADD CONSTRAINT service_mode_changes_barber_id_fkey FOREIGN KEY (barber_id) REFERENCES public.barbers(id) ON DELETE SET NULL;


--
-- Name: service_mode_changes service_mode_changes_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_mode_changes
    ADD CONSTRAINT service_mode_changes_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: service_mode_changes service_mode_changes_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_mode_changes
    ADD CONSTRAINT service_mode_changes_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: service_mode_changes service_mode_changes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_mode_changes
    ADD CONSTRAINT service_mode_changes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: service_mode_overrides service_mode_overrides_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_mode_overrides
    ADD CONSTRAINT service_mode_overrides_barber_id_fkey FOREIGN KEY (barber_id) REFERENCES public.barbers(id) ON DELETE CASCADE;


--
-- Name: service_mode_overrides service_mode_overrides_cleared_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_mode_overrides
    ADD CONSTRAINT service_mode_overrides_cleared_by_user_id_fkey FOREIGN KEY (cleared_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: service_mode_overrides service_mode_overrides_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_mode_overrides
    ADD CONSTRAINT service_mode_overrides_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: service_mode_overrides service_mode_overrides_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_mode_overrides
    ADD CONSTRAINT service_mode_overrides_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: service_mode_overrides service_mode_overrides_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_mode_overrides
    ADD CONSTRAINT service_mode_overrides_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: services services_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.service_categories(id) ON DELETE SET NULL;


--
-- Name: services services_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: staff_profiles staff_profiles_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;


--
-- Name: staff_profiles staff_profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: staff_profiles staff_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: time_blocks time_blocks_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_blocks
    ADD CONSTRAINT time_blocks_barber_id_fkey FOREIGN KEY (barber_id) REFERENCES public.barbers(id) ON DELETE CASCADE;


--
-- Name: time_blocks time_blocks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_blocks
    ADD CONSTRAINT time_blocks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: time_blocks time_blocks_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_blocks
    ADD CONSTRAINT time_blocks_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: time_blocks time_blocks_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_blocks
    ADD CONSTRAINT time_blocks_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: waitlist_entries waitlist_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: waitlist_entries waitlist_entries_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: waitlist_entries waitlist_entries_desired_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_desired_barber_id_fkey FOREIGN KEY (desired_barber_id) REFERENCES public.barbers(id) ON DELETE SET NULL;


--
-- Name: waitlist_entries waitlist_entries_desired_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_desired_service_id_fkey FOREIGN KEY (desired_service_id) REFERENCES public.services(id) ON DELETE SET NULL;


--
-- Name: waitlist_entries waitlist_entries_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: waitlist_entries waitlist_entries_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: whatsapp_conversations whatsapp_conversations_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE SET NULL;


--
-- Name: whatsapp_conversations whatsapp_conversations_whatsapp_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_whatsapp_account_id_fkey FOREIGN KEY (whatsapp_account_id) REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE;


--
-- Name: whatsapp_messages whatsapp_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL;


--
-- Name: whatsapp_messages whatsapp_messages_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE SET NULL;


--
-- Name: whatsapp_messages whatsapp_messages_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.outreach_recipients(id) ON DELETE SET NULL;


--
-- Name: whatsapp_messages whatsapp_messages_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.outreach_templates(id);


--
-- Name: whatsapp_messages whatsapp_messages_whatsapp_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_whatsapp_account_id_fkey FOREIGN KEY (whatsapp_account_id) REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE;


--
-- Name: whatsapp_template_mappings whatsapp_template_mappings_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_template_mappings
    ADD CONSTRAINT whatsapp_template_mappings_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.outreach_templates(id) ON DELETE CASCADE;


--
-- Name: whatsapp_template_mappings whatsapp_template_mappings_whatsapp_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_template_mappings
    ADD CONSTRAINT whatsapp_template_mappings_whatsapp_account_id_fkey FOREIGN KEY (whatsapp_account_id) REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE;


--
-- Name: whatsapp_webhook_events whatsapp_webhook_events_whatsapp_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_webhook_events
    ADD CONSTRAINT whatsapp_webhook_events_whatsapp_account_id_fkey FOREIGN KEY (whatsapp_account_id) REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL;


--
-- Name: analytics_event_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_event_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_ingestion_rejections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_ingestion_rejections ENABLE ROW LEVEL SECURITY;

--
-- Name: api_source_health; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_source_health ENABLE ROW LEVEL SECURITY;

--
-- Name: api_source_health api_source_health_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY api_source_health_all_prospect_worker ON public.api_source_health TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: api_source_health api_source_health_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY api_source_health_select_platform_staff ON public.api_source_health FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: api_source_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_source_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: api_source_limits api_source_limits_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY api_source_limits_all_prospect_worker ON public.api_source_limits TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: api_source_limits api_source_limits_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY api_source_limits_select_platform_staff ON public.api_source_limits FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: api_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: api_usage api_usage_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY api_usage_all_prospect_worker ON public.api_usage TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: api_usage api_usage_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY api_usage_select_platform_staff ON public.api_usage FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: appointment_claim_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointment_claim_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments appointments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY appointments_delete ON public.appointments FOR DELETE TO authenticated USING (( SELECT private.has_org_role(appointments.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: appointments appointments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY appointments_insert ON public.appointments FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(appointments.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: appointments appointments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY appointments_select ON public.appointments FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(appointments.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: appointments appointments_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY appointments_update ON public.appointments FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(appointments.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(appointments.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: appointments appointments_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY appointments_update_self ON public.appointments FOR UPDATE TO authenticated USING (( SELECT private.is_own_barber(appointments.barber_id) AS is_own_barber)) WITH CHECK (( SELECT private.is_own_barber(appointments.barber_id) AS is_own_barber));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_logs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_logs_select ON public.audit_logs FOR SELECT TO authenticated USING ((((organization_id IS NOT NULL) AND ( SELECT private.has_org_role(audit_logs.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: barber_availability_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.barber_availability_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: barber_availability_exceptions barber_availability_exceptions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barber_availability_exceptions_delete ON public.barber_availability_exceptions FOR DELETE TO authenticated USING (( SELECT private.has_org_role(barber_availability_exceptions.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: barber_availability_exceptions barber_availability_exceptions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barber_availability_exceptions_insert ON public.barber_availability_exceptions FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(barber_availability_exceptions.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: barber_availability_exceptions barber_availability_exceptions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barber_availability_exceptions_select ON public.barber_availability_exceptions FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(barber_availability_exceptions.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: barber_availability_exceptions barber_availability_exceptions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barber_availability_exceptions_update ON public.barber_availability_exceptions FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(barber_availability_exceptions.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(barber_availability_exceptions.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: barber_services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.barber_services ENABLE ROW LEVEL SECURITY;

--
-- Name: barber_services barber_services_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barber_services_delete ON public.barber_services FOR DELETE TO authenticated USING (( SELECT private.has_org_role(barber_services.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: barber_services barber_services_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barber_services_insert ON public.barber_services FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(barber_services.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: barber_services barber_services_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barber_services_select ON public.barber_services FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(barber_services.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: barber_working_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.barber_working_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: barber_working_hours barber_working_hours_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barber_working_hours_delete ON public.barber_working_hours FOR DELETE TO authenticated USING (( SELECT private.has_org_role(barber_working_hours.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: barber_working_hours barber_working_hours_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barber_working_hours_insert ON public.barber_working_hours FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(barber_working_hours.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: barber_working_hours barber_working_hours_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barber_working_hours_select ON public.barber_working_hours FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(barber_working_hours.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: barber_working_hours barber_working_hours_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barber_working_hours_update ON public.barber_working_hours FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(barber_working_hours.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(barber_working_hours.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: barbers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;

--
-- Name: barbers barbers_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barbers_delete ON public.barbers FOR DELETE TO authenticated USING (( SELECT private.has_org_role(barbers.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: barbers barbers_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barbers_insert ON public.barbers FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(barbers.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: barbers barbers_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barbers_select ON public.barbers FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(barbers.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: barbers barbers_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY barbers_update ON public.barbers FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(barbers.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(barbers.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: booking_provider_observations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_provider_observations ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_provider_observations booking_provider_observations_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_provider_observations_all_prospect_worker ON public.booking_provider_observations TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: booking_provider_observations booking_provider_observations_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_provider_observations_delete_platform_admin ON public.booking_provider_observations FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: booking_provider_observations booking_provider_observations_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_provider_observations_insert_platform_admin ON public.booking_provider_observations FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: booking_provider_observations booking_provider_observations_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_provider_observations_select_platform_staff ON public.booking_provider_observations FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: booking_provider_observations booking_provider_observations_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_provider_observations_update_platform_admin ON public.booking_provider_observations FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: booking_providers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_providers booking_providers_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_providers_delete_platform_admin ON public.booking_providers FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: booking_providers booking_providers_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_providers_insert_platform_admin ON public.booking_providers FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: booking_providers booking_providers_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_providers_select_platform_staff ON public.booking_providers FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: booking_providers booking_providers_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_providers_select_prospect_worker ON public.booking_providers FOR SELECT TO prospect_worker USING (true);


--
-- Name: booking_providers booking_providers_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_providers_update_platform_admin ON public.booking_providers FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: chairs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chairs ENABLE ROW LEVEL SECURITY;

--
-- Name: chairs chairs_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chairs_delete ON public.chairs FOR DELETE TO authenticated USING (( SELECT private.has_org_role(chairs.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: chairs chairs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chairs_insert ON public.chairs FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(chairs.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: chairs chairs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chairs_select ON public.chairs FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(chairs.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: chairs chairs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chairs_update ON public.chairs FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(chairs.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(chairs.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: commercial_capabilities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commercial_capabilities ENABLE ROW LEVEL SECURITY;

--
-- Name: commercial_capabilities commercial_capabilities_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commercial_capabilities_select ON public.commercial_capabilities FOR SELECT TO authenticated USING (true);


--
-- Name: commercial_plan_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commercial_plan_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: commercial_plan_changes commercial_plan_changes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commercial_plan_changes_select ON public.commercial_plan_changes FOR SELECT TO authenticated USING ((( SELECT private.has_org_role(commercial_plan_changes.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: commercial_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commercial_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: commercial_plans commercial_plans_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commercial_plans_select ON public.commercial_plans FOR SELECT TO authenticated USING (true);


--
-- Name: customer_favorites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_favorites ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_favorites customer_favorites_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_favorites_delete ON public.customer_favorites FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_favorites customer_favorites_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_favorites_insert ON public.customer_favorites FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_favorites customer_favorites_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_favorites_select ON public.customer_favorites FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_memberships customer_memberships_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_memberships_delete ON public.customer_memberships FOR DELETE TO authenticated USING (( SELECT private.has_org_role(customer_memberships.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: customer_memberships customer_memberships_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_memberships_insert ON public.customer_memberships FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(customer_memberships.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: customer_memberships customer_memberships_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_memberships_select ON public.customer_memberships FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(customer_memberships.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: customer_memberships customer_memberships_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_memberships_update ON public.customer_memberships FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(customer_memberships.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(customer_memberships.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: customer_passport_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_passport_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_passport_photos customer_passport_photos_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_passport_photos_delete ON public.customer_passport_photos FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_passport_photos customer_passport_photos_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_passport_photos_insert ON public.customer_passport_photos FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_passport_photos customer_passport_photos_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_passport_photos_select ON public.customer_passport_photos FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_passport_shares; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_passport_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_passport_shares customer_passport_shares_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_passport_shares_delete ON public.customer_passport_shares FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_passport_shares customer_passport_shares_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_passport_shares_select ON public.customer_passport_shares FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_passports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_passports ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_passports customer_passports_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_passports_insert ON public.customer_passports FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_passports customer_passports_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_passports_select ON public.customer_passports FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_passports customer_passports_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_passports_update ON public.customer_passports FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_professional_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_professional_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_professional_relationships customer_professional_relationships_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_professional_relationships_select ON public.customer_professional_relationships FOR SELECT TO authenticated USING (((customer_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_admin() AS is_platform_admin) OR ( SELECT private.is_own_professional(customer_professional_relationships.professional_id) AS is_own_professional) OR ( SELECT private.is_org_member(customer_professional_relationships.organization_id) AS is_org_member)));


--
-- Name: customer_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_profiles customer_profiles_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_profiles_delete ON public.customer_profiles FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_profiles customer_profiles_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_profiles_insert ON public.customer_profiles FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_profiles customer_profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_profiles_select ON public.customer_profiles FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_profiles customer_profiles_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_profiles_update ON public.customer_profiles FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_delete ON public.customers FOR DELETE TO authenticated USING (( SELECT private.has_org_role(customers.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: customers customers_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_insert ON public.customers FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(customers.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: customers customers_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_select ON public.customers FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(customers.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: customers customers_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_update ON public.customers FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(customers.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(customers.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: email_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: email_outbox email_outbox_select_platform; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_outbox_select_platform ON public.email_outbox FOR SELECT TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: invitations invitations_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invitations_delete ON public.invitations FOR DELETE TO authenticated USING (( SELECT private.has_org_role(invitations.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: invitations invitations_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invitations_insert ON public.invitations FOR INSERT TO authenticated WITH CHECK ((( SELECT private.has_org_role(invitations.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role) AND (invited_by = ( SELECT auth.uid() AS uid)) AND ((role <> 'owner'::public.membership_role) OR ( SELECT private.has_org_role(invitations.organization_id, ARRAY['owner'::public.membership_role]) AS has_org_role))));


--
-- Name: invitations invitations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invitations_select ON public.invitations FOR SELECT TO authenticated USING ((( SELECT private.has_org_role(invitations.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: location_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: location_hours location_hours_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY location_hours_delete ON public.location_hours FOR DELETE TO authenticated USING (( SELECT private.has_org_role(location_hours.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: location_hours location_hours_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY location_hours_insert ON public.location_hours FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(location_hours.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: location_hours location_hours_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY location_hours_select ON public.location_hours FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(location_hours.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: location_hours location_hours_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY location_hours_update ON public.location_hours FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(location_hours.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(location_hours.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: location_service_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_service_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: location_service_settings location_service_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY location_service_settings_select ON public.location_service_settings FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(location_service_settings.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

--
-- Name: locations locations_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY locations_delete ON public.locations FOR DELETE TO authenticated USING (( SELECT private.has_org_role(locations.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: locations locations_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY locations_insert ON public.locations FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(locations.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: locations locations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY locations_select ON public.locations FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(locations.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: locations locations_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY locations_update ON public.locations FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(locations.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(locations.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: membership_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_plans membership_plans_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY membership_plans_delete ON public.membership_plans FOR DELETE TO authenticated USING (( SELECT private.has_org_role(membership_plans.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: membership_plans membership_plans_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY membership_plans_insert ON public.membership_plans FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(membership_plans.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: membership_plans membership_plans_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY membership_plans_select ON public.membership_plans FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(membership_plans.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: membership_plans membership_plans_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY membership_plans_update ON public.membership_plans FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(membership_plans.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(membership_plans.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: memberships memberships_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memberships_delete ON public.memberships FOR DELETE TO authenticated USING ((( SELECT private.has_org_role(memberships.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role) OR (user_id = ( SELECT auth.uid() AS uid))));


--
-- Name: memberships memberships_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memberships_insert ON public.memberships FOR INSERT TO authenticated WITH CHECK ((( SELECT private.has_org_role(memberships.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role) AND ((role <> 'owner'::public.membership_role) OR ( SELECT private.has_org_role(memberships.organization_id, ARRAY['owner'::public.membership_role]) AS has_org_role))));


--
-- Name: memberships memberships_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memberships_select ON public.memberships FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(memberships.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: memberships memberships_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memberships_update ON public.memberships FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(memberships.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK ((( SELECT private.has_org_role(memberships.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role) AND ((role <> 'owner'::public.membership_role) OR ( SELECT private.has_org_role(memberships.organization_id, ARRAY['owner'::public.membership_role]) AS has_org_role))));


--
-- Name: ml_datasets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_datasets ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_datasets ml_datasets_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_datasets_all_prospect_worker ON public.ml_datasets TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: ml_datasets ml_datasets_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_datasets_select_platform_staff ON public.ml_datasets FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: ml_feature_schemas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_feature_schemas ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_feature_schemas ml_feature_schemas_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_feature_schemas_select_platform_staff ON public.ml_feature_schemas FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: ml_feature_schemas ml_feature_schemas_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_feature_schemas_select_prospect_worker ON public.ml_feature_schemas FOR SELECT TO prospect_worker USING (true);


--
-- Name: ml_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_metrics ml_metrics_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_metrics_all_prospect_worker ON public.ml_metrics TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: ml_metrics ml_metrics_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_metrics_select_platform_staff ON public.ml_metrics FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: ml_model_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_model_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_model_versions ml_model_versions_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_model_versions_all_prospect_worker ON public.ml_model_versions TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: ml_model_versions ml_model_versions_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_model_versions_delete_platform_admin ON public.ml_model_versions FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: ml_model_versions ml_model_versions_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_model_versions_insert_platform_admin ON public.ml_model_versions FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: ml_model_versions ml_model_versions_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_model_versions_select_platform_staff ON public.ml_model_versions FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: ml_model_versions ml_model_versions_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_model_versions_update_platform_admin ON public.ml_model_versions FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: ml_predictions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_predictions ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_predictions ml_predictions_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_predictions_all_prospect_worker ON public.ml_predictions TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: ml_predictions ml_predictions_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_predictions_select_platform_staff ON public.ml_predictions FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: ml_training_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_training_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_training_runs ml_training_runs_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_training_runs_all_prospect_worker ON public.ml_training_runs TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: ml_training_runs ml_training_runs_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ml_training_runs_select_platform_staff ON public.ml_training_runs FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: notifications notifications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: organization_commercial_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_commercial_state ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_commercial_state organization_commercial_state_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_commercial_state_select ON public.organization_commercial_state FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(organization_commercial_state.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: organization_dashboard_layouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_dashboard_layouts ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_dashboard_layouts organization_dashboard_layouts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_dashboard_layouts_delete ON public.organization_dashboard_layouts FOR DELETE TO authenticated USING (( SELECT private.has_org_role(organization_dashboard_layouts.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: organization_dashboard_layouts organization_dashboard_layouts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_dashboard_layouts_insert ON public.organization_dashboard_layouts FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(organization_dashboard_layouts.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: organization_dashboard_layouts organization_dashboard_layouts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_dashboard_layouts_select ON public.organization_dashboard_layouts FOR SELECT TO authenticated USING (( SELECT private.is_org_member(organization_dashboard_layouts.organization_id) AS is_org_member));


--
-- Name: organization_dashboard_layouts organization_dashboard_layouts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_dashboard_layouts_update ON public.organization_dashboard_layouts FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(organization_dashboard_layouts.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(organization_dashboard_layouts.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: organization_follows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_follows ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_follows organization_follows_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_follows_select_own ON public.organization_follows FOR SELECT TO authenticated USING ((follower_user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_delete ON public.organizations FOR DELETE TO authenticated USING (( SELECT private.has_org_role(organizations.id, ARRAY['owner'::public.membership_role]) AS has_org_role));


--
-- Name: organizations organizations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_select ON public.organizations FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(organizations.id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: organizations organizations_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_update ON public.organizations FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(organizations.id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(organizations.id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: outreach_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_assignments outreach_assignments_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_assignments_all_prospect_worker ON public.outreach_assignments TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: outreach_assignments outreach_assignments_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_assignments_select_platform_staff ON public.outreach_assignments FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: outreach_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_campaigns outreach_campaigns_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_campaigns_all_prospect_worker ON public.outreach_campaigns TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: outreach_campaigns outreach_campaigns_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_campaigns_delete_platform_admin ON public.outreach_campaigns FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_campaigns outreach_campaigns_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_campaigns_insert_platform_admin ON public.outreach_campaigns FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_campaigns outreach_campaigns_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_campaigns_select_platform_staff ON public.outreach_campaigns FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: outreach_campaigns outreach_campaigns_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_campaigns_update_platform_admin ON public.outreach_campaigns FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_channel_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_channel_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_channel_policies outreach_channel_policies_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_channel_policies_delete_platform_admin ON public.outreach_channel_policies FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_channel_policies outreach_channel_policies_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_channel_policies_insert_platform_admin ON public.outreach_channel_policies FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_channel_policies outreach_channel_policies_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_channel_policies_select_platform_staff ON public.outreach_channel_policies FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: outreach_channel_policies outreach_channel_policies_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_channel_policies_select_prospect_worker ON public.outreach_channel_policies FOR SELECT TO prospect_worker USING (true);


--
-- Name: outreach_channel_policies outreach_channel_policies_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_channel_policies_update_platform_admin ON public.outreach_channel_policies FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_events ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_events outreach_events_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_events_all_prospect_worker ON public.outreach_events TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: outreach_events outreach_events_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_events_select_platform_staff ON public.outreach_events FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: outreach_experiment_arms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_experiment_arms ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_experiment_arms outreach_experiment_arms_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_experiment_arms_delete_platform_admin ON public.outreach_experiment_arms FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_experiment_arms outreach_experiment_arms_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_experiment_arms_insert_platform_admin ON public.outreach_experiment_arms FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_experiment_arms outreach_experiment_arms_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_experiment_arms_select_platform_staff ON public.outreach_experiment_arms FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: outreach_experiment_arms outreach_experiment_arms_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_experiment_arms_select_prospect_worker ON public.outreach_experiment_arms FOR SELECT TO prospect_worker USING (true);


--
-- Name: outreach_experiment_arms outreach_experiment_arms_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_experiment_arms_update_platform_admin ON public.outreach_experiment_arms FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_experiments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_experiments ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_experiments outreach_experiments_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_experiments_delete_platform_admin ON public.outreach_experiments FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_experiments outreach_experiments_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_experiments_insert_platform_admin ON public.outreach_experiments FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_experiments outreach_experiments_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_experiments_select_platform_staff ON public.outreach_experiments FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: outreach_experiments outreach_experiments_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_experiments_select_prospect_worker ON public.outreach_experiments FOR SELECT TO prospect_worker USING (true);


--
-- Name: outreach_experiments outreach_experiments_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_experiments_update_platform_admin ON public.outreach_experiments FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_recipients outreach_recipients_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_recipients_all_prospect_worker ON public.outreach_recipients TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: outreach_recipients outreach_recipients_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_recipients_delete_platform_admin ON public.outreach_recipients FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_recipients outreach_recipients_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_recipients_insert_platform_admin ON public.outreach_recipients FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_recipients outreach_recipients_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_recipients_select_platform_staff ON public.outreach_recipients FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: outreach_recipients outreach_recipients_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_recipients_update_platform_admin ON public.outreach_recipients FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_sales_angles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_sales_angles ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_sales_angles outreach_sales_angles_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_sales_angles_select_platform_staff ON public.outreach_sales_angles FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: outreach_sales_angles outreach_sales_angles_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_sales_angles_select_prospect_worker ON public.outreach_sales_angles FOR SELECT TO prospect_worker USING (true);


--
-- Name: outreach_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_templates outreach_templates_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_templates_delete_platform_admin ON public.outreach_templates FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_templates outreach_templates_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_templates_insert_platform_admin ON public.outreach_templates FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: outreach_templates outreach_templates_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_templates_select_platform_staff ON public.outreach_templates FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: outreach_templates outreach_templates_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_templates_select_prospect_worker ON public.outreach_templates FOR SELECT TO prospect_worker USING (true);


--
-- Name: outreach_templates outreach_templates_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_templates_update_platform_admin ON public.outreach_templates FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: plan_capabilities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plan_capabilities ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_capabilities plan_capabilities_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_capabilities_select ON public.plan_capabilities FOR SELECT TO authenticated USING (true);


--
-- Name: platform_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_audit_log platform_audit_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_audit_log_select ON public.platform_audit_log FOR SELECT TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: platform_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_invitations platform_invitations_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_invitations_select_admin ON public.platform_invitations FOR SELECT TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: platform_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_members ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_members platform_members_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_members_select_admin ON public.platform_members FOR SELECT TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: platform_members platform_members_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_members_select_own ON public.platform_members FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: platform_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_notifications platform_notifications_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_notifications_select ON public.platform_notifications FOR SELECT TO authenticated USING (((recipient_user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role)));


--
-- Name: platform_notifications platform_notifications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_notifications_update_own ON public.platform_notifications FOR UPDATE TO authenticated USING (((recipient_user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role))) WITH CHECK (((recipient_user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role)));


--
-- Name: platform_owner_bootstrap_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_owner_bootstrap_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_support_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_support_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_support_sessions platform_support_sessions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_support_sessions_select ON public.platform_support_sessions FOR SELECT TO authenticated USING (((platform_actor_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: professional_applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.professional_applications ENABLE ROW LEVEL SECURITY;

--
-- Name: professional_applications professional_applications_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY professional_applications_select ON public.professional_applications FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: professional_applications professional_applications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY professional_applications_update_own ON public.professional_applications FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending_review'::public.professional_application_status))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending_review'::public.professional_application_status)));


--
-- Name: professional_applications professional_applications_update_platform; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY professional_applications_update_platform ON public.professional_applications FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: professional_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.professional_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: professional_claims professional_claims_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY professional_claims_select ON public.professional_claims FOR SELECT TO authenticated USING (((claimant_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: professional_follows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.professional_follows ENABLE ROW LEVEL SECURITY;

--
-- Name: professional_follows professional_follows_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY professional_follows_select ON public.professional_follows FOR SELECT TO authenticated USING (((follower_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: professionals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;

--
-- Name: professionals professionals_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY professionals_select ON public.professionals FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_admin() AS is_platform_admin) OR (EXISTS ( SELECT 1
   FROM public.barbers b
  WHERE ((b.professional_id = professionals.id) AND ( SELECT private.is_org_member(b.organization_id) AS is_org_member))))));


--
-- Name: professionals professionals_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY professionals_update_self ON public.professionals FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (claim_state = 'claimed'::public.professional_claim_state))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (claim_state = 'claimed'::public.professional_claim_state)));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: prospect_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_contacts prospect_contacts_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_contacts_all_prospect_worker ON public.prospect_contacts TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_contacts prospect_contacts_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_contacts_select_platform_staff ON public.prospect_contacts FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_data_quality; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_data_quality ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_data_quality prospect_data_quality_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_data_quality_all_prospect_worker ON public.prospect_data_quality TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_data_quality prospect_data_quality_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_data_quality_select_platform_staff ON public.prospect_data_quality FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_duplicates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_duplicates ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_duplicates prospect_duplicates_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_duplicates_delete_platform_admin ON public.prospect_duplicates FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_duplicates prospect_duplicates_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_duplicates_select_platform_staff ON public.prospect_duplicates FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_duplicates prospect_duplicates_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_duplicates_update_platform_admin ON public.prospect_duplicates FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_duplicates prospect_duplicates_write_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_duplicates_write_platform_admin ON public.prospect_duplicates FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_events ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_events prospect_events_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_events_all_prospect_worker ON public.prospect_events TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_events prospect_events_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_events_select_platform_staff ON public.prospect_events FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_features; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_features ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_features prospect_features_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_features_all_prospect_worker ON public.prospect_features TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_features prospect_features_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_features_select_platform_staff ON public.prospect_features FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_fit_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_fit_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_fit_scores prospect_fit_scores_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_fit_scores_all_prospect_worker ON public.prospect_fit_scores TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_fit_scores prospect_fit_scores_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_fit_scores_select_platform_staff ON public.prospect_fit_scores FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_identity_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_identity_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_identity_matches prospect_identity_matches_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_identity_matches_all_prospect_worker ON public.prospect_identity_matches TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_identity_matches prospect_identity_matches_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_identity_matches_delete_platform_admin ON public.prospect_identity_matches FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_identity_matches prospect_identity_matches_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_identity_matches_insert_platform_admin ON public.prospect_identity_matches FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_identity_matches prospect_identity_matches_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_identity_matches_select_platform_staff ON public.prospect_identity_matches FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_identity_matches prospect_identity_matches_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_identity_matches_update_platform_admin ON public.prospect_identity_matches FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_job_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_job_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_job_sources prospect_job_sources_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_job_sources_all_prospect_worker ON public.prospect_job_sources TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_job_sources prospect_job_sources_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_job_sources_select_platform_staff ON public.prospect_job_sources FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_jobs prospect_jobs_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_jobs_all_prospect_worker ON public.prospect_jobs TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_jobs prospect_jobs_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_jobs_insert_platform_admin ON public.prospect_jobs FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_jobs prospect_jobs_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_jobs_select_platform_staff ON public.prospect_jobs FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_locales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_locales ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_locales prospect_locales_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_locales_all_prospect_worker ON public.prospect_locales TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_locales prospect_locales_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_locales_delete_platform_admin ON public.prospect_locales FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_locales prospect_locales_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_locales_insert_platform_admin ON public.prospect_locales FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_locales prospect_locales_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_locales_select_platform_staff ON public.prospect_locales FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_locales prospect_locales_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_locales_update_platform_admin ON public.prospect_locales FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_locations prospect_locations_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_locations_all_prospect_worker ON public.prospect_locations TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_locations prospect_locations_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_locations_select_platform_staff ON public.prospect_locations FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_notes prospect_notes_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_notes_delete_platform_admin ON public.prospect_notes FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_notes prospect_notes_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_notes_select_platform_staff ON public.prospect_notes FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_notes prospect_notes_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_notes_update_platform_admin ON public.prospect_notes FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_notes prospect_notes_write_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_notes_write_platform_admin ON public.prospect_notes FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_outreach; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_outreach ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_outreach prospect_outreach_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_outreach_delete_platform_admin ON public.prospect_outreach FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_outreach_eligibility; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_outreach_eligibility ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_outreach_eligibility prospect_outreach_eligibility_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_outreach_eligibility_all_prospect_worker ON public.prospect_outreach_eligibility TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_outreach_eligibility prospect_outreach_eligibility_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_outreach_eligibility_delete_platform_admin ON public.prospect_outreach_eligibility FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_outreach_eligibility prospect_outreach_eligibility_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_outreach_eligibility_insert_platform_admin ON public.prospect_outreach_eligibility FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_outreach_eligibility prospect_outreach_eligibility_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_outreach_eligibility_select_platform_staff ON public.prospect_outreach_eligibility FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_outreach_eligibility prospect_outreach_eligibility_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_outreach_eligibility_update_platform_admin ON public.prospect_outreach_eligibility FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_outreach prospect_outreach_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_outreach_select_platform_staff ON public.prospect_outreach FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_outreach prospect_outreach_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_outreach_update_platform_admin ON public.prospect_outreach FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_outreach prospect_outreach_write_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_outreach_write_platform_admin ON public.prospect_outreach FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_professionals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_professionals ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_professionals prospect_professionals_select_platform; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_professionals_select_platform ON public.prospect_professionals FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_professionals prospect_professionals_select_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_professionals_select_worker ON public.prospect_professionals FOR SELECT TO prospect_worker USING (true);


--
-- Name: prospect_publication_eligibility; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_publication_eligibility ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_publication_eligibility prospect_publication_eligibility_select_platform; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_publication_eligibility_select_platform ON public.prospect_publication_eligibility FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_publication_eligibility prospect_publication_eligibility_select_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_publication_eligibility_select_worker ON public.prospect_publication_eligibility FOR SELECT TO prospect_worker USING (true);


--
-- Name: prospect_score_rulesets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_score_rulesets ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_score_rulesets prospect_score_rulesets_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_score_rulesets_delete_platform_admin ON public.prospect_score_rulesets FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_score_rulesets prospect_score_rulesets_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_score_rulesets_insert_platform_admin ON public.prospect_score_rulesets FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_score_rulesets prospect_score_rulesets_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_score_rulesets_select_platform_staff ON public.prospect_score_rulesets FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_score_rulesets prospect_score_rulesets_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_score_rulesets_select_prospect_worker ON public.prospect_score_rulesets FOR SELECT TO prospect_worker USING (true);


--
-- Name: prospect_score_rulesets prospect_score_rulesets_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_score_rulesets_update_platform_admin ON public.prospect_score_rulesets FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_scores prospect_scores_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_scores_all_prospect_worker ON public.prospect_scores TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_scores prospect_scores_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_scores_select_platform_staff ON public.prospect_scores FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_search_partitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_search_partitions ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_search_partitions prospect_search_partitions_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_search_partitions_all_prospect_worker ON public.prospect_search_partitions TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_search_partitions prospect_search_partitions_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_search_partitions_select_platform_staff ON public.prospect_search_partitions FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_searches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_searches ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_searches prospect_searches_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_searches_all_prospect_worker ON public.prospect_searches TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_searches prospect_searches_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_searches_delete_platform_admin ON public.prospect_searches FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_searches prospect_searches_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_searches_insert_platform_admin ON public.prospect_searches FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_searches prospect_searches_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_searches_select_platform_staff ON public.prospect_searches FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_searches prospect_searches_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_searches_update_platform_admin ON public.prospect_searches FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_segment_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_segment_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_segment_definitions prospect_segment_definitions_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_segment_definitions_select_platform_staff ON public.prospect_segment_definitions FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_segment_definitions prospect_segment_definitions_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_segment_definitions_select_prospect_worker ON public.prospect_segment_definitions FOR SELECT TO prospect_worker USING (true);


--
-- Name: prospect_segments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_segments ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_segments prospect_segments_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_segments_all_prospect_worker ON public.prospect_segments TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_segments prospect_segments_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_segments_select_platform_staff ON public.prospect_segments FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_social_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_social_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_social_profiles prospect_social_profiles_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_social_profiles_all_prospect_worker ON public.prospect_social_profiles TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_social_profiles prospect_social_profiles_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_social_profiles_select_platform_staff ON public.prospect_social_profiles FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_source_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_source_records ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_source_records prospect_source_records_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_source_records_all_prospect_worker ON public.prospect_source_records TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospect_source_records prospect_source_records_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_source_records_select_platform_staff ON public.prospect_source_records FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_sources prospect_sources_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_sources_delete_platform_admin ON public.prospect_sources FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_sources prospect_sources_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_sources_select_platform_staff ON public.prospect_sources FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_sources prospect_sources_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_sources_select_prospect_worker ON public.prospect_sources FOR SELECT TO prospect_worker USING (true);


--
-- Name: prospect_sources prospect_sources_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_sources_update_platform_admin ON public.prospect_sources FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_sources prospect_sources_write_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_sources_write_platform_admin ON public.prospect_sources FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_suppressions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_suppressions ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_suppressions prospect_suppressions_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_suppressions_delete_platform_admin ON public.prospect_suppressions FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_suppressions prospect_suppressions_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_suppressions_select_platform_staff ON public.prospect_suppressions FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_suppressions prospect_suppressions_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_suppressions_update_platform_admin ON public.prospect_suppressions FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_suppressions prospect_suppressions_write_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_suppressions_write_platform_admin ON public.prospect_suppressions FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_tags prospect_tags_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_tags_delete_platform_admin ON public.prospect_tags FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_tags prospect_tags_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_tags_select_platform_staff ON public.prospect_tags FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospect_tags prospect_tags_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_tags_update_platform_admin ON public.prospect_tags FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospect_tags prospect_tags_write_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_tags_write_platform_admin ON public.prospect_tags FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

--
-- Name: prospects prospects_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospects_all_prospect_worker ON public.prospects TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: prospects prospects_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospects_delete_platform_admin ON public.prospects FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospects prospects_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospects_select_platform_staff ON public.prospects FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: prospects prospects_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospects_update_platform_admin ON public.prospects FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: prospects prospects_write_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospects_write_platform_admin ON public.prospects FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: queue_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: queue_entries queue_entries_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY queue_entries_delete ON public.queue_entries FOR DELETE TO authenticated USING (( SELECT private.has_org_role(queue_entries.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: queue_entries queue_entries_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY queue_entries_insert ON public.queue_entries FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(queue_entries.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: queue_entries queue_entries_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY queue_entries_select ON public.queue_entries FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(queue_entries.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: queue_entries queue_entries_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY queue_entries_update ON public.queue_entries FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(queue_entries.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(queue_entries.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: queue_entries queue_entries_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY queue_entries_update_self ON public.queue_entries FOR UPDATE TO authenticated USING (((barber_id IS NOT NULL) AND ( SELECT private.is_own_barber(queue_entries.barber_id) AS is_own_barber))) WITH CHECK (((barber_id IS NOT NULL) AND ( SELECT private.is_own_barber(queue_entries.barber_id) AS is_own_barber)));


--
-- Name: service_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: service_categories service_categories_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_categories_delete ON public.service_categories FOR DELETE TO authenticated USING (( SELECT private.has_org_role(service_categories.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: service_categories service_categories_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_categories_insert ON public.service_categories FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(service_categories.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: service_categories service_categories_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_categories_select ON public.service_categories FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(service_categories.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: service_categories service_categories_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_categories_update ON public.service_categories FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(service_categories.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(service_categories.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: service_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: service_locations service_locations_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_locations_delete ON public.service_locations FOR DELETE TO authenticated USING (( SELECT private.has_org_role(service_locations.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: service_locations service_locations_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_locations_insert ON public.service_locations FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(service_locations.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: service_locations service_locations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_locations_select ON public.service_locations FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(service_locations.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: service_mode_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_mode_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: service_mode_changes service_mode_changes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_mode_changes_select ON public.service_mode_changes FOR SELECT TO authenticated USING ((( SELECT private.has_org_role(service_mode_changes.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: service_mode_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_mode_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: service_mode_overrides service_mode_overrides_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_mode_overrides_select ON public.service_mode_overrides FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(service_mode_overrides.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

--
-- Name: services services_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY services_delete ON public.services FOR DELETE TO authenticated USING (( SELECT private.has_org_role(services.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: services services_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY services_insert ON public.services FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(services.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: services services_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY services_select ON public.services FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(services.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: services services_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY services_update ON public.services FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(services.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(services.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: staff_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_profiles staff_profiles_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_profiles_delete ON public.staff_profiles FOR DELETE TO authenticated USING (( SELECT private.has_org_role(staff_profiles.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: staff_profiles staff_profiles_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_profiles_insert ON public.staff_profiles FOR INSERT TO authenticated WITH CHECK ((( SELECT private.has_org_role(staff_profiles.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role) AND (EXISTS ( SELECT 1
   FROM public.memberships m
  WHERE ((m.organization_id = m.organization_id) AND (m.user_id = m.user_id))))));


--
-- Name: staff_profiles staff_profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_profiles_select ON public.staff_profiles FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(staff_profiles.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: staff_profiles staff_profiles_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_profiles_update ON public.staff_profiles FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(staff_profiles.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(staff_profiles.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role]) AS has_org_role));


--
-- Name: time_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.time_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: time_blocks time_blocks_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY time_blocks_delete ON public.time_blocks FOR DELETE TO authenticated USING ((( SELECT private.can_manage_appointments(time_blocks.organization_id) AS can_manage_appointments) OR ( SELECT private.is_own_barber(time_blocks.barber_id) AS is_own_barber)));


--
-- Name: time_blocks time_blocks_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY time_blocks_insert ON public.time_blocks FOR INSERT TO authenticated WITH CHECK ((( SELECT private.can_manage_appointments(time_blocks.organization_id) AS can_manage_appointments) OR ( SELECT private.is_own_barber(time_blocks.barber_id) AS is_own_barber)));


--
-- Name: time_blocks time_blocks_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY time_blocks_select ON public.time_blocks FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(time_blocks.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: time_blocks time_blocks_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY time_blocks_update ON public.time_blocks FOR UPDATE TO authenticated USING ((( SELECT private.can_manage_appointments(time_blocks.organization_id) AS can_manage_appointments) OR ( SELECT private.is_own_barber(time_blocks.barber_id) AS is_own_barber))) WITH CHECK ((( SELECT private.can_manage_appointments(time_blocks.organization_id) AS can_manage_appointments) OR ( SELECT private.is_own_barber(time_blocks.barber_id) AS is_own_barber)));


--
-- Name: waitlist_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: waitlist_entries waitlist_entries_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waitlist_entries_delete ON public.waitlist_entries FOR DELETE TO authenticated USING (( SELECT private.has_org_role(waitlist_entries.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: waitlist_entries waitlist_entries_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waitlist_entries_insert ON public.waitlist_entries FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_org_role(waitlist_entries.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: waitlist_entries waitlist_entries_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waitlist_entries_select ON public.waitlist_entries FOR SELECT TO authenticated USING ((( SELECT private.is_org_member(waitlist_entries.organization_id) AS is_org_member) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: waitlist_entries waitlist_entries_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waitlist_entries_update ON public.waitlist_entries FOR UPDATE TO authenticated USING (( SELECT private.has_org_role(waitlist_entries.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role)) WITH CHECK (( SELECT private.has_org_role(waitlist_entries.organization_id, ARRAY['owner'::public.membership_role, 'manager'::public.membership_role, 'receptionist'::public.membership_role]) AS has_org_role));


--
-- Name: whatsapp_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_accounts whatsapp_accounts_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_accounts_delete_platform_admin ON public.whatsapp_accounts FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: whatsapp_accounts whatsapp_accounts_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_accounts_insert_platform_admin ON public.whatsapp_accounts FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: whatsapp_accounts whatsapp_accounts_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_accounts_select_platform_staff ON public.whatsapp_accounts FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: whatsapp_accounts whatsapp_accounts_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_accounts_select_prospect_worker ON public.whatsapp_accounts FOR SELECT TO prospect_worker USING (true);


--
-- Name: whatsapp_accounts whatsapp_accounts_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_accounts_update_platform_admin ON public.whatsapp_accounts FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: whatsapp_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_conversations whatsapp_conversations_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_conversations_all_prospect_worker ON public.whatsapp_conversations TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: whatsapp_conversations whatsapp_conversations_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_conversations_select_platform_staff ON public.whatsapp_conversations FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: whatsapp_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_messages whatsapp_messages_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_messages_all_prospect_worker ON public.whatsapp_messages TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: whatsapp_messages whatsapp_messages_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_messages_select_platform_staff ON public.whatsapp_messages FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: whatsapp_template_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_template_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_template_mappings whatsapp_template_mappings_delete_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_template_mappings_delete_platform_admin ON public.whatsapp_template_mappings FOR DELETE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: whatsapp_template_mappings whatsapp_template_mappings_insert_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_template_mappings_insert_platform_admin ON public.whatsapp_template_mappings FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: whatsapp_template_mappings whatsapp_template_mappings_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_template_mappings_select_platform_staff ON public.whatsapp_template_mappings FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- Name: whatsapp_template_mappings whatsapp_template_mappings_select_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_template_mappings_select_prospect_worker ON public.whatsapp_template_mappings FOR SELECT TO prospect_worker USING (true);


--
-- Name: whatsapp_template_mappings whatsapp_template_mappings_update_platform_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_template_mappings_update_platform_admin ON public.whatsapp_template_mappings FOR UPDATE TO authenticated USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: whatsapp_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_webhook_events whatsapp_webhook_events_all_prospect_worker; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_webhook_events_all_prospect_worker ON public.whatsapp_webhook_events TO prospect_worker USING (true) WITH CHECK (true);


--
-- Name: whatsapp_webhook_events whatsapp_webhook_events_select_platform_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_webhook_events_select_platform_staff ON public.whatsapp_webhook_events FOR SELECT TO authenticated USING (( SELECT private.has_platform_role(ARRAY['platform_owner'::public.platform_role, 'platform_admin'::public.platform_role, 'platform_support'::public.platform_role]) AS has_platform_role));


--
-- PostgreSQL database dump complete
--

\unrestrict WeCePo1aejI6tGdoqEHlqmVodcZqPke1NtCdZOnSq1p4IyPtPi4kcqbXO3MagEW

