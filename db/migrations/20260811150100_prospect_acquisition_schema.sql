-- FadeUp — Prospect Worker V2
-- Migration: prospect acquisition core schema
--
-- This is FadeUp's OWN sales/growth data — completely distinct from the
-- tenant schema (organizations/memberships/appointments/...). There is no
-- organization_id on any table here: a "prospect" is a business FadeUp does
-- not yet have as a customer, so CLAUDE.md's tenant-isolation rules do not
-- apply to this schema the way they apply to business tables. Instead,
-- every table here is gated to FadeUp's own platform staff
-- (public.platform_members, see 20260810130000_platform_roles.sql) — never
-- anon, never an ordinary barbershop/customer authenticated user.
--
-- Two distinct write paths, matching the split already established for
-- other worker-fed systems in this schema:
--   1. public.prospect_worker — a dedicated, non-superuser Postgres role
--      the Worker V2 process connects as DIRECTLY (not through PostgREST —
--      job claiming needs FOR UPDATE SKIP LOCKED, which the REST layer
--      cannot express). Explicit `to prospect_worker` RLS policies grant it
--      exactly the rows/tables it needs; it is NOT granted BYPASSRLS or any
--      elevated role attribute, keeping it auditable the same way every
--      other access path in this schema is: named policies, not a
--      blanket bypass. The role's LOGIN password is set out-of-band by
--      infra/worker/bootstrap-worker-db.sh from infra/worker/.env.worker
--      (never in a migration file).
--   2. FadeUp platform staff (platform_owner/platform_admin/
--      platform_support) via the ordinary Supabase client, same
--      private.is_platform_admin() / private.has_platform_role() helpers
--      used throughout /platform. Read access is available to all three
--      platform roles (browsing prospects is not sensitive tenant data);
--      direct write access (notes, tags, manual outreach logging,
--      suppression, duplicate resolution, source config) is
--      platform_owner/platform_admin only, matching the conservative
--      posture set in 20260810140000_platform_control_center.sql.
--
-- The prospect_worker role itself is created here (idempotent, NOLOGIN
-- until the bootstrap script sets a password) so this migration and the
-- next one can reference it in RLS policies/grants without ordering
-- dependence on the infra script having already run.
--
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    create role prospect_worker with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password null;
  end if;
end
$$;

comment on role prospect_worker is
  'Dedicated runtime role for the FadeUp Prospect Worker V2 process. Not superuser, not BYPASSRLS — scoped to prospect_*/api_* tables via named RLS policies. Password set by infra/worker/bootstrap-worker-db.sh, never in a migration.';

grant usage on schema public to prospect_worker;
grant usage on schema extensions to prospect_worker;
grant usage on schema private to prospect_worker;

-- postgres is NOT superuser in this self-hosted setup (confirmed: rolsuper
-- = false, rolcreaterole = true) — SET ROLE to another role requires
-- membership, not just createrole. Granting membership lets
-- ops/test tooling impersonate prospect_worker via `SET ROLE
-- prospect_worker` (used by db/tests/verify_prospect_worker_v2.sql) without
-- granting prospect_worker itself any elevated privilege.
grant prospect_worker to postgres;

-- Enums -----------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_type') then
    create type public.prospect_type as enum ('barbershop', 'independent_barber');
  end if;
end $$;

comment on type public.prospect_type is 'What kind of business a prospect is. Fixed set per the Prospect Worker V2 spec.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_entity_kind') then
    create type public.prospect_entity_kind as enum ('independent', 'group_parent', 'group_location');
  end if;
end $$;

comment on type public.prospect_entity_kind is
  'Future-proofing for chains/multi-location groups: group_parent is the chain entity, group_location rows point to it via prospects.parent_group_id. Discovery currently only ever produces independent rows — grouping is not auto-detected yet.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_pipeline_stage') then
    create type public.prospect_pipeline_stage as enum (
      'discovered', 'enriched', 'qualified', 'selected', 'contacted', 'replied', 'demo', 'trial', 'customer', 'lost'
    );
  end if;
