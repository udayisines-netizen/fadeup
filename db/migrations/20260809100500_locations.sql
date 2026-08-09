-- FadeUp — LOT 2: multi-tenant database foundation
-- Migration: locations
--
-- A physical shop location belonging to an organization. One organization
-- can have many locations. Tenant ownership is direct (organization_id).
--
-- RLS is enabled and FORCEd (default deny) but, like organizations, policies
-- are deferred to 20260809100900_tenant_rls_policies.sql.
--
-- Idempotent: safe to re-run.

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text,
  timezone text not null default 'UTC',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_name_not_blank check (btrim(name) <> '')
);

comment on table public.locations is
  'Physical shop location belonging to an organization. An organization can have many.';

create index if not exists locations_organization_id_idx on public.locations (organization_id);

drop trigger if exists locations_set_updated_at on public.locations;
create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

alter table public.locations enable row level security;
alter table public.locations force row level security;
