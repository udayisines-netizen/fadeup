-- FadeUp — LOT 2: multi-tenant database foundation
-- Migration: profiles
--
-- One row per auth.users row. Holds basic, non-tenant identity data only
-- (display name, avatar). Organization membership/roles live in
-- public.memberships, not here — a profile is not itself tenant data, it is
-- the identity a tenant membership points at.
--
-- Row lifecycle is driven entirely by auth.users: a row is created
-- automatically via the handle_new_user() trigger on auth.users insert, and
-- removed automatically via ON DELETE CASCADE when the auth.users row is
-- deleted. There is no client-facing INSERT or DELETE path.
--
-- Idempotent: safe to re-run.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_not_blank check (full_name is null or btrim(full_name) <> '')
);

comment on table public.profiles is
  'One row per auth.users row. Basic identity only — not tenant data. Populated by handle_new_user() trigger.';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-provision a profile row whenever a new auth.users row is created.
-- SECURITY DEFINER: runs as the function owner (postgres, which has
-- BYPASSRLS) because the inserting "user" at signup time has no session/JWT
-- context yet for an ordinary RLS policy to authorize against. The function
-- body is intentionally minimal and schema-qualified (search_path = '') so
-- it cannot be redirected by a manipulated search_path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Trigger function on auth.users: creates the matching public.profiles row for a newly created user.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security -----------------------------------------------------
-- Default deny. A user may read and update only their own profile row.
-- No client-facing INSERT or DELETE policy: creation happens via the
-- trigger above (SECURITY DEFINER, bypasses RLS); deletion happens via the
-- ON DELETE CASCADE from auth.users when Supabase Auth deletes the user.
-- anon has no access at all.
--
-- Cross-tenant note: profiles carries no organization_id and is
-- intentionally NOT visible across membership boundaries in this lot — a
-- user cannot see any other user's profile, including teammates in the same
-- organization. Org-scoped visibility of teammate display names (e.g. for
-- staff rosters) is a product decision for a later lot (staff_profiles) and
-- must be added as its own explicit policy, not inferred here.

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