end $$;

comment on type public.prospect_pipeline_stage is
  'Sales pipeline stage. Worker V2 only ever writes discovered/enriched/qualified — contacted onward is a manual/CRM action, per the spec''s "do not begin uncontrolled outreach automatically".';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_score_bucket') then
    create type public.prospect_score_bucket as enum ('LOW', 'MEDIUM', 'HIGH', 'HOT');
  end if;
end $$;

comment on type public.prospect_score_bucket is '0-39 LOW, 40-69 MEDIUM, 70-84 HIGH, 85-100 HOT — see private.prospect_score_bucket_for().';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_social_platform') then
    create type public.prospect_social_platform as enum ('instagram', 'facebook', 'tiktok', 'twitter', 'youtube', 'linkedin', 'other');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_duplicate_status') then
    create type public.prospect_duplicate_status as enum ('pending', 'confirmed_duplicate', 'confirmed_distinct');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_suppression_scope') then
    create type public.prospect_suppression_scope as enum ('prospect', 'phone', 'email', 'domain', 'instagram_handle');
  end if;
end $$;

comment on type public.prospect_suppression_scope is
  'A suppression may target a specific prospect row, or a raw normalized identifier (phone/email/domain/instagram_handle) so re-discovery under a different source cannot resurrect a previously-suppressed business under a new prospect id.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_outreach_channel') then
    create type public.prospect_outreach_channel as enum ('email', 'phone', 'sms', 'instagram_dm', 'in_person', 'other');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_outreach_direction') then
    create type public.prospect_outreach_direction as enum ('outbound', 'inbound');
  end if;
end $$;

-- prospect_sources --------------------------------------------------------------
-- Registry of discovery/enrichment source adapters. A row here does not
-- imply credentials are configured — is_enabled is an operator-facing
-- toggle, actual usability additionally depends on the Worker process
-- finding the relevant API key in its own environment. config holds
-- non-secret tuning only; secrets never live in the database.
create table if not exists public.prospect_sources (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]+$'),
  display_name text not null,
  is_enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prospect_sources is
  'Registry of discovery/enrichment adapters (osm, geoapify, sirene, google_places, website, instagram). config is non-secret tuning only — API keys live in Worker environment, never here.';

insert into public.prospect_sources (key, display_name, is_enabled, config) values
  ('osm', 'OpenStreetMap / Overpass', true, '{}'::jsonb),
  ('geoapify', 'Geoapify Places', true, '{}'::jsonb),
  ('sirene', 'INSEE Sirene', true, '{}'::jsonb),
  ('google_places', 'Google Places API (New)', true, '{}'::jsonb),
  ('website', 'Website enrichment', true, '{}'::jsonb),
  ('instagram', 'Instagram (official Meta API)', false, '{}'::jsonb)
on conflict (key) do nothing;

drop trigger if exists prospect_sources_set_updated_at on public.prospect_sources;
create trigger prospect_sources_set_updated_at
  before update on public.prospect_sources
  for each row execute function public.set_updated_at();

-- prospects -----------------------------------------------------------------
create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  type public.prospect_type not null,
  entity_kind public.prospect_entity_kind not null default 'independent',
  parent_group_id uuid references public.prospects (id) on delete set null,
  status public.prospect_pipeline_stage not null default 'discovered',
  canonical_name text not null check (btrim(canonical_name) <> ''),
  country text not null check (country ~ '^[A-Z]{2}$'),
  website_url text,
  website_domain text,
  phone_e164 text,
  email text,
  current_score int check (current_score between 0 and 100),
  current_score_bucket public.prospect_score_bucket,
  do_not_contact boolean not null default false,
  converted_organization_id uuid references public.organizations (id) on delete set null,
  first_discovered_at timestamptz not null default now(),
  last_enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospects_parent_not_self check (parent_group_id is null or parent_group_id <> id)
);

