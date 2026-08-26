-- FadeUp — R2: who may change a plan, and what a downgrade is allowed to do
--
-- THE TWO THINGS THIS FILE GUARANTEES
--
--   1. A CLIENT CANNOT GRANT ITSELF A PLAN.
--      Not a customer, not a barber, not a receptionist, not a manager, not an
--      owner. The only caller who can is a platform admin, through one audited
--      RPC. Everything else has no privilege on the table to begin with, so
--      "PATCH plan_key = multi_scale" is not a request that gets refused — it
--      is a request that has no statement to make.
--
--   2. A DOWNGRADE NEVER DELETES ANYTHING.
--      Moving from multi_scale (10) to multi_growth (2) with eight
--      establishments does not deactivate six of them, does not archive them,
--      does not hide them. It FAILS, and it says why. Data an organization
--      created is theirs; a plan is a statement about capacity going forward,
--      not a licence to destroy history retroactively.
--
--      The organization's own route down is to deactivate what it no longer
--      operates FIRST, deliberately, and then change plan. That keeps the
--      decision with the people whose business it is.
--
-- ENFORCED TWICE, ON PURPOSE
--
-- The RPC checks capacity and produces a good error message. A BEFORE UPDATE
-- trigger checks it again for every writer, including postgres and
-- service_role, so a well-meaning operator running raw SQL at 2am cannot
-- silently put an organization on a plan that does not cover it. The RPC is the
-- ergonomics; the trigger is the guarantee.
--
-- WHY CANCELLING IS NOT A DOWNGRADE
--
-- status = canceled resolves to free capacity, which a five-location group
-- obviously exceeds — so if cancellation were treated as a downgrade, an
-- organization that stopped paying could never be cancelled. That is backwards.
-- Cancellation is always permitted, changes no data, and simply stops growth:
-- the five locations remain, and a sixth is refused. The capacity rule applies
-- to a change of PLAN, which is a commercial choice, and not to a change of
-- STATUS, which is usually a consequence.
--
-- WHAT entitlement_source RECORDS HERE
--
-- 'platform_grant', always. A human at FadeUp decided this. That is an honest
-- description of what actually happened and is deliberately NOT 'billing':
-- there is no billing provider in this repository, and a plan that appeared
-- because staff granted it must never be mistaken later for a plan somebody
-- paid for. When billing exists, it gets its own writer and its own source
-- value, and this RPC keeps meaning exactly what it means today.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The integrity trigger — the guarantee
--
-- Fires on UPDATE only. INSERT is deliberately exempt: the R2 backfill assigns
-- multi_scale to an organization that already exceeded every plan FadeUp sells,
-- and that documented over-capacity state must be recordable. What must never
-- happen afterwards is someone REDUCING capacity below what is in use.
--
-- The rule, stated precisely:
--
--   a change of plan_key is refused when the new plan's capacity is below
--   current usage AND the new capacity is lower than the old one.
--
-- The second clause is what lets an already-over-capacity organization move
-- sideways or upward. Without it, the backfilled eleven-location organization
-- would be frozen on multi_scale forever, unable even to be moved to a plan
-- that helps it, which would be a rule punishing the wrong party.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_commercial_state_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_max_est integer;
  v_old_max_est integer;
  v_new_max_pro integer;
  v_old_max_pro integer;
  v_used_est integer;
  v_used_pro integer;
begin
  -- A status change, a note, a provider reference: none of these are capacity
  -- events. Only a change of plan is.
  if new.plan_key = old.plan_key then
    return new;
  end if;

  select p.max_establishments, p.max_operational_professionals
    into v_new_max_est, v_new_max_pro
  from public.commercial_plans p where p.plan_key = new.plan_key;

  select p.max_establishments, p.max_operational_professionals
    into v_old_max_est, v_old_max_pro
  from public.commercial_plans p where p.plan_key = old.plan_key;

  if v_new_max_est is null then
    raise exception 'unknown plan %', new.plan_key using errcode = 'P0001';
  end if;

  v_used_est := private.org_active_establishments(new.organization_id);
  v_used_pro := private.org_active_professionals(new.organization_id);

  -- Establishments. `v_new_max_est < v_old_max_est` is the "this is a
  -- downgrade" test; an upgrade or a sideways move is never blocked, even for
  -- an organization that is already over capacity.
  if v_used_est > v_new_max_est and v_new_max_est < v_old_max_est then
    raise exception
      'cannot move to %: it covers % establishment(s) and this organization operates %',
      new.plan_key, v_new_max_est, v_used_est
      using errcode = 'P0001',
            hint = 'Deactivate the establishments no longer in use first. FadeUp never deletes or deactivates an establishment to satisfy a plan change.';
  end if;

  -- Professionals. NULL on either side means unlimited, so a move TO unlimited
  -- is never a downgrade and a move FROM unlimited to a number is always one.
  if v_new_max_pro is not null
     and v_used_pro > v_new_max_pro
     and (v_old_max_pro is null or v_new_max_pro < v_old_max_pro) then
    raise exception
      'cannot move to %: it covers % operational professional(s) and this organization rosters %',
      new.plan_key, v_new_max_pro, v_used_pro
      using errcode = 'P0001',
            hint = 'Offboard the professionals no longer working here first. Offboarding preserves their identity, their followers and their appointment history — FadeUp never deletes a professional to satisfy a plan change.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_commercial_state_integrity() is
  'Refuses a plan change that would leave an organization over capacity, for EVERY writer including postgres and service_role — so a downgrade can never quietly imply that data should be removed to fit. Only a change of plan_key is a capacity event: a status change (including cancellation) is always permitted, because an organization that stopped paying must remain cancellable and cancelling deletes nothing. INSERT is exempt so the documented over-capacity backfill state stays recordable, and an already-over-capacity organization can still be moved to a better plan.';

