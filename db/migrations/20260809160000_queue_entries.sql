-- FadeUp — LOT 10: live queue
-- Migration: queue_entries
--
-- Walk-in queue management — a deliberately SEPARATE concept from
-- `appointments` (LOT 8), not a variant of it. An appointment has a fixed
-- scheduled starts_at/ends_at; a queue entry has no scheduled time at all —
-- it represents "this customer is physically waiting, next available."
-- Reusing appointments with nullable time columns would blur two genuinely
-- different business concepts and complicate every appointment query with
-- "is this a real booking or a walk-in" branching. barber_id is nullable —
-- a walk-in can request "any available barber" (null) or a specific one.
--
-- Position in line is NOT a stored/maintained column — it's derived by
-- ordering `waiting` entries by `created_at` (per location, optionally per
-- barber) at query time. A stored position column would need renumbering
-- every time an entry leaves the queue out of order (a no-show pulled from
-- the middle, a customer who leaves), which is exactly the kind of stateful
-- bookkeeping that invites bugs; recomputing it from created_at order is
-- always correct and needs no maintenance.
--
-- Scope note: this lot is the internal, authenticated-only queue data model
-- and management surface (staff add/call/complete queue entries). A public/
-- anon-facing read (e.g. a TV/kiosk display, or a customer-facing "you are
-- #3 in line" view) is explicitly deferred to LOT 11 (Chair Mode + Kiosk +
-- TV Mode), the same way LOT 8 (internal appointments) was separated from
-- LOT 9 (public booking) — building the anon-facing surface before the
-- kiosk/TV feature that actually needs it would mean guessing its shape.
--
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'queue_status') then
    create type public.queue_status as enum ('waiting', 'called', 'in_service', 'completed', 'cancelled', 'no_show');
  end if;
end
$$;

create table if not exists public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  -- null = "any available barber" (a genuine walk-in request, not an
  -- unset/placeholder value).
  barber_id uuid references public.barbers (id) on delete set null,
  service_id uuid references public.services (id) on delete set null,
  customer_name text not null,
  customer_phone text,
  status public.queue_status not null default 'waiting',
  notes text,
  called_at timestamptz,
  service_started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint queue_entries_customer_name_not_blank check (btrim(customer_name) <> '')
);

comment on table public.queue_entries is
  'Walk-in queue, separate from appointments (no scheduled time). Position in line is derived from created_at order among status=waiting rows, not stored. barber_id null means "any available barber."';

create index if not exists queue_entries_organization_id_idx on public.queue_entries (organization_id);
-- The hot path: "current waiting line for this location, in order."
create index if not exists queue_entries_location_waiting_idx on public.queue_entries (location_id, created_at) where status = 'waiting';
create index if not exists queue_entries_barber_id_idx on public.queue_entries (barber_id) where barber_id is not null;

drop trigger if exists queue_entries_set_updated_at on public.queue_entries;
create trigger queue_entries_set_updated_at
  before update on public.queue_entries
  for each row execute function public.set_updated_at();

-- Tenant-consistency invariant: location_id, and barber_id/service_id if
-- set, must all belong to the same organization_id.
create or replace function public.check_queue_entry_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
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

drop trigger if exists queue_entries_check_consistency on public.queue_entries;
create trigger queue_entries_check_consistency
  before insert or update on public.queue_entries
  for each row execute function public.check_queue_entry_consistency();

-- Row Level Security -------------------------------------------------------
-- select: any org member, or platform admin — same reasoning as
-- appointments, everyone on shift needs to see the line, including
-- barbers.
-- insert/update/delete: owner/manager/receptionist only, matching
-- appointments (LOT 8) exactly — front-of-house roles run the queue.
-- Barbers are read-only here too; self-service "call my next customer"
-- is deferred to Chair Mode (LOT 11), consistent with the same
-- documented simplification made for appointments.

alter table public.queue_entries enable row level security;
alter table public.queue_entries force row level security;

drop policy if exists queue_entries_select on public.queue_entries;
create policy queue_entries_select
  on public.queue_entries
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists queue_entries_insert on public.queue_entries;
create policy queue_entries_insert
  on public.queue_entries
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

drop policy if exists queue_entries_update on public.queue_entries;
create policy queue_entries_update
  on public.queue_entries
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

drop policy if exists queue_entries_delete on public.queue_entries;
create policy queue_entries_delete
  on public.queue_entries
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

-- Realtime -------------------------------------------------------------
-- "Live" queue means the frontend subscribes to Postgres Changes on this
-- table rather than polling. Supabase Realtime's Postgres Changes feature
-- is RLS-aware for authenticated subscribers (a connected client only
-- receives change events for rows its own RLS policies would let it
-- SELECT) — the queue_entries_select policy above is what makes this
-- actually tenant-safe, not an extra check here. `supabase_realtime` is a
-- selective (not ALL TABLES) publication in this stack, so a table must be
-- explicitly added to it to broadcast changes at all.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_entries'
  ) then
    alter publication supabase_realtime add table public.queue_entries;
  end if;
end
$$;