comment on table public.prospects is
  'Canonical (post-dedup) business entity discovered by Worker V2. FadeUp''s own sales data — no organization_id, gated to platform staff only. See migration header.';

create index if not exists prospects_type_idx on public.prospects (type);
create index if not exists prospects_status_idx on public.prospects (status);
create index if not exists prospects_country_idx on public.prospects (country);
create index if not exists prospects_website_domain_idx on public.prospects (website_domain) where website_domain is not null;
create index if not exists prospects_phone_e164_idx on public.prospects (phone_e164) where phone_e164 is not null;
create index if not exists prospects_score_bucket_idx on public.prospects (current_score_bucket);
create index if not exists prospects_do_not_contact_idx on public.prospects (do_not_contact) where do_not_contact;
create index if not exists prospects_parent_group_id_idx on public.prospects (parent_group_id) where parent_group_id is not null;
create index if not exists prospects_created_at_idx on public.prospects (created_at desc);
create index if not exists prospects_canonical_name_trgm_idx on public.prospects using gin (canonical_name extensions.gin_trgm_ops);

drop trigger if exists prospects_set_updated_at on public.prospects;
create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

-- prospect_locations ------------------------------------------------------------
create table if not exists public.prospect_locations (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  is_primary boolean not null default true,
  address_line text,
  city text,
  postal_code text,
  region text,
  country text not null check (country ~ '^[A-Z]{2}$'),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospect_locations_lat_lon_together check (
    (latitude is null and longitude is null) or (latitude is not null and longitude is not null)
  )
);

comment on table public.prospect_locations is 'One or more physical locations for a prospect. A group_parent prospect (see prospect_entity_kind) typically has none of its own — its group_location children each have one.';

create unique index if not exists prospect_locations_one_primary_per_prospect
  on public.prospect_locations (prospect_id)
  where is_primary;

create index if not exists prospect_locations_prospect_id_idx on public.prospect_locations (prospect_id);
create index if not exists prospect_locations_country_city_idx on public.prospect_locations (country, city);
create index if not exists prospect_locations_geo_idx
  on public.prospect_locations using gist (extensions.ll_to_earth(latitude, longitude))
  where latitude is not null and longitude is not null;

drop trigger if exists prospect_locations_set_updated_at on public.prospect_locations;
create trigger prospect_locations_set_updated_at
  before update on public.prospect_locations
  for each row execute function public.set_updated_at();

-- prospect_contacts ---------------------------------------------------------
create table if not exists public.prospect_contacts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  full_name text,
  role_title text,
  phone_e164 text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospect_contacts_has_identity check (
    full_name is not null or phone_e164 is not null or email is not null
  )
);

comment on table public.prospect_contacts is 'Named individual contacts at a prospect (owner, manager, ...), distinct from the business-level phone/email on prospects itself.';

create index if not exists prospect_contacts_prospect_id_idx on public.prospect_contacts (prospect_id);

drop trigger if exists prospect_contacts_set_updated_at on public.prospect_contacts;
create trigger prospect_contacts_set_updated_at
  before update on public.prospect_contacts
  for each row execute function public.set_updated_at();

-- prospect_social_profiles ---------------------------------------------------
create table if not exists public.prospect_social_profiles (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  platform public.prospect_social_platform not null,
  handle text,
  url text,
  external_id text,
  follower_count int check (follower_count is null or follower_count >= 0),
  is_business_account boolean,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospect_social_profiles_handle_or_url check (handle is not null or url is not null)
);

create unique index if not exists prospect_social_profiles_unique_handle
  on public.prospect_social_profiles (prospect_id, platform, handle)
  where handle is not null;

create index if not exists prospect_social_profiles_prospect_id_idx on public.prospect_social_profiles (prospect_id);

drop trigger if exists prospect_social_profiles_set_updated_at on public.prospect_social_profiles;
create trigger prospect_social_profiles_set_updated_at
  before update on public.prospect_social_profiles
  for each row execute function public.set_updated_at();

