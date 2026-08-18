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
