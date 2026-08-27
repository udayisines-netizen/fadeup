-- ============================================================================
-- FadeUp — MASTER: the Service Mode foundation
-- Generated 2026-08-26. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-service-mode.sh
-- Verify in sync:   scripts/generate-master-service-mode.sh --check
--
-- WHAT THIS IS
--
--   FadeUp sells two operating channels — reservations and a live walk-in
--   queue — and until this file the product had no way to SAY which of them a
--   shop is currently running. Both were unconditionally open, everywhere,
--   always.
--
--   It adds one enum, three tables and the enforcement that makes them mean
--   something:
--
--     service_mode                 hybrid / reservation_only / queue_only /
--                                  unavailable
--     location_service_settings    per-ESTABLISHMENT default mode + queue_open,
--                                  and the mutex the whole feature serialises on
--     barbers.service_mode_override  one nullable column: NULL = inherit
--     service_mode_overrides       temporary exceptions, location or barber
--     service_mode_changes         append-only "who changed what, and when"
--
--   THIS LOT REQUIRES R1A, R1B AND R2. It composes R2's
--   private.org_has_capability rather than reimplementing any commercial logic,
--   and it changes no price, no plan and no capability packaging.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. THIS FILE CLOSES A REAL ENTITLEMENT BYPASS, AND THAT IS ITS MOST
--      VISIBLE CONSEQUENCE.
--      R2 built private.org_has_capability and wired it into capacity triggers
--      and the plan-assignment RPC — but NOT into booking or queue admission.
--      Searching every migration for a caller finds only R2's own assertion
--      lists. R2's own MASTER header says so, and says the fix "is a product
--      decision with its own migration". This is that migration.
--
--      After applying, a new appointment requires the `booking` capability and
--      a new queue entry requires `walkIns` OR `liveQueue`. The `free` plan has
--      none of the three and can therefore do neither.
--
--      This breaks NO operating organization today: R2's backfill
--      (20260826110200) assigns `free` only to an organization with zero active
--      locations AND zero active professionals, and both admission paths
--      already require a valid active location. Every organization that can
--      currently take a booking is on `solo` or better, and every one of those
--      plans includes `booking`.
--
--   B. EVERY EXISTING ESTABLISHMENT IS BACKFILLED TO `hybrid`, QUEUE OPEN.
--      That is exactly how all of them behave today, so the backfill changes
--      no current behaviour. Every barber gets NULL — inherit — and NOT a copy
--      of the establishment's mode: copying it would turn a live inheritance
--      edge into a snapshot and make the establishment default useless.
--
--      Inactive locations are backfilled too, deliberately, so that
--      reactivating one does not silently change its service mode.
--
--   C. MODE GOVERNS NEW ADMISSIONS ONLY. NOTHING IS EVER CANCELLED.
--      The guards are BEFORE INSERT and fire on INSERT alone. Switching an
--      establishment to reservation_only with three people in the queue leaves
--      three people in the queue, and they are still served. Switching to
--      queue_only leaves tomorrow's eight appointments intact and still
--      confirmable, completable and cancellable. There is no code path in this
--      file that deletes or cancels anything — the generator asserts the
--      absence of DELETE and of any UPDATE that sets a cancelled status.
--
--   D. queue_open IS A SEPARATE FACT AND STAYS ONE.
--      It did not exist before this lot (verified: no runtime queue state in
--      any of the 89 preceding migrations; the marketplace's `is_open_now` is
--      computed from location_hours, which is opening hours). Every combination
--      is legitimate and representable, including reservation_only with the
--      queue open — where the mode still refuses new joins. Changing the mode
--      never mutates queue_open, and vice versa.
--
--   E. ENFORCEMENT IS A TRIGGER, SO IT BINDS service_role AND postgres TOO.
--      There are four ways to create an appointment and three to create a queue
--      entry, including a direct PostgREST insert by staff and BYPASSRLS roles.
--      An RLS `with check` would have held for the browser and evaporated for
--      exactly the privileged paths. There is NO bypass GUC, NO session
--      variable and NO role exemption; a restore that must exceed current mode
--      is `pg_restore --disable-triggers`, which is explicit and auditable.
--
--   F. THE RACE IS CLOSED WITH A SHARED/EXCLUSIVE PAIR ON A REAL ROW.
--      Mode changes take FOR UPDATE on the establishment's
--      location_service_settings row; admissions take FOR SHARE on the same
--      row. Admissions run concurrently with each other; a mode change waits
--      for those in flight and then blocks new ones. Under READ COMMITTED a
--      blocked row lock re-reads the row when granted, so an admission that
--      queues behind a mode change sees the NEW mode — there is no window in
--      which a stale admission commits after the change won.
--
--   G. EXPIRY NEEDS NO CRON, NO WORKER AND NO OPEN BROWSER.
--      A temporary override stops applying the instant expires_at <= now(),
--      decided by the resolver reading the row. Rows are never deleted on
--      expiry, so the history survives. There is no scheduled job to install
--      and none to forget to install.
--
--   H. MODE IS OPERATIONAL STATE, SO IT LIVES ON THE PLACEMENT.
--      The persistent override is a column on public.barbers, NOT on the
--      durable public.professionals identity R1B built. A professional will
--      work in more than one establishment and their mode can differ at each;
--      a column on the identity could hold only one answer, and would make
--      durable identity mutable operational state.
--
--   I. PER ESTABLISHMENT, NEVER PER ORGANIZATION.
--      location_service_settings is keyed on location_id. A multi-salon group
--      changes one salon at a time, and one salon going queue_only says nothing
--      about the others.
--
-- WHAT THIS LOT DELIBERATELY DOES NOT DO
--
--   No recurring weekly schedules (no rule editor, no scheduler, no schedule
--   engine) — the model leaves room for them and this lot does not build them.
--   No mobile application, no Expo, no React Native. No Stripe, no billing, no
--   checkout. No new pricing and no change to R2's plan matrix. No SMS. No
--   automatic mode inferred from queue length or staff count.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully rolls
--     back.
--   * Removes no table, removes no column, truncates nothing, deletes nothing.
--   * Cancels nothing: no appointment and no queue entry changes status.
--   * Writes data in exactly one place — the location_service_settings
--     backfill, which is INSERT ... ON CONFLICT DO NOTHING and idempotent.
--   * Fabricates no temporary override and no history row.
--   * Adds no anon RLS policy. The database's count stays at zero.
--   * Touches no R1A, R1B or R2 object, and re-asserts R1B's protection of
--     barbers.professional_id.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \\
--       -f supabase/MASTER_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--
--   R1A's, R1B's and R2's verifications must still pass unchanged:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260826120000_service_mode_foundation.sql
-- ============================================================================

