-- FadeUp — R3: the canonical analytics event log
--
-- WHAT THIS IS
--
--   One append-only table, public.analytics_events, plus the controlled
--   vocabulary that gives its rows meaning: public.analytics_event_definitions.
--
--   Before this migration FadeUp emits ZERO events. docs/v2/ANALYTICS_DRAFT.md
--   verified that: no PostHog, no GA, no Segment, no Sentry, no sendBeacon and
--   no fetch() to any third-party host anywhere in apps/web/src. R3 is
--   therefore a clean sheet, and the decisions below are made on merit rather
--   than inherited from an SDK.
--
-- THE FOUR STREAMS, AND WHY THIS IS ONLY THE SECOND
--
--   FadeUp already has three kinds of durable record and this table is none of
--   them. Keeping the boundary explicit is the single most important thing
--   this migration does, because every event-sourcing accident starts by
--   blurring it:
--
--     1. CURRENT PRODUCT STATE — organization_follows, professional_follows,
--        appointments, queue_entries, customer_favorites.
--        These remain the ONLY truth about what is true NOW. This migration
--        does not convert a single one of them into an event stream, does not
--        add an event id to any of them, and does not make any read path
--        replay events to answer "is this customer following this shop".
--
--     2. PRODUCT ANALYTICS HISTORY — this table. What HAPPENED, when, under
--        which commercial terms. Never consulted to decide product behaviour.
--
--     3. SECURITY / ADMIN AUDIT — audit_logs, platform_audit_log,
--        commercial_plan_changes, service_mode_changes. Who did an
--        administrative thing, for accountability. Retained on a different
--        schedule and read by a different audience.
--
--     4. WORKER EXECUTION LOGS — prospect_events, outreach_events,
--        prospect_jobs. How the acquisition machine ran.
--
--   An analytics event is DERIVED from (1), it does not replace it. If this
--   table were dropped tomorrow the product would behave identically and only
--   the reporting would go dark. That property is the design goal.
--
-- WHY NO FOREIGN KEYS ON analytics_events — A DELIBERATE DEPARTURE
--
--   Every other business table in this repository carries FKs, and CLAUDE.md
--   asks that they always be considered. They were, and this table is the one
--   place where they are wrong. Three independent reasons:
--
--     a. HISTORY MUST OUTLIVE ITS SUBJECT. `on delete cascade` would let
--        deleting one barber erase the record that four hundred services were
--        delivered — precisely the defect R0 found on appointments.barber_id
--        and R1A fixed. `on delete set null` is no better: it silently
--        rewrites an append-only row and destroys the attribution that made
--        the event worth keeping.
--
--     b. AN FK IS A WRITE ON THE HOT PATH. Thirteen context columns means
--        thirteen parent lookups and thirteen row locks per inserted event,
--        inside the same transaction as a booking or a queue join. §21 of the
--        R3 brief requires event writes stay cheap; this is where that is won.
--
--     c. FKs WOULD FORCE THIRTEEN MORE INDEXES. Postgres needs an index on the
--        referencing column for a parent DELETE to be anything but a seq scan.
--        Thirteen indexes on the highest-volume table in the schema is the
--        over-indexing §20 forbids.
--
--   Integrity is instead enforced where it belongs — at INGESTION. No client
--   can write here at all (see below); the ingestion functions in
--   20260827120200 resolve and validate every id they store. The ids in this
--   table are RECORDED VALUES, not live references, and that is what an
--   append-only log is.
--
-- WHY event_name IS TEXT AGAINST A REGISTRY, NOT AN ENUM
--
--   An enum cannot have a value removed, cannot carry a version, cannot record
--   whether an event is server-authoritative or client intent, and cannot say
--   "documented but not wired yet" — which §4 of the brief explicitly requires
--   for the events R3 defers. The registry table below answers all four, is
--   queryable, is testable, and is what the ingestion allowlist consults.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The controlled vocabularies
--
-- Enums here rather than in the registry, because origin and actor kind are
-- closed sets that the DATABASE must be able to reject — a mistyped origin
-- must fail the insert, not quietly create a new category that splits every
-- future report in two.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'analytics_event_origin') then
    -- customer_mobile and pro_web are listed and NOT wired. R3 builds no
    -- mobile app (§3) and instruments no professional surface; naming them
    -- now is what lets apps/mobile reuse this contract later without a
    -- migration, and costs nothing because an unused enum label is inert.
    create type public.analytics_event_origin as enum (
      'public_web',       -- unauthenticated marketing/discovery surface
      'customer_web',     -- signed-in customer experience
      'customer_mobile',  -- reserved for apps/mobile — not emitted in R3
      'pro_web',          -- professional/shop workspace
      'backend',          -- a database transition: server-authoritative
      'worker',           -- prospect-worker / acquisition pipeline
      'system'            -- scheduled or platform-internal
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'analytics_actor_type') then
    create type public.analytics_actor_type as enum (
      'anonymous',
      'customer',
      'professional',
      'staff',
      'platform_admin',
      'worker',
      'system'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'analytics_emission') then
    -- The distinction §5 is built on. A `server` event is evidence; a `client`
    -- event is a statement of intent by a browser and is never allowed to
    -- stand in for a business fact.
    create type public.analytics_emission as enum ('server', 'client');
  end if;

  if not exists (select 1 from pg_type where typname = 'analytics_event_status') then
    -- `deferred` is a first-class state. §4 requires the taxonomy to be able
    -- to DOCUMENT an event contract without wiring it, and forbids faking
    -- events for flows that do not exist. A deferred definition is rejected by
    -- the ingestion allowlist, so documenting one can never accidentally
    -- start producing rows.
    create type public.analytics_event_status as enum ('wired', 'deferred');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. public.analytics_event_definitions — the taxonomy, as data
