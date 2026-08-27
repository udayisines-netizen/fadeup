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
