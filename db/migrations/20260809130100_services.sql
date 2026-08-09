-- FadeUp — LOT 7: services + availability
-- Migration: services
--
-- Price is stored as integer cents (services.price_cents), not a float or
-- decimal dollars column — avoids floating-point rounding entirely and
-- matches how every payment provider FadeUp will integrate with (LOT 16)
-- represents money. Duration/buffers are plain integer minutes.
--
-- Idempotent: safe to re-run.

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  category_id uuid references public.service_categories (id) on delete set null,
  name text not null,
  description text,
  duration_minutes integer not null,
  buffer_before_minutes integer not null default 0,
  buffer_after_minutes integer not null default 0,
  price_cents integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_name_not_blank check (btrim(name) <> ''),
  constraint services_duration_positive check (duration_minutes > 0),
  constraint services_buffers_nonnegative check (buffer_before_minutes >= 0 and buffer_after_minutes >= 0),
  constraint services_price_nonnegative check (price_cents >= 0)
);

comment on table public.services is
  'Service catalog entry: duration/buffers drive appointment-engine slot math (LOT 8), not built here. price_cents is integer cents.';

create index if not exists services_organization_id_idx on public.services (organization_id);
create index if not exists services_category_id_idx on public.services (category_id);

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- Tenant-consistency invariant: category_id, if set, must belong to the
-- same organization_id.
create or replace function public.check_service_category_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.service_categories sc
    where sc.id = new.category_id and sc.organization_id = new.organization_id
  ) then
    raise exception 'services.category_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists services_check_category_consistency on public.services;
create trigger services_check_category_consistency
  before insert or update on public.services
  for each row execute function public.check_service_category_consistency();

-- Row Level Security -------------------------------------------------------
-- select: any org member, or platform admin. Public (anon) visibility for
-- booking pages is explicitly out of scope here (LOT 9, public booking) —
-- same deferred-anon-policy pattern as organizations/locations in LOT 2.
-- insert/update/delete: owner/manager only.

alter table public.services enable row level security;
alter table public.services force row level security;

drop policy if exists services_select on public.services;
create policy services_select
  on public.services
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists services_insert on public.services;
create policy services_insert
  on public.services
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists services_update on public.services;
create policy services_update
  on public.services
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists services_delete on public.services;
create policy services_delete
  on public.services
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));