--
-- Every event FadeUp knows about, whether or not R3 emits it. This is the
-- allowlist, the version register and the documentation, in one place that
-- tests can read.
-- ---------------------------------------------------------------------------

create table if not exists public.analytics_event_definitions (
  event_name text primary key,

  -- The CURRENT contract version for this event. Bumped when the meaning of
  -- `properties` changes incompatibly — see 20260827120200 and
  -- docs/v2/R3_ANALYTICS_EVENT_ENGINE.md for the rules. Historical rows keep
  -- the version they were written with, which is the whole point.
  event_version integer not null default 1,

  family text not null,

  emission public.analytics_emission not null,
  status public.analytics_event_status not null default 'deferred',

  -- Whether emission of this event is once-only for its subject. Drives the
  -- dedupe_key discipline in the emitter: `true` means a permanent
  -- entity-scoped key, `false` means a key scoped to the transition instant so
  -- that legitimate repeats stay separate (§6).
  is_idempotent boolean not null default false,

  -- Enforced at ingestion. An event that is meaningless without a tenant must
  -- never be recorded without one, or it silently vanishes from every
  -- per-organization report.
  requires_organization boolean not null default false,

  description text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint analytics_event_definitions_name_shape
    check (event_name ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint analytics_event_definitions_family_shape
    check (family ~ '^[a-z][a-z0-9_]{2,31}$'),
  constraint analytics_event_definitions_version_positive
    check (event_version >= 1),
  constraint analytics_event_definitions_description_not_blank
    check (btrim(description) <> ''),

  -- A client-emitted event can never be idempotent-by-entity: the browser has
  -- no authoritative transition to key on, and §6 explicitly forbids
  -- deduplicating repeated views and searches, which are legitimately
  -- repeated. Encoded as a constraint so the combination is unrepresentable
  -- rather than merely discouraged.
  constraint analytics_event_definitions_client_not_idempotent
    check (not (emission = 'client' and is_idempotent))
);

comment on table public.analytics_event_definitions is
  'The FadeUp analytics taxonomy, as queryable data rather than an enum. One row per event contract, including contracts that are documented but deliberately NOT wired in R3 (status = ''deferred''). This table IS the ingestion allowlist: private.emit_analytics_event refuses any event_name absent from it or marked deferred, so a typo becomes an error instead of a new category that quietly splits a funnel in half.';

comment on column public.analytics_event_definitions.event_version is
  'The CURRENT version of this event contract. Stamped onto new rows by the emitter; historical analytics_events rows keep the version they were written under, so a report can always tell which contract a row obeys.';

comment on column public.analytics_event_definitions.emission is
  '''server'' = produced by an authoritative database state transition and usable as evidence. ''client'' = a browser statement of intent. Constitution-level distinction: a click is not a business success, and no conversion metric may be built on a client event.';

comment on column public.analytics_event_definitions.is_idempotent is
  'True when the event can happen at most once for its subject (a completed appointment completes once). Such events get a permanent entity-scoped dedupe_key. False means repeats are legitimate and each carries a transition-scoped key instead, so a second genuine follow is not swallowed by the first.';

create index if not exists analytics_event_definitions_family_idx
  on public.analytics_event_definitions (family, event_name);

create index if not exists analytics_event_definitions_wired_idx
  on public.analytics_event_definitions (emission, event_name)
  where status = 'wired';

drop trigger if exists analytics_event_definitions_set_updated_at
  on public.analytics_event_definitions;
create trigger analytics_event_definitions_set_updated_at
  before update on public.analytics_event_definitions
  for each row execute function public.set_updated_at();

-- The taxonomy is not secret — but it is not a client-writable table either,
-- and nothing in apps/web needs to read it at runtime: the web adapter carries
-- its own typed copy (§19), and a runtime round-trip to discover event names
-- would be latency spent to learn something the bundle already knows.
alter table public.analytics_event_definitions enable row level security;
alter table public.analytics_event_definitions force row level security;

revoke all on table public.analytics_event_definitions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.analytics_events — the log
--
-- Column order below is the conceptual grouping from the R3 brief: identity,
-- time, actor, business context, acquisition, surface, commercial snapshot,
-- metadata. Nothing was added mechanically; every column has a named consumer
-- in §10's funnels or §18's query primitives, and columns that had neither
-- were left out (see the DELIBERATELY ABSENT note at the foot of this file).
-- ---------------------------------------------------------------------------

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),

  -- IDENTITY ---------------------------------------------------------------
  event_name text not null,

  -- Denormalized from the registry AT EMIT TIME, never joined at read time.
  -- If it were resolved by joining analytics_event_definitions, bumping a
  -- contract version would retroactively relabel every historical row and
  -- destroy the ability to interpret old data — the exact failure §7 exists to
  -- prevent.
  event_version integer not null default 1,

  -- TIME -------------------------------------------------------------------
  -- occurred_at is when the thing HAPPENED (for a server event, the instant of
  -- the state transition). ingested_at is when this row was written. They
  -- differ for anything replayed, backfilled or buffered, and reports that
  -- care about truth use occurred_at while reports that care about pipeline
  -- health use both.
  occurred_at timestamptz not null default now(),
  ingested_at timestamptz not null default now(),

  -- ACTOR ------------------------------------------------------------------
  actor_type public.analytics_actor_type not null,

  -- ALWAYS derived from auth.uid() or from authoritative server state. There
  -- is no ingestion path on which a caller supplies this value — see §11 and
  -- the argument list of public.track_analytics_event, which does not accept
  -- an actor.
  actor_user_id uuid,

  -- The org-scoped CRM row, when one is involved. Deliberately NOT the actor
  -- identity: R1A demoted customers.user_id from evidence because it was
  -- squattable, and a social/behavioural log must not rest on it.
  customer_id uuid,

  -- The durable human identity from R1B. Survives the person changing shop,
  -- which barber_id does not.
  professional_id uuid,

  -- BUSINESS CONTEXT -------------------------------------------------------
  organization_id uuid,
  location_id uuid,
  barber_id uuid,          -- operational placement, per CUSTOMER_API_FREEZE §1
  appointment_id uuid,
  queue_entry_id uuid,
  passport_id uuid,

  -- ACQUISITION ------------------------------------------------------------
  -- prospect_id is the CANONICAL post-dedup prospect. acquisition_source_
  -- record_id points at the individual source observation. Both are kept
  -- precisely so §9 holds: one real professional discovered through four
  -- sources is four source records, ONE prospect, and therefore one
  -- conversion. Counting source records as conversions is the mistake this
  -- pair of columns exists to make impossible.
  prospect_id uuid,
  acquisition_source text,
  acquisition_source_record_id uuid,

  -- SURFACE ----------------------------------------------------------------
  event_origin public.analytics_event_origin not null,
  platform text,

  -- An opaque, client-generated, SHORT-LIVED handle used only to approximate
  -- "distinct anonymous visitors" in aggregate (§13). It is not a device id,
  -- not derived from any device characteristic, and never joined to an
  -- account. See the privacy note in docs/v2/R3_ANALYTICS_EVENT_ENGINE.md.
  session_id text,

  locale text,
  country_code text,

  -- COMMERCIAL SNAPSHOT ----------------------------------------------------
  -- Captured at emit time, never re-derived. §8: a service completed while the
  -- shop was on salon_pro was completed on salon_pro, and must still report
  -- that way after the shop upgrades, downgrades or cancels.
  plan_key text,
  commercial_family public.commercial_family,

  -- METADATA ---------------------------------------------------------------
  properties jsonb not null default '{}'::jsonb,

  -- Ties the events of one logical user journey together (a booking flow from
  -- first search to completed appointment). causation_id names the event that
  -- directly produced this one. Both nullable: most events have neither, and
  -- fabricating a correlation is worse than admitting there is none.
  correlation_id uuid,
  causation_id uuid,

  -- NULL means "repeats of this event are legitimate and must stay separate".
  -- Non-null means "this transition happens once and must be recorded once".
  -- §6: profile views and searches are deliberately never deduplicated.
  dedupe_key text,

  constraint analytics_events_name_shape
    check (event_name ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint analytics_events_version_positive
    check (event_version >= 1),

  -- properties is an object, never a scalar or an array. Reports index into it
  -- by key; a bare `3` or `[1,2]` would be silently unqueryable.
  constraint analytics_events_properties_is_object
    check (jsonb_typeof(properties) = 'object'),

  -- A soft ceiling that makes "someone started shipping message bodies into
  -- properties" fail loudly instead of quietly inflating the table. §12
  -- forbids the content; this makes the volume impossible too.
  constraint analytics_events_properties_bounded
    check (pg_column_size(properties) <= 4096),

  -- An anonymous actor cannot have an account id, and an identified actor must
  -- have one. Without this the actor_type column drifts into decoration and
  -- "unique authenticated viewers" becomes uncountable.
  constraint analytics_events_actor_coherent
    check (
      (actor_type = 'anonymous' and actor_user_id is null)
      or (actor_type in ('system', 'worker'))
      or (actor_type in ('customer', 'professional', 'staff', 'platform_admin')
          and actor_user_id is not null)
    ),

  -- ingested_at is never earlier than occurred_at. A row claiming to have been
  -- written before the thing happened is a clock or a backfill bug, and it
  -- silently corrupts every latency and funnel-timing measurement.
  constraint analytics_events_ingest_not_before_occurrence
    check (ingested_at >= occurred_at),

  constraint analytics_events_country_code_shape
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),

  -- Coarse geography only (§12). A column that accepts a lat/long pair would
  -- eventually receive one.
  constraint analytics_events_locale_shape
    check (locale is null or locale ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$'),

  constraint analytics_events_session_id_bounded
    check (session_id is null or char_length(session_id) between 8 and 64),

  constraint analytics_events_platform_shape
    check (platform is null or platform ~ '^[a-z][a-z0-9_]{1,31}$')
);

comment on table public.analytics_events is
  'FadeUp''s canonical APPEND-ONLY product analytics log. One row per thing that happened. Deliberately carries NO foreign keys — an event must survive deletion of its subject, and thirteen FKs on the highest-volume table would put thirteen parent lookups inside every booking transaction; integrity is enforced at ingestion instead, where no client can write at all. This table is NOT product state: organization_follows, appointments and queue_entries remain the only truth about what is true now, and nothing in the product reads this table to decide behaviour.';

comment on column public.analytics_events.occurred_at is
  'When the thing happened. For a server event this is the instant of the authoritative state transition, not the instant the row was written.';

comment on column public.analytics_events.ingested_at is
  'When this row was written. Equals occurred_at for live emission and differs for anything replayed or backfilled, which is how pipeline lag is measured without contaminating occurred_at.';

comment on column public.analytics_events.actor_user_id is
  'The acting account, ALWAYS derived server-side from auth.uid() or from authoritative state. public.track_analytics_event takes no actor argument at all, so a client cannot attribute an event to another user even by trying.';

comment on column public.analytics_events.session_id is
  'Opaque short-lived client handle, used ONLY to approximate distinct anonymous visitors in aggregate. Not a device fingerprint, not derived from any device characteristic, never joined to an account, and never exposed through any read contract.';

comment on column public.analytics_events.plan_key is
  'The organization''s effective plan AT THE MOMENT OF THE EVENT, snapshotted rather than joined. A shop that completes a service on salon_pro and upgrades next month must still report that completion against salon_pro.';

comment on column public.analytics_events.prospect_id is
  'The CANONICAL post-dedup prospect. Paired with acquisition_source_record_id precisely so that one professional discovered through several sources counts as several observations and exactly ONE conversion.';

comment on column public.analytics_events.properties is
  'Controlled per-event payload. Never PII: no email address, phone number, token, private note, message body, exact coordinate or future appointment detail. Entity ids and small controlled scalars only — the ingestion functions reject the forbidden keys outright.';

comment on column public.analytics_events.dedupe_key is
  'NULL = repeats are legitimate and must stay distinct (views, searches). Non-null = this transition occurs once and is recorded once, enforced by a unique index rather than by callers being careful.';

-- ---------------------------------------------------------------------------
-- 4. Indexes
--
-- Six, and each answers a query §18 names. The temptation on an event table is
-- one index per column "so any question is fast"; that trades a cheap write —
-- which happens inside booking transactions — for reports nobody has written
-- yet. These are the accesses that actually exist.
-- ---------------------------------------------------------------------------

-- IDEMPOTENCY. Partial, because the overwhelming majority of rows are views
-- and searches with a NULL key and must not enter this index at all.
create unique index if not exists analytics_events_dedupe_key_unique
  on public.analytics_events (dedupe_key)
  where dedupe_key is not null;

-- THE TENANT REPORT: "this shop's <event> over this period", which is every
-- primitive in §18. Leading with organization_id keeps one tenant's scan off
-- every other tenant's rows.
create index if not exists analytics_events_org_name_time_idx
  on public.analytics_events (organization_id, event_name, occurred_at desc)
  where organization_id is not null;

-- THE PLATFORM FUNNEL: acquisition and claim events, which have no tenant.
create index if not exists analytics_events_name_time_idx
  on public.analytics_events (event_name, occurred_at desc);

-- REPEAT / RETENTION cohorts (§10), and the erasure path: finding everything
-- attributable to one account is a GDPR requirement, not merely a report.
create index if not exists analytics_events_actor_time_idx
  on public.analytics_events (actor_user_id, occurred_at desc)
  where actor_user_id is not null;

-- THE PROFESSIONAL'S OWN NUMBERS (§13, §18). A professional's analytics are
-- keyed on the durable identity, not on any one shop placement.
create index if not exists analytics_events_professional_name_time_idx
  on public.analytics_events (professional_id, event_name, occurred_at desc)
  where professional_id is not null;

-- RETENTION SWEEPS. BRIN rather than B-tree deliberately: this supports
-- `where occurred_at < cutoff` over an append-ordered table at roughly 1/1000
-- the size of the equivalent B-tree, and no other index here leads with time.
-- It is not intended to accelerate report filters — the composite indexes
-- above already carry occurred_at in their trailing position.
create index if not exists analytics_events_occurred_at_brin
  on public.analytics_events using brin (occurred_at);

-- NO JSONB INDEX. §20 permits one only if actually needed, and today nothing
-- filters on a properties key: every report groups by event_name and a context
-- column. A GIN index on properties would be the single most expensive object
-- in this migration and would be maintained on every insert to serve no query.

-- ---------------------------------------------------------------------------
-- 5. Append-only, enforced
--
-- "Append-only" as a comment is a wish. These two triggers make UPDATE and
-- DELETE fail for EVERY caller including service_role, postgres and a direct
-- psql session — the same no-role-exemption discipline R1A used for the
-- appointment transition guard, and for the same reason: a history that a
-- privileged path can rewrite is not history.
--
-- Deliberate exception: retention. Deleting rows older than the retention
-- horizon is a legitimate, privacy-REQUIRED operation, so the DELETE guard
-- honours one narrowly-scoped transaction-local flag set exclusively by
-- private.purge_analytics_events (20260827120400). That is not a general
-- bypass: it cannot be reached by any client role, it is not readable as a
-- session setting a client can set through PostgREST, and it refuses to delete
-- anything inside the retention horizon.
-- ---------------------------------------------------------------------------

create or replace function public.reject_analytics_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
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

comment on function public.reject_analytics_event_mutation() is
  'Makes analytics_events genuinely append-only for every caller, with no role exemption — service_role and postgres included. UPDATE is refused unconditionally. DELETE is refused unless the retention purge has set its transaction-local flag, which no client role can reach.';

drop trigger if exists analytics_events_reject_update on public.analytics_events;
create trigger analytics_events_reject_update
  before update on public.analytics_events
  for each row execute function public.reject_analytics_event_mutation();

drop trigger if exists analytics_events_reject_delete on public.analytics_events;
create trigger analytics_events_reject_delete
  before delete on public.analytics_events
  for each row execute function public.reject_analytics_event_mutation();

-- ---------------------------------------------------------------------------
-- 6. Security posture: unreachable by construction
--
-- RLS is enabled AND forced, and there is deliberately NO permissive policy
-- and NO grant to anon or authenticated. That combination is stronger than a
-- restrictive policy: PostgREST cannot expose a table the client roles hold no
-- privilege on, so there is no policy to get subtly wrong, no `using (true)`
-- to be added by accident later, and no path by which one tenant reads
-- another's rows.
--
-- Everything legitimate goes through a SECURITY DEFINER contract that performs
-- its own authorization: ingestion in 20260827120200, reads in 20260827120400.
--
-- §11 requires that clients cannot raw-INSERT. This is how that is guaranteed
-- rather than asserted.
-- ---------------------------------------------------------------------------

alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;

revoke all on table public.analytics_events from public, anon, authenticated;

-- Belt and braces: named explicitly so a future `grant all on all tables`
-- shows up as a conflict in review rather than silently opening the log.
revoke select, insert, update, delete
  on public.analytics_events
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Ingestion diagnostics (§22)
--
-- Rejected events must be visible, or a broken instrumentation change looks
-- exactly like a quiet product. Bounded and coarse on purpose: a reason and a
-- name, never the payload that was rejected — a rejected payload is the single
-- most likely place for the PII §12 forbids to end up.
-- ---------------------------------------------------------------------------

create table if not exists public.analytics_ingestion_rejections (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event_name text,
  event_origin text,
  reason text not null,
  -- Which stage refused it, so a spike can be attributed without reading rows.
  stage text not null,
  constraint analytics_ingestion_rejections_reason_not_blank
    check (btrim(reason) <> ''),
  constraint analytics_ingestion_rejections_stage_shape
    check (stage in ('client_rpc', 'server_emit'))
);

comment on table public.analytics_ingestion_rejections is
  'Why events were refused, for §22 observability. Deliberately stores no payload and no actor: the rejected payload is the likeliest place for forbidden PII to appear, and a diagnostics table is the last place it should be preserved. A reason, a name and a stage are enough to find a broken instrumentation change.';

create index if not exists analytics_ingestion_rejections_recent_idx
  on public.analytics_ingestion_rejections (occurred_at desc);

alter table public.analytics_ingestion_rejections enable row level security;
alter table public.analytics_ingestion_rejections force row level security;

revoke all on table public.analytics_ingestion_rejections from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- DELIBERATELY ABSENT, and why
--
--   ip_address / user_agent / device fingerprint — §12 forbids invasive
--     fingerprinting. Neither is needed by any funnel in §10, and an
--     `ip_address` column is a column that eventually gets logged.
--   latitude / longitude — coarse geography only. country_code is the column
--     §12 asks for; a precise coordinate on a customer's profile view is
--     location tracking whatever it is called.
--   referrer / utm_* — R3 runs no campaigns (§9 defers outreach entirely).
--     campaign_id is not added because the existing model has no campaign
--     entity to reference; adding a dangling text column now would be the
--     mechanical schema-filling §2 warns against. When Worker V2 introduces
--     campaigns, one nullable column is a trivial migration.
--   viewer identity on a public profile view — §12: viewers are never
--     exposed. The event records WHO WAS VIEWED; the viewer appears only as
--     actor_user_id, which no read contract in R3 projects.
--   PARTITIONING — §20 permits it only if justified, and the Postgres guidance
--     bundled with this repository puts the threshold at 100M rows. FadeUp has
--     not emitted one event yet. The design stays partition-COMPATIBLE (no
--     FKs pointing in, append-only, occurred_at present on every row, BRIN
--     rather than a clustered B-tree on time), so converting later is a data
--     move and not a redesign.
-- ---------------------------------------------------------------------------
