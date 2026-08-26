-- FadeUp — R2: give every EXISTING organization commercial state, without
--               inventing a payment
--
-- THE PROBLEM
--
-- 20260826110100 gives every organization created FROM NOW ON a default
-- commercial state through an AFTER INSERT trigger. Organizations that already
-- exist have none, and an organization with no commercial state is an
-- organization every entitlement check must fail closed on — which would lock
-- the existing product out of itself.
--
-- WHAT THIS BACKFILL IS ALLOWED TO CLAIM, AND WHAT IT IS NOT
--
-- It is NOT allowed to claim that anyone paid. There is no billing integration
-- in this repository, so there is no evidence to record, so entitlement_source
-- is 'early_access' for every row this file writes, provider stays NULL, and
-- status is 'active' because the assigned plan genuinely is in force — not
-- because a charge succeeded.
--
-- 'early_access' is a true statement about the world, not a euphemism. FadeUp
-- has been telling visitors exactly this on /pricing: "Every organization gets
-- the same product today while FadeUp is in early access." Writing that down is
-- honest. Writing 'billing' would not be, and the CHECK constraint on
-- organization_commercial_state would refuse it anyway for lack of a provider.
--
-- THE DERIVATION, AND WHY IT IS THE CHEAPEST COVERING PLAN
--
-- The temptation is to look at a shop using the Pro workspace and record
-- salon_pro. That fabricates a TIER — it decides that this shop chose the EUR
-- 49 product when nobody ever asked them. So the rule is minimal instead:
--
--   assign the CHEAPEST plan whose capacity already covers the shape the
--   organization has today.
--
-- Nothing is granted that the organization is not already using. Nothing is
-- taken away that it is already using. No premium tier is invented. Concretely,
-- with L = active locations and P = active operational professionals:
--
--   L = 0 and P = 0   ->  free
--                         An organization that never finished onboarding starts
--                         exactly where a new one starts. Recording anything
--                         else would be granting a product to a shop that has
--                         not yet opened.
--   L <= 1 and P <= 1 ->  solo
--                         One professional, one place: that IS the Independent
--                         product, and it is cheaper than any salon plan.
--   L <= 1            ->  salon_essential
--                         One salon with a team. The CHEAPEST single-salon
--                         plan, deliberately — not salon_pro, however much the
--                         shop currently uses the live queue.
--   L <= 2            ->  multi_growth
--   L <= 5            ->  multi_pro
--   L <= 10           ->  multi_scale
--   L > 10            ->  multi_scale, with the overage recorded in
--                         assignment_note.
--
-- THE OVER-CAPACITY CASE IS NOT RESOLVED BY DELETING ANYTHING
--
-- An organization with eleven active locations exceeds every plan FadeUp sells.
-- The response is NOT to deactivate the eleventh, and NOT to invent an
-- unlimited plan. It is assigned multi_scale, the discrepancy is written into
-- assignment_note so it is discoverable rather than silent, and the capacity
-- trigger in 20260826110400 will refuse a TWELFTH. Existing data is preserved;
-- growth is what stops. That is the same non-destructive rule downgrades follow
-- in 20260826110600, applied to a state that predates the rule.
--
-- CONSEQUENCE AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A one-location, one-professional organization is backfilled to `solo`, and
--   solo covers exactly one professional. The next barber that organization
--   hires will be refused by the roster capacity trigger until the plan is
--   changed. That is the intended commercial behaviour, not a defect — and
--   public.assign_commercial_plan() is the supported, audited way to change it.
--
-- Idempotent: only writes where no row exists, so re-running is a no-op rather
-- than a second audit entry.

set lock_timeout = '5s';

do $$
declare
  v_backfilled integer := 0;
  v_free integer := 0;
  v_over_capacity integer := 0;
