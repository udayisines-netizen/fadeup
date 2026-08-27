-- ============================================================================
-- FadeUp — MASTER: the R3 analytics and event engine
-- Generated 2026-08-27. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r3.sh
-- Verify in sync:   scripts/generate-master-r3.sh --check
--
-- WHAT THIS IS
--
--   Before this file, FadeUp measured nothing. Not "measured badly" — there
--   was no PostHog, no GA, no Segment, no Sentry, no sendBeacon and no fetch
--   to any third-party host anywhere in the browser bundle. Every number about
--   the product was a hand-written SQL query against operational tables.
--
--   It adds four enums, three tables and the machinery that makes them mean
--   something:
--
--     analytics_events               the canonical APPEND-ONLY event log
--     analytics_event_definitions    the taxonomy, as data: 40 event contracts
--                                    across seven families, each versioned and
--                                    marked wired or deferred
--     analytics_ingestion_rejections why events were refused
--
--   Plus one client RPC, one internal emitter, one non-fatal wrapper, thirteen
--   AFTER triggers on existing business tables, four read contracts and a
--   retention primitive.
--
--   THIS LOT REQUIRES R1A, R1B, R2 AND SERVICE MODE. It composes R1A's
--   completion and queue transition guards (without which the timestamps it
--   records would be browser-supplied and worthless), R1B's durable
--   professional identity and claim lifecycle, and R2's
--   private.effective_plan_key. It changes no price, no plan, no capability
--   packaging and no identity semantics.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. NOTHING IS BACKFILLED, AND THAT IS THE POINT.
--      A shop with four hundred completed appointments from before this file
--      has ZERO analytics events after it. There is no honest occurred_at for
--      a service delivered last March, no honest actor, and no honest record
--      of which plan was in force. Manufacturing those would put fabricated
--      evidence into the one table whose entire value is that it is evidence.
--      The generator asserts that applying this file writes no events.
--
--      Consequence: every funnel starts empty and fills from the moment of
--      application. That is a real cost and it is the correct one.
--
--   B. ANALYTICS CANNOT REFUSE A CUSTOMER'S ACTION.
--      Every one of the thirteen triggers calls
--      private.try_emit_analytics_event, which wraps emission in a
--      subtransaction. A malformed event, a missing taxonomy row or a
--      constraint violation rolls back the EVENT and nothing else; the follow,
--      the booking, the completion and the claim all still commit. The failure
--      is recorded in analytics_ingestion_rejections instead of reaching the
--      customer. The companion VERIFY proves this by deliberately breaking
--      emission and asserting the Follow still succeeds.
--
--   C. THE EVENT LOG IS UNREACHABLE BY CLIENTS, BY CONSTRUCTION.
--      RLS is enabled AND forced on analytics_events, there is NO permissive
--      policy, and anon and authenticated hold no privilege on it whatsoever.
--      PostgREST cannot expose a table the client roles have no grant on, so
--      there is no policy to get subtly wrong. Reads go through four
--      SECURITY DEFINER contracts that authorize their own callers; writes go
--      through one client RPC that has no actor parameter at all.
--
--   D. CLICK IS NOT CONVERSION.
--      Every conversion event — appointment created/completed/cancelled, queue
--      joined/completed, follow, favorite, claim approved — originates from a
--      database state transition, not from a button. A tap that fails to
--      change state produces no event. The browser can emit only the ten
--      INTENT events, and the emission wall in the ingestion layer refuses any
--      attempt to send a business fact from a web origin.
--
--   E. HISTORICAL COMMERCIAL TERMS ARE FROZEN AT EMIT TIME.
--      plan_key and commercial_family are snapshotted onto each event, never
--      joined at read time. A service completed on salon_pro still reports as
--      salon_pro after the shop upgrades, downgrades or cancels.
--
--   F. ONE REAL PROFESSIONAL IS ONE CONVERSION, HOWEVER MANY SOURCES FOUND
--      THEM. external_profile_created hangs off prospect_professionals — the
--      unified prospect-to-identity linkage, unique per prospect — and the
--      platform funnel counts DISTINCT professional identities rather than
--      approval events. Multi-source discovery cannot inflate the count at
--      either end.
--
--   G. NO PARTITIONING, DELIBERATELY. The Postgres guidance bundled with this
--      repository puts the threshold at 100M rows and FadeUp has not emitted
--      one event yet. The design stays partition-COMPATIBLE — no inbound FKs,
--      append-only, occurred_at on every row, BRIN rather than a clustered
--      B-tree on time — so converting later is a data move, not a redesign.
--
-- WHAT THIS LOT DELIBERATELY DOES NOT DO
--
--   No dashboard and no BI surface. No Worker V2, no crawling, no scraping, no
--   outreach, no campaign execution. No mobile application. No Marketplace
--   redesign. No CRM. No billing. No new pricing and no change to R2's plan
--   matrix. No SMS. No cron and no scheduled job of any kind. No third-party
--   analytics SDK and no request to any external host.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully rolls
--     back.
--   * Removes no table, removes no column, truncates nothing, deletes nothing.
--   * Writes no analytics row: no backfill, no fabricated history.
--   * Changes no existing table's data. The only DML is the taxonomy seed.
--   * Alters no existing function, RPC or policy belonging to R1A, R1B, R2 or
--     Service Mode.
--   * Adds no anon RLS policy. The database's count stays at zero.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--
--   The earlier lots' verifications must still pass unchanged:
--     supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--     supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--     supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--     supabase/VERIFY_ORGANIZATION_FOLLOWS_2026_08_27.sql
--     supabase/VERIFY_CUSTOMER_API_FREEZE_2026_08_27.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260827120000_analytics_event_foundation.sql
-- ============================================================================

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


-- ============================================================================
-- END db/migrations/20260827120000_analytics_event_foundation.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260827120100_analytics_event_taxonomy.sql
-- ============================================================================

-- FadeUp — R3: the event taxonomy
--
-- Seeds public.analytics_event_definitions with every event contract FadeUp
-- recognises, in seven families.
--
-- THE STATUS COLUMN IS THE POINT OF THIS FILE
--
--   §4 of the R3 brief says two things that pull in opposite directions:
--   "create and document a controlled event taxonomy", and "DO NOT fake events
--   for flows that do not exist yet". The resolution is `status`:
--
--     wired    — R3 emits this event, from a real authoritative source or a
--                real instrumented surface. It will produce rows.
--     deferred — the CONTRACT is fixed and documented so that the surface which
--                eventually emits it does not get to invent a new name, but
--                nothing emits it today and the ingestion allowlist REFUSES it.
--
--   A deferred definition therefore cannot produce a single row, by
--   construction rather than by discipline. That is what makes it safe to
--   write the whole taxonomy down now.
--
-- WHY SOME OBVIOUS EVENTS ARE DEFERRED
--
--   Each deferral below is because the product has no authoritative source for
--   the fact today — not because the event is unimportant. The specific
--   reasons are recorded per row, because "deferred" without a reason becomes
--   "forgotten" within one lot:
--
--     queue_called / queue_service_started — the queue lifecycle DOES have
--       authoritative state for these (R1A stamps called_at and
--       service_started_at), so they are WIRED. Only their exposure to
--       customers is deferred, which is a UI question, not an event question.
--
--     passport_viewed — there is no server-side passport read path to hook and
--       no customer surface that renders a passport belonging to someone else.
--       Instrumenting it would mean inventing a view event from a component
--       mount, which §5 forbids for anything that is not pure intent, and §17
--       forbids exposing private Passport history through analytics anyway.
--
--     prospect_discovered / prospect_enriched — Worker V2 is R4/R10. R3 must
--       not start it (§25). The contract is fixed here so that when the worker
--       lands it emits into an existing shape rather than a new one.
--
--     claim_approved / claim_rejected — these DO have authoritative state
--       (professional_claims transitions) and are WIRED. claim_started is
--       deferred: there is no server-side "started" transition, only a submit,
--       and a client-side claim funnel surface does not exist yet.
--
--     plan_changed — WIRED: commercial_plan_changes is authoritative.
--       plan_assigned is the same transition seen from the other side and is
--       wired with it. entitlement_blocked_action is DEFERRED: the R2/Service
--       Mode guards raise exceptions from BEFORE INSERT triggers, and a
--       trigger that raises has its whole subtransaction rolled back — INCLUDING
--       any event it wrote. Recording a refusal therefore requires an emission
--       path that survives the abort, which is a genuine piece of engineering
--       (an autonomous transaction or a post-abort client report) and not
--       something to bolt on at the end of R3. Written down here so the next
--       lot inherits the problem statement rather than rediscovering it.
--
-- Idempotent: safe to re-run. `on conflict do update` so re-running after a
-- contract edit converges rather than silently keeping the old row.

set lock_timeout = '5s';

insert into public.analytics_event_definitions
  (event_name, event_version, family, emission, status, is_idempotent, requires_organization, description)
values

-- DISCOVERY ------------------------------------------------------------------
-- Pure intent. Every one of these is a browser statement and none is ever
-- allowed to stand in for a conversion (§5).
  ('discovery_viewed', 1, 'discovery', 'client', 'wired', false, false,
   'The marketplace/discovery surface was opened. No tenant: this is a platform surface.'),

  ('search_performed', 1, 'discovery', 'client', 'wired', false, false,
   'A discovery search was executed. Properties carry the coarse shape of the query — result count, whether filters were applied — never the raw query string, which is free text a customer can type anything into.'),

  ('search_result_viewed', 1, 'discovery', 'client', 'wired', false, false,
   'A specific search result was opened from the result list. Carries the subject and its position, which is what makes result-quality measurable.'),

  ('public_profile_viewed', 1, 'discovery', 'client', 'wired', false, false,
   'A public barbershop or professional profile was viewed. The SUBJECT is recorded; the viewer appears only as actor_user_id and is never projected by any read contract (§12).'),

