-- FadeUp — R2: Solo covers ONE professional, and the database says so
--
-- THE INVARIANT
--
--   Solo (EUR 19) is one independent professional operating alone. It is not a
--   cheap salon plan, and Constitution 1.0 already required that the cap be
--   "a real constraint the model must be able to express and enforce" rather
--   than a sentence on a pricing page. This file is that enforcement.
--
--   Free (EUR 0) carries the same cap for the same reason: if a free
--   organization could roster five barbers, the free tier would quietly be the
--   product and every paid plan would be optional.
--
--   Every salon and multi-salon plan carries max_operational_professionals =
--   NULL, which this trigger reads as UNLIMITED. That is what "team is
--   included" means operationally: adding a barber to a salon_essential shop is
--   free, adding the tenth is free, and there is no quantity anywhere in this
--   schema for a price to be multiplied by.
--
-- WHAT AN "OPERATIONAL PROFESSIONAL" IS, AND WHY IT IS NOT A `professionals` ROW
--
-- This is the distinction R1B spent an entire lot establishing, and R2 must not
-- collapse it:
--
--   public.professionals            DURABLE IDENTITY. Shop-independent, outlives
--                                   employment, carries the follow graph and the
--                                   public profile. NEVER counted here, never
--                                   deleted here, never touched by a commercial
--                                   state change.
--   public.barbers                  A ROSTER PLACEMENT: this identity works at
--                                   this organization. THIS is what a plan
--                                   covers, and this is what is counted.
--
-- So a professional who leaves a Solo business keeps their identity, their
-- followers, their verified-client relationships and their appointment history;
-- the business simply no longer rosters them. A downgrade removes no identity,
-- and this trigger deletes nothing under any circumstances.
--
-- ACTIVE, NOT EVER-EXISTED
--
-- R1A made offboarding a deactivation rather than a deletion: offboard_barber()
-- sets staff_profiles.is_active = false and leaves the row. Counting every
-- barbers row would therefore make a shop permanently over capacity for people
-- who left years ago, and would turn R1A's durable history into a punishment.
-- The count is barbers joined to an ACTIVE staff_profile.
--
-- That has a deliberate consequence: reactivating a staff profile that backs a
-- roster row IS a capacity event, and is checked here. Otherwise "offboard,
-- downgrade to Solo, re-onboard" would be a three-step bypass.
--
-- THE RACE
--
-- Two managers invite the second barber into a Solo organization at the same
-- instant. Both count 1, both conclude one more fits, and one of them must
-- lose. Identical shape to the establishment race, and closed identically: take
-- `SELECT ... FOR UPDATE` on the organization's single commercial-state row
-- before counting, so the second transaction blocks and then re-counts against
-- committed data.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The shared check
--
-- One function, two triggers. The alternative — duplicating the count and the
-- lock into a barbers trigger and a staff_profiles trigger — is how two
-- enforcement points end up disagreeing after someone fixes a bug in one.
-- ---------------------------------------------------------------------------

create or replace function private.assert_professional_capacity(p_organization_id uuid)
returns void
language plpgsql
-- SECURITY DEFINER for the same reason as the establishment trigger:
-- organization_commercial_state has every client privilege revoked and FORCE
-- RLS enabled, so only the definer can read and lock it.
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_max integer;
  v_used integer;
begin
  perform private.ensure_organization_commercial_state(p_organization_id);

  -- THE MUTEX — the same row the establishment cap locks, so the two caps can
  -- never interleave into an inconsistent view of the same organization.
  perform 1
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id
  for update;

  v_plan := private.effective_plan_key(p_organization_id);

  if v_plan is null then
    raise exception 'cannot roster a professional: the organization has no resolvable commercial plan'
      using errcode = 'P0001';
  end if;

  select p.max_operational_professionals into v_max
  from public.commercial_plans p
  where p.plan_key = v_plan;

  -- NULL is UNLIMITED, and it is reached only through a plan that genuinely
  -- exists — v_plan was resolved above and an unknown plan already raised. So
  -- this NULL means "team is included", never "we could not work it out".
  if v_max is null then
    return;
  end if;

  v_used := private.org_active_professionals(p_organization_id);

  if v_used + 1 > v_max then
    raise exception
      'the % plan covers % operational professional(s); this organization already rosters %',
      v_plan, v_max, v_used
      using errcode = 'P0001',
            hint = 'Move to a Salon or Multi-salons plan to roster a team. No professional identity, appointment history or relationship is removed by this refusal.';
  end if;
