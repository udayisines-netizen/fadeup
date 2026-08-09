-- FadeUp — LOT 7: services + availability
-- Migration: service_locations
--
-- Which locations offer a given service. Deliberately explicit, not
-- sparse-set-implicit: a service with ZERO rows here means "not yet
-- assigned to any location," not "available everywhere" — an implicit
-- "empty means everywhere" rule is a classic footgun (a service silently
-- becomes bookable at a brand-new location nobody meant to enable it at).
-- Client code that wants "assign to all current locations by default" when
-- creating a service should do so explicitly (insert one row per location),
-- not rely on absence-of-rows semantics.
--
-- Idempotent: safe to re-run.

create table if not exists public.service_locations (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (service_id, location_id)
);

comment on table public.service_locations is
  'Explicit join: which locations offer a service. No rows for a service means "offered nowhere yet," not "offered everywhere."';

create index if not exists service_locations_organization_id_idx on public.service_locations (organization_id);
create index if not exists service_locations_location_id_idx on public.service_locations (location_id);

-- Tenant-consistency invariant: both service_id and location_id must belong
-- to the same organization_id as the join row itself.
create or replace function public.check_service_location_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.services s
    where s.id = new.service_id and s.organization_id = new.organization_id
  ) then
    raise exception 'service_locations.service_id must belong to the same organization_id';
  end if;
  if not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'service_locations.location_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists service_locations_check_consistency on public.service_locations;
create trigger service_locations_check_consistency
  before insert or update on public.service_locations
  for each row execute function public.check_service_location_consistency();

alter table public.service_locations enable row level security;
alter table public.service_locations force row level security;

drop policy if exists service_locations_select on public.service_locations;
create policy service_locations_select
  on public.service_locations
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists service_locations_insert on public.service_locations;
create policy service_locations_insert
  on public.service_locations
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists service_locations_delete on public.service_locations;
create policy service_locations_delete
  on public.service_locations
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));
