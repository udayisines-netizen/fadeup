-- FadeUp — R2: the establishment cap, enforced where a browser cannot reach
--
-- WHAT WAS ACTUALLY POSSIBLE BEFORE THIS FILE
--
-- public.locations has an INSERT policy granting any owner or manager the right
-- to create a location (20260809100900_tenant_rls_policies.sql). Locations are
-- created by a DIRECT PostgREST insert — there is no RPC in the path. So a
-- single-salon shop could open a browser console and create its eleventh
-- address, and the only thing that would have stopped it was a number rendered
-- on a pricing page.
--
-- A commercial limit that lives in the UI is not a limit. This trigger is.
--
-- WHY A TRIGGER RATHER THAN AN RLS `with check`
--
--   * RLS is bypassed by service_role and by postgres, both of which hold
--     BYPASSRLS in this stack. A cap expressed as a policy would hold for the
--     browser and evaporate for every server-side path, which is the wrong way
--     round for a COMMERCIAL rule.
--   * A `with check` cannot take a lock, so it cannot be made race-free.
--   * A trigger fires for every writer — PostgREST, an RPC, a background job,
--     psql — which is what "the database enforces it" has to mean.
--
-- THE RACE, AND HOW IT IS CLOSED
--
-- Two managers of a multi_growth organization (cap 2, one location existing)
-- both press "add location" at the same instant. Both transactions count 1,
-- both conclude 1 + 1 <= 2, both insert, and the organization has three
-- locations on a two-location plan. Counting is not enough; the count has to be
-- serialised.
--
-- The mutex is the organization's commercial-state row, which 20260826110100
-- made exactly-one-per-organization by using organization_id as the primary
-- key. Each transaction takes `SELECT ... FOR UPDATE` on it BEFORE counting.
-- The second blocks until the first commits or rolls back, and only then takes
-- its count — under READ COMMITTED that is a fresh statement, so it sees a
-- committed sibling insert. There is no window in which two writers hold the
-- same stale count.
--
-- Locking a row the organization already owns, rather than an advisory lock
-- keyed on a hashed uuid, means the lock is visible in pg_locks as what it is
-- and is released by ordinary transaction end. Advisory locks would also work
-- and are harder to reason about when something goes wrong at 2am.
--
-- WHAT COUNTS, AND WHAT DELIBERATELY DOES NOT
--
--   counts      an ACTIVE location
--   ignores     an inactive location. A shop that closed an address is not
--               operating it. This also means DEACTIVATING a location frees
--               capacity, which is the correct and non-destructive way for an
--               over-capacity organization to come back into compliance —
--               nothing is deleted to satisfy a plan.
--
-- Reactivating an inactive location is therefore also a capacity event, and is
-- checked here too. Without that, "deactivate, downgrade, reactivate" would be
-- a three-step bypass.
--
-- OPERATOR NOTE
--
-- This trigger fires for postgres and service_role as well; there is no session
-- override GUC and no role exemption, deliberately. A restore that must exceed
-- current capacity is a `pg_restore --disable-triggers` (explicit and loud) or a
-- plan change through public.assign_commercial_plan() (audited). Both are better
-- than a magic setting that a future RPC might learn to set.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

create or replace function public.enforce_establishment_capacity()
returns trigger
language plpgsql
-- SECURITY DEFINER because organization_commercial_state has every client
-- privilege revoked and FORCE RLS enabled; the definer (postgres, BYPASSRLS)
-- can read and lock it while the calling manager cannot read it directly at
-- all. search_path is pinned and every name is schema-qualified, so a caller
-- cannot substitute their own commercial_plans table.
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_max integer;
  v_used integer;
begin
  -- An inactive location consumes no capacity, so creating one is always
  -- allowed. It also cannot be a bypass: switching it on later comes back
  -- through this same trigger on UPDATE.
  if not new.is_active then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Only two kinds of UPDATE are capacity events: switching a location back
    -- on, and moving it to a different organization (which no code path does,
    -- but an unchecked one would be a way to smuggle capacity between tenants).
    if old.is_active and new.organization_id = old.organization_id then
      return new;
    end if;
  end if;

  -- Guarantee the row that is about to be locked exists. In every normal path
  -- it already does — organizations get commercial state on insert and the R2
  -- backfill covered the rest — so this is the safety net for a restore or a
  -- future code path, and it creates the most restrictive plan, never a
  -- permissive one.
  perform private.ensure_organization_commercial_state(new.organization_id);

  -- THE MUTEX. Everything after this line is serialised per organization.
  perform 1
  from public.organization_commercial_state s
  where s.organization_id = new.organization_id
  for update;

  v_plan := private.effective_plan_key(new.organization_id);

  select p.max_establishments into v_max
  from public.commercial_plans p
  where p.plan_key = v_plan;

  if v_max is null then
    -- No commercial state, or a plan that is not in the catalogue. Fail closed:
    -- an unresolvable plan must never be read as "unlimited".
    raise exception 'cannot create an establishment: the organization has no resolvable commercial plan'
      using errcode = 'P0001',
            hint = 'Every organization must have a row in organization_commercial_state naming a plan that exists in commercial_plans.';
  end if;

  -- The row being inserted (or reactivated) is not yet part of this count: on
  -- INSERT it does not exist, and on the reactivation path it is still
  -- is_active = false in the table. So the question is always "does one more
  -- fit".
  v_used := private.org_active_establishments(new.organization_id);

  if v_used + 1 > v_max then
    raise exception
      'the % plan covers % active establishment(s); this organization already operates %',
      v_plan, v_max, v_used
      using errcode = 'P0001',
            hint = 'Move to a Multi-salons plan to operate more establishments. Existing establishments are never removed to satisfy a plan.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_establishment_capacity() is
  'Enforces the plan establishment cap on public.locations for EVERY writer — PostgREST, RPCs, service_role and postgres alike — because a commercial limit that only holds for the browser is not a limit. Race-free: it takes SELECT ... FOR UPDATE on the organization''s single commercial-state row before counting, so two concurrent "add location" requests cannot both pass on the same stale count. Only ACTIVE locations count, so deactivating one frees capacity — that is the non-destructive route back into compliance, and it is why reactivation is checked here too.';

drop trigger if exists locations_enforce_establishment_capacity on public.locations;
create trigger locations_enforce_establishment_capacity
  before insert or update of is_active, organization_id on public.locations
  for each row execute function public.enforce_establishment_capacity();

-- ---------------------------------------------------------------------------
-- Prove the trigger is actually attached
--
-- A migration that creates a function and fails to attach it produces a
-- database that looks enforced and is not. Cheap to check, and the failure mode
-- it prevents is silent.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'locations_enforce_establishment_capacity'
      and tgrelid = 'public.locations'::regclass
      and not tgisinternal
  ) then
    raise exception 'R2 capacity check failed: the establishment capacity trigger is not attached to public.locations'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_establishment_capacity'
      and p.prosecdef
      and exists (
        -- Postgres stores `set search_path = ''` as the literal
        -- search_path="" — quotes included — so the match is a prefix, not an
        -- equality. Checked against pg_proc on the live stack rather than
        -- assumed.
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  ) then
    raise exception 'R2 capacity check failed: enforce_establishment_capacity must be SECURITY DEFINER with a pinned search_path'
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  raise notice 'R2 establishment capacity enforcement installed';
end $$;
