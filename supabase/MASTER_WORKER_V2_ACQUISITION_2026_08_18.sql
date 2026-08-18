-- ============================================================================
-- FadeUp — MASTER: Worker V2 / Platform Acquisition Intelligence
-- Generated 2026-08-18. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-sql.sh
-- Verify in sync:   scripts/generate-master-sql.sh --check
--
-- WHAT THIS IS
--   The ordered, effective SQL required to upgrade the CURRENT FadeUp
--   database with ONLY the Worker V2 / Platform acquisition changes:
--   competitor intelligence, the prospect feature store, dual scoring,
--   segmentation, locale resolution, the adaptive search planner,
--   approved-template outreach, the WhatsApp Business Cloud API surface,
--   A/B experimentation, and the machine-learning registry.
--
--   It is a byte-for-byte concatenation of these version-controlled
--   migrations, which remain the source of truth:
--     db/migrations/20260818100000_prospect_competitor_intelligence.sql
--     db/migrations/20260818100100_prospect_outreach_whatsapp_ml.sql
--
--   No fix exists only here. If something must change, change the
--   migration and regenerate.
--
-- WHAT THIS IS NOT
--   It does not create the base FadeUp schema. It assumes the existing
--   database already has: the `private` and `extensions` schemas,
--   public.set_updated_at(), public.platform_members and the
--   private.is_platform_admin()/has_platform_role() helpers, the
--   prospect_worker role, and the prospect_* tables from
--   20260811150100 / 20260811150200.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back. There is no partially-upgraded state.
--   * Contains no DROP TABLE, no TRUNCATE, no DROP FUNCTION ... CASCADE,
--     no mass DELETE, and never disables row level security.
--   * Idempotent: every object is created IF NOT EXISTS or via a guarded
--     DO block, so re-running is safe.
--   * The one DROP CONSTRAINT is prospect_jobs_job_type_check, replaced
--     in the same statement block by a SUPERSET that still admits every
--     previously-valid value — no existing row can be invalidated.
--
-- HOW TO APPLY
--   Review first, then run against the target database as a role that can
--   create objects in `public` and `private` (postgres in the self-hosted
--   Supabase stack):
--
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_WORKER_V2_ACQUISITION_2026_08_18.sql
--
--   Then run the companion verification script and confirm zero
--   unexpected FAIL rows:
--
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260818100000_prospect_competitor_intelligence.sql
-- ============================================================================

-- FadeUp — Prospect Worker V2 / Platform Acquisition Intelligence
-- Migration: competitor (booking-provider) intelligence, prospect features
-- with tri-state semantics, data quality, dual scoring, segmentation,
-- locale resolution, and the adaptive search planner.
--
-- EXTENDS the existing acquisition schema created by
--   20260811150100_prospect_acquisition_schema.sql  (prospects + provenance)
--   20260811150200_prospect_job_queue.sql           (jobs + api budgets)
-- It does not replace or redesign any of it. Every posture decision below
-- deliberately matches that migration's header:
--   * FadeUp's OWN internal acquisition data — no organization_id, and a
--     prospect is NEVER a public marketplace/bookable entity. Nothing here
--     grants anon or an ordinary authenticated barber/customer any access.
--   * SELECT -> any platform role (owner/admin/support)
--     INSERT/UPDATE/DELETE -> platform_owner/platform_admin only
--     ALL -> prospect_worker on the tables the Worker itself produces
--   * FORCE ROW LEVEL SECURITY on every table, so even the owning role is
--     not implicitly exempt.
--
-- Idempotent: safe to re-run.

-- ============================================================================
-- 1. Enums
-- ============================================================================

-- Tri-state (plus not-applicable) truth for every derived feature. The
-- whole point: "the website crawl timed out" must never be recorded as
-- "this business has no online booking". Missing data is UNKNOWN, and
-- scoring/ML treat UNKNOWN as its own category, never as false.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_tribool') then
    create type public.prospect_tribool as enum ('TRUE', 'FALSE', 'UNKNOWN', 'NOT_APPLICABLE');
  end if;
end $$;

comment on type public.prospect_tribool is
  'TRUE/FALSE/UNKNOWN/NOT_APPLICABLE. UNKNOWN means "not observed" and is NEVER equivalent to FALSE — see private.tribool_is_true()/tribool_is_false() and the feature-engineering section of docs/worker-v2/acquisition-intelligence.md.';

-- How an identity-resolution decision was reached. Mirrors the states the
-- spec requires so an ambiguous merge is reviewable from /platform rather
-- than silently applied.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_identity_match_state') then
    create type public.prospect_identity_match_state as enum ('MATCHED', 'POSSIBLE_MATCH', 'REVIEW_REQUIRED', 'NOT_MATCHED');
  end if;
end $$;

-- Competitor/booking-provider taxonomy. Deliberately an enum-free TEXT key
-- constrained by a foreign key to public.booking_providers instead: the
-- spec requires this list be extensible/configurable from /platform, and a
-- Postgres enum cannot have values removed or renamed safely.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'booking_provider_detection_method') then
    create type public.booking_provider_detection_method as enum (
      'booking_url',
      'outbound_link',
      'embedded_widget',
      'iframe_domain',
      'script_domain',
      'booking_button_target',
      'structured_data',
      'domain_pattern',
      'provider_directory',
      'manual_override'
    );
  end if;
end $$;

comment on type public.booking_provider_detection_method is
  'How a booking-provider observation was obtained. Every value here corresponds to a compliant, publicly-accessible signal — no value describes bypassing a login, CAPTCHA or anti-bot control (see docs/worker-v2/competitor-intelligence.md).';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_locale_source') then
    create type public.prospect_locale_source as enum (
      'verified_business_country',
      'business_address',
      'website_language',
      'provider_locale',
      'phone_country',
      'dominant_website_language',
      'manual_override',
      'default_fallback'
    );
  end if;
end $$;

comment on type public.prospect_locale_source is
  'Evidence that determined a prospect''s locale, in the spec''s priority order. Business NAME is deliberately absent — a name is never sufficient evidence of language.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_search_partition_status') then
    create type public.prospect_search_partition_status as enum ('planned', 'running', 'completed', 'saturated', 'subdivided', 'skipped', 'failed');
  end if;
end $$;

-- ============================================================================
-- 2. Tri-state helpers
-- ============================================================================
-- Used by scoring/segmentation SQL and by VERIFY. Keeping these as
-- functions (rather than inlining `= 'TRUE'` everywhere) is what makes the
-- "UNKNOWN is not FALSE" rule mechanically enforceable and greppable.

create or replace function private.tribool_is_true(p_value public.prospect_tribool)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_value = 'TRUE';
$$;

create or replace function private.tribool_is_false(p_value public.prospect_tribool)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_value = 'FALSE';
$$;

create or replace function private.tribool_is_known(p_value public.prospect_tribool)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_value in ('TRUE', 'FALSE');
$$;

comment on function private.tribool_is_true(public.prospect_tribool) is
  'Strictly TRUE. UNKNOWN and NOT_APPLICABLE are not true — and, critically, their negation is not false either: use tribool_is_false() for that, never NOT tribool_is_true().';

revoke execute on function private.tribool_is_true(public.prospect_tribool) from public, anon;
revoke execute on function private.tribool_is_false(public.prospect_tribool) from public, anon;
revoke execute on function private.tribool_is_known(public.prospect_tribool) from public, anon;
grant execute on function private.tribool_is_true(public.prospect_tribool) to authenticated, prospect_worker;
grant execute on function private.tribool_is_false(public.prospect_tribool) to authenticated, prospect_worker;
grant execute on function private.tribool_is_known(public.prospect_tribool) to authenticated, prospect_worker;

-- ============================================================================
-- 3. booking_providers — the competitor registry
-- ============================================================================
-- A configurable registry rather than a hardcoded enum, per spec §10
-- ("this list must be extensible/configurable"). `signatures` holds the
-- maintainable detection signature set (domains/path patterns) so the
-- Worker's competitor detector has ONE source of truth instead of regexes
-- scattered through the codebase — the Worker reads this table at startup
-- and falls back to its bundled copy if the DB is unreachable.
create table if not exists public.booking_providers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[A-Z0-9_]+$'),
  display_name text not null check (btrim(display_name) <> ''),
  homepage_url text,
  -- Markets where this provider is commercially relevant; informational,
  -- used by /platform to sort the competitor board by region.
  primary_markets text[] not null default '{}'::text[],
  -- Detection signatures: {"domains": ["planity.com"], "path_patterns": ["/booking/"]}.
  -- Never contains executable content — matched literally/by anchored
  -- regex in the Worker, never eval'd.
  signatures jsonb not null default '{}'::jsonb,
  -- True for the two sentinel rows (NO_BOOKING / UNKNOWN) that are states
  -- rather than actual products. Kept as rows so observations, analytics
  -- and segment joins have a uniform shape.
  is_sentinel boolean not null default false,
  -- Whether a compliant public discovery surface (official API or openly
  -- accessible listing) exists for finding businesses ON this provider.
  -- NULL = not yet assessed. FALSE = assessed and none exists; the Worker
  -- must then rely on website-based detection only and must NOT attempt a
  -- bypass. See docs/worker-v2/competitor-intelligence.md.
  supports_compliant_discovery boolean,
  discovery_notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.booking_providers is
  'Competitor/booking-provider registry (Planity, Booksy, Fresha, ...) plus the NO_BOOKING/UNKNOWN sentinels. signatures is the single maintainable detection-signature source; supports_compliant_discovery=false means website detection only — never an anti-bot bypass.';

comment on column public.booking_providers.supports_compliant_discovery is
  'NULL = unassessed, TRUE = a compliant official API/public listing exists and may be used as a discovery source, FALSE = assessed and none exists; provider discovery stays unsupported and only website-based detection applies.';

drop trigger if exists booking_providers_set_updated_at on public.booking_providers;
create trigger booking_providers_set_updated_at
  before update on public.booking_providers
  for each row execute function public.set_updated_at();