-- prospect_source_records (provenance) ---------------------------------------
-- One row per raw record fetched from a source, BEFORE/alongside
-- canonicalization into a prospects row. This is the provenance trail the
-- spec requires ("never lose source provenance during canonicalization") —
-- prospect_id starts null (a fresh, not-yet-linked candidate) and is set
-- once the Worker's dedup step resolves it to a canonical prospect, which
-- may already exist from a different source.
--
-- job_id references public.prospect_jobs, created in the next migration
-- (20260811150200_prospect_job_queue.sql) — the FK is added there via
-- ALTER TABLE once that table exists, to avoid a forward reference here.
create table if not exists public.prospect_source_records (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.prospect_sources (id),
  prospect_id uuid references public.prospects (id) on delete set null,
  external_id text,
  external_type text,
  source_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  fetched_at timestamptz not null default now(),
  last_verified_at timestamptz,
  job_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.prospect_source_records is
  'Raw per-source record + provenance (external_id, source_url, fetched_at, confidence). Never overwritten/discarded during canonicalization — see migration header.';

create unique index if not exists prospect_source_records_unique_external
  on public.prospect_source_records (source_id, external_id)
  where external_id is not null;

create index if not exists prospect_source_records_prospect_id_idx on public.prospect_source_records (prospect_id);
create index if not exists prospect_source_records_job_id_idx on public.prospect_source_records (job_id) where job_id is not null;

-- prospect_scores -------------------------------------------------------------
-- Append-only score history. prospects.current_score/current_score_bucket is
-- a denormalized cache of the latest row here, kept in sync by trigger
-- (see prospect_scores_sync_prospect below) so list/filter views never need
-- a correlated subquery just to show a score.
create table if not exists public.prospect_scores (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  score int not null check (score between 0 and 100),
  bucket public.prospect_score_bucket not null,
  factors jsonb not null default '[]'::jsonb,
  scored_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.prospect_scores is 'Append-only score history with an explainable factor breakdown (factors: [{factor, points, max_points, explanation}, ...]). No AI — deterministic rule scoring only, per spec.';

create index if not exists prospect_scores_prospect_id_scored_at_idx on public.prospect_scores (prospect_id, scored_at desc);

create or replace function private.prospect_scores_sync_prospect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.prospects
  set current_score = new.score, current_score_bucket = new.bucket
  where id = new.prospect_id;
  return new;
end;
$$;

drop trigger if exists prospect_scores_sync_prospect on public.prospect_scores;
create trigger prospect_scores_sync_prospect
  after insert on public.prospect_scores
  for each row execute function private.prospect_scores_sync_prospect();

-- prospect_events (append-only timeline) -----------------------------------
create table if not exists public.prospect_events (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  event_type text not null check (btrim(event_type) <> ''),
  actor_user_id uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.prospect_events is 'Append-only prospect timeline (pipeline transitions, enrichment runs, ...). actor_user_id null means the Worker/system, not a platform staff member.';

create index if not exists prospect_events_prospect_id_created_at_idx on public.prospect_events (prospect_id, created_at desc);

revoke update, delete on public.prospect_events from anon, authenticated, prospect_worker;

-- Pipeline-stage transitions are logged automatically, on ANY update path
-- (Worker direct writes or platform-staff UPDATEs alike) — SECURITY DEFINER
-- so it always succeeds regardless of which of those two grant sets the
-- caller has for prospect_events itself.
create or replace function private.log_prospect_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.prospect_events (prospect_id, event_type, actor_user_id, metadata)
    values (
      new.id,
      'pipeline_stage_changed',
      (select auth.uid()),
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists prospects_log_status_change on public.prospects;
create trigger prospects_log_status_change
  after update on public.prospects
  for each row execute function private.log_prospect_status_change();

-- prospect_tags ---------------------------------------------------------------
create table if not exists public.prospect_tags (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  tag text not null check (btrim(tag) <> ''),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (prospect_id, tag)
);

create index if not exists prospect_tags_prospect_id_idx on public.prospect_tags (prospect_id);

-- prospect_duplicates -----------------------------------------------------------
create table if not exists public.prospect_duplicates (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  duplicate_of_prospect_id uuid not null references public.prospects (id) on delete cascade,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  reason text not null check (btrim(reason) <> ''),
  status public.prospect_duplicate_status not null default 'pending',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint prospect_duplicates_not_self check (prospect_id <> duplicate_of_prospect_id)
);

comment on table public.prospect_duplicates is 'Candidate duplicate pairs awaiting platform-staff review. Never auto-merged — see spec: "Do not automatically merge uncertain candidates."';

-- One candidate row per unordered pair — a (A,B) match and a (B,A) match
-- discovered independently are the same real-world candidacy.
create unique index if not exists prospect_duplicates_unique_pair
  on public.prospect_duplicates (least(prospect_id, duplicate_of_prospect_id), greatest(prospect_id, duplicate_of_prospect_id));

create index if not exists prospect_duplicates_status_idx on public.prospect_duplicates (status);

create or replace function private.prospect_duplicates_stamp_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status <> 'pending' then
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists prospect_duplicates_stamp_review on public.prospect_duplicates;
create trigger prospect_duplicates_stamp_review
  before update on public.prospect_duplicates
  for each row execute function private.prospect_duplicates_stamp_review();

-- prospect_notes ----------------------------------------------------------------
create table if not exists public.prospect_notes (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null,
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prospect_notes_prospect_id_idx on public.prospect_notes (prospect_id, created_at desc);

drop trigger if exists prospect_notes_set_updated_at on public.prospect_notes;
create trigger prospect_notes_set_updated_at
  before update on public.prospect_notes
  for each row execute function public.set_updated_at();

-- prospect_outreach ---------------------------------------------------------
-- Manual logging only for V1 — Worker V2 does not send outreach itself, per
-- spec ("Do NOT begin uncontrolled outreach automatically").
create table if not exists public.prospect_outreach (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  channel public.prospect_outreach_channel not null,
  direction public.prospect_outreach_direction not null default 'outbound',
  summary text,
  occurred_at timestamptz not null default now(),
  logged_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists prospect_outreach_prospect_id_idx on public.prospect_outreach (prospect_id, occurred_at desc);

-- prospect_suppressions (global Do Not Contact) --------------------------------
create table if not exists public.prospect_suppressions (
  id uuid primary key default gen_random_uuid(),
  scope public.prospect_suppression_scope not null,
  prospect_id uuid references public.prospects (id) on delete set null,
  value text,
  reason text not null check (btrim(reason) <> ''),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint prospect_suppressions_shape check (
    (scope = 'prospect' and prospect_id is not null and value is null)
    or (scope <> 'prospect' and value is not null)
  )
);

comment on table public.prospect_suppressions is
  'Global Do Not Contact list. Identifier-scoped rows (phone/email/domain/instagram_handle) block re-selection even under a freshly-discovered prospect id — see private.is_prospect_value_suppressed().';

create unique index if not exists prospect_suppressions_unique_prospect
  on public.prospect_suppressions (prospect_id)
  where scope = 'prospect';

create unique index if not exists prospect_suppressions_unique_value
  on public.prospect_suppressions (scope, value)
  where value is not null;

-- Keeps prospects.do_not_contact (the fast, indexed filter list/dedup code
-- checks) in sync whenever a prospect-scoped suppression is added.
create or replace function private.prospect_suppressions_sync_prospect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scope = 'prospect' and new.prospect_id is not null then
    update public.prospects set do_not_contact = true where id = new.prospect_id;
  end if;
  return new;
end;
$$;

drop trigger if exists prospect_suppressions_sync_prospect on public.prospect_suppressions;
create trigger prospect_suppressions_sync_prospect
  after insert on public.prospect_suppressions
  for each row execute function private.prospect_suppressions_sync_prospect();

-- private.is_prospect_value_suppressed: used by the Worker during
-- normalization/dedup to check a raw phone/email/domain/instagram handle
-- against the suppression list BEFORE a discovered candidate is written as
-- a new prospect — the whole point of identifier-scoped suppression is to
-- catch this pre-insert, not just post-hoc.
create or replace function private.is_prospect_value_suppressed(p_scope public.prospect_suppression_scope, p_value text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.prospect_suppressions
    where scope = p_scope and value = p_value
  );
$$;

comment on function private.is_prospect_value_suppressed(public.prospect_suppression_scope, text) is
  'True if the given normalized identifier is on the global suppression list. Called by the Worker pre-insert, not just enforced after the fact.';

grant execute on function private.is_prospect_value_suppressed(public.prospect_suppression_scope, text) to prospect_worker, authenticated;

-- Row level security ------------------------------------------------------------
-- Uniform posture across every table in this migration:
--   SELECT      -> any platform role (owner/admin/support)
--   INSERT/UPDATE/DELETE (platform-staff-writable tables) -> owner/admin only
--   ALL         -> prospect_worker, on the tables the Worker itself produces
-- FORCE ROW LEVEL SECURITY is set on every table so even the table owner
-- (postgres, running as a superuser-equivalent role in this self-hosted
-- setup) is not implicitly exempt — consistent with every other table in
-- this schema.

do $$
declare
  t text;
  worker_write_tables text[] := array[
    'prospects', 'prospect_locations', 'prospect_contacts', 'prospect_social_profiles',
    'prospect_source_records', 'prospect_scores'
  ];
  staff_write_tables text[] := array[
    'prospects', 'prospect_tags', 'prospect_duplicates', 'prospect_notes',
    'prospect_outreach', 'prospect_suppressions', 'prospect_sources'
  ];
  all_tables text[] := array[
    'prospects', 'prospect_locations', 'prospect_contacts', 'prospect_social_profiles',
    'prospect_source_records', 'prospect_scores', 'prospect_events', 'prospect_tags',
    'prospect_duplicates', 'prospect_notes', 'prospect_outreach', 'prospect_suppressions',
    'prospect_sources'
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
  end loop;

  foreach t in array staff_write_tables loop
    execute format('drop policy if exists %I_write_platform_admin on public.%I', t, t);
    execute format(
      'create policy %I_write_platform_admin on public.%I for insert to authenticated with check ((select private.is_platform_admin()))',
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
  end loop;

  foreach t in array worker_write_tables loop
    execute format('drop policy if exists %I_all_prospect_worker on public.%I', t, t);
    execute format(
      'create policy %I_all_prospect_worker on public.%I for all to prospect_worker using (true) with check (true)',
      t, t
    );
    execute format('grant select, insert, update, delete on public.%I to prospect_worker', t);
  end loop;

  -- prospect_events: worker and platform-admin UPDATE paths both insert via
  -- the SECURITY DEFINER trigger above, never a direct client INSERT.
  execute 'drop policy if exists prospect_events_all_prospect_worker on public.prospect_events';
  execute 'create policy prospect_events_all_prospect_worker on public.prospect_events for all to prospect_worker using (true) with check (true)';
  execute 'grant select, insert, update, delete on public.prospect_events to prospect_worker';

  -- prospect_sources: worker needs read (which sources are enabled) but
  -- never writes it directly (toggling is a platform_admin action, via the
  -- staff_write_tables loop above).
  execute 'drop policy if exists prospect_sources_select_prospect_worker on public.prospect_sources';
  execute 'create policy prospect_sources_select_prospect_worker on public.prospect_sources for select to prospect_worker using (true)';
  execute 'grant select on public.prospect_sources to prospect_worker';
end
$$;

-- prospect_tags/prospect_notes/prospect_outreach/prospect_suppressions are
-- platform-admin-write, platform-staff-read only — no Worker write path.
-- The Worker never tags, notes, contacts, or suppresses on its own
-- initiative; those are explicitly human actions.
