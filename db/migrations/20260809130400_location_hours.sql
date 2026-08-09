-- FadeUp — LOT 7: services + availability
-- Migration: location_hours
--
-- Regular weekly opening hours per location. One row per (location,
-- day_of_week) — day_of_week is 0=Sunday..6=Saturday (Postgres's own
-- `extract(dow from ...)` convention, so later slot-computation code in
-- LOT 8 can join against it without a mapping table). A day with no row is
-- treated as closed by convention (not enforced here — the appointment
-- engine, LOT 8, is what actually interprets this data; this migration only
-- stores it correctly).
--
-- Idempotent: safe to re-run.

create table if not exists public.location_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  day_of_week smallint not null,
  is_closed boolean not null default false,
  open_time time,
  close_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_hours_day_of_week_range check (day_of_week between 0 and 6),
  constraint location_hours_location_day_unique unique (location_id, day_of_week),
  constraint location_hours_open_close_consistent check (
    is_closed or (open_time is not null and close_time is not null and open_time < close_time)
  )
);

comment on table public.location_hours is
  'Regular weekly opening hours per location. day_of_week: 0=Sunday..6=Saturday (Postgres extract(dow) convention).';

create index if not exists location_hours_organization_id_idx on public.location_hours (organization_id);

drop trigger if exists location_hours_set_updated_at on public.location_hours;
create trigger location_hours_set_updated_at
  before update on public.location_hours
  for each row execute function public.set_updated_at();

create or replace function public.check_location_hours_location_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'location_hours.location_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists location_hours_check_consistency on public.location_hours;
create trigger location_hours_check_consistency
  before insert or update on public.location_hours
  for each row execute function public.check_location_hours_location_consistency();

alter table public.location_hours enable row level security;
alter table public.location_hours force row level security;

drop policy if exists location_hours_select on public.location_hours;
create policy location_hours_select
  on public.location_hours
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists location_hours_insert on public.location_hours;
create policy location_hours_insert
  on public.location_hours
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists location_hours_update on public.location_hours;
create policy location_hours_update
  on public.location_hours
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists location_hours_delete on public.location_hours;
create policy location_hours_delete
  on public.location_hours
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));
