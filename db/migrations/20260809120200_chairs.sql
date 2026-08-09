-- FadeUp — LOT 6: organization / locations / staff / chairs
-- Migration: chairs
--
-- Structural inventory of physical chairs per location. Deliberately does
-- NOT include a live operational status/occupancy state machine (available/
-- reserved/occupied) here — that belongs to Chair Mode (LOT 11), which needs
-- real concurrency-safety design (two barbers must never claim the same
-- chair) that would be premature to half-build now with no session/claiming
-- logic behind it. `is_active` here means "this chair currently exists in
-- the shop's inventory," not "currently occupied."
--
-- Idempotent: safe to re-run.

create table if not exists public.chairs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chairs_name_not_blank check (btrim(name) <> '')
);

comment on table public.chairs is
  'Structural inventory of physical chairs per location. Live occupancy/session state is Chair Mode (LOT 11), not this table.';

create index if not exists chairs_organization_id_idx on public.chairs (organization_id);
create index if not exists chairs_location_id_idx on public.chairs (location_id);

drop trigger if exists chairs_set_updated_at on public.chairs;
create trigger chairs_set_updated_at
  before update on public.chairs
  for each row execute function public.set_updated_at();

-- Tenant-consistency invariant: location_id must belong to the same
-- organization_id. Trigger-level (not just RLS with check).
create or replace function public.check_chair_location_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'chairs.location_id must belong to the same organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists chairs_check_location_consistency on public.chairs;
create trigger chairs_check_location_consistency
  before insert or update on public.chairs
  for each row execute function public.check_chair_location_consistency();

-- Row Level Security -------------------------------------------------------
-- select: any org member, or platform admin.
-- insert/update/delete: owner/manager only.

alter table public.chairs enable row level security;
alter table public.chairs force row level security;

drop policy if exists chairs_select on public.chairs;
create policy chairs_select
  on public.chairs
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists chairs_insert on public.chairs;
create policy chairs_insert
  on public.chairs
  for insert
  to authenticated
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists chairs_update on public.chairs;
create policy chairs_update
  on public.chairs
  for update
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])))
  with check ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));

drop policy if exists chairs_delete on public.chairs;
create policy chairs_delete
  on public.chairs
  for delete
  to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[])));