end;
$$;

comment on function private.assert_professional_capacity(uuid) is
  'Refuses to let an organization roster one more ACTIVE operational professional than its plan covers. NULL max means unlimited, which is how "team is included" is spelled — every salon and multi-salon plan reaches that branch. Race-free through SELECT ... FOR UPDATE on the same commercial-state row the establishment cap locks. Counts roster placements (barbers with an active staff_profile), never public.professionals: a durable professional identity is not a commercial object and is never counted, restricted or deleted by anything in R2.';

revoke all on function private.assert_professional_capacity(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Adding someone to a roster
--
-- BEFORE INSERT on barbers. The row does not exist yet, so the count is the
-- current one and the question is "does one more fit".
--
-- An UPDATE that moves a roster placement between organizations is also a
-- capacity event. No code path does this today; leaving it unchecked would
-- create one.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_barber_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
begin
  if tg_op = 'UPDATE' and new.organization_id = old.organization_id then
    return new;
  end if;

  -- A roster placement whose staff profile is inactive is not operational and
  -- consumes nothing. Reactivating that profile comes back through the
  -- staff_profiles trigger below.
  select sp.is_active into v_active
  from public.staff_profiles sp
  where sp.id = new.staff_profile_id;

  if coalesce(v_active, false) then
    perform private.assert_professional_capacity(new.organization_id);
  end if;

  return new;
end;
$$;

comment on function public.enforce_barber_capacity() is
  'Applies the plan professional cap when a professional is added to a roster, or moved between organizations. Fires for every writer including service_role and postgres — an invitation flow, an onboarding RPC and a raw INSERT are all the same commercial event.';

drop trigger if exists barbers_enforce_professional_capacity on public.barbers;
create trigger barbers_enforce_professional_capacity
  before insert or update of organization_id, staff_profile_id on public.barbers
  for each row execute function public.enforce_barber_capacity();

-- ---------------------------------------------------------------------------
-- 3. Bringing someone back
--
-- BEFORE UPDATE on staff_profiles, on the false -> true transition only, and
-- only when the profile actually backs a roster placement. Without this,
-- offboard -> downgrade -> re-onboard walks straight past the cap.
--
-- The profile is still is_active = false in the table at BEFORE UPDATE time, so
-- it is excluded from the count and the "+1" in assert_professional_capacity is
-- correct rather than off by one.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_staff_reactivation_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_active or not new.is_active then
    return new;
  end if;

  if exists (select 1 from public.barbers b where b.staff_profile_id = new.id) then
    perform private.assert_professional_capacity(new.organization_id);
  end if;

  return new;
end;
$$;

comment on function public.enforce_staff_reactivation_capacity() is
  'Closes the offboard -> downgrade -> re-onboard bypass. Reactivating a staff profile that backs a roster placement is the same commercial event as adding a professional, so it takes the same lock and the same cap. Only the false -> true transition is a capacity event; every other staff_profiles update passes through untouched.';

drop trigger if exists staff_profiles_enforce_professional_capacity on public.staff_profiles;
create trigger staff_profiles_enforce_professional_capacity
  before update of is_active on public.staff_profiles
  for each row execute function public.enforce_staff_reactivation_capacity();

-- ---------------------------------------------------------------------------
-- 4. Prove both triggers are attached, and that R1B is untouched
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'barbers_enforce_professional_capacity'
      and tgrelid = 'public.barbers'::regclass and not tgisinternal
  ) then
    raise exception 'R2 capacity check failed: the professional capacity trigger is not attached to public.barbers'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'staff_profiles_enforce_professional_capacity'
      and tgrelid = 'public.staff_profiles'::regclass and not tgisinternal
  ) then
    raise exception 'R2 capacity check failed: the reactivation capacity trigger is not attached to public.staff_profiles'
      using errcode = 'P0001';
  end if;

  -- R1B's identity trigger must still be the thing that mints a professional
  -- when a roster row appears. R2 adds a cap in front of it and must not have
  -- replaced it: if this is missing, R2 has broken durable identity while
  -- enforcing a price.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.barbers'::regclass and not tgisinternal
      and tgname = 'barbers_assign_professional'
  ) then
    raise exception 'R2 capacity check failed: R1B''s barbers_assign_professional trigger is missing — R2 must add a cap in front of identity, never replace it'
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  raise notice 'R2 operational professional capacity enforcement installed';
end $$;
