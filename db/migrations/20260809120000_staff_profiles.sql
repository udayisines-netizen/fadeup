-- FadeUp — LOT 6: organization / locations / staff / chairs
-- Migration: staff_profiles
--
-- The operational/public-facing staff record — distinct from `memberships`
-- (which is purely authorization: user + org -> role) and `profiles` (bare
-- account identity, not org-scoped, not visible to teammates — see the
-- documented gap in 20260809100200_profiles.sql). `staff_profiles` is what
-- finally lets a teammate roster show real display names: it's org-scoped
-- and readable by any member of that org, unlike `profiles`.
--
-- Applies to any membership role, not barbers specifically — an owner or
-- receptionist can have a staff profile too (title/bio/location assignment
-- are meaningful for any staff member). `barbers` (next migration) is the
-- further specialization for staff who actually take appointments.
--
-- Idempotent: safe to re-run.

create table if not exists public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  location_id uuid references public.locations (id) on delete set null,
  display_name text not null,
  title text,
  bio text,
  avatar_url text,
  is_public boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_profiles_org_user_unique unique (organization_id, user_id),
  constraint staff_profiles_display_name_not_blank check (btrim(display_name) <> '')
);

comment on table public.staff_profiles is
  'Operational/public-facing staff record: display name, title, bio, primary location. One per (organization, user). Authorization role lives in memberships, not here.';

create index if not exists staff_profiles_organization_id_idx on public.staff_profiles (organization_id);
create index if not exists staff_profiles_location_id_idx on public.staff_profiles (location_id);

drop trigger if exists staff_profiles_set_updated_at on public.staff_profiles;
create trigger staff_profiles_set_updated_at
  before update on public.staff_profiles
  for each row execute function public.set_updated_at();

-- Tenant-consistency invariant: location_id, if set, must belong to the
-- same organization_id — enforced at the trigger level (not just RLS
-- `with check`) so it holds even for service_role/direct-SQL writes, not
-- only ordinary authenticated client writes.
create or replace function public.check_staff_profile_location_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.location_id is not null and not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'staff_profiles.location_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_profiles_check_location_consistency on public.staff_profiles;
create trigger staff_profiles_check_location_consistency
  before insert or update on public.staff_profiles
  for each row execute function public.check_staff_profile_location_consistency();

-- Row Level Security -------------------------------------------------------
-- select: any org member (this is the whole point — org-scoped visibility
--   that plain `profiles` deliberately doesn't have), or platform admin.
-- insert/update: owner/manager, and the target user_id must already hold a
--   membership in this organization (a staff profile cannot be created for
--   someone with no membership — never trust the client to keep this
--   consistent on its own).
-- delete: owner/manager.

alter table public.staff_profiles enable row level security;
alter table public.staff_profiles force row level security;

drop policy if exists staff_profiles_select on public.staff_profiles;
create policy staff_profiles_select
  on public.staff_profiles
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists staff_profiles_insert on public.staff_profiles;
create policy staff_profiles_insert
  on public.staff_profiles
  for insert
  to authenticated
  with check (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
    and exists (
      select 1 from public.memberships m
      where m.organization_id = organization_id and m.user_id = user_id
    )
  );

drop policy if exists staff_profiles_update on public.staff_profiles;
create policy staff_profiles_update
  on public.staff_profiles
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists staff_profiles_delete on public.staff_profiles;
create policy staff_profiles_delete
  on public.staff_profiles
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

-- Auto-provision a staff_profiles row for every new membership ------------
-- Every path that creates a membership (org creation's owner trigger,
-- accept_invitation, or a direct owner/manager insert) should leave the org
-- with a usable team roster, not a mix of members who have a staff profile
-- and members who don't. SECURITY DEFINER: bypasses RLS for this one
-- controlled insert, same pattern as handle_new_organization. display_name
-- defaults from the account's profiles.full_name when available; owner/
-- manager can edit it afterward via the normal staff_profiles_update policy
-- (self-service edit by the staff member themselves is intentionally not
-- built yet — deferred, not forgotten: see docs/database.md).
create or replace function public.handle_new_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text;
begin
  select p.full_name into v_full_name from public.profiles p where p.id = new.user_id;

  insert into public.staff_profiles (organization_id, user_id, display_name)
  values (new.organization_id, new.user_id, coalesce(nullif(btrim(v_full_name), ''), 'Team member'))
  on conflict (organization_id, user_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_membership() is
  'Trigger function on memberships: auto-creates the matching staff_profiles row so every member has one.';

drop trigger if exists on_membership_created on public.memberships;
create trigger on_membership_created
  after insert on public.memberships
  for each row execute function public.handle_new_membership();