drop trigger if exists organization_commercial_state_integrity on public.organization_commercial_state;
create trigger organization_commercial_state_integrity
  before update on public.organization_commercial_state
  for each row execute function public.enforce_commercial_state_integrity();

-- ---------------------------------------------------------------------------
-- 2. public.assign_commercial_plan — the one legitimate way in
--
-- PLATFORM ADMIN ONLY. Until billing exists, somebody has to be able to put an
-- organization on the plan it agreed to, and development and testing need the
-- same door. Making that door explicit, narrow and audited is strictly better
-- than the alternative everyone reaches for otherwise, which is loosening the
-- table privileges "just for now".
--
-- Note what is NOT a parameter: entitlement_source, provider, or anything else
-- that could be used to dress a staff decision up as a payment. The source is
-- hard-coded to platform_grant.
-- ---------------------------------------------------------------------------

create or replace function public.assign_commercial_plan(
  p_organization_id uuid,
  p_plan_key text,
  p_status public.commercial_status default 'active',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_old_plan text;
  v_old_status public.commercial_status;
  v_max_est integer;
  v_max_pro integer;
  v_used_est integer;
  v_used_pro integer;
  v_change_id uuid;
begin
  v_actor := (select auth.uid());

  if v_actor is null then
    raise exception 'changing a commercial plan requires an authenticated session'
      using errcode = '42501';
  end if;

  -- The whole authorization decision, in one line, resolved from the session
  -- and never from an argument. An owner of the organization is NOT sufficient:
  -- the organization is the party being charged, and a party cannot decide what
  -- it owes.
  if not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff may change an organization commercial plan'
      using errcode = '42501';
  end if;

  if p_organization_id is null then
    raise exception 'organization is required' using errcode = '22023';
  end if;

  -- Unknown plan fails closed and says so, rather than being coerced into
  -- something plausible. is_available is checked too: a withdrawn plan may be
  -- kept for the organizations already on it, and must not be newly assignable.
  select p.max_establishments, p.max_operational_professionals
    into v_max_est, v_max_pro
  from public.commercial_plans p
  where p.plan_key = p_plan_key and p.is_available;

  if v_max_est is null then
    raise exception 'unknown or unavailable plan: %', coalesce(p_plan_key, '(null)')
      using errcode = '22023',
            hint = 'Plan keys are free, solo, salon_essential, salon_pro, salon_business, multi_growth, multi_pro, multi_scale.';
  end if;

  perform private.ensure_organization_commercial_state(p_organization_id);

  -- Serialise against concurrent assignment AND against concurrent location or
  -- roster creation: this is the same row those triggers lock, so "downgrade
  -- while another location is being created" cannot interleave into a state
  -- where both succeeded.
  select s.plan_key, s.status into v_old_plan, v_old_status
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id
  for update;

  if v_old_plan is null then
    raise exception 'organization not found' using errcode = '42704';
  end if;

  if v_old_plan = p_plan_key and v_old_status = p_status then
    raise exception 'organization is already on % with status %', p_plan_key, p_status
      using errcode = 'P0001';
  end if;

  -- Counted AFTER the lock, so the numbers in the error message are the
  -- numbers the decision was made on.
  v_used_est := private.org_active_establishments(p_organization_id);
  v_used_pro := private.org_active_professionals(p_organization_id);

  -- The same rule the trigger enforces, checked here so the caller gets an
  -- explanation rather than a constraint violation. Defence in depth, not a
  -- substitute: the trigger still runs on the UPDATE below.
  if v_used_est > v_max_est then
    raise exception
      'cannot move to %: it covers % establishment(s) and this organization operates %. Nothing has been changed.',
      p_plan_key, v_max_est, v_used_est
      using errcode = 'P0001',
            hint = 'Deactivate the establishments no longer in use first. FadeUp does not remove establishments to satisfy a plan change.';
  end if;

  if v_max_pro is not null and v_used_pro > v_max_pro then
    raise exception
      'cannot move to %: it covers % operational professional(s) and this organization rosters %. Nothing has been changed.',
      p_plan_key, v_max_pro, v_used_pro
      using errcode = 'P0001',
            hint = 'Offboard the professionals no longer working here first. Their identity, followers and appointment history are preserved either way.';
  end if;

  update public.organization_commercial_state
  set plan_key = p_plan_key,
      status = p_status,
      -- Hard-coded. A staff decision is a staff decision, and no argument to
      -- this function can make it look like a payment.
      entitlement_source = 'platform_grant',
      assigned_at = now(),
      assigned_by = v_actor,
      assignment_note = p_note
  where organization_id = p_organization_id;

  insert into public.commercial_plan_changes
    (organization_id, previous_plan_key, new_plan_key,
     previous_status, new_status, entitlement_source, changed_by, change_reason)
  values
    (p_organization_id, v_old_plan, p_plan_key,
     v_old_status, p_status, 'platform_grant', v_actor, p_note)
  returning id into v_change_id;

  return v_change_id;
end;
$$;

comment on function public.assign_commercial_plan(uuid, text, public.commercial_status, text) is
  'The ONLY way a commercial plan changes. Platform admin only, resolved from auth.uid() and never from an argument — an owner of the organization is deliberately not sufficient, because the party being charged cannot decide what it owes. Refuses unknown and withdrawn plans, refuses a downgrade that the organization''s current establishments or roster would not fit (nothing is ever deleted to make one fit), takes the same row lock the capacity triggers take so a downgrade cannot interleave with a location being created, and appends an immutable audit row. entitlement_source is hard-coded to platform_grant: no argument to this function can dress a staff decision up as a payment.';

revoke execute on function public.assign_commercial_plan(uuid, text, public.commercial_status, text) from public, anon;
-- Granted to authenticated because that is the only role a JWT can present;
-- the function itself is what refuses everyone who is not platform staff. The
-- alternative — a dedicated database role — would need a second authenticator
-- path that does not exist in this stack.
grant execute on function public.assign_commercial_plan(uuid, text, public.commercial_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Re-assert that no client can write commercial state directly
--
-- 20260826110100 revoked these at creation. Re-asserting is free and turns
-- "clients cannot write commercial state" into a property THIS migration
-- verifies, rather than one inherited from a file above it that a later edit
-- might weaken.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate on public.organization_commercial_state from anon, authenticated;
revoke insert, update, delete, truncate on public.commercial_plan_changes from anon, authenticated;
revoke insert, update, delete, truncate on public.commercial_plans from anon, authenticated;
revoke insert, update, delete, truncate on public.commercial_capabilities from anon, authenticated;
revoke insert, update, delete, truncate on public.plan_capabilities from anon, authenticated;

do $$
declare
  v_bad text := '';
  r record;
begin
  for r in
    select g.table_name, g.grantee, g.privilege_type
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('organization_commercial_state', 'commercial_plan_changes',
                           'commercial_plans', 'commercial_capabilities', 'plan_capabilities')
      and g.grantee in ('anon', 'authenticated', 'PUBLIC')
      and g.privilege_type <> 'SELECT'
  loop
    v_bad := v_bad || format(' %s/%s/%s', r.table_name, r.grantee, r.privilege_type);
  end loop;

  if v_bad <> '' then
    raise exception 'R2 plan-assignment check failed — a client role holds a write privilege on commercial state:%', v_bad
      using errcode = 'P0001';
  end if;

  -- And no write POLICY either. Privileges and policies are two independent
  -- locks and this lot depends on both being shut.
  select coalesce(string_agg(format(' %s/%s', tablename, policyname), ''), '')
    into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('organization_commercial_state', 'commercial_plan_changes',
                      'commercial_plans', 'commercial_capabilities', 'plan_capabilities')
    and cmd <> 'SELECT';

  if v_bad <> '' then
    raise exception 'R2 plan-assignment check failed — a non-SELECT policy exists on commercial state:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  raise notice 'R2 plan assignment controls installed';
end $$;