-- SOCIAL ---------------------------------------------------------------------
-- All six are server-authoritative: they are emitted from the actual state
-- transition on the follow/favorite edge, not from the button that requested
-- it. A click that fails to change state produces no event.
  ('organization_followed', 1, 'social', 'server', 'wired', false, true,
   'A customer began following a barbershop. Emitted from the organization_follows state transition, never from the button.'),

  ('organization_unfollowed', 1, 'social', 'server', 'wired', false, true,
   'A customer explicitly stopped following a barbershop.'),

  ('professional_followed', 1, 'social', 'server', 'wired', false, false,
   'A customer began following a professional. No organization: a professional follow is an edge to a durable human identity that outlives any one shop (CUSTOMER_API_FREEZE §1).'),

  ('professional_unfollowed', 1, 'social', 'server', 'wired', false, false,
   'A customer explicitly stopped following a professional.'),

  ('organization_favorited', 1, 'social', 'server', 'wired', false, true,
   'A customer favorited a shop. Favorite and Follow are separate relationships and are deliberately separate events.'),

  ('organization_unfavorited', 1, 'social', 'server', 'wired', false, true,
   'A customer removed a shop favorite.'),

-- BOOKING --------------------------------------------------------------------
-- The four lifecycle events are server-authoritative. The four intent events
-- are client-side and exist to locate abandonment inside the funnel; §5 is
-- explicit that they must never be used as conversion.
  ('booking_started', 1, 'booking', 'client', 'wired', false, true,
   'A customer opened the booking flow. INTENT ONLY — the top of the funnel, never evidence that anything was booked.'),

  ('booking_service_selected', 1, 'booking', 'client', 'wired', false, true,
   'A service was chosen inside the booking flow.'),

  ('booking_barber_selected', 1, 'booking', 'client', 'wired', false, true,
   'A barber was chosen inside the booking flow, or "any available" was accepted.'),

  ('booking_slot_selected', 1, 'booking', 'client', 'wired', false, true,
   'A time slot was chosen. The last intent step before the server decides.'),

  ('appointment_created', 1, 'booking', 'server', 'wired', true, true,
   'An appointment row was created. Emitted once per appointment from the INSERT, whatever path created it — public booking, staff dialog or direct insert.'),

  ('appointment_confirmed', 1, 'booking', 'server', 'wired', false, true,
   'An appointment reached confirmed. NOT once-only: a customer reschedule returns a confirmed appointment to pending, and the shop can confirm it again. Each confirmation is a real, separately countable event.'),

  ('appointment_cancelled', 1, 'booking', 'server', 'wired', true, true,
   'An appointment was cancelled. Terminal, and the transition guard forbids leaving a terminal state, so exactly one.'),

  ('appointment_no_show', 1, 'booking', 'server', 'wired', true, true,
   'A confirmed appointment was marked no_show. NOT IN THE §4 MINIMUM LIST, and added deliberately: no_show is a distinct authoritative status that both the staff path and apply_appointment_no_show_rule write, and folding it into appointment_cancelled would report abandonment as customer choice and make no-show rate — a number shops actually manage — uncountable.'),

  ('appointment_completed', 1, 'booking', 'server', 'wired', true, true,
   'A service was actually delivered. THE conversion event of the customer funnel. Terminal and once-only: R1A''s enforce_appointment_transition refuses any transition out of completed, for every caller including service_role.'),

-- QUEUE ----------------------------------------------------------------------
  ('queue_viewed', 1, 'queue', 'client', 'wired', false, true,
   'The live queue for a shop was viewed. Intent.'),

  ('queue_join_started', 1, 'queue', 'client', 'wired', false, true,
   'The join-queue flow was opened. Intent.'),

  ('queue_joined', 1, 'queue', 'server', 'wired', true, true,
   'A queue entry was actually created. One row, one event.'),

  ('queue_cancelled', 1, 'queue', 'server', 'wired', true, true,
   'A queue entry was cancelled before service.'),

  ('queue_no_show', 1, 'queue', 'server', 'wired', true, true,
   'A queue entry was marked no_show. Added alongside appointment_no_show and for the same reason: queue_status carries no_show as its own authoritative value, and collapsing it into queue_cancelled would misreport walk-in abandonment as customer cancellation.'),

  ('queue_called', 1, 'queue', 'server', 'wired', true, true,
   'The customer was called. Authoritative: R1A stamps called_at server-side and discards any client-supplied value.'),

  ('queue_service_started', 1, 'queue', 'server', 'wired', true, true,
   'Service actually began. Authoritative via service_started_at, stamped by the transition guard.'),

  ('queue_completed', 1, 'queue', 'server', 'wired', true, true,
   'A walk-in service was delivered. The queue-side conversion event, and the queue counterpart of appointment_completed.'),

-- PASSPORT -------------------------------------------------------------------
  ('passport_issued', 1, 'passport', 'server', 'wired', true, false,
   'A Fade Passport was issued to a customer. Once per passport. No organization: the Passport is customer-owned and portable, and attributing its issuance to whichever shop the customer happened to be looking at would be false.'),

  ('passport_relationship_created', 1, 'passport', 'server', 'wired', true, true,
   'A durable customer-professional relationship came into existence, from a first completed service. The passport-side evidence that a professional has a returning client.'),

  ('passport_viewed', 1, 'passport', 'client', 'deferred', false, false,
   'DEFERRED. No server-side passport read path exists to hook, and §17 forbids exposing private Passport history through analytics. Wiring this from a component mount would be inventing a view event, which §5 forbids. Contract fixed so the surface that eventually renders a passport does not invent a different name.'),

-- ACQUISITION / CLAIM --------------------------------------------------------
  ('prospect_discovered', 1, 'acquisition', 'server', 'deferred', true, false,
   'DEFERRED to R4/R10. Worker V2 discovery is explicitly out of R3 scope (§25). Contract fixed now so the worker emits into this shape rather than inventing one, and so the prospect_id / acquisition_source_record_id pairing that prevents double-counting is settled before there is data to get wrong.'),

  ('prospect_enriched', 1, 'acquisition', 'server', 'deferred', false, false,
   'DEFERRED to R4/R10, with prospect_discovered. Not idempotent by nature: a prospect is legitimately re-enriched as sources are re-crawled.'),

  ('external_profile_created', 1, 'acquisition', 'server', 'wired', true, false,
   'An unclaimed external professional profile was published from a prospect. Authoritative: public.create_external_professional is the sole writer and is idempotent per prospect, so this is once per professional identity.'),

  ('claim_started', 1, 'acquisition', 'client', 'deferred', false, false,
   'DEFERRED. There is no server-side "started" transition — professional_claims has only a submit — and no claim-funnel surface exists to instrument. Wiring it would require inventing a state the product does not have.'),

  ('claim_submitted', 1, 'acquisition', 'server', 'wired', true, false,
   'A professional submitted a claim over an identity. Authoritative from the professional_claims INSERT.'),

  ('claim_approved', 1, 'acquisition', 'server', 'wired', true, false,
   'A claim was approved and the identity became claimed. The activation point of the acquisition funnel.'),

  ('claim_rejected', 1, 'acquisition', 'server', 'wired', true, false,
   'A claim was rejected.'),

-- COMMERCIAL -----------------------------------------------------------------
  ('plan_assigned', 1, 'commercial', 'server', 'wired', true, true,
   'An organization received its first commercial plan. Distinguished from plan_changed because first assignment and later movement are different questions: one measures onboarding, the other measures expansion and churn.'),

  ('plan_changed', 1, 'commercial', 'server', 'wired', true, true,
   'An organization moved between plans. Properties carry the direction and both plan keys. Emitted from commercial_plan_changes, which is already an authoritative append-only record.'),

  ('entitlement_blocked_action', 1, 'commercial', 'server', 'deferred', false, true,
   'DEFERRED, and the reason is technical rather than editorial. The entitlement guards refuse an action by RAISING from a BEFORE INSERT trigger, which aborts the subtransaction and would discard any event written inside it. Recording a refusal needs an emission path that survives the abort — an autonomous transaction, or a client-side report of the refusal it received. Both are real work and neither belongs in a foundation lot. The contract is fixed here so the lot that builds it inherits a definition instead of a debate.')

on conflict (event_name) do update set
  event_version         = excluded.event_version,
  family                = excluded.family,
  emission              = excluded.emission,
  status                = excluded.status,
  is_idempotent         = excluded.is_idempotent,
  requires_organization = excluded.requires_organization,
  description           = excluded.description,
  updated_at            = now();

-- ---------------------------------------------------------------------------
-- Assertions on the seed itself
--
-- A taxonomy that silently loses a family is worse than one that fails to
-- install: the reports keep rendering, with a hole in them. These run inside
-- the migration so a bad edit cannot commit.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
  v_count integer;
