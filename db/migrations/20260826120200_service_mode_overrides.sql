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
