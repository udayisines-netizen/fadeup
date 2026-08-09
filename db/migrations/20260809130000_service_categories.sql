-- FadeUp — LOT 7: services + availability
-- Migration: service_categories
--
-- Idempotent: safe to re-run.

create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_categories_name_not_blank check (btrim(name) <> '')
);

comment on table public.service_categories is
  'Optional grouping for services (e.g. "Haircuts", "Beard", "Color"). A service without a category is still valid.';

create index if not exists service_categories_organization_id_idx on public.service_categories (organization_id);

drop trigger if exists service_categories_set_updated_at on public.service_categories;
create trigger service_categories_set_updated_at
  before update on public.service_categories
  for each row execute function public.set_updated_at();

alter table public.service_categories enable row level security;
alter table public.service_categories force row level security;

drop policy if exists service_categories_select on public.service_categories;
create policy service_categories_select
  on public.service_categories
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists service_categories_insert on public.service_categories;
create policy service_categories_insert
  on public.service_categories
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists service_categories_update on public.service_categories;
create policy service_categories_update
  on public.service_categories
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists service_categories_delete on public.service_categories;
create policy service_categories_delete
  on public.service_categories
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));
