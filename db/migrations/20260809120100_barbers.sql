-- FadeUp — LOT 6: organization / locations / staff / chairs
-- Migration: barbers
--
-- The further specialization of staff_profiles for staff who actually take
-- appointments. Kept as its own table (not a boolean column on
-- staff_profiles) because barber-specific concerns are coming in later lots
-- (service eligibility in LOT 7, commission rules in LOT 17) and will attach
-- to this row, not to every staff profile. For LOT 6, deliberately minimal:
-- just the "this staff member is a bookable barber" fact and its
-- organization-consistency guarantee. Working hours/time-off/service
-- eligibility are explicitly out of scope here (LOT 7's working-time
-- engine).
--
-- Idempotent: safe to re-run.

create table if not exists public.barbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles (id) on delete cascade,
  is_bookable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint barbers_staff_profile_unique unique (staff_profile_id)
);

comment on table public.barbers is
  'Marks a staff_profiles row as a bookable barber. Service eligibility, working hours and commission rules attach here in later lots, not on staff_profiles directly.';

create index if not exists barbers_organization_id_idx on public.barbers (organization_id);

drop trigger if exists barbers_set_updated_at on public.barbers;
create trigger barbers_set_updated_at
  before update on public.barbers
  for each row execute function public.set_updated_at();

-- Tenant-consistency invariant: staff_profile_id must belong to the same
-- organization_id. Trigger-level (not just RLS with check) so it holds for
-- service_role/direct-SQL writes too.
create or replace function public.check_barber_staff_profile_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.staff_profiles sp
    where sp.id = new.staff_profile_id and sp.organization_id = new.organization_id
  ) then
    raise exception 'barbers.staff_profile_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists barbers_check_staff_profile_consistency on public.barbers;
create trigger barbers_check_staff_profile_consistency
  before insert or update on public.barbers
  for each row execute function public.check_barber_staff_profile_consistency();

-- Row Level Security -------------------------------------------------------
-- select: any org member, or platform admin.
-- insert/update/delete: owner/manager only.

alter table public.barbers enable row level security;
alter table public.barbers force row level security;

drop policy if exists barbers_select on public.barbers;
create policy barbers_select
  on public.barbers
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists barbers_insert on public.barbers;
create policy barbers_insert
  on public.barbers
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists barbers_update on public.barbers;
create policy barbers_update
  on public.barbers
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists barbers_delete on public.barbers;
create policy barbers_delete
  on public.barbers
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));
