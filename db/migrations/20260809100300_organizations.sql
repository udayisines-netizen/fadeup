-- FadeUp — LOT 2: multi-tenant database foundation
-- Migration: organizations
--
-- The tenant root. Every other business table in FadeUp must resolve to a
-- row here, either directly (organization_id) or via an immutable ownership
-- chain (per CLAUDE.md multi-tenancy rules).
--
-- slug is unique and will back public booking URLs (/s/{slug}) in a later
-- lot; the public (anon) lookup policy for that route is explicitly out of
-- scope here — this lot grants anon no access to this table at all.
--
-- RLS is enabled and FORCEd immediately (default deny) but policies are
-- intentionally deferred to 20260809100900_tenant_rls_policies.sql, which
-- runs after the memberships table and the private authorization helper
-- functions it depends on both exist. Between this migration and that one
-- there are zero policies, which means zero access for anon/authenticated —
-- a safe, if temporarily inert, state.
--
-- Idempotent: safe to re-run.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_not_blank check (btrim(name) <> ''),
  -- lowercase, hyphen-separated, URL-safe: matches how slugs will be used
  -- in public booking paths (/s/{slug}) in a later lot.
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table public.organizations is
  'Tenant root. Every business resource must have a provable ownership path to a row here.';

-- Explicit unique constraint (Postgres creates a backing unique index
-- automatically) so slug lookups (public booking URL resolution, later lot)
-- and uniqueness enforcement share one index.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_slug_key'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_slug_key unique (slug);
  end if;
end $$;

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;
alter table public.organizations force row level security;
