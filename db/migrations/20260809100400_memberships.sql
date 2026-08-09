-- FadeUp — LOT 2: multi-tenant database foundation
-- Migration: memberships
--
-- Core tenant-authorization table: (user_id, organization_id) -> role.
-- Every RLS policy on every other tenant table ultimately resolves through
-- this table (via the private.is_org_member / private.has_org_role helper
-- functions added in 20260809100800_authz_helper_functions.sql).
--
-- Role representation: native Postgres enum, not a text + CHECK constraint.
-- Tradeoff, documented here since it's a real decision:
--   + compact (4 bytes), self-documenting, invalid values rejected at the
--     type level (no per-table CHECK to keep in sync), sorts/compares fast.
--   - adding a new role later requires `alter type ... add value` in its
--     own migration; in Postgres <12 that couldn't run in the same
--     transaction as a query using the new value — on Postgres 17 (this
--     stack) `add value if not exists` runs fine as a single statement but
--     still can't be combined with a use of that value in the SAME
--     transaction block. Removing/renaming a value is not supported and
--     requires a type-swap migration. Given FadeUp's four roles are fixed
--     by CLAUDE.md and additions are expected to be rare and deliberate,
--     the compactness/enforcement win outweighs that migration friction.
--
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_role') then
    create type public.membership_role as enum ('owner', 'manager', 'receptionist', 'barber');
  end if;
end $$;

comment on type public.membership_role is
  'Org-scoped role for a membership row. Fixed set per CLAUDE.md: owner, manager, receptionist, barber.';

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.membership_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_org_user_unique unique (organization_id, user_id)
);

comment on table public.memberships is
  'Core tenant-authorization table. One row per (user, organization) with an org-scoped role.';

create index if not exists memberships_organization_id_idx on public.memberships (organization_id);
create index if not exists memberships_user_id_idx on public.memberships (user_id);

drop trigger if exists memberships_set_updated_at on public.memberships;
create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();

alter table public.memberships enable row level security;
alter table public.memberships force row level security;

-- Auto-provision the creator as 'owner' -----------------------------------
-- An organization must always have at least one owner from the moment it
-- exists. Rather than trusting the client to make a second, separate
-- membership INSERT after creating an organization (which RLS could not yet
-- authorize anyway — a brand-new org has no members, so no
-- has_org_role(...) check could ever pass), the organization row itself
-- drives its own first membership via this AFTER INSERT trigger.
--
-- SECURITY DEFINER: bypasses RLS for exactly this one controlled insert.
-- Guarded by "where auth.uid() is not null" so that organizations created
-- by an operator/migration running as postgres (no JWT session) do not
-- attempt to create a bogus membership row.
--
-- Known gap, deliberately out of scope for LOT 2: nothing yet prevents the
-- last owner of an organization from leaving/being removed. Enforcing "an
-- organization always has >=1 owner" on delete requires a BEFORE DELETE
-- trigger with cross-row counting logic — left for the lot that builds
-- membership management UI, where the product behavior (block? auto
-- transfer ownership? require explicit transfer first?) needs to be
-- defined rather than assumed here.
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    insert into public.memberships (organization_id, user_id, role)
    values (new.id, (select auth.uid()), 'owner')
    on conflict (organization_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.handle_new_organization() is
  'Trigger function on organizations: makes the creating user the owner membership for the new org.';

drop trigger if exists on_organization_created on public.organizations;
create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();