-- Seed. `signatures` here is the initial registry; platform_admin can edit
-- it from /platform without a deploy. Path patterns are intentionally
-- conservative — a bare domain mention in a blog post should not brand a
-- business as a competitor customer, so the Worker requires the domain to
-- appear in a link/script/iframe target (see confidence rules in the
-- Worker's competitor detector), not merely anywhere in the page text.
insert into public.booking_providers (key, display_name, homepage_url, primary_markets, signatures, is_sentinel, supports_compliant_discovery, discovery_notes) values
  ('PLANITY', 'Planity', 'https://www.planity.com', array['FR', 'BE', 'DE'],
   '{"domains": ["planity.com", "planity.fr"], "path_patterns": ["/booking", "/rendez-vous"]}'::jsonb, false, null,
   'No official public discovery API assessed. Website-based detection only until a compliant surface is confirmed.'),
  ('BOOKSY', 'Booksy', 'https://booksy.com', array['PL', 'US', 'GB', 'ES', 'FR'],
   '{"domains": ["booksy.com", "booksy.net"], "path_patterns": ["/b/", "/instant-experiences"]}'::jsonb, false, null,
   'No official public discovery API assessed. Website-based detection only.'),
  ('FRESHA', 'Fresha', 'https://www.fresha.com', array['GB', 'US', 'AU', 'FR'],
   '{"domains": ["fresha.com", "shedul.com"], "path_patterns": ["/a/", "/book"]}'::jsonb, false, null,
   'No official public discovery API assessed. Website-based detection only.'),
  ('TREATWELL', 'Treatwell', 'https://www.treatwell.co.uk', array['GB', 'FR', 'IT', 'ES', 'NL'],
   '{"domains": ["treatwell.co.uk", "treatwell.fr", "treatwell.com", "treatwell.it", "treatwell.es", "treatwell.nl"], "path_patterns": ["/place/"]}'::jsonb, false, null,
   'No official public discovery API assessed. Website-based detection only.'),
  ('KIUTE', 'Kiute', 'https://www.kiute.com', array['FR'],
   '{"domains": ["kiute.com", "kiutepro.com", "flexy.fr"], "path_patterns": []}'::jsonb, false, null, null),
  ('RESERVIO', 'Reservio', 'https://www.reservio.com', array['CZ', 'FR', 'DE'],
   '{"domains": ["reservio.com"], "path_patterns": []}'::jsonb, false, null, null),
  ('SUMUP_BOOKINGS', 'SumUp Bookings', 'https://www.sumup.com', array['FR', 'GB', 'DE'],
   '{"domains": ["bookings.sumup.com", "sumup.link"], "path_patterns": []}'::jsonb, false, null, null),
  ('SQUIRE', 'SQUIRE', 'https://getsquire.com', array['US', 'GB', 'CA'],
   '{"domains": ["getsquire.com", "squire.com"], "path_patterns": ["/booking"]}'::jsonb, false, null, null),
  ('PHOREST', 'Phorest', 'https://www.phorest.com', array['IE', 'GB', 'US', 'DE'],
   '{"domains": ["phorest.com", "phorest.me"], "path_patterns": []}'::jsonb, false, null, null),
  ('SALONIZED', 'Salonized', 'https://www.salonized.com', array['NL', 'BE', 'DE'],
   '{"domains": ["salonized.com"], "path_patterns": []}'::jsonb, false, null, null),
  ('TIMIFY', 'TIMIFY', 'https://www.timify.com', array['DE', 'GB', 'ES'],
   '{"domains": ["timify.com"], "path_patterns": []}'::jsonb, false, null, null),
  ('TIMELY', 'Timely', 'https://www.gettimely.com', array['NZ', 'AU', 'GB'],
   '{"domains": ["gettimely.com", "timelyapp.com"], "path_patterns": []}'::jsonb, false, null, null),
  ('CUSTOM_BOOKING', 'Custom / in-house booking', null, array[]::text[],
   '{"domains": [], "path_patterns": ["/booking", "/reservation", "/rendez-vous", "/prendre-rdv", "/book-now"]}'::jsonb, false, null,
   'Matched when a booking affordance exists on the business''s own domain and no known third-party provider signature is present.'),
  ('OTHER', 'Other provider', null, array[]::text[], '{}'::jsonb, false, null,
   'A booking provider was observed but does not match any registered signature. Review from /platform and either add a registry row or reclassify.'),
  ('NO_BOOKING', 'No online booking', null, array[]::text[], '{}'::jsonb, true, null,
   'SENTINEL. Only assigned after a SUCCESSFUL enrichment that found no booking affordance — never after a failed/timed-out crawl (that is UNKNOWN).'),
  ('UNKNOWN', 'Unknown', null, array[]::text[], '{}'::jsonb, true, null,
   'SENTINEL. Not yet determined. Explicitly NOT equivalent to NO_BOOKING — see spec §10.')
on conflict (key) do nothing;

create index if not exists booking_providers_active_idx on public.booking_providers (is_active) where is_active;

-- ============================================================================
-- 4. booking_provider_observations — historical competitor state
-- ============================================================================
-- Append-only observation log, per spec §13: we never store a flat
-- `uses_planity = true`. A prospect that moves Planity -> Booksy -> FadeUp
-- leaves three observation rows, which is exactly what makes migration
-- intelligence (and later, competitor-tenure ML features) possible.
create table if not exists public.booking_provider_observations (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  provider_id uuid not null references public.booking_providers (id),
  detection_method public.booking_provider_detection_method not null,
  -- The literal signal observed (a URL, a script src, an iframe host).
  -- Bounded so a pathological page cannot bloat the table.
  evidence text check (evidence is null or length(evidence) <= 2000),
  evidence_url text check (evidence_url is null or length(evidence_url) <= 2000),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  observed_at timestamptz not null default now(),
  job_id uuid references public.prospect_jobs (id) on delete set null,
  -- Set by trigger, never by the writer: exactly one row per
  -- (prospect, provider) pair is `is_current`.
  is_current boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.booking_provider_observations is
  'Append-only history of which booking product a prospect was observed using, with evidence + confidence. Never collapsed into a single boolean — see spec §13 (migration intelligence depends on the history).';

create index if not exists booking_provider_observations_prospect_idx
  on public.booking_provider_observations (prospect_id, observed_at desc);
create index if not exists booking_provider_observations_provider_idx
  on public.booking_provider_observations (provider_id, observed_at desc);
create unique index if not exists booking_provider_observations_one_current
  on public.booking_provider_observations (prospect_id, provider_id)
  where is_current;

-- Collapses repeated identical detections into first_seen/last_seen on the
-- current row rather than an unbounded stream of duplicates, while still
-- creating a NEW row (and retiring the old one) whenever the observed
-- provider actually changes.
--
-- MUST be a BEFORE trigger: booking_provider_observations_one_current is a
-- (non-deferrable) partial unique index, so it is enforced as the row is
-- inserted — an AFTER trigger would never get the chance to tidy up,
-- because the insert itself would already have failed. Doing the work here
-- and returning NULL cancels the redundant insert entirely.
--
-- SECURITY DEFINER because both the Worker role and platform staff write
-- here through different grant sets.
create or replace function private.booking_provider_observations_maintain_current()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.booking_provider_observations;
begin
  select * into v_previous
  from public.booking_provider_observations
  where prospect_id = new.prospect_id
    and provider_id = new.provider_id
    and is_current
  limit 1;

  if found then
    -- Same provider seen again: keep ONE current row and extend its
    -- observation window instead of appending a duplicate. The insert is
    -- cancelled (return null), so the caller sees no new row.
    update public.booking_provider_observations
    set last_seen_at = greatest(v_previous.last_seen_at, new.observed_at),
        confidence = greatest(v_previous.confidence, new.confidence),
        evidence = coalesce(new.evidence, v_previous.evidence),
        evidence_url = coalesce(new.evidence_url, v_previous.evidence_url),
        detection_method = new.detection_method
    where id = v_previous.id;

    return null;
  end if;

  -- A DIFFERENT provider became current: retire every other current row
  -- for this prospect. The retired rows stay — that IS the history the
  -- migration-intelligence features are built from.
  update public.booking_provider_observations
  set is_current = false
  where prospect_id = new.prospect_id
    and is_current;

  return new;
end;
$$;

drop trigger if exists booking_provider_observations_maintain_current on public.booking_provider_observations;
create trigger booking_provider_observations_maintain_current
  before insert on public.booking_provider_observations
  for each row
  when (new.is_current)
  execute function private.booking_provider_observations_maintain_current();

-- ============================================================================
-- 5. prospect_identity_matches — auditable entity resolution
-- ============================================================================
-- The existing schema already has public.prospect_duplicates (human review
-- queue for fuzzy pairs). This table is the complementary AUDIT record:
-- every identity decision the Worker makes — including the confident
-- auto-links that never reach the review queue — with the rule that
-- produced it. Spec §9 requires the matched attributes, rule and confidence
-- be stored, not just the outcome.
create table if not exists public.prospect_identity_matches (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  candidate_prospect_id uuid references public.prospects (id) on delete cascade,
  source_key text,
  source_external_id text,
  state public.prospect_identity_match_state not null,
  matching_rule text not null check (btrim(matching_rule) <> ''),
  matched_attributes jsonb not null default '{}'::jsonb,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  rules_version text not null default 'identity-v2',
  merge_applied boolean not null default false,
  decided_at timestamptz not null default now(),
  job_id uuid references public.prospect_jobs (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint prospect_identity_matches_not_self check (
    candidate_prospect_id is null or candidate_prospect_id <> prospect_id
  ),
  -- REVIEW_REQUIRED/POSSIBLE_MATCH must never claim a merge was applied:
  -- an ambiguous match is exactly the case the spec says a human resolves.
  constraint prospect_identity_matches_merge_only_when_matched check (
    not merge_applied or state = 'MATCHED'
  )
);

comment on table public.prospect_identity_matches is
  'Audit trail for every identity-resolution decision (matched attributes + rule + confidence + version), including confident auto-links. REVIEW_REQUIRED/POSSIBLE_MATCH rows surface in /platform; they can never carry merge_applied = true.';

create index if not exists prospect_identity_matches_prospect_idx on public.prospect_identity_matches (prospect_id, decided_at desc);
create index if not exists prospect_identity_matches_state_idx on public.prospect_identity_matches (state) where state in ('POSSIBLE_MATCH', 'REVIEW_REQUIRED');

-- ============================================================================
-- 6. prospect_features — versioned, evidence-bearing feature store
-- ============================================================================
-- One row per (prospect, feature_key, feature_version). Every feature keeps
-- its value, evidence, observation time and confidence, per spec §16.
-- Values are split by kind so booleans genuinely get tri-state semantics
-- rather than a nullable boolean that reads as "false" in every naive
-- query.
create table if not exists public.prospect_features (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  feature_key text not null check (feature_key ~ '^[a-z0-9_]+$'),
  feature_version text not null default 'v1',
  value_bool public.prospect_tribool,
  value_numeric numeric,
  value_text text,
  -- Where the value came from: a source key, 'website', 'computed', ...
  evidence_source text,
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  observed_at timestamptz not null default now(),
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exactly one value slot is populated — otherwise "which column is the
  -- feature?" becomes ambiguous for the ML dataset builder.
  constraint prospect_features_single_value check (
    (value_bool is not null)::int + (value_numeric is not null)::int + (value_text is not null)::int = 1
  )
);

comment on table public.prospect_features is
  'Versioned feature store, one row per (prospect, feature_key, feature_version). Boolean features use public.prospect_tribool so "not observed" (UNKNOWN) is never conflated with "observed absent" (FALSE) — see spec §17.';

create unique index if not exists prospect_features_unique
  on public.prospect_features (prospect_id, feature_key, feature_version);
create index if not exists prospect_features_key_idx on public.prospect_features (feature_key, feature_version);
create index if not exists prospect_features_prospect_idx on public.prospect_features (prospect_id);

drop trigger if exists prospect_features_set_updated_at on public.prospect_features;
create trigger prospect_features_set_updated_at
  before update on public.prospect_features
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 7. prospect_data_quality
-- ============================================================================
create table if not exists public.prospect_data_quality (
  prospect_id uuid primary key references public.prospects (id) on delete cascade,
  identity_completeness numeric(5, 4) not null default 0 check (identity_completeness between 0 and 1),
  contact_completeness numeric(5, 4) not null default 0 check (contact_completeness between 0 and 1),
  digital_completeness numeric(5, 4) not null default 0 check (digital_completeness between 0 and 1),
  source_count int not null default 0 check (source_count >= 0),
  source_agreement numeric(5, 4) check (source_agreement is null or source_agreement between 0 and 1),
  conflict_count int not null default 0 check (conflict_count >= 0),
  enrichment_success public.prospect_tribool not null default 'UNKNOWN',
  data_freshness_days numeric,
  overall_confidence numeric(5, 4) not null default 0 check (overall_confidence between 0 and 1),
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prospect_data_quality is
  'Per-prospect data-quality snapshot surfaced in /platform. enrichment_success is tri-state: a crawl that never ran is UNKNOWN, not a failure.';

drop trigger if exists prospect_data_quality_set_updated_at on public.prospect_data_quality;
create trigger prospect_data_quality_set_updated_at
  before update on public.prospect_data_quality
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 8. Dual scoring — FadeUp fit + migration potential
-- ============================================================================
-- The existing public.prospect_scores stays exactly as it is (the V1
-- deterministic opportunity score, still written by the Worker and still
-- feeding prospects.current_score). This adds the two NEW, distinct scores
-- the spec requires, deliberately in their OWN table so migration potential
-- is never averaged into general fit (spec §20: "Do NOT mix this with
-- general opportunity score").
do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_fit_class') then
    create type public.prospect_fit_class as enum ('HOT', 'WARM', 'COLD');
  end if;
end $$;

create table if not exists public.prospect_fit_scores (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  -- 'fadeup_fit' | 'migration_potential'. TEXT + check rather than an enum
  -- so a third score can be added without an enum migration.
  score_kind text not null check (score_kind in ('fadeup_fit', 'migration_potential')),
  score int not null check (score between 0 and 100),
  classification public.prospect_fit_class not null,
  -- [{group, factor, points, max_points, explanation}, ...]. Every point
  -- awarded must appear here — spec §19 "Do not assign points without
  -- explicit rules".
  breakdown jsonb not null default '[]'::jsonb,
  ruleset_version text not null,
  scored_at timestamptz not null default now(),
  job_id uuid references public.prospect_jobs (id) on delete set null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.prospect_fit_scores is
  'Append-only history of the two distinct deterministic scores: fadeup_fit (general opportunity) and migration_potential (switch-from-competitor value). Kept apart on purpose — see spec §20.';

create index if not exists prospect_fit_scores_prospect_idx on public.prospect_fit_scores (prospect_id, score_kind, scored_at desc);
create unique index if not exists prospect_fit_scores_one_current
  on public.prospect_fit_scores (prospect_id, score_kind)
  where is_current;
create index if not exists prospect_fit_scores_kind_score_idx on public.prospect_fit_scores (score_kind, score desc);

-- Retires the previous current row for the same (prospect, kind) so the
-- partial unique index above always holds without the writer having to run
-- a two-statement dance. BEFORE, not AFTER, for the same reason as
-- booking_provider_observations_maintain_current(): the partial unique
-- index is checked during the insert, so an AFTER trigger would fire only
-- after the constraint had already rejected the row.
create or replace function private.prospect_fit_scores_maintain_current()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.prospect_fit_scores
  set is_current = false
  where prospect_id = new.prospect_id
    and score_kind = new.score_kind
    and is_current;
  return new;
end;
$$;

drop trigger if exists prospect_fit_scores_maintain_current on public.prospect_fit_scores;
create trigger prospect_fit_scores_maintain_current
  before insert on public.prospect_fit_scores
  for each row
  when (new.is_current)
  execute function private.prospect_fit_scores_maintain_current();

-- Configurable ruleset weights, editable by platform_owner/admin from
-- /platform (spec §19 "Rules should be configurable from Platform where
-- appropriate"). The Worker reads the active row and stamps its version on
-- every score it writes; if no row is active it falls back to its bundled
-- defaults and stamps THAT version, so a score is never unattributable.
create table if not exists public.prospect_score_rulesets (
  id uuid primary key default gen_random_uuid(),
  score_kind text not null check (score_kind in ('fadeup_fit', 'migration_potential')),
  version text not null,
  weights jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (score_kind, version)
);

create unique index if not exists prospect_score_rulesets_one_active
  on public.prospect_score_rulesets (score_kind)
  where is_active;

drop trigger if exists prospect_score_rulesets_set_updated_at on public.prospect_score_rulesets;
create trigger prospect_score_rulesets_set_updated_at
  before update on public.prospect_score_rulesets
  for each row execute function public.set_updated_at();

comment on table public.prospect_score_rulesets is
  'Operator-editable scoring weights. Exactly one active ruleset per score_kind; the Worker stamps prospect_fit_scores.ruleset_version with whatever it actually used (DB row or its bundled default).';

-- ============================================================================
-- 9. prospect_segments
-- ============================================================================
-- A prospect may belong to many segments simultaneously (spec §21), so this
-- is a membership table, not a column on prospects.
create table if not exists public.prospect_segments (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  segment_key text not null check (segment_key ~ '^[A-Z0-9_]+$'),
  -- Why the prospect qualified — keeps segmentation explainable in the
  -- same way scores are.
  rationale jsonb not null default '{}'::jsonb,
  segmenter_version text not null default 'segments-v1',
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (prospect_id, segment_key)
);

comment on table public.prospect_segments is
  'Multi-membership acquisition segments (NO_BOOKING, COMPETITOR_USER, HIGH_MIGRATION_POTENTIAL, REVIEW_REQUIRED, ...). Recomputed by the Worker''s segmentation step; rationale explains each membership.';

create index if not exists prospect_segments_key_idx on public.prospect_segments (segment_key);
create index if not exists prospect_segments_prospect_idx on public.prospect_segments (prospect_id);

-- Reference list, so /platform can render the full segment board (including
-- segments with zero members) rather than only what happens to exist.
create table if not exists public.prospect_segment_definitions (
  key text primary key check (key ~ '^[A-Z0-9_]+$'),
  display_name text not null,
  description text not null,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

insert into public.prospect_segment_definitions (key, display_name, description, sort_order) values
  ('NO_BOOKING', 'No online booking', 'Enrichment succeeded and found no booking affordance. Never assigned on an UNKNOWN/failed crawl.', 10),
  ('COMPETITOR_USER', 'Competitor user', 'Currently observed on a known third-party booking provider.', 20),
  ('COMPETITOR_SWITCH_HIGH', 'High switch candidate', 'Competitor user with a migration_potential score of 70 or above.', 30),
  ('INDEPENDENT_BARBER', 'Independent barber', 'Prospect type is independent_barber.', 40),
  ('MULTI_BARBER_SHOP', 'Multi-barber shop', 'Evidence of two or more barbers at the business.', 50),
  ('HIGH_REPUTATION', 'High reputation', 'Strong rating combined with meaningful review volume.', 60),
  ('HIGH_DIGITAL_GAP', 'High digital gap', 'Material gap between business value and digital maturity.', 70),
  ('HIGH_FADEUP_FIT', 'High FadeUp fit', 'fadeup_fit score of 70 or above.', 80),
  ('HIGH_MIGRATION_POTENTIAL', 'High migration potential', 'migration_potential score of 70 or above.', 90),
  ('REVIEW_REQUIRED', 'Review required', 'An ambiguous identity match or locale determination needs a human decision.', 100)
on conflict (key) do nothing;

-- ============================================================================
-- 10. Locale resolution
-- ============================================================================
-- Deterministic, evidence-ordered locale detection (spec §22). Stored on
-- its own table rather than as prospects columns so the manual override
-- and the machine determination are separable and auditable.
create table if not exists public.prospect_locales (
  prospect_id uuid primary key references public.prospects (id) on delete cascade,
  detected_country text check (detected_country is null or detected_country ~ '^[A-Z]{2}$'),
  detected_language text check (detected_language is null or detected_language ~ '^[a-z]{2}$'),
  locale text check (locale is null or locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  language_source public.prospect_locale_source,
  language_confidence numeric(4, 3) check (language_confidence is null or language_confidence between 0 and 1),
  language_review_required boolean not null default false,
  -- Human override always wins over detection and is never overwritten by
  -- a later Worker pass (enforced in private.set_prospect_locale).
  override_locale text check (override_locale is null or override_locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  override_by uuid references auth.users (id) on delete set null,
  override_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prospect_locales is
  'Deterministic locale determination + optional human override. language_review_required = true when evidence was ambiguous; outreach template selection treats an unresolved locale as a hard block, never a guess.';

drop trigger if exists prospect_locales_set_updated_at on public.prospect_locales;
create trigger prospect_locales_set_updated_at
  before update on public.prospect_locales
  for each row execute function public.set_updated_at();

-- The effective locale for every downstream decision (template selection,
-- analytics, ML features). Override wins; otherwise the detected locale;
-- otherwise NULL, which callers must treat as "cannot send", not "use the
-- default language".
create or replace function public.prospect_effective_locale(p_prospect_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pl.override_locale, pl.locale)
  from public.prospect_locales pl
  where pl.prospect_id = p_prospect_id;
$$;

comment on function public.prospect_effective_locale(uuid) is
  'Override locale if a human set one, else the detected locale, else NULL. NULL means outreach must be BLOCKED — never silently defaulted to fr-FR/en-GB (spec §25).';

revoke execute on function public.prospect_effective_locale(uuid) from public, anon;
grant execute on function public.prospect_effective_locale(uuid) to authenticated, prospect_worker;

-- ============================================================================
-- 11. Adaptive search planner
-- ============================================================================
-- A search is a tree of partitions. The planner subdivides a partition only
-- when it looks SATURATED (the provider returned a full page, so results
-- were likely truncated); a low-yield partition is completed, not split
-- further (spec §7). Hard limits live on the search row so a runaway plan
-- is impossible even if the Worker has a bug.
create table if not exists public.prospect_searches (
  id uuid primary key default gen_random_uuid(),
  label text,
  country text not null check (country ~ '^[A-Z]{2}$'),
  region text,
  city text,
  postal_code text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  radius_km numeric check (radius_km is null or radius_km > 0),
  entity_type text not null default 'both' check (entity_type in ('barbershop', 'independent_barber', 'both')),
  keywords text[] not null default '{}'::text[],
  source_keys text[] not null default '{}'::text[],
  max_results int check (max_results is null or max_results > 0),
  -- Hard limits (spec §7). Defaults are conservative on purpose.
  max_depth int not null default 3 check (max_depth between 0 and 8),
  max_partitions int not null default 200 check (max_partitions between 1 and 5000),
  max_requests int not null default 2000 check (max_requests between 1 and 100000),
  max_runtime_seconds int not null default 3600 check (max_runtime_seconds between 30 and 86400),
  status text not null default 'planned' check (status in ('planned', 'running', 'completed', 'cancelled', 'failed', 'limit_reached')),
  planner_version text not null default 'planner-v1',
  totals jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prospect_searches is
  'A planned multi-provider, multi-partition acquisition search. The max_* columns are hard stops enforced by the Worker''s planner and re-asserted here as the operator-visible contract.';

create index if not exists prospect_searches_status_idx on public.prospect_searches (status);
create index if not exists prospect_searches_created_at_idx on public.prospect_searches (created_at desc);

drop trigger if exists prospect_searches_set_updated_at on public.prospect_searches;
create trigger prospect_searches_set_updated_at
  before update on public.prospect_searches
  for each row execute function public.set_updated_at();

create table if not exists public.prospect_search_partitions (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.prospect_searches (id) on delete cascade,
  parent_partition_id uuid references public.prospect_search_partitions (id) on delete cascade,
  source_key text not null,
  query text,
  -- Geographic cell this partition covers.
  country text not null check (country ~ '^[A-Z]{2}$'),
  region text,
  city text,
  postal_code text,
  center_latitude double precision check (center_latitude is null or center_latitude between -90 and 90),
  center_longitude double precision check (center_longitude is null or center_longitude between -180 and 180),
  radius_km numeric check (radius_km is null or radius_km > 0),
  depth int not null default 0 check (depth >= 0),
  status public.prospect_search_partition_status not null default 'planned',
  raw_results int not null default 0 check (raw_results >= 0),
  unique_results int not null default 0 check (unique_results >= 0),
  duplicate_results int not null default 0 check (duplicate_results >= 0),
  -- Saturated = the provider likely truncated the result set for this
  -- cell, so subdividing is warranted.
  saturated boolean not null default false,
  requests int not null default 0 check (requests >= 0),
  retries int not null default 0 check (retries >= 0),
  duration_ms int check (duration_ms is null or duration_ms >= 0),
  -- Only populated where a provider's pricing is actually knowable; NULL
  -- rather than a fabricated number otherwise.
  estimated_cost_usd numeric(12, 6) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  job_id uuid references public.prospect_jobs (id) on delete set null,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospect_search_partitions_parent_not_self check (parent_partition_id is null or parent_partition_id <> id)
);

comment on table public.prospect_search_partitions is
  'One node of a search plan tree. estimated_cost_usd is NULL where a provider''s per-request price is not knowable — never a fabricated figure (spec §7 "estimated external cost where measurable").';

create index if not exists prospect_search_partitions_search_idx on public.prospect_search_partitions (search_id, depth);
create index if not exists prospect_search_partitions_parent_idx on public.prospect_search_partitions (parent_partition_id) where parent_partition_id is not null;
create index if not exists prospect_search_partitions_status_idx on public.prospect_search_partitions (status);

drop trigger if exists prospect_search_partitions_set_updated_at on public.prospect_search_partitions;
create trigger prospect_search_partitions_set_updated_at
  before update on public.prospect_search_partitions
  for each row execute function public.set_updated_at();

-- Enforces max_partitions in the database, not only in Worker code: a bug
-- in the planner cannot produce an unbounded tree.
create or replace function private.prospect_search_partitions_enforce_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search public.prospect_searches;
  v_count int;
begin
  select * into v_search from public.prospect_searches where id = new.search_id;
  if not found then
    raise exception 'prospect_search_partitions: search % does not exist', new.search_id;
  end if;

  if new.depth > v_search.max_depth then
    raise exception 'prospect_search_partitions: depth % exceeds search max_depth %', new.depth, v_search.max_depth
      using errcode = 'check_violation';
  end if;

  select count(*) into v_count from public.prospect_search_partitions where search_id = new.search_id;
  if v_count >= v_search.max_partitions then
    raise exception 'prospect_search_partitions: search % already has its maximum of % partitions', new.search_id, v_search.max_partitions
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists prospect_search_partitions_enforce_limits on public.prospect_search_partitions;
create trigger prospect_search_partitions_enforce_limits
  before insert on public.prospect_search_partitions
  for each row execute function private.prospect_search_partitions_enforce_limits();

-- ============================================================================
-- 12. Extend prospect_jobs with the new job types
-- ============================================================================
-- The existing CHECK constraint enumerates job_type. Replace it (not the
-- table) with the superset — every previously-valid value is still valid,
-- so no existing row can be invalidated.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'prospect_jobs_job_type_check'
      and conrelid = 'public.prospect_jobs'::regclass
  ) then
    alter table public.prospect_jobs drop constraint prospect_jobs_job_type_check;
  end if;

  alter table public.prospect_jobs
    add constraint prospect_jobs_job_type_check check (job_type in (
      -- Pre-existing (20260811150200) — unchanged.
      'discovery', 'enrichment', 'dedup_scan', 'scoring', 'website_crawl', 'instagram_enrich',
      -- Worker V2 acquisition-intelligence pipeline.
      'search_plan', 'identity_resolution', 'competitor_detection', 'website_enrichment',
      'feature_computation', 'fit_scoring', 'segmentation', 'locale_resolution', 'data_quality',
      -- Outreach + data science (tables in the next migration).
      'ml_prediction', 'outreach_preparation', 'whatsapp_send', 'outcome_processing'
    ));
end $$;

-- Link jobs to the search that produced them, for the planner's own
-- bookkeeping and for /platform's search detail view.
alter table public.prospect_jobs
  add column if not exists search_id uuid references public.prospect_searches (id) on delete set null;
alter table public.prospect_jobs
  add column if not exists partition_id uuid references public.prospect_search_partitions (id) on delete set null;

create index if not exists prospect_jobs_search_id_idx on public.prospect_jobs (search_id) where search_id is not null;

-- ============================================================================
-- 13. Extend prospects with the acquisition-intelligence denormalizations
-- ============================================================================
-- Denormalized caches only — each has an authoritative table above. They
-- exist so list/filter screens (spec §49) do not need correlated
-- subqueries per row. Kept in sync by the triggers below.
alter table public.prospects
  add column if not exists current_booking_provider_id uuid references public.booking_providers (id) on delete set null;
alter table public.prospects
  add column if not exists fadeup_fit_score int check (fadeup_fit_score is null or fadeup_fit_score between 0 and 100);
alter table public.prospects
  add column if not exists fadeup_fit_class public.prospect_fit_class;
alter table public.prospects
  add column if not exists migration_potential_score int check (migration_potential_score is null or migration_potential_score between 0 and 100);
alter table public.prospects
  add column if not exists migration_potential_class public.prospect_fit_class;
-- Business signals used by both scores and by the ML dataset. Nullable on
-- purpose: NULL is "unknown", and no scoring rule may treat it as zero.
alter table public.prospects
  add column if not exists rating numeric(3, 2) check (rating is null or rating between 0 and 5);
alter table public.prospects
  add column if not exists review_count int check (review_count is null or review_count >= 0);
alter table public.prospects
  add column if not exists estimated_barber_count int check (estimated_barber_count is null or estimated_barber_count >= 0);

comment on column public.prospects.current_booking_provider_id is
  'Denormalized cache of the current booking_provider_observations row. NULL means never assessed — semantically UNKNOWN, never NO_BOOKING.';
comment on column public.prospects.rating is 'Provider-reported rating (0-5). NULL is unknown and must not be scored as 0.';

create index if not exists prospects_booking_provider_idx on public.prospects (current_booking_provider_id);
create index if not exists prospects_fadeup_fit_idx on public.prospects (fadeup_fit_score desc nulls last);
create index if not exists prospects_migration_potential_idx on public.prospects (migration_potential_score desc nulls last);

-- Keeps prospects.current_booking_provider_id aligned with whichever
-- observation row is currently `is_current`.
create or replace function private.prospects_sync_booking_provider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect_id uuid := coalesce(new.prospect_id, old.prospect_id);
begin
  update public.prospects p
  set current_booking_provider_id = (
    select o.provider_id
    from public.booking_provider_observations o
    where o.prospect_id = v_prospect_id and o.is_current
    order by o.confidence desc, o.observed_at desc
    limit 1
  )
  where p.id = v_prospect_id;
  return null;
end;
$$;

drop trigger if exists booking_provider_observations_sync_prospect on public.booking_provider_observations;
create trigger booking_provider_observations_sync_prospect
  after insert or update or delete on public.booking_provider_observations
  for each row execute function private.prospects_sync_booking_provider();

-- Keeps the two denormalized score columns aligned with the current
-- prospect_fit_scores rows.
create or replace function private.prospects_sync_fit_scores()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.score_kind = 'fadeup_fit' then
    update public.prospects
    set fadeup_fit_score = new.score, fadeup_fit_class = new.classification
    where id = new.prospect_id;
  elsif new.score_kind = 'migration_potential' then
    update public.prospects
    set migration_potential_score = new.score, migration_potential_class = new.classification
    where id = new.prospect_id;
  end if;
  return null;
end;
$$;

drop trigger if exists prospect_fit_scores_sync_prospect on public.prospect_fit_scores;
create trigger prospect_fit_scores_sync_prospect
  after insert on public.prospect_fit_scores
  for each row
  when (new.is_current)
  execute function private.prospects_sync_fit_scores();

-- ============================================================================
-- 14. Row level security
-- ============================================================================
-- Identical posture to 20260811150100 — see this file's header.
do $$
declare
  t text;
  all_tables text[] := array[
    'booking_providers', 'booking_provider_observations', 'prospect_identity_matches',
    'prospect_features', 'prospect_data_quality', 'prospect_fit_scores',
    'prospect_score_rulesets', 'prospect_segments', 'prospect_segment_definitions',
    'prospect_locales', 'prospect_searches', 'prospect_search_partitions'
  ];
  -- Tables the Worker itself produces.
  worker_write_tables text[] := array[
    'booking_provider_observations', 'prospect_identity_matches', 'prospect_features',
    'prospect_data_quality', 'prospect_fit_scores', 'prospect_segments',
    'prospect_locales', 'prospect_searches', 'prospect_search_partitions'
  ];
  -- Tables platform staff configure by hand.
  staff_write_tables text[] := array[
    'booking_providers', 'prospect_score_rulesets', 'prospect_searches',
    'prospect_locales', 'prospect_identity_matches', 'booking_provider_observations'
  ];
  -- Read-only reference data for the Worker.
  worker_read_tables text[] := array['booking_providers', 'prospect_score_rulesets', 'prospect_segment_definitions'];
begin
  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I_select_platform_staff on public.%I', t, t);
    execute format(
      'create policy %I_select_platform_staff on public.%I for select to authenticated using ((select private.has_platform_role(array[''platform_owner'',''platform_admin'',''platform_support'']::public.platform_role[])))',
      t, t
    );
  end loop;

  foreach t in array staff_write_tables loop
    execute format('drop policy if exists %I_insert_platform_admin on public.%I', t, t);
    execute format(
      'create policy %I_insert_platform_admin on public.%I for insert to authenticated with check ((select private.is_platform_admin()))',
      t, t
    );
    execute format('drop policy if exists %I_update_platform_admin on public.%I', t, t);
    execute format(
      'create policy %I_update_platform_admin on public.%I for update to authenticated using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()))',
      t, t
    );
    execute format('drop policy if exists %I_delete_platform_admin on public.%I', t, t);
    execute format(
      'create policy %I_delete_platform_admin on public.%I for delete to authenticated using ((select private.is_platform_admin()))',
      t, t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;

  foreach t in array worker_write_tables loop
    execute format('drop policy if exists %I_all_prospect_worker on public.%I', t, t);
    execute format(
      'create policy %I_all_prospect_worker on public.%I for all to prospect_worker using (true) with check (true)',
      t, t
    );
    execute format('grant select, insert, update, delete on public.%I to prospect_worker', t);
  end loop;

  foreach t in array worker_read_tables loop
    execute format('drop policy if exists %I_select_prospect_worker on public.%I', t, t);
    execute format('create policy %I_select_prospect_worker on public.%I for select to prospect_worker using (true)', t, t);
    execute format('grant select on public.%I to prospect_worker', t);
  end loop;

  -- Every remaining table needs its SELECT grant for platform staff too;
  -- the loop above only granted the staff-writable ones.
  foreach t in array all_tables loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end
$$;

-- Identity-match decisions and competitor observations are an audit trail:
-- nobody, including platform_owner and the Worker, may rewrite history.
-- (Platform staff CAN insert a manual_override observation or mark a match
-- reviewed — those are new rows / the reviewed_* columns, handled by the
-- UPDATE policy above; what is revoked here is deletion.)
revoke delete on public.booking_provider_observations from authenticated, prospect_worker;
revoke delete on public.prospect_identity_matches from authenticated, prospect_worker;
revoke update, delete on public.prospect_fit_scores from authenticated;

-- prospect_segment_definitions is reference data, edited by deploy only.
revoke insert, update, delete on public.prospect_segment_definitions from authenticated, prospect_worker;

-- ----------------------------------------------------------------------------
-- Defense in depth: strip the anon grant.
-- ----------------------------------------------------------------------------
-- The self-hosted Supabase bootstrap sets ALTER DEFAULT PRIVILEGES so that
-- every new table in `public` is granted to anon, authenticated and
-- service_role automatically. RLS already blocks anon here (every policy
-- is `to authenticated` or `to prospect_worker`, and FORCE ROW LEVEL
-- SECURITY is on), so no data is reachable — but leaving a table-level
-- grant in place for the anonymous role on internal acquisition data is
-- the wrong posture, and it would become a real exposure the moment
-- someone added a permissive policy.
--
-- Scoped strictly to the tables THIS migration creates.
do $$
declare
  t text;
  new_tables text[] := array[
    'booking_providers', 'booking_provider_observations', 'prospect_identity_matches',
    'prospect_features', 'prospect_data_quality', 'prospect_fit_scores',
    'prospect_score_rulesets', 'prospect_segments', 'prospect_segment_definitions',
    'prospect_locales', 'prospect_searches', 'prospect_search_partitions'
  ];
begin
  foreach t in array new_tables loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;

-- ============================================================================
-- 15. New discovery/enrichment sources
-- ============================================================================
-- Registered so /platform's existing source cards, budgets and health
-- rows cover them from day one. `competitor_directory` is registered but
-- seeded DISABLED: no competitor has a confirmed compliant discovery
-- surface yet (see booking_providers.supports_compliant_discovery), and it
-- must stay off until one is assessed and configured.
insert into public.prospect_sources (key, display_name, is_enabled, config) values
  ('competitor_directory', 'Competitor directory (compliant surfaces only)', false,
   '{"note": "Disabled until a provider with supports_compliant_discovery = true is configured. Never used to bypass anti-bot controls."}'::jsonb)
on conflict (key) do nothing;

insert into public.api_source_limits (source_id, max_requests_per_minute, max_requests_per_day, max_requests_per_month)
select id, 10, 500, 5000 from public.prospect_sources where key = 'competitor_directory'
on conflict (source_id) do nothing;

insert into public.api_source_health (source_id)
select id from public.prospect_sources where key = 'competitor_directory'
on conflict (source_id) do nothing;


-- ============================================================================
-- END db/migrations/20260818100000_prospect_competitor_intelligence.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260818100100_prospect_outreach_whatsapp_ml.sql
-- ============================================================================

-- FadeUp — Prospect Worker V2 / Platform Acquisition
-- Migration: approved-template outreach, WhatsApp Business Cloud API,
-- A/B experimentation, and the machine-learning registry.
--
-- Builds on 20260818100000_prospect_competitor_intelligence.sql. Same
-- posture as the rest of the acquisition schema (see that file's header):
-- FadeUp-internal data, platform-staff gated, FORCE RLS everywhere, and a
-- dedicated prospect_worker role with explicit per-table policies rather
-- than BYPASSRLS.
--
-- Three rules are enforced in the DATABASE, not merely in application
-- code, because the spec makes them non-negotiable:
--
--   1. ELIGIBILITY (spec §28/§44). A scraped phone number is not a
--      marketing opt-in. private.assert_whatsapp_sendable() runs as a
--      BEFORE trigger on outreach_recipients: a recipient that is
--      suppressed, opted out, do-not-contact, already converted, or
--      without a resolved locale CANNOT reach a queued state. Frontend
--      manipulation cannot bypass it, and neither can the Worker.
--
--   2. NO LLM-GENERATED COPY (spec §23). Message text comes only from an
--      approved outreach_templates row. outreach_recipients stores
--      template_id + rendered_body, and a CHECK plus trigger guarantee the
--      rendered body was produced from an APPROVED template. There is no
--      column anywhere for free-text generated copy.
--
--   3. IDEMPOTENCY (spec §60). One (campaign, prospect) pair, one
--      recipient; one idempotency key, one WhatsApp message. Both are
--      unique indexes, so a double-send is a constraint violation rather
--      than a race.
--
-- Idempotent: safe to re-run.

-- ============================================================================
-- 1. Enums
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'outreach_channel_kind') then
    create type public.outreach_channel_kind as enum ('whatsapp', 'email', 'sms');
  end if;
end $$;

comment on type public.outreach_channel_kind is
  'Channels the template engine can target. Only whatsapp has a provider implementation in this migration; email/sms exist so a template''s channel is explicit rather than assumed.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'outreach_template_status') then
    create type public.outreach_template_status as enum ('draft', 'pending_approval', 'approved', 'paused', 'retired');
  end if;
end $$;

comment on type public.outreach_template_status is
  'Only ''approved'' templates may be rendered or sent. ''paused'' is the operator kill switch required by spec §72 — it stops future sends without destroying history.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'outreach_campaign_status') then
    create type public.outreach_campaign_status as enum (
      'draft', 'preparing', 'ready', 'running', 'paused', 'completed', 'cancelled', 'failed'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'outreach_recipient_state') then
    create type public.outreach_recipient_state as enum (
      'blocked', 'pending', 'queued', 'sent', 'delivered', 'read', 'replied',
      'positive_reply', 'negative_reply', 'failed', 'opted_out',
      'claimed', 'activated', 'paid'
    );
  end if;
end $$;

comment on type public.outreach_recipient_state is
  'Full funnel through to paid (spec §29/§34). ''blocked'' is a terminal pre-send state for a recipient that failed the eligibility gate — deliberately kept as a row so /platform can show WHY a selected prospect was not contacted.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'outreach_event_type') then
    create type public.outreach_event_type as enum (
      'queued', 'sent', 'delivered', 'read', 'failed', 'replied',
      'positive_reply', 'negative_reply', 'opted_out',
      'claim_started', 'claim_completed', 'registered', 'activated', 'first_booking', 'paid'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'outreach_opt_in_status') then
    create type public.outreach_opt_in_status as enum ('none', 'pending', 'confirmed', 'withdrawn');
  end if;
end $$;

comment on type public.outreach_opt_in_status is
  '''none'' is the default for a discovered prospect and is NOT consent. Whether ''none'' is sufficient for a given jurisdiction/channel is an operator policy decision recorded on public.outreach_channel_policies — the database never assumes it.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'whatsapp_message_direction') then
    create type public.whatsapp_message_direction as enum ('outbound', 'inbound');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'whatsapp_message_status') then
    create type public.whatsapp_message_status as enum ('pending', 'sent', 'delivered', 'read', 'failed', 'received');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ml_model_target') then
    create type public.ml_model_target as enum (
      'reply', 'positive_reply', 'claim', 'activated', 'paid', 'expected_value'
    );
  end if;
end $$;

comment on type public.ml_model_target is
  'What a model predicts. ''delivered''/''read'' are deliberately absent — spec §30 forbids optimizing for those vanity metrics.';

-- ============================================================================
-- 2. Sales angles (deterministic taxonomy)
-- ============================================================================
create table if not exists public.outreach_sales_angles (
  key text primary key check (key ~ '^[A-Z0-9_]+$'),
  display_name text not null,
  description text not null,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.outreach_sales_angles (key, display_name, description, sort_order) values
  ('ONLINE_BOOKING', 'Online booking', 'The business has no online booking at all.', 10),
  ('MARKETPLACE_ACQUISITION', 'Marketplace acquisition', 'New customers reached through the FadeUp marketplace.', 20),
  ('LIVE_QUEUE', 'Live queue', 'Walk-in queue management for high-footfall shops.', 30),
  ('BARBER_MANAGEMENT', 'Barber management', 'Managing a team of barbers, schedules and chairs.', 40),
  ('SHOP_OS', 'Shop OS', 'Running the whole shop on one system.', 50),
  ('CUSTOMER_RETENTION', 'Customer retention', 'Bringing existing customers back more often.', 60),
  ('COMPETITOR_MIGRATION', 'Competitor migration', 'Switching from an incumbent booking product.', 70),
  ('MULTI_LOCATION', 'Multi-location', 'Operating more than one location.', 80),
  ('DIGITAL_MODERNIZATION', 'Digital modernization', 'Overall digital presence is behind the market.', 90)
on conflict (key) do nothing;

-- ============================================================================
-- 3. outreach_templates — administrator-controlled, approval-gated
-- ============================================================================
-- The ONLY source of message copy in the entire system. There is no
-- generated-text column anywhere by design (spec §23).
create table if not exists public.outreach_templates (
  id uuid primary key default gen_random_uuid(),
  -- Stable human key, e.g. planity_switch_fr_v1.
  key text not null check (key ~ '^[a-z0-9_]+$'),
  name text not null check (btrim(name) <> ''),
  channel public.outreach_channel_kind not null default 'whatsapp',
  -- Exact locale this copy is written in. Selection matches on this
  -- EXACTLY — never a language-family fallback (spec §25).
  locale text not null check (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  -- Targeting. NULL = applies to any value of that dimension.
  segment_key text references public.prospect_segment_definitions (key),
  booking_provider_id uuid references public.booking_providers (id),
  sales_angle text references public.outreach_sales_angles (key),
  version int not null default 1 check (version >= 1),
  status public.outreach_template_status not null default 'draft',
  -- Human-written copy with {{variable}} placeholders only. Length-bounded
  -- to WhatsApp's practical template body limit.
  body text not null check (btrim(body) <> '' and length(body) <= 4000),
  -- Which variables the body is allowed to reference. Rendering rejects
  -- any placeholder not listed here, so a template cannot be edited into
  -- referencing arbitrary prospect data.
  allowed_variables text[] not null default array['business_name', 'city', 'competitor', 'shop_type']::text[],
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, version),
  -- An approved template must record who approved it and when.
  constraint outreach_templates_approval_shape check (
    status <> 'approved' or (approved_by is not null and approved_at is not null)
  )
);

comment on table public.outreach_templates is
  'Administrator-authored, approval-gated message copy. THE only source of outbound text — no LLM/AI generation path exists anywhere in this schema (spec §23). Placeholders are restricted to allowed_variables and rendered by a non-evaluating substituter.';

comment on column public.outreach_templates.allowed_variables is
  'Whitelist of {{placeholders}} the body may use. The renderer escapes and validates every value and rejects unknown placeholders — there is no expression language, no eval, no code execution path.';

create index if not exists outreach_templates_selection_idx
  on public.outreach_templates (channel, locale, status)
  where status = 'approved';
create index if not exists outreach_templates_segment_idx on public.outreach_templates (segment_key);
create index if not exists outreach_templates_provider_idx on public.outreach_templates (booking_provider_id);

drop trigger if exists outreach_templates_set_updated_at on public.outreach_templates;
create trigger outreach_templates_set_updated_at
  before update on public.outreach_templates
  for each row execute function public.set_updated_at();

-- Stamps approver identity server-side. A client cannot self-attribute an
-- approval, and cannot approve without being platform_admin (the RLS
-- UPDATE policy already requires that; this records WHO).
create or replace function private.outreach_templates_stamp_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_by := coalesce((select auth.uid()), new.approved_by);
    new.approved_at := now();
  end if;

  -- Any edit to the copy of an approved template drops it back to draft:
  -- approval attaches to specific text, not to a row id.
  if new.body is distinct from old.body and old.status = 'approved' and new.status = 'approved' then
    new.status := 'draft';
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists outreach_templates_stamp_approval on public.outreach_templates;
create trigger outreach_templates_stamp_approval
  before update on public.outreach_templates
  for each row execute function private.outreach_templates_stamp_approval();

-- ============================================================================
-- 4. Outreach eligibility (server-side gate)
-- ============================================================================
-- Per-prospect, per-channel contactability. Separate from
-- public.prospect_suppressions (which already exists and stays the global
-- Do-Not-Contact list) because eligibility is channel-specific: a business
-- may be reachable by email and not by WhatsApp.
create table if not exists public.prospect_outreach_eligibility (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  channel public.outreach_channel_kind not null,
  -- The destination as the provider needs it (E.164 for WhatsApp).
  destination text,
  is_eligible boolean not null default false,
  opt_in_status public.outreach_opt_in_status not null default 'none',
  opt_in_source text,
  opt_in_at timestamptz,
  do_not_contact boolean not null default false,
  opted_out_at timestamptz,
  suppression_reason text,
  -- Set when the provider permanently rejects the destination (WhatsApp
  -- error 131026 and similar) so we stop retrying a dead number.
  destination_invalid boolean not null default false,
  last_evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prospect_id, channel)
);

comment on table public.prospect_outreach_eligibility is
  'Server-side, channel-specific contactability. is_eligible defaults to FALSE: discovering a phone number never creates eligibility (spec §28). Enforced by private.assert_whatsapp_sendable() on the recipient insert path, so no client can bypass it.';

create index if not exists prospect_outreach_eligibility_channel_idx
  on public.prospect_outreach_eligibility (channel, is_eligible);

drop trigger if exists prospect_outreach_eligibility_set_updated_at on public.prospect_outreach_eligibility;
create trigger prospect_outreach_eligibility_set_updated_at
  before update on public.prospect_outreach_eligibility
  for each row execute function public.set_updated_at();

-- Operator-declared policy per channel/country. The database refuses to
-- decide on its own whether "no explicit opt-in" is permissible in a given
-- market — that is a legal/commercial judgement the Platform Owner makes
-- explicitly, and this table records it so the decision is auditable.
create table if not exists public.outreach_channel_policies (
  id uuid primary key default gen_random_uuid(),
  channel public.outreach_channel_kind not null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  requires_explicit_opt_in boolean not null default true,
  policy_notes text,
  set_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, country)
);

comment on table public.outreach_channel_policies is
  'Operator-declared per-country consent policy. Default requires_explicit_opt_in = true (the safe posture). Nothing here is inferred — the Platform Owner records the decision and the eligibility gate enforces it.';

drop trigger if exists outreach_channel_policies_set_updated_at on public.outreach_channel_policies;
create trigger outreach_channel_policies_set_updated_at
  before update on public.outreach_channel_policies
  for each row execute function public.set_updated_at();

insert into public.outreach_channel_policies (channel, country, requires_explicit_opt_in, policy_notes) values
  ('whatsapp', 'FR', true, 'Default safe posture — outbound WhatsApp marketing requires a recorded opt-in until the Platform Owner explicitly records a different assessment.'),
  ('whatsapp', 'GB', true, 'Default safe posture.'),
  ('whatsapp', 'US', true, 'Default safe posture.')
on conflict (channel, country) do nothing;

-- ============================================================================
-- 5. Campaigns and recipients
-- ============================================================================
create table if not exists public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  channel public.outreach_channel_kind not null default 'whatsapp',
  status public.outreach_campaign_status not null default 'draft',
  -- The prospect filter used to build the recipient set, stored verbatim
  -- so the selection is reproducible and auditable.
  selection_filters jsonb not null default '{}'::jsonb,
  whatsapp_account_id uuid,
  experiment_id uuid,
  -- Throughput guard so a campaign cannot burst through provider limits.
  max_sends_per_hour int not null default 60 check (max_sends_per_hour between 1 and 10000),
  -- Set when a human approves the prepared campaign for sending.
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_campaigns_approval_shape check (
    status not in ('running', 'completed') or (approved_by is not null and approved_at is not null)
  )
);

comment on table public.outreach_campaigns is
  'A WhatsApp (or other channel) campaign. A campaign cannot reach ''running'' without a recorded human approval — the CHECK above is the server-side half of the /platform prepare -> approve -> queue workflow.';

create index if not exists outreach_campaigns_status_idx on public.outreach_campaigns (status);
create index if not exists outreach_campaigns_created_at_idx on public.outreach_campaigns (created_at desc);

drop trigger if exists outreach_campaigns_set_updated_at on public.outreach_campaigns;
create trigger outreach_campaigns_set_updated_at
  before update on public.outreach_campaigns
  for each row execute function public.set_updated_at();

create table if not exists public.outreach_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  state public.outreach_recipient_state not null default 'pending',
  -- Which approved template was selected, and how.
  template_id uuid references public.outreach_templates (id),
  -- 'rule' | 'ml' | 'experiment' | 'manual'. Never 'generated'.
  selection_method text check (selection_method in ('rule', 'ml', 'experiment', 'manual')),
  selection_reason jsonb not null default '{}'::jsonb,
  locale text check (locale is null or locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  sales_angle text references public.outreach_sales_angles (key),
  -- Rendered from template_id's body by pure variable substitution. Kept
  -- so /platform can show exactly what was sent, and so an audit can
  -- re-derive it from the template + variables.
  rendered_body text check (rendered_body is null or length(rendered_body) <= 4000),
  rendered_variables jsonb not null default '{}'::jsonb,
  destination text,
  -- Why a recipient is 'blocked'. Populated by the eligibility gate.
  blocked_reason text,
  experiment_id uuid,
  experiment_arm text,
  ml_prediction_id uuid,
  queued_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  converted_at timestamptz,
  last_error text,
  attempts int not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Duplicate-send protection (spec §60): one prospect appears at most
  -- once per campaign, enforced by the database.
  unique (campaign_id, prospect_id),
  -- A recipient that has left 'pending'/'blocked' MUST carry the template
  -- it was rendered from — there is no path to a sent message without an
  -- approved template behind it.
  constraint outreach_recipients_requires_template check (
    state in ('pending', 'blocked') or (template_id is not null and rendered_body is not null)
  ),
  constraint outreach_recipients_blocked_has_reason check (
    state <> 'blocked' or blocked_reason is not null
  )
);

comment on table public.outreach_recipients is
  'One prospect within one campaign. UNIQUE (campaign_id, prospect_id) is the duplicate-send guard; outreach_recipients_requires_template guarantees no message exists without an approved template; the eligibility trigger below blocks ineligible/suppressed/converted prospects before they can be queued.';

create index if not exists outreach_recipients_campaign_state_idx on public.outreach_recipients (campaign_id, state);
create index if not exists outreach_recipients_prospect_idx on public.outreach_recipients (prospect_id);
create index if not exists outreach_recipients_template_idx on public.outreach_recipients (template_id);
create index if not exists outreach_recipients_queue_idx
  on public.outreach_recipients (campaign_id, queued_at)
  where state = 'queued';

drop trigger if exists outreach_recipients_set_updated_at on public.outreach_recipients;
create trigger outreach_recipients_set_updated_at
  before update on public.outreach_recipients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The eligibility gate.
-- ---------------------------------------------------------------------------
-- Returns NULL when the prospect may be contacted on this channel, or a
-- machine-readable reason string when it may not. Kept as a separate
-- STABLE function (not inlined in the trigger) so /platform can call it to
-- PREVIEW why a prospect would be blocked, and so VERIFY can assert its
-- behaviour directly.
create or replace function public.outreach_block_reason(
  p_prospect_id uuid,
  p_channel public.outreach_channel_kind
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
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

comment on function public.outreach_block_reason(uuid, public.outreach_channel_kind) is
  'NULL = contactable. Otherwise a machine-readable block reason. Single source of truth for the eligibility gate: used by the recipient trigger (enforcement), by /platform (preview), and by VERIFY (assertion).';

revoke execute on function public.outreach_block_reason(uuid, public.outreach_channel_kind) from public, anon;
grant execute on function public.outreach_block_reason(uuid, public.outreach_channel_kind) to authenticated, prospect_worker;

-- Enforcement. Any attempt to put a recipient into a sendable state runs
-- this first. Applies to INSERT and UPDATE, to the Worker and to platform
-- staff alike.
create or replace function private.assert_whatsapp_sendable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel public.outreach_channel_kind;
  v_reason text;
  v_template public.outreach_templates;
  v_locale text;
begin
  select channel into v_channel from public.outreach_campaigns where id = new.campaign_id;
  if v_channel is null then
    raise exception 'outreach_recipients: campaign % does not exist', new.campaign_id;
  end if;

  -- 'pending' and 'blocked' are pre-send bookkeeping states and are always
  -- allowed; everything else means "this will be, or has been, sent".
  if new.state in ('pending', 'blocked') then
    return new;
  end if;

  -- Terminal post-send states are set by webhook/outcome processing on an
  -- already-gated row; re-running the gate then would wrongly reject a
  -- prospect who legitimately opted out AFTER we messaged them.
  if new.state in ('sent', 'delivered', 'read', 'replied', 'positive_reply',
                   'negative_reply', 'failed', 'opted_out', 'claimed', 'activated', 'paid') then
    if tg_op = 'UPDATE' and old.state in ('queued', 'sent', 'delivered', 'read', 'replied',
                                          'positive_reply', 'negative_reply', 'claimed', 'activated') then
      return new;
    end if;
    raise exception 'outreach_recipients: cannot move recipient % directly to % — it must pass through queued first',
      new.id, new.state using errcode = 'check_violation';
  end if;

  -- new.state = 'queued': the gate.
  v_reason := public.outreach_block_reason(new.prospect_id, v_channel);
  if v_reason is not null then
    raise exception 'outreach_recipients: prospect % is not contactable on % (%)',
      new.prospect_id, v_channel, v_reason using errcode = 'check_violation';
  end if;

  -- Template must exist, be APPROVED, match the channel, and match the
  -- prospect's effective locale EXACTLY.
  if new.template_id is null then
    raise exception 'outreach_recipients: cannot queue without a template' using errcode = 'check_violation';
  end if;

  select * into v_template from public.outreach_templates where id = new.template_id;
  if not found then
    raise exception 'outreach_recipients: template % does not exist', new.template_id using errcode = 'check_violation';
  end if;

  if v_template.status <> 'approved' then
    raise exception 'outreach_recipients: template % is % — only approved templates may be sent',
      v_template.key, v_template.status using errcode = 'check_violation';
  end if;

  if v_template.channel <> v_channel then
    raise exception 'outreach_recipients: template % is for channel %, campaign is %',
      v_template.key, v_template.channel, v_channel using errcode = 'check_violation';
  end if;

  v_locale := public.prospect_effective_locale(new.prospect_id);
  if v_template.locale <> v_locale then
    raise exception 'outreach_recipients: template % is %, prospect locale is % — refusing to send the wrong language',
      v_template.key, v_template.locale, v_locale using errcode = 'check_violation';
  end if;

  if new.rendered_body is null or btrim(new.rendered_body) = '' then
    raise exception 'outreach_recipients: cannot queue without a rendered body' using errcode = 'check_violation';
  end if;

  new.locale := v_locale;
  new.queued_at := coalesce(new.queued_at, now());
  return new;
end;
$$;

comment on function private.assert_whatsapp_sendable() is
  'Server-side eligibility + approved-template + locale gate. Runs BEFORE INSERT OR UPDATE on outreach_recipients so neither the frontend, the Worker, nor a direct SQL client can queue a message that violates spec §25/§28/§44.';

drop trigger if exists outreach_recipients_assert_sendable on public.outreach_recipients;
create trigger outreach_recipients_assert_sendable
  before insert or update on public.outreach_recipients
  for each row execute function private.assert_whatsapp_sendable();

-- ---------------------------------------------------------------------------
-- Conversion stops prospecting (spec §43).
-- ---------------------------------------------------------------------------
create or replace function private.cancel_outreach_on_conversion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.converted_organization_id is not null and old.converted_organization_id is null)
     or (new.status = 'customer' and old.status is distinct from 'customer') then

    -- Stop anything not yet sent. Already-sent recipients keep their state:
    -- that history is what the funnel analytics are built from.
    update public.outreach_recipients
    set state = 'blocked',
        blocked_reason = 'prospect_converted'
    where prospect_id = new.id
      and state in ('pending', 'queued');

    -- Cancel queued prospecting work for this prospect.
    update public.prospect_jobs
    set status = 'cancelled',
        result = result || jsonb_build_object('cancelled_reason', 'prospect_converted')
    where status in ('queued', 'retry')
      and payload->>'prospectId' = new.id::text;

    update public.prospect_outreach_eligibility
    set is_eligible = false,
        suppression_reason = 'prospect_converted',
        last_evaluated_at = now()
    where prospect_id = new.id;
  end if;

  return null;
end;
$$;

drop trigger if exists prospects_cancel_outreach_on_conversion on public.prospects;
create trigger prospects_cancel_outreach_on_conversion
  after update on public.prospects
  for each row execute function private.cancel_outreach_on_conversion();

-- ============================================================================
-- 6. outreach_events — append-only outcome log
-- ============================================================================
create table if not exists public.outreach_events (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.outreach_recipients (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  event_type public.outreach_event_type not null,
  occurred_at timestamptz not null default now(),
  -- Provider-side identifier, used for idempotent webhook processing.
  provider_event_id text,
  -- For positive_reply/negative_reply: who classified it. NULL = the
  -- deterministic opt-out keyword matcher, not a human and not an LLM.
  classified_by uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.outreach_events is
  'Append-only funnel outcome log through to paid. Reply sentiment is either human-classified (classified_by set) or matched by the deterministic opt-out keyword list — never inferred by a model (spec §34 "Do not invent labels").';

create index if not exists outreach_events_recipient_idx on public.outreach_events (recipient_id, occurred_at desc);
create index if not exists outreach_events_prospect_idx on public.outreach_events (prospect_id, occurred_at desc);
create index if not exists outreach_events_type_idx on public.outreach_events (event_type, occurred_at desc);
create unique index if not exists outreach_events_provider_event_unique
  on public.outreach_events (provider_event_id, event_type)
  where provider_event_id is not null;

revoke update, delete on public.outreach_events from authenticated, prospect_worker;

-- ============================================================================
-- 7. WhatsApp Business Cloud API
-- ============================================================================
-- Official Meta Cloud API only. NOTHING in this schema stores or implies a
-- browser-automation / reverse-engineered client path (spec §27).
--
-- SECRETS: access tokens, app secrets and verify tokens are NEVER stored
-- here. They live in the Worker's environment (infra/worker/.env.worker).
-- This table holds only the non-secret identifiers needed to route a send.
create table if not exists public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null check (btrim(label) <> ''),
  -- Meta WhatsApp Business Account ID and Phone Number ID. Public
  -- identifiers, not credentials.
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone_number text,
  -- Name of the environment variable holding this account's access token,
  -- so an operator can see WHICH secret is expected without the value ever
  -- entering the database.
  access_token_env_var text not null default 'META_WHATSAPP_ACCESS_TOKEN'
    check (access_token_env_var ~ '^[A-Z][A-Z0-9_]*$'),
  is_active boolean not null default true,
  -- 'mock' keeps the whole pipeline exercisable with no Meta credentials
  -- and provably sends nothing (spec §61).
  provider_mode text not null default 'mock' check (provider_mode in ('mock', 'live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_accounts is
  'Non-secret WhatsApp Cloud API routing config. Access tokens, the app secret and the webhook verify token are environment-only and MUST NEVER be stored in this table — access_token_env_var names the variable, never its value.';

comment on column public.whatsapp_accounts.provider_mode is
  '''mock'' (default) routes every send to the in-process mock provider — no network call to Meta. ''live'' requires the named env var to be present in the Worker environment.';

drop trigger if exists whatsapp_accounts_set_updated_at on public.whatsapp_accounts;
create trigger whatsapp_accounts_set_updated_at
  before update on public.whatsapp_accounts
  for each row execute function public.set_updated_at();

-- Defense in depth: reject anything that looks like a credential being
-- pasted into a config column.
create or replace function private.whatsapp_accounts_reject_secrets()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.waba_id ~ '^(EAA|Bearer )' or new.phone_number_id ~ '^(EAA|Bearer )' then
    raise exception 'whatsapp_accounts: that value looks like an access token. Tokens belong in the Worker environment, never in the database.'
      using errcode = 'check_violation';
  end if;
  if length(new.waba_id) > 64 or length(new.phone_number_id) > 64 then
    raise exception 'whatsapp_accounts: identifier too long to be a WABA/phone number id'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_accounts_reject_secrets on public.whatsapp_accounts;
create trigger whatsapp_accounts_reject_secrets
  before insert or update on public.whatsapp_accounts
  for each row execute function private.whatsapp_accounts_reject_secrets();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'outreach_campaigns_whatsapp_account_fkey'
      and conrelid = 'public.outreach_campaigns'::regclass
  ) then
    alter table public.outreach_campaigns
      add constraint outreach_campaigns_whatsapp_account_fkey
      foreign key (whatsapp_account_id) references public.whatsapp_accounts (id) on delete set null;
  end if;
end $$;

-- Maps a FadeUp template to the Meta-approved template it is sent as.
-- Meta requires pre-approved templates for business-initiated messages, so
-- this mapping is what makes an approved FadeUp template actually sendable.
create table if not exists public.whatsapp_template_mappings (
  id uuid primary key default gen_random_uuid(),
  whatsapp_account_id uuid not null references public.whatsapp_accounts (id) on delete cascade,
  template_id uuid not null references public.outreach_templates (id) on delete cascade,
  -- The name/language as registered in the Meta template manager.
  meta_template_name text not null check (meta_template_name ~ '^[a-z0-9_]+$'),
  meta_template_language text not null,
  -- Ordered list of the FadeUp variable names that fill Meta's positional
  -- body parameters {{1}}, {{2}}, ...
  variable_order text[] not null default '{}'::text[],
  approval_state text not null default 'unknown'
    check (approval_state in ('unknown', 'pending', 'approved', 'rejected', 'paused', 'disabled')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (whatsapp_account_id, template_id),
  unique (whatsapp_account_id, meta_template_name, meta_template_language)
);

comment on table public.whatsapp_template_mappings is
  'Bridges an approved FadeUp template to its Meta-approved WhatsApp template. variable_order maps FadeUp variable names onto Meta''s positional {{1}}..{{n}} body parameters.';

drop trigger if exists whatsapp_template_mappings_set_updated_at on public.whatsapp_template_mappings;
create trigger whatsapp_template_mappings_set_updated_at
  before update on public.whatsapp_template_mappings
  for each row execute function public.set_updated_at();

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  whatsapp_account_id uuid not null references public.whatsapp_accounts (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete set null,
  contact_wa_id text not null,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (whatsapp_account_id, contact_wa_id)
);

drop trigger if exists whatsapp_conversations_set_updated_at on public.whatsapp_conversations;
create trigger whatsapp_conversations_set_updated_at
  before update on public.whatsapp_conversations
  for each row execute function public.set_updated_at();

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  whatsapp_account_id uuid not null references public.whatsapp_accounts (id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations (id) on delete set null,
  recipient_id uuid references public.outreach_recipients (id) on delete set null,
  prospect_id uuid references public.prospects (id) on delete set null,
  direction public.whatsapp_message_direction not null,
  status public.whatsapp_message_status not null default 'pending',
  -- Meta's wamid, once the send is accepted.
  provider_message_id text,
  -- Our own key, computed BEFORE the send. UNIQUE, so a retry after an
  -- ambiguous timeout can never produce a second real message.
  idempotency_key text,
  to_phone_e164 text,
  from_phone_e164 text,
  template_id uuid references public.outreach_templates (id),
  meta_template_name text,
  meta_template_language text,
  -- Outbound: what was actually sent (rendered from the approved
  -- template). Inbound: what the prospect wrote.
  body text check (body is null or length(body) <= 8000),
  error_code text,
  error_message text,
  attempts int not null default 0 check (attempts >= 0),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_messages is
  'Every WhatsApp message in or out. idempotency_key is computed before the send and is UNIQUE — a retried send after a timeout collides instead of duplicating (spec §60).';

create unique index if not exists whatsapp_messages_idempotency_unique
  on public.whatsapp_messages (idempotency_key)
  where idempotency_key is not null;
create unique index if not exists whatsapp_messages_provider_id_unique
  on public.whatsapp_messages (provider_message_id)
  where provider_message_id is not null;
create index if not exists whatsapp_messages_recipient_idx on public.whatsapp_messages (recipient_id);
create index if not exists whatsapp_messages_prospect_idx on public.whatsapp_messages (prospect_id, created_at desc);
create index if not exists whatsapp_messages_status_idx on public.whatsapp_messages (status, created_at desc);

drop trigger if exists whatsapp_messages_set_updated_at on public.whatsapp_messages;
create trigger whatsapp_messages_set_updated_at
  before update on public.whatsapp_messages
  for each row execute function public.set_updated_at();

-- Raw webhook envelopes, stored before processing so a duplicate or
-- out-of-order delivery is detectable and replayable (spec §62).
create table if not exists public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  whatsapp_account_id uuid references public.whatsapp_accounts (id) on delete set null,
  -- Meta's per-delivery id. UNIQUE => duplicate deliveries are a no-op.
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature_valid boolean not null default false,
  processed boolean not null default false,
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.whatsapp_webhook_events is
  'Raw inbound webhook envelopes. UNIQUE provider_event_id makes redelivery idempotent; signature_valid records the X-Hub-Signature-256 verification result — an unverified event is stored for forensics but never processed.';

create unique index if not exists whatsapp_webhook_events_provider_unique
  on public.whatsapp_webhook_events (provider_event_id);
create index if not exists whatsapp_webhook_events_unprocessed_idx
  on public.whatsapp_webhook_events (received_at)
  where not processed;

revoke update, delete on public.whatsapp_webhook_events from authenticated;

-- ============================================================================
-- 8. Experiments (A/B before ML — spec §31/§32)
-- ============================================================================
create table if not exists public.outreach_experiments (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]+$'),
  name text not null check (btrim(name) <> ''),
  hypothesis text,
  status text not null default 'draft' check (status in ('draft', 'running', 'paused', 'completed', 'abandoned')),
  -- The cohort this experiment applies to. Assignment only happens for
  -- prospects matching ALL non-null dimensions.
  cohort_locale text check (cohort_locale is null or cohort_locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  cohort_segment_key text references public.prospect_segment_definitions (key),
  cohort_booking_provider_id uuid references public.booking_providers (id),
  cohort_country text check (cohort_country is null or cohort_country ~ '^[A-Z]{2}$'),
  -- Exposure controls (spec §69).
  exploration_pct numeric(5, 2) not null default 100 check (exploration_pct between 0 and 100),
  min_sample_per_arm int not null default 30 check (min_sample_per_arm >= 1),
  max_experiments_per_prospect int not null default 1 check (max_experiments_per_prospect >= 1),
  cooldown_days int not null default 30 check (cooldown_days >= 0),
  -- Reproducible assignment: arm = hash(seed || prospect_id) % arms.
  assignment_seed text not null default encode(gen_random_bytes(16), 'hex'),
  primary_metric public.ml_model_target not null default 'positive_reply',
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.outreach_experiments is
  'A/B experiment over eligible approved templates. Assignment is deterministic (hash of assignment_seed + prospect_id), so an assignment is reproducible and auditable. primary_metric defaults to positive_reply — never read/delivered.';

drop trigger if exists outreach_experiments_set_updated_at on public.outreach_experiments;
create trigger outreach_experiments_set_updated_at
  before update on public.outreach_experiments
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'outreach_campaigns_experiment_fkey'
      and conrelid = 'public.outreach_campaigns'::regclass
  ) then
    alter table public.outreach_campaigns
      add constraint outreach_campaigns_experiment_fkey
      foreign key (experiment_id) references public.outreach_experiments (id) on delete set null;
  end if;
end $$;

create table if not exists public.outreach_experiment_arms (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.outreach_experiments (id) on delete cascade,
  arm_key text not null check (arm_key ~ '^[A-Za-z0-9_]+$'),
  template_id uuid not null references public.outreach_templates (id),
  weight int not null default 1 check (weight >= 1),
  is_control boolean not null default false,
  created_at timestamptz not null default now(),
  unique (experiment_id, arm_key),
  unique (experiment_id, template_id)
);

create unique index if not exists outreach_experiment_arms_one_control
  on public.outreach_experiment_arms (experiment_id)
  where is_control;

create table if not exists public.outreach_assignments (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.outreach_experiments (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  arm_id uuid not null references public.outreach_experiment_arms (id) on delete cascade,
  recipient_id uuid references public.outreach_recipients (id) on delete set null,
  assignment_hash text not null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Statistical contamination guard (spec §32): a prospect gets ONE arm
  -- per experiment, permanently.
  unique (experiment_id, prospect_id)
);

comment on table public.outreach_assignments is
  'Immutable experiment assignment. UNIQUE (experiment_id, prospect_id) prevents a prospect being re-randomized; the trigger below prevents simultaneous conflicting experiments on the same prospect.';

create index if not exists outreach_assignments_prospect_idx on public.outreach_assignments (prospect_id);
create index if not exists outreach_assignments_arm_idx on public.outreach_assignments (arm_id);

-- Prevents a prospect from being enrolled in more simultaneous running
-- experiments than the experiment's own max_experiments_per_prospect
-- allows, and enforces the cooldown between exposures.
create or replace function private.assert_experiment_exposure_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_experiment public.outreach_experiments;
  v_active_count int;
  v_last_assignment timestamptz;
begin
  select * into v_experiment from public.outreach_experiments where id = new.experiment_id;
  if not found then
    raise exception 'outreach_assignments: experiment % does not exist', new.experiment_id;
  end if;

  select count(*) into v_active_count
  from public.outreach_assignments a
  join public.outreach_experiments e on e.id = a.experiment_id
  where a.prospect_id = new.prospect_id
    and a.experiment_id <> new.experiment_id
    and e.status = 'running';

  if v_active_count >= v_experiment.max_experiments_per_prospect then
    raise exception 'outreach_assignments: prospect % is already in % running experiment(s); limit is %',
      new.prospect_id, v_active_count, v_experiment.max_experiments_per_prospect
      using errcode = 'check_violation';
  end if;

  if v_experiment.cooldown_days > 0 then
    select max(a.assigned_at) into v_last_assignment
    from public.outreach_assignments a
    where a.prospect_id = new.prospect_id
      and a.experiment_id <> new.experiment_id;

    if v_last_assignment is not null
       and v_last_assignment > now() - make_interval(days => v_experiment.cooldown_days) then
      raise exception 'outreach_assignments: prospect % is within the % day experiment cooldown (last exposure %)',
        new.prospect_id, v_experiment.cooldown_days, v_last_assignment
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists outreach_assignments_exposure_limits on public.outreach_assignments;
create trigger outreach_assignments_exposure_limits
  before insert on public.outreach_assignments
  for each row execute function private.assert_experiment_exposure_limits();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'outreach_recipients_experiment_fkey'
      and conrelid = 'public.outreach_recipients'::regclass
  ) then
    alter table public.outreach_recipients
      add constraint outreach_recipients_experiment_fkey
      foreign key (experiment_id) references public.outreach_experiments (id) on delete set null;
  end if;
end $$;

-- ============================================================================
-- 9. Machine learning registry
-- ============================================================================
-- ML NEVER decides eligibility and NEVER writes copy (spec §23/§28). Its
-- only job is ranking already-eligible approved templates.

create table if not exists public.ml_feature_schemas (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version ~ '^[a-z0-9._-]+$'),
  -- [{name, dtype, source, nullable, unknown_encoding}, ...]
  features jsonb not null default '[]'::jsonb,
  -- Features that must NEVER be used because they are only observable
  -- after the prediction moment. The training pipeline asserts against
  -- this list (spec §68).
  forbidden_features text[] not null default array[
    'replied', 'positive_reply', 'delivered', 'read', 'claimed', 'activated', 'paid',
    'replied_at', 'delivered_at', 'read_at', 'converted_at'
  ]::text[],
  notes text,
  created_at timestamptz not null default now()
);

comment on table public.ml_feature_schemas is
  'Versioned feature contract. forbidden_features is the machine-checkable data-leakage guard: the training pipeline fails if any of these appears in a training matrix (spec §68).';

create table if not exists public.ml_datasets (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version ~ '^[a-z0-9._-]+$'),
  feature_schema_version text not null references public.ml_feature_schemas (version),
  target public.ml_model_target not null,
  row_count int not null default 0 check (row_count >= 0),
  positive_count int not null default 0 check (positive_count >= 0),
  negative_count int not null default 0 check (negative_count >= 0),
  -- Snapshot boundary, so the dataset is reproducible.
  snapshot_from timestamptz,
  snapshot_to timestamptz not null,
  -- Per-feature missingness/coverage, for the /platform dataset screen.
  feature_coverage jsonb not null default '{}'::jsonb,
  label_distribution jsonb not null default '{}'::jsonb,
  random_seed int not null default 42,
  created_at timestamptz not null default now(),
  constraint ml_datasets_counts_consistent check (positive_count + negative_count <= row_count)
);

create table if not exists public.ml_model_versions (
  id uuid primary key default gen_random_uuid(),
  model_key text not null check (model_key ~ '^[a-z0-9_]+$'),
  model_version text not null,
  model_type text not null check (model_type in ('logistic_regression', 'gradient_boosted_trees', 'rule_baseline')),
  target public.ml_model_target not null,
  feature_schema_version text not null references public.ml_feature_schemas (version),
  training_dataset_version text references public.ml_datasets (version),
  hyperparameters jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  -- Artifact lives on the Worker's filesystem/volume, never in the
  -- database and never served to a browser (spec §71).
  artifact_path text,
  artifact_sha256 text check (artifact_sha256 is null or artifact_sha256 ~ '^[a-f0-9]{64}$'),
  random_seed int not null default 42,
  is_active boolean not null default false,
  promoted_by uuid references auth.users (id) on delete set null,
  promoted_at timestamptz,
  retired_at timestamptz,
  evaluation_notes text,
  created_at timestamptz not null default now(),
  unique (model_key, model_version),
  -- No silent automatic promotion (spec §73): an active model must record
  -- a human promoter and a written evaluation.
  constraint ml_model_versions_promotion_shape check (
    not is_active or (promoted_by is not null and promoted_at is not null and evaluation_notes is not null)
  )
);

comment on table public.ml_model_versions is
  'Model registry. is_active requires promoted_by + promoted_at + evaluation_notes, so a freshly-trained model can NEVER become production by merely existing (spec §73). At most one active model per (model_key, target).';

-- Exactly one promoted model per decision task.
create unique index if not exists ml_model_versions_one_active
  on public.ml_model_versions (model_key, target)
  where is_active;

create table if not exists public.ml_training_runs (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid references public.ml_model_versions (id) on delete cascade,
  dataset_version text references public.ml_datasets (version),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'skipped_insufficient_data')),
  -- Set when the pipeline correctly REFUSES to train (spec §31: "if
  -- insufficient labeled outreach data exists, do not train a meaningless
  -- model").
  skip_reason text,
  train_rows int check (train_rows is null or train_rows >= 0),
  validation_rows int check (validation_rows is null or validation_rows >= 0),
  train_metrics jsonb not null default '{}'::jsonb,
  validation_metrics jsonb not null default '{}'::jsonb,
  baseline_metrics jsonb not null default '{}'::jsonb,
  leakage_check_passed boolean,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  log_excerpt text,
  created_at timestamptz not null default now()
);

comment on table public.ml_training_runs is
  'Every training attempt, including the ones that correctly declined to train. status = skipped_insufficient_data with a skip_reason is a SUCCESSFUL outcome of the phased ML strategy, not a failure.';

create table if not exists public.ml_predictions (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  template_id uuid not null references public.outreach_templates (id) on delete cascade,
  model_version_id uuid references public.ml_model_versions (id) on delete set null,
  -- NULL model_version_id + this flag = the deterministic fallback ranked
  -- the candidates because no model was promoted or inference failed.
  is_fallback boolean not null default false,
  target public.ml_model_target not null,
  predicted_probability numeric(6, 5) not null check (predicted_probability between 0 and 1),
  feature_schema_version text,
  features_snapshot jsonb not null default '{}'::jsonb,
  selected boolean not null default false,
  campaign_id uuid references public.outreach_campaigns (id) on delete set null,
  predicted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.ml_predictions is
  'Append-only prediction history — one row per (prospect, candidate template), with the chosen one flagged `selected`. Never overwritten (spec §37), so every past recommendation stays auditable.';

create index if not exists ml_predictions_prospect_idx on public.ml_predictions (prospect_id, predicted_at desc);
create index if not exists ml_predictions_model_idx on public.ml_predictions (model_version_id);
create index if not exists ml_predictions_selected_idx on public.ml_predictions (selected, predicted_at desc) where selected;

revoke update, delete on public.ml_predictions from authenticated, prospect_worker;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'outreach_recipients_ml_prediction_fkey'
      and conrelid = 'public.outreach_recipients'::regclass
  ) then
    alter table public.outreach_recipients
      add constraint outreach_recipients_ml_prediction_fkey
      foreign key (ml_prediction_id) references public.ml_predictions (id) on delete set null;
  end if;
end $$;

create table if not exists public.ml_metrics (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.ml_model_versions (id) on delete cascade,
  metric_key text not null check (metric_key ~ '^[a-z0-9_@.]+$'),
  metric_value numeric not null,
  split text not null default 'validation' check (split in ('train', 'validation', 'test', 'production')),
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (model_version_id, metric_key, split)
);

-- Seed the initial feature schema so the dataset builder has a contract to
-- validate against from the very first run.
insert into public.ml_feature_schemas (version, features, notes) values
  ('fs-v1',
   '[
     {"name": "country", "dtype": "categorical", "source": "prospects.country", "nullable": false, "unknown_encoding": "UNKNOWN"},
     {"name": "region", "dtype": "categorical", "source": "prospect_locations.region", "nullable": true, "unknown_encoding": "UNKNOWN"},
     {"name": "city_size_band", "dtype": "categorical", "source": "derived", "nullable": true, "unknown_encoding": "UNKNOWN"},
     {"name": "shop_type", "dtype": "categorical", "source": "prospects.type", "nullable": false, "unknown_encoding": "UNKNOWN"},
     {"name": "rating", "dtype": "numeric", "source": "prospects.rating", "nullable": true, "unknown_encoding": "nan"},
     {"name": "review_count", "dtype": "numeric", "source": "prospects.review_count", "nullable": true, "unknown_encoding": "nan"},
     {"name": "estimated_barber_count", "dtype": "numeric", "source": "prospects.estimated_barber_count", "nullable": true, "unknown_encoding": "nan"},
     {"name": "has_website", "dtype": "tribool", "source": "prospect_features", "nullable": false, "unknown_encoding": "UNKNOWN"},
     {"name": "website_quality_score", "dtype": "numeric", "source": "prospect_features", "nullable": true, "unknown_encoding": "nan"},
     {"name": "mobile_ready", "dtype": "tribool", "source": "prospect_features", "nullable": false, "unknown_encoding": "UNKNOWN"},
     {"name": "booking_detected", "dtype": "tribool", "source": "prospect_features", "nullable": false, "unknown_encoding": "UNKNOWN"},
     {"name": "booking_provider", "dtype": "categorical", "source": "booking_providers.key", "nullable": false, "unknown_encoding": "UNKNOWN"},
     {"name": "instagram_presence", "dtype": "tribool", "source": "prospect_features", "nullable": false, "unknown_encoding": "UNKNOWN"},
     {"name": "digital_gap_score", "dtype": "numeric", "source": "prospect_features", "nullable": true, "unknown_encoding": "nan"},
     {"name": "fadeup_fit_score", "dtype": "numeric", "source": "prospects.fadeup_fit_score", "nullable": true, "unknown_encoding": "nan"},
     {"name": "migration_potential_score", "dtype": "numeric", "source": "prospects.migration_potential_score", "nullable": true, "unknown_encoding": "nan"},
     {"name": "multi_barber", "dtype": "tribool", "source": "prospect_features", "nullable": false, "unknown_encoding": "UNKNOWN"},
     {"name": "template_key", "dtype": "categorical", "source": "outreach_templates.key", "nullable": false, "unknown_encoding": "UNKNOWN"},
     {"name": "sales_angle", "dtype": "categorical", "source": "outreach_recipients.sales_angle", "nullable": true, "unknown_encoding": "UNKNOWN"},
     {"name": "locale", "dtype": "categorical", "source": "outreach_recipients.locale", "nullable": false, "unknown_encoding": "UNKNOWN"},
     {"name": "send_weekday", "dtype": "categorical", "source": "derived", "nullable": false, "unknown_encoding": "UNKNOWN"},
     {"name": "send_hour", "dtype": "numeric", "source": "derived", "nullable": false, "unknown_encoding": "nan"}
   ]'::jsonb,
   'Initial contract. Every feature is observable at the moment the template decision is made; nothing derived from the outcome appears here.')
on conflict (version) do nothing;

-- Register the deterministic rule selector as a first-class "model" so
-- /platform can always show what is currently making decisions, even in
-- Phase 0 with no trained model at all.
insert into public.ml_model_versions (
  model_key, model_version, model_type, target, feature_schema_version,
  hyperparameters, metrics, is_active, evaluation_notes
) values (
  'template_selector', 'rules-v1', 'rule_baseline', 'positive_reply', 'fs-v1',
  '{}'::jsonb, '{}'::jsonb, false,
  'Deterministic Phase 0 baseline. Always available as the fallback selector; never requires promotion to be used, because fallback is unconditional (spec §36/§67).'
)
on conflict (model_key, model_version) do nothing;

-- ============================================================================
-- 10. Row level security
-- ============================================================================
do $$
declare
  t text;
  all_tables text[] := array[
    'outreach_sales_angles', 'outreach_templates', 'prospect_outreach_eligibility',
    'outreach_channel_policies', 'outreach_campaigns', 'outreach_recipients',
    'outreach_events', 'whatsapp_accounts', 'whatsapp_template_mappings',
    'whatsapp_conversations', 'whatsapp_messages', 'whatsapp_webhook_events',
    'outreach_experiments', 'outreach_experiment_arms', 'outreach_assignments',
    'ml_feature_schemas', 'ml_datasets', 'ml_model_versions', 'ml_training_runs',
    'ml_predictions', 'ml_metrics'
  ];
  -- Tables platform_owner/platform_admin configure and operate.
  staff_write_tables text[] := array[
    'outreach_templates', 'prospect_outreach_eligibility', 'outreach_channel_policies',
    'outreach_campaigns', 'outreach_recipients', 'whatsapp_accounts',
    'whatsapp_template_mappings', 'outreach_experiments', 'outreach_experiment_arms',
    'ml_model_versions'
  ];
  -- Tables the Worker writes as it runs the pipeline.
  worker_write_tables text[] := array[
    'outreach_recipients', 'outreach_events', 'whatsapp_conversations',
    'whatsapp_messages', 'whatsapp_webhook_events', 'outreach_assignments',
    'ml_datasets', 'ml_model_versions', 'ml_training_runs', 'ml_predictions',
    'ml_metrics', 'prospect_outreach_eligibility', 'outreach_campaigns'
  ];
  -- Reference/config the Worker only reads.
  worker_read_tables text[] := array[
    'outreach_sales_angles', 'outreach_templates', 'outreach_channel_policies',
    'whatsapp_accounts', 'whatsapp_template_mappings', 'outreach_experiments',
    'outreach_experiment_arms', 'ml_feature_schemas'
  ];
begin
  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I_select_platform_staff on public.%I', t, t);
    execute format(
      'create policy %I_select_platform_staff on public.%I for select to authenticated using ((select private.has_platform_role(array[''platform_owner'',''platform_admin'',''platform_support'']::public.platform_role[])))',
      t, t
    );
    execute format('grant select on public.%I to authenticated', t);
  end loop;

  foreach t in array staff_write_tables loop
    execute format('drop policy if exists %I_insert_platform_admin on public.%I', t, t);
    execute format(
      'create policy %I_insert_platform_admin on public.%I for insert to authenticated with check ((select private.is_platform_admin()))',
      t, t
    );
    execute format('drop policy if exists %I_update_platform_admin on public.%I', t, t);
    execute format(
      'create policy %I_update_platform_admin on public.%I for update to authenticated using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()))',
      t, t
    );
    execute format('drop policy if exists %I_delete_platform_admin on public.%I', t, t);
    execute format(
      'create policy %I_delete_platform_admin on public.%I for delete to authenticated using ((select private.is_platform_admin()))',
      t, t
    );
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;

  foreach t in array worker_write_tables loop
    execute format('drop policy if exists %I_all_prospect_worker on public.%I', t, t);
    execute format(
      'create policy %I_all_prospect_worker on public.%I for all to prospect_worker using (true) with check (true)',
      t, t
    );
    execute format('grant select, insert, update, delete on public.%I to prospect_worker', t);
  end loop;

  foreach t in array worker_read_tables loop
    execute format('drop policy if exists %I_select_prospect_worker on public.%I', t, t);
    execute format('create policy %I_select_prospect_worker on public.%I for select to prospect_worker using (true)', t, t);
    execute format('grant select on public.%I to prospect_worker', t);
  end loop;
end
$$;

-- Append-only audit surfaces: nobody rewrites outcome history or
-- prediction history, not even platform_owner.
revoke update, delete on public.outreach_events from authenticated, prospect_worker;
revoke update, delete on public.ml_predictions from authenticated, prospect_worker;
revoke delete on public.whatsapp_messages from authenticated;
revoke delete on public.whatsapp_webhook_events from authenticated, prospect_worker;

-- Reference data is deploy-managed.
revoke insert, update, delete on public.outreach_sales_angles from authenticated, prospect_worker;
revoke insert, update, delete on public.ml_feature_schemas from authenticated;

-- ============================================================================
-- 11. Operator control RPCs
-- ============================================================================

-- Approve a template. Separate from a raw UPDATE so approval is one
-- explicit, auditable action rather than a field edit.
create or replace function public.approve_outreach_template(p_template_id uuid)
returns public.outreach_templates
language plpgsql
security definer
set search_path = ''
as $$
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

revoke execute on function public.approve_outreach_template(uuid) from public, anon;
grant execute on function public.approve_outreach_template(uuid) to authenticated;

-- Pause/resume a template — the operator kill switch (spec §72).
create or replace function public.set_outreach_template_paused(p_template_id uuid, p_paused boolean)
returns public.outreach_templates
language plpgsql
security definer
set search_path = ''
as $$
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

revoke execute on function public.set_outreach_template_paused(uuid, boolean) from public, anon;
grant execute on function public.set_outreach_template_paused(uuid, boolean) to authenticated;

-- Explicit, human model promotion (spec §73). Demotes the incumbent for
-- the same (model_key, target) in the same transaction so the "exactly one
-- active" index can never be violated mid-flight.
create or replace function public.promote_ml_model(p_model_version_id uuid, p_evaluation_notes text)
returns public.ml_model_versions
language plpgsql
security definer
set search_path = ''
as $$
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

revoke execute on function public.promote_ml_model(uuid, text) from public, anon;
grant execute on function public.promote_ml_model(uuid, text) to authenticated;

-- Retire the active model for a decision task — the "disable ML selection,
-- fall back to rules" control (spec §72).
create or replace function public.retire_ml_model(p_model_version_id uuid)
returns public.ml_model_versions
language plpgsql
security definer
set search_path = ''
as $$
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

revoke execute on function public.retire_ml_model(uuid) from public, anon;
grant execute on function public.retire_ml_model(uuid) to authenticated;

-- Suppress a prospect from all future outreach, on every channel, in one
-- action. Wraps the pre-existing prospect_suppressions table rather than
-- introducing a parallel mechanism.
create or replace function public.suppress_prospect_outreach(p_prospect_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

revoke execute on function public.suppress_prospect_outreach(uuid, text) from public, anon;
grant execute on function public.suppress_prospect_outreach(uuid, text) to authenticated;

-- Campaign lifecycle. Validates the transition rather than trusting a raw
-- UPDATE, and stamps the approval the outreach_campaigns CHECK requires.
create or replace function public.set_outreach_campaign_status(p_campaign_id uuid, p_status public.outreach_campaign_status)
returns public.outreach_campaigns
language plpgsql
security definer
set search_path = ''
as $$
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

revoke execute on function public.set_outreach_campaign_status(uuid, public.outreach_campaign_status) from public, anon;
grant execute on function public.set_outreach_campaign_status(uuid, public.outreach_campaign_status) to authenticated;

-- Manual reply classification (spec §34: build the UI, do not invent the
-- label). Writes an append-only outreach_events row and advances the
-- recipient state.
create or replace function public.classify_outreach_reply(p_recipient_id uuid, p_positive boolean, p_note text default null)
returns public.outreach_recipients
language plpgsql
security definer
set search_path = ''
as $$
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

revoke execute on function public.classify_outreach_reply(uuid, boolean, text) from public, anon;
grant execute on function public.classify_outreach_reply(uuid, boolean, text) to authenticated;

-- Human locale override (spec §72).
create or replace function public.override_prospect_locale(p_prospect_id uuid, p_locale text)
returns public.prospect_locales
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function public.override_prospect_locale(uuid, text) from public, anon;
grant execute on function public.override_prospect_locale(uuid, text) to authenticated;

-- Manual competitor override (spec §72). Recorded as a normal observation
-- with detection_method = 'manual_override' so the history stays uniform.
create or replace function public.override_prospect_booking_provider(
  p_prospect_id uuid,
  p_provider_key text,
  p_note text default null
)
returns public.booking_provider_observations
language plpgsql
security definer
set search_path = ''
as $$
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

revoke execute on function public.override_prospect_booking_provider(uuid, text, text) from public, anon;
grant execute on function public.override_prospect_booking_provider(uuid, text, text) to authenticated;

-- ============================================================================
-- 12. Analytics views
-- ============================================================================
-- Views (not materialized) so /platform always reads live data — spec §40
-- "Do not hardcode percentages. Use actual database data."
--
-- security_invoker = on: the view executes with the CALLER's privileges, so
-- the underlying tables' RLS still applies. Without it, a view owned by
-- postgres would leak acquisition data to any authenticated user.

create or replace view public.outreach_funnel_stats
with (security_invoker = on) as
select
  c.id as campaign_id,
  c.name as campaign_name,
  r.template_id,
  t.key as template_key,
  r.locale,
  r.sales_angle,
  r.experiment_id,
  r.experiment_arm,
  bp.key as booking_provider_key,
  p.country,
  count(*) as recipients,
  count(*) filter (where r.state = 'blocked') as blocked,
  count(*) filter (where r.state not in ('pending', 'blocked')) as queued_or_beyond,
  count(*) filter (where r.sent_at is not null) as sent,
  count(*) filter (where r.delivered_at is not null) as delivered,
  count(*) filter (where r.read_at is not null) as read,
  count(*) filter (where r.replied_at is not null) as replied,
  count(*) filter (where r.state = 'positive_reply') as positive_reply,
  count(*) filter (where r.state = 'negative_reply') as negative_reply,
  count(*) filter (where r.state = 'opted_out') as opted_out,
  count(*) filter (where r.state in ('claimed', 'activated', 'paid')) as claimed,
  count(*) filter (where r.state in ('activated', 'paid')) as activated,
  count(*) filter (where r.state = 'paid') as paid
from public.outreach_recipients r
join public.outreach_campaigns c on c.id = r.campaign_id
join public.prospects p on p.id = r.prospect_id
left join public.outreach_templates t on t.id = r.template_id
left join public.booking_providers bp on bp.id = p.current_booking_provider_id
group by c.id, c.name, r.template_id, t.key, r.locale, r.sales_angle,
         r.experiment_id, r.experiment_arm, bp.key, p.country;

comment on view public.outreach_funnel_stats is
  'Live funnel counts sliced by campaign/template/locale/angle/experiment/competitor/country. security_invoker = on, so the caller''s RLS on the underlying tables still applies.';

create or replace view public.competitor_analytics
with (security_invoker = on) as
select
  bp.id as provider_id,
  bp.key as provider_key,
  bp.display_name,
  bp.is_sentinel,
  count(p.id) as discovered,
  count(p.id) filter (where p.status in ('qualified', 'selected', 'contacted', 'replied', 'demo', 'trial', 'customer')) as qualified,
  count(distinct r.prospect_id) filter (where r.sent_at is not null) as contacted,
  count(distinct r.prospect_id) filter (where r.replied_at is not null) as replied,
  count(distinct r.prospect_id) filter (where r.state = 'positive_reply') as positive_reply,
  count(distinct r.prospect_id) filter (where r.state in ('claimed', 'activated', 'paid')) as claimed,
  count(distinct r.prospect_id) filter (where r.state in ('activated', 'paid')) as activated,
  count(distinct r.prospect_id) filter (where r.state = 'paid') as paid,
  avg(p.migration_potential_score) filter (where p.migration_potential_score is not null) as avg_migration_score,
  avg(p.fadeup_fit_score) filter (where p.fadeup_fit_score is not null) as avg_fit_score
from public.booking_providers bp
left join public.prospects p on p.current_booking_provider_id = bp.id
left join public.outreach_recipients r on r.prospect_id = p.id
group by bp.id, bp.key, bp.display_name, bp.is_sentinel;

comment on view public.competitor_analytics is
  'Per-competitor discovery -> paid funnel, computed from real rows. Prospects with NO observation at all are absent here by design: they are UNKNOWN, and lumping them under NO_BOOKING would be exactly the conflation spec §10 forbids.';

create or replace view public.prospect_score_distribution
with (security_invoker = on) as
select
  s.score_kind,
  count(*) as scored,
  avg(s.score)::numeric(6, 2) as mean_score,
  percentile_cont(0.5) within group (order by s.score)::numeric(6, 2) as median_score,
  stddev_pop(s.score)::numeric(6, 2) as stddev_score,
  percentile_cont(0.1) within group (order by s.score)::numeric(6, 2) as p10,
  percentile_cont(0.25) within group (order by s.score)::numeric(6, 2) as p25,
  percentile_cont(0.75) within group (order by s.score)::numeric(6, 2) as p75,
  percentile_cont(0.9) within group (order by s.score)::numeric(6, 2) as p90,
  count(*) filter (where s.classification = 'HOT') as hot_count,
  count(*) filter (where s.classification = 'WARM') as warm_count,
  count(*) filter (where s.classification = 'COLD') as cold_count,
  -- Pathological-scoring detector (spec §42): a score that cannot separate
  -- prospects is worse than no score, and the operator must see that.
  (stddev_pop(s.score) < 5 and count(*) >= 50) as low_discrimination_warning
from public.prospect_fit_scores s
where s.is_current
group by s.score_kind;

comment on view public.prospect_score_distribution is
  'Score-health monitor. low_discrimination_warning fires when a score''s standard deviation collapses below 5 points over a meaningful sample — the "nearly every prospect is 85-95" pathology from spec §42.';

create or replace view public.template_performance
with (security_invoker = on) as
select
  t.id as template_id,
  t.key as template_key,
  t.name,
  t.locale,
  t.status,
  t.sales_angle,
  t.segment_key,
  bp.key as booking_provider_key,
  count(r.id) as recipients,
  count(r.id) filter (where r.sent_at is not null) as sent,
  count(r.id) filter (where r.delivered_at is not null) as delivered,
  count(r.id) filter (where r.read_at is not null) as read,
  count(r.id) filter (where r.replied_at is not null) as replied,
  count(r.id) filter (where r.state = 'positive_reply') as positive_reply,
  count(r.id) filter (where r.state = 'opted_out') as opted_out,
  count(r.id) filter (where r.state in ('claimed', 'activated', 'paid')) as claimed,
  count(r.id) filter (where r.state in ('activated', 'paid')) as activated,
  count(r.id) filter (where r.state = 'paid') as paid,
  -- Rates are NULL, not 0, when the denominator is zero: an untested
  -- template must not look like a 0%-performing one.
  case when count(r.id) filter (where r.sent_at is not null) > 0
       then (count(r.id) filter (where r.replied_at is not null))::numeric
            / (count(r.id) filter (where r.sent_at is not null))
  end as reply_rate,
  case when count(r.id) filter (where r.sent_at is not null) > 0
       then (count(r.id) filter (where r.state = 'positive_reply'))::numeric
            / (count(r.id) filter (where r.sent_at is not null))
  end as positive_reply_rate,
  case when count(r.id) filter (where r.sent_at is not null) > 0
       then (count(r.id) filter (where r.state in ('activated', 'paid')))::numeric
            / (count(r.id) filter (where r.sent_at is not null))
  end as activation_rate,
  case when count(r.id) filter (where r.sent_at is not null) > 0
       then (count(r.id) filter (where r.state = 'paid'))::numeric
            / (count(r.id) filter (where r.sent_at is not null))
  end as paid_rate
from public.outreach_templates t
left join public.outreach_recipients r on r.template_id = t.id
left join public.booking_providers bp on bp.id = t.booking_provider_id
group by t.id, t.key, t.name, t.locale, t.status, t.sales_angle, t.segment_key, bp.key;

comment on view public.template_performance is
  'Per-template funnel through to paid. Rates are NULL when nothing has been sent — never 0 — so an untested template is visibly untested rather than apparently failing (spec §41).';

create or replace view public.experiment_results
with (security_invoker = on) as
select
  e.id as experiment_id,
  e.key as experiment_key,
  e.name as experiment_name,
  e.status,
  e.primary_metric,
  e.min_sample_per_arm,
  a.id as arm_id,
  a.arm_key,
  a.is_control,
  t.key as template_key,
  count(asg.id) as assigned,
  count(r.id) filter (where r.sent_at is not null) as sent,
  count(r.id) filter (where r.replied_at is not null) as replied,
  count(r.id) filter (where r.state = 'positive_reply') as positive_reply,
  count(r.id) filter (where r.state in ('activated', 'paid')) as activated,
  count(r.id) filter (where r.state = 'paid') as paid,
  (count(r.id) filter (where r.sent_at is not null)) >= e.min_sample_per_arm as reached_min_sample
from public.outreach_experiments e
join public.outreach_experiment_arms a on a.experiment_id = e.id
join public.outreach_templates t on t.id = a.template_id
left join public.outreach_assignments asg on asg.arm_id = a.id
left join public.outreach_recipients r on r.id = asg.recipient_id
group by e.id, e.key, e.name, e.status, e.primary_metric, e.min_sample_per_arm,
         a.id, a.arm_key, a.is_control, t.key;

comment on view public.experiment_results is
  'Per-arm experiment outcomes. reached_min_sample tells the operator whether an arm has enough sent messages to be worth reading at all — a guard against calling a winner on 4 sends.';

-- ----------------------------------------------------------------------------
-- View + table grants, and the anon revoke.
-- ----------------------------------------------------------------------------
-- The Supabase bootstrap's ALTER DEFAULT PRIVILEGES grants every new
-- object in `public` to anon/authenticated/service_role, including write
-- privileges that make no sense on a view. Reset each view to exactly
-- SELECT for the roles that need it, and nothing for anon.
--
-- These views are security_invoker, so a reader only ever sees rows the
-- underlying tables' RLS already allows them — the revoke below is the
-- second lock on the same door, not the only one.
do $$
declare
  v text;
  views text[] := array[
    'outreach_funnel_stats', 'competitor_analytics', 'prospect_score_distribution',
    'template_performance', 'experiment_results'
  ];
begin
  foreach v in array views loop
    execute format('revoke all on public.%I from anon, authenticated, prospect_worker', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;

  -- The Worker reads the three views it uses for benchmarking and
  -- outcome reconciliation; it has no reason to read the rest.
  execute 'grant select on public.outreach_funnel_stats to prospect_worker';
  execute 'grant select on public.competitor_analytics to prospect_worker';
  execute 'grant select on public.template_performance to prospect_worker';
end
$$;

-- Same defense-in-depth revoke as the previous migration, for the tables
-- created here. See that file's comment for the full rationale.
do $$
declare
  t text;
  new_tables text[] := array[
    'outreach_sales_angles', 'outreach_templates', 'prospect_outreach_eligibility',
    'outreach_channel_policies', 'outreach_campaigns', 'outreach_recipients',
    'outreach_events', 'whatsapp_accounts', 'whatsapp_template_mappings',
    'whatsapp_conversations', 'whatsapp_messages', 'whatsapp_webhook_events',
    'outreach_experiments', 'outreach_experiment_arms', 'outreach_assignments',
    'ml_feature_schemas', 'ml_datasets', 'ml_model_versions', 'ml_training_runs',
    'ml_predictions', 'ml_metrics'
  ];
begin
  foreach t in array new_tables loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;


-- ============================================================================
-- END db/migrations/20260818100100_prospect_outreach_whatsapp_ml.sql
-- ============================================================================

commit;

-- ============================================================================
-- Applied. Next step: run
--   supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
-- and confirm 0 unexpected FAIL rows.
-- ============================================================================
