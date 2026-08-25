-- FadeUp — R1A: a completed service survives the roster
--
-- REPRODUCED BEFORE THIS MIGRATION: authenticated as the organization OWNER,
-- `DELETE FROM public.barbers WHERE id = ...` — the exact statement PostgREST
-- issues for `DELETE /rest/v1/barbers?id=eq...` — took the appointment count
-- for that professional from 1 to 0. `barbers_delete` grants this to
-- owner/manager with no further guard.
--
-- This is not a hypothetical about a future UI button. The frontend never
-- deletes a barbers row (apps/web/src/lib/queries/barbers.ts does INSERT and
-- UPDATE only, toggling is_bookable to remove someone from the roster) — but
-- in a PostgREST system the frontend is not the security boundary. RLS is, and
-- RLS permits it today.
--
-- There are TWO cascade paths into appointments, and closing only one is
-- pointless:
--     barbers                      -> appointments  (ON DELETE CASCADE)
--     auth.users -> staff_profiles -> barbers -> appointments
--
-- WHAT CHANGES, AND THE DEAD END IT MUST NOT CREATE
--
-- 1. appointments.barber_id becomes ON DELETE RESTRICT. Deleting a barber who
--    has any appointment now fails loudly with 23503 instead of silently
--    destroying revenue history.
--
-- 2. That alone would make account deletion impossible forever: erasing an
--    auth.users row cascades to staff_profiles, to barbers, and would then be
--    blocked by the new RESTRICT. Erasure would dead-end on a foreign key
--    error with no supported path. So staff_profiles.user_id becomes NULLABLE
--    with ON DELETE SET NULL.
--
--    Deleting an account therefore DETACHES the person from the roster record
--    and leaves the service history standing, rather than deleting business
--    records. The staff row survives as an unowned tombstone: RLS predicates
--    all compare user_id to auth.uid(), and NULL matches nobody, so a detached
--    profile grants no access to anyone.
--
--    This is the correct separation. Authentication erasure and destruction of
--    a shop's business records are different operations, and only the first is
--    the user's to demand.
--
-- 3. Routine offboarding is not deletion and never was. offboard_barber()
--    below makes the existing convention explicit and callable.
--
-- OPERATIONAL CONSEQUENCE: a shop that previously "removed" a barber by
-- deleting the row must now deactivate instead. That is the intended
-- behaviour change and the only one in this migration.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Detachable staff identity
--    Must come first, or step 2 creates the account-deletion dead end.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_profiles'
      and column_name = 'user_id' and is_nullable = 'NO'
  ) then
    alter table public.staff_profiles alter column user_id drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'staff_profiles_user_id_fkey' and confdeltype = 'c'
  ) then
    alter table public.staff_profiles drop constraint staff_profiles_user_id_fkey;
    alter table public.staff_profiles
      add constraint staff_profiles_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete set null;
  end if;
end $$;

comment on column public.staff_profiles.user_id is
  'The account behind this roster record. NULLABLE and ON DELETE SET NULL: erasing an account detaches the person and leaves the shop''s service history intact, rather than cascading it away. A NULL user_id is a tombstone — every RLS predicate compares it to auth.uid(), which NULL never matches.';

-- ---------------------------------------------------------------------------
-- 2. The service record is protected
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'appointments_barber_id_fkey' and confdeltype = 'c'
  ) then
    alter table public.appointments drop constraint appointments_barber_id_fkey;
    alter table public.appointments
      add constraint appointments_barber_id_fkey
      foreign key (barber_id) references public.barbers (id)
      on delete restrict
      not valid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'appointments_barber_id_fkey' and not convalidated
  ) then
    alter table public.appointments validate constraint appointments_barber_id_fkey;
  end if;
end $$;

-- Configuration children keep CASCADE deliberately: working hours, service
-- eligibility and time blocks describe a barber's CURRENT setup, not what
-- happened. Only the service record is history.
--
-- queue_entries.barber_id is already ON DELETE SET NULL and is left alone —
-- queue history already survives, losing attribution, which is honest.

-- ---------------------------------------------------------------------------
-- 3. The supported offboarding path
-- ---------------------------------------------------------------------------

create or replace function public.offboard_barber(p_barber_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_sp uuid;
begin
  select organization_id, staff_profile_id into v_org, v_sp
  from public.barbers where id = p_barber_id;

  if v_org is null then
    raise exception 'barber not found' using errcode = '42704';
  end if;

  if not (select private.has_org_role(v_org, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to manage this roster' using errcode = '42501';
  end if;

  update public.barbers set is_bookable = false where id = p_barber_id;
  update public.staff_profiles set is_active = false, is_public = false where id = v_sp;
end;
$$;

comment on function public.offboard_barber(uuid) is
  'Owner/manager only. The supported way to remove a professional from a roster: makes them unbookable and removes them from public surfaces, while leaving their appointment history intact. Deleting the barbers row is no longer possible once history exists (ON DELETE RESTRICT) and was never the intended path.';

revoke execute on function public.offboard_barber(uuid) from public, anon;
grant execute on function public.offboard_barber(uuid) to authenticated;
