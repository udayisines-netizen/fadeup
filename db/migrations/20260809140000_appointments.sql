-- FadeUp — LOT 8: appointment engine
-- Migration: appointments
--
-- The core booking record. Scope note: there is no `customers` table yet
-- (that's LOT 12, Customer CRM) — appointments capture guest-style
-- customer_name/phone/email directly for now. LOT 12 will add a real
-- `customers` table and a `customer_id` FK to this table; these plain
-- columns are a deliberate, honest placeholder, not a design mistake to
-- silently work around.
--
-- Double-booking prevention uses a GiST EXCLUDE constraint (not a trigger or
-- application-level check) so it holds even under concurrent writes —
-- a trigger-based "check for overlap then insert" has a race condition
-- between the check and the insert; an exclusion constraint does not.
-- `blocked_range` is the barber's fully-occupied window including buffers
-- (buffer_before_minutes/buffer_after_minutes are snapshotted from the
-- service at booking time — see column comments — so a later edit to the
-- service's buffers never silently changes the blocked window of
-- appointments already booked). It is populated by a BEFORE trigger, not a
-- generated column: Postgres's timestamptz +/- interval operator is STABLE
-- rather than IMMUTABLE (interval arithmetic is timezone-rule-dependent),
-- so it is rejected inside a generated-column expression.
--
-- Idempotent: safe to re-run.

-- btree_gist lets a plain equality column (barber_id, chair_id) participate
-- in a GiST exclusion constraint alongside a range column.
create extension if not exists btree_gist with schema extensions;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'appointment_status') then
    create type public.appointment_status as enum ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
  end if;
end
$$;

comment on type public.appointment_status is
  'pending: reserved for a future online booking-request flow (LOT 9), not used by staff-created appointments in LOT 8, which default to confirmed.';

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  barber_id uuid not null references public.barbers (id) on delete cascade,
  chair_id uuid references public.chairs (id) on delete set null,
  -- restrict, not cascade: deleting a service that has appointment history
  -- would silently destroy that history. Shops deactivate a service
  -- (services.is_active) instead of deleting it once it has been booked.
  service_id uuid not null references public.services (id) on delete restrict,
  customer_name text not null,
  customer_phone text,
  customer_email text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Snapshotted from services.buffer_before_minutes/buffer_after_minutes at
  -- booking time — see migration comment above.
  buffer_before_minutes integer not null default 0,
  buffer_after_minutes integer not null default 0,
  status public.appointment_status not null default 'confirmed',
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Populated by the appointments_set_blocked_range trigger below, before
  -- every insert/update — see migration comment for why this can't be a
  -- generated column.
  blocked_range tstzrange not null default tstzrange(now(), now(), '[)'),
  constraint appointments_customer_name_not_blank check (btrim(customer_name) <> ''),
  constraint appointments_time_order check (ends_at > starts_at),
  constraint appointments_buffers_nonnegative check (buffer_before_minutes >= 0 and buffer_after_minutes >= 0),
  -- A cancelled/no-show appointment frees up the barber's time; only
  -- non-cancelled, non-no-show appointments actually block a slot.
  constraint appointments_barber_no_overlap exclude using gist (
    barber_id with =,
    blocked_range with &&
  ) where (status not in ('cancelled', 'no_show')),
  -- chair_id is nullable; exclusion constraints treat NULL as distinct from
  -- NULL (same as a unique constraint), so appointments with no chair
  -- assigned never conflict with each other here — chair-level conflict
  -- protection only applies once a chair is actually assigned.
  constraint appointments_chair_no_overlap exclude using gist (
    chair_id with =,
    blocked_range with &&
  ) where (status not in ('cancelled', 'no_show'))
);

comment on table public.appointments is
  'Core booking record. No customers table yet (LOT 12) — customer_name/phone/email are a deliberate placeholder. blocked_range (generated) is the barber''s fully-occupied window including buffers, enforced conflict-free via a GiST exclusion constraint (race-free, unlike a check-then-insert trigger).';

create index if not exists appointments_organization_id_idx on public.appointments (organization_id);
create index if not exists appointments_barber_id_starts_at_idx on public.appointments (barber_id, starts_at);
create index if not exists appointments_location_id_starts_at_idx on public.appointments (location_id, starts_at);
create index if not exists appointments_chair_id_starts_at_idx on public.appointments (chair_id, starts_at) where chair_id is not null;
create index if not exists appointments_service_id_idx on public.appointments (service_id);

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

create or replace function public.set_appointment_blocked_range()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.blocked_range := tstzrange(
    new.starts_at - (new.buffer_before_minutes || ' minutes')::interval,
    new.ends_at + (new.buffer_after_minutes || ' minutes')::interval,
    '[)'
  );
  return new;
end;
$$;

drop trigger if exists appointments_set_blocked_range on public.appointments;
create trigger appointments_set_blocked_range
  before insert or update on public.appointments
  for each row execute function public.set_appointment_blocked_range();

-- Tenant-consistency invariant: location_id, barber_id, service_id and
-- (if set) chair_id must all belong to the same organization_id, and a
-- chair, if set, must belong to the same location_id as the appointment.
create or replace function public.check_appointment_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
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

drop trigger if exists appointments_check_consistency on public.appointments;
create trigger appointments_check_consistency
  before insert or update on public.appointments
  for each row execute function public.check_appointment_consistency();

-- Row Level Security -------------------------------------------------------
-- select: any org member, or platform admin — staff need shared visibility
-- of the shop's schedule. Per-barber "only my own appointments" visibility
-- is not implemented in LOT 8; revisit if a future privacy requirement
-- needs it.
-- insert/update/delete: owner/manager/receptionist only in LOT 8 — the
-- staff roles that actually run front-of-house booking. Barbers are
-- read-only here; self-service status updates (mark complete/no-show from
-- the chair) are deferred to Chair Mode (LOT 11), which will need its own
-- narrowly-scoped policy rather than blanket appointment write access.

alter table public.appointments enable row level security;
alter table public.appointments force row level security;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select
  on public.appointments
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert
  on public.appointments
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

drop policy if exists appointments_update on public.appointments;
create policy appointments_update
  on public.appointments
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));

drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete
  on public.appointments
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])));
