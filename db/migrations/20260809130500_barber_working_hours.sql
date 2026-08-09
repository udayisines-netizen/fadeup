-- FadeUp — LOT 7: services + availability
-- Migration: barber_working_hours
--
-- Regular weekly schedule per barber — a subset of whatever location_hours
-- allows, but that intersection is the appointment engine's job (LOT 8),
-- not enforced here. Same day_of_week convention as location_hours
-- (0=Sunday..6=Saturday).
--
-- Idempotent: safe to re-run.

create table if not exists public.barber_working_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  barber_id uuid not null references public.barbers (id) on delete cascade,
  day_of_week smallint not null,
  is_off boolean not null default false,
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint barber_working_hours_day_of_week_range check (day_of_week between 0 and 6),
  constraint barber_working_hours_barber_day_unique unique (barber_id, day_of_week),
  constraint barber_working_hours_start_end_consistent check (
    is_off or (start_time is not null and end_time is not null and start_time < end_time)
  )
);

comment on table public.barber_working_hours is
  'Regular weekly schedule per barber. day_of_week: 0=Sunday..6=Saturday. Intersection with location_hours is LOT 8''s job, not enforced here.';

create index if not exists barber_working_hours_organization_id_idx on public.barber_working_hours (organization_id);

drop trigger if exists barber_working_hours_set_updated_at on public.barber_working_hours;
create trigger barber_working_hours_set_updated_at
  before update on public.barber_working_hours
  for each row execute function public.set_updated_at();

create or replace function public.check_barber_working_hours_barber_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.barbers b
    where b.id = new.barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'barber_working_hours.barber_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists barber_working_hours_check_consistency on public.barber_working_hours;
create trigger barber_working_hours_check_consistency
  before insert or update on public.barber_working_hours
  for each row execute function public.check_barber_working_hours_barber_consistency();

alter table public.barber_working_hours enable row level security;
alter table public.barber_working_hours force row level security;

drop policy if exists barber_working_hours_select on public.barber_working_hours;
create policy barber_working_hours_select
  on public.barber_working_hours
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists barber_working_hours_insert on public.barber_working_hours;
create policy barber_working_hours_insert
  on public.barber_working_hours
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists barber_working_hours_update on public.barber_working_hours;
create policy barber_working_hours_update
  on public.barber_working_hours
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists barber_working_hours_delete on public.barber_working_hours;
create policy barber_working_hours_delete
  on public.barber_working_hours
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));
