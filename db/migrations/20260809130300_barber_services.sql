-- FadeUp — LOT 7: services + availability
-- Migration: barber_services
--
-- Which services a barber is eligible to perform. Same explicit-join
-- philosophy as service_locations: zero rows means "not eligible for
-- anything yet," never an implicit "eligible for everything."
--
-- Idempotent: safe to re-run.

create table if not exists public.barber_services (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  barber_id uuid not null references public.barbers (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (barber_id, service_id)
);

comment on table public.barber_services is
  'Explicit join: which services a barber is eligible to perform. No rows means not eligible for anything yet.';

create index if not exists barber_services_organization_id_idx on public.barber_services (organization_id);
create index if not exists barber_services_service_id_idx on public.barber_services (service_id);

create or replace function public.check_barber_service_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.barbers b
    where b.id = new.barber_id and b.organization_id = new.organization_id
  ) then
    raise exception 'barber_services.barber_id must belong to the same organization_id';
  end if;
  if not exists (
    select 1 from public.services s
    where s.id = new.service_id and s.organization_id = new.organization_id
  ) then
    raise exception 'barber_services.service_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists barber_services_check_consistency on public.barber_services;
create trigger barber_services_check_consistency
  before insert or update on public.barber_services
  for each row execute function public.check_barber_service_consistency();

alter table public.barber_services enable row level security;
alter table public.barber_services force row level security;

drop policy if exists barber_services_select on public.barber_services;
create policy barber_services_select
  on public.barber_services
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists barber_services_insert on public.barber_services;
create policy barber_services_insert
  on public.barber_services
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists barber_services_delete on public.barber_services;
create policy barber_services_delete
  on public.barber_services
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));