begin
  -- One statement, one pass. A cursor per organization would be easier to read
  -- and would also hold the transaction open across thousands of round trips
  -- for no benefit: the derivation is pure arithmetic over two counts.
  with shape as (
    select
      o.id as organization_id,
      (
        select count(*)
        from public.locations l
        where l.organization_id = o.id and l.is_active
      ) as active_locations,
      (
        select count(*)
        from public.barbers b
        join public.staff_profiles sp on sp.id = b.staff_profile_id
        where b.organization_id = o.id and sp.is_active
      ) as active_professionals
    from public.organizations o
    where not exists (
      select 1 from public.organization_commercial_state s
      where s.organization_id = o.id
    )
  ),
  derived as (
    select
      shape.*,
      case
        when active_locations = 0 and active_professionals = 0 then 'free'
        when active_locations <= 1 and active_professionals <= 1 then 'solo'
        when active_locations <= 1 then 'salon_essential'
        when active_locations <= 2 then 'multi_growth'
        when active_locations <= 5 then 'multi_pro'
        else 'multi_scale'
      end as plan_key
    from shape
  ),
  inserted as (
    insert into public.organization_commercial_state
      (organization_id, plan_key, status, entitlement_source,
       assigned_at, assigned_by, assignment_note)
    select
      d.organization_id,
      d.plan_key,
      'active',
      -- No payment is claimed anywhere in this file. See the header.
      'early_access',
      now(),
      null,
      case
        when d.active_locations > 10 then
          format(
            'R2 backfill: cheapest covering plan for %s active location(s) and %s active professional(s). '
            || 'OVER CAPACITY — this organization exceeds every plan FadeUp sells; existing locations are '
            || 'preserved untouched and further establishment creation will be refused until the plan is '
            || 'reviewed. No payment is asserted: entitlement_source is early_access.',
            d.active_locations, d.active_professionals)
        else
          format(
            'R2 backfill: cheapest plan whose capacity already covers %s active location(s) and %s active '
            || 'professional(s). No tier was inferred from usage and no payment is asserted: '
            || 'entitlement_source is early_access.',
            d.active_locations, d.active_professionals)
      end
    from derived d
    returning organization_id, plan_key
  ),
  logged as (
    insert into public.commercial_plan_changes
      (organization_id, previous_plan_key, new_plan_key,
       previous_status, new_status, entitlement_source, changed_by, change_reason)
    select
      i.organization_id, null, i.plan_key, null, 'active', 'early_access', null,
      'R2 backfill: organization predates the commercial model. Cheapest covering plan assigned; no payment asserted.'
    from inserted i
    returning 1
  )
  select
    (select count(*) from logged),
    (select count(*) from derived where plan_key = 'free'),
    (select count(*) from derived where active_locations > 10)
  into v_backfilled, v_free, v_over_capacity;

  raise notice 'R2 backfill: % organization(s) given commercial state (% on free, % over capacity)',
    v_backfilled, v_free, v_over_capacity;
end $$;

-- ---------------------------------------------------------------------------
-- Assert the backfill actually covered everything
--
-- A backfill that silently missed rows is worse than one that failed, because
-- the missed organizations only surface later as entitlement checks failing
-- closed on real traffic.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing integer;
  v_fabricated integer;
begin
  select count(*) into v_missing
  from public.organizations o
  where not exists (
    select 1 from public.organization_commercial_state s where s.organization_id = o.id
  );

  if v_missing > 0 then
    raise exception 'R2 backfill check failed: % organization(s) still have no commercial state', v_missing
      using errcode = 'P0001';
  end if;

  -- Nothing in this repository may claim a payment. If a row exists with
  -- entitlement_source = billing after R2 installs, something fabricated it.
  select count(*) into v_fabricated
  from public.organization_commercial_state
  where entitlement_source = 'billing';

  if v_fabricated > 0 then
    raise exception 'R2 backfill check failed: % organization(s) claim billing as their entitlement source, but no billing provider exists in this repository', v_fabricated
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  v_bad integer;
begin
  -- Every backfilled organization's plan must actually cover the shape it has.
  -- If the derivation above is ever edited into something that under-grants,
  -- this catches it here rather than at the first refused location insert.
  select count(*) into v_bad
  from public.organization_commercial_state s
  join public.commercial_plans p on p.plan_key = s.plan_key
  join public.organizations o on o.id = s.organization_id
  where (
    select count(*) from public.locations l
    where l.organization_id = o.id and l.is_active
  ) > p.max_establishments
  -- The documented, deliberate exception: an organization that already exceeded
  -- every plan FadeUp sells. It keeps every location it has; only growth stops.
  and p.plan_key <> 'multi_scale';

  if v_bad > 0 then
    raise exception 'R2 backfill check failed: % organization(s) were assigned a plan that does not cover their existing locations', v_bad
      using errcode = 'P0001';
  end if;
end $$;
