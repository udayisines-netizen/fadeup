-- FadeUp — LOT 7: services + availability
-- Migration: barber_availability_exceptions
--
-- One-off overrides to a barber's regular weekly schedule for a specific
-- date: time off, a holiday closure, or an extra/adjusted window. One row
-- per (barber, date) — a day either has one exception or it doesn't; there
-- is no support for multiple disjoint windows on the same day in this lot.
--
-- Idempotent: safe to re-run.

create table if not exists public.barber_availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  barber_id uuid not null references public.barbers (id) on delete cascade,
  exception_date date not null,
  is_unavailable boolean not null default true,
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint barber_availability_exceptions_barber_date_unique unique (barber_id, exception_date),
  constraint barber_availability_exceptions_time_consistent check (
    is_unavailable or (start_time is not null and end_time is not null and start_time < end_time)
  )
);

comment on table public.barber_availability_exceptions is
  'Date-specific override of a barber''s regular schedule (time off, holiday, or an adjusted window). One row per (barber, date).';

create index if not exists barber_availability_exceptions_organization_id_idx on public.barber_availability_exceptions (organization_id);
create index if not exists barber_availability_exceptions_barber_id_idx on public.barber_availability_exceptions (barber_id);

drop trigger if exists barber_availability_exceptions_set_updated_at on public.barber_availability_exceptions;
create trigger barber_availability_exceptions_set_updated_at
  before update on public.barber_availability_exceptions
  for each row execute function public.set_updated_at();

create or replace function public.check_barber_exception_barber_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.barbers b
    where b.id = new.barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'barber_availability_exceptions.barber_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists barber_availability_exceptions_check_consistency on public.barber_availability_exceptions;
create trigger barber_availability_exceptions_check_consistency
  before insert or update on public.barber_availability_exceptions
  for each row execute function public.check_barber_exception_barber_consistency();

alter table public.barber_availability_exceptions enable row level security;
alter table public.barber_availability_exceptions force row level security;

drop policy if exists barber_availability_exceptions_select on public.barber_availability_exceptions;
create policy barber_availability_exceptions_select
  on public.barber_availability_exceptions
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists barber_availability_exceptions_insert on public.barber_availability_exceptions;
create policy barber_availability_exceptions_insert
  on public.barber_availability_exceptions
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists barber_availability_exceptions_update on public.barber_availability_exceptions;
create policy barber_availability_exceptions_update
  on public.barber_availability_exceptions
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists barber_availability_exceptions_delete on public.barber_availability_exceptions;
create policy barber_availability_exceptions_delete
  on public.barber_availability_exceptions
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));