-- FadeUp — SERVICE MODE: the type, the establishment default, and queue_open
--
-- WHAT THIS LOT IS FOR
--
-- FadeUp sells two operating channels: reservations and a live walk-in queue.
-- Until this file, the product had no way to SAY which of them a shop is
-- currently running. Both were unconditionally open, everywhere, always. A
-- barber who only takes walk-ins on Saturday had no way to express it except by
-- deleting their availability, and a shop that wanted to stop new walk-ins for
-- an hour had no way to express it at all.
--
-- Four modes, and only four:
--
--   hybrid            reservations AND queue
--   reservation_only  reservations, no NEW queue admissions
--   queue_only        queue, no NEW reservations
--   unavailable       no NEW admission on either channel
--
-- The enum values are durable machine identities. Every label a human reads is
-- a locale key in apps/web/src/locales/*/; nothing in this schema is a
-- presentation string, and no business logic anywhere may branch on one.
--
-- WHAT SERVICE MODE IS NOT
--
-- It is not availability, not opening hours, not staff active/inactive, not a
-- location being active, and — most importantly — NOT AN ENTITLEMENT. Setting
-- a free organization to `hybrid` must not hand it a paid Booking or Queue
-- operation. Service mode answers "which channels does this establishment
-- accept?", and it composes with, rather than replaces, the R2 commercial
-- question and the runtime queue question.
--
-- WHY queue_open IS BORN HERE, AND WHY IT IS A SEPARATE COLUMN
--
-- An audit of all 89 preceding migrations found NO runtime queue state of any
-- kind. `is_open_now` in the marketplace RPCs is computed from location_hours —
-- that is opening hours, a genuinely different fact, and it is not writable.
-- So the "is the live queue accepting new entries right now?" state does not
-- exist yet and is created here.
--
-- It is deliberately NOT folded into service_mode, because the two answer
-- different questions and every combination of them is legitimate:
--
--   hybrid           + queue_open=false   booking open, walk-ins paused
--   queue_only       + queue_open=false   walk-in shop, queue paused right now
--   reservation_only + queue_open=true    representable, and it means what it
--   unavailable      + queue_open=true    says: mode still blocks new joins
--
-- The last two look odd and must remain representable: closing the queue is an
-- operational act with its own history, and a mode change must never silently
-- mutate it. A shop that flips to reservation_only for an afternoon should find
-- its queue exactly as it left it when it flips back.
--
-- WHY THE DEFAULT IS hybrid
--
-- Verified against the repository, not assumed: today book_public_appointment
-- and join_public_queue both admit unconditionally, so every existing
-- establishment currently behaves exactly as `hybrid` + `queue_open=true`
-- behaves. Any other default would silently switch off a channel that works
-- today, which §40 forbids.
--
-- WHY THIS TABLE, AND NOT A COLUMN ON public.locations
--
--   * It is the MUTEX for the whole feature. Every mode change, every
--     queue_open toggle and every temporary-override write takes FOR UPDATE on
--     this row; every admission takes FOR SHARE. Putting that contention on
--     public.locations would serialise address edits against walk-ins.
--   * locations is read on nearly every public page. Adding a hot,
--     frequently-updated column to it would churn a row that is otherwise
--     almost static, and drag it into the realtime publication for reasons
--     unrelated to addresses.
--   * The grant surface can be shut completely: a client never writes this
--     table directly, only through the RPCs in 20260826120400.
--
-- PER ESTABLISHMENT, NEVER PER ORGANIZATION
--
-- The primary key is location_id. A multi-salon organization gets one row per
-- salon, and one salon switching to queue_only says nothing about the others.
-- "Shop default" in product language means THIS row.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The type
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'service_mode') then
    create type public.service_mode as enum
      ('hybrid', 'reservation_only', 'queue_only', 'unavailable');
  end if;
end $$;

comment on type public.service_mode is
  'Which service channels an establishment or barber placement accepts for NEW admissions. hybrid = reservations + queue; reservation_only = reservations only; queue_only = walk-ins only; unavailable = neither. Governs NEW admissions ONLY — never existing appointments or queue entries. Not an entitlement, not availability, not opening hours.';

-- ---------------------------------------------------------------------------
-- 2. The establishment row
-- ---------------------------------------------------------------------------

create table if not exists public.location_service_settings (
  location_id uuid primary key references public.locations (id) on delete cascade,
  -- Denormalised so RLS, the capability lookup and the tenant guard do not
  -- have to join through locations on every admission. Kept honest by
  -- location_service_settings_check_consistency below.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  default_service_mode public.service_mode not null default 'hybrid',
  queue_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.location_service_settings is
  'Per-ESTABLISHMENT service-mode default and live queue runtime state. One row per location, created by trigger and guaranteed by private.ensure_location_service_settings. Also THE MUTEX for the service-mode feature: mode changes take FOR UPDATE on this row, admissions take FOR SHARE, so an admission can never commit against a mode a committed transaction has already replaced. A client never writes this table directly — only through the RPCs in 20260826120400.';

comment on column public.location_service_settings.default_service_mode is
  'The establishment default. Barbers with barbers.service_mode_override IS NULL inherit it live — changing this column moves every inheriting barber without touching a single barber row.';

comment on column public.location_service_settings.queue_open is
  'Runtime live-queue state: is the queue accepting NEW entries right now? Deliberately independent of default_service_mode — every combination of the two is legitimate and representable, and changing the mode never silently mutates this. Not opening hours (see location_hours) and not availability.';

create index if not exists location_service_settings_organization_id_idx
  on public.location_service_settings (organization_id);

drop trigger if exists location_service_settings_set_updated_at on public.location_service_settings;
create trigger location_service_settings_set_updated_at
  before update on public.location_service_settings
  for each row execute function public.set_updated_at();

-- Tenant-consistency invariant, at trigger level so it holds for service_role
-- and direct SQL too — the same standard every other FadeUp table is held to.
create or replace function public.check_location_service_settings_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
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

drop trigger if exists location_service_settings_check_consistency on public.location_service_settings;
create trigger location_service_settings_check_consistency
  before insert or update on public.location_service_settings
  for each row execute function public.check_location_service_settings_consistency();

-- ---------------------------------------------------------------------------
-- 3. ensure_location_service_settings — the row always exists
--
-- Every reader and every enforcement point calls this first, so no code path
-- has to carry a "what if there is no row" branch. It creates the COMPATIBILITY
-- default (hybrid / open), not the most restrictive one, and that is a
-- deliberate departure from the R2 ensure_organization_commercial_state
-- precedent: R2's row is a COMMERCIAL fact, where failing closed is right,
-- while this row is an OPERATIONAL preference whose absence is a bookkeeping
-- gap rather than a claim. Failing closed here would take a working shop
-- offline over a missing row. The commercial gate is enforced separately in
-- 20260826120500 and is what actually stops an unentitled organization —
-- this default cannot grant anything.
-- ---------------------------------------------------------------------------

create or replace function private.ensure_location_service_settings(p_location_id uuid)
returns void
language plpgsql
-- SECURITY DEFINER: client roles hold no INSERT on this table (see the grants
-- at the foot of this file), but an anonymous booking must still be able to
-- traverse a location whose row a restore left behind.
security definer
set search_path = ''
as $$
begin
  if p_location_id is null then
    return;
  end if;

  insert into public.location_service_settings (location_id, organization_id)
  select l.id, l.organization_id
  from public.locations l
  where l.id = p_location_id
  on conflict (location_id) do nothing;
end;
$$;

comment on function private.ensure_location_service_settings(uuid) is
  'Guarantees the service-settings row for a location exists, with the compatibility default (hybrid, queue open). Idempotent and safe to call on any path. Creates the PERMISSIVE default deliberately: this row is an operational preference, not a commercial claim, and a missing row must not take a working establishment offline. Entitlement is enforced separately and cannot be granted by this function.';

revoke all on function private.ensure_location_service_settings(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. New locations get their row automatically
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_location_service_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.location_service_settings (location_id, organization_id)
  values (new.id, new.organization_id)
  on conflict (location_id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_location_service_settings() is
  'AFTER INSERT on locations: gives every new establishment its service-settings row with the compatibility default, so no later code path has to cope with a location that has none.';

drop trigger if exists locations_create_service_settings on public.locations;
create trigger locations_create_service_settings
  after insert on public.locations
  for each row execute function public.handle_new_location_service_settings();

-- ---------------------------------------------------------------------------
-- 5. Backfill
--
-- Deterministic and behaviour-preserving: EVERY existing location, active or
-- not, receives hybrid + queue_open=true, because that is precisely how every
-- one of them behaves today. Inactive locations are included on purpose —
-- excluding them would mean reactivating a location silently changed its
-- service mode, which is the sort of surprise this table exists to prevent.
--
-- No temporary overrides are fabricated. No change-history rows are fabricated:
-- nobody made these choices, and inventing an actor for them would be a lie
-- told to whoever reads the audit trail later.
-- ---------------------------------------------------------------------------

insert into public.location_service_settings (location_id, organization_id)
select l.id, l.organization_id
from public.locations l
on conflict (location_id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. RLS and grants
--
-- READ: any member of the owning organization, or a platform admin. The
-- customer-facing read does NOT come through this policy — it goes through
-- public.get_public_service_state (20260826120600), a curated projection that
-- re-derives every id from the organization slug and returns zero rows for
-- anything not publicly operable. Exposing this table to anon would be an
-- existence oracle for every location id in the database.
--
-- WRITE: nobody. There is no INSERT, UPDATE or DELETE policy and no client
-- write grant. Every mutation goes through a SECURITY DEFINER RPC that checks
-- the actor's membership and writes the change history in the same
-- transaction. A policy would let a manager UPDATE the row directly and skip
-- the audit row entirely.
-- ---------------------------------------------------------------------------

alter table public.location_service_settings enable row level security;
alter table public.location_service_settings force row level security;

drop policy if exists location_service_settings_select on public.location_service_settings;
create policy location_service_settings_select
  on public.location_service_settings
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

revoke all on public.location_service_settings from anon, authenticated;
grant select on public.location_service_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Realtime
--
-- A mode change or a queue open/close must reach an open Pro screen without a
-- manual refresh. Postgres Changes is RLS-aware, and the select policy above is
-- what makes this tenant-safe — a subscriber only receives events for rows its
-- own policy would let it read. Anonymous customer surfaces have no realtime
-- path here (they never could — anon has no SELECT); they refresh through the
-- expires_at-scheduled invalidation and the existing polling fallback.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'location_service_settings'
  ) then
    alter publication supabase_realtime add table public.location_service_settings;
  end if;
end $$;


-- ============================================================================
-- END db/migrations/20260826120000_service_mode_foundation.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826120100_barber_service_mode_override.sql
-- ============================================================================

-- FadeUp — SERVICE MODE: the barber's persistent override
--
-- WHY THIS COLUMN IS ON public.barbers AND NOT ON public.professionals
--
-- R1B deliberately split two things that had been one:
--
--   public.professionals   durable, organization-INDEPENDENT public identity.
--                          It survives leaving a shop, being deleted as a
--                          staff account, and being claimed later. It is what
--                          a follower follows and what a Passport remembers.
--
--   public.barbers         the OPERATIONAL placement: this professional, taking
--                          appointments, for this organization, right now.
--
-- Service mode is operational state. "I am taking walk-ins only today" is a
-- fact about a shift at an establishment, not a fact about a person. Putting it
-- on `professionals` would be convenient and would be wrong twice over:
--
--   1. A professional will eventually work in more than one establishment
--      (R18). Their mode can legitimately differ per establishment — walk-ins
--      at the busy high-street shop, appointments only at the quiet one. A
--      column on the durable identity can hold exactly one answer and would
--      force both shops to agree.
--   2. It would make the durable identity mutable operational state, which is
--      precisely the coupling R1B paid to remove. A professional whose account
--      is erased still has appointments and a Passport; they must not still
--      have an opinion about today's walk-in policy.
--
-- So it goes on the placement row. `barbers` is the right one specifically:
-- staff_profiles covers any role (a receptionist has one, and a receptionist
-- has no service mode), while `barbers` is exactly "this staff member takes
-- appointments" — the population for which the question is meaningful.
--
-- NULL MEANS INHERIT, AND INHERITANCE IS REAL
--
-- The column is nullable and NULL is the default and the overwhelmingly common
-- value. It is NOT backfilled with the establishment's mode: copying the
-- location default into every barber row would turn a live inheritance edge
-- into a snapshot, and changing the establishment default would then require
-- finding and updating every barber who had not deliberately chosen anything.
-- That is the bug this comment exists to prevent someone "tidying up" into
-- existence later.
--
--   Location: hybrid
--     Barber A  override NULL              -> hybrid            (inherits)
--     Barber B  override reservation_only  -> reservation_only  (their own)
--     Barber C  override queue_only        -> queue_only        (their own)
--
--   Location default changes to queue_only:
--     Barber A  -> queue_only         (moved, no row written)
--     Barber B  -> reservation_only   (untouched — they chose)
--     Barber C  -> queue_only         (untouched — they chose, and it now agrees)
--
-- WHY NO REVOKE IS NEEDED HERE, AND WHY THAT WAS CHECKED RATHER THAN ASSUMED
--
-- `authenticated` holds INSERT and UPDATE on public.barbers as COLUMN-level
-- grants, not table-level ones — R1B already revoked the table-level privilege
-- when it protected professional_id (pg_class.relacl shows authenticated=rdDxtm,
-- with no `a` and no `w`; the per-column grants live in pg_attribute.attacl).
--
-- A new column therefore arrives with NO write privilege for any client role,
-- automatically. Re-granting a column list here — the technique 20260825100400
-- needed for appointments.booked_by_user_id, where the grant WAS table-level —
-- would be worse than unnecessary: the natural way to write it is to list "all
-- the columns", which would silently re-grant professional_id and undo R1B's
-- protection. So this file grants nothing, and the assertion block below proves
-- the column really is unwritable rather than trusting that reasoning.
--
-- SELECT is table-level and does cover the new column, which is harmless:
-- public.barbers has RLS enabled and FORCEd with no `anon` policy at all, so
-- anonymous callers read nothing from this table by any route. Public barber
-- data reaches customers only through the curated SECURITY DEFINER projections.
--
-- The only way to WRITE this column is public.set_barber_service_mode_override
-- (20260826120400), which checks the actor and writes the change-history row in
-- the same transaction.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'barbers'
      and column_name = 'service_mode_override'
  ) then
    alter table public.barbers add column service_mode_override public.service_mode;
  end if;
end $$;

comment on column public.barbers.service_mode_override is
  'This barber placement''s PERSISTENT service mode. NULL — the default and the common case — means inherit the establishment default from location_service_settings live, so changing the establishment default moves every inheriting barber with no row updates. Non-NULL means this barber normally works in that mode regardless of the establishment. Beaten by an active temporary override (see service_mode_overrides); beats the establishment default. Deliberately on the OPERATIONAL placement row rather than on the durable public.professionals identity: a professional may work in several establishments under different modes, and R1B''s identity durability must not become mutable operational state. Writable ONLY through public.set_barber_service_mode_override.';

-- A partial index: the resolver's interesting case is the small minority of
-- rows that actually carry an override. Rows inheriting NULL are never looked
-- up by this column.
create index if not exists barbers_service_mode_override_idx
  on public.barbers (service_mode_override) where service_mode_override is not null;

-- ---------------------------------------------------------------------------
-- Prove the column is unwritable by clients, and that R1B's protection of
-- professional_id is still intact.
--
-- This is an assertion, not a fix. If a future migration ever re-grants
-- table-level INSERT/UPDATE on public.barbers, this block fails the replay
-- loudly instead of letting the override quietly become client-writable.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text := '';
  r record;
begin
  for r in
    select unnest(array['anon', 'authenticated']) as grantee,
           unnest(array['insert', 'update']) as priv
  loop
    if has_column_privilege(r.grantee, 'public.barbers', 'service_mode_override', r.priv) then
      v_bad := v_bad || format(' %s:%s', r.grantee, r.priv);
    end if;
  end loop;

  -- R1B's own protection, re-checked here because this file is the one that
  -- would break it.
  if has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'update')
     or has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'insert') then
    v_bad := v_bad || ' R1B-regression:professional_id-writable';
  end if;

  if v_bad <> '' then
    raise exception 'service_mode_override privilege check failed —%', v_bad
      using errcode = 'P0001';
  end if;
end $$;


-- ============================================================================
-- END db/migrations/20260826120100_barber_service_mode_override.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826120200_service_mode_overrides.sql
-- ============================================================================

-- FadeUp — SERVICE MODE: temporary overrides, and the change history
--
-- WHAT A TEMPORARY OVERRIDE IS FOR
--
-- The operational exceptions a real shop floor produces every day:
--
--   "Queue only for the next hour, we're swamped."
--   "I'm unavailable for the rest of today."
--   "Reservations only until further notice."
--
-- Two scopes, which is exactly what makes the feature usable by both people who
-- need it:
--
--   location   a manager changes the whole establishment
--   barber     a barber changes only themselves
--
-- EXPIRATION IS A PREDICATE, NOT A JOB
--
-- An override stops applying the instant `expires_at <= now()`. That is decided
-- by the resolver reading the row, and by nothing else. There is deliberately
-- no cron entry, no background worker and no sweep, because correctness must
-- not depend on a process being alive: if the sweeper is down for an hour, a
-- barber who said "unavailable for 30 minutes" must still be taking bookings at
-- minute 31.
--
-- Rows are therefore never deleted on expiry. An expired row is simply inert,
-- and it is worth keeping — "why did we stop taking walk-ins at 3pm last
-- Tuesday" is a question someone eventually asks.
--
-- Everything is timestamptz. A duration chosen in the UI ("30 minutes",
-- "today", "until closing") is resolved to an ABSOLUTE instant by the caller,
-- using the establishment's own timezone, before it ever reaches the database.
-- The backend accepts and returns absolute instants only; it never receives the
-- string "today" and never has to guess whose midnight was meant. The
-- server's own timezone is irrelevant to all of it.
--
-- WHY location_id IS NOT NULL EVEN FOR A BARBER-SCOPED OVERRIDE
--
-- Three jobs, all of which need it present:
--
--   1. Tenant anchor. Every FadeUp business row must reach an organization
--      through an immutable ownership chain. A barber-scoped row hanging off
--      barber_id alone would have to join through staff_profiles to find its
--      establishment, and staff_profiles.location_id is NULLABLE and
--      ON DELETE SET NULL — so the chain could break under an ordinary
--      offboarding.
--   2. The mutex. Every write here locks location_service_settings for THIS
--      location_id. Serialising barber overrides on the establishment they
--      belong to is what makes a manager's location override and a barber's
--      own override order deterministically against each other.
--   3. The resolver reads by (location_id, barber_id) — the pair carried by the
--      row being admitted — so both scopes are answered from one index.
--
-- WHY "AT MOST ONE ACTIVE ROW" IS AN INDEX AND NOT A CONVENTION
--
-- Two active overrides on the same target would make the effective mode
-- genuinely ambiguous, and no precedence rule could rescue it — they sit at the
-- same precedence level. Ordering by created_at would "work" and would hide a
-- data bug behind an arbitrary tiebreak.
--
-- So: a partial unique index per scope over the rows that have not been
-- cleared. Setting an override CLEARS the previous one and inserts a new row,
-- inside the mutex, which makes "last writer wins, exactly one active row" a
-- database guarantee rather than a hope. The cleared rows stay as history.
--
-- The index cannot include the time predicate (now() is not immutable), so a
-- naturally-expired-but-uncleared row still occupies the slot. That is correct
-- and intended: the setter clears it as part of the same transaction, and the
-- resolver ignores it on time regardless. What the index actually guarantees is
-- the thing that matters — never two rows competing to be current.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Scope
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'service_mode_scope') then
    create type public.service_mode_scope as enum ('location', 'barber');
  end if;
end $$;

comment on type public.service_mode_scope is
  'What a service-mode override applies to: an entire establishment, or one barber placement within it. Fixed at two values for V1 — organization-wide overrides are deliberately absent, because a multi-salon organization must never be forced to operate every salon identically.';

-- ---------------------------------------------------------------------------
-- 2. The overrides table
-- ---------------------------------------------------------------------------

create table if not exists public.service_mode_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scope public.service_mode_scope not null,

  -- Always present. See the header: tenant anchor, mutex key, resolver index.
  -- CASCADE because an override is meaningless without its establishment and
  -- holds no history anyone needs once the location itself is gone.
  location_id uuid not null references public.locations (id) on delete cascade,

  -- Set if and only if scope = 'barber'.
  --
  -- CASCADE, and this is the deliberate choice §41 demands: an override is
  -- ephemeral operational state, not evidence. Deleting a barber placement must
  -- not be blocked by a temporary "queue only" row (RESTRICT would make
  -- offboarding fail on a note about last Tuesday), and SET NULL would silently
  -- promote a barber-scoped override into a location-wide one, which is a
  -- privilege escalation by data mutation. R1A/R1B's durable evidence —
  -- appointments, queue entries, Passports, follows, the professional identity
  -- — lives in other tables and is entirely unaffected by this cascade.
  barber_id uuid references public.barbers (id) on delete cascade,

  mode public.service_mode not null,

  starts_at timestamptz not null default now(),
  -- NULL = "until manually changed". A deliberate product state, not a missing
  -- value: it is one of the four durations the Pro UI offers.
  expires_at timestamptz,
  -- Set when superseded or explicitly cleared. Never deleted, so the history
  -- survives; the partial unique indexes below key on this being NULL.
  cleared_at timestamptz,
  cleared_by_user_id uuid references auth.users (id) on delete set null,

  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint service_mode_overrides_barber_matches_scope check (
    (scope = 'barber') = (barber_id is not null)
  ),
  constraint service_mode_overrides_window_ordered check (
    expires_at is null or expires_at > starts_at
  ),
  constraint service_mode_overrides_cleared_pair check (
    (cleared_by_user_id is null) or (cleared_at is not null)
  )
);

comment on table public.service_mode_overrides is
  'Temporary service-mode exceptions, at establishment or barber-placement scope. Expiry is a RESOLVER PREDICATE, never a job: a row stops applying the instant expires_at <= now(), with no cron, worker or browser involved, and rows are never deleted on expiry so the history survives. expires_at NULL means "until manually changed". At most one uncleared row per target is a database guarantee (partial unique indexes below), so the effective mode is never ambiguous.';

comment on column public.service_mode_overrides.location_id is
  'Always present, including for barber-scoped rows: it is the tenant anchor (staff_profiles.location_id is nullable and ON DELETE SET NULL, so it cannot be relied on), the mutex key every write locks, and half of the (location_id, barber_id) pair the resolver reads.';

comment on column public.service_mode_overrides.expires_at is
  'Absolute instant, always timestamptz. UI durations ("30 minutes", "today", "until closing") are resolved to an absolute instant by the caller using the ESTABLISHMENT''S timezone before reaching the database — the backend never receives a vague string and never depends on the server''s timezone. NULL means "until manually changed", which is a product state rather than a missing value.';

comment on column public.service_mode_overrides.cleared_at is
  'Set when this override is superseded by a newer one or explicitly cleared. Rows are never deleted, so this is what distinguishes "current" from "history" — and what the partial unique indexes key on to guarantee at most one active override per target.';

create index if not exists service_mode_overrides_organization_id_idx
  on public.service_mode_overrides (organization_id);

-- The resolver's two lookups. Partial on cleared_at so the indexes stay small
-- as history accumulates — an establishment that changes mode twice a day for a
-- year has ~700 rows and exactly one of them in each index.
create index if not exists service_mode_overrides_location_active_idx
  on public.service_mode_overrides (location_id, starts_at desc)
  where cleared_at is null and scope = 'location';

create index if not exists service_mode_overrides_barber_active_idx
  on public.service_mode_overrides (barber_id, starts_at desc)
  where cleared_at is null and scope = 'barber';

-- At most one ACTIVE override per target. See the header for why this is an
-- index rather than a convention, and why the time predicate is deliberately
-- absent from it.
create unique index if not exists service_mode_overrides_one_active_location
  on public.service_mode_overrides (location_id)
  where cleared_at is null and scope = 'location';

create unique index if not exists service_mode_overrides_one_active_barber
  on public.service_mode_overrides (barber_id)
  where cleared_at is null and scope = 'barber';

drop trigger if exists service_mode_overrides_set_updated_at on public.service_mode_overrides;
create trigger service_mode_overrides_set_updated_at
  before update on public.service_mode_overrides
  for each row execute function public.set_updated_at();

-- Tenant + placement consistency, at trigger level so it binds service_role and
-- direct SQL as well as ordinary clients.
create or replace function public.check_service_mode_override_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
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

drop trigger if exists service_mode_overrides_check_consistency on public.service_mode_overrides;
create trigger service_mode_overrides_check_consistency
  before insert or update on public.service_mode_overrides
  for each row execute function public.check_service_mode_override_consistency();

-- ---------------------------------------------------------------------------
-- 3. The change history
--
-- Service mode decides whether a customer can book. When a shop asks "why did
-- we take no walk-ins on Saturday morning", the answer has to be recoverable,
-- and it cannot be recovered from current-state rows that were overwritten.
--
-- Append-only, and enforced as such by a trigger rather than merely by
-- withholding grants — the same standard R2 applied to commercial_plan_changes,
-- for the same reason: a privileged path that can rewrite history produces an
-- audit trail nobody has grounds to believe.
--
-- Deliberately NOT a generic event-sourcing platform. It records the five kinds
-- of service-mode change this lot can actually make, and nothing else.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'service_mode_change_kind') then
    create type public.service_mode_change_kind as enum (
      'location_default',
      'barber_override',
      'temporary_override_set',
      'temporary_override_cleared',
      'queue_open'
    );
  end if;
end $$;

create table if not exists public.service_mode_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  change_kind public.service_mode_change_kind not null,
  scope public.service_mode_scope not null,
  location_id uuid not null references public.locations (id) on delete cascade,
  -- SET NULL, not CASCADE: unlike an override, a history row is evidence. An
  -- offboarded barber's mode changes still happened, and the record of them
  -- must outlive the placement row exactly as R1A/R1B require of appointment
  -- and queue history.
  barber_id uuid references public.barbers (id) on delete set null,

  previous_mode public.service_mode,
  new_mode public.service_mode,
  previous_queue_open boolean,
  new_queue_open boolean,
  expires_at timestamptz,

  changed_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.service_mode_changes is
  'Append-only history of every service-mode and queue_open change: who, what scope, from what, to what, when, and until when. Append-only is enforced by trigger, not merely by withholding grants — an audit trail a privileged path can rewrite is not one. Deliberately narrow: five change kinds, not a general event bus. NOT backfilled — nobody made the pre-existing choices and inventing an actor for them would be a lie told to whoever reads this later.';

create index if not exists service_mode_changes_location_idx
  on public.service_mode_changes (location_id, created_at desc);
create index if not exists service_mode_changes_organization_idx
  on public.service_mode_changes (organization_id, created_at desc);
create index if not exists service_mode_changes_barber_idx
  on public.service_mode_changes (barber_id, created_at desc) where barber_id is not null;

create or replace function public.reject_service_mode_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'service_mode_changes is append-only: % is not permitted', tg_op
    using errcode = '42501',
          hint = 'Record a new change instead of editing the record of an old one.';
end;
$$;

comment on function public.reject_service_mode_history_mutation() is
  'Makes service_mode_changes append-only for EVERY writer including service_role and postgres. A trigger rather than a grant, because BYPASSRLS roles would otherwise be able to rewrite the audit trail.';

drop trigger if exists service_mode_changes_no_update on public.service_mode_changes;
create trigger service_mode_changes_no_update
  before update or delete on public.service_mode_changes
  for each row execute function public.reject_service_mode_history_mutation();

-- ---------------------------------------------------------------------------
-- 4. RLS and grants
--
-- Both tables: read for org members and platform admins, write for nobody.
--
-- Every mutation goes through a SECURITY DEFINER RPC in 20260826120400 that
-- checks the actor, takes the mutex and writes the history row in the same
-- transaction. An INSERT policy here would let a manager create an override
-- directly and skip all three.
--
-- anon gets nothing at all — not even SELECT. A customer learns the effective
-- mode through public.get_public_service_state, which returns a curated answer
-- for a publicly operable establishment and zero rows otherwise. Raw override
-- rows carry actor ids and internal history that no customer surface needs.
-- ---------------------------------------------------------------------------

alter table public.service_mode_overrides enable row level security;
alter table public.service_mode_overrides force row level security;

drop policy if exists service_mode_overrides_select on public.service_mode_overrides;
create policy service_mode_overrides_select
  on public.service_mode_overrides
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

revoke all on public.service_mode_overrides from anon, authenticated;
grant select on public.service_mode_overrides to authenticated;

alter table public.service_mode_changes enable row level security;
alter table public.service_mode_changes force row level security;

-- Reading the audit trail is an owner/manager act, not something every barber
-- on the floor needs. It names who changed what, and the roster does not need
-- that to cut hair.
drop policy if exists service_mode_changes_select on public.service_mode_changes;
create policy service_mode_changes_select
  on public.service_mode_changes
  for select
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
    or (select private.is_platform_admin())
  );

revoke all on public.service_mode_changes from anon, authenticated;
grant select on public.service_mode_changes to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Realtime
--
-- Creating, replacing or clearing a temporary override must move an open Pro
-- screen and an open customer profile without a manual refresh. Postgres
-- Changes is RLS-aware and the select policy above is what makes it tenant-safe.
--
-- service_mode_changes is deliberately NOT published: it is an audit trail read
-- on demand, and broadcasting it would double every event for no benefit.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'service_mode_overrides'
  ) then
    alter publication supabase_realtime add table public.service_mode_overrides;
  end if;
end $$;


-- ============================================================================
-- END db/migrations/20260826120200_service_mode_overrides.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826120300_effective_service_mode.sql
-- ============================================================================

-- FadeUp — SERVICE MODE: the one resolver
--
-- ONE DOMAIN TRUTH
--
-- There is exactly one implementation of service-mode precedence in FadeUp, and
-- it is private.effective_service_mode. The booking guard, the queue guard, the
-- Pro read RPC and the customer read RPC all call it. None of them reimplements
-- the ordering, and neither does the frontend — the resolver hands back the
-- answer AND its provenance, so a client renders "queue only until 15:30,
-- because you set it" without knowing the rules that produced it.
--
-- Four resolvers that agree today would be four resolvers that disagree after
-- the next change, and the one that disagrees silently would be the enforcement
-- path.
--
-- THE PRECEDENCE
--
--   1. active BARBER temporary override
--   2. active LOCATION temporary override
--   3. BARBER persistent override        (barbers.service_mode_override)
--   4. LOCATION default                  (location_service_settings)
--
-- The specific beats the general, and the temporary beats the standing
-- arrangement, at every level. A barber saying "not me, not right now" is the
-- most specific statement anyone can make about a chair, so it wins outright —
-- including over a manager's location-wide temporary override. That is not an
-- authorization hole: a manager who needs to override a barber can set that
-- barber's override directly (they are permitted to), and doing so is recorded
-- against them by name in service_mode_changes. Silently outranking a barber's
-- own "I'm unavailable" would produce bookings for someone who has said they
-- cannot take them.
--
-- WHY IT RESOLVES ON (location_id, barber_id) AND NOT ON barber_id ALONE
--
-- The pair is what the row being admitted actually carries. Both
-- appointments and queue_entries have a NOT NULL location_id, and a barber_id
-- that is nullable on the queue side ("any available barber" — a genuine
-- walk-in request, not an unset value).
--
-- Resolving from the pair means:
--
--   * a queue entry with no barber naturally answers at location scope only,
--     with no special case anywhere;
--   * enforcement judges the establishment the booking is actually FOR, rather
--     than wherever the barber's staff profile currently points — and
--     staff_profiles.location_id is nullable and ON DELETE SET NULL, so it is
--     not something an invariant should lean on;
--   * a professional working at two establishments (R18) resolves differently
--     at each, with no schema change.
--
-- ACTIVE MEANS ACTIVE NOW, DECIDED HERE
--
--   cleared_at is null
--   and starts_at <= now()
--   and (expires_at is null or expires_at > now())
--
-- STABLE, not IMMUTABLE, because it reads now() and mutable tables. Marking it
-- IMMUTABLE would let the planner fold a mode into a cached plan and serve an
-- expired override forever, which is the exact failure this design exists to
-- rule out.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The two mode predicates
--
-- Deliberately tiny, deliberately central. Every "can this channel take a new
-- customer" question in the codebase resolves through these two functions, so
-- that adding a fifth mode later is a change in one place rather than a search
-- for every `= 'hybrid'` comparison someone wrote inline.
--
-- IMMUTABLE is correct here and only here: these are pure functions of the enum
-- value, reading nothing.
-- ---------------------------------------------------------------------------

create or replace function private.mode_allows_booking(p_mode public.service_mode)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_mode in ('hybrid', 'reservation_only');
$$;

comment on function private.mode_allows_booking(public.service_mode) is
  'Does this service mode admit a NEW reservation? hybrid and reservation_only yes; queue_only and unavailable no. NOT the final answer — booking admission also requires the R2 booking entitlement, a valid operational identity, and the existing availability rules. NULL in, NULL out, and every caller treats NULL as deny.';

create or replace function private.mode_allows_queue(p_mode public.service_mode)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_mode in ('hybrid', 'queue_only');
$$;

comment on function private.mode_allows_queue(public.service_mode) is
  'Does this service mode admit a NEW queue entry? hybrid and queue_only yes; reservation_only and unavailable no. NOT the final answer — queue admission also requires the R2 walk-in/queue entitlement AND queue_open, which this function deliberately says nothing about. Service mode never replaces queue_open.';

revoke all on function private.mode_allows_booking(public.service_mode) from public, anon, authenticated;
revoke all on function private.mode_allows_queue(public.service_mode) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The resolver
--
-- Returns provenance alongside the mode, because a client that has to
-- re-derive "where did this come from" is a client that has reimplemented the
-- precedence — and would eventually disagree with the guard that actually
-- refuses the booking.
--
-- `source` is a stable machine token, never a sentence:
--
--   barber_temporary_override
--   location_temporary_override
--   barber_override
--   location_default
--
-- No authorization of its own. It lives in `private`, is not reachable through
-- PostgREST, has EXECUTE granted to no client role, and every public caller
-- establishes the actor's relationship to the tenant first. Called directly it
-- would answer questions about any location in the database.
-- ---------------------------------------------------------------------------

create or replace function private.effective_service_mode(
  p_location_id uuid,
  p_barber_id uuid default null
)
returns table (
  mode public.service_mode,
  source text,
  starts_at timestamptz,
  expires_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  with candidates as (
    -- 1. the barber's own temporary override
    select 1 as precedence,
           o.mode,
           'barber_temporary_override'::text as source,
           o.starts_at,
           o.expires_at
    from public.service_mode_overrides o
    where p_barber_id is not null
      and o.scope = 'barber'
      and o.barber_id = p_barber_id
      and o.cleared_at is null
      and o.starts_at <= now()
      and (o.expires_at is null or o.expires_at > now())

    union all

    -- 2. the establishment's temporary override
    select 2,
           o.mode,
           'location_temporary_override',
           o.starts_at,
           o.expires_at
    from public.service_mode_overrides o
    where o.scope = 'location'
      and o.location_id = p_location_id
      and o.cleared_at is null
      and o.starts_at <= now()
      and (o.expires_at is null or o.expires_at > now())

    union all

    -- 3. the barber's standing arrangement. NULL is the inherit sentinel and
    --    must not become a candidate, or every inheriting barber would resolve
    --    to a NULL mode instead of falling through to the establishment.
    select 3,
           b.service_mode_override,
           'barber_override',
           null::timestamptz,
           null::timestamptz
    from public.barbers b
    where p_barber_id is not null
      and b.id = p_barber_id
      and b.service_mode_override is not null

    union all

    -- 4. the establishment default — the floor of the precedence, and the
    --    reason every location is guaranteed a settings row.
    select 4,
           s.default_service_mode,
           'location_default',
           null::timestamptz,
           null::timestamptz
    from public.location_service_settings s
    where s.location_id = p_location_id
  )
  select c.mode, c.source, c.starts_at, c.expires_at
  from candidates c
  order by c.precedence
  limit 1;
$$;

comment on function private.effective_service_mode(uuid, uuid) is
  'THE service-mode resolver — the only implementation of precedence in FadeUp. Resolves for the (location_id, barber_id) pair carried by the row being admitted: barber temporary override > location temporary override > barber persistent override > establishment default. Returns the mode AND its provenance (source, starts_at, expires_at) so no caller — including the frontend — has to reimplement the ordering. Expiry is decided here and nowhere else: an override with expires_at <= now() is simply not a candidate, so correctness needs no cron, worker or open browser. Returns zero rows only when the location has no settings row, which callers treat as deny. STABLE, never IMMUTABLE: it reads now(). Performs no authorization; callers must establish the actor first.';

revoke all on function private.effective_service_mode(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The composed admission questions
--
-- These are what enforcement and both read RPCs actually ask, so that the
-- composition rule — entitlement AND mode AND runtime state — is written once
-- instead of being reassembled slightly differently in four places. That kind
-- of drift is how a gate ends up decorative on one path.
--
-- BOOKING requires the R2 `booking` capability.
--
-- QUEUE requires `walkIns` OR `liveQueue`, and the disjunction is deliberate.
-- R2's matrix gives salon_essential `walkIns` WITHOUT `liveQueue`; demanding
-- liveQueue would silently withdraw a walk-in channel that plan pays for, which
-- is a pricing change, and this lot changes no pricing. The question this gate
-- asks is "is this organization entitled to operate a walk-in/queue channel at
-- all" — free has neither key and is refused, every plan that sells one is
-- admitted. Separating the public intake surface from the staff queue console
-- is a packaging question that belongs to R2, not here.
--
-- Neither function takes a lock. Locking belongs to the enforcement path in
-- 20260826120500, which needs it; the read RPCs must not take row locks on
-- behalf of someone merely looking at a page.
-- ---------------------------------------------------------------------------

create or replace function private.booking_admission_allowed(
  p_organization_id uuid,
  p_location_id uuid,
  p_barber_id uuid default null
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    private.org_has_capability(p_organization_id, 'booking')
    and private.mode_allows_booking((select m.mode from private.effective_service_mode(p_location_id, p_barber_id) m)),
    false
  );
$$;

comment on function private.booking_admission_allowed(uuid, uuid, uuid) is
  'Composed answer to "may a NEW reservation be admitted here?": the R2 booking entitlement AND the effective service mode. Fails closed on every unknown — no commercial state, no settings row, NULL argument — via the coalesce. Deliberately does NOT answer whether a slot exists; that stays with get_public_available_slots, and conflating the two would let the UI promise a time the availability engine has not offered.';

create or replace function private.queue_admission_allowed(
  p_organization_id uuid,
  p_location_id uuid,
  p_barber_id uuid default null
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (
      private.org_has_capability(p_organization_id, 'walkIns')
      or private.org_has_capability(p_organization_id, 'liveQueue')
    )
    and private.mode_allows_queue((select m.mode from private.effective_service_mode(p_location_id, p_barber_id) m))
    and (select s.queue_open from public.location_service_settings s where s.location_id = p_location_id),
    false
  );
$$;

comment on function private.queue_admission_allowed(uuid, uuid, uuid) is
  'Composed answer to "may a NEW queue entry be admitted here?": the R2 walk-in/queue entitlement AND the effective service mode AND queue_open. All three are independent facts and all three must hold — service mode never replaces queue_open, and queue_open never overrides the mode. The entitlement is a disjunction of walkIns/liveQueue because R2 sells salon_essential the first without the second; requiring liveQueue would withdraw a paid channel, which would be a pricing change. Fails closed on every unknown.';

revoke all on function private.booking_admission_allowed(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.queue_admission_allowed(uuid, uuid, uuid) from public, anon, authenticated;


-- ============================================================================
-- END db/migrations/20260826120300_effective_service_mode.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826120400_service_mode_controls.sql
-- ============================================================================

-- FadeUp — SERVICE MODE: the controls
--
-- THE ONLY WAY TO CHANGE A SERVICE MODE
--
-- location_service_settings, barbers.service_mode_override and
-- service_mode_overrides all have zero client write privilege. These five RPCs
-- are the entire mutation surface, and each of them does the same four things
-- in the same order, in one transaction:
--
--   1. derive the tenant from the OBJECT, never from an argument
--   2. authorize the actor from auth.uid()
--   3. take the mutex
--   4. write the change AND its history row together
--
-- CALLER-SUPPLIED IDS ARE ARGUMENTS, NOT CREDENTIALS
--
-- Every one of these functions takes a location_id or a barber_id. None of them
-- takes an organization_id, and that is deliberate rather than incidental: an
-- organization_id parameter is an invitation to authorize against the value the
-- caller sent instead of against the object they named. The tenant is looked up
-- FROM the location or the barber, and the actor's membership is then checked
-- against what was found. Passing someone else's location id gets a refusal,
-- never a foothold.
--
-- WHO MAY DO WHAT
--
--   establishment default        owner / manager
--   establishment queue_open     owner / manager / receptionist
--   barber persistent override   owner / manager, or that barber themselves
--   location temporary override  owner / manager
--   barber temporary override    owner / manager, or that barber themselves
--
-- queue_open is wider on purpose. "Stop taking walk-ins, we're at capacity" is
-- a front-of-house judgement made a dozen times a week by whoever is on the
-- desk; making it an owner-only act would mean it never gets used and the queue
-- fills with people who cannot be served. Changing the establishment's DEFAULT
-- MODE is a different kind of decision — it is how the shop presents itself —
-- and stays with owner/manager. private.can_manage_appointments is the existing
-- owner/manager/receptionist predicate and is reused rather than re-spelled.
--
-- A barber may manage THEIR OWN override and nobody else's. private.is_own_barber
-- (R1B) resolves that from auth.uid() through staff_profiles, so a barber cannot
-- reach a colleague by passing their id. A manager may manage any barber in
-- their own organization, and the history row records which of the two it was.
--
-- prospect_worker is granted nothing here and is asserted to hold nothing in
-- 20260826120700. The acquisition worker discovers shops; it has no business
-- deciding whether one is taking walk-ins.
--
-- THE MUTEX, AND WHY IT IS TAKEN BEFORE READING
--
-- Every function takes `SELECT ... FOR UPDATE` on the establishment's
-- location_service_settings row before it reads anything it will act on. That
-- single row serialises the whole feature for that establishment: two managers
-- racing a mode change, a manager racing a barber, two barbers racing their own
-- overrides, and — critically — a mode change racing an admission, because the
-- admission guard in 20260826120500 takes FOR SHARE on the same row.
--
-- Reading before locking would produce exactly the bug this design is for: two
-- transactions both read `hybrid`, both decide, and the loser's decision
-- overwrites the winner's with a value computed from state that no longer
-- exists.
--
-- No function here upgrades a share lock to an exclusive one, and every
-- function locks exactly one row, so there is no lock-ordering cycle and no
-- deadlock to reason about.
--
-- ABSOLUTE INSTANTS ONLY
--
-- set_service_mode_temporary_override takes p_expires_at as a timestamptz. It
-- never takes "today", "30 minutes" or "until closing". Those are UI
-- affordances, resolved against the ESTABLISHMENT'S timezone by the caller
-- before the request is made. A backend that accepted them would have to guess
-- whose midnight was meant, and would guess with the server's timezone.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The shared authority check
--
-- Written once so that five call sites cannot drift into five slightly
-- different ideas of who is allowed to do this. Returns the organization it
-- resolved, so the caller uses the tenant this function actually authorized
-- against rather than looking it up a second time and hoping it matches.
-- ---------------------------------------------------------------------------

create or replace function private.assert_service_mode_authority(
  p_location_id uuid,
  p_barber_id uuid default null,
  p_allow_receptionist boolean default false
)
returns uuid
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_barber_location uuid;
begin
  -- The tenant comes from the OBJECT. Nothing the caller sent is trusted to
  -- describe who owns what.
  select l.organization_id into v_organization_id
  from public.locations l
  where l.id = p_location_id;

  if not found then
    -- Same refusal as a permission failure, and deliberately so: a distinct
    -- "no such location" would let anyone probe which location ids exist across
    -- every tenant in the database.
    raise exception 'not authorized to manage service mode for this establishment'
      using errcode = '42501';
  end if;

  if p_barber_id is not null then
    -- The barber must belong to the same tenant AND be placed at this
    -- establishment. Checking the tenant alone would let a manager of a
    -- multi-salon organization aim an override at a barber in another salon,
    -- where the resolver would never apply it.
    select sp.location_id into v_barber_location
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_barber_id and b.organization_id = v_organization_id;

    if not found or v_barber_location is distinct from p_location_id then
      raise exception 'not authorized to manage service mode for this professional'
        using errcode = '42501';
    end if;
  end if;

  -- Manager path: owner/manager always; receptionist only where the operation
  -- is a front-of-house one (queue_open).
  if (select private.has_org_role(
        v_organization_id,
        array['owner', 'manager']::public.membership_role[])) then
    return v_organization_id;
  end if;

  if p_allow_receptionist
     and (select private.can_manage_appointments(v_organization_id)) then
    return v_organization_id;
  end if;

  -- Self path: a barber managing their own placement. Resolved from auth.uid()
  -- through staff_profiles by private.is_own_barber (R1B) — the caller's
  -- p_barber_id is the thing being checked, never the thing doing the checking.
  if p_barber_id is not null and (select private.is_own_barber(p_barber_id)) then
    return v_organization_id;
  end if;

  raise exception 'not authorized to manage service mode here'
    using errcode = '42501';
end;
$$;

comment on function private.assert_service_mode_authority(uuid, uuid, boolean) is
  'The single authority check behind every service-mode control. Derives the tenant FROM the location (never from a caller-supplied organization_id), verifies the barber is in that tenant and placed at that establishment, then admits owner/manager, optionally receptionist for front-of-house operations, or the barber themselves via private.is_own_barber. Returns the organization it authorized against so callers do not re-derive it. Raises 42501 for an unknown location rather than a distinct error, so it cannot be used to enumerate location ids across tenants.';

revoke all on function private.assert_service_mode_authority(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The establishment default
-- ---------------------------------------------------------------------------

create or replace function public.set_location_service_mode(
  p_location_id uuid,
  p_mode public.service_mode
)
returns public.location_service_settings
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.set_location_service_mode(uuid, public.service_mode) is
  'Sets the ESTABLISHMENT default service mode. owner/manager only. Per location, never per organization — a multi-salon group changes one salon at a time. Takes the establishment mutex before reading, so it orders deterministically against concurrent admissions and other mode changes. Governs NEW admissions only: existing appointments and queue entries are never touched, cancelled or altered by this call. Writes the audit row in the same transaction, including when the value is unchanged.';

revoke execute on function public.set_location_service_mode(uuid, public.service_mode) from public, anon;
grant execute on function public.set_location_service_mode(uuid, public.service_mode) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. queue_open — the runtime state, kept separate on purpose
--
-- This function changes queue_open and NOTHING else. It does not read, infer or
-- adjust the service mode, and set_location_service_mode does not read, infer
-- or adjust queue_open. A shop that pauses walk-ins for lunch and then switches
-- to reservation_only for the afternoon must find its queue still paused when
-- it switches back — not silently reopened because the mode moved.
-- ---------------------------------------------------------------------------

create or replace function public.set_location_queue_open(
  p_location_id uuid,
  p_queue_open boolean
)
returns public.location_service_settings
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.set_location_queue_open(uuid, boolean) is
  'Opens or closes the live queue for NEW entries at one establishment. owner/manager/receptionist — closing the line is a front-of-house judgement made several times a week, and restricting it to owners would mean it never gets used. Changes queue_open and NOTHING else: it never reads or adjusts the service mode, exactly as a mode change never reads or adjusts this. Closing the queue does NOT cancel, remove or alter anyone already waiting — it only stops new arrivals joining.';

revoke execute on function public.set_location_queue_open(uuid, boolean) from public, anon;
grant execute on function public.set_location_queue_open(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The barber's persistent override
--
-- p_mode NULL is the documented way to go back to inheriting, not a missing
-- argument. There is no separate "clear" function, because clearing is exactly
-- "set it to inherit" and two functions would be two chances to forget the
-- audit row.
-- ---------------------------------------------------------------------------

create or replace function public.set_barber_service_mode_override(
  p_barber_id uuid,
  p_mode public.service_mode default null
)
returns public.barbers
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.set_barber_service_mode_override(uuid, public.service_mode) is
  'Sets a barber placement''s PERSISTENT service mode. owner/manager of that organization, or that barber themselves (resolved from auth.uid(), never from the supplied id). p_mode NULL is the documented way to return to inheriting the establishment default — there is no separate clear function, because clearing IS setting it to inherit. Takes the establishment mutex, so it orders against location mode changes and concurrent admissions. Existing appointments and queue entries are never affected.';

revoke execute on function public.set_barber_service_mode_override(uuid, public.service_mode) from public, anon;
grant execute on function public.set_barber_service_mode_override(uuid, public.service_mode) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Temporary overrides
--
-- Set is "clear the current one, insert the new one", both inside the mutex.
-- That is what makes the partial unique index in 20260826120200 hold under
-- concurrency instead of producing a unique violation that a user would see as
-- a mysterious failure: the second writer waits, then clears what the first
-- wrote, then inserts. Last writer wins, exactly one active row, deterministic.
-- ---------------------------------------------------------------------------

create or replace function public.set_service_mode_temporary_override(
  p_scope public.service_mode_scope,
  p_location_id uuid,
  p_mode public.service_mode,
  p_expires_at timestamptz default null,
  p_barber_id uuid default null
)
returns public.service_mode_overrides
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.set_service_mode_temporary_override(public.service_mode_scope, uuid, public.service_mode, timestamptz, uuid) is
  'Creates a temporary service-mode override at establishment or barber scope, superseding any override currently active on that exact target. owner/manager for either scope; a barber may also set their own. p_expires_at is an ABSOLUTE instant or NULL for "until manually changed" — the UI resolves "30 minutes"/"today"/"until closing" against the establishment''s timezone before calling, and this function never receives a duration or a vague string. Supersede-then-insert happens inside the establishment mutex, which is what makes "exactly one active override" hold under concurrency instead of surfacing as a unique violation.';

revoke execute on function public.set_service_mode_temporary_override(public.service_mode_scope, uuid, public.service_mode, timestamptz, uuid) from public, anon;
grant execute on function public.set_service_mode_temporary_override(public.service_mode_scope, uuid, public.service_mode, timestamptz, uuid) to authenticated;

create or replace function public.clear_service_mode_temporary_override(
  p_scope public.service_mode_scope,
  p_location_id uuid,
  p_barber_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.clear_service_mode_temporary_override(public.service_mode_scope, uuid, uuid) is
  'Clears the active temporary override on one target, returning the effective mode to the next precedence level (barber persistent override, then establishment default). Returns the number of rows cleared; zero is a legitimate outcome — the override may have expired naturally — and is not an error, because a Pro tapping "back to normal" on a stale screen should get the state they asked for. Rows are marked cleared, never deleted, so the history survives.';

revoke execute on function public.clear_service_mode_temporary_override(public.service_mode_scope, uuid, uuid) from public, anon;
grant execute on function public.clear_service_mode_temporary_override(public.service_mode_scope, uuid, uuid) to authenticated;


-- ============================================================================
-- END db/migrations/20260826120400_service_mode_controls.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826120500_service_mode_enforcement.sql
-- ============================================================================

-- FadeUp — SERVICE MODE: enforcement, where a browser cannot reach
--
-- WHAT WAS ACTUALLY POSSIBLE BEFORE THIS FILE
--
-- Two things, both proven by reading the schema rather than assumed.
--
-- 1. SERVICE MODE HAD NO ENFORCEMENT AT ALL, because it did not exist. Hiding
--    the Book button would have been the entire mechanism.
--
-- 2. THE R2 ENTITLEMENT GATE WAS NEVER HUNG ON A DOOR. R2 built
--    private.org_has_capability and private.assert_org_capability and wired
--    them into capacity triggers and the plan-assignment RPC — but NOT into
--    booking or queue admission. Searching the whole of db/migrations for a
--    caller finds only R2's own assertion lists. So the commercial rule
--    "Free is presence, not an operating system" was, on these two paths,
--    enforced by nothing.
--
--    That is not currently exploitable in production data — the R2 backfill
--    (20260826110200) only assigns `free` to an organization with zero active
--    locations AND zero active professionals, and both admission paths require
--    a valid active location, so no operating shop is on `free` today. But
--    nothing prevented one from being put there, and §16 is explicit that a
--    known entitlement bypass gets wired up in this lot. It is wired here,
--    using R2's existing helper, with no new commercial logic of any kind.
--
-- WHY A TRIGGER, AND WHY BEFORE INSERT
--
-- There are four ways to create an appointment and three to create a queue
-- entry, found by searching every migration rather than by trusting the
-- application:
--
--   book_public_appointment      SECURITY DEFINER, granted to anon
--   join_public_queue            SECURITY DEFINER, granted to anon
--   direct PostgREST INSERT      authenticated, column grant + RLS org role
--   service_role / postgres      BYPASSRLS
--
-- A check inside the two RPCs would cover two of them. An RLS `with check`
-- would cover three and evaporate for exactly the privileged writers §34 says
-- must not be exempt. A BEFORE INSERT trigger fires for every one, including
-- psql, and that is what "the database enforces it" has to mean.
--
-- Centralised, not duplicated: both triggers call the same
-- private.*_admission_allowed composers from 20260826120300, so the booking
-- path and the queue path cannot drift into subtly different ideas of what is
-- allowed. Duplicating the checks is how one path ends up decorative.
--
-- INSERT ONLY. THIS IS THE WHOLE POINT.
--
-- The trigger fires on INSERT and on nothing else. Service mode governs NEW
-- ADMISSIONS; it says nothing whatever about commitments that already exist.
-- Concretely, all of the following keep working in every mode, including
-- `unavailable`:
--
--   * checking in, starting, completing, cancelling or no-showing an existing
--     appointment — the whole R1A lifecycle
--   * calling, serving and completing everyone already in the queue
--   * reschedule_appointment, which UPDATEs the existing row rather than
--     inserting a replacement (verified: 20260819210000 preserves the row and
--     its status), so it never reaches this trigger and needs no exemption —
--     and therefore no caller-controlled skip flag has to exist
--
-- A shop that switches to reservation_only with three people waiting still has
-- three people waiting, and still serves them. It simply admits no fourth.
--
-- NO BYPASS
--
-- There is no GUC, no session variable, no parameter and no role exemption.
-- A restore that must reinstate rows an establishment's current mode would
-- refuse is `pg_restore --disable-triggers`: explicit, loud, and auditable —
-- which a magic setting some future RPC learns to set would not be.
--
-- THE LOCK, AND WHY IT IS SHARED
--
-- The guard takes FOR SHARE on the establishment's location_service_settings
-- row. The controls in 20260826120400 take FOR UPDATE on the same row.
--
--   * Many admissions proceed concurrently — they only conflict with a writer,
--     not with each other. An exclusive lock here would serialise every walk-in
--     at a busy shop behind every other one, for no correctness gain.
--   * A mode change waits for in-flight admissions, then blocks new ones until
--     it commits.
--   * An admission that arrives mid-change waits, and — this is the part that
--     matters — under READ COMMITTED a blocked row lock re-reads the row as of
--     the moment it is granted. So the loser sees the NEW mode, never the stale
--     one it queued behind. There is no window in which a mode change commits
--     and an admission computed against the old mode commits after it.
--   * No transaction here upgrades a share lock to exclusive, so the two lock
--     modes cannot form a deadlock cycle.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Booking admission
-- ---------------------------------------------------------------------------

create or replace function public.enforce_booking_service_mode()
returns trigger
language plpgsql
-- SECURITY DEFINER: the composers read organization_commercial_state, on which
-- every client role has had its privileges revoked and which has FORCE RLS. The
-- definer (postgres) can read it; the anonymous customer booking a haircut
-- cannot, and must not need to. search_path is pinned and every name is
-- schema-qualified, so a caller cannot substitute their own tables.
security definer
set search_path = ''
as $$
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

comment on function public.enforce_booking_service_mode() is
  'BEFORE INSERT on appointments: the ONE place a new reservation is admitted or refused. Fires for every writer — the anon RPC, a direct PostgREST insert by staff, service_role and postgres alike — because RLS would exempt the privileged ones. Composes the R2 booking entitlement with the effective service mode; adds no commercial logic of its own. INSERT only, deliberately: every existing appointment keeps its full R1A lifecycle in every mode, and reschedule_appointment UPDATEs rather than inserting, so it neither reaches this trigger nor needs a bypass flag.';

drop trigger if exists appointments_enforce_service_mode on public.appointments;
create trigger appointments_enforce_service_mode
  before insert on public.appointments
  for each row execute function public.enforce_booking_service_mode();

-- ---------------------------------------------------------------------------
-- 2. Queue admission
--
-- Three independent facts, all of which must hold, and each of which is
-- reported distinctly when it is the one that failed. A shop told "walk-ins are
-- closed" when the real reason is that the queue is paused for ten minutes will
-- go looking in the wrong settings screen.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_queue_service_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.enforce_queue_service_mode() is
  'BEFORE INSERT on queue_entries: the ONE place a new walk-in is admitted or refused. Fires for every writer including service_role and postgres. Requires all three independent facts — the R2 walk-in/queue entitlement, a mode that allows the queue, and queue_open — and reports distinctly which one failed, because each has a different control and a different fix. INSERT only: everyone already waiting keeps their full R1A lifecycle in every mode, and closing the queue never removes them.';

drop trigger if exists queue_entries_enforce_service_mode on public.queue_entries;
create trigger queue_entries_enforce_service_mode
  before insert on public.queue_entries
  for each row execute function public.enforce_queue_service_mode();

-- ---------------------------------------------------------------------------
-- 3. Trigger firing order, stated rather than left to luck
--
-- PostgreSQL fires BEFORE ROW triggers in alphabetical order by trigger name.
-- The relevant existing neighbours are:
--
--   appointments:  appointments_check_consistency, appointments_check_time_blocks,
--                  appointments_enforce_service_mode, appointments_set_blocked_range
--   queue_entries: queue_entries_check_consistency,
--                  queue_entries_enforce_service_mode
--
-- Both new triggers therefore run AFTER the tenant-consistency check, which is
-- the order we want: consistency establishes that location_id and barber_id
-- genuinely belong to organization_id, and only then does this file resolve a
-- mode from them. Resolving first would mean answering a question about a pair
-- of ids that had not yet been proven to belong together.
--
-- This is an assertion rather than a comment, so that renaming a trigger cannot
-- quietly reverse the order.
-- ---------------------------------------------------------------------------

do $$
begin
  if 'appointments_enforce_service_mode' <= 'appointments_check_consistency' then
    raise exception 'service-mode trigger would fire before the tenant-consistency check on appointments'
      using errcode = 'P0001';
  end if;
  if 'queue_entries_enforce_service_mode' <= 'queue_entries_check_consistency' then
    raise exception 'service-mode trigger would fire before the tenant-consistency check on queue_entries'
      using errcode = 'P0001';
  end if;
end $$;


-- ============================================================================
-- END db/migrations/20260826120500_service_mode_enforcement.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826120600_service_mode_contracts.sql
-- ============================================================================

-- FadeUp — SERVICE MODE: the read contracts
--
-- TWO AUDIENCES, TWO SHAPES, ONE TRUTH
--
-- Both functions here answer from private.effective_service_mode and the
-- private.*_admission_allowed composers. Neither reimplements precedence, and
-- neither is allowed to: a customer-facing contract that computed the mode
-- slightly differently from the trigger that refuses the booking would show a
-- Book button that fails on tap, which is worse than showing nothing.
--
--   get_public_service_state   anon + authenticated. What a customer, or the
--                              future mobile app, is allowed to know.
--   get_service_mode_state     authenticated org members. What a Pro needs to
--                              operate the establishment.
--
-- WHY THE PUBLIC ONE TAKES A SLUG
--
-- Every existing public read in FadeUp resolves the organization from
-- p_organization_slug and then re-validates every id it was handed against it
-- (get_public_organization, list_public_barbers, get_public_queue_status). This
-- follows that pattern exactly, and for the same reason: a function that
-- accepted a bare location_id would answer questions about any location id
-- anyone cared to guess. With the slug, an id from a different tenant simply
-- fails to match and the function returns nothing.
--
-- ZERO ROWS IS THE REFUSAL, AND IT IS DELIBERATELY INDISTINGUISHABLE
--
-- Unknown slug, wrong tenant, inactive location, non-public barber, barber not
-- placed here — all return zero rows, identically. No error message
-- distinguishes them, because a distinguishable one is an oracle: it would let
-- an anonymous caller enumerate which location ids exist, which barbers are
-- inactive, and which shops have shut down.
--
-- UNCLAIMED AND EXTERNAL PROFESSIONALS GET NOTHING, BY CONSTRUCTION
--
-- This matters more than it looks. R1B/R10 create public.professionals rows for
-- professionals the acquisition worker DISCOVERED — real people who have never
-- heard of FadeUp. They have a public identity and no operational reality.
--
-- This function is reachable only through a public.barbers row: an actual
-- roster placement, in an actual organization, at an actual active location,
-- with a public and active staff profile. A discovered-but-unclaimed
-- professional has no such row, so there is no query shape that makes this
-- function invent availability, a service mode, a queue state or a booking
-- promise on their behalf. The safety is structural rather than a filter
-- someone could later forget to apply.
--
-- WHAT booking_accepting_new_entries DOES AND DOES NOT MEAN
--
-- It means: a new booking would not be refused by entitlement or by service
-- mode. It does NOT mean a slot exists. Slot computation is
-- get_public_available_slots, it is expensive, it depends on a date and a
-- service, and it stays exactly where it is. Conflating the two here would let
-- the UI promise a time the availability engine has never offered — which is a
-- worse customer experience than the honest "this shop takes reservations, now
-- go and pick one".
--
-- The queue side has no such caveat: queue_accepting_new_entries genuinely is
-- the final answer, because joining a queue needs no slot.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The customer contract
-- ---------------------------------------------------------------------------

create or replace function public.get_public_service_state(
  p_organization_slug text,
  p_location_id uuid,
  p_barber_id uuid default null
)
returns table (
  location_id uuid,
  barber_id uuid,
  effective_service_mode public.service_mode,
  mode_source text,
  mode_expires_at timestamptz,
  mode_allows_booking boolean,
  mode_allows_queue boolean,
  queue_open boolean,
  queue_accepting_new_entries boolean,
  booking_accepting_new_entries boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
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

  perform private.ensure_location_service_settings(p_location_id);

  select m.mode, m.source, m.expires_at
    into v_mode, v_source, v_expires_at
  from private.effective_service_mode(p_location_id, p_barber_id) m;

  select s.queue_open into v_queue_open
  from public.location_service_settings s
  where s.location_id = p_location_id;

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

comment on function public.get_public_service_state(text, uuid, uuid) is
  'The customer-facing service-state contract, and the one the future mobile Customer app consumes. Anon-callable. Re-derives the organization from the slug and re-validates the location and barber against it, exactly as every other public read does; returns ZERO ROWS — indistinguishably — for an unknown slug, a foreign tenant, an inactive location or a non-public barber, so it is not an existence oracle. Unreachable for unclaimed/external professionals by construction: it requires a real barbers placement, which a discovered-but-unclaimed professional does not have, so no fabricated availability or queue state can ever be produced for one. booking_accepting_new_entries means "not refused by entitlement or mode" and is NOT slot availability — that remains get_public_available_slots. queue_accepting_new_entries IS final, because joining a queue needs no slot. Exposes no actor ids, no override history and no internal authorization state.';

revoke execute on function public.get_public_service_state(text, uuid, uuid) from public;
grant execute on function public.get_public_service_state(text, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The Pro contract
--
-- One call returns everything the operational surface needs: the
-- establishment's default and queue state, the active location override, and
-- every barber's effective mode with its provenance. One row per barber plus a
-- location-scope row, rather than N+1 calls from a screen that lists a roster.
--
-- Returns nothing — rather than raising — for a caller who is not a member, so
-- it is safe to call from a shared layout that renders before the caller's
-- workspace is known. That is the same choice get_booking_requests made, for
-- the same reason.
-- ---------------------------------------------------------------------------

create or replace function public.get_service_mode_state(p_location_id uuid)
returns table (
  scope public.service_mode_scope,
  barber_id uuid,
  barber_display_name text,
  location_default_service_mode public.service_mode,
  barber_service_mode_override public.service_mode,
  effective_service_mode public.service_mode,
  mode_source text,
  mode_starts_at timestamptz,
  mode_expires_at timestamptz,
  queue_open boolean,
  mode_allows_booking boolean,
  mode_allows_queue boolean,
  booking_accepting_new_entries boolean,
  queue_accepting_new_entries boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
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

  perform private.ensure_location_service_settings(p_location_id);

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
  from public.location_service_settings s
  cross join lateral private.effective_service_mode(p_location_id, null) m
  where s.location_id = p_location_id;

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
  join public.location_service_settings s on s.location_id = p_location_id
  cross join lateral private.effective_service_mode(p_location_id, b.id) m
  where b.organization_id = v_organization_id
    and sp.location_id = p_location_id
  order by 3;
end;
$$;

comment on function public.get_service_mode_state(uuid) is
  'The Pro operating view of one establishment: the location default and queue_open, plus every barber placed there with their persistent override, effective mode and provenance — one call rather than N+1 from a roster screen. Any org member may read it (a barber needs to know the shop is reservation_only this afternoon); CHANGING it is a separate question answered by private.assert_service_mode_authority. Returns nothing rather than raising for a non-member, so it is safe to call from a shared layout that renders before the workspace is resolved.';

revoke execute on function public.get_service_mode_state(uuid) from public, anon;
grant execute on function public.get_service_mode_state(uuid) to authenticated;


-- ============================================================================
-- END db/migrations/20260826120600_service_mode_contracts.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826120700_service_mode_privilege_hardening.sql
-- ============================================================================

-- FadeUp — SERVICE MODE: privilege hardening
--
-- WHY A SEPARATE FILE THAT MOSTLY ASSERTS
--
-- Every preceding file in this lot revokes and grants as it goes. This one
-- exists because "we were careful in six files" is not a property anyone can
-- check, and because the two failure modes that matter most are both SILENT:
--
--   * PUBLIC holds EXECUTE on a new function by default. A trigger function is
--     an ordinary function that happens to be wired to a trigger, so
--     enforce_booking_service_mode is directly callable by anyone unless it is
--     revoked — and it is SECURITY DEFINER.
--   * A future migration that adds a column, or re-grants a table, can undo a
--     protection established here without anything failing.
--
-- So this file revokes what must be revoked, and then ASSERTS the whole
-- posture. An assertion that fails aborts the replay loudly, which is the only
-- way a privilege regression gets noticed before production. It is the same
-- shape as 20260826101000 (R1B) and 20260826110700 (R2).
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. PUBLIC holds EXECUTE on every new function by default. Take it back.
--
-- The trigger functions matter most: they are SECURITY DEFINER, they are owned
-- by postgres, and a direct call with a hand-built record would run definer
-- code with attacker-chosen arguments. They are only ever meant to be reached
-- by the trigger machinery.
-- ---------------------------------------------------------------------------

revoke all on function public.enforce_booking_service_mode() from public, anon, authenticated;
revoke all on function public.enforce_queue_service_mode() from public, anon, authenticated;
revoke all on function public.handle_new_location_service_settings() from public, anon, authenticated;
revoke all on function public.check_location_service_settings_consistency() from public, anon, authenticated;
revoke all on function public.check_service_mode_override_consistency() from public, anon, authenticated;
revoke all on function public.reject_service_mode_history_mutation() from public, anon, authenticated;

-- The five control RPCs and the two read RPCs already revoked PUBLIC in their
-- own files and granted the roles they need. Re-stated here so that this file
-- is a complete statement of the lot's execute posture rather than half of one.
revoke execute on function public.set_location_service_mode(uuid, public.service_mode) from public;
revoke execute on function public.set_location_queue_open(uuid, boolean) from public;
revoke execute on function public.set_barber_service_mode_override(uuid, public.service_mode) from public;
revoke execute on function public.set_service_mode_temporary_override(public.service_mode_scope, uuid, public.service_mode, timestamptz, uuid) from public;
revoke execute on function public.clear_service_mode_temporary_override(public.service_mode_scope, uuid, uuid) from public;
revoke execute on function public.get_public_service_state(text, uuid, uuid) from public;
revoke execute on function public.get_service_mode_state(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. prospect_worker, explicitly
--
-- The acquisition worker discovers barbershops. It has no business deciding
-- whether one is taking walk-ins, and R1B/R2 both took the trouble to keep its
-- privileges from creeping. The role only exists in the live stack, so the
-- revoke is guarded — but the ASSERTION below runs either way, so a future
-- grant to it cannot slip through unnoticed in an environment where it does
-- exist.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    execute 'revoke all on public.location_service_settings from prospect_worker';
    execute 'revoke all on public.service_mode_overrides from prospect_worker';
    execute 'revoke all on public.service_mode_changes from prospect_worker';
    execute 'revoke all on function public.set_location_service_mode(uuid, public.service_mode) from prospect_worker';
    execute 'revoke all on function public.set_location_queue_open(uuid, boolean) from prospect_worker';
    execute 'revoke all on function public.set_barber_service_mode_override(uuid, public.service_mode) from prospect_worker';
    execute 'revoke all on function public.set_service_mode_temporary_override(public.service_mode_scope, uuid, public.service_mode, timestamptz, uuid) from prospect_worker';
    execute 'revoke all on function public.clear_service_mode_temporary_override(public.service_mode_scope, uuid, uuid) from prospect_worker';
    execute 'revoke all on function public.get_service_mode_state(uuid) from prospect_worker';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3a. Every new table has RLS enabled AND forced.
--
-- ENABLE alone is not enough: without FORCE, the table OWNER bypasses every
-- policy, and in this stack the owner is postgres — which is what a definer
-- function runs as.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'location_service_settings', 'service_mode_overrides', 'service_mode_changes'
      )
      and not (c.relrowsecurity and c.relforcerowsecurity)
  loop
    v_bad := v_bad || ' ' || r.relname;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode RLS check failed — not enabled+forced on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3b. Every function this lot added pins search_path.
--
-- Deliberately NOT filtered to SECURITY DEFINER. An unqualified name resolves
-- through the CALLER's search_path either way, which is a privilege-escalation
-- primitive: a caller creates their own `service_mode_overrides` in a schema
-- they control and the resolver reads the mode from there instead. Being a
-- definer makes it worse, not different.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'ensure_location_service_settings', 'handle_new_location_service_settings',
        'check_location_service_settings_consistency',
        'check_service_mode_override_consistency', 'reject_service_mode_history_mutation',
        'mode_allows_booking', 'mode_allows_queue', 'effective_service_mode',
        'booking_admission_allowed', 'queue_admission_allowed',
        'assert_service_mode_authority',
        'set_location_service_mode', 'set_location_queue_open',
        'set_barber_service_mode_override',
        'set_service_mode_temporary_override', 'clear_service_mode_temporary_override',
        'enforce_booking_service_mode', 'enforce_queue_service_mode',
        'get_public_service_state', 'get_service_mode_state'
      )
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode search_path check failed — not pinned on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3c. anon may execute exactly ONE thing this lot added.
--
-- get_public_service_state is the customer contract and is anon-callable by
-- design. Everything else — every control, the Pro read, every trigger
-- function, every private helper — must be unreachable without a session.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'ensure_location_service_settings', 'handle_new_location_service_settings',
        'check_location_service_settings_consistency',
        'check_service_mode_override_consistency', 'reject_service_mode_history_mutation',
        'mode_allows_booking', 'mode_allows_queue', 'effective_service_mode',
        'booking_admission_allowed', 'queue_admission_allowed',
        'assert_service_mode_authority',
        'set_location_service_mode', 'set_location_queue_open',
        'set_barber_service_mode_override',
        'set_service_mode_temporary_override', 'clear_service_mode_temporary_override',
        'enforce_booking_service_mode', 'enforce_queue_service_mode',
        'get_service_mode_state'
      )
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode EXECUTE check failed — anon can execute:%', v_bad
      using errcode = 'P0001';
  end if;

  -- The converse, asserted too: the one anon-callable function must actually be
  -- callable, or the customer surface silently loses its CTA.
  if not has_function_privilege('anon', 'public.get_public_service_state(text, uuid, uuid)', 'execute') then
    raise exception 'service mode EXECUTE check failed — anon cannot call get_public_service_state'
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3d. The `private` helpers are not an API.
--
-- authenticated must reach the service-mode model only through the public RPCs,
-- which check membership. A directly callable private.effective_service_mode
-- would answer "what mode is this location in?" for every location in the
-- database, and private.assert_service_mode_authority would be an oracle for
-- which locations a user can manage.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'ensure_location_service_settings', 'mode_allows_booking', 'mode_allows_queue',
        'effective_service_mode', 'booking_admission_allowed', 'queue_admission_allowed',
        'assert_service_mode_authority'
      )
      and (has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('anon', p.oid, 'execute'))
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode EXECUTE check failed — a client role can call a private helper directly:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3e. No client role may WRITE any service-mode state directly.
--
-- This is the assertion that keeps the whole design honest. If any of these
-- became true, a manager could change a mode without an audit row, without the
-- mutex, and — for the barber override — without the rule that a barber owns
-- their own placement.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select t.tbl, g.grantee, p.priv
    from unnest(array[
      'public.location_service_settings',
      'public.service_mode_overrides',
      'public.service_mode_changes'
    ]) as t(tbl)
    cross join unnest(array['anon', 'authenticated']) as g(grantee)
    cross join unnest(array['insert', 'update', 'delete']) as p(priv)
    where has_table_privilege(g.grantee, t.tbl, p.priv)
  loop
    v_bad := v_bad || format(' %s:%s:%s', r.tbl, r.grantee, r.priv);
  end loop;

  -- The barber override column, checked the same way. barbers itself is
  -- legitimately writable — this is specifically about the one new column.
  if has_column_privilege('authenticated', 'public.barbers', 'service_mode_override', 'update')
     or has_column_privilege('authenticated', 'public.barbers', 'service_mode_override', 'insert')
     or has_column_privilege('anon', 'public.barbers', 'service_mode_override', 'update')
     or has_column_privilege('anon', 'public.barbers', 'service_mode_override', 'insert') then
    v_bad := v_bad || ' public.barbers.service_mode_override:client-writable';
  end if;

  if v_bad <> '' then
    raise exception 'service mode write check failed — a client role can write service-mode state directly:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3f. anon may not READ the internal tables either.
--
-- A customer learns the effective mode through get_public_service_state, which
-- curates the answer and returns nothing for an establishment they have no
-- business seeing. Raw rows carry actor ids, override history and — on
-- location_service_settings — an existence oracle for every location id.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  for r in
    select t.tbl
    from unnest(array[
      'public.location_service_settings',
      'public.service_mode_overrides',
      'public.service_mode_changes'
    ]) as t(tbl)
    where has_table_privilege('anon', t.tbl, 'select')
  loop
    v_bad := v_bad || ' ' || r.tbl;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode read check failed — anon can select:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3g. prospect_worker gained nothing.
--
-- Asserted separately from the revoke above. Worker V2 requires no
-- service-mode privilege to do its job, and R1B/R2 both took the trouble to
-- keep its privileges from creeping.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  if not exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    return;
  end if;

  for r in
    select t.tbl, p.priv
    from unnest(array[
      'public.location_service_settings',
      'public.service_mode_overrides',
      'public.service_mode_changes'
    ]) as t(tbl)
    cross join unnest(array['select', 'insert', 'update', 'delete']) as p(priv)
    where has_table_privilege('prospect_worker', t.tbl, p.priv)
  loop
    v_bad := v_bad || format(' %s:%s', r.tbl, r.priv);
  end loop;

  for r in
    select p.proname as tbl, ''::text as priv
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'set_location_service_mode', 'set_location_queue_open',
        'set_barber_service_mode_override', 'set_service_mode_temporary_override',
        'clear_service_mode_temporary_override', 'get_service_mode_state',
        'effective_service_mode', 'assert_service_mode_authority'
      )
      and has_function_privilege('prospect_worker', p.oid, 'execute')
  loop
    v_bad := v_bad || ' fn:' || r.tbl;
  end loop;

  if v_bad <> '' then
    raise exception 'service mode privilege check failed — prospect_worker holds:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3h. The enforcement triggers actually exist and are BEFORE INSERT.
--
-- The single most valuable assertion in this file. Every other check in this
-- lot is about someone reaching state they should not; this one is about the
-- guard silently not being there at all — which is what a `drop trigger` in a
-- future migration, or a table rebuild, would produce. A service mode nothing
-- enforces is a UI preference.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text := '';
begin
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.appointments'::regclass
      and t.tgname = 'appointments_enforce_service_mode'
      and not t.tgisinternal
      -- tgtype bit 1 (value 2) = BEFORE, bit 2 (value 4) = INSERT
      and (t.tgtype & 2) <> 0
      and (t.tgtype & 4) <> 0
  ) then
    v_bad := v_bad || ' appointments';
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.queue_entries'::regclass
      and t.tgname = 'queue_entries_enforce_service_mode'
      and not t.tgisinternal
      and (t.tgtype & 2) <> 0
      and (t.tgtype & 4) <> 0
  ) then
    v_bad := v_bad || ' queue_entries';
  end if;

  if v_bad <> '' then
    raise exception 'service mode enforcement check failed — BEFORE INSERT guard missing on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3i. The R2 entitlement gate is genuinely wired into admission.
--
-- §16's whole point. R2 built org_has_capability and no admission path called
-- it; this lot's claim to have fixed that is checked here by reading the
-- function bodies, so that a future edit which quietly drops the capability
-- check fails the replay rather than reopening the bypass in silence.
-- ---------------------------------------------------------------------------

do $$
declare
  v_booking text;
  v_queue text;
begin
  select p.prosrc into v_booking
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'enforce_booking_service_mode';

  select p.prosrc into v_queue
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'enforce_queue_service_mode';

  if v_booking is null or v_booking not like '%org_capability%' then
    raise exception 'service mode entitlement check failed — booking admission does not consult the R2 capability helper'
      using errcode = 'P0001';
  end if;

  if v_queue is null or v_queue not like '%org_has_capability%' then
    raise exception 'service mode entitlement check failed — queue admission does not consult the R2 capability helper'
      using errcode = 'P0001';
  end if;
end $$;


-- ============================================================================
-- END db/migrations/20260826120700_service_mode_privilege_hardening.sql
-- ============================================================================

commit;

-- ============================================================================
-- Applied. Next steps: run
--   supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--   supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- and confirm 0 FAIL rows in all four.
-- ============================================================================