begin
  -- Every family in §4 must be represented.
  select string_agg(f, ', ')
    into v_missing
  from unnest(array[
    'discovery', 'social', 'booking', 'queue', 'passport', 'acquisition', 'commercial'
  ]) as f
  where not exists (
    select 1 from public.analytics_event_definitions d where d.family = f
  );

  if v_missing is not null then
    raise exception 'R3 taxonomy is missing entire event families: %', v_missing;
  end if;

  -- The conversion events the whole product funnel rests on MUST be server
  -- emitted and MUST be idempotent. If a future edit flipped one of these to
  -- client emission, every conversion number FadeUp reports would silently
  -- become a count of button presses.
  select count(*)
    into v_count
  from public.analytics_event_definitions d
  where d.event_name in (
      'appointment_created', 'appointment_completed', 'appointment_cancelled',
      'queue_joined', 'queue_completed',
      'organization_followed', 'organization_unfollowed',
      'professional_followed', 'professional_unfollowed',
      'organization_favorited', 'organization_unfavorited',
      'claim_approved'
    )
    and d.emission = 'server'
    and d.status = 'wired';

  if v_count <> 12 then
    raise exception 'R3 taxonomy: expected 12 wired server-authoritative critical events, found %', v_count;
  end if;

  -- And no client event may claim to be a conversion by being idempotent.
  -- The table constraint already forbids it; this proves the seed obeys it.
  if exists (
    select 1 from public.analytics_event_definitions
    where emission = 'client' and is_idempotent
  ) then
    raise exception 'R3 taxonomy: a client event is marked idempotent — client intent is never a business fact';
  end if;

  select count(*) into v_count from public.analytics_event_definitions;
  raise notice 'R3 taxonomy installed: % event definitions (% wired, % deferred)',
    v_count,
    (select count(*) from public.analytics_event_definitions where status = 'wired'),
    (select count(*) from public.analytics_event_definitions where status = 'deferred');
end $$;


-- ============================================================================
-- END db/migrations/20260827120100_analytics_event_taxonomy.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260827120200_analytics_ingestion.sql
-- ============================================================================

-- FadeUp — R3: controlled ingestion
--
-- There are exactly TWO ways a row reaches public.analytics_events, and no
-- third:
--
--   SERVER   private.emit_analytics_event, called from an authoritative state
--            transition (a trigger or an RPC that already owns the fact).
--            Origin backend/worker/system. This is evidence.
--
--   CLIENT   public.track_analytics_event, the single RPC a browser may call.
--            Origin public_web/customer_web/customer_mobile/pro_web. This is
--            intent, and the emission column on the registry makes it
--            impossible for a browser to write a server event (§5).
--
-- WHAT MAKES IMPERSONATION IMPOSSIBLE RATHER THAN MERELY DISCOURAGED
--
--   public.track_analytics_event HAS NO ACTOR PARAMETER. Not an ignored one,
--   not a validated one — the argument does not exist. The actor is derived
--   inside the function from auth.uid(). A client cannot pass an actor it is
--   not, because there is nowhere to put it. This is the §11 requirement
--   ("no client-provided arbitrary actor_user_id") expressed in the signature
--   rather than in a check that a later edit could relax.
--
-- WHY THE SERVER PATH MUST NEVER RAISE
--
--   §14 and §22: an analytics failure must not break a Follow, a booking or a
--   completion. private.emit_analytics_event is strict and DOES raise — that is
--   what makes it testable. Triggers therefore call
--   private.try_emit_analytics_event, which wraps it in an exception block, and
--   records the failure to analytics_ingestion_rejections instead of
--   propagating it.
--
--   The plpgsql exception block opens a subtransaction, so a failed emission
--   rolls back only itself; the surrounding booking or follow commits
--   untouched. That is the entire safety property, and db/tests exercises it
--   by deliberately breaking emission and asserting the business action still
--   succeeds.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. private.analytics_actor_type_for — who is acting
--
-- Derived from real state, never asserted by the caller. The order matters:
-- platform staff first (they are the narrowest set), then organization staff,
-- then a claimed professional identity, and only then customer — which is the
-- default because it is the only category that requires no relationship to
-- anything.
-- ---------------------------------------------------------------------------

create or replace function private.analytics_actor_type_for(p_user_id uuid)
returns public.analytics_actor_type
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when p_user_id is null then 'anonymous'::public.analytics_actor_type
    when exists (
      select 1 from public.platform_members pm
      where pm.user_id = p_user_id
        and pm.role in ('platform_owner', 'platform_admin')
    ) then 'platform_admin'::public.analytics_actor_type
    when exists (
      select 1 from public.memberships m where m.user_id = p_user_id
    ) then 'staff'::public.analytics_actor_type
    when exists (
      select 1 from public.professionals p where p.user_id = p_user_id
    ) then 'professional'::public.analytics_actor_type
    else 'customer'::public.analytics_actor_type
  end;
$$;

comment on function private.analytics_actor_type_for(uuid) is
  'Classifies an acting account from actual state — platform membership, organization membership, claimed professional identity — falling back to customer. Never accepts a caller''s claim about who they are. SECURITY DEFINER because it reads tables the client roles cannot; performs no authorization of its own and is not an entry point.';

revoke all on function private.analytics_actor_type_for(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. private.analytics_commercial_snapshot — the terms in force RIGHT NOW
--
-- §8. Returns the plan the organization is actually on at this instant, so the
-- emitter can freeze it onto the row. Composes R2's private.effective_plan_key
-- rather than reimplementing any commercial logic — the canceled-degrades-to-
-- free and past_due-keeps-plan semantics stay in exactly one place.
-- ---------------------------------------------------------------------------

create or replace function private.analytics_commercial_snapshot(
  p_organization_id uuid,
  out plan_key text,
  out commercial_family public.commercial_family
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.plan_key,
    p.commercial_family
  from public.commercial_plans p
  where p_organization_id is not null
    and p.plan_key = private.effective_plan_key(p_organization_id);
$$;

comment on function private.analytics_commercial_snapshot(uuid) is
  'The plan_key and commercial_family in force for an organization at this instant, for freezing onto an analytics event. Composes R2''s private.effective_plan_key so canceled/past_due semantics are resolved in exactly one place. Returns NULLs for an organization with no commercial state, which is recorded honestly rather than defaulted to ''free''.';

revoke all on function private.analytics_commercial_snapshot(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. private.assert_analytics_properties_safe — the privacy gate (§12)
--
-- Two rules, both enforced rather than documented:
--
--   a. A FORBIDDEN KEY IS REFUSED. The list is the §12 list, matched on the
--      key name as a substring so `customer_email`, `email` and
--      `contact_email_address` are all caught by one entry. Substring matching
--      produces occasional false positives; on a privacy gate that is the
--      correct direction to be wrong, and the alternative — an exact-match
--      list — is defeated by the first person who writes `userEmail`.
--
--   b. NO NESTED OBJECTS. An object value is where a whole customer record
--      gets pasted in "temporarily". Scalars and arrays of scalars keep
--      properties queryable and keep the blast radius of a mistake to one
--      value.
--
-- A raw email address is additionally matched by shape, because the realistic
-- accident is not a key called `email` — it is a key called `identifier` with
-- an address in it.
-- ---------------------------------------------------------------------------

create or replace function private.assert_analytics_properties_safe(p_properties jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_forbidden text[] := array[
    'email', 'phone', 'mobile', 'password', 'token', 'secret', 'credential',
    'authorization', 'note', 'message', 'body', 'address', 'postcode',
    'postal', 'latitude', 'longitude', 'lat_', 'lng', 'coordinate', 'geo_point',
    'ip_', 'user_agent', 'fingerprint', 'birth', 'ssn', 'tax_id'
  ];
  v_bad text;
begin
  if p_properties is null then
    return;
  end if;

  if jsonb_typeof(p_properties) <> 'object' then
    raise exception 'analytics properties must be a JSON object'
      using errcode = '22023';
  end if;

  for v_key, v_value in select * from jsonb_each(p_properties) loop
    select f into v_bad
    from unnest(v_forbidden) as f
    where lower(v_key) like '%' || f || '%'
    limit 1;

    if v_bad is not null then
      raise exception 'analytics properties may not contain personal data: key % matches forbidden term %', v_key, v_bad
        using errcode = '22023';
    end if;

    if jsonb_typeof(v_value) = 'object' then
      raise exception 'analytics properties may not contain nested objects: key %', v_key
        using errcode = '22023';
    end if;

    if jsonb_typeof(v_value) = 'string'
       and (v_value #>> '{}') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' then
      raise exception 'analytics properties may not contain an email address: key %', v_key
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

comment on function private.assert_analytics_properties_safe(jsonb) is
  'The §12 privacy gate on the analytics properties payload. Refuses forbidden key names by substring match, refuses nested objects, and refuses any string value shaped like an email address — because the realistic accident is not a key called ''email'', it is a key called ''identifier'' with an address in it. Substring matching over-refuses slightly, which on a privacy gate is the correct direction to be wrong.';

revoke all on function private.assert_analytics_properties_safe(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.emit_analytics_event — THE writer
--
-- Strict by design. Every rejection below is a bug in a caller, and a bug in a
-- caller must be loud somewhere: this function raises, and the non-fatal
-- wrapper in §5 decides whether the noise reaches the user (never) or the
-- diagnostics table (always).
--
-- Returns the new event id, or NULL when the dedupe key absorbed a duplicate.
-- The distinction matters to tests: "no row was written" and "a duplicate was
-- correctly suppressed" are different outcomes and are reported differently.
-- ---------------------------------------------------------------------------

create or replace function private.emit_analytics_event(
  p_event_name text,
  p_event_origin public.analytics_event_origin,
  p_actor_user_id uuid default null,
  p_actor_type public.analytics_actor_type default null,
  p_organization_id uuid default null,
  p_location_id uuid default null,
  p_barber_id uuid default null,
  p_professional_id uuid default null,
  p_customer_id uuid default null,
  p_appointment_id uuid default null,
  p_queue_entry_id uuid default null,
  p_passport_id uuid default null,
  p_prospect_id uuid default null,
  p_acquisition_source text default null,
  p_acquisition_source_record_id uuid default null,
  p_properties jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null,
  p_dedupe_key text default null,
  p_session_id text default null,
  p_locale text default null,
  p_country_code text default null,
  p_platform text default null,
  p_correlation_id uuid default null,
  p_causation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def public.analytics_event_definitions%rowtype;
  v_actor_type public.analytics_actor_type;
  v_plan_key text;
  v_family public.commercial_family;
  v_occurred_at timestamptz;
  v_id uuid;
begin
  -- 4.1 The allowlist. An unknown name is a typo, and a typo that silently
  -- inserted would create a new category nobody queries — the quietest and
  -- most expensive kind of analytics bug.
  select * into v_def
  from public.analytics_event_definitions d
  where d.event_name = p_event_name;

  if not found then
    raise exception 'unknown analytics event: %', p_event_name
      using errcode = '22023';
  end if;

  if v_def.status <> 'wired' then
    raise exception 'analytics event % is documented but not wired', p_event_name
      using errcode = '22023';
  end if;

  -- 4.2 Emission class must match the origin. This is the wall between intent
  -- and evidence (§5): a browser origin can never carry a server event, and a
  -- backend origin can never carry a client one. Enforced here rather than in
  -- the client RPC alone, so that a future internal caller cannot smuggle a
  -- client event in as authoritative either.
  if v_def.emission = 'server'
     and p_event_origin not in ('backend', 'worker', 'system') then
    raise exception 'analytics event % is server-authoritative and cannot be emitted from origin %',
      p_event_name, p_event_origin
      using errcode = '42501';
  end if;

  if v_def.emission = 'client'
     and p_event_origin not in ('public_web', 'customer_web', 'customer_mobile', 'pro_web') then
    raise exception 'analytics event % is client intent and cannot be emitted from origin %',
      p_event_name, p_event_origin
      using errcode = '42501';
  end if;

  -- 4.3 An event that is meaningless without a tenant never gets recorded
  -- without one. Otherwise it vanishes from every per-organization report
  -- while still inflating the platform totals.
  if v_def.requires_organization and p_organization_id is null then
    raise exception 'analytics event % requires an organization', p_event_name
      using errcode = '22023';
  end if;

  -- 4.4 An idempotent event without a dedupe key is not idempotent. The
  -- registry says this event happens once; a caller that forgets the key would
  -- make that a lie on the first retry.
  if v_def.is_idempotent and p_dedupe_key is null then
    raise exception 'analytics event % is declared idempotent and requires a dedupe key', p_event_name
      using errcode = '22023';
  end if;

  perform private.assert_analytics_properties_safe(p_properties);

  -- 4.5 Actor. A caller may state the actor type only when it genuinely knows
  -- better than the derivation — a worker or a system job, which has no
  -- account at all. Everything else is derived.
  v_actor_type := coalesce(
    p_actor_type,
    private.analytics_actor_type_for(p_actor_user_id)
  );

  -- 4.6 THE COMMERCIAL SNAPSHOT (§8). Resolved now, frozen forever. A report
  -- run next year must still see the terms that were in force at the moment
  -- the service was delivered, not the terms the shop happens to be on when
  -- the report runs.
  if p_organization_id is not null then
    select s.plan_key, s.commercial_family
      into v_plan_key, v_family
    from private.analytics_commercial_snapshot(p_organization_id) s;
  end if;

  -- occurred_at defaults to the transaction timestamp, so every event emitted
  -- by one business transition shares an instant and they order deterministically.
  v_occurred_at := coalesce(p_occurred_at, now());

  -- A caller must not be able to date an event into the future; ingested_at
  -- would then violate the table's own coherence constraint, and every funnel
  -- timing built on it would be wrong.
  if v_occurred_at > now() then
    raise exception 'analytics event % cannot occur in the future', p_event_name
      using errcode = '22023';
  end if;

  insert into public.analytics_events (
    event_name, event_version,
    occurred_at, ingested_at,
    actor_type, actor_user_id, customer_id, professional_id,
    organization_id, location_id, barber_id,
    appointment_id, queue_entry_id, passport_id,
    prospect_id, acquisition_source, acquisition_source_record_id,
    event_origin, platform, session_id, locale, country_code,
    plan_key, commercial_family,
    properties, correlation_id, causation_id, dedupe_key
  )
  values (
    p_event_name, v_def.event_version,
    v_occurred_at, now(),
    v_actor_type, p_actor_user_id, p_customer_id, p_professional_id,
    p_organization_id, p_location_id, p_barber_id,
    p_appointment_id, p_queue_entry_id, p_passport_id,
    p_prospect_id, p_acquisition_source, p_acquisition_source_record_id,
    p_event_origin, p_platform, p_session_id, p_locale, p_country_code,
    v_plan_key, v_family,
    coalesce(p_properties, '{}'::jsonb), p_correlation_id, p_causation_id, p_dedupe_key
  )
  -- THE idempotency mechanism (§6). A duplicate is absorbed silently and
  -- returns NULL; it is not an error, because the whole point is that a retry
  -- is allowed to happen.
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.emit_analytics_event(text, public.analytics_event_origin, uuid, public.analytics_actor_type, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, timestamptz, text, text, text, text, text, uuid, uuid) is
  'THE writer for public.analytics_events. Validates against the taxonomy allowlist, enforces the server/client emission wall, requires a tenant where the contract demands one, requires a dedupe key for idempotent events, applies the §12 privacy gate, derives the actor from real state and freezes the commercial snapshot at emit time. Raises on every violation — callers on a business path must use private.try_emit_analytics_event instead. Returns the new id, or NULL when a duplicate was correctly absorbed.';

revoke all on function private.emit_analytics_event(text, public.analytics_event_origin, uuid, public.analytics_actor_type, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, timestamptz, text, text, text, text, text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. private.try_emit_analytics_event — the non-fatal wrapper
--
-- Everything on a business path calls THIS. §14: a broken analytics contract
-- must not stop a customer following a shop, and §22: it must not be silent
-- either.
--
-- The exception block is a subtransaction. A failure inside it rolls back the
-- attempted event insert and nothing else, so the surrounding follow, booking
-- or completion is entirely unaffected. The rejection row is written AFTER the
-- handler regains control, in the outer transaction, so it survives.
-- ---------------------------------------------------------------------------

create or replace function private.try_emit_analytics_event(
  p_event_name text,
  p_event_origin public.analytics_event_origin,
  p_actor_user_id uuid default null,
  p_actor_type public.analytics_actor_type default null,
  p_organization_id uuid default null,
  p_location_id uuid default null,
  p_barber_id uuid default null,
  p_professional_id uuid default null,
  p_customer_id uuid default null,
  p_appointment_id uuid default null,
  p_queue_entry_id uuid default null,
  p_passport_id uuid default null,
  p_prospect_id uuid default null,
  p_acquisition_source text default null,
  p_acquisition_source_record_id uuid default null,
  p_properties jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null,
  p_dedupe_key text default null,
  p_correlation_id uuid default null,
  p_causation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  begin
    v_id := private.emit_analytics_event(
      p_event_name                   => p_event_name,
      p_event_origin                 => p_event_origin,
      p_actor_user_id                => p_actor_user_id,
      p_actor_type                   => p_actor_type,
      p_organization_id              => p_organization_id,
      p_location_id                  => p_location_id,
      p_barber_id                    => p_barber_id,
      p_professional_id              => p_professional_id,
      p_customer_id                  => p_customer_id,
      p_appointment_id               => p_appointment_id,
      p_queue_entry_id               => p_queue_entry_id,
      p_passport_id                  => p_passport_id,
      p_prospect_id                  => p_prospect_id,
      p_acquisition_source           => p_acquisition_source,
      p_acquisition_source_record_id => p_acquisition_source_record_id,
      p_properties                   => p_properties,
      p_occurred_at                  => p_occurred_at,
      p_dedupe_key                   => p_dedupe_key,
      p_correlation_id               => p_correlation_id,
      p_causation_id                 => p_causation_id
    );
    return v_id;
  exception when others then
    -- Deliberately catching everything. The alternative is enumerating the
    -- error classes analytics may fail with, and being wrong about one of them
    -- on the day a booking fails because a report was misconfigured.
    insert into public.analytics_ingestion_rejections (event_name, event_origin, reason, stage)
    values (p_event_name, p_event_origin::text, left(sqlerrm, 500), 'server_emit');
    return null;
  end;
end;
$$;

comment on function private.try_emit_analytics_event(text, public.analytics_event_origin, uuid, public.analytics_actor_type, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, timestamptz, text, uuid, uuid) is
  'Non-fatal emission, and the ONLY form any business path may call. Wraps private.emit_analytics_event in a subtransaction so a failed event rolls back itself and nothing else — the surrounding follow, booking or completion always commits. Failures are recorded to analytics_ingestion_rejections rather than propagated, satisfying §14 (analytics never breaks the product) and §22 (analytics never fails silently) at the same time.';

revoke all on function private.try_emit_analytics_event(text, public.analytics_event_origin, uuid, public.analytics_actor_type, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, timestamptz, text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. public.track_analytics_event — the ONE client entry point
--
-- NOTE THE ARGUMENT LIST. There is no actor, no plan, no occurred_at, no
-- dedupe key and no country. Every one of those is either derived server-side
-- or deliberately not accepted:
--
--   actor        — derived from auth.uid(). See the file header.
--   occurred_at  — now(). A client-supplied timestamp is a client-supplied
--                  history, and it would let one caller reorder a funnel.
--   dedupe_key   — client events are never deduplicated (§6). Repeated views
--                  and searches are real and must stay distinct.
--   plan / family— snapshotted from authoritative commercial state.
--   country_code — not accepted from the browser. A client-asserted country is
--                  a claim, not a fact, and the honest answer today is NULL.
--                  When an edge layer supplies a verified country, it becomes
--                  a server-side derivation and not a new parameter here.
--
-- CONTEXT VALIDATION (§11). The organization must be one that is genuinely
-- PUBLIC — the same get_public_organization gate follow_organization uses —
-- and any location or barber must actually belong to it. This closes the
-- incoherent-context hole (events pointing at a private tenant, or at a barber
-- from a different shop) without pretending to solve view inflation, which is
-- a rate-limiting problem §13 explicitly declines to over-engineer in R3.
-- ---------------------------------------------------------------------------

create or replace function public.track_analytics_event(
  p_event_name text,
  p_event_origin text,
  p_organization_id uuid default null,
  p_location_id uuid default null,
  p_barber_id uuid default null,
  p_professional_id uuid default null,
  p_properties jsonb default '{}'::jsonb,
  p_session_id text default null,
  p_locale text default null,
  p_correlation_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.track_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, uuid) is
  'The ONLY path by which a browser writes analytics. Deliberately has no actor parameter: the acting account is derived from auth.uid(), so impersonation is impossible by signature rather than by check. Refuses server-authoritative event names outright, refuses authenticated origins from signed-out callers, and refuses incoherent context — an organization that is not public, or a location/barber belonging to a different tenant. Accepts no timestamp, no dedupe key and no commercial context; all three are server-derived.';

revoke execute on function public.track_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, uuid)
  from public;

-- anon is granted deliberately: discovery, search and public profile views
-- happen while signed out, and an analytics contract that only sees
-- authenticated traffic would report a funnel that starts in the middle.
grant execute on function public.track_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, uuid)
  to anon, authenticated;


-- ============================================================================
-- END db/migrations/20260827120200_analytics_ingestion.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260827120300_analytics_business_events.sql
-- ============================================================================

-- FadeUp — R3: authoritative business events
--
-- Every event created here comes from a REAL STATE TRANSITION in a table that
-- is already the product's truth. Not one comes from a button.
--
-- THE RULE THIS FILE EXISTS TO ENFORCE (§5)
--
--   CLICK != BUSINESS SUCCESS.
--
--   A customer who taps Follow and whose request then fails must not appear in
--   the follower funnel. The only way to guarantee that is to emit from the
--   row that changed, inside the transaction that changed it — so an event
--   exists if and only if the fact does. A frontend cannot offer that
--   guarantee at any level of care, which is why none of the conversion events
--   in this file are reachable from apps/web.
--
-- WHY AFTER TRIGGERS, AND NOT EDITS TO THE RPCs
--
--   There are four ways to create an appointment and three to create a queue
--   entry — a public RPC, a staff dialog, a direct PostgREST insert, an
--   internal function. Instrumenting the RPCs would leave the other paths
--   silent and would put analytics inside two hundred lines of twice-hardened,
--   security-critical booking code. An AFTER trigger covers every path,
--   touches none of that code, and is exactly the pattern the repository
--   already uses for notifications (20260819100000) and for the
--   customer-professional relationship (20260826100400).
--
--   AFTER, never BEFORE: the event must describe a fact that has already been
--   accepted by every constraint and guard in front of it.
--
-- WHY NONE OF THIS CAN BREAK THE PRODUCT (§14)
--
--   Every trigger calls private.try_emit_analytics_event, never the strict
--   emitter. That wrapper contains a subtransaction, so a malformed event, a
--   missing taxonomy row or a constraint violation rolls back the EVENT and
--   leaves the follow, booking, completion or claim entirely intact. The
--   failure lands in analytics_ingestion_rejections instead of on the customer.
--
--   This is verified rather than asserted: the R3 suite deliberately breaks
--   emission and proves the business action still commits.
--
-- IDEMPOTENCY, PER TRANSITION KIND (§6)
--
--   ONCE-ONLY transitions — completion, cancellation, creation, issuance —
--   get a PERMANENT entity-scoped key: 'appointment:<id>:completed'. R1A's
--   transition guards make a terminal state unleavable for every caller, so
--   that key can never legitimately be reused, and any retry or duplicated
--   trigger collapses onto the existing row.
--
--   REPEATABLE transitions — following, favoriting, re-confirming after a
--   reschedule — get a key scoped to the TRANSITION INSTANT:
--   'org_follow:<user>:<org>:followed:<epoch microseconds>'. MICROseconds, not
--   seconds: a follow, unfollow and re-follow can all land inside one second,
--   and a whole-second key would silently collapse the last two into the
--   first — the monotonic-undercount failure this whole scheme exists to
--   avoid. A second genuine follow next
--   month is a different instant and stays a separate event, which §6
--   explicitly requires; a duplicated trigger inside one transaction shares
--   now() and collapses. Using a permanent key here would silently swallow
--   every re-follow and make the social funnel monotonically wrong.
--
--   The triggers also fire ONLY on a genuine state change. A second Follow RPC
--   on an already-followed shop updates no state, so no trigger arm runs and
--   no event is written — the double-click case is handled before idempotency
--   is even needed.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. private.analytics_trigger_actor — who caused this transition
--
-- Three genuinely different situations, and conflating them would corrupt
-- every "who does this" report:
--
--   a signed-in account          -> that account, classified from real state
--   a signed-out browser request -> anonymous (a real anonymous booking IS a
--                                   real customer action)
--   no web session at all        -> system (a worker, a sweep, a migration)
--
-- session_user distinguishes (b) from (c): every request through PostgREST
-- arrives as `authenticator`, and nothing else does. This is the same
-- reasoning create_external_professional already relies on, reused rather than
-- reinvented.
-- ---------------------------------------------------------------------------

create or replace function private.analytics_trigger_actor(
  out actor_user_id uuid,
  out actor_type public.analytics_actor_type
)
language plpgsql
stable
set search_path = ''
as $$
begin
  actor_user_id := (select auth.uid());

  if actor_user_id is not null then
    -- NULL means "let the emitter classify from real state".
    actor_type := null;
  elsif session_user = 'authenticator' then
    actor_type := 'anonymous';
  else
    actor_type := 'system';
  end if;
end;
$$;

comment on function private.analytics_trigger_actor() is
  'Resolves the actor for an event emitted from a trigger. Distinguishes a signed-in account (classified from real state by the emitter), a genuinely anonymous web request, and an internal session with no web request at all — using session_user, since every PostgREST request arrives as `authenticator` and nothing else does. Collapsing anonymous into system would erase every anonymous booking from the funnel.';

revoke all on function private.analytics_trigger_actor() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. SOCIAL — organization follow
--
-- organization_follows mutates ONE row in place and keeps unfollows as
-- tombstones, so both directions are visible as a transition on is_following.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_organization_follow_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.analytics_organization_follow_event() is
  'Emits organization_followed / organization_unfollowed from the actual organization_follows state transition. Fires only when is_following genuinely changes direction, so a repeated Follow on an already-followed shop produces nothing. Non-fatal: a failed event never blocks the Follow.';

drop trigger if exists organization_follows_analytics on public.organization_follows;
create trigger organization_follows_analytics
  after insert or update on public.organization_follows
  for each row execute function public.analytics_organization_follow_event();

-- ---------------------------------------------------------------------------
-- 3. SOCIAL — professional follow
--
-- No organization_id, deliberately. A professional follow is an edge to a
-- durable human identity that outlives any shop placement
-- (CUSTOMER_API_FREEZE §1); attributing it to whichever shop the person
-- currently works at would make the number wrong the day they move.
--
-- `source` is carried in properties because auto-follow (created by a
-- completed service) and a deliberate manual follow are different social
-- facts, and a follower count that cannot tell them apart is not evidence of
-- anything.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_professional_follow_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.analytics_professional_follow_event() is
  'Emits professional_followed / professional_unfollowed from the professional_follows state transition, carrying source (manual vs auto) in properties because an auto-follow earned by a completed service and a deliberate follow are different social facts. Carries no organization: the edge is to a durable identity that outlives any shop placement.';

drop trigger if exists professional_follows_analytics on public.professional_follows;
create trigger professional_follows_analytics
  after insert or update on public.professional_follows
  for each row execute function public.analytics_professional_follow_event();

-- ---------------------------------------------------------------------------
-- 4. SOCIAL — shop favorite
--
-- customer_favorites has no state column: favoriting is an INSERT and
-- unfavoriting is a DELETE. Favorite and Follow stay separate events because
-- CUSTOMER_API_FREEZE §3 keeps them separate relationships.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_favorite_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.analytics_favorite_event() is
  'Emits organization_favorited / organization_unfavorited from customer_favorites, where favoriting is an INSERT and unfavoriting a DELETE. Distinguishes a whole-shop favorite from a specific-barber favorite in properties. Favorite stays a separate event from Follow because they are separate relationships under CUSTOMER_API_FREEZE §3.';

drop trigger if exists customer_favorites_analytics on public.customer_favorites;
create trigger customer_favorites_analytics
  after insert or delete on public.customer_favorites
  for each row execute function public.analytics_favorite_event();

-- ---------------------------------------------------------------------------
-- 5. BOOKING — the appointment lifecycle
--
-- One function, both trigger arms, because the context resolution
-- (professional identity behind the barber placement) is identical and
-- duplicating it is how the two arms drift apart.
--
-- professional_id is looked up from barbers.professional_id: barber_id is an
-- operational placement and professional_id is the durable human. A report of
-- "services delivered by this person" must survive them changing shop, so the
-- event records both.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_appointment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.analytics_appointment_event() is
  'Emits the authoritative appointment lifecycle: created on INSERT, and confirmed/cancelled/no_show/completed from real status transitions. Records both barber_id (operational placement) and professional_id (durable identity) so that "services delivered by this person" survives them changing shop. Carries no customer name, contact detail, note or scheduled time — §12. Once-only transitions use permanent dedupe keys; confirmation uses a transition-scoped one because a reschedule legitimately produces a second confirmation.';

drop trigger if exists appointments_analytics_insert on public.appointments;
create trigger appointments_analytics_insert
  after insert on public.appointments
  for each row execute function public.analytics_appointment_event();

drop trigger if exists appointments_analytics_update on public.appointments;
create trigger appointments_analytics_update
  after update of status on public.appointments
  for each row execute function public.analytics_appointment_event();

-- ---------------------------------------------------------------------------
-- 6. QUEUE — the walk-in lifecycle
--
-- Every timestamp read here is server-stamped by R1A's
-- enforce_queue_transition, which OVERWRITES whatever the browser sent. Before
-- R1A the queue timestamps were written by apps/web and a single UPDATE could
-- claim a service completed before it started, ten days in the past. Building
-- analytics on those columns is only defensible because that is now fixed.
--
-- §16: nothing here invents wait time, position or service state. Position is
-- derived, not stored, and this file does not compute it.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_queue_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.analytics_queue_event() is
  'Emits the authoritative walk-in queue lifecycle from queue_entries: joined on INSERT, then called / service_started / completed / cancelled / no_show from real status transitions. Every timestamp it reads is server-stamped by R1A''s enforce_queue_transition, which discards client-supplied values — analytics on these columns would be worthless without that guard. Invents no wait time, position or service state (§16).';

drop trigger if exists queue_entries_analytics_insert on public.queue_entries;
create trigger queue_entries_analytics_insert
  after insert on public.queue_entries
  for each row execute function public.analytics_queue_event();

drop trigger if exists queue_entries_analytics_update on public.queue_entries;
create trigger queue_entries_analytics_update
  after update of status on public.queue_entries
  for each row execute function public.analytics_queue_event();

-- ---------------------------------------------------------------------------
-- 7. PASSPORT
--
-- Two events, and note what is NOT here: nothing reads the Passport's
-- CONTENTS. §17 forbids exposing private Passport history through analytics,
-- so the events record that a passport exists and that a relationship formed —
-- never a haircut, a fade type or a preference note.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_passport_issued_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.analytics_passport_issued_event() is
  'Emits passport_issued when a Fade Passport comes into existence. Records that a passport exists and nothing about what is in it — §17 forbids exposing private Passport history through analytics, and no property here reads a preference column. No organization: the Passport is customer-owned and portable, so attributing issuance to a shop would be false.';

drop trigger if exists customer_passports_analytics on public.customer_passports;
create trigger customer_passports_analytics
  after insert on public.customer_passports
  for each row execute function public.analytics_passport_issued_event();

create or replace function public.analytics_relationship_created_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.analytics_relationship_created_event() is
  'Emits passport_relationship_created when a durable customer-professional relationship first forms from a completed service. The retention funnel''s anchor: this is the moment a first-time customer becomes someone with a history.';

drop trigger if exists customer_professional_relationships_analytics
  on public.customer_professional_relationships;
create trigger customer_professional_relationships_analytics
  after insert on public.customer_professional_relationships
  for each row execute function public.analytics_relationship_created_event();

-- ---------------------------------------------------------------------------
-- 8. ACQUISITION — external profile publication
--
-- Hooked on prospect_professionals, NOT on professionals.
--
-- That is the whole §9 requirement in one decision. prospect_professionals is
-- the UNIFIED LINKAGE between a canonical prospect and a durable professional
-- identity, and it is unique per prospect. Hooking `professionals` instead
-- would have fired before the linkage row existed, leaving the event with no
-- prospect to attribute to — and it would have counted an identity created by
-- any other path as an acquisition.
--
-- Because the linkage is one row per prospect and the event is keyed on the
-- professional, the same real person discovered through four different sources
-- produces four source records, ONE prospect, ONE linkage and therefore
-- exactly ONE external_profile_created. Multi-source discovery can never
-- inflate the conversion count.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_external_profile_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.analytics_external_profile_event() is
  'Emits external_profile_created from prospect_professionals — the unified prospect-to-identity linkage — rather than from professionals. This is what makes §9 hold: one real professional discovered through several sources yields several source records, ONE prospect, ONE linkage and therefore exactly ONE conversion, so multi-source discovery can never inflate the count. Attribution is FIRST-touch, because the question is which channel found a business nobody had.';

drop trigger if exists prospect_professionals_analytics on public.prospect_professionals;
create trigger prospect_professionals_analytics
  after insert on public.prospect_professionals
  for each row execute function public.analytics_external_profile_event();

-- ---------------------------------------------------------------------------
-- 9. CLAIM — submission and decision
--
-- claim_started is deliberately absent: there is no "started" state in
-- professional_claims to hook, and inventing one from a page view would be
-- exactly the fabrication §4 forbids. It stays documented and deferred.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_claim_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.analytics_claim_event() is
  'Emits claim_submitted on INSERT and claim_approved / claim_rejected from real professional_claims decisions. Resolves the originating prospect through prospect_professionals so an approved claim closes the acquisition funnel end to end; a claim over an organically created identity records no prospect rather than a fabricated one. Carries neither the applicant''s evidence text nor the reviewer''s private decision note.';

drop trigger if exists professional_claims_analytics_insert on public.professional_claims;
create trigger professional_claims_analytics_insert
  after insert on public.professional_claims
  for each row execute function public.analytics_claim_event();

drop trigger if exists professional_claims_analytics_update on public.professional_claims;
create trigger professional_claims_analytics_update
  after update of state on public.professional_claims
  for each row execute function public.analytics_claim_event();

-- ---------------------------------------------------------------------------
-- 10. COMMERCIAL — plan assignment and movement
--
-- commercial_plan_changes is already an authoritative, append-only, trigger-
-- protected history. This adds an analytics view of it rather than a second
-- source of truth: previous_plan_key IS NULL is precisely "first assignment",
-- which the table's own comment documents.
--
-- NOTE ON THE SNAPSHOT: the emitter freezes the plan in force at this instant,
-- which for a plan change is the NEW plan. The properties carry both keys
-- explicitly, so a report never has to guess which side of the change the
-- snapshot represents.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_plan_change_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.analytics_plan_change_event() is
  'Emits plan_assigned (previous_plan_key IS NULL — an organization receiving its first plan) or plan_changed, from the already-authoritative commercial_plan_changes history. Both plan keys travel in properties so a report never has to guess which side of the transition the frozen commercial snapshot represents. change_reason is deliberately not carried: it is free text.';

drop trigger if exists commercial_plan_changes_analytics on public.commercial_plan_changes;
create trigger commercial_plan_changes_analytics
  after insert on public.commercial_plan_changes
  for each row execute function public.analytics_plan_change_event();

-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT INSTRUMENTED HERE, AND WHY
--
--   entitlement_blocked_action — the guards refuse by RAISING from a BEFORE
--     INSERT trigger, which aborts the subtransaction and would discard any
--     event written inside it. Recording a refusal needs an emission path that
--     survives the abort. Deferred with the reason written down, not forgotten.
--
--   prospect_discovered / prospect_enriched — Worker V2 is R4/R10 and §25
--     forbids starting it. No trigger is attached to prospects or
--     prospect_events by this migration.
--
--   passport_viewed / claim_started — no authoritative source exists. §4:
--     do not fake events for flows that do not exist yet.
--
--   Every DISCOVERY and BOOKING-INTENT event — those are genuinely client
--   surface facts and are emitted through public.track_analytics_event by the
--   web adapter. Nothing in this file emits them, and the emission wall in the
--   ingestion layer makes it impossible for this file to do so by accident.
-- ---------------------------------------------------------------------------


-- ============================================================================
-- END db/migrations/20260827120300_analytics_business_events.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260827120400_analytics_query_contracts.sql
-- ============================================================================

-- FadeUp — R3: the analytics read layer
--
-- §18: product surfaces must NOT query public.analytics_events directly, and
-- the foundation migration makes that structurally true — anon and
-- authenticated hold no privilege on the table at all, so there is no raw read
-- to forbid.
--
-- This file supplies what replaces it: a small set of SECURITY DEFINER
-- aggregation contracts, each of which authorizes its own caller before
-- reading anything.
--
-- WHAT THESE ARE AND ARE NOT
--
--   They are PRIMITIVES. §18 is explicit that R3 does not build the FadeUp Pro
--   BI dashboard, and nothing here renders, paginates, charts or exports. Each
--   function answers one bounded question over one bounded window and returns
--   counts.
--
--   They return ONLY AGGREGATES. Never a row, never an actor id, never a
--   session id, never a customer name. That is not a stylistic preference: a
--   contract that returned event rows would hand a shop owner the identities
--   of everyone who looked at their profile, which §12 forbids outright. A
--   count of unique viewers is the strongest thing that can be safely exposed,
--   and it is what these return.
--
-- WHY EVERY FUNCTION TAKES AN EXPLICIT WINDOW
--
--   An unbounded aggregate over an append-only event log is a table scan whose
--   cost grows forever. Requiring [from, to) means every one of these is an
--   index range scan on (organization_id, event_name, occurred_at) from the
--   day it ships, and it makes the expensive query unwriteable rather than
--   merely discouraged. The window is also capped, for the same reason.
--
-- WHY NOTHING HERE RUNS AT INGESTION (§21)
--
--   Not one of these functions is called by a trigger, by the emitter or by
--   any business path. Aggregation happens when somebody asks a question, on
--   their own connection, never inside a booking transaction.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. private.analytics_window — one place that decides what a legal window is
--
-- Defaulting and capping in every function separately is how three of them end
-- up with different maxima and the fourth ends up with none.
-- ---------------------------------------------------------------------------

create or replace function private.analytics_window(
  p_from timestamptz,
  p_to timestamptz,
  out window_from timestamptz,
  out window_to timestamptz
)
language plpgsql
immutable
set search_path = ''
as $$
begin
  window_to   := coalesce(p_to, now());
  window_from := coalesce(p_from, window_to - interval '30 days');

  if window_from >= window_to then
    raise exception 'analytics window start must precede its end'
      using errcode = '22023';
  end if;

  -- Two years. Long enough for any year-over-year question a shop actually
  -- asks, short enough that no single call can scan the whole log.
  if window_to - window_from > interval '730 days' then
    raise exception 'analytics window may not exceed 730 days'
      using errcode = '22023';
  end if;
end;
$$;

comment on function private.analytics_window(timestamptz, timestamptz) is
  'Normalises and CAPS an analytics query window in one place, so every read contract shares the same defaults and the same 730-day maximum. The cap is what keeps an unbounded scan of an append-only log unwriteable rather than merely discouraged.';

revoke all on function private.analytics_window(timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.get_organization_analytics_summary
--
-- The tenant's own numbers, and the §18 primitive list in one row.
--
-- AUTHORIZATION: owner or manager only. Deliberately NOT every member — a
-- barber and a receptionist have no business reading the shop's conversion
-- rates, and `is_org_member` would have granted exactly that. Platform admins
-- are admitted separately because support genuinely needs it.
--
-- Conversion rates are computed here rather than left to the caller, because
-- two callers dividing by different denominators is how the same shop gets two
-- different numbers. booking_conversion_rate is completions over CREATED
-- appointments, not over booking_started: intent is a client event and §5
-- forbids resting a conversion metric on one.
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_analytics_summary(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  window_from timestamptz,
  window_to timestamptz,

  profile_views bigint,
  unique_authenticated_viewers bigint,
  distinct_anonymous_sessions bigint,

  booking_starts bigint,
  appointments_created bigint,
  appointments_confirmed bigint,
  appointments_completed bigint,
  appointments_cancelled bigint,
  appointments_no_show bigint,

  queue_views bigint,
  queue_joins bigint,
  queue_completions bigint,
  queue_cancellations bigint,

  follows bigint,
  unfollows bigint,
  favorites bigint,
  unfavorites bigint,

  unique_customers bigint,
  repeat_customers bigint,

  booking_conversion_rate numeric,
  queue_conversion_rate numeric
)
language plpgsql
security definer
stable
set search_path = ''
as $$
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

comment on function public.get_organization_analytics_summary(uuid, timestamptz, timestamptz) is
  'The §18 primitive set for ONE organization, over a bounded window, as counts only. Owner/manager or platform admin — deliberately not every member, since a barber has no business reading the shop''s conversion rates. Returns no event row, no actor id and no session id: a shop learns HOW MANY people viewed its profile and never WHO, per §12. Conversion is completions over appointments CREATED, never over booking_started, because intent is a client event and §5 forbids resting conversion on one.';

revoke execute on function public.get_organization_analytics_summary(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_organization_analytics_summary(uuid, timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.get_professional_analytics_summary
--
-- A professional's own numbers, keyed on the DURABLE identity rather than on a
-- barber placement — so the figures follow the person when they change shop,
-- which is the entire reason professionals exists.
--
-- AUTHORIZATION: the professional themselves, or a platform admin. Not the
-- shop that currently employs them: a professional's cross-shop history is
-- theirs, and R1B built a shop-independent identity precisely so it would not
-- be readable by whoever they happen to work for.
-- ---------------------------------------------------------------------------

create or replace function public.get_professional_analytics_summary(
  p_professional_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  window_from timestamptz,
  window_to timestamptz,
  profile_views bigint,
  unique_authenticated_viewers bigint,
  follows bigint,
  unfollows bigint,
  appointments_completed bigint,
  queue_completions bigint,
  unique_customers bigint,
  repeat_customers bigint,
  relationships_created bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
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

comment on function public.get_professional_analytics_summary(uuid, timestamptz, timestamptz) is
  'A professional''s own numbers, keyed on the durable R1B identity so they follow the person across shops. Readable by that professional or by a platform admin — deliberately NOT by their current employer, since a shop-independent identity that the shop could read would not be shop-independent. Aggregates only.';

revoke execute on function public.get_professional_analytics_summary(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_professional_analytics_summary(uuid, timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. public.get_organization_retention_cohort
--
-- The §10 retention funnel, as a cohort rather than a running total: of the
-- customers whose FIRST delivered service at this shop fell inside the window,
-- how many came back within 30, 60 and 90 days.
--
-- "First" is computed over the whole log, not over the window. A customer who
-- first visited two years ago and returned last week is not a new customer,
-- and a cohort that treated them as one would report retention that never
-- happened.
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_retention_cohort(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  window_from timestamptz,
  window_to timestamptz,
  first_time_customers bigint,
  returned_at_all bigint,
  returned_within_30d bigint,
  returned_within_60d bigint,
  returned_within_90d bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
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

comment on function public.get_organization_retention_cohort(uuid, timestamptz, timestamptz) is
  'The §10 retention funnel as a true cohort: of customers whose FIRST delivered service at this shop fell in the window, how many returned at all and within 30/60/90 days. First-visit is computed over all history, not over the window, so a long-standing customer who happened to visit during the window is never miscounted as newly acquired.';

revoke execute on function public.get_organization_retention_cohort(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_organization_retention_cohort(uuid, timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.get_platform_analytics_funnel
--
-- FadeUp's own numbers: the acquisition and claim funnel of §10, plus the
-- platform-wide product totals. Platform admin only, and it is the only
-- contract here that reads across tenants.
--
-- converted_professionals counts DISTINCT professional_id, not events. That is
-- the §9 guarantee expressed at read time as well as at write time: the same
-- real person discovered through four sources must count once, and a
-- `count(*)` here would have quietly undone the care taken in the emitter.
-- ---------------------------------------------------------------------------

create or replace function public.get_platform_analytics_funnel(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  window_from timestamptz,
  window_to timestamptz,

  external_profiles_created bigint,
  claims_submitted bigint,
  claims_approved bigint,
  claims_rejected bigint,
  converted_professionals bigint,

  organizations_with_activity bigint,
  appointments_created bigint,
  appointments_completed bigint,
  queue_joins bigint,
  queue_completions bigint,
  passports_issued bigint,
  plans_assigned bigint,
  plans_changed bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
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

comment on function public.get_platform_analytics_funnel(timestamptz, timestamptz) is
  'FadeUp''s own acquisition/claim funnel and platform product totals, over a bounded window. Platform admin only, and the only read contract that crosses tenants. converted_professionals counts DISTINCT professional identities rather than approval events, so multi-source discovery cannot inflate it — the §9 guarantee enforced at read time as well as at write time.';

revoke execute on function public.get_platform_analytics_funnel(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_platform_analytics_funnel(timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. private.purge_analytics_events — the retention path
--
-- The ONLY way a row ever leaves analytics_events, and the only holder of the
-- flag the append-only DELETE guard honours.
--
-- Not a cron job and not scheduled here: R3 installs no scheduler (§25 keeps
-- worker/automation scope out), and a retention policy is an operator decision
-- with legal weight. What R3 provides is a safe, auditable, single-purpose
-- primitive for whoever makes that decision, with a floor that makes an
-- accidental "purge everything" impossible.
-- ---------------------------------------------------------------------------

create or replace function private.purge_analytics_events(p_before timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  if p_before is null then
    raise exception 'a retention cutoff is required' using errcode = '22023';
  end if;

  -- THE FLOOR. Nothing inside 90 days can be purged by this function at all,
  -- whatever it is asked. A retention job with a mis-signed interval, a
  -- timezone slip or a typo'd unit is the realistic way an event log gets
  -- destroyed, and none of those can reach live data through here.
  if p_before > now() - interval '90 days' then
    raise exception 'analytics retention cutoff must be at least 90 days in the past'
      using errcode = '22023';
  end if;

  -- Transaction-local, and unset immediately afterwards. A client role cannot
  -- reach this function at all, so the flag is not an escape hatch — it is how
  -- one function tells one trigger that this specific DELETE is the sanctioned
  -- one.
  perform set_config('fadeup.analytics_retention_purge', 'on', true);

  delete from public.analytics_events e where e.occurred_at < p_before;
  get diagnostics v_deleted = row_count;

  perform set_config('fadeup.analytics_retention_purge', '', true);

  raise notice 'analytics retention: % events removed before %', v_deleted, p_before;
  return v_deleted;
end;
$$;

comment on function private.purge_analytics_events(timestamptz) is
  'The ONLY path by which an analytics event is ever removed, and the only holder of the flag the append-only DELETE guard honours. Refuses any cutoff inside 90 days, so a mis-signed interval or a typo''d unit in a future retention job cannot reach live data. Deliberately not scheduled: R3 installs no cron, and a retention policy is an operator decision with legal weight.';

revoke all on function private.purge_analytics_events(timestamptz) from public, anon, authenticated;


-- ============================================================================
-- END db/migrations/20260827120400_analytics_query_contracts.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260827120500_analytics_privilege_hardening.sql
-- ============================================================================

-- FadeUp — R3: privilege hardening, and the assertions that keep it true
--
-- THE DEFAULT THIS FILE EXISTS TO UNDO
--
--   Postgres grants EXECUTE to PUBLIC on every newly created function. Because
--   anon and authenticated inherit from PUBLIC, that means every function the
--   preceding four migrations created is, by default, a callable API endpoint —
--   including nine SECURITY DEFINER trigger functions.
--
--   In practice a trigger function called directly fails immediately ("trigger
--   functions can only be called as triggers"), so this is hardening rather
--   than a live exploit. It is done anyway, because "it happens to fail for an
--   unrelated reason" is not an access control, and because the Supabase
--   security guidance bundled with this repository is unambiguous: a SECURITY
--   DEFINER function in `public` is a public endpoint until somebody revokes it.
--
-- WHAT IS DELIBERATELY LEFT CALLABLE
--
--   Exactly four functions, and each is listed by name below rather than
--   matched by a pattern, so adding a fifth is a decision somebody has to
--   write down:
--
--     track_analytics_event               anon + authenticated  (§11 client path)
--     get_organization_analytics_summary  authenticated         (tenant reads)
--     get_organization_retention_cohort   authenticated
--     get_professional_analytics_summary  authenticated
--     get_platform_analytics_funnel       authenticated         (admin-gated in body)
--
--   Every one of those authorizes its own caller in its body. The grant admits
--   them to the function; the function decides what they may see.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Revoke PUBLIC execute on everything R3 created in `public`
--
-- Driven off the catalogue rather than a hand-maintained list, so a function
-- added by a later R3 fix cannot be forgotten here.
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn record;
  v_revoked integer := 0;
begin
  for v_fn in
    select
      p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'analytics\_%'
        or p.proname in (
          'track_analytics_event',
          'reject_analytics_event_mutation',
          'get_organization_analytics_summary',
          'get_organization_retention_cohort',
          'get_professional_analytics_summary',
          'get_platform_analytics_funnel'
        )
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.signature);
    v_revoked := v_revoked + 1;
  end loop;

  raise notice 'R3 hardening: execute revoked from PUBLIC on % analytics functions', v_revoked;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Re-grant the four (five signatures) that are genuinely client contracts
-- ---------------------------------------------------------------------------

grant execute on function public.track_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, uuid)
  to anon, authenticated;

grant execute on function public.get_organization_analytics_summary(uuid, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.get_organization_retention_cohort(uuid, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.get_professional_analytics_summary(uuid, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.get_platform_analytics_funnel(timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Re-assert the table posture
--
-- The foundation migration set this up; re-asserting here means a stray grant
-- issued between the two is corrected on every replay, and means this file
-- alone is enough to restore the posture.
-- ---------------------------------------------------------------------------

revoke all on table public.analytics_events from public, anon, authenticated;
revoke all on table public.analytics_event_definitions from public, anon, authenticated;
revoke all on table public.analytics_ingestion_rejections from public, anon, authenticated;

-- The acquisition worker gets nothing either. It has no reason to read product
-- analytics, and R1A's least-privilege migration removed a broader grant from
-- this same role for exactly the reason that a scraping worker is the
-- highest-risk credential in the system.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    execute 'revoke all on table public.analytics_events from prospect_worker';
    execute 'revoke all on table public.analytics_event_definitions from prospect_worker';
    execute 'revoke all on table public.analytics_ingestion_rejections from prospect_worker';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. THE ASSERTIONS
--
-- Everything above can be undone by one careless grant in a later migration.
-- These run inside this transaction and refuse to commit if the posture is
-- wrong, so the failure surfaces at deploy time rather than in an audit.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text;
  v_count integer;
begin
  -- 4.1 No client role holds ANY privilege on the event log. This is the §11
  -- "clients cannot raw INSERT" requirement, proven rather than asserted, and
  -- it covers SELECT too — a tenant reading another tenant's raw events is the
  -- larger failure.
  select string_agg(format('%s:%s', r, pr), ', ')
    into v_bad
  from unnest(array['anon', 'authenticated']) as r
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as pr
  where has_table_privilege(r, 'public.analytics_events', pr);

  if v_bad is not null then
    raise exception 'R3 hardening: a client role holds privilege on analytics_events (%)', v_bad;
  end if;

  -- 4.2 Same for the taxonomy and the diagnostics table.
  select string_agg(format('%s on %s', r, t), ', ')
    into v_bad
  from unnest(array['anon', 'authenticated']) as r
  cross join unnest(array[
    'public.analytics_event_definitions',
    'public.analytics_ingestion_rejections'
  ]) as t
  where has_table_privilege(r, t, 'SELECT')
     or has_table_privilege(r, t, 'INSERT');

  if v_bad is not null then
    raise exception 'R3 hardening: a client role holds privilege on an analytics support table (%)', v_bad;
  end if;

  -- 4.3 RLS is enabled AND forced on all three. Enabled-but-not-forced would
  -- exempt the table owner, and every ingestion function runs as the owner.
  select string_agg(c.relname, ', ')
    into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('analytics_events', 'analytics_event_definitions', 'analytics_ingestion_rejections')
    and not (c.relrowsecurity and c.relforcerowsecurity);

  if v_bad is not null then
    raise exception 'R3 hardening: RLS is not enabled and forced on: %', v_bad;
  end if;

  -- 4.4 EVERY R3 function pins its search_path — deliberately NOT filtered to
  -- SECURITY DEFINER, matching the reasoning R1B's hardening already records:
  -- an unqualified name resolves through the CALLER's search_path in either
  -- case, so a caller can create their own `analytics_events` in a schema they
  -- control and have the function read or write there instead. Definer
  -- functions make that worse, not different.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and (p.proname like 'analytics\_%'
         or p.proname like '%\_analytics\_%'
         or p.proname in ('track_analytics_event', 'purge_analytics_events',
                          'emit_analytics_event', 'try_emit_analytics_event'))
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
      where cfg like 'search_path=%'
    );

  if v_bad is not null then
    raise exception 'R3 hardening: SECURITY DEFINER function without a pinned search_path: %', v_bad;
  end if;

  -- 4.5 No analytics function in `private` is callable by a client role. The
  -- private schema is not exposed through PostgREST, so this is defence in
  -- depth — but private.emit_analytics_event accepts an arbitrary actor id,
  -- and a grant on it would hand a client exactly the impersonation the whole
  -- ingestion design exists to prevent.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon', 'authenticated']) as r
  where n.nspname = 'private'
    and (p.proname like '%analytics%' or p.proname like 'purge_analytics%')
    and has_function_privilege(r, p.oid, 'EXECUTE');

  if v_bad is not null then
    raise exception 'R3 hardening: a client role can execute a private analytics function: %', v_bad;
  end if;

  -- 4.6 THE INSTRUMENTATION IS ACTUALLY ATTACHED.
  --
  -- Everything else here is worthless if the triggers are missing: an
  -- analytics engine nothing emits into is an empty table with excellent
  -- documentation. A dropped migration or a renamed table produces exactly
  -- that, and nothing else in the pipeline would notice.
  select count(*)
    into v_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal
    and t.tgname in (
      'organization_follows_analytics',
      'professional_follows_analytics',
      'customer_favorites_analytics',
      'appointments_analytics_insert',
      'appointments_analytics_update',
      'queue_entries_analytics_insert',
      'queue_entries_analytics_update',
      'customer_passports_analytics',
      'customer_professional_relationships_analytics',
      'prospect_professionals_analytics',
      'professional_claims_analytics_insert',
      'professional_claims_analytics_update',
      'commercial_plan_changes_analytics'
    );

  if v_count <> 13 then
    raise exception 'R3 hardening: expected 13 analytics triggers attached, found %', v_count;
  end if;

  -- 4.7 The append-only guards are attached. Without them "append-only" is a
  -- comment.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'analytics_events'
      and t.tgname = 'analytics_events_reject_update'
      and not t.tgisinternal
  ) or not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'analytics_events'
      and t.tgname = 'analytics_events_reject_delete'
      and not t.tgisinternal
  ) then
    raise exception 'R3 hardening: analytics_events is missing an append-only guard';
  end if;

  -- 4.8 analytics_events has NO permissive policy. The posture is "no grant,
  -- no policy, unreachable"; a policy appearing here would mean somebody
  -- started down the road of exposing the raw log to clients.
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename = 'analytics_events';

  if v_count <> 0 then
    raise exception 'R3 hardening: analytics_events has % RLS policies; it is meant to be unreachable, not selectively readable', v_count;
  end if;

  raise notice 'R3 hardening: all analytics privilege assertions passed';
end $$;


-- ============================================================================
-- END db/migrations/20260827120500_analytics_privilege_hardening.sql
-- ============================================================================

commit;

-- ============================================================================
-- Applied. Next steps: run
--   supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql
--   supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--   supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- and confirm 0 FAIL rows in all five.
-- ============================================================================
